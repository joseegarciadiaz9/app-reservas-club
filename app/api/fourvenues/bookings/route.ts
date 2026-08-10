import {
  getFourvenuesClient,
  type CreateBookingBase,
  type CreateCheckoutInput,
} from "../../../lib/fourvenues";
import { errorResponse, jsonOk } from "../_shared";

export const dynamic = "force-dynamic";

type BookingBody =
  | ({ mode?: "checkout" } & CreateCheckoutInput)
  | ({ mode: "request" } & CreateBookingBase);

/**
 * POST /api/fourvenues/bookings
 * Body: { mode: "checkout" | "request", event_id, zone_slug, normalized_zone_name,
 *         rate_slug, table_id?, observations_client?, info: { full_name, email, quantity, ... } }
 *
 * - "checkout": devuelve payment_url (la reserva se confirma al pagar).
 * - "request":  crea una solicitud que el venue acepta desde el panel.
 */
export async function POST(request: Request): Promise<Response> {
  let body: BookingBody;
  try {
    body = (await request.json()) as BookingBody;
  } catch {
    return Response.json(
      { success: false, error: "JSON inválido en el cuerpo de la petición" },
      { status: 400 },
    );
  }

  const missing = requiredFieldErrors(body);
  if (missing.length > 0) {
    return Response.json(
      { success: false, error: `Faltan campos obligatorios: ${missing.join(", ")}` },
      { status: 422 },
    );
  }

  try {
    const client = getFourvenuesClient();
    if (body.mode === "request") {
      const { mode: _mode, ...payload } = body;
      const booking = await client.requestBooking(payload as CreateBookingBase);
      return jsonOk({ mode: "request", booking });
    }
    const { mode: _mode, ...payload } = body;
    const result = await client.createCheckout(payload as CreateCheckoutInput);
    return jsonOk({ mode: "checkout", ...result });
  } catch (error) {
    return errorResponse(error);
  }
}

function requiredFieldErrors(body: BookingBody): string[] {
  const missing: string[] = [];
  if (!body.event_id) missing.push("event_id");
  // La API los trata como excluyentes: basta (y hace falta) uno de los dos.
  if (!body.zone_slug && !body.normalized_zone_name) {
    missing.push("zone_slug o normalized_zone_name");
  }
  if (!body.rate_slug) missing.push("rate_slug");
  if (!body.info) {
    missing.push("info");
  } else {
    if (!body.info.full_name) missing.push("info.full_name");
    if (!body.info.email) missing.push("info.email");
    if (!body.info.quantity) missing.push("info.quantity");
  }
  return missing;
}
