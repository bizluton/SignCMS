import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import JSZip from "jszip";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Slider } from "@/components/ui/slider";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  FolderOpen,
  FileArchive,
  Play,
  Pause,
  SkipForward,
  Volume2,
  VolumeX,
  Maximize,
  AlertCircle,
  Link2,
  Repeat,
} from "lucide-react";
import { saveLastFolderHandle, loadLastFolderHandle, clearLastFolderHandle } from "@/lib/folderHandleStore";
import { toast } from "@/hooks/use-toast";
import QRCode from "qrcode";
import { DesignStage, WidgetRender } from "@/components/player/DesignStage";

/** Tiny inline QR renderer — regenerates a data URL when `value` changes. */
function KioskQR({ value }: { value: string }) {
  const [src, setSrc] = useState<string>("");
  useEffect(() => {
    let cancelled = false;
    QRCode.toDataURL(value, { margin: 1, width: 192, errorCorrectionLevel: "M" })
      .then((d) => { if (!cancelled) setSrc(d); })
      .catch(() => { if (!cancelled) setSrc(""); });
    return () => { cancelled = true; };
  }, [value]);
  if (!src) return <div className="h-48 w-48 bg-muted animate-pulse rounded" />;
  return <img src={src} alt="Kiosk URL QR code" className="h-48 w-48 rounded bg-white p-2" />;
}

/**
 * SignCMSPlayer
 * -------------
 * Local playback for schedule bundles exported from the Publishing Center.
 * Accepts either:
 *   - A `.zip` archive (schedule.json + assets/...)
 *   - A folder picked via the File System Access API (unpacked layout)
 *
 * Plays schedule_items in order on loop. Design-project items render their
 * first image/video media. BGM tracks loop independently with a volume mixer.
 */

interface MediaEntry {
  id: string;
  name?: string;
  original_name?: string;
  type?: string;
  mime_type?: string;
  duration_seconds?: number | null;
  assetPath?: string | null;
  /** Embedded for widget-type virtual entries (no asset file). */
  widgetConfig?: any;
}

interface ScheduleItem {
  media_id: string | null;
  design_project_id: string | null;
  item_type: string;
  duration: number;
  sort_order: number;
}

interface BgmItem {
  media_id: string;
  sort_order: number;
}

interface DesignProject {
  id: string;
  name: string;
  zones?: any[];
}

interface Manifest {
  format: string;
  version: number;
  schedule: { id: string; name: string; bgm_volume?: number };
  items: ScheduleItem[];
  bgm: BgmItem[];
  designProjects: DesignProject[];
  media: MediaEntry[];
  warnings?: { mediaId: string; reason: string }[];
}

type PlayItem =
  | { kind: "image"; url: string; durationMs: number; label: string }
  | { kind: "video"; url: string; durationMs: number; label: string }
  | { kind: "design"; project: DesignProject; durationMs: number; label: string }
  | { kind: "widget"; config: any; durationMs: number; label: string }
  | { kind: "blank"; durationMs: number; label: string };

const DEFAULT_DURATION = 10;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isVideoMime(m?: string) {
  return !!m && m.startsWith("video/");
}
function isImageMime(m?: string) {
  return !!m && m.startsWith("image/");
}
function isAudioMime(m?: string) {
  return !!m && m.startsWith("audio/");
}

/**
 * Estimate a sensible duration for a design project when the schedule item
 * doesn't supply one (legacy data). Picks the longest mediaItem duration
 * across all zones, or 30s as a default.
 */
function estimateDesignDuration(d: DesignProject | undefined): number {
  if (!d?.zones) return 30;
  let max = 0;
  const visit = (content: any) => {
    if (!content) return;
    if (Array.isArray(content.mediaItems)) {
      for (const m of content.mediaItems) {
        const dur = Number(m?.duration);
        if (Number.isFinite(dur) && dur > max) max = dur;
      }
    }
  };
  for (const z of d.zones) {
    if (!z || z._meta) continue;
    visit(z?.content);
    if (Array.isArray(z?.overlays)) for (const o of z.overlays) visit(o?.content);
  }
  return max > 0 ? max : 30;
}

export interface SignCMSPlayerProps {
  /** Optional pre-built export ZIP. When supplied, the player auto-loads it
   *  on mount instead of waiting for a user file pick. Used by in-app preview
   *  dialogs (e.g. Publishing Center) that already have the schedule blob. */
  bootstrapBlob?: Blob | null;
  /** Hide the file/folder loader card and the kiosk-link generator. The
   *  player still renders the playback stage and bottom transport bar. */
  compactUi?: boolean;
  /** Auto-start playback once the bootstrap blob has finished loading. */
  autoPlay?: boolean;
}

