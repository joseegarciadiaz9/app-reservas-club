/**
 * Cliente server-side de la Channel Manager API de Fourvenues.
 *
 * IMPORTANTE: este módulo SOLO debe usarse en el servidor (Route Handlers o
 * Server Actions). La API key nunca puede exponerse en el cliente.
 *
 * Config vía variables de entorno (secrets del Worker):
 *   - FOURVENUES_API_KEY   → clave de Channel Manager con permisos de Booking.
 *   - FOURVENUES_ENV        → "alpha" (por defecto) | "prod".
 *   - FOURVENUES_BASE_URL   → opcional, sobreescribe la base URL.
 *   - FOURVENUES_CHANNEL_ID → opcional, external_channel_id por defecto.
 *
 * Docs: https://docs.fourvenues.com/channel-manager/api-reference
 */

import { env as workerEnv } from "cloudflare:workers";

const BASE_URLS = {
  alpha: "https://channels-service-alpha.fourvenues.com",
  prod: "https://channels-service.fourvenues.com",
} as const;

type FourvenuesEnvName = keyof typeof BASE_URLS;

export interface FourvenuesConfig {
  apiKey: string;
  baseUrl: string;
  defaultChannelId?: string;
}

/** Lee la config desde el entorno del Worker (cloudflare:workers) o process.env. */
export function resolveConfig(overrides?: Partial<FourvenuesConfig>): FourvenuesConfig {
  const bag = readEnvBag();

  const envName = (bag.FOURVENUES_ENV as FourvenuesEnvName) || "alpha";
  const baseUrl =
    overrides?.baseUrl ||
    bag.FOURVENUES_BASE_URL ||
    BASE_URLS[envName] ||
    BASE_URLS.alpha;

  const apiKey = overrides?.apiKey || bag.FOURVENUES_API_KEY || "";

  return {
    apiKey,
    baseUrl,
    defaultChannelId: overrides?.defaultChannelId || bag.FOURVENUES_CHANNEL_ID,
  };
}

/** True cuando hay API key configurada (para alternar simulación / real). */
export function isConfigured(): boolean {
  return Boolean(resolveConfig().apiKey);
}

function readEnvBag(): Record<string, string | undefined> {
  // process.env funciona en dev con Vite/Wrangler y en Node.
  const fromProcess =
    typeof process !== "undefined" && process.env
      ? (process.env as Record<string, string | undefined>)
      : {};

  // En Cloudflare Workers los secrets/vars llegan por el binding `env`
  // (mismo patrón que db/index.ts).
  const fromWorker =
    workerEnv && typeof workerEnv === "object"
      ? (workerEnv as unknown as Record<string, string | undefined>)
      : {};

  return { ...fromProcess, ...fromWorker };
}

// ---------------------------------------------------------------------------
// Tipos de la API
// ---------------------------------------------------------------------------

/**
 * Formas verificadas contra la respuesta real de `GET /bookings/zones/` en Alpha
 * (10-ago-2026). Ojo con dos detalles que no son los que cabría esperar:
 * la zona expone `normalized_name` (no `normalized_zone_name`) y puede **no
 * traer `rates`**: en ese caso las tarifas cuelgan de cada mesa.
 */
export interface FourvenuesRate {
  _id: string;
  slug: string;
  name: string;
  /** Descripción de la tarifa, p. ej. "1 botella de champán. VIP con sofá". */
  content: string;
  /** Condiciones en texto (el local suele aclarar aquí cómo se calcula el precio final). */
  conditions?: string;
  price: number;
  included_persons: number;
  supplement_persons: number;
  supplement_price: number;
  fee_type?: "percentage" | "fixed";
  fee_quantity?: number;
  internal_description?: string;
  full_payment: boolean;
  /** El importe viene en `value` (no en `amount`). */
  deposit: { type: "fixed" | "percentage"; value: number };
}

