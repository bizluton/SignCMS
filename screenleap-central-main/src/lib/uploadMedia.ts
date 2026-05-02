import { supabase } from "@/integrations/supabase/client";
import {
  computeFileMd5,
  isAcceptableImage,
  isAcceptableVideo,
  validateImageSpec,
  tryNormalizeImage,
  convertToWebP,
} from "@/lib/fileHash";
import { probeVideoMeta } from "@/lib/videoTranscode";

const MAX_FILE_SIZE = 50 * 1024 * 1024;

export type UploadMediaErrorCode =
  | "unsupported"
  | "file_too_large"
  | "storage_full"
  | "no_org"
  | "image_resolution"
  | "image_too_large"
  | "image_cmyk"
  | "image_auto_convert_failed"
  | "video_resolution"
  | "duplicate_file"
  | "media_capacity_exceeded"
  | "network"
  | "unknown";

export interface UploadMediaResult {
  ok: boolean;
  data?: { id: string; original_name: string; type: "image" | "video"; transcodeStatus?: string };
  errorCode?: UploadMediaErrorCode;
  errorDetail?: string;
  /** Original filename of the duplicate (when errorCode === 'duplicate_file'). */
  duplicateName?: string;
}

export interface UploadMediaOptions {
  /** Required: org to upload to. */
  orgId: string;
  /** Optional: cap remaining storage (bytes). When provided and would exceed, returns 'storage_full'. */
  remainingBytes?: number;
  /** Optional: human-friendly display name (saved as original_name). Defaults to file.name. */
  displayName?: string;
}

/**
 * Shared media upload pipeline used by /media and the studio media picker.
 * Performs full client-side spec validation, MD5 dedup, and edge function upload.
 * Returns a structured result; the caller decides which toast/i18n to render.
 */
