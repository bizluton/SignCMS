// queue-system: external REST API for kiosk / POS integrations.
//
// Auth model (two layers):
//   Layer 1 — Supabase platform: every request must carry
//             `Authorization: Bearer <anon_key_or_service_role_key>`
//             This is enforced by the Supabase Edge Function runtime BEFORE
//             our handler runs. Callers without this header receive:
//             {"code":"UNAUTHORIZED_NO_AUTH_HEADER",...} from the platform.
//
//   Layer 2 — HMAC business logic (POST endpoints only):
//             The request body must include { ..., sig, ts, exp } where sig
//             is HMAC-SHA256 of the canonicalised payload using the org's
//             api_secret from queue_system_configs.
//
// Routes:
//   GET  /queue-system/status      query: org_id, queue_id
//                                  → only anon key needed (read-only)
//   POST /queue-system/call-next   body: { org_id, queue_id, counter, ts, exp, sig }
//   POST /queue-system/reset       body: { org_id, queue_id, ts, exp, sig }
//
// The "exp" field (Unix seconds) must be ≥ now(); replay window is 5 min.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

// Standard Supabase Edge Function CORS headers — must include `authorization`
// so browser preflight passes when called from frontend code.
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-signcms-signature",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// Deterministic JSON serialisation (keys sorted recursively).
function canonicalize(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value))
    return "[" + (value as unknown[]).map(canonicalize).join(",") + "]";
  const keys = Object.keys(value as Record<string, unknown>).sort();
  return (
    "{" +
    keys
      .map(
        (k) =>
          JSON.stringify(k) +
          ":" +
          canonicalize((value as Record<string, unknown>)[k]),
      )
      .join(",") +
    "}"
  );
}

function toBase64Url(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function hmacVerify(
  secret: string,
  payload: Record<string, unknown>,
  sig: string,
): Promise<boolean> {
  const keyBytes = new TextEncoder().encode(secret);
  const key = await crypto.subtle.importKey(
    "raw",
    keyBytes,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const data = new TextEncoder().encode(canonicalize(payload));
  const raw = await crypto.subtle.sign("HMAC", key, data);
  return toBase64Url(new Uint8Array(raw)) === sig;
}

async function resolveSecret(
  sbService: ReturnType<typeof createClient>,
  orgId: string,
): Promise<string | null> {
  const { data } = await sbService
    .from("queue_system_configs")
    .select("api_secret")
    .eq("org_id", orgId)
    .maybeSingle();
  return data?.api_secret ?? null;
}

// Verifies HMAC signature on POST body payloads.
// Returns { ok: true } on success, or an error Response.
async function verifyHmac(
  sbService: ReturnType<typeof createClient>,
  params: Record<string, unknown>,
): Promise<{ ok: true } | Response> {
  const { sig, ...rest } = params;
  if (typeof sig !== "string") return json({ error: "sig required" }, 400);

  const orgId = rest["org_id"];
  if (typeof orgId !== "string") return json({ error: "org_id required" }, 400);

  const exp = rest["exp"];
  if (typeof exp !== "number" || exp < Math.floor(Date.now() / 1000)) {
    return json({ error: "expired or missing exp" }, 401);
  }

  const secret = await resolveSecret(sbService, orgId);
  if (!secret) return json({ error: "org not configured — run app setup first" }, 404);

  const valid = await hmacVerify(secret, rest as Record<string, unknown>, sig);
  if (!valid) return json({ error: "invalid signature" }, 403);

  return { ok: true };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const url = new URL(req.url);
  const route = url.pathname.replace(/.*\/queue-system/, "");

  // Use service role for all DB operations so RLS does not block edge function access.
  const sbService = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // ── GET /status ────────────────────────────────────────────────────────────
  // Read-only: only requires Supabase anon key (Layer 1).
  // No HMAC needed — the platform JWT check is sufficient for a public status query.
  if (req.method === "GET" && route === "/status") {
    const queueId = url.searchParams.get("queue_id");
    const orgId = url.searchParams.get("org_id");

    if (!queueId || !orgId) {
      return json({ error: "org_id and queue_id query params required" }, 400);
    }

    const { data: queue } = await sbService
      .from("queue_system_queues")
      .select("id, queue_name, prefix, current_number")
      .eq("id", queueId)
      .eq("org_id", orgId)
      .maybeSingle();

    if (!queue) return json({ error: "queue not found" }, 404);

    const { count } = await sbService
      .from("queue_system_tickets")
      .select("id", { count: "exact", head: true })
      .eq("queue_id", queue.id)
      .eq("status", "waiting");

    return json({
      queueId: queue.id,
      queueName: queue.queue_name,
      prefix: queue.prefix,
      currentNumber: queue.current_number,
      waitingCount: count ?? 0,
    });
  }

  // ── POST endpoints — require HMAC (Layer 2) in addition to anon key ────────
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ error: "invalid JSON body" }, 400);
  }

  // ── POST /call-next ────────────────────────────────────────────────────────
  if (route === "/call-next") {
    const check = await verifyHmac(sbService, body);
    if (check instanceof Response) return check;

    const queueId = body["queue_id"];
    const counter = typeof body["counter"] === "string" ? body["counter"] : "";
    if (typeof queueId !== "string") return json({ error: "queue_id required" }, 400);

    const { data: ticket, error } = await sbService.rpc("queue_call_next", {
      p_queue_id: queueId,
      p_counter: counter,
    });

    if (error) {
      if (error.message.includes("queue_not_found"))
        return json({ error: "queue not found" }, 404);
      return json({ error: error.message }, 500);
    }

    return json({ ok: true, ticket });
  }

  // ── POST /reset ────────────────────────────────────────────────────────────
  if (route === "/reset") {
    const check = await verifyHmac(sbService, body);
    if (check instanceof Response) return check;

    const queueId = body["queue_id"];
    if (typeof queueId !== "string") return json({ error: "queue_id required" }, 400);

    const { error } = await sbService.rpc("queue_reset", { p_queue_id: queueId });
    if (error) return json({ error: error.message }, 500);

    return json({ ok: true });
  }

  return json({ error: "not found" }, 404);
});
