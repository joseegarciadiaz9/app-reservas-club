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

/** True si las notas del RRPP indican que la reserva va sin cobro. */
export function detectNoCharge(text: string | undefined | null): boolean {
  if (!text) return false;
  return NO_CHARGE_PATTERNS.some((pattern) => pattern.test(text));
}

/**
 * Reservas sin cobro → `request` (las acepta el local, sin pago automático).
 * El resto → `checkout` (genera enlace de pago).
 */
export function resolveBookingMode(noCharge: boolean): BookingMode {
  return noCharge ? "request" : "checkout";
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
  }
  if (parts.arrival) lines.push(`Hora de llegada: ${parts.arrival}`);
  if (typeof parts.bottles === "number" && parts.bottles > 0) {
    lines.push(`Botellas: ${parts.bottles}`);
  }
  if (parts.tables && parts.tables.length > 1) {
    lines.push(`Mesas combinadas: ${parts.tables.join(" + ")}`);
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

function matches(candidate: string, alias: string): boolean {
  const a = normalize(candidate);
  const b = normalize(alias);
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
          matches(zone.normalized_zone_name, alias) ||
          matches(zone.slug, alias),
      );
      if (hit) return hit;
    }
  }
  return undefined;
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

  const spaces = zone.spaces ?? [];
  const candidates = mapping.spacePattern
    ? spaces.filter((space) => mapping.spacePattern!.test(space.name))
    : spaces;

  const spaceMatch = selection.tableName
    ? candidates.find(
        (space) =>
          matches(space.name, selection.tableName as string) ||
          matches(space.normalized_name, selection.tableName as string),
      )
    : undefined;

  // Las tarifas pueden colgar de la mesa concreta o de la zona.
  const rates = spaceMatch?.rates?.length ? spaceMatch.rates : zone.rates ?? [];
  const rate = pickRate(rates, mapping.rateAliases);
  if (!rate) return null;

  return {
    zone_slug: zone.slug,
    normalized_zone_name: zone.normalized_zone_name,
    rate_slug: rate.slug,
    table_id: zone.can_select_client ? spaceMatch?._id : undefined,
    rate,
    zone,
  };
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

/** Payload común a `checkout` y `request`. */
function buildBase(args: BuildBookingArgs): CreateBookingBase {
  return {
    event_id: args.eventId,
    zone_slug: args.placement.zone_slug,
    normalized_zone_name: args.placement.normalized_zone_name,
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
