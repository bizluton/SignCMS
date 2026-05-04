import { useEffect, useMemo, useRef, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import Hls from "hls.js";
import QueueDisplayWidget from "@/components/widgets/QueueDisplayWidget";

/**
 * DesignStage — faithful renderer for a `design_project` saved by Content Studio.
 *
 * Reads the project's `zones` JSONB (which mixes `_meta`, regular zone entries,
 * and `_overlay` entries) and reproduces the multi-zone layout used in the
 * editor. All assets are resolved via a `resolveMediaUrl` callback so the
 * Local Player can swap real DB URLs for offline blob URLs out of the bundle.
 *
 * Zones are absolutely positioned in % of the canvas; overlays are positioned
 * in px relative to the canvas resolution. The whole canvas scales to fit
 * its container while preserving aspect ratio.
 */

interface WidgetConfig {
  widgetType?: string;
  bgColor?: string;
  textColor?: string;
  timezone?: string;
  format?: string;
  showDate?: boolean;
  text?: string;
  qrcodeContent?: string;
  qrcodeSize?: number;
  targetDate?: string;
  countdownTitle?: string;
  url?: string;
  youtubeId?: string;
  youtubeUrl?: string;
  youtubeMuted?: boolean;
  youtubeMuteBgm?: boolean;
  youtubeVolume?: number;
  streamUrl?: string;
  streamMuted?: boolean;
  streamFit?: string;
  paramsSchema?: Array<{ key: string; [k: string]: unknown }>;
  params?: Record<string, unknown>;
  [key: string]: unknown;
}

function _parseYoutubeId(url: string): string | null {
  if (!url) return null;
  for (const p of [/(?:v=|\/embed\/|\.be\/)([A-Za-z0-9_-]{11})/, /^([A-Za-z0-9_-]{11})$/]) {
    const m = url.match(p);
    if (m) return m[1];
  }
  return null;
}

/** YouTube widget — cover mode + end-screen prevention via postMessage seek-back */
function YoutubeWidgetRender({ videoId, muted = true, volume = 100 }: { videoId: string; muted?: boolean; volume?: number }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [dims, setDims] = useState({ w: 0, h: 0 });

  useEffect(() => {
    const obs = new ResizeObserver(entries => {
      const r = entries[0].contentRect;
      setDims({ w: Math.round(r.width), h: Math.round(r.height) });
    });
    if (containerRef.current) obs.observe(containerRef.current);
    return () => obs.disconnect();
  }, []);

  // End-screen prevention + initial volume set on first PLAYING
  useEffect(() => {
    let volumeApplied = false;
    const sendCmd = (func: string, args: unknown[]) =>
      iframeRef.current?.contentWindow?.postMessage(JSON.stringify({ event: 'command', func, args }), '*');
    const handleMsg = (e: MessageEvent) => {
      if (!['https://www.youtube.com', 'https://www.youtube-nocookie.com'].includes(e.origin)) return;
      try {
        const d = typeof e.data === 'string' ? JSON.parse(e.data) : e.data;
        if (d.event === 'infoDelivery' && d.info) {
          if (d.info.duration > 30 && d.info.currentTime > d.info.duration - 22)
            sendCmd('seekTo', [0, true]);
          if (!muted && !volumeApplied && d.info.playerState === 1) {
            volumeApplied = true;
            sendCmd('setVolume', [volume]);
          }
        }
      } catch {}
    };
    window.addEventListener('message', handleMsg);
    return () => window.removeEventListener('message', handleMsg);
  }, [videoId, muted, volume]);

  const muteParam = muted ? 1 : 0;
  const src = `https://www.youtube-nocookie.com/embed/${videoId}?autoplay=1&mute=${muteParam}&loop=1&playlist=${videoId}&controls=0&rel=0&iv_load_policy=3&disablekb=1&enablejsapi=1`;
  const base = { border: 0 as const, pointerEvents: 'none' as const, transform: 'scale(1.22)', transformOrigin: 'center center' };
  let style: Record<string, unknown> = { ...base, position: 'absolute', inset: 0, width: '100%', height: '100%' };
  if (dims.w > 0 && dims.h > 0) {
    const za = dims.w / dims.h, va = 16 / 9;
    if (za > va) {
      const ih = Math.ceil(dims.w / va);
      style = { ...base, position: 'absolute', width: `${dims.w}px`, height: `${ih}px`, top: `${Math.floor((dims.h - ih) / 2)}px`, left: 0 };
    } else {
      const iw = Math.ceil(dims.h * va);
      style = { ...base, position: 'absolute', height: `${dims.h}px`, width: `${iw}px`, left: `${Math.floor((dims.w - iw) / 2)}px`, top: 0 };
    }
  }
  return (
    <div ref={containerRef} style={{ width: '100%', height: '100%', position: 'relative', overflow: 'hidden' }}>
      {dims.w > 0 && <iframe ref={iframeRef} src={src} style={style as React.CSSProperties} allow="autoplay; encrypted-media" />}
    </div>
  );
}

/** HLS / stream widget */
function StreamWidgetRender({ url, muted = true, fitMode = "cover" }: { url: string; muted?: boolean; fitMode?: string }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [streamError, setStreamError] = useState<string | null>(null);
  const isHls = !!url && !/^rtmp[se]?:\/\//i.test(url) && !/^rtsps?:\/\//i.test(url);

  useEffect(() => {
    setStreamError(null);
    if (!isHls) return;
    const video = videoRef.current;
    if (!video) return;
    let hls: Hls | null = null;
    if (Hls.isSupported()) {
      hls = new Hls({ enableWorker: false, lowLatencyMode: true, maxBufferLength: 30 });
      hls.loadSource(url);
      hls.attachMedia(video);
      hls.on(Hls.Events.MANIFEST_PARSED, () => { video.play().catch(() => {}); });
      hls.on(Hls.Events.ERROR, (_e, data) => {
        if (data.fatal) {
          if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
            hls?.startLoad();
          } else {
            setStreamError('stream error');
          }
        }
      });
    } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = url;
      video.play().catch(() => {});
    }
    return () => { hls?.destroy(); };
  }, [url, isHls]);

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%', background: '#000' }}>
      <video ref={videoRef} muted={muted} playsInline autoPlay
        style={{ width: '100%', height: '100%', objectFit: fitMode === 'contain' ? 'contain' : 'cover', display: 'block' }} />
      {streamError && (
        <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.7)' }}>
          <span style={{ color: '#f87171', fontSize: 12 }}>串流連線失敗</span>
        </div>
      )}
    </div>
  );
}

