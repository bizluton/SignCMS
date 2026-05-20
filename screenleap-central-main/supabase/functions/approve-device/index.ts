// approve-device — Admin approves a pending device registration
//
// POST (authenticated) with { registrationId, screenName, channelId? }
// 1. Creates a screens row  2. Issues device_token  3. Creates device_license
// 4. Updates registration → approved  5. Broadcasts token to waiting device via Realtime

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { corsHeaders, corsPreflight } from "../_shared/cors.ts";

function json(req: Request, body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(req), "Content-Type": "application/json" },
  });
}

function randomHex(bytes: number): string {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return Array.from(buf).map((b) => b.toString(16).padStart(2, "0")).join("");
}

// Crypto-secure 6-digit numeric code (100000–999999). Used for new
// device_licenses created during approve-device. Math.random() is not
// suitable because the output is predictable.
function randomDigits6(): string {
  // Read 4 bytes, treat as uint32, mod 900000, shift to 100000.
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  return String(100000 + (buf[0] % 900000));
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return corsPreflight(req);
  if (req.method !== "POST")    return json(req, { ok: false, error: "method_not_allowed" }, 405);

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const ANON_KEY     = Deno.env.get("SUPABASE_ANON_KEY")!;

  // Auth: must be an org admin or system admin
  const authHeader = req.headers.get("authorization");
  if (!authHeader) return json(req, { ok: false, error: "unauthorized" }, 401);

  const userClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { authorization: authHeader } },
  });
  const { data: { user }, error: authErr } = await userClient.auth.getUser();
  if (authErr || !user) return json(req, { ok: false, error: "unauthorized" }, 401);

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  let body: Record<string, unknown>;
  try { body = await req.json(); }
  catch { return json(req, { ok: false, error: "invalid_json" }, 400); }

  const { registrationId, screenName, channelId } = body as {
    registrationId: string;
    screenName:     string;
    channelId?:     string;
  };

  if (!registrationId) return json(req, { ok: false, error: "registration_id_required" }, 400);
  if (!screenName)      return json(req, { ok: false, error: "screen_name_required" }, 400);

  // Fetch the pending registration
  const { data: reg } = await admin
    .from("device_registrations")
    .select("id, org_id, device_serial, device_model, status, fingerprint")
    .eq("id", registrationId)
    .maybeSingle();

  if (!reg)                   return json(req, { ok: false, error: "registration_not_found" }, 404);
  if (reg.status !== "pending") return json(req, { ok: false, error: "not_pending" }, 409);

  // Permission check: caller must be in the same org
  const { data: roles } = await admin
    .from("user_roles")
    .select("role")
    .eq("user_id", user.id)
    .eq("org_id",  reg.org_id);

  const isOrgAdmin = roles?.some(r => ["org_admin", "admin"].includes(r.role));
  const { data: sysAdmin } = await admin.rpc("is_system_admin", { _uid: user.id });
  if (!isOrgAdmin && !sysAdmin) return json(req, { ok: false, error: "permission_denied" }, 403);

  // 1. Generate device token (64-char hex = 32 bytes)
  const deviceToken  = randomHex(32);

  // 2. Generate a unique virtual serial if device didn't provide one
  const deviceSerial = reg.device_serial || `WP-${randomHex(8).toUpperCase()}`;
  const deviceModel  = reg.device_model  || "Web Player";

  // 3. Create a new screen
  const { data: screen, error: screenErr } = await admin
    .from("screens")
    .insert({
      name:                    screenName,
      org_id:                  reg.org_id,
      resolution:              "1920×1080",
      status:                  "active",
      serial_number:           deviceSerial,
      device_token:            deviceToken,
      device_token_issued_at:  new Date().toISOString(),
      device_token_issued_by:  user.id,
      ...(channelId ? { current_channel_id: channelId } : {}),
    })
    .select("id")
    .single();

  if (screenErr || !screen) {
    console.error("screen insert error:", screenErr);
    return json(req, { ok: false, error: "screen_create_failed" }, 500);
  }

  // 4. Create device license (code: 6-digit auto-generated, crypto-secure)
  const licenseCode = randomDigits6();
  await admin.from("device_licenses").insert({
    device_model:  deviceModel,
    device_serial: deviceSerial,
    org_id:        reg.org_id,
    status:        "active",
    code:          licenseCode,
    note:          `Auto-registered — ${screenName}`,
    created_by:    user.id,
  });

  // 5. Mark registration as approved.
  //    Important: do NOT write device_token into the row — it is delivered
  //    exclusively via the Realtime broadcast below. Persisting the bearer
  //    token alongside an unauthenticated-readable row has historically
  //    leaked tokens (see 20260520000002 migration).
  await admin
    .from("device_registrations")
    .update({
      status:      "approved",
      screen_id:   screen.id,
      approved_at: new Date().toISOString(),
      approved_by: user.id,
      updated_at:  new Date().toISOString(),
    })
    .eq("id", registrationId);

  // 6. Broadcast token to the waiting device via Realtime
  const realtimeClient = createClient(SUPABASE_URL, ANON_KEY);
  await realtimeClient
    .channel(`device-reg:${registrationId}`)
    .send({
      type:    "broadcast",
      event:   "approved",
      payload: { deviceToken, screenId: screen.id },
    });

  return json(req, {
    ok:          true,
    screenId:    screen.id,
    deviceToken,
    licenseCode,
  });
});
