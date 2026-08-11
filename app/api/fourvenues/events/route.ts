import { getFourvenuesClient } from "../../../lib/fourvenues";
import { errorResponse, jsonOk } from "../_shared";

// Depende de la API key (secret) y de los parámetros de la petición.
export const dynamic = "force-dynamic";

/**
 * El filtro de fechas de la API se aplica sobre la fecha de **fin** del evento,
 * no la de inicio: pedir start=end=15/08 devuelve el evento de la noche del 14
 * (que termina de madrugada el 15). Por eso pedimos una ventana amplia y después
 * nos quedamos con los eventos que EMPIEZAN el día solicitado.
 */
function shiftDays(isoDate: string, days: number): string {
  const date = new Date(`${isoDate}T12:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return isoDate;
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** Día (YYYY-MM-DD) del instante dado en la zona horaria del local. */
function localDate(iso: string | undefined): string {
  if (!iso) return "";
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return "";
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Madrid",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(parsed);
}

/**
 * GET /api/fourvenues/events?date=YYYY-MM-DD
 * GET /api/fourvenues/events?start_date=YYYY-MM-DD&end_date=YYYY-MM-DD
 */
export async function GET(request: Request): Promise<Response> {
  try {
    const { searchParams } = new URL(request.url);
    const date = searchParams.get("date") ?? undefined;
    const start_date =
      searchParams.get("start_date") ?? (date ? shiftDays(date, -1) : undefined);
    const end_date =
      searchParams.get("end_date") ?? (date ? shiftDays(date, 2) : undefined);
    const organization_id = searchParams.get("organization_id") ?? undefined;
    const location_id = searchParams.get("location_id") ?? undefined;

    const events = await getFourvenuesClient().listEvents({
      start_date,
      end_date,
      organization_id,
      location_id,
    });

    if (!date) return jsonOk(events);

    // Solo los que EMPIEZAN ese día. Si no hay ninguno se devuelve vacío a
    // propósito: es preferible avisar de que no hay evento que enseñar las zonas
    // de otra fecha y arriesgarse a crear la reserva en el evento equivocado.
    return jsonOk(events.filter((event) => localDate(event.start_date) === date));
  } catch (error) {
    return errorResponse(error);
  }
}
