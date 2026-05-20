// player-heartbeat — lightweight keep-alive endpoint for SignCMS players.
//
// Used by players that are connected to Supabase Realtime and have nothing
// new to report (no log batch, no shadow change, no project re-sync needed).
// Players still need to ping periodically so the server can mark them online.
//
// Cost-vs-`player-sync`:
//   player-sync     : ~6 queries (auth + heartbeat + log batch + screens lookup +
//                                 channel + project + manifest)
//   player-heartbeat: 2 queries  (auth + UPDATE screens SET last_ping_at)
//
// At 10k devices on a 300s polling interval that's the difference between
// ~86M and ~29M Supabase queries/month — a real impact on tier limits.
//
// Players should call this instead of player-sync when ALL of:
//   1. They are connected to Realtime (so they will be notified of changes).
//   2. The log_batch buffer is empty.
//   3. They are not requesting a fresh manifest / project.
//
// Otherwise (initial connect, after Realtime drop, log batch pending, etc.)
// call player-sync.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const CORS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-device-token",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "POST")    return json({ ok: false, error: "method_not_allowed" }, 405);

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  const deviceToken = req.headers.get("x-device-token") ?? "";
  if (!deviceToken) return json({ ok: false, error: "missing_token" }, 401);

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // Validate device token (reuses the same RPC as player-sync)
  const { data: auth } = await admin.rpc("get_screen_by_device_token", { _token: deviceToken });
  if (!auth?.ok) return json({ ok: false, error: auth?.error ?? "invalid_token" }, 401);

  const screenId = auth.screen_id as string;
  const now      = new Date().toISOString();

  // Optional: accept disk_status for telemetry without forcing a full sync.
  // The player can send this on heartbeats to keep storage stats fresh.
  let diskStatus: Record<string, unknown> | null = null;
  try {
    const body = await req.json();
    if (body?.disk_status && typeof body.disk_status === "object") {
      diskStatus = body.disk_status;
    }
  } catch { /* empty body fine */ }

  const { error: updErr } = await admin
    .from("screens")
    .update({
      last_ping_at: now,
      online:       true,
      status:       "online",
      updated_at:   now,
      ...(diskStatus !== null ? {
        disk_status:    diskStatus,
        disk_status_at: now,
      } : {}),
    })
    .eq("id", screenId);

  if (updErr) {
    console.error("heartbeat update failed", updErr);
    return json({ ok: false, error: "update_failed" }, 500);
  }

  // Tell the player to keep calling /heartbeat unless server suggests
  // otherwise. `next_action: "sync"` would tell the player to upgrade to
  // a full player-sync on its next tick (used as a server-side nudge when
  // the project has changed but Realtime push hasn't reached the player).
  return json({
    ok:        true,
    server_ts: now,
    // Future: include a flag here when something changed (e.g. published a
    // new channel) so the player upgrades to a full sync on next tick.
    next_action: "heartbeat",
  });
});
