/**
 * Shared CORS configuration for SignCMS edge functions.
 *
 * Why this exists:
 *   The original per-function CORS headers used `Access-Control-Allow-Origin: *`
 *   even on authenticated mutation endpoints. That makes every endpoint
 *   reachable from any origin where a logged-in user's JWT happens to be
 *   present in a hostile page (CSRF-shaped abuse). Locking the allow-list
 *   to SignCMS's own origins closes that.
 *
 * Behaviour:
 *   - corsAllowedOrigin(req): returns the request's `Origin` if it is in
 *     the allow-list, or the first allow-list entry otherwise (so the
 *     preflight still has a usable value).
 *   - corsHeaders(req): the standard CORS header bag, with the correct
 *     Allow-Origin filled in, Allow-Credentials true, and Vary: Origin.
 *   - corsPreflight(req): returns a 204 Response suitable for a
 *     `req.method === "OPTIONS"` early-return.
 *
 * Operators may add more allowed origins via the env var
 *   CORS_EXTRA_ORIGINS="https://foo.example,https://bar.example"
 * to support staging / preview deploys without redeploying every function.
 */

const DEFAULT_ALLOWED_ORIGINS = [
  "https://signcms.net",
  "https://www.signcms.net",
  "https://staging.signcms.net",
  // Local dev (Vite default ports).
  "http://localhost:5173",
  "http://127.0.0.1:5173",
  "http://localhost:8080",
  "http://127.0.0.1:8080",
];

function loadAllowedOrigins(): string[] {
  const extras = (Deno.env.get("CORS_EXTRA_ORIGINS") ?? "")
    .split(/[,\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  return Array.from(new Set([...DEFAULT_ALLOWED_ORIGINS, ...extras]));
}

const ALLOWED_ORIGINS = loadAllowedOrigins();

export function corsAllowedOrigin(req: Request): string {
  const origin = req.headers.get("origin") ?? "";
  if (ALLOWED_ORIGINS.includes(origin)) return origin;
  // Fall back to the canonical production origin so preflight has a value;
  // requests that aren't in the allow-list get this echoed back, and the
  // browser will reject them anyway because Origin won't match.
  return ALLOWED_ORIGINS[0];
}

export function corsHeaders(req: Request): Record<string, string> {
  return {
    "Access-Control-Allow-Origin":      corsAllowedOrigin(req),
    "Access-Control-Allow-Headers":     "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods":     "POST, GET, OPTIONS",
    "Access-Control-Allow-Credentials": "true",
    "Vary":                             "Origin",
  };
}

export function corsPreflight(req: Request): Response {
  return new Response("ok", {
    status: 204,
    headers: corsHeaders(req),
  });
}
