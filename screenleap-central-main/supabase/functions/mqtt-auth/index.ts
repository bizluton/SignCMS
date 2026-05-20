/**
 * mqtt-auth — Mosquitto HTTP Authentication backend (mosquitto-go-auth plugin)
 *
 * This function acts as the HTTP backend for the `mosquitto-go-auth` plugin.
 * Mosquitto calls sub-paths of this function's URL for each auth check.
 *
 * mosquitto.conf (mosquitto-go-auth plugin):
 *   auth_plugin /usr/lib/mosquitto-go-auth.so
 *   auth_opt_backends http
 *   auth_opt_http_host   <supabase-project>.supabase.co
 *   auth_opt_http_port   443
 *   auth_opt_http_with_tls true
 *   auth_opt_http_params_mode json
 *   auth_opt_http_getuser_uri    /functions/v1/mqtt-auth/user
 *   auth_opt_http_superuser_uri  /functions/v1/mqtt-auth/superuser
 *   auth_opt_http_aclcheck_uri   /functions/v1/mqtt-auth/acl
 *
 * MQTT Credentials (native MQTT username / password):
 *   Devices (preferred): username = {screenId}       password = {screens.device_token}
 *   Devices (legacy):    username = {screenId}       password = MQTT_DEVICE_PASS (shared)
 *   Server publisher:    username = signcms-server   password = MQTT_SERVER_PASS
 *
 * The shared MQTT_DEVICE_PASS path is a compatibility fallback for player
 * builds that predate the per-device-token rollout. Operators may disable it
 * by setting MQTT_ALLOW_SHARED_PASSWORD=false once all players are updated.
 *
 * Topic ACL (acc: 1=subscribe, 2=publish, 4=unsubscribe):
 *   {screenId} → publish   signage/player/{screenId}/heartbeat
 *   {screenId} → publish   signage/player/{screenId}/response
 *   {screenId} → publish   signage/player/{screenId}/status  (LWT)
 *   {screenId} → subscribe signage/player/{screenId}/command
 *   {screenId} → subscribe signage/player/{screenId}/shadow/delta
 *   signcms-server → superuser (all topics)
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

// UUID v4-ish shape; the device username is screens.id which is a uuid.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Constant-time string comparison to defeat timing side-channels on token
// verification. Both inputs must be the same byte length to be considered
// equal; this is fine because device_token is always 64 hex chars.
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

const CORS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Headers": "authorization, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function allow(status = 200) {
  return new Response(JSON.stringify({ ok: true }), {
    status, headers: { ...CORS, "Content-Type": "application/json" },
  });
}

function deny(status = 403) {
  return new Response(JSON.stringify({ ok: false }), {
    status, headers: { ...CORS, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "POST")    return deny(405);

  const SUPABASE_URL     = Deno.env.get("SUPABASE_URL")!;
  const SERVICE_ROLE     = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const MQTT_SERVER_USER = Deno.env.get("MQTT_SERVER_USER") ?? "signcms-server";
  const MQTT_SERVER_PASS = Deno.env.get("MQTT_SERVER_PASS") ?? "";
  const MQTT_DEVICE_PASS = Deno.env.get("MQTT_DEVICE_PASS") ?? "";
  // Compatibility flag for the shared-password path during per-device-token
  // rollout. Set MQTT_ALLOW_SHARED_PASSWORD=false in env once all players
  // send their device_token as the MQTT password.
  const ALLOW_SHARED = (Deno.env.get("MQTT_ALLOW_SHARED_PASSWORD") ?? "true").toLowerCase() !== "false";

  // ── Route by path suffix ───────────────────────────────────────────────
  const url     = new URL(req.url);
  const pathEnd = url.pathname.split("/").pop() ?? "";

  let body: Record<string, string>;
  try { body = await req.json(); }
  catch { return deny(400); }

  const { username = "", password = "", topic = "", acc = "0" } = body;

  // ── /superuser — server publisher gets full access ─────────────────────
  if (pathEnd === "superuser") {
    return username === MQTT_SERVER_USER ? allow() : deny();
  }

  // ── /user — authenticate client ────────────────────────────────────────
  if (pathEnd === "user") {
    if (!username || !password) return deny();

    // Server publisher
    if (username === MQTT_SERVER_USER) {
      if (!MQTT_SERVER_PASS) return deny();
      return timingSafeEqual(password, MQTT_SERVER_PASS) ? allow() : deny();
    }

    // Device path — username must look like a screen UUID.
    if (!UUID_RE.test(username)) return deny();

    // Preferred: per-device token stored on screens.device_token.
    // This is the only path that ties an MQTT session to one specific screen.
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: scr } = await admin
      .from("screens")
      .select("device_token")
      .eq("id", username)
      .maybeSingle();

    if (scr?.device_token && timingSafeEqual(password, scr.device_token)) {
      return allow();
    }

    // Legacy fallback: shared MQTT_DEVICE_PASS. To be removed once all
    // players authenticate with their per-device token (set
    // MQTT_ALLOW_SHARED_PASSWORD=false to disable).
    if (ALLOW_SHARED && MQTT_DEVICE_PASS && timingSafeEqual(password, MQTT_DEVICE_PASS)) {
      return allow();
    }

    return deny();
  }

  // ── /acl — check topic permission ─────────────────────────────────────
  if (pathEnd === "acl") {
    const accNum = parseInt(acc, 10);
    // acc: 1=subscribe, 2=publish, 4=unsubscribe

    // Server publisher: superuser → grant all
    if (username === MQTT_SERVER_USER) return allow();

    if (!username) return deny();
    const serial = username;  // screenId is the username directly

    const publishOk   = accNum === 2 || accNum === 6;
    const subscribeOk = accNum === 1 || accNum === 4 || accNum === 6;

    if (publishOk) {
      const allowed =
        topic === `signage/player/${serial}/heartbeat` ||
        topic === `signage/player/${serial}/response`  ||
        topic === `signage/player/${serial}/status`;
      return allowed ? allow() : deny();
    }

    if (subscribeOk) {
      const allowed =
        topic === `signage/player/${serial}/command`      ||
        topic === `signage/player/${serial}/shadow/delta`;
      return allowed ? allow() : deny();
    }

    return deny();
  }

  return deny(404);
});
