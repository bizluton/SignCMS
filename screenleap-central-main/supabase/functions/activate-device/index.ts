// activate-device — Device self-activates by entering a 6-digit code
//
// POST (no auth) { code, fingerprint?, userAgent?, deviceSerial?, deviceModel? }
//
// Checks two code sources in order:
//   1. device_licenses   — admin pre-registered a specific device (serial/model known)
//   2. screen_activation_codes — admin created a "web player" slot with just a name
//
// In both cases: finds or creates a screen, issues a fresh device_token.
// For screen_activation_codes: writes real deviceSerial + deviceModel from the device.
//
// Returns { ok, deviceToken, screenId }

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

function randomHex(bytes: number): string {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return Array.from(buf).map(b => b.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "POST")    return json({ ok: false, error: "method_not_allowed" }, 405);

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  let body: Record<string, unknown>;
  try { body = await req.json(); }
  catch { return json({ ok: false, error: "invalid_json" }, 400); }

  const { code, fingerprint, userAgent, deviceSerial, deviceModel } = body as {
    code:          string;
    fingerprint?:  string;
    userAgent?:    string;
    deviceSerial?: string;
    deviceModel?:  string;
  };

  // Must be exactly 6 digits
  const trimmed = (code || "").trim();
  if (!/^\d{6}$/.test(trimmed)) {
    return json({ ok: false, error: "invalid_code" }, 400);
  }

  // ── 1. Check device_licenses (admin pre-registered physical device) ────────
  const { data: lic } = await admin
    .from("device_licenses")
    .select("id, org_id, device_serial, device_model, note, status")
    .eq("code", trimmed)
    .eq("status", "active")
    .maybeSingle();

  if (lic) {
    // Priority: license serial → device-reported → fingerprint-based virtual
    const serial = (lic.device_serial && lic.device_serial.trim())
      || (deviceSerial && deviceSerial.trim())
      || `WP-${(fingerprint || randomHex(8)).slice(0, 16).toUpperCase()}`;

    const model = (lic.device_model && lic.device_model.trim())
      || (deviceModel && deviceModel.trim())
      || "Web Player";

    // Find or create the screen
    const { data: existing } = await admin
      .from("screens")
      .select("id")
      .eq("org_id", lic.org_id)
      .eq("serial_number", serial)
      .maybeSingle();

    const deviceToken = randomHex(32);
    let screenId: string;

    if (existing) {
      await admin
        .from("screens")
        .update({
          device_token:           deviceToken,
          device_token_issued_at: new Date().toISOString(),
          status:                 "active",
        })
        .eq("id", existing.id);
      screenId = existing.id;
      console.log(`Re-issued token for existing screen ${screenId}`);
    } else {
      const rawNote    = (lic.note || "").replace(/^Auto-registered\s*[—-]\s*/i, "").trim();
      const screenName = rawNote || model;

      const { data: scr, error: scrErr } = await admin
        .from("screens")
        .insert({
          name:                   screenName,
          org_id:                 lic.org_id,
          resolution:             "1920x1080",
          status:                 "active",
          serial_number:          serial,
          device_model:           model,
          device_token:           deviceToken,
          device_token_issued_at: new Date().toISOString(),
        })
        .select("id")
        .single();

      if (scrErr || !scr) {
        console.error("screen create failed:", scrErr);
        return json({ ok: false, error: "screen_create_failed" }, 500);
      }
      screenId = scr.id;
      console.log(`Created new screen ${screenId} (${screenName})`);
    }

    return json({ ok: true, deviceToken, screenId });
  }

  // ── 2. Check screen_activation_codes (admin created a web player slot) ────
  const { data: ac } = await admin
    .from("screen_activation_codes")
    .select("id, org_id, name, status")
    .eq("code", trimmed)
    .eq("status", "pending")
    .maybeSingle();

  if (!ac) return json({ ok: false, error: "invalid_code" }, 404);

  // Use device-reported serial, or fingerprint-based virtual serial
  const acSerial = (deviceSerial && deviceSerial.trim())
    || `WP-${(fingerprint || randomHex(8)).slice(0, 16).toUpperCase()}`;
  const acModel  = (deviceModel && deviceModel.trim()) || userAgent?.slice(0, 100) || "Web Player";

  const acToken = randomHex(32);
  const { data: acScr, error: acScrErr } = await admin
    .from("screens")
    .insert({
      name:                   ac.name,
      org_id:                 ac.org_id,
      resolution:             "1920x1080",
      status:                 "active",
      serial_number:          acSerial,
      device_model:           acModel,
      device_token:           acToken,
      device_token_issued_at: new Date().toISOString(),
    })
    .select("id")
    .single();

  if (acScrErr || !acScr) {
    console.error("screen create failed:", acScrErr);
    return json({ ok: false, error: "screen_create_failed" }, 500);
  }

  // Mark the code as used — triggers Realtime UPDATE that admin UI listens to
  await admin
    .from("screen_activation_codes")
    .update({ status: "used", screen_id: acScr.id, used_at: new Date().toISOString() })
    .eq("id", ac.id);

  console.log(`Web player activated: screen ${acScr.id} (${ac.name}), serial=${acSerial}, model=${acModel}`);
  return json({ ok: true, deviceToken: acToken, screenId: acScr.id });
});
