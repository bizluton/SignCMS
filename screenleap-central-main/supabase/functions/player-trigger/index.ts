/**
 * player-trigger
 *
 * Native Android player API — smart-trigger event polling.
 * Called every 10 seconds by the Management Software.
 *
 * GET /functions/v1/player-trigger
 *       ?screen_id={uuid}
 *       &org_id={uuid}
 *       &since={ISO-timestamp}
 *
 * The APK stores the timestamp of the last successful poll as `since`.
 * On startup, pass since = now() − 30 s to catch any trigger that fired
 * while the device was booting.
 *
 * Response:
 * {
 *   "events": [
 *     {
 *       "log_id":          "uuid",
 *       "rule_id":         "uuid",
 *       "trigger_key":     "iot_sensor_1",
 *       "design_id":       "uuid",
 *       "design_name":     "Emergency Alert",
 *       "duration_seconds": 30,
 *       "fired_at":        "2026-05-01T12:00:05Z"
 *     }
 *   ],
 *   "server_time": "2026-05-01T12:00:10Z"
 * }
 *
 * APK behaviour on non-empty events:
 *   1. Show the design_id content in WebView for duration_seconds.
 *   2. After the duration expires, resume the normal playlist.
 *   3. If a new event arrives while one is active, replace with the latest.
 *   4. Update the local `since` cursor to server_time after a successful poll.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.99.3";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "GET") return json({ error: "method_not_allowed" }, 405);

  try {
    const url = new URL(req.url);
    const screenId = url.searchParams.get("screen_id");
    const orgId    = url.searchParams.get("org_id");
    const since    = url.searchParams.get("since");

    if (!screenId) return json({ error: "screen_id is required" }, 400);
    if (!orgId)    return json({ error: "org_id is required" }, 400);

    // Default `since` to 30 s ago when omitted (device just booted).
    const sinceTs = since
      ? new Date(since).toISOString()
      : new Date(Date.now() - 30_000).toISOString();

    const serverTime = new Date().toISOString();

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // Fetch successful trigger log rows newer than `since` that target this
    // screen (screen_id = screenId) OR the whole org (screen_id IS NULL).
    const { data: logs, error: logsError } = await supabase
      .from("smart_trigger_logs")
      .select(
        "id, rule_id, screen_id, org_id, success, trigger_key, created_at," +
        "smart_trigger_rules!rule_id(name, duration_seconds, target_design_project_id," +
        "  design_projects!target_design_project_id(name))",
      )
      .eq("org_id", orgId)
      .eq("success", true)
      .gte("created_at", sinceTs)
      .or(`screen_id.eq.${screenId},screen_id.is.null`)
      .order("created_at", { ascending: true })
      .limit(20);

    if (logsError) {
      console.error("player-trigger log fetch error:", logsError);
      return json({ error: "query_failed" }, 500);
    }

    type RawLog = {
      id: string;
      rule_id: string | null;
      screen_id: string | null;
      org_id: string;
      success: boolean;
      trigger_key: string | null;
      created_at: string;
      smart_trigger_rules: {
        name: string;
        duration_seconds: number | null;
        target_design_project_id: string | null;
        design_projects: { name: string } | null;
      } | null;
    };

    const events = ((logs ?? []) as unknown as RawLog[]).map(row => ({
      log_id:           row.id,
      rule_id:          row.rule_id,
      trigger_key:      row.trigger_key,
      design_id:        row.smart_trigger_rules?.target_design_project_id ?? null,
      design_name:      row.smart_trigger_rules?.design_projects?.name ?? null,
      duration_seconds: row.smart_trigger_rules?.duration_seconds ?? 30,
      fired_at:         row.created_at,
    }));

    return json({ events, server_time: serverTime });

  } catch (err) {
    console.error("player-trigger error:", err);
    return json({ error: "internal_error" }, 500);
  }
});
