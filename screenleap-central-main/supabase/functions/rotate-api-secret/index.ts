// rotate-api-secret: generates a new api_secret for an app owned by the caller.
// The old secret is immediately invalidated. The new secret is returned ONCE.
//
// POST /
// Body: { appId: string (uuid) }
// Returns: { api_secret: string }
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

function randomHex(bytes: number): string {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return Array.from(buf).map((b) => b.toString(16).padStart(2, "0")).join("");
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

  const { appId } = body as { appId?: string };
  if (!appId) return json({ error: "appId is required" }, 400);

  // Verify caller is the submitter
  const { data: app } = await supabase
    .from("store_apps")
    .select("id, submitted_by")
    .eq("id", appId)
    .maybeSingle();

  if (!app) return json({ error: "App not found" }, 404);
  if (app.submitted_by !== user.id) return json({ error: "Forbidden — not your app" }, 403);

  const api_secret = `sas_${randomHex(32)}`;

  const sbService = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const { error: updateErr } = await sbService
    .from("store_apps")
    .update({ api_secret, updated_at: new Date().toISOString() })
    .eq("id", appId);

  if (updateErr) return json({ error: updateErr.message }, 500);

  return json({ api_secret });
});
