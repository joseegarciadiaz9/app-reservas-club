import { getFourvenuesClient } from "../../../lib/fourvenues";
import { errorResponse, jsonOk } from "../_shared";

// Depende de la API key (secret) y de los parámetros de la petición.
export const dynamic = "force-dynamic";

/**
 * GET /api/fourvenues/events?date=YYYY-MM-DD
 * GET /api/fourvenues/events?start_date=YYYY-MM-DD&end_date=YYYY-MM-DD
 */
export async function GET(request: Request): Promise<Response> {
  try {
    const { searchParams } = new URL(request.url);
    const date = searchParams.get("date") ?? undefined;
    const start_date = searchParams.get("start_date") ?? date ?? undefined;
    const end_date = searchParams.get("end_date") ?? date ?? undefined;
    const organization_id = searchParams.get("organization_id") ?? undefined;
    const location_id = searchParams.get("location_id") ?? undefined;

    const events = await getFourvenuesClient().listEvents({
      start_date,
      end_date,
      organization_id,
      location_id,
    });
    return jsonOk(events);
  } catch (error) {
    return errorResponse(error);
  }
}
