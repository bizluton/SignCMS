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
 *   Devices:          username = {screenId}       password = MQTT_DEVICE_PASS (shared)
 *   Server publisher: username = signcms-server   password = MQTT_SERVER_PASS
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
      return password === MQTT_SERVER_PASS ? allow() : deny();
    }

    // Device: any screenId with the shared device password
    if (!MQTT_DEVICE_PASS) return deny();    // secret not configured → reject all
    return password === MQTT_DEVICE_PASS ? allow() : deny();
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
