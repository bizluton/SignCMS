// register-device — Self-registration endpoint for SignCMS Web Player / Tizen devices
//
// POST with { joinToken, deviceSerial?, deviceModel?, fingerprint, userAgent }
// joinToken may be the short 8-char join_code OR the legacy 32-char join_token hex.
// Returns { ok, registrationId, status:"pending", realtimeChannel }
// Device should subscribe to `device-reg:<registrationId>` broadcast for approval.

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
  if (req.method !== "POST")    return json({ ok: false, error: "method_not_allowed" }, 405);

  const SUPABASE_URL  = Deno.env.get("SUPABASE_URL")!;
  const SERVICE_ROLE  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const ANON_KEY      = Deno.env.get("SUPABASE_ANON_KEY")!;
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  let body: Record<string, unknown>;
  try { body = await req.json(); }
  catch { return json({ ok: false, error: "invalid_json" }, 400); }

  const { joinToken, deviceSerial, deviceModel, fingerprint, userAgent } = body as {
    joinToken:     string;
    deviceSerial?: string;
    deviceModel?:  string;
    fingerprint?:  string;
    userAgent?:    string;
  };

  if (!joinToken) return json({ ok: false, error: "join_token_required" }, 400);

  // Extract client IP for rate limiting (populated later at insert time).
  const clientIp =
    req.headers.get("cf-connecting-ip") ||
    req.headers.get("x-real-ip") ||
    req.headers.get("x-forwarded-for")?.split(",")[0].trim() ||
    "unknown";

  // Look up org by short join_code first, then fall back to legacy join_token
  const upper = joinToken.toUpperCase();
  let { data: org } = await admin
    .from("organizations")
    .select("id, name")
    .eq("join_code", upper)
    .maybeSingle();

  if (!org) {
    const { data: orgLegacy } = await admin
      .from("organizations")
      .select("id, name")
      .eq("join_token", joinToken)
      .maybeSingle();
    org = orgLegacy;
  }

  if (!org) return json({ ok: false, error: "invalid_join_token" }, 404);

  // Prevent duplicate: if a pending/approved registration with the same
  // fingerprint exists, return the existing registrationId so the device
  // can re-use it after a page reload.
  //
  // Security note: we no longer return device_token over HTTP. For an
  // already-approved registration, we look up the screen's current
  // device_token and RE-BROADCAST it via the device-reg:<id> Realtime
  // channel. The device just needs to be subscribed to receive it.
  // device_token is never sent in this HTTP response — Realtime is the
  // only delivery path. (See migration 20260520000002.)
  //
  // NOTE: This dedup check runs BEFORE the rate limit so that returning
  // devices (page reload, retry) are never blocked by the IP cap.
  if (fingerprint) {
    const { data: existing } = await admin
      .from("device_registrations")
      .select("id, status, screen_id")
      .eq("org_id", org.id)
      .eq("fingerprint", fingerprint)
      .in("status", ["pending", "approved"])
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (existing) {
      if (existing.status === "approved" && existing.screen_id) {
        // Look up the current device_token from screens and re-broadcast.
        const { data: scr } = await admin
          .from("screens")
          .select("id, device_token")
          .eq("id", existing.screen_id)
          .maybeSingle();
        if (scr?.device_token) {
          try {
            const realtimeClient = createClient(SUPABASE_URL, ANON_KEY);
            await realtimeClient
              .channel(`device-reg:${existing.id}`)
              .send({
                type:    "broadcast",
                event:   "approved",
                payload: { deviceToken: scr.device_token, screenId: scr.id },
              });
          } catch (e) {
            console.error("rebroadcast failed", e);
          }
        }
        return json({
          ok:              true,
          registrationId:  existing.id,
          status:          "approved",
          realtimeChannel: `device-reg:${existing.id}`,
        });
      }
      return json({
        ok:             true,
        registrationId: existing.id,
        status:         "pending",
        realtimeChannel: `device-reg:${existing.id}`,
      });
    }
  }

  // Rate limit: max 20 NEW registrations per IP per hour.
  // Placed after the fingerprint dedup so returning devices (reload/retry)
  // never hit the cap — only genuinely new registrations are counted.
  // This prevents join_code brute-force (~10^6 possibilities for 6-char codes).
  const oneHourAgo = new Date(Date.now() - 3_600_000).toISOString();
  const { count: recentCount } = await admin
    .from("device_registrations")
    .select("*", { count: "exact", head: true })
    .eq("ip_address", clientIp)
    .gte("created_at", oneHourAgo);
  if ((recentCount ?? 0) >= 20) {
    return json({ ok: false, error: "rate_limit_exceeded" }, 429);
  }

  // Create new pending registration
  const { data: reg, error } = await admin
    .from("device_registrations")
    .insert({
      org_id:        org.id,
      device_serial: deviceSerial  || null,
      device_model:  deviceModel   || null,
      fingerprint:   fingerprint   || "",
      user_agent:    userAgent     || req.headers.get("user-agent") || "",
      ip_address:    clientIp !== "unknown" ? clientIp : null,
      status:        "pending",
    })
    .select("id")
    .single();

  if (error || !reg) {
    console.error("insert error:", error);
    return json({ ok: false, error: "registration_failed" }, 500);
  }

  return json({
    ok:              true,
    registrationId:  reg.id,
    status:          "pending",
    realtimeChannel: `device-reg:${reg.id}`,
  });
});
