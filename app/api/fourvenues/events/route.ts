import { getFourvenuesClient } from "../../../lib/fourvenues";
import { errorResponse, jsonOk } from "../_shared";

// Depende de la API key (secret) y de los parámetros de la petición.
export const dynamic = "force-dynamic";

/**
 * `end_date` es EXCLUSIVO en la API: pedir start=end=15/08 no devuelve el evento
 * de esa noche (empieza a las 20:00 UTC). Para un día concreto hay que cerrar el
 * rango en el día siguiente.
 */
function nextDay(isoDate: string): string {
  const date = new Date(`${isoDate}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return isoDate;
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

/**
 * GET /api/fourvenues/events?date=YYYY-MM-DD
 * GET /api/fourvenues/events?start_date=YYYY-MM-DD&end_date=YYYY-MM-DD
 */
export async function GET(request: Request): Promise<Response> {
  try {
    const { searchParams } = new URL(request.url);
    const date = searchParams.get("date") ?? undefined;
    const start_date = searchParams.get("start_date") ?? date ?? undefined;
    const end_date =
      searchParams.get("end_date") ?? (date ? nextDay(date) : undefined);
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
