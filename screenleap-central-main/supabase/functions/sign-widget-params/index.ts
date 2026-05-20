// sign-widget-params: generates HMAC-SHA256 signed query params for an external
// widget iframe. The third-party server can verify the signature so it knows the
// request originated from our platform and the orgId wasn't spoofed.
//
// POST /
// Body: { appId: string (uuid), orgId: string, lang?: string }
// Returns: { signedParams: string }  — ready to append as ?... to widget_url
//
// Signed payload (canonicalized JSON):
//   { orgId, installToken, lang, ts (unix seconds), exp (ts + 3600) }
//
// The signature covers all fields above. ts/exp allow the third party to reject
// replayed requests older than 1 hour.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

import { corsHeaders, corsPreflight } from "../_shared/cors.ts";

function json(req: Request, body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(req), "Content-Type": "application/json" },
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
  if (req.method === "OPTIONS") return corsPreflight(req);
  if (req.method !== "POST") return json(req, { error: "Method not allowed" }, 405);

  // Require user auth
  const authHeader = req.headers.get("authorization");
  if (!authHeader) return json(req, { error: "Unauthorized" }, 401);

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { authorization: authHeader } } },
  );

  const { data: { user }, error: authErr } = await supabase.auth.getUser();
  if (authErr || !user) return json(req, { error: "Unauthorized" }, 401);

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json(req, { error: "Invalid JSON body" }, 400); }

  const { appId, orgId, lang = "zh" } = body as { appId?: string; orgId?: string; lang?: string };
  if (!appId || !orgId) return json(req, { error: "appId and orgId are required" }, 400);

  // Verify the caller belongs to the requested org
  const { data: membership } = await supabase
    .from("org_members")
    .select("id")
    .eq("user_id", user.id)
    .eq("org_id", orgId)
    .maybeSingle();

  if (!membership) return json(req, { error: "Not a member of this org" }, 403);

  // Fetch app secret + install token (service role needed for api_secret)
  const sbService = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const { data: app, error: appErr } = await sbService
    .from("store_apps")
    .select("api_secret, widget_url, status")
    .eq("id", appId)
    .maybeSingle();

  if (appErr || !app) return json(req, { error: "App not found" }, 404);
  if (app.status !== "approved") return json(req, { error: "App not approved" }, 403);

  const { data: install } = await sbService
    .from("org_installed_apps")
    .select("install_token")
    .eq("org_id", orgId)
    .eq("app_id", appId)
    .maybeSingle();

  if (!install) return json(req, { error: "App not installed for this org" }, 403);

  const ts  = Math.floor(Date.now() / 1000);
  const exp = ts + 3600;

  const payload = { orgId, installToken: install.install_token, lang, ts, exp };
  const sig = await hmacSign(app.api_secret, payload);

  const params = new URLSearchParams({
    orgId,
    installToken: install.install_token,
    lang: String(lang),
    ts: String(ts),
    exp: String(exp),
    sig,
  });

  return json(req, { signedParams: params.toString(), widgetUrl: app.widget_url });
});
