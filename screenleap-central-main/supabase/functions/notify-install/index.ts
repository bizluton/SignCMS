// notify-install: fires after an org installs or uninstalls an external app.
// POSTs a HMAC-signed webhook to the app's webhook_url so the third party can
// provision / deprovision resources for that org.
//
// POST /
// Body: { appId: string (uuid), orgId: string, event: "install" | "uninstall" }
// Returns: { ok: true } or error
//
// Webhook payload sent to third party:
//   { event, orgId, installToken, ts, exp }
//   Header: X-SignCMS-Signature: <hmac-base64url>
//
// This endpoint is called server-side by InstalledAppsContext after the DB write,
// so it must accept a valid user JWT for the installing/uninstalling org member.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

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

  const { appId, orgId, event } = body as { appId?: string; orgId?: string; event?: string };
  if (!appId || !orgId || !event) return json({ error: "appId, orgId, and event are required" }, 400);
  if (event !== "install" && event !== "uninstall") return json({ error: "event must be install or uninstall" }, 400);

  // Caller must be an org admin
  const { data: membership } = await supabase
    .from("org_members")
    .select("role")
    .eq("user_id", user.id)
    .eq("org_id", orgId)
    .maybeSingle();

  if (!membership || !["admin", "owner"].includes(membership.role)) {
    return json({ error: "Org admin required" }, 403);
  }

  const sbService = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // Fetch app (webhook_url + api_secret)
  const { data: app } = await sbService
    .from("store_apps")
    .select("webhook_url, api_secret")
    .eq("id", appId)
    .maybeSingle();

  if (!app) return json({ error: "App not found" }, 404);
  if (!app.webhook_url) return json({ ok: true, skipped: "no webhook_url configured" });

  // Fetch install_token (may not exist on uninstall — use empty string)
  const { data: install } = await sbService
    .from("org_installed_apps")
    .select("install_token")
    .eq("org_id", orgId)
    .eq("app_id", appId)
    .maybeSingle();

  const ts  = Math.floor(Date.now() / 1000);
  const exp = ts + 300;
  const installToken = install?.install_token ?? "";

  const webhookPayload = { event, orgId, installToken, ts, exp };
  const sig = await hmacSign(app.api_secret, webhookPayload);

  try {
    const resp = await fetch(app.webhook_url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-SignCMS-Signature": sig,
      },
      body: JSON.stringify(webhookPayload),
      signal: AbortSignal.timeout(10_000),
    });

    return json({ ok: true, webhookStatus: resp.status });
  } catch (err: unknown) {
    // Webhook delivery failure is non-fatal — log but don't block the install flow.
    const msg = err instanceof Error ? err.message : String(err);
    console.error("notify-install webhook failed:", msg);
    return json({ ok: true, webhookError: msg });
  }
});
