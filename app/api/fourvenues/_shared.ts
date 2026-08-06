import { FourvenuesError } from "../../lib/fourvenues";

/** Convierte cualquier error en una Response JSON coherente. */
export function errorResponse(error: unknown): Response {
  if (error instanceof FourvenuesError) {
    return Response.json(
      { success: false, error: error.message, details: error.body ?? null },
      { status: error.status },
    );
  }
  const message = error instanceof Error ? error.message : "Error desconocido";
  return Response.json({ success: false, error: message }, { status: 500 });
}

export function jsonOk<T>(data: T): Response {
  return Response.json({ success: true, data });
}
