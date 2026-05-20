import { useState, useCallback, useRef, useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useActiveOrg } from "@/contexts/ActiveOrgContext";
import { useUserOrgs } from "@/hooks/useUserOrgs";
import { useLanguage } from "@/contexts/LanguageContext";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription,
  AlertDialogFooter, AlertDialogAction, AlertDialogCancel,
} from "@/components/ui/alert-dialog";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger,
} from "@/components/ui/sheet";
import { useIsMobile } from "@/hooks/use-mobile";
import { supabase } from "@/integrations/supabase/client";
import { uploadMediaFile } from "@/lib/uploadMedia";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { VideoThumb } from "@/components/media/VideoThumb";
import { LayoutThumb } from "@/components/studio/LayoutThumb";
import { ColorSwatchInput } from "@/components/studio/ColorSwatchInput";
import { ZoneAnimatedWrapper } from "@/components/studio/ZoneAnimatedWrapper";
import { MediaHoverPreview, type MediaHoverPreviewData } from "@/components/media/MediaHoverPreview";
import {
  formatBytesCompact,
  formatDimensions,
  formatDuration as formatMediaDuration,
  getDurationSec as getMediaDurationSec,
  getSizeBytes as getMediaSizeBytes,
} from "@/lib/mediaFormat";
import {
  Monitor, Smartphone, LayoutGrid, Columns2, Rows2, Square,
  Type, ImageIcon, Film, Palette, Upload, Trash2, ChevronRight,
  Utensils, PartyPopper, ShoppingBag, Sun, Gift, Coffee,
  X, Plus, AlignLeft, AlignCenter, AlignRight, Minus,
  Save, FolderOpen, FilePlus, ChevronLeft, ChevronRightIcon, Play, Pause,
  Layers, Code2, Clock, Calendar, Globe, CloudSun, QrCode, Timer, Youtube, Move, Maximize2, Lock, Unlock, Check,
  Search, ArrowUpDown, ArrowDownAZ, ArrowUpAZ, GripVertical, MoreHorizontal, PanelLeft, PanelRight, Edit3, Eye, EyeOff, List, ChevronUp, ChevronDown,
  Music, Volume2, Settings2, VolumeX,
  Download, Loader2, Radio, Megaphone, Rocket,
  SlidersHorizontal, CheckCircle2, AlertTriangle,
} from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Label } from "@/components/ui/label";
import { QRCodeSVG } from "qrcode.react";
import Hls from "hls.js";
import { useWidgets, widgetsToStudioRows } from "@/hooks/useWidgets";
import { useInstalledApps } from "@/contexts/InstalledAppsContext";
import { WidgetPreviewCard } from "@/components/widgets/WidgetPreviewCard";
import QueueDisplayWidget from "@/components/widgets/QueueDisplayWidget";
import MeetingRoomWidget from "@/components/widgets/MeetingRoomWidget";
import { StudioPreviewDialog } from "@/components/studio/StudioPreviewDialog";
import { QuickPublishDialog } from "@/components/studio/QuickPublishDialog";
import {
  STUDIO_DATA_VERSION,
  getStudioSourceCacheStatus,
  getStudioSourceStatRows,
  getStudioLayouts,
  getStudioTemplates,
  invalidateStudioSourceCache,
  saveUserScene,
  deleteUserScene,
  renameUserScene,
  type StudioIconKey,
} from "@/lib/studioData";
import { type TranslationKey } from "@/contexts/translations";
import JSZip from "jszip";
import { useProfiles } from "@/contexts/ProfilesContext";
import { Users, User as UserIcon, Building2 } from "lucide-react";
import {
  checkDesignProjectReferences,
  unassignProjectReference,
  queueDesignProjectDelete,
  cancelDesignProjectDelete,
  fetchPendingDeleteRequests,
  type ReferenceItem,
} from "@/lib/referenceCheck";
import { formatUserError } from "@/lib/formatUserError";

// ── Types ──────────────────────────────────────────────────────────

interface WidgetParamDef {
  key: string;
  label: string;
  label_zh?: string;
  type: "text" | "select" | "color" | "toggle" | "number";
  default?: unknown;
  options?: Array<{ value: string; label: string; label_zh?: string }>;
  min?: number;
  max?: number;
  transparent?: boolean;
}

interface WidgetConfig {
  widgetType?: string;
  text?: string;
  speed?: string;
  url?: string;
  clockStyle?: string;
  format?: string;
  timezone?: string;
  showDate?: boolean;
  qrcodeContent?: string;
  qrcodeSize?: number;
  countdownTitle?: string;
  targetDate?: string;
  youtubeUrl?: string;
  youtubeMuted?: boolean;
  youtubeMuteBgm?: boolean;
  youtubeVolume?: number;
  youtubeFit?: string; // "cover" | "contain" | "stretch"
  streamUrl?: string;
  streamMuted?: boolean;
  streamFit?: string;
  streamProtocol?: string;
  city?: string;
  bgColor?: string;
  textColor?: string;
  fontSize?: string;
  animation?: string;
  paramsSchema?: WidgetParamDef[];
  params?: Record<string, unknown>;
  widgetScope?: string;   // 'system' | 'app' | 'external'
  widgetAppId?: string;   // store_apps.id (uuid) — set for external scope widgets
  [key: string]: unknown;
}

interface DbMediaItem {
  id: string;
  name: string;
  original_name?: string | null;
  type: string;
  url?: string;
  thumbnail?: string;
  size_bytes?: number | null;
  width?: number | null;
  height?: number | null;
  duration_seconds?: number | null;
  mime_type?: string | null;
  source_codec?: string | null;
  source_container?: string | null;
  transcode_status?: string | null;
  created_at?: string;
}

interface DbWidgetItem {
  id: string;
  name: string;
  url: string;
  config?: WidgetConfig | null;
  created_at?: string;
}

type PickerRaw = DbMediaItem | DbWidgetItem;

interface PickerPayload {
  kind: "media" | "widget";
  raw: PickerRaw;
}

type AspectRatio = "16:9" | "9:16";

interface Resolution {
  id: string;        // "fhd" | "uhd-4k" | "uhd-8k" | "hd" | "custom"
  labelKey: string;  // i18n key
  width: number;
  height: number;
}

// 解析度預設（依 aspect 分組）
const RESOLUTION_PRESETS: Record<AspectRatio, Resolution[]> = {
  "16:9": [
    { id: "hd",     labelKey: "studioRes720p",  width: 1280, height: 720 },
    { id: "fhd",    labelKey: "studioResFHD",   width: 1920, height: 1080 },
    { id: "uhd-4k", labelKey: "studioRes4K",    width: 3840, height: 2160 },
    { id: "uhd-8k", labelKey: "studioRes8K",    width: 7680, height: 4320 },
  ],
  "9:16": [
    { id: "hd",     labelKey: "studioRes720p",  width: 720,  height: 1280 },
    { id: "fhd",    labelKey: "studioResFHD",   width: 1080, height: 1920 },
    { id: "uhd-4k", labelKey: "studioRes4K",    width: 2160, height: 3840 },
    { id: "uhd-8k", labelKey: "studioRes8K",    width: 4320, height: 7680 },
  ],
};

const DEFAULT_RESOLUTION_ID = "uhd-4k";

const CUSTOM_RES_STORAGE_KEY = "studio:lastCustomRes";
const MY_PRESETS_STORAGE_KEY = "studio:myResPresets";
const STUDIO_SESSION_KEY = "studio:session";
const STUDIO_DRAFT_KEY = "studio:draft";

// ── Auto-name helper ─────────────────────────────────────────────────────────
// Generates a unique project name in the format PRJ{YYMMDD}{XX} where XX is
// the next free 2-digit hex sequence (00–FF) for today.
function generateProjectName(existingNames: string[]): string {
  const now = new Date();
  const yy = String(now.getFullYear()).slice(2);
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  const prefix = `PRJ${yy}${mm}${dd}`;
  const pattern = new RegExp(`^${prefix}([0-9A-Fa-f]{2})$`);
  const used = new Set<number>();
  for (const name of existingNames) {
    const m = name.match(pattern);
    if (m) used.add(parseInt(m[1], 16));
  }
  for (let i = 0; i <= 0xff; i++) {
    if (!used.has(i)) {
      return `${prefix}${i.toString(16).toUpperCase().padStart(2, "0")}`;
    }
  }
  // Extremely unlikely: all 256 slots used today
  return `${prefix}${(Date.now() & 0xff).toString(16).toUpperCase().padStart(2, "0")}X`;
}

type StudioSession = {
  projectId: string | null;
  selectedZone: string | null;
  selectedOverlay: string | null;
  layoutPanelOpen: boolean;
  mediaLibraryOpen: boolean;
  sidebarTab: string;
};

function loadStudioSession(): Partial<StudioSession> | null {
  try {
    const raw = localStorage.getItem(STUDIO_SESSION_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw);
    if (!p || typeof p !== "object") return null;
    return {
      projectId: typeof p.projectId === "string" ? p.projectId : null,
      selectedZone: typeof p.selectedZone === "string" ? p.selectedZone : null,
      selectedOverlay: typeof p.selectedOverlay === "string" ? p.selectedOverlay : null,
      layoutPanelOpen: typeof p.layoutPanelOpen === "boolean" ? p.layoutPanelOpen : undefined,
      mediaLibraryOpen: typeof p.mediaLibraryOpen === "boolean" ? p.mediaLibraryOpen : undefined,
      sidebarTab: typeof p.sidebarTab === "string" ? p.sidebarTab : undefined,
    };
  } catch { return null; }
}

function saveStudioSession(s: StudioSession) {
  try { localStorage.setItem(STUDIO_SESSION_KEY, JSON.stringify(s)); } catch { /* ignore */ }
}

// ── Auto-draft types & helpers ────────────────────────────────────────────────
// A draft captures the full unsaved canvas state so it can be recovered after
// an unexpected page reload (ChunkLoadError auto-retry, HMR, tab discard, etc.).
type StudioDraft = {
  v: 1;
  orgId: string | null;
  projectId: string | null;
  projectName: string;
  savedAt: string; // ISO timestamp
  aspect: AspectRatio;
  resolution: { id: string; width: number; height: number };
  outputPages: Record<string, Array<{ id: string; name: string; zones: Zone[]; overlays: OverlayBlock[] }>>;
  outputActivePageId: Record<string, string>;
  outputMode: string;
  outputCount: number;
  activeOutput: number;
  bgmItems: MediaItem[];
  bgmVolume: number;
  bgmAudioSource: string;
};

function loadStudioDraft(): StudioDraft | null {
  try {
    const raw = localStorage.getItem(STUDIO_DRAFT_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw);
    if (!p || typeof p !== "object" || p.v !== 1) return null;
    return p as StudioDraft;
  } catch { return null; }
}

function saveStudioDraft(draft: StudioDraft) {
  try { localStorage.setItem(STUDIO_DRAFT_KEY, JSON.stringify(draft)); } catch { /* ignore */ }
}

function clearStudioDraft() {
  try { localStorage.removeItem(STUDIO_DRAFT_KEY); } catch { /* ignore */ }
}

type StoredCustomRes = { w: string; h: string; rows: string; cols: string; applyGrid: boolean };
type MyResPreset = { id: string; name: string; w: number; h: number; rows: number; cols: number; applyGrid: boolean };

function loadStoredCustomRes(): StoredCustomRes | null {
  try {
    const raw = localStorage.getItem(CUSTOM_RES_STORAGE_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw);
    if (!p || typeof p !== "object") return null;
    return {
      w: typeof p.w === "string" ? p.w : "1920",
      h: typeof p.h === "string" ? p.h : "1080",
      rows: typeof p.rows === "string" ? p.rows : "1",
      cols: typeof p.cols === "string" ? p.cols : "1",
      applyGrid: !!p.applyGrid,
    };
  } catch { return null; }
}

function loadMyResPresets(): MyResPreset[] {
  try {
    const raw = localStorage.getItem(MY_PRESETS_STORAGE_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    return arr
      .filter((p: unknown) => p !== null && typeof p === "object" && p !== null
        && typeof (p as Record<string, unknown>).id === "string"
        && typeof (p as Record<string, unknown>).name === "string"
        && Number.isFinite((p as Record<string, unknown>).w)
        && Number.isFinite((p as Record<string, unknown>).h))
      .map((p: unknown) => {
        const pr = p as Record<string, unknown>;
        return ({
        id: pr.id as string,
        name: pr.name as string,
        w: Number(pr.w),
        h: Number(pr.h),
        rows: Number.isFinite(pr.rows as number) ? Number(pr.rows) : 1,
        cols: Number.isFinite(pr.cols as number) ? Number(pr.cols) : 1,
        applyGrid: !!pr.applyGrid,
      });
      });
  } catch { return []; }
}

function saveMyResPresets(list: MyResPreset[]) {
  try { localStorage.setItem(MY_PRESETS_STORAGE_KEY, JSON.stringify(list)); } catch { /* ignore */ }
}

function getDefaultResolution(aspect: AspectRatio): Resolution {
  const list = RESOLUTION_PRESETS[aspect];
  return list.find((r) => r.id === DEFAULT_RESOLUTION_ID) || list[0];
}

// 由專案的 zones JSONB 內嵌 _meta 取出解析度資訊（給專案卡片徽章用）
function getProjectResolutionBadge(zones: unknown): { label: string; dims: string } | null {
  if (!Array.isArray(zones)) return null;
  const meta = zones.find((z: unknown) => z !== null && typeof z === "object" && (z as Record<string, unknown>)._meta && (z as Record<string, unknown>).resolution) as Record<string, unknown> | undefined;
  if (!meta?.resolution) return null;
  const res = meta.resolution as { id: string; width: number; height: number };
  const { id, width, height } = res;
  const labelMap: Record<string, string> = { hd: "HD", fhd: "FHD", "uhd-4k": "4K", "uhd-8k": "8K", custom: "Custom" };
  const label = labelMap[id] || "—";
  return { label, dims: `${width}×${height}` };
}

function gcd(a: number, b: number): number { return b === 0 ? a : gcd(b, a % b); }

/** Short, uppercase audio format label (e.g. "MP3", "WAV"). Used in BGM picker. */
function getBgmFormatLabel(item: { mime_type?: string | null; name?: string | null; original_name?: string | null; url?: string | null }): string {
  const mime = (item.mime_type || "").toLowerCase();
  if (mime) {
    if (mime.includes("mpeg") || mime.includes("mp3")) return "MP3";
    if (mime.includes("wav") || mime.includes("wave")) return "WAV";
    if (mime.includes("ogg") || mime.includes("opus")) return "OGG";
    if (mime.includes("aac")) return "AAC";
    if (mime.includes("flac")) return "FLAC";
    if (mime.includes("mp4") || mime.includes("m4a")) return "M4A";
    if (mime.includes("webm")) return "WEBM";
  }
  const src = (item.original_name || item.name || item.url || "").toLowerCase();
  const m = src.match(/\.([a-z0-9]{2,5})(?:\?|#|$)/);
  if (m) {
    const ext = m[1];
    if (ext === "mp3" || ext === "wav" || ext === "ogg" || ext === "aac" || ext === "flac" || ext === "m4a" || ext === "webm" || ext === "opus") {
      return ext === "opus" ? "OGG" : ext.toUpperCase();
    }
  }
  return "AUDIO";
}

/**
 * Parse an audio duration string into total seconds.
 * Accepts "m:ss", "h:mm:ss", or numeric-string seconds (e.g. "42", "42.5").
 * Returns 0 for unparseable / empty input.
 */
function parseAudioDurationSec(raw: string | null | undefined): number {
  if (!raw) return 0;
  const s = String(raw).trim();
  if (!s) return 0;
  // h:mm:ss or m:ss
  const parts = s.split(":");
  if (parts.length === 2 || parts.length === 3) {
    const nums = parts.map((p) => Number(p));
    if (nums.every((n) => Number.isFinite(n) && n >= 0)) {
      if (nums.length === 2) return Math.round(nums[0] * 60 + nums[1]);
      return Math.round(nums[0] * 3600 + nums[1] * 60 + nums[2]);
    }
  }
  const n = parseFloat(s);
  return Number.isFinite(n) && n > 0 ? Math.max(0, Math.round(n)) : 0;
}

/** Accepts "1:23" or numeric-string seconds and returns "m:ss". */
function formatBgmDuration(raw: string): string {
  if (/^\d+:\d{2}$/.test(raw)) return raw;
  const secs = Math.max(0, Math.round(parseFloat(raw) || 0));
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

// 由 width/height 推導 aspect（嚴格只支援 16:9 / 9:16；其他比例歸到較接近者）
function inferAspect(w: number, h: number): AspectRatio {
  return w >= h ? "16:9" : "9:16";
}

interface MediaItem {
  id: string;
  type: "image" | "video" | "widget" | "audio";
  url: string;
  name: string;
  duration?: number; // seconds for carousel auto-advance
  widgetConfig?: WidgetConfig;
  /** 0-100, only used for video items. undefined = use default 100. */
  volume?: number;
  /** Mute the item's own audio. For videos: silences the video. When true the BGM track plays. */
  muted?: boolean;
  /** Per-item fill mode. Falls back to zone-level ZoneContent.fitMode if undefined. */
  fitMode?: "cover-x" | "cover-y" | "contain" | "stretch";
}

type CarouselTransition = "fade" | "slide" | "zoom" | "none";

interface ZoneContent {
  type: "text" | "media" | "color" | "widget";
  value: string;
  bgColor?: string;
  fontSize?: number;
  textColor?: string;
  textAlign?: "left" | "center" | "right";
  mediaItems?: MediaItem[];
  carouselInterval?: number; // seconds
  carouselTransition?: CarouselTransition;
  widgetId?: string;
  widgetName?: string;
  widgetConfig?: WidgetConfig;
  fitMode?: "cover-x" | "cover-y" | "contain" | "stretch"; // 媒體填滿方式
}

interface Zone {
  id: string;
  x: number; y: number; w: number; h: number;
  label: string;
  content?: ZoneContent;
}

interface OverlayBlock {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  label: string;
  opacity: number; // 0-100
  zIndex: number;
  locked?: boolean;
  content?: ZoneContent;
}

interface DesignProject {
  id: string;
  name: string;
  aspect: AspectRatio;
  zones: Zone[];
  overlays?: OverlayBlock[];
  created_at: string;
  updated_at: string;
  team_id?: string | null;
  collab_scope?: string | null;
  org_id?: string | null;
  created_by?: string | null;
}

interface LayoutPreset {
  id: string;
  nameKey: string;
  icon: React.ReactNode;
  zones: Omit<Zone, "content">[];
  aspect?: AspectRatio; // undefined = 通用; 否則僅在該 aspect 下顯示
}

interface TemplateItem {
  id: string;
  nameKey: string;
  icon: React.ReactNode;
  color: string;
  zones: Zone[];
  aspect: AspectRatio;
}

// ── Layout preset thumbnail (SVG mini-preview, aspect-aware) ───────
// LayoutThumb / ColorSwatchInput / ZoneAnimatedWrapper extracted to
// src/components/studio/ — see imports near the top of this file.

// ── Scene snapshot thumbnail (div-based, renders actual zone content) ─
type SceneZone = { id: string; x: number; y: number; w: number; h: number; label: string; content?: unknown };
function SceneThumb({ zones }: { zones: SceneZone[] }) {
  return (
    <div className="relative w-full h-full overflow-hidden bg-muted">
      {zones.map((z) => {
        const c = z.content as ZoneContent | undefined;
        const base: React.CSSProperties = {
          position: "absolute",
          left: `${z.x}%`, top: `${z.y}%`,
          width: `${z.w}%`, height: `${z.h}%`,
          overflow: "hidden",
        };

        if (!c) {
          return (
            <div key={z.id} style={base} className="flex items-center justify-center bg-muted border border-border/30">
              <span className="text-[5px] font-semibold text-muted-foreground">{z.label}</span>
            </div>
          );
        }

        if (c.type === "color") {
          return <div key={z.id} style={{ ...base, background: c.bgColor || "hsl(var(--muted))" }} />;
        }

        if (c.type === "text") {
          return (
            <div key={z.id} style={{ ...base, background: c.bgColor || "hsl(var(--muted))" }}
              className="flex items-center justify-center p-0.5">
              <span style={{ color: c.textColor || "#fff", fontSize: "5px", lineHeight: 1.2,
                textAlign: (c.textAlign as React.CSSProperties["textAlign"]) || "center",
                display: "-webkit-box", WebkitLineClamp: 4, WebkitBoxOrient: "vertical" as const,
                overflow: "hidden", wordBreak: "break-all" }}>
                {c.value}
              </span>
            </div>
          );
        }

        if (c.type === "media" && Array.isArray(c.mediaItems) && c.mediaItems.length > 0) {
          const first = c.mediaItems[0] as { type?: string; url?: string; name?: string };
          if (first?.url && (first.type === "image" || first.url.startsWith("data:image"))) {
            return (
              <div key={z.id} style={base}>
                <img src={first.url} alt={first.name || ""} style={{ width: "100%", height: "100%", objectFit: "cover" }} loading="lazy" />
              </div>
            );
          }
          if (first?.url && first.type === "video") {
            return (
              <div key={z.id} style={base}>
                <VideoThumb src={first.url} name={first.name || ""} showPlayHint={false} className="w-full h-full" />
              </div>
            );
          }
        }

        // widget or fallback
        return (
          <div key={z.id} style={{ ...base, background: c.bgColor || "hsl(var(--muted)/0.6)" }}
            className="flex items-center justify-center">
            <span style={{ color: c.textColor || "hsl(var(--muted-foreground))", fontSize: "5px", fontWeight: 600 }}>{z.label}</span>
          </div>
        );
      })}
    </div>
  );
}

// ── Shared layout/template presets ────────────────────────────────
const STUDIO_ICON_MAP: Record<StudioIconKey, React.ReactNode> = {
  square: <Square className="w-4 h-4" />,
  columns2: <Columns2 className="w-4 h-4" />,
  rows2: <Rows2 className="w-4 h-4" />,
  layoutGrid: <LayoutGrid className="w-4 h-4" />,
  utensils: <Utensils className="w-5 h-5" />,
  partyPopper: <PartyPopper className="w-5 h-5" />,
  shoppingBag: <ShoppingBag className="w-5 h-5" />,
  sun: <Sun className="w-5 h-5" />,
  gift: <Gift className="w-5 h-5" />,
  coffee: <Coffee className="w-5 h-5" />,
};

function buildLayoutPresets(): LayoutPreset[] {
  return getStudioLayouts().map((preset) => ({
  ...preset,
  icon: STUDIO_ICON_MAP[preset.iconKey],
  }));
}

function buildTemplatePresets(): TemplateItem[] {
  return getStudioTemplates().map((template) => ({
  ...template,
  icon: STUDIO_ICON_MAP[template.iconKey],
  })) as TemplateItem[];
}

const INITIAL_LAYOUT_PRESETS = buildLayoutPresets();

// ── Carousel Preview ───────────────────────────────────────────────
function CarouselPreview({ items, transition = "fade", fitMode = "cover-x", unmuteVideo = false, playing = true, pinToIdx }: { items: MediaItem[]; transition?: CarouselTransition; fitMode?: "cover-x" | "cover-y" | "contain" | "stretch"; unmuteVideo?: boolean; playing?: boolean; pinToIdx?: number }) {
  const [idx, setIdx] = useState(0);
  const [prevIdx, setPrevIdx] = useState(0);
  const [animating, setAnimating] = useState(false);

  useEffect(() => {
    if (pinToIdx !== undefined || !playing || items.length <= 1) return;
    const currentDuration = (items[idx]?.duration || 5) * 1000;
    const timer = setTimeout(() => {
      setPrevIdx(idx);
      setAnimating(true);
      setIdx((i) => (i + 1) % items.length);
      setTimeout(() => setAnimating(false), 600);
    }, currentDuration);
    return () => clearTimeout(timer);
  }, [playing, items.length, idx, items, pinToIdx]);

  // Sync internal idx when pinToIdx changes
  useEffect(() => {
    if (pinToIdx !== undefined) {
      const safeIdx = Math.min(Math.max(0, pinToIdx), Math.max(0, items.length - 1));
      setIdx(safeIdx);
      setPrevIdx(safeIdx);
    }
  }, [pinToIdx, items.length]);

  if (items.length === 0) return null;

  const renderItem = (item: MediaItem, isCurrent: boolean) => {
    const eff = item.fitMode ?? fitMode; // per-item override, or zone default
    const itemVideoStyle: React.CSSProperties = {
      width: "100%", height: "100%",
      objectFit: eff === "contain" ? "contain" : eff === "stretch" ? "fill" : "cover",
    };
    const itemImgStyle: React.CSSProperties =
      eff === "cover-y" ? { width: "auto", height: "100%", maxWidth: "none" } :
      eff === "contain" ? { width: "100%", height: "100%", objectFit: "contain" } :
      eff === "stretch" ? { width: "100%", height: "100%", objectFit: "fill" } :
      /* cover-x */ { width: "100%", height: "auto", maxHeight: "none" };

    if (item.type === "widget" && item.widgetConfig) {
      return <WidgetZonePreview config={item.widgetConfig} />;
    }
    if (item.type === "image" && (item.url.startsWith("data:") || item.url.startsWith("http"))) {
      return <img src={item.url} alt={item.name} style={itemImgStyle} />;
    }
    if (item.type === "video" && (item.url.startsWith("data:") || item.url.startsWith("http") || item.url.startsWith("blob:"))) {
      if (!isCurrent) return null;
      const isMuted = !unmuteVideo || !!item.muted;
      const volFraction = Math.max(0, Math.min(1, (item.volume ?? 100) / 100));
      return (
        <video
          key={`${item.id}-${isMuted}`}
          ref={(el) => { if (el) el.volume = volFraction; }}
          src={item.url}
          style={itemVideoStyle}
          autoPlay
          muted={isMuted}
          data-natural-muted={isMuted ? "1" : "0"}
          data-volume={volFraction}
          playsInline
          loop={items.length === 1}
        />
      );
    }
    const Icon = item.type === "image" ? ImageIcon : Film;
    return (
      <div className="flex flex-col items-center gap-1 text-muted-foreground">
        <Icon className="w-8 h-8 opacity-50" />
        <span className="text-[10px] opacity-60 truncate max-w-[80%]">{item.name}</span>
      </div>
    );
  };

  const getTransitionStyle = (isCurrent: boolean): React.CSSProperties => {
    const base: React.CSSProperties = {
      position: "absolute", inset: 0, overflow: "hidden",
      display: "flex", alignItems: "center", justifyContent: "center",
      transition: "all 0.6s cubic-bezier(0.4, 0, 0.2, 1)",
    };
    if (transition === "fade") {
      return { ...base, opacity: isCurrent ? 1 : 0 };
    }
    if (transition === "slide") {
      return {
        ...base,
        opacity: isCurrent ? 1 : 0,
        transform: isCurrent ? "translateX(0)" : (animating ? "translateX(-100%)" : "translateX(100%)"),
      };
    }
    if (transition === "zoom") {
      return {
        ...base,
        opacity: isCurrent ? 1 : 0,
        transform: isCurrent ? "scale(1)" : "scale(1.15)",
      };
    }
    // none
    return { ...base, opacity: isCurrent ? 1 : 0, transition: "none" };
  };

  return (
    <div className="w-full h-full relative overflow-hidden">
      {items.map((item, i) => (
        <div key={item.id + i} style={getTransitionStyle(i === idx)}>
          {renderItem(item, i === idx)}
        </div>
      ))}
      {items.length > 1 && (
        <div className="absolute bottom-1.5 left-1/2 -translate-x-1/2 flex gap-1 z-10">
          {items.map((_, i) => (
            <span key={i} className={`w-1.5 h-1.5 rounded-full transition-all duration-300 ${i === idx ? "bg-white scale-125" : "bg-white/40"}`} />
          ))}
        </div>
      )}
    </div>
  );
}

// ── Media Library Dock (bottom panel) ──────────────────────────────
function MediaLibraryDock({
  dbMedia,
  dbWidgets,
  activeOrgId,
  onMediaUploaded,
  onAddItems,
  selectedZoneLabel,
  height,
  onHeightChange,
  variant = "bottom",
}: {
  dbMedia: { id: string; name: string; original_name?: string | null; type: string; url?: string; thumbnail?: string; size_bytes?: number | null; width?: number | null; height?: number | null; duration_seconds?: number | null; mime_type?: string | null; created_at?: string }[];
  dbWidgets: { id: string; name: string; url: string; created_at?: string }[];
  activeOrgId?: string;
  onMediaUploaded?: () => Promise<void> | void;
  onAddItems: (items: PickerPayload[]) => void;
  selectedZoneLabel?: string | null;
  height?: number;
  onHeightChange?: (h: number) => void;
  variant?: "bottom" | "side";
}) {
  const { t } = useLanguage();
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"all" | "image" | "video" | "widget">("all");
  const [sort, setSort] = useState<"name-asc" | "name-desc" | "newest" | "oldest">("newest");
  const VIEW_MODE_LS_KEY = "studio-medialib-viewmode";
  const [viewMode, setViewMode] = useState<"grid" | "list">(() => {
    try { return (localStorage.getItem(VIEW_MODE_LS_KEY) as "grid" | "list") || "grid"; } catch { return "grid"; }
  });
  useEffect(() => { try { localStorage.setItem(VIEW_MODE_LS_KEY, viewMode); } catch { /* ignore */ } }, [viewMode]);
  const [isUploading, setIsUploading] = useState(false);
  const [isDropActive, setIsDropActive] = useState(false);
  const [renameTarget, setRenameTarget] = useState<{ id: string; defaultName: string; originalFileName: string } | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const uploadInputRef = useRef<HTMLInputElement | null>(null);
  const resizingRef = useRef(false);
  // Multi-select: Cmd/Ctrl-click to toggle, Shift-click for range, plain click = add (or select if no zone)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const lastClickedIdRef = useRef<string | null>(null);

  // Resize handle: drag up/down to change dock height (180–600px) — only when bottom variant
  useEffect(() => {
    if (variant !== "bottom" || !onHeightChange) return;
    const onMove = (e: MouseEvent) => {
      if (!resizingRef.current) return;
      const newH = Math.max(180, Math.min(600, window.innerHeight - e.clientY - 8));
      onHeightChange(newH);
    };
    const onUp = () => { resizingRef.current = false; document.body.style.cursor = ""; document.body.style.userSelect = ""; };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => { window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); };
  }, [onHeightChange, variant]);

  const items = useMemo(() => {
    const list: { id: string; kind: "media" | "widget"; name: string; searchName: string; type?: string; icon: React.ReactNode; thumbnail?: string; raw: PickerRaw; createdAt?: string }[] = [];
    dbMedia.forEach((m) => {
      // Audio is managed exclusively from the BGM track on the timeline.
      // Hide audio items here so users don't accidentally add them into a zone/overlay.
      if (m.type === "audio") return;
      const displayName = m.original_name?.trim() || m.name;
      const previewThumb = m.type === "video"
        ? (m.thumbnail || undefined)
        : (m.thumbnail || m.url);
      list.push({
        id: `media-${m.id}`, kind: "media", name: displayName, searchName: `${displayName} ${m.name}`.toLocaleLowerCase(), type: m.type,
        icon: m.type === "image" ? <ImageIcon className="w-3.5 h-3.5 text-primary shrink-0" /> : <Film className="w-3.5 h-3.5 text-primary shrink-0" />,
        thumbnail: previewThumb, raw: m, createdAt: m.created_at,
      });
    });
    dbWidgets.forEach((w) => {
      let config: WidgetConfig | null = null;
      try {
        const raw = w.url?.startsWith("widget://") ? w.url.slice("widget://".length) : w.url;
        if (raw?.startsWith("{")) config = JSON.parse(raw) as WidgetConfig;
      } catch {}
      const WidgetIcon = config?.widgetType === "clock" ? Clock : config?.widgetType === "date" ? Calendar : config?.widgetType === "webpage" ? Globe : config?.widgetType === "stream" ? Radio : config?.widgetType === "announcement" ? Megaphone : Code2;
      list.push({
        id: `widget-${w.id}`, kind: "widget", name: w.name, searchName: w.name.toLocaleLowerCase(),
        icon: <WidgetIcon className="w-3.5 h-3.5 text-accent-foreground shrink-0" />,
        raw: { ...w, config }, createdAt: w.created_at,
      });
    });
    return list;
  }, [dbMedia, dbWidgets]);

  const filtered = useMemo(() => {
    let f = items;
    if (filter === "image") f = f.filter((i) => i.kind === "media" && i.type === "image");
    else if (filter === "video") f = f.filter((i) => i.kind === "media" && i.type === "video");
    else if (filter === "widget") f = f.filter((i) => i.kind === "widget");
    if (search.trim()) {
      const q = search.trim().toLocaleLowerCase();
      f = f.filter((i) => i.searchName.includes(q));
    }
    return [...f].sort((a, b) => {
      if (sort === "name-asc") return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" });
      if (sort === "name-desc") return b.name.localeCompare(a.name, undefined, { numeric: true, sensitivity: "base" });
      if (sort === "newest") return (b.createdAt || "").localeCompare(a.createdAt || "");
      return (a.createdAt || "").localeCompare(b.createdAt || "");
    });
  }, [items, filter, search, sort]);

  const handleFilesUpload = async (files: File[]) => {
    if (!files.length) return;
    if (!activeOrgId) { toast.error(t("teamSelectOrg")); return; }
    setIsUploading(true);
    let lastUploadedId: string | null = null;
    let lastFileName = "";
    let successCount = 0;
    let pendingTranscodeCount = 0;
    for (const file of files) {
      const result = await uploadMediaFile(file, { orgId: activeOrgId });
      if (!result.ok) {
        const code = result.errorCode;
        const msg =
          code === "unsupported" ? t("mediaUnsupported")
          : code === "file_too_large" ? t("mediaFileTooLarge")
          : code === "storage_full" || code === "media_capacity_exceeded" ? t("planLimitMedia")
          : code === "image_resolution" ? `${t("mediaImageSpecResolution")}（${result.errorDetail || ""}）`
          : code === "image_too_large" ? `${t("mediaImageSpecTooLarge")}（${result.errorDetail || ""}）`
          : code === "image_cmyk" ? `${t("mediaImageSpecCmyk")}（${result.errorDetail || ""}）`
          : code === "image_auto_convert_failed" ? t("mediaImageAutoConvertFailed")
          : code === "video_resolution" ? `${t("mediaVideoSpecResolution")}（${result.errorDetail || ""}）`
          : code === "duplicate_file" ? `${t("mediaDuplicate")}: ${result.duplicateName || file.name}`
          : result.errorDetail || t("mediaUnsupported");
        toast.error(`${file.name}：${msg}`);
        continue;
      }
      successCount++;
      if (result.data?.transcodeStatus === "pending_transcode") pendingTranscodeCount++;
      lastUploadedId = result.data!.id;
      lastFileName = file.name;
    }
    setIsUploading(false);
    if (successCount > 0) {
      toast.success(`${t("mediaUploaded")}：${successCount}`);
      if (pendingTranscodeCount > 0) toast.warning(t("transcodeUploadNote"), { duration: 6000 });
      await onMediaUploaded?.();
      if (lastUploadedId && files.length === 1) {
        const baseName = lastFileName.replace(/\.[^.]+$/, "");
        setRenameTarget({ id: lastUploadedId, defaultName: baseName, originalFileName: lastFileName });
        setRenameValue(baseName);
      }
    }
  };

  const onDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setIsDropActive(false);
    const files = Array.from(e.dataTransfer.files || []);
    if (files.length) await handleFilesUpload(files);
  };

  const submitRename = async () => {
    if (!renameTarget) return;
    const newName = renameValue.trim();
    if (!newName || newName === renameTarget.defaultName) { setRenameTarget(null); return; }
    const { error } = await supabase.from("media_items").update({ original_name: newName }).eq("id", renameTarget.id);
    if (error) { toast.error(formatUserError(error, t)); return; }
    toast.success(t("studioRenameSaved"));
    await onMediaUploaded?.();
    setRenameTarget(null);
  };

  // Prune selectedIds when filtered list changes (avoid stale ids)
  useEffect(() => {
    setSelectedIds((prev) => {
      if (prev.size === 0) return prev;
      const validIds = new Set(items.map((i) => i.id));
      let changed = false;
      const next = new Set<string>();
      prev.forEach((id) => {
        if (validIds.has(id)) next.add(id);
        else changed = true;
      });
      return changed ? next : prev;
    });
  }, [items]);

  const clearSelection = () => { setSelectedIds(new Set()); lastClickedIdRef.current = null; };

  const isVideoNotReady = (item: typeof items[number]): boolean => {
    if (item.kind !== "media" || item.type !== "video") return false;
    const s = (item.raw as DbMediaItem).transcode_status;
    return s === "pending_transcode" || s === "transcoding" || s === "failed";
  };

  const handleItemClick = (item: typeof items[number], e: React.MouseEvent) => {
    if (isVideoNotReady(item)) {
      toast.warning(t("transcodeUploadNote"));
      return;
    }
    const isMeta = e.ctrlKey || e.metaKey;
    const isShift = e.shiftKey;

    // Cmd/Ctrl-click: toggle selection (no zone add)
    if (isMeta) {
      setSelectedIds((prev) => {
        const next = new Set(prev);
        if (next.has(item.id)) next.delete(item.id); else next.add(item.id);
        return next;
      });
      lastClickedIdRef.current = item.id;
      return;
    }

    // Shift-click: range select within current filtered list
    if (isShift && lastClickedIdRef.current) {
      const ids = filtered.map((i) => i.id);
      const a = ids.indexOf(lastClickedIdRef.current);
      const b = ids.indexOf(item.id);
      if (a >= 0 && b >= 0) {
        const [s, eIdx] = a < b ? [a, b] : [b, a];
        setSelectedIds((prev) => {
          const next = new Set(prev);
          for (let i = s; i <= eIdx; i++) next.add(ids[i]);
          return next;
        });
        return;
      }
    }

    // Plain click: if a zone is selected, add (multi if selected) to zone; else just single-select
    if (!selectedZoneLabel) {
      setSelectedIds(new Set([item.id]));
      lastClickedIdRef.current = item.id;
      return;
    }

    // If clicked item is part of multi-selection, add ALL selected; else add just this one
    let toAdd: PickerPayload[];
    if (selectedIds.size > 1 && selectedIds.has(item.id)) {
      // Preserve filtered order
      toAdd = filtered.filter((i) => selectedIds.has(i.id)).map((i) => ({ kind: i.kind, raw: i.raw }));
    } else {
      toAdd = [{ kind: item.kind, raw: item.raw }];
    }
    onAddItems(toAdd);
    toast.success(
      toAdd.length > 1
        ? `${t("studioAddedToZone").replace("{label}", selectedZoneLabel)}（${toAdd.length}）`
        : t("studioAddedToZone").replace("{label}", selectedZoneLabel)
    );
    clearSelection();
  };

  const onPickerItemDragStart = (e: React.DragEvent, item: typeof items[number]) => {
    if (isVideoNotReady(item)) { e.preventDefault(); return; }
    try {
      // If the dragged item is part of an active multi-selection, drag the whole set
      const useMulti = selectedIds.size > 1 && selectedIds.has(item.id);
      const dragItems = useMulti
        ? filtered.filter((i) => selectedIds.has(i.id) && !isVideoNotReady(i))
        : [item];

      const payloadArr = dragItems.map((i) => ({ kind: i.kind, raw: i.raw }));
      // Backwards compatible: keep single-payload format if only one
      e.dataTransfer.setData(
        "application/x-studio-picker-item",
        JSON.stringify(useMulti ? payloadArr : payloadArr[0])
      );
      e.dataTransfer.setData("text/plain", dragItems.map((i) => i.name).join(", "));
      e.dataTransfer.effectAllowed = "copy";

      // Custom drag image: translucent thumbnail + name chip following cursor
      const ghost = document.createElement("div");
      const thumbSrc =
        item.kind === "media" && item.type !== "video"
          ? (item.raw?.url || item.thumbnail || "")
          : (item.thumbnail || item.raw?.thumbnail || "");
      const typeBadge = item.kind === "widget" ? "WGT" : item.type === "video" ? "VID" : "IMG";
      const badgeColor = item.kind === "widget" ? "#71717a" : item.type === "video" ? "#ef4444" : "#3b82f6";
      ghost.style.cssText = [
        "position:fixed","top:-1000px","left:-1000px",
        "width:140px","height:auto","padding:6px",
        "border-radius:8px","border:2px solid hsl(var(--primary))",
        "background:rgba(15,23,42,0.85)","color:#fff","opacity:0.92",
        "box-shadow:0 10px 30px rgba(0,0,0,0.45)",
        "font:600 11px 'PingFang TC','Microsoft JhengHei','Noto Sans TC',sans-serif",
        "display:flex","flex-direction:column","gap:4px","pointer-events:none","z-index:2147483647",
      ].join(";");
      const thumbWrap = document.createElement("div");
      thumbWrap.style.cssText = "position:relative;width:100%;aspect-ratio:16/9;border-radius:4px;overflow:hidden;background:#000";
      if (thumbSrc) {
        const img = document.createElement("img");
        img.src = thumbSrc;
        img.style.cssText = "width:100%;height:100%;object-fit:cover;display:block";
        thumbWrap.appendChild(img);
      }
      const badge = document.createElement("span");
      badge.textContent = typeBadge;
      badge.style.cssText = `position:absolute;bottom:2px;right:2px;background:${badgeColor};color:#fff;font-size:9px;font-weight:700;padding:1px 4px;border-radius:3px;line-height:1`;
      thumbWrap.appendChild(badge);
      // Multi-select count badge (top-right)
      if (useMulti) {
        const countBadge = document.createElement("span");
        countBadge.textContent = `+${dragItems.length - 1}`;
        countBadge.style.cssText = "position:absolute;top:2px;right:2px;background:hsl(var(--primary));color:#fff;font-size:10px;font-weight:800;padding:2px 6px;border-radius:999px;line-height:1;box-shadow:0 2px 6px rgba(0,0,0,0.35)";
        thumbWrap.appendChild(countBadge);
      }
      ghost.appendChild(thumbWrap);
      const label = document.createElement("div");
      label.textContent = useMulti
        ? t("studioMediaDragItemsCount").replace("{count}", String(dragItems.length))
        : item.name;
      label.style.cssText = "max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap";
      ghost.appendChild(label);
      document.body.appendChild(ghost);
      e.dataTransfer.setDragImage(ghost, 70, 40);
      // Browser snapshots the ghost synchronously; remove on next tick
      window.setTimeout(() => { ghost.remove(); }, 0);
    } catch { /* ignore */ }
    // Cancel any pending hover preview while dragging
    if (hoverTimerRef.current) { window.clearTimeout(hoverTimerRef.current); hoverTimerRef.current = null; }
    setHoverPreview(null);
  };

  // ---- Hover preview (0.5s delay, follows thumbnail) ----
  const [hoverPreview, setHoverPreview] = useState<MediaHoverPreviewData | null>(null);
  const hoverTimerRef = useRef<number | null>(null);
  const scheduleHoverPreview = (e: React.MouseEvent, item: typeof items[number]) => {
    if (item.kind !== "media") return; // widgets: skip preview
    const target = e.currentTarget as HTMLElement;
    if (hoverTimerRef.current) window.clearTimeout(hoverTimerRef.current);
    hoverTimerRef.current = window.setTimeout(() => {
      const rect = target.getBoundingClientRect();
      const m = item.raw as DbMediaItem;
      setHoverPreview({
        kind: item.kind,
        type: item.type,
        name: item.name,
        url: m.url,
        thumbnail: item.thumbnail || m.thumbnail || undefined,
        durationSeconds: typeof m.duration_seconds === "number" ? m.duration_seconds : null,
        width: typeof m.width === "number" ? m.width : null,
        height: typeof m.height === "number" ? m.height : null,
        sizeBytes: typeof m.size_bytes === "number" ? m.size_bytes : null,
        mimeType: m.mime_type ?? null,
        codec: m.source_codec ?? null,
        container: m.source_container ?? null,
        anchor: rect,
      });
    }, 250);
  };
  const cancelHoverPreview = () => {
    if (hoverTimerRef.current) { window.clearTimeout(hoverTimerRef.current); hoverTimerRef.current = null; }
    setHoverPreview(null);
  };
  useEffect(() => () => {
    if (hoverTimerRef.current) window.clearTimeout(hoverTimerRef.current);
  }, []);

  return (
    <div
      className={`shrink-0 border border-border rounded-xl bg-card flex flex-col overflow-hidden relative ${variant === "side" ? "h-full w-full" : ""}`}
      style={variant === "bottom" ? { height } : undefined}
      onDragOver={(e) => { e.preventDefault(); setIsDropActive(true); }}
      onDragLeave={(e) => { if (e.currentTarget.contains(e.relatedTarget as Node)) return; setIsDropActive(false); }}
      onDrop={onDrop}
    >
      {/* Resize handle on top edge (bottom variant only) */}
      {variant === "bottom" && (
        <div
          title={t("studioDockResize")}
          className="absolute top-0 left-0 right-0 h-1.5 cursor-row-resize hover:bg-primary/30 transition-colors z-20 flex items-center justify-center group"
          onMouseDown={(e) => { e.preventDefault(); resizingRef.current = true; document.body.style.cursor = "row-resize"; document.body.style.userSelect = "none"; }}
        >
          <div className="w-10 h-0.5 rounded-full bg-muted-foreground/30 group-hover:bg-primary/60 transition-colors" />
        </div>
      )}

      {/* Drop overlay */}
      {isDropActive && (
        <div className="absolute inset-0 z-30 bg-primary/10 border-2 border-dashed border-primary rounded-xl flex items-center justify-center pointer-events-none">
          <div className="flex items-center gap-2 text-primary font-semibold text-sm">
            <Upload className="w-5 h-5" /> {t("studioDropzoneActive")}
          </div>
        </div>
      )}

      {/* Header */}
      <div className={`flex items-center gap-2 px-3 pt-3 pb-2 border-b border-border shrink-0 ${variant === "side" ? "pr-12" : ""}`}>
        <span className="text-xs font-semibold text-foreground flex items-center gap-1.5">
          <ImageIcon className="w-3.5 h-3.5 text-primary" />
          {t("studioMediaLibraryDock")}
        </span>
        <span className="text-[10px] text-muted-foreground truncate flex-1">
          {selectedZoneLabel
            ? t("studioMediaDockHint")
            : <span className="text-warning">{t("studioSelectZoneFirst")}</span>}
        </span>
        {selectedIds.size > 0 && (
          <div className="flex items-center gap-1 shrink-0">
            <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-primary/15 text-primary border border-primary/30">
              {t("bulkSelected").replace("{count}", String(selectedIds.size))}
            </span>
            <button
              type="button"
              onClick={clearSelection}
              className="text-[10px] text-muted-foreground hover:text-foreground underline-offset-2 hover:underline"
              title={t("studioMediaClearSelection")}
            >
              {t("studioMediaClear")}
            </button>
          </div>
        )}
        <input
          ref={uploadInputRef}
          type="file"
          accept="image/jpeg,image/jpg,image/png,video/mp4"
          multiple
          className="hidden"
          onChange={(e) => {
            const files = Array.from(e.target.files || []);
            e.target.value = "";
            if (files.length) handleFilesUpload(files);
          }}
        />
        <Button variant="outline" size="sm" className="h-6 text-[10px] gap-1 shrink-0" disabled={isUploading} onClick={() => uploadInputRef.current?.click()}>
          <Upload className="w-3 h-3" />
          {isUploading ? t("studioUploading") : t("studioDropzoneClick").replace(/^或/, "")}
        </Button>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-1.5 px-3 py-1.5 border-b border-border shrink-0">
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-muted-foreground" />
          <Input className="h-6 text-[11px] pl-7 pr-2" placeholder={t("pickerSearchPlaceholder")} value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <div className="flex gap-0.5">
          {(["all", "image", "video", "widget"] as const).map((f) => (
            <Button key={f} variant={filter === f ? "default" : "ghost"} size="sm"
              className="h-6 text-[10px] px-2 rounded-full shrink-0"
              onClick={() => setFilter(f)}>
              {t(`pickerFilter_${f}` as TranslationKey)}
            </Button>
          ))}
        </div>
        <Button variant="ghost" size="icon" className="h-6 w-6 shrink-0" title={t("pickerSort")}
          onClick={() => {
            const order: Array<typeof sort> = ["newest", "oldest", "name-asc", "name-desc"];
            setSort(order[(order.indexOf(sort) + 1) % order.length]);
          }}>
          {sort === "name-asc" ? <ArrowDownAZ className="w-3 h-3" /> :
           sort === "name-desc" ? <ArrowUpAZ className="w-3 h-3" /> :
           <ArrowUpDown className="w-3 h-3" />}
        </Button>
        <div className="flex items-center border border-border rounded-md overflow-hidden shrink-0">
          <button
            type="button"
            title={t("studioMediaViewGrid")}
            onClick={() => setViewMode("grid")}
            className={`h-6 w-6 flex items-center justify-center transition-colors ${viewMode === "grid" ? "bg-primary text-primary-foreground" : "bg-background text-muted-foreground hover:bg-muted"}`}
          >
            <LayoutGrid className="w-3 h-3" />
          </button>
          <button
            type="button"
            title={t("studioMediaViewList")}
            onClick={() => setViewMode("list")}
            className={`h-6 w-6 flex items-center justify-center transition-colors ${viewMode === "list" ? "bg-primary text-primary-foreground" : "bg-background text-muted-foreground hover:bg-muted"}`}
          >
            <List className="w-3 h-3" />
          </button>
        </div>
      </div>

      {/* Grid / List */}
      <div className="flex-1 overflow-y-auto p-2 min-h-0">
        {filtered.length === 0 ? (
          <p className="text-[11px] text-muted-foreground text-center py-6">{t("mediaNoResult")}</p>
        ) : viewMode === "grid" ? (
          <div className="grid gap-1.5" style={{ gridTemplateColumns: variant === "side" ? "repeat(3, minmax(0, 1fr))" : "repeat(auto-fill, minmax(96px, 1fr))" }}>
            {filtered.map((item) => {
              const typeBadge = item.kind === "widget" ? "WGT" : item.type === "video" ? "VID" : "IMG";
              const badgeBg = item.kind === "widget" ? "bg-muted-foreground/80" : item.type === "video" ? "bg-destructive/80" : "bg-blue-500/80";
              const notReady = isVideoNotReady(item);
              const tsStatus = notReady ? (item.raw as DbMediaItem).transcode_status : null;
              const statusLabel = tsStatus === "transcoding" ? t("transcodeStatusProcessing") : tsStatus === "failed" ? t("transcodeStatusFailed") : tsStatus ? t("transcodeStatusPending") : undefined;
              return (
                <button
                  key={item.id}
                  type="button"
                  draggable={!notReady}
                  onDragStart={(e) => onPickerItemDragStart(e, item)}
                  onMouseEnter={(e) => scheduleHoverPreview(e, item)}
                  onMouseLeave={cancelHoverPreview}
                  aria-label={`${item.name} (${typeBadge})`}
                  title={notReady ? `${item.name}\n${statusLabel}` : `${item.name}${item.kind === "media" ? `\n${item.raw.name}` : ""}`}
                  className={`group relative aspect-video rounded-md overflow-hidden border-2 transition-all ${notReady ? "opacity-60 cursor-not-allowed border-transparent" : selectedIds.has(item.id) ? "border-primary ring-2 ring-primary/40" : `border-transparent hover:border-primary/60 ${selectedZoneLabel ? "cursor-pointer" : "cursor-grab opacity-90"}`}`}
                  onClick={(e) => handleItemClick(item, e)}
                >
                  {item.kind === "media" && item.type === "video" && item.raw?.url ? (
                    <VideoThumb
                      src={item.raw.url}
                      name={item.name}
                      poster={item.thumbnail || undefined}
                      className="absolute inset-0"
                    />
                  ) : item.kind === "media" && item.thumbnail ? (
                    <img src={item.thumbnail} alt={item.name} className="absolute inset-0 w-full h-full object-cover bg-muted" loading="lazy" />
                  ) : item.kind === "widget" && (item.raw as { config?: unknown })?.config ? (
                    <div className="absolute inset-0"><WidgetPreviewCard config={(item.raw as { config: Parameters<typeof WidgetPreviewCard>[0]["config"] }).config} /></div>
                  ) : (
                    <div className="absolute inset-0 flex items-center justify-center bg-muted">{item.icon}</div>
                  )}
                  <span className={`absolute bottom-0.5 right-0.5 ${badgeBg} text-white text-[8px] font-bold px-1 py-0.5 rounded leading-none`}>{typeBadge}</span>
                  {notReady && statusLabel && (
                    <span className={`absolute top-0.5 left-0.5 text-white text-[8px] font-bold px-1 py-0.5 rounded leading-none ${tsStatus === "failed" ? "bg-destructive/90" : "bg-yellow-600/90"}`}>
                      {statusLabel}
                    </span>
                  )}
                  {!notReady && selectedZoneLabel && (
                    <span className="pointer-events-none absolute inset-0 bg-primary/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                      <Plus className="w-6 h-6 text-primary-foreground drop-shadow" />
                    </span>
                  )}
                  <span className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent text-white text-[9px] px-1 pt-2 pb-0.5 line-clamp-1 text-left" lang="zh-Hant">
                    {item.name}
                  </span>
                </button>
              );
            })}
          </div>
        ) : (
          <div className={`grid border border-border rounded-md overflow-hidden ${variant === "side" ? "grid-cols-1" : "grid-cols-1 lg:grid-cols-2"}`}>
            {filtered.map((item, idx) => {
              const typeBadge = item.kind === "widget" ? "WGT" : item.type === "video" ? "VID" : "IMG";
              const badgeBg = item.kind === "widget" ? "bg-muted-foreground/80" : item.type === "video" ? "bg-destructive/80" : "bg-blue-500/80";
              const isLeftCol = idx % 2 === 0;
              const notReady = isVideoNotReady(item);
              const tsStatus = notReady ? (item.raw as DbMediaItem).transcode_status : null;
              const statusLabel = tsStatus === "transcoding" ? t("transcodeStatusProcessing") : tsStatus === "failed" ? t("transcodeStatusFailed") : tsStatus ? t("transcodeStatusPending") : undefined;
              return (
                <button
                  key={item.id}
                  type="button"
                  draggable={!notReady}
                  onDragStart={(e) => onPickerItemDragStart(e, item)}
                  onMouseEnter={(e) => scheduleHoverPreview(e, item)}
                  onMouseLeave={cancelHoverPreview}
                  aria-label={`${item.name} (${typeBadge})`}
                  title={notReady ? `${item.name}\n${statusLabel}` : `${item.name}${item.kind === "media" ? `\n${item.raw.name}` : ""}`}
                  className={`group flex items-center gap-2 px-2 py-1.5 text-left transition-colors border-b border-border last:border-b-0 ${variant !== "side" && isLeftCol ? "lg:border-r" : ""} ${notReady ? "opacity-60 cursor-not-allowed" : `${selectedIds.has(item.id) ? "bg-primary/15 ring-1 ring-primary/50 ring-inset" : ""} ${selectedZoneLabel ? "cursor-pointer hover:bg-primary/10" : "cursor-grab hover:bg-primary/10"}`}`}
                  onClick={(e) => handleItemClick(item, e)}
                >
                  <div className="relative w-10 h-10 shrink-0 rounded overflow-hidden bg-muted border border-border">
                    {item.kind === "media" && item.type === "video" && item.raw?.url ? (
                      <VideoThumb src={item.raw.url} name={item.name} poster={item.thumbnail || undefined} className="absolute inset-0" showPlayHint={false} />
                    ) : item.kind === "media" && item.thumbnail ? (
                      <img src={item.thumbnail} alt={item.name} className="absolute inset-0 w-full h-full object-cover" loading="lazy" />
                    ) : item.kind === "widget" && (item.raw as { config?: unknown })?.config ? (
                      <div className="absolute inset-0"><WidgetPreviewCard config={(item.raw as { config: Parameters<typeof WidgetPreviewCard>[0]["config"] }).config} /></div>
                    ) : (
                      <div className="absolute inset-0 flex items-center justify-center">{item.icon}</div>
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-medium text-foreground truncate" lang="zh-Hant" style={{ fontFamily: "'PingFang TC','Microsoft JhengHei','Noto Sans TC',sans-serif" }}>{item.name}</div>
                    {notReady && statusLabel ? (
                      <div className={`text-[10px] font-medium truncate ${tsStatus === "failed" ? "text-destructive" : "text-yellow-600"}`}>{statusLabel}</div>
                    ) : item.kind === "media" && item.raw?.name && item.raw.name !== item.name && (
                      <div className="text-[10px] text-muted-foreground/80 truncate" lang="zh-Hant" style={{ fontFamily: "'PingFang TC','Microsoft JhengHei','Noto Sans TC',sans-serif" }}>{item.raw.name}</div>
                    )}
                  </div>
                  {!notReady && item.kind === "media" && (() => {
                    const m = item.raw as DbMediaItem;
                    const totalSec = Math.round(getMediaDurationSec(m));
                    const durStr = totalSec > 0 ? `${totalSec}s` : "";
                    const sizeStr = formatBytesCompact(getMediaSizeBytes(m));
                    const dimStr = formatDimensions(m);
                    const metas = [
                      item.type === "video" ? durStr : "",
                      dimStr,
                      sizeStr,
                    ].filter(Boolean);
                    if (metas.length === 0) return null;
                    return (
                      <div className="hidden sm:flex shrink-0 items-center gap-1 text-[9px] text-muted-foreground tabular-nums" title={metas.join(" · ")}>
                        {metas.map((m, i) => (
                          <span key={i} className="px-1.5 py-0.5 rounded bg-muted/60 border border-border/50 leading-none whitespace-nowrap">{m}</span>
                        ))}
                      </div>
                    );
                  })()}
                  <span className={`shrink-0 ${badgeBg} text-white text-[8px] font-bold px-1 py-0.5 rounded leading-none`}>{typeBadge}</span>
                  {!notReady && selectedZoneLabel && (
                    <Plus className="w-3.5 h-3.5 text-primary opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
                  )}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Floating hover preview (portal) */}
      <MediaHoverPreview data={hoverPreview} />


      <Dialog open={!!renameTarget} onOpenChange={(open) => { if (!open) setRenameTarget(null); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{t("studioRenameTitle")}</DialogTitle>
            <DialogDescription>{t("studioRenameDesc")}</DialogDescription>
          </DialogHeader>
          {renameTarget && (
            <div className="space-y-3">
              <div className="text-xs text-muted-foreground">
                <span className="font-medium">{t("studioRenameOriginalLabel")}：</span>
                <span className="text-foreground" lang="zh-Hant">{renameTarget.originalFileName}</span>
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-foreground">{t("studioRenameLabel")}</label>
                <Input value={renameValue} lang="zh-Hant" autoFocus onChange={(e) => setRenameValue(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") submitRename(); }} />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setRenameTarget(null)}>{t("studioRenameSkip")}</Button>
            <Button onClick={submitRename} disabled={!renameValue.trim()}>{t("studioRenameSave")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ── Zone Timeline ──────────────────────────────────────────────────
function ZoneTimeline({
  zones,
  overlays,
  selectedZoneId,
  selectedOverlayId,
  onSelectZone,
  onSelectOverlay,
  onUpdateZoneContent,
  onUpdateOverlayContent,
  onAddItemsToTarget,
  bgmItems,
  bgmVolume,
  bgmAudioSource,
  onBgmItemsChange,
  onBgmVolumeChange,
  onBgmAudioSourceChange,
  dbMedia,
  activeOrgId,
  onMediaUploaded,
  height,
  onHeightChange,
  onPinItem,
  pinnedItem,
}: {
  zones: Zone[];
  overlays: OverlayBlock[];
  selectedZoneId: string | null;
  selectedOverlayId: string | null;
  onSelectZone: (id: string | null) => void;
  onSelectOverlay: (id: string | null) => void;
  onUpdateZoneContent: (zoneId: string, content: ZoneContent) => void;
  onUpdateOverlayContent: (overlayId: string, content: ZoneContent) => void;
  onAddItemsToTarget: (
    items: PickerPayload[],
    target: { type: "zone"; id: string } | { type: "overlay"; id: string },
  ) => void | Promise<void>;
  bgmItems: MediaItem[];
  bgmVolume: number;
  bgmAudioSource: string;
  onBgmItemsChange: (items: MediaItem[]) => void;
  onBgmVolumeChange: (v: number) => void;
  onBgmAudioSourceChange: (src: string) => void;
  dbMedia: { id: string; name: string; original_name?: string | null; type: string; url?: string; thumbnail?: string; size_bytes?: number | null; width?: number | null; height?: number | null; duration_seconds?: number | null; mime_type?: string | null; created_at?: string }[];
  activeOrgId?: string;
  onMediaUploaded?: () => Promise<void> | void;
  height: number;
  onHeightChange: (h: number) => void;
  onPinItem?: (trackId: string, itemIdx: number) => void;
  pinnedItem?: { trackId: string; itemIdx: number } | null;
}) {
  const { t } = useLanguage();
  const resizingRef = useRef(false);
  // Auto-size: measure inner content so the dock height fits the number of zone rows
  // (no empty space below the last row), capped by the user-configured `height`.
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const headerRef = useRef<HTMLDivElement | null>(null);
  const footerRef = useRef<HTMLDivElement | null>(null);
  const [measuredBody, setMeasuredBody] = useState<number>(0);
  const [chromeH, setChromeH] = useState<number>(0);
  // BGM picker dialog: shows ONLY audio media so users can add to the BGM track
  const [bgmPickerOpen, setBgmPickerOpen] = useState(false);
  const [bgmPickerSearch, setBgmPickerSearch] = useState("");
  const [bgmPickerSelected, setBgmPickerSelected] = useState<Set<string>>(new Set());
  const [bgmUploading, setBgmUploading] = useState(false);
  const bgmUploadInputRef = useRef<HTMLInputElement | null>(null);
  const handleBgmUpload = async (files: File[]) => {
    if (!files.length) return;
    if (!activeOrgId) { toast.error(t("teamSelectOrg")); return; }
    // Restrict to audio files only
    const audioFiles = files.filter((f) => f.type.startsWith("audio/") || /\.(mp3|wav|ogg|m4a|aac|flac)$/i.test(f.name));
    if (audioFiles.length === 0) { toast.error(t("studioTimelineBgmUploadOnlyAudio")); return; }
    setBgmUploading(true);
    const newIds: string[] = [];
    let successCount = 0;
    for (const file of audioFiles) {
      const result = await uploadMediaFile(file, { orgId: activeOrgId });
      if (!result.ok) {
        const code = result.errorCode;
        const msg =
          code === "unsupported" ? t("mediaUnsupported")
          : code === "file_too_large" ? t("mediaFileTooLarge")
          : code === "storage_full" || code === "media_capacity_exceeded" ? t("planLimitMedia")
          : code === "duplicate_file" ? `${t("mediaDuplicate")}: ${result.duplicateName || file.name}`
          : result.errorDetail || t("mediaUnsupported");
        toast.error(`${file.name}：${msg}`);
        continue;
      }
      successCount++;
      if (result.data?.id) newIds.push(result.data.id);
    }
    setBgmUploading(false);
    if (successCount > 0) {
      toast.success(`${t("mediaUploaded")}：${successCount}`);
      await onMediaUploaded?.();
      // Auto-select newly uploaded items so user just hits "Add"
      setBgmPickerSelected((prev) => {
        const next = new Set(prev);
        newIds.forEach((id) => next.add(id));
        return next;
      });
    }
  };
  // Preview playback (single audio element shared across rows)
  const bgmPreviewAudioRef = useRef<HTMLAudioElement | null>(null);
  const [bgmPreviewId, setBgmPreviewId] = useState<string | null>(null);
  const stopBgmPreview = () => {
    const el = bgmPreviewAudioRef.current;
    if (el) { try { el.pause(); el.currentTime = 0; } catch { /* ignore */ } }
    setBgmPreviewId(null);
  };
  const togglePreview = (id: string, url: string) => {
    if (bgmPreviewId === id) { stopBgmPreview(); return; }
    let el = bgmPreviewAudioRef.current;
    if (!el) {
      el = new Audio();
      el.preload = "none";
      el.addEventListener("ended", () => setBgmPreviewId(null));
      el.addEventListener("error", () => { setBgmPreviewId(null); toast.error(t("studioTimelineBgmPreviewError")); });
      bgmPreviewAudioRef.current = el;
    }
    try {
      el.src = url;
      el.currentTime = 0;
      void el.play().then(() => setBgmPreviewId(id)).catch(() => { setBgmPreviewId(null); toast.error(t("studioTimelineBgmPreviewError")); });
    } catch {
      setBgmPreviewId(null);
      toast.error(t("studioTimelineBgmPreviewError"));
    }
  };
  // Stop preview on unmount
  useEffect(() => () => stopBgmPreview(), []);
  const audioOnlyMedia = useMemo(
    () => dbMedia.filter((m) => m.type === "audio"),
    [dbMedia],
  );
  const filteredAudioMedia = useMemo(() => {
    const q = bgmPickerSearch.trim().toLocaleLowerCase();
    if (!q) return audioOnlyMedia;
    return audioOnlyMedia.filter((m) => {
      const name = (m.original_name || m.name || "").toLocaleLowerCase();
      return name.includes(q);
    });
  }, [audioOnlyMedia, bgmPickerSearch]);
  const confirmAddBgmFromPicker = () => {
    const chosen = audioOnlyMedia.filter((m) => bgmPickerSelected.has(m.id));
    if (chosen.length === 0) { setBgmPickerOpen(false); return; }
    const appended: MediaItem[] = chosen.map((m) => {
      const dur = Math.round(getMediaDurationSec(m)) || 30;
      return {
        id: m.id,
        type: "audio" as const,
        url: m.url || "",
        name: (m.original_name && m.original_name.trim()) || m.name,
        duration: dur,
      };
    });
    onBgmItemsChange([...bgmItems, ...appended]);
    toast.success(t("studioTimelineBgmAdded").replace("{n}", String(appended.length)));
    stopBgmPreview();
    setBgmPickerOpen(false);
    setBgmPickerSelected(new Set());
    setBgmPickerSearch("");
  };
  // Drag-to-reorder state for timeline cards
  const [dragState, setDragState] = useState<{ trackId: string; fromIdx: number } | null>(null);
  const [dragOverIdx, setDragOverIdx] = useState<{ trackId: string; idx: number } | null>(null);
  // Duration-resize live state (so width updates while dragging)
  const [liveResize, setLiveResize] = useState<{ trackId: string; idx: number; dur: number } | null>(null);
  const [dropTrackId, setDropTrackId] = useState<string | null>(null);
  const TRACK_VIS_LS_KEY = "studio-timeline-hidden-tracks";
  const [hiddenTrackIds, setHiddenTrackIds] = useState<Set<string>>(() => {
    try {
      const raw = localStorage.getItem(TRACK_VIS_LS_KEY);
      if (!raw) return new Set();
      const arr = JSON.parse(raw);
      return Array.isArray(arr) ? new Set<string>(arr) : new Set();
    } catch {
      return new Set();
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(TRACK_VIS_LS_KEY, JSON.stringify(Array.from(hiddenTrackIds)));
    } catch { /* ignore */ }
  }, [hiddenTrackIds]);
  const toggleTrackVisibility = (id: string) => {
    setHiddenTrackIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };
  const setAllVisible = (visible: boolean) => {
    if (visible) {
      setHiddenTrackIds(new Set());
    } else {
      const all = new Set<string>([...zones.map(z => `z-${z.id}`), ...overlays.map(o => `o-${o.id}`)]);
      setHiddenTrackIds(all);
    }
  };

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!resizingRef.current) return;
      const newH = Math.max(180, Math.min(600, window.innerHeight - e.clientY - 8));
      onHeightChange(newH);
    };
    const onUp = () => { resizingRef.current = false; document.body.style.cursor = ""; document.body.style.userSelect = ""; };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => { window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); };
  }, [onHeightChange]);

  const activeZone = zones.find((z) => z.id === selectedZoneId) || null;
  const activeOverlay = overlays.find((o) => o.id === selectedOverlayId) || null;
  const activeContent = activeZone?.content || activeOverlay?.content || null;
  const mediaItems: MediaItem[] = activeContent?.type === "media" ? (activeContent.mediaItems || []) : [];

  const updateActive = (newItems: MediaItem[]) => {
    if (activeZone) {
      onUpdateZoneContent(activeZone.id, { ...(activeContent || { type: "media", value: "" }), type: "media", value: "", mediaItems: newItems });
    } else if (activeOverlay) {
      onUpdateOverlayContent(activeOverlay.id, { ...(activeContent || { type: "media", value: "" }), type: "media", value: "", mediaItems: newItems });
    }
  };

  const move = (idx: number, dir: -1 | 1) => {
    const newItems = [...mediaItems];
    const tgt = idx + dir;
    if (tgt < 0 || tgt >= newItems.length) return;
    [newItems[idx], newItems[tgt]] = [newItems[tgt], newItems[idx]];
    updateActive(newItems);
  };

  const remove = (idx: number) => {
    const newItems = mediaItems.filter((_, i) => i !== idx);
    updateActive(newItems);
  };

  const activeId = activeZone ? `z-${activeZone.id}` : activeOverlay ? `o-${activeOverlay.id}` : null;

  // Observe natural body content height so the container can shrink to fit zone rows.
  useEffect(() => {
    const bodyEl = bodyRef.current;
    if (!bodyEl) return;
    const updateBody = () => setMeasuredBody(bodyEl.scrollHeight);
    updateBody();
    const ro = new ResizeObserver(updateBody);
    ro.observe(bodyEl);
    Array.from(bodyEl.children).forEach((c) => ro.observe(c as Element));
    return () => ro.disconnect();
  }, [zones.length, overlays.length, hiddenTrackIds, bgmItems.length, mediaItems.length]);
  useEffect(() => {
    const update = () => {
      const h = (headerRef.current?.offsetHeight || 0) + (footerRef.current?.offsetHeight || 0);
      setChromeH(h);
    };
    update();
    const ro = new ResizeObserver(update);
    if (headerRef.current) ro.observe(headerRef.current);
    if (footerRef.current) ro.observe(footerRef.current);
    return () => ro.disconnect();
  }, [activeZone, activeOverlay, mediaItems.length]);

  // Container height = min(natural content height, user-configured max from drag handle).
  // This makes the dock auto-size to the number of zone rows without leaving empty
  // space under the last row, while still allowing the user to cap the max height.
  const naturalH = measuredBody + chromeH;
  const effectiveH = naturalH > 0 ? Math.min(naturalH, height) : height;

  return (
    <div
      className="shrink-0 border border-border rounded-xl bg-card flex flex-col overflow-hidden relative"
      style={{ height: effectiveH }}
    >
      {/* Resize handle */}
      <div
        title={t("studioDockResize")}
        className="absolute top-0 left-0 right-0 h-1.5 cursor-row-resize hover:bg-primary/30 transition-colors z-20 flex items-center justify-center group"
        onMouseDown={(e) => { e.preventDefault(); resizingRef.current = true; document.body.style.cursor = "row-resize"; document.body.style.userSelect = "none"; }}
      >
        <div className="w-10 h-0.5 rounded-full bg-muted-foreground/30 group-hover:bg-primary/60 transition-colors" />
      </div>

      {/* Header with zone visibility toggles */}
      <div ref={headerRef} className="flex items-center gap-2 px-3 pt-3 pb-2 border-b border-border shrink-0 overflow-x-auto">
        <span className="text-xs font-semibold text-foreground flex items-center gap-1.5 shrink-0">
          <Layers className="w-3.5 h-3.5 text-primary" />
          {t("studioTimeline")}
        </span>
        <div className="flex items-center gap-1 flex-1 min-w-0">
          {/* Always-on BGM pill */}
          <span
            title={t("studioTimelineBgmHint")}
            className="shrink-0 h-6 px-2 rounded-full text-[10px] font-medium border bg-accent text-accent-foreground border-accent flex items-center gap-1"
          >
            <Music className="w-2.5 h-2.5" />
            {t("studioTimelineBgmLabel")}
            {bgmItems.length > 0 && <span className="opacity-70">·{bgmItems.length}</span>}
          </span>
          {zones.map((z) => {
            const id = `z-${z.id}`;
            const isActive = activeId === id;
            const isVisible = !hiddenTrackIds.has(id);
            const count = z.content?.type === "media" ? (z.content.mediaItems?.length || 0) : 0;
            return (
              <button
                key={id}
                type="button"
                onClick={() => toggleTrackVisibility(id)}
                onDoubleClick={() => onSelectZone(z.id)}
                title={isVisible ? t("studioTimelineHideTrack") : t("studioTimelineShowTrack")}
                className={`shrink-0 h-6 px-2 rounded-full text-[10px] font-medium border transition-all flex items-center gap-1 ${
                  !isVisible
                    ? "bg-background text-muted-foreground border-dashed border-border opacity-50"
                    : isActive
                      ? "bg-primary text-primary-foreground border-primary"
                      : "bg-muted text-muted-foreground border-border hover:bg-muted/70"
                }`}
              >
                {isVisible ? <Eye className="w-2.5 h-2.5" /> : <EyeOff className="w-2.5 h-2.5" />}
                {t("studioTimelineZonePrefix")} {z.label}
                {count > 0 && <span className="opacity-70">·{count}</span>}
              </button>
            );
          })}
          {overlays.map((o) => {
            const id = `o-${o.id}`;
            const isActive = activeId === id;
            const isVisible = !hiddenTrackIds.has(id);
            const count = o.content?.type === "media" ? (o.content.mediaItems?.length || 0) : 0;
            return (
              <button
                key={id}
                type="button"
                onClick={() => toggleTrackVisibility(id)}
                onDoubleClick={() => onSelectOverlay(o.id)}
                title={isVisible ? t("studioTimelineHideTrack") : t("studioTimelineShowTrack")}
                className={`shrink-0 h-6 px-2 rounded-full text-[10px] font-medium border transition-all flex items-center gap-1 ${
                  !isVisible
                    ? "bg-background text-muted-foreground border-dashed border-border opacity-50"
                    : isActive
                      ? "bg-accent-foreground text-background border-accent-foreground"
                      : "bg-muted text-muted-foreground border-border hover:bg-muted/70"
                }`}
              >
                {isVisible ? <Eye className="w-2.5 h-2.5" /> : <EyeOff className="w-2.5 h-2.5" />}
                {t("studioTimelineOverlayPrefix")} {o.label}
                {count > 0 && <span className="opacity-70">·{count}</span>}
              </button>
            );
          })}
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <Button variant="ghost" size="sm" className="h-6 px-2 text-[10px]" onClick={() => setAllVisible(true)} title={t("studioTimelineShowAll")}>
            {t("studioTimelineShowAll")}
          </Button>
          <Button variant="ghost" size="sm" className="h-6 px-2 text-[10px]" onClick={() => setAllVisible(false)} title={t("studioTimelineHideAll")}>
            {t("studioTimelineHideAll")}
          </Button>
        </div>
      </div>

      {/* Timeline body: BGM track + one row per zone/overlay */}
      <div ref={bodyRef} className="flex-1 overflow-y-auto min-h-0">
        {/* ── BGM Track (always present) ─────────────────────────── */}
        {(() => {
          const PX_PER_SEC = 28;
          const MIN_CARD_PX = 88;
          // Collect zones/overlays that contain at least one video (potential audio sources)
          const videoSources: { id: string; label: string; kind: "zone" | "overlay" }[] = [];
          zones.forEach((z) => {
            const items = z.content?.type === "media" ? (z.content.mediaItems || []) : [];
            if (items.some((m) => m.type === "video")) {
              videoSources.push({ id: `z-${z.id}`, label: `${t("studioTimelineZonePrefix")} ${z.label}`, kind: "zone" });
            }
          });
          overlays.forEach((o) => {
            const items = o.content?.type === "media" ? (o.content.mediaItems || []) : [];
            if (items.some((m) => m.type === "video")) {
              videoSources.push({ id: `o-${o.id}`, label: `${t("studioTimelineOverlayPrefix")} ${o.label}`, kind: "overlay" });
            }
          });

          // Selected source might no longer exist (e.g. zone deleted) — show as "bgm" fallback
          const sourceExists = bgmAudioSource === "bgm" || bgmAudioSource === "mute" || videoSources.some((v) => v.id === bgmAudioSource);
          const effectiveSource = sourceExists ? bgmAudioSource : "bgm";

          const segments = bgmItems.map((item) => {
            const dur = Math.max(1, Math.round(item.duration || 30));
            const px = Math.max(MIN_CARD_PX, dur * PX_PER_SEC);
            return { item, dur, px };
          });
          const totalPx = segments.reduce((s, x) => s + x.px, 0);

          const moveBgm = (idx: number, dir: -1 | 1) => {
            const next = [...bgmItems];
            const tgt = idx + dir;
            if (tgt < 0 || tgt >= next.length) return;
            [next[idx], next[tgt]] = [next[tgt], next[idx]];
            onBgmItemsChange(next);
          };
          const removeBgm = (idx: number) => onBgmItemsChange(bgmItems.filter((_, i) => i !== idx));

          const trackId = "bgm";
          const isDropOver = dropTrackId === trackId;

          return (
            <div
              className={`flex border-b border-border transition-colors bg-accent/5 ${isDropOver ? "ring-2 ring-accent-foreground ring-inset" : ""}`}
              onDragOver={(e) => {
                if (!e.dataTransfer.types.includes("application/x-studio-picker-item")) return;
                e.preventDefault();
                e.dataTransfer.dropEffect = "copy";
                if (dropTrackId !== trackId) setDropTrackId(trackId);
              }}
              onDragLeave={(e) => {
                if (e.currentTarget.contains(e.relatedTarget as Node)) return;
                if (dropTrackId === trackId) setDropTrackId(null);
              }}
              onDrop={(e) => {
                setDropTrackId(null);
                try {
                  const raw = e.dataTransfer.getData("application/x-studio-picker-item");
                  if (!raw) return;
                  const parsed = JSON.parse(raw) as unknown;
                  const arr: PickerPayload[] = Array.isArray(parsed) ? parsed as PickerPayload[] : [parsed as PickerPayload];
                  // Only accept audio media on BGM track
                  const audioItems = arr.filter(
                    (p) => p && p.kind === "media" && p.raw && (p.raw as DbMediaItem).type === "audio",
                  );
                  if (arr.length > 0 && audioItems.length === 0) {
                    toast.error(t("studioTimelineBgmOnlyAudio"));
                    return;
                  }
                  if (audioItems.length === 0) return;
                  e.preventDefault();
                  e.stopPropagation();
                  // Resolve to MediaItem and append
                  const appended: MediaItem[] = audioItems.map((it) => {
                    const m = it.raw as DbMediaItem;
                    const dur = Math.round(getMediaDurationSec(m)) || 30;
                    return {
                      id: m.id,
                      type: "audio" as const,
                      url: m.url || "",
                      name: (m.original_name && m.original_name.trim()) || m.name,
                      duration: dur,
                    };
                  });
                  onBgmItemsChange([...bgmItems, ...appended]);
                  toast.success(t("studioTimelineBgmAdded").replace("{n}", String(appended.length)));
                } catch { /* ignore */ }
              }}
            >
              {/* Track label + controls (sticky left) */}
              <div className="shrink-0 sticky left-0 z-10 w-44 px-2 py-2 border-r border-border bg-card flex flex-col gap-1.5">
                <div className="flex items-center gap-1.5">
                  <Music className="w-3 h-3 text-accent-foreground shrink-0" />
                  <span className="text-[10px] font-semibold text-foreground truncate">{t("studioTimelineBgmLabel")}</span>
                  <span className="text-[9px] text-muted-foreground">{bgmItems.length}</span>
                  {bgmItems.length > 0 && (
                    <span className="text-[9px] text-muted-foreground tabular-nums" title={t("studioTimelineTotalDuration")}>
                      ·{(() => {
                        const total = bgmItems.reduce((s, it) => s + Math.max(0, Math.round(it.duration || 0)), 0);
                        const m = Math.floor(total / 60);
                        const sec = total % 60;
                        return `${m}:${String(sec).padStart(2, "0")}`;
                      })()}
                    </span>
                  )}
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-5 w-5 ml-auto"
                    title={t("studioTimelineBgmAddAudio")}
                    onClick={() => { setBgmPickerSelected(new Set()); setBgmPickerSearch(""); setBgmPickerOpen(true); }}
                  >
                    <Plus className="w-3 h-3" />
                  </Button>
                  {/* Mute toggle: click to mute/unmute all audio on BGM track */}
                  <TooltipProvider delayDuration={200}>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          className={`h-5 w-5 ${effectiveSource === "mute" ? "text-destructive" : "text-muted-foreground"}`}
                          aria-label={effectiveSource === "mute" ? t("studioPreviewUnmute") : t("studioTimelineBgmSourceMute")}
                          aria-pressed={effectiveSource === "mute"}
                          onClick={() => onBgmAudioSourceChange(effectiveSource === "mute" ? "bgm" : "mute")}
                        >
                          {effectiveSource === "mute" ? <VolumeX className="w-3 h-3" /> : <Volume2 className="w-3 h-3" />}
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent side="top" className="flex flex-col gap-0.5 text-xs">
                        <span className="font-medium">
                          {effectiveSource === "mute" ? t("studioPreviewUnmute") : t("studioTimelineBgmSourceMute")}
                        </span>
                        <span className="text-muted-foreground">
                          {effectiveSource === "mute" ? t("studioTimelineBgmUnmuteHint") : t("studioTimelineBgmMuteHint")}
                        </span>
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                </div>
                {/* Volume */}
                <div className="flex items-center gap-1.5">
                  <Volume2 className="w-3 h-3 text-muted-foreground shrink-0" />
                  <Slider
                    value={[bgmVolume]}
                    min={0}
                    max={100}
                    step={1}
                    onValueChange={(v) => onBgmVolumeChange(v[0] ?? 0)}
                    className="flex-1"
                    aria-label={t("studioTimelineBgmVolume")}
                  />
                  <span className="text-[9px] text-muted-foreground w-6 text-right tabular-nums">{bgmVolume}</span>
                </div>
              </div>
              {/* Track content */}
              <div className="flex-1 overflow-x-auto min-w-0">
                {bgmItems.length === 0 ? (
                  <div className="h-20 flex items-center justify-center text-[10px] text-muted-foreground px-3 text-center">
                    {t("studioTimelineBgmEmpty")}
                  </div>
                ) : (
                  <div className="flex flex-col" style={{ width: totalPx, minWidth: "100%" }}>
                    <div className="p-1.5 flex items-stretch gap-1 h-[88px]">
                      {segments.map(({ item, dur, px }, idx) => (
                        <div
                          key={`${item.id}-${idx}`}
                          className="group h-full flex flex-col rounded border border-accent/40 bg-accent/10 overflow-hidden relative shrink-0"
                          style={{ width: px }}
                          title={item.name}
                        >
                          <span className="absolute top-0.5 left-0.5 z-10 bg-foreground/80 text-background text-[8px] font-bold px-1 py-0.5 rounded leading-none flex items-center gap-0.5">
                            <GripVertical className="w-2 h-2" />{idx + 1}
                          </span>
                          <span className="absolute top-0.5 right-2 z-10 text-[8px] font-semibold px-1 py-0.5 rounded leading-none bg-accent-foreground/90 text-accent">{dur}s</span>
                          <div className="flex-1 min-h-0 relative flex items-center justify-center bg-accent/20">
                            <Music className="w-6 h-6 text-accent-foreground/70" />
                          </div>
                          <div className="shrink-0 px-1 py-0.5 border-t border-accent/40 bg-card flex items-center justify-between gap-0.5">
                            <span className="text-[9px] truncate flex-1 text-foreground" title={item.name}>{item.name}</span>
                            <div className="flex items-center gap-0">
                              <Button variant="ghost" size="icon" className="h-4 w-4" disabled={idx === 0} title={t("studioTimelineMoveLeft")} onClick={() => moveBgm(idx, -1)}>
                                <ChevronLeft className="w-2.5 h-2.5" />
                              </Button>
                              <Button variant="ghost" size="icon" className="h-4 w-4" disabled={idx === bgmItems.length - 1} title={t("studioTimelineMoveRight")} onClick={() => moveBgm(idx, 1)}>
                                <ChevronRight className="w-2.5 h-2.5" />
                              </Button>
                              <Button variant="ghost" size="icon" className="h-4 w-4 text-destructive hover:text-destructive" title={t("studioTimelineRemove")} onClick={() => removeBgm(idx)}>
                                <Trash2 className="w-2.5 h-2.5 text-destructive" />
                              </Button>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          );
        })()}

        {(() => {
          const PX_PER_SEC = 28;
          const MIN_CARD_PX = 88;
          type Track = {
            id: string;
            kind: "zone" | "overlay";
            label: string;
            items: MediaItem[];
            onUpdate: (items: MediaItem[]) => void;
            onSelect: () => void;
            isActive: boolean;
          };
          const tracks: Track[] = [
            ...zones.map<Track>((z) => ({
              id: `z-${z.id}`,
              kind: "zone",
              label: `${t("studioTimelineZonePrefix")} ${z.label}`,
              items: z.content?.type === "media" ? (z.content.mediaItems || []) : [],
              onUpdate: (items) => onUpdateZoneContent(z.id, { ...(z.content || { type: "media", value: "" }), type: "media", value: "", mediaItems: items }),
              onSelect: () => onSelectZone(z.id),
              isActive: activeId === `z-${z.id}`,
            })),
            ...overlays.map<Track>((o) => ({
              id: `o-${o.id}`,
              kind: "overlay",
              label: `${t("studioTimelineOverlayPrefix")} ${o.label}`,
              items: o.content?.type === "media" ? (o.content.mediaItems || []) : [],
              onUpdate: (items) => onUpdateOverlayContent(o.id, { ...(o.content || { type: "media", value: "" }), type: "media", value: "", mediaItems: items }),
              onSelect: () => onSelectOverlay(o.id),
              isActive: activeId === `o-${o.id}`,
            })),
          ];

          const visibleTracks = tracks.filter((tr) => !hiddenTrackIds.has(tr.id));

          if (tracks.length === 0) {
            return (
              <div className="h-full flex items-center justify-center text-center text-xs text-muted-foreground px-3">
                {t("studioTimelineEmpty")}
              </div>
            );
          }
          if (visibleTracks.length === 0) {
            return (
              <div className="h-full flex items-center justify-center text-center text-xs text-muted-foreground px-3">
                {t("studioTimelineEmpty")}
              </div>
            );
          }

          return visibleTracks.map((track) => {
            const segments = track.items.map((item) => {
              const dur = Math.max(1, Math.round(item.duration || 5));
              const px = Math.max(MIN_CARD_PX, dur * PX_PER_SEC);
              return { item, dur, px };
            });
            const totalSec = segments.reduce((s, x) => s + x.dur, 0);
            const totalPx = segments.reduce((s, x) => s + x.px, 0);
            const tickStep = totalSec <= 30 ? 5 : totalSec <= 120 ? 10 : totalSec <= 600 ? 30 : 60;
            const secToPx = (sec: number) => {
              let acc = 0; let pxAcc = 0;
              for (const seg of segments) {
                if (sec <= acc + seg.dur) {
                  const frac = (sec - acc) / seg.dur;
                  return pxAcc + frac * seg.px;
                }
                acc += seg.dur; pxAcc += seg.px;
              }
              return pxAcc;
            };
            const ticks: number[] = [];
            for (let s = 0; s <= totalSec; s += tickStep) ticks.push(s);
            if (totalSec > 0 && ticks[ticks.length - 1] !== totalSec) ticks.push(totalSec);

            const moveItem = (idx: number, dir: -1 | 1) => {
              const newItems = [...track.items];
              const tgt = idx + dir;
              if (tgt < 0 || tgt >= newItems.length) return;
              [newItems[idx], newItems[tgt]] = [newItems[tgt], newItems[idx]];
              track.onUpdate(newItems);
            };
            const removeItem = (idx: number) => track.onUpdate(track.items.filter((_, i) => i !== idx));

            return (
              <div
                key={track.id}
                className={`flex border-b border-border transition-colors ${track.isActive ? "bg-primary/5" : "hover:bg-muted/30"} ${dropTrackId === track.id ? "ring-2 ring-primary ring-inset" : ""}`}
                onDragOver={(e) => {
                  if (!e.dataTransfer.types.includes("application/x-studio-picker-item")) return;
                  e.preventDefault();
                  e.dataTransfer.dropEffect = "copy";
                  if (dropTrackId !== track.id) setDropTrackId(track.id);
                }}
                onDragLeave={(e) => {
                  if (e.currentTarget.contains(e.relatedTarget as Node)) return;
                  if (dropTrackId === track.id) setDropTrackId(null);
                }}
                onDrop={(e) => {
                  setDropTrackId(null);
                  try {
                    const raw = e.dataTransfer.getData("application/x-studio-picker-item");
                    if (!raw) return;
                    const parsed = JSON.parse(raw) as unknown;
                    const arr: PickerPayload[] = Array.isArray(parsed) ? parsed as PickerPayload[] : [parsed as PickerPayload];
                    const valid = arr.filter((p) => p && (p.kind === "media" || p.kind === "widget"));
                    if (valid.length === 0) return;
                    e.preventDefault();
                    e.stopPropagation();
                    const targetId = track.id.startsWith("z-") ? track.id.slice(2) : track.id.slice(2);
                    void onAddItemsToTarget(valid, { type: track.kind, id: targetId });
                  } catch { /* ignore */ }
                }}
              >
                {/* Track label (sticky left) */}
                <button
                  type="button"
                  onClick={track.onSelect}
                  className={`shrink-0 sticky left-0 z-10 w-24 px-2 py-2 text-left border-r border-border flex flex-col items-start justify-center gap-0.5 ${track.isActive ? "bg-primary/10" : "bg-card hover:bg-muted/50"}`}
                  title={track.label}
                >
                  <span className={`text-[10px] font-semibold truncate w-full flex items-center gap-0.5 ${track.isActive ? "text-primary" : "text-foreground"}`}>
                    {track.items.some((m) => m.type === "video") && (
                      <Film className="w-2.5 h-2.5 shrink-0 text-destructive" />
                    )}
                    <span className="truncate">{track.label}</span>
                  </span>
                  <span className="text-[9px] text-muted-foreground">{track.items.length} · {segments.reduce((s, x) => s + x.dur, 0)}s</span>
                </button>
                {/* Track content */}
                <div className="flex-1 overflow-x-auto min-w-0">
                  {track.items.length === 0 ? (
                    <div className="h-20 flex items-center justify-center text-[10px] text-muted-foreground px-3">
                      {t("studioTimelineNoItems")}
                    </div>
                  ) : (
                    <div className="flex flex-col" style={{ width: totalPx, minWidth: "100%" }}>
                      {/* Time ruler */}
                      <div className="shrink-0 h-5 relative border-b border-border bg-muted/20">
                        {ticks.map((s, i) => {
                          const left = secToPx(s);
                          const isMajor = i % 2 === 0 || s === totalSec;
                          return (
                            <div key={`${s}-${i}`} className="absolute top-0 bottom-0" style={{ left }}>
                              <div className={`w-px ${isMajor ? "h-2.5 bg-foreground/50" : "h-1.5 bg-foreground/30"}`} />
                              {isMajor && (
                                <span className="text-[8px] text-muted-foreground leading-none mt-0.5 block -translate-x-1/2 whitespace-nowrap">{s}s</span>
                              )}
                            </div>
                          );
                        })}
                      </div>
                      {/* Cards row */}
                      <div className="p-1.5 flex items-stretch gap-1 h-[88px]">
                        {segments.map(({ item, dur, px }, idx) => {
                          const isImg = item.type === "image";
                          const isVid = item.type === "video";
                          const isWidget = item.type === "widget";
                          const canResizeDuration = !isVid; // 影片秒數鎖定原長
                          const isLive = liveResize && liveResize.trackId === track.id && liveResize.idx === idx;
                          const liveDur = isLive ? liveResize!.dur : dur;
                          const livePx = isLive ? Math.max(MIN_CARD_PX, liveDur * PX_PER_SEC) : px;
                          const isDragging = dragState?.trackId === track.id && dragState.fromIdx === idx;
                          const isDropTarget = dragOverIdx?.trackId === track.id && dragOverIdx.idx === idx && dragState?.trackId === track.id && dragState.fromIdx !== idx;

                          // HTML5 drag handlers for reorder
                          const onDragStart = (e: React.DragEvent) => {
                            setDragState({ trackId: track.id, fromIdx: idx });
                            try { e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", String(idx)); } catch { /* ignore */ }
                          };
                          const onDragOver = (e: React.DragEvent) => {
                            if (dragState?.trackId !== track.id) return;
                            e.preventDefault();
                            e.dataTransfer.dropEffect = "move";
                            if (dragOverIdx?.idx !== idx || dragOverIdx?.trackId !== track.id) {
                              setDragOverIdx({ trackId: track.id, idx });
                            }
                          };
                          const onDrop = (e: React.DragEvent) => {
                            e.preventDefault();
                            if (!dragState || dragState.trackId !== track.id) { setDragOverIdx(null); return; }
                            const from = dragState.fromIdx;
                            const to = idx;
                            setDragState(null);
                            setDragOverIdx(null);
                            if (from === to) return;
                            const newItems = [...track.items];
                            const [moved] = newItems.splice(from, 1);
                            newItems.splice(to, 0, moved);
                            track.onUpdate(newItems);
                          };
                          const onDragEnd = () => { setDragState(null); setDragOverIdx(null); };

                          // Duration drag handle (right edge)
                          const onResizeStart = (e: React.MouseEvent) => {
                            if (!canResizeDuration) return;
                            e.preventDefault();
                            e.stopPropagation();
                            const startX = e.clientX;
                            const startDur = Math.max(1, Math.round(item.duration || 5));
                            document.body.style.cursor = "col-resize";
                            document.body.style.userSelect = "none";
                            const onMove = (ev: MouseEvent) => {
                              const dx = ev.clientX - startX;
                              const newDur = Math.max(1, Math.min(600, Math.round(startDur + dx / PX_PER_SEC)));
                              setLiveResize({ trackId: track.id, idx, dur: newDur });
                            };
                            const onUp = (ev: MouseEvent) => {
                              window.removeEventListener("mousemove", onMove);
                              window.removeEventListener("mouseup", onUp);
                              document.body.style.cursor = "";
                              document.body.style.userSelect = "";
                              const dx = ev.clientX - startX;
                              const newDur = Math.max(1, Math.min(600, Math.round(startDur + dx / PX_PER_SEC)));
                              setLiveResize(null);
                              if (newDur !== startDur) {
                                const newItems = track.items.map((it, i) => i === idx ? { ...it, duration: newDur } : it);
                                track.onUpdate(newItems);
                              }
                            };
                            window.addEventListener("mousemove", onMove);
                            window.addEventListener("mouseup", onUp);
                          };

                          const isPinned = pinnedItem?.trackId === track.id && pinnedItem.itemIdx === idx;
                          return (
                            <div
                              key={`${item.id}-${idx}`}
                              draggable
                              onDragStart={onDragStart}
                              onDragOver={onDragOver}
                              onDrop={onDrop}
                              onDragEnd={onDragEnd}
                              onMouseDown={(e) => {
                                // Record start position; used by onMouseUp to detect a click vs drag
                                if ((e.target as HTMLElement).closest('button')) return;
                                (e.currentTarget as HTMLDivElement).dataset.pinStart = `${e.clientX},${e.clientY}`;
                              }}
                              onMouseUp={(e) => {
                                const el = e.currentTarget as HTMLDivElement;
                                const raw = el.dataset.pinStart;
                                if (!raw) return;
                                delete el.dataset.pinStart;
                                if ((e.target as HTMLElement).closest('button')) return;
                                const [sx, sy] = raw.split(',').map(Number);
                                // Only treat as a click if pointer barely moved (< 6 px)
                                if (Math.hypot(e.clientX - sx, e.clientY - sy) < 6) {
                                  onPinItem?.(track.id, idx);
                                }
                              }}
                              className={`group h-full flex flex-col rounded border bg-background/60 overflow-hidden relative shrink-0 transition-[width,opacity] ${
                                isDragging ? "opacity-40 border-primary border-dashed" :
                                isDropTarget ? "border-primary border-2" : "border-border"
                              } ${isPinned ? "ring-2 ring-primary" : ""}`}
                              style={{ width: livePx, cursor: isPinned ? "default" : dragState ? "grabbing" : "grab" }}
                              title={isPinned ? t("studioTimelineItemPinned") : canResizeDuration ? t("studioTimelineDragReorder") : t("studioTimelineVideoDurationLocked")}
                            >
                              <span className="absolute top-0.5 left-0.5 z-10 bg-foreground/80 text-background text-[8px] font-bold px-1 py-0.5 rounded leading-none flex items-center gap-0.5">
                                <GripVertical className="w-2 h-2" />{idx + 1}
                              </span>
                              <span className={`absolute top-0.5 right-2 z-10 text-[8px] font-semibold px-1 py-0.5 rounded leading-none ${isLive ? "bg-warning text-warning-foreground" : "bg-primary/90 text-primary-foreground"}`}>{liveDur}s</span>
                              <div className="flex-1 min-h-0 relative bg-muted">
                                {isImg && item.url ? (
                                  <img src={item.url} alt={item.name} className="absolute inset-0 w-full h-full object-cover pointer-events-none" loading="lazy" draggable={false} />
                                ) : isVid && item.url ? (
                                  <VideoThumb
                                    src={item.url}
                                    name={item.name}
                                    poster={undefined}
                                    className="absolute inset-0 pointer-events-none"
                                    showPlayHint={false}
                                  />
                                ) : isWidget ? (
                                  <div className="absolute inset-0 flex items-center justify-center"><Code2 className="w-5 h-5 text-accent-foreground" /></div>
                                ) : (
                                  <div className="absolute inset-0 flex items-center justify-center">
                                    <Film className="w-5 h-5 text-muted-foreground" />
                                    {isVid && <Play className="absolute w-3.5 h-3.5 text-white drop-shadow" fill="currentColor" />}
                                  </div>
                                )}
                              </div>
                              <div className="shrink-0 px-1 py-0.5 border-t border-border bg-card flex items-center justify-between gap-0.5">
                                <div className="flex items-center gap-0.5 min-w-0 flex-1">
                                  <Button variant="ghost" size="icon" className="h-4 w-4 shrink-0" disabled={idx === 0} title={t("studioTimelineMoveLeft")} onClick={() => moveItem(idx, -1)}>
                                    <ChevronLeft className="w-2.5 h-2.5" />
                                  </Button>
                                  <Button variant="ghost" size="icon" className="h-4 w-4 shrink-0" disabled={idx === track.items.length - 1} title={t("studioTimelineMoveRight")} onClick={() => moveItem(idx, 1)}>
                                    <ChevronRight className="w-2.5 h-2.5" />
                                  </Button>
                                  <span className="text-[9px] text-foreground/80 font-medium truncate min-w-0" title={item.name}>
                                    {item.name}
                                  </span>
                                </div>
                                <div className="flex items-center gap-0">
                                  <Popover>
                                    <PopoverTrigger asChild>
                                      <Button
                                        variant="ghost"
                                        size="icon"
                                        className="h-4 w-4"
                                        title={t("studioTimelineItemSettings")}
                                        onClick={(e) => e.stopPropagation()}
                                      >
                                        <Settings2 className="w-2.5 h-2.5" />
                                      </Button>
                                    </PopoverTrigger>
                                    <PopoverContent
                                      className="w-64 p-3 space-y-3 max-h-[80vh] overflow-y-auto"
                                      align="end"
                                      onClick={(e) => e.stopPropagation()}
                                      onMouseDown={(e) => e.stopPropagation()}
                                    >
                                      <div className="text-xs font-semibold truncate" title={item.name}>{item.name}</div>

                                      {/* Duration: editable for all (videos override locked length) */}
                                      <div className="space-y-1">
                                        <div className="flex items-center justify-between">
                                          <Label className="text-[10px] text-muted-foreground">
                                            {isVid ? t("studioTimelineItemDurationVideo") : t("studioTimelineItemDuration")}
                                          </Label>
                                          <span className="text-[10px] font-mono tabular-nums">{Math.max(1, Math.round(item.duration || 5))}s</span>
                                        </div>
                                        <Slider
                                          value={[Math.max(1, Math.round(item.duration || 5))]}
                                          min={1}
                                          max={600}
                                          step={1}
                                          onValueChange={(v) => {
                                            const newDur = Math.max(1, Math.min(600, Math.round(v[0])));
                                            const newItems = track.items.map((it, i) => i === idx ? { ...it, duration: newDur } : it);
                                            track.onUpdate(newItems);
                                          }}
                                        />
                                      </div>

                                      {/* Widget-specific settings */}
                                      {isWidget && item.widgetConfig && (
                                        <WidgetItemSettings
                                          config={item.widgetConfig}
                                          onChange={(next) => {
                                            const newItems = track.items.map((it, i) => i === idx ? { ...it, widgetConfig: next } : it);
                                            track.onUpdate(newItems);
                                          }}
                                          onItemPatch={(patch) => {
                                            const newItems = track.items.map((it, i) => i === idx ? { ...it, ...patch } : it);
                                            track.onUpdate(newItems);
                                          }}
                                        />
                                      )}

                                      {/* Volume + mute: only meaningful for video items */}
                                      {isVid && (<>
                                        <div className="space-y-1">
                                          <div className="flex items-center justify-between">
                                            <Label className="text-[10px] text-muted-foreground flex items-center gap-1">
                                              <Volume2 className="w-3 h-3" />
                                              {t("studioTimelineItemVolume")}
                                            </Label>
                                            <span className="text-[10px] font-mono tabular-nums">{item.muted ? 0 : (typeof item.volume === "number" ? item.volume : 100)}%</span>
                                          </div>
                                          <Slider
                                            value={[item.muted ? 0 : (typeof item.volume === "number" ? item.volume : 100)]}
                                            min={0}
                                            max={100}
                                            step={1}
                                            disabled={!!item.muted}
                                            onValueChange={(v) => {
                                              const vol = Math.max(0, Math.min(100, Math.round(v[0])));
                                              const newItems = track.items.map((it, i) => i === idx ? { ...it, volume: vol } : it);
                                              track.onUpdate(newItems);
                                            }}
                                          />
                                        </div>
                                        <div className="flex items-center justify-between pt-1 border-t border-border">
                                          <div className="space-y-0.5">
                                            <Label className="text-[10px] font-medium flex items-center gap-1">
                                              <VolumeX className="w-3 h-3" />
                                              {t("studioTimelineItemMute")}
                                            </Label>
                                            <p className="text-[9px] text-muted-foreground leading-tight">{t("studioTimelineItemMuteHint")}</p>
                                          </div>
                                          <Switch
                                            checked={!!item.muted}
                                            onCheckedChange={(checked) => {
                                              const newItems = track.items.map((it, i) => i === idx ? { ...it, muted: checked } : it);
                                              track.onUpdate(newItems);
                                            }}
                                          />
                                        </div>
                                      </>)}

                                      {/* Per-item fitMode for image and video items */}
                                      {(isImg || isVid) && (
                                        <div className="space-y-1 pt-2 border-t border-border">
                                          <Label className="text-[10px] text-muted-foreground">{t("studioFitMode")}</Label>
                                          <div className="flex gap-1 flex-wrap">
                                            {([
                                              { val: undefined as ("cover-x"|"cover-y"|"contain"|"stretch"|undefined), label: t("studioFitDefault"), short: t("studioFitDefaultShort") },
                                              { val: "cover-x" as const, label: t("studioFitCoverXTip"), short: t("studioFitCoverXShort") },
                                              { val: "cover-y" as const, label: t("studioFitCoverYTip"), short: t("studioFitCoverYShort") },
                                              { val: "contain" as const, label: t("studioFitContainTip"), short: t("studioFitContainShort") },
                                              { val: "stretch" as const, label: t("studioFitStretchTip"), short: t("studioFitStretchShort") },
                                            ]).map(({ val, label, short }) => (
                                              <Button
                                                key={String(val ?? "default")}
                                                type="button"
                                                title={label}
                                                size="sm"
                                                variant={item.fitMode === val ? "default" : "outline"}
                                                className="h-6 px-2 text-[10px]"
                                                onClick={() => {
                                                  let newItem: MediaItem;
                                                  if (val === undefined) {
                                                    // eslint-disable-next-line @typescript-eslint/no-unused-vars
                                                    const { fitMode: _fm, ...rest } = item as (MediaItem & { fitMode?: unknown });
                                                    newItem = rest as MediaItem;
                                                  } else {
                                                    newItem = { ...item, fitMode: val };
                                                  }
                                                  const newItems = track.items.map((it, i) => i === idx ? newItem : it);
                                                  track.onUpdate(newItems);
                                                }}
                                              >
                                                {short}
                                              </Button>
                                            ))}
                                          </div>
                                        </div>
                                      )}
                                    </PopoverContent>
                                  </Popover>
                                  <Button variant="ghost" size="icon" className="h-4 w-4 text-destructive hover:text-destructive" title={t("studioTimelineRemove")} onClick={() => removeItem(idx)}>
                                    <Trash2 className="w-2.5 h-2.5 text-destructive" />
                                  </Button>
                                </div>
                              </div>
                              {/* Right-edge duration resize handle (images/widgets only) */}
                              {canResizeDuration && (
                                <div
                                  onMouseDown={onResizeStart}
                                  onDragStart={(e) => e.preventDefault()}
                                  draggable={false}
                                  title={t("studioTimelineDragDuration")}
                                  className="absolute top-0 bottom-0 right-0 w-1.5 cursor-col-resize z-20 bg-primary/0 hover:bg-primary/60 transition-colors"
                                />
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            );
          });
        })()}
      </div>
      {/* Footer: active track total */}
      {(activeZone || activeOverlay) && mediaItems.length > 0 && (
        <div ref={footerRef} className="shrink-0 px-3 py-1 border-t border-border bg-muted/20 flex items-center justify-between text-[10px] text-muted-foreground">
          <span>{t("studioTimelineRuler")}</span>
          <span className="font-medium text-foreground">
            {t("studioTimelineTotalDuration")}: {mediaItems.reduce((s, m) => s + Math.max(1, Math.round(m.duration || 5)), 0)}s
          </span>
        </div>
      )}
      {/* BGM picker dialog — audio-only, opened from BGM track header */}
      <Dialog open={bgmPickerOpen} onOpenChange={(o) => { setBgmPickerOpen(o); if (!o) { stopBgmPreview(); setBgmPickerSelected(new Set()); setBgmPickerSearch(""); } }}>
        <DialogContent className="sm:max-w-2xl max-h-[90vh] flex flex-col gap-0 p-0 overflow-hidden">
          <div className="shrink-0 px-6 pt-6 pb-3">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Music className="w-4 h-4 text-accent-foreground" />
                {t("studioTimelineBgmPickerTitle")}
              </DialogTitle>
              <DialogDescription>{t("studioTimelineBgmPickerDesc")}</DialogDescription>
            </DialogHeader>
            <div className="flex items-center gap-2 mt-3">
              <div className="relative flex-1">
                <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
                <Input
                  value={bgmPickerSearch}
                  onChange={(e) => setBgmPickerSearch(e.target.value)}
                  placeholder={t("studioTimelineBgmPickerSearch")}
                  className="pl-7 h-8 text-xs"
                />
              </div>
              <input
                ref={bgmUploadInputRef}
                type="file"
                accept="audio/*,.mp3,.wav,.ogg,.m4a,.aac,.flac"
                multiple
                className="hidden"
                onChange={async (e) => {
                  const files = Array.from(e.target.files || []);
                  e.currentTarget.value = "";
                  if (files.length) await handleBgmUpload(files);
                }}
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-8 text-xs gap-1.5 shrink-0"
                disabled={bgmUploading || !activeOrgId}
                onClick={() => bgmUploadInputRef.current?.click()}
                title={t("studioTimelineBgmUploadHint")}
              >
                <Upload className="w-3.5 h-3.5" />
                {bgmUploading ? t("mediaUploading") : t("studioTimelineBgmUpload")}
              </Button>
            </div>
          </div>
          <div className="flex-1 min-h-0 overflow-y-auto border-y border-border divide-y divide-border mx-6">
            {filteredAudioMedia.length === 0 ? (
              <div className="p-6 text-center text-xs text-muted-foreground">
                {audioOnlyMedia.length === 0
                  ? t("studioTimelineBgmPickerEmpty")
                  : t("studioTimelineBgmPickerNoMatch")}
              </div>
            ) : (
              filteredAudioMedia.map((m) => {
                const alreadyAdded = bgmItems.some((b) => b.id === m.id);
                const checked = bgmPickerSelected.has(m.id);
                const displayName = (m.original_name && m.original_name.trim()) || m.name;
                const isPlaying = bgmPreviewId === m.id;
                const toggleSelect = () => {
                  if (alreadyAdded) return;
                  setBgmPickerSelected((prev) => {
                    const next = new Set(prev);
                    if (next.has(m.id)) next.delete(m.id); else next.add(m.id);
                    return next;
                  });
                };
                return (
                  <div
                    key={m.id}
                    role="button"
                    tabIndex={alreadyAdded ? -1 : 0}
                    onClick={toggleSelect}
                    onKeyDown={(e) => { if (!alreadyAdded && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); toggleSelect(); } }}
                    className={`w-full px-3 py-2 flex items-center gap-3 text-left transition-colors ${alreadyAdded ? "opacity-40 cursor-not-allowed" : "hover:bg-muted/50 cursor-pointer"} ${checked ? "bg-accent/10" : ""}`}
                  >
                    <div className={`w-4 h-4 rounded border flex items-center justify-center shrink-0 ${alreadyAdded ? "border-border bg-muted" : checked ? "bg-primary border-primary" : "border-border"}`}>
                      {alreadyAdded ? <Check className="w-3 h-3 text-muted-foreground" /> : checked && <Check className="w-3 h-3 text-primary-foreground" />}
                    </div>
                    <Button
                      type="button"
                      variant={isPlaying ? "default" : "ghost"}
                      size="icon"
                      className="h-7 w-7 shrink-0"
                      title={isPlaying ? t("studioTimelineBgmPreviewStop") : t("studioTimelineBgmPreviewPlay")}
                      onClick={(e) => { e.stopPropagation(); togglePreview(m.id, m.url || ""); }}
                    >
                      {isPlaying ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
                    </Button>
                    <Music className="w-4 h-4 text-accent-foreground shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="text-xs font-medium text-foreground truncate">{displayName}</div>
                      <div className="text-[10px] text-muted-foreground flex items-center gap-1.5 mt-0.5">
                        <span className="font-mono uppercase">{getBgmFormatLabel(m)}</span>
                        {(() => { const d = formatMediaDuration(m); return d ? (
                          <>
                            <span>·</span>
                            <span>{d}</span>
                          </>
                        ) : null; })()}
                        {alreadyAdded && <span className="text-[9px] text-muted-foreground">· {t("studioTimelineBgmAlreadyAdded")}</span>}
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
          <div className="shrink-0 px-6 py-4">
            <DialogFooter>
              <Button variant="ghost" onClick={() => setBgmPickerOpen(false)}>{t("cancel")}</Button>
              <Button onClick={confirmAddBgmFromPicker} disabled={bgmPickerSelected.size === 0}>
                {t("studioTimelineBgmPickerConfirm").replace("{n}", String(bgmPickerSelected.size))}
              </Button>
            </DialogFooter>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}


function ZoneEditor({ zone, onUpdate, onClose, dbMedia, dbWidgets, isEmbedded, activeOrgId, onMediaUploaded, hideContentPicker, existingVideoZoneLabel }: {
  zone: Zone;
  onUpdate: (content: ZoneContent) => void;
  onClose: () => void;
  dbMedia: { id: string; name: string; original_name?: string | null; type: string; url?: string; thumbnail?: string; size_bytes?: number | null; width?: number | null; height?: number | null; duration_seconds?: number | null; mime_type?: string | null; created_at?: string }[];
  dbWidgets: { id: string; name: string; url: string; created_at?: string }[];
  isEmbedded?: boolean;
  activeOrgId?: string;
  onMediaUploaded?: () => Promise<void> | void;
  hideContentPicker?: boolean;
  existingVideoZoneLabel?: string | null;
}) {
  const { t } = useLanguage();
  const content: ZoneContent = zone.content || { type: "color", value: "", bgColor: "hsl(var(--muted))" };
  const mediaItems = content.mediaItems || [];
  const [showContentPicker, setShowContentPicker] = useState(false);
  const [selectedPickerIds, setSelectedPickerIds] = useState<Set<string>>(new Set());
  const [pickerSearch, setPickerSearch] = useState("");
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [dragOverIdx, setDragOverIdx] = useState<number | null>(null);
  const [pickerFilter, setPickerFilter] = useState<"all" | "image" | "video" | "widget">("all");
  const [pickerSort, setPickerSort] = useState<"name-asc" | "name-desc" | "newest" | "oldest">("name-asc");
  const [isUploading, setIsUploading] = useState(false);
  const [isDropActive, setIsDropActive] = useState(false);
  const [renameTarget, setRenameTarget] = useState<{ id: string; defaultName: string; originalFileName: string } | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const uploadInputRef = useRef<HTMLInputElement | null>(null);

  const [pickerView, setPickerView] = useState<"grid" | "list">("grid");

  const pickerItems = useMemo(() => {
    const items: { id: string; kind: "media" | "widget"; name: string; searchName: string; type?: string; icon: React.ReactNode; thumbnail?: string; raw: PickerRaw; createdAt?: string }[] = [];
    dbMedia.forEach((m) => {
      // Audio is managed exclusively from the BGM track on the timeline.
      if (m.type === "audio") return;
      const displayName = m.original_name?.trim() || m.name;
      const previewThumb = m.type === "video"
        ? (m.thumbnail || undefined)
        : (m.thumbnail || m.url);
      items.push({
        id: `media-${m.id}`, kind: "media", name: displayName, searchName: `${displayName} ${m.name}`.toLocaleLowerCase(), type: m.type,
        icon: m.type === "image" ? <ImageIcon className="w-3.5 h-3.5 text-primary shrink-0" /> : <Film className="w-3.5 h-3.5 text-primary shrink-0" />,
        thumbnail: previewThumb,
        raw: m, createdAt: m.created_at,
      });
    });
    dbWidgets.forEach((w) => {
      let config: WidgetConfig | null = null;
      try {
        const raw = w.url?.startsWith("widget://") ? w.url.slice("widget://".length) : w.url;
        if (raw?.startsWith("{")) config = JSON.parse(raw) as WidgetConfig;
      } catch {}
      const WidgetIcon = config?.widgetType === "clock" ? Clock : config?.widgetType === "date" ? Calendar : config?.widgetType === "webpage" ? Globe : config?.widgetType === "stream" ? Radio : config?.widgetType === "announcement" ? Megaphone : Code2;
      items.push({
        id: `widget-${w.id}`, kind: "widget", name: w.name, searchName: w.name.toLocaleLowerCase(),
        icon: <WidgetIcon className="w-3.5 h-3.5 text-accent-foreground shrink-0" />,
        raw: { ...w, config }, createdAt: w.created_at,
      });
    });
    return items;
  }, [dbMedia, dbWidgets]);

  const filteredPickerItems = useMemo(() => {
    let filtered = pickerItems;
    if (pickerFilter === "image") filtered = filtered.filter((i) => i.kind === "media" && i.type === "image");
    else if (pickerFilter === "video") filtered = filtered.filter((i) => i.kind === "media" && i.type === "video");
    else if (pickerFilter === "widget") filtered = filtered.filter((i) => i.kind === "widget");
    if (pickerSearch.trim()) {
      const q = pickerSearch.trim().toLocaleLowerCase();
      filtered = filtered.filter((i) => i.searchName.includes(q));
    }
    filtered = [...filtered].sort((a, b) => {
      if (pickerSort === "name-asc") return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" });
      if (pickerSort === "name-desc") return b.name.localeCompare(a.name, undefined, { numeric: true, sensitivity: "base" });
      if (pickerSort === "newest") return (b.createdAt || "").localeCompare(a.createdAt || "");
      return (a.createdAt || "").localeCompare(b.createdAt || "");
    });
    return filtered;
  }, [pickerItems, pickerFilter, pickerSearch, pickerSort]);

  const togglePickerItem = (id: string) => {
    setSelectedPickerIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  // ── Drag-and-drop upload ────────────────────────────────────────
  const handleFilesUpload = async (files: File[]) => {
    if (!files.length) return;
    if (!activeOrgId) {
      toast.error(t("teamSelectOrg"));
      return;
    }
    setIsUploading(true);
    let lastUploadedId: string | null = null;
    let lastFileName = "";
    let successCount = 0;
    let pendingTranscodeCount = 0;

    for (const file of files) {
      const result = await uploadMediaFile(file, { orgId: activeOrgId });
      if (!result.ok) {
        const code = result.errorCode;
        const msg =
          code === "unsupported" ? t("mediaUnsupported")
          : code === "file_too_large" ? t("mediaFileTooLarge")
          : code === "storage_full" || code === "media_capacity_exceeded" ? t("planLimitMedia")
          : code === "image_resolution" ? `${t("mediaImageSpecResolution")}（${result.errorDetail || ""}）`
          : code === "image_too_large" ? `${t("mediaImageSpecTooLarge")}（${result.errorDetail || ""}）`
          : code === "image_cmyk" ? `${t("mediaImageSpecCmyk")}（${result.errorDetail || ""}）`
          : code === "image_auto_convert_failed" ? t("mediaImageAutoConvertFailed")
          : code === "video_resolution" ? `${t("mediaVideoSpecResolution")}（${result.errorDetail || ""}）`
          : code === "duplicate_file" ? `${t("mediaDuplicate")}: ${result.duplicateName || file.name}`
          : result.errorDetail || t("mediaUnsupported");
        toast.error(`${file.name}：${msg}`);
        continue;
      }
      successCount++;
      if (result.data?.transcodeStatus === "pending_transcode") pendingTranscodeCount++;
      lastUploadedId = result.data!.id;
      lastFileName = file.name;
    }

    setIsUploading(false);

    if (successCount > 0) {
      toast.success(`${t("mediaUploaded")}：${successCount}`);
      if (pendingTranscodeCount > 0) toast.warning(t("transcodeUploadNote"), { duration: 6000 });
      await onMediaUploaded?.();
      // Auto-select newly uploaded item(s) by media-{id} so they're queued for adding
      if (lastUploadedId) {
        setSelectedPickerIds((prev) => {
          const next = new Set(prev);
          next.add(`media-${lastUploadedId}`);
          return next;
        });
        // Open rename dialog on the most recent upload (single-file flow)
        if (files.length === 1) {
          const baseName = lastFileName.replace(/\.[^.]+$/, "");
          setRenameTarget({ id: lastUploadedId, defaultName: baseName, originalFileName: lastFileName });
          setRenameValue(baseName);
        }
      }
    }
  };

  const onPickerDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setIsDropActive(false);
    const files = Array.from(e.dataTransfer.files || []);
    if (files.length) await handleFilesUpload(files);
  };

  const submitRename = async () => {
    if (!renameTarget) return;
    const newName = renameValue.trim();
    if (!newName || newName === renameTarget.defaultName) {
      setRenameTarget(null);
      return;
    }
    const { error } = await supabase
      .from("media_items")
      .update({ original_name: newName })
      .eq("id", renameTarget.id);
    if (error) {
      toast.error(formatUserError(error, t));
      return;
    }
    toast.success(t("studioRenameSaved"));
    await onMediaUploaded?.();
    setRenameTarget(null);
  };

  const confirmPickerSelection = async () => {
    const selectedItems = Array.from(selectedPickerIds)
      .map((pickerId) => pickerItems.find((p) => p.id === pickerId))
      .filter(Boolean) as NonNullable<(typeof pickerItems)[number]>[];

    const mediaIds = selectedItems
      .filter((item) => item.kind === "media")
      .map((item) => item.raw.id);

    const mediaDetailMap = new Map<string, { id: string; name: string; original_name?: string | null; type: string; url: string; thumbnail: string; duration_seconds: number | null }>();

    if (mediaIds.length > 0) {
      const { data, error } = await supabase
        .from("media_items")
        .select("id, name, original_name, type, url, thumbnail, duration_seconds")
        .is("deleted_at", null)
        .in("id", mediaIds);

      if (error) {
        toast.error(formatUserError(error, t));
        return;
      }

      (data || []).forEach((item) => mediaDetailMap.set(item.id, item));
    }

    const hasIncomingVideo = Array.from(selectedPickerIds).some((pickerId) => {
      const item = pickerItems.find((p) => p.id === pickerId);
      if (!item || item.kind !== "media") return false;
      const m = mediaDetailMap.get(item.raw.id);
      return m?.type === "video";
    });
    if (hasIncomingVideo && existingVideoZoneLabel) {
      toast.error(t("studioVideoZoneLimit").replace("{zone}", existingVideoZoneLabel));
      return;
    }

    const appendedItems: MediaItem[] = [];

    selectedItems.forEach((item) => {
      if (item.kind === "media") {
        const m = mediaDetailMap.get(item.raw.id);
        if (!m) return;

        const isVideo = m.type === "video";
        const dur = isVideo
          ? (Math.round(getMediaDurationSec(m)) || 10)
          : 7;
        appendedItems.push({
          id: m.id,
          type: m.type as "image" | "video",
          url: m.thumbnail || m.url,
          name: m.original_name?.trim() || m.name,
          duration: dur,
          ...(isVideo ? { volume: 30 } : {}),
        });
        return;
      }

      const w = item.raw;
      appendedItems.push({ id: w.id, type: "widget", url: "", name: w.name, duration: 10, widgetConfig: w.config });
    });

    const updatedItems = [...mediaItems, ...appendedItems];
    const updatedContent = updatedItems.length > 0
      ? {
          ...content,
          type: "media" as const,
          mediaItems: updatedItems,
          widgetId: undefined,
          widgetName: undefined,
          widgetConfig: undefined,
        }
      : content;

    onUpdate(updatedContent);
    setSelectedPickerIds(new Set());
    setShowContentPicker(false);
    setPickerSearch("");
    setPickerFilter("all");
  };

  const addMedia = (m: typeof dbMedia[0]) => {
    const isVideo = m.type === "video";
    if (isVideo && existingVideoZoneLabel) {
      toast.error(t("studioVideoZoneLimit").replace("{zone}", existingVideoZoneLabel));
      return;
    }
    const dur = isVideo ? (Math.round(getMediaDurationSec(m)) || 10) : 7;
    const newItem: MediaItem = {
      id: m.id,
      type: m.type as "image" | "video",
      url: "",
      name: m.original_name?.trim() || m.name,
      duration: dur,
      ...(isVideo ? { volume: 30 } : {}),
    };
    onUpdate({ ...content, type: "media", mediaItems: [...mediaItems, newItem] });
  };

  const removeMedia = (id: string, index?: number) => {
    const updated = mediaItems.filter((m, i) => !(m.id === id && (index === undefined || i === index)));
    onUpdate({ ...content, mediaItems: updated, type: updated.length > 0 ? "media" : "color" });
  };

  const innerContent = (
      <div className="space-y-3">
        {/* Unified content section: Media & Widgets */}
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <label className="text-xs text-muted-foreground flex items-center gap-1"><Layers className="w-3 h-3" /> {hideContentPicker ? t("studioCurrentItems") : t("studioContentPicker")}</label>
            {!hideContentPicker && (
              <Button variant="outline" size="sm" className="h-6 text-[10px] gap-1" onClick={() => { setShowContentPicker(!showContentPicker); setSelectedPickerIds(new Set()); setPickerSearch(""); setPickerFilter("all"); }}>
                <Plus className="w-3 h-3" /> {t("studioAddContent")}
              </Button>
            )}
          </div>

          {/* Currently added content items */}
          {mediaItems.length > 0 && (
            <div className="space-y-0.5 mb-2">
              {mediaItems.map((m, i) => (
                <div
                  key={`${m.id}-${i}`}
                  draggable
                  onDragStart={() => setDragIdx(i)}
                  onDragOver={(e) => { e.preventDefault(); setDragOverIdx(i); }}
                  onDragEnd={() => {
                    if (dragIdx !== null && dragOverIdx !== null && dragIdx !== dragOverIdx) {
                      const reordered = [...mediaItems];
                      const [moved] = reordered.splice(dragIdx, 1);
                      reordered.splice(dragOverIdx, 0, moved);
                      onUpdate({ ...content, type: "media", mediaItems: reordered });
                    }
                    setDragIdx(null);
                    setDragOverIdx(null);
                  }}
                  className={`p-1.5 rounded-md text-xs transition-all ${
                    dragOverIdx === i && dragIdx !== null && dragIdx !== i
                      ? "bg-primary/15 ring-1 ring-primary/40"
                      : "bg-muted/50"
                  } ${dragIdx === i ? "opacity-40" : ""}`}
                >
                  {/* Main row */}
                  <div className="flex items-center gap-1.5">
                    <GripVertical className="w-3 h-3 text-muted-foreground/50 shrink-0 cursor-grab active:cursor-grabbing" />
                    {m.type === "image" ? <ImageIcon className="w-3.5 h-3.5 text-muted-foreground shrink-0" /> : m.type === "video" ? <Film className="w-3.5 h-3.5 text-muted-foreground shrink-0" /> : <Code2 className="w-3.5 h-3.5 text-accent-foreground shrink-0" />}
                    <span className="truncate flex-1 text-foreground">{m.name}</span>
                    <Badge variant="outline" className="text-[9px] h-4 px-1 shrink-0">{m.type === "image" ? "IMG" : m.type === "video" ? "VID" : "Widget"}</Badge>
                    <div className="flex items-center gap-1 shrink-0">
                      {m.type === "video" ? (
                        <span className="text-[10px] text-muted-foreground">{m.duration || 10}s</span>
                      ) : (
                        <>
                          <Button variant="ghost" size="icon" className="h-4 w-4" onClick={() => {
                            const updated = [...mediaItems];
                            updated[i] = { ...m, duration: Math.max(1, (m.duration || 5) - 1) };
                            onUpdate({ ...content, type: "media", mediaItems: updated });
                          }}><Minus className="w-2.5 h-2.5" /></Button>
                          <span className="text-[10px] font-medium text-foreground w-5 text-center">{m.duration || 5}s</span>
                          <Button variant="ghost" size="icon" className="h-4 w-4" onClick={() => {
                            const updated = [...mediaItems];
                            updated[i] = { ...m, duration: Math.min(60, (m.duration || 5) + 1) };
                            onUpdate({ ...content, type: "media", mediaItems: updated });
                          }}><Plus className="w-2.5 h-2.5" /></Button>
                        </>
                      )}
                    </div>
                    <Button variant="ghost" size="icon" className="h-5 w-5 shrink-0" onClick={() => removeMedia(m.id, i)}><X className="w-3 h-3" /></Button>
                  </div>
                  {/* Per-item fitMode row (images and videos only) */}
                  {(m.type === "image" || m.type === "video") && (
                    <div className="flex items-center gap-1 mt-1.5 ml-1 pl-2 border-l-2 border-muted">
                      <span className="text-[10px] text-muted-foreground shrink-0">{t("studioFitMode")}:</span>
                      {([
                        { val: undefined as ("cover-x"|"cover-y"|"contain"|"stretch"|undefined), label: t("studioFitDefault"), short: t("studioFitDefaultShort") },
                        { val: "cover-x" as const, label: t("studioFitCoverXTip"), short: t("studioFitCoverXShort") },
                        { val: "cover-y" as const, label: t("studioFitCoverYTip"), short: t("studioFitCoverYShort") },
                        { val: "contain" as const, label: t("studioFitContainTip"), short: t("studioFitContainShort") },
                        { val: "stretch" as const, label: t("studioFitStretchTip"), short: t("studioFitStretchShort") },
                      ]).map(({ val, label, short }) => (
                        <button
                          key={String(val ?? "default")}
                          type="button"
                          title={label}
                          onClick={() => {
                            const updated = [...mediaItems];
                            if (val === undefined) {
                              // eslint-disable-next-line @typescript-eslint/no-unused-vars
                              const { fitMode: _fm, ...rest } = updated[i] as (MediaItem & { fitMode?: unknown });
                              updated[i] = rest as MediaItem;
                            } else {
                              updated[i] = { ...updated[i], fitMode: val };
                            }
                            onUpdate({ ...content, type: "media", mediaItems: updated });
                          }}
                          className={`h-6 px-1.5 flex items-center justify-center rounded text-[10px] font-medium transition-colors ${
                            m.fitMode === val
                              ? "bg-primary text-primary-foreground"
                              : "bg-muted/40 border border-border/60 hover:bg-accent hover:text-foreground text-muted-foreground"
                          }`}
                        >
                          {short}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Legacy single widget */}
          {content.type === "widget" && content.widgetName && mediaItems.length === 0 && (
            <div className="flex items-center gap-2 p-1.5 rounded-md bg-muted/50 text-xs mb-2">
              <Code2 className="w-3.5 h-3.5 text-accent-foreground shrink-0" />
              <span className="truncate flex-1 text-foreground">{content.widgetName}</span>
              <Button variant="ghost" size="icon" className="h-5 w-5 shrink-0" onClick={() => onUpdate({ ...content, type: "color", widgetId: undefined, widgetName: undefined, widgetConfig: undefined })}><X className="w-3 h-3" /></Button>
            </div>
          )}

          {/* Carousel transition options */}
          {mediaItems.length > 1 && (
            <div className="space-y-2 mt-1">
              <div>
                <label className="text-[11px] text-muted-foreground mb-1 block">{t("studioTransition")}</label>
                <div className="flex gap-1">
                  {([
                    { val: "fade" as CarouselTransition, label: t("studioTransFade") },
                    { val: "slide" as CarouselTransition, label: t("studioTransSlide") },
                    { val: "zoom" as CarouselTransition, label: t("studioTransZoom") },
                    { val: "none" as CarouselTransition, label: t("studioTransNone") },
                  ]).map(({ val, label }) => (
                    <Button key={val} variant={(content.carouselTransition || "fade") === val ? "default" : "outline"} size="sm" className="h-6 text-[10px] flex-1 px-1"
                      onClick={() => onUpdate({ ...content, carouselTransition: val })}>{label}</Button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Unified multi-select picker */}
          {showContentPicker && !hideContentPicker && (
            <div
              className={`mt-2 border rounded-md bg-card overflow-hidden transition-colors ${
                isDropActive ? "border-primary ring-2 ring-primary/30" : "border-border"
              }`}
              onDragOver={(e) => { e.preventDefault(); setIsDropActive(true); }}
              onDragLeave={(e) => { if (e.currentTarget.contains(e.relatedTarget as Node)) return; setIsDropActive(false); }}
              onDrop={onPickerDrop}
            >
              {/* Search bar */}
              <div className="p-2 border-b border-border">
                <div className="relative">
                  <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-muted-foreground" />
                  <Input
                    className="h-7 text-[11px] pl-7 pr-2"
                    placeholder={t("pickerSearchPlaceholder")}
                    value={pickerSearch}
                    onChange={(e) => setPickerSearch(e.target.value)}
                  />
                </div>
              </div>

              {/* Quick upload dropzone */}
              <div className="px-2 pt-2">
                <input
                  ref={uploadInputRef}
                  type="file"
                  accept="image/jpeg,image/jpg,image/png,video/mp4"
                  multiple
                  className="hidden"
                  onChange={(e) => {
                    const files = Array.from(e.target.files || []);
                    e.target.value = "";
                    if (files.length) handleFilesUpload(files);
                  }}
                />
                <button
                  type="button"
                  disabled={isUploading}
                  onClick={() => uploadInputRef.current?.click()}
                  className={`w-full flex items-center justify-center gap-1.5 rounded-md border border-dashed py-2 text-[10px] transition-colors ${
                    isDropActive ? "border-primary bg-primary/10 text-primary"
                    : isUploading ? "border-border bg-muted/40 text-muted-foreground"
                    : "border-muted-foreground/40 text-muted-foreground hover:border-primary hover:text-primary hover:bg-primary/5"
                  }`}
                >
                  <Upload className="w-3 h-3" />
                  {isUploading
                    ? t("studioUploading")
                    : isDropActive
                      ? t("studioDropzoneActive")
                      : (
                        <>
                          {t("studioDropzoneIdle")}
                          <span className="opacity-60">· {t("studioDropzoneClick")}</span>
                        </>
                      )}
                </button>
              </div>

              {/* Filter pills + view toggle + sort */}
              <div className="flex items-center gap-1 px-2 py-1.5 border-b border-border">
                <div className="flex gap-0.5 flex-1 overflow-x-auto">
                  {(["all", "image", "video", "widget"] as const).map((f) => (
                    <Button key={f} variant={pickerFilter === f ? "default" : "ghost"} size="sm"
                      className="h-5 text-[9px] px-2 rounded-full shrink-0"
                      onClick={() => setPickerFilter(f)}>
                      {t(`pickerFilter_${f}` as TranslationKey)}
                    </Button>
                  ))}
                </div>
                <Button variant="ghost" size="icon" className="h-5 w-5 shrink-0" title={t("pickerView")}
                  onClick={() => setPickerView(pickerView === "grid" ? "list" : "grid")}>
                  {pickerView === "grid" ? <LayoutGrid className="w-3 h-3" /> : <Layers className="w-3 h-3" />}
                </Button>
                <Button variant="ghost" size="icon" className="h-5 w-5 shrink-0" title={t("pickerSort")}
                  onClick={() => {
                    const order: Array<typeof pickerSort> = ["name-asc", "name-desc", "newest", "oldest"];
                    setPickerSort(order[(order.indexOf(pickerSort) + 1) % order.length]);
                  }}>
                  {pickerSort === "name-asc" ? <ArrowDownAZ className="w-3 h-3" /> :
                   pickerSort === "name-desc" ? <ArrowUpAZ className="w-3 h-3" /> :
                   <ArrowUpDown className="w-3 h-3" />}
                </Button>
              </div>

              {/* Select-all toolbar */}
              <div className="flex items-center justify-between px-2 py-1 border-b border-border bg-muted/30">
                <div className="flex items-center gap-1">
                  <Button variant="ghost" size="sm" className="h-5 text-[9px] px-1.5"
                    onClick={() => setSelectedPickerIds(new Set(filteredPickerItems.map((i) => i.id)))}
                    disabled={filteredPickerItems.length === 0}>
                    {t("pickerSelectAll")}
                  </Button>
                  <Button variant="ghost" size="sm" className="h-5 text-[9px] px-1.5"
                    onClick={() => setSelectedPickerIds(new Set())}
                    disabled={selectedPickerIds.size === 0}>
                    {t("pickerClearAll")}
                  </Button>
                </div>
                {selectedPickerIds.size > 0 && (
                  <span className="text-[9px] font-semibold text-primary">
                    {t("studioSelectedCount").replace("{count}", String(selectedPickerIds.size))}
                  </span>
                )}
              </div>

              {/* Items grid/list */}
              <div className="max-h-72 overflow-y-auto p-2">
                {filteredPickerItems.length === 0 ? (
                  <p className="text-[11px] text-muted-foreground text-center py-6">{t("mediaNoResult")}</p>
                ) : pickerView === "grid" ? (
                  <div className="grid grid-cols-3 gap-1.5">
                    {filteredPickerItems.map((item) => {
                      const isSelected = selectedPickerIds.has(item.id);
                      const typeBadge = item.kind === "widget" ? "WGT" : item.type === "video" ? "VID" : "IMG";
                      const badgeBg = item.kind === "widget" ? "bg-muted-foreground/80" : item.type === "video" ? "bg-destructive/80" : "bg-blue-500/80";
                      return (
                        <button
                          key={item.id}
                          type="button"
                          aria-checked={isSelected}
                          aria-label={`${item.name} (${typeBadge})`}
                          title={`${item.name}${item.kind === "media" ? `\n${item.raw.name}` : ""}`}
                          className={`group relative aspect-video rounded-md overflow-hidden border-2 transition-all ${
                            isSelected ? "border-primary ring-2 ring-primary/30" : "border-transparent hover:border-primary/60"
                          }`}
                          onClick={() => togglePickerItem(item.id)}
                        >
                          {/* Thumbnail */}
                          {item.kind === "media" && item.thumbnail ? (
                            <img src={item.thumbnail} alt={item.name} className="absolute inset-0 w-full h-full object-cover bg-muted" loading="lazy" />
                          ) : item.kind === "widget" && (item.raw as { config?: unknown })?.config ? (
                            <div className="absolute inset-0"><WidgetPreviewCard config={(item.raw as { config: Parameters<typeof WidgetPreviewCard>[0]["config"] }).config} /></div>
                          ) : (
                            <div className="absolute inset-0 flex items-center justify-center bg-muted">
                              {item.icon}
                            </div>
                          )}
                          {/* Video play overlay */}
                          {item.kind === "media" && item.type === "video" && (
                            <div className="absolute inset-0 flex items-center justify-center bg-black/20">
                              <Play className="w-5 h-5 text-white drop-shadow" fill="currentColor" />
                            </div>
                          )}
                          {/* Type badge */}
                          <span className={`absolute bottom-0.5 right-0.5 ${badgeBg} text-white text-[8px] font-bold px-1 py-0.5 rounded leading-none`}>
                            {typeBadge}
                          </span>
                          {/* Selected check */}
                          <span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-primary flex items-center justify-center transition-opacity ${isSelected ? "opacity-100" : "opacity-0"}`}>
                            <Check className="w-2.5 h-2.5 text-primary-foreground" strokeWidth={3} />
                          </span>
                          {/* Name caption */}
                          <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent text-white text-[9px] px-1 pt-2 pb-0.5 line-clamp-1 text-left">
                            {item.name}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  <div className="space-y-0.5">
                    {filteredPickerItems.map((item) => {
                      const isSelected = selectedPickerIds.has(item.id);
                      return (
                        <button key={item.id} className={`w-full flex items-center gap-2 p-1.5 rounded text-left text-xs transition-colors ${isSelected ? "bg-primary/10 ring-1 ring-primary/30" : "hover:bg-muted"}`}
                          onClick={() => togglePickerItem(item.id)}>
                          <div className={`w-4 h-4 rounded-sm border flex items-center justify-center shrink-0 transition-colors ${isSelected ? "bg-primary border-primary" : "border-muted-foreground/30"}`}>
                            {isSelected && <Check className="w-3 h-3 text-primary-foreground" />}
                          </div>
                          {item.kind === "media" && item.thumbnail ? (
                            <img src={item.thumbnail} alt="" className="w-8 h-8 rounded object-cover bg-muted shrink-0" loading="lazy" />
                          ) : item.kind === "widget" && (item.raw as { config?: unknown })?.config ? (
                            <div className="w-8 h-8 rounded overflow-hidden shrink-0"><WidgetPreviewCard config={(item.raw as { config: Parameters<typeof WidgetPreviewCard>[0]["config"] }).config} /></div>
                          ) : (
                            <div className="w-8 h-8 rounded bg-muted flex items-center justify-center shrink-0">{item.icon}</div>
                          )}
                          <span className="truncate text-foreground flex-1" lang="zh-Hant">{item.name}</span>
                          <Badge variant="outline" className="text-[9px] h-4 px-1 shrink-0">{item.kind === "media" ? (item.type === "image" ? "IMG" : "VID") : "Widget"}</Badge>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Bottom confirm bar */}
              <div className="flex items-center justify-between px-2 py-1.5 border-t border-border bg-muted/20">
                <span className="text-[10px] text-muted-foreground">
                  {t("studioSelectedCount").replace("{count}", String(selectedPickerIds.size))}
                </span>
                <Button size="sm" className="h-6 text-[10px] gap-1" disabled={selectedPickerIds.size === 0} onClick={confirmPickerSelection}>
                  <Check className="w-3 h-3" /> {t("studioConfirmAdd")}
                </Button>
              </div>
            </div>
          )}

          {/* Rename dialog after upload */}
          <Dialog open={!!renameTarget} onOpenChange={(open) => { if (!open) setRenameTarget(null); }}>
            <DialogContent className="max-w-sm">
              <DialogHeader>
                <DialogTitle>{t("studioRenameTitle")}</DialogTitle>
                <DialogDescription>{t("studioRenameDesc")}</DialogDescription>
              </DialogHeader>
              {renameTarget && (
                <div className="space-y-3">
                  <div className="text-xs text-muted-foreground">
                    <span className="font-medium">{t("studioRenameOriginalLabel")}：</span>
                    <span className="text-foreground" lang="zh-Hant">{renameTarget.originalFileName}</span>
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-foreground">{t("studioRenameLabel")}</label>
                    <Input
                      value={renameValue}
                      lang="zh-Hant"
                      autoFocus
                      onChange={(e) => setRenameValue(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter") submitRename(); }}
                    />
                  </div>
                </div>
              )}
              <DialogFooter>
                <Button variant="ghost" onClick={() => setRenameTarget(null)}>{t("studioRenameSkip")}</Button>
                <Button onClick={submitRename} disabled={!renameValue.trim()}>{t("studioRenameSave")}</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>

        {/* Text input */}
        <div>
          <label className="text-xs text-muted-foreground mb-1 block">{t("studioText")}</label>
          <Textarea
            placeholder={t("studioTextPlaceholder")}
            value={content.type === "text" ? content.value : ""}
            className="min-h-[60px] text-sm leading-relaxed resize-y"
            lang="zh-Hant"
            onChange={(e) => onUpdate({ ...content, type: "text", value: e.target.value })}
          />
        </div>
        {/* Font size */}
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <label className="text-xs text-muted-foreground">{t("studioFontSize")}</label>
            <span className="text-xs font-medium text-foreground">{content.fontSize || 24}px</span>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="icon" className="h-6 w-6 shrink-0" onClick={() => onUpdate({ ...content, fontSize: Math.max(12, (content.fontSize || 24) - 2) })}><Minus className="w-3 h-3" /></Button>
            <Slider value={[content.fontSize || 24]} min={12} max={72} step={2} onValueChange={([v]) => onUpdate({ ...content, fontSize: v })} className="flex-1" />
            <Button variant="outline" size="icon" className="h-6 w-6 shrink-0" onClick={() => onUpdate({ ...content, fontSize: Math.min(72, (content.fontSize || 24) + 2) })}><Plus className="w-3 h-3" /></Button>
          </div>
        </div>
        {/* Text align */}
        <div>
          <label className="text-xs text-muted-foreground mb-1.5 block">{t("studioTextAlign")}</label>
          <div className="flex gap-1">
            {([{ val: "left" as const, icon: <AlignLeft className="w-3.5 h-3.5" /> }, { val: "center" as const, icon: <AlignCenter className="w-3.5 h-3.5" /> }, { val: "right" as const, icon: <AlignRight className="w-3.5 h-3.5" /> }]).map(({ val, icon }) => (
              <Button key={val} variant={(content.textAlign || "center") === val ? "default" : "outline"} size="sm" className="h-7 w-9 px-0" onClick={() => onUpdate({ ...content, textAlign: val })}>{icon}</Button>
            ))}
          </div>
        </div>
        {/* BG color */}
        <div>
          <label className="text-xs text-muted-foreground mb-1 block">{t("studioBgColor")}</label>
          <div className="flex gap-1.5 flex-wrap">
            <button className="w-6 h-6 rounded-md border border-border hover:scale-110 transition-transform relative overflow-hidden" onClick={() => onUpdate({ ...content, bgColor: "transparent" })}
              style={{ background: "linear-gradient(45deg, #ccc 25%, transparent 25%, transparent 75%, #ccc 75%), linear-gradient(45deg, #ccc 25%, transparent 25%, transparent 75%, #ccc 75%)", backgroundSize: "8px 8px", backgroundPosition: "0 0, 4px 4px" }}>
              {(content.bgColor === "transparent" || !content.bgColor) && <div className="absolute inset-0 ring-2 ring-primary rounded-md" />}
            </button>
            {["hsl(var(--primary))", "hsl(var(--destructive))", "hsl(var(--warning))", "hsl(var(--success))", "hsl(220 14% 20%)", "hsl(0 0% 100%)", "hsl(280 60% 50%)", "hsl(190 70% 45%)"].map((c) => (
              <button key={c} className="w-6 h-6 rounded-md border border-border hover:scale-110 transition-transform" style={{ background: c }} onClick={() => onUpdate({ ...content, bgColor: c })} />
            ))}
          </div>
        </div>
      </div>
  );

  if (isEmbedded) return innerContent;

  return (
    <Card className="absolute z-50 p-4 w-80 shadow-xl border border-border animate-scale-in max-h-[90%] overflow-y-auto" style={{ top: 8, right: 8 }} onClick={(e) => e.stopPropagation()}>
      <div className="flex items-center justify-between mb-3">
        <span className="text-sm font-semibold text-foreground">{t("studioEditZone")} {zone.label}</span>
        <Button variant="ghost" size="icon" className="h-6 w-6" onClick={onClose}><X className="w-3.5 h-3.5" /></Button>
      </div>
      {innerContent}
    </Card>
  );
}

// ZoneAnimatedWrapper extracted to src/components/studio/ZoneAnimatedWrapper.tsx

// ── Widget Zone Preview ────────────────────────────────────────────
function WidgetZonePreview({ config }: { config: WidgetConfig }) {
  const [now, setNow] = useState(new Date());

  useEffect(() => {
    if (config?.widgetType === "clock" || config?.widgetType === "date") {
      const timer = setInterval(() => setNow(new Date()), 1000);
      return () => clearInterval(timer);
    }
  }, [config?.widgetType]);
  return <WidgetZonePreviewBody config={config} now={now} />;
}

// ── Taiwan district lookup for the weather_tw dependent select ──────────────
const _D = (names: string[]) => names.map(n => ({ value: n, label: n, label_zh: n }));
const TW_DISTRICTS: Record<string, Array<{ value: string; label: string; label_zh: string }>> = {
  "臺北市": _D(["中正區","大同區","中山區","松山區","大安區","萬華區","信義區","士林區","北投區","內湖區","南港區","文山區"]),
  "新北市": _D(["板橋區","三重區","中和區","永和區","新莊區","新店區","樹林區","鶯歌區","三峽區","淡水區","汐止區","瑞芳區","土城區","蘆洲區","五股區","泰山區","林口區","深坑區","石碇區","坪林區","三芝區","石門區","八里區","平溪區","雙溪區","貢寮區","金山區","萬里區","烏來區"]),
  "桃園市": _D(["桃園區","中壢區","大溪區","楊梅區","蘆竹區","大園區","龜山區","八德區","龍潭區","平鎮區","新屋區","觀音區","復興區"]),
  "臺中市": _D(["中區","東區","南區","西區","北區","北屯區","西屯區","南屯區","太平區","大里區","霧峰區","烏日區","豐原區","后里區","石岡區","東勢區","和平區","新社區","潭子區","大雅區","神岡區","大肚區","沙鹿區","龍井區","梧棲區","清水區","大甲區","外埔區","大安區"]),
  "臺南市": _D(["中西區","東區","南區","北區","安平區","安南區","永康區","歸仁區","新化區","左鎮區","玉井區","楠西區","南化區","仁德區","關廟區","龍崎區","官田區","麻豆區","佳里區","西港區","七股區","將軍區","學甲區","北門區","新營區","後壁區","白河區","東山區","六甲區","下營區","柳營區","鹽水區","善化區","大內區","山上區","新市區","安定區"]),
  "高雄市": _D(["楠梓區","左營區","鼓山區","三民區","鹽埕區","前金區","苓雅區","前鎮區","旗津區","小港區","鳳山區","林園區","大寮區","大樹區","大社區","仁武區","鳥松區","岡山區","橋頭區","燕巢區","田寮區","阿蓮區","路竹區","湖內區","茄萣區","永安區","彌陀區","梓官區","旗山區","美濃區","六龜區","甲仙區","杉林區","內門區","茂林區","桃源區","那瑪夏區"]),
  "基隆市": _D(["仁愛區","信義區","中正區","中山區","安樂區","暖暖區","七堵區"]),
  "新竹縣": _D(["竹北市","湖口鄉","新豐鄉","新埔鎮","關西鎮","芎林鄉","寶山鄉","竹東鎮","五峰鄉","橫山鄉","尖石鄉","北埔鄉","峨眉鄉"]),
  "新竹市": _D(["東區","北區","香山區"]),
  "苗栗縣": _D(["苗栗市","苑裡鎮","通霄鎮","竹南鎮","頭份市","後龍鎮","卓蘭鎮","大湖鄉","公館鄉","銅鑼鄉","南庄鄉","頭屋鄉","三義鄉","西湖鄉","造橋鄉","三灣鄉","獅潭鄉","泰安鄉"]),
  "彰化縣": _D(["彰化市","鹿港鎮","和美鎮","線西鄉","伸港鄉","福興鄉","秀水鄉","花壇鄉","芬園鄉","員林市","溪湖鎮","田中鎮","大村鄉","埔鹽鄉","埔心鄉","永靖鄉","社頭鄉","二水鄉","北斗鎮","二林鎮","田尾鄉","埤頭鄉","芳苑鄉","大城鄉","竹塘鄉","溪州鄉"]),
  "南投縣": _D(["南投市","中寮鄉","草屯鎮","國姓鄉","埔里鎮","仁愛鄉","名間鄉","集集鎮","水里鄉","魚池鄉","信義鄉","竹山鎮","鹿谷鄉"]),
  "雲林縣": _D(["斗南鎮","大埤鄉","虎尾鎮","土庫鎮","褒忠鄉","東勢鄉","台西鄉","崙背鄉","麥寮鄉","斗六市","林內鄉","古坑鄉","莿桐鄉","西螺鎮","二崙鄉","北港鎮","水林鄉","口湖鄉","四湖鄉","元長鄉"]),
  "嘉義縣": _D(["太保市","朴子市","布袋鎮","大林鎮","民雄鄉","溪口鄉","新港鄉","六腳鄉","東石鄉","義竹鄉","鹿草鄉","水上鄉","中埔鄉","竹崎鄉","梅山鄉","番路鄉","大埔鄉","阿里山鄉"]),
  "嘉義市": _D(["東區","西區"]),
  "屏東縣": _D(["屏東市","三地門鄉","霧臺鄉","瑪家鄉","九如鄉","里港鄉","高樹鄉","鹽埔鄉","長治鄉","麟洛鄉","竹田鄉","內埔鄉","萬丹鄉","潮州鎮","泰武鄉","來義鄉","萬巒鄉","崁頂鄉","新埤鄉","南州鄉","林邊鄉","東港鎮","琉球鄉","車城鄉","滿州鄉","枋寮鄉","新園鄉","枋山鄉","春日鄉","獅子鄉","牡丹鄉","恆春鎮","佳冬鄉"]),
  "宜蘭縣": _D(["宜蘭市","頭城鎮","礁溪鄉","壯圍鄉","員山鄉","羅東鎮","三星鄉","大同鄉","五結鄉","冬山鄉","蘇澳鎮","南澳鄉"]),
  "花蓮縣": _D(["花蓮市","新城鄉","秀林鄉","吉安鄉","壽豐鄉","鳳林鎮","光復鄉","豐濱鄉","瑞穗鄉","富里鄉","卓溪鄉","玉里鎮"]),
  "臺東縣": _D(["台東市","綠島鄉","蘭嶼鄉","延平鄉","卑南鄉","鹿野鄉","關山鎮","海端鄉","池上鄉","東河鄉","成功鎮","長濱鄉","太麻里鄉","金峰鄉","大武鄉","達仁鄉"]),
  "澎湖縣": _D(["馬公市","西嶼鄉","望安鄉","七美鄉","白沙鄉","湖西鄉"]),
  "金門縣": _D(["金城鎮","金湖鎮","金沙鎮","金寧鄉","烈嶼鄉","烏坵鄉"]),
  "連江縣": _D(["南竿鄉","北竿鄉","莒光鄉","東引鄉"]),
};
// Aliases for 台 / 臺 variants
TW_DISTRICTS["台北市"] = TW_DISTRICTS["臺北市"];
TW_DISTRICTS["台中市"] = TW_DISTRICTS["臺中市"];
TW_DISTRICTS["台南市"] = TW_DISTRICTS["臺南市"];
TW_DISTRICTS["台東縣"] = TW_DISTRICTS["臺東縣"];

// ColorSwatchInput extracted to src/components/studio/ColorSwatchInput.tsx

// ── Announcement scope picker (org + team dropdowns with auto-fill) ──────────
// ── QueueScopePicker ──────────────────────────────────────────────────────────
// Auto-fills org UUID from context; lets user pick team + individual queues.
function QueueScopePicker({
  orgId, teamId, queueIds, counterNames, ttsLang, cycleSeconds, numSize, labelSize, subLabelSize,
  onOrgChange, onTeamChange, onQueueIdsChange, onCounterNamesChange, onTtsLangChange, onCycleSecondsChange, onNumSizeChange, onLabelSizeChange, onSubLabelSizeChange,
  lang,
}: {
  orgId: string; teamId: string; queueIds: string[]; counterNames: string[];
  ttsLang: string; cycleSeconds: number; numSize: number; labelSize: number; subLabelSize: number;
  onOrgChange: (v: string) => void;
  onTeamChange: (v: string) => void;
  onQueueIdsChange: (v: string[]) => void;
  onCounterNamesChange: (v: string[]) => void;
  onTtsLangChange: (v: string) => void;
  onCycleSecondsChange: (v: number) => void;
  onNumSizeChange: (v: number) => void;
  onLabelSizeChange: (v: number) => void;
  onSubLabelSizeChange: (v: number) => void;
  lang: string;
}) {
  const { activeOrgId } = useActiveOrg();
  const [teams, setTeams] = useState<{ id: string; name: string }[]>([]);
  const [queues, setQueues] = useState<{ id: string; queue_name: string }[]>([]);
  const [availableCounters, setAvailableCounters] = useState<string[]>([]);

  // Always use the active org — auto-fill on first render
  useEffect(() => {
    if (activeOrgId) onOrgChange(activeOrgId);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeOrgId]);

  const resolvedOrg = activeOrgId || "";

  // Fetch teams when org changes
  useEffect(() => {
    if (!resolvedOrg) { setTeams([]); return; }
    void supabase.from("teams").select("id, name").eq("org_id", resolvedOrg).order("name")
      .then(({ data }) => setTeams((data || []) as { id: string; name: string }[]));
  }, [resolvedOrg]);

  // Fetch queues when org or team changes
  useEffect(() => {
    if (!resolvedOrg) { setQueues([]); return; }
    type QueueRow = { id: string; queue_name: string };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let q: any = (supabase as any).from("queue_system_queues").select("id, queue_name").eq("org_id", resolvedOrg);
    if (teamId) q = q.eq("team_id", teamId);
    void (q.order("queue_name") as Promise<{ data: QueueRow[] | null }>)
      .then(({ data }) => setQueues(data ?? []));
  }, [resolvedOrg, teamId]);

  // Fetch distinct counter names from recent tickets for the resolved queues
  useEffect(() => {
    if (!resolvedOrg) { setAvailableCounters([]); return; }
    // Build queue id filter: either from queueIds selection or all queues in org
    const qIds = queueIds.length > 0 ? queueIds : queues.map((q) => q.id);
    if (qIds.length === 0) { setAvailableCounters([]); return; }
    void supabase
      .from("queue_system_tickets")
      .select("counter_name")
      .in("queue_id", qIds)
      .neq("counter_name", "")
      .order("called_at", { ascending: false })
      .limit(200)
      .then(({ data }) => {
        const distinct = [...new Set((data ?? []).map((r) => r.counter_name))].sort();
        setAvailableCounters(distinct);
      });
  }, [resolvedOrg, queueIds, queues]);

  const isZh = lang === "zh" || lang === "zh-TW";
  const isJa = lang === "ja";

  const L = {
    team:      isZh ? "團隊（全組織則留空）" : isJa ? "チーム（組織全体は空白）" : "Team (leave blank for org-wide)",
    queues:    isZh ? "顯示的隊列（留空=全部）" : isJa ? "表示するキュー（空=全て）" : "Queues to display (empty = all)",
    counters:  isZh ? "服務櫃檯（留空=全部）" : isJa ? "カウンター（空=全て）" : "Counters (empty = all)",
    allCounters: isZh ? "（顯示全部櫃檯）" : isJa ? "（全カウンター）" : "(Show all counters)",
    noCounters:  isZh ? "尚無叫號紀錄" : isJa ? "まだ記録なし" : "No call records yet",
    teamAll:   isZh ? "全組織" : isJa ? "組織全体" : "Org-wide",
    teamPh:    isZh ? "選擇團隊" : isJa ? "チームを選択" : "Select team",
    allQueues: isZh ? "（顯示全部隊列）" : isJa ? "（全キュー表示）" : "(Show all queues)",
    tts:       isZh ? "語音播報語言" : isJa ? "TTS言語" : "TTS Language",
    cycle:     isZh ? "輪播間隔（秒）" : isJa ? "切替間隔（秒）" : "Cycle seconds",
  };

  const toggleQueue = (id: string) => {
    onQueueIdsChange(
      queueIds.includes(id) ? queueIds.filter((q) => q !== id) : [...queueIds, id],
    );
  };

  const toggleCounter = (name: string) => {
    onCounterNamesChange(
      counterNames.includes(name) ? counterNames.filter((c) => c !== name) : [...counterNames, name],
    );
  };

  return (
    <div className="space-y-2">
      {/* Team */}
      <div className="space-y-1">
        <Label className="text-[10px] text-muted-foreground">{L.team}</Label>
        <Select value={teamId || "__all__"} onValueChange={(v) => { onTeamChange(v === "__all__" ? "" : v); onQueueIdsChange([]); }}>
          <SelectTrigger className="h-7 text-xs"><SelectValue placeholder={L.teamPh} /></SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__" className="text-xs">{L.teamAll}</SelectItem>
            {teams.map((tm) => <SelectItem key={tm.id} value={tm.id} className="text-xs">{tm.name}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      {/* Queue picker */}
      {queues.length > 0 && (
        <div className="space-y-1">
          <Label className="text-[10px] text-muted-foreground">{L.queues}</Label>
          <div className="rounded-md border border-border bg-muted/30 p-2 space-y-1 max-h-32 overflow-y-auto">
            {queueIds.length === 0 && (
              <p className="text-[9px] text-muted-foreground italic">{L.allQueues}</p>
            )}
            {queues.map((q) => (
              <label key={q.id} className="flex items-center gap-1.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={queueIds.includes(q.id)}
                  onChange={() => toggleQueue(q.id)}
                  className="h-3 w-3 accent-primary"
                />
                <span className="text-[10px]">{q.queue_name}</span>
              </label>
            ))}
          </div>
        </div>
      )}

      {/* Counter picker */}
      <div className="space-y-1">
        <Label className="text-[10px] text-muted-foreground">{L.counters}</Label>
        <div className="rounded-md border border-border bg-muted/30 p-2 space-y-1 max-h-32 overflow-y-auto">
          {availableCounters.length === 0 ? (
            <p className="text-[9px] text-muted-foreground italic">{L.noCounters}</p>
          ) : (
            <>
              {counterNames.length === 0 && (
                <p className="text-[9px] text-muted-foreground italic">{L.allCounters}</p>
              )}
              {availableCounters.map((name) => (
                <label key={name} className="flex items-center gap-1.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={counterNames.includes(name)}
                    onChange={() => toggleCounter(name)}
                    className="h-3 w-3 accent-primary"
                  />
                  <span className="text-[10px]">{name}</span>
                </label>
              ))}
            </>
          )}
        </div>
      </div>

      {/* TTS Language */}
      <div className="space-y-1">
        <Label className="text-[10px] text-muted-foreground">{L.tts}</Label>
        <Select value={ttsLang || "zh-TW"} onValueChange={onTtsLangChange}>
          <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="zh-TW" className="text-xs">中文（台灣）</SelectItem>
            <SelectItem value="zh-CN" className="text-xs">中文（中国）</SelectItem>
            <SelectItem value="en-US" className="text-xs">English</SelectItem>
            <SelectItem value="ja-JP" className="text-xs">日本語</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Cycle seconds */}
      <div className="space-y-1">
        <Label className="text-[10px] text-muted-foreground">{L.cycle}</Label>
        <Input
          type="number"
          min={3}
          max={60}
          value={cycleSeconds || 8}
          onChange={(e) => onCycleSecondsChange(Math.max(3, Number(e.target.value) || 8))}
          className="h-7 text-xs"
        />
      </div>

      {/* Number font size */}
      <div className="space-y-1">
        <Label className="text-[10px] text-muted-foreground">
          {isZh ? "號碼字體大小（cqi %）" : isJa ? "番号フォントサイズ（cqi %）" : "Number font size (cqi %)"}
        </Label>
        <Input
          type="number"
          min={6}
          max={30}
          step={0.5}
          value={numSize ?? 16}
          onChange={(e) => onNumSizeChange(Math.max(6, Math.min(30, Number(e.target.value) || 16)))}
          className="h-7 text-xs"
        />
      </div>

      {/* Queue/counter label font size */}
      <div className="space-y-1">
        <Label className="text-[10px] text-muted-foreground">
          {isZh ? "隊列名稱字體大小（cqi %）" : isJa ? "キュー名フォントサイズ（cqi %）" : "Queue label font size (cqi %)"}
        </Label>
        <Input
          type="number"
          min={1}
          max={10}
          step={0.5}
          value={labelSize ?? 2.5}
          onChange={(e) => onLabelSizeChange(Math.max(1, Math.min(10, Number(e.target.value) || 2.5)))}
          className="h-7 text-xs"
        />
      </div>

      {/* Counter sub-label font size */}
      <div className="space-y-1">
        <Label className="text-[10px] text-muted-foreground">
          {isZh ? "服務櫃檯字體大小（cqi %）" : isJa ? "カウンター名フォントサイズ（cqi %）" : "Counter label font size (cqi %)"}
        </Label>
        <Input
          type="number"
          min={1}
          max={12}
          step={0.5}
          value={subLabelSize ?? 3}
          onChange={(e) => onSubLabelSizeChange(Math.max(1, Math.min(12, Number(e.target.value) || 3)))}
          className="h-7 text-xs"
        />
      </div>
    </div>
  );
}

// ── MeetingRoomScopePicker ─────────────────────────────────────────────────────
function MeetingRoomScopePicker({
  apiUrl, calendarId, lang, showTimeline, refreshSeconds,
  onApiUrlChange, onCalendarIdChange, onLangChange, onShowTimelineChange, onRefreshSecondsChange,
  uiLang,
}: {
  apiUrl: string; calendarId: string; lang: string; showTimeline: boolean; refreshSeconds: number;
  onApiUrlChange: (v: string) => void;
  onCalendarIdChange: (v: string) => void;
  onLangChange: (v: string) => void;
  onShowTimelineChange: (v: boolean) => void;
  onRefreshSecondsChange: (v: number) => void;
  uiLang: string;
}) {
  const isZh = uiLang === "zh" || uiLang === "zh-TW";
  const isJa = uiLang === "ja";
  const [rooms, setRooms] = useState<{ calendar_id: string; display_name?: string; resource_name: string }[]>([]);
  const [fetching, setFetching] = useState(false);

  // Fetch rooms from the API when URL changes
  useEffect(() => {
    if (!apiUrl) { setRooms([]); return; }
    setFetching(true);
    fetch(`${apiUrl}/api/v1/meeting-rooms`)
      .then((r) => r.ok ? r.json() : [])
      .then((data: { calendar_id: string; display_name?: string; resource_name: string }[]) => setRooms(Array.isArray(data) ? data : []))
      .catch(() => setRooms([]))
      .finally(() => setFetching(false));
  }, [apiUrl]);

  const L = {
    apiUrl:    isZh ? "BizBooking API 網址" : isJa ? "BizBooking API URL" : "BizBooking API URL",
    apiUrlPh:  "http://localhost:8083",
    room:      isZh ? "會議室" : isJa ? "会議室" : "Meeting Room",
    noRooms:   isZh ? "（請先輸入 API 網址）" : isJa ? "（API URLを入力してください）" : "(Enter API URL first)",
    lang:      isZh ? "語言" : isJa ? "言語" : "Language",
    timeline:  isZh ? "顯示今日排程" : isJa ? "本日スケジュール表示" : "Show today's schedule",
    refresh:   isZh ? "刷新間隔（秒）" : isJa ? "更新間隔（秒）" : "Refresh interval (s)",
  };

  return (
    <div className="space-y-2">
      {/* API URL */}
      <div className="space-y-1">
        <Label className="text-[10px] text-muted-foreground">{L.apiUrl}</Label>
        <Input
          value={apiUrl}
          onChange={(e) => onApiUrlChange(e.target.value)}
          placeholder={L.apiUrlPh}
          className="h-7 text-xs font-mono"
        />
      </div>

      {/* Room selector */}
      <div className="space-y-1">
        <Label className="text-[10px] text-muted-foreground">{L.room}</Label>
        {rooms.length > 0 ? (
          <Select value={calendarId} onValueChange={onCalendarIdChange}>
            <SelectTrigger className="h-7 text-xs">
              <SelectValue placeholder={isZh ? "選擇會議室" : "Select room"} />
            </SelectTrigger>
            <SelectContent>
              {rooms.map((r) => (
                <SelectItem key={r.calendar_id} value={r.calendar_id} className="text-xs">
                  {r.display_name ?? r.resource_name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : (
          <Input
            value={calendarId}
            onChange={(e) => onCalendarIdChange(e.target.value)}
            placeholder={fetching ? (isZh ? "載入中…" : "Loading…") : L.noRooms}
            className="h-7 text-xs font-mono"
          />
        )}
      </div>

      {/* Language */}
      <div className="space-y-1">
        <Label className="text-[10px] text-muted-foreground">{L.lang}</Label>
        <Select value={lang} onValueChange={onLangChange}>
          <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="zh-TW" className="text-xs">中文（台灣）</SelectItem>
            <SelectItem value="en-US" className="text-xs">English</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Show timeline toggle */}
      <div className="flex items-center justify-between">
        <Label className="text-[10px] text-muted-foreground">{L.timeline}</Label>
        <Switch
          checked={showTimeline}
          onCheckedChange={onShowTimelineChange}
          className="scale-75 origin-right"
        />
      </div>

      {/* Refresh interval */}
      <div className="space-y-1">
        <Label className="text-[10px] text-muted-foreground">{L.refresh}</Label>
        <Input
          type="number"
          min={10}
          max={300}
          value={refreshSeconds}
          onChange={(e) => onRefreshSecondsChange(Math.max(10, Number(e.target.value) || 30))}
          className="h-7 text-xs"
        />
      </div>
    </div>
  );
}

function AnnouncementScopePicker({
  orgId, teamId, onOrgChange, onTeamChange, lang,
}: {
  orgId: string; teamId: string;
  onOrgChange: (v: string) => void; onTeamChange: (v: string) => void;
  lang: string;
}) {
  const { orgs } = useUserOrgs();
  const { activeOrgId } = useActiveOrg();
  const [teams, setTeams] = useState<{ id: string; name: string }[]>([]);

  // Auto-fill orgId with activeOrgId on first render
  useEffect(() => {
    if (!orgId && activeOrgId) onOrgChange(activeOrgId);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeOrgId]);

  const resolvedOrg = orgId || activeOrgId || "";

  // Fetch teams whenever the effective org changes
  useEffect(() => {
    if (!resolvedOrg) { setTeams([]); return; }
    supabase.from("teams").select("id, name").eq("org_id", resolvedOrg).order("name")
      .then(({ data }) => setTeams((data || []) as { id: string; name: string }[]));
  }, [resolvedOrg]);

  const labels = {
    org:     lang === "zh" || lang === "zh-TW" ? "組織" : lang === "ja" ? "組織" : "Organisation",
    team:    lang === "zh" || lang === "zh-TW" ? "團隊（可選）" : lang === "ja" ? "チーム（任意）" : "Team (optional)",
    orgPh:   lang === "zh" || lang === "zh-TW" ? "選擇組織" : lang === "ja" ? "組織を選択" : "Select organisation",
    teamAll: lang === "zh" || lang === "zh-TW" ? "全組織" : lang === "ja" ? "組織全体" : "Org-wide",
    teamPh:  lang === "zh" || lang === "zh-TW" ? "選擇團隊" : lang === "ja" ? "チームを選択" : "Select team",
  };

  return (
    <div className="space-y-1.5">
      <div className="space-y-1">
        <Label className="text-[10px] text-muted-foreground">{labels.org}</Label>
        <Select value={resolvedOrg} onValueChange={(v) => { onOrgChange(v); onTeamChange(""); }}>
          <SelectTrigger className="h-7 text-xs"><SelectValue placeholder={labels.orgPh} /></SelectTrigger>
          <SelectContent>
            {orgs.map((o) => <SelectItem key={o.id} value={o.id} className="text-xs">{o.name}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-1">
        <Label className="text-[10px] text-muted-foreground">{labels.team}</Label>
        <Select value={teamId || "__all__"} onValueChange={(v) => onTeamChange(v === "__all__" ? "" : v)}>
          <SelectTrigger className="h-7 text-xs"><SelectValue placeholder={labels.teamPh} /></SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__" className="text-xs">{labels.teamAll}</SelectItem>
            {teams.map((tm) => <SelectItem key={tm.id} value={tm.id} className="text-xs">{tm.name}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}

// ── Dynamic param control (for HTML/catalog widgets with paramsSchema) ──
function DynamicParamControl({ param, value, onChange, lang }: {
  param: WidgetParamDef;
  value: unknown;
  onChange: (v: unknown) => void;
  lang: string;
}) {
  const label = ((lang === "zh" || lang === "zh-TW") && param.label_zh) ? param.label_zh : param.label;
  if (param.type === "select" && param.options) {
    return (
      <div className="space-y-1">
        <Label className="text-[10px] text-muted-foreground">{label}</Label>
        <Select value={String(value ?? param.default ?? "")} onValueChange={onChange}>
          <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            {param.options.map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>
                {((lang === "zh" || lang === "zh-TW") && opt.label_zh) ? opt.label_zh : opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    );
  }
  if (param.type === "toggle") {
    return (
      <div className="flex items-center justify-between pt-1">
        <Label className="text-[10px]">{label}</Label>
        <Switch checked={!!value} onCheckedChange={onChange} />
      </div>
    );
  }
  if (param.type === "color") {
    if (param.transparent) {
      const raw = String(value ?? param.default ?? "#000000");
      const isT = raw === "transparent";
      return (
        <div className="space-y-1">
          <Label className="text-[10px] text-muted-foreground">{label}</Label>
          <div className="flex items-center gap-1.5">
            <ColorSwatchInput value={raw} onChange={onChange} fallback="#0f172a" disabled={isT} />
            <button
              type="button"
              onClick={() => onChange(isT ? "#0f172a" : "transparent")}
              className={`h-8 px-2.5 rounded-full border text-[10px] shrink-0 transition-colors ${isT ? "bg-primary text-primary-foreground border-primary" : "border-border text-muted-foreground hover:border-primary hover:text-foreground"}`}
            >
              透明
            </button>
          </div>
        </div>
      );
    }
    return (
      <div className="space-y-1">
        <Label className="text-[10px] text-muted-foreground">{label}</Label>
        <ColorSwatchInput value={String(value ?? param.default ?? "#000000")} onChange={onChange} />
      </div>
    );
  }
  if (param.type === "number") {
    return (
      <div className="space-y-1">
        <Label className="text-[10px] text-muted-foreground">{label}</Label>
        <Input type="number" value={String(value ?? param.default ?? "")} min={param.min} onChange={(e) => onChange(Number(e.target.value))} className="h-7 text-xs" />
      </div>
    );
  }
  return (
    <div className="space-y-1">
      <Label className="text-[10px] text-muted-foreground">{label}</Label>
      <Input value={String(value ?? param.default ?? "")} onChange={(e) => onChange(e.target.value)} className="h-7 text-xs" />
    </div>
  );
}

// ── YouTube video-ID extractor (shared with YoutubeZonePreview below) ─
function parseYoutubeId(url: string): string | null {
  if (!url) return null;
  const patterns = [
    /(?:v=|\/embed\/|\.be\/)([A-Za-z0-9_-]{11})/,
    /^([A-Za-z0-9_-]{11})$/,
  ];
  for (const p of patterns) {
    const m = url.match(p);
    if (m) return m[1];
  }
  return null;
}

// ── YouTube IFrame API — singleton loader + duration probe ─────────
declare global { interface Window { onYouTubeIframeAPIReady?: () => void; YT?: { Player: new (el: HTMLElement, opts: object) => unknown } } }
let _ytReady = false;
const _ytQueue: Array<() => void> = [];
function _ensureYTApi(): Promise<void> {
  if (_ytReady) return Promise.resolve();
  return new Promise((resolve) => {
    _ytQueue.push(resolve);
    if (document.querySelector('script[src*="youtube.com/iframe_api"]')) return;
    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => { _ytReady = true; prev?.(); _ytQueue.splice(0).forEach(cb => cb()); };
    const s = document.createElement('script'); s.src = 'https://www.youtube.com/iframe_api'; document.head.appendChild(s);
  });
}
function fetchYoutubeDuration(videoId: string): Promise<number> {
  return _ensureYTApi().then(() => new Promise<number>((resolve) => {
    const el = document.createElement('div');
    el.style.cssText = 'position:fixed;left:-9999px;width:160px;height:90px;overflow:hidden';
    document.body.appendChild(el);
    let settled = false;
    const done = (dur: number) => {
      if (settled) return; settled = true;
      clearTimeout(timer);
      try { (player as { destroy?: () => void }).destroy?.(); } catch {}
      try { document.body.removeChild(el); } catch {}
      resolve(dur);
    };
    const timer = setTimeout(() => done(0), 12000);
    const player = new window.YT!.Player(el, {
      videoId,
      playerVars: { autoplay: 1, mute: 1, controls: 0, playsinline: 1 },
      events: {
        // onStateChange fires with PLAYING(1) once metadata is loaded — getDuration() is reliable here
        onStateChange: (e: { data: number; target: { getDuration: () => number; pauseVideo: () => void } }) => {
          if (e.data === 1) { e.target.pauseVideo(); done(e.target.getDuration()); }
          if (e.data === 0) done(0); // ended (live stream or very short)
        },
        onError: () => done(0),
      },
    });
  }));
}

// ── Widget Item Settings (timeline popover) ────────────────────────
function WidgetItemSettings({ config, onChange, onItemPatch }: {
  config: WidgetConfig;
  onChange: (next: WidgetConfig) => void;
  onItemPatch?: (patch: { duration?: number }) => void;
}) {
  const { t, language } = useLanguage();
  const wt = config?.widgetType as string | undefined;
  const set = (patch: Record<string, unknown>) => onChange({ ...config, ...patch });

  // Auto-detect YouTube duration when URL changes
  const onItemPatchRef = useRef(onItemPatch);
  onItemPatchRef.current = onItemPatch;
  const lastFetchedId = useRef<string | null>(null);
  useEffect(() => {
    if (wt !== "youtube") return;
    const vid = parseYoutubeId(config.youtubeUrl || "");
    if (!vid || vid === lastFetchedId.current) return;
    lastFetchedId.current = vid;
    fetchYoutubeDuration(vid).then(dur => {
      onItemPatchRef.current?.({ duration: dur > 0 ? Math.round(dur) : 300 });
    });
  }, [config.youtubeUrl, wt]);

  return (
    <div className="space-y-2 pt-2 border-t border-border">
      <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Widget</div>

      {wt === "marquee" && (
        <div className="space-y-1">
          <Label className="text-[10px] text-muted-foreground">{t("widgetText")}</Label>
          <Textarea
            value={config.text || ""}
            onChange={(e) => set({ text: e.target.value })}
            placeholder={t("widgetTextPlaceholder")}
            className="text-xs min-h-[48px]"
          />
          <Label className="text-[10px] text-muted-foreground">{t("widgetSpeed")}</Label>
          <Select value={config.speed || "normal"} onValueChange={(v) => set({ speed: v })}>
            <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="slow">{t("widgetSpeedSlow")}</SelectItem>
              <SelectItem value="normal">{t("widgetSpeedNormal")}</SelectItem>
              <SelectItem value="fast">{t("widgetSpeedFast")}</SelectItem>
            </SelectContent>
          </Select>
        </div>
      )}

      {wt === "webpage" && (
        <div className="space-y-1">
          <Label className="text-[10px] text-muted-foreground">{t("widgetUrl")}</Label>
          <Input value={config.url || ""} onChange={(e) => set({ url: e.target.value })} placeholder={t("widgetUrlPlaceholder")} className="h-7 text-xs" />
          {config.paramsSchema && config.paramsSchema.length > 0 && (
            <div className="space-y-1 pt-1 border-t border-border mt-1">
              {config.paramsSchema.map((param) => (
                <DynamicParamControl
                  key={param.key}
                  param={param}
                  value={(config.params || {})[param.key] ?? param.default}
                  onChange={(v) => set({ params: { ...(config.params || {}), [param.key]: v } })}
                  lang={language}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {/* HTML clock (has paramsSchema): DynamicParamControl handles all settings */}
      {wt === "clock" && config.paramsSchema && config.paramsSchema.length > 0 && (
        <div className="space-y-1 pt-1 border-t border-border mt-1">
          {config.paramsSchema.filter(p => p.key !== "showSec").map((param) => {
            const params = config.params || {};
            const label = ((language === "zh" || language === "zh-TW") && param.label_zh) ? param.label_zh : param.label;
            // timeFmt: render select + showSec toggle side by side
            if (param.key === "timeFmt") {
              const secParam = config.paramsSchema!.find(p => p.key === "showSec");
              const secVal = secParam ? !!(params["showSec"] ?? secParam.default) : false;
              return (
                <div key="timeFmt-sec" className="space-y-1">
                  <div className="flex items-center justify-between">
                    <Label className="text-[10px] text-muted-foreground">{label}</Label>
                    {secParam && (
                      <div className="flex items-center gap-1">
                        <span className="text-[10px] text-muted-foreground">
                          {((language === "zh" || language === "zh-TW") && secParam.label_zh) ? secParam.label_zh : secParam.label}
                        </span>
                        <Switch
                          checked={secVal}
                          onCheckedChange={(v) => set({ params: { ...params, showSec: v } })}
                        />
                      </div>
                    )}
                  </div>
                  <Select
                    value={String(params["timeFmt"] ?? param.default ?? "")}
                    onValueChange={(v) => set({ params: { ...params, timeFmt: v } })}
                  >
                    <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {param.options?.map((opt) => (
                        <SelectItem key={opt.value} value={opt.value}>
                          {((language === "zh" || language === "zh-TW") && opt.label_zh) ? opt.label_zh : opt.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              );
            }
            return (
              <DynamicParamControl
                key={param.key}
                param={param}
                value={params[param.key] ?? param.default}
                onChange={(v) => set({ params: { ...params, [param.key]: v } })}
                lang={language}
              />
            );
          })}
        </div>
      )}

      {/* Legacy React clock (no paramsSchema): manual settings */}
      {wt === "clock" && (!config.paramsSchema || config.paramsSchema.length === 0) && (
        <div className="space-y-1">
          <Label className="text-[10px] text-muted-foreground">{t("widgetClockStyle")}</Label>
          <Select value={config.clockStyle || "digital"} onValueChange={(v) => set({ clockStyle: v })}>
            <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="digital">Digital</SelectItem>
              <SelectItem value="analog">Analog</SelectItem>
            </SelectContent>
          </Select>
          <Label className="text-[10px] text-muted-foreground">{t("widgetFormat")}</Label>
          <Select value={config.format || "24"} onValueChange={(v) => set({ format: v })}>
            <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="24">{t("widgetFormat24")}</SelectItem>
              <SelectItem value="12">{t("widgetFormat12")}</SelectItem>
            </SelectContent>
          </Select>
          <Label className="text-[10px] text-muted-foreground">{t("widgetTimezone")}</Label>
          <Input value={config.timezone || ""} onChange={(e) => set({ timezone: e.target.value })} placeholder="Asia/Taipei" className="h-7 text-xs" />
          <div className="flex items-center justify-between pt-1">
            <Label className="text-[10px]">{t("widgetShowDate")}</Label>
            <Switch checked={!!config.showDate} onCheckedChange={(c) => set({ showDate: c })} />
          </div>
        </div>
      )}

      {wt === "qrcode" && (
        <div className="space-y-1">
          <Label className="text-[10px] text-muted-foreground">{t("widgetQrcodeContent")}</Label>
          <Input value={config.qrcodeContent || ""} onChange={(e) => set({ qrcodeContent: e.target.value })} placeholder="https://..." className="h-7 text-xs" />
          <div className="flex items-center justify-between">
            <Label className="text-[10px] text-muted-foreground">{t("widgetQrcodeSize")}</Label>
            <span className="text-[10px] font-mono">{config.qrcodeSize || 200}px</span>
          </div>
          <Slider value={[config.qrcodeSize || 200]} min={80} max={400} step={10} onValueChange={(v) => set({ qrcodeSize: v[0] })} />
        </div>
      )}

      {wt === "countdown" && (
        <div className="space-y-1">
          <Label className="text-[10px] text-muted-foreground">{t("widgetCountdownTitle")}</Label>
          <Input value={config.countdownTitle || ""} onChange={(e) => set({ countdownTitle: e.target.value })} placeholder={t("widgetCountdownTitlePlaceholder")} className="h-7 text-xs" />
          <Label className="text-[10px] text-muted-foreground">{t("widgetTargetDate")}</Label>
          <Input
            type="datetime-local"
            value={config.targetDate ? String(config.targetDate).slice(0, 16) : ""}
            onChange={(e) => set({ targetDate: e.target.value })}
            className="h-7 text-xs"
          />
        </div>
      )}

      {wt === "youtube" && (
        <div className="space-y-2">
          <div className="space-y-1">
            <Label className="text-[10px] text-muted-foreground">{t("widgetYoutubeUrl")}</Label>
            <Input value={config.youtubeUrl || ""} onChange={(e) => set({ youtubeUrl: e.target.value })} placeholder={t("widgetYoutubeUrlPlaceholder")} className="h-7 text-xs" />
          </div>
          <div className="flex items-center justify-between pt-0.5">
            <div>
              <Label className="text-[10px]">{t("widgetYoutubeEnableSound")}</Label>
              {config.youtubeMuted === false && (
                <p className="text-[9px] text-muted-foreground">{t("widgetYoutubeMuteBgmAuto")}</p>
              )}
            </div>
            <Switch
              checked={config.youtubeMuted === false}
              onCheckedChange={(c) => set({ youtubeMuted: !c, youtubeMuteBgm: c })}
            />
          </div>
          {config.youtubeMuted === false && (
            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <Label className="text-[10px] text-muted-foreground">{t("widgetYoutubeVolume")}</Label>
                <span className="text-[10px] font-mono tabular-nums">{config.youtubeVolume ?? 100}%</span>
              </div>
              <Slider
                value={[config.youtubeVolume ?? 100]}
                min={0} max={100} step={1}
                onValueChange={(v) => set({ youtubeVolume: v[0] })}
              />
            </div>
          )}
          <div className="space-y-1">
            <Label className="text-[10px] text-muted-foreground">{t("studioFitMode")}</Label>
            <Select value={(config.youtubeFit as string) || "cover"} onValueChange={(v) => set({ youtubeFit: v })}>
              <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="cover">{t("widgetYoutubeFitCover")}</SelectItem>
                <SelectItem value="contain">{t("widgetYoutubeFitContain")}</SelectItem>
                <SelectItem value="stretch">{t("widgetYoutubeFitStretch")}</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      )}

      {wt === "stream" && (
        <div className="space-y-1">
          <Label className="text-[10px] text-muted-foreground">{t("widgetStreamUrl")}</Label>
          <Input value={config.streamUrl || ""} onChange={(e) => set({ streamUrl: e.target.value })} placeholder={t("widgetStreamUrlPlaceholder")} className="h-7 text-xs" />
          {config.streamUrl && (
            <span className="text-[9px] px-1.5 py-0.5 rounded font-mono" style={{
              background: detectStreamProtocol(config.streamUrl) === "hls" ? "#10b98120" : "#f59e0b20",
              color: detectStreamProtocol(config.streamUrl) === "hls" ? "#10b981" : "#f59e0b",
            }}>
              {detectStreamProtocol(config.streamUrl).toUpperCase()}
              {detectStreamProtocol(config.streamUrl) !== "hls" && " — 需中繼轉 HLS"}
            </span>
          )}
          <Label className="text-[10px] text-muted-foreground mt-1">{t("widgetStreamFit")}</Label>
          <Select value={config.streamFit || "cover"} onValueChange={(v) => set({ streamFit: v })}>
            <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="cover">{t("widgetStreamFitCover")}</SelectItem>
              <SelectItem value="contain">{t("widgetStreamFitContain")}</SelectItem>
            </SelectContent>
          </Select>
          <div className="flex items-center justify-between pt-1">
            <Label className="text-[10px]">{t("widgetStreamMuted")}</Label>
            <Switch checked={config.streamMuted !== false} onCheckedChange={(c) => set({ streamMuted: c })} />
          </div>
        </div>
      )}

      {wt === "weather" && config.paramsSchema && config.paramsSchema.length > 0 && (
        <div className="space-y-1.5">
          {[
            ...config.paramsSchema.filter(p => p.key !== "weatherColor" && p.key !== "showUV" && p.key !== "showAQ"),
            ...(config.paramsSchema.some(p => p.key === "showUV") ? [] : [{ key: "showUV", type: "toggle" as const, label: "Show UV Index", label_zh: "顯示 UV 指數", default: true }]),
            ...(config.paramsSchema.some(p => p.key === "showAQ") ? [] : [{ key: "showAQ", type: "toggle" as const, label: "Show Air Quality", label_zh: "顯示空氣品質", default: true }]),
            ...(config.paramsSchema.filter(p => p.key === "showUV" || p.key === "showAQ")),
          ].map((param) => {
            const params = config.params || {};
            return (
              <DynamicParamControl
                key={param.key}
                param={param.key === "wallColor" ? { ...param, transparent: true } : param}
                value={params[param.key] ?? param.default}
                onChange={(v) => set({ params: { ...params, [param.key]: v } })}
                lang={language}
              />
            );
          })}
        </div>
      )}

      {wt === "weather_tw" && config.paramsSchema && config.paramsSchema.length > 0 && (
        <div className="space-y-1.5">
          {[
            ...config.paramsSchema.filter(p => p.key !== "weatherColor" && p.key !== "showUV" && p.key !== "showAQ"),
            ...(config.paramsSchema.some(p => p.key === "showUV") ? [] : [{ key: "showUV", type: "toggle" as const, label: "Show UV Index", label_zh: "顯示 UV 指數", default: true }]),
            ...(config.paramsSchema.some(p => p.key === "showAQ") ? [] : [{ key: "showAQ", type: "toggle" as const, label: "Show Air Quality", label_zh: "顯示空氣品質", default: true }]),
            ...(config.paramsSchema.filter(p => p.key === "showUV" || p.key === "showAQ")),
          ].map((param) => {
            const params = config.params || {};

            // District: county-dependent dropdown
            if (param.key === "regionName") {
              const county = String(params["locationName"] ?? "臺北市");
              const opts = TW_DISTRICTS[county] ?? TW_DISTRICTS["臺北市"] ?? [];
              return (
                <DynamicParamControl
                  key={param.key}
                  param={{ ...param, type: "select", options: opts }}
                  value={params["regionName"] ?? opts[0]?.value ?? ""}
                  onChange={(v) => set({ params: { ...params, regionName: v } })}
                  lang={language}
                />
              );
            }

            // County: auto-reset district on change
            return (
              <DynamicParamControl
                key={param.key}
                param={param.key === "wallColor" ? { ...param, transparent: true } : param}
                value={params[param.key] ?? param.default}
                onChange={(v) => {
                  if (param.key === "locationName") {
                    const firstDistrict = (TW_DISTRICTS[String(v)] ?? TW_DISTRICTS["臺北市"] ?? [])[0]?.value ?? "";
                    set({ params: { ...params, locationName: v, regionName: firstDistrict } });
                  } else {
                    set({ params: { ...params, [param.key]: v } });
                  }
                }}
                lang={language}
              />
            );
          })}
        </div>
      )}

      {wt === "announcement" && (
        <div className="space-y-1.5">
          <AnnouncementScopePicker
            orgId={String((config.params || {}).orgId ?? "")}
            teamId={String((config.params || {}).teamId ?? "")}
            onOrgChange={(v) => set({ params: { ...(config.params || {}), orgId: v, teamId: "" } })}
            onTeamChange={(v) => set({ params: { ...(config.params || {}), teamId: v } })}
            lang={language}
          />
          {config.paramsSchema?.filter((p) => p.key !== "orgId" && p.key !== "teamId").map((param) => (
            <DynamicParamControl
              key={param.key}
              param={param}
              value={(config.params || {})[param.key] ?? param.default}
              onChange={(v) => set({ params: { ...(config.params || {}), [param.key]: v } })}
              lang={language}
            />
          ))}
        </div>
      )}

      {wt === "queue-display" && (
        <QueueScopePicker
          orgId={String((config.params || {}).orgId ?? "")}
          teamId={String((config.params || {}).teamId ?? "")}
          queueIds={((config.params || {}).queueIds as string[] | undefined) ?? []}
          counterNames={((config.params || {}).counterNames as string[] | undefined) ?? []}
          ttsLang={String((config.params || {}).ttsLang ?? "zh-TW")}
          cycleSeconds={Number((config.params || {}).cycleSeconds ?? 8)}
          numSize={Number((config.params || {}).numSize ?? 16)}
          labelSize={Number((config.params || {}).labelSize ?? 2.5)}
          subLabelSize={Number((config.params || {}).subLabelSize ?? 3)}
          onOrgChange={(v) => set({ params: { ...(config.params || {}), orgId: v, teamId: "", queueIds: [], counterNames: [] } })}
          onTeamChange={(v) => set({ params: { ...(config.params || {}), teamId: v, queueIds: [], counterNames: [] } })}
          onQueueIdsChange={(v) => set({ params: { ...(config.params || {}), queueIds: v, counterNames: [] } })}
          onCounterNamesChange={(v) => set({ params: { ...(config.params || {}), counterNames: v } })}
          onTtsLangChange={(v) => set({ params: { ...(config.params || {}), ttsLang: v } })}
          onCycleSecondsChange={(v) => set({ params: { ...(config.params || {}), cycleSeconds: v } })}
          onNumSizeChange={(v) => set({ params: { ...(config.params || {}), numSize: v } })}
          onLabelSizeChange={(v) => set({ params: { ...(config.params || {}), labelSize: v } })}
          onSubLabelSizeChange={(v) => set({ params: { ...(config.params || {}), subLabelSize: v } })}
          lang={language}
        />
      )}

      {wt === "meeting-room" && (
        <MeetingRoomScopePicker
          apiUrl={String((config.params || {}).apiUrl ?? "")}
          calendarId={String((config.params || {}).calendarId ?? "")}
          lang={String((config.params || {}).lang ?? "zh-TW")}
          showTimeline={(config.params || {}).showTimeline as boolean ?? true}
          refreshSeconds={Number((config.params || {}).refreshSeconds ?? 30)}
          onApiUrlChange={(v) => set({ params: { ...(config.params || {}), apiUrl: v, calendarId: "" } })}
          onCalendarIdChange={(v) => set({ params: { ...(config.params || {}), calendarId: v } })}
          onLangChange={(v) => set({ params: { ...(config.params || {}), lang: v } })}
          onShowTimelineChange={(v) => set({ params: { ...(config.params || {}), showTimeline: v } })}
          onRefreshSecondsChange={(v) => set({ params: { ...(config.params || {}), refreshSeconds: v } })}
          uiLang={language}
        />
      )}

      {/* Common appearance — hidden for youtube/stream and for widgets that manage colors via their own paramsSchema */}
      {wt !== "youtube" && wt !== "stream" && wt !== "weather_tw" && wt !== "weather" && wt !== "announcement" && !(config.paramsSchema && config.paramsSchema.length > 0 && (wt === "webpage" || wt === "clock")) && <div className="grid grid-cols-2 gap-2 pt-1">
        <div className="space-y-1">
          <Label className="text-[10px] text-muted-foreground">{t("widgetBgColor")}</Label>
          <div className="flex items-center gap-1.5">
            <ColorSwatchInput
              value={config.bgColor || "#1a1a2e"}
              onChange={(v) => set({ bgColor: v })}
              fallback="#1a1a2e"
              disabled={config.bgColor === "transparent"}
            />
            <button
              type="button"
              onClick={() => set({ bgColor: config.bgColor === "transparent" ? "#1a1a2e" : "transparent" })}
              className={`h-8 px-2.5 rounded-full border text-[10px] shrink-0 transition-colors ${config.bgColor === "transparent" ? "bg-primary text-primary-foreground border-primary" : "border-border text-muted-foreground hover:border-primary hover:text-foreground"}`}
            >
              {t("transparent")}
            </button>
          </div>
        </div>
        <div className="space-y-1">
          <Label className="text-[10px] text-muted-foreground">{t("widgetTextColor")}</Label>
          <ColorSwatchInput value={config.textColor || "#ffffff"} onChange={(v) => set({ textColor: v })} />
        </div>
      </div>}

      {wt === "queue-display" && (
        <div className="space-y-1 pt-1">
          <Label className="text-[10px] text-muted-foreground">
            {language === "zh" ? "標籤文字顏色（隊列名 / 櫃檯名）" : language === "ja" ? "ラベル文字色（キュー名／カウンター名）" : "Label color (queue / counter name)"}
          </Label>
          <ColorSwatchInput value={config.params?.labelColor as string || "#ffffff80"} onChange={(v) => set({ params: { ...(config.params || {}), labelColor: v } })} />
        </div>
      )}

      {((wt === "clock" && (!config.paramsSchema || config.paramsSchema.length === 0)) || wt === "date" || wt === "marquee" || wt === "countdown") && (
        <div className="space-y-1">
          <Label className="text-[10px] text-muted-foreground">{t("widgetFontSize")}</Label>
          <Select value={config.fontSize || "medium"} onValueChange={(v) => set({ fontSize: v })}>
            <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="small">{t("widgetFontSizeSmall")}</SelectItem>
              <SelectItem value="medium">{t("widgetFontSizeMedium")}</SelectItem>
              <SelectItem value="large">{t("widgetFontSizeLarge")}</SelectItem>
              <SelectItem value="xlarge">{t("widgetFontSizeXLarge")}</SelectItem>
            </SelectContent>
          </Select>
        </div>
      )}

      <div className="space-y-1">
        <Label className="text-[10px] text-muted-foreground">{t("widgetAnimation")}</Label>
        <Select value={config.animation || "none"} onValueChange={(v) => set({ animation: v })}>
          <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="none">none</SelectItem>
            <SelectItem value="fadeIn">fadeIn</SelectItem>
            <SelectItem value="slideUp">slideUp</SelectItem>
            <SelectItem value="bounce">bounce</SelectItem>
            <SelectItem value="zoomIn">zoomIn</SelectItem>
            <SelectItem value="flipIn">flipIn</SelectItem>
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}

// ── Widget Zone Preview (continued original body) ──────────────────
function injectWidgetParams(html: string, params?: Record<string, unknown>): string {
  if (!params || Object.keys(params).length === 0) return html;
  const script = `<script>window.__widgetParams=${JSON.stringify(params)};</script>`;
  return html.includes('</head>') ? html.replace('</head>', script + '</head>') : script + html;
}

// ExternalWidgetZonePreview: calls sign-widget-params Edge Function to get a
// time-limited signed URL, then renders the third-party iframe.
function ExternalWidgetZonePreview({ appId, widgetUrl, lang, bg }: {
  appId: string; widgetUrl: string; lang: string; bg: string;
}) {
  const { activeOrgId } = useActiveOrg();
  const [signedUrl, setSignedUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!appId || !activeOrgId) return;
    let cancelled = false;
    supabase.functions.invoke("sign-widget-params", {
      body: { appId, orgId: activeOrgId, lang },
    }).then(({ data, error }) => {
      if (cancelled || error || !data?.signedParams) return;
      const base = data.widgetUrl || widgetUrl;
      setSignedUrl(`${base}${base.includes("?") ? "&" : "?"}${data.signedParams}`);
    });
    return () => { cancelled = true; };
  }, [appId, activeOrgId, lang, widgetUrl]);

  if (!signedUrl) {
    return (
      <div className="w-full h-full flex items-center justify-center" style={{ background: bg }}>
        <Loader2 className="w-5 h-5 animate-spin opacity-40" />
      </div>
    );
  }
  return (
    <div className="w-full h-full" style={{ background: bg }}>
      <iframe src={signedUrl} className="w-full h-full border-0" sandbox="allow-scripts allow-same-origin allow-forms" />
    </div>
  );
}

function WebpageZonePreview({ url, bg, fg, params, allowSameOrigin }: { url: string; bg: string; fg: string; params?: Record<string, unknown>; allowSameOrigin?: boolean }) {
  const isStorageUrl = url.includes('supabase.co/storage');
  const [rawHtml, setRawHtml] = useState<string | null>(isStorageUrl ? null : undefined as unknown as null);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const paramsRef = useRef(params);
  paramsRef.current = params;

  // Fetch HTML only for Supabase Storage URLs (text/plain content-type workaround)
  useEffect(() => {
    if (!isStorageUrl) return;
    if (!url) { setRawHtml(""); return; }
    setRawHtml(null);
    let cancelled = false;
    fetch(url)
      .then((r) => r.text())
      .then((html) => { if (!cancelled) setRawHtml(html); })
      .catch(() => { if (!cancelled) setRawHtml(""); });
    return () => { cancelled = true; };
  }, [url, isStorageUrl]);

  // Live param updates via postMessage (no iframe reload)
  useEffect(() => {
    if (!params) return;
    const win = iframeRef.current?.contentWindow;
    if (!win) return;
    win.postMessage({ widgetParams: params, clockConfig: params }, '*');
  }, [params]);  

  // External URL: use iframe src directly (no CORS issue for navigation)
  if (!isStorageUrl) {
    if (!url) return (
      <div className="w-full h-full flex flex-col items-center justify-center gap-1" style={{ background: bg, color: fg }}>
        <Globe className="w-6 h-6 opacity-50" />
        <span className="text-[10px] opacity-60">URL</span>
      </div>
    );
    return <iframe ref={iframeRef} src={url} className="w-full h-full border-0 pointer-events-none" sandbox="allow-scripts allow-same-origin" />;
  }

  // Supabase Storage HTML: fetch+srcDoc to bypass text/plain content-type
  if (rawHtml === null) return (
    <div className="w-full h-full flex items-center justify-center" style={{ background: bg }}>
      <Loader2 className="w-6 h-6 animate-spin opacity-40" style={{ color: fg }} />
    </div>
  );
  if (!rawHtml) return (
    <div className="w-full h-full flex flex-col items-center justify-center gap-1" style={{ background: bg, color: fg }}>
      <Globe className="w-6 h-6 opacity-50" />
      <span className="text-[10px] opacity-60">URL</span>
    </div>
  );
  return <iframe ref={iframeRef} srcDoc={injectWidgetParams(rawHtml, paramsRef.current)} className="w-full h-full border-0 pointer-events-none" sandbox={allowSameOrigin ? "allow-scripts allow-same-origin" : "allow-scripts"} />;
}

const MARQUEE_SIZE_RATIO: Record<string, number> = { small: 0.20, medium: 0.30, large: 0.45, xlarge: 0.60 };

function MarqueeZonePreview({ text, bg, fg, speed, fontSize: fontSizeKey }: { text: string; bg: string; fg: string; speed?: string; fontSize?: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [dims, setDims] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const obs = new ResizeObserver(entries => {
      const { width, height } = entries[0].contentRect;
      setDims({ w: Math.round(width), h: Math.round(height) });
    });
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
  const ratio = MARQUEE_SIZE_RATIO[fontSizeKey || 'medium'] ?? 0.30;
  const fsPx = dims.h > 0 ? Math.max(10, Math.round(dims.h * ratio)) : 16;
  // Duration scales with number of lines so each line gets same on-screen time
  const baseSec = speed === 'slow' ? 25 : speed === 'fast' ? 8 : 14;
  const duration = `${baseSec * lines.length}s`;

  return (
    <div ref={containerRef} className="w-full h-full flex items-center overflow-hidden" style={{ background: bg, color: fg }}>
      {dims.w > 0 && (
        <span style={{ display: 'inline-block', whiteSpace: 'nowrap', paddingLeft: `${dims.w}px`, fontSize: `${fsPx}px`, fontWeight: 500, animation: `marqueeScroll ${duration} linear infinite` }}>
          {lines.map((line, i) => (
            <span key={i} style={i < lines.length - 1 ? { marginRight: `${dims.w}px` } : {}}>
              {line}
            </span>
          ))}
        </span>
      )}
    </div>
  );
}

function CountdownZonePreview({ config, bg, fg }: { config: WidgetConfig; bg: string; fg: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [dims, setDims] = useState({ w: 0, h: 0 });
  const [now, setNow] = useState(new Date());
  const { t } = useLanguage();
  useEffect(() => {
    const obs = new ResizeObserver(entries => {
      const { width, height } = entries[0].contentRect;
      setDims({ w: Math.round(width), h: Math.round(height) });
    });
    if (containerRef.current) obs.observe(containerRef.current);
    return () => obs.disconnect();
  }, []);
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  const ratio = MARQUEE_SIZE_RATIO[config.fontSize || 'medium'] ?? 0.30;
  const hasTitle = !!config.countdownTitle;
  // Reserve space for labels (~35% of digit height) when computing available height
  const heightForDigits = hasTitle ? dims.h * 0.50 : dims.h * 0.68;
  const maxFromH = heightForDigits * ratio;
  // Each 2-digit monospace number ≈ fontSize × 1.2 wide; 4 numbers + 3 gaps (0.6×) = fontSize × 6.6
  const maxFromW = dims.w > 0 ? (dims.w * 0.90) / 6.6 : 999;
  const digitsPx = dims.h > 0 ? Math.max(10, Math.floor(Math.min(maxFromH, maxFromW))) : 16;
  const titlePx  = dims.h > 0 ? Math.max(8, Math.floor(dims.h * 0.12)) : 10;
  const labelPx  = Math.max(7, Math.floor(digitsPx * 0.32));
  const gapPx    = Math.max(2, Math.floor(digitsPx * 0.3));
  const innerGap = Math.max(1, Math.floor(digitsPx * 0.08));

  const target = config.targetDate ? new Date(config.targetDate).getTime() : Date.now() + 86400000;
  const diff = Math.max(0, target - now.getTime());
  const days  = Math.floor(diff / 86400000);
  const hours = Math.floor((diff % 86400000) / 3600000);
  const mins  = Math.floor((diff % 3600000) / 60000);
  const secs  = Math.floor((diff % 60000) / 1000);
  const labels = [t("widgetDays"), t("widgetHours"), t("widgetMinutes"), t("widgetSeconds")];

  return (
    <div ref={containerRef} className="w-full h-full flex flex-col items-center justify-center" style={{ background: bg, color: fg, gap: `${gapPx}px` }}>
      {config.countdownTitle && <span style={{ fontSize: `${titlePx}px`, fontWeight: 'bold', opacity: 0.7 }}>{config.countdownTitle}</span>}
      <div className="flex" style={{ gap: `${gapPx}px` }}>
        {[days, hours, mins, secs].map((v, i) => (
          <div key={i} className="flex flex-col items-center" style={{ gap: `${innerGap}px` }}>
            <span style={{ fontSize: `${digitsPx}px`, fontFamily: 'monospace', fontWeight: 'bold', lineHeight: 1 }}>{String(v).padStart(2, "0")}</span>
            <span style={{ fontSize: `${labelPx}px`, opacity: 0.65, lineHeight: 1 }}>{labels[i]}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function QRCodeZonePreview({ content, bg, fg }: { content: string; bg: string; fg: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [dims, setDims] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const obs = new ResizeObserver(entries => {
      const { width, height } = entries[0].contentRect;
      setDims({ w: Math.round(width), h: Math.round(height) });
    });
    if (containerRef.current) obs.observe(containerRef.current);
    return () => obs.disconnect();
  }, []);
  const qrSize = dims.h > 0 ? Math.round(Math.min(dims.w, dims.h) * 0.78) : 80;
  return (
    <div ref={containerRef} className="w-full h-full flex items-center justify-center" style={{ background: bg }}>
      {dims.h > 0 && <QRCodeSVG value={content} size={qrSize} bgColor={bg === 'transparent' ? 'transparent' : bg} fgColor={fg} level="M" />}
    </div>
  );
}

function detectStreamProtocol(url: string): "hls" | "rtmp" | "rtsp" | "unknown" {
  if (!url) return "unknown";
  if (/^rtmp[se]?:\/\//i.test(url)) return "rtmp";
  if (/^rtsps?:\/\//i.test(url)) return "rtsp";
  return "hls"; // treat all http/https as HLS
}

function StreamZonePreview({ url, muted = true, fitMode = "cover" }: { url?: string; muted?: boolean; fitMode?: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [streamError, setStreamError] = useState<string | null>(null);

  const proto = url ? detectStreamProtocol(url) : "unknown";
  const isHls = !!url && proto === "hls";

  useEffect(() => {
    setStreamError(null);
    if (!isHls) return;
    const video = videoRef.current;
    if (!video || !url) return;
    let hls: Hls | null = null;
    if (Hls.isSupported()) {
      hls = new Hls({ enableWorker: false, lowLatencyMode: true });
      hls.loadSource(url);
      hls.attachMedia(video);
      hls.on(Hls.Events.MANIFEST_PARSED, () => { video.play().catch(() => {}); });
      hls.on(Hls.Events.ERROR, (_e, data) => {
        if (data.fatal) {
          const isNetwork = data.type === Hls.ErrorTypes.NETWORK_ERROR;
          const isMixed = url.startsWith('http://') && location.protocol === 'https:';
          setStreamError(isMixed ? '混合內容封鎖 (HTTP → HTTPS)' : isNetwork ? '無法連線到串流來源' : '串流載入失敗');
        }
      });
    } else if (video.canPlayType("application/vnd.apple.mpegurl")) {
      video.src = url;
      video.onerror = () => setStreamError('串流載入失敗');
      video.play().catch(() => {});
    }
    return () => { hls?.destroy(); };
  }, [url, isHls]);

  const protoColor = proto === "hls" ? "#10b981" : proto !== "unknown" ? "#f59e0b" : "#6b7280";

  if (!isHls) {
    const hint = proto === "rtmp" ? "nginx-rtmp / Wowza → HLS" : proto === "rtsp" ? "go2rtc / mediamtx → HLS" : null;
    return (
      <div ref={containerRef} className="w-full h-full flex flex-col items-center justify-center gap-1.5 px-3" style={{ background: '#0a0a1a' }}>
        <Radio className="w-6 h-6 opacity-70" style={{ color: protoColor }} />
        {url ? (
          <>
            <span className="text-[9px] px-1.5 py-0.5 rounded font-mono" style={{ background: protoColor + '25', color: protoColor }}>{proto.toUpperCase()}</span>
            <span className="text-[8px] text-white/40 text-center">{hint}</span>
            <span className="text-[8px] text-amber-400/60 text-center">需中繼伺服器轉為 HLS 播放</span>
          </>
        ) : (
          <span className="text-[10px] text-white/30">未設定串流網址</span>
        )}
      </div>
    );
  }

  const objFit = fitMode === 'contain' ? 'contain' : 'cover';
  return (
    <div ref={containerRef} className="w-full h-full relative overflow-hidden" style={{ background: '#000' }}>
      <video
        ref={videoRef}
        muted={muted}
        playsInline
        autoPlay
        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: objFit, pointerEvents: 'none' }}
      />
      {streamError && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 bg-black/80 px-2">
          <Radio className="w-5 h-5 text-red-400 opacity-80" />
          <span className="text-[9px] text-red-300 text-center leading-tight">{streamError}</span>
          <span className="text-[8px] text-white/30 text-center leading-tight break-all">{url}</span>
        </div>
      )}
    </div>
  );
}

function extractYoutubeId(url: string): string | null { return parseYoutubeId(url); }

function YoutubeZonePreview({ url, bg, muted = true, volume = 100, fitMode = "cover" }: { url: string; bg: string; muted?: boolean; volume?: number; fitMode?: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [dims, setDims] = useState({ w: 0, h: 0 });

  useEffect(() => {
    const obs = new ResizeObserver(entries => {
      const { width, height } = entries[0].contentRect;
      setDims({ w: Math.round(width), h: Math.round(height) });
    });
    if (containerRef.current) obs.observe(containerRef.current);
    return () => obs.disconnect();
  }, []);

  const videoId = extractYoutubeId(url);

  // End-screen prevention (seek back) + initial volume set on first PLAYING state
  useEffect(() => {
    if (!videoId) return;
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
  }, [videoId, muted]);

  // Live-update volume when slider changes (iframe already playing)
  useEffect(() => {
    if (muted || !videoId) return;
    iframeRef.current?.contentWindow?.postMessage(
      JSON.stringify({ event: 'command', func: 'setVolume', args: [volume] }), '*'
    );
  }, [volume, muted, videoId]);

  if (!videoId) return (
    <div ref={containerRef} className="w-full h-full flex items-center justify-center" style={{ background: bg }}>
      <Youtube className="w-8 h-8 opacity-50" />
    </div>
  );

  const muteParam = muted ? 1 : 0;
  const embedUrl = `https://www.youtube.com/embed/${videoId}?autoplay=1&mute=${muteParam}&loop=1&playlist=${videoId}&controls=0&modestbranding=1&rel=0&iv_load_policy=3&disablekb=1&enablejsapi=1`;

  // Build iframe positioning based on fitMode
  let iframeStyle: React.CSSProperties = { border: 0, pointerEvents: 'none', position: 'absolute', inset: 0, width: '100%', height: '100%' };

  if (dims.w > 0 && dims.h > 0) {
    const videoAspect = 16 / 9;
    const zoneAspect = dims.w / dims.h;

    if (fitMode === "contain") {
      // Letterbox: fit video inside zone, maintain aspect
      let w: number, h: number;
      if (zoneAspect > videoAspect) {
        h = dims.h;
        w = Math.round(dims.h * videoAspect);
      } else {
        w = dims.w;
        h = Math.round(dims.w / videoAspect);
      }
      iframeStyle = { border: 0, pointerEvents: 'none', position: 'absolute', width: `${w}px`, height: `${h}px`, top: `${Math.round((dims.h - h) / 2)}px`, left: `${Math.round((dims.w - w) / 2)}px` };
    } else if (fitMode === "stretch") {
      // Fill zone completely, ignore aspect ratio
      iframeStyle = { border: 0, pointerEvents: 'none', position: 'absolute', inset: 0, width: '100%', height: '100%' };
    } else {
      // Cover: fill zone, crop if needed (with scale(1.22) for chrome removal)
      const baseStyle: React.CSSProperties = { border: 0, pointerEvents: 'none', transform: 'scale(1.22)', transformOrigin: 'center center' };
      if (zoneAspect > videoAspect) {
        const iframeH = Math.ceil(dims.w / videoAspect);
        iframeStyle = { ...baseStyle, position: 'absolute', width: `${dims.w}px`, height: `${iframeH}px`, top: `${Math.floor((dims.h - iframeH) / 2)}px`, left: 0 };
      } else {
        const iframeW = Math.ceil(dims.h * videoAspect);
        iframeStyle = { ...baseStyle, position: 'absolute', height: `${dims.h}px`, width: `${iframeW}px`, left: `${Math.floor((dims.w - iframeW) / 2)}px`, top: 0 };
      }
    }
  }

  return (
    <div ref={containerRef} className="w-full h-full relative overflow-hidden" style={{ background: bg }}>
      {dims.w > 0 && <iframe ref={iframeRef} src={embedUrl} style={iframeStyle} allow="autoplay; encrypted-media" />}
    </div>
  );
}

function WidgetZonePreviewBody({ config, now }: { config: WidgetConfig; now: Date }) {

  if (!config) return null;
  const bg = config.bgColor || (config.widgetType === "youtube" || config.widgetType === "stream" ? "transparent" : "#1a1a2e");
  const fg = config.textColor || "#ffffff";
  const fontSize = config.fontSize || "medium";
  const ZONE_FS: Record<string, Record<string, string>> = {
    small: { time: "text-base", title: "text-xs", countdown: "text-base", marquee: "text-xs" },
    medium: { time: "text-2xl", title: "text-[10px]", countdown: "text-lg", marquee: "text-sm" },
    large: { time: "text-3xl", title: "text-sm", countdown: "text-2xl", marquee: "text-lg" },
    xlarge: { time: "text-4xl", title: "text-base", countdown: "text-3xl", marquee: "text-xl" },
  };
  const zfs = ZONE_FS[fontSize] || ZONE_FS.medium;

  if (config.widgetType === "clock") {
    // HTML clock widget from Supabase Storage takes precedence
    if (config.url) {
      return <WebpageZonePreview url={String(config.url)} bg={bg} params={config.params as Record<string, unknown> | undefined} />;
    }
    // Legacy React clock fallback (for old zones without a URL)
    const tz = config.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (config.clockStyle === "analog") {
      const hParts = now.toLocaleString("en-US", { hour: "numeric", minute: "numeric", second: "numeric", hour12: false, timeZone: tz }).split(":");
      const h = parseInt(hParts[0]), m = parseInt(hParts[1]), s = parseInt(hParts[2]);
      const hDeg = (h % 12) * 30 + m * 0.5, mDeg = m * 6, sDeg = s * 6;
      return (
        <div className="w-full h-full flex items-center justify-center" style={{ background: bg }}>
          <svg viewBox="0 0 200 200" className="w-[70%] max-w-[160px]">
            <circle cx="100" cy="100" r="96" fill="none" stroke={fg} strokeWidth="2" opacity="0.15" />
            {[...Array(12)].map((_, i) => {
              const num = i === 0 ? 12 : i;
              const angle = (i * 30 - 90) * Math.PI / 180;
              return <text key={i} x={100 + 78 * Math.cos(angle)} y={100 + 78 * Math.sin(angle)} textAnchor="middle" dominantBaseline="central" fill={fg} fontSize="14" fontWeight="600" opacity="0.8">{num}</text>;
            })}
            {[...Array(60)].map((_, i) => {
              const angle = (i * 6 - 90) * Math.PI / 180;
              const isH = i % 5 === 0;
              return <line key={i} x1={100 + (isH ? 86 : 89) * Math.cos(angle)} y1={100 + (isH ? 86 : 89) * Math.sin(angle)} x2={100 + 92 * Math.cos(angle)} y2={100 + 92 * Math.sin(angle)} stroke={fg} strokeWidth={isH ? 2 : 0.8} opacity={isH ? 0.6 : 0.3} />;
            })}
            <polygon points={`${100 + 45 * Math.cos((hDeg - 90) * Math.PI / 180)},${100 + 45 * Math.sin((hDeg - 90) * Math.PI / 180)} ${100 + 5 * Math.cos(hDeg * Math.PI / 180)},${100 + 5 * Math.sin(hDeg * Math.PI / 180)} ${100 - 10 * Math.cos((hDeg - 90) * Math.PI / 180)},${100 - 10 * Math.sin((hDeg - 90) * Math.PI / 180)} ${100 - 5 * Math.cos(hDeg * Math.PI / 180)},${100 - 5 * Math.sin(hDeg * Math.PI / 180)}`} fill={fg} opacity="0.9" />
            <polygon points={`${100 + 65 * Math.cos((mDeg - 90) * Math.PI / 180)},${100 + 65 * Math.sin((mDeg - 90) * Math.PI / 180)} ${100 + 4 * Math.cos(mDeg * Math.PI / 180)},${100 + 4 * Math.sin(mDeg * Math.PI / 180)} ${100 - 12 * Math.cos((mDeg - 90) * Math.PI / 180)},${100 - 12 * Math.sin((mDeg - 90) * Math.PI / 180)} ${100 - 4 * Math.cos(mDeg * Math.PI / 180)},${100 - 4 * Math.sin(mDeg * Math.PI / 180)}`} fill={fg} opacity="0.85" />
            <line x1={100 - 18 * Math.cos((sDeg - 90) * Math.PI / 180)} y1={100 - 18 * Math.sin((sDeg - 90) * Math.PI / 180)} x2={100 + 72 * Math.cos((sDeg - 90) * Math.PI / 180)} y2={100 + 72 * Math.sin((sDeg - 90) * Math.PI / 180)} stroke="hsl(0 70% 55%)" strokeWidth="1.2" strokeLinecap="round" />
            <circle cx="100" cy="100" r="5" fill={fg} />
            <circle cx="100" cy="100" r="2.5" fill="hsl(0 70% 55%)" />
          </svg>
        </div>
      );
    }
    const opts: Intl.DateTimeFormatOptions = { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: config.format === "12", timeZone: tz };
    const timeStr = now.toLocaleTimeString("en-US", opts);
    return (
      <div className="w-full h-full flex flex-col items-center justify-center gap-1" style={{ background: bg, color: fg }}>
        <span className={`${zfs.time} font-mono font-bold tracking-wider`}>{timeStr}</span>
        {config.showDate && <span className="text-[10px] opacity-60">{now.toLocaleDateString("zh-TW", { month: "short", day: "numeric", timeZone: tz })}</span>}
      </div>
    );
  }

  if (config.widgetType === "date") {
    return (
      <div className="w-full h-full flex flex-col items-center justify-center gap-1" style={{ background: bg, color: fg }}>
        <span className="text-sm font-medium opacity-70">{now.toLocaleDateString("zh-TW", { weekday: "long" })}</span>
        <span className="text-xl font-bold">{now.toLocaleDateString("zh-TW", { year: "numeric", month: "long", day: "numeric" })}</span>
      </div>
    );
  }

  if (config.widgetType === "marquee" && config.text) {
    return <MarqueeZonePreview text={config.text} bg={bg} fg={fg} speed={config.speed} fontSize={config.fontSize} />;
  }

  if (config.widgetType === "webpage") {
    return <WebpageZonePreview url={config.url || ""} bg={bg} fg={fg} params={config.params} />;
  }

  if (config.widgetType === "qrcode") {
    return <QRCodeZonePreview content={config.qrcodeContent || "https://example.com"} bg={bg} fg={fg} />;
  }

  if (config.widgetType === "countdown") {
    return <CountdownZonePreview config={config} bg={bg} fg={fg} />;
  }

  if (config.widgetType === "youtube") {
    return <YoutubeZonePreview url={config.youtubeUrl || ""} bg={bg} muted={config.youtubeMuted !== false} volume={config.youtubeVolume ?? 100} fitMode={(config.youtubeFit as string) || "cover"} />;
  }

  if (config.widgetType === "stream") {
    return <StreamZonePreview url={config.streamUrl as string | undefined} muted={config.streamMuted !== false} fitMode={config.streamFit as string | undefined} />;
  }

  if (config.widgetType === "weather") {
    if (config.url) return <WebpageZonePreview url={String(config.url)} bg={bg} fg={fg} params={config.params as Record<string, unknown> | undefined} allowSameOrigin />;
    return (
      <div className="w-full h-full flex flex-col items-center justify-center gap-1" style={{ background: bg, color: fg }}>
        <CloudSun className="w-6 h-6 opacity-50" />
        <span className="text-[9px] font-medium opacity-70">全球天氣</span>
      </div>
    );
  }

  if (config.widgetType === "weather_tw") {
    return <WebpageZonePreview url={config.url || ""} bg={bg} fg={fg} params={config.params} allowSameOrigin />;
  }

  if (config.widgetType === "announcement") {
    return <WebpageZonePreview url={config.url || ""} bg={bg} fg={fg} params={config.params as Record<string, unknown> | undefined} allowSameOrigin />;
  }

  if (config.widgetType === "queue-display") {
    return (
      <QueueDisplayWidget config={{
        orgId: (config.params?.orgId as string) || "",
        teamId: (config.params?.teamId as string | undefined) || undefined,
        queueIds: (config.params?.queueIds as string[] | undefined) || undefined,
        counterNames: (config.params?.counterNames as string[] | undefined) || undefined,
        ttsLang: (config.params?.ttsLang as string | undefined) || "zh-TW",
        cycleSeconds: (config.params?.cycleSeconds as number | undefined) || 8,
        bgColor: config.bgColor || undefined,
        textColor: config.textColor || undefined,
        numSize: Number((config.params?.numSize as number | undefined) ?? 16),
        labelColor: (config.params?.labelColor as string | undefined) || undefined,
        labelSize: Number((config.params?.labelSize as number | undefined) ?? 2.5),
        subLabelSize: Number((config.params?.subLabelSize as number | undefined) ?? 3),
      }} />
    );
  }

  if (config.widgetType === "meeting-room") {
    return (
      <MeetingRoomWidget config={{
        apiUrl:         (config.params?.apiUrl        as string) || "",
        calendarId:     (config.params?.calendarId    as string) || "",
        lang:           ((config.params?.lang         as string) || "zh-TW") as "zh-TW" | "en-US",
        showTimeline:   (config.params?.showTimeline  as boolean) ?? true,
        refreshSeconds: Number(config.params?.refreshSeconds ?? 30),
        bgColor:        config.bgColor || undefined,
        textColor:      config.textColor || undefined,
      }} />
    );
  }

  // External third-party widget: fetch signed URL from Edge Function
  if (config.widgetScope === "external" && config.widgetAppId && config.url) {
    return (
      <ExternalWidgetZonePreview
        appId={String(config.widgetAppId)}
        widgetUrl={String(config.url)}
        lang="zh"
        bg={bg}
      />
    );
  }

  return (
    <div className="w-full h-full flex items-center justify-center" style={{ background: bg, color: fg }}>
      <Code2 className="w-6 h-6 opacity-50" />
    </div>
  );
}

// ── Main page ──────────────────────────────────────────────────────
export default function ContentStudioPage() {
  const { t, language } = useLanguage();
  const { user } = useAuth();
  const { activeOrgId } = useActiveOrg();
  const { defaultOrgId } = useUserOrgs();
  const { installedApps } = useInstalledApps();
  const { widgets: catalogWidgets } = useWidgets();
  const [aspect, setAspect] = useState<AspectRatio>("16:9");
  const [resolution, setResolution] = useState<Resolution>(() => getDefaultResolution("16:9"));
  type OutputMode = "mirror" | "independent" | "extend-h" | "extend-v" | "grid-2x2-h";
  const [outputMode, setOutputMode] = useState<OutputMode>("mirror");
  const [outputCount, setOutputCount] = useState<number>(1);
  const [activeOutput, setActiveOutput] = useState<number>(1);
  // Keep a stable ref so callbacks can always read the latest activeOutput without deps
  const activeOutputRef = useRef<number>(1);
  activeOutputRef.current = activeOutput;
  const [outputModeOpen, setOutputModeOpen] = useState(false);
  // Draft state while the popover is open — committed only on Confirm
  const [pendingOutputMode, setPendingOutputMode] = useState<OutputMode>("mirror");
  const [pendingOutputCount, setPendingOutputCount] = useState<number>(1);
  const [showCustomResDialog, setShowCustomResDialog] = useState(false);
  const [customResW, setCustomResW] = useState(() => loadStoredCustomRes()?.w ?? "1920");
  const [customResH, setCustomResH] = useState(() => loadStoredCustomRes()?.h ?? "1080");
  const [customResRows, setCustomResRows] = useState(() => loadStoredCustomRes()?.rows ?? "1");
  const [customResCols, setCustomResCols] = useState(() => loadStoredCustomRes()?.cols ?? "1");
  const [customResApplyGrid, setCustomResApplyGrid] = useState(() => loadStoredCustomRes()?.applyGrid ?? false);
  const [lastCustomRes, setLastCustomRes] = useState<StoredCustomRes | null>(() => loadStoredCustomRes());
  const [myPresets, setMyPresets] = useState<MyResPreset[]>(() => loadMyResPresets());
  const [presetSaveName, setPresetSaveName] = useState("");
  const [scenesVersion, setScenesVersion] = useState(0);
  const [saveToSceneDialogOpen, setSaveToSceneDialogOpen] = useState(false);
  const [saveToSceneDialogName, setSaveToSceneDialogName] = useState("");
  const [saveToSceneFlashKey, setSaveToSceneFlashKey] = useState(0);
  const [saveToScenePendingPage, setSaveToScenePendingPage] = useState<{ name: string; zones: Zone[]; aspect?: string } | null>(null);
  const studioSources = useMemo(() => {
    invalidateStudioSourceCache();
    return { layouts: buildLayoutPresets(), templates: buildTemplatePresets(), cache: getStudioSourceCacheStatus() };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [STUDIO_DATA_VERSION, scenesVersion]);
  const studioCacheLoadedAt = useMemo(
    () => new Intl.DateTimeFormat(language, { hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(new Date(studioSources.cache.loadedAt)),
    [language, studioSources.cache.loadedAt],
  );
  const [zones, setZones] = useState<Zone[]>([]);
  const [overlays, setOverlays] = useState<OverlayBlock[]>([]);
  // ── Multi-page (carousel) support ──────────────────────────────
  // Each "page" is a layout snapshot (zones + overlays). The active page is
  // mirrored into the live `zones` / `overlays` state so the existing editor
  // logic continues to work unchanged.
  type PageTransition = {
    mode: "auto" | "fixed" | "trigger";
    seconds: number;
    triggers: { gpio: boolean; remote: boolean; api: boolean };
  };
  const DEFAULT_PAGE_TRANSITION: PageTransition = {
    mode: "auto",
    seconds: 300,
    triggers: { gpio: false, remote: true, api: false },
  };
  const normalizePageTransition = (raw?: unknown): PageTransition => {
    if (!raw || typeof raw !== "object") return { ...DEFAULT_PAGE_TRANSITION, triggers: { ...DEFAULT_PAGE_TRANSITION.triggers } };
    const rec = raw as Record<string, unknown>;
    const mode = rec.mode === "fixed" || rec.mode === "trigger" ? rec.mode : "auto";
    const seconds = typeof rec.seconds === "number" && rec.seconds > 0 ? Math.min(3600, rec.seconds) : 300;
    const tr = (rec.triggers && typeof rec.triggers === "object") ? rec.triggers as Record<string, unknown> : {};
    return {
      mode,
      seconds,
      triggers: {
        gpio: !!tr.gpio,
        remote: tr.remote === undefined ? true : !!tr.remote,
        api: !!tr.api,
      },
    };
  };
  type StudioPage = { id: string; name: string; zones: Zone[]; overlays: OverlayBlock[]; transition?: PageTransition };
  const makePageId = () => `pg-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

  // ── Per-output pages ──────────────────────────────────────────────────────
  // Each output has its own independent carousel of layout pages.
  // outputPages:         { [outputIndex]: StudioPage[] }
  // outputActivePageId:  { [outputIndex]: string }
  const _initPageId = makePageId();
  const [outputPages, setOutputPages] = useState<Record<number, StudioPage[]>>(() => ({
    1: [{
      id: _initPageId,
      name: "版型 1",
      zones: [],
      overlays: [],
    }],
  }));
  const [outputActivePageId, setOutputActivePageId] = useState<Record<number, string>>(() => ({
    1: _initPageId,
  }));

  // Stable refs so callbacks can read latest values without stale closures
  const outputPagesRef = useRef(outputPages);
  outputPagesRef.current = outputPages;
  const outputActivePageIdRef = useRef(outputActivePageId);
  outputActivePageIdRef.current = outputActivePageId;

  // Derived: current output's pages and active page ID
  const pages = outputPages[activeOutput] ?? [];
  const activePageId = outputActivePageId[activeOutput] ?? (pages[0]?.id ?? "");

  // Stable setters — always operate on the currently-active output (via ref)
  const setPages = useCallback((updater: StudioPage[] | ((prev: StudioPage[]) => StudioPage[])) => {
    setOutputPages((prev) => {
      const ao = activeOutputRef.current;
      const cur = prev[ao] ?? [];
      const next = typeof updater === "function" ? updater(cur) : updater;
      if (next === cur) return prev;
      return { ...prev, [ao]: next };
    });
  }, []);
  const setActivePageId = useCallback((id: string) => {
    setOutputActivePageId((prev) => {
      const ao = activeOutputRef.current;
      if (prev[ao] === id) return prev;
      return { ...prev, [ao]: id };
    });
  }, []);

  // Safety: initialise activePageId if missing for current output
  useEffect(() => {
    if (!activePageId && pages.length > 0) setActivePageId(pages[0].id);
  }, [activePageId, pages, setActivePageId]);

  // Mirror live zones/overlays into the active page on every change
  useEffect(() => {
    if (!activePageId) return;
    setPages((prev) => {
      const idx = prev.findIndex((p) => p.id === activePageId);
      if (idx === -1) return prev;
      const cur = prev[idx];
      // Avoid pointless re-renders if reference is identical
      if (cur.zones === zones && cur.overlays === overlays) return prev;
      const next = prev.slice();
      next[idx] = { ...cur, zones, overlays };
      return next;
    });
  }, [zones, overlays, activePageId, setPages]);
  // BGM track: an always-present audio playlist for the project.
  // audioSource: "bgm" = play this BGM track; "mute" = silence; otherwise zoneId/overlayId whose video provides sound.
  const [bgmItems, setBgmItems] = useState<MediaItem[]>([]);
  const [bgmVolume, setBgmVolume] = useState<number>(30);
  const [bgmAudioSource, setBgmAudioSource] = useState<string>("bgm");
  const persistedSessionRef = useRef<Partial<StudioSession> | null>(loadStudioSession());
  const [selectedZone, setSelectedZone] = useState<string | null>(null);
  const [selectedOverlay, setSelectedOverlay] = useState<string | null>(null);
  const [pinnedPreview, setPinnedPreview] = useState<{ trackId: string; itemIdx: number } | null>(null);
  const pinnedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Ref updated on every render so toggleLayoutPanelManualCollapse can read
  // the current derived `layoutPanelCollapsed` without a stale closure.
  const layoutPanelCollapsedRef = useRef<boolean>(false);
  const [dropTargetId, setDropTargetId] = useState<string | null>(null);
  // Always start on "我的專案" regardless of persisted session — rule 1 of the panel UX
  const [sidebarTab, setSidebarTab] = useState<string>("my");
  const [innerSidebarTab, setInnerSidebarTab] = useState<string>("layouts");
  const isMobile = useIsMobile();
  const [mobileEditMode, setMobileEditMode] = useState(false);
  const [mobilePanelOpen, setMobilePanelOpen] = useState(false);
  const [mobileToolsOpen, setMobileToolsOpen] = useState(false);
  const [mobileEditorOpen, setMobileEditorOpen] = useState(false);
  const [mobileMediaOpen, setMobileMediaOpen] = useState(false);
  const [mobileTimelineOpen, setMobileTimelineOpen] = useState(false);
  // Always start with layout panel open (true) so the left sidebar is visible on entry
  const [layoutPanelOpen, setLayoutPanelOpen] = useState<boolean>(true);
  // Always start with media panel closed regardless of persisted session — rule 1 of the panel UX
  const [mediaLibraryOpen, setMediaLibraryOpen] = useState<boolean>(false);
  const enforceInitialPanelState = useCallback(() => {
    setSidebarTab("my");
    setInnerSidebarTab("layouts");
    setLayoutPanelOpen(true);
    setMediaLibraryOpen(false);
  }, []);
  const DOCK_H_LS_KEY = "studio-timeline-dock-height";
  const [dockHeight, setDockHeight] = useState<number>(() => {
    try {
      const raw = localStorage.getItem(DOCK_H_LS_KEY);
      const n = raw ? Number(raw) : NaN;
      return Number.isFinite(n) && n >= 180 && n <= 600 ? n : 540;
    } catch {
      return 540;
    }
  });
  useEffect(() => {
    try { localStorage.setItem(DOCK_H_LS_KEY, String(dockHeight)); } catch { /* ignore */ }
  }, [dockHeight]);
  useEffect(() => {
    // If there is no persisted session, fall back to the default initial layout.
    if (!persistedSessionRef.current) {
      setSelectedZone(null);
      setSelectedOverlay(null);
      enforceInitialPanelState();
    }
    // Otherwise: panels/tab were already hydrated from the session in their
    // initial state. selectedZone/Overlay are restored after the project loads.
  }, [enforceInitialPanelState]);
  const MEDIA_W_LS_KEY = "studio-media-lib-width";
  const MEDIA_W_MIN = 240;
  const MEDIA_W_MAX = 640;
  const [mediaLibWidth, setMediaLibWidth] = useState<number>(() => {
    try {
      const raw = localStorage.getItem(MEDIA_W_LS_KEY);
      const n = raw ? Number(raw) : NaN;
      return Number.isFinite(n) && n >= MEDIA_W_MIN && n <= MEDIA_W_MAX ? n : 340;
    } catch {
      return 340;
    }
  });
  useEffect(() => {
    try { localStorage.setItem(MEDIA_W_LS_KEY, String(mediaLibWidth)); } catch { /* ignore */ }
  }, [mediaLibWidth]);
  const mediaResizingRef = useRef(false);
  const startMediaResize = (e: React.MouseEvent) => {
    e.preventDefault();
    mediaResizingRef.current = true;
    const startX = e.clientX;
    const startW = mediaLibWidth;
    const onMove = (ev: MouseEvent) => {
      if (!mediaResizingRef.current) return;
      // Handle is on the LEFT edge of the right panel — dragging left grows the panel
      const delta = startX - ev.clientX;
      const next = Math.min(MEDIA_W_MAX, Math.max(MEDIA_W_MIN, startW + delta));
      setMediaLibWidth(next);
    };
    const onUp = () => {
      mediaResizingRef.current = false;
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
    };
    document.body.style.userSelect = "none";
    document.body.style.cursor = "col-resize";
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };
  // Auto-open editor sheet when a zone/overlay is picked on mobile in edit mode
  useEffect(() => {
    if (isMobile && mobileEditMode && (selectedZone || selectedOverlay)) setMobileEditorOpen(true);
    if (!selectedZone && !selectedOverlay) setMobileEditorOpen(false);
  }, [isMobile, mobileEditMode, selectedZone, selectedOverlay]);
  // Reset edit mode when leaving mobile
  useEffect(() => { if (!isMobile) setMobileEditMode(false); }, [isMobile]);
  // Project state
  const [currentProject, setCurrentProject] = useState<DesignProject | null>(null);
  const [projects, setProjects] = useState<DesignProject[]>([]);
  const [pendingDeleteIds, setPendingDeleteIds] = useState<Set<string>>(new Set());
  const sourceStatRows = useMemo(() => getStudioSourceStatRows(projects.length, language), [projects.length, language]);
  const [deleteConfirm, setDeleteConfirm] = useState<{
    id: string;
    name: string;
    channels: ReferenceItem[];
    media: ReferenceItem[];
    schedules: ReferenceItem[];
    queued: boolean;
    busyKey: string | null;
  } | null>(null);
  const [showSaveDialog, setShowSaveDialog] = useState(false);
  const [showLoadDialog, setShowLoadDialog] = useState(false);
  const [showPreviewDialog, setShowPreviewDialog] = useState(false);
  const [quickPublishOpen, setQuickPublishOpen] = useState(false);
  // "qp" = quick-publish validation block reason shown in AlertDialog
  const [qpBlockReason, setQpBlockReason] = useState<"unsaved" | "no_zones" | "empty_zones" | null>(null);
  // "save" = save validation block reason (incomplete design)
  const [saveBlockReason, setSaveBlockReason] = useState<"no_zones" | "empty_zones" | null>(null);
  const [projectName, setProjectName] = useState("");
  // Inline project-name editing (badge in canvas header)
  const [projectNameEditing, setProjectNameEditing] = useState(false);
  const [projectNameInput, setProjectNameInput] = useState("");
  const [saving, setSaving] = useState(false);
  const [projectTeamId, setProjectTeamId] = useState<string>("none");
  const [teams, setTeams] = useState<Array<{ id: string; name: string; org_id: string }>>([]);
  const [projectCollab, setProjectCollab] = useState<"creator" | "team" | "org">("org");
  const { ensureProfiles, getDisplayName, profilesVersion } = useProfiles();
  // Unsaved-changes tracking
  const [isDirty, setIsDirty] = useState(false);
  const cleanSnapshotRef = useRef<string>("");
  // Auto-draft recovery
  const [draftRecoveryOpen, setDraftRecoveryOpen] = useState(false);
  const draftToRestoreRef = useRef<StudioDraft | null>(null);
  // Always-current payload ref — synchronously readable by emergency-save event handler
  const draftPayloadRef = useRef<StudioDraft | null>(null);
  const [pendingDestructiveAction, setPendingDestructiveAction] = useState<null | "new" | "load">(null);
  const [showPreviewSavePrompt, setShowPreviewSavePrompt] = useState(false);

  // Scene delete confirmation state
  const [sceneDeleteConfirm, setSceneDeleteConfirm] = useState<{ id: string; name: string } | null>(null);

  // Export download dialog (manual click fallback, avoids iframe download blocking)
  const [exportDownload, setExportDownload] = useState<{ url: string; filename: string; sizeBytes: number } | null>(null);
  // Page-switch confirmation: when non-null, holds the target pageId awaiting user OK
  const [pendingPageSwitch, setPendingPageSwitch] = useState<string | null>(null);
  // Library-apply confirmation: layout preset or scene template pending user OK
  const [pendingApply, setPendingApply] = useState<
    | { kind: "layout"; preset: LayoutPreset; mobileClose?: boolean }
    | { kind: "template"; tpl: TemplateItem; mobileClose?: boolean }
    | null
  >(null);

  // Build a stable signature of the editable project state for dirty detection.
  const computeSnapshot = useCallback(() => {
    try {
      return JSON.stringify({
        a: aspect,
        r: { w: resolution.width, h: resolution.height, id: resolution.id },
        z: zones,
        o: overlays,
        b: { items: bgmItems, vol: bgmVolume, src: bgmAudioSource },
      });
    } catch { return ""; }
  }, [aspect, resolution, zones, overlays, bgmItems, bgmVolume, bgmAudioSource]);

  // Mark a clean baseline (called after load/save/new).
  const markClean = useCallback(() => {
    cleanSnapshotRef.current = computeSnapshot();
    setIsDirty(false);
    clearStudioDraft();
    draftPayloadRef.current = null;
  }, [computeSnapshot]);

  // Recompute dirty whenever tracked state changes.
  useEffect(() => {
    const snap = computeSnapshot();
    setIsDirty(snap !== cleanSnapshotRef.current);
  }, [computeSnapshot]);

  // Initial baseline on mount.
  useEffect(() => { cleanSnapshotRef.current = computeSnapshot(); setIsDirty(false);   }, []);

  // ── Auto-draft: keep draftPayloadRef always current ───────────────────────
  // This ref is read synchronously by the emergency-save handler (and by the
  // debounced timer) so that we never capture stale state.
  useEffect(() => {
    if (!isDirty) { draftPayloadRef.current = null; return; }
    draftPayloadRef.current = {
      v: 1,
      orgId: activeOrgId ?? null,
      projectId: currentProject?.id ?? null,
      projectName: currentProject?.name ?? projectName,
      savedAt: new Date().toISOString(),
      aspect,
      resolution: { id: resolution.id, width: resolution.width, height: resolution.height },
      outputPages: Object.fromEntries(
        Object.entries(outputPages).map(([k, pgList]) => [
          k,
          pgList.map((p) => ({ id: p.id, name: p.name, zones: p.zones, overlays: p.overlays })),
        ])
      ),
      outputActivePageId: Object.fromEntries(Object.entries(outputActivePageId).map(([k, v]) => [k, v])),
      outputMode,
      outputCount,
      activeOutput,
      bgmItems,
      bgmVolume,
      bgmAudioSource,
    };
  }, [isDirty, activeOrgId, currentProject?.id, currentProject?.name, projectName, aspect, resolution, outputPages, outputActivePageId, outputMode, outputCount, activeOutput, bgmItems, bgmVolume, bgmAudioSource]);

  // ── Auto-draft: debounced save to localStorage (3 s after last change) ────
  const draftSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!isDirty) return;
    if (draftSaveTimerRef.current) clearTimeout(draftSaveTimerRef.current);
    draftSaveTimerRef.current = setTimeout(() => {
      const payload = draftPayloadRef.current;
      if (payload) saveStudioDraft(payload);
    }, 3000);
    return () => {
      if (draftSaveTimerRef.current) clearTimeout(draftSaveTimerRef.current);
    };
  }, [isDirty, aspect, resolution.width, resolution.height, zones, overlays, bgmItems, bgmVolume, bgmAudioSource, outputPages]);

  // ── Auto-draft: emergency sync-save before ErrorBoundary-triggered reload ─
  // ErrorBoundary dispatches "studio:emergency-draft-save" before calling
  // window.location.reload() on a ChunkLoadError. We write the current draft
  // synchronously so it survives the reload.
  useEffect(() => {
    const onEmergencySave = () => {
      const payload = draftPayloadRef.current;
      if (payload) saveStudioDraft(payload);
    };
    window.addEventListener("studio:emergency-draft-save", onEmergencySave);
    return () => window.removeEventListener("studio:emergency-draft-save", onEmergencySave);
  }, []);

  // ── Unsaved-changes navigation guard ────────────────────────────
  // 1) Browser-level: refresh / close tab → native "unsaved changes" prompt.
  // 2) In-app SPA navigation → click-intercept on document (capture phase).
  //    Note: useBlocker from react-router-dom requires a *Data Router*
  //    (createHashRouter / createBrowserRouter). This app uses the legacy
  //    <HashRouter> component, so useBlocker throws at runtime. Instead we
  //    intercept anchor clicks in the capture phase — all HashRouter NavLinks
  //    render as <a href="#/route"> so we can detect route changes before
  //    navigation commits.
  const navigate = useNavigate();
  const isDirtyRef = useRef(isDirty);
  useEffect(() => { isDirtyRef.current = isDirty; }, [isDirty]);

  // pendingNavHref: the href the user clicked while dirty; non-null = dialog open.
  const [pendingNavHref, setPendingNavHref] = useState<string | null>(null);
  const pendingNavHrefRef = useRef<string | null>(null);
  useEffect(() => { pendingNavHrefRef.current = pendingNavHref; }, [pendingNavHref]);

  // beforeunload — covers tab close / page refresh.
  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (!isDirtyRef.current) return;
      e.preventDefault();
      e.returnValue = ""; // required for Chrome
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, []);

  // Click-intercept — captures sidebar / NavLink clicks before HashRouter handles them.
  // All in-app links look like href="#/schedules". We extract the path portion and
  // compare it to the current hash route to decide if this is a real navigation away.
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (!isDirtyRef.current) return;
      const anchor = (e.target as Element).closest("a[href]");
      if (!anchor) return;
      const href = anchor.getAttribute("href") ?? "";
      // Hash-router links: "#/schedules", "#/media", etc.
      const nextPath = href.startsWith("#") ? href.slice(1) : href;
      if (!nextPath.startsWith("/")) return; // external or bare anchor — ignore
      const currentPath = window.location.hash.slice(1) || "/";
      if (nextPath === currentPath || nextPath.startsWith(currentPath + "/")) return;
      e.preventDefault();
      e.stopPropagation();
      setPendingNavHref(href);
    };
    document.addEventListener("click", handleClick, { capture: true });
    return () => document.removeEventListener("click", handleClick, { capture: true });
  }, []);

  const confirmLeave = useCallback(() => {
    const href = pendingNavHrefRef.current;
    setPendingNavHref(null);
    if (href) window.location.href = href;
  }, []);


  // DB media for picker
  const [dbMedia, setDbMedia] = useState<{ id: string; name: string; original_name?: string | null; type: string; url: string; thumbnail: string; size_bytes?: number | null; width?: number | null; height?: number | null; duration_seconds?: number | null; mime_type?: string | null; created_at?: string }[]>([]);
  const [dbWidgets, setDbWidgets] = useState<{ id: string; name: string; url: string; created_at?: string }[]>([]);

  const loadMedia = useCallback(async () => {
    let mediaQ = supabase
      .from("media_items")
      .select("id, name, original_name, type, url, thumbnail, size_bytes, width, height, duration_seconds, mime_type, transcode_status, created_at")
      .neq("type", "widget")
      .is("deleted_at", null)
      .order("created_at", { ascending: false });

    let widgetQ = supabase
      .from("media_items")
      .select("id, name, url, created_at")
      .eq("type", "widget")
      .is("deleted_at", null)
      .order("created_at", { ascending: false });

    if (activeOrgId) {
      mediaQ = mediaQ.eq("org_id", activeOrgId);
      widgetQ = widgetQ.eq("org_id", activeOrgId);
    }

    const [mediaRes, widgetRes] = await Promise.all([mediaQ, widgetQ]);
    if (mediaRes.error) toast.error(mediaRes.error.message);
    else setDbMedia(mediaRes.data || []);
    if (widgetRes.error) toast.error(widgetRes.error.message);
    else {
      // Prepend catalog widgets (system + app + user-of-org) — read-only catalog
      setDbWidgets([...widgetsToStudioRows(catalogWidgets), ...(widgetRes.data || [])]);
    }
  }, [activeOrgId, t, catalogWidgets]);

  useEffect(() => { loadMedia(); }, [loadMedia]);

  // Real-time: reload media list when any media_item changes (soft-delete, upload, rename)
  useEffect(() => {
    const channel = supabase
      .channel("studio-media-realtime")
      .on("postgres_changes", { event: "*", schema: "public", table: "media_items" }, () => { void loadMedia(); })
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [loadMedia]);

  // Load projects list
  const loadProjects = useCallback(async () => {
    setProjects([]);
    let q = supabase.from("design_projects").select("*").order("updated_at", { ascending: false });
    if (activeOrgId) q = q.eq("org_id", activeOrgId);
    const { data } = await q;
    const list = (data || []).map((d) => ({ ...d, zones: d.zones || [] }));
    setProjects(list as DesignProject[]);
    // Preload creator names for project cards
    ensureProfiles(list.map((p) => p.created_by).filter(Boolean) as string[]);
    // Mark which projects have a pending delete request queued
    const ids = list.map((p) => p.id).filter(Boolean) as string[];
    fetchPendingDeleteRequests(ids).then(setPendingDeleteIds).catch(() => undefined);
  }, [activeOrgId, ensureProfiles, STUDIO_DATA_VERSION]);

  useEffect(() => { loadProjects(); }, [loadProjects]);

  // Load teams for save dialog
  useEffect(() => {
    (async () => {
      let q = supabase.from("teams").select("id, name, org_id").order("name");
      if (activeOrgId) q = q.eq("org_id", activeOrgId);
      const { data } = await q;
      setTeams(data || []);
    })();
  }, [activeOrgId]);

  const importInputRef = useRef<HTMLInputElement>(null);

  // Canvas: prefer fixed display height (540), but shrink height proportionally
  // when computed width would overflow the available container width.
  const canvasContainerRef = useRef<HTMLDivElement>(null);
  const [containerSize, setContainerSize] = useState<{ w: number; h: number }>({ w: 0, h: 0 });
  useEffect(() => {
    const el = canvasContainerRef.current;
    if (!el) return;
    const update = () => {
      const r = el.getBoundingClientRect();
      setContainerSize({ w: r.width, h: r.height });
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const ratio = resolution.width / resolution.height;
  // Linear extend modes
  const extendCount = (outputMode === "extend-h" || outputMode === "extend-v") ? outputCount : 1;
  // 2×2 grid modes (always 4 panels, 2 cols × 2 rows)
  const isGrid2x2 = outputMode === "grid-2x2-h";
  // Effective aspect ratio for the whole canvas display
  const displayRatio = outputMode === "extend-h" ? ratio * extendCount
    : outputMode === "extend-v"   ? ratio / extendCount
    : outputMode === "grid-2x2-h" ? ratio   // 2W × 2H → same ratio; canvas shows 2×2 panels
    : ratio;
  const { W, H } = (() => {
    const maxH = outputMode === "extend-v" ? 540 * extendCount : isGrid2x2 ? 620 : 540;
    const availW = containerSize.w > 0 ? containerSize.w - 8 : Infinity;
    const availH = containerSize.h > 0 ? Math.min(containerSize.h - 8, maxH) : maxH;
    let h = availH;
    let w = h * displayRatio;
    if (w > availW) {
      w = availW;
      h = w / displayRatio;
    }
    return { W: Math.round(w), H: Math.round(h) };
  })();
  // Single-panel pixel dimensions within the canvas
  const singleW = isGrid2x2 ? Math.round(W / 2)
    : outputMode === "extend-h" ? Math.round(W / extendCount)
    : W;
  const singleH = isGrid2x2 ? Math.round(H / 2)
    : outputMode === "extend-v" ? Math.round(H / extendCount)
    : H;
  // Panel bounding box helper (1-indexed n → {x,y,w,h} in canvas px)
  const getPanelRect = (n: number) => {
    if (isGrid2x2) {
      const col = (n - 1) % 2;
      const row = Math.floor((n - 1) / 2);
      return { x: col * singleW, y: row * singleH, w: singleW, h: singleH };
    }
    if (outputMode === "extend-h") return { x: (n - 1) * singleW, y: 0, w: singleW, h: H };
    if (outputMode === "extend-v") return { x: 0, y: (n - 1) * singleH, w: W, h: singleH };
    return { x: 0, y: 0, w: W, h: H };
  };
  const totalPanels = isGrid2x2 ? 4 : extendCount;

  // Auto-clamp overlays when canvas size shrinks so they remain visible/operable
  useEffect(() => {
    if (!W || !H) return;
    setOverlays((prev) => {
      let changed = false;
      const next = prev.map((o) => {
        const minW = 60, minH = 40;
        const w = Math.max(minW, Math.min(o.w, W));
        const h = Math.max(minH, Math.min(o.h, H));
        const x = Math.max(0, Math.min(o.x, W - w));
        const y = Math.max(0, Math.min(o.y, H - h));
        if (x !== o.x || y !== o.y || w !== o.w || h !== o.h) {
          changed = true;
          return { ...o, x, y, w, h };
        }
        return o;
      });
      return changed ? next : prev;
    });
  }, [W, H]);

  // Apply layout / template by APPENDING a new page (carousel slide).
  // First-ever click on a brand-new project replaces the empty default page in place.
  const appendPage = useCallback((newZones: Zone[], newOverlays: OverlayBlock[] = []) => {
    const id = makePageId();
    setPages((prev) => {
      const next = [...prev, { id, name: `版型 ${prev.length + 1}`, zones: newZones, overlays: newOverlays }];
      return next;
    });
    setActivePageId(id);
    setZones(newZones);
    setOverlays(newOverlays);
    setSelectedZone(null);
    setSelectedOverlay(null);
    setExtraSelectedZoneIds(new Set());
    toast.success(t("studioPageAdded"));
  }, [t]);
  // Actual apply logic (called after user confirms)
  const doApplyLayout = useCallback((preset: LayoutPreset) => {
    const newZones = preset.zones.map((z) => ({ ...z }));
    setZones(newZones);
    setOverlays([]);
    setSelectedZone(null);
    setSelectedOverlay(null);
    setExtraSelectedZoneIds(new Set());
  }, []);
  const doApplyTemplate = useCallback((tpl: TemplateItem) => {
    setAspect(tpl.aspect);
    const newZones = tpl.zones.map((z) => ({ ...z }));
    setZones(newZones);
    setOverlays([]);
    setSelectedZone(null);
    setSelectedOverlay(null);
    setExtraSelectedZoneIds(new Set());
    if (tpl.bgm) {
      setBgmItems((tpl.bgm.items as MediaItem[]) ?? []);
      setBgmVolume(tpl.bgm.volume ?? 30);
      setBgmAudioSource(tpl.bgm.audioSource ?? "bgm");
    }
  }, []);

  // Guard wrappers — show confirmation before applying.
  // If the canvas is blank (no zones), apply directly and auto-name the project.
  const applyLayout = useCallback((preset: LayoutPreset, mobileClose?: boolean) => {
    if (zones.length === 0) {
      if (!currentProject && !projectName) {
        setProjectName(generateProjectName(projects.map((p) => p.name || "")));
      }
      doApplyLayout(preset);
      if (mobileClose) setMobilePanelOpen(false);
      return;
    }
    setPendingApply({ kind: "layout", preset, mobileClose });
  }, [zones.length, currentProject, projectName, projects, doApplyLayout]);
  const applyTemplate = useCallback((tpl: TemplateItem, mobileClose?: boolean) => {
    if (zones.length === 0) {
      if (!currentProject && !projectName) {
        setProjectName(generateProjectName(projects.map((p) => p.name || "")));
      }
      doApplyTemplate(tpl);
      if (mobileClose) setMobilePanelOpen(false);
      return;
    }
    setPendingApply({ kind: "template", tpl, mobileClose });
  }, [zones.length, currentProject, projectName, projects, doApplyTemplate]);

  // Add a blank page using the simplest (single full-canvas) layout.
  const addBlankPage = useCallback(() => {
    appendPage(studioSources.layouts[0].zones.map((z) => ({ ...z })), []);
  }, [appendPage, studioSources.layouts]);

  // Drag-to-reorder page tabs
  const [dragPageId, setDragPageId] = useState<string | null>(null);
  const [dragOverPageId, setDragOverPageId] = useState<string | null>(null);
  // Project-level transition (switching condition) — applies to all pages
  const [transitionDialogOpen, setTransitionDialogOpen] = useState(false);
  const [projectTransition, setProjectTransition] = useState<PageTransition>(() => ({ ...DEFAULT_PAGE_TRANSITION, triggers: { ...DEFAULT_PAGE_TRANSITION.triggers } }));
  const updateProjectTransition = useCallback((patch: Partial<PageTransition>) => {
    setProjectTransition((cur) => ({
      ...cur,
      ...patch,
      triggers: { ...cur.triggers, ...(patch.triggers || {}) },
    }));
  }, []);
  const reorderPages = useCallback((fromId: string, toId: string) => {
    if (fromId === toId) return;
    setPages((prev) => {
      const fromIdx = prev.findIndex((p) => p.id === fromId);
      const toIdx = prev.findIndex((p) => p.id === toId);
      if (fromIdx === -1 || toIdx === -1) return prev;
      const next = [...prev];
      const [moved] = next.splice(fromIdx, 1);
      next.splice(toIdx, 0, moved);
      return next;
    });
  }, []);

  // Switch to another page: load its zones/overlays into the live editor state.
  // doSwitchPage performs the actual switch; switchToPage adds a confirmation guard.
  const doSwitchPage = useCallback((pageId: string) => {
    // 點擊版型編號頁籤：三個區域全部展開
    setLayoutPanelOpen(true);
    setMediaLibraryOpen(true);
    if (pageId === activePageId) return;
    const target = pages.find((p) => p.id === pageId);
    if (!target) return;
    setActivePageId(pageId);
    setZones(target.zones);
    setOverlays(target.overlays);
    setSelectedZone(null);
    setSelectedOverlay(null);
    setExtraSelectedZoneIds(new Set());
  }, [activePageId, pages, setActivePageId]);

  const switchToPage = useCallback((pageId: string) => {
    if (pageId === activePageId) return;
    // Show confirmation before switching (prevents accidental tab clicks)
    setPendingPageSwitch(pageId);
  }, [activePageId]);

  const renamePage = useCallback((pageId: string, newName: string) => {
    const trimmed = newName.trim();
    if (!trimmed) return;
    setPages((prev) => prev.map((p) => p.id === pageId ? { ...p, name: trimmed } : p));
  }, []);

  const deletePage = useCallback((pageId: string) => {
    setPages((prev) => {
      if (prev.length <= 1) {
        toast.error(t("studioCannotDeleteLastPage"));
        return prev;
      }
      const idx = prev.findIndex((p) => p.id === pageId);
      if (idx === -1) return prev;
      const filtered = prev.filter((p) => p.id !== pageId);
      // 自動重新編號：僅針對名稱仍為預設「版型 N」格式的頁籤
      // 邊界情況：若使用者已將某頁手動命名為「版型 X」，重新編號時必須跳過該編號避免重複
      const customNames = new Set(
        filtered
          .filter((p) => typeof p.name === "string" && !/^版型\s*\d+$/.test(p.name))
          .map((p) => p.name as string)
      );
      let counter = 1;
      const next = filtered.map((p) => {
        if (typeof p.name === "string" && /^版型\s*\d+$/.test(p.name)) {
          // 找出下一個不會與自訂名稱衝突的編號
          while (customNames.has(`版型 ${counter}`)) counter += 1;
          const renamed = { ...p, name: `版型 ${counter}` };
          counter += 1;
          return renamed;
        }
        return p;
      });
      // If we deleted the active page, switch to a neighbour
      if (pageId === activePageId) {
        const fallback = next[Math.max(0, idx - 1)];
        setActivePageId(fallback.id);
        setZones(fallback.zones);
        setOverlays(fallback.overlays);
        setSelectedZone(null);
        setSelectedOverlay(null);
        setExtraSelectedZoneIds(new Set());
      }
      return next;
    });
  }, [activePageId, t]);

  const handleSaveToScene = useCallback((page: { name: string; zones: Zone[]; aspect?: string }) => {
    const displayName = (() => {
      const m = typeof page.name === "string" ? page.name.match(/^版型\s*(\d+)$/) : null;
      return m ? `${t("studioPageTabPrefix")} ${m[1]}` : (page.name || t("studioPageTabPrefix"));
    })();
    setSaveToScenePendingPage(page);
    setSaveToSceneDialogName(displayName);
    setSaveToSceneFlashKey(0);
    setSaveToSceneDialogOpen(true);
  }, [t]);

  const commitSaveToScene = useCallback(() => {
    if (!saveToScenePendingPage) return;
    const name = saveToSceneDialogName.trim();
    if (!name) return;
    const nameLower = name.toLowerCase();
    const duplicate = studioSources.templates.some((tpl) => tpl.nameKey.toLowerCase() === nameLower);
    if (duplicate) {
      setSaveToSceneFlashKey((k) => k + 1);
      return;
    }
    const page = saveToScenePendingPage;
    const scene = {
      id: `user-scene-${Date.now()}`,
      nameKey: name,
      iconKey: "layoutGrid" as const,
      color: "hsl(220 60% 50%)",
      aspect: (aspect as "16:9" | "9:16"),
      zones: page.zones.map((z) => ({
        id: z.id,
        x: z.x, y: z.y, w: z.w, h: z.h,
        label: z.label,
        content: z.content as import("@/lib/studioPresets").StudioZoneContent | undefined,
      })),
      bgm: bgmItems.length > 0
        ? { items: bgmItems as unknown[], volume: bgmVolume, audioSource: bgmAudioSource }
        : undefined,
    };
    saveUserScene(scene);
    setScenesVersion((v) => v + 1);
    setSaveToSceneDialogOpen(false);
    toast.success(t("studioSaveToSceneSuccess"));
  }, [saveToScenePendingPage, saveToSceneDialogName, studioSources.templates, t, aspect, bgmItems, bgmVolume, bgmAudioSource]);

  // 切換 aspect：若目前版型不適用新比例，自動轉換為對應比例下最相近的版型，並盡量保留每個 zone 已編輯的內容
  const changeAspect = useCallback((next: AspectRatio) => {
    setAspect((prev) => {
      if (prev === next) return prev;

      // 同步切換解析度為新 aspect 的同 id（如 fhd→fhd），找不到則用該 aspect 預設
      setResolution((prevRes) => {
        const list = RESOLUTION_PRESETS[next];
        const sameId = list.find((r) => r.id === prevRes.id);
        return sameId || getDefaultResolution(next);
      });

      const candidates = studioSources.layouts.filter((lp) => lp.aspect === next);
      if (candidates.length === 0) return next;

      const sig = (zs: Pick<Zone, "x" | "y" | "w" | "h">[]) =>
        [...zs].map((z) => `${Math.round(z.x)},${Math.round(z.y)},${Math.round(z.w)},${Math.round(z.h)}`).sort().join("|");
      const currentSig = sig(zones);
      const exact = candidates.find((lp) => sig(lp.zones) === currentSig);
      if (exact) {
        return next;
      }

      const sameCount = candidates.filter((lp) => lp.zones.length === zones.length);
      const pick =
        sameCount[0] ||
        [...candidates].sort(
          (a, b) => Math.abs(a.zones.length - zones.length) - Math.abs(b.zones.length - zones.length),
        )[0];

      const orderByArea = <T extends Pick<Zone, "w" | "h">>(arr: T[]) =>
        arr.map((z, idx) => ({ z, idx, area: z.w * z.h })).sort((a, b) => b.area - a.area);

      const oldOrder = orderByArea(zones);
      const newZonesBase = pick.zones.map((z) => ({ ...z }));
      const newOrder = orderByArea(newZonesBase);

      const merged = newZonesBase.map((nz) => ({ ...nz })) as Zone[];
      newOrder.forEach((entry, i) => {
        const src = oldOrder[i];
        if (src) {
          merged[entry.idx].content = zones[src.idx].content;
        }
      });

      setZones(merged);
      setSelectedZone(null);
      toast.success(t("studioAspectAutoConverted") + ` → ${t(pick.nameKey as TranslationKey)}`);
      return next;
    });
  }, [zones, t]);

  // 套用解析度（同 aspect 內切換或從自訂對話框寫入）
  const applyResolution = useCallback((res: Resolution) => {
    const inferred = inferAspect(res.width, res.height);
    if (inferred !== aspect) {
      // 自訂解析度若改變了 aspect，連動更新
      changeAspect(inferred);
    }
    setResolution(res);
  }, [aspect, changeAspect]);

  // Generate equal NxM grid zones for current canvas (returns zones array, does NOT setState)
  const buildGridZones = useCallback((rowsRaw: number, colsRaw: number): Zone[] => {
    const rows = Math.max(1, Math.min(10, rowsRaw || 1));
    const cols = Math.max(1, Math.min(10, colsRaw || 1));
    const cellW = 100 / cols;
    const cellH = 100 / rows;
    const out: Zone[] = [];
    let idx = 0;
    const stamp = Date.now().toString(36);
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        out.push({
          id: `z-grid-${r}-${c}-${stamp}`,
          x: c * cellW, y: r * cellH, w: cellW, h: cellH,
          label: String.fromCharCode(65 + idx),
        });
        idx++;
      }
    }
    return out;
  }, []);

  // Apply a custom resolution + optional grid in one shot (used by Last Custom / My Presets)
  const applyResPreset = useCallback((p: { w: number; h: number; rows: number; cols: number; applyGrid: boolean }) => {
    if (!Number.isFinite(p.w) || !Number.isFinite(p.h) || p.w < 16 || p.h < 16) {
      toast.error(t("studioCustomResInvalid"));
      return;
    }
    if (p.applyGrid) {
      const total = Math.max(1, p.rows) * Math.max(1, p.cols) + overlays.length;
      if (total > 8) {
        toast.error(`區塊總數不可超過 8 個（含重疊區塊 ${overlays.length} 個）`);
        return;
      }
    }
    applyResolution({ id: "custom", labelKey: "studioResCustom", width: p.w, height: p.h });
    if (p.applyGrid) {
      setZones(buildGridZones(p.rows, p.cols));
      setSelectedZone(null);
      setExtraSelectedZoneIds(new Set());
    }
    // sync dialog inputs + last-custom memory
    setCustomResW(String(p.w)); setCustomResH(String(p.h));
    setCustomResRows(String(p.rows)); setCustomResCols(String(p.cols));
    setCustomResApplyGrid(p.applyGrid);
    const stored: StoredCustomRes = { w: String(p.w), h: String(p.h), rows: String(p.rows), cols: String(p.cols), applyGrid: p.applyGrid };
    try { localStorage.setItem(CUSTOM_RES_STORAGE_KEY, JSON.stringify(stored)); } catch { /* ignore */ }
    setLastCustomRes(stored);
  }, [overlays.length, applyResolution, buildGridZones, t]);

  const handleSelectResolution = useCallback((id: string) => {
    if (id === "custom") {
      if (resolution.id === "custom") {
        setCustomResW(String(resolution.width));
        setCustomResH(String(resolution.height));
      } else {
        const stored = loadStoredCustomRes();
        if (stored) {
          setCustomResW(stored.w); setCustomResH(stored.h);
          setCustomResRows(stored.rows); setCustomResCols(stored.cols);
          setCustomResApplyGrid(stored.applyGrid);
        }
      }
      setShowCustomResDialog(true);
      return;
    }
    if (id === "__last_custom__" && lastCustomRes) {
      applyResPreset({
        w: parseInt(lastCustomRes.w, 10), h: parseInt(lastCustomRes.h, 10),
        rows: parseInt(lastCustomRes.rows, 10) || 1, cols: parseInt(lastCustomRes.cols, 10) || 1,
        applyGrid: lastCustomRes.applyGrid,
      });
      return;
    }
    if (id.startsWith("__preset__:")) {
      const presetId = id.slice("__preset__:".length);
      const p = myPresets.find((mp) => mp.id === presetId);
      if (p) applyResPreset({ w: p.w, h: p.h, rows: p.rows, cols: p.cols, applyGrid: p.applyGrid });
      return;
    }
    const found = RESOLUTION_PRESETS[aspect].find((r) => r.id === id);
    if (found) applyResolution(found);
  }, [aspect, resolution, applyResolution, lastCustomRes, myPresets, applyResPreset]);

  const submitCustomResolution = useCallback(() => {
    const w = parseInt(customResW, 10);
    const h = parseInt(customResH, 10);
    if (!Number.isFinite(w) || !Number.isFinite(h) || w < 16 || h < 16 || w > 16384 || h > 16384) {
      toast.error(t("studioCustomResInvalid"));
      return;
    }
    if (customResApplyGrid) {
      const rows = Math.max(1, Math.min(10, parseInt(customResRows, 10) || 1));
      const cols = Math.max(1, Math.min(10, parseInt(customResCols, 10) || 1));
      if (rows * cols + overlays.length > 8) {
        toast.error(`區塊總數不可超過 8 個（含重疊區塊 ${overlays.length} 個）`);
        return;
      }
    }
    applyResolution({ id: "custom", labelKey: "studioResCustom", width: w, height: h });
    if (customResApplyGrid) {
      const rows = Math.max(1, Math.min(10, parseInt(customResRows, 10) || 1));
      const cols = Math.max(1, Math.min(10, parseInt(customResCols, 10) || 1));
      setZones(buildGridZones(rows, cols));
      setSelectedZone(null);
      setExtraSelectedZoneIds(new Set());
    }
    const stored: StoredCustomRes = {
      w: String(w), h: String(h),
      rows: customResRows, cols: customResCols,
      applyGrid: customResApplyGrid,
    };
    try { localStorage.setItem(CUSTOM_RES_STORAGE_KEY, JSON.stringify(stored)); } catch { /* ignore quota */ }
    setLastCustomRes(stored);
    setShowCustomResDialog(false);
  }, [customResW, customResH, customResApplyGrid, customResRows, customResCols, overlays.length, applyResolution, buildGridZones, t]);

  const saveCurrentAsPreset = useCallback(() => {
    const name = presetSaveName.trim();
    if (!name) { toast.error("請輸入預設名稱"); return; }
    const w = parseInt(customResW, 10);
    const h = parseInt(customResH, 10);
    if (!Number.isFinite(w) || !Number.isFinite(h) || w < 16 || h < 16) {
      toast.error(t("studioCustomResInvalid")); return;
    }
    if (myPresets.length >= 20) { toast.error("最多儲存 20 組預設"); return; }
    const rows = Math.max(1, Math.min(10, parseInt(customResRows, 10) || 1));
    const cols = Math.max(1, Math.min(10, parseInt(customResCols, 10) || 1));
    const next: MyResPreset[] = [
      ...myPresets,
      { id: `preset-${Date.now().toString(36)}`, name, w, h, rows, cols, applyGrid: customResApplyGrid },
    ];
    setMyPresets(next);
    saveMyResPresets(next);
    setPresetSaveName("");
    toast.success(`已儲存預設「${name}」`);
  }, [presetSaveName, customResW, customResH, customResRows, customResCols, customResApplyGrid, myPresets, t]);

  const deleteMyPreset = useCallback((id: string) => {
    const next = myPresets.filter((p) => p.id !== id);
    setMyPresets(next);
    saveMyResPresets(next);
    toast.success("已刪除預設");
  }, [myPresets]);

  const updateZoneContent = useCallback((zoneId: string, content: ZoneContent) => { setZones((prev) => prev.map((z) => (z.id === zoneId ? { ...z, content } : z))); }, []);
  const updateOverlayContent = useCallback((overlayId: string, content: ZoneContent) => { setOverlays((prev) => prev.map((o) => (o.id === overlayId ? { ...o, content } : o))); }, []);

  // Resolve picker items into MediaItem[] then append to a specific zone or overlay
  const addItemsToSpecificTarget = useCallback(async (
    items: PickerPayload[],
    target: { type: "zone"; id: string } | { type: "overlay"; id: string },
  ) => {
    const targetZone = target.type === "zone" ? zones.find((z) => z.id === target.id) : null;
    const targetOverlay = target.type === "overlay" ? overlays.find((o) => o.id === target.id) : null;
    if (!targetZone && !targetOverlay) return;

    const mediaIds = items.filter((i) => i.kind === "media").map((i) => (i.raw as DbMediaItem).id);
    const detailMap = new Map<string, { id: string; name: string; original_name: string; type: string; url: string; thumbnail: string; duration_seconds: number | null }>();
    if (mediaIds.length > 0) {
      const { data, error } = await supabase
        .from("media_items")
        .select("id, name, original_name, type, url, thumbnail, duration_seconds")
        .is("deleted_at", null)
        .in("id", mediaIds);
      if (error) { toast.error(formatUserError(error, t)); return; }
      (data || []).forEach((m) => detailMap.set(m.id, m));
    }

    const appended: MediaItem[] = [];
    items.forEach((it) => {
      if (it.kind === "media") {
        const m = detailMap.get(it.raw.id);
        if (!m) return;
        const isVideo = m.type === "video";
        const dur = isVideo ? (Math.round(getMediaDurationSec(m)) || 10) : 7;
        appended.push({
          id: m.id,
          type: m.type,
          url: m.thumbnail || m.url,
          name: m.original_name?.trim() || m.name,
          duration: dur,
          ...(isVideo ? { volume: 30 } : {}),
        });
      } else {
        const w = it.raw;
        appended.push({ id: w.id, type: "widget", url: "", name: w.name, duration: 10, widgetConfig: w.config });
      }
    });

    if (appended.length === 0) return;

    const hasIncomingVideo = appended.some((m) => m.type === "video");

    if (targetZone) {
      if (hasIncomingVideo) {
        const videoHolder =
          zones.find((z) => z.id !== targetZone.id && z.content?.mediaItems?.some((m) => m.type === "video")) ??
          overlays.find((o) => o.content?.mediaItems?.some((m) => m.type === "video"));
        if (videoHolder) {
          toast.error(t("studioVideoZoneLimit").replace("{zone}", videoHolder.label));
          return;
        }
      }
      const existing = targetZone.content?.mediaItems || [];
      updateZoneContent(targetZone.id, {
        ...(targetZone.content || { type: "color", value: "", bgColor: "hsl(var(--muted))" }),
        type: "media",
        mediaItems: [...existing, ...appended],
        widgetId: undefined, widgetName: undefined, widgetConfig: undefined,
      });
      toast.success(t("studioAddedToZone").replace("{label}", targetZone.label));
    } else if (targetOverlay) {
      if (hasIncomingVideo) {
        const videoHolder =
          zones.find((z) => z.content?.mediaItems?.some((m) => m.type === "video")) ??
          overlays.find((o) => o.id !== targetOverlay.id && o.content?.mediaItems?.some((m) => m.type === "video"));
        if (videoHolder) {
          toast.error(t("studioVideoZoneLimit").replace("{zone}", videoHolder.label));
          return;
        }
      }
      const existing = targetOverlay.content?.mediaItems || [];
      updateOverlayContent(targetOverlay.id, {
        ...(targetOverlay.content || { type: "color", value: "", bgColor: "transparent" }),
        type: "media",
        mediaItems: [...existing, ...appended],
        widgetId: undefined, widgetName: undefined, widgetConfig: undefined,
      });
      toast.success(t("studioAddedToZone").replace("{label}", targetOverlay.label));
    }
  }, [zones, overlays, updateZoneContent, updateOverlayContent, t]);

  // Append to currently selected zone/overlay (kept for click-to-add path)
  const addItemsToActiveTarget = useCallback(async (items: PickerPayload[]) => {
    const targetZone = zones.find((z) => z.id === selectedZone);
    const targetOverlay = !targetZone ? overlays.find((o) => o.id === selectedOverlay) : null;
    if (targetZone) return addItemsToSpecificTarget(items, { type: "zone", id: targetZone.id });
    if (targetOverlay) return addItemsToSpecificTarget(items, { type: "overlay", id: targetOverlay.id });
  }, [zones, overlays, selectedZone, selectedOverlay, addItemsToSpecificTarget]);

  // Drop handlers reading the studio picker payload (supports single OR array payloads)
  const parsePickerDropPayload = useCallback((e: React.DragEvent): PickerPayload[] | null => {
    try {
      const raw = e.dataTransfer.getData("application/x-studio-picker-item");
      if (!raw) return null;
      const parsed = JSON.parse(raw) as unknown;
      const arr: PickerPayload[] = Array.isArray(parsed) ? parsed as PickerPayload[] : [parsed as PickerPayload];
      const valid = arr.filter((p) => p && (p.kind === "media" || p.kind === "widget"));
      return valid.length ? valid : null;
    } catch { return null; }
  }, []);

  // Overlay management
  const addOverlay = useCallback(() => {
    if (zones.length + overlays.length >= 8) {
      toast.error(`區塊總數不可超過 8 個（目前 ${zones.length} 區塊 + ${overlays.length} 重疊）`);
      return;
    }
    const id = `overlay-${Date.now()}`;
    const usedLabels = new Set(overlays.map((o) => o.label.replace(/^OV-/, "")));
    let label = "A";
    for (let i = 0; i < 26; i++) {
      const c = String.fromCharCode(65 + i);
      if (!usedLabels.has(c)) { label = c; break; }
    }
    // Adapt to actual canvas size so overlay always fits (handles narrow/tall portrait canvases)
    const rect = canvasRef.current?.getBoundingClientRect();
    const cw = rect?.width ?? 800;
    const ch = rect?.height ?? 600;
    const w = Math.max(60, Math.min(200, Math.round(cw * 0.6)));
    const h = Math.max(40, Math.min(120, Math.round(ch * 0.2)));
    const x = Math.max(0, Math.round((cw - w) / 2));
    const y = Math.max(0, Math.round((ch - h) / 2));
    setOverlays((prev) => [...prev, { id, x, y, w, h, label: `OV-${label}`, opacity: 100, zIndex: prev.length + 1, content: { type: "text", value: "", bgColor: "transparent", fontSize: 20, textColor: "hsl(0 0% 100%)" } }]);
  }, [overlays.length, zones.length]);

  const deleteOverlay = useCallback((id: string) => {
    setOverlays((prev) => prev.filter((o) => o.id !== id));
    if (selectedOverlay === id) setSelectedOverlay(null);
  }, [selectedOverlay]);

  // Split the selected overlay into two halves (vertical = side-by-side, horizontal = top/bottom)
  const splitSelectedOverlay = useCallback((dir: "horizontal" | "vertical") => {
    if (!selectedOverlay) return;
    if (zones.length + overlays.length >= 8) {
      toast.error(`區塊總數不可超過 8 個`);
      return;
    }
    setOverlays((prev) => {
      const o = prev.find((x) => x.id === selectedOverlay);
      if (!o) return prev;
      if (dir === "vertical" && o.w < 40) { toast.info("區塊太小，無法繼續分割"); return prev; }
      if (dir === "horizontal" && o.h < 40) { toast.info("區塊太小，無法繼續分割"); return prev; }
      const newId = `overlay-${Date.now()}`;
      const usedLabels = new Set(prev.map((o) => o.label.replace(/^OV-/, "")));
      let nextLabel = "A";
      for (let i = 0; i < 26; i++) {
        const c = String.fromCharCode(65 + i);
        if (!usedLabels.has(c)) { nextLabel = c; break; }
      }
      const maxZ = prev.reduce((m, p) => Math.max(m, p.zIndex || 0), 0);
      let updated: OverlayBlock;
      let created: OverlayBlock;
      if (dir === "vertical") {
        const halfW = o.w / 2;
        updated = { ...o, w: halfW };
        created = { ...o, id: newId, x: o.x + halfW, w: halfW, label: `OV-${nextLabel}`, zIndex: maxZ + 1 };
      } else {
        const halfH = o.h / 2;
        updated = { ...o, h: halfH };
        created = { ...o, id: newId, y: o.y + halfH, h: halfH, label: `OV-${nextLabel}`, zIndex: maxZ + 1 };
      }
      return prev.map((p) => (p.id === o.id ? updated : p)).concat(created);
    });
    toast.success("已分割重疊區塊");
  }, [selectedOverlay, zones.length, overlays.length]);

  const moveOverlayLayer = useCallback((id: string, direction: "up" | "down") => {
    setOverlays((prev) => {
      const sorted = [...prev].sort((a, b) => a.zIndex - b.zIndex);
      const idx = sorted.findIndex((o) => o.id === id);
      if (direction === "up" && idx < sorted.length - 1) {
        const swapId = sorted[idx + 1].id;
        const myZ = sorted[idx].zIndex, otherZ = sorted[idx + 1].zIndex;
        return prev.map((o) => o.id === id ? { ...o, zIndex: otherZ } : o.id === swapId ? { ...o, zIndex: myZ } : o);
      }
      if (direction === "down" && idx > 0) {
        const swapId = sorted[idx - 1].id;
        const myZ = sorted[idx].zIndex, otherZ = sorted[idx - 1].zIndex;
        return prev.map((o) => o.id === id ? { ...o, zIndex: otherZ } : o.id === swapId ? { ...o, zIndex: myZ } : o);
      }
      return prev;
    });
  }, []);

  // ── Switch active output ────────────────────────────────────────────────
  // Saves current output's page state automatically (the mirror useEffect keeps
  // it up to date), then loads the target output's active page.
  const switchToOutput = useCallback((n: number) => {
    if (n === activeOutputRef.current) return;
    const allPages = outputPagesRef.current;
    const allActiveIds = outputActivePageIdRef.current;
    let targetPages = allPages[n];
    let targetActiveId = allActiveIds[n];
    if (!targetPages || targetPages.length === 0) {
      // Lazily initialise this output with a default page
      const id = makePageId();
      const initZones = INITIAL_LAYOUT_PRESETS[0].zones.map((z) => ({ ...z }));
      const newPage: StudioPage = { id, name: "版型 1", zones: initZones, overlays: [] };
      targetPages = [newPage];
      targetActiveId = id;
      setOutputPages((prev) => ({ ...prev, [n]: [newPage] }));
      setOutputActivePageId((prev) => ({ ...prev, [n]: id }));
    } else if (!targetActiveId || !targetPages.find((p) => p.id === targetActiveId)) {
      targetActiveId = targetPages[0].id;
      setOutputActivePageId((prev) => ({ ...prev, [n]: targetActiveId! }));
    }
    setActiveOutput(n);
    const targetPage = targetPages.find((p) => p.id === targetActiveId) ?? targetPages[0];
    if (targetPage) {
      setZones(targetPage.zones);
      setOverlays(targetPage.overlays);
    }
    setSelectedZone(null);
    setSelectedOverlay(null);
    setExtraSelectedZoneIds(new Set());
  }, []); // stable — reads everything from refs

  // Save project (resolution 內嵌為 zones[0] 的 _meta 標記，避免 schema 變更)
  const handleSave = useCallback(async (name?: string): Promise<boolean> => {
    setSaving(true);
    // Build a per-output snapshot, ensuring the currently-active page of the
    // active output reflects the very latest zones/overlays.
    const ao = activeOutput;
    const aoPagesSnapshot = (outputPages[ao] ?? []).map((p) =>
      p.id === activePageId ? { ...p, zones, overlays } : p
    );
    const outputPagesSnapshot = { ...outputPages, [ao]: aoPagesSnapshot };
    // Capture current display-canvas pixel size so the player can convert overlay
    // absolute-pixel coords (stored relative to this canvas) back to percentages.
    const _canvasRect = canvasRef.current?.getBoundingClientRect();
    const metaEntry = {
      _meta: true,
      resolution: { id: resolution.id, width: resolution.width, height: resolution.height },
      displayW: _canvasRect ? Math.round(_canvasRect.width)  : undefined,
      displayH: _canvasRect ? Math.round(_canvasRect.height) : undefined,
      bgm: { items: bgmItems, volume: bgmVolume, audioSource: bgmAudioSource },
      // New multi-output format
      outputPages: Object.fromEntries(
        Object.entries(outputPagesSnapshot).map(([k, pgList]) => [
          k,
          pgList.map((p) => ({ id: p.id, name: p.name, zones: p.zones, overlays: p.overlays })),
        ])
      ),
      outputActivePageId,
      // Legacy compat: also persist current output's pages in 'pages' field
      pages: aoPagesSnapshot.map((p) => ({ id: p.id, name: p.name, zones: p.zones, overlays: p.overlays })),
      activePageId,
      outputMode,
      outputCount,
      activeOutput,
      pageTransition: {
        ...projectTransition,
        pageChannels: aoPagesSnapshot.map((p, i) => ({
          id: p.id,
          name: p.name,
          gpioChannel: i,
          remoteCode: String(i + 1).padStart(2, "0"),
        })),
      },
    };
    const zonesData = JSON.parse(JSON.stringify([
      metaEntry,
      ...zones.map(z => ({ ...z })),
      ...overlays.map(o => ({ ...o, _overlay: true })),
    ]));
    const saveOrgId = activeOrgId || defaultOrgId || null;
    const teamIdToSave = projectTeamId && projectTeamId !== "none" ? projectTeamId : null;
    const collabToSave = projectCollab === "team" && !teamIdToSave ? "creator" : projectCollab;
    const projectName_ = name || currentProject?.name || "Untitled";
    const updatedAt = new Date().toISOString();
    let ok = false;
    try {
      if (currentProject) {
        await supabase.from("design_projects").update({ name: projectName_, aspect, zones: zonesData, team_id: teamIdToSave, collab_scope: collabToSave, updated_at: updatedAt }).eq("id", currentProject.id);
        setCurrentProject({ ...currentProject, name: projectName_, aspect, zones: zones, overlays, updated_at: updatedAt });
        toast.success(t("studioProjectSaved"));
        ok = true;
      } else {
        const { data } = await supabase.from("design_projects").insert({ name: projectName_, aspect, zones: zonesData, created_by: user?.id ?? null, org_id: saveOrgId, team_id: teamIdToSave, collab_scope: collabToSave, updated_at: updatedAt }).select().single();
        if (data) { setCurrentProject({ ...data, zones, overlays }); toast.success(t("studioProjectSaved")); ok = true; }
      }
      loadProjects();
    } catch { toast.error(t("studioProjectSaveFailed")); }
    setSaving(false);
    setShowSaveDialog(false);
    setTimeout(() => markClean(), 0);
    return ok;
  }, [currentProject, aspect, zones, overlays, user, t, loadProjects, activeOrgId, defaultOrgId, resolution, bgmItems, bgmVolume, bgmAudioSource, markClean, outputPages, outputActivePageId, activeOutput, activePageId, projectTransition, projectTeamId, projectCollab]);

  // Load project
  const handleLoad = useCallback((project: DesignProject) => {
    setCurrentProject(project);
    const loadedAspect = project.aspect as AspectRatio;
    setAspect(loadedAspect);
    // Hydrate team / collab so the settings dialog reflects the loaded project.
    const loadedTeamId = project.team_id;
    const loadedCollab = project.collab_scope;
    setProjectTeamId(loadedTeamId ? String(loadedTeamId) : "none");
    setProjectCollab(
      loadedCollab === "team" || loadedCollab === "org" || loadedCollab === "creator"
        ? loadedCollab
        : "creator"
    );
    setProjectName(project.name || "");
    const allData: Array<Record<string, unknown>> = Array.isArray(project.zones) ? project.zones as Array<Record<string, unknown>> : [];
    const metaEntry = allData.find((z) => z._meta) as Record<string, unknown> | undefined;
    const regularZones = allData.filter((z) => !z._overlay && !z._meta) as unknown as Zone[];
    const overlayData = allData.filter((z) => z._overlay).map((o) => { const { _overlay, ...rest } = o; return rest as unknown as OverlayBlock; });

    // 還原解析度，未存則用該 aspect 預設；若儲存的 id 是 custom 則保留 custom 標籤（即使尺寸恰好等於預設）
    const metaRes = metaEntry?.resolution as { id?: string; width?: number; height?: number } | undefined;
    if (metaRes?.width && metaRes?.height) {
      const r = metaRes;
      if (r.id === "custom") {
        setResolution({ id: "custom", labelKey: "studioResCustom", width: r.width, height: r.height });
      } else {
        const matched = RESOLUTION_PRESETS[loadedAspect].find((p) => p.width === r.width && p.height === r.height);
        setResolution(matched || { id: "custom", labelKey: "studioResCustom", width: r.width ?? 1920, height: r.height ?? 1080 });
      }
    } else {
      setResolution(getDefaultResolution(loadedAspect));
    }

    // Restore output settings first (needed for page restoration below)
    const savedOutputMode = metaEntry?.outputMode;
    if (savedOutputMode === "mirror" || savedOutputMode === "independent" || savedOutputMode === "extend-h" || savedOutputMode === "extend-v" || savedOutputMode === "grid-2x2-h") {
      setOutputMode(savedOutputMode);
    } else {
      setOutputMode("mirror");
    }
    const savedOutputCount = typeof metaEntry?.outputCount === "number" ? metaEntry.outputCount : 1;
    setOutputCount(Math.max(1, Math.min(4, savedOutputCount)));
    const savedActiveOutput = typeof metaEntry?.activeOutput === "number" ? metaEntry.activeOutput : 1;
    const loadAO = Math.max(1, Math.min(savedOutputCount, savedActiveOutput));
    setActiveOutput(loadAO);

    // Helper to deserialise a raw pages array into StudioPage[]
    const deserialisePages = (raw: Array<Record<string, unknown>>): StudioPage[] =>
      raw.map((p, i) => ({
        id: typeof p.id === "string" ? p.id : makePageId(),
        name: typeof p.name === "string" && p.name ? p.name : `版型 ${i + 1}`,
        zones: Array.isArray(p.zones) ? p.zones as Zone[] : [],
        overlays: Array.isArray(p.overlays) ? p.overlays as OverlayBlock[] : [],
      }));

    // ── Restore per-output pages ──────────────────────────────────────
    const savedOutputPagesRaw = metaEntry?.outputPages as Record<string, Array<Record<string, unknown>>> | undefined;
    const savedOutputActivePageIdRaw = metaEntry?.outputActivePageId as Record<string, string> | undefined;

    if (savedOutputPagesRaw && Object.keys(savedOutputPagesRaw).length > 0) {
      // New multi-output format
      const restoredOutputPages: Record<number, StudioPage[]> = {};
      const restoredOutputActivePageId: Record<number, string> = {};
      for (const [k, pgListRaw] of Object.entries(savedOutputPagesRaw)) {
        const oNum = parseInt(k, 10);
        if (!Number.isFinite(oNum) || !Array.isArray(pgListRaw)) continue;
        const pgList = deserialisePages(pgListRaw);
        restoredOutputPages[oNum] = pgList;
        const wantId = savedOutputActivePageIdRaw?.[k];
        const found = typeof wantId === "string" && pgList.find((p) => p.id === wantId);
        restoredOutputActivePageId[oNum] = found ? found.id : (pgList[0]?.id ?? "");
      }
      setOutputPages(restoredOutputPages);
      setOutputActivePageId(restoredOutputActivePageId);
      const loadPages = restoredOutputPages[loadAO] ?? [];
      const loadActiveId = restoredOutputActivePageId[loadAO] ?? loadPages[0]?.id ?? "";
      const activePg = loadPages.find((p) => p.id === loadActiveId) ?? loadPages[0];
      setZones(activePg?.zones ?? []);
      setOverlays(activePg?.overlays ?? []);
    } else {
      // Legacy single-output format
      const savedPages: Array<Record<string, unknown>> = Array.isArray(metaEntry?.pages) ? metaEntry.pages as Array<Record<string, unknown>> : [];
      let restoredPages: StudioPage[];
      let restoredActiveId: string;
      if (savedPages.length > 0) {
        restoredPages = deserialisePages(savedPages);
        const wantId = typeof metaEntry?.activePageId === "string" ? metaEntry.activePageId as string : restoredPages[0].id;
        const active = restoredPages.find((p) => p.id === wantId) ?? restoredPages[0];
        restoredActiveId = active.id;
        setZones(active.zones);
        setOverlays(active.overlays);
      } else {
        // Ancient legacy: no pages at all, wrap raw zones
        const firstPageId = makePageId();
        restoredPages = [{ id: firstPageId, name: "版型 1", zones: regularZones, overlays: overlayData }];
        restoredActiveId = firstPageId;
        setZones(regularZones);
        setOverlays(overlayData);
      }
      setOutputPages({ [loadAO]: restoredPages });
      setOutputActivePageId({ [loadAO]: restoredActiveId });
    }

    // Restore BGM track from _meta (graceful defaults for legacy projects)
    const bgmMeta = metaEntry?.bgm as { items?: MediaItem[]; volume?: number; audioSource?: string } | undefined;
    setBgmItems(Array.isArray(bgmMeta?.items) ? bgmMeta!.items! : []);
    setBgmVolume(typeof bgmMeta?.volume === "number" ? Math.max(0, Math.min(100, bgmMeta.volume)) : 30);
    setBgmAudioSource(typeof bgmMeta?.audioSource === "string" && bgmMeta.audioSource ? bgmMeta.audioSource : "bgm");

    // Restore project-level page transition condition
    setProjectTransition(normalizePageTransition(metaEntry?.pageTransition));

    setSelectedZone(null);
    setSelectedOverlay(null);
    setShowLoadDialog(false);
    // Dismiss any pending draft (user loaded a project, so the draft is superseded)
    clearStudioDraft();
    draftToRestoreRef.current = null;
    setDraftRecoveryOpen(false);
    setTimeout(() => markClean(), 0);
    if (suppressLoadToastRef.current) {
      suppressLoadToastRef.current = false;
    } else {
      toast.success(t("studioProjectLoaded"));
    }
  }, [t, markClean]);

  // ── Session restore: rehydrate the last project + selection on mount ──
  const suppressLoadToastRef = useRef(false);
  const sessionRestoredRef = useRef(false);
  useEffect(() => {
    if (sessionRestoredRef.current) return;
    const saved = persistedSessionRef.current;
    if (!saved?.projectId) { sessionRestoredRef.current = true; return; }
    if (projects.length === 0) return; // wait for projects to load
    const target = projects.find((p) => p.id === saved.projectId);
    sessionRestoredRef.current = true;
    if (!target) return; // project no longer exists or not in this org
    suppressLoadToastRef.current = true;
    handleLoad(target);
    // Restore the selected zone/overlay if it still exists in the loaded canvas.
    setTimeout(() => {
      const allZoneEntries: Array<Record<string, unknown>> = Array.isArray(target.zones) ? target.zones as Array<Record<string, unknown>> : [];
      const regularZoneIds = new Set(
        allZoneEntries.filter((z) => !z._overlay && !z._meta).map((z) => z.id as string)
      );
      const overlayIds = new Set(
        allZoneEntries.filter((z) => z._overlay).map((z) => z.id as string)
      );
      // Multi-page projects keep zones inside _meta.pages, so check there too.
      const meta = allZoneEntries.find((z) => z._meta) as Record<string, unknown> | undefined;
      // Collect IDs from legacy 'pages' field
      if (Array.isArray(meta?.pages)) {
        for (const pg of meta!.pages as Array<{ zones?: Array<{ id?: string }>; overlays?: Array<{ id?: string }> }>) {
          (pg.zones || []).forEach((z) => z?.id && regularZoneIds.add(z.id));
          (pg.overlays || []).forEach((o) => o?.id && overlayIds.add(o.id));
        }
      }
      // Collect IDs from new per-output 'outputPages' field
      if (meta?.outputPages && typeof meta.outputPages === "object") {
        for (const pgList of Object.values(meta.outputPages as Record<string, Array<{ zones?: Array<{ id?: string }>; overlays?: Array<{ id?: string }> }>>) ) {
          if (!Array.isArray(pgList)) continue;
          for (const pg of pgList) {
            (pg.zones || []).forEach((z) => z?.id && regularZoneIds.add(z.id));
            (pg.overlays || []).forEach((o) => o?.id && overlayIds.add(o.id));
          }
        }
      }
      if (saved.selectedZone && regularZoneIds.has(saved.selectedZone)) {
        setSelectedZone(saved.selectedZone);
      } else if (saved.selectedOverlay && overlayIds.has(saved.selectedOverlay)) {
        setSelectedOverlay(saved.selectedOverlay);
      }
    }, 0);
  }, [projects, handleLoad]);

  // ── Auto-draft: check for a recoverable draft after session restore ───────
  // Runs once after projects load (gives session restore a 200 ms head start).
  const draftCheckedRef = useRef(false);
  useEffect(() => {
    if (projects.length === 0) return; // wait for projects list
    if (draftCheckedRef.current) return;
    const timer = setTimeout(() => {
      if (draftCheckedRef.current) return;
      draftCheckedRef.current = true;
      const draft = loadStudioDraft();
      if (!draft) return;
      // Discard if it belongs to a different org
      if (draft.orgId && activeOrgId && draft.orgId !== activeOrgId) {
        clearStudioDraft();
        return;
      }
      // Discard if the project has been saved more recently than the draft
      if (draft.projectId) {
        const proj = projects.find((p) => p.id === draft.projectId);
        if (proj && proj.updated_at && new Date(proj.updated_at) >= new Date(draft.savedAt)) {
          clearStudioDraft();
          return;
        }
      }
      draftToRestoreRef.current = draft;
      setDraftRecoveryOpen(true);
    }, 200);
    return () => clearTimeout(timer);
  }, [projects, activeOrgId]);

  // ── Session persist: keep the last project + selection + panels in sync ──
  // Only remember the project ID when there are unsaved changes (isDirty).
  // A cleanly-saved project should NOT auto-reopen on next visit — the user
  // explicitly saved and left, so the next visit starts with a fresh canvas.
  // If the user navigates away mid-edit (isDirty=true), the session is
  // preserved so they can resume where they left off.
  useEffect(() => {
    saveStudioSession({
      projectId: (currentProject && isDirty) ? currentProject.id : null,
      selectedZone,
      selectedOverlay,
      layoutPanelOpen,
      mediaLibraryOpen,
      sidebarTab,
    });
  }, [
    currentProject?.id,
    isDirty,
    selectedZone,
    selectedOverlay,
    layoutPanelOpen,
    mediaLibraryOpen,
    sidebarTab,
  ]);

  // ── Draft recovery: restore saved draft back to the canvas ──────────────────
  type StudioPage = { id: string; name: string; zones: Zone[]; overlays: OverlayBlock[] };
  const handleRecoverDraft = useCallback(() => {
    const draft = draftToRestoreRef.current;
    if (!draft) { setDraftRecoveryOpen(false); return; }
    setDraftRecoveryOpen(false);

    // Restore aspect & resolution
    setAspect(draft.aspect as AspectRatio);
    const resLabelKey =
      draft.resolution.id === "hd"     ? "studioRes720p" :
      draft.resolution.id === "fhd"    ? "studioResFHD"  :
      draft.resolution.id === "uhd-4k" ? "studioRes4K"   :
      draft.resolution.id === "uhd-8k" ? "studioRes8K"   : "studioResCustom";
    setResolution({ id: draft.resolution.id, labelKey: resLabelKey as TranslationKey, width: draft.resolution.width, height: draft.resolution.height });

    // Restore output settings
    const validModes = ["mirror", "independent", "extend-h", "extend-v", "grid-2x2-h"];
    if (validModes.includes(draft.outputMode)) setOutputMode(draft.outputMode as "mirror" | "independent" | "extend-h" | "extend-v" | "grid-2x2-h");
    const safeCount = Math.max(1, Math.min(4, draft.outputCount));
    setOutputCount(safeCount);
    const safeAO = Math.max(1, Math.min(safeCount, draft.activeOutput));
    setActiveOutput(safeAO);

    // Restore per-output pages
    const restoredOutputPages: Record<number, StudioPage[]> = {};
    const restoredOutputActivePageId: Record<number, string> = {};
    for (const [k, pgList] of Object.entries(draft.outputPages)) {
      const oNum = parseInt(k, 10);
      if (!Number.isFinite(oNum) || !Array.isArray(pgList)) continue;
      restoredOutputPages[oNum] = pgList as StudioPage[];
      const wantId = draft.outputActivePageId[k];
      const found = typeof wantId === "string" && (pgList as StudioPage[]).find((p) => p.id === wantId);
      restoredOutputActivePageId[oNum] = found ? found.id : ((pgList as StudioPage[])[0]?.id ?? "");
    }
    setOutputPages(restoredOutputPages);
    setOutputActivePageId(restoredOutputActivePageId);

    // Set active page zones/overlays
    const aoPages = restoredOutputPages[safeAO] ?? [];
    const aoActiveId = restoredOutputActivePageId[safeAO] ?? aoPages[0]?.id ?? "";
    const activePg = aoPages.find((p) => p.id === aoActiveId) ?? aoPages[0];
    setZones(activePg?.zones ?? []);
    setOverlays(activePg?.overlays ?? []);

    // Restore BGM
    setBgmItems(Array.isArray(draft.bgmItems) ? draft.bgmItems : []);
    setBgmVolume(typeof draft.bgmVolume === "number" ? Math.max(0, Math.min(100, draft.bgmVolume)) : 30);
    setBgmAudioSource(typeof draft.bgmAudioSource === "string" && draft.bgmAudioSource ? draft.bgmAudioSource : "bgm");

    // Restore project ref if it still exists
    if (draft.projectId) {
      const proj = projects.find((p) => p.id === draft.projectId);
      if (proj) setCurrentProject(proj);
    }
    setProjectName(draft.projectName || "");

    // Draft content is dirty — do NOT call markClean
    clearStudioDraft();
    draftToRestoreRef.current = null;
    toast.success(t("studioDraftRestored"));
  }, [projects, t, setAspect, setResolution, setOutputMode, setOutputCount, setActiveOutput, setOutputPages, setOutputActivePageId, setZones, setOverlays, setBgmItems, setBgmVolume, setBgmAudioSource, setCurrentProject, setProjectName]);

  // Delete project
  const handleDelete = useCallback(async (id: string) => {
    const project = projects.find((p) => p.id === id);
    const projectName = project?.name || "";
    const report = await checkDesignProjectReferences(id);
    const channels  = report.groups.find((g) => g.kind === "channel")?.items  ?? [];
    const media     = report.groups.find((g) => g.kind === "media")?.items    ?? [];
    const schedules = report.groups.find((g) => g.kind === "schedule")?.items ?? [];
    setDeleteConfirm({
      id,
      name: projectName,
      channels,
      media,
      schedules,
      queued: pendingDeleteIds.has(id),
      busyKey: null,
    });
  }, [projects, pendingDeleteIds]);

  const confirmDeleteProject = useCallback(async () => {
    if (!deleteConfirm) return;
    const { id } = deleteConfirm;
    setDeleteConfirm(null);
    await supabase.from("design_projects").delete().eq("id", id);
    if (currentProject?.id === id) { setCurrentProject(null); }
    loadProjects();
    toast.success(t("studioProjectDeleted"));
  }, [deleteConfirm, currentProject, loadProjects, t]);

  // Re-run the reference check after an unassign, so the dialog updates live.
  const refreshDeleteConfirmRefs = useCallback(async (id: string) => {
    const report = await checkDesignProjectReferences(id);
    const channels  = report.groups.find((g) => g.kind === "channel")?.items  ?? [];
    const media     = report.groups.find((g) => g.kind === "media")?.items    ?? [];
    const schedules = report.groups.find((g) => g.kind === "schedule")?.items ?? [];
    setDeleteConfirm((prev) => (prev && prev.id === id ? { ...prev, channels, media, schedules, busyKey: null } : prev));
    // If queued and references are now zero, the trigger will have deleted the project.
    if (channels.length + media.length + schedules.length === 0) {
      // Reload to clear pending state and remove from grid.
      loadProjects();
    }
  }, [loadProjects]);

  const handleUnassignReference = useCallback(async (item: ReferenceItem) => {
    if (!deleteConfirm) return;
    const key = JSON.stringify(item.unassign ?? {});
    setDeleteConfirm({ ...deleteConfirm, busyKey: key });
    try {
      await unassignProjectReference(item);
      toast.success(t("studioDeleteUnassignSuccess"));
      await refreshDeleteConfirmRefs(deleteConfirm.id);
    } catch (err: unknown) {
      toast.error(t("studioDeleteUnassignError"), { description: err instanceof Error ? err.message : undefined });
      setDeleteConfirm((prev) => (prev ? { ...prev, busyKey: null } : prev));
    }
  }, [deleteConfirm, refreshDeleteConfirmRefs, t]);

  const handleQueueDelete = useCallback(async () => {
    if (!deleteConfirm || !user) return;
    const project = projects.find((p) => p.id === deleteConfirm.id);
    const res = await queueDesignProjectDelete({
      projectId: deleteConfirm.id,
      orgId: project?.org_id ?? activeOrgId ?? null,
      userId: user.id,
    });
    if ("error" in res) {
      toast.error(res.error);
      return;
    }
    setPendingDeleteIds((prev) => new Set(prev).add(deleteConfirm.id));
    setDeleteConfirm({ ...deleteConfirm, queued: true });
    toast.success(t("studioDeleteRequestedTitle"), { description: t("studioDeleteRequestedDesc") });
  }, [deleteConfirm, user, projects, activeOrgId, t]);

  const handleCancelQueuedDelete = useCallback(async () => {
    if (!deleteConfirm) return;
    await cancelDesignProjectDelete(deleteConfirm.id);
    setPendingDeleteIds((prev) => {
      const next = new Set(prev);
      next.delete(deleteConfirm.id);
      return next;
    });
    setDeleteConfirm({ ...deleteConfirm, queued: false });
  }, [deleteConfirm]);

  // Export project as ZIP (JSON manifest + referenced media files)
  const handleExport = useCallback(async (project: DesignProject) => {
    const exportToast = toast.loading(t("studioExportingProject"));
    try {
      // Re-fetch latest version to be safe
      const { data: fresh } = await supabase
        .from("design_projects")
        .select("*")
        .eq("id", project.id)
        .single();
      const proj: DesignProject = fresh ? { ...fresh, zones: (fresh.zones as Zone[] | null) ?? [] } : project;
      const zonesData: Array<Record<string, unknown>> = Array.isArray(proj.zones) ? proj.zones as Array<Record<string, unknown>> : [];

      // Collect all referenced media ids from zones / overlays / mediaItems / bgm
      const mediaIds = new Set<string>();
      const walkContent = (content: unknown) => {
        if (!content || typeof content !== "object") return;
        const c = content as Record<string, unknown>;
        if (Array.isArray(c.mediaItems)) {
          for (const m of c.mediaItems as Array<{ id?: unknown }>) if (m?.id) mediaIds.add(String(m.id));
        }
      };
      // Walk top-level zone/overlay items (active page)
      for (const z of zonesData) {
        walkContent(z?.content);
        if (Array.isArray(z?.overlays)) for (const o of z.overlays as Array<{ content?: unknown }>) walkContent(o?.content);
      }
      // Walk ALL pages from _meta so non-active pages' media is also included
      const metaEntry = zonesData.find((z) => z._meta === true);
      // Legacy 'pages' field
      const allPages = Array.isArray(metaEntry?.pages)
        ? (metaEntry!.pages as Array<{ zones?: unknown[]; overlays?: unknown[] }>)
        : [];
      for (const page of allPages) {
        for (const z of (page.zones || [])) walkContent((z as Record<string, unknown>).content);
        for (const o of (page.overlays || [])) walkContent((o as Record<string, unknown>).content);
      }
      // New per-output 'outputPages' field
      if (metaEntry?.outputPages && typeof metaEntry.outputPages === "object") {
        for (const pgList of Object.values(metaEntry.outputPages as Record<string, Array<{ zones?: unknown[]; overlays?: unknown[] }>>)) {
          if (!Array.isArray(pgList)) continue;
          for (const page of pgList) {
            for (const z of (page.zones || [])) walkContent((z as Record<string, unknown>).content);
            for (const o of (page.overlays || [])) walkContent((o as Record<string, unknown>).content);
          }
        }
      }
      // Walk BGM audio items from _meta.bgm.items
      const bgmMeta = metaEntry?.bgm as { items?: Array<{ id?: unknown }> } | undefined;
      for (const b of (bgmMeta?.items || [])) if (b?.id) mediaIds.add(String(b.id));

      // Fetch media metadata
      type MediaRow = { id: string; name: string; original_name: string | null; type: string; mime_type: string; url: string; size_bytes: number; width: number | null; height: number | null; duration_seconds: number | null };
      let mediaRows: MediaRow[] = [];
      if (mediaIds.size > 0) {
        const { data } = await supabase
          .from("media_items")
          .select("id, name, original_name, type, mime_type, url, size_bytes, width, height, duration_seconds")
          .is("deleted_at", null)
          .in("id", Array.from(mediaIds));
        mediaRows = (data || []) as MediaRow[];
      }

      const zip = new JSZip();
      const assetsFolder = zip.folder("assets")!;
      const manifestMedia: Array<Record<string, unknown>> = [];

      const sanitize = (s: string) => (s || "file").replace(/[^\w\-.]+/g, "_").slice(0, 80);
      const usedNames = new Set<string>();

      for (const m of mediaRows) {
        let assetPath: string | null = null;
        try {
          const url: string = m.url || "";
          if (!url) {
            manifestMedia.push({ ...m, assetPath: null, exportError: "no_url" });
            continue;
          }
          let blob: Blob | null = null;
          let extFromMime = "";
          if (m.mime_type) {
            const map: Record<string, string> = {
              "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "image/gif": "gif",
              "video/mp4": "mp4", "video/webm": "webm", "audio/mpeg": "mp3", "audio/wav": "wav",
            };
            extFromMime = map[m.mime_type] || "";
          }
          if (url.startsWith("data:")) {
            // base64 data url
            const match = url.match(/^data:([^;]+);base64,(.+)$/);
            if (match) {
              const bin = atob(match[2]);
              const bytes = new Uint8Array(bin.length);
              for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
              blob = new Blob([bytes], { type: match[1] });
              if (!extFromMime) extFromMime = (match[1].split("/")[1] || "bin").split("+")[0];
            }
          } else {
            const resp = await fetch(url);
            if (resp.ok) blob = await resp.blob();
          }
          if (blob) {
            const baseName = sanitize(m.original_name || m.name || `media_${m.id}`);
            const hasExt = /\.[A-Za-z0-9]{2,5}$/.test(baseName);
            const fileName = hasExt ? baseName : (extFromMime ? `${baseName}.${extFromMime}` : baseName);
            // Prefix with id to guarantee uniqueness
            let candidate = `${m.id}_${fileName}`;
            let n = 1;
            while (usedNames.has(candidate)) { candidate = `${m.id}_${n}_${fileName}`; n++; }
            usedNames.add(candidate);
            assetsFolder.file(candidate, blob);
            assetPath = `assets/${candidate}`;
          }
        } catch (err) {
          console.error("Export media failed", m.id, err);
        }
        manifestMedia.push({
          id: m.id,
          name: m.name,
          original_name: m.original_name,
          type: m.type,
          mime_type: m.mime_type,
          size_bytes: m.size_bytes,
          width: m.width,
          height: m.height,
          duration_seconds: m.duration_seconds,
          assetPath,
        });
      }

      const manifest = {
        format: "signcms.design_project",
        version: 1,
        exportedAt: new Date().toISOString(),
        project: {
          id: proj.id,
          name: proj.name,
          aspect: proj.aspect,
          zones: zonesData,
          overlays: zonesData.filter((z) => z._overlay === true),
          bgmItems: bgmMeta?.items ?? null,
          updated_at: proj.updated_at,
          created_at: proj.created_at,
        },
        media: manifestMedia,
      };
      zip.file("project.json", JSON.stringify(manifest, null, 2));

      const blob = await zip.generateAsync({ type: "blob" });
      const url = URL.createObjectURL(blob);
      const filename = `PJM_${sanitize(proj.name || "project")}.zip`;
      // Try direct download first
      try {
        const a = document.createElement("a");
        a.href = url;
        a.download = filename;
        a.rel = "noopener";
        document.body.appendChild(a);
        a.click();
        a.remove();
      } catch { /* ignore */ }
      // Always also show a manual download dialog so user can click the link
      // (works around iframe sandbox / popup blockers in preview environments)
      setExportDownload({ url, filename, sizeBytes: blob.size });
      toast.success(t("studioExportSuccess"), { id: exportToast });
      // Revoke later — give user time to click the manual link
      setTimeout(() => URL.revokeObjectURL(url), 5 * 60_000);
    } catch (err) {
      console.error("Export project failed", err);
      toast.error(t("studioExportFailed"), { id: exportToast });
    }
  }, [t]);

  // Export scene (user-saved template) to ZIP
  const handleExportScene = useCallback(async (tpl: TemplateItem) => {
    const exportToast = toast.loading(t("studioExportingProject"));
    try {
      const tplRaw = tpl as TemplateItem & { bgm?: { items?: Array<{ id?: string }>; volume?: number; audioSource?: string } };

      const mediaIds = new Set<string>();
      const walkContent = (content: unknown) => {
        if (!content || typeof content !== "object") return;
        const c = content as Record<string, unknown>;
        if (Array.isArray(c.mediaItems)) {
          for (const m of c.mediaItems as Array<{ id?: unknown }>) if (m?.id) mediaIds.add(String(m.id));
        }
      };
      for (const z of tpl.zones) walkContent(z.content);
      for (const b of (tplRaw.bgm?.items || [])) if (b?.id) mediaIds.add(String(b.id));

      type MediaRow = { id: string; name: string; original_name: string | null; type: string; mime_type: string; url: string; size_bytes: number; width: number | null; height: number | null; duration_seconds: number | null };
      let mediaRows: MediaRow[] = [];
      if (mediaIds.size > 0) {
        const { data } = await supabase
          .from("media_items")
          .select("id, name, original_name, type, mime_type, url, size_bytes, width, height, duration_seconds")
          .is("deleted_at", null)
          .in("id", Array.from(mediaIds));
        mediaRows = (data || []) as MediaRow[];
      }

      const zip = new JSZip();
      const assetsFolder = zip.folder("assets")!;
      const manifestMedia: Array<Record<string, unknown>> = [];
      const sanitize = (s: string) => (s || "file").replace(/[^\w\-.]+/g, "_").slice(0, 80);
      const usedNames = new Set<string>();

      for (const m of mediaRows) {
        let assetPath: string | null = null;
        try {
          const url: string = m.url || "";
          if (!url) { manifestMedia.push({ ...m, assetPath: null, exportError: "no_url" }); continue; }
          let blob: Blob | null = null;
          let extFromMime = "";
          if (m.mime_type) {
            const map: Record<string, string> = {
              "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "image/gif": "gif",
              "video/mp4": "mp4", "video/webm": "webm", "audio/mpeg": "mp3", "audio/wav": "wav",
            };
            extFromMime = map[m.mime_type] || "";
          }
          if (url.startsWith("data:")) {
            const match = url.match(/^data:([^;]+);base64,(.+)$/);
            if (match) {
              const bin = atob(match[2]);
              const bytes = new Uint8Array(bin.length);
              for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
              blob = new Blob([bytes], { type: match[1] });
              if (!extFromMime) extFromMime = (match[1].split("/")[1] || "bin").split("+")[0];
            }
          } else {
            const resp = await fetch(url);
            if (resp.ok) blob = await resp.blob();
          }
          if (blob) {
            const baseName = sanitize(m.original_name || m.name || `media_${m.id}`);
            const hasExt = /\.[A-Za-z0-9]{2,5}$/.test(baseName);
            const fileName = hasExt ? baseName : (extFromMime ? `${baseName}.${extFromMime}` : baseName);
            let candidate = `${m.id}_${fileName}`;
            let n = 1;
            while (usedNames.has(candidate)) { candidate = `${m.id}_${n}_${fileName}`; n++; }
            usedNames.add(candidate);
            assetsFolder.file(candidate, blob);
            assetPath = `assets/${candidate}`;
          }
        } catch (err) { console.error("Export scene media failed", m.id, err); }
        manifestMedia.push({ id: m.id, name: m.name, original_name: m.original_name, type: m.type, mime_type: m.mime_type, size_bytes: m.size_bytes, width: m.width, height: m.height, duration_seconds: m.duration_seconds, assetPath });
      }

      const manifest = {
        format: "signcms.design_scene",
        version: 1,
        exportedAt: new Date().toISOString(),
        scene: {
          id: tpl.id,
          nameKey: tpl.nameKey,
          aspect: tpl.aspect,
          zones: tpl.zones,
          bgm: tplRaw.bgm ?? null,
        },
        media: manifestMedia,
      };
      zip.file("scene.json", JSON.stringify(manifest, null, 2));

      const blob = await zip.generateAsync({ type: "blob" });
      const url = URL.createObjectURL(blob);
      const filename = `SCENE_${sanitize(tpl.nameKey || "scene")}.zip`;
      try {
        const a = document.createElement("a");
        a.href = url; a.download = filename; a.rel = "noopener";
        document.body.appendChild(a); a.click(); a.remove();
      } catch { /* ignore */ }
      setExportDownload({ url, filename, sizeBytes: blob.size });
      toast.success(t("studioExportSuccess"), { id: exportToast });
      setTimeout(() => URL.revokeObjectURL(url), 5 * 60_000);
    } catch (err) {
      console.error("Export scene failed", err);
      toast.error(t("studioExportFailed"), { id: exportToast });
    }
  }, [t]);

  // Import project from ZIP
  const handleImport = useCallback(async (file: File) => {
    const importToast = toast.loading(t("studioImportingProject"));
    try {
      const zip = await JSZip.loadAsync(file);
      const projectJsonFile = zip.file("project.json");
      if (!projectJsonFile) throw new Error("missing project.json");
      const manifest = JSON.parse(await projectJsonFile.async("string")) as {
        format: string;
        version: number;
        project: {
          name: string; aspect: string; zones: unknown;
          overlays?: unknown; bgmItems?: unknown;
        };
        media?: Array<{
          id: string; name: string; original_name: string | null;
          type: string; mime_type: string; size_bytes: number;
          width: number | null; height: number | null;
          duration_seconds: number | null; assetPath: string | null;
        }>;
      };
      if (manifest.format !== "signcms.design_project") throw new Error("invalid format");
      const proj = manifest.project;
      const mediaManifest = manifest.media || [];

      const idRemap = new Map<string, string>();
      for (const m of mediaManifest) {
        if (!m.assetPath) continue;
        const assetFile = zip.file(m.assetPath);
        if (!assetFile) continue;
        try {
          const buf = await assetFile.async("arraybuffer");
          const blob = new Blob([buf], { type: m.mime_type || "application/octet-stream" });
          const baseName = m.original_name || m.name || `import_${m.id}`;
          const tmpFile = new File([blob], baseName, { type: m.mime_type || "application/octet-stream" });
          const result = await uploadMediaFile(tmpFile, { orgId: activeOrgId! });
          if (result.ok && result.data?.id) idRemap.set(m.id, result.data.id);
        } catch (err) {
          console.warn("Import: asset upload failed", m.id, err);
        }
      }

      const remapIds = (data: unknown): unknown => {
        let str = JSON.stringify(data);
        for (const [oldId, newId] of idRemap) str = str.split(oldId).join(newId);
        return JSON.parse(str);
      };

      const { data: inserted, error } = await (supabase as unknown as { from: (t: string) => unknown })
        .from("design_projects")
        .insert({
          name: `${proj.name} (imported)`,
          aspect: proj.aspect,
          zones: remapIds(proj.zones),
          org_id: activeOrgId,
          created_by: user?.id,
          collab_scope: "org",
        })
        .select()
        .single() as { data: { id: string; name: string; aspect: string; zones: unknown; org_id: string; created_by: string | null; updated_at: string; created_at: string; team_id: string | null; collab_scope: string | null } | null; error: unknown };

      if (error) throw error;
      toast.success(t("studioImportSuccess"), { id: importToast });
      await loadProjects();
      if (inserted) {
        setSidebarTab("my");
        handleLoad({ ...inserted, zones: (inserted.zones as Zone[] | null) ?? [] } as DesignProject);
      }
    } catch (err) {
      console.error("Import project failed", err);
      toast.error(t("studioImportFailed"), { id: importToast });
    }
  }, [t, activeOrgId, user?.id, loadProjects, handleLoad]);

  // New project
  const handleNew = useCallback(() => {
    setCurrentProject(null);
    const firstPageId = makePageId();
    // Reset to a single output with a single blank page
    setOutputPages({ 1: [{ id: firstPageId, name: "版型 1", zones: [], overlays: [] }] });
    setOutputActivePageId({ 1: firstPageId });
    setZones([]);
    setOverlays([]);
    setBgmItems([]);
    setBgmVolume(30);
    setBgmAudioSource("bgm");
    setAspect("16:9");
    setResolution(getDefaultResolution("16:9"));
    setSelectedZone(null);
    setSelectedOverlay(null);
    setExtraSelectedZoneIds(new Set());
    setProjectTransition({ ...DEFAULT_PAGE_TRANSITION, triggers: { ...DEFAULT_PAGE_TRANSITION.triggers } });
    setOutputMode("mirror");
    setOutputCount(1);
    setActiveOutput(1);
    // Auto-generate a project name (PRJ + YYMMDD + next hex sequence)
    setProjectName(generateProjectName(projects.map((p) => p.name || "")));
    // Switch to template/layout selector, collapse media panel, ensure left panel is open
    setSidebarTab("new");
    setInnerSidebarTab("layouts");
    setMediaLibraryOpen(false);
    setLayoutPanelOpen(true);
    // Clear any manual collapse so the layout panel is visible.
    // NOTE: setLayoutPanelManuallyCollapsed is declared later in the component body but
    // is safe to call here because handleNew is only invoked from user events (after full render).
    setLayoutPanelManuallyCollapsed(false);
    try { localStorage.setItem("studio:layoutPanelManuallyCollapsed", "0"); } catch { /* ignore */ }
    // Discard any pending draft (user explicitly chose to start fresh)
    clearStudioDraft();
    draftPayloadRef.current = null;
    draftToRestoreRef.current = null;
    setDraftRecoveryOpen(false);
    // Mark clean after state settles
    setTimeout(() => markClean(), 0);
  }, [markClean, projects]);

  // Wrappers that warn before discarding unsaved work
  const requestNew = useCallback(() => {
    if (isDirty) { setPendingDestructiveAction("new"); return; }
    handleNew();
  }, [isDirty, handleNew]);
  const requestOpen = useCallback(() => {
    if (isDirty) { setPendingDestructiveAction("load"); return; }
    setShowLoadDialog(true);
  }, [isDirty]);
  const confirmDestructiveAction = useCallback(() => {
    const action = pendingDestructiveAction;
    setPendingDestructiveAction(null);
    if (action === "new") handleNew();
    else if (action === "load") setShowLoadDialog(true);
  }, [pendingDestructiveAction, handleNew]);

  // ── Save & Leave: persist current project, then continue with the
  //    pending destructive action or pending navigation ───────────────
  // When the project has never been saved (no name yet), open the Save
  // dialog and remember which follow-up action to run after saving.
  const postSaveActionRef = useRef<null | "destructive" | "leave">(null);

  // Helper: open the Save dialog for a new project, pre-filling an auto-generated name.
  const openSaveDialogForNew = useCallback(() => {
    setProjectName(generateProjectName(projects.map((p) => p.name || "")));
    setProjectTeamId("none");
    setProjectCollab("org");
    setShowSaveDialog(true);
  }, [projects]);

  const saveAndConfirmDestructive = useCallback(async () => {
    if (!currentProject) {
      // Defer: route through the Save dialog so the user can name the project.
      postSaveActionRef.current = "destructive";
      setPendingDestructiveAction((prev) => prev);
      openSaveDialogForNew();
      return;
    }
    const ok = await handleSave();
    if (!ok) return;
    confirmDestructiveAction();
  }, [currentProject, handleSave, confirmDestructiveAction, openSaveDialogForNew]);

  const saveAndLeave = useCallback(async () => {
    if (!currentProject) {
      postSaveActionRef.current = "leave";
      openSaveDialogForNew();
      return;
    }
    const ok = await handleSave();
    if (!ok) return;
    // Navigate away now that the project is saved.
    confirmLeave();
  }, [currentProject, handleSave, confirmLeave, openSaveDialogForNew]);

  // Save dialog wrapper: persist, then run any pending follow-up action.
  const handleSaveFromDialog = useCallback(async () => {
    const ok = await handleSave(projectName);
    if (!ok) return;
    const next = postSaveActionRef.current;
    postSaveActionRef.current = null;
    if (next === "destructive") {
      confirmDestructiveAction();
    } else if (next === "leave") {
      confirmLeave();
    }
  }, [handleSave, projectName, confirmDestructiveAction, confirmLeave]);
  const requestPreview = useCallback(() => {
    // Require a saved (named & clean) project before previewing
    if (!currentProject || isDirty) { setShowPreviewSavePrompt(true); return; }
    setShowPreviewDialog(true);
  }, [currentProject, isDirty]);

  // Multi-select for merge (ctrl/shift+click). Primary zone stays in selectedZone;
  // extra zones live here. Reset whenever primary selection changes via single click.
  const [extraSelectedZoneIds, setExtraSelectedZoneIds] = useState<Set<string>>(new Set());
  // Floating zone toolbar collapsed state (persisted)
  const [zoneToolbarCollapsed, setZoneToolbarCollapsed] = useState<boolean>(() => {
    try { return localStorage.getItem("studio:zoneToolbarCollapsed") === "1"; } catch { return false; }
  });
  const toggleZoneToolbarCollapsed = useCallback(() => {
    setZoneToolbarCollapsed((prev) => {
      const next = !prev;
      try { localStorage.setItem("studio:zoneToolbarCollapsed", next ? "1" : "0"); } catch { /* ignore */ }
      return next;
    });
  }, []);

  const handlePinPreview = useCallback((trackId: string, itemIdx: number) => {
    setPinnedPreview({ trackId, itemIdx });
    if (pinnedTimerRef.current) clearTimeout(pinnedTimerRef.current);
    pinnedTimerRef.current = setTimeout(() => {
      setPinnedPreview(null);
      pinnedTimerRef.current = null;
    }, 30000);
  }, []);

  /**
   * handleQuickPublishClick — pre-flight validation before opening the Quick Publish dialog.
   *
   * Conditions that BLOCK publish (in priority order):
   *  1. No saved project → button is disabled; should never reach here
   *  2. isDirty          → project has unsaved changes
   *  3. zones.length===0 → no layout template applied yet
   *  4. empty zones      → at least one zone has no content (media type with 0 items, or no content at all)
   */
  const handleQuickPublishClick = useCallback(() => {
    if (!currentProject) return; // guarded by button disabled state

    if (isDirty) {
      setQpBlockReason("unsaved");
      return;
    }

    // Check current canvas (zones on the active page)
    if (zones.length === 0) {
      setQpBlockReason("no_zones");
      return;
    }

    const emptyZones = zones.filter((z) => {
      if (!z.content) return true; // no content object at all
      if (z.content.type === "media") {
        return !z.content.mediaItems || z.content.mediaItems.length === 0;
      }
      // "widget" / "text" / "color" zones are considered configured
      return false;
    });

    if (emptyZones.length > 0) {
      setQpBlockReason("empty_zones");
      return;
    }

    setQuickPublishOpen(true);
  }, [currentProject, isDirty, zones]);

  /**
   * handleSaveClick — pre-flight validation before saving.
   * Blocks save when the design is structurally incomplete:
   *  1. zones.length === 0  → no layout template applied yet
   *  2. Any media zone with 0 mediaItems → content not placed in every zone
   */
  const handleSaveClick = useCallback(() => {
    if (zones.length === 0) { setSaveBlockReason("no_zones"); return; }
    const emptyZones = zones.filter((z) => {
      if (!z.content) return true;
      if (z.content.type === "media") return !z.content.mediaItems || z.content.mediaItems.length === 0;
      return false;
    });
    if (emptyZones.length > 0) { setSaveBlockReason("empty_zones"); return; }
    if (currentProject) handleSave();
    else openSaveDialogForNew();
  }, [zones, currentProject, handleSave, openSaveDialogForNew]);

  // Layout panel manual collapse (persisted) — independent from auto-collapse on zone selection
  const [layoutPanelManuallyCollapsed, setLayoutPanelManuallyCollapsed] = useState<boolean>(() => {
    try { return localStorage.getItem("studio:layoutPanelManuallyCollapsed") === "1"; } catch { return false; }
  });
  const toggleLayoutPanelManualCollapse = useCallback(() => {
    // Read current collapsed state from ref (avoids stale closure; ref is kept in sync on every render).
    // If panel is currently hidden for ANY reason → expand it (single click to open).
    // If panel is visible → collapse it.
    if (layoutPanelCollapsedRef.current) {
      // Expand: clear manual-collapse, force layoutPanelOpen, close media (mutual exclusion)
      setLayoutPanelManuallyCollapsed(false);
      setLayoutPanelOpen(true);
      setMediaLibraryOpen(false);
      try { localStorage.setItem("studio:layoutPanelManuallyCollapsed", "0"); } catch { /* ignore */ }
    } else {
      // Collapse: set manual-collapse flag
      setLayoutPanelManuallyCollapsed(true);
      setLayoutPanelOpen(false);
      try { localStorage.setItem("studio:layoutPanelManuallyCollapsed", "1"); } catch { /* ignore */ }
    }
  }, []);


  // Generate sequential A, B, C… labels by reading order (top→bottom, left→right).
  const relabelZones = useCallback((list: Zone[]): Zone[] => {
    const sorted = [...list].sort((a, b) => (a.y - b.y) || (a.x - b.x));
    const labelOf = (i: number) => String.fromCharCode(65 + i);
    const map = new Map(sorted.map((z, i) => [z.id, labelOf(i)] as const));
    return list.map((z) => ({ ...z, label: map.get(z.id) || z.label }));
  }, []);

  // Select/deselect a zone with optional additive (Ctrl/Shift) behaviour.
  const handleZoneClick = useCallback((zoneId: string, additive: boolean) => {
    setSelectedOverlay(null);
    if (!additive) {
      setExtraSelectedZoneIds(new Set());
      setSelectedZone((prev) => {
        const next = prev === zoneId ? null : zoneId;
        if (next) {
          // 點擊版型區塊：收起左側版型選擇區、展開右側媒體素材庫
          setLayoutPanelOpen(false);
          setMediaLibraryOpen(true);
        }
        return next;
      });
      return;
    }
    if (!selectedZone) { setSelectedZone(zoneId); return; }
    if (zoneId === selectedZone) {
      const extras = Array.from(extraSelectedZoneIds);
      if (extras.length) {
        const [next, ...rest] = extras;
        setSelectedZone(next);
        setExtraSelectedZoneIds(new Set(rest));
      } else {
        setSelectedZone(null);
      }
      return;
    }
    setExtraSelectedZoneIds((prev) => {
      const next = new Set(prev);
      if (next.has(zoneId)) next.delete(zoneId); else next.add(zoneId);
      return next;
    });
  }, [selectedZone, extraSelectedZoneIds]);

  // ── Merge: combine selected zones (must form a perfect rectangle) ──────────
  const mergeSelectedZones = useCallback(() => {
    if (!selectedZone) return;
    const ids = new Set<string>([selectedZone, ...extraSelectedZoneIds]);
    if (ids.size < 2) {
      toast.info("請先用 Ctrl / Shift 點選至少兩個相鄰區塊");
      return;
    }
    const picks = zones.filter((z) => ids.has(z.id));
    const minX = Math.min(...picks.map((z) => z.x));
    const minY = Math.min(...picks.map((z) => z.y));
    const maxX = Math.max(...picks.map((z) => z.x + z.w));
    const maxY = Math.max(...picks.map((z) => z.y + z.h));
    const targetArea = (maxX - minX) * (maxY - minY);
    const sumArea = picks.reduce((s, z) => s + z.w * z.h, 0);
    if (Math.abs(sumArea - targetArea) > 0.5) {
      toast.error("選取的區塊必須能拼成一個完整矩形");
      return;
    }
    const primary = picks.find((z) => z.id === selectedZone)!;
    const merged: Zone = { ...primary, x: minX, y: minY, w: maxX - minX, h: maxY - minY };
    const next = relabelZones([merged, ...zones.filter((z) => !ids.has(z.id))]);
    setZones(next);
    setExtraSelectedZoneIds(new Set());
    setSelectedZone(merged.id);
    toast.success("已合併區塊");
  }, [selectedZone, extraSelectedZoneIds, zones, relabelZones]);

  // ── Merge towards a direction (single neighbour on that side) ──────────────
  const mergeDirection = useCallback((dir: "left" | "right" | "up" | "down") => {
    if (!selectedZone) return;
    const z = zones.find((zz) => zz.id === selectedZone);
    if (!z) return;
    const tol = 1;
    const overlaps = (aS: number, aSz: number, bS: number, bSz: number) => aS < bS + bSz && aS + aSz > bS;
    let neighbours: Zone[] = [];
    if (dir === "right") neighbours = zones.filter((n) => n.id !== z.id && Math.abs(n.x - (z.x + z.w)) <= tol && overlaps(z.y, z.h, n.y, n.h));
    if (dir === "left") neighbours = zones.filter((n) => n.id !== z.id && Math.abs(n.x + n.w - z.x) <= tol && overlaps(z.y, z.h, n.y, n.h));
    if (dir === "down") neighbours = zones.filter((n) => n.id !== z.id && Math.abs(n.y - (z.y + z.h)) <= tol && overlaps(z.x, z.w, n.x, n.w));
    if (dir === "up") neighbours = zones.filter((n) => n.id !== z.id && Math.abs(n.y + n.h - z.y) <= tol && overlaps(z.x, z.w, n.x, n.w));
    if (!neighbours.length) { toast.info("該方向沒有可合併的相鄰區塊"); return; }
    // pick the neighbour that, combined with z, forms a rectangle
    const candidate = neighbours.find((n) => {
      if (dir === "left" || dir === "right") return Math.abs(n.y - z.y) <= tol && Math.abs(n.h - z.h) <= tol;
      return Math.abs(n.x - z.x) <= tol && Math.abs(n.w - z.w) <= tol;
    });
    if (!candidate) { toast.error("該方向的相鄰區塊大小不一致，無法直接合併"); return; }
    const merged: Zone =
      dir === "right" ? { ...z, w: z.w + candidate.w } :
      dir === "left" ? { ...z, x: candidate.x, w: z.w + candidate.w } :
      dir === "down" ? { ...z, h: z.h + candidate.h } :
      { ...z, y: candidate.y, h: z.h + candidate.h };
    const next = relabelZones([merged, ...zones.filter((zz) => zz.id !== z.id && zz.id !== candidate.id)]);
    setZones(next);
    setExtraSelectedZoneIds(new Set());
    setSelectedZone(merged.id);
    toast.success("已合併區塊");
  }, [selectedZone, zones, relabelZones]);

  // ── Split: bisect the selected zone horizontally or vertically ─────────────
  const splitSelectedZone = useCallback((dir: "horizontal" | "vertical") => {
    if (!selectedZone) return;
    if (zones.length + overlays.length >= 8) {
      toast.error(`區塊總數不可超過 8 個`);
      return;
    }
    const z = zones.find((zz) => zz.id === selectedZone);
    if (!z) return;
    if (dir === "vertical" && z.w < 20) { toast.info("區塊太小，無法繼續分割"); return; }
    if (dir === "horizontal" && z.h < 20) { toast.info("區塊太小，無法繼續分割"); return; }
    const newId = `z-${Date.now().toString(36)}`;
    const split: Zone[] = dir === "vertical"
      ? [
          { ...z, w: z.w / 2 },
          { id: newId, x: z.x + z.w / 2, y: z.y, w: z.w / 2, h: z.h, label: "" },
        ]
      : [
          { ...z, h: z.h / 2 },
          { id: newId, x: z.x, y: z.y + z.h / 2, w: z.w, h: z.h / 2, label: "" },
        ];
    const next = relabelZones([...zones.filter((zz) => zz.id !== z.id), ...split]);
    setZones(next);
    setExtraSelectedZoneIds(new Set());
    setSelectedZone(z.id);
    toast.success("已分割區塊");
  }, [selectedZone, zones, overlays.length, relabelZones]);


  // Resize logic
  const canvasRef = useRef<HTMLDivElement>(null);
  const [resizing, setResizing] = useState<{ zoneId: string; edge: "right" | "bottom"; startPos: number; startVal: number } | null>(null);

  const getAdjacentZones = useCallback((zone: Zone, edge: "right" | "bottom", allZones: Zone[]) => {
    if (edge === "right") { const re = zone.x + zone.w; return allZones.filter((z) => z.id !== zone.id && Math.abs(z.x - re) < 1 && z.y < zone.y + zone.h && z.y + z.h > zone.y); }
    const be = zone.y + zone.h; return allZones.filter((z) => z.id !== zone.id && Math.abs(z.y - be) < 1 && z.x < zone.x + zone.w && z.x + z.w > zone.x);
  }, []);

  const hasResizeHandle = useCallback((zone: Zone, edge: "right" | "bottom", allZones: Zone[]) => getAdjacentZones(zone, edge, allZones).length > 0, [getAdjacentZones]);

  const handleResizeStart = useCallback((e: React.MouseEvent, zoneId: string, edge: "right" | "bottom") => {
    e.stopPropagation(); e.preventDefault();
    const startPos = edge === "right" ? e.clientX : e.clientY;
    const zone = zones.find((z) => z.id === zoneId); if (!zone) return;
    const startVal = edge === "right" ? zone.w : zone.h;
    const canvasRect = canvasRef.current?.getBoundingClientRect(); if (!canvasRect) return;
    const canvasSize = edge === "right" ? canvasRect.width : canvasRect.height;
    const dividerPos = edge === "right" ? zone.x + zone.w : zone.y + zone.h;
    const tolerance = 1.5;
    const overlaps = (aStart: number, aSize: number, bStart: number, bSize: number) => aStart < bStart + bSize && aStart + aSize > bStart;

    // Resize the whole divider group, not just the clicked block, so sibling blocks
    // on the same row/column stay aligned (e.g. A/B top row above C).
    const sourceZones = zones.filter((z) => {
      if (edge === "right") return Math.abs(z.x + z.w - dividerPos) <= tolerance;
      return Math.abs(z.y + z.h - dividerPos) <= tolerance;
    });

    const adjacentZones = zones.filter((z) => {
      if (sourceZones.some((s) => s.id === z.id)) return false;
      if (edge === "right") {
        return Math.abs(z.x - dividerPos) <= tolerance && sourceZones.some((s) => overlaps(s.y, s.h, z.y, z.h));
      }
      return Math.abs(z.y - dividerPos) <= tolerance && sourceZones.some((s) => overlaps(s.x, s.w, z.x, z.w));
    });

    if (!adjacentZones.length) return;

    const sourceIds = new Set(sourceZones.map((z) => z.id));
    const adjacentIds = new Set(adjacentZones.map((z) => z.id));
    const initialMap = new Map<string, { x: number; y: number; w: number; h: number }>();
    [...sourceZones, ...adjacentZones].forEach((z) => initialMap.set(z.id, { x: z.x, y: z.y, w: z.w, h: z.h }));

    const minDiff = Math.max(...sourceZones.map((z) => 10 - (edge === "right" ? z.w : z.h)));
    const maxDiff = Math.min(...adjacentZones.map((z) => (edge === "right" ? z.w : z.h) - 10));

    setResizing({ zoneId, edge, startPos, startVal });

    const onMove = (ev: MouseEvent) => {
      const delta = edge === "right" ? ev.clientX - startPos : ev.clientY - startPos;
      const deltaPercent = (delta / canvasSize) * 100;
      const diff = Math.max(minDiff, Math.min(maxDiff, deltaPercent));

      setZones((prev) => prev.map((z) => {
        const init = initialMap.get(z.id);
        if (!init) return z;

        if (sourceIds.has(z.id)) {
          return edge === "right"
            ? { ...z, w: init.w + diff }
            : { ...z, h: init.h + diff };
        }

        if (adjacentIds.has(z.id)) {
          return edge === "right"
            ? { ...z, x: init.x + diff, w: init.w - diff }
            : { ...z, y: init.y + diff, h: init.h - diff };
        }

        return z;
      }));
    };

    const onUp = () => {
      setResizing(null);
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }, [zones]);

  // Overlay drag logic
  const handleOverlayDragStart = useCallback((e: React.MouseEvent, overlayId: string) => {
    e.stopPropagation(); e.preventDefault();
    const overlay = overlays.find((o) => o.id === overlayId);
    if (!overlay) return;
    const startX = e.clientX, startY = e.clientY;
    const origX = overlay.x, origY = overlay.y;
    const canvasRect = canvasRef.current?.getBoundingClientRect();
    if (!canvasRect) return;

    const onMove = (ev: MouseEvent) => {
      const dx = ev.clientX - startX;
      const dy = ev.clientY - startY;
      const newX = Math.max(0, Math.min(canvasRect.width - overlay.w, origX + dx));
      const newY = Math.max(0, Math.min(canvasRect.height - overlay.h, origY + dy));
      setOverlays((prev) => prev.map((o) => o.id === overlayId ? { ...o, x: newX, y: newY } : o));
    };
    const onUp = () => { window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); };
    window.addEventListener("mousemove", onMove); window.addEventListener("mouseup", onUp);
  }, [overlays]);

  // Overlay resize logic
  const handleOverlayResizeStart = useCallback((e: React.MouseEvent, overlayId: string, corner: string) => {
    e.stopPropagation(); e.preventDefault();
    const overlay = overlays.find((o) => o.id === overlayId);
    if (!overlay) return;
    const startX = e.clientX, startY = e.clientY;
    const origW = overlay.w, origH = overlay.h;
    const canvasRect = canvasRef.current?.getBoundingClientRect();
    if (!canvasRect) return;

    const onMove = (ev: MouseEvent) => {
      const dx = ev.clientX - startX;
      const dy = ev.clientY - startY;
      const newW = Math.max(60, Math.min(canvasRect.width - overlay.x, origW + dx));
      const newH = Math.max(40, Math.min(canvasRect.height - overlay.y, origH + dy));
      setOverlays((prev) => prev.map((o) => o.id === overlayId ? { ...o, w: newW, h: newH } : o));
    };
    const onUp = () => { window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); };
    window.addEventListener("mousemove", onMove); window.addEventListener("mouseup", onUp);
  }, [overlays]);

  const activeZone = zones.find((z) => z.id === selectedZone);
  const activeOverlay = overlays.find((o) => o.id === selectedOverlay);
  const canEdit = !isMobile || mobileEditMode;
  // Working project name: saved name takes priority over the draft name in the save-dialog input
  const workingProjectName = currentProject?.name || projectName;
  const layoutPanelCollapsed = !isMobile && (layoutPanelManuallyCollapsed || ((!!activeZone || !!activeOverlay) && !layoutPanelOpen));
  // Keep ref in sync so callbacks defined earlier can read current value without stale closures
  layoutPanelCollapsedRef.current = layoutPanelCollapsed;
  const existingVideoZoneLabel = (() => {
    if (activeZone) {
      return (
        zones.find((z) => z.id !== activeZone.id && z.content?.mediaItems?.some((m) => m.type === "video"))?.label ??
        overlays.find((o) => o.content?.mediaItems?.some((m) => m.type === "video"))?.label ??
        null
      );
    }
    if (activeOverlay) {
      return (
        zones.find((z) => z.content?.mediaItems?.some((m) => m.type === "video"))?.label ??
        overlays.find((o) => o.id !== activeOverlay.id && o.content?.mediaItems?.some((m) => m.type === "video"))?.label ??
        null
      );
    }
    return null;
  })();
  return (
    <div className="flex flex-col h-[calc(100vh-4rem)] max-h-[calc(100vh-4rem)] overflow-hidden">
      {/* Header — desktop & tablet */}
      {!isMobile && (
      <div className="flex items-center justify-between px-1 pb-3 shrink-0">
        <div className="flex items-center gap-3">
          <div>
            <h1 className="text-2xl font-bold text-foreground">{t("studioTitle")}</h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              {currentProject ? currentProject.name : t("studioSubtitle")}
              {currentProject && <Badge variant="secondary" className="ml-2 text-[10px]">{t("studioEditing")}</Badge>}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {/* Project actions */}
          <Button variant="outline" size="sm" className="gap-1.5 text-xs h-8" onClick={requestNew}><FilePlus className="w-3.5 h-3.5" /> {t("studioNew")}</Button>
          <Button variant="outline" size="sm" className="gap-1.5 text-xs h-8" onClick={requestOpen}><FolderOpen className="w-3.5 h-3.5" /> {t("studioOpen")}</Button>
          <Button variant="outline" size="sm" className="gap-1.5 text-xs h-8" onClick={requestPreview}><Eye className="w-3.5 h-3.5" /> {t("studioPreview")}</Button>
          <Button variant="default" size="sm" className="gap-1.5 text-xs h-8" onClick={handleSaveClick} disabled={saving}>
            <Save className="w-3.5 h-3.5" /> {t("save")}
          </Button>
          <Button
            variant="default"
            size="sm"
            className="gap-1.5 text-xs h-8 bg-gradient-to-r from-orange-500 to-rose-500 hover:from-orange-600 hover:to-rose-600 text-white border-0 shadow-md shadow-orange-500/30"
            onClick={handleQuickPublishClick}
            disabled={!currentProject}
            title={!currentProject ? t("qpNeedProject") : t("studioQuickPublish")}
          >
            <Rocket className="w-3.5 h-3.5" /> {t("studioQuickPublish")}
          </Button>
          {currentProject && (
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5 text-xs h-8"
              onClick={() => { setProjectName(currentProject.name || ""); setShowSaveDialog(true); }}
              title={t("studioEditProjectSettings")}
            >
              <Settings2 className="w-3.5 h-3.5" /> {t("studioProjectSettings")}
            </Button>
          )}
          <div className="w-px h-6 bg-border mx-1" />
          {/* Aspect toggle */}
          <div className="flex items-center gap-1 bg-muted rounded-lg p-1">
            <Button variant={aspect === "16:9" ? "default" : "ghost"} size="sm" className="gap-1.5 text-xs h-7" onClick={() => changeAspect("16:9")}>
              <Monitor className="w-3.5 h-3.5" /> {t("studioLandscape")}
            </Button>
            <Button variant={aspect === "9:16" ? "default" : "ghost"} size="sm" className="gap-1.5 text-xs h-7" onClick={() => changeAspect("9:16")}>
              <Smartphone className="w-3.5 h-3.5" /> {t("studioPortrait")}
            </Button>
          </div>
          {/* Resolution selector */}
          <Select
            value={
              RESOLUTION_PRESETS[aspect].some((r) => r.id === resolution.id && r.width === resolution.width && r.height === resolution.height)
                ? resolution.id
                : "custom"
            }
            onValueChange={handleSelectResolution}
          >
            <SelectTrigger className="h-8 w-auto min-w-[150px] text-xs gap-1.5" title={t("studioResolution")}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {RESOLUTION_PRESETS[aspect].map((r) => (
                <SelectItem key={r.id} value={r.id} className="text-xs">
                  <span className="font-medium">{t(r.labelKey as TranslationKey)}</span>
                  <span className="text-muted-foreground ml-2">{r.width}×{r.height}</span>
                </SelectItem>
              ))}
              {lastCustomRes && (
                <>
                  <div className="my-1 h-px bg-border" />
                  <div className="px-2 py-1 text-[10px] uppercase tracking-wide text-muted-foreground">上次自訂</div>
                  <SelectItem value="__last_custom__" className="text-xs">
                    <span className="font-medium">上次自訂</span>
                    <span className="text-muted-foreground ml-2">
                      {lastCustomRes.w}×{lastCustomRes.h}
                      {lastCustomRes.applyGrid ? ` · ${lastCustomRes.rows}×${lastCustomRes.cols}` : ""}
                    </span>
                  </SelectItem>
                </>
              )}
              {myPresets.length > 0 && (
                <>
                  <div className="my-1 h-px bg-border" />
                  <div className="px-2 py-1 text-[10px] uppercase tracking-wide text-muted-foreground">我的預設</div>
                  {myPresets.map((p) => (
                    <div key={p.id} className="relative group">
                      <SelectItem value={`__preset__:${p.id}`} className="text-xs pr-8">
                        <span className="font-medium truncate max-w-[120px] inline-block align-middle">{p.name}</span>
                        <span className="text-muted-foreground ml-2">
                          {p.w}×{p.h}
                          {p.applyGrid ? ` · ${p.rows}×${p.cols}` : ""}
                        </span>
                      </SelectItem>
                      <button
                        type="button"
                        className="absolute right-1.5 top-1/2 -translate-y-1/2 p-1 rounded hover:bg-destructive/15 text-muted-foreground hover:text-destructive opacity-60 hover:opacity-100"
                        onPointerDown={(e) => { e.preventDefault(); e.stopPropagation(); deleteMyPreset(p.id); }}
                        title="刪除此預設"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </div>
                  ))}
                </>
              )}
              <div className="my-1 h-px bg-border" />
              <SelectItem
                value="custom"
                className="text-xs"
                onPointerDown={(e) => {
                  // Always reopen custom dialog, even when value is already "custom"
                  e.preventDefault();
                  if (resolution.id === "custom") {
                    setCustomResW(String(resolution.width));
                    setCustomResH(String(resolution.height));
                  } else {
                    const stored = loadStoredCustomRes();
                    if (stored) {
                      setCustomResW(stored.w); setCustomResH(stored.h);
                      setCustomResRows(stored.rows); setCustomResCols(stored.cols);
                      setCustomResApplyGrid(stored.applyGrid);
                    }
                  }
                  setShowCustomResDialog(true);
                  // close the select
                  (document.activeElement as HTMLElement | null)?.blur?.();
                }}
              >
                <span className="font-medium">{t("studioResCustom")}</span>
                {resolution.id === "custom" && (
                  <span className="text-muted-foreground ml-2">{resolution.width}×{resolution.height}</span>
                )}
                <Edit3 className="w-3 h-3 ml-2 inline-block text-muted-foreground" />
              </SelectItem>
            </SelectContent>
          </Select>
          <div className="w-px h-6 bg-border mx-1" />
          {(() => {
            const total = zones.length + overlays.length;
            const atLimit = total >= 8;
            return (
              <>
                <span
                  className={`text-[11px] font-medium tabular-nums px-2 py-0.5 rounded-md border ${atLimit ? "text-destructive border-destructive/40 bg-destructive/10" : "text-muted-foreground border-border bg-muted/40"}`}
                  title={t("studioZoneTotalLimitTip").replace("{max}", "8")}
                >
                  {t("studioZoneTotalCount").replace("{current}", String(total)).replace("{max}", "8")}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-1.5 text-xs h-8"
                  onClick={addOverlay}
                  disabled={atLimit}
                  title={atLimit ? "已達區塊總數上限 (8)" : undefined}
                >
                  <Layers className="w-3.5 h-3.5" /> {t("studioAddOverlay")}
                </Button>
              </>
            );
          })()}
        </div>
      </div>
      )}

      {/* Header — mobile */}
      {isMobile && (
        <div className="flex flex-col gap-1.5 px-1 pb-2 shrink-0">
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0 flex-1">
              <h1 className="text-base font-bold text-foreground truncate">{currentProject?.name || t("studioTitle")}</h1>
              <div className="flex items-center gap-1.5 mt-0.5">
                <Badge variant={mobileEditMode ? "default" : "secondary"} className="text-[9px] px-1.5 py-0 gap-0.5">
                  {mobileEditMode ? <><Edit3 className="w-2.5 h-2.5" /> {t("studioMobileEditing")}</> : <><Eye className="w-2.5 h-2.5" /> {t("studioMobileReadOnly")}</>}
                </Badge>
                <span className="text-[10px] text-muted-foreground">{aspect} · {resolution.width}×{resolution.height}</span>
              </div>
            </div>
            <Button variant="outline" size="icon" className="h-9 w-9 shrink-0" onClick={() => { setSidebarTab("my"); setMobilePanelOpen(true); }} title={t("studioMobilePanels")}>
              <PanelLeft className="w-4 h-4" />
            </Button>
            <Button variant="outline" size="icon" className="h-9 w-9 shrink-0" onClick={() => setMobileToolsOpen(true)} title={t("studioMobileTools")}>
              <MoreHorizontal className="w-4 h-4" />
            </Button>
            <Button
              variant={mobileEditMode ? "default" : "outline"}
              size="icon"
              className="h-9 w-9 shrink-0"
              onClick={() => { setMobileEditMode((v) => !v); setSelectedZone(null); setSelectedOverlay(null); }}
              title={mobileEditMode ? t("studioMobileExitEdit") : t("studioMobileEnterEdit")}
            >
              {mobileEditMode ? <Eye className="w-4 h-4" /> : <Edit3 className="w-4 h-4" />}
            </Button>
          </div>
          {/* Second row: media library / timeline shortcut buttons (edit mode only) */}
          {mobileEditMode && (
            <div className="grid grid-cols-2 gap-1.5">
              <Button
                variant="outline"
                size="sm"
                className="h-8 text-xs gap-1.5"
                onClick={() => { setMobileTimelineOpen(false); setMobileMediaOpen(true); }}
              >
                <ImageIcon className="w-3.5 h-3.5" /> {t("studioMobileMedia")}
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="h-8 text-xs gap-1.5"
                onClick={() => { setMobileMediaOpen(false); setMobileTimelineOpen(true); }}
              >
                <Layers className="w-3.5 h-3.5" /> {t("studioMobileTimeline")}
              </Button>
            </div>
          )}
        </div>
      )}

      {/* Save-to-Scene dialog */}
      <Dialog open={saveToSceneDialogOpen} onOpenChange={(o) => { if (!o) setSaveToSceneDialogOpen(false); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{t("studioSaveToScene")}</DialogTitle>
          </DialogHeader>
          <div>
            <label className="text-xs text-muted-foreground mb-1.5 block">{t("studioSaveToSceneName")}</label>
            <Input
              key={saveToSceneFlashKey}
              value={saveToSceneDialogName}
              onChange={(e) => setSaveToSceneDialogName(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") commitSaveToScene(); }}
              autoFocus
              className={saveToSceneFlashKey > 0 ? "animate-[field-error-flash_0.5s_ease-in-out] border-destructive" : ""}
            />
            {saveToSceneFlashKey > 0 && (
              <p className="text-xs text-destructive mt-1.5">{t("studioSceneNameDuplicate")}</p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSaveToSceneDialogOpen(false)}>{t("cancel")}</Button>
            <Button onClick={commitSaveToScene} disabled={!saveToSceneDialogName.trim()}>{t("studioSaveToScene")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Custom resolution dialog */}
      <Dialog open={showCustomResDialog} onOpenChange={setShowCustomResDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{t("studioResCustom")}</DialogTitle>
            <DialogDescription>{t("studioCustomResDesc")}</DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">{t("studioResWidth")} (px)</label>
              <Input type="number" min={16} max={16384} value={customResW} onChange={(e) => setCustomResW(e.target.value)} />
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">{t("studioResHeight")} (px)</label>
              <Input type="number" min={16} max={16384} value={customResH} onChange={(e) => setCustomResH(e.target.value)} />
            </div>
          </div>
          {(() => {
            const w = parseInt(customResW, 10);
            const h = parseInt(customResH, 10);
            if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return null;
            const g = gcd(w, h);
            const orientation = w >= h ? t("studioLandscape") : t("studioPortrait");
            return (
              <p className="text-[11px] text-muted-foreground">
                {t("studioResRatio")}: <span className="font-medium text-foreground">{w / g}:{h / g}</span> · {orientation}
              </p>
            );
          })()}

          {/* Grid split section */}
          <div className="border-t border-border pt-3 mt-1 space-y-2.5">
            <div className="flex items-center justify-between">
              <div>
                <label className="text-xs font-medium text-foreground block">分割區域</label>
                <p className="text-[10px] text-muted-foreground mt-0.5">依行×列自動將畫布分割為等大區塊</p>
              </div>
              <Switch checked={customResApplyGrid} onCheckedChange={setCustomResApplyGrid} />
            </div>
            {customResApplyGrid && (
              <>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-[11px] text-muted-foreground mb-1 block">行（橫向）</label>
                    <Input type="number" min={1} max={10} value={customResRows} onChange={(e) => setCustomResRows(e.target.value)} />
                  </div>
                  <div>
                    <label className="text-[11px] text-muted-foreground mb-1 block">列（直向）</label>
                    <Input type="number" min={1} max={10} value={customResCols} onChange={(e) => setCustomResCols(e.target.value)} />
                  </div>
                </div>
                {(() => {
                  const w = parseInt(customResW, 10);
                  const h = parseInt(customResH, 10);
                  const rows = Math.max(1, Math.min(10, parseInt(customResRows, 10) || 1));
                  const cols = Math.max(1, Math.min(10, parseInt(customResCols, 10) || 1));
                  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return null;
                  const previewZones: { id: string; x: number; y: number; w: number; h: number; label: string }[] = [];
                  let idx = 0;
                  for (let r = 0; r < rows; r++) {
                    for (let c = 0; c < cols; c++) {
                      previewZones.push({
                        id: `pv-${r}-${c}`,
                        x: (c * 100) / cols,
                        y: (r * 100) / rows,
                        w: 100 / cols,
                        h: 100 / rows,
                        label: String.fromCharCode(65 + idx),
                      });
                      idx++;
                    }
                  }
                  const ratio = w / h;
                  const previewH = 120;
                  const previewW = Math.min(360, previewH * ratio);
                  return (
                    <div className="flex flex-col items-center gap-1.5 pt-1">
                      <span className="text-[10px] text-muted-foreground">預覽 · {rows}×{cols} = {rows * cols} 區塊</span>
                      <div className="rounded-md border border-border bg-muted/30 overflow-hidden" style={{ width: previewW, height: previewH }}>
                        <LayoutThumb zones={previewZones} aspect={ratio >= 1 ? "16:9" : "9:16"} />
                      </div>
                    </div>
                  );
                })()}
                <p className="text-[10px] text-muted-foreground">⚠ 套用後將覆蓋目前畫布的版型分區</p>
              </>
            )}
          </div>

          {/* Save as my preset */}
          <div className="border-t border-border pt-3 mt-1 space-y-1.5">
            <label className="text-xs font-medium text-foreground block">儲存為「我的預設」</label>
            <p className="text-[10px] text-muted-foreground">將目前解析度{customResApplyGrid ? "與分割" : ""}設定命名儲存，下次可從解析度下拉直接叫用</p>
            <div className="flex items-center gap-2">
              <Input
                placeholder="預設名稱（例：店面主螢幕）"
                value={presetSaveName}
                onChange={(e) => setPresetSaveName(e.target.value)}
                className="h-8 text-xs flex-1"
                maxLength={40}
              />
              <Button size="sm" variant="outline" className="h-8 text-xs gap-1" onClick={saveCurrentAsPreset} disabled={!presetSaveName.trim()}>
                <Plus className="w-3 h-3" /> 儲存
              </Button>
            </div>
            {myPresets.length > 0 && (
              <div className="pt-1.5">
                <p className="text-[10px] text-muted-foreground mb-1">已儲存 {myPresets.length} / 20</p>
                <div className="flex flex-wrap gap-1.5 max-h-24 overflow-y-auto">
                  {myPresets.map((p) => (
                    <span key={p.id} className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded border border-border bg-muted/40">
                      <span className="font-medium text-foreground">{p.name}</span>
                      <span className="text-muted-foreground">{p.w}×{p.h}{p.applyGrid ? ` ${p.rows}×${p.cols}` : ""}</span>
                      <button type="button" onClick={() => deleteMyPreset(p.id)} className="ml-0.5 text-muted-foreground hover:text-destructive" title="刪除">
                        <X className="w-2.5 h-2.5" />
                      </button>
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCustomResDialog(false)}>{t("cancel")}</Button>
            <Button onClick={submitCustomResolution}>{t("studioConfirm")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Body */}
      <div className="flex flex-1 min-h-0">
        {/* Left sidebar (hidden on mobile — accessed via bottom Sheet) */}
        <div className={`${layoutPanelCollapsed ? "w-0" : "w-64"} shrink-0 hidden md:flex flex-col min-h-0 overflow-hidden transition-[width] duration-500 ease-[cubic-bezier(0.22,1,0.36,1)]`}>
          <Tabs value={sidebarTab} onValueChange={setSidebarTab} className="flex flex-col min-h-0 h-full">
            <div className="flex items-center gap-1.5 shrink-0">
              <TabsList className="w-full min-w-0">
                <TabsTrigger value="new" className="flex-1 text-xs">{t("studioNewProject")}</TabsTrigger>
                <TabsTrigger value="my" className="flex-1 text-xs">{t("studioMyProject")}</TabsTrigger>
              </TabsList>
            </div>

            {/* New Project: Layout + Scene inner tabs */}
            <TabsContent value="new" className="flex-1 flex flex-col min-h-0 mt-2 data-[state=inactive]:hidden">
              <Tabs value={innerSidebarTab} onValueChange={setInnerSidebarTab} className="flex flex-col flex-1 min-h-0">
                <TabsList className="w-full shrink-0">
                  <TabsTrigger value="layouts" className="flex-1 text-xs">{t("studioLayouts")}</TabsTrigger>
                  <TabsTrigger value="scene" className="flex-1 text-xs">{t("studioScene")}</TabsTrigger>
                </TabsList>
                <TabsContent value="layouts" className="flex-1 overflow-y-auto mt-3 pr-1">
                  {(() => {
                    const filtered = studioSources.layouts
                      .filter((lp) => !lp.aspect || lp.aspect === aspect)
                      .slice()
                      .sort((a, b) => a.zones.length - b.zones.length);
                    if (filtered.length === 0) {
                      return <p className="text-xs text-muted-foreground text-center py-6">{t("studioNoLayouts")}</p>;
                    }
                    return (
                      <>
                        <p className="text-[10px] text-muted-foreground mb-2 px-1">
                          {t("studioLayoutsForAspect")} <span className="font-medium text-foreground">{aspect}</span> · {filtered.length}
                        </p>
                        <div className={`grid gap-2 ${aspect === "9:16" ? "grid-cols-3" : "grid-cols-2"}`}>
                          {filtered.map((lp) => (
                            <button
                              key={lp.id}
                              onClick={() => applyLayout(lp)}
                              title={t(lp.nameKey as TranslationKey)}
                              className="flex flex-col gap-1.5 p-2 rounded-lg border border-border bg-card hover:bg-accent hover:border-primary/50 transition-colors text-left group"
                            >
                              <div className={`w-full rounded-md overflow-hidden bg-muted ring-1 ring-border group-hover:ring-primary/40 transition-all ${aspect === "9:16" ? "aspect-[9/16]" : "aspect-video"}`}>
                                <LayoutThumb zones={lp.zones} aspect={aspect} />
                              </div>
                              <div className="flex items-center justify-between gap-1">
                                <p className="text-[11px] font-medium text-foreground truncate">{t(lp.nameKey as TranslationKey)}</p>
                                <Badge variant="secondary" className="text-[9px] px-1 py-0 shrink-0">{lp.zones.length}</Badge>
                              </div>
                            </button>
                          ))}
                        </div>
                      </>
                    );
                  })()}
                </TabsContent>
                <TabsContent value="scene" className="flex-1 overflow-y-auto mt-3 pr-1">
                  {studioSources.templates.length === 0 ? (
                    <p className="text-xs text-muted-foreground text-center py-8">{t("studioNoProjects")}</p>
                  ) : (
                    <div className={`grid gap-2 ${aspect === "9:16" ? "grid-cols-3" : "grid-cols-2"}`}>
                      {studioSources.templates.map((tpl) => (
                        <div key={tpl.id} className="relative group">
                          <button
                            onClick={() => applyTemplate(tpl)}
                            className="w-full flex flex-col gap-1.5 p-2 rounded-lg border border-border bg-card hover:bg-accent hover:border-primary/50 transition-colors text-left"
                          >
                            <div className={`w-full rounded-md overflow-hidden bg-muted ring-1 ring-border group-hover:ring-primary/40 transition-all ${tpl.aspect === "9:16" ? "aspect-[9/16]" : "aspect-video"}`}>
                              <SceneThumb zones={tpl.zones} />
                            </div>
                            <div className="flex items-center justify-between gap-1">
                              <p className="text-[11px] font-medium text-foreground truncate">{t(tpl.nameKey as TranslationKey)}</p>
                              <Badge variant="secondary" className="text-[9px] px-1 py-0 shrink-0">{tpl.zones.length}</Badge>
                            </div>
                          </button>
                          {tpl.id.startsWith("user-scene-") && (
                            <Popover>
                              <PopoverTrigger asChild>
                                <button
                                  type="button"
                                  className="absolute top-3 right-3 w-5 h-5 inline-flex items-center justify-center rounded bg-background/80 border border-border opacity-0 group-hover:opacity-100 transition-opacity hover:bg-accent"
                                  onClick={(e) => e.stopPropagation()}
                                  aria-label="Edit"
                                >
                                  <Edit3 className="w-3 h-3" />
                                </button>
                              </PopoverTrigger>
                              <PopoverContent side="bottom" align="start" className="w-40 p-1">
                                <button
                                  type="button"
                                  className="w-full flex items-center gap-2 px-2 py-1.5 text-xs rounded hover:bg-accent transition-colors text-left"
                                  onClick={() => {
                                    const input = window.prompt(t("studioRenameScene"), t(tpl.nameKey as TranslationKey));
                                    if (!input?.trim()) return;
                                    renameUserScene(tpl.id, input.trim());
                                    setScenesVersion((v) => v + 1);
                                  }}
                                >
                                  <Edit3 className="w-3 h-3 shrink-0" /> {t("studioRenameScene")}
                                </button>
                                <button
                                  type="button"
                                  className="w-full flex items-center gap-2 px-2 py-1.5 text-xs rounded hover:bg-accent transition-colors text-left"
                                  onClick={() => handleExportScene(tpl)}
                                >
                                  <Download className="w-3 h-3 shrink-0" /> {t("studioDownloadScene")}
                                </button>
                                <button
                                  type="button"
                                  className="w-full flex items-center gap-2 px-2 py-1.5 text-xs rounded hover:bg-destructive/10 hover:text-destructive transition-colors text-left"
                                  onClick={() => setSceneDeleteConfirm({ id: tpl.id, name: t(tpl.nameKey as TranslationKey) || tpl.nameKey })}
                                >
                                  <Trash2 className="w-3 h-3 shrink-0 text-destructive" /> {t("studioDeleteScene")}
                                </button>
                              </PopoverContent>
                            </Popover>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </TabsContent>
              </Tabs>
            </TabsContent>

            {/* My Project: project list + Import */}
            <TabsContent value="my" className="flex-1 flex flex-col min-h-0 mt-2 data-[state=inactive]:hidden">
              <div className="shrink-0 mb-2">
                <Button variant="outline" size="sm" className="w-full gap-1.5 text-xs" onClick={() => importInputRef.current?.click()}>
                  <Upload className="w-3.5 h-3.5" /> {t("studioImportProject")}
                </Button>
              </div>
              <div className="flex-1 overflow-y-auto space-y-2 pr-1">
                {projects.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground">
                    <FolderOpen className="w-8 h-8 mx-auto mb-2 opacity-40" />
                    <p className="text-xs">{t("studioNoProjects")}</p>
                  </div>
                ) : projects.map((p) => {
                  const resBadge = getProjectResolutionBadge(p.zones);
                  const teamName = p.team_id
                    ? (() => { const tm = teams.find((tt) => tt.id === p.team_id); return tm ? (tm.name === "Default" ? t("teamNoTeamLabel") : tm.name) : t("teamNoTeamLabel"); })()
                    : t("teamNoTeamLabel");
                  const collab = (p.collab_scope as "creator" | "team" | "org" | null | undefined) || "creator";
                  const collabLabel = collab === "org" ? t("studioCollabOrg") : collab === "team" ? t("studioCollabTeam") : t("studioCollabCreator");
                  const CollabIcon = collab === "org" ? Building2 : collab === "team" ? Users : UserIcon;
                  const creatorName = getDisplayName(p.created_by ?? null, "—");
                  void profilesVersion;
                  return (
                  <div key={p.id} className={`flex items-center gap-3 p-3 rounded-lg border bg-card hover:bg-accent transition-colors group ${currentProject?.id === p.id ? "border-primary" : "border-border"}`}>
                    <button className="flex-1 text-left min-w-0" onClick={() => handleLoad(p)}>
                      <p className="text-sm font-medium text-foreground truncate">{p.name}</p>
                      <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                        <Badge variant="secondary" className="text-[10px] px-1.5 py-0">{p.aspect === "9:16" ? t("aspectPortrait") : t("aspectLandscape")}</Badge>
                        {resBadge && (
                          <Badge
                            variant="outline"
                            className="text-[10px] px-1.5 py-0 border-primary/40 text-primary"
                            title={resBadge.dims}
                          >
                            {resBadge.label}
                          </Badge>
                        )}
                        <Badge variant="outline" className="text-[10px] px-1.5 py-0 inline-flex items-center gap-1">
                          <Users className="w-2.5 h-2.5" />{teamName}
                        </Badge>
                        <Badge variant="outline" className="text-[10px] px-1.5 py-0 inline-flex items-center gap-1">
                          <CollabIcon className="w-2.5 h-2.5" />{collabLabel}
                        </Badge>
                        <span className="text-[11px] text-muted-foreground">{new Date(p.updated_at).toLocaleDateString()}</span>
                      </div>
                      <p className="text-[11px] text-muted-foreground mt-0.5 truncate">
                        <UserIcon className="w-2.5 h-2.5 inline mr-1" />{t("studioCreator")}: {creatorName}
                      </p>
                    </button>
                    <Button variant="ghost" size="icon" className="h-7 w-7 opacity-0 group-hover:opacity-100 transition-opacity shrink-0" onClick={() => handleExport(p)} title={t("studioExportProject")}>
                      <Download className="w-3.5 h-3.5" />
                    </Button>
                    <Button variant="ghost" size="icon" className="h-7 w-7 opacity-0 group-hover:opacity-100 transition-opacity shrink-0" onClick={() => handleDelete(p.id)}>
                      <Trash2 className="w-3.5 h-3.5 text-destructive" />
                    </Button>
                  </div>
                  );
                })}
              </div>
            </TabsContent>
          </Tabs>
        </div>

        {/* Left panel toggle tab — pinned near scrollbar start */}
        <div className="hidden md:flex shrink-0 w-6 items-start pt-[72px] justify-center">
          <button
            type="button"
            onClick={toggleLayoutPanelManualCollapse}
            title={layoutPanelCollapsed ? t("studioRailExpandLayouts") : t("studioRailCollapseLayouts")}
            aria-label={layoutPanelCollapsed ? t("studioRailExpandLayouts") : t("studioRailCollapseLayouts")}
            aria-expanded={!layoutPanelCollapsed}
            className="group relative h-24 w-6 rounded-r-xl border border-l-0 border-primary/30 bg-gradient-to-b from-primary/10 via-card/90 to-card/80 backdrop-blur-sm shadow-md flex flex-col items-center justify-center gap-1.5 transition-all duration-200 text-primary/60 hover:border-primary/60 hover:from-primary/20 hover:to-primary/10 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60 overflow-hidden"
          >
            {/* Top accent stripe */}
            <div className="pointer-events-none absolute top-0 left-0 right-0 h-[3px] rounded-tr-xl bg-gradient-to-r from-primary/80 to-primary/30" />
            <PanelLeft className="w-3 h-3 shrink-0" />
            <ChevronRight className={`w-3 h-3 shrink-0 transition-transform duration-300 ${layoutPanelCollapsed ? "" : "rotate-180"}`} />
          </button>
        </div>

        {/* Canvas + Dock + Right Editor Panel */}
        <div className="flex-1 flex gap-3 min-h-0 min-w-0">
          {/* Canvas column (canvas above, media dock below) */}
          <div className="flex-1 flex flex-col gap-3 min-h-0 min-w-0">
            {/* Output mode controls */}
            {pages.length > 0 && (
              <div className="shrink-0 flex items-center gap-1.5 mb-1">
                {/* OUTPUT capsule pill */}
                <div className="flex items-stretch h-8 rounded-full overflow-hidden shadow-sm border border-border/60">
                  {/* Icon + label segment */}
                  <span className="flex items-center gap-1.5 pl-3 pr-3 bg-[hsl(var(--foreground))] text-[hsl(var(--background))] text-[11px] font-bold uppercase tracking-wide select-none whitespace-nowrap">
                    <Monitor className="w-3.5 h-3.5 shrink-0" />
                    OUTPUT
                  </span>
                  {/* Number segments */}
                  {outputMode === "mirror" ? (
                    /* Mirror — single passive count pill */
                    <span className="flex items-center justify-center px-3 bg-primary/70 text-primary-foreground text-xs font-bold select-none min-w-[32px]">
                      {outputCount}
                    </span>
                  ) : (
                    Array.from({ length: outputCount }, (_, i) => {
                      const n = i + 1;
                      const isActive = activeOutput === n;
                      return (
                        <button
                          key={n}
                          type="button"
                          onClick={() => switchToOutput(n)}
                          title={`切換至輸出 ${n}`}
                          className={`flex items-center justify-center min-w-[32px] px-2.5 text-sm font-bold transition-all duration-150 border-l border-white/15 ${
                            isActive
                              ? "bg-primary text-primary-foreground scale-[1.02]"
                              : "bg-primary/45 text-primary-foreground/75 hover:bg-primary/70"
                          }`}
                        >
                          {n}
                        </button>
                      );
                    })
                  )}
                </div>

                {/* Sliders icon — opens mode/count settings */}
                <Popover open={outputModeOpen} onOpenChange={(open) => {
                  if (open) {
                    // Initialise draft from current applied values when opening
                    setPendingOutputMode(outputMode);
                    setPendingOutputCount(outputCount);
                  }
                  setOutputModeOpen(open);
                }}>
                  <PopoverTrigger asChild>
                    <button
                      type="button"
                      className="w-7 h-7 inline-flex items-center justify-center rounded-md border border-border text-muted-foreground hover:text-primary hover:border-primary/60 hover:bg-primary/5 transition-colors"
                      title="輸出設定"
                    >
                      <SlidersHorizontal className="w-3.5 h-3.5" />
                    </button>
                  </PopoverTrigger>
                  <PopoverContent side="bottom" align="start" className="w-72 p-0" onClick={(e) => e.stopPropagation()}>
                    {/* ── Mode list ── */}
                    <div className="px-3 pt-3 pb-1">
                      <p className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground mb-2">OUTPUT MODE</p>
                      {([
                        { id: "independent",  label: "Independent",       desc: "Each Output plays its own content",                fixedCount: null },
                        { id: "mirror",       label: "Mirror",            desc: "All Outputs display the same picture — count locked to 1", fixedCount: 1 },
                        { id: "extend-h",     label: "Extend Horizontal", desc: "Outputs extend horizontally into one canvas",      fixedCount: null },
                        { id: "extend-v",     label: "Extend Vertical",   desc: "Outputs extend vertically into one canvas",        fixedCount: null },
                        { id: "grid-2x2-h",   label: "2×2 Matrix",        desc: "4 screens in a 2×2 grid (3840×2160 or 2160×3840) — count locked to 4", fixedCount: 4 },
                      ] as const).map((opt) => (
                        <button
                          key={opt.id}
                          type="button"
                          onClick={() => {
                            setPendingOutputMode(opt.id);
                            // Auto-set fixed counts
                            if (opt.fixedCount !== null) setPendingOutputCount(opt.fixedCount);
                          }}
                          className={`w-full flex items-start gap-3 px-3 py-2.5 rounded-md text-left transition-colors ${pendingOutputMode === opt.id ? "bg-primary/10 text-primary" : "hover:bg-muted/60 text-foreground"}`}
                        >
                          <div className="mt-0.5 shrink-0">
                            {pendingOutputMode === opt.id
                              ? <CheckCircle2 className="w-4 h-4 text-primary" />
                              : <span className="w-4 h-4 rounded-full border-2 border-muted-foreground/40 inline-block" />}
                          </div>
                          <div>
                            <p className="text-sm font-semibold leading-tight">{opt.label}</p>
                            <p className="text-[11px] text-muted-foreground mt-0.5 leading-snug">{opt.desc}</p>
                          </div>
                        </button>
                      ))}
                    </div>

                    {/* ── Count section ── */}
                    {pendingOutputMode === "grid-2x2-h" || pendingOutputMode === "mirror" ? (
                      <div className="border-t border-border px-3 py-2.5 flex items-center gap-2 text-[11px] text-muted-foreground">
                        <span className="bg-primary/10 text-primary font-bold px-2 py-0.5 rounded">
                          {pendingOutputMode === "mirror" ? "1" : "4"}
                        </span>
                        <span>
                          {pendingOutputMode === "mirror" ? "Mirror 模式輸出數量固定為 1" : "輸出數量固定為 4（2 列 × 2 行）"}
                        </span>
                      </div>
                    ) : (
                      <div className="border-t border-border px-3 py-2.5">
                        <p className="text-[11px] font-semibold text-muted-foreground mb-1.5">輸出數量</p>
                        <div className="flex gap-1">
                          {[1, 2, 3, 4].map((n) => (
                            <button
                              key={n}
                              type="button"
                              onClick={() => setPendingOutputCount(n)}
                              className={`flex-1 h-8 rounded-md border text-xs font-bold transition-colors ${pendingOutputCount === n ? "bg-primary text-primary-foreground border-primary" : "border-border hover:border-primary/60 hover:bg-muted/60"}`}
                            >
                              {n}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Extend mode hint */}
                    {(pendingOutputMode === "extend-h" || pendingOutputMode === "extend-v") && (
                      <div className="px-3 pb-1 text-[11px] text-amber-600 dark:text-amber-400 flex items-start gap-1.5">
                        <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                        <span>延伸模式下，版面將依輸出數量水平/垂直延展。</span>
                      </div>
                    )}

                    {/* ── Confirm / Cancel ── */}
                    <div className="border-t border-border px-3 py-2.5 flex items-center justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => setOutputModeOpen(false)}
                        className="h-8 px-3 rounded-md border border-border text-xs font-medium text-foreground hover:bg-muted/60 transition-colors"
                      >
                        {t("cancel")}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setOutputMode(pendingOutputMode);
                          setOutputCount(pendingOutputCount);
                          if (activeOutput > pendingOutputCount) switchToOutput(pendingOutputCount);
                          setOutputModeOpen(false);
                        }}
                        className="h-8 px-4 rounded-md bg-primary text-primary-foreground text-xs font-semibold hover:bg-primary/90 transition-colors"
                      >
                        {t("confirm")}
                      </button>
                    </div>
                  </PopoverContent>
                </Popover>
                <div className="w-px h-5 bg-border mx-1" />
              </div>
            )}

            {/* Page tabs (multi-layout carousel) */}
            {pages.length > 0 && (
              <div className="shrink-0 flex items-center gap-0 pb-1">
                {/* Scrollable tabs area */}
                <div className="flex items-center gap-1 overflow-x-auto min-w-0 flex-1">
                <TooltipProvider delayDuration={300}>
                {pages.map((p, idx) => {
                  const isActive = p.id === activePageId;
                  return (
                    <Tooltip key={p.id}>
                      <TooltipTrigger asChild>
                    <div
                      role="tab"
                      aria-selected={isActive}
                      onClick={() => switchToPage(p.id)}
                      draggable={canEdit}
                      onDragStart={(e) => {
                        if (!canEdit) return;
                        setDragPageId(p.id);
                        e.dataTransfer.effectAllowed = "move";
                        try { e.dataTransfer.setData("text/plain", p.id); } catch { /* noop */ }
                      }}
                      onDragOver={(e) => {
                        if (!canEdit || !dragPageId) return;
                        e.preventDefault();
                        e.dataTransfer.dropEffect = "move";
                        if (dragOverPageId !== p.id) setDragOverPageId(p.id);
                      }}
                      onDragLeave={() => {
                        if (dragOverPageId === p.id) setDragOverPageId(null);
                      }}
                      onDrop={(e) => {
                        if (!canEdit || !dragPageId) return;
                        e.preventDefault();
                        reorderPages(dragPageId, p.id);
                        setDragPageId(null);
                        setDragOverPageId(null);
                      }}
                      onDragEnd={() => { setDragPageId(null); setDragOverPageId(null); }}
                      className={`group relative flex items-center gap-1.5 pl-3 pr-1.5 h-8 rounded-t-md border-t border-x text-xs whitespace-nowrap transition-[background-color,border-color,color,box-shadow] duration-150 ease-out ${
                        canEdit ? "cursor-grab active:cursor-grabbing" : "cursor-pointer"
                      } ${
                        isActive
                          ? "bg-background border-primary/60 text-primary font-semibold shadow-[0_-2px_6px_-3px_hsl(var(--primary)/0.3)] animate-studio-tab-pop"
                          : "bg-muted/40 border-transparent text-muted-foreground hover:bg-muted/70 hover:text-foreground"
                      } ${dragOverPageId === p.id && dragPageId && dragPageId !== p.id ? "ring-2 ring-primary/60" : ""} ${dragPageId === p.id ? "opacity-50" : ""}`}
                    >
                      <Layers className={`w-3 h-3 shrink-0 transition-all duration-200 ${isActive ? "opacity-100 text-primary" : "opacity-70"}`} />
                      <span className="select-none">
                        {(() => {
                          const m = typeof p.name === "string" ? p.name.match(/^版型\s*(\d+)$/) : null;
                          if (m) return `${t("studioPageTabPrefix")} ${m[1]}`;
                          return p.name || `${t("studioPageTabPrefix")} ${idx + 1}`;
                        })()}
                      </span>
                      {canEdit && (
                        <Popover>
                          <PopoverTrigger asChild>
                            <button
                              type="button"
                              onClick={(e) => e.stopPropagation()}
                              className="ml-0.5 w-4 h-4 inline-flex items-center justify-center rounded hover:bg-accent opacity-0 group-hover:opacity-100 transition-opacity"
                              aria-label="Edit"
                            >
                              <Edit3 className="w-3 h-3" />
                            </button>
                          </PopoverTrigger>
                          <PopoverContent side="bottom" align="start" className="w-40 p-1" onClick={(e) => e.stopPropagation()}>
                            <button
                              type="button"
                              className="w-full flex items-center gap-2 px-2 py-1.5 text-xs rounded hover:bg-accent transition-colors text-left"
                              onClick={(e) => {
                                e.stopPropagation();
                                const m = typeof p.name === "string" ? p.name.match(/^版型\s*(\d+)$/) : null;
                                const displayName = m ? `${t("studioPageTabPrefix")} ${m[1]}` : p.name;
                                const input = window.prompt(t("studioRenamePage"), displayName);
                                if (input == null) return;
                                const trimmed = input.trim();
                                const prefix = t("studioPageTabPrefix");
                                const escaped = prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
                                const km = trimmed.match(new RegExp(`^${escaped}\\s*(\\d+)$`));
                                renamePage(p.id, km ? `版型 ${km[1]}` : trimmed);
                              }}
                            >
                              <Edit3 className="w-3 h-3 shrink-0" /> {t("studioRenamePage")}
                            </button>
                            <button
                              type="button"
                              className="w-full flex items-center gap-2 px-2 py-1.5 text-xs rounded hover:bg-accent transition-colors text-left"
                              onClick={(e) => { e.stopPropagation(); handleSaveToScene(pages.find((pg) => pg.id === p.id) ?? p); }}
                            >
                              <Layers className="w-3 h-3 shrink-0" /> {t("studioSaveToScene")}
                            </button>
                            {pages.length > 1 && (
                              <button
                                type="button"
                                className="w-full flex items-center gap-2 px-2 py-1.5 text-xs rounded hover:bg-destructive/10 hover:text-destructive transition-colors text-left"
                                onClick={(e) => { e.stopPropagation(); deletePage(p.id); }}
                              >
                                <Trash2 className="w-3 h-3 shrink-0 text-destructive" /> {t("studioDeletePage")}
                              </button>
                            )}
                          </PopoverContent>
                        </Popover>
                      )}
                      {isActive && (
                        <span
                          aria-hidden
                          className="pointer-events-none absolute left-1.5 right-1.5 -bottom-px h-0.5 rounded-full bg-primary origin-left animate-studio-indicator-grow"
                        />
                      )}
                    </div>
                      </TooltipTrigger>
                      <TooltipContent side="bottom" className="text-xs">
                        <span className="font-medium">{p.name}</span>
                      </TooltipContent>
                    </Tooltip>
                  );
                })}
                </TooltipProvider>
                {canEdit && (
                  <button
                    type="button"
                    onClick={addBlankPage}
                    className="ml-1 w-7 h-7 inline-flex items-center justify-center rounded-md border border-dashed border-border text-muted-foreground hover:text-foreground hover:border-foreground hover:bg-muted/50 transition-colors"
                    aria-label={t("studioAddPage")}
                    title={t("studioAddPage")}
                  >
                    <Plus className="w-3.5 h-3.5" />
                  </button>
                )}
                {canEdit && (
                  <button
                    type="button"
                    onClick={() => setTransitionDialogOpen(true)}
                    className="ml-1 w-7 h-7 inline-flex items-center justify-center rounded-md border border-border text-muted-foreground hover:text-primary hover:border-primary/60 hover:bg-primary/5 transition-colors"
                    aria-label={t("studioPageTransitionConfigure")}
                    title={t("studioPageTransitionConfigure")}
                  >
                    <Settings2 className="w-3.5 h-3.5" />
                  </button>
                )}
                </div>{/* end scrollable tabs area */}

                {/* ── Project name badge (right of page tabs) ─────────── */}
                <div className="shrink-0 ml-2 flex items-center">
                  {projectNameEditing ? (
                    <Input
                      autoFocus
                      value={projectNameInput}
                      onChange={(e) => setProjectNameInput(e.target.value)}
                      onBlur={() => {
                        const trimmed = projectNameInput.trim();
                        setProjectNameEditing(false);
                        if (!trimmed) return;
                        setProjectName(trimmed);
                        if (currentProject) setCurrentProject({ ...currentProject, name: trimmed });
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          const trimmed = projectNameInput.trim();
                          setProjectNameEditing(false);
                          if (!trimmed) return;
                          setProjectName(trimmed);
                          if (currentProject) setCurrentProject({ ...currentProject, name: trimmed });
                        } else if (e.key === "Escape") {
                          setProjectNameEditing(false);
                        }
                      }}
                      className="h-7 text-xs w-44 shrink-0"
                    />
                  ) : (
                    <button
                      type="button"
                      onClick={() => { setProjectNameInput(workingProjectName || ""); setProjectNameEditing(true); }}
                      title={t("studioProjectNameEdit")}
                      className="group flex items-center gap-1.5 h-7 px-2.5 rounded-md border border-dashed border-border/50 hover:border-primary/50 bg-transparent hover:bg-muted/50 transition-colors max-w-[200px]"
                    >
                      {workingProjectName ? (
                        <span className="text-xs font-medium text-foreground/80 truncate">{workingProjectName}</span>
                      ) : (
                        <span className="text-xs text-muted-foreground/50 italic">{t("studioProjectNamePlaceholder")}</span>
                      )}
                      <Edit3 className="w-3 h-3 text-muted-foreground/50 opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
                    </button>
                  )}
                </div>
              </div>
            )}
            <div ref={canvasContainerRef} className="flex-1 flex items-center justify-center bg-muted/30 rounded-xl border border-border relative overflow-hidden min-h-0">
          {/* Floating resolution badge */}
          <div className="absolute bottom-3 right-3 z-20 px-2.5 py-1 rounded-md bg-background/80 backdrop-blur-sm border border-border shadow-sm text-[11px] font-medium text-foreground tabular-nums pointer-events-none flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-primary" />
            {isGrid2x2 ? (
              <>
                <span className="text-muted-foreground">{resolution.width}×{resolution.height} ×4</span>
                <span className="text-border">|</span>
                <span>{resolution.width * 2}×{resolution.height * 2}</span>
              </>
            ) : extendCount > 1 ? (
              <>
                <span className="text-muted-foreground">{resolution.width}×{resolution.height}</span>
                <span className="text-muted-foreground/60">×{extendCount}</span>
                <span className="text-border">|</span>
                <span>
                  {outputMode === "extend-h"
                    ? `${resolution.width * extendCount}×${resolution.height}`
                    : `${resolution.width}×${resolution.height * extendCount}`}
                </span>
              </>
            ) : (
              <>{resolution.width}×{resolution.height}</>
            )}
          </div>

          {/* Zone merge / split toolbar */}
          {canEdit && selectedZone && !isMobile && (() => {
            const z = zones.find((zz) => zz.id === selectedZone);
            const isSingle = extraSelectedZoneIds.size === 0;
            const pxW = z ? Math.round((z.w / 100) * resolution.width) : 0;
            const pxH = z ? Math.round((z.h / 100) * resolution.height) : 0;
            // If a timeline card is pinned for this zone, operate on that single item; otherwise batch
            const pinnedForThisZone = pinnedPreview?.trackId === `z-${z?.id}`;
            const pinnedIdx = pinnedForThisZone ? pinnedPreview!.itemIdx : -1;
            const pinnedItem = pinnedForThisZone ? z?.content?.mediaItems?.[pinnedIdx] : undefined;
            const fit = pinnedItem?.fitMode ?? z?.content?.fitMode ?? "cover-x";
            const setFit = (mode: "cover-x" | "cover-y" | "contain" | "stretch") => {
              if (!z) return;
              const base: ZoneContent = z.content || { type: "color", value: "", bgColor: "hsl(var(--muted))" };
              if (pinnedForThisZone && pinnedIdx >= 0) {
                // Single-item mode: apply only to the pinned item
                const updatedItems = (base.mediaItems || []).map((item, i) =>
                  (i === pinnedIdx && (item.type === "image" || item.type === "video")) ? { ...item, fitMode: mode } : item
                );
                updateZoneContent(z.id, { ...base, mediaItems: updatedItems });
              } else {
                // Batch mode: apply to all image/video items
                const updatedItems = (base.mediaItems || []).map((item) =>
                  (item.type === "image" || item.type === "video") ? { ...item, fitMode: mode } : item
                );
                updateZoneContent(z.id, { ...base, fitMode: mode, mediaItems: updatedItems });
              }
            };
            return (
            <div className={`absolute z-30 flex flex-col gap-1.5 px-2 py-1.5 rounded-lg bg-background/90 backdrop-blur-sm border border-border shadow-md transition-[box-shadow,border-color,transform,top,left,right] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] hover:shadow-lg hover:border-primary/30 ${zoneToolbarCollapsed ? "top-3 right-3" : "top-3 left-1/2 -translate-x-1/2"}`}>
              <div className="flex items-center gap-1">
                <span className="text-[11px] text-muted-foreground px-1.5">
                  {extraSelectedZoneIds.size > 0
                    ? t("studioZoneSelected").replace("{n}", String(extraSelectedZoneIds.size + 1))
                    : isSingle && z
                      ? t("studioZoneInfo").replace("{label}", z.label).replace("{w}", String(pxW)).replace("{h}", String(pxH))
                      : t("studioZoneToolbarOps")}
                </span>
                {!zoneToolbarCollapsed && <div className="flex items-center gap-1 animate-studio-toolbar-expand origin-top">
                <div className="w-px h-5 bg-border mx-1" />
                <Button size="sm" variant="ghost" className="h-7 px-2 text-xs gap-1" onClick={() => splitSelectedZone("vertical")} disabled={zones.length + overlays.length >= 8} title={zones.length + overlays.length >= 8 ? "已達區塊總數上限 (8)" : t("studioSplitVerticalTip")}>
                  <Columns2 className="w-3.5 h-3.5" /> {t("studioSplitVertical")}
                </Button>
                <Button size="sm" variant="ghost" className="h-7 px-2 text-xs gap-1" onClick={() => splitSelectedZone("horizontal")} disabled={zones.length + overlays.length >= 8} title={zones.length + overlays.length >= 8 ? "已達區塊總數上限 (8)" : t("studioSplitHorizontalTip")}>
                  <Rows2 className="w-3.5 h-3.5" /> {t("studioSplitHorizontal")}
                </Button>
                <div className="w-px h-5 bg-border mx-1" />
                {extraSelectedZoneIds.size > 0 ? (
                  <Button size="sm" variant="default" className="h-7 px-2 text-xs gap-1" onClick={mergeSelectedZones} title={t("studioMergeSelectedTip")}>
                    <Square className="w-3.5 h-3.5" /> {t("studioMergeSelected")}
                  </Button>
                ) : (
                  <>
                    <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => mergeDirection("up")} title={t("studioMergeUp")}><ChevronLeft className="w-3.5 h-3.5 rotate-90" /></Button>
                    <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => mergeDirection("down")} title={t("studioMergeDown")}><ChevronRightIcon className="w-3.5 h-3.5 rotate-90" /></Button>
                    <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => mergeDirection("left")} title={t("studioMergeLeft")}><ChevronLeft className="w-3.5 h-3.5" /></Button>
                    <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => mergeDirection("right")} title={t("studioMergeRight")}><ChevronRightIcon className="w-3.5 h-3.5" /></Button>
                  </>
                )}
                <span className="text-[10px] text-muted-foreground px-1.5 hidden lg:inline">{t("studioMultiSelectHint")}</span>
                </div>}
                <div className="w-px h-5 bg-border mx-1" />
                <Button size="sm" variant="ghost" className="h-7 w-7 p-0 hover:bg-primary/10 hover:text-primary" onClick={toggleZoneToolbarCollapsed} title={zoneToolbarCollapsed ? "展開工具列" : "收合工具列"}>
                  <ChevronUp className={`w-3.5 h-3.5 transition-transform duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] ${zoneToolbarCollapsed ? "rotate-180" : "rotate-0"}`} />
                </Button>
              </div>
              {!zoneToolbarCollapsed && isSingle && z && (
                <div className="flex items-center gap-1 border-t border-border pt-1.5 animate-studio-toolbar-expand origin-top">
                  <span className="text-[11px] text-muted-foreground px-1.5">
                    {pinnedForThisZone && pinnedIdx >= 0 ? `${t("studioFitModeSingle")} #${pinnedIdx + 1}` : t("studioFitModeDefault")}
                  </span>
                  <Button size="sm" variant={fit === "cover-x" ? "default" : "ghost"} className="h-7 px-2 text-xs gap-1" onClick={() => setFit("cover-x")} title={t("studioFitCoverXTip")}>
                    <Maximize2 className="w-3.5 h-3.5" /> {t("studioFitCoverX")}
                  </Button>
                  <Button size="sm" variant={fit === "cover-y" ? "default" : "ghost"} className="h-7 px-2 text-xs gap-1" onClick={() => setFit("cover-y")} title={t("studioFitCoverYTip")}>
                    <Maximize2 className="w-3.5 h-3.5 rotate-90" /> {t("studioFitCoverY")}
                  </Button>
                  <Button size="sm" variant={fit === "contain" ? "default" : "ghost"} className="h-7 px-2 text-xs gap-1" onClick={() => setFit("contain")} title={t("studioFitContainTip")}>
                    <Square className="w-3.5 h-3.5" /> {t("studioFitContain")}
                  </Button>
                  <Button size="sm" variant={fit === "stretch" ? "default" : "ghost"} className="h-7 px-2 text-xs gap-1" onClick={() => setFit("stretch")} title={t("studioFitStretchTip")}>
                    <Move className="w-3.5 h-3.5" /> {t("studioFitStretch")}
                  </Button>
                </div>
              )}
            </div>
            );
          })()}

          {/* Overlay split / fit toolbar */}
          {canEdit && selectedOverlay && !selectedZone && !isMobile && (() => {
            const o = overlays.find((oo) => oo.id === selectedOverlay);
            if (!o) return null;
            const fit = o.content?.fitMode || "cover-x";
            const setFit = (mode: "cover-x" | "cover-y" | "contain" | "stretch") => {
              const base: ZoneContent = o.content || { type: "color", value: "", bgColor: "transparent" };
              updateOverlayContent(o.id, { ...base, fitMode: mode });
            };
            return (
              <div className={`absolute z-30 flex flex-col gap-1.5 px-2 py-1.5 rounded-lg bg-background/90 backdrop-blur-sm border border-border shadow-md transition-[box-shadow,border-color,transform,top,left,right] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] hover:shadow-lg hover:border-primary/30 ${zoneToolbarCollapsed ? "top-3 right-3" : "top-3 left-1/2 -translate-x-1/2"}`}>
                <div className="flex items-center gap-1">
                  <span className="text-[11px] text-muted-foreground px-1.5">
                    {t("studioTimelineOverlayPrefix")} {o.label} · {Math.round(o.w)}×{Math.round(o.h)}
                  </span>
                  {!zoneToolbarCollapsed && <div className="flex items-center gap-1 animate-studio-toolbar-expand origin-top">
                  <div className="w-px h-5 bg-border mx-1" />
                  <Button size="sm" variant="ghost" className="h-7 px-2 text-xs gap-1" onClick={() => splitSelectedOverlay("vertical")} disabled={zones.length + overlays.length >= 8} title={zones.length + overlays.length >= 8 ? "已達區塊總數上限 (8)" : t("studioSplitVerticalTip")}>
                    <Columns2 className="w-3.5 h-3.5" /> {t("studioSplitVertical")}
                  </Button>
                  <Button size="sm" variant="ghost" className="h-7 px-2 text-xs gap-1" onClick={() => splitSelectedOverlay("horizontal")} disabled={zones.length + overlays.length >= 8} title={zones.length + overlays.length >= 8 ? "已達區塊總數上限 (8)" : t("studioSplitHorizontalTip")}>
                    <Rows2 className="w-3.5 h-3.5" /> {t("studioSplitHorizontal")}
                  </Button>
                  </div>}
                  <div className="w-px h-5 bg-border mx-1" />
                  <Button size="sm" variant="ghost" className="h-7 w-7 p-0 hover:bg-primary/10 hover:text-primary" onClick={toggleZoneToolbarCollapsed} title={zoneToolbarCollapsed ? "展開工具列" : "收合工具列"}>
                    <ChevronUp className={`w-3.5 h-3.5 transition-transform duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] ${zoneToolbarCollapsed ? "rotate-180" : "rotate-0"}`} />
                  </Button>
                </div>
                {!zoneToolbarCollapsed && (
                <div className="flex items-center gap-1 border-t border-border pt-1.5 animate-studio-toolbar-expand origin-top">
                  <span className="text-[11px] text-muted-foreground px-1.5">{t("studioFitMode")}</span>
                  <Button size="sm" variant={fit === "cover-x" ? "default" : "ghost"} className="h-7 px-2 text-xs gap-1" onClick={() => setFit("cover-x")} title={t("studioFitCoverXTip")}>
                    <Maximize2 className="w-3.5 h-3.5" /> {t("studioFitCoverX")}
                  </Button>
                  <Button size="sm" variant={fit === "cover-y" ? "default" : "ghost"} className="h-7 px-2 text-xs gap-1" onClick={() => setFit("cover-y")} title={t("studioFitCoverYTip")}>
                    <Maximize2 className="w-3.5 h-3.5 rotate-90" /> {t("studioFitCoverY")}
                  </Button>
                  <Button size="sm" variant={fit === "contain" ? "default" : "ghost"} className="h-7 px-2 text-xs gap-1" onClick={() => setFit("contain")} title={t("studioFitContainTip")}>
                    <Square className="w-3.5 h-3.5" /> {t("studioFitContain")}
                  </Button>
                  <Button size="sm" variant={fit === "stretch" ? "default" : "ghost"} className="h-7 px-2 text-xs gap-1" onClick={() => setFit("stretch")} title={t("studioFitStretchTip")}>
                    <Move className="w-3.5 h-3.5" /> {t("studioFitStretch")}
                  </Button>
                </div>
                )}
              </div>
            );
          })()}

          <div ref={canvasRef} className={`relative bg-card rounded-lg shadow-lg border border-border overflow-hidden ${resizing ? "" : "transition-all duration-300"}`} style={{ width: W, height: H, maxWidth: "100%", maxHeight: "100%" }}
            onClick={() => { if (selectedOverlay) setSelectedOverlay(null); }}>
            {/* Multi-output overlays: panel labels + divider lines + active highlight */}
            {totalPanels > 1 && (() => {
              const DIVIDER = { background: "rgba(99,102,241,0.85)", boxShadow: "0 0 6px rgba(99,102,241,0.6)" };
              return (
                <>
                  {/* Per-panel label */}
                  {Array.from({ length: totalPanels }, (_, i) => {
                    const n = i + 1;
                    const { x, y } = getPanelRect(n);
                    const isActive = activeOutput === n;
                    return (
                      <div key={n} className="pointer-events-none absolute z-50"
                        style={{ left: x + 6, top: y + 6 }}>
                        <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${isActive ? "bg-primary text-primary-foreground" : "bg-black/50 text-white/80"}`}>
                          OUT {n}
                        </span>
                      </div>
                    );
                  })}
                  {/* Active panel highlight */}
                  {(() => {
                    const { x, y, w, h } = getPanelRect(activeOutput);
                    return (
                      <div className="pointer-events-none absolute z-40 ring-2 ring-primary/70"
                        style={{ left: x, top: y, width: w, height: h }} />
                    );
                  })()}
                  {/* Divider lines — vertical */}
                  {(outputMode === "extend-h" || isGrid2x2) &&
                    Array.from({ length: isGrid2x2 ? 1 : extendCount - 1 }, (_, i) => (
                      <div key={`v${i}`} className="pointer-events-none absolute z-50"
                        style={{ top: 0, bottom: 0, left: singleW * (i + 1) - 1, width: 2, ...DIVIDER }} />
                    ))}
                  {/* Divider lines — horizontal */}
                  {(outputMode === "extend-v" || isGrid2x2) &&
                    Array.from({ length: isGrid2x2 ? 1 : extendCount - 1 }, (_, i) => (
                      <div key={`h${i}`} className="pointer-events-none absolute z-50"
                        style={{ left: 0, right: 0, top: singleH * (i + 1) - 1, height: 2, ...DIVIDER }} />
                    ))}
                </>
              );
            })()}
            {isMobile && !currentProject && (
              <div className="absolute inset-0 z-40 flex items-center justify-center bg-background/85 backdrop-blur-sm p-4">
                <div className="w-full max-w-xs rounded-xl border border-border bg-card shadow-lg p-5 flex flex-col items-center text-center gap-3">
                  <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center">
                    <FolderOpen className="w-6 h-6 text-primary" />
                  </div>
                  <div>
                    <h3 className="text-base font-semibold text-foreground">{t("studioMobileEmptyTitle")}</h3>
                    <p className="text-xs text-muted-foreground mt-1">{t("studioMobileEmptyDesc")}</p>
                  </div>
                  <div className="flex flex-col gap-2 w-full pt-1">
                    <Button size="sm" className="w-full gap-1.5" onClick={(e) => { e.stopPropagation(); setSidebarTab("my"); setMobilePanelOpen(true); }}>
                      <FolderOpen className="w-3.5 h-3.5" /> {t("studioOpen")}
                    </Button>
                    <Button size="sm" variant="outline" className="w-full gap-1.5" onClick={(e) => { e.stopPropagation(); requestNew(); }}>
                      <FilePlus className="w-3.5 h-3.5" /> {t("studioNew")}
                    </Button>
                  </div>
                </div>
              </div>
            )}
            {/* Desktop: blank canvas hint when no zones exist */}
            {!isMobile && zones.length === 0 && (
              <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 pointer-events-none select-none">
                <div className="w-14 h-14 rounded-full bg-primary/8 flex items-center justify-center">
                  <LayoutGrid className="w-7 h-7 text-primary/40" />
                </div>
                <div className="text-center">
                  <p className="text-sm font-medium text-muted-foreground/70">{t("studioCanvasBlankHint")}</p>
                  <p className="text-xs text-muted-foreground/45 mt-1">{t("studioCanvasBlankDesc")}</p>
                </div>
              </div>
            )}
            {zones.map((zone) => {
              const isSelected = selectedZone === zone.id;
              const isExtra = extraSelectedZoneIds.has(zone.id);
              const bg = zone.content?.bgColor || "hsl(var(--muted))";
              const mediaItems = zone.content?.mediaItems || [];
              const isDropTarget = dropTargetId === `zone-${zone.id}`;
              return (
                <div key={zone.id}
                  className={`absolute transition-[box-shadow,opacity] duration-200 ease-out flex items-center justify-center overflow-hidden ${canEdit ? "cursor-pointer" : "cursor-default"} ${
                    isSelected
                      ? "ring-[3px] ring-primary ring-offset-2 ring-offset-background z-20 animate-studio-active-pulse"
                      : isExtra
                        ? "ring-2 ring-primary/70 z-10"
                        : canEdit
                          ? "hover:ring-2 hover:ring-primary/40"
                          : ""
                  } ${isDropTarget ? "ring-2 ring-primary ring-offset-2 z-20" : ""}`}
                  style={{ left: `${zone.x}%`, top: `${zone.y}%`, width: `${zone.w}%`, height: `${zone.h}%`, background: bg }}
                  onClick={(e) => { if (!canEdit) return; handleZoneClick(zone.id, e.shiftKey || e.ctrlKey || e.metaKey); }}
                  onDragOver={(e) => {
                    if (!e.dataTransfer.types.includes("application/x-studio-picker-item")) return;
                    e.preventDefault();
                    e.dataTransfer.dropEffect = "copy";
                    if (dropTargetId !== `zone-${zone.id}`) setDropTargetId(`zone-${zone.id}`);
                  }}
                  onDragLeave={(e) => {
                    if (e.currentTarget.contains(e.relatedTarget as Node)) return;
                    if (dropTargetId === `zone-${zone.id}`) setDropTargetId(null);
                  }}
                  onDrop={(e) => {
                    const payload = parsePickerDropPayload(e);
                    setDropTargetId(null);
                    if (!payload) return;
                    e.preventDefault();
                    e.stopPropagation();
                    void addItemsToSpecificTarget(payload, { type: "zone", id: zone.id });
                  }}
                >

                  {/* Content render */}
                  {zone.content?.type === "media" && mediaItems.length > 0 ? (
                    <CarouselPreview items={mediaItems} transition={zone.content.carouselTransition || "fade"} fitMode={zone.content.fitMode || "cover-x"}
                      pinToIdx={pinnedPreview?.trackId === `z-${zone.id}` ? pinnedPreview.itemIdx : undefined}
                    />
                  ) : zone.content?.type === "widget" && zone.content.widgetConfig ? (
                    <ZoneAnimatedWrapper animation={zone.content.widgetConfig.animation}>
                      <WidgetZonePreview config={zone.content.widgetConfig} />
                    </ZoneAnimatedWrapper>
                  ) : zone.content?.type === "text" && zone.content.value ? (
                    <div className="p-3 w-full" style={{ color: zone.content.textColor || "hsl(0 0% 100%)", fontSize: Math.min(zone.content.fontSize || 24, 52), textAlign: zone.content.textAlign || "center" }}>
                      <span className="font-bold leading-tight whitespace-pre-line">{zone.content.value}</span>
                    </div>
                  ) : (
                    <div className="flex flex-col items-center gap-1 text-muted-foreground/60">
                      <Plus className="w-6 h-6" />
                      <span className="text-xs font-medium">{zone.label}</span>
                    </div>
                  )}

                  <span
                    className={`absolute top-1.5 left-1.5 text-[10px] font-bold px-1.5 py-0.5 rounded transition-colors duration-200 ${
                      isSelected
                        ? "bg-primary text-primary-foreground shadow-sm"
                        : "bg-foreground/80 text-background"
                    }`}
                  >
                    {zone.label}
                  </span>

                  {zone.content?.mediaItems?.some((m) => m.type === "video") && (
                    <span className="absolute top-1.5 right-1.5 flex items-center gap-0.5 bg-destructive/90 text-destructive-foreground text-[9px] font-bold px-1.5 py-0.5 rounded shadow-sm">
                      <Film className="w-2.5 h-2.5" />
                    </span>
                  )}

                  {canEdit && hasResizeHandle(zone, "right", zones) && (
                    <div className="absolute top-0 right-0 w-2 h-full cursor-col-resize z-20 group/handle hover:bg-primary/30 transition-colors" onMouseDown={(e) => handleResizeStart(e, zone.id, "right")}>
                      <div className="absolute top-1/2 right-0 -translate-y-1/2 w-1 h-8 rounded-full bg-primary/60 opacity-0 group-hover/handle:opacity-100 transition-opacity" />
                    </div>
                  )}
                  {canEdit && hasResizeHandle(zone, "bottom", zones) && (
                    <div className="absolute bottom-0 left-0 h-2 w-full cursor-row-resize z-20 group/handle hover:bg-primary/30 transition-colors" onMouseDown={(e) => handleResizeStart(e, zone.id, "bottom")}>
                      <div className="absolute bottom-0 left-1/2 -translate-x-1/2 h-1 w-8 rounded-full bg-primary/60 opacity-0 group-hover/handle:opacity-100 transition-opacity" />
                    </div>
                  )}
                </div>
              );
            })}

            {/* Overlay blocks */}
            {overlays.map((overlay) => {
              const isSelected = selectedOverlay === overlay.id;
              const bg = overlay.content?.bgColor || "transparent";
              const mediaItems = overlay.content?.mediaItems || [];
              const isOverlayDropTarget = dropTargetId === `overlay-${overlay.id}`;
              return (
                <div key={overlay.id}
                  className={`absolute flex items-center justify-center overflow-hidden rounded-lg ${overlay.locked || !canEdit ? "cursor-default" : "cursor-move"} ${isSelected ? "ring-2 ring-accent-foreground ring-offset-1" : canEdit ? "hover:ring-1 hover:ring-accent-foreground/50" : ""} ${isOverlayDropTarget ? "ring-2 ring-primary ring-offset-2" : ""}`}
                  style={{ left: overlay.x, top: overlay.y, width: overlay.w, height: overlay.h, background: bg, opacity: (overlay.opacity ?? 100) / 100, zIndex: 30 + (overlay.zIndex ?? 0) + (isSelected ? 10 : 0) }}
                  onClick={(e) => { if (!canEdit) return; e.stopPropagation(); setSelectedZone(null); setSelectedOverlay(isSelected ? null : overlay.id); }}
                  onMouseDown={(e) => { if (!canEdit || overlay.locked) return; if ((e.target as HTMLElement).dataset.resize) return; handleOverlayDragStart(e, overlay.id); }}
                  onDragOver={(e) => {
                    if (!e.dataTransfer.types.includes("application/x-studio-picker-item")) return;
                    e.preventDefault();
                    e.dataTransfer.dropEffect = "copy";
                    if (dropTargetId !== `overlay-${overlay.id}`) setDropTargetId(`overlay-${overlay.id}`);
                  }}
                  onDragLeave={(e) => {
                    if (e.currentTarget.contains(e.relatedTarget as Node)) return;
                    if (dropTargetId === `overlay-${overlay.id}`) setDropTargetId(null);
                  }}
                  onDrop={(e) => {
                    const payload = parsePickerDropPayload(e);
                    setDropTargetId(null);
                    if (!payload) return;
                    e.preventDefault();
                    e.stopPropagation();
                    void addItemsToSpecificTarget(payload, { type: "overlay", id: overlay.id });
                  }}
                >
                  {/* Content render */}
                  {overlay.content?.type === "media" && mediaItems.length > 0 ? (
                    <CarouselPreview items={mediaItems} transition={overlay.content.carouselTransition || "fade"} fitMode={overlay.content.fitMode || "cover-x"}
                      pinToIdx={pinnedPreview?.trackId === `o-${overlay.id}` ? pinnedPreview.itemIdx : undefined}
                    />
                  ) : overlay.content?.type === "widget" && overlay.content.widgetConfig ? (
                    <ZoneAnimatedWrapper animation={overlay.content.widgetConfig.animation}>
                      <WidgetZonePreview config={overlay.content.widgetConfig} />
                    </ZoneAnimatedWrapper>
                  ) : overlay.content?.type === "text" && overlay.content.value ? (
                    <div className="p-2 w-full" style={{ color: overlay.content.textColor || "hsl(0 0% 100%)", fontSize: Math.min(overlay.content.fontSize || 20, 40), textAlign: overlay.content.textAlign || "center" }}>
                      <span className="font-bold leading-tight whitespace-pre-line">{overlay.content.value}</span>
                    </div>
                  ) : (
                    <div className="flex flex-col items-center gap-1 text-white/60">
                      <Move className="w-5 h-5" />
                      <span className="text-[10px] font-medium">{overlay.label}</span>
                    </div>
                  )}

                  {/* Label badge */}
                  <span className="absolute top-1 left-1 bg-accent-foreground/80 text-background text-[9px] font-bold px-1.5 py-0.5 rounded flex items-center gap-1">
                    {overlay.locked ? <Lock className="w-2.5 h-2.5" /> : <Layers className="w-2.5 h-2.5" />} {overlay.label}
                  </span>

                  {/* Delete button */}
                  {isSelected && (
                    <Button variant="destructive" size="icon" className="absolute top-1 right-1 h-5 w-5 z-50" onClick={(e) => { e.stopPropagation(); deleteOverlay(overlay.id); }}>
                      <Trash2 className="w-3 h-3 text-destructive" />
                    </Button>
                  )}

                  {/* Resize handle bottom-right */}
                  {!overlay.locked && (
                    <div data-resize="true" className="absolute bottom-0 right-0 w-4 h-4 cursor-se-resize z-50 flex items-end justify-end"
                      onMouseDown={(e) => handleOverlayResizeStart(e, overlay.id, "se")}>
                      <Maximize2 className="w-3 h-3 text-white/60 rotate-90" />
                    </div>
                  )}
                </div>
              );
            })}

          </div>

          {/* Mobile read-only hint pill */}
          {isMobile && !mobileEditMode && (
            <div className="absolute top-3 left-1/2 -translate-x-1/2 z-20 px-3 py-1.5 rounded-full bg-background/85 backdrop-blur-sm border border-border shadow-sm text-[11px] text-muted-foreground flex items-center gap-1.5 max-w-[90%]">
              <Eye className="w-3 h-3 shrink-0" />
              <span className="truncate">{t("studioMobileEditHint")}</span>
            </div>
          )}
          </div>

            {/* Bottom Timeline (desktop only) */}
            {!isMobile && (
              <ZoneTimeline
                dbMedia={dbMedia}
                activeOrgId={activeOrgId}
                onMediaUploaded={loadMedia}
                zones={zones}
                overlays={overlays}
                selectedZoneId={selectedZone}
                selectedOverlayId={selectedOverlay}
                onSelectZone={(id) => { setSelectedOverlay(null); setSelectedZone(id); }}
                onSelectOverlay={(id) => { setSelectedZone(null); setSelectedOverlay(id); }}
                onUpdateZoneContent={updateZoneContent}
                onUpdateOverlayContent={updateOverlayContent}
                onAddItemsToTarget={addItemsToSpecificTarget}
                bgmItems={bgmItems}
                bgmVolume={bgmVolume}
                bgmAudioSource={bgmAudioSource}
                onBgmItemsChange={setBgmItems}
                onBgmVolumeChange={setBgmVolume}
                onBgmAudioSourceChange={setBgmAudioSource}
                height={dockHeight}
                onHeightChange={setDockHeight}
                onPinItem={handlePinPreview}
                pinnedItem={pinnedPreview}
              />
            )}
          </div>

          {/* Right panel toggle tab — pinned near scrollbar start */}
          {!isMobile && (
            <div className="flex shrink-0 w-6 items-start pt-[72px] justify-center">
              <button
                type="button"
                onClick={() => {
                  const opening = !mediaLibraryOpen;
                  if (opening) {
                    // Opening media panel → mutually exclusive with left panel
                    setLayoutPanelManuallyCollapsed(true);
                    try { localStorage.setItem("studio:layoutPanelManuallyCollapsed", "1"); } catch { /* ignore */ }
                    setLayoutPanelOpen(false);
                  }
                  setMediaLibraryOpen(opening);
                }}
                title={mediaLibraryOpen ? t("studioRailCollapseMedia") : t("studioRailExpandMedia")}
                aria-label={mediaLibraryOpen ? t("studioRailCollapseMedia") : t("studioRailExpandMedia")}
                aria-expanded={mediaLibraryOpen}
                className="group relative h-24 w-6 rounded-l-xl border border-r-0 border-primary/30 bg-gradient-to-b from-primary/10 via-card/90 to-card/80 backdrop-blur-sm shadow-md flex flex-col items-center justify-center gap-1.5 transition-all duration-200 text-primary/60 hover:border-primary/60 hover:from-primary/20 hover:to-primary/10 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60 overflow-hidden"
              >
                {/* Top accent stripe */}
                <div className="pointer-events-none absolute top-0 left-0 right-0 h-[3px] rounded-tl-xl bg-gradient-to-l from-primary/80 to-primary/30" />
                <PanelRight className="w-3 h-3 shrink-0" />
                <ChevronLeft className={`w-3 h-3 shrink-0 transition-transform duration-300 ${mediaLibraryOpen ? "" : "rotate-180"}`} />
              </button>
            </div>
          )}

          {/* Right-side Media Library (desktop only) */}
          {!isMobile && (
            <div
              className="shrink-0 flex flex-col relative overflow-hidden transition-[width] duration-500 ease-[cubic-bezier(0.22,1,0.36,1)]"
              style={{ width: mediaLibraryOpen ? `${mediaLibWidth}px` : "0px" }}
            >
              <div className="flex flex-col h-full">
                {/* Drag handle on the left edge */}
                <div
                  role="separator"
                  aria-orientation="vertical"
                  onMouseDown={startMediaResize}
                  className="absolute left-0 top-0 bottom-0 w-1.5 -translate-x-1/2 cursor-col-resize z-10 hover:bg-primary/40 active:bg-primary/60 transition-colors"
                  title={t("studioMediaResizeHandle")}
                  aria-label={t("studioMediaResizeHandle")}
                />
                <MediaLibraryDock
                  variant="side"
                  dbMedia={dbMedia}
                  dbWidgets={dbWidgets}
                  activeOrgId={activeOrgId}
                  onMediaUploaded={loadMedia}
                  onAddItems={addItemsToActiveTarget}
                  selectedZoneLabel={activeZone?.label || activeOverlay?.label || null}
                />
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Hidden file input for project import */}
      <input
        ref={importInputRef}
        type="file"
        accept=".zip"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) handleImport(file);
          e.target.value = "";
        }}
      />

      {/* Mobile: Panels Sheet (Layouts / Templates / Projects) */}
      {isMobile && (
        <Sheet open={mobilePanelOpen} onOpenChange={setMobilePanelOpen}>
          <SheetContent side="bottom" className="h-[80vh] flex flex-col p-4">
            <SheetHeader className="shrink-0">
              <SheetTitle className="text-base">{t("studioMobilePanels")}</SheetTitle>
            </SheetHeader>
            <Tabs value={sidebarTab} onValueChange={setSidebarTab} className="flex flex-col flex-1 min-h-0 mt-3">
              <TabsList className="w-full shrink-0">
                <TabsTrigger value="new" className="flex-1 text-xs">{t("studioNewProject")}</TabsTrigger>
                <TabsTrigger value="my" className="flex-1 text-xs">{t("studioMyProject")}</TabsTrigger>
              </TabsList>

              {/* New Project: Layout + Scene inner tabs */}
              <TabsContent value="new" className="flex-1 flex flex-col min-h-0 mt-2 data-[state=inactive]:hidden">
                <Tabs value={innerSidebarTab} onValueChange={setInnerSidebarTab} className="flex flex-col flex-1 min-h-0">
                  <TabsList className="w-full shrink-0">
                    <TabsTrigger value="layouts" className="flex-1 text-xs">{t("studioLayouts")}</TabsTrigger>
                    <TabsTrigger value="scene" className="flex-1 text-xs">{t("studioScene")}</TabsTrigger>
                  </TabsList>
                  <TabsContent value="layouts" className="flex-1 overflow-y-auto mt-3 pr-1">
                    {(() => {
                      const filtered = studioSources.layouts.filter((lp) => !lp.aspect || lp.aspect === aspect);
                      if (filtered.length === 0) return <p className="text-xs text-muted-foreground text-center py-6">{t("studioNoLayouts")}</p>;
                      return (
                        <>
                          <p className="text-[10px] text-muted-foreground mb-2 px-1">
                            {t("studioLayoutsForAspect")} <span className="font-medium text-foreground">{aspect}</span> · {filtered.length}
                          </p>
                          <div className={`grid gap-2 ${aspect === "9:16" ? "grid-cols-3" : "grid-cols-2"}`}>
                            {filtered.map((lp) => (
                              <button key={lp.id} onClick={() => applyLayout(lp, true)} title={t(lp.nameKey as TranslationKey)}
                                className="flex flex-col gap-1.5 p-2 rounded-lg border border-border bg-card active:bg-accent transition-colors text-left">
                                <div className={`w-full rounded-md overflow-hidden bg-muted ring-1 ring-border ${aspect === "9:16" ? "aspect-[9/16]" : "aspect-video"}`}>
                                  <LayoutThumb zones={lp.zones} aspect={aspect} />
                                </div>
                                <div className="flex items-center justify-between gap-1">
                                  <p className="text-[11px] font-medium text-foreground truncate">{t(lp.nameKey as TranslationKey)}</p>
                                  <Badge variant="secondary" className="text-[9px] px-1 py-0 shrink-0">{lp.zones.length}</Badge>
                                </div>
                              </button>
                            ))}
                          </div>
                        </>
                      );
                    })()}
                  </TabsContent>
                  <TabsContent value="scene" className="flex-1 overflow-y-auto mt-3 pr-1">
                    {studioSources.templates.length === 0 ? (
                      <p className="text-xs text-muted-foreground text-center py-8">{t("studioNoProjects")}</p>
                    ) : (
                      <div className={`grid gap-2 ${aspect === "9:16" ? "grid-cols-3" : "grid-cols-2"}`}>
                        {studioSources.templates.map((tpl) => (
                          <div key={tpl.id} className="relative group">
                            <button
                              onClick={() => applyTemplate(tpl, true)}
                              className="w-full flex flex-col gap-1.5 p-2 rounded-lg border border-border bg-card active:bg-accent transition-colors text-left"
                            >
                              <div className={`w-full rounded-md overflow-hidden bg-muted ring-1 ring-border ${tpl.aspect === "9:16" ? "aspect-[9/16]" : "aspect-video"}`}>
                                <SceneThumb zones={tpl.zones} />
                              </div>
                              <div className="flex items-center justify-between gap-1">
                                <p className="text-[11px] font-medium text-foreground truncate">{t(tpl.nameKey as TranslationKey)}</p>
                                <Badge variant="secondary" className="text-[9px] px-1 py-0 shrink-0">{tpl.zones.length}</Badge>
                              </div>
                            </button>
                            {tpl.id.startsWith("user-scene-") && (
                              <Popover>
                                <PopoverTrigger asChild>
                                  <button
                                    type="button"
                                    className="absolute top-3 right-3 w-5 h-5 inline-flex items-center justify-center rounded bg-background/80 border border-border opacity-0 group-hover:opacity-100 transition-opacity hover:bg-accent"
                                    onClick={(e) => e.stopPropagation()}
                                  >
                                    <Edit3 className="w-3 h-3" />
                                  </button>
                                </PopoverTrigger>
                                <PopoverContent side="bottom" align="start" className="w-40 p-1">
                                  <button
                                    type="button"
                                    className="w-full flex items-center gap-2 px-2 py-1.5 text-xs rounded hover:bg-accent transition-colors text-left"
                                    onClick={() => {
                                      const input = window.prompt(t("studioRenameScene"), t(tpl.nameKey as TranslationKey));
                                      if (!input?.trim()) return;
                                      renameUserScene(tpl.id, input.trim());
                                      setScenesVersion((v) => v + 1);
                                    }}
                                  >
                                    <Edit3 className="w-3 h-3 shrink-0" /> {t("studioRenameScene")}
                                  </button>
                                  <button
                                    type="button"
                                    className="w-full flex items-center gap-2 px-2 py-1.5 text-xs rounded hover:bg-accent transition-colors text-left"
                                    onClick={() => handleExportScene(tpl)}
                                  >
                                    <Download className="w-3 h-3 shrink-0" /> {t("studioDownloadScene")}
                                  </button>
                                  <button
                                    type="button"
                                    className="w-full flex items-center gap-2 px-2 py-1.5 text-xs rounded hover:bg-destructive/10 hover:text-destructive transition-colors text-left"
                                    onClick={() => setSceneDeleteConfirm({ id: tpl.id, name: t(tpl.nameKey as TranslationKey) || tpl.nameKey })}
                                  >
                                    <Trash2 className="w-3 h-3 shrink-0 text-destructive" /> {t("studioDeleteScene")}
                                  </button>
                                </PopoverContent>
                              </Popover>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </TabsContent>
                </Tabs>
              </TabsContent>

              {/* My Project: import + list */}
              <TabsContent value="my" className="flex-1 flex flex-col min-h-0 mt-2 data-[state=inactive]:hidden">
                <div className="shrink-0 mb-2">
                  <Button variant="outline" size="sm" className="w-full gap-1.5 text-xs" onClick={() => importInputRef.current?.click()}>
                    <Upload className="w-3.5 h-3.5" /> {t("studioImportProject")}
                  </Button>
                </div>
                <div className="flex-1 overflow-y-auto space-y-2 pr-1">
                  {projects.length === 0 ? (
                    <div className="text-center py-8 text-muted-foreground">
                      <FolderOpen className="w-8 h-8 mx-auto mb-2 opacity-40" />
                      <p className="text-xs">{t("studioNoProjects")}</p>
                    </div>
                  ) : projects.map((p) => {
                    const resBadge = getProjectResolutionBadge(p.zones);
                    return (
                      <div key={p.id} className={`flex items-center gap-3 p-3 rounded-lg border bg-card transition-colors ${currentProject?.id === p.id ? "border-primary" : "border-border"}`}>
                        <button className="flex-1 text-left min-w-0" onClick={() => { handleLoad(p); setMobilePanelOpen(false); }}>
                          <p className="text-sm font-medium text-foreground truncate">{p.name}</p>
                          <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                            <Badge variant="secondary" className="text-[10px] px-1.5 py-0">{p.aspect === "9:16" ? t("aspectPortrait") : t("aspectLandscape")}</Badge>
                            {resBadge && (
                              <Badge variant="outline" className="text-[10px] px-1.5 py-0 border-primary/40 text-primary" title={resBadge.dims}>
                                {resBadge.label}
                              </Badge>
                            )}
                            <span className="text-[11px] text-muted-foreground">{new Date(p.updated_at).toLocaleDateString()}</span>
                          </div>
                        </button>
                        <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" onClick={() => handleExport(p)} title={t("studioExportProject")}>
                          <Download className="w-3.5 h-3.5" />
                        </Button>
                        <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" onClick={() => handleDelete(p.id)}>
                          <Trash2 className="w-3.5 h-3.5 text-destructive" />
                        </Button>
                      </div>
                    );
                  })}
                </div>
              </TabsContent>
            </Tabs>
          </SheetContent>
        </Sheet>
      )}

      {/* Mobile: Tools Sheet (project actions, aspect, resolution, overlay) */}
      {isMobile && (
        <Sheet open={mobileToolsOpen} onOpenChange={setMobileToolsOpen}>
          <SheetContent side="bottom" className="max-h-[85vh] overflow-y-auto p-4">
            <SheetHeader>
              <SheetTitle className="text-base">{t("studioMobileTools")}</SheetTitle>
            </SheetHeader>
            <div className="mt-4 space-y-4">
              {/* Project actions */}
              <div className="grid grid-cols-3 gap-2">
                <Button variant="outline" size="sm" className="gap-1.5 text-xs h-10" onClick={() => { requestNew(); setMobileToolsOpen(false); }}>
                  <FilePlus className="w-3.5 h-3.5" /> {t("studioNew")}
                </Button>
                <Button variant="outline" size="sm" className="gap-1.5 text-xs h-10" onClick={() => { requestOpen(); setMobileToolsOpen(false); }}>
                  <FolderOpen className="w-3.5 h-3.5" /> {t("studioOpen")}
                </Button>
                <Button variant="default" size="sm" className="gap-1.5 text-xs h-10" disabled={saving || !mobileEditMode} title={!mobileEditMode ? t("studioMobileEditDisabledTip") : undefined}
                  onClick={() => { handleSaveClick(); setMobileToolsOpen(false); }}>
                  <Save className="w-3.5 h-3.5" /> {t("save")}
                </Button>
              </div>

              {/* Aspect */}
              <div>
                <label className="text-xs text-muted-foreground mb-1.5 block">{t("studioResRatio")}</label>
                <div className="grid grid-cols-2 gap-2">
                  <Button variant={aspect === "16:9" ? "default" : "outline"} size="sm" className="gap-1.5 text-xs h-10" disabled={!mobileEditMode}
                    onClick={() => changeAspect("16:9")}>
                    <Monitor className="w-3.5 h-3.5" /> {t("studioLandscape")}
                  </Button>
                  <Button variant={aspect === "9:16" ? "default" : "outline"} size="sm" className="gap-1.5 text-xs h-10" disabled={!mobileEditMode}
                    onClick={() => changeAspect("9:16")}>
                    <Smartphone className="w-3.5 h-3.5" /> {t("studioPortrait")}
                  </Button>
                </div>
              </div>

              {/* Resolution */}
              <div>
                <label className="text-xs text-muted-foreground mb-1.5 block">{t("studioResolution")}</label>
                <div className="flex items-center gap-1.5">
                  <Select
                    disabled={!mobileEditMode}
                    value={
                      RESOLUTION_PRESETS[aspect].some((r) => r.id === resolution.id && r.width === resolution.width && r.height === resolution.height)
                        ? resolution.id
                        : "custom"
                    }
                    onValueChange={handleSelectResolution}
                  >
                    <SelectTrigger className="h-10 text-xs flex-1">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {RESOLUTION_PRESETS[aspect].map((r) => (
                        <SelectItem key={r.id} value={r.id} className="text-xs">
                          <span className="font-medium">{t(r.labelKey as TranslationKey)}</span>
                          <span className="text-muted-foreground ml-2">{r.width}×{r.height}</span>
                        </SelectItem>
                      ))}
                      {lastCustomRes && (
                        <>
                          <div className="my-1 h-px bg-border" />
                          <SelectItem value="__last_custom__" className="text-xs">
                            <span className="font-medium">上次自訂</span>
                            <span className="text-muted-foreground ml-2">{lastCustomRes.w}×{lastCustomRes.h}</span>
                          </SelectItem>
                        </>
                      )}
                      {myPresets.length > 0 && (
                        <>
                          <div className="my-1 h-px bg-border" />
                          <div className="px-2 py-1 text-[10px] uppercase tracking-wide text-muted-foreground">我的預設</div>
                          {myPresets.map((p) => (
                            <SelectItem key={p.id} value={`__preset__:${p.id}`} className="text-xs">
                              <span className="font-medium">{p.name}</span>
                              <span className="text-muted-foreground ml-2">{p.w}×{p.h}</span>
                            </SelectItem>
                          ))}
                        </>
                      )}
                      <div className="my-1 h-px bg-border" />
                      <SelectItem
                        value="custom"
                        className="text-xs"
                        onPointerDown={(e) => {
                          e.preventDefault();
                          if (resolution.id === "custom") {
                            setCustomResW(String(resolution.width));
                            setCustomResH(String(resolution.height));
                          } else {
                            const stored = loadStoredCustomRes();
                            if (stored) {
                              setCustomResW(stored.w); setCustomResH(stored.h);
                              setCustomResRows(stored.rows); setCustomResCols(stored.cols);
                              setCustomResApplyGrid(stored.applyGrid);
                            }
                          }
                          setShowCustomResDialog(true);
                          (document.activeElement as HTMLElement | null)?.blur?.();
                        }}
                      >
                        <span className="font-medium">{t("studioResCustom")}</span>
                        {resolution.id === "custom" && (
                          <span className="text-muted-foreground ml-2">{resolution.width}×{resolution.height}</span>
                        )}
                        <Edit3 className="w-3 h-3 ml-2 inline-block text-muted-foreground" />
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {/* Overlay */}
              <Button variant="outline" size="sm" className="w-full gap-1.5 text-xs h-10"
                disabled={!mobileEditMode || zones.length + overlays.length >= 8}
                onClick={() => { addOverlay(); setMobileToolsOpen(false); }}
                title={!mobileEditMode ? t("studioMobileEditDisabledTip") : (zones.length + overlays.length >= 8 ? "已達區塊總數上限 (8)" : undefined)}>
                <Layers className="w-3.5 h-3.5" /> {t("studioAddOverlay")} <span className="ml-auto text-[10px] text-muted-foreground tabular-nums">{zones.length + overlays.length}/8</span>
              </Button>

              {!mobileEditMode && (
                <p className="text-[11px] text-muted-foreground text-center">{t("studioMobileEditDisabledTip")}</p>
              )}
            </div>
          </SheetContent>
        </Sheet>
      )}

      {/* Mobile: Zone editor sheet */}
      {isMobile && mobileEditMode && (
        <Sheet open={mobileEditorOpen && !!activeZone} onOpenChange={(o) => { if (!o) setSelectedZone(null); }}>
          <SheetContent side="bottom" className="h-[80vh] flex flex-col p-0">
            <SheetHeader className="px-4 pt-4 pb-2 shrink-0 border-b border-border">
              <SheetTitle className="text-base">{t("studioMobileEditZone")} · {activeZone?.label}</SheetTitle>
            </SheetHeader>
            <div className="flex-1 overflow-y-auto p-4">
              {activeZone && (
                <ZoneEditor zone={activeZone} onUpdate={(content) => updateZoneContent(activeZone.id, content)} onClose={() => setSelectedZone(null)} dbMedia={dbMedia} dbWidgets={dbWidgets} activeOrgId={activeOrgId} onMediaUploaded={loadMedia} isEmbedded existingVideoZoneLabel={existingVideoZoneLabel} />
              )}
            </div>
          </SheetContent>
        </Sheet>
      )}

      {/* Mobile: Overlay editor sheet */}
      {isMobile && mobileEditMode && (
        <Sheet open={mobileEditorOpen && !!activeOverlay} onOpenChange={(o) => { if (!o) setSelectedOverlay(null); }}>
          <SheetContent side="bottom" className="h-[80vh] flex flex-col p-0">
            <SheetHeader className="px-4 pt-4 pb-2 shrink-0 border-b border-border">
              <SheetTitle className="text-base flex items-center gap-2">
                {t("studioEditOverlay")} {activeOverlay?.label}
              </SheetTitle>
            </SheetHeader>
            <div className="flex-1 overflow-y-auto p-4 space-y-3">
              {activeOverlay && (
                <>
                  <Button variant={activeOverlay.locked ? "default" : "outline"} size="sm" className="w-full h-9 text-xs gap-1.5"
                    onClick={() => setOverlays((prev) => prev.map((o) => o.id === activeOverlay.id ? { ...o, locked: !o.locked } : o))}>
                    {activeOverlay.locked ? <Lock className="w-3.5 h-3.5" /> : <Unlock className="w-3.5 h-3.5" />}
                    {activeOverlay.locked ? t("studioLocked") : t("studioUnlocked")}
                  </Button>
                  <div>
                    <div className="flex items-center justify-between mb-1.5">
                      <label className="text-xs text-muted-foreground">{t("studioOpacity")}</label>
                      <span className="text-xs font-medium text-foreground">{activeOverlay.opacity ?? 100}%</span>
                    </div>
                    <Slider value={[activeOverlay.opacity ?? 100]} min={10} max={100} step={5}
                      onValueChange={([v]) => setOverlays((prev) => prev.map((o) => o.id === activeOverlay.id ? { ...o, opacity: v } : o))} />
                  </div>
                  {overlays.length > 1 && (
                    <div className="flex items-center justify-between">
                      <label className="text-xs text-muted-foreground">{t("studioLayerOrder")}</label>
                      <div className="flex items-center gap-1">
                        <Button variant="outline" size="sm" className="h-7 text-[10px] gap-1 px-2" onClick={() => moveOverlayLayer(activeOverlay.id, "down")}>
                          <ChevronLeft className="w-3 h-3" /> {t("studioLayerDown")}
                        </Button>
                        <Button variant="outline" size="sm" className="h-7 text-[10px] gap-1 px-2" onClick={() => moveOverlayLayer(activeOverlay.id, "up")}>
                          {t("studioLayerUp")} <ChevronRight className="w-3 h-3" />
                        </Button>
                      </div>
                    </div>
                  )}
                  <Button variant="destructive" size="sm" className="w-full h-9 text-xs gap-1.5"
                    onClick={() => { deleteOverlay(activeOverlay.id); }}>
                    <Trash2 className="w-3.5 h-3.5 text-destructive" /> {t("studioDeleteOverlay")}
                  </Button>
                  <div className="pt-2 border-t border-border">
                    <ZoneEditor zone={{ id: activeOverlay.id, x: 0, y: 0, w: 100, h: 100, label: activeOverlay.label, content: activeOverlay.content }}
                      onUpdate={(content) => updateOverlayContent(activeOverlay.id, content)}
                      onClose={() => setSelectedOverlay(null)} dbMedia={dbMedia} dbWidgets={dbWidgets} activeOrgId={activeOrgId} onMediaUploaded={loadMedia} isEmbedded existingVideoZoneLabel={existingVideoZoneLabel} />
                  </div>
                </>
              )}
            </div>
          </SheetContent>
        </Sheet>
      )}

      {/* Mobile: Media Library sheet */}
      {isMobile && (
        <Sheet open={mobileMediaOpen} onOpenChange={setMobileMediaOpen}>
          <SheetContent side="bottom" className="h-[80vh] flex flex-col p-0">
            <SheetHeader className="px-4 pt-4 pb-2 shrink-0 border-b border-border">
              <SheetTitle className="text-base flex items-center gap-2">
                <ImageIcon className="w-4 h-4 text-primary" /> {t("studioMobileMedia")}
              </SheetTitle>
            </SheetHeader>
            <div className="flex-1 overflow-hidden p-2">
              <MediaLibraryDock
                variant="side"
                dbMedia={dbMedia}
                dbWidgets={dbWidgets}
                activeOrgId={activeOrgId}
                onMediaUploaded={loadMedia}
                onAddItems={(items) => { addItemsToActiveTarget(items); }}
                selectedZoneLabel={activeZone?.label || activeOverlay?.label || null}
              />
            </div>
          </SheetContent>
        </Sheet>
      )}

      {/* Mobile: Timeline sheet */}
      {isMobile && (
        <Sheet open={mobileTimelineOpen} onOpenChange={setMobileTimelineOpen}>
          <SheetContent side="bottom" className="h-[70vh] flex flex-col p-0">
            <SheetHeader className="px-4 pt-4 pb-2 shrink-0 border-b border-border">
              <SheetTitle className="text-base flex items-center gap-2">
                <Layers className="w-4 h-4 text-primary" /> {t("studioMobileTimeline")}
              </SheetTitle>
            </SheetHeader>
            <div className="flex-1 overflow-hidden p-2">
              <ZoneTimeline
                dbMedia={dbMedia}
                activeOrgId={activeOrgId}
                onMediaUploaded={loadMedia}
                zones={zones}
                overlays={overlays}
                selectedZoneId={selectedZone}
                selectedOverlayId={selectedOverlay}
                onSelectZone={(id) => { setSelectedOverlay(null); setSelectedZone(id); }}
                onSelectOverlay={(id) => { setSelectedZone(null); setSelectedOverlay(id); }}
                onUpdateZoneContent={updateZoneContent}
                onUpdateOverlayContent={updateOverlayContent}
                onAddItemsToTarget={addItemsToSpecificTarget}
                bgmItems={bgmItems}
                bgmVolume={bgmVolume}
                bgmAudioSource={bgmAudioSource}
                onBgmItemsChange={setBgmItems}
                onBgmVolumeChange={setBgmVolume}
                onBgmAudioSourceChange={setBgmAudioSource}
                height={Math.round(window.innerHeight * 0.6)}
                onHeightChange={() => { /* fixed height in mobile sheet */ }}
              />
            </div>
          </SheetContent>
        </Sheet>
      )}

      {/* Preview Dialog */}
      <StudioPreviewDialog
        open={showPreviewDialog}
        onOpenChange={setShowPreviewDialog}
        editorW={W}
        editorH={H}
        resolutionLabel={`${aspect} · ${resolution.width}×${resolution.height}`}
        totalDurationSec={(() => {
          const sumItems = (items: MediaItem[] | undefined) =>
            (items || []).reduce((s, it) => s + Math.max(1, Math.round(it.duration || 5)), 0);
          // Use the longest track across all zones and overlays
          const durations = [
            ...zones.map((z) => sumItems(z.content?.mediaItems)),
            ...overlays.map((o) => sumItems(o.content?.mediaItems)),
          ].filter((d) => d > 0);
          const total = durations.length > 0 ? Math.max(...durations) : 0;
          return total > 0 ? total : 30;
        })()}
        bgmItems={bgmItems.map((b) => ({ id: b.id, url: b.url, name: b.name, duration: b.duration }))}
        bgmVolume={bgmVolume}
        bgmAudioSource={bgmAudioSource}
        renderStage={(playing) => (
          <div className="absolute inset-0" style={{ background: "hsl(0 0% 0%)" }}>
            {/* Zones */}
            {zones.map((zone) => {
              const mItems = zone.content?.mediaItems || [];
              const bg = zone.content?.bgColor || "hsl(0 0% 8%)";
              return (
                <div
                  key={zone.id}
                  className="absolute flex items-center justify-center overflow-hidden"
                  style={{
                    left: `${zone.x}%`, top: `${zone.y}%`, width: `${zone.w}%`, height: `${zone.h}%`,
                    background: bg,
                  }}
                >
                  {zone.content?.type === "media" && mItems.length > 0 ? (
                    <CarouselPreview items={mItems} transition={zone.content.carouselTransition || "fade"} fitMode={zone.content.fitMode || "cover-x"} unmuteVideo={bgmAudioSource !== "mute" && (bgmAudioSource === "bgm" || bgmAudioSource === `z-${zone.id}`)} playing={playing} />
                  ) : zone.content?.type === "widget" && zone.content.widgetConfig ? (
                    <ZoneAnimatedWrapper animation={zone.content.widgetConfig.animation}>
                      <WidgetZonePreview config={zone.content.widgetConfig} />
                    </ZoneAnimatedWrapper>
                  ) : zone.content?.type === "text" && zone.content.value ? (
                    <div className="p-3 w-full" style={{ color: zone.content.textColor || "hsl(0 0% 100%)", fontSize: zone.content.fontSize || 24, textAlign: zone.content.textAlign || "center" }}>
                      <span className="font-bold leading-tight whitespace-pre-line">{zone.content.value}</span>
                    </div>
                  ) : null}
                </div>
              );
            })}
            {/* Overlays */}
            {overlays.map((overlay) => {
              const mItems = overlay.content?.mediaItems || [];
              const bg = overlay.content?.bgColor || "transparent";
              return (
                <div
                  key={overlay.id}
                  className="absolute flex items-center justify-center overflow-hidden rounded-lg"
                  style={{
                    left: overlay.x, top: overlay.y, width: overlay.w, height: overlay.h,
                    background: bg,
                    opacity: (overlay.opacity ?? 100) / 100,
                    zIndex: 30 + (overlay.zIndex ?? 0),
                  }}
                >
                  {overlay.content?.type === "media" && mItems.length > 0 ? (
                    <CarouselPreview items={mItems} transition={overlay.content.carouselTransition || "fade"} fitMode={overlay.content.fitMode || "cover-x"} unmuteVideo={bgmAudioSource !== "mute" && (bgmAudioSource === "bgm" || bgmAudioSource === `o-${overlay.id}`)} playing={playing} />
                  ) : overlay.content?.type === "widget" && overlay.content.widgetConfig ? (
                    <ZoneAnimatedWrapper animation={overlay.content.widgetConfig.animation}>
                      <WidgetZonePreview config={overlay.content.widgetConfig} />
                    </ZoneAnimatedWrapper>
                  ) : overlay.content?.type === "text" && overlay.content.value ? (
                    <div className="p-2 w-full" style={{ color: overlay.content.textColor || "hsl(0 0% 100%)", fontSize: overlay.content.fontSize || 20, textAlign: overlay.content.textAlign || "center" }}>
                      <span className="font-bold leading-tight whitespace-pre-line">{overlay.content.value}</span>
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        )}
      />

      {/* Quick Publish Dialog */}
      <QuickPublishDialog
        open={quickPublishOpen}
        onClose={() => setQuickPublishOpen(false)}
        project={currentProject}
        isDirty={isDirty}
        onSaveFirst={async () => { await handleSave(); }}
        activeOrgId={activeOrgId}
        userId={user?.id}
      />

      {/* Quick Publish — pre-flight validation block dialog */}
      <AlertDialog open={qpBlockReason !== null} onOpenChange={(o) => { if (!o) setQpBlockReason(null); }}>
        <AlertDialogContent className="max-w-sm">
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <Rocket className="w-4 h-4 text-emerald-600 shrink-0" />
              {t("qpBlockTitle")}
            </AlertDialogTitle>
            <AlertDialogDescription className="pt-1">
              {qpBlockReason === "unsaved" && t("qpBlockUnsaved")}
              {qpBlockReason === "no_zones" && t("qpBlockNoZones")}
              {qpBlockReason === "empty_zones" && t("qpBlockEmptyZones")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="gap-2 sm:gap-2">
            <AlertDialogCancel>{t("cancel")}</AlertDialogCancel>
            {qpBlockReason === "unsaved" && (
              <AlertDialogAction
                onClick={() => {
                  setQpBlockReason(null);
                  if (currentProject) handleSave();
                  else openSaveDialogForNew();
                }}
              >
                <Save className="w-3.5 h-3.5 mr-1.5" /> {t("save")}
              </AlertDialogAction>
            )}
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Save pre-flight: design not complete */}
      <AlertDialog open={saveBlockReason !== null} onOpenChange={(o) => { if (!o) setSaveBlockReason(null); }}>
        <AlertDialogContent className="max-w-sm">
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <Save className="w-4 h-4 shrink-0" />
              {t("saveBlockTitle")}
            </AlertDialogTitle>
            <AlertDialogDescription className="pt-1">
              {saveBlockReason === "no_zones" && t("saveBlockNoZones")}
              {saveBlockReason === "empty_zones" && t("saveBlockEmptyZones")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("cancel")}</AlertDialogCancel>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Unsaved-changes confirmation */}
      <AlertDialog open={pendingDestructiveAction !== null} onOpenChange={(o) => { if (!o) setPendingDestructiveAction(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("studioUnsavedTitle")}</AlertDialogTitle>
            <AlertDialogDescription>{t("studioUnsavedDesc")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="gap-2 sm:gap-2">
            <AlertDialogCancel>{t("cancel")}</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={confirmDestructiveAction}
            >
              {t("studioUnsavedDiscard")}
            </AlertDialogAction>
            <AlertDialogAction
              onClick={(e) => { e.preventDefault(); void saveAndConfirmDestructive(); }}
              disabled={saving}
            >
              <Save className="w-4 h-4 mr-1.5" /> {t("studioUnsavedSaveAndLeave")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Page-switch confirmation */}
      <AlertDialog open={pendingPageSwitch !== null} onOpenChange={(o) => { if (!o) setPendingPageSwitch(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("studioPageSwitchTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("studioPageSwitchDesc").replace(
                "{name}",
                pages.find((p) => p.id === pendingPageSwitch)?.name ?? ""
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (pendingPageSwitch) {
                  doSwitchPage(pendingPageSwitch);
                  setPendingPageSwitch(null);
                }
              }}
            >
              {t("studioPageSwitchConfirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Library apply confirmation (layout template or scene template) */}
      <AlertDialog open={pendingApply !== null} onOpenChange={(o) => { if (!o) setPendingApply(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {pendingApply?.kind === "template" ? t("studioApplyTemplateTitle") : t("studioApplyLayoutTitle")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {pendingApply?.kind === "template"
                ? t("studioApplyTemplateDesc").replace("{name}", t(pendingApply.tpl.nameKey as TranslationKey))
                : pendingApply?.kind === "layout"
                  ? t("studioApplyLayoutDesc").replace("{name}", t(pendingApply.preset.nameKey as TranslationKey))
                  : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (!pendingApply) return;
                // Auto-name the project if not yet named
                if (!currentProject && !projectName) {
                  setProjectName(generateProjectName(projects.map((p) => p.name || "")));
                }
                if (pendingApply.kind === "layout") {
                  doApplyLayout(pendingApply.preset);
                  if (pendingApply.mobileClose) setMobilePanelOpen(false);
                } else {
                  doApplyTemplate(pendingApply.tpl);
                  if (pendingApply.mobileClose) setMobilePanelOpen(false);
                }
                setPendingApply(null);
              }}
            >
              {t("studioApplyConfirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Unsaved-changes navigation guard — click-intercept for HashRouter */}
      <AlertDialog
        open={pendingNavHref !== null}
        onOpenChange={(o) => { if (!o) setPendingNavHref(null); }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("studioUnsavedLeaveTitle")}</AlertDialogTitle>
            <AlertDialogDescription>{t("studioUnsavedLeaveDesc")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="gap-2 sm:gap-2">
            <AlertDialogCancel onClick={() => setPendingNavHref(null)}>{t("cancel")}</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={confirmLeave}
            >
              {t("studioUnsavedDiscard")}
            </AlertDialogAction>
            <AlertDialogAction
              onClick={(e) => { e.preventDefault(); void saveAndLeave(); }}
              disabled={saving}
            >
              <Save className="w-4 h-4 mr-1.5" /> {t("studioUnsavedSaveAndLeave")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Preview-requires-save prompt */}
      <AlertDialog open={showPreviewSavePrompt} onOpenChange={setShowPreviewSavePrompt}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("studioPreviewSaveTitle")}</AlertDialogTitle>
            <AlertDialogDescription>{t("studioPreviewSaveDesc")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setShowPreviewSavePrompt(false);
                if (currentProject) {
                  handleSave();
                } else {
                  openSaveDialogForNew();
                }
              }}
            >
              {t("save")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Delete project confirmation with reference summary */}
      <AlertDialog open={deleteConfirm !== null} onOpenChange={(o) => { if (!o) setDeleteConfirm(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {deleteConfirm?.queued
                ? t("studioDeleteRequestedTitle")
                : deleteConfirm && (deleteConfirm.channels.length + deleteConfirm.media.length + deleteConfirm.schedules.length) > 0
                  ? t("studioDeleteBlockedTitle")
                  : t("studioDeleteConfirmTitle")}
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3">
                {deleteConfirm?.name && (
                  <div className="text-sm font-medium text-foreground">{deleteConfirm.name}</div>
                )}
                {deleteConfirm?.queued && (
                  <div className="text-xs text-muted-foreground">{t("studioDeleteRequestedDesc")}</div>
                )}
                {deleteConfirm && (deleteConfirm.channels.length + deleteConfirm.media.length + deleteConfirm.schedules.length) > 0 ? (
                  <>
                    <div>{t("studioDeleteRefSummary")}:</div>
                    <ul className="space-y-2 text-sm">
                      {([
                        { items: deleteConfirm.channels,  labelKey: "studioDeleteBoundChannel"  as const },
                        { items: deleteConfirm.schedules, labelKey: "studioDeleteBoundSchedule" as const },
                        { items: deleteConfirm.media,     labelKey: "studioDeleteBoundMedia"    as const },
                      ] as const).map(({ items, labelKey }) =>
                        items.length > 0 ? (
                          <li key={labelKey}>
                            <div className="font-medium text-foreground">
                              {t(labelKey)} ({items.length} {t("studioDeleteRefCount")})
                            </div>
                            <ul className="mt-1 space-y-1">
                              {items.map((it, i) => {
                                const key = JSON.stringify(it.unassign ?? {}) + i;
                                const busy = deleteConfirm.busyKey === JSON.stringify(it.unassign ?? {});
                                return (
                                  <li key={key} className="flex items-center justify-between gap-2 text-muted-foreground">
                                    <span className="truncate">{it.name}</span>
                                    {it.unassign && (
                                      <Button
                                        size="sm"
                                        variant="outline"
                                        className="h-7 px-2 text-xs shrink-0"
                                        disabled={busy}
                                        onClick={() => handleUnassignReference(it)}
                                      >
                                        {t("studioDeleteUnassignBtn")}
                                      </Button>
                                    )}
                                  </li>
                                );
                              })}
                            </ul>
                          </li>
                        ) : null,
                      )}
                    </ul>
                  </>
                ) : (
                  <div>{t("studioDeleteConfirmDesc")}</div>
                )}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("studioDeleteCancelBtn")}</AlertDialogCancel>
            {deleteConfirm && (deleteConfirm.channels.length + deleteConfirm.media.length + deleteConfirm.schedules.length) === 0 ? (
              <AlertDialogAction
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                onClick={confirmDeleteProject}
              >
                {t("studioDeleteConfirmBtn")}
              </AlertDialogAction>
            ) : deleteConfirm?.queued ? (
              <Button variant="outline" onClick={handleCancelQueuedDelete}>
                {t("studioDeleteCancelRequestBtn")}
              </Button>
            ) : (
              <Button
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                onClick={handleQueueDelete}
              >
                {t("studioDeleteRequestBtn")}
              </Button>
            )}
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Save Dialog */}

      {/* Scene delete confirmation dialog */}
      <AlertDialog open={!!sceneDeleteConfirm} onOpenChange={(o) => { if (!o) setSceneDeleteConfirm(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("studioDeleteSceneConfirmTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("studioDeleteSceneConfirmDesc").replace("{name}", sceneDeleteConfirm?.name ?? "")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("cancel")}</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                if (!sceneDeleteConfirm) return;
                deleteUserScene(sceneDeleteConfirm.id);
                setScenesVersion((v) => v + 1);
                setSceneDeleteConfirm(null);
              }}
            >
              {t("studioDeleteScene")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Auto-draft recovery dialog */}
      <AlertDialog open={draftRecoveryOpen} onOpenChange={(o) => { if (!o) { clearStudioDraft(); draftToRestoreRef.current = null; setDraftRecoveryOpen(false); } }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("studioDraftTitle")}</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-1.5 text-sm">
                <p>{t("studioDraftDesc")}</p>
                {draftToRestoreRef.current?.projectName && (
                  <p className="text-foreground font-medium">
                    {t("studioDraftProject").replace("{name}", draftToRestoreRef.current.projectName)}
                  </p>
                )}
                {draftToRestoreRef.current?.savedAt && (
                  <p className="text-xs text-muted-foreground">
                    {t("studioDraftTime").replace("{time}", new Date(draftToRestoreRef.current.savedAt).toLocaleString())}
                  </p>
                )}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => { clearStudioDraft(); draftToRestoreRef.current = null; }}>
              {t("studioDraftDiscard")}
            </AlertDialogCancel>
            <AlertDialogAction onClick={handleRecoverDraft}>
              {t("studioDraftRestore")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Manual export download dialog (iframe-safe) */}
      <Dialog
        open={!!exportDownload}
        onOpenChange={(open) => { if (!open) setExportDownload(null); }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("studioExportProject")}</DialogTitle>
            <DialogDescription>
              ZIP 已準備好，請點擊下方連結下載到您的電腦。
            </DialogDescription>
          </DialogHeader>
          {exportDownload && (
            <div className="mt-2 space-y-3">
              <div className="rounded-md border bg-muted/40 p-3 text-sm">
                <div className="font-medium break-all">{exportDownload.filename}</div>
                <div className="text-xs text-muted-foreground mt-1">
                  {formatBytesCompact(exportDownload.sizeBytes)}
                </div>
              </div>
              <a
                href={exportDownload.url}
                download={exportDownload.filename}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex w-full items-center justify-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition"
              >
                <Download className="w-4 h-4" />
                下載 ZIP
              </a>
              <p className="text-xs text-muted-foreground">
                若點擊後沒反應，請在新分頁中右鍵 →「另存連結為…」。連結將於 5 分鐘後失效。
              </p>
            </div>
          )}
          <DialogFooter className="mt-4">
            <Button variant="outline" onClick={() => setExportDownload(null)}>
              關閉
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {/* Project-level page transition (switching condition) settings — applies to all pages */}
      <Dialog open={transitionDialogOpen} onOpenChange={setTransitionDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("studioPageTransitionTitle")}</DialogTitle>
            <DialogDescription>{t("studioPageTransitionDesc")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label className="text-xs font-medium">{t("studioPageTransitionMode")}</Label>
              <div className="grid grid-cols-1 gap-2">
                {([
                  { v: "auto", title: t("studioPageTransitionAuto"), desc: t("studioPageTransitionAutoDesc") },
                  { v: "fixed", title: t("studioPageTransitionFixed"), desc: t("studioPageTransitionFixedDesc") },
                  { v: "trigger", title: t("studioPageTransitionTrigger"), desc: t("studioPageTransitionTriggerDesc") },
                ] as const).map((opt) => {
                  const active = projectTransition.mode === opt.v;
                  return (
                    <button
                      key={opt.v}
                      type="button"
                      onClick={() => updateProjectTransition({ mode: opt.v })}
                      className={`text-left p-3 rounded-md border transition-colors ${active ? "border-primary bg-primary/5" : "border-border hover:bg-muted/40"}`}
                    >
                      <div className="text-sm font-medium">{opt.title}</div>
                      <div className="text-xs text-muted-foreground mt-0.5">{opt.desc}</div>
                    </button>
                  );
                })}
              </div>
            </div>

            {projectTransition.mode === "fixed" && (
              <div className="space-y-2">
                <Label className="text-xs font-medium">{t("studioPageTransitionSeconds")}</Label>
                <Input
                  type="number"
                  min={1}
                  max={3600}
                  value={projectTransition.seconds}
                  onChange={(e) => {
                    const n = parseInt(e.target.value, 10);
                    if (!isNaN(n) && n > 0) updateProjectTransition({ seconds: Math.min(3600, n) });
                  }}
                  className="h-8"
                />
              </div>
            )}

            {/* Trigger switch — always visible; works alongside any time mode */}
            <div className="space-y-3">
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label className="text-xs font-medium">{t("studioPageTransitionTriggers")}</Label>
                  {projectTransition.mode !== "trigger" && (
                    <span className="text-[10px] text-muted-foreground">{t("studioPageTriggerNote")}</span>
                  )}
                </div>
                <div className="space-y-2 rounded-md border border-border p-3">
                  {([
                    { k: "gpio" as const, label: t("studioPageTriggerGpio") },
                    { k: "remote" as const, label: t("studioPageTriggerRemote") },
                    { k: "api" as const, label: t("studioPageTriggerApi") },
                  ]).map((row) => (
                    <div key={row.k} className="flex items-center justify-between">
                      <span className="text-sm">{row.label}</span>
                      <Switch
                        checked={!!projectTransition.triggers[row.k]}
                        onCheckedChange={(v) => updateProjectTransition({ triggers: { [row.k]: !!v } as Partial<PageTransition["triggers"]> })}
                      />
                    </div>
                  ))}
                </div>
              </div>
              {(projectTransition.triggers.gpio || projectTransition.triggers.remote) && pages.length > 0 && (
                <div className="space-y-1.5">
                  <Label className="text-xs font-medium">{t("studioPageTriggerChannels")}</Label>
                  <div className="rounded-md border border-border divide-y divide-border text-xs">
                    {pages.map((p, i) => (
                      <div key={p.id} className="flex items-center justify-between px-3 py-1.5">
                        <span className="font-medium truncate max-w-[140px]">{p.name}</span>
                        <span className="text-muted-foreground tabular-nums flex gap-2 shrink-0">
                          {projectTransition.triggers.gpio && <span>GPIO {i}</span>}
                          {projectTransition.triggers.remote && <span>{t("studioPageTriggerRemoteCode")} {String(i + 1).padStart(2, "0")}</span>}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {pages.length <= 1 && (projectTransition.mode === "auto" || projectTransition.mode === "fixed") && (
              <div className="text-[11px] text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-md px-3 py-2">
                {t("studioPageTransitionOnlyMulti")}
              </div>
            )}

            <div className="text-[11px] text-muted-foreground border-t border-border pt-2">
              {t("studioPageTransitionFallback")}
            </div>
          </div>
          <DialogFooter>
            <Button onClick={() => { setTransitionDialogOpen(false); toast.success(t("studioPageTransitionSaved")); }}>
              {t("studioPageTransitionDone")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showSaveDialog} onOpenChange={setShowSaveDialog}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{currentProject ? t("studioEditProjectSettings") : t("studioSaveProject")}</DialogTitle>
            <DialogDescription>{t("studioSaveDesc")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-3 mt-2">
            <Input placeholder={t("studioProjectNamePlaceholder")} value={projectName} onChange={(e) => setProjectName(e.target.value)} autoFocus />
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">{t("screensTeam")}</label>
              <Select value={projectTeamId} onValueChange={setProjectTeamId}>
                <SelectTrigger><SelectValue placeholder={t("screensSelectTeam")} /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">{t("teamNoTeamLabel")}</SelectItem>
                  {teams.map((tm) => (
                    <SelectItem key={tm.id} value={tm.id}>
                      {tm.name === "Default" ? t("teamNoTeamLabel") : tm.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">{t("studioCollab")}</label>
              <Select value={projectCollab} onValueChange={(v) => setProjectCollab(v as "creator" | "team" | "org")}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="creator"><span className="inline-flex items-center gap-2"><UserIcon className="w-3.5 h-3.5" />{t("studioCollabCreator")}</span></SelectItem>
                  <SelectItem value="team" disabled={!projectTeamId || projectTeamId === "none"}>
                    <span className="inline-flex items-center gap-2"><Users className="w-3.5 h-3.5" />{t("studioCollabTeam")}</span>
                  </SelectItem>
                  <SelectItem value="org"><span className="inline-flex items-center gap-2"><Building2 className="w-3.5 h-3.5" />{t("studioCollabOrg")}</span></SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter className="mt-4">
            <Button variant="outline" onClick={() => { postSaveActionRef.current = null; setShowSaveDialog(false); }}>{t("cancel")}</Button>
            <Button onClick={handleSaveFromDialog} disabled={!projectName.trim() || saving}><Save className="w-4 h-4 mr-1.5" /> {t("save")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Load Dialog */}
      <Dialog open={showLoadDialog} onOpenChange={setShowLoadDialog}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{t("studioOpenProject")}</DialogTitle>
            <DialogDescription>{t("studioOpenDesc")}</DialogDescription>
          </DialogHeader>
          <div className="max-h-64 overflow-y-auto space-y-2 mt-2">
            {projects.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-6">{t("studioNoProjects")}</p>
            ) : projects.map((p) => {
              const resBadge = getProjectResolutionBadge(p.zones);
              return (
              <button key={p.id} onClick={() => handleLoad(p)} className="w-full flex items-center justify-between p-3 rounded-lg border border-border hover:bg-accent transition-colors text-left">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <p className="text-sm font-medium text-foreground truncate">{p.name}</p>
                    {resBadge && (
                      <Badge
                        variant="outline"
                        className="text-[10px] px-1.5 py-0 border-primary/40 text-primary shrink-0"
                        title={resBadge.dims}
                      >
                        {resBadge.label}
                      </Badge>
                    )}
                  </div>
                  <p className="text-[11px] text-muted-foreground mt-0.5">{p.aspect === "9:16" ? t("aspectPortrait") : t("aspectLandscape")} · {new Date(p.updated_at).toLocaleString()}</p>
                </div>
                <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0 ml-2" />
              </button>
              );
            })}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
