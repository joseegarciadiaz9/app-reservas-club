import { getFourvenuesClient } from "../../../lib/fourvenues";
import { errorResponse, jsonOk } from "../_shared";

export const dynamic = "force-dynamic";

/**
 * GET /api/fourvenues/zones?event_id=...
 * Devuelve zonas + mesas (spaces) + tarifas + disponibilidad del evento.
 */
export async function GET(request: Request): Promise<Response> {
  try {
    const { searchParams } = new URL(request.url);
    const eventId = searchParams.get("event_id");
    if (!eventId) {
      return Response.json(
        { success: false, error: "Falta el parámetro event_id" },
        { status: 400 },
      );
    }
    const zones = await getFourvenuesClient().getBookingZones(eventId);
    return jsonOk(zones);
  } catch (error) {
    return errorResponse(error);
  }
}
