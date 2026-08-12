/**
 * Construcción del payload de reserva para Fourvenues a partir del borrador de la
 * UI. Lógica pura y segura para el navegador (no toca la API key).
 *
 * Puntos clave del mapeo (ver INTEGRATION.md):
 *  - El referente/RRPP, la hora de llegada y las botellas NO tienen campo propio en
 *    la API: se anotan en `observations_client`.
 *  - Las reservas "no cobrar / 0 €" no se fijan por API. Se detectan por las notas
 *    del RRPP, se avisa en `observations_client` y se envían por el flujo `request`
 *    (lo confirma el local desde el panel), así se omite el cobro automático.
 */

import type {
  CreateBookingBase,
  CreateCheckoutInput,
  FourvenuesBookingInfo,
  FourvenuesRate,
  FourvenuesSpace,
  FourvenuesZone,
} from "./fourvenues";

export type BookingMode = "checkout" | "request";

/** Palabras que marcan una reserva sin cobro (invitación / gratis / 0 €). */
const NO_CHARGE_PATTERNS: RegExp[] = [
  /no\s+cobrar/i,
  /sin\s+cobro/i,
  /sin\s+coste/i,
  /gratis/i,
  /gratuit/i,
  /invitaci[oó]n/i,
  /invitad/i,
  /cortes[ií]a/i,
  /no\s+pagan?/i,
  /0\s*€/,
  /\b0\s*eur/i,
];

/**
 * Reservas con precio distinto al de la tarifa, aunque NO sean gratis: mesas
 * "a copas" (sin botella), consumición mínima… El importe hay que ajustarlo a
 * mano, así que tampoco pueden salir con enlace de pago automático.
 */
const SPECIAL_PRICING_PATTERNS: RegExp[] = [
  /a\s*copas/i,
  /solo\s+copas/i,
  /sin\s+botella/i,
  /consumici[oó]n\s+m[ií]nima/i,
];

/** True si las notas del RRPP indican que la reserva va sin cobro. */
export function detectNoCharge(text: string | undefined | null): boolean {
  if (!text) return false;
  return NO_CHARGE_PATTERNS.some((pattern) => pattern.test(text));
}

/** True si el precio no es el de la tarifa (mesa a copas, mínimo…). */
export function detectSpecialPricing(text: string | undefined | null): boolean {
  if (!text) return false;
  return SPECIAL_PRICING_PATTERNS.some((pattern) => pattern.test(text));
}

/**
 * ¿Tiene que revisarla el local antes de cobrar nada? Tanto las invitaciones
 * como las mesas a copas: en ambos casos el importe no es el de la tarifa.
 */
export function needsVenueReview(text: string | undefined | null): boolean {
  return detectNoCharge(text) || detectSpecialPricing(text);
}

/**
 * Lo que necesita revisión va por `request` (queda "A revisar" en el panel, sin
 * cobro automático). El resto por `checkout`, que genera el enlace de pago.
 */
export function resolveBookingMode(review: boolean): BookingMode {
  return review ? "request" : "checkout";
}

export interface ObservationParts {
  arrival?: string;
  bottles?: number;
  referral?: string;
  /** Mesas combinadas, p. ej. ["201", "202"]. */
  tables?: string[];
  /** Observaciones internas escritas por el RRPP. */
  internalNotes?: string;
  noCharge?: boolean;
  /** Precio distinto al de la tarifa (a copas, mínimo…). */
  specialPricing?: boolean;
  /** Texto de botellas cuando no es un número ("A copas"). */
  bottlesNote?: string;
}

/**
 * Compone el texto de `observations_client` reuniendo lo que no cabe en campos
 * propios de la API (hora, botellas, referente, mesas combinadas y el aviso de no
 * cobro), seguido de las observaciones libres del RRPP.
 */