export interface FourvenuesSpace {
  /** Este `_id` es el `table_id` que se envía al crear la reserva. */
  _id: string;
  name: string;
  normalized_name: string;
  capacity: number;
  minimum?: number;
  position?: { x: number; y: number; scale?: number; rotation?: number; radius?: number };
  blocked?: boolean;
  hidden?: boolean;
  available: boolean;
  rates: FourvenuesRate[];
}

export interface FourvenuesZone {
  _id: string;
  available: boolean;
  slug: string;
  name: string;
  /** Slug legible de la zona; es lo que se envía como `normalized_zone_name`. */
  normalized_name: string;
  /** Si true, se puede fijar `table_id` en la reserva. */
  can_select_client: boolean;
  is_full: boolean;
  spaces: FourvenuesSpace[];
  /** Puede no venir: entonces las tarifas están en cada mesa. */
  rates?: FourvenuesRate[];
  has_discount_codes_enabled?: boolean;
}

export interface FourvenuesBilling {
  customer_type?: "individual" | "company";
  customer_name?: string;
  document_type?: "dni" | "nie" | "passport" | string;
  document_number?: string;
  address?: string;
  city?: string;
  postal_code?: string;
  country?: string;
}

export interface FourvenuesBookingInfo {
  full_name: string;
  email: string;
  phone?: string;
  birthdate?: string;
  /** Número de personas. */
  quantity: number;
  billing?: FourvenuesBilling;
}

export interface FourvenuesBooking {
  _id: string;
  organization_id: string;
  channel_id: string;
  referral_id?: string;
  status: string;
  quantity: number;
  full_name: string;
  email: string;
  phone: string;
  deposit: number;
  fee_type: "percentage" | "fixed";
  fee_quantity: number;
  qr_code?: string;
  activation_code?: string;
  observations_referral?: string;
  observations_client?: string;
  payment_id?: string;
  marketing_consent?: boolean;
  billing_info?: FourvenuesBilling;
}

export interface CreateBookingBase {
  event_id: string;
  /**
   * `zone_slug` y `normalized_zone_name` son **excluyentes**: la API responde
   * 400 ("exclusive peers") si se envían los dos. Se manda solo uno.
   */
  zone_slug?: string;
  normalized_zone_name?: string;
  rate_slug: string;
  /** Solo permitido si la zona tiene `can_select_client: true`. */
  table_id?: string;
  external_channel_id?: string;
  observations_client?: string;
  marketing_consent?: boolean;
  discount_code?: string;
  info: FourvenuesBookingInfo;
}

export interface CreateCheckoutInput extends CreateBookingBase {
  redirect_url?: string;
  error_url?: string;
  send_resources?: boolean;
  metadata?: Record<string, unknown>;
  full_payment?: boolean;
  tip_rate_id?: string;
}

export interface CheckoutResult {
  payment_id: string;
  payment_url: string;
  total_amount: number;
  booking: FourvenuesBooking;
}

export interface FourvenuesEvent {
  _id: string;
  slug?: string;
  name?: string;
  start_date?: string;
  end_date?: string;
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// Errores
// ---------------------------------------------------------------------------

export class FourvenuesError extends Error {
  readonly status: number;
  readonly body: unknown;
  constructor(message: string, status: number, body: unknown) {
    super(message);
    this.name = "FourvenuesError";
    this.status = status;
    this.body = body;
  }
}

export class FourvenuesNotConfiguredError extends FourvenuesError {
  constructor() {
    super(
      "Falta FOURVENUES_API_KEY. Configura la clave de Channel Manager (Booking) para activar la integración.",
      503,
      null,
    );
    this.name = "FourvenuesNotConfiguredError";
  }
}

// ---------------------------------------------------------------------------
// Cliente
// ---------------------------------------------------------------------------

interface ApiEnvelope<T> {
  data: T;
  success: boolean;
}

export class FourvenuesClient {
  private readonly config: FourvenuesConfig;

  constructor(overrides?: Partial<FourvenuesConfig>) {
    this.config = resolveConfig(overrides);
  }

