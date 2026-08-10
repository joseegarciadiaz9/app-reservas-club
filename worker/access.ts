/**
 * Control de acceso de la herramienta interna.
 *
 * Se aplica en el Worker (`worker/index.ts`), que es el único punto de entrada:
 * así quedan protegidas TANTO las páginas COMO los Route Handlers
 * (`/api/fourvenues/*`), que son los que crean reservas reales en Fourvenues.
 *
 * Configuración:
 *   - `APP_ACCESS_PASSWORD` → contraseña compartida del equipo de RRPP.
 *   - `APP_SESSION_SECRET`  → opcional; si no se define, se deriva de la
 *     contraseña (cambiarla invalida las sesiones abiertas).
 *
 * Regla de seguridad (fail-closed): si hay `FOURVENUES_API_KEY` (la app puede
 * crear reservas de verdad) pero NO hay contraseña, la app se bloquea entera en
 * lugar de quedar abierta. Sin clave y sin contraseña se permite el paso, para
 * poder enseñar la demo en modo simulación.
 */

const COOKIE_NAME = "totem_session";
/** Duración de la sesión: cubre un turno completo. */
const SESSION_TTL_SECONDS = 12 * 60 * 60;

export type EnvBag = Record<string, unknown>;

export function readEnv(env: EnvBag | undefined, key: string): string {
  const fromBinding = env?.[key];
  if (typeof fromBinding === "string" && fromBinding) return fromBinding;
  const proc = typeof process !== "undefined" ? process.env : undefined;
  const fromProcess = proc?.[key];
  return typeof fromProcess === "string" ? fromProcess : "";
}

// ---------------------------------------------------------------------------
// Token de sesión (HMAC-SHA256, sin dependencias: Web Crypto)
// ---------------------------------------------------------------------------

function b64urlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function sign(payload: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload));
  return b64urlEncode(new Uint8Array(signature));
}

/** Comparación en tiempo constante (evita filtrar el secreto por timing). */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function sessionSecret(env: EnvBag | undefined): string {
  const explicit = readEnv(env, "APP_SESSION_SECRET");
  if (explicit) return explicit;
  // Derivado de la contraseña: basta con configurar una sola variable.
  return `totem-session:${readEnv(env, "APP_ACCESS_PASSWORD")}`;
}

export async function createSessionToken(env: EnvBag | undefined): Promise<string> {
  const expiresAt = Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS;
  const payload = String(expiresAt);
  const signature = await sign(payload, sessionSecret(env));
  return `${payload}.${signature}`;
}

async function isValidToken(token: string, env: EnvBag | undefined): Promise<boolean> {
  const separator = token.lastIndexOf(".");
  if (separator <= 0) return false;
  const payload = token.slice(0, separator);
  const signature = token.slice(separator + 1);

  const expected = await sign(payload, sessionSecret(env));
  if (!safeEqual(signature, expected)) return false;

  const expiresAt = Number(payload);
  return Number.isFinite(expiresAt) && expiresAt > Math.floor(Date.now() / 1000);
}

// ---------------------------------------------------------------------------
// Cookies
// ---------------------------------------------------------------------------

function readCookie(request: Request, name: string): string {
  const header = request.headers.get("Cookie") ?? "";
  for (const part of header.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return rest.join("=");
  }
  return "";
}

function cookieHeader(value: string, request: Request, maxAge: number): string {
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  return `${COOKIE_NAME}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`;
}

export function sessionCookie(token: string, request: Request): string {
  return cookieHeader(token, request, SESSION_TTL_SECONDS);
}

export function clearedCookie(request: Request): string {
  return cookieHeader("", request, 0);
}

// ---------------------------------------------------------------------------
// Puerta de acceso
// ---------------------------------------------------------------------------

/** Rutas accesibles sin sesión (login y assets estáticos). */
function isPublicPath(pathname: string): boolean {
  if (pathname === "/login" || pathname === "/api/auth/login") return true;
  if (pathname === "/favicon.ico" || pathname === "/favicon.svg") return true;
  return (
    pathname.startsWith("/_vinext/") ||
    pathname.startsWith("/assets/") ||
    pathname.startsWith("/@vite/") ||
    pathname.startsWith("/@id/") ||
    pathname.startsWith("/@fs/") ||
    pathname.startsWith("/node_modules/") ||
    pathname.startsWith("/__debug")
  );
}

export async function hasValidSession(request: Request, env: EnvBag | undefined): Promise<boolean> {
  const token = readCookie(request, COOKIE_NAME);
  return Boolean(token) && (await isValidToken(token, env));
}

function wantsJson(request: Request, pathname: string): boolean {
  return pathname.startsWith("/api/") || (request.headers.get("Accept") ?? "").includes("application/json");
}

/**
 * Devuelve una respuesta si la petición debe cortarse (login, bloqueo o
 * redirección), o `null` si puede continuar hacia la app.
 */
export async function guard(request: Request, env: EnvBag | undefined): Promise<Response | null> {
  const url = new URL(request.url);
  const { pathname } = url;
  const password = readEnv(env, "APP_ACCESS_PASSWORD");

  // Fail-closed: clave real de Fourvenues configurada pero sin contraseña.
  if (!password) {
    if (!readEnv(env, "FOURVENUES_API_KEY")) return null; // modo simulación: abierto
    return new Response(
      "Configuración incompleta: falta APP_ACCESS_PASSWORD. La app no se sirve sin protección mientras haya una clave de Fourvenues activa.",
      { status: 503, headers: { "Content-Type": "text/plain; charset=utf-8" } },
    );
  }

  if (pathname === "/api/auth/logout") {
    return new Response(null, {
      status: 204,
      headers: { "Set-Cookie": clearedCookie(request) },
    });
  }

  if (pathname === "/api/auth/login") {
    if (request.method !== "POST") return new Response("Method Not Allowed", { status: 405 });
    let submitted = "";
    try {
      const body = (await request.json()) as { password?: unknown };
      submitted = typeof body.password === "string" ? body.password : "";
    } catch {
      submitted = "";
    }
    if (!submitted || !safeEqual(submitted, password)) {
      return Response.json({ success: false, error: "Contraseña incorrecta" }, { status: 401 });
    }
    const token = await createSessionToken(env);
    return Response.json(
      { success: true },
      { headers: { "Set-Cookie": sessionCookie(token, request) } },
    );
  }

  if (isPublicPath(pathname)) return null;
  if (await hasValidSession(request, env)) return null;

  if (wantsJson(request, pathname)) {
    return Response.json({ success: false, error: "No autorizado" }, { status: 401 });
  }

  const redirectTo = new URL("/login", url);
  if (pathname !== "/") redirectTo.searchParams.set("next", pathname + url.search);
  return Response.redirect(redirectTo.toString(), 302);
}
