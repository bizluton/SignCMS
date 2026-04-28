// Trigger-share-sign: signs and verifies trigger-test share payloads using HMAC-SHA256.
// The signing secret is auto-generated on first use and stored in `public.trigger_share_keys`
// (RLS-locked, service-role only). Clients never see the secret — only the resulting signature.
//
// POST /sign    body: { payload: <any JSON> }    -> { sig: <base64url> }
// POST /verify  body: { payload: <any JSON>, sig: <base64url> } -> { ok: boolean, error?: string }
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// Max sizes for trigger-test share payloads.
// - REQUEST_BYTES caps the raw HTTP body (covers payload + sig + JSON envelope).
// - PAYLOAD_BYTES caps the canonicalized payload that actually gets signed.
// Both are intentionally generous for typical use (a handful of presets) but
// small enough to keep URL hashes manageable and to prevent DoS via huge JSON.
const MAX_REQUEST_BYTES = 64 * 1024;   // 64 KB raw request body
const MAX_PAYLOAD_BYTES = 48 * 1024;   // 48 KB canonical payload

function toBase64Url(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(s: string): Uint8Array {
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/") + pad;
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// Stable JSON serialization: sort object keys recursively so the same logical
// payload always produces the same signing input regardless of key order.
function canonicalize(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(canonicalize).join(",") + "]";
  const keys = Object.keys(value as Record<string, unknown>).sort();
  return "{" + keys.map((k) => JSON.stringify(k) + ":" + canonicalize((value as any)[k])).join(",") + "}";
}

let cachedKey: CryptoKey | null = null;

async function getSigningKey(): Promise<CryptoKey> {
  if (cachedKey) return cachedKey;
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
  // Try read existing
  const { data: existing, error: readErr } = await supabase
    .from("trigger_share_keys").select("secret").eq("id", 1).maybeSingle();
  if (readErr) throw readErr;

  let secret: string;
  if (existing?.secret) {
    secret = existing.secret;
  } else {
    // Generate a fresh 32-byte secret and persist it (idempotent via singleton id=1).
    const buf = new Uint8Array(32);
    crypto.getRandomValues(buf);
    secret = toBase64Url(buf);
    const { error: insErr } = await supabase
      .from("trigger_share_keys")
      .insert({ id: 1, secret });
    if (insErr) {
      // Race: another invocation just created it — re-read.
      const { data: again } = await supabase
        .from("trigger_share_keys").select("secret").eq("id", 1).maybeSingle();
      if (!again?.secret) throw insErr;
      secret = again.secret;
    }
  }

  const keyBytes = new TextEncoder().encode(secret);
  cachedKey = await crypto.subtle.importKey(
    "raw",
    keyBytes,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
  return cachedKey;
}

/**
 * Canonicalize + size-check the payload. Throws an Error with `.tooLarge = true`
 * when the canonical form exceeds MAX_PAYLOAD_BYTES so the handler can return 413.
 */
function canonicalBytes(payload: unknown): Uint8Array {
  const bytes = new TextEncoder().encode(canonicalize(payload));
  if (bytes.length > MAX_PAYLOAD_BYTES) {
    const err: any = new Error(
      `Payload too large: ${bytes.length} bytes (max ${MAX_PAYLOAD_BYTES})`,
    );
    err.tooLarge = true;
    err.size = bytes.length;
    throw err;
  }
  return bytes;
}

async function sign(payload: unknown): Promise<string> {
  const key = await getSigningKey();
  const data = canonicalBytes(payload);
  const sig = await crypto.subtle.sign("HMAC", key, data);
  return toBase64Url(new Uint8Array(sig));
}

async function verify(payload: unknown, sigB64: string): Promise<boolean> {
  const key = await getSigningKey();
  // canonicalBytes may throw `tooLarge` — let the handler turn that into 413
  // BEFORE doing the HMAC compare so we never spend cycles verifying oversized data.
  const data = canonicalBytes(payload);
  try {
    return await crypto.subtle.verify("HMAC", key, fromBase64Url(sigB64), data);
  } catch {
    return false;
  }
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const url = new URL(req.url);
  const op = url.pathname.endsWith("/verify") ? "verify"
           : url.pathname.endsWith("/sign")   ? "sign"
           : null;
  if (!op) return json({ error: "Use /sign or /verify" }, 400);

  // Cheap pre-check using Content-Length (when present) before reading the stream.
  const declaredLen = Number(req.headers.get("content-length") ?? "0");
  if (Number.isFinite(declaredLen) && declaredLen > MAX_REQUEST_BYTES) {
    return json({
      error: "Request body too large",
      code: "payload_too_large",
      maxBytes: MAX_REQUEST_BYTES,
      receivedBytes: declaredLen,
    }, 413);
  }

  // Read raw text so we can enforce a hard cap even when Content-Length is missing/lying.
  let raw: string;
  try { raw = await req.text(); } catch { return json({ error: "Failed to read body" }, 400); }
  if (raw.length > MAX_REQUEST_BYTES) {
    return json({
      error: "Request body too large",
      code: "payload_too_large",
      maxBytes: MAX_REQUEST_BYTES,
      receivedBytes: raw.length,
    }, 413);
  }
  let body: any;
  try { body = JSON.parse(raw); } catch { return json({ error: "Invalid JSON body" }, 400); }

  if (op === "sign") {
    if (body?.payload === undefined) return json({ error: "payload required" }, 400);
    try {
      const sig = await sign(body.payload);
      return json({ sig });
    } catch (e: any) {
      if (e?.tooLarge) {
        return json({
          error: e.message,
          code: "payload_too_large",
          maxBytes: MAX_PAYLOAD_BYTES,
          receivedBytes: e.size,
        }, 413);
      }
      return json({ error: e?.message ?? String(e) }, 500);
    }
  }

  // verify
  if (body?.payload === undefined || typeof body?.sig !== "string") {
    return json({ ok: false, error: "payload and sig required" }, 400);
  }
  try {
    const ok = await verify(body.payload, body.sig);
    return json({ ok });
  } catch (e: any) {
    if (e?.tooLarge) {
      return json({
        ok: false,
        error: e.message,
        code: "payload_too_large",
        maxBytes: MAX_PAYLOAD_BYTES,
        receivedBytes: e.size,
      }, 413);
    }
    return json({ ok: false, error: e?.message ?? String(e) }, 500);
  }
});