export default function SignCMSPlayer({ bootstrapBlob, compactUi, autoPlay }: SignCMSPlayerProps = {}) {
  const [manifest, setManifest] = useState<Manifest | null>(null);
  const [assetUrls, setAssetUrls] = useState<Record<string, string>>({}); // assetPath -> blob URL
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [currentIdx, setCurrentIdx] = useState(0);
  const [bgmIdx, setBgmIdx] = useState(0);
  const [bgmVolume, setBgmVolume] = useState(50);
  const [muted, setMuted] = useState(false);
  const [kioskHint, setKioskHint] = useState<string | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showOverlay, setShowOverlay] = useState(false);
  const [loop, setLoop] = useState(true);
  // Kiosk-link generator options.
  const [linkFullscreen, setLinkFullscreen] = useState(true);
  const [linkMuted, setLinkMuted] = useState(true);
  const [linkLoop, setLinkLoop] = useState(true);
  const [linkVolume, setLinkVolume] = useState<number | null>(null); // null = don't override
  const [linkHideUi, setLinkHideUi] = useState(false);
  const [linkStartAt, setLinkStartAt] = useState<number | null>(null);
  const [linkDate, setLinkDate] = useState<string>(""); // YYYY-MM-DD
  const [hideUi, setHideUi] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const itemStartRef = useRef<number>(Date.now());
  const [scrubFrac, setScrubFrac] = useState<number | null>(null);
  const scrubBarRef = useRef<HTMLDivElement | null>(null);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const timerRef = useRef<number | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const blobUrlsRef = useRef<string[]>([]);

  const cleanupBlobs = useCallback(() => {
    for (const u of blobUrlsRef.current) {
      try { URL.revokeObjectURL(u); } catch { /* noop */ }
    }
    blobUrlsRef.current = [];
  }, []);

  useEffect(() => () => {
    cleanupBlobs();
    if (timerRef.current) window.clearTimeout(timerRef.current);
  }, [cleanupBlobs]);

  // ?date=YYYY-MM-DD [&time=HH:MM:SS] — patch global Date so widgets/content
  // and the overlay clock all see the simulated moment. The offset is frozen
  // at mount, then time advances normally from there.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const dateStr = params.get("date");
    if (!dateStr || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return;
    const timeStr = params.get("time");
    const t = timeStr && /^\d{2}:\d{2}(:\d{2})?$/.test(timeStr) ? timeStr : "00:00:00";
    const simulated = new Date(`${dateStr}T${t.length === 5 ? t + ":00" : t}`);
    if (Number.isNaN(simulated.getTime())) return;
    const realAtPatch = Date.now();
    const offset = simulated.getTime() - realAtPatch;
    const RealDate = window.Date;
    const realNow = RealDate.now.bind(RealDate);
    const PatchedDate = function (this: unknown, ...args: unknown[]) {
      if (args.length === 0) {
        // new Date() → simulated "now"
        return new RealDate(realNow() + offset);
      }
      // @ts-expect-error variadic constructor passthrough
      return new RealDate(...args);
    } as unknown as DateConstructor;
    (PatchedDate as unknown as { prototype: unknown }).prototype = RealDate.prototype;
    PatchedDate.now = () => realNow() + offset;
    PatchedDate.parse = RealDate.parse;
    PatchedDate.UTC = RealDate.UTC;
    Object.setPrototypeOf(PatchedDate, RealDate);
    window.Date = PatchedDate;
    // Trigger a re-render so the overlay clock shows the simulated time.
    setNow(PatchedDate.now());
    return () => {
      window.Date = RealDate;
    };
  }, []);

  // Track fullscreen state. When user presses ESC (or otherwise exits FS),
 // auto-pause so a kiosk doesn't keep blasting in the background.
  useEffect(() => {
    const onFsChange = () => {
      const fs = !!document.fullscreenElement;
      setIsFullscreen(fs);
      if (!fs && playing) setPlaying(false);
    };
    document.addEventListener("fullscreenchange", onFsChange);
    return () => document.removeEventListener("fullscreenchange", onFsChange);
  }, [playing]);

  // Auto-hide the floating overlay after a few seconds of no mouse movement,
  // but only while in fullscreen (kiosk) — the in-card transport stays visible
  // when not fullscreen.
  useEffect(() => {
    const active = isFullscreen || hideUi;
    if (!active) { setShowOverlay(false); return; }
    setShowOverlay(true);
    let hideTimer: number | null = null;
    const reveal = () => {
      setShowOverlay(true);
      if (hideTimer) window.clearTimeout(hideTimer);
      hideTimer = window.setTimeout(() => setShowOverlay(false), 3000);
    };
    const el = containerRef.current;
    el?.addEventListener("mousemove", reveal);
    el?.addEventListener("touchstart", reveal);
    el?.addEventListener("keydown", reveal);
    reveal();
    return () => {
      if (hideTimer) window.clearTimeout(hideTimer);
      el?.removeEventListener("mousemove", reveal);
      el?.removeEventListener("touchstart", reveal);
      el?.removeEventListener("keydown", reveal);
    };
  }, [isFullscreen, hideUi]);

  const mediaById = useMemo(() => {
    const map = new Map<string, MediaEntry>();
    for (const m of manifest?.media ?? []) map.set(String(m.id), m);
    return map;
  }, [manifest]);

  const designById = useMemo(() => {
    const map = new Map<string, DesignProject>();
    for (const d of manifest?.designProjects ?? []) map.set(String(d.id), d);
    return map;
  }, [manifest]);

  // Build the flat play queue.
  const queue = useMemo<PlayItem[]>(() => {
    if (!manifest) return [];
    const items = [...manifest.items].sort((a, b) => a.sort_order - b.sort_order);
    const out: PlayItem[] = [];
    for (let idx = 0; idx < items.length; idx++) {
      const it = items[idx];
      const pos = `#${idx + 1}/${items.length}`;

      // Design-project items render the full multi-zone stage. The schedule
      // duration governs how long the design stays on screen; per-zone
      // carousels cycle independently inside DesignStage.
      if (!it.media_id && it.design_project_id) {
        const dp = designById.get(it.design_project_id);
        if (!dp) {
          out.push({
            kind: "blank",
            durationMs: Math.max(1, it.duration || DEFAULT_DURATION) * 1000,
            label: `${pos} ✗ design_project not in manifest — id=${it.design_project_id}`,
          });
          continue;
        }
        const designDurationMs =
          Math.max(1, it.duration || estimateDesignDuration(dp)) * 1000;
        out.push({
          kind: "design",
          project: dp,
          durationMs: designDurationMs,
          label: `${pos} 🎬 ${dp.name || it.design_project_id}`,
        });
        continue;
      }

      const durationMs = Math.max(1, it.duration || DEFAULT_DURATION) * 1000;
      const mediaId: string | null = it.media_id;
      const m = mediaId ? mediaById.get(mediaId) : null;
      const url = m?.assetPath ? assetUrls[m.assetPath] : null;
      const label = m?.original_name || m?.name || mediaId || "item";

      if (!mediaId) {
        out.push({
          kind: "blank",
          durationMs,
          label: `${pos} ✗ schedule item has neither media_id nor design_project_id`,
        });
        continue;
      }
      if (!m) {
        out.push({
          kind: "blank",
          durationMs,
          label: `${pos} ✗ media not in manifest — id=${mediaId}`,
        });
        continue;
      }
      // Widget-type virtual entries have no asset file; render directly.
      if (m.mime_type === "application/x-widget" || m.type === "widget") {
        if (!m.widgetConfig) {
          out.push({
            kind: "blank",
            durationMs,
            label: `${pos} ✗ widget config missing — ${m.original_name || m.name || mediaId}`,
          });
          continue;
        }
        out.push({
          kind: "widget",
          config: m.widgetConfig,
          durationMs,
          label: `${pos} 🧩 ${m.original_name || m.name || mediaId}`,
        });
        continue;
      }
      if (!m.assetPath) {
        out.push({
          kind: "blank",
          durationMs,
          label: `${pos} ✗ media has no assetPath — ${m.original_name || m.name || mediaId}`,
        });
        continue;
      }
      if (!url) {
        out.push({
          kind: "blank",
          durationMs,
          label: `${pos} ✗ asset file missing in bundle — expected "${m.assetPath}" (${m.original_name || m.name || mediaId})`,
        });
        continue;
      }
      if (isVideoMime(m.mime_type)) {
        out.push({ kind: "video", url, durationMs, label });
      } else if (isImageMime(m.mime_type)) {
        out.push({ kind: "image", url, durationMs, label });
      } else {
        out.push({
          kind: "blank",
          durationMs,
          label: `${pos} ✗ unsupported mime "${m.mime_type || "?"}" — ${label}`,
        });
      }
    }
    return out;
  }, [manifest, mediaById, designById, assetUrls]);

  const bgmQueue = useMemo<string[]>(() => {
    if (!manifest) return [];
    return [...manifest.bgm]
      .sort((a, b) => a.sort_order - b.sort_order)
      .map((b) => {
        const m = mediaById.get(String(b.media_id));
        return m?.assetPath ? assetUrls[m.assetPath] : "";
      })
      .filter(Boolean);
  }, [manifest, mediaById, assetUrls]);

  const current = queue[currentIdx];

  /** Resolve a media UUID → bundle blob URL (for DesignStage). */
  const resolveMediaUrl = useCallback(
    (id: string): string | null => {
      const m = mediaById.get(String(id));
      if (!m?.assetPath) return null;
      return assetUrls[m.assetPath] || null;
    },
    [mediaById, assetUrls],
  );

  // Advance to next item; if loop=false and we're at the last, stop playback.
  const advance = useCallback(() => {
    setCurrentIdx((i) => {
      const n = queue.length;
      if (n === 0) return 0;
      if (i + 1 >= n) {
        if (loop) return 0;
        // End of queue → pause.
        setPlaying(false);
        return i;
      }
      return i + 1;
    });
  }, [queue.length, loop]);

  // Schedule the next-item transition when current item changes.
  useEffect(() => {
    if (!playing || !current) return;
    itemStartRef.current = Date.now();
    if (timerRef.current) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(advance, current.durationMs);
    return () => {
      if (timerRef.current) window.clearTimeout(timerRef.current);
    };
  }, [playing, current, advance]);

  // Tick once per second so the overlay clock & countdown stay fresh.
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  // Audio element control.
  useEffect(() => {
    const a = audioRef.current;
    if (!a) return;
    a.volume = muted ? 0 : bgmVolume / 100;
  }, [bgmVolume, muted]);

  useEffect(() => {
    const a = audioRef.current;
    if (!a) return;
    if (playing && bgmQueue.length > 0) {
      a.src = bgmQueue[bgmIdx % bgmQueue.length];
      a.play().catch(() => { /* user-gesture required, ignore */ });
    } else {
      a.pause();
    }
  }, [playing, bgmQueue, bgmIdx]);

  const handleZipFile = async (file: File) => {
    setLoading(true);
    setError(null);
    try {
      cleanupBlobs();
      const zip = await JSZip.loadAsync(file);
      const manifestFile = zip.file("schedule.json");
      if (!manifestFile) throw new Error("schedule.json not found in ZIP");
      const manifestText = await manifestFile.async("string");
      const m: Manifest = JSON.parse(manifestText);
      const urls: Record<string, string> = {};
      const assetsFolder = zip.folder("assets");
      if (assetsFolder) {
        const entries: { path: string; file: JSZip.JSZipObject }[] = [];
        zip.forEach((path, file) => {
          if (path.startsWith("assets/") && !file.dir) entries.push({ path, file });
        });
        for (const e of entries) {
          const blob = await e.file.async("blob");
          const url = URL.createObjectURL(blob);
          urls[e.path] = url;
          blobUrlsRef.current.push(url);
        }
      }
      setManifest(m);
      setAssetUrls(urls);
      setBgmVolume(m.schedule?.bgm_volume ?? 50);
      setCurrentIdx(0);
      setBgmIdx(0);
    } catch (err: any) {
      console.error(err);
      setError(err?.message || "Failed to load ZIP");
    } finally {
      setLoading(false);
    }
  };

  // Auto-load a pre-built export blob (used by in-app preview dialogs).
  useEffect(() => {
    if (!bootstrapBlob) return;
    const file = new File([bootstrapBlob], "preview.zip", { type: "application/zip" });
    handleZipFile(file).then(() => {
      if (autoPlay) setPlaying(true);
    }).catch(() => { /* error already surfaced via state */ });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bootstrapBlob]);

  // Load schedule.json + assets/ from a granted directory handle.
  const loadFromDirHandle = async (dir: any) => {
    cleanupBlobs();
    const manifestHandle = await dir.getFileHandle("schedule.json");
    const manifestText = await (await manifestHandle.getFile()).text();
    const m: Manifest = JSON.parse(manifestText);
    const urls: Record<string, string> = {};
    try {
      const assetsDir = await dir.getDirectoryHandle("assets");
      for await (const [name, handle] of (assetsDir as any).entries()) {
        if (handle.kind !== "file") continue;
        const file = await handle.getFile();
        const url = URL.createObjectURL(file);
        urls[`assets/${name}`] = url;
        blobUrlsRef.current.push(url);
      }
    } catch { /* assets dir optional */ }
    setManifest(m);
    setAssetUrls(urls);
    setBgmVolume(m.schedule?.bgm_volume ?? 50);
    setCurrentIdx(0);
    setBgmIdx(0);
  };

  const handlePickFolder = async () => {
    if (typeof (window as any).showDirectoryPicker !== "function") {
      setError("Your browser does not support folder picking. Use a Chromium-based browser or upload a ZIP.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const dir = await (window as any).showDirectoryPicker();
      await loadFromDirHandle(dir);
      // Persist for kiosk reuse via ?folder=last.
      saveLastFolderHandle(dir).catch(() => { /* noop */ });
    } catch (err: any) {
      if (err?.name === "AbortError") { setLoading(false); return; }
      console.error(err);
      setError(err?.message || "Failed to load folder");
    } finally {
      setLoading(false);
    }
  };

  // Kiosk URL params: ?autoplay=1 ?folder=last ?fullscreen=1
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const wantAutoplay = params.get("autoplay") === "1";
    const wantFolder = params.get("folder") === "last";
    const wantFs = params.get("fullscreen") === "1" || wantAutoplay;
    const wantMuted = params.get("muted") !== "0"; // default true
    const wantLoop = params.get("loop") !== "0";   // default true
    const volParam = params.get("volume");
    const wantVolume = volParam != null && /^\d+$/.test(volParam)
      ? Math.max(0, Math.min(100, parseInt(volParam, 10)))
      : null;
    const wantHideUi = params.get("hideUi") === "1";
    if (wantHideUi) setHideUi(true);
    if (!wantAutoplay && !wantFolder) return;

    let cancelled = false;
    (async () => {
      // Try to silently reuse the persisted folder handle.
      if (wantFolder) {
        const handle = await loadLastFolderHandle();
        if (handle) {
          try {
            // queryPermission may return "granted" without a gesture; otherwise
            // we surface a hint and wait for the user to click anywhere.
            const perm = await (handle as any).queryPermission?.({ mode: "read" });
            if (perm !== "granted") {
              setKioskHint("Click anywhere to grant folder access and start autoplay.");
              const onGesture = async () => {
                window.removeEventListener("click", onGesture);
                window.removeEventListener("keydown", onGesture);
                try {
                  const r = await (handle as any).requestPermission?.({ mode: "read" });
                  if (r !== "granted") { setError("Folder permission denied"); return; }
                  setKioskHint(null);
                  setLoading(true);
                  await loadFromDirHandle(handle);
                  setLoading(false);
                  if (!cancelled) startKiosk(wantFs, wantMuted, wantLoop, wantVolume);
                } catch (e) {
                  console.error(e);
                  setError("Failed to reopen last folder. Pick it again.");
                  await clearLastFolderHandle();
                }
              };
              window.addEventListener("click", onGesture, { once: true });
              window.addEventListener("keydown", onGesture, { once: true });
              return;
            }
            setLoading(true);
            await loadFromDirHandle(handle);
            setLoading(false);
            if (!cancelled) startKiosk(wantFs, wantMuted, wantLoop, wantVolume);
            return;
          } catch (e) {
            console.error(e);
            await clearLastFolderHandle();
          }
        }
      }
      // Fall back: just hint to user (browsers cannot auto-load files without a gesture).
      if (wantAutoplay) {
        setKioskHint("Load a ZIP or folder to auto-start playback.");
      }
    })();

    function startKiosk(fs: boolean, mute: boolean, lp: boolean, vol: number | null) {
      // Default muted so browsers allow autoplay even before user gesture.
      setMuted(mute);
      setLoop(lp);
      if (vol != null) setBgmVolume(vol);
      setPlaying(true);
      if (fs) {
        setTimeout(() => {
          try { containerRef.current?.requestFullscreen?.(); } catch { /* noop */ }
        }, 100);
      }
    }

    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // When a manifest is loaded AND kiosk autoplay was requested, kick off play.
  useEffect(() => {
    if (!manifest) return;
    const params = new URLSearchParams(window.location.search);
    if (params.get("autoplay") === "1" && !playing) {
      setMuted(params.get("muted") !== "0");
      setLoop(params.get("loop") !== "0");
      const v = params.get("volume");
      if (v != null && /^\d+$/.test(v)) {
        setBgmVolume(Math.max(0, Math.min(100, parseInt(v, 10))));
      }
      if (params.get("hideUi") === "1") setHideUi(true);
      const sa = params.get("startAt");
      if (sa != null && /^\d+$/.test(sa)) {
        // 1-based in URL for human friendliness; clamp to queue range.
        const n = Math.max(1, parseInt(sa, 10));
        setCurrentIdx(Math.min(n - 1, Math.max(0, queue.length - 1)));
      }
      setPlaying(true);
      if (params.get("fullscreen") !== "0") {
        setTimeout(() => {
          try { containerRef.current?.requestFullscreen?.(); } catch { /* noop */ }
        }, 100);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [manifest]);

  const togglePlay = () => setPlaying((p) => !p);
  const skip = () => setCurrentIdx((i) => (i + 1) % Math.max(queue.length, 1));
  // Seek to a fraction (0..1) of the current item.
  const seekToFraction = (frac: number) => {
    if (!current) return;
    const f = Math.min(1, Math.max(0, frac));
    if (current.kind === "video" && videoRef.current) {
      const dur = videoRef.current.duration;
      if (Number.isFinite(dur) && dur > 0) {
        videoRef.current.currentTime = dur * f;
      }
      // Re-anchor countdown/progress to the new position.
      itemStartRef.current = Date.now() - current.durationMs * f;
    } else {
      // Image / blank — re-arm the timer for the remaining duration.
      itemStartRef.current = Date.now() - current.durationMs * f;
      if (timerRef.current) window.clearTimeout(timerRef.current);
      const remaining = Math.max(0, current.durationMs * (1 - f));
      if (playing) timerRef.current = window.setTimeout(advance, remaining);
    }
    setNow(Date.now());
  };
  const requestFullscreen = () => {
    const el = containerRef.current;
    if (!el) return;
    if (document.fullscreenElement) document.exitFullscreen?.();
    else el.requestFullscreen?.();
  };

  return (
    <div className="space-y-4">
      {/* Loader controls (hidden in compactUi mode used by in-app preview) */}
      {!compactUi && (
      <Card className="p-4 flex flex-wrap items-center gap-3">
        <input
          id="signcms-zip-input"
          type="file"
          accept=".zip,application/zip"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) handleZipFile(f);
            e.target.value = "";
          }}
        />
        <Button
          variant="outline"
          onClick={() => document.getElementById("signcms-zip-input")?.click()}
          disabled={loading}
        >
          <FileArchive className="w-4 h-4 mr-2" />
          Load ZIP
        </Button>
        <Button variant="outline" onClick={handlePickFolder} disabled={loading}>
          <FolderOpen className="w-4 h-4 mr-2" />
          Load Folder
        </Button>
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="outline" title="Generate a kiosk-mode URL with custom options">
              <Link2 className="w-4 h-4 mr-2" />
              Kiosk Link
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-80" align="end">
            {(() => {
              const params = new URLSearchParams({ folder: "last", autoplay: "1" });
              if (!linkFullscreen) params.set("fullscreen", "0");
              if (!linkMuted) params.set("muted", "0");
              if (!linkLoop) params.set("loop", "0");
              if (linkVolume != null) params.set("volume", String(linkVolume));
              if (linkHideUi) params.set("hideUi", "1");
              if (linkStartAt != null && linkStartAt > 1) params.set("startAt", String(linkStartAt));
              if (linkDate) params.set("date", linkDate);
              const url = `${window.location.origin}/local-player?${params.toString()}`;
              return (
                <div className="space-y-3">
                  <div className="text-sm font-medium">Kiosk Link Options</div>
                  <div className="flex items-center gap-2">
                    <Checkbox id="opt-fs" checked={linkFullscreen} onCheckedChange={(v) => setLinkFullscreen(!!v)} />
                    <Label htmlFor="opt-fs" className="text-sm font-normal cursor-pointer">Auto fullscreen</Label>
                  </div>
                  <div className="flex items-center gap-2">
                    <Checkbox id="opt-mute" checked={linkMuted} onCheckedChange={(v) => setLinkMuted(!!v)} />
                    <Label htmlFor="opt-mute" className="text-sm font-normal cursor-pointer">Start muted (recommended for autoplay)</Label>
                  </div>
                  <div className="flex items-center gap-2">
                    <Checkbox id="opt-loop" checked={linkLoop} onCheckedChange={(v) => setLinkLoop(!!v)} />
                    <Label htmlFor="opt-loop" className="text-sm font-normal cursor-pointer">Loop schedule (off = stop after one round)</Label>
                  </div>
                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <Checkbox
                        id="opt-vol"
                        checked={linkVolume != null}
                        onCheckedChange={(v) => setLinkVolume(v ? 50 : null)}
                      />
                      <Label htmlFor="opt-vol" className="text-sm font-normal cursor-pointer flex-1">
                        Set BGM volume {linkVolume != null && <span className="text-muted-foreground">({linkVolume})</span>}
                      </Label>
                    </div>
                    {linkVolume != null && (
                      <Slider
                        value={[linkVolume]}
                        max={100}
                        step={1}
                        onValueChange={(v) => setLinkVolume(v[0] ?? 0)}
                      />
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <Checkbox id="opt-hideui" checked={linkHideUi} onCheckedChange={(v) => setLinkHideUi(!!v)} />
                    <Label htmlFor="opt-hideui" className="text-sm font-normal cursor-pointer">Hide bottom UI (mouse-move to reveal)</Label>
                  </div>
                  <div className="flex items-center gap-2">
                    <Checkbox
                      id="opt-startat"
                      checked={linkStartAt != null}
                      onCheckedChange={(v) => setLinkStartAt(v ? 1 : null)}
                    />
                    <Label htmlFor="opt-startat" className="text-sm font-normal cursor-pointer flex-1">Start at item</Label>
                    {linkStartAt != null && (
                      <input
                        type="number"
                        min={1}
                        max={Math.max(1, queue.length)}
                        value={linkStartAt}
                        onChange={(e) => {
                          const n = parseInt(e.target.value, 10);
                          setLinkStartAt(Number.isFinite(n) && n >= 1 ? n : 1);
                        }}
                        className="w-16 h-7 rounded-md border bg-background px-2 text-sm"
                      />
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <Checkbox
                      id="opt-date"
                      checked={!!linkDate}
                      onCheckedChange={(v) => setLinkDate(v ? new Date().toISOString().slice(0, 10) : "")}
                    />
                    <Label htmlFor="opt-date" className="text-sm font-normal cursor-pointer flex-1">Simulate date</Label>
                    {linkDate && (
                      <input
                        type="date"
                        value={linkDate}
                        onChange={(e) => setLinkDate(e.target.value)}
                        className="h-7 rounded-md border bg-background px-2 text-sm"
                      />
                    )}
                  </div>
                  <div className="flex justify-center">
                    <KioskQR value={url} />
                  </div>
                  <div className="rounded-md bg-muted p-2 text-xs break-all font-mono">{url}</div>
                  <Button
                    size="sm"
                    className="w-full"
                    onClick={async () => {
                      try {
                        await navigator.clipboard.writeText(url);
                        toast({ title: "Kiosk link copied", description: url });
                      } catch {
                        window.prompt("Copy this kiosk URL:", url);
                      }
                    }}
                  >
                    <Link2 className="w-4 h-4 mr-2" />
                    Copy URL
                  </Button>
                </div>
              );
            })()}
          </PopoverContent>
        </Popover>
        {manifest && (
          <span className="text-sm text-muted-foreground ml-auto">
            <span className="font-medium text-foreground">{manifest.schedule.name}</span>
            {" · "}{queue.length} items{bgmQueue.length > 0 ? ` · ${bgmQueue.length} BGM` : ""}
          </span>
        )}
      </Card>
      )}

      {error && (
        <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          <AlertCircle className="w-4 h-4 mt-0.5" />
          <span>{error}</span>
        </div>
      )}

      {kioskHint && (
        <div className="rounded-md border border-primary/40 bg-primary/10 p-3 text-sm">
          {kioskHint}
        </div>
      )}

      {/* Stage */}
      <Card className="overflow-hidden">
        <div
          ref={containerRef}
          className="relative aspect-video w-full bg-black flex items-center justify-center"
        >
          {!current && (
            <div className="text-muted-foreground text-sm">
              {loading ? "Loading…" : "Load a ZIP or folder to begin."}
            </div>
          )}
          {current?.kind === "image" && (
            <img src={current.url} alt={current.label} className="max-w-full max-h-full object-contain" />
          )}
          {current?.kind === "video" && (
            <video
              ref={videoRef}
              key={current.url + currentIdx}
              src={current.url}
              autoPlay={playing}
              muted={muted}
              playsInline
              className="max-w-full max-h-full object-contain"
              onEnded={advance}
            />
          )}
          {current?.kind === "design" && (
            <div className="absolute inset-0">
              <DesignStage
                key={current.project.id + currentIdx}
                project={current.project as any}
                resolveMediaUrl={resolveMediaUrl}
                muted={muted}
                playing={playing}
              />
            </div>
          )}
          {current?.kind === "widget" && (
            <div className="absolute inset-0">
              <WidgetRender config={current.config} />
            </div>
          )}
          {current?.kind === "blank" && (
            <div className="text-muted-foreground text-sm">{current.label}</div>
          )}

          {/* Hidden BGM player */}
          <audio
            ref={audioRef}
            onEnded={() => setBgmIdx((i) => (i + 1) % Math.max(bgmQueue.length, 1))}
          />

          {/* Floating overlay for kiosk/fullscreen — auto-hides after 3s idle */}
          {(isFullscreen || hideUi) && (
            <div
              className={`absolute inset-x-0 bottom-0 transition-opacity duration-300 ${
                showOverlay ? "opacity-100" : "opacity-0 pointer-events-none"
              }`}
            >
              <div className="m-4 rounded-lg bg-background/85 backdrop-blur shadow-lg border overflow-hidden">
                <div className="p-3 flex items-center gap-3">
                <Button size="icon" variant="ghost" onClick={togglePlay} disabled={!queue.length}>
                  {playing ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
                </Button>
                <Button size="icon" variant="ghost" onClick={skip} disabled={!queue.length}>
                  <SkipForward className="w-4 h-4" />
                </Button>
                <div className="text-xs text-muted-foreground tabular-nums w-16">
                  {queue.length > 0 ? `${currentIdx + 1} / ${queue.length}` : "0 / 0"}
                </div>
                <div className="flex-1 truncate text-sm">{current?.label ?? ""}</div>
                <div className="flex flex-col items-end leading-tight tabular-nums">
                  <span className="text-sm font-medium">
                    {new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false })}
                  </span>
                  <span className="text-[10px] text-muted-foreground">
                    {playing && current
                      ? `next in ${Math.max(0, Math.ceil((current.durationMs - (now - itemStartRef.current)) / 1000))}s`
                      : "paused"}
                  </span>
                </div>
                <Button size="icon" variant="ghost" onClick={() => setMuted((m) => !m)}>
                  {muted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
                </Button>
                <div className="w-28">
                  <Slider
                    value={[bgmVolume]}
                    max={100}
                    step={1}
                    onValueChange={(v) => setBgmVolume(v[0] ?? 0)}
                  />
                </div>
                <Button
                  size="icon"
                  variant="ghost"
                  onClick={() => document.exitFullscreen?.()}
                  title="Exit fullscreen (ESC)"
                >
                  <Maximize className="w-4 h-4" />
                </Button>
                </div>
                {/* Thin progress bar — visualises elapsed % of current item */}
                <div
                  ref={scrubBarRef}
                  className="relative h-1.5 w-full bg-muted cursor-pointer group touch-none"
                  role="slider"
                  aria-label="Seek current item"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={current ? Math.round(((now - itemStartRef.current) / current.durationMs) * 100) : 0}
                  onPointerDown={(e) => {
                    if (!current) return;
                    e.currentTarget.setPointerCapture(e.pointerId);
                    const rect = e.currentTarget.getBoundingClientRect();
                    setScrubFrac(Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width)));
                  }}
                  onPointerMove={(e) => {
                    if (scrubFrac == null) return;
                    const rect = e.currentTarget.getBoundingClientRect();
                    setScrubFrac(Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width)));
                  }}
                  onPointerUp={(e) => {
                    if (scrubFrac == null) return;
                    try { e.currentTarget.releasePointerCapture(e.pointerId); } catch { /* noop */ }
                    seekToFraction(scrubFrac);
                    setScrubFrac(null);
                  }}
                  onPointerCancel={() => setScrubFrac(null)}
                  title="Drag to seek"
                >
                  <div
                    className={`h-full bg-primary group-hover:bg-primary/80 pointer-events-none ${
                      scrubFrac == null ? "transition-[width] duration-1000 ease-linear" : ""
                    }`}
                    style={{
                      width: scrubFrac != null && current
                        ? `${scrubFrac * 100}%`
                        : playing && current
                        ? `${Math.min(100, Math.max(0, ((now - itemStartRef.current) / current.durationMs) * 100))}%`
                        : "0%",
                    }}
                  />
                  {scrubFrac != null && current && (
                    <div
                      className="absolute -translate-x-1/2 -translate-y-8 px-2 py-0.5 rounded bg-background border text-[10px] tabular-nums shadow pointer-events-none"
                      style={{ left: `${scrubFrac * 100}%` }}
                    >
                      {Math.round(scrubFrac * (current.durationMs / 1000))}s / {Math.round(current.durationMs / 1000)}s
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Transport */}
        {!hideUi && (
        <div className="flex items-center gap-3 p-3 border-t">
          <Button size="icon" variant="ghost" onClick={togglePlay} disabled={!queue.length}>
            {playing ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
          </Button>
          <Button size="icon" variant="ghost" onClick={skip} disabled={!queue.length}>
            <SkipForward className="w-4 h-4" />
          </Button>
          <div className="text-xs text-muted-foreground tabular-nums w-20">
            {queue.length > 0 ? `${currentIdx + 1} / ${queue.length}` : "0 / 0"}
          </div>
          <div className="flex-1 truncate text-sm text-muted-foreground">{current?.label ?? ""}</div>

          <Button size="icon" variant="ghost" onClick={() => setMuted((m) => !m)}>
            {muted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
          </Button>
          <div className="w-32">
            <Slider
              value={[bgmVolume]}
              max={100}
              step={1}
              onValueChange={(v) => setBgmVolume(v[0] ?? 0)}
            />
          </div>
          <Button
            size="icon"
            variant={loop ? "secondary" : "ghost"}
            onClick={() => setLoop((v) => !v)}
            title={loop ? "Loop on (click to play once)" : "Loop off (click to loop)"}
          >
            <Repeat className="w-4 h-4" />
          </Button>
          <Button size="icon" variant="ghost" onClick={requestFullscreen}>
            <Maximize className="w-4 h-4" />
          </Button>
        </div>
        )}
      </Card>
    </div>
  );
}