export function composeClientObservations(parts: ObservationParts): string {
  const lines: string[] = [];

  if (parts.noCharge) {
    lines.push("⚠️ RESERVA SIN COBRO — no cobrar / adelanto 0 € (confirmar en el panel).");
  } else if (parts.specialPricing) {
    // Sin botella el importe no es el de la tarifa: lo ajusta el local.
    lines.push("⚠️ MESA A COPAS (sin botella) — revisar el importe antes de confirmar.");
  }
  if (parts.arrival) lines.push(`Hora de llegada: ${parts.arrival}`);
  if (parts.bottlesNote) {
    lines.push(`Botellas: ${parts.bottlesNote}`);
  } else if (typeof parts.bottles === "number" && parts.bottles > 0) {
    lines.push(`Botellas: ${parts.bottles}`);
  }
  // La mesa NO se puede fijar por API (`can_select_client: false` en producción),
  // así que la elección del RRPP solo llega al local si va escrita aquí. Antes
  // solo se anotaba al combinar varias y la mesa suelta se perdía: la reserva
  // llegaba "Sin colocar" sin rastro de la que se había pedido.
  if (parts.tables?.length) {
    lines.push(
      parts.tables.length > 1
        ? `Mesas solicitadas (combinadas): ${parts.tables.join(" + ")}`
        : `Mesa solicitada: ${parts.tables[0]}`,
    );
  }
  if (parts.referral && parts.referral.toLowerCase() !== "sin asignar") {
    lines.push(`Referente (RRPP): ${parts.referral}`);
  }

  const notes = parts.internalNotes?.trim();
  if (notes) lines.push(notes);

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Resolución de zona / tarifa / mesa contra los datos reales de la API
// ---------------------------------------------------------------------------

export interface ResolvedPlacement {
  zone_slug: string;
  normalized_zone_name: string;
  rate_slug: string;
  /** Solo si la zona permite fijar mesa (`can_select_client`). */
  table_id?: string;
  /** Tarifa elegida, para mostrar precio/adelanto reales en la UI. */
  rate: FourvenuesRate;
  zone: FourvenuesZone;
}

/** Normaliza para comparar nombres de zona/mesa sin acentos ni mayúsculas. */
function normalize(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

/**
 * Cómo se mapea cada "zona" de la UI a la estructura REAL de Fourvenues.
 *
 * Verificado en el panel de producción de TØTEM Punta Umbría (ago 2026). Lo que
 * la app llama "zona" es en realidad un par **(zona, tarifa)**, y los nombres
 * cambian entre eventos de fiesta y de concierto:
 *
 *  - Fiesta:    PISTA GENERAL (Escenario) · EMBARCADERO DEL PINAR · ARENAS (oculta)
 *  - Concierto: PISTA (CONCIERTO) · PINAR · PISTA GENERAL y ARENAS ocultas
 *
 * Correcciones importantes frente al modelo antiguo:
 *  - **Jaima no es una zona**: J1–J4 son espacios ("Sofá") dentro de PINAR, con la
 *    misma tarifa PRECIO PINAR que las mesas 201–224.
 *  - **Lateral escenario y Front Stage no son zonas**: son tarifas dentro de la
 *    zona PISTA (CONCIERTO).
 *  - La tarifa **no depende del nº de botellas**: es el precio del reservado
 *    (3 personas incluidas + suplemento por persona extra).
 */
export interface ZoneMapping {
  /** Nombres de zona aceptables, en orden de preferencia. */
  zoneAliases: string[];
  /** Nombres de tarifa aceptables dentro de esa zona. */
  rateAliases: string[];
  /** Si se indica, filtra los espacios de la zona (p. ej. solo jaimas J1–J4). */
  spacePattern?: RegExp;
}

export const ZONE_MAPPINGS: Record<string, ZoneMapping> = {
  pinar: {
    zoneAliases: ["EMBARCADERO DEL PINAR", "PINAR"],
    rateAliases: ["PRECIO PINAR"],
    spacePattern: /^\d+$/,
  },
  // Las jaimas comparten zona y tarifa con el Pinar; solo cambian los espacios.
  jaima: {
    zoneAliases: ["EMBARCADERO DEL PINAR", "PINAR"],
    rateAliases: ["PRECIO PINAR"],
    spacePattern: /^J\d+$/i,
  },
  pista: {
    zoneAliases: ["PISTA GENERAL", "PISTA"],
    rateAliases: ["PRECIO FIESTA"],
  },
  lateral: {
    zoneAliases: ["PISTA (CONCIERTO)", "PISTA"],
    rateAliases: ["LATERAL ESCENARIO"],
  },
  front: {
    zoneAliases: ["PISTA (CONCIERTO)", "PISTA"],
    rateAliases: ["FRONT STAGE"],
  },
  arenas: {
    zoneAliases: ["ARENAS"],
    rateAliases: ["PRECIO CHILL"],
  },
};

function matches(candidate: string | undefined | null, alias: string): boolean {
  const a = normalize(candidate ?? "");
  const b = normalize(alias);
  // Sin esto, un campo vacío haría match con CUALQUIER alias (la cadena vacía es
  // subcadena de todo) y se acabaría reservando en la zona equivocada.
  if (!a || !b) return false;
  return a === b || a.includes(b) || b.includes(a);
}

/**
 * Localiza la zona real a partir de los alias, probándolos en orden y
 * descartando las zonas ocultas/no disponibles cuando hay alternativa.
 */
export function findZone(
  zones: FourvenuesZone[],
  aliases: string[],
): FourvenuesZone | undefined {
  const usable = zones.filter((zone) => zone.available !== false);
  for (const pool of [usable, zones]) {
    for (const alias of aliases) {
      const hit = pool.find(
        (zone) =>
          matches(zone.name, alias) ||
          matches(zone.normalized_name ?? "", alias) ||
          matches(zone.slug, alias),
      );
      if (hit) return hit;
    }
  }
  return undefined;
}

/** Mesas realmente vendibles: ni bloqueadas, ni ocultas, ni sin disponibilidad. */
export function sellableSpaces(zone: FourvenuesZone): FourvenuesSpace[] {
  return (zone.spaces ?? []).filter(
    (space) => space.available !== false && !space.blocked && !space.hidden,
  );
}

/**
 * Tarifas aplicables a una zona. Muchas zonas NO traen `rates`: en ese caso las
 * tarifas cuelgan de cada mesa y hay que recolectarlas (sin duplicar).
 */
export function zoneRates(zone: FourvenuesZone): FourvenuesRate[] {
  if (zone.rates?.length) return zone.rates;
  const seen = new Set<string>();
  const collected: FourvenuesRate[] = [];
  for (const space of sellableSpaces(zone)) {
    for (const rate of space.rates ?? []) {
      const key = rate.slug || rate._id;
      if (seen.has(key)) continue;
      seen.add(key);
      collected.push(rate);
    }
  }
  return collected;
}

/**
 * Elige la tarifa por nombre (PRECIO PINAR, FRONT STAGE…). El nº de botellas NO
 * determina la tarifa; si ningún alias encaja, se usa la primera disponible.
 */
export function pickRate(
  rates: FourvenuesRate[],
  rateAliases: string[] = [],
): FourvenuesRate | undefined {
  if (rates.length === 0) return undefined;
  for (const alias of rateAliases) {
    const hit = rates.find((rate) => matches(rate.name, alias) || matches(rate.slug, alias));
    if (hit) return hit;
  }
  return rates[0];
}

/**
 * Resuelve zona + tarifa + mesa reales a partir de la selección de la UI.
 * Devuelve `null` si no encuentra la zona o no hay tarifas (no se puede reservar).
 *
 * Ojo: `table_id` solo se envía si la zona expone `can_select_client: true`. En
 * producción esa opción está desactivada para clientes, así que normalmente la
 * mesa concreta la asigna el local (y la anotamos en las observaciones).
 */
export function resolvePlacement(
  zones: FourvenuesZone[],
  selection: { zoneKey: string; tableName?: string },
): ResolvedPlacement | null {
  const mapping = ZONE_MAPPINGS[selection.zoneKey] ?? {
    zoneAliases: [selection.zoneKey],
    rateAliases: [],
  };

  const zone = findZone(zones, mapping.zoneAliases);
  if (!zone) return null;

  return placementForZone(zone, {
    tableName: selection.tableName,
    rateAliases: mapping.rateAliases,
    spacePattern: mapping.spacePattern,
  });
}

/**
 * Construye el placement para una zona ya elegida. Se usa cuando el RRPP
 * selecciona la zona a mano sobre los datos reales de la API (no hace falta
 * adivinarla por alias), y opcionalmente fija la tarifa por slug.
 */
export function placementForZone(
  zone: FourvenuesZone,
  options: {
    tableName?: string;
    rateSlug?: string;
    rateAliases?: string[];
    spacePattern?: RegExp;
    /** Reserva sin cobro: usa una tarifa a 0 € si el local ha creado alguna. */
    preferNoCharge?: boolean;
  } = {},
): ResolvedPlacement | null {
  const spaces = sellableSpaces(zone);
  const candidates = options.spacePattern
    ? spaces.filter((space) => options.spacePattern!.test(space.name))
    : spaces;

  const spaceMatch = options.tableName
    ? candidates.find(
        (space) =>
          matches(space.name, options.tableName as string) ||
          matches(space.normalized_name, options.tableName as string),
      )
    : undefined;

  // Las tarifas pueden colgar de la mesa concreta o de la zona.
  const rates = spaceMatch?.rates?.length ? spaceMatch.rates : zoneRates(zone);
  const rate =
    // Si es sin cobro y existe tarifa a 0 €, manda esa sobre lo demás.
    (options.preferNoCharge ? findNoChargeRate(rates) : undefined) ||
    (options.rateSlug && rates.find((item) => item.slug === options.rateSlug)) ||
    pickRate(rates, options.rateAliases ?? []);
  if (!rate) return null;

  return {
    zone_slug: zone.slug,
    // La API devuelve `normalized_name`; el payload lo espera como
    // `normalized_zone_name`. Si faltara, el slug sirve de respaldo.
    normalized_zone_name: zone.normalized_name || zone.slug,
    rate_slug: rate.slug,
    table_id: zone.can_select_client ? spaceMatch?._id : undefined,
    rate,
    zone,
  };
}

/**
 * Tarifas que sirven para una reserva sin cobro.
 *
 * Fourvenues **no permite fijar el precio por API** (no hay campo de importe ni
 * equivalente al botón "Invitación" del panel): el importe sale siempre de la
 * tarifa. La única vía para que nazca a 0 € es que exista una tarifa a 0 €.
 *
 * Se exige que el precio sea 0 **y** que el nombre lo identifique como tal, para
 * no coger por error una tarifa a 0 € creada con otro fin.
 *
 * ⚠️ **Hoy esa tarifa no se puede tener de forma segura.** Las tarifas no tienen
 * visibilidad propia (heredan la de la zona) y, comprobado en Alpha, la API
 * cuenta como "cliente": si la zona no deja reservar a clientes, la reserva
 * falla con `400 "You are not authorized to reserve a table for this zone"`.
 * O sea, todo lo que la app puede reservar es también reservable desde la web
 * pública, así que una tarifa a 0 € quedaría expuesta.
 *
 * Esta función se mantiene por si en el futuro hay una vía segura; mientras no
 * exista la tarifa, el comportamiento no cambia.
 */
const NO_CHARGE_RATE_PATTERNS: RegExp[] = [
  /invitaci[oó]n/i,
  /invitad/i,
  /a\s*copas/i,
  /cortes[ií]a/i,
  /sin\s+cobro/i,
];

export function findNoChargeRate(rates: FourvenuesRate[]): FourvenuesRate | undefined {
  return rates.find(
    (rate) =>
      rate.price === 0 &&
      NO_CHARGE_RATE_PATTERNS.some((pattern) => pattern.test(rate.name ?? "")),
  );
}

/**
 * Los dos importes de una reserva, que **no** son el mismo número:
 *
 * - `price`: lo que costará la mesa en total (base + suplemento por persona
 *   extra). Es lo que el grupo acaba pagando entre enlace y puerta.
 * - `chargeNow`: lo que cobra el enlace de pago en el momento.
 *
 * Comprobado contra un checkout real (PINAR, tarifa "PRECIO EMBARCADERO",
 * 6 personas): la pasarela pidió 84 €, no los 125 € del total ni el 50 % de
 * adelanto. Es decir, Fourvenues cobra sobre el **precio base** de la tarifa
 * —los suplementos por persona se liquidan en puerta— y le suma su comisión;
 * y si la tarifa es `full_payment`, cobra el 100 %, no el adelanto.
 */
export function priceForRate(rate: FourvenuesRate, people: number) {
  const extraPeople = Math.max(0, people - (rate.included_persons ?? 0));
  const supplementUnit = rate.supplement_persons || 1;
  const extraBlocks = Math.ceil(extraPeople / supplementUnit);
  const price = rate.price + extraBlocks * (rate.supplement_price ?? 0);

  const payable = rate.full_payment
    ? rate.price
    : rate.deposit?.type === "percentage"
      ? (rate.price * (rate.deposit.value ?? 0)) / 100
      : (rate.deposit?.value ?? 0);
  const fee =
    rate.fee_type === "percentage"
      ? (payable * (rate.fee_quantity ?? 0)) / 100
      : (rate.fee_quantity ?? 0);
  const chargeNow = Math.round((payable + fee) * 100) / 100;

  return { price, chargeNow, pendingAtDoor: Math.max(0, price - payable) };
}

// ---------------------------------------------------------------------------
// Ensamblado del payload final
// ---------------------------------------------------------------------------

export interface BuildBookingArgs {
  eventId: string;
  placement: ResolvedPlacement;
  info: FourvenuesBookingInfo;
  observations: string;
  externalChannelId?: string;
  discountCode?: string;
}

/**
 * Payload común a `checkout` y `request`.
 *
 * `zone_slug` y `normalized_zone_name` son excluyentes en la API (400
 * "exclusive peers" si van los dos), así que se manda solo el slug, y el
 * nombre normalizado únicamente como respaldo si no hubiera slug.
 */
function buildBase(args: BuildBookingArgs): CreateBookingBase {
  const { zone_slug, normalized_zone_name } = args.placement;
  return {
    event_id: args.eventId,
    ...(zone_slug ? { zone_slug } : { normalized_zone_name }),
    rate_slug: args.placement.rate_slug,
    table_id: args.placement.table_id,
    external_channel_id: args.externalChannelId,
    observations_client: args.observations || undefined,
    discount_code: args.discountCode,
    info: args.info,
  };
}

export function buildRequestInput(args: BuildBookingArgs): CreateBookingBase {
  return buildBase(args);
}

export interface BuildCheckoutArgs extends BuildBookingArgs {
  redirectUrl?: string;
  errorUrl?: string;
}

export function buildCheckoutInput(args: BuildCheckoutArgs): CreateCheckoutInput {
  return {
    ...buildBase(args),
    redirect_url: args.redirectUrl,
    error_url: args.errorUrl,
    send_resources: true,
  };
}
