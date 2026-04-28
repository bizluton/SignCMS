import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

export interface MediaHoverPreviewData {
  kind: "media" | "widget";
  type?: "video" | "image" | string;
  name: string;
  url?: string;
  thumbnail?: string;
  // Canonical numeric fields (Phase 3: legacy text fields removed)
  durationSeconds?: number | null;
  width?: number | null;
  height?: number | null;
  sizeBytes?: number | null;
  mimeType?: string | null;
  codec?: string | null;
  container?: string | null;
  /** Anchor rect (the thumbnail) in viewport coords */
  anchor: DOMRect;
}

function formatDuration(secs: number | null | undefined): string {
  if (typeof secs !== "number" || !Number.isFinite(secs) || secs <= 0) return "";
  const total = Math.round(secs);
  const m = Math.floor(total / 60);
  const s = total % 60;
  if (total < 60) return `${total}s`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function formatSize(bytes: number | null | undefined): string {
  if (typeof bytes !== "number" || bytes <= 0) return "";
  return bytes >= 1048576
    ? `${(bytes / 1048576).toFixed(1)}MB`
    : bytes >= 1024
      ? `${Math.round(bytes / 1024)}KB`
      : `${bytes}B`;
}

/** Derive container/encoding label from container, mime, codec hints. */
function formatEncoding(
  container: string | null | undefined,
  mime: string | null | undefined,
  codec: string | null | undefined,
): string {
  const parts: string[] = [];
  let cont = (container && String(container).trim()) || "";
  if (!cont && mime) {
    const m = String(mime).trim().toLowerCase();
    // e.g. "video/mp4" → "MP4", "image/jpeg" → "JPEG"
    const after = m.split("/")[1] || "";
    if (after) cont = after.split(";")[0].toUpperCase();
  }
  if (cont) parts.push(cont.toUpperCase());
  const c = (codec && String(codec).trim()) || "";
  if (c) parts.push(c.toUpperCase());
  return parts.join(" · ");
}

interface Props {
  data: MediaHoverPreviewData | null;
}

const PREVIEW_W = 360;
const PREVIEW_H = 290;
const FOOTER_H = 70;
const GAP = 8;

/**
 * Floating preview card that follows the hovered media thumbnail.
 * Videos auto-play (muted, loop); images render at large size.
 */
export function MediaHoverPreview({ data }: Props) {
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const ref = useRef<HTMLDivElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [videoError, setVideoError] = useState<string | null>(null);
  const [imageError, setImageError] = useState<boolean>(false);

  // Reset error state whenever the previewed media changes
  useEffect(() => {
    setVideoError(null);
    setImageError(false);
  }, [data?.url, data?.type]);

  useLayoutEffect(() => {
    if (!data) { setPos(null); return; }
    const { anchor } = data;
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    let left = anchor.right + GAP;
    if (left + PREVIEW_W > vw - 8) left = anchor.left - PREVIEW_W - GAP;
    if (left < 8) left = Math.max(8, vw - PREVIEW_W - 8);

    let top = anchor.top + anchor.height / 2 - PREVIEW_H / 2;
    if (top < 8) top = 8;
    if (top + PREVIEW_H > vh - 8) top = vh - PREVIEW_H - 8;

    setPos({ left, top });
  }, [data]);

  useEffect(() => {
    if (!data) return;
    const onScroll = () => setPos(null);
    window.addEventListener("scroll", onScroll, true);
    return () => window.removeEventListener("scroll", onScroll, true);
  }, [data]);

  // Force-play video whenever a new video preview is shown.
  // AbortError is expected when the user hovers/unhovers quickly — ignore it.
  const safePlay = (el: HTMLVideoElement) => {
    try {
      el.muted = true;
      el.defaultMuted = true;
      const p = el.play();
      if (p && typeof p.catch === "function") {
        p.catch((err) => {
          if (err?.name === "AbortError") return;
          // eslint-disable-next-line no-console
          console.warn("[MediaHoverPreview] play failed:", err?.name, err?.message);
        });
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn("[MediaHoverPreview] play threw:", err);
    }
  };

  const attachVideo = (el: HTMLVideoElement | null) => {
    videoRef.current = el;
    if (!el) return;
    el.muted = true;
    el.defaultMuted = true;
    el.setAttribute("muted", "");
    safePlay(el);
  };

  // Retry loop: if the video stays paused after mount, keep nudging play().
  // Some browsers reject early play() calls before metadata is ready.
  useEffect(() => {
    if (!data || data.type !== "video" || !data.url || !pos) return;
    let cancelled = false;
    let attempts = 0;
    const interval = window.setInterval(() => {
      const el = videoRef.current;
      if (cancelled || !el) return;
      attempts += 1;
      if (!el.paused || attempts > 6) {
        window.clearInterval(interval);
        return;
      }
      el.muted = true;
      safePlay(el);
    }, 250);
    return () => { cancelled = true; window.clearInterval(interval); };
  }, [data?.url, data?.type, pos]);

  /** Map HTMLMediaElement error codes to a human-friendly Chinese reason. */
  const describeVideoError = (el: HTMLVideoElement): string => {
    const err = el.error;
    if (!err) return "影片無法載入";
    switch (err.code) {
      case 1: return "影片載入已中止";              // MEDIA_ERR_ABORTED
      case 2: return "網路錯誤，無法下載影片";        // MEDIA_ERR_NETWORK
      case 3: return "影片解碼失敗（格式或編碼不支援）"; // MEDIA_ERR_DECODE
      case 4: return "此影片格式或編碼瀏覽器不支援";    // MEDIA_ERR_SRC_NOT_SUPPORTED
      default: return "影片無法播放";
    }
  };

  if (!data || !pos) return null;

  const isVideo = data.kind === "media" && data.type === "video" && !!data.url;
  const isImage = data.kind === "media" && data.type !== "video";
  const imgSrc = data.url || data.thumbnail;

  // Type label (Chinese)
  const typeLabel =
    data.kind === "widget" ? "小工具" :
    data.type === "video" ? "影片" :
    data.type === "image" ? "圖片" : "媒體";
  const typeColor =
    data.kind === "widget" ? "bg-muted-foreground/80 text-background" :
    data.type === "video" ? "bg-destructive/85 text-destructive-foreground" :
    "bg-blue-500/85 text-white";

  const encoding = formatEncoding(data.container, data.mimeType, data.codec);

  const metas: string[] = [];
  if (data.type === "video") {
    const dur = formatDuration(data.durationSeconds);
    if (dur) metas.push(dur);
  }
  const dimStr = (data.width && data.height) ? `${data.width}×${data.height}` : "";
  if (dimStr) metas.push(dimStr);
  const sz = formatSize(data.sizeBytes);
  if (sz) metas.push(sz);
  if (encoding) metas.push(encoding);

  return createPortal(
    <div
      ref={ref}
      className="pointer-events-none fixed z-[100] rounded-lg border border-border bg-popover text-popover-foreground shadow-2xl overflow-hidden animate-in fade-in-0 zoom-in-95"
      style={{ left: pos.left, top: pos.top, width: PREVIEW_W, height: PREVIEW_H }}
      role="tooltip"
    >
      <div className="relative w-full bg-black" style={{ height: PREVIEW_H - FOOTER_H }}>
        {isVideo ? (
          <video
            key={data.url}
            ref={attachVideo}
            src={data.url}
            autoPlay
            muted
            loop
            playsInline
            preload="auto"
            poster={data.thumbnail || undefined}
            onCanPlay={(e) => { const v = e.currentTarget; v.muted = true; safePlay(v); }}
            onLoadedData={(e) => { const v = e.currentTarget; v.muted = true; safePlay(v); }}
            onLoadedMetadata={(e) => { const v = e.currentTarget; v.muted = true; safePlay(v); }}
            onPlaying={() => { /* eslint-disable-next-line no-console */ console.debug("[MediaHoverPreview] playing", data.url); }}
            onPause={() => { /* eslint-disable-next-line no-console */ console.debug("[MediaHoverPreview] paused", data.url); }}
            onError={(e) => {
              const reason = describeVideoError(e.currentTarget);
              // eslint-disable-next-line no-console
              console.warn("[MediaHoverPreview] video error:", reason, data.url);
              setVideoError(reason);
            }}
            className="w-full h-full object-contain"
          />
        ) : isImage && imgSrc ? (
          <img
            src={imgSrc}
            alt={data.name}
            onError={() => setImageError(true)}
            className="w-full h-full object-contain"
          />
        ) : (
          <div className="flex items-center justify-center w-full h-full text-xs text-muted-foreground">
            {data.name}
          </div>
        )}

        {/* Error overlay */}
        {(videoError || (isImage && imageError)) && (
          <div
            className="absolute inset-0 flex flex-col items-center justify-center gap-1.5 bg-background/90 text-center px-3"
            lang="zh-Hant"
            style={{ fontFamily: "'PingFang TC','Microsoft JhengHei','Noto Sans TC',sans-serif" }}
          >
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-destructive/15 text-destructive">
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M12 9v4" />
                <path d="M12 17h.01" />
                <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z" />
              </svg>
            </div>
            <div className="text-[12px] font-semibold text-foreground">
              {videoError ? "影片無法預覽" : "圖片無法預覽"}
            </div>
            <div className="text-[10px] text-muted-foreground leading-snug">
              {videoError || "圖片載入失敗或來源不可用"}
            </div>
          </div>
        )}

        <span className={`absolute top-1.5 left-1.5 ${typeColor} text-[9px] font-bold px-1.5 py-0.5 rounded leading-none shadow`}>
          {typeLabel}
        </span>
      </div>
      <div
        className="bg-popover border-t border-border px-2 py-1.5"
        lang="zh-Hant"
        style={{ fontFamily: "'PingFang TC','Microsoft JhengHei','Noto Sans TC',sans-serif", height: FOOTER_H }}
      >
        <div className="text-[11px] font-medium text-foreground truncate leading-tight">{data.name}</div>
        {metas.length > 0 && (
          <div className="mt-1 flex flex-wrap items-center gap-1">
            {metas.map((m, i) => (
              <span
                key={i}
                className="text-[9px] text-muted-foreground tabular-nums px-1.5 py-0.5 rounded bg-muted/60 border border-border/50 leading-none whitespace-nowrap"
              >
                {m}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
