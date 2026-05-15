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

  // Prevent duplicate: if a pending registration with same fingerprint exists,
  // return the existing one so the device can re-use it after a page reload.
  if (fingerprint) {
    const { data: existing } = await admin
      .from("device_registrations")
      .select("id, status, device_token")
      .eq("org_id", org.id)
      .eq("fingerprint", fingerprint)
      .in("status", ["pending", "approved"])
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (existing) {
      if (existing.status === "approved" && existing.device_token) {
        return json({
          ok:            true,
          registrationId: existing.id,
          status:        "approved",
          deviceToken:   existing.device_token,
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

  // Create new pending registration
  const { data: reg, error } = await admin
    .from("device_registrations")
    .insert({
      org_id:        org.id,
      device_serial: deviceSerial  || null,
      device_model:  deviceModel   || null,
      fingerprint:   fingerprint   || "",
      user_agent:    userAgent     || req.headers.get("user-agent") || "",
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
