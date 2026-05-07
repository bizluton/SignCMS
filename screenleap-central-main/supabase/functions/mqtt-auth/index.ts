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
 *   # Shared secret sent as a header so only Mosquitto can call us:
 *   auth_opt_http_response_params  Authorization: Bearer <MQTT_SERVER_PASS>
 *
 * Credentials:
 *   Screens:         username = screen:{screenId}   password = {device_token}
 *   Server publisher: username = signcms-server     password = {MQTT_SERVER_PASS}
 *
 * Topic ACL (acc: 1=subscribe, 2=publish, 4=unsubscribe):
 *   screen:{id} → publish   signage/player/{id}/heartbeat
 *   screen:{id} → publish   signage/player/{id}/response
 *   screen:{id} → subscribe signage/player/{id}/command
 *   signcms-server → superuser (all topics)
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

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

  const SUPABASE_URL    = Deno.env.get("SUPABASE_URL")!;
  const SERVICE_ROLE    = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const MQTT_SERVER_PASS = Deno.env.get("MQTT_SERVER_PASS") ?? "";

  // ── Verify request comes from Mosquitto (shared secret) ────────────────
  const auth = req.headers.get("authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!MQTT_SERVER_PASS || token !== MQTT_SERVER_PASS) return deny(401);

  // ── Route by path suffix ───────────────────────────────────────────────
  const url      = new URL(req.url);
  const pathEnd  = url.pathname.split("/").pop() ?? "";

  let body: Record<string, string>;
  try { body = await req.json(); }
  catch { return deny(400); }

  const { username = "", password = "", clientid = "", topic = "", acc = "0" } = body;

  // ── /superuser — server publisher gets full access ─────────────────────
  if (pathEnd === "superuser") {
    const serverUser = Deno.env.get("MQTT_SERVER_USER") ?? "signcms-server";
    return username === serverUser ? allow() : deny();
  }

  // ── /user — authenticate client ────────────────────────────────────────
  if (pathEnd === "user") {
    // Server-side publisher
    const serverUser = Deno.env.get("MQTT_SERVER_USER") ?? "signcms-server";
    if (username === serverUser) {
      return password === MQTT_SERVER_PASS ? allow() : deny();
    }

    // Screen player: username must be "screen:{screenId}"
    if (!username.startsWith("screen:")) return deny();
    const screenId   = username.slice("screen:".length);
    if (!screenId || !password) return deny();

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: authResult } = await admin.rpc("get_screen_by_device_token", { _token: password });
    if (!authResult?.ok || authResult.screen_id !== screenId) return deny();

    return allow();
  }

  // ── /acl — check topic permission ─────────────────────────────────────
  if (pathEnd === "acl") {
    const accNum = parseInt(acc, 10);
    // acc: 1=subscribe, 2=publish, 4=unsubscribe

    // Server publisher: grant all via superuser (this path shouldn't be reached
    // if superuser check returned true, but handle gracefully)
    const serverUser = Deno.env.get("MQTT_SERVER_USER") ?? "signcms-server";
    if (username === serverUser) return allow();

    // Screen: username = "screen:{screenId}"
    if (!username.startsWith("screen:")) return deny();
    const screenId = username.slice("screen:".length);

    const publishOk   = accNum === 2 || accNum === 6; // publish or publish+subscribe
    const subscribeOk = accNum === 1 || accNum === 4 || accNum === 6; // sub or unsub or both

    if (publishOk) {
      // Screens may publish to their own: heartbeat, response, status (LWT)
      const allowed =
        topic === `signage/player/${screenId}/heartbeat` ||
        topic === `signage/player/${screenId}/response`  ||
        topic === `signage/player/${screenId}/status`;
      return allowed ? allow() : deny();
    }

    if (subscribeOk) {
      // Screens may subscribe to their own: command, shadow/delta
      const allowed =
        topic === `signage/player/${screenId}/command`      ||
        topic === `signage/player/${screenId}/shadow/delta`;
      return allowed ? allow() : deny();
    }

    return deny();
  }

  return deny(404);
});
