// register-app: third-party developers POST their app manifest here to request
// listing in the App Store. A system admin then approves via the dashboard.
//
// POST /  (requires valid user JWT — any authenticated user may submit)
// Body: {
//   slug: string,           // URL-safe identifier, e.g. "meeting-room"
//   name_i18n:  { zh, en, ja },
//   desc_i18n:  { zh, en, ja },
//   icon_url?:  string,
//   gradient?:  string,     // Tailwind gradient e.g. "from-violet-500 to-purple-500"
//   publisher:  string,
//   website_url?: string,
//   webhook_url?: string,   // receives install/uninstall POST
//   widget_url:  string,    // iframe base URL
// }
// Returns: { api_key, message } — api_secret is delivered ONLY on registration
//
// NOTE: api_secret is returned once here and never again. The developer must store it.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

import { corsHeaders, corsPreflight } from "../_shared/cors.ts";

function json(req: Request, body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(req), "Content-Type": "application/json" },
  });
}

function randomHex(bytes: number): string {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return Array.from(buf).map((b) => b.toString(16).padStart(2, "0")).join("");
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

  const { slug, name_i18n, desc_i18n, icon_url, gradient, publisher, website_url, webhook_url, widget_url } = body as Record<string, unknown>;

  if (!slug || typeof slug !== "string" || !/^[a-z0-9-]+$/.test(slug)) {
    return json(req, { error: "slug must be lowercase alphanumeric with hyphens" }, 400);
  }
  if (!widget_url || typeof widget_url !== "string") {
    return json(req, { error: "widget_url is required" }, 400);
  }
  if (!publisher || typeof publisher !== "string") {
    return json(req, { error: "publisher is required" }, 400);
  }

  // Check slug not already taken
  const sbService = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const { data: existing } = await sbService
    .from("store_apps")
    .select("id")
    .eq("slug", slug)
    .maybeSingle();

  if (existing) return json(req, { error: "slug already registered" }, 409);

  const api_key    = `sak_${randomHex(16)}`;   // Store App Key
  const api_secret = `sas_${randomHex(32)}`;   // Store App Secret

  const { error: insertErr } = await sbService.from("store_apps").insert({
    slug,
    name_i18n:   name_i18n   || {},
    desc_i18n:   desc_i18n   || {},
    icon_url:    icon_url    || null,
    gradient:    gradient    || "from-gray-500 to-gray-600",
    publisher:   String(publisher),
    website_url: website_url || null,
    webhook_url: webhook_url || null,
    widget_url:  String(widget_url),
    api_key,
    api_secret,
    status:      "pending",
    submitted_by: user.id,
  });

  if (insertErr) return json(req, { error: insertErr.message }, 500);

  return json(req, {
    api_key,
    api_secret,   // returned ONCE — developer must persist this
    message: "App registered. A system admin will review your submission.",
  }, 201);
});
