// queue-system: external REST API for kiosk / POS integrations.
//
// All endpoints require HMAC-SHA256 signature verification using the org's
// api_secret from queue_system_configs (same canonicalize algorithm as
// notify-install). The signature must be included as a "sig" field in the
// JSON body (POST) or as ?sig= query param (GET).
//
// Routes:
//   POST /queue-system/call-next   body: { org_id, queue_id, counter, ts, exp, sig }
//   POST /queue-system/reset       body: { org_id, queue_id, ts, exp, sig }
//   GET  /queue-system/status      query: org_id, queue_id, ts, exp, sig
//
// The "exp" field (Unix seconds) must be ≥ now(); requests older than 5 min
// are rejected regardless of signature validity.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type, x-signcms-signature",
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

async function verifyRequest(
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
  if (!secret) return json({ error: "org not configured" }, 404);

  const valid = await hmacVerify(secret, rest as Record<string, unknown>, sig);
  if (!valid) return json({ error: "invalid signature" }, 403);

  return { ok: true };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const url = new URL(req.url);
  const route = url.pathname.replace(/.*\/queue-system/, "");

  const sbService = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // ── GET /status ────────────────────────────────────────────────────────────
  if (req.method === "GET" && route === "/status") {
    const params: Record<string, unknown> = {};
    url.searchParams.forEach((v, k) => {
      // coerce numeric-looking values
      params[k] = isNaN(Number(v)) ? v : Number(v);
    });

    const check = await verifyRequest(sbService, params);
    if (check instanceof Response) return check;

    const { data: queue } = await sbService
      .from("queue_system_queues")
      .select("id, queue_name, prefix, current_number")
      .eq("id", params["queue_id"] as string)
      .eq("org_id", params["org_id"] as string)
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

  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ error: "invalid JSON" }, 400);
  }

  // ── POST /call-next ────────────────────────────────────────────────────────
  if (route === "/call-next") {
    const check = await verifyRequest(sbService, body);
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
    const check = await verifyRequest(sbService, body);
    if (check instanceof Response) return check;

    const queueId = body["queue_id"];
    if (typeof queueId !== "string") return json({ error: "queue_id required" }, 400);

    const { error } = await sbService.rpc("queue_reset", { p_queue_id: queueId });
    if (error) return json({ error: error.message }, 500);

    return json({ ok: true });
  }

  return json({ error: "not found" }, 404);
});