interface MediaItem {
  id: string;
  type: "image" | "video" | "widget";
  url?: string;
  name?: string;
  duration?: number;
  widgetConfig?: WidgetConfig;
  muted?: boolean;
  volume?: number;
}

interface ZoneContent {
  type: "text" | "media" | "color" | "widget";
  value?: string;
  bgColor?: string;
  fontSize?: number;
  textColor?: string;
  textAlign?: "left" | "center" | "right";
  mediaItems?: MediaItem[];
  carouselInterval?: number;
  carouselTransition?: "fade" | "slide" | "zoom" | "none";
  widgetId?: string;
  widgetName?: string;
  widgetConfig?: WidgetConfig;
  fitMode?: "cover-x" | "cover-y" | "contain" | "stretch";
}

interface Zone {
  id: string;
  x: number; y: number; w: number; h: number;
  label?: string;
  content?: ZoneContent;
}

interface OverlayBlock {
  id: string;
  x: number; y: number; w: number; h: number;
  opacity?: number;
  zIndex?: number;
  content?: ZoneContent;
}

export interface DesignProjectShape {
  id: string;
  name?: string;
  aspect?: string;
  zones?: unknown[]; // raw mixed array straight from DB
}

export interface DesignStageProps {
  project: DesignProjectShape;
  /** Resolve a media UUID → playable URL (blob URL from bundle, or fallback). */
  resolveMediaUrl: (mediaId: string) => string | null;
  /** Whether videos should be muted (kiosk autoplay). */
  muted: boolean;
  /** Whether to play. When false, all videos pause. */
  playing: boolean;
}

/** Pull canvas resolution out of the embedded `_meta` zone (set on save). */
function readMeta(zonesRaw: unknown[] | undefined): { w: number; h: number } {
  const fallback = { w: 1920, h: 1080 };
  if (!Array.isArray(zonesRaw)) return fallback;
  const meta = zonesRaw.find((z) => z != null && typeof z === "object" && "_meta" in z && "resolution" in z) as Record<string, unknown> | undefined;
  const r = meta?.resolution as Record<string, unknown> | undefined;
  if (r?.width && r?.height) return { w: Number(r.width), h: Number(r.height) };
  return fallback;
}

