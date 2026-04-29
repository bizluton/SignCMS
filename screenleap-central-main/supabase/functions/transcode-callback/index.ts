/**
 * transcode-callback
 * Called by the self-hosted ffmpeg worker when a transcode job finishes.
 *
 * On success:
 *   1. Downloads the transcoded file from output_url (worker's S3/R2)
 *   2. Overwrites the Supabase Storage object at the original path
 *   3. Updates media_items (url, size_bytes, dimensions, duration, status)
 *
 * On failure:
 *   - Sets transcode_status = 'failed', writes transcode_error
 *
 * Security: HMAC-SHA256 request signature + 5-min timestamp window.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.99.3";

const HMAC_TOLERANCE_MS = 5 * 60 * 1000;
const BUCKET = "media";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-signature, x-timestamp",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

async function verifyHmac(secret: string, timestamp: string, rawBody: string, sig: string): Promise<boolean> {
  const tsNum = Number(timestamp);
  if (!Number.isFinite(tsNum) || Math.abs(Date.now() - tsNum) > HMAC_TOLERANCE_MS) return false;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const expected = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(timestamp + "." + rawBody));
  const expectedHex = Array.from(new Uint8Array(expected)).map((b) => b.toString(16).padStart(2, "0")).join("");
  // Timing-safe compare
  if (expectedHex.length !== sig.length) return false;
  let diff = 0;
  for (let i = 0; i < expectedHex.length; i++) diff |= expectedHex.charCodeAt(i) ^ sig.charCodeAt(i);
  return diff === 0;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  try {
    const hmacSecret = Deno.env.get("TRANSCODE_HMAC_SECRET");
    if (!hmacSecret) {
      console.error("TRANSCODE_HMAC_SECRET not set");
      return json({ error: "server_misconfigured" }, 500);
    }

    const rawBody = await req.text();
    const sig = req.headers.get("x-signature") ?? "";
    const timestamp = req.headers.get("x-timestamp") ?? "";

    if (!(await verifyHmac(hmacSecret, timestamp, rawBody, sig))) {
      return json({ error: "invalid_signature" }, 401);
    }

    let payload: {
      job_id: string;
      status: "done" | "failed" | "progress";
      // done
      output_url?: string;
      duration_seconds?: number;
      size_bytes?: number;
      width?: number;
      height?: number;
      storage_key?: string;
      // failed
      error?: string;
    };
    try {
      payload = JSON.parse(rawBody);
    } catch {
      return json({ error: "invalid_json" }, 400);
    }

    // Progress callbacks are fire-and-forget — acknowledge and skip DB write
    if (payload.status === "progress") return json({ ok: true });

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const mediaId = payload.job_id;

    if (payload.status === "failed") {
      await supabase
        .from("media_items")
        .update({ transcode_status: "failed", transcode_error: payload.error ?? "Unknown error" })
        .eq("id", mediaId);
      return json({ ok: true });
    }

    // status === "done"
    if (!payload.output_url) return json({ error: "missing output_url" }, 400);

    // Fetch current media item to get the storage path
    const { data: item, error: itemError } = await supabase
      .from("media_items")
      .select("id, url, org_id, md5")
      .eq("id", mediaId)
      .maybeSingle();
    if (itemError || !item) return json({ error: "media_not_found" }, 404);

    // Download the transcoded file from worker's S3/R2
    const dlRes = await fetch(payload.output_url);
    if (!dlRes.ok) {
      const txt = await dlRes.text().catch(() => "");
      console.error("Failed to download transcoded file:", dlRes.status, txt.slice(0, 200));
      await supabase
        .from("media_items")
        .update({ transcode_status: "failed", transcode_error: `download_failed_${dlRes.status}` })
        .eq("id", mediaId);
      return json({ error: "download_failed" }, 502);
    }
    const fileBytes = await dlRes.arrayBuffer();

    // Overwrite in Supabase Storage: keep the same path but use .mp4 extension
    const storagePath = `${item.org_id}/${item.md5}.mp4`;
    const { error: uploadError } = await supabase.storage
      .from(BUCKET)
      .upload(storagePath, fileBytes, {
        contentType: "video/mp4",
        cacheControl: "3600",
        upsert: true,
      });

    if (uploadError) {
      console.error("Storage re-upload error:", uploadError);
      await supabase
        .from("media_items")
        .update({ transcode_status: "failed", transcode_error: "storage_upload_failed" })
        .eq("id", mediaId);
      return json({ error: "storage_upload_failed" }, 500);
    }

    const { data: pub } = supabase.storage.from(BUCKET).getPublicUrl(storagePath);
    const newUrl = pub.publicUrl;

    // Update media_items with final transcoded metadata
    await supabase
      .from("media_items")
      .update({
        url: newUrl,
        thumbnail: "",  // video thumbnail regeneration is client-side
        mime_type: "video/mp4",
        size_bytes: payload.size_bytes ?? fileBytes.byteLength,
        width: payload.width ?? null,
        height: payload.height ?? null,
        duration_seconds: payload.duration_seconds ?? null,
        transcode_status: "ready",
        transcode_completed_at: new Date().toISOString(),
        transcode_error: null,
      })
      .eq("id", mediaId);

    return json({ ok: true });
  } catch (err) {
    console.error("transcode-callback error:", err);
    return new Response(JSON.stringify({ error: "Internal error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
