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

/** Localiza la zona real que corresponde a la etiqueta de la UI ("Pinar", …). */
export function findZone(
  zones: FourvenuesZone[],
  zoneLabel: string,
): FourvenuesZone | undefined {
  const target = normalize(zoneLabel);
  return zones.find(
    (zone) =>
      normalize(zone.name) === target ||
      normalize(zone.normalized_zone_name) === target ||
      normalize(zone.slug) === target ||
      normalize(zone.name).includes(target) ||
      target.includes(normalize(zone.name)),
  );
}

/**
 * Elige la tarifa de una zona. Preferimos la que encaje con el nº de botellas
 * (por nombre/contenido); si no, la primera disponible.
 */
export function pickRate(
  rates: FourvenuesRate[],
  bottles?: number,
): FourvenuesRate | undefined {
  if (rates.length === 0) return undefined;
  if (bottles && bottles > 0) {
    const byBottles = rates.find((rate) =>
      new RegExp(`\\b${bottles}\\b`).test(`${rate.name} ${rate.content}`),
    );
    if (byBottles) return byBottles;
  }
  return rates[0];
}

/**
 * Resuelve zona + tarifa + mesa reales a partir de la selección de la UI.
 * Devuelve `null` si no encuentra la zona o no hay tarifas (no se puede reservar).
 */
export function resolvePlacement(
  zones: FourvenuesZone[],
  selection: { zoneLabel: string; tableName?: string; bottles?: number },
): ResolvedPlacement | null {
  const zone = findZone(zones, selection.zoneLabel);
  if (!zone) return null;

  // Las tarifas pueden estar en la zona o en la mesa concreta.
  const spaceMatch = selection.tableName
    ? zone.spaces.find(
        (space) =>
          normalize(space.name) === normalize(selection.tableName as string) ||
          normalize(space.normalized_name) === normalize(selection.tableName as string),
      )
    : undefined;

  const rates = spaceMatch?.rates?.length ? spaceMatch.rates : zone.rates;
  const rate = pickRate(rates, selection.bottles);
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
