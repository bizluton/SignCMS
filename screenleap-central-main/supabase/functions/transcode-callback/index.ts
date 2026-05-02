/**
 * transcode-callback
 * Handles Mux webhook events for video transcoding.
 *
 * Flow:
 *   video.asset.static_renditions.ready →
 *     1. Download highest-quality MP4 from Mux stream URL
 *     2. Upload to Supabase Storage (same path as original, .mp4 extension)
 *     3. Update media_items (url, size, dimensions, duration, status=ready)
 *     4. DELETE Mux asset to avoid ongoing storage charges
 *
 *   video.asset.errored → transcode_status = 'failed'
 *
 * Security: Mux webhook signature (HMAC-SHA256) verified before any processing.
 * Header format: mux-signature: t=<unix_seconds>,v1=<hex>
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.99.3";

const BUCKET = "media";
const SIG_TOLERANCE_SECS = 300; // 5-minute replay window

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, mux-signature",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

async function verifyMuxSignature(
  secret: string,
  rawBody: string,
  sigHeader: string,
): Promise<boolean> {
  // "t=<timestamp>,v1=<hex>"
  const parts: Record<string, string> = {};
  for (const segment of sigHeader.split(",")) {
    const eq = segment.indexOf("=");
    if (eq > 0) parts[segment.slice(0, eq)] = segment.slice(eq + 1);
  }
  const { t: timestamp, v1: sig } = parts;
  if (!timestamp || !sig) return false;

  const tsNum = Number(timestamp);
  if (!Number.isFinite(tsNum) || Math.abs(Date.now() / 1000 - tsNum) > SIG_TOLERANCE_SECS) {
    return false;
  }

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const expected = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(`${timestamp}.${rawBody}`),
  );
  const expectedHex = Array.from(new Uint8Array(expected))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  if (expectedHex.length !== sig.length) return false;
  let diff = 0;
  for (let i = 0; i < expectedHex.length; i++) {
    diff |= expectedHex.charCodeAt(i) ^ sig.charCodeAt(i);
  }
  return diff === 0;
}

interface MuxStaticFile {
  name: string;  // e.g. "high.mp4"
  ext: string;
  height: number;
  width: number;
  bitrate: number;
  filesize: number;
}

interface MuxPayload {
  type: string;
  data: {
    id: string;
    status?: string;
    passthrough?: string;
    duration?: number;
    playback_ids?: Array<{ id: string; policy: string }>;
    static_renditions?: {
      status: string;
      files?: MuxStaticFile[];
    };
    tracks?: Array<{ type: string; max_width?: number; max_height?: number }>;
    errors?: { type: string; messages: string[] };
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  try {
    const webhookSecret = Deno.env.get("MUX_WEBHOOK_SECRET");
    if (!webhookSecret) {
      console.error("MUX_WEBHOOK_SECRET not set");
      return json({ error: "server_misconfigured" }, 500);
    }

    const rawBody = await req.text();
    const sigHeader = req.headers.get("mux-signature") ?? "";

    if (!(await verifyMuxSignature(webhookSecret, rawBody, sigHeader))) {
      return json({ error: "invalid_signature" }, 401);
    }

    let payload: MuxPayload;
    try {
      payload = JSON.parse(rawBody);
    } catch {
      return json({ error: "invalid_json" }, 400);
    }

    const { type: eventType, data } = payload;

    // Only handle static renditions ready / asset errored; ack everything else
    const isStaticReady =
      eventType === "video.asset.static_renditions.ready" ||
      // video.asset.ready can also carry finished static_renditions for short clips
      (eventType === "video.asset.ready" && data.static_renditions?.status === "ready");

    if (!isStaticReady && eventType !== "video.asset.errored") {
      return json({ ok: true });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const mediaId = data.passthrough;
    const muxAssetId = data.id;

    if (!mediaId) {
      console.error("Mux webhook missing passthrough (media_id), asset:", muxAssetId);
      return json({ ok: true });
    }

    if (eventType === "video.asset.errored") {
      const errMsg = data.errors?.messages?.join("; ") ?? "Mux transcoding error";
      await supabase
        .from("media_items")
        .update({ transcode_status: "failed", transcode_error: errMsg })
        .eq("id", mediaId);
      return json({ ok: true });
    }

    // --- static renditions ready ---

    const playbackId = data.playback_ids?.find((p) => p.policy === "public")?.id;
    const mp4Files = (data.static_renditions?.files ?? [])
      .filter((f) => f.ext === "mp4")
      .sort((a, b) => b.height - a.height); // highest quality first

    if (!playbackId || mp4Files.length === 0) {
      console.error("No public playback ID or MP4 files in payload for asset:", muxAssetId);
      await supabase
        .from("media_items")
        .update({ transcode_status: "failed", transcode_error: "mux_no_mp4_renditions" })
        .eq("id", mediaId);
      return json({ error: "no_renditions" }, 422);
    }

    const bestFile = mp4Files[0];
    const mp4Url = `https://stream.mux.com/${playbackId}/${bestFile.name}`;

    const { data: item, error: itemError } = await supabase
      .from("media_items")
      .select("id, org_id, md5")
      .eq("id", mediaId)
      .maybeSingle();
    if (itemError || !item) return json({ error: "media_not_found" }, 404);

    // Download MP4 from Mux CDN
    const dlRes = await fetch(mp4Url);
    if (!dlRes.ok) {
      console.error("Failed to download from Mux:", dlRes.status, mp4Url);
      await supabase
        .from("media_items")
        .update({
          transcode_status: "failed",
          transcode_error: `mux_download_failed_${dlRes.status}`,
        })
        .eq("id", mediaId);
      return json({ error: "download_failed" }, 502);
    }
    const fileBytes = await dlRes.arrayBuffer();

    // Overwrite in Supabase Storage
    const storagePath = `${item.org_id}/${item.md5}.mp4`;
    const { error: uploadError } = await supabase.storage
      .from(BUCKET)
      .upload(storagePath, fileBytes, {
        contentType: "video/mp4",
        cacheControl: "3600",
        upsert: true,
      });

    if (uploadError) {
      console.error("Storage upload error:", uploadError);
      await supabase
        .from("media_items")
        .update({ transcode_status: "failed", transcode_error: "storage_upload_failed" })
        .eq("id", mediaId);
      return json({ error: "storage_upload_failed" }, 500);
    }

    const { data: pub } = supabase.storage.from(BUCKET).getPublicUrl(storagePath);
    const newUrl = pub.publicUrl;

    const videoTrack = data.tracks?.find((t) => t.type === "video");

    await supabase
      .from("media_items")
      .update({
        url: newUrl,
        thumbnail: "",
        mime_type: "video/mp4",
        size_bytes: bestFile.filesize || fileBytes.byteLength,
        width: videoTrack?.max_width ?? bestFile.width ?? null,
        height: videoTrack?.max_height ?? bestFile.height ?? null,
        duration_seconds: data.duration ?? null,
        transcode_status: "ready",
        transcode_completed_at: new Date().toISOString(),
        transcode_error: null,
      })
      .eq("id", mediaId);

    // Delete the Mux asset now that we have our own copy in Supabase Storage
    const muxTokenId = Deno.env.get("MUX_TOKEN_ID")!;
    const muxTokenSecret = Deno.env.get("MUX_TOKEN_SECRET")!;
    await fetch(`https://api.mux.com/video/v1/assets/${muxAssetId}`, {
      method: "DELETE",
      headers: { "Authorization": `Basic ${btoa(`${muxTokenId}:${muxTokenSecret}`)}` },
    }).catch((e) => console.error("Mux asset delete error:", e));

    return json({ ok: true });
  } catch (err) {
    console.error("transcode-callback error:", err);
    return new Response(JSON.stringify({ error: "Internal error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
