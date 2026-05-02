import SparkMD5 from "spark-md5";

/**
 * Compute MD5 hash of a File using streaming chunks (avoids loading large files into memory at once).
 * Returns lowercase 32-char hex string.
 */
export async function computeFileMd5(
  file: File,
  onProgress?: (ratio: number) => void,
): Promise<string> {
  const CHUNK_SIZE = 4 * 1024 * 1024; // 4 MB chunks
  const spark = new SparkMD5.ArrayBuffer();
  const total = file.size;
  let offset = 0;

  while (offset < total) {
    const end = Math.min(offset + CHUNK_SIZE, total);
    const slice = file.slice(offset, end);
    const buf = await slice.arrayBuffer();
    spark.append(buf);
    offset = end;
    onProgress?.(total === 0 ? 1 : offset / total);
  }

  return spark.end();
}

/**
 * Allowed video container extensions.
 * Per spec: only .mp4 is allowed (no .mov / .mkv / .webm / etc).
 */
export const ALLOWED_VIDEO_EXTS = new Set(["mp4"]);

export function isAcceptableVideo(file: File): boolean {
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  if (!ALLOWED_VIDEO_EXTS.has(ext)) return false;
  // MIME 可能是空字串（某些 OS 會這樣），有則必須是 video/*
  if (file.type && !file.type.startsWith("video/")) return false;
  return true;
}

/**
 * Allowed image extensions per spec: JPG / JPEG / PNG only.
 */
export const ALLOWED_IMAGE_EXTS = new Set(["jpg", "jpeg", "png"]);
const ALLOWED_IMAGE_MIMES = new Set(["image/jpeg", "image/jpg", "image/png"]);

export function isAcceptableImage(file: File): boolean {
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  if (!ALLOWED_IMAGE_EXTS.has(ext)) return false;
  if (file.type && !ALLOWED_IMAGE_MIMES.has(file.type.toLowerCase())) return false;
  return true;
}

/**
 * Allowed audio extensions per spec: MP3 / WAV / OGG / M4A / AAC.
 * Used for background music tracks.
 */
export const ALLOWED_AUDIO_EXTS = new Set(["mp3", "wav", "ogg", "m4a", "aac"]);
const ALLOWED_AUDIO_MIMES = new Set([
  "audio/mpeg", "audio/mp3", "audio/wav", "audio/wave", "audio/x-wav",
  "audio/ogg", "audio/mp4", "audio/x-m4a", "audio/aac", "audio/aacp",
]);

export function isAcceptableAudio(file: File): boolean {
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  if (!ALLOWED_AUDIO_EXTS.has(ext)) return false;
  if (file.type && !ALLOWED_AUDIO_MIMES.has(file.type.toLowerCase()) && !file.type.startsWith("audio/")) return false;
  return true;
}
export const IMAGE_SPEC = {
  maxWidth: 3840,
  maxHeight: 2160,
  maxBytes: 5 * 1024 * 1024, // 5 MB（硬性上限）
} as const;

export type ImageSpecCheck =
  | { ok: true }
  | { ok: false; reason: "resolution" | "tooLarge" | "cmyk"; detail: string };

/**
 * Detect CMYK JPEG by scanning Adobe APP14 marker (transform = 2 → YCCK/CMYK)
 * or SOF marker with 4 components. PNG never supports CMYK so it always passes.
 */
async function isCmykJpeg(file: File): Promise<boolean> {
  const slice = file.slice(0, Math.min(file.size, 256 * 1024));
  const buf = new Uint8Array(await slice.arrayBuffer());
  if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) return false;

  let i = 2;
  while (i + 3 < buf.length) {
    if (buf[i] !== 0xff) { i++; continue; }
    let marker = buf[i + 1];
    while (marker === 0xff && i + 2 < buf.length) { i++; marker = buf[i + 1]; }
    if (marker === 0xd8 || marker === 0xd9) { i += 2; continue; }
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { i += 2; continue; }

    const segLen = (buf[i + 2] << 8) | buf[i + 3];
    if (segLen < 2) break;
    const segStart = i + 2;
    const segEnd = segStart + segLen;
    if (segEnd > buf.length) break;

    // APP14 (Adobe): identifier "Adobe" + transform byte at offset 11
    if (marker === 0xee && segLen >= 12) {
      const id = String.fromCharCode(
        buf[segStart + 2], buf[segStart + 3], buf[segStart + 4], buf[segStart + 5], buf[segStart + 6],
      );
      if (id === "Adobe") {
        const transform = buf[segStart + 11];
        if (transform === 2) return true; // YCCK / CMYK
      }
    }

    // SOF markers — components count at segStart + 5
    if ((marker >= 0xc0 && marker <= 0xcf) && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      const components = buf[segStart + 5];
      return components === 4;
    }

    i = segEnd;
  }
  return false;
}

/**
 * Validate an image File against project spec (resolution / size / color).
 */