function splitZones(zonesRaw: unknown[] | undefined): { zones: Zone[]; overlays: OverlayBlock[] } {
  if (!Array.isArray(zonesRaw)) return { zones: [], overlays: [] };
  const zones: Zone[] = [];
  const overlays: OverlayBlock[] = [];
  for (const z of zonesRaw) {
    if (!z || typeof z !== "object") continue;
    const zObj = z as Record<string, unknown>;
    if (zObj._meta) continue;
    if (zObj._overlay) {
      const { _overlay, ...rest } = zObj;
      void _overlay;
      overlays.push(rest as unknown as OverlayBlock);
    } else {
      zones.push(zObj as unknown as Zone);
    }
  }
  return { zones, overlays };
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Fetches HTML from URL, injects window.__widgetParams, renders via srcdoc. */
function WebpageWidgetRender({ config }: { config: WidgetConfig }) {
  const { url, params } = config;
  const paramsKey = JSON.stringify(params || {});
  const [srcDoc, setSrcDoc] = useState<string>("");
  useEffect(() => {
    if (!url) { setSrcDoc(""); return; }
    let cancelled = false;
    fetch(url)
      .then((r) => r.text())
      .then((html) => {
        if (cancelled) return;
        const hasParams = params && Object.keys(params).length > 0;
        if (hasParams) {
          const injection = `<script>window.__widgetParams = ${JSON.stringify(params)};</script>`;
          setSrcDoc(html.includes("</head>") ? html.replace("</head>", `${injection}</head>`) : injection + html);
        } else {
          setSrcDoc(html);
        }
      })
      .catch(() => { if (!cancelled) setSrcDoc(""); });
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, paramsKey]);
  if (!srcDoc) return <div className="w-full h-full" />;
  return (
    <iframe
      srcDoc={srcDoc}
      className="w-full h-full border-0"
      title="webpage-widget"
      sandbox="allow-scripts allow-same-origin"
    />
  );
}

/** Render one widget (clock, date, marquee, qrcode, countdown, webpage, weather). */
export function WidgetRender({ config }: { config: WidgetConfig | null | undefined }) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    if (!config) return;
    const wt = config.widgetType;
    if (wt === "clock" || wt === "date" || wt === "countdown") {
      const id = window.setInterval(() => setNow(new Date()), 1000);
      return () => window.clearInterval(id);
    }
  }, [config?.widgetType]);

  if (!config) return null;
  const bg = config.bgColor || "transparent";
  const fg = config.textColor || "#ffffff";

  if (config.widgetType === "clock") {
    const tz = config.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone;
    const opts: Intl.DateTimeFormatOptions = {
      hour: "2-digit", minute: "2-digit", second: "2-digit",
      hour12: config.format === "12", timeZone: tz,
    };
    return (
      <div className="w-full h-full flex flex-col items-center justify-center" style={{ background: bg, color: fg }}>
        <span className="font-mono font-bold tracking-wider text-[8vmin]">
          {now.toLocaleTimeString("en-US", opts)}
        </span>
        {config.showDate && (
          <span className="opacity-70 text-[3vmin] mt-1">
            {now.toLocaleDateString("zh-TW", { month: "long", day: "numeric", weekday: "long", timeZone: tz })}
          </span>
        )}
      </div>
    );
  }

  if (config.widgetType === "date") {
    return (
      <div className="w-full h-full flex flex-col items-center justify-center" style={{ background: bg, color: fg }}>
        <span className="opacity-70 text-[3vmin]">{now.toLocaleDateString("zh-TW", { weekday: "long" })}</span>
        <span className="font-bold text-[5vmin]">
          {now.toLocaleDateString("zh-TW", { year: "numeric", month: "long", day: "numeric" })}
        </span>
      </div>
    );
  }

  if (config.widgetType === "marquee" && config.text) {
    return (
      <div className="w-full h-full flex items-center overflow-hidden" style={{ background: bg, color: fg }}>
        <div className="animate-marquee whitespace-nowrap font-medium text-[4vmin]">{config.text}</div>
      </div>
    );
  }

  if (config.widgetType === "qrcode") {
    return (
      <div className="w-full h-full flex items-center justify-center" style={{ background: bg }}>
        <QRCodeSVG
          value={config.qrcodeContent || "https://example.com"}
          size={Math.min(config.qrcodeSize || 256, 512)}
          bgColor={bg === "transparent" ? "#ffffff" : bg}
          fgColor={fg}
          level="M"
        />
      </div>
    );
  }

  if (config.widgetType === "countdown") {
    const target = config.targetDate ? new Date(config.targetDate).getTime() : Date.now() + 86400000;
    const diff = Math.max(0, target - now.getTime());
    const d = Math.floor(diff / 86400000);
    const h = Math.floor((diff % 86400000) / 3600000);
    const m = Math.floor((diff % 3600000) / 60000);
    const s = Math.floor((diff % 60000) / 1000);
    return (
      <div className="w-full h-full flex flex-col items-center justify-center" style={{ background: bg, color: fg }}>
        {config.countdownTitle && (
          <span className="font-bold opacity-80 text-[3vmin] mb-2">{config.countdownTitle}</span>
        )}
        <div className="flex gap-3 font-mono font-bold text-[6vmin]">
          {[d, h, m, s].map((v, i) => (
            <span key={i}>{String(v).padStart(2, "0")}</span>
          ))}
        </div>
      </div>
    );
  }

  if ((config.widgetType === "webpage" || config.widgetType === "weather_tw" || config.widgetType === "weather") && config.url) {
    return <WebpageWidgetRender config={config} />;
  }

  if (config.widgetType === "youtube") {
    const vid = config.youtubeId || _parseYoutubeId(config.youtubeUrl || "");
    if (vid) return <YoutubeWidgetRender videoId={vid} muted={config.youtubeMuted !== false} volume={config.youtubeVolume ?? 100} />;
  }

  if (config.widgetType === "stream" && config.streamUrl) {
    return <StreamWidgetRender url={config.streamUrl} muted={config.streamMuted !== false} fitMode={config.streamFit as string | undefined} />;
  }

  if (config.widgetType === "queue-display") {
    const orgId =
      (config.params?.orgId as string) ||
      (config.orgId as string) ||
      "";
    if (!orgId) {
      return (
        <div className="w-full h-full flex items-center justify-center" style={{ background: bg }}>
          <p className="text-[3vmin]" style={{ color: fg, opacity: 0.5 }}>請在 Widget 設定中填入組織 ID</p>
        </div>
      );
    }
    const teamId =
      (config.params?.teamId as string | undefined) ||
      (config.teamId as string | undefined) ||
      undefined;
    const queueIds =
      (config.params?.queueIds as string[] | undefined) ||
      (config.queueIds as string[] | undefined) ||
      undefined;
    return (
      <QueueDisplayWidget config={{
        orgId,
        teamId:       teamId || undefined,
        queueIds:     queueIds?.length ? queueIds : undefined,
        ttsLang:      (config.params?.ttsLang      as string | undefined) ?? (config.ttsLang      as string | undefined) ?? "zh-TW",
        cycleSeconds: Number((config.params?.cycleSeconds ?? config.cycleSeconds) ?? 8),
      }} />
    );
  }

  // Unknown widget — render label.
  return (
    <div className="w-full h-full flex items-center justify-center text-[3vmin] opacity-60" style={{ background: bg, color: fg }}>
      {config.widgetType || "widget"}
    </div>
  );
}