export async function uploadMediaFile(
  file: File,
  options: UploadMediaOptions,
): Promise<UploadMediaResult> {
  const isImage = isAcceptableImage(file);
  const isVideo = !isImage && isAcceptableVideo(file);
  if (!isImage && !isVideo) return { ok: false, errorCode: "unsupported" };

  if (!options.orgId) return { ok: false, errorCode: "no_org" };

  if (
    typeof options.remainingBytes === "number" &&
    options.remainingBytes >= 0 &&
    file.size > options.remainingBytes
  ) {
    return { ok: false, errorCode: "storage_full" };
  }

  if (file.size > MAX_FILE_SIZE) return { ok: false, errorCode: "file_too_large" };

  let workingFile: File = file;
  let width = 0;
  let height = 0;
  let durationSec = 0;
  let needsTranscode = false;
  let sourceFps = 0;
  let sourceBitrate = 0;
  let sourceCodec = "";
  let sourceContainer = "";

  if (isImage) {
    const probeImage = (f: File) =>
      new Promise<{ w: number; h: number }>((resolve) => {
        const objectUrl = URL.createObjectURL(f);
        const img = new Image();
        img.onload = () => { resolve({ w: img.width, h: img.height }); URL.revokeObjectURL(objectUrl); };
        img.onerror = () => { resolve({ w: 0, h: 0 }); URL.revokeObjectURL(objectUrl); };
        img.src = objectUrl;
      });

    let imgMeta = await probeImage(workingFile);
    width = imgMeta.w;
    height = imgMeta.h;
    let spec = await validateImageSpec(workingFile, { width: imgMeta.w, height: imgMeta.h });

    if (spec.ok === false && (spec.reason === "tooLarge" || spec.reason === "resolution" || spec.reason === "cmyk")) {
      const normalized = await tryNormalizeImage(workingFile);
      if (normalized) {
        workingFile = normalized;
        imgMeta = await probeImage(workingFile);
        width = imgMeta.w;
        height = imgMeta.h;
        spec = await validateImageSpec(workingFile, { width: imgMeta.w, height: imgMeta.h });
      } else {
        return { ok: false, errorCode: "image_auto_convert_failed" };
      }
    }

    if (spec.ok === false) {
      const code: UploadMediaErrorCode =
        spec.reason === "resolution" ? "image_resolution"
        : spec.reason === "tooLarge" ? "image_too_large"
        : "image_cmyk";
      return { ok: false, errorCode: code, errorDetail: spec.detail };
    }
    // Convert to WebP for better compression (skip if already WebP or normalization already ran).
    if (workingFile.type !== "image/webp") {
      const webpFile = await convertToWebP(workingFile);
      if (webpFile) workingFile = webpFile;
    }
  }

  if (isVideo) {
    // Get duration (and fallback dimensions) from the HTML video element.
    const objectUrl = URL.createObjectURL(workingFile);
    const htmlMeta = await new Promise<{ width: number; height: number; durationSec: number }>((resolve) => {
      const video = document.createElement("video");
      video.preload = "metadata";
      video.muted = true;
      const timer = setTimeout(() => {
        resolve({ width: 0, height: 0, durationSec: 0 });
        URL.revokeObjectURL(objectUrl);
      }, 5000);
      video.onloadedmetadata = () => {
        clearTimeout(timer);
        const raw = video.duration;
        const valid = Number.isFinite(raw) && raw > 0;
        resolve({
          width: video.videoWidth || 0,
          height: video.videoHeight || 0,
          durationSec: valid ? raw : 0,
        });
        URL.revokeObjectURL(objectUrl);
      };
      video.onerror = () => {
        clearTimeout(timer);
        resolve({ width: 0, height: 0, durationSec: 0 });
        URL.revokeObjectURL(objectUrl);
      };
      video.src = objectUrl;
    });

    durationSec = htmlMeta.durationSec;

    // Deep probe via MediaInfo.js WASM to detect codec, fps, bitrate.
    const probeMeta = await probeVideoMeta(workingFile);

    // Prefer WASM dimensions; fall back to HTML element values.
    width = probeMeta.width > 0 ? probeMeta.width : htmlMeta.width;
    height = probeMeta.height > 0 ? probeMeta.height : htmlMeta.height;

    // Resolution > 4K is a hard rejection — Mux capped-1080p would silently downscale.
    if (width > 3840 || height > 2160) {
      return {
        ok: false,
        errorCode: "video_resolution",
        errorDetail: `${width}×${height} > 3840×2160`,
      };
    }

    // High bitrate / fps / non-h264 codec → route through Mux transcoding instead of blocking.
    needsTranscode = probeMeta.needsTranscode;
    sourceFps = probeMeta.fps;
    sourceBitrate = probeMeta.bitrate;
    sourceCodec = probeMeta.codec;
    sourceContainer = probeMeta.container;
  }

  // MD5 dedup pre-check (within org, exclude soft-deleted records)
  const md5 = await computeFileMd5(workingFile);
  const dup = await supabase
    .from("media_items")
    .select("id, original_name")
    .eq("org_id", options.orgId)
    .eq("md5", md5)
    .eq("size_bytes", workingFile.size)
    .is("deleted_at", null)
    .limit(1)
    .maybeSingle();
  if (dup?.data) {
    return {
      ok: false,
      errorCode: "duplicate_file",
      duplicateName: dup.data.original_name || file.name,
    };
  }

  const formData = new FormData();
  formData.append("file", workingFile);
  formData.append("name", workingFile.name);
  formData.append("original_name", options.displayName?.trim() || file.name);
  formData.append("md5", md5);
  formData.append("type", isImage ? "image" : "video");
  if (width > 0) formData.append("width", String(width));
  if (height > 0) formData.append("height", String(height));
  if (durationSec > 0) formData.append("duration_seconds", String(durationSec));
  formData.append("org_id", options.orgId);
  if (isVideo) {
    if (needsTranscode) formData.append("needs_transcode", "true");
    if (sourceFps > 0) formData.append("source_fps", String(sourceFps));
    if (sourceBitrate > 0) formData.append("source_bitrate", String(sourceBitrate));
    if (sourceCodec) formData.append("source_codec", sourceCodec);
    if (sourceContainer) formData.append("source_container", sourceContainer);
  }

  const session = await supabase.auth.getSession();
  const accessToken = session.data.session?.access_token;

  try {
    const res = await fetch(
      `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/upload-media`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}` },
        body: formData,
      },
    );
    const result = await res.json();
    if (!res.ok || result.error) {
      if (result.error === "media_capacity_exceeded") return { ok: false, errorCode: "media_capacity_exceeded" };
      if (result.error === "duplicate_file") {
        return { ok: false, errorCode: "duplicate_file", duplicateName: result.original_name || file.name };
      }
      return { ok: false, errorCode: "unknown", errorDetail: result.error };
    }
    return {
      ok: true,
      data: {
        id: result.id,
        original_name: options.displayName?.trim() || file.name,
        type: isImage ? "image" : "video",
        transcodeStatus: result.transcode_status as string | undefined,
      },
    };
  } catch (err) {
    return { ok: false, errorCode: "network", errorDetail: err instanceof Error ? err.message : String(err) };
  }
}
