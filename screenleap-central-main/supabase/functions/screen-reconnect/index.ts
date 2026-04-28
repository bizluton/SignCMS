// Reconnect Screen - validates JWT, checks user can access the screen,
// records a "reconnect requested" screen_log row, refreshes the screen's
// updated_at timestamp (heartbeat ping), and resolves any active offline alert.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

interface Body {
  screen_id?: string;
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  // Validate JWT in code (verify_jwt is off by default)
  const auth = req.headers.get("Authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice("Bearer ".length) : "";
  if (!token) return json({ error: "Missing bearer token" }, 401);

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;

  // User-scoped client for identity check
  const userClient = createClient(SUPABASE_URL, ANON, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const { data: userData, error: userErr } = await userClient.auth.getUser();
  if (userErr || !userData?.user) return json({ error: "Invalid token" }, 401);
  const userId = userData.user.id;

  // Parse + validate body
  let body: Body;
  try { body = await req.json(); } catch { return json({ error: "Invalid JSON" }, 400); }
  const screenId = typeof body.screen_id === "string" ? body.screen_id.trim() : "";
  if (!screenId) return json({ error: "screen_id is required" }, 400);

  // Service-role client for cross-table writes
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // Authorisation: caller must be in the screen's org or be a system admin
  const { data: screen, error: screenErr } = await admin
    .from("screens")
    .select("id, name, org_id, online")
    .eq("id", screenId)
    .maybeSingle();
  if (screenErr) return json({ error: screenErr.message }, 500);
  if (!screen) return json({ error: "Screen not found" }, 404);

  const { data: isSysAdmin } = await admin.rpc("is_system_admin", { _user: userId });
  if (!isSysAdmin) {
    const { data: inOrg } = await admin.rpc("user_in_org", {
      _user_id: userId,
      _org_id: screen.org_id,
    });
    if (!inOrg) return json({ error: "Forbidden" }, 403);
  }

  // Touch the screen row so updated_at = "last reconnect attempt"
  const nowIso = new Date().toISOString();
  const { error: touchErr } = await admin
    .from("screens")
    .update({ updated_at: nowIso })
    .eq("id", screenId);
  if (touchErr) return json({ error: touchErr.message }, 500);

  // Best-effort: log the reconnect attempt (table may have varying columns)
  await admin.from("screen_logs").insert({
    screen_id: screenId,
    org_id: screen.org_id,
    event_type: "system",
    event_code: "screen.reconnect_requested",
    event_title: "Reconnect requested",
    event_detail: `Reconnect requested by user ${userId}`,
    event_params: { requested_by: userId },
  }).then(() => {}, () => {});

  // Resolve any active offline alert for this screen (best-effort)
  await admin
    .from("screen_alerts")
    .update({
      status: "acknowledged",
      acknowledged_at: nowIso,
      acknowledged_by: userId,
      note: "Auto-acknowledged via reconnect request",
    })
    .eq("screen_id", screenId)
    .eq("status", "active");

  return json({
    ok: true,
    screen_id: screenId,
    requested_at: nowIso,
    online: screen.online,
  });
});