  get baseUrl(): string {
    return this.config.baseUrl;
  }

  get configured(): boolean {
    return Boolean(this.config.apiKey);
  }

  private async request<T>(
    method: "GET" | "POST" | "PUT",
    path: string,
    options: { query?: Record<string, string | undefined>; body?: unknown } = {},
  ): Promise<T> {
    if (!this.config.apiKey) throw new FourvenuesNotConfiguredError();

    const url = new URL(path, this.config.baseUrl);
    for (const [key, value] of Object.entries(options.query ?? {})) {
      if (value !== undefined && value !== null && value !== "") {
        url.searchParams.set(key, value);
      }
    }

    const response = await fetch(url.toString(), {
      method,
      headers: {
        "X-Api-Key": this.config.apiKey,
        ...(options.body ? { "Content-Type": "application/json" } : {}),
      },
      body: options.body ? JSON.stringify(options.body) : undefined,
      // Nunca cachear: los eventos se crean sobre la marcha y la disponibilidad
      // de mesas cambia por minutos. Una respuesta guardada podría ofrecer una
      // mesa que acaban de reservar, o esconder un evento recién publicado.
      cache: "no-store",
    });

    const raw = await response.text();
    let parsed: unknown = null;
    if (raw) {
      try {
        parsed = JSON.parse(raw);
      } catch {
        parsed = raw;
      }
    }

    if (!response.ok) {
      const message =
        (parsed && typeof parsed === "object" && "message" in parsed
          ? String((parsed as Record<string, unknown>).message)
          : `Fourvenues API ${response.status}`) || `Fourvenues API ${response.status}`;
      throw new FourvenuesError(message, response.status, parsed);
    }

    const envelope = parsed as ApiEnvelope<T>;
    return (envelope && "data" in envelope ? envelope.data : (parsed as T));
  }

  /** Lista eventos, opcionalmente filtrando por rango de fechas (YYYY-MM-DD). */
  listEvents(params: {
    start_date?: string;
    end_date?: string;
    organization_id?: string;
    location_id?: string;
  } = {}): Promise<FourvenuesEvent[]> {
    return this.request<FourvenuesEvent[]>("GET", "/events", { query: params });
  }

  getEvent(id: string): Promise<FourvenuesEvent> {
    return this.request<FourvenuesEvent>("GET", `/events/${id}`);
  }

  /** Zonas + mesas (spaces) + tarifas + disponibilidad de un evento. */
  getBookingZones(eventId: string): Promise<FourvenuesZone[]> {
    return this.request<FourvenuesZone[]>("GET", "/bookings/zones/", {
      query: { event_id: eventId },
    });
  }

  getBooking(id: string): Promise<FourvenuesBooking> {
    return this.request<FourvenuesBooking>("GET", `/bookings/${id}`);
  }

  /**
   * Crea una sesión de checkout: devuelve `payment_url` con el enlace de pago.
   * La reserva se confirma cuando el cliente paga el adelanto.
   */
  createCheckout(input: CreateCheckoutInput): Promise<CheckoutResult> {
    const body = this.withChannel(input);
    return this.request<CheckoutResult>("POST", "/bookings/checkout", { body });
  }

  /**
   * Solicita una reserva: el venue debe aceptarla desde el panel de Fourvenues.
   */
  requestBooking(input: CreateBookingBase): Promise<FourvenuesBooking> {
    const body = this.withChannel(input);
    return this.request<FourvenuesBooking>("POST", "/bookings/request", { body });
  }

  private withChannel<T extends { external_channel_id?: string }>(input: T): T {
    if (!input.external_channel_id && this.config.defaultChannelId) {
      return { ...input, external_channel_id: this.config.defaultChannelId };
    }
    return input;
  }
}

/** Instancia lista para usar con la config del entorno. */
export function getFourvenuesClient(overrides?: Partial<FourvenuesConfig>): FourvenuesClient {
  return new FourvenuesClient(overrides);
}
