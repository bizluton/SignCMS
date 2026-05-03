// submit-app-version: developer submits a new widget version for review.
// Creates a 'draft' row in store_app_versions; admin then approves/rejects.
// Optionally accepts a raw HTML file via multipart form (uploads to Storage).
//
// POST /
// Body (JSON): { appId, versionTag, widgetUrl, changelog: { zh?, en?, ja? } }
//   OR multipart: same fields + file field "html" (uploaded to media bucket)
// Returns: { id, versionTag }
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

  const sbService = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  let appId: string, versionTag: string, widgetUrl: string;
  let changelog: Record<string, string> = {};
  let htmlBytes: Uint8Array | null = null;
  let htmlFilename = "";

  const ct = req.headers.get("content-type") || "";
  if (ct.includes("multipart/form-data")) {
    const form = await req.formData();
    appId      = String(form.get("appId") || "");
    versionTag = String(form.get("versionTag") || "");
    widgetUrl  = String(form.get("widgetUrl") || "");
    try { changelog = JSON.parse(String(form.get("changelog") || "{}")); } catch {}
    const htmlFile = form.get("html") as File | null;
    if (htmlFile) {
      htmlBytes   = new Uint8Array(await htmlFile.arrayBuffer());
      htmlFilename = htmlFile.name;
    }
  } else {
    let body: Record<string, unknown>;
    try { body = await req.json(); } catch { return json({ error: "Invalid body" }, 400); }
    appId      = String(body.appId      || "");
    versionTag = String(body.versionTag || "");
    widgetUrl  = String(body.widgetUrl  || "");
    changelog  = (body.changelog as Record<string, string>) || {};
  }

  if (!appId || !versionTag) return json({ error: "appId and versionTag are required" }, 400);
  if (!/^\d+\.\d+(\.\d+)?(-\S+)?$/.test(versionTag)) {
    return json({ error: "versionTag must be semver, e.g. 1.0.0" }, 400);
  }

  // Verify caller owns the app
  const { data: app } = await supabase
    .from("store_apps")
    .select("id, slug, submitted_by, status")
    .eq("id", appId)
    .maybeSingle();

  if (!app) return json({ error: "App not found" }, 404);
  if (app.submitted_by !== user.id) return json({ error: "Forbidden" }, 403);
  if (app.status === "rejected" || app.status === "suspended") {
    return json({ error: "Cannot submit versions for a rejected or suspended app" }, 403);
  }

  // If HTML bytes provided, upload to storage
  if (htmlBytes && htmlBytes.length > 0) {
    const slug = app.slug;
    const storagePath = `widget-assets/ext-${slug}-v${versionTag}-${Date.now()}.html`;
    const { error: upErr } = await sbService.storage
      .from("media")
      .upload(storagePath, htmlBytes, {
        contentType: "text/html; charset=utf-8",
        cacheControl: "31536000",
        upsert: false,
      });
    if (upErr) return json({ error: `Upload failed: ${upErr.message}` }, 500);
    const { data: pub } = sbService.storage.from("media").getPublicUrl(storagePath);
    widgetUrl = pub.publicUrl;
  }

  if (!widgetUrl) return json({ error: "widgetUrl or html file is required" }, 400);

  // Check version tag not already in use
  const { data: existingVer } = await sbService
    .from("store_app_versions")
    .select("id")
    .eq("app_id", appId)
    .eq("version_tag", versionTag)
    .maybeSingle();

  if (existingVer) return json({ error: "Version tag already exists for this app" }, 409);

  const { data: inserted, error: insertErr } = await sbService
    .from("store_app_versions")
    .insert({
      app_id:         appId,
      version_tag:    versionTag,
      widget_url:     widgetUrl,
      changelog_i18n: changelog,
      status:         "draft",
      submitted_by:   user.id,
    })
    .select("id")
    .single();

  if (insertErr) return json({ error: insertErr.message }, 500);

  return json({ id: inserted.id, versionTag }, 201);
});