/** Per-zone playlist renderer. Cycles through mediaItems by their `duration`. */
function MediaCarousel({
  items,
  resolveMediaUrl,
  muted,
  playing,
  fitMode = "contain",
}: {
  items: MediaItem[];
  resolveMediaUrl: (id: string) => string | null;
  muted: boolean;
  playing: boolean;
  fitMode?: "cover-x" | "cover-y" | "contain" | "stretch";
}) {
  const [idx, setIdx] = useState(0);
  const timerRef = useRef<number | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  const safeItems = useMemo(() => items.filter(Boolean), [items]);
  const cur = safeItems[idx % Math.max(safeItems.length, 1)];

  // Resolve URL for current media item.
  const url = useMemo<string | null>(() => {
    if (!cur) return null;
    if (cur.type === "widget") return null;
    // Prefer bundle blob URL by id; fall back to embedded url (data:/http for online preview).
    if (cur.id && UUID_RE.test(String(cur.id))) {
      const resolved = resolveMediaUrl(String(cur.id));
      if (resolved) return resolved;
    }
    return cur.url || null;
  }, [cur, resolveMediaUrl]);

  // Schedule the next slide based on item duration (default 10s for images).
  useEffect(() => {
    if (!playing || !cur || safeItems.length <= 1) return;
    if (cur.type === "video") return; // video advances on `ended`
    const ms = Math.max(1, cur.duration || 10) * 1000;
    if (timerRef.current) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => {
      setIdx((i) => (i + 1) % safeItems.length);
    }, ms);
    return () => {
      if (timerRef.current) window.clearTimeout(timerRef.current);
    };
  }, [playing, cur, safeItems.length, idx]);

  // Pause/resume video on `playing` toggle.
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    if (playing) v.play().catch(() => { /* gesture required */ });
    else { try { v.pause(); } catch { /* noop */ } }
  }, [playing, url]);

  if (safeItems.length === 0) return null;
  if (!cur) return null;

  // Tailwind object-fit class from saved fitMode.
  const fitClass =
    fitMode === "cover-x" || fitMode === "cover-y" ? "object-cover"
    : fitMode === "stretch" ? "object-fill"
    : "object-contain";

  if (cur.type === "widget") {
    return <WidgetRender config={cur.widgetConfig} />;
  }
  if (!url) {
    return (
      <div className="w-full h-full flex items-center justify-center text-white/60 text-xs bg-black/40">
        ✗ missing asset — {cur.name || cur.id}
      </div>
    );
  }
  if (cur.type === "video") {
    return (
      <video
        ref={videoRef}
        key={url}
        src={url}
        autoPlay={playing}
        muted={muted || cur.muted}
        playsInline
        className={`w-full h-full ${fitClass}`}
        onEnded={() => setIdx((i) => (i + 1) % safeItems.length)}
      />
    );
  }
  // image
  return <img src={url} alt={cur.name || ""} className={`w-full h-full ${fitClass}`} />;
}

