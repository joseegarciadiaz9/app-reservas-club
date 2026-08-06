import { getFourvenuesClient } from "../../../lib/fourvenues";
import { jsonOk } from "../_shared";

export const dynamic = "force-dynamic";

/**
 * GET /api/fourvenues/status
 * Indica si la integración está configurada (hay API key) y contra qué entorno.
 * La UI lo usa para pasar de "simulación" a "conectado".
 */
export async function GET(): Promise<Response> {
  const client = getFourvenuesClient();
  return jsonOk({
    configured: client.configured,
    baseUrl: client.baseUrl,
  });
}