export async function validateImageSpec(
  file: File,
  meta: { width: number; height: number },
): Promise<ImageSpecCheck> {
  const { maxWidth, maxHeight, maxBytes } = IMAGE_SPEC;

  if (file.size > maxBytes) {
    const mb = (file.size / (1024 * 1024)).toFixed(1);
    return { ok: false, reason: "tooLarge", detail: `${mb} MB > 5 MB` };
  }

  if (meta.width > 0 && meta.height > 0) {
    if (meta.width > maxWidth || meta.height > maxHeight) {
      return {
        ok: false,
        reason: "resolution",
        detail: `${meta.width}×${meta.height} > ${maxWidth}×${maxHeight}`,
      };
    }
  }

  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  if (ext === "jpg" || ext === "jpeg") {
    const cmyk = await isCmykJpeg(file).catch(() => false);
    if (cmyk) return { ok: false, reason: "cmyk", detail: "CMYK / YCCK" };
  }

  return { ok: true };
}

/**
 * Convert any browser-decodable image to WebP at the given quality.
 * Falls back to JPEG if the browser does not support WebP encoding.
 * Does NOT resize — use tryNormalizeImage for oversized images.
 * Returns null if the image cannot be decoded.
 */
export async function convertToWebP(file: File, quality = 0.85): Promise<File | null> {
  const url = URL.createObjectURL(file);
  const img = new Image();
  img.decoding = "async";
  const loaded = await new Promise<boolean>((resolve) => {
    img.onload = () => resolve(true);
    img.onerror = () => resolve(false);
    img.src = url;
  });
  if (!loaded || !img.naturalWidth || !img.naturalHeight) {
    URL.revokeObjectURL(url);
    return null;
  }

  const canvas = document.createElement("canvas");
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  const ctx = canvas.getContext("2d");
  if (!ctx) { URL.revokeObjectURL(url); return null; }
  ctx.drawImage(img, 0, 0);
  URL.revokeObjectURL(url);

  const baseName = file.name.replace(/\.[^.]+$/, "");

  // Try WebP first; fall back to JPEG if browser returns empty blob.
  const webpBlob = await new Promise<Blob | null>((res) =>
    canvas.toBlob((b) => res(b), "image/webp", quality)
  );
  if (webpBlob && webpBlob.size > 0 && webpBlob.type === "image/webp") {
    return new File([webpBlob], `${baseName}.webp`, { type: "image/webp" });
  }

  // JPEG fallback (white background for images with alpha).
  const ctx2 = canvas.getContext("2d")!;
  ctx2.globalCompositeOperation = "destination-over";
  ctx2.fillStyle = "#ffffff";
  ctx2.fillRect(0, 0, canvas.width, canvas.height);
  const jpegBlob = await new Promise<Blob | null>((res) =>
    canvas.toBlob((b) => res(b), "image/jpeg", quality)
  );
  if (!jpegBlob) return null;
  return new File([jpegBlob], `${baseName}.jpg`, { type: "image/jpeg" });
}

/**
 * Try to auto-normalize an image: re-encode as WebP via canvas (browser converts
 * color space automatically when drawing), downscale to fit ≤ 3840×2160, and binary-search
 * the quality so the output is ≤ 5 MB.
 *
 * Returns the normalized File on success, or null if the source image cannot be decoded
 * (e.g. exotic CMYK that the browser can't open) or no quality satisfies the size budget.
 */
export async function tryNormalizeImage(file: File): Promise<File | null> {
  const { maxWidth, maxHeight, maxBytes } = IMAGE_SPEC;

  const url = URL.createObjectURL(file);
  const img = new Image();
  img.decoding = "async";
  const loaded = await new Promise<boolean>((resolve) => {
    img.onload = () => resolve(true);
    img.onerror = () => resolve(false);
    img.src = url;
  });
  if (!loaded || !img.naturalWidth || !img.naturalHeight) {
    URL.revokeObjectURL(url);
    return null;
  }

  // Fit within max resolution, preserve aspect.
  let w = img.naturalWidth;
  let h = img.naturalHeight;
  const scale = Math.min(1, maxWidth / w, maxHeight / h);
  w = Math.max(1, Math.round(w * scale));
  h = Math.max(1, Math.round(h * scale));

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    URL.revokeObjectURL(url);
    return null;
  }
  ctx.drawImage(img, 0, 0, w, h);
  URL.revokeObjectURL(url);

  // Detect WebP encoding support once.
  const supportsWebP = await new Promise<boolean>((res) =>
    canvas.toBlob((b) => res(!!(b && b.size > 0 && b.type === "image/webp")), "image/webp", 0.8)
  );
  const mime = supportsWebP ? "image/webp" : "image/jpeg";

  // For JPEG fallback: fill white background (no alpha support).
  if (!supportsWebP) {
    ctx.globalCompositeOperation = "destination-over";
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, w, h);
  }

  const toBlob = (q: number): Promise<Blob | null> =>
    new Promise((res) => canvas.toBlob((b) => res(b), mime, q));

  // Binary search quality 0.5–0.95 for largest blob that fits maxBytes.
  let lo = 0.5;
  let hi = 0.95;
  let best: Blob | null = null;
  for (let i = 0; i < 7; i++) {
    const mid = (lo + hi) / 2;
    const blob = await toBlob(mid);
    if (!blob) return null;
    if (blob.size <= maxBytes) {
      best = blob;
      lo = mid;
    } else {
      hi = mid;
    }
  }

  // 兜底：若中段都超標，試最低品質
  if (!best) {
    const fallback = await toBlob(0.5);
    if (fallback && fallback.size <= maxBytes) best = fallback;
  }
  if (!best) return null;

  const baseName = file.name.replace(/\.[^.]+$/, "");
  const ext = supportsWebP ? "webp" : "jpg";
  return new File([best], `${baseName}.${ext}`, {
    type: mime,
    lastModified: Date.now(),
  });
}

