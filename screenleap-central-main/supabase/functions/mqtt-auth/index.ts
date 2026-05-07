/**
 * mqtt-auth — EMQX HTTP Authentication webhook
 *
 * EMQX calls this endpoint for every client that attempts to connect.
 * We validate the player credentials and return { result: "allow" } or
 * { result: "deny" }.
 *
 * EMQX HTTP Auth configuration (Basic Auth HTTP Plugin):
 *   URL:    https://<project>.supabase.co/functions/v1/mqtt-auth
 *   Method: POST
 *   Header: Authorization: Bearer <MQTT_SERVER_API_KEY>
 *
 * Player credentials:
 *   clientid: screen_{screenId}_{timestamp}
 *   username:  screen:{screenId}
 *   password:  {device_token}   (64-hex raw token)
 *
 * Server-side publisher credentials (used by Edge Functions):
 *   username:  server
 *   password:  {MQTT_SERVER_API_KEY}
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const CORS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
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
  if (req.method !== "POST")    return json({ result: "deny" }, 405);

  const SUPABASE_URL       = Deno.env.get("SUPABASE_URL")!;
  const SERVICE_ROLE       = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const MQTT_SERVER_API_KEY = Deno.env.get("MQTT_SERVER_API_KEY") ?? "";

  // ── Verify this request comes from the EMQX broker ─────────────────────
  // EMQX sends Bearer token in Authorization header (set in EMQX HTTP Auth config)
  const authHeader = req.headers.get("authorization") ?? "";
  const webhookKey = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
  if (!MQTT_SERVER_API_KEY || webhookKey !== MQTT_SERVER_API_KEY) {
    return json({ result: "deny" }, 401);
  }

  // ── Parse EMQX auth payload ─────────────────────────────────────────────
  let body: { username?: string; password?: string; clientid?: string };
  try { body = await req.json(); }
  catch { return json({ result: "deny" }, 400); }

  const { username = "", password = "" } = body;

  // ── Server-side publisher (Edge Functions) ─────────────────────────────
  // Allow the backend to publish using the same API key as the server password.
  if (username === "server") {
    if (password === MQTT_SERVER_API_KEY && MQTT_SERVER_API_KEY) {
      return json({ result: "allow" });
    }
    return json({ result: "deny" });
  }

  // ── Player authentication ───────────────────────────────────────────────
  // Username must be "screen:{uuid}" and password must be the raw device token.
  if (!username.startsWith("screen:")) {
    return json({ result: "deny" });
  }

  const screenId   = username.slice("screen:".length);
  const deviceToken = password;

  if (!screenId || !deviceToken) return json({ result: "deny" });

  // Validate via get_screen_by_device_token RPC
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: auth } = await admin.rpc("get_screen_by_device_token", { _token: deviceToken });

  if (!auth?.ok) return json({ result: "deny" });

  // Confirm the authenticated screen_id matches the claimed username
  if (auth.screen_id !== screenId) return json({ result: "deny" });

  return json({ result: "allow" });
});