/** Render a single zone or overlay's content (color/text/media/widget). */
function ZoneContentRender({
  content,
  resolveMediaUrl,
  muted,
  playing,
}: {
  content?: ZoneContent;
  resolveMediaUrl: (id: string) => string | null;
  muted: boolean;
  playing: boolean;
}) {
  if (!content) return <div className="w-full h-full" style={{ background: "transparent" }} />;

  if (content.type === "color") {
    return <div className="w-full h-full" style={{ background: content.bgColor || content.value || "#000" }} />;
  }
  if (content.type === "text") {
    return (
      <div
        className="w-full h-full flex items-center"
        style={{
          background: content.bgColor || "transparent",
          color: content.textColor || "#fff",
          fontSize: content.fontSize ? `${content.fontSize}px` : undefined,
          justifyContent: content.textAlign === "right" ? "flex-end"
            : content.textAlign === "center" ? "center" : "flex-start",
          padding: "0.5em 1em",
        }}
      >
        <div className="whitespace-pre-wrap">{content.value || ""}</div>
      </div>
    );
  }
  if (content.type === "widget") {
    // Legacy single-widget zone.
    return <WidgetRender config={content.widgetConfig} />;
  }
  if (content.type === "media") {
    const items = content.mediaItems || [];
    return (
      <div className="w-full h-full" style={{ background: content.bgColor || "#000" }}>
        <MediaCarousel
          items={items}
          resolveMediaUrl={resolveMediaUrl}
          muted={muted}
          playing={playing}
          fitMode={content.fitMode}
        />
      </div>
    );
  }
  return null;
}

export function DesignStage({ project, resolveMediaUrl, muted, playing }: DesignStageProps) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [scale, setScale] = useState(1);

  const { w: canvasW, h: canvasH } = useMemo(() => readMeta(project.zones), [project]);
  const { zones, overlays } = useMemo(() => splitZones(project.zones), [project]);

  // Fit canvas to wrapper while preserving aspect ratio.
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const compute = () => {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) return;
      const sx = r.width / canvasW;
      const sy = r.height / canvasH;
      setScale(Math.max(0.01, Math.min(sx, sy)));
    };
    compute();
    const ro = new ResizeObserver(compute);
    ro.observe(el);
    return () => ro.disconnect();
  }, [canvasW, canvasH]);

  return (
    <div ref={wrapRef} className="relative w-full h-full flex items-center justify-center bg-black overflow-hidden">
      <div
        className="relative shrink-0"
        style={{
          width: canvasW,
          height: canvasH,
          transform: `scale(${scale})`,
          transformOrigin: "center center",
          background: "#000",
        }}
      >
        {/* Zones (% positioning) */}
        {zones.map((z) => (
          <div
            key={`z-${z.id}`}
            className="absolute overflow-hidden"
            style={{
              left: `${z.x}%`,
              top: `${z.y}%`,
              width: `${z.w}%`,
              height: `${z.h}%`,
            }}
          >
            <ZoneContentRender
              content={z.content}
              resolveMediaUrl={resolveMediaUrl}
              muted={muted}
              playing={playing}
            />
          </div>
        ))}
        {/* Overlays (px positioning relative to canvas) */}
        {overlays.map((o) => (
          <div
            key={`o-${o.id}`}
            className="absolute overflow-hidden"
            style={{
              left: o.x,
              top: o.y,
              width: o.w,
              height: o.h,
              opacity: typeof o.opacity === "number" ? o.opacity / 100 : 1,
              zIndex: typeof o.zIndex === "number" ? o.zIndex : 10,
            }}
          >
            <ZoneContentRender
              content={o.content}
              resolveMediaUrl={resolveMediaUrl}
              muted={muted}
              playing={playing}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
