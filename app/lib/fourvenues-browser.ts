/**
 * Helper de navegador para hablar con nuestros Route Handlers
 * (/api/fourvenues/*). No toca la API de Fourvenues directamente:
 * la API key vive solo en el servidor.
 */

import type {
  CheckoutResult,
  CreateBookingBase,
  CreateCheckoutInput,
  FourvenuesBooking,
  FourvenuesEvent,
  FourvenuesZone,
} from "./fourvenues";

export interface ApiResult<T> {
  success: boolean;
  data?: T;
  error?: string;
  details?: unknown;
}

async function call<T>(input: RequestInfo, init?: RequestInit): Promise<ApiResult<T>> {
  const response = await fetch(input, init);
  const payload = (await response.json().catch(() => null)) as ApiResult<T> | null;
  if (!payload) {
    return { success: false, error: `Respuesta no válida (${response.status})` };
  }
  return payload;
}

export interface IntegrationStatus {
  configured: boolean;
  baseUrl: string;
}

/** ¿Está la integración con Fourvenues activa (hay API key)? */
export function getIntegrationStatus(): Promise<ApiResult<IntegrationStatus>> {
  return call<IntegrationStatus>("/api/fourvenues/status");
}

/** Eventos de una fecha (YYYY-MM-DD). */
export function fetchEvents(dateIso: string): Promise<ApiResult<FourvenuesEvent[]>> {
  return call<FourvenuesEvent[]>(`/api/fourvenues/events?date=${encodeURIComponent(dateIso)}`);
}

/** Zonas + mesas + tarifas + disponibilidad de un evento. */
export function fetchZones(eventId: string): Promise<ApiResult<FourvenuesZone[]>> {
  return call<FourvenuesZone[]>(`/api/fourvenues/zones?event_id=${encodeURIComponent(eventId)}`);
}

/** Crea una reserva con enlace de pago (checkout). */
export function createCheckout(
  payload: CreateCheckoutInput,
): Promise<ApiResult<{ mode: "checkout" } & CheckoutResult>> {
  return call("/api/fourvenues/bookings", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mode: "checkout", ...payload }),
  });
}

/** Solicita una reserva (el venue la acepta desde el panel). */
export function requestBooking(
  payload: CreateBookingBase,
): Promise<ApiResult<{ mode: "request"; booking: FourvenuesBooking }>> {
  return call("/api/fourvenues/bookings", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mode: "request", ...payload }),
  });
}

/**
 * Convierte una fecha DD/MM/YYYY (como la usa la UI) a YYYY-MM-DD para la API.
 */
export function toIsoDate(ddmmyyyy: string): string {
  const parts = ddmmyyyy.trim().split(/[/.-]/);
  if (parts.length !== 3) return ddmmyyyy;
  const [d, m, y] = parts;
  const year = y.length === 2 ? `20${y}` : y;
  return `${year}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
}
