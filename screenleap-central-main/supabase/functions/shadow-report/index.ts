/**
 * shadow-report — Device reports its current state to the server.
 *
 * Called by the Electron player (via HTTP POST) after it applies a
 * shadow delta.  The server updates screen_shadows.reported; the DB
 * trigger recomputes delta.  If delta becomes empty (desired == reported)
 * the server clears the retained shadow/delta MQTT message so the device
 * will not receive it again on the next reconnect.
 *
 * Auth: x-device-token header (same as player-sync)
 *
 * Request body:
 *   {
 *     "reported": {
 *       "channel_id":   "<uuid|null>",
 *       "status":       "playing|idle|error",
 *       "version":      "1.0.0"
 *     }
 *   }
 *
 * Response:
 *   { ok: true, synced: true|false, delta: {...} }
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { clearShadowDelta, publishShadowDelta } from "../_shared/mqtt.ts";

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
  if (!deviceToken)  return json({ ok: false, error: "missing_token" }, 401);

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // ── Authenticate ─────────────────────────────────────────────────────────
  const { data: auth } = await admin.rpc("get_screen_by_device_token", { _token: deviceToken });
  if (!auth?.ok) return json({ ok: false, error: auth?.error ?? "invalid_token" }, 401);

  const screenId = auth.screen_id as string;

  // ── Parse reported state ──────────────────────────────────────────────────
  let reported: Record<string, unknown> = {};
  try {
    const body = await req.json();
    if (body?.reported && typeof body.reported === "object") {
      reported = body.reported;
    }
  } catch { /* empty body → treat as empty reported */ }

  // ── Update reported in screen_shadows ─────────────────────────────────────
  // The DB trigger auto-computes delta and sets synced_at when delta == {}.
  const { data: shadow, error } = await admin
    .from("screen_shadows")
    .upsert(
      { screen_id: screenId, reported },
      { onConflict: "screen_id" },
    )
    .select("desired, reported, delta, synced_at")
    .maybeSingle();

  if (error) {
    console.error("[shadow-report] upsert error:", error.message);
    return json({ ok: false, error: error.message }, 500);
  }

  const delta  = (shadow?.delta  ?? {}) as Record<string, unknown>;
  const synced = Object.keys(delta).length === 0;

  // ── Sync MQTT retain ──────────────────────────────────────────────────────
  if (synced) {
    // desired == reported → clear the retained delta from the broker
    await clearShadowDelta(screenId);
  } else {
    // Still a delta — re-publish in case the broker lost it (shouldn't happen
    // with QoS 1 retain, but be defensive)
    const desired = (shadow?.desired ?? {}) as Record<string, unknown>;
    await publishShadowDelta(screenId, desired, delta);
  }

  return json({ ok: true, synced, delta });
});