/** Video spec limits per project policy (see Media Library memory). */
export const VIDEO_SPEC = {
  maxWidth: 3840,
  maxHeight: 2160,
  maxBitrateBps: 20 * 1000 * 1000, // 20 Mbps
  maxFps: 65, // 規範為 30/60，估算誤差容忍到 65
} as const;

export type VideoSpecCheck =
  | { ok: true }
  | { ok: false; reason: "resolution" | "bitrate" | "fps"; detail: string };

/**
 * Estimate FPS by sampling frames over ~600ms via requestVideoFrameCallback.
 * Returns null when the API is unavailable or sampling fails.
 */
async function estimateFps(file: File): Promise<number | null> {
  const anyVid = document.createElement("video") as HTMLVideoElement & {
    requestVideoFrameCallback?: (cb: (now: number, meta: { mediaTime: number; presentedFrames: number }) => void) => number;
  };
  if (typeof anyVid.requestVideoFrameCallback !== "function") return null;

  return new Promise<number | null>((resolve) => {
    const url = URL.createObjectURL(file);
    const v = anyVid;
    v.muted = true;
    (v as HTMLVideoElement & { playsInline: boolean }).playsInline = true;
    v.preload = "auto";
    v.src = url;

    let startTime = 0;
    let startFrames = 0;
    let lastTime = 0;
    let lastFrames = 0;
    let done = false;

    const cleanup = (val: number | null) => {
      if (done) return;
      done = true;
      try { v.pause(); } catch { /* ignore */ }
      URL.revokeObjectURL(url);
      resolve(val);
    };

    const timer = setTimeout(() => cleanup(null), 3000);

    const onFrame = (_now: number, meta: { mediaTime: number; presentedFrames: number }) => {
      if (done) return;
      if (startFrames === 0) {
        startTime = meta.mediaTime;
        startFrames = meta.presentedFrames;
      }
      lastTime = meta.mediaTime;
      lastFrames = meta.presentedFrames;
      const dt = lastTime - startTime;
      if (dt >= 0.6 && lastFrames - startFrames >= 5) {
        clearTimeout(timer);
        const fps = (lastFrames - startFrames) / dt;
        cleanup(Number.isFinite(fps) && fps > 0 ? fps : null);
        return;
      }
      anyVid.requestVideoFrameCallback!(onFrame);
    };

    v.onloadeddata = () => {
      v.play().catch(() => cleanup(null));
      anyVid.requestVideoFrameCallback!(onFrame);
    };
    v.onerror = () => cleanup(null);
  });
}

/**
 * Validate a video File against project spec.
 * Bitrate uses size/duration; FPS uses requestVideoFrameCallback sampling (best-effort).
 */
export async function validateVideoSpec(
  file: File,
  meta: { width: number; height: number; durationSec: number },
): Promise<VideoSpecCheck> {
  const { maxWidth, maxHeight, maxBitrateBps, maxFps } = VIDEO_SPEC;

  if (meta.width > 0 && meta.height > 0) {
    if (meta.width > maxWidth || meta.height > maxHeight) {
      return {
        ok: false,
        reason: "resolution",
        detail: `${meta.width}×${meta.height} > ${maxWidth}×${maxHeight}`,
      };
    }
  }

  if (meta.durationSec > 0) {
    const bps = (file.size * 8) / meta.durationSec;
    if (bps > maxBitrateBps) {
      const mbps = (bps / 1_000_000).toFixed(1);
      return { ok: false, reason: "bitrate", detail: `${mbps} Mbps > 20 Mbps` };
    }
  }

  const fps = await estimateFps(file);
  if (fps != null && fps > maxFps) {
    return { ok: false, reason: "fps", detail: `${fps.toFixed(1)} fps > ${maxFps}` };
  }

  return { ok: true };
}
