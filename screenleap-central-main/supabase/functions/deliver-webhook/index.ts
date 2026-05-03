// deliver-webhook: centralized signed webhook delivery with logging.
// Called server-side after any significant app event (install, uninstall,
// app.approved, app.rejected, app.suspended, version.approved).
//
// POST /
// Body: { appId: string (uuid), eventType: string, extraPayload?: Record }
// Returns: { ok: true, logged: true, webhookStatus?: number, skipped?: string }
//
// Signing: HMAC-SHA256 over canonicalized JSON payload.
// Header: X-SignCMS-Signature: <base64url>
// Logs every attempt (success + failure) to store_app_webhook_logs.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const VALID_EVENTS = new Set([
  "install", "uninstall",
  "app.approved", "app.rejected", "app.suspended",
  "version.approved", "version.rejected",
]);

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function toBase64Url(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function canonicalize(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(canonicalize).join(",") + "]";
  const keys = Object.keys(value as Record<string, unknown>).sort();
  return "{" + keys.map((k) => JSON.stringify(k) + ":" + canonicalize((value as any)[k])).join(",") + "}";
}

async function hmacSign(secret: string, payload: unknown): Promise<string> {
  const keyBytes = new TextEncoder().encode(secret);
  const key = await crypto.subtle.importKey(
    "raw", keyBytes, { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const data = new TextEncoder().encode(canonicalize(payload));
  const sig = await crypto.subtle.sign("HMAC", key, data);
  return toBase64Url(new Uint8Array(sig));
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const authHeader = req.headers.get("authorization");
  if (!authHeader) return json({ error: "Unauthorized" }, 401);

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { authorization: authHeader } } },
  );

  const { data: { user }, error: authErr } = await supabase.auth.getUser();
  if (authErr || !user) return json({ error: "Unauthorized" }, 401);

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json({ error: "Invalid JSON body" }, 400); }

  const { appId, eventType, extraPayload } = body as {
    appId?: string;
    eventType?: string;
    extraPayload?: Record<string, unknown>;
  };

  if (!appId || !eventType) return json({ error: "appId and eventType are required" }, 400);
  if (!VALID_EVENTS.has(eventType)) {
    return json({ error: `Invalid eventType. Valid: ${[...VALID_EVENTS].join(", ")}` }, 400);
  }

  const sbService = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const { data: app } = await sbService
    .from("store_apps")
    .select("webhook_url, api_secret, slug")
    .eq("id", appId)
    .maybeSingle();

  if (!app) return json({ error: "App not found" }, 404);

  const ts  = Math.floor(Date.now() / 1000);
  const exp = ts + 300;
  const webhookPayload = { event: eventType, appId, ts, exp, ...(extraPayload || {}) };

  // No webhook URL — log the skip and return ok
  if (!app.webhook_url) {
    await sbService.from("store_app_webhook_logs").insert({
      app_id:     appId,
      event_type: eventType,
      payload:    webhookPayload,
      error_msg:  "no webhook_url configured",
    });
    return json({ ok: true, logged: true, skipped: "no webhook_url configured" });
  }

  const sig = await hmacSign(app.api_secret, webhookPayload);

  let statusCode: number | null = null;
  let responseBody: string | null = null;
  let errorMsg: string | null = null;

  try {
    const resp = await fetch(app.webhook_url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-SignCMS-Signature": sig,
        "X-SignCMS-Event": eventType,
      },
      body: JSON.stringify(webhookPayload),
      signal: AbortSignal.timeout(10_000),
    });
    statusCode = resp.status;
    responseBody = (await resp.text()).slice(0, 2000);
  } catch (err: unknown) {
    errorMsg = err instanceof Error ? err.message : String(err);
  }

  // Always log
  await sbService.from("store_app_webhook_logs").insert({
    app_id:        appId,
    event_type:    eventType,
    payload:       webhookPayload,
    status_code:   statusCode,
    response_body: responseBody,
    error_msg:     errorMsg,
  });

  if (errorMsg) {
    console.error(`deliver-webhook [${eventType}] ${appId}: ${errorMsg}`);
  }

  return json({ ok: true, logged: true, webhookStatus: statusCode, webhookError: errorMsg });
});
