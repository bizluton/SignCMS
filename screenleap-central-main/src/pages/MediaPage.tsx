import React, { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { useSearchParams, Link } from "react-router-dom";
import { useUserRole } from "@/hooks/useUserRole";
import { useUserOrgs } from "@/hooks/useUserOrgs";
import { useOrgLicense } from "@/hooks/useOrgLicense";
import { useOrgPlan, PLAN_LABELS, formatBytes } from "@/hooks/useOrgPlan";
import { PlanUsageBar } from "@/components/PlanUsageBar";
import { useLanguage } from "@/contexts/LanguageContext";
import { useActiveOrg } from "@/contexts/ActiveOrgContext";
import { useProfiles } from "@/contexts/ProfilesContext";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { translatePlanLimitError } from "@/lib/planLimitError";
import {
  checkMediaReferences,
  checkMediaReferencesBatch,
  type MediaProjectRef,
} from "@/lib/referenceCheck";
import { computeFileMd5, isAcceptableImage, isAcceptableVideo, isAcceptableAudio, validateVideoSpec, validateImageSpec, tryNormalizeImage } from "@/lib/fileHash";
import { probeVideoMeta } from "@/lib/videoTranscode";
import {
  formatBytes as formatMediaBytes,
  formatDimensions,
  formatDuration,
  getDurationSec,
  getSizeBytes,
} from "@/lib/mediaFormat";
import {
  Upload,
  Trash2,
  Search,
  Grid3X3,
  List,
  Eye,
  FileImage,
  FileVideo,
  Music,
  Clock,
  HardDrive,
  Loader2,
  FolderOpen,
  Pencil,
  Plus,
  Settings2,
  Code2,
  Calendar,
  Globe,
  Type,
  CloudSun,
  QrCode,
  Timer,
  Youtube,
  Hash,
  User,
  Users,
  Building2,
  Info,
  CheckSquare,
  Square,
  Download,
  X,
  Trash,
  RotateCcw,
  History,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { Switch } from "@/components/ui/switch";
import { DialogClose } from "@/components/ui/dialog";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { useMediaTags, MediaTagFilter, MediaTagEditor } from "@/components/media/MediaTagControls";
import { VideoThumb } from "@/components/media/VideoThumb";
import { MediaEmptyState } from "@/components/media/MediaEmptyState";
import { Progress } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { toast } from "sonner";
import { logActivity } from "@/lib/activityLogger";
import { useWidgets, widgetsToMediaRows } from "@/hooks/useWidgets";

type MediaType = "image" | "video" | "widget" | "audio";

interface MediaItemRow {
  id: string;
  name: string;
  original_name?: string | null;
  type: MediaType;
  url?: string;
  thumbnail?: string | null;
  // Canonical numeric fields (Phase 3: legacy text fields removed)
  size_bytes?: number | null;
  width?: number | null;
  height?: number | null;
  duration_seconds?: number | null;
  created_at: string;
  design_project_id?: string | null;
  is_system?: boolean;
  md5?: string | null;
  mime_type?: string | null;
  uploaded_by?: string | null;
  // Transcode tracking
  transcode_status?: string | null;
  source_fps?: number | null;
  source_bitrate?: number | null;
  source_codec?: string | null;
  source_container?: string | null;
  transcode_error?: string | null;
}

interface ProjectItem {
  id: string;
  name: string;
  zones?: unknown;
}

const getDisplayName = (item: Pick<MediaItemRow, "name" | "original_name">) => item.original_name?.trim() || item.name;

type MediaItemDetails = Pick<MediaItemRow, "url" | "thumbnail">;

const NONE_PROJECT_VALUE = "__none__";

type WidgetSubType = "date" | "clock" | "webpage" | "marquee" | "qrcode" | "countdown" | "youtube" | "weather";
type WidgetAnimation = "none" | "fadeIn" | "slideUp" | "bounce" | "zoomIn" | "flipIn";

interface WidgetConfig {
  widgetType: WidgetSubType;
  url?: string;
  text?: string;
  speed?: "slow" | "normal" | "fast";
  format?: "12" | "24";
  clockStyle?: "digital" | "analog";
  showDate?: boolean;
  timezone?: string;
  bgColor?: string;
  textColor?: string;
  qrcodeContent?: string;
  targetDate?: string;
  countdownTitle?: string;
  youtubeUrl?: string;
  city?: string;
  fontSize?: "small" | "medium" | "large" | "xlarge";
  qrcodeSize?: number;
  animation?: WidgetAnimation;
}

const WIDGET_ICONS: Record<WidgetSubType, React.ComponentType<{ className?: string }>> = {
  date: Calendar, clock: Clock, webpage: Globe, marquee: Type, qrcode: QrCode, countdown: Timer, youtube: Youtube, weather: CloudSun,
};

const TIMEZONE_OPTIONS = [
  { value: "Asia/Taipei", label: "Asia/Taipei (UTC+8)" },
  { value: "Asia/Tokyo", label: "Asia/Tokyo (UTC+9)" },
  { value: "America/New_York", label: "America/New_York (UTC-5)" },
  { value: "America/Los_Angeles", label: "America/Los_Angeles (UTC-8)" },
  { value: "Europe/London", label: "Europe/London (UTC+0)" },
  { value: "Europe/Berlin", label: "Europe/Berlin (UTC+1)" },
  { value: "Asia/Shanghai", label: "Asia/Shanghai (UTC+8)" },
  { value: "Asia/Singapore", label: "Asia/Singapore (UTC+8)" },
  { value: "Australia/Sydney", label: "Australia/Sydney (UTC+11)" },
];

const defaultWidgetForm: {
  name: string; widgetType: WidgetSubType; url: string; text: string;
  speed: "slow" | "normal" | "fast"; format: "12" | "24";
  clockStyle: "digital" | "analog"; showDate: boolean; timezone: string;
  bgColor: string; textColor: string; qrcodeContent: string; targetDate: string;
  countdownTitle: string; youtubeUrl: string; city: string;
  fontSize: "small" | "medium" | "large" | "xlarge"; qrcodeSize: number;
  animation: WidgetAnimation; projectId: string;
} = {
  name: "",
  widgetType: "clock",
  url: "",
  text: "",
  speed: "normal",
  format: "24",
  clockStyle: "digital",
  showDate: true,
  timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  bgColor: "#1a1a2e",
  textColor: "#ffffff",
  qrcodeContent: "",
  targetDate: "",
  countdownTitle: "",
  youtubeUrl: "",
  city: "",
  fontSize: "medium",
  qrcodeSize: 128,
  animation: "none",
  projectId: NONE_PROJECT_VALUE,
};

function parseWidgetConfig(url: string): WidgetConfig | null {
  if (!url?.startsWith("widget://")) return null;
  try { return JSON.parse(url.replace("widget://", "")); } catch { return null; }
}

// ── Widget Preview (lightweight) ───────────────────────────────────
function WidgetPreviewCard({ config }: { config: WidgetConfig }) {
  const [now, setNow] = useState(new Date());

  useEffect(() => {
    if (config.widgetType === "clock" || config.widgetType === "date" || config.widgetType === "countdown") {
      const timer = setInterval(() => setNow(new Date()), 1000);
      return () => clearInterval(timer);
    }
  }, [config.widgetType]);

  const bg = config.bgColor || "#1a1a2e";
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
            <polygon points={`${100 + 45 * Math.cos((hDeg - 90) * Math.PI / 180)},${100 + 45 * Math.sin((hDeg - 90) * Math.PI / 180)} ${100 + 5 * Math.cos(hDeg * Math.PI / 180)},${100 + 5 * Math.sin(hDeg * Math.PI / 180)} ${100 - 10 * Math.cos((hDeg - 90) * Math.PI / 180)},${100 - 10 * Math.sin((hDeg - 90) * Math.PI / 180)} ${100 - 5 * Math.cos(hDeg * Math.PI / 180)},${100 - 5 * Math.sin(hDeg * Math.PI / 180)}`} fill={fg} opacity="0.9" />
            <polygon points={`${100 + 65 * Math.cos((mDeg - 90) * Math.PI / 180)},${100 + 65 * Math.sin((mDeg - 90) * Math.PI / 180)} ${100 + 4 * Math.cos(mDeg * Math.PI / 180)},${100 + 4 * Math.sin(mDeg * Math.PI / 180)} ${100 - 12 * Math.cos((mDeg - 90) * Math.PI / 180)},${100 - 12 * Math.sin((mDeg - 90) * Math.PI / 180)} ${100 - 4 * Math.cos(mDeg * Math.PI / 180)},${100 - 4 * Math.sin(mDeg * Math.PI / 180)}`} fill={fg} opacity="0.85" />
            <line x1={100 - 18 * Math.cos((sDeg - 90) * Math.PI / 180)} y1={100 - 18 * Math.sin((sDeg - 90) * Math.PI / 180)} x2={100 + 72 * Math.cos((sDeg - 90) * Math.PI / 180)} y2={100 + 72 * Math.sin((sDeg - 90) * Math.PI / 180)} stroke="hsl(0 70% 55%)" strokeWidth="1.2" strokeLinecap="round" />
            <circle cx="100" cy="100" r="5" fill={fg} />
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
    return (
      <div className="w-full h-full flex items-center overflow-hidden" style={{ background: bg, color: fg }}>
        <div className={`animate-marquee whitespace-nowrap ${zfs.marquee} font-medium`}>{config.text}</div>
      </div>
    );
  }

  if (config.widgetType === "webpage") {
    return (
      <div className="w-full h-full flex flex-col items-center justify-center gap-1" style={{ background: bg, color: fg }}>
        <Globe className="w-6 h-6 opacity-50" />
        <span className="text-[10px] opacity-60 truncate max-w-[80%]">{config.url || "URL"}</span>
      </div>
    );
  }

  if (config.widgetType === "qrcode") {
    const qrSize = config.qrcodeSize ? Math.min(config.qrcodeSize, 120) : 80;
    return (
      <div className="w-full h-full flex items-center justify-center" style={{ background: bg }}>
        <QRCodeSVG value={config.qrcodeContent || "https://example.com"} size={qrSize} bgColor={bg} fgColor={fg} level="M" />
      </div>
    );
  }

  if (config.widgetType === "countdown") {
    const target = config.targetDate ? new Date(config.targetDate).getTime() : Date.now() + 86400000;
    const diff = Math.max(0, target - now.getTime());
    const days = Math.floor(diff / 86400000);
    const hours = Math.floor((diff % 86400000) / 3600000);
    const mins = Math.floor((diff % 3600000) / 60000);
    const secs = Math.floor((diff % 60000) / 1000);
    return (
      <div className="w-full h-full flex flex-col items-center justify-center gap-1" style={{ background: bg, color: fg }}>
        {config.countdownTitle && <span className={`${zfs.title} font-bold opacity-70`}>{config.countdownTitle}</span>}
        <div className="flex gap-2">
          {[days, hours, mins, secs].map((v, i) => (
            <span key={i} className={`${zfs.countdown} font-mono font-bold`}>{String(v).padStart(2, "0")}</span>
          ))}
        </div>
      </div>
    );
  }

  if (config.widgetType === "youtube") {
    return (
      <div className="w-full h-full flex items-center justify-center" style={{ background: bg, color: fg }}>
        <Youtube className="w-8 h-8 opacity-50" />
      </div>
    );
  }

  if (config.widgetType === "weather") {
    return (
      <div className="w-full h-full flex flex-col items-center justify-center gap-1" style={{ background: bg, color: fg }}>
        <CloudSun className="w-8 h-8 opacity-50" />
        <span className="text-[10px] font-medium">{config.city || "City"}</span>
      </div>
    );
  }

  return (
    <div className="w-full h-full flex items-center justify-center" style={{ background: bg, color: fg }}>
      <Code2 className="w-6 h-6 opacity-50" />
    </div>
  );
}

const getPreviewIcon = (type: MediaType) => {
  if (type === "image") return <FileImage className="w-10 h-10 text-muted-foreground" />;
  if (type === "video") return <FileVideo className="w-10 h-10 text-muted-foreground" />;
  if (type === "audio") return <Music className="w-10 h-10 text-muted-foreground" />;
  return <FolderOpen className="w-10 h-10 text-muted-foreground" />;
};

// Detect Creative Commons BY-attributed audio (e.g. Kevin MacLeod tracks named "... (CC BY 4.0).mp3")
const isCcByAudio = (item: { type: string; original_name?: string; name?: string }) => {
  if (item.type !== "audio") return false;
  const src = `${item.original_name || ""} ${item.name || ""}`;
  return /cc\s*by\s*4\.?0/i.test(src) || /kevin\s*macleod/i.test(src);
};

const getTypeBadgeVariant = (type: MediaType) => (type === "widget" ? "default" : "secondary");

const MediaPage = () => {
  const { t, language } = useLanguage();
  const { tier: planTier, limits: planLimits } = useOrgPlan();
  const { user } = useAuth();
  const { isAdmin, isOrgAdmin, isCsAgent, loading: roleLoading } = useUserRole();
  const { orgs, defaultOrgId } = useUserOrgs();
  const { license } = useOrgLicense();
  // 媒體開放給組織內所有成員（含一般 user），授權過期則禁用
  const canManageMedia = !license?.expired && (isAdmin || isOrgAdmin || isCsAgent || (orgs && orgs.length > 0));
  const { activeOrgId } = useActiveOrg();
  const { ensureProfiles, getProfile, profilesVersion } = useProfiles();
  const { widgets: catalogWidgets } = useWidgets();

  const fileInputRef = useRef<HTMLInputElement>(null);

  const [media, setMedia] = useState<MediaItemRow[]>([]);
  const [projects, setProjects] = useState<ProjectItem[]>([]);
  // mediaId -> schedules referencing it (fetched from schedule_items for visible media)
  const [mediaScheduleMap, setMediaScheduleMap] = useState<Map<string, { id: string; name: string }[]>>(new Map());
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  // Filters are persisted in the URL (so refresh + share-link work) and mirrored to
  // localStorage as a fallback for first visits.
  const FILTERS_KEY = "signcms_media_filters_v1";
  const lsFilters = (() => {
    try { return JSON.parse(localStorage.getItem(FILTERS_KEY) || "{}"); } catch { return {}; }
  })();
  const [searchParams, setSearchParams] = useSearchParams();

  const initialSearch = searchParams.get("q") ?? lsFilters.search ?? "";
  const initialType = searchParams.get("type") ?? lsFilters.typeFilter ?? "all";
  const initialOwner = searchParams.get("owner") ?? lsFilters.ownerFilter ?? "all";
  const initialTagsParam = searchParams.get("tags");
  const initialTags = initialTagsParam
    ? initialTagsParam.split(",").filter(Boolean)
    : Array.isArray(lsFilters.tagFilter) ? lsFilters.tagFilter : [];
  const initialView = (searchParams.get("view") as "grid" | "list" | null) ?? lsFilters.viewMode ?? "grid";

  const [search, setSearch] = useState<string>(initialSearch);
  const [typeFilter, setTypeFilter] = useState<string>(initialType);
  const [ownerFilter, setOwnerFilter] = useState<string>(initialOwner);
  const [tagFilter, setTagFilter] = useState<string[]>(initialTags);
  const [viewMode, setViewMode] = useState<"grid" | "list">(initialView);

  // Sync state → URL (replace, no history spam) + localStorage mirror.
  useEffect(() => {
    const next = new URLSearchParams(searchParams);
    const setOrDelete = (key: string, value: string, defaultValue: string) => {
      if (value && value !== defaultValue) next.set(key, value);
      else next.delete(key);
    };
    setOrDelete("q", search, "");
    setOrDelete("type", typeFilter, "all");
    setOrDelete("owner", ownerFilter, "all");
    setOrDelete("view", viewMode, "grid");
    if (tagFilter.length > 0) next.set("tags", tagFilter.join(","));
    else next.delete("tags");
    if (next.toString() !== searchParams.toString()) {
      setSearchParams(next, { replace: true });
    }
    try {
      localStorage.setItem(
        FILTERS_KEY,
        JSON.stringify({ search, typeFilter, ownerFilter, tagFilter, viewMode }),
      );
    } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, typeFilter, ownerFilter, tagFilter, viewMode]);

  const [previewItem, setPreviewItem] = useState<MediaItemRow | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [transcodeRequestingId, setTranscodeRequestingId] = useState<string | null>(null);
  // Bulk selection state
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkDeleteConfirmText, setBulkDeleteConfirmText] = useState("");
  const [deleteUsage, setDeleteUsage] = useState<{ schedules: string[]; projects: string[] } | null>(null);
  const [checkingUsage, setCheckingUsage] = useState(false);
  const [widgetDialogOpen, setWidgetDialogOpen] = useState(false);
  const [widgetForm, setWidgetForm] = useState(defaultWidgetForm);
  const [orgLicense, setOrgLicense] = useState<{ license_plan: string; license_expires_at: string } | null>(null);
  const [teammateIds, setTeammateIds] = useState<Set<string>>(new Set());

  // Trash (soft-deleted media) state
  type TrashRow = {
    id: string;
    name: string;
    original_name: string | null;
    type: string;
    thumbnail: string | null;
    size_bytes: number | null;
    deleted_at: string;
    org_id: string;
  };
  const [trashOpen, setTrashOpen] = useState(false);
  const [trashRows, setTrashRows] = useState<TrashRow[]>([]);
  const [trashLoading, setTrashLoading] = useState(false);
  const [trashBusyId, setTrashBusyId] = useState<string | null>(null);
  const [purgeConfirmId, setPurgeConfirmId] = useState<string | null>(null);
  const [restoreConfirmId, setRestoreConfirmId] = useState<string | null>(null);
  const [trashSearch, setTrashSearch] = useState("");
  const [trashOrgFilter, setTrashOrgFilter] = useState<string>("__active__");
  const [trashDateFrom, setTrashDateFrom] = useState<string>("");
  const [trashDateTo, setTrashDateTo] = useState<string>("");
  const [, setTrashTick] = useState(0);
  useEffect(() => {
    if (!trashOpen) return;
    const id = window.setInterval(() => setTrashTick((n) => n + 1), 60_000);
    return () => window.clearInterval(id);
  }, [trashOpen]);
  const [trashSelectedIds, setTrashSelectedIds] = useState<Set<string>>(new Set());
  const [trashBulkBusy, setTrashBulkBusy] = useState(false);
  // Configured trash retention window (days). Read from
  // schedule_cleanup_settings.media_retention_days so the countdown shown to
  // the user always matches the value set in System Settings → Media Cleanup.
  // Falls back to 7 if the row is missing or the read fails.
  const [trashRetentionDays, setTrashRetentionDays] = useState<number>(7);
  const [bulkRestoreConfirmOpen, setBulkRestoreConfirmOpen] = useState(false);
  const [bulkPurgeConfirmOpen, setBulkPurgeConfirmOpen] = useState(false);
  const [bulkPurgeConfirmText, setBulkPurgeConfirmText] = useState("");
  type BulkResultItem = { id: string; name: string; ok: boolean; error?: string | null };
  type BulkResult = { action: "restore" | "purge"; items: BulkResultItem[] } | null;
  const [bulkResult, setBulkResult] = useState<BulkResult>(null);
  useEffect(() => { if (!bulkPurgeConfirmOpen) setBulkPurgeConfirmText(""); }, [bulkPurgeConfirmOpen]);
  useEffect(() => { if (!trashOpen) setTrashSelectedIds(new Set()); }, [trashOpen]);
  useEffect(() => { if (!bulkDeleteOpen) setBulkDeleteConfirmText(""); }, [bulkDeleteOpen]);

  // ---- Trash audit log (reads activity_logs filtered by media restore/purge events) ----
  type TrashAuditRow = {
    id: string;
    created_at: string;
    user_id: string;
    org_id: string | null;
    action_code: string;
    target_id: string | null;
    target_name: string | null;
    detail: string | null;
    action_params: Record<string, unknown> | null;
  };
  const [trashAuditOpen, setTrashAuditOpen] = useState(false);
  const [trashAuditRows, setTrashAuditRows] = useState<TrashAuditRow[]>([]);
  const [trashAuditLoading, setTrashAuditLoading] = useState(false);
  const [trashAuditError, setTrashAuditError] = useState<string | null>(null);
  const [trashAuditActionFilter, setTrashAuditActionFilter] = useState<"__all__" | "restore" | "purge">("__all__");

  const fetchTrashAudit = useCallback(async () => {
    setTrashAuditLoading(true);
    setTrashAuditError(null);
    let q = supabase
      .from("activity_logs")
      .select("id, created_at, user_id, org_id, action_code, target_id, target_name, detail, action_params")
      .in("action_code", ["media.restore_soft_deleted", "media.purge_soft_deleted_item"])
      .order("created_at", { ascending: false })
      .limit(100);
    if (trashOrgFilter !== "__all__") {
      const orgScope = trashOrgFilter === "__active__" ? activeOrgId : trashOrgFilter;
      if (orgScope) q = q.eq("org_id", orgScope);
    }
    const { data, error } = await q;
    if (error) {
      setTrashAuditError(error.message);
      setTrashAuditRows([]);
    } else {
      const rows = (data || []) as TrashAuditRow[];
      setTrashAuditRows(rows);
      const ids = Array.from(new Set(rows.map((r) => r.user_id).filter(Boolean)));
      if (ids.length > 0) void ensureProfiles(ids);
    }
    setTrashAuditLoading(false);
  }, [trashOrgFilter, activeOrgId, ensureProfiles]);

  useEffect(() => {
    if (trashOpen && trashAuditOpen) void fetchTrashAudit();
  }, [trashOpen, trashAuditOpen, fetchTrashAudit]);

  const filteredTrashAuditRows = useMemo(() => {
    if (trashAuditActionFilter === "__all__") return trashAuditRows;
    const code = trashAuditActionFilter === "restore"
      ? "media.restore_soft_deleted"
      : "media.purge_soft_deleted_item";
    return trashAuditRows.filter((r) => r.action_code === code);
  }, [trashAuditRows, trashAuditActionFilter]);

  const toggleTrashSelected = useCallback((id: string) => {
    setTrashSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  const fetchTrash = useCallback(async () => {
    setTrashLoading(true);
    let q = supabase
      .from("media_items")
      .select("id, name, original_name, type, thumbnail, size_bytes, deleted_at, org_id")
      .not("deleted_at", "is", null)
      .order("deleted_at", { ascending: false });
    if (trashOrgFilter === "__active__") {
      if (!activeOrgId) {
        setTrashRows([]);
        setTrashLoading(false);
        return;
      }
      q = q.eq("org_id", activeOrgId);
    } else if (trashOrgFilter !== "__all__") {
      q = q.eq("org_id", trashOrgFilter);
    }
    const { data, error } = await q;
    if (error) toast.error(error.message);
    else setTrashRows((data || []) as TrashRow[]);
    setTrashLoading(false);
  }, [activeOrgId, trashOrgFilter]);

  useEffect(() => {
    if (trashOpen) void fetchTrash();
  }, [trashOpen, fetchTrash]);

  // Load configured retention window each time the trash dialog opens, so the
  // countdown immediately reflects any change made in System Settings without
  // requiring a page reload.
  useEffect(() => {
    if (!trashOpen) return;
    let cancelled = false;
    const loadRetention = async () => {
      const { data } = await supabase
        .from("schedule_cleanup_settings")
        .select("media_retention_days")
        .eq("id", 1)
        .maybeSingle();
      if (!cancelled && data?.media_retention_days) {
        setTrashRetentionDays(Number(data.media_retention_days));
      }
    };
    void loadRetention();

    // Live-update the retention window if a system admin changes it in
    // System Settings while the trash dialog is open.
    const channel = supabase
      .channel("schedule_cleanup_settings_changes")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "schedule_cleanup_settings" },
        (payload) => {
          const next = (payload.new as { media_retention_days?: number } | null)?.media_retention_days;
          if (next) {
            setTrashRetentionDays(Number(next));
            setTrashTick((n) => n + 1);
          } else {
            void loadRetention();
          }
        },
      )
      .subscribe();

    return () => {
      cancelled = true;
      void supabase.removeChannel(channel);
    };
  }, [trashOpen]);

  const orgNameById = useMemo(() => {
    const m = new Map<string, string>();
    (orgs || []).forEach((o) => m.set(o.id, o.name));
    return m;
  }, [orgs]);

  const filteredTrashRows = useMemo(() => {
    const q = trashSearch.trim().toLowerCase();
    const fromTs = trashDateFrom ? new Date(trashDateFrom + "T00:00:00").getTime() : null;
    const toTs = trashDateTo ? new Date(trashDateTo + "T23:59:59.999").getTime() : null;
    return trashRows.filter((r) => {
      if (q) {
        const name = (r.original_name || r.name || "").toLowerCase();
        if (!name.includes(q)) return false;
      }
      if (fromTs !== null || toTs !== null) {
        const ts = new Date(r.deleted_at).getTime();
        if (fromTs !== null && ts < fromTs) return false;
        if (toTs !== null && ts > toTs) return false;
      }
      return true;
    });
  }, [trashRows, trashSearch, trashDateFrom, trashDateTo]);

  const resetTrashFilters = useCallback(() => {
    setTrashSearch("");
    setTrashOrgFilter("__active__");
    setTrashDateFrom("");
    setTrashDateTo("");
  }, []);

  const runBulkTrashAction = useCallback(async (
    action: "restore" | "purge",
    explicitIds?: string[],
  ) => {
    const ids = explicitIds ?? Array.from(trashSelectedIds);
    if (ids.length === 0) return;
    const nameById = new Map(trashRows.map((r) => [r.id, r.original_name || r.name] as const));
    setTrashBulkBusy(true);
    const rpcName = action === "restore" ? "restore_soft_deleted_media" : "purge_soft_deleted_media_item";
    const results: BulkResultItem[] = [];
    const succeededIds: string[] = [];
    for (const id of ids) {
      const { data, error } = await supabase.rpc(rpcName as "restore_soft_deleted_media", { _media_id: id });
      const rpcResult = data as { success?: boolean; error?: string } | null;
      const success = !error && rpcResult?.success !== false;
      const name = nameById.get(id) || id.slice(0, 8);
      if (success) {
        succeededIds.push(id);
        results.push({ id, name, ok: true });
      } else {
        const errMsg = error?.message || rpcResult?.error || "unknown_error";
        results.push({ id, name, ok: false, error: errMsg });
      }
    }
    setTrashBulkBusy(false);
    setTrashRows((rows) => rows.filter((r) => !succeededIds.includes(r.id)));
    setTrashSelectedIds((prev) => {
      const next = new Set(prev);
      succeededIds.forEach((id) => next.delete(id));
      return next;
    });
    if (action === "restore" && succeededIds.length > 0) fetchAllRef.current();
    const okCount = results.filter((r) => r.ok).length;
    const failCount = results.length - okCount;
    let msg = t("mediaTrashBulkResultSuccess").replace("{ok}", String(okCount));
    if (failCount > 0) msg += t("mediaTrashBulkResultFailed").replace("{fail}", String(failCount));
    if (failCount > 0 && okCount === 0) toast.error(msg);
    else toast.success(msg);
    setBulkResult({ action, items: results });
  }, [trashSelectedIds, trashRows, t]);

  const fetchAllRef = useRef<() => void>(() => {});
  const handleRestore = useCallback(async (id: string) => {
    setTrashBusyId(id);
    const { data, error } = await supabase.rpc("restore_soft_deleted_media", { _media_id: id });
    setTrashBusyId(null);
    if (error) {
      toast.error(error.message);
      return;
    }
    const res = data as { success?: boolean; error?: string } | null;
    if (!res?.success) {
      toast.error(res?.error ?? "restore_failed");
      return;
    }
    toast.success(t("mediaTrashRestored"));
    setTrashRows((rows) => rows.filter((r) => r.id !== id));
    fetchAllRef.current();
  }, [t]);

  const handlePurgeNow = useCallback(async (id: string) => {
    setTrashBusyId(id);
    const { data, error } = await supabase.rpc("purge_soft_deleted_media_item", { _media_id: id });
    setTrashBusyId(null);
    setPurgeConfirmId(null);
    if (error) {
      toast.error(error.message);
      return;
    }
    const res = data as { success?: boolean; error?: string } | null;
    if (!res?.success) {
      toast.error(res?.error ?? "purge_failed");
      return;
    }
    toast.success(t("mediaTrashPurged"));
    setTrashRows((rows) => rows.filter((r) => r.id !== id));
  }, [t]);

  // Compute the absolute expiry instant from a soft-delete timestamp using
  // the currently configured retention window. Centralised so the countdown
  // and the formatted purge date can never diverge.
  const computeTrashExpiryMs = useCallback((deletedAt: string): number => {
    const days = Math.max(1, trashRetentionDays || 7);
    return new Date(deletedAt).getTime() + days * 24 * 60 * 60 * 1000;
  }, [trashRetentionDays]);

  const formatTrashRemaining = useCallback((deletedAt: string): string => {
    const remaining = computeTrashExpiryMs(deletedAt) - Date.now();
    if (remaining <= 0) return "0 " + t("mediaTrashHours");
    const hours = Math.floor(remaining / (60 * 60 * 1000));
    if (hours >= 24) return `${Math.floor(hours / 24)} ${t("mediaTrashDays")}`;
    return `${hours} ${t("mediaTrashHours")}`;
  }, [t, computeTrashExpiryMs]);

  // Standardised purge timestamp shown to all users: YYYY/MM/DD HH:mm in the
  // viewer's local timezone, regardless of UI language. We append the IANA
  // timezone label so users always know which clock the date refers to.
  const formatTrashExpiryDate = useCallback((deletedAt: string): string => {
    const expiresAt = new Date(computeTrashExpiryMs(deletedAt));
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
    const parts = new Intl.DateTimeFormat("en-CA", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
      timeZone: tz,
    }).formatToParts(expiresAt);
    const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
    return `${get("year")}/${get("month")}/${get("day")} ${get("hour")}:${get("minute")} (${tz})`;
  }, [computeTrashExpiryMs]);

  // Per-org media tags + per-item tag map
  const realMediaIds = useMemo(
    () => media.filter((m) => !m.is_system && !!m.id).map((m) => m.id),
    [media],
  );
  const { tags: allMediaTags, itemTags, refresh: refreshTags } = useMediaTags(activeOrgId, realMediaIds);

  const renderOwnerBadge = useCallback((item: MediaItemRow) => {
    if (item.is_system || !item.uploaded_by) return null;
    if (user?.id && item.uploaded_by === user.id) {
      return <User className="w-3.5 h-3.5 text-primary" aria-label={t("mediaOwnerSelf")} />;
    }
    if (teammateIds.has(item.uploaded_by)) {
      return <Users className="w-3.5 h-3.5 text-foreground" aria-label={t("mediaOwnerTeam")} />;
    }
    return <Building2 className="w-3.5 h-3.5 text-muted-foreground" aria-label={t("mediaOwnerOrg")} />;
  }, [user?.id, teammateIds, t]);

  // Fetch media, projects and org license in parallel for fastest first paint
  const fetchAll = useCallback(async () => {
    setLoading(true);
    let mediaQ = supabase
      .from("media_items")
      .select("id, name, original_name, type, url, thumbnail, size_bytes, width, height, duration_seconds, created_at, design_project_id, is_system, org_id, md5, mime_type, uploaded_by, transcode_status, source_fps, source_bitrate, source_codec, source_container, transcode_error")
      .is("deleted_at", null)
      .order("created_at", { ascending: false });
    let projectsQ = supabase
      .from("design_projects")
      .select("id, name, org_id, zones")
      .order("name", { ascending: true });
    if (activeOrgId) {
      mediaQ = mediaQ.eq("org_id", activeOrgId);
      projectsQ = projectsQ.eq("org_id", activeOrgId);
    }
    const licenseQ = activeOrgId
      ? supabase.from("organizations").select("license_plan, license_expires_at").eq("id", activeOrgId).single()
      : Promise.resolve({ data: null, error: null });

    // Load teammates: every user_id sharing at least one team with current user
    const teammatesQ = user?.id
      ? (async () => {
          const { data: myTeams } = await supabase
            .from("team_members").select("team_id").eq("user_id", user.id);
          const teamIds = (myTeams || []).map((r) => r.team_id);
          if (teamIds.length === 0) return { data: [] as { user_id: string }[] };
          const { data: members } = await supabase
            .from("team_members").select("user_id").in("team_id", teamIds);
          return { data: (members || []) as { user_id: string }[] };
        })()
      : Promise.resolve({ data: [] as { user_id: string }[] });

    const [mediaRes, projectsRes, licenseRes, teammatesRes] = await Promise.all([mediaQ, projectsQ, licenseQ, teammatesQ]);

    if (mediaRes.error) toast.error(mediaRes.error.message);
    else {
      // Inject catalog widgets (system + app + user-of-org) at top — read-only entries
      const catRows = widgetsToMediaRows(catalogWidgets, activeOrgId) as unknown as MediaItemRow[];
      setMedia([...catRows, ...((mediaRes.data || []) as MediaItemRow[])]);
    }

    if (projectsRes.error) toast.error(projectsRes.error.message);
    else setProjects((projectsRes.data || []) as ProjectItem[]);

    if (licenseRes && licenseRes.data) setOrgLicense(licenseRes.data as { license_plan: string; license_expires_at: string });

    const ids = new Set<string>((teammatesRes.data || []).map((r) => r.user_id));
    if (user?.id) ids.add(user.id);
    setTeammateIds(ids);

    // Preload profiles for everyone who uploaded media in this org via global cache
    const uploaderIds = ((mediaRes.data || []) as MediaItemRow[])
      .map((m) => m.uploaded_by)
      .filter((v): v is string => !!v);
    if (uploaderIds.length > 0) {
      // Fire-and-forget — context updates trigger re-render via profilesVersion
      ensureProfiles(uploaderIds);
    }

    setLoading(false);
  }, [activeOrgId, user?.id, ensureProfiles, t, catalogWidgets]);

  const openPreview = useCallback(async (item: MediaItemRow) => {
    setPreviewItem(item);
    setPreviewLoading(false);
  }, []);

  // Backwards-compatible aliases used elsewhere in the file
  const fetchMedia = fetchAll;
  const fetchProjects = fetchAll;

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  useEffect(() => {
    fetchAllRef.current = fetchAll;
  }, [fetchAll]);

  const filteredMedia = useMemo(() => {
    return media.filter((item) => {
      const displayName = getDisplayName(item).toLowerCase();
      const matchesSearch = displayName.includes(search.toLowerCase());
      const matchesType = typeFilter === "all" || item.type === typeFilter;

      let matchesOwner = true;
      if (ownerFilter !== "all") {
        if (item.is_system || !item.uploaded_by) matchesOwner = false;
        else if (ownerFilter === "self") matchesOwner = item.uploaded_by === user?.id;
        else if (ownerFilter === "team")
          matchesOwner = item.uploaded_by !== user?.id && teammateIds.has(item.uploaded_by);
        else if (ownerFilter === "org") matchesOwner = !teammateIds.has(item.uploaded_by);
      }

      let matchesTag = true;
      if (tagFilter.length > 0) {
        const ids = itemTags.get(item.id) || [];
        // OR semantics: keep item if it has any of the selected tags
        matchesTag = ids.some((id) => tagFilter.includes(id));
      }

      return matchesSearch && matchesType && matchesOwner && matchesTag;
    });
  }, [media, search, typeFilter, ownerFilter, tagFilter, itemTags, user?.id, teammateIds]);

  const stats = useMemo(() => {
    const images = media.filter((item) => item.type === "image").length;
    const videos = media.filter((item) => item.type === "video").length;
    const audios = media.filter((item) => item.type === "audio").length;
    const widgets = media.filter((item) => item.type === "widget").length;

    // Total storage — prefer numeric size_bytes, fallback to legacy text size.
    let totalBytes = 0;
    for (const item of media) totalBytes += getSizeBytes(item);

    return { images, videos, audios, widgets, totalBytes };
  }, [media]);

  const projectNameMap = useMemo(() => {
    return new Map(projects.map((project) => [project.id, project.name]));
  }, [projects]);

  /**
   * Map: mediaId → list of design projects that REFERENCE this media inside their
   * zones / overlays / bgmItems (i.e. the file is used in the project, not just owned by it).
   */
  const mediaUsageMap = useMemo(() => {
    const map = new Map<string, { id: string; name: string }[]>();
    const collectIds = (node: unknown, out: Set<string>) => {
      if (!node || typeof node !== "object") return;
      if (Array.isArray(node)) { node.forEach((n) => collectIds(n, out)); return; }
      const obj = node as Record<string, unknown>;
      if (Array.isArray(obj.mediaItems)) {
        for (const m of obj.mediaItems) if (m && typeof m === "object" && (m as Record<string, unknown>).id) out.add(String((m as Record<string, unknown>).id));
      }
      if (Array.isArray(obj.bgmItems)) {
        for (const b of obj.bgmItems) if (b && typeof b === "object" && (b as Record<string, unknown>).id) out.add(String((b as Record<string, unknown>).id));
      }
      if (Array.isArray(obj.overlays)) {
        for (const o of obj.overlays) collectIds((o as Record<string, unknown>)?.content, out);
      }
      if (obj.content) collectIds(obj.content, out);
    };
    for (const p of projects) {
      const ids = new Set<string>();
      const zones = Array.isArray(p.zones) ? p.zones : [];
      for (const z of zones) collectIds(z, ids);
      // Also walk top-level zones structure for project-level overlays/bgm if present
      collectIds(p.zones, ids);
      ids.forEach((mediaId) => {
        const arr = map.get(mediaId) || [];
        if (!arr.some((x) => x.id === p.id)) arr.push({ id: p.id, name: p.name });
        map.set(mediaId, arr);
      });
    }
    return map;
  }, [projects]);

  // Fetch schedule references for currently-visible (non-system, non-widget) media so each
  // card can show a compact "used in schedules" summary alongside design-project chips.
  useEffect(() => {
    const ids = media.filter((m) => !m.is_system && m.type !== "widget").map((m) => m.id);
    if (ids.length === 0) { setMediaScheduleMap(new Map()); return; }
    let cancelled = false;
    (async () => {
      const fromTable = (table: string) => supabase.from(table as Parameters<typeof supabase.from>[0]);
      const { data, error } = await fromTable("schedule_items")
        .select("media_id, schedules:schedule_id(id, name)")
        .in("media_id", ids);
      if (cancelled || error || !Array.isArray(data)) return;
      const map = new Map<string, { id: string; name: string }[]>();
      for (const row of data) {
        const mid = row?.media_id; const s = row?.schedules;
        if (!mid || !s?.id || !s?.name) continue;
        const arr = map.get(mid) || [];
        if (!arr.some((x) => x.id === s.id)) arr.push({ id: s.id, name: s.name });
        map.set(mid, arr);
      }
      setMediaScheduleMap(map);
    })();
    return () => { cancelled = true; };
  }, [media]);

  const getProjectName = (projectId?: string | null) => {
    if (!projectId) return t("mediaNoProject");
    return projectNameMap.get(projectId) || t("mediaNoProject");
  };

  const handleUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const isImage = isAcceptableImage(file);
    const isVideo = !isImage && isAcceptableVideo(file);
    const isAudio = !isImage && !isVideo && isAcceptableAudio(file);

    if (!isImage && !isVideo && !isAudio) {
      toast.error(t("mediaUnsupported"));
      event.target.value = "";
      return;
    }

    // Check storage capacity limit (plan_tier based)
    if (planLimits.mediaBytes >= 0 && stats.totalBytes + file.size > planLimits.mediaBytes) {
      toast.error(t("mediaStorageFull") as string);
      event.target.value = "";
      return;
    }

    // Allow up to 50 MB via edge function
    const MAX_FILE_SIZE = 50 * 1024 * 1024;
    if (file.size > MAX_FILE_SIZE) {
      toast.error(t("mediaFileTooLarge"));
      event.target.value = "";
      return;
    }

    setUploading(true);
    let workingFile: File = file;

    try {
      // Probe metadata client-side before uploading.
      // Canonical fields sent to the edge function: width, height, duration_seconds.
      let width = 0;
      let height = 0;
      let durationSec = 0;
      // Transcode detection (populated below for video files)
      let sourceFps = 0;
      let sourceBitrate = 0;
      let sourceCodec = "";
      let sourceContainer = "";
      let needsTranscode = false;

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

        // 規格驗證：尺寸 / 大小 / 色彩空間
        let spec = await validateImageSpec(workingFile, { width: imgMeta.w, height: imgMeta.h });

        // 自動修復：超大 / 超尺寸 / CMYK 都嘗試 canvas 轉成 sRGB JPEG 並壓到 ≤5MB
        if (spec.ok === false && (spec.reason === "tooLarge" || spec.reason === "resolution" || spec.reason === "cmyk")) {
          const normalized = await tryNormalizeImage(workingFile);
          if (normalized) {
            workingFile = normalized;
            imgMeta = await probeImage(workingFile);
            width = imgMeta.w;
            height = imgMeta.h;
            spec = await validateImageSpec(workingFile, { width: imgMeta.w, height: imgMeta.h });
            if (spec.ok !== false) {
              toast.success(t("mediaImageAutoConverted") as string);
            }
          } else {
            toast.error(t("mediaImageAutoConvertFailed") as string);
            setUploading(false);
            event.target.value = "";
            return;
          }
        }

        if (spec.ok === false) {
          const key =
            spec.reason === "resolution" ? "mediaImageSpecResolution"
            : spec.reason === "tooLarge" ? "mediaImageSpecTooLarge"
            : "mediaImageSpecCmyk";
          toast.error(`${t(key) as string}（${spec.detail}）`);
          setUploading(false);
          event.target.value = "";
          return;
        }
        if (spec.ok && spec.warning === "tooSmall") {
          toast.warning(t("mediaImageSpecTooSmall") as string);
        }
      }

      if (isVideo) {
        const objectUrl = URL.createObjectURL(file);
        const videoMeta = await new Promise<{ width: number; height: number; durationSec: number }>((resolve) => {
          const video = document.createElement("video");
          video.preload = "metadata";
          video.muted = true;
          // 安全網：5 秒內沒觸發 loadedmetadata 就放棄
          const timer = setTimeout(() => {
            resolve({ width: 0, height: 0, durationSec: 0 });
            URL.revokeObjectURL(objectUrl);
          }, 5000);
          video.onloadedmetadata = () => {
            clearTimeout(timer);
            const raw = video.duration;
            const valid = Number.isFinite(raw) && raw > 0;
            const w = video.videoWidth || 0;
            const h = video.videoHeight || 0;
            resolve({
              width: w,
              height: h,
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
        width = videoMeta.width;
        height = videoMeta.height;
        durationSec = videoMeta.durationSec;

        // 規格驗證：解析度 / 位元率 / 幀率
        const spec = await validateVideoSpec(file, {
          width: videoMeta.width,
          height: videoMeta.height,
          durationSec: videoMeta.durationSec,
        });
        if (spec.ok === false) {
          const key =
            spec.reason === "resolution" ? "mediaVideoSpecResolution"
            : spec.reason === "bitrate" ? "mediaVideoSpecBitrate"
            : "mediaVideoSpecFps";
          toast.error(`${t(key) as string}（${spec.detail}）`);
          setUploading(false);
          event.target.value = "";
          return;
        }

        // Deep probe with MediaInfo.js to detect fps/bitrate/codec for transcode gating
        const probe = await probeVideoMeta(file);
        sourceFps = probe.fps;
        sourceBitrate = probe.bitrate;
        sourceCodec = probe.codec;
        sourceContainer = probe.container;
        needsTranscode = probe.needsTranscode;
        // Use MediaInfo dimensions if native element returned 0
        if (width === 0 && probe.width > 0) width = probe.width;
        if (height === 0 && probe.height > 0) height = probe.height;
      }

      if (isAudio) {
        const objectUrl = URL.createObjectURL(file);
        const audioMeta = await new Promise<{ durationSec: number }>((resolve) => {
          const audio = document.createElement("audio");
          audio.preload = "metadata";
          const timer = setTimeout(() => {
            resolve({ durationSec: 0 });
            URL.revokeObjectURL(objectUrl);
          }, 5000);
          audio.onloadedmetadata = () => {
            clearTimeout(timer);
            const raw = audio.duration;
            const valid = Number.isFinite(raw) && raw > 0;
            resolve({ durationSec: valid ? raw : 0 });
            URL.revokeObjectURL(objectUrl);
          };
          audio.onerror = () => {
            clearTimeout(timer);
            resolve({ durationSec: 0 });
            URL.revokeObjectURL(objectUrl);
          };
          audio.src = objectUrl;
        });
        durationSec = audioMeta.durationSec;
      }

      // Upload via edge function (bypasses REST payload limit)
      const uploadOrgId = activeOrgId || defaultOrgId;
      if (!uploadOrgId) { toast.error(t("teamSelectOrg")); setUploading(false); event.target.value = ""; return; }

      // Compute MD5 of the file (used as the storage filename + duplicate-detection key)
      const md5 = await computeFileMd5(workingFile);

      // Pre-check duplicate within the same org BEFORE uploading
      const dup = await supabase
        .from("media_items")
        .select("id, original_name")
        .eq("org_id", uploadOrgId)
        .eq("md5", md5)
        .eq("size_bytes", workingFile.size)
        .limit(1)
        .maybeSingle();

      if (dup?.data) {
        toast.error(`${t("mediaDuplicate") as string}: ${dup.data.original_name || file.name}`);
        setUploading(false);
        event.target.value = "";
        return;
      }

      const formData = new FormData();
      formData.append("file", workingFile);
      formData.append("name", workingFile.name);
      formData.append("original_name", file.name);
      formData.append("md5", md5);
      formData.append("type", isImage ? "image" : isVideo ? "video" : "audio");
      if (width > 0) formData.append("width", String(width));
      if (height > 0) formData.append("height", String(height));
      if (durationSec > 0) formData.append("duration_seconds", String(durationSec));
      formData.append("org_id", uploadOrgId);
      if (isVideo) {
        if (sourceFps > 0) formData.append("source_fps", String(sourceFps));
        if (sourceBitrate > 0) formData.append("source_bitrate", String(sourceBitrate));
        if (sourceCodec) formData.append("source_codec", sourceCodec);
        if (sourceContainer) formData.append("source_container", sourceContainer);
        formData.append("needs_transcode", String(needsTranscode));
      }

      const session = await supabase.auth.getSession();
      const accessToken = session.data.session?.access_token;

      const res = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/upload-media`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
          body: formData,
        }
      );

      const result = await res.json();

      if (!res.ok || result.error) {
        if (result.error === "media_capacity_exceeded") {
          toast.error(t("planLimitMedia"));
        } else if (result.error === "duplicate_file") {
          toast.error(`${t("mediaDuplicate") as string}: ${result.original_name || file.name}`);
        } else {
          toast.error(result.error || t("mediaUnsupported"));
        }
      } else {
        if (result.transcode_status === "pending_transcode") {
          toast.success(`${t("mediaUploaded")}：${file.name}`, { description: t("transcodeUploadNote") as string });
        } else {
          toast.success(`${t("mediaUploaded")}：${file.name}`);
        }
        logActivity({ action: "upload_media", category: "media", targetName: file.name });
        fetchAll();
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("mediaUnsupported"));
    } finally {
      setUploading(false);
      event.target.value = "";
    }
  };

  const checkMediaUsage = async (mediaId: string) => {
    setCheckingUsage(true);
    setDeleteUsage(null);

    // Build the in-memory list of design projects that reference this media
    // (either as a direct owner via design_project_id, or through zones/overlays/bgm).
    const item = media.find((m) => m.id === mediaId);
    const projectRefs: MediaProjectRef[] = [];
    if (item?.design_project_id) {
      const pName = projectNameMap.get(item.design_project_id);
      if (pName) projectRefs.push({ id: item.design_project_id, name: pName });
    }
    for (const p of mediaUsageMap.get(mediaId) || []) {
      projectRefs.push({ id: p.id, name: p.name });
    }

    const report = await checkMediaReferences(mediaId, projectRefs);
    const projects = report.groups.find((g) => g.kind === "project")?.names ?? [];
    const schedules = report.groups.find((g) => g.kind === "schedule")?.names ?? [];
    setDeleteUsage({ schedules, projects });
    setCheckingUsage(false);
  };

  const requestDelete = async (itemId: string) => {
    const item = media.find((m) => m.id === itemId);
    if (item?.is_system) {
      toast.error(t("widgetSystemCannotDelete"));
      return;
    }
    setDeleteId(itemId);
    await checkMediaUsage(itemId);
  };

  const handleRequestTranscode = async (mediaId: string) => {
    setTranscodeRequestingId(mediaId);
    toast.info(t("transcodeStarting") as string);
    try {
      const session = await supabase.auth.getSession();
      const accessToken = session.data.session?.access_token;
      const res = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/request-transcode`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ media_id: mediaId }),
        },
      );
      const result = await res.json();
      if (!res.ok || result.error) {
        if (result.error === "worker_not_configured") {
          toast.error(t("transcodeWorkerNotConfigured") as string);
        } else {
          toast.error(t("transcodeRequestFailed") as string);
        }
      } else {
        toast.success(t("transcodeRequested") as string);
        fetchAll();
      }
    } catch {
      toast.error(t("transcodeRequestFailed") as string);
    } finally {
      setTranscodeRequestingId(null);
    }
  };

  const handleDelete = async () => {
    if (!deleteId) return;
    // Block delete if in use
    if (deleteUsage && (deleteUsage.schedules.length > 0 || deleteUsage.projects.length > 0)) return;

    const item = media.find((entry) => entry.id === deleteId);
    // Soft-delete: mark as trashed instead of hard-deleting. Items remain
    // restorable for 7 days from the trash dialog. Physical storage files are
    // kept intact until the trash entry is restored or purged.
    const { error } = await supabase
      .from("media_items")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", deleteId)
      .is("deleted_at", null);

    if (error) {
      toast.error(error.message);
    } else {
      toast.success(`${t("mediaDeleted")}：${item?.name || ""}`);
      logActivity({ action: "soft_delete_media", category: "media", targetName: item?.name || "", targetId: deleteId });
      setDeleteId(null);
      setDeleteUsage(null);
      if (previewItem?.id === deleteId) setPreviewItem(null);
      fetchMedia();
    }
  };

  // ============== Bulk operations ==============
  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };
  const exitSelectMode = () => { setSelectMode(false); setSelectedIds(new Set()); };

  // Returns true if the media asset is currently referenced by any design project or schedule.
  // Used to surface a visual "In use" hint in selection mode so users know which items the
  // bulk-delete flow will skip before confirming.
  const isMediaInUse = (id: string) => {
    return (mediaUsageMap.get(id)?.length ?? 0) > 0 || (mediaScheduleMap.get(id)?.length ?? 0) > 0;
  };

  const handleBulkDelete = async () => {
    if (selectedIds.size === 0) return;
    setBulkBusy(true);
    const ids = Array.from(selectedIds);

    // Build per-media project refs from the in-memory zone scan, then ask the
    // shared utility to detect schedule references in a single batched query.
    const projectRefsByMedia = new Map<string, MediaProjectRef[]>();
    for (const id of ids) {
      const refs = (mediaUsageMap.get(id) || []).map((r) => ({ id: r.id, name: r.name }));
      if (refs.length > 0) projectRefsByMedia.set(id, refs);
    }
    const reports = await checkMediaReferencesBatch(ids, projectRefsByMedia);
    const inUseIds = new Set<string>();
    const inUseDetails: { name: string; reasons: string[] }[] = [];
    reports.forEach((report, mid) => {
      if (!report.hasAny) return;
      inUseIds.add(mid);
      const item = media.find((m) => m.id === mid);
      const reasons = report.groups.map((g) => `${t(g.labelKey)}: ${g.names.join(", ")}`);
      inUseDetails.push({ name: item?.original_name?.trim() || item?.name || mid, reasons });
    });

    const deletableIds = ids.filter((id) => !inUseIds.has(id));
    const items = media.filter((m) => deletableIds.includes(m.id));

    if (deletableIds.length === 0) {
      toast.error(t("mediaInUseWarning"), {
        description: inUseDetails.slice(0, 5).map((d) => `• ${d.name} — ${d.reasons.join("; ")}`).join("\n"),
      });
      setBulkBusy(false);
      return;
    }

    // Soft-delete bulk: move items to trash instead of hard-deleting them.
    const { error } = await supabase
      .from("media_items")
      .update({ deleted_at: new Date().toISOString() })
      .in("id", deletableIds)
      .is("deleted_at", null);
    if (error) {
      toast.error(error.message);
      setBulkBusy(false);
      return;
    }
    // Storage files are intentionally kept so the items can be restored from
    // the trash within the 7-day window; physical cleanup happens on purge.
    if (inUseIds.size > 0) {
      toast.success(`${t("mediaDeleted")}：${deletableIds.length}`, {
        description: `${t("mediaBulkDeleteSkipped")}：${inUseIds.size}\n` +
          inUseDetails.slice(0, 5).map((d) => `• ${d.name} — ${d.reasons.join("; ")}`).join("\n"),
      });
    } else {
      toast.success(`${t("mediaDeleted")}：${deletableIds.length}`);
    }
    items.forEach((it) => logActivity({ action: "soft_delete_media", category: "media", targetName: it.name || "", targetId: it.id }));
    setBulkDeleteOpen(false);
    exitSelectMode();
    fetchAll();
    setBulkBusy(false);
  };

  const handleBulkDownload = async () => {
    if (selectedIds.size === 0) return;
    setBulkBusy(true);
    try {
      const items = media.filter((m) => selectedIds.has(m.id) && m.url && !m.url.startsWith("widget://"));
      if (items.length === 0) { toast.error(t("mediaNoResult")); setBulkBusy(false); return; }
      const JSZip = (await import("jszip")).default;
      const zip = new JSZip();
      let ok = 0;
      for (const it of items) {
        try {
          const res = await fetch(it.url!);
          if (!res.ok) continue;
          const blob = await res.blob();
          const safe = (it.original_name || it.name || it.id).replace(/[\\/:*?"<>|]/g, "_");
          zip.file(safe, blob);
          ok++;
        } catch (e) { console.warn("zip add failed", it.id, e); }
      }
      if (ok === 0) { toast.error("Download failed"); setBulkBusy(false); return; }
      const blob = await zip.generateAsync({ type: "blob" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `media-${new Date().toISOString().slice(0, 10)}.zip`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast.success(`✓ ${ok} / ${items.length}`);
    } finally {
      setBulkBusy(false);
    }
  };

  const handleCreateWidget = async () => {
    if (!widgetForm.name.trim()) { toast.error(t("widgetFillRequired")); return; }
    const config: WidgetConfig = {
      widgetType: widgetForm.widgetType, url: widgetForm.url, text: widgetForm.text,
      speed: widgetForm.speed, format: widgetForm.format, clockStyle: widgetForm.clockStyle,
      showDate: widgetForm.showDate, timezone: widgetForm.timezone, bgColor: widgetForm.bgColor,
      textColor: widgetForm.textColor, qrcodeContent: widgetForm.qrcodeContent,
      targetDate: widgetForm.targetDate, countdownTitle: widgetForm.countdownTitle,
      youtubeUrl: widgetForm.youtubeUrl, city: widgetForm.city, fontSize: widgetForm.fontSize,
      qrcodeSize: widgetForm.qrcodeSize, animation: widgetForm.animation,
    };
    const widgetOrgId = activeOrgId || defaultOrgId;
    if (!widgetOrgId) { toast.error(t("teamSelectOrg")); return; }
    const { error } = await supabase.from("media_items").insert({
      name: widgetForm.name.trim(), type: "widget",
      url: "widget://" + JSON.stringify(config),
      thumbnail: "",
      uploaded_by: user?.id,
      org_id: widgetOrgId,
    });
    if (error) { toast.error(translatePlanLimitError(error, t)); } else {
      toast.success(t("widgetCreated"));
      setWidgetDialogOpen(false);
      setWidgetForm({ ...defaultWidgetForm });
      fetchMedia();
    }
  };

  const renderProjectSelect = (item: MediaItemRow, _compact = false) => {
    const referencedBy = mediaUsageMap.get(item.id) || [];
    const schedulesRef = mediaScheduleMap.get(item.id) || [];
    const total = referencedBy.length + schedulesRef.length;
    if (total === 0) {
      return <span className="text-[10px] italic text-muted-foreground">{t("mediaUsedInNone")}</span>;
    }
    const tooltipParts: string[] = [];
    if (referencedBy.length > 0) tooltipParts.push(`${t("mediaUsedInProjects")}: ${referencedBy.map((p) => p.name).join(", ")}`);
    if (schedulesRef.length > 0) tooltipParts.push(`${t("mediaUsedInSchedules")}: ${schedulesRef.map((s) => s.name).join(", ")}`);
    return (
      <span
        title={tooltipParts.join(" · ")}
        className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary"
      >
        <FolderOpen className="h-2.5 w-2.5 shrink-0" />
        In use · {total}
      </span>
    );
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
            <h1 className="text-xl sm:text-3xl font-bold tracking-tight text-foreground">{t("mediaTitle")}</h1>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
              <span className="inline-flex items-center gap-1.5">
                <FileImage className="w-4 h-4" />
                <span className="font-medium text-foreground">{stats.images}</span>
                <span>{t("mediaImages")}</span>
              </span>
              <span className="inline-flex items-center gap-1.5">
                <FileVideo className="w-4 h-4" />
                <span className="font-medium text-foreground">{stats.videos}</span>
                <span>{t("mediaVideos")}</span>
              </span>
              <span className="inline-flex items-center gap-1.5">
                <Music className="w-4 h-4" />
                <span className="font-medium text-foreground">{stats.audios}</span>
                <span>{t("mediaAudios")}</span>
              </span>
              <span className="inline-flex items-center gap-1.5">
                <Code2 className="w-4 h-4" />
                <span className="font-medium text-foreground">{stats.widgets}</span>
                <span>{t("mediaWidgets")}</span>
              </span>
            </div>
          </div>
          <p className="text-muted-foreground mt-1">{t("mediaSubtitle")}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {canManageMedia && <input ref={fileInputRef} type="file" className="hidden" accept="image/jpeg,image/png,.jpg,.jpeg,.png,video/mp4,.mp4,audio/*,.mp3,.wav,.ogg,.m4a,.aac" onChange={handleUpload} />}
          <Button variant="outline" className="gap-2" onClick={() => setTrashOpen(true)}>
            <Trash className="w-4 h-4" />
            {t("mediaTrashView")}
          </Button>
          {canManageMedia && (isAdmin || isOrgAdmin) && (
            <Button variant="outline" className="gap-2" onClick={() => setWidgetDialogOpen(true)}>
              <Code2 className="w-4 h-4" />
              {t("mediaAddWidget")}
            </Button>
          )}
          {canManageMedia && (
            <div className="flex items-center gap-1">
              <Button className="gap-2" onClick={() => fileInputRef.current?.click()} disabled={uploading}>
                {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
                {t("mediaUpload")}
              </Button>
              <HoverCard openDelay={120} closeDelay={80}>
                <HoverCardTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-9 w-9 text-muted-foreground hover:text-foreground"
                    aria-label={t("mediaUploadSpecTitle")}
                  >
                    <Info className="w-4 h-4" />
                  </Button>
                </HoverCardTrigger>
                <HoverCardContent align="end" className="w-[26rem] p-0 text-sm">
                  <div className="px-4 pt-3 pb-2 font-semibold border-b">
                    {t("mediaUploadSpecTitle")}
                  </div>
                  <div className="p-2">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="text-muted-foreground">
                          <th className="px-2 py-1.5 text-left font-medium w-[28%]">{t("mediaUploadSpecColItem")}</th>
                          <th className="px-2 py-1.5 text-left font-medium">
                            <span className="inline-flex items-center gap-1">
                              <FileImage className="w-3.5 h-3.5" />
                              {t("mediaUploadSpecColImage")}
                            </span>
                          </th>
                          <th className="px-2 py-1.5 text-left font-medium">
                            <span className="inline-flex items-center gap-1">
                              <FileVideo className="w-3.5 h-3.5" />
                              {t("mediaUploadSpecColVideo")}
                            </span>
                          </th>
                        </tr>
                      </thead>
                      <tbody className="[&_tr]:border-t [&_tr]:border-border/60">
                        <tr>
                          <td className="px-2 py-1.5 text-muted-foreground">{t("mediaUploadSpecRowFormat")}</td>
                          <td className="px-2 py-1.5">{t("mediaUploadSpecValImageFormat")}</td>
                          <td className="px-2 py-1.5">{t("mediaUploadSpecValVideoFormat")}</td>
                        </tr>
                        <tr>
                          <td className="px-2 py-1.5 text-muted-foreground">{t("mediaUploadSpecRowResolution")}</td>
                          <td className="px-2 py-1.5">{t("mediaUploadSpecValResolution")}</td>
                          <td className="px-2 py-1.5">{t("mediaUploadSpecValResolution")}</td>
                        </tr>
                        <tr>
                          <td className="px-2 py-1.5 text-muted-foreground">{t("mediaUploadSpecRowColor")}</td>
                          <td className="px-2 py-1.5">{t("mediaUploadSpecValImageColor")}</td>
                          <td className="px-2 py-1.5">{t("mediaUploadSpecValVideoColor")}</td>
                        </tr>
                        <tr>
                          <td className="px-2 py-1.5 text-muted-foreground">{t("mediaUploadSpecRowBitrate")}</td>
                          <td className="px-2 py-1.5 text-muted-foreground">{t("mediaUploadSpecDash")}</td>
                          <td className="px-2 py-1.5">{t("mediaUploadSpecValBitrate")}</td>
                        </tr>
                        <tr>
                          <td className="px-2 py-1.5 text-muted-foreground">{t("mediaUploadSpecRowFps")}</td>
                          <td className="px-2 py-1.5 text-muted-foreground">{t("mediaUploadSpecDash")}</td>
                          <td className="px-2 py-1.5">{t("mediaUploadSpecValFps")}</td>
                        </tr>
                        <tr>
                          <td className="px-2 py-1.5 text-muted-foreground">{t("mediaUploadSpecRowSize")}</td>
                          <td className="px-2 py-1.5">{t("mediaUploadSpecValImageSize")}</td>
                          <td className="px-2 py-1.5">{t("mediaUploadSpecValVideoSize")}</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </HoverCardContent>
              </HoverCard>
            </div>
          )}
        </div>
      </div>

      {/* Storage Usage Bar (plan_tier based) */}
      <PlanUsageBar
        icon={HardDrive}
        label={t("mediaStorageUsage")}
        used={stats.totalBytes}
        limit={planLimits.mediaBytes}
        formatValue={formatBytes}
        planLabel={planTier ? PLAN_LABELS[planTier][language] : undefined}
        usedSuffix={t("mediaStorageUsed")}
      />

      <Tabs value={typeFilter} onValueChange={setTypeFilter}>
        <TabsList>
          <TabsTrigger value="all">{t("allTypes")}</TabsTrigger>
          <TabsTrigger value="image">{t("image")}</TabsTrigger>
          <TabsTrigger value="video">{t("video")}</TabsTrigger>
          <TabsTrigger value="audio">{t("audio")}</TabsTrigger>
          <TabsTrigger value="widget">{t("widget")}</TabsTrigger>
        </TabsList>
      </Tabs>

      <Card className="p-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-1 flex-col gap-3 sm:flex-row">
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t("mediaSearchPlaceholder")} className="pl-9" />
            </div>
            <Select value={ownerFilter} onValueChange={setOwnerFilter}>
              <SelectTrigger className="w-full sm:w-[160px]">
                <User className="mr-1.5 h-4 w-4 text-muted-foreground" />
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t("mediaOwnerFilterAll")}</SelectItem>
                <SelectItem value="self">{t("mediaOwnerFilterSelf")}</SelectItem>
                <SelectItem value="team">{t("mediaOwnerFilterTeam")}</SelectItem>
                <SelectItem value="org">{t("mediaOwnerFilterOrg")}</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-center gap-2 self-end lg:self-auto">
            {canManageMedia && (
              <Button
                variant={selectMode ? "default" : "outline"}
                className="gap-2"
                onClick={() => { if (selectMode) exitSelectMode(); else setSelectMode(true); }}
              >
                {selectMode ? <X className="w-4 h-4" /> : <CheckSquare className="w-4 h-4" />}
                {selectMode ? t("cancel") : t("select")}
              </Button>
            )}
            <Button variant={viewMode === "grid" ? "default" : "outline"} size="icon" onClick={() => setViewMode("grid")} title={t("tipGridView")}>
              <Grid3X3 className="w-4 h-4" />
            </Button>
            <Button variant={viewMode === "list" ? "default" : "outline"} size="icon" onClick={() => setViewMode("list")} title={t("tipListView")}>
              <List className="w-4 h-4" />
            </Button>
          </div>
        </div>
        {allMediaTags.length > 0 && (
          <div className="mt-3 border-t border-border pt-3">
            <MediaTagFilter tags={allMediaTags} selectedIds={tagFilter} onChange={setTagFilter} />
          </div>
        )}
      </Card>

      {selectMode && (
        <Card className="sticky top-2 z-20 flex flex-wrap items-center justify-between gap-3 border-primary/30 bg-primary/5 p-3 shadow-md">
          <div className="flex items-center gap-3">
            <Checkbox
              checked={filteredMedia.length > 0 && selectedIds.size === filteredMedia.length}
              onCheckedChange={(v) => {
                if (v) setSelectedIds(new Set(filteredMedia.map((m) => m.id)));
                else setSelectedIds(new Set());
              }}
              aria-label={t("selectAll")}
            />
            <span className="text-sm font-medium">
              {t("bulkSelected").replace("{count}", String(selectedIds.size))}
            </span>
            {(() => {
              const skipCount = Array.from(selectedIds).filter((id) => isMediaInUse(id)).length;
              if (skipCount === 0) return null;
              return (
                <span
                  title={t("mediaInUseWarning")}
                  className="rounded-full bg-destructive/10 px-2 py-0.5 text-[11px] font-medium text-destructive"
                >
                  {t("mediaBulkDeleteSkipped")}: {skipCount}
                </span>
              );
            })()}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant="outline" disabled={selectedIds.size === 0 || bulkBusy} onClick={handleBulkDownload} className="gap-2">
              {bulkBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
              {t("bulkDownload")}
            </Button>
            <Button size="sm" variant="destructive" disabled={selectedIds.size === 0 || bulkBusy} onClick={() => setBulkDeleteOpen(true)} className="gap-2">
              <Trash2 className="w-4 h-4" />{t("delete")}
            </Button>
            <Button size="sm" variant="ghost" onClick={exitSelectMode} className="gap-1">
              <X className="w-4 h-4" />
            </Button>
          </div>
        </Card>
      )}

      {loading || roleLoading ? (
        <Card className="p-10 flex items-center justify-center gap-3 text-muted-foreground">
          <Loader2 className="w-5 h-5 animate-spin" />
          <span>{t("mediaReading")}</span>
        </Card>
      ) : filteredMedia.length === 0 ? (
        <MediaEmptyState
          hasFilters={
            media.length > 0 ||
            search.trim() !== "" ||
            typeFilter !== "all" ||
            ownerFilter !== "all" ||
            tagFilter.length > 0
          }
          canManage={!!canManageMedia}
          onUploadClick={() => fileInputRef.current?.click()}
          onAddWidgetClick={() => setWidgetDialogOpen(true)}
          onClearFilters={() => {
            setSearch("");
            setTypeFilter("all");
            setOwnerFilter("all");
            setTagFilter([]);
          }}
        />
      ) : viewMode === "grid" ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {filteredMedia.map((item) => {
            const displayName = getDisplayName(item);
            const isSelected = selectedIds.has(item.id);
            const inUse = selectMode && isMediaInUse(item.id);
            return (
              <Card
                key={item.id}
                className={`overflow-hidden cursor-pointer relative ${isSelected ? "ring-2 ring-primary" : ""} ${inUse ? "opacity-70" : ""}`}
                onClick={() => { if (selectMode) toggleSelect(item.id); else openPreview(item); }}
              >
                {selectMode && (
                  <div className="absolute right-2 top-2 z-10 flex items-center gap-1.5">
                    {inUse && (
                      <span
                        title={t("mediaInUseWarning")}
                        className="rounded-full bg-destructive/90 px-1.5 py-0.5 text-[10px] font-medium text-destructive-foreground shadow-sm"
                      >
                        In use
                      </span>
                    )}
                    <div
                      className="rounded bg-background/90 p-1 shadow-sm backdrop-blur-sm"
                      onClick={(e) => { e.stopPropagation(); toggleSelect(item.id); }}
                    >
                      <Checkbox checked={isSelected} aria-label={displayName} />
                    </div>
                  </div>
                )}
                <div className="aspect-video bg-muted flex items-center justify-center overflow-hidden relative">
                  {item.type === "widget" && item.url ? (
                    (() => { const c = parseWidgetConfig(item.url); return c ? <WidgetPreviewCard config={c} /> : <Code2 className="w-10 h-10 text-muted-foreground" />; })()
                  ) : item.type === "image" && item.url ? (
                    <img
                      src={item.thumbnail || item.url}
                      alt={displayName}
                      loading="lazy"
                      decoding="async"
                      className="h-full w-full object-cover"
                    />
                  ) : item.type === "video" && item.url ? (
                    <VideoThumb src={item.url} name={displayName} poster={item.thumbnail || undefined} />
                  ) : (
                    getPreviewIcon(item.type)
                  )}
                  {item.type === "video" && (() => { const d = formatDuration(item); return d ? (
                    <span className="absolute bottom-2 right-2 rounded bg-foreground/80 px-1.5 py-0.5 text-[10px] text-background">
                      {d}
                    </span>
                  ) : null; })()}
                  {isCcByAudio(item) && (
                    <a
                      href="https://creativecommons.org/licenses/by/4.0/"
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={(e) => e.stopPropagation()}
                      title={t("mediaAttributionTitle")}
                      className="absolute bottom-2 right-2 rounded bg-primary/90 px-1.5 py-0.5 text-[10px] font-bold tracking-wide text-primary-foreground shadow-sm hover:bg-primary"
                    >
                      CC BY
                    </a>
                  )}
                  <div className="absolute left-2 top-2 flex items-center gap-1">
                    <Badge variant={getTypeBadgeVariant(item.type)} className="text-[10px]">
                      {item.type === "image" ? t("image") : item.type === "video" ? t("video") : item.type === "audio" ? t("audio") : t("widget")}
                    </Badge>
                    {(() => { const o = renderOwnerBadge(item); return o ? (
                      <span className="inline-flex items-center justify-center rounded bg-background/80 px-1 py-0.5 backdrop-blur-sm" title={
                        item.uploaded_by === user?.id ? t("mediaOwnerSelf")
                          : item.uploaded_by && teammateIds.has(item.uploaded_by) ? t("mediaOwnerTeam")
                          : t("mediaOwnerOrg")
                      }>{o}</span>
                    ) : null; })()}
                  </div>
                  {item.type === "widget" && (
                    <Badge variant={item.is_system ? "destructive" : "outline"} className="absolute right-2 top-2 text-[10px]">
                      {item.is_system ? t("widgetSystem") : t("widgetRegular")}
                    </Badge>
                  )}
                  {/* Transcode status overlay badge */}
                  {item.type === "video" && item.transcode_status === "pending_transcode" && (
                    <Badge className="absolute right-2 top-2 text-[10px] bg-yellow-500 text-white border-0">
                      {t("transcodeStatusPending")}
                    </Badge>
                  )}
                  {item.type === "video" && item.transcode_status === "transcoding" && (
                    <Badge className="absolute right-2 top-2 text-[10px] bg-blue-500 text-white border-0 animate-pulse">
                      {t("transcodeStatusProcessing")}
                    </Badge>
                  )}
                  {item.type === "video" && item.transcode_status === "failed" && (
                    <Badge
                      className="absolute right-2 top-2 text-[10px] bg-destructive text-destructive-foreground border-0 cursor-help"
                      title={item.transcode_error ?? undefined}
                    >
                      {t("transcodeStatusFailed")}
                    </Badge>
                  )}
                </div>

                <div className="space-y-2 p-3">
                  <p className="truncate text-sm font-medium text-foreground">{displayName}</p>
                  <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                    <span>{formatMediaBytes(getSizeBytes(item))}</span>
                    {item.type === "audio" ? (
                      <>
                        <span>·</span>
                        <span className="font-mono uppercase">{getAudioFormatLabel(item)}</span>
                        <span>·</span>
                        <span className="flex items-center gap-1"><Clock className="w-3 h-3" />{formatDuration(item) || "--:--"}</span>
                      </>
                    ) : item.type !== "widget" ? (
                      <>
                        <span>·</span>
                        <span>{formatDimensions(item) || "-"}</span>
                      </>
                    ) : null}
                    <span>·</span>
                    <div className="min-w-0 flex-1">{renderProjectSelect(item)}</div>
                  </div>
                  {/* Transcode action button */}
                  {item.type === "video" && (item.transcode_status === "pending_transcode" || item.transcode_status === "failed") && canManageMedia && (
                    <button
                      className="mt-1 w-full rounded border border-yellow-500 py-0.5 text-[11px] font-medium text-yellow-600 hover:bg-yellow-50 dark:hover:bg-yellow-950 disabled:opacity-50"
                      disabled={transcodeRequestingId === item.id}
                      onClick={(e) => { e.stopPropagation(); void handleRequestTranscode(item.id); }}
                    >
                      {item.transcode_status === "failed" ? t("transcodeRetry") : t("transcodeStart")}
                    </button>
                  )}
                </div>
              </Card>
            );
          })}
        </div>
      ) : (
        <div className="grid gap-2">
          {filteredMedia.map((item) => {
            const displayName = getDisplayName(item);
            const isSelected = selectedIds.has(item.id);
            const inUse = selectMode && isMediaInUse(item.id);
            return (
              <Card
                key={item.id}
                className={`flex cursor-pointer items-center gap-4 p-3 ${isSelected ? "ring-2 ring-primary" : ""} ${inUse ? "opacity-70" : ""}`}
                onClick={() => { if (selectMode) toggleSelect(item.id); else openPreview(item); }}
              >
                {selectMode && (
                  <div className="flex shrink-0 items-center gap-2">
                    <div onClick={(e) => { e.stopPropagation(); toggleSelect(item.id); }}>
                      <Checkbox checked={isSelected} aria-label={displayName} />
                    </div>
                    {inUse && (
                      <span
                        title={t("mediaInUseWarning")}
                        className="rounded-full bg-destructive/90 px-1.5 py-0.5 text-[10px] font-medium text-destructive-foreground"
                      >
                        In use
                      </span>
                    )}
                  </div>
                )}
                <div className="relative flex h-12 w-20 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-muted">
                  {item.type === "widget" && item.url ? (
                    (() => { const c = parseWidgetConfig(item.url); return c ? <WidgetPreviewCard config={c} /> : <Code2 className="w-6 h-6 text-muted-foreground" />; })()
                  ) : item.type === "image" && item.url ? (
                    <img
                      src={item.thumbnail || item.url}
                      alt={displayName}
                      loading="lazy"
                      decoding="async"
                      className="h-full w-full object-cover"
                    />
                  ) : item.type === "video" && item.url ? (
                    <VideoThumb
                      src={item.url}
                      name={displayName}
                      showPlayHint={false}
                      poster={item.thumbnail || undefined}
                    />
                  ) : (
                    getPreviewIcon(item.type)
                  )}
                  {isCcByAudio(item) && (
                    <span
                      title={t("mediaAttributionTitle")}
                      className="absolute bottom-0.5 right-0.5 rounded bg-primary/90 px-1 py-px text-[8px] font-bold leading-tight text-primary-foreground shadow-sm"
                    >
                      CC BY
                    </span>
                  )}
                </div>

                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-foreground">{displayName}</p>
                  <div className="mt-1 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                    <Badge variant={item.type === "widget" ? "default" : "outline"} className="text-[10px] px-1.5 py-0 h-4">
                      {item.type === "image" ? t("image") : item.type === "video" ? t("video") : item.type === "audio" ? t("audio") : t("widget")}
                    </Badge>
                    {(() => { const o = renderOwnerBadge(item); return o ? (
                      <span className="inline-flex items-center" title={
                        item.uploaded_by === user?.id ? t("mediaOwnerSelf")
                          : item.uploaded_by && teammateIds.has(item.uploaded_by) ? t("mediaOwnerTeam")
                          : t("mediaOwnerOrg")
                      }>{o}</span>
                    ) : null; })()}
                    {item.type === "widget" && (
                      <Badge variant={item.is_system ? "destructive" : "secondary"} className="text-[10px] px-1.5 py-0 h-4">
                        {item.is_system ? t("widgetSystem") : t("widgetRegular")}
                      </Badge>
                    )}
                    {item.type === "video" && item.transcode_status === "pending_transcode" && (
                      <Badge className="text-[10px] px-1.5 py-0 h-4 bg-yellow-500 text-white border-0">{t("transcodeStatusPending")}</Badge>
                    )}
                    {item.type === "video" && item.transcode_status === "transcoding" && (
                      <Badge className="text-[10px] px-1.5 py-0 h-4 bg-blue-500 text-white border-0 animate-pulse">{t("transcodeStatusProcessing")}</Badge>
                    )}
                    {item.type === "video" && item.transcode_status === "failed" && (
                      <Badge className="text-[10px] px-1.5 py-0 h-4 bg-destructive text-destructive-foreground border-0 cursor-help" title={item.transcode_error ?? undefined}>{t("transcodeStatusFailed")}</Badge>
                    )}
                    <span className="flex items-center gap-1"><HardDrive className="w-3 h-3" />{formatMediaBytes(getSizeBytes(item))}</span>
                    {item.type === "audio" ? (
                      <span className="font-mono uppercase">{getAudioFormatLabel(item)}</span>
                    ) : item.type !== "widget" ? (
                      <span>{formatDimensions(item) || "-"}</span>
                    ) : null}
                    {(() => { const d = formatDuration(item); return d ? <span className="flex items-center gap-1"><Clock className="w-3 h-3" />{d}</span> : null; })()}
                    <span>{item.created_at?.split("T")[0]}</span>
                    <div className="min-w-[140px]">{renderProjectSelect(item, true)}</div>
                  </div>
                </div>

                <div className="flex shrink-0 items-center gap-1">
                  {item.type === "video" && (item.transcode_status === "pending_transcode" || item.transcode_status === "failed") && canManageMedia && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 border-yellow-500 text-yellow-600 text-[11px] hover:bg-yellow-50 dark:hover:bg-yellow-950"
                      disabled={transcodeRequestingId === item.id}
                      onClick={(e) => { e.stopPropagation(); void handleRequestTranscode(item.id); }}
                    >
                      {item.transcode_status === "failed" ? t("transcodeRetry") : t("transcodeStart")}
                    </Button>
                  )}
                  <Button variant="ghost" size="icon" className="h-8 w-8" onClick={(e) => { e.stopPropagation(); openPreview(item); }} title={t("mediaTitle")}>
                    <Eye className="w-4 h-4" />
                  </Button>
                  {canManageMedia && !item.is_system && (
                    <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive hover:text-destructive" onClick={(e) => { e.stopPropagation(); requestDelete(item.id); }} title={t("mediaDeleteItem")}>
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  )}
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {/* Bulk delete confirm */}
      <AlertDialog open={bulkDeleteOpen} onOpenChange={setBulkDeleteOpen}>
        <AlertDialogContent className="sm:max-w-xl">
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2 text-destructive">
              <Trash2 className="w-5 h-5" />
              {t("bulkDeleteConfirmTitle")}
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3">
                {(() => {
                  const selectedItems = media.filter((m) => selectedIds.has(m.id));
                  const deletable = selectedItems.filter((m) => !isMediaInUse(m.id));
                  const inUse = selectedItems.filter((m) => isMediaInUse(m.id));
                  const previewLimit = 12;
                  const deletablePreview = deletable.slice(0, previewLimit);
                  const deletableMore = deletable.length - deletablePreview.length;
                  const inUsePreview = inUse.slice(0, previewLimit);
                  const inUseMore = inUse.length - inUsePreview.length;
                  const renderThumb = (item: MediaItemRow) => (
                    <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-md border bg-muted">
                      {item.type === "image" && item.url ? (
                        <img src={item.thumbnail || item.url} alt={getDisplayName(item)} className="h-full w-full object-cover" loading="lazy" />
                      ) : item.type === "video" && item.thumbnail ? (
                        <img src={item.thumbnail} alt={getDisplayName(item)} className="h-full w-full object-cover" loading="lazy" />
                      ) : (
                        <div className="scale-75 opacity-70">{getPreviewIcon(item.type)}</div>
                      )}
                    </div>
                  );
                  return (
                    <>
                      <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm">
                        <p className="text-destructive">
                          {t("bulkDeleteSummary")
                            .replace("{total}", String(selectedItems.length))
                            .replace("{deletable}", String(deletable.length))
                            .replace("{inUse}", String(inUse.length))}
                        </p>
                        <p className="mt-1 text-xs text-muted-foreground">{t("bulkDeleteConfirmDesc")}</p>
                      </div>

                      {deletable.length > 0 && (
                        <div className="rounded-md border bg-muted/30 p-2">
                          <div className="px-1 pb-2 text-xs font-medium text-foreground">
                            {t("bulkDeleteAffectedTitle").replace("{count}", String(deletable.length))}
                          </div>
                          <div className="max-h-44 space-y-1 overflow-y-auto pr-1">
                            {deletablePreview.map((item) => (
                              <div key={item.id} className="flex items-center gap-2 rounded-sm px-1 py-1 hover:bg-background/50">
                                {renderThumb(item)}
                                <span className="truncate text-xs text-foreground">{getDisplayName(item)}</span>
                              </div>
                            ))}
                          </div>
                          {deletableMore > 0 && (
                            <div className="px-1 pt-1 text-xs text-muted-foreground">
                              {t("bulkDeleteMore").replace("{count}", String(deletableMore))}
                            </div>
                          )}
                        </div>
                      )}

                      {inUse.length > 0 && (
                        <div className="rounded-md border border-dashed bg-muted/40 p-2">
                          <div className="px-1 pb-2 text-xs font-medium text-muted-foreground">
                            {t("bulkDeleteSkippedTitle").replace("{count}", String(inUse.length))}
                          </div>
                          <div className="max-h-32 space-y-1 overflow-y-auto pr-1">
                            {inUsePreview.map((item) => (
                              <div key={item.id} className="flex items-center gap-2 rounded-sm px-1 py-1">
                                {renderThumb(item)}
                                <span className="truncate text-xs text-foreground">{getDisplayName(item)}</span>
                              </div>
                            ))}
                          </div>
                          {inUseMore > 0 && (
                            <div className="px-1 pt-1 text-xs text-muted-foreground">
                              {t("bulkDeleteMore").replace("{count}", String(inUseMore))}
                            </div>
                          )}
                        </div>
                      )}

                      {deletable.length === 0 ? (
                        <p className="text-sm text-destructive">{t("bulkDeleteNoneDeletable")}</p>
                      ) : (
                        <div className="space-y-1.5">
                          <p className="text-sm text-foreground">
                            {t("bulkDeleteTypeToConfirm").replace("{phrase}", t("bulkDeleteConfirmPhrase"))}
                          </p>
                          <Input
                            value={bulkDeleteConfirmText}
                            onChange={(e) => setBulkDeleteConfirmText(e.target.value)}
                            placeholder={t("bulkDeleteConfirmPlaceholder")}
                            autoComplete="off"
                            autoFocus
                            className="h-9"
                          />
                        </div>
                      )}
                    </>
                  );
                })()}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={bulkBusy}>{t("cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                void handleBulkDelete();
              }}
              disabled={
                bulkBusy ||
                bulkDeleteConfirmText.trim() !== t("bulkDeleteConfirmPhrase") ||
                media.filter((m) => selectedIds.has(m.id) && !isMediaInUse(m.id)).length === 0
              }
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {bulkBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : t("confirmDelete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={!!previewItem} onOpenChange={(open) => !open && setPreviewItem(null)}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{previewItem ? getDisplayName(previewItem) : ""}</DialogTitle>
            <DialogDescription className="sr-only">{t("mediaPreviewSr")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="aspect-video overflow-hidden rounded-lg bg-muted flex items-center justify-center">
              {previewLoading ? (
                <div className="flex flex-col items-center gap-2 text-muted-foreground">
                  <Loader2 className="w-6 h-6 animate-spin" />
                  <span className="text-xs">{t("mediaReading")}</span>
                </div>
              ) : previewItem?.type === "widget" ? (
                (() => { const c = parseWidgetConfig(previewItem.url); return c ? <WidgetPreviewCard config={c} /> : <Code2 className="w-16 h-16 opacity-30" />; })()
              ) : previewItem?.type === "image" && previewItem.url ? (
                <img src={previewItem.url} alt={getDisplayName(previewItem)} className="h-full w-full object-contain" />
              ) : previewItem?.type === "video" && previewItem.url ? (
                <video src={previewItem.url} controls className="h-full w-full" />
              ) : previewItem?.type === "audio" && previewItem.url ? (
                <div className="flex flex-col items-center justify-center gap-3 p-6 w-full">
                  <Music className="w-16 h-16 text-muted-foreground" />
                  <audio src={previewItem.url} controls className="w-full max-w-md" />
                </div>
              ) : previewItem ? (
                <div className="flex flex-col items-center gap-2 text-muted-foreground">
                  {getPreviewIcon(previewItem.type)}
                  <span className="text-xs">{t("mediaPreviewLoadFail")}</span>
                </div>
              ) : null}
            </div>
            {previewItem && (
              <PreviewInfoPanel item={previewItem} usedInProjects={mediaUsageMap.get(previewItem.id) || []} usedInSchedules={mediaScheduleMap.get(previewItem.id) || []} t={t} uploaderProfile={previewItem.uploaded_by ? getProfile(previewItem.uploaded_by) ?? null : null} key={`preview-${previewItem.id}-${profilesVersion}`} />
            )}
            {previewItem && !previewItem.is_system && activeOrgId && (
              <div className="rounded-lg border border-border bg-muted/30 p-3">
                <p className="mb-2 text-xs font-medium text-muted-foreground">{t("mediaTagFilter")}</p>
                <MediaTagEditor
                  mediaId={previewItem.id}
                  orgId={activeOrgId}
                  allTags={allMediaTags}
                  selectedIds={itemTags.get(previewItem.id) || []}
                  canEdit={!!canManageMedia}
                  onChanged={refreshTags}
                />
              </div>
            )}
            {canManageMedia && previewItem && !previewItem.is_system && (
              <div className="flex justify-end">
                <Button variant="destructive" size="sm" className="gap-2" onClick={() => { requestDelete(previewItem.id); setPreviewItem(null); }}>
                  <Trash2 className="w-4 h-4" />
                  {t("mediaDeleteItem")}
                </Button>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      <AlertDialog open={deleteId !== null} onOpenChange={(open) => { if (!open) { setDeleteId(null); setDeleteUsage(null); } }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("mediaDeleteConfirm")}</AlertDialogTitle>
            <AlertDialogDescription>
              {checkingUsage ? (
                <span className="flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" />{t("mediaCheckingUsage")}</span>
              ) : deleteUsage && (deleteUsage.schedules.length > 0 || deleteUsage.projects.length > 0) ? (
                <div className="space-y-2">
                  <p className="text-destructive font-medium">{t("mediaInUseWarning")}</p>
                  {deleteUsage.projects.length > 0 && (
                    <div>
                      <p className="text-xs text-muted-foreground">{t("mediaUsedInProjects")}：</p>
                      <ul className="list-disc list-inside text-sm">{deleteUsage.projects.map((n) => <li key={n}>{n}</li>)}</ul>
                      <Link
                        to="/studio"
                        className="inline-block mt-1 text-xs text-primary hover:underline"
                      >
                        {t("mediaInUseGoStudio")} →
                      </Link>
                    </div>
                  )}
                  {deleteUsage.schedules.length > 0 && (
                    <div>
                      <p className="text-xs text-muted-foreground">{t("mediaUsedInSchedules")}：</p>
                      <ul className="list-disc list-inside text-sm">{deleteUsage.schedules.map((n) => <li key={n}>{n}</li>)}</ul>
                      <Link
                        to="/schedules"
                        className="inline-block mt-1 text-xs text-primary hover:underline"
                      >
                        {t("mediaInUseGoSchedules")} →
                      </Link>
                    </div>
                  )}
                </div>
              ) : (
                t("mediaDeleteDesc")
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("cancel")}</AlertDialogCancel>
            {(!deleteUsage || (deleteUsage.schedules.length === 0 && deleteUsage.projects.length === 0)) && !checkingUsage && (
              <AlertDialogAction onClick={handleDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
                {t("confirmDelete")}
              </AlertDialogAction>
            )}
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Widget Creation Dialog */}
      <Dialog open={widgetDialogOpen} onOpenChange={setWidgetDialogOpen}>
        <DialogContent className="sm:max-w-lg max-h-[85vh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><Code2 className="w-5 h-5 text-primary" />{t("mediaAddWidget")}</DialogTitle>
            <DialogDescription className="sr-only">{t("mediaAddWidget")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2 overflow-y-auto flex-1 pr-1 min-h-0">
            <div className="space-y-2">
              <Label>{t("widgetName")} *</Label>
              <Input value={widgetForm.name} onChange={(e) => setWidgetForm({ ...widgetForm, name: e.target.value })} placeholder={t("widgetNamePlaceholder")} />
            </div>
            <div className="space-y-2">
              <Label>{t("widgetType")}</Label>
              <div className="grid grid-cols-4 gap-2">
                {(["clock", "date", "webpage", "marquee", "qrcode", "countdown", "youtube", "weather"] as WidgetSubType[]).map((wt) => {
                  const Icon = WIDGET_ICONS[wt];
                  const labels: Record<WidgetSubType, string> = { date: t("widgetDate"), clock: t("widgetClock"), webpage: t("widgetWebpage"), marquee: t("widgetMarquee"), qrcode: t("widgetQrcode"), countdown: t("widgetCountdown"), youtube: t("widgetYoutube"), weather: t("widgetWeather") };
                  return (
                    <button key={wt} type="button" onClick={() => setWidgetForm({ ...widgetForm, widgetType: wt })}
                      className={`flex flex-col items-center gap-1.5 p-3 rounded-lg border-2 transition-all text-center ${widgetForm.widgetType === wt ? "border-primary bg-primary/5" : "border-border hover:border-primary/40"}`}>
                      <Icon className={`w-6 h-6 ${widgetForm.widgetType === wt ? "text-primary" : "text-muted-foreground"}`} />
                      <span className="text-xs font-medium">{labels[wt]}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {widgetForm.widgetType === "clock" && (
              <div className="space-y-3">
                <div className="space-y-2">
                  <Label>{t("widgetClockStyle")}</Label>
                  <div className="grid grid-cols-2 gap-2">
                    <button type="button" onClick={() => setWidgetForm({ ...widgetForm, clockStyle: "digital" })}
                      className={`p-2.5 rounded-lg border-2 text-sm ${widgetForm.clockStyle === "digital" ? "border-primary bg-primary/5 text-primary font-medium" : "border-border hover:border-primary/40"}`}>{t("widgetDigital")}</button>
                    <button type="button" onClick={() => setWidgetForm({ ...widgetForm, clockStyle: "analog" })}
                      className={`p-2.5 rounded-lg border-2 text-sm ${widgetForm.clockStyle === "analog" ? "border-primary bg-primary/5 text-primary font-medium" : "border-border hover:border-primary/40"}`}>{t("widgetAnalog")}</button>
                  </div>
                </div>
                {widgetForm.clockStyle === "digital" && (
                  <div className="space-y-2">
                    <Label>{t("widgetFormat")}</Label>
                    <Select value={widgetForm.format} onValueChange={(v) => setWidgetForm({ ...widgetForm, format: v as "12" | "24" })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="24">{t("widgetFormat24")}</SelectItem>
                        <SelectItem value="12">{t("widgetFormat12")}</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                )}
                <div className="flex items-center justify-between">
                  <Label>{t("widgetShowDate")}</Label>
                  <Switch checked={widgetForm.showDate} onCheckedChange={(v) => setWidgetForm({ ...widgetForm, showDate: v })} />
                </div>
                <div className="space-y-2">
                  <Label>{t("widgetTimezone")}</Label>
                  <Select value={widgetForm.timezone} onValueChange={(v) => setWidgetForm({ ...widgetForm, timezone: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent className="max-h-60">
                      {TIMEZONE_OPTIONS.map((tz) => (<SelectItem key={tz.value} value={tz.value}>{tz.label}</SelectItem>))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            )}

            {widgetForm.widgetType === "webpage" && (
              <div className="space-y-2"><Label>{t("widgetUrl")}</Label><Input value={widgetForm.url} onChange={(e) => setWidgetForm({ ...widgetForm, url: e.target.value })} placeholder={t("widgetUrlPlaceholder")} /></div>
            )}

            {widgetForm.widgetType === "marquee" && (
              <>
                <div className="space-y-2"><Label>{t("widgetText")}</Label><Input value={widgetForm.text} onChange={(e) => setWidgetForm({ ...widgetForm, text: e.target.value })} placeholder={t("widgetTextPlaceholder")} /></div>
                <div className="space-y-2">
                  <Label>{t("widgetSpeed")}</Label>
                  <Select value={widgetForm.speed} onValueChange={(v) => setWidgetForm({ ...widgetForm, speed: v as "slow" | "normal" | "fast" })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="slow">{t("widgetSpeedSlow")}</SelectItem>
                      <SelectItem value="normal">{t("widgetSpeedNormal")}</SelectItem>
                      <SelectItem value="fast">{t("widgetSpeedFast")}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </>
            )}

            {widgetForm.widgetType === "qrcode" && (
              <div className="space-y-2"><Label>{t("widgetQrcodeContent")}</Label><Input value={widgetForm.qrcodeContent} onChange={(e) => setWidgetForm({ ...widgetForm, qrcodeContent: e.target.value })} placeholder={t("widgetQrcodePlaceholder")} /></div>
            )}

            {widgetForm.widgetType === "countdown" && (
              <>
                <div className="space-y-2"><Label>{t("widgetCountdownTitle")}</Label><Input value={widgetForm.countdownTitle} onChange={(e) => setWidgetForm({ ...widgetForm, countdownTitle: e.target.value })} placeholder={t("widgetCountdownTitlePlaceholder")} /></div>
                <div className="space-y-2"><Label>{t("widgetTargetDate")}</Label><Input type="datetime-local" value={widgetForm.targetDate} onChange={(e) => setWidgetForm({ ...widgetForm, targetDate: e.target.value })} /></div>
              </>
            )}

            {widgetForm.widgetType === "youtube" && (
              <div className="space-y-2"><Label>{t("widgetYoutubeUrl")}</Label><Input value={widgetForm.youtubeUrl} onChange={(e) => setWidgetForm({ ...widgetForm, youtubeUrl: e.target.value })} placeholder={t("widgetYoutubeUrlPlaceholder")} /></div>
            )}

            {widgetForm.widgetType === "weather" && (
              <div className="space-y-2"><Label>{t("widgetCity")}</Label><Input value={widgetForm.city} onChange={(e) => setWidgetForm({ ...widgetForm, city: e.target.value })} placeholder={t("widgetCityPlaceholder")} /></div>
            )}

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>{t("widgetBgColor")}</Label>
                <div className="flex items-center gap-2">
                  <input type="color" value={widgetForm.bgColor} onChange={(e) => setWidgetForm({ ...widgetForm, bgColor: e.target.value })} className="w-8 h-8 rounded border border-border cursor-pointer" />
                  <Input value={widgetForm.bgColor} onChange={(e) => setWidgetForm({ ...widgetForm, bgColor: e.target.value })} className="flex-1" />
                </div>
              </div>
              <div className="space-y-2">
                <Label>{t("widgetTextColor")}</Label>
                <div className="flex items-center gap-2">
                  <input type="color" value={widgetForm.textColor} onChange={(e) => setWidgetForm({ ...widgetForm, textColor: e.target.value })} className="w-8 h-8 rounded border border-border cursor-pointer" />
                  <Input value={widgetForm.textColor} onChange={(e) => setWidgetForm({ ...widgetForm, textColor: e.target.value })} className="flex-1" />
                </div>
              </div>
            </div>

            {/* Live Preview */}
            <div className="space-y-2">
              <Label>{t("widgetLivePreview")}</Label>
              <div className="aspect-video rounded-lg overflow-hidden border border-border bg-muted/30">
                <WidgetPreviewCard config={{
                  widgetType: widgetForm.widgetType, url: widgetForm.url, text: widgetForm.text,
                  speed: widgetForm.speed, format: widgetForm.format, clockStyle: widgetForm.clockStyle,
                  showDate: widgetForm.showDate, timezone: widgetForm.timezone, bgColor: widgetForm.bgColor,
                  textColor: widgetForm.textColor, qrcodeContent: widgetForm.qrcodeContent,
                  targetDate: widgetForm.targetDate, countdownTitle: widgetForm.countdownTitle,
                  youtubeUrl: widgetForm.youtubeUrl, city: widgetForm.city, fontSize: widgetForm.fontSize,
                  qrcodeSize: widgetForm.qrcodeSize, animation: widgetForm.animation,
                }} />
              </div>
            </div>
          </div>
          <DialogFooter>
            <DialogClose asChild><Button variant="outline">{t("cancel")}</Button></DialogClose>
            <Button onClick={handleCreateWidget} className="gap-2"><Plus className="w-4 h-4" />{t("mediaAddWidget")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Trash dialog: soft-deleted media within 7-day restore window */}
      <Dialog open={trashOpen} onOpenChange={setTrashOpen}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Trash className="w-5 h-5" />
              {t("mediaTrashView")}
            </DialogTitle>
            <DialogDescription>{t("mediaTrashHint")}</DialogDescription>
          </DialogHeader>
          <div className="flex items-center gap-2 rounded-md border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
            <Trash className="w-3.5 h-3.5 shrink-0" />
            <span>{t("mediaTrashRetentionBanner").replace("{days}", String(trashRetentionDays))}</span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2 pb-2">
            <div className="relative sm:col-span-2 lg:col-span-1">
              <Search className="w-4 h-4 absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={trashSearch}
                onChange={(e) => setTrashSearch(e.target.value)}
                placeholder={t("mediaTrashSearchPlaceholder")}
                className="pl-8 h-9"
              />
            </div>
            {(orgs && orgs.length > 0) && (
              <Select value={trashOrgFilter} onValueChange={setTrashOrgFilter}>
                <SelectTrigger className="h-9">
                  <SelectValue placeholder={t("mediaTrashFilterOrg")} />
                </SelectTrigger>
                <SelectContent>
                  {activeOrgId && (
                    <SelectItem value="__active__">
                      {orgNameById.get(activeOrgId) || t("mediaTrashFilterOrg")}
                    </SelectItem>
                  )}
                  {isAdmin && <SelectItem value="__all__">{t("mediaTrashFilterOrgAll")}</SelectItem>}
                  {orgs.filter((o) => o.id !== activeOrgId).map((o) => (
                    <SelectItem key={o.id} value={o.id}>{o.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            <Input
              type="date"
              value={trashDateFrom}
              onChange={(e) => setTrashDateFrom(e.target.value)}
              aria-label={t("mediaTrashFilterFrom")}
              className="h-9"
            />
            <div className="flex gap-2">
              <Input
                type="date"
                value={trashDateTo}
                onChange={(e) => setTrashDateTo(e.target.value)}
                aria-label={t("mediaTrashFilterTo")}
                className="h-9 flex-1"
              />
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-9 px-2 shrink-0"
                onClick={resetTrashFilters}
                disabled={!trashSearch && trashOrgFilter === "__active__" && !trashDateFrom && !trashDateTo}
              >
                <X className="w-4 h-4 mr-1" />
                {t("mediaTrashFilterReset")}
              </Button>
            </div>
          </div>
          {filteredTrashRows.length > 0 && (
            <div className="flex flex-wrap items-center gap-2 pb-2">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-8 gap-1.5"
                onClick={() => {
                  const allIds = filteredTrashRows.map((r) => r.id);
                  const allSelected = allIds.length > 0 && allIds.every((id) => trashSelectedIds.has(id));
                  if (allSelected) {
                    setTrashSelectedIds((prev) => {
                      const next = new Set(prev);
                      allIds.forEach((id) => next.delete(id));
                      return next;
                    });
                  } else {
                    setTrashSelectedIds((prev) => {
                      const next = new Set(prev);
                      allIds.forEach((id) => next.add(id));
                      return next;
                    });
                  }
                }}
              >
                {filteredTrashRows.every((r) => trashSelectedIds.has(r.id)) ? (
                  <CheckSquare className="w-4 h-4" />
                ) : (
                  <Square className="w-4 h-4" />
                )}
                {t("mediaTrashSelectAll")}
              </Button>
              {trashSelectedIds.size > 0 && (
                <>
                  <span className="text-xs text-muted-foreground">
                    {t("mediaTrashSelectedCount").replace("{count}", String(trashSelectedIds.size))}
                  </span>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-8 gap-1.5"
                    disabled={trashBulkBusy}
                    onClick={() => setBulkRestoreConfirmOpen(true)}
                  >
                    {trashBulkBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RotateCcw className="w-3.5 h-3.5" />}
                    {t("mediaTrashBulkRestore")}
                  </Button>
                  <Button
                    type="button"
                    variant="destructive"
                    size="sm"
                    className="h-8 gap-1.5"
                    disabled={trashBulkBusy}
                    onClick={() => setBulkPurgeConfirmOpen(true)}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    {t("mediaTrashBulkPurge")}
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-8"
                    disabled={trashBulkBusy}
                    onClick={() => setTrashSelectedIds(new Set())}
                  >
                    {t("mediaTrashClearSelection")}
                  </Button>
                </>
              )}
            </div>
          )}
          {/* Trash audit log panel */}
          <div className="rounded-md border bg-card/40">
            <button
              type="button"
              onClick={() => setTrashAuditOpen((v) => !v)}
              className="w-full flex items-center justify-between gap-2 px-3 py-2 text-sm font-medium hover:bg-muted/40 transition-colors rounded-md"
              aria-expanded={trashAuditOpen}
            >
              <span className="flex items-center gap-2">
                <History className="w-4 h-4 text-muted-foreground" />
                {t("mediaTrashAuditTitle")}
              </span>
              <span className="flex items-center gap-1 text-xs text-muted-foreground">
                {trashAuditOpen ? t("mediaTrashAuditHide") : t("mediaTrashAuditShow")}
                {trashAuditOpen ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
              </span>
            </button>
            {trashAuditOpen && (
              <div className="border-t px-3 py-3 space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <Select
                    value={trashAuditActionFilter}
                    onValueChange={(v) => setTrashAuditActionFilter(v as typeof trashAuditActionFilter)}
                  >
                    <SelectTrigger className="h-8 w-[160px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__all__">{t("mediaTrashAuditFilterAll")}</SelectItem>
                      <SelectItem value="restore">{t("mediaTrashAuditActionRestore")}</SelectItem>
                      <SelectItem value="purge">{t("mediaTrashAuditActionPurge")}</SelectItem>
                    </SelectContent>
                  </Select>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-8 gap-1.5"
                    onClick={() => void fetchTrashAudit()}
                    disabled={trashAuditLoading}
                  >
                    {trashAuditLoading
                      ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      : <RotateCcw className="w-3.5 h-3.5" />}
                    {t("mediaTrashAuditRefresh")}
                  </Button>
                </div>
                {trashAuditError ? (
                  <div className="py-3 text-center text-xs text-destructive">
                    {t("mediaTrashAuditError").replace("{err}", trashAuditError)}
                  </div>
                ) : trashAuditLoading ? (
                  <div className="flex items-center justify-center py-4 text-muted-foreground">
                    <Loader2 className="w-4 h-4 animate-spin" />
                  </div>
                ) : filteredTrashAuditRows.length === 0 ? (
                  <div className="py-4 text-center text-xs text-muted-foreground">
                    {t("mediaTrashAuditEmpty")}
                  </div>
                ) : (
                  <div className="max-h-64 overflow-y-auto divide-y divide-border rounded border bg-background">
                    {filteredTrashAuditRows.map((row) => {
                      const isRestore = row.action_code === "media.restore_soft_deleted";
                      const params = (row.action_params || {}) as Record<string, unknown>;
                      const status = (params.status as string) || "success";
                      const errorReason = (params.error as string) || null;
                      const profile = getProfile(row.user_id);
                      const userLabel = profile?.display_name || t("mediaTrashAuditUnknownUser");
                      const itemName = row.target_name || (row.target_id ? row.target_id.slice(0, 8) : "—");
                      const orgName = row.org_id ? orgNameById.get(row.org_id) : null;
                      return (
                        <div key={row.id} className="px-3 py-2 text-xs flex items-start gap-2">
                          <Badge
                            variant={isRestore ? "secondary" : "destructive"}
                            className="shrink-0 h-5 text-[10px]"
                          >
                            {isRestore ? t("mediaTrashAuditActionRestore") : t("mediaTrashAuditActionPurge")}
                          </Badge>
                          <div className="flex-1 min-w-0 space-y-0.5">
                            <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                              <span className="font-medium text-foreground truncate">{userLabel}</span>
                              <span
                                className={
                                  status === "success"
                                    ? "text-emerald-600 dark:text-emerald-400"
                                    : "text-destructive"
                                }
                              >
                                · {status === "success"
                                  ? t("mediaTrashAuditStatusSuccess")
                                  : `${t("mediaTrashAuditStatusFailed")}${errorReason ? ` (${errorReason})` : ""}`}
                              </span>
                              <span className="text-muted-foreground">
                                · {new Date(row.created_at).toLocaleString()}
                              </span>
                            </div>
                            <div className="text-muted-foreground truncate">
                              <span className="text-foreground/80">{itemName}</span>
                              {orgName && (
                                <span className="ml-1 inline-flex items-center gap-1">
                                  · <Building2 className="w-3 h-3 inline" />{orgName}
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </div>
          {trashLoading ? (
            <div className="flex items-center justify-center py-10 text-muted-foreground">
              <Loader2 className="w-5 h-5 animate-spin" />
            </div>
          ) : trashRows.length === 0 ? (
            <div className="py-10 text-center text-sm text-muted-foreground">
              {t("mediaTrashEmpty")}
            </div>
          ) : filteredTrashRows.length === 0 ? (
            <div className="py-10 text-center text-sm text-muted-foreground">
              {t("mediaTrashNoMatch")}
            </div>
          ) : (
            <div className="max-h-[60vh] overflow-y-auto divide-y divide-border rounded-md border">
              {filteredTrashRows.map((row) => {
                const Icon = row.type === "image" ? FileImage : row.type === "video" ? FileVideo : Music;
                return (
                  <div key={row.id} className="flex items-center gap-3 p-3">
                    <Checkbox
                      checked={trashSelectedIds.has(row.id)}
                      onCheckedChange={() => toggleTrashSelected(row.id)}
                      aria-label={row.original_name || row.name}
                      className="shrink-0"
                    />
                    <div className="w-14 h-14 rounded bg-muted flex items-center justify-center overflow-hidden shrink-0">
                      {row.thumbnail ? (
                        <img src={row.thumbnail} alt="" className="w-full h-full object-cover" />
                      ) : (
                        <Icon className="w-6 h-6 text-muted-foreground" />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-sm truncate text-foreground">
                        {row.original_name || row.name}
                      </div>
                      {(trashOrgFilter === "__all__" || row.org_id !== activeOrgId) && orgNameById.get(row.org_id) && (
                        <div className="text-xs text-muted-foreground mt-0.5 flex items-center gap-1">
                          <Building2 className="w-3 h-3" />
                          {orgNameById.get(row.org_id)}
                        </div>
                      )}
                      <div className="text-xs text-muted-foreground mt-0.5">
                        {t("mediaTrashDeletedAt")}: {new Date(row.deleted_at).toLocaleString()}
                      </div>
                      {(() => {
                        const totalMs = 7 * 24 * 60 * 60 * 1000;
                        const elapsed = Date.now() - new Date(row.deleted_at).getTime();
                        const remaining = Math.max(0, totalMs - elapsed);
                        const remainingPct = Math.max(0, Math.min(100, (remaining / totalMs) * 100));
                        const tone =
                          remainingPct <= 15
                            ? "bg-destructive"
                            : remainingPct <= 40
                              ? "bg-amber-500"
                              : "bg-primary";
                        const labelTone =
                          remainingPct <= 15
                            ? "text-destructive"
                            : remainingPct <= 40
                              ? "text-amber-600 dark:text-amber-400"
                              : "text-muted-foreground";
                        return (
                          <div className="mt-1 space-y-1">
                            <div className={`text-xs font-medium ${labelTone}`}>
                              {t("mediaTrashExpiresIn")} {formatTrashRemaining(row.deleted_at)}
                            </div>
                            <div className="text-[11px] text-muted-foreground">
                              {t("mediaTrashPurgeOn").replace("{date}", formatTrashExpiryDate(row.deleted_at))}
                            </div>
                            <div
                              className="h-1.5 w-full rounded-full bg-muted overflow-hidden"
                              role="progressbar"
                              aria-valuemin={0}
                              aria-valuemax={100}
                              aria-valuenow={Math.round(remainingPct)}
                              aria-label={`${t("mediaTrashExpiresIn")} ${formatTrashRemaining(row.deleted_at)}`}
                            >
                              <div
                                className={`h-full ${tone} transition-all`}
                                style={{ width: `${remainingPct}%` }}
                              />
                            </div>
                          </div>
                        );
                      })()}
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <Button variant="outline" size="sm" className="gap-1.5" disabled={trashBusyId === row.id} onClick={() => setRestoreConfirmId(row.id)}>
                        {trashBusyId === row.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RotateCcw className="w-3.5 h-3.5" />}
                        {t("mediaTrashRestore")}
                      </Button>
                      <Button variant="destructive" size="sm" className="gap-1.5" disabled={trashBusyId === row.id} onClick={() => setPurgeConfirmId(row.id)}>
                        <Trash2 className="w-3.5 h-3.5" />
                        {t("mediaTrashPurge")}
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </DialogContent>
      </Dialog>

      {(() => {
        const restoreRow = trashRows.find((r) => r.id === restoreConfirmId) || null;
        const purgeRow = trashRows.find((r) => r.id === purgeConfirmId) || null;
        return (
          <>
            <AlertDialog open={!!restoreConfirmId} onOpenChange={(o) => !o && setRestoreConfirmId(null)}>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle className="flex items-center gap-2">
                    <RotateCcw className="w-5 h-5 text-primary" />
                    {t("mediaTrashRestoreConfirmTitle")}
                  </AlertDialogTitle>
                  <AlertDialogDescription asChild>
                    <div className="space-y-3">
                      <p className="text-sm text-muted-foreground">{t("mediaTrashRestoreConfirmDesc")}</p>
                      {restoreRow && (
                        <div className="rounded-md border bg-muted/40 p-3 text-sm space-y-1">
                          <div className="flex items-center gap-2">
                            <span className="text-muted-foreground">{t("mediaTrashItemLabel")}:</span>
                            <span className="font-medium text-foreground truncate">{restoreRow.original_name || restoreRow.name}</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="text-muted-foreground">{t("mediaTrashDeletedAt")}:</span>
                            <span className="text-foreground">{new Date(restoreRow.deleted_at).toLocaleString()}</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="text-muted-foreground">{t("mediaTrashRestoreRemainingLabel")}:</span>
                            <span className="text-foreground font-medium">{formatTrashRemaining(restoreRow.deleted_at)}</span>
                          </div>
                        </div>
                      )}
                    </div>
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel disabled={trashBusyId === restoreConfirmId}>{t("cancel")}</AlertDialogCancel>
                  <AlertDialogAction
                    disabled={trashBusyId === restoreConfirmId}
                    onClick={(e) => {
                      e.preventDefault();
                      if (restoreConfirmId) {
                        const id = restoreConfirmId;
                        setRestoreConfirmId(null);
                        void handleRestore(id);
                      }
                    }}
                  >
                    {trashBusyId === restoreConfirmId ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <RotateCcw className="w-4 h-4 mr-1" />}
                    {t("mediaTrashConfirmRestoreBtn")}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>

            <AlertDialog open={!!purgeConfirmId} onOpenChange={(o) => !o && setPurgeConfirmId(null)}>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle className="flex items-center gap-2 text-destructive">
                    <Trash2 className="w-5 h-5" />
                    {t("mediaTrashPurgeConfirmTitle")}
                  </AlertDialogTitle>
                  <AlertDialogDescription asChild>
                    <div className="space-y-3">
                      <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive-foreground">
                        <p className="font-medium text-destructive">{t("mediaTrashPurgeWarning")}</p>
                      </div>
                      {purgeRow && (
                        <div className="rounded-md border bg-muted/40 p-3 text-sm space-y-1">
                          <div className="flex items-center gap-2">
                            <span className="text-muted-foreground">{t("mediaTrashItemLabel")}:</span>
                            <span className="font-medium text-foreground truncate">{purgeRow.original_name || purgeRow.name}</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="text-muted-foreground">{t("mediaTrashDeletedAt")}:</span>
                            <span className="text-foreground">{new Date(purgeRow.deleted_at).toLocaleString()}</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="text-muted-foreground">{t("mediaTrashRestoreRemainingLabel")}:</span>
                            <span className="text-foreground font-medium">{formatTrashRemaining(purgeRow.deleted_at)}</span>
                          </div>
                        </div>
                      )}
                      <p className="text-xs text-muted-foreground">{t("mediaTrashPurgeConfirm")}</p>
                    </div>
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel disabled={trashBusyId === purgeConfirmId}>{t("cancel")}</AlertDialogCancel>
                  <AlertDialogAction
                    disabled={trashBusyId === purgeConfirmId}
                    className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                    onClick={(e) => {
                      e.preventDefault();
                      if (purgeConfirmId) void handlePurgeNow(purgeConfirmId);
                    }}
                  >
                    {trashBusyId === purgeConfirmId ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <Trash2 className="w-4 h-4 mr-1" />}
                    {t("mediaTrashConfirmPurgeBtn")}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>

            <AlertDialog open={bulkRestoreConfirmOpen} onOpenChange={setBulkRestoreConfirmOpen}>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle className="flex items-center gap-2">
                    <RotateCcw className="w-5 h-5 text-primary" />
                    {t("mediaTrashBulkRestoreConfirmTitle")}
                  </AlertDialogTitle>
                  <AlertDialogDescription asChild>
                    <div className="space-y-2">
                      <p className="text-sm text-muted-foreground">
                        {t("mediaTrashSelectedCount").replace("{count}", String(trashSelectedIds.size))} — {t("mediaTrashRestoreConfirmDesc")}
                      </p>
                      {trashSelectedIds.size > 0 && (() => {
                        const selectedRows = trashRows.filter((r) => trashSelectedIds.has(r.id));
                        const preview = selectedRows.slice(0, 8);
                        const more = selectedRows.length - preview.length;
                        return (
                          <div className="rounded-md border bg-muted/30 px-3 py-2 max-h-40 overflow-y-auto text-xs space-y-1">
                            <div className="font-medium text-foreground">
                              {t("mediaTrashBulkConfirmItemsTitle").replace("{count}", String(selectedRows.length))}
                            </div>
                            <ul className="list-disc pl-4 space-y-0.5">
                              {preview.map((r) => (
                                <li key={r.id} className="truncate">{r.original_name || r.name}</li>
                              ))}
                            </ul>
                            {more > 0 && (
                              <div className="text-muted-foreground">
                                {t("mediaTrashBulkConfirmMore").replace("{count}", String(more))}
                              </div>
                            )}
                          </div>
                        );
                      })()}
                    </div>
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel disabled={trashBulkBusy}>{t("cancel")}</AlertDialogCancel>
                  <AlertDialogAction
                    disabled={trashBulkBusy}
                    onClick={(e) => {
                      e.preventDefault();
                      setBulkRestoreConfirmOpen(false);
                      void runBulkTrashAction("restore");
                    }}
                  >
                    {trashBulkBusy ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <RotateCcw className="w-4 h-4 mr-1" />}
                    {t("mediaTrashConfirmRestoreBtn")}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>

            <AlertDialog open={bulkPurgeConfirmOpen} onOpenChange={setBulkPurgeConfirmOpen}>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle className="flex items-center gap-2 text-destructive">
                    <Trash2 className="w-5 h-5" />
                    {t("mediaTrashBulkPurgeConfirmTitle")}
                  </AlertDialogTitle>
                  <AlertDialogDescription asChild>
                    <div className="space-y-3">
                      <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm">
                        <p className="font-medium text-destructive">{t("mediaTrashPurgeWarning")}</p>
                      </div>
                      <p className="text-sm text-muted-foreground">
                        {t("mediaTrashSelectedCount").replace("{count}", String(trashSelectedIds.size))}
                      </p>
                      {trashSelectedIds.size > 0 && (() => {
                        const selectedRows = trashRows.filter((r) => trashSelectedIds.has(r.id));
                        const preview = selectedRows.slice(0, 8);
                        const more = selectedRows.length - preview.length;
                        return (
                          <div className="rounded-md border bg-muted/30 px-3 py-2 max-h-40 overflow-y-auto text-xs space-y-1">
                            <div className="font-medium text-foreground">
                              {t("mediaTrashBulkConfirmItemsTitle").replace("{count}", String(selectedRows.length))}
                            </div>
                            <ul className="list-disc pl-4 space-y-0.5">
                              {preview.map((r) => (
                                <li key={r.id} className="truncate">{r.original_name || r.name}</li>
                              ))}
                            </ul>
                            {more > 0 && (
                              <div className="text-muted-foreground">
                                {t("mediaTrashBulkConfirmMore").replace("{count}", String(more))}
                              </div>
                            )}
                          </div>
                        );
                      })()}
                      <div className="space-y-1.5">
                        <p className="text-sm text-foreground">
                          {t("mediaTrashBulkPurgeTypeToConfirm").replace(
                            "{phrase}",
                            t("mediaTrashBulkPurgeConfirmPhrase"),
                          )}
                        </p>
                        <Input
                          value={bulkPurgeConfirmText}
                          onChange={(e) => setBulkPurgeConfirmText(e.target.value)}
                          placeholder={t("mediaTrashBulkPurgeConfirmPlaceholder")}
                          autoComplete="off"
                          autoFocus
                          className="h-9"
                        />
                      </div>
                    </div>
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel disabled={trashBulkBusy}>{t("cancel")}</AlertDialogCancel>
                  <AlertDialogAction
                    disabled={trashBulkBusy || bulkPurgeConfirmText.trim() !== t("mediaTrashBulkPurgeConfirmPhrase")}
                    className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                    onClick={(e) => {
                      e.preventDefault();
                      setBulkPurgeConfirmOpen(false);
                      void runBulkTrashAction("purge");
                    }}
                  >
                    {trashBulkBusy ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <Trash2 className="w-4 h-4 mr-1" />}
                    {t("mediaTrashConfirmPurgeBtn")}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>

            <AlertDialog open={!!bulkResult} onOpenChange={(o) => { if (!o) setBulkResult(null); }}>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle className="flex items-center gap-2">
                    {bulkResult?.action === "purge" ? (
                      <Trash2 className="w-5 h-5 text-destructive" />
                    ) : (
                      <RotateCcw className="w-5 h-5 text-primary" />
                    )}
                    {t("mediaTrashBulkResultDialogTitle")}
                    {bulkResult && (
                      <span className="text-xs text-muted-foreground font-normal">
                        ·{" "}
                        {bulkResult.action === "purge"
                          ? t("mediaTrashBulkActionPurge")
                          : t("mediaTrashBulkActionRestore")}
                      </span>
                    )}
                  </AlertDialogTitle>
                  <AlertDialogDescription asChild>
                    <div className="space-y-3">
                      {bulkResult && (() => {
                        const okItems = bulkResult.items.filter((i) => i.ok);
                        const failItems = bulkResult.items.filter((i) => !i.ok);
                        return (
                          <>
                            <p className="text-sm text-muted-foreground">
                              {t("mediaTrashBulkResultSummary")
                                .replace("{total}", String(bulkResult.items.length))
                                .replace("{ok}", String(okItems.length))
                                .replace("{fail}", String(failItems.length))}
                            </p>
                            {failItems.length > 0 && (
                              <div className="rounded-md border border-destructive/40 bg-destructive/10 p-2 max-h-40 overflow-y-auto text-xs">
                                <div className="font-medium text-destructive mb-1">
                                  {t("mediaTrashBulkResultFailedHeader")} ({failItems.length})
                                </div>
                                <ul className="space-y-1">
                                  {failItems.map((i) => (
                                    <li key={i.id} className="flex justify-between gap-2">
                                      <span className="truncate text-foreground">{i.name}</span>
                                      <span className="shrink-0 text-destructive/80 font-mono">{i.error}</span>
                                    </li>
                                  ))}
                                </ul>
                              </div>
                            )}
                            {okItems.length > 0 && (
                              <div className="rounded-md border bg-muted/30 p-2 max-h-40 overflow-y-auto text-xs">
                                <div className="font-medium text-emerald-600 dark:text-emerald-400 mb-1">
                                  {t("mediaTrashBulkResultSucceededHeader")} ({okItems.length})
                                </div>
                                <ul className="space-y-0.5">
                                  {okItems.map((i) => (
                                    <li key={i.id} className="truncate">{i.name}</li>
                                  ))}
                                </ul>
                              </div>
                            )}
                          </>
                        );
                      })()}
                    </div>
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  {bulkResult && bulkResult.items.some((i) => !i.ok) && (
                    <Button
                      variant="outline"
                      disabled={trashBulkBusy}
                      onClick={() => {
                        const failedIds = bulkResult.items.filter((i) => !i.ok).map((i) => i.id);
                        const action = bulkResult.action;
                        setBulkResult(null);
                        runBulkTrashAction(action, failedIds);
                      }}
                    >
                      <RotateCcw className="w-4 h-4" />
                      {t("mediaTrashBulkResultRetryFailed").replace(
                        "{n}",
                        String(bulkResult.items.filter((i) => !i.ok).length),
                      )}
                    </Button>
                  )}
                  <AlertDialogAction onClick={() => setBulkResult(null)}>
                    {t("mediaTrashBulkResultClose")}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </>
        );
      })()}
    </div>
  );
};

export default MediaPage;

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function getEncodingFromUrl(url?: string | null): string {
  if (!url) return "-";
  if (url.startsWith("widget://")) return "Widget JSON";
  const match = url.match(/^data:([^;,]+)/);
  if (match) return match[1];
  return "-";
}

/** Short, uppercase audio format label (e.g. "MP3", "WAV", "OGG", "M4A", "AAC", "FLAC"). */
export function getAudioFormatLabel(item: { mime_type?: string | null; name?: string | null; original_name?: string | null; url?: string | null }): string {
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

async function computeMD5(data?: string | null): Promise<string> {
  if (!data) return "-";
  const encoder = new TextEncoder();
  const dataBuffer = encoder.encode(data);
  const hashBuffer = await crypto.subtle.digest("SHA-256", dataBuffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  // Use first 16 bytes (128 bits) to mimic MD5 length
  return hashArray.slice(0, 16).map(b => b.toString(16).padStart(2, "0")).join("");
}

function PreviewInfoPanel({ item, usedInProjects, usedInSchedules, t, uploaderProfile }: { item: MediaItemRow; usedInProjects: { id: string; name: string }[]; usedInSchedules: { id: string; name: string }[]; t: (key: string) => string; uploaderProfile: { display_name: string | null; avatar_url: string | null } | null }) {
  const [hash, setHash] = useState<string>("...");
  const [extraInfo, setExtraInfo] = useState<{ pixels?: string; frameRate?: string; bitrate?: string }>({});
  const uploader = uploaderProfile;

  useEffect(() => {
    computeMD5(item.url).then(setHash).catch(() => setHash("-"));
  }, [item.url]);

  useEffect(() => {
    if (item.type === "image" && item.url && !item.url.startsWith("widget://")) {
      const img = new Image();
      img.onload = () => {
        const totalPixels = img.width * img.height;
        let pixelStr: string;
        if (totalPixels >= 1_000_000) pixelStr = `${(totalPixels / 1_000_000).toFixed(1)} MP`;
        else if (totalPixels >= 1_000) pixelStr = `${(totalPixels / 1_000).toFixed(1)} KP`;
        else pixelStr = `${totalPixels} px`;
        setExtraInfo({ pixels: pixelStr });
      };
      img.src = item.url;
    }

    if (item.type === "video" && item.url) {
      const video = document.createElement("video");
      video.preload = "metadata";
      video.muted = true;

      // Try to detect frame rate using requestVideoFrameCallback
      let frameCount = 0;
      let startTime = 0;
      let resolved = false;

      const resolveInfo = (fps: string | null) => {
        if (resolved) return;
        resolved = true;
        // Estimate bitrate from numeric size_bytes / duration_seconds (legacy text fallback handled inside helpers).
        let bitrateStr = "-";
        const sizeBytes = getSizeBytes(item);
        const totalSecs = getDurationSec(item);
        if (sizeBytes > 0 && totalSecs > 0) {
          const bitsPerSec = (sizeBytes * 8) / totalSecs;
          if (bitsPerSec >= 1_000_000) bitrateStr = `${(bitsPerSec / 1_000_000).toFixed(1)} Mbps`;
          else if (bitsPerSec >= 1_000) bitrateStr = `${(bitsPerSec / 1_000).toFixed(0)} Kbps`;
          else bitrateStr = `${Math.round(bitsPerSec)} bps`;
        }
        setExtraInfo({ frameRate: fps || "-", bitrate: bitrateStr });
        video.pause();
        video.src = "";
      };

      video.onloadeddata = () => {
        // Use requestVideoFrameCallback if available to measure FPS
        if ("requestVideoFrameCallback" in video) {
          startTime = performance.now();
          const countFrames = (_now: number, _meta: unknown) => {
            frameCount++;
            if (frameCount >= 10) {
              const elapsed = (performance.now() - startTime) / 1000;
              const fps = elapsed > 0 ? (frameCount / elapsed).toFixed(1) : "-";
              resolveInfo(`${fps} fps`);
              return;
            }
            (video as HTMLVideoElement & { requestVideoFrameCallback: (cb: (now: number, meta: unknown) => void) => void }).requestVideoFrameCallback(countFrames);
          };
          video.playbackRate = 4;
          video.play().then(() => {
            (video as HTMLVideoElement & { requestVideoFrameCallback: (cb: (now: number, meta: unknown) => void) => void }).requestVideoFrameCallback(countFrames);
          }).catch(() => resolveInfo(null));
          // Timeout fallback
          setTimeout(() => resolveInfo(null), 5000);
        } else {
          resolveInfo(null);
        }
      };
      video.onerror = () => resolveInfo(null);
      video.src = item.url;
    }
  }, [item.url, item.type, item.size_bytes, item.duration_seconds]);

  const encoding = item.mime_type || getEncodingFromUrl(item.url);
  const uploadDate = item.created_at ? new Date(item.created_at).toLocaleString("zh-TW") : "-";
  const displayName = getDisplayName(item);

  const uploaderName = uploader?.display_name?.trim() || (item.uploaded_by ? item.uploaded_by.slice(0, 8) : "-");
  const uploaderInitial = (uploader?.display_name?.trim() || "?").charAt(0).toUpperCase();
  const uploaderNode: React.ReactNode = item.is_system ? (
    <span>—</span>
  ) : item.uploaded_by ? (
    <span className="inline-flex items-center gap-2">
      <Avatar className="h-5 w-5">
        {uploader?.avatar_url ? <AvatarImage src={uploader.avatar_url} alt={uploaderName} /> : null}
        <AvatarFallback className="text-[10px]">{uploaderInitial}</AvatarFallback>
      </Avatar>
      <span>{uploaderName}</span>
    </span>
  ) : (
    <span>-</span>
  );

  const fields: { label: string; value: React.ReactNode }[] = [
    { label: t("mediaFileName"), value: displayName },
    { label: t("mediaResolution"), value: formatDimensions(item) || "-" },
    { label: t("mediaFileSize"), value: formatMediaBytes(getSizeBytes(item)) || "-" },
    { label: t("mediaEncoding"), value: encoding },
    ...(item.type === "image" ? [{ label: t("mediaPixels"), value: extraInfo.pixels || "..." }] : []),
    ...(item.type === "video" ? [
      { label: t("mediaDuration"), value: formatDuration(item) || "-" },
      { label: t("mediaFrameRate"), value: extraInfo.frameRate || "..." },
      { label: t("mediaBitrate"), value: extraInfo.bitrate || "..." },
    ] : []),
    { label: t("mediaUploader"), value: uploaderNode },
    { label: t("mediaUploadDate"), value: uploadDate },
    { label: "MD5", value: item.md5 || hash },
    {
      label: t("mediaUsedInProjects"),
      value: usedInProjects.length > 0 ? (
        <div className="flex flex-wrap items-center gap-1">
          {usedInProjects.map((p) => (
            <span
              key={p.id}
              title={p.name}
              className="inline-flex max-w-[180px] items-center gap-1 truncate rounded-full bg-primary/10 px-1.5 py-0.5 text-[11px] font-medium text-primary"
            >
              <FolderOpen className="h-3 w-3 shrink-0" />
              <span className="truncate">{p.name}</span>
            </span>
          ))}
        </div>
      ) : (
        <span className="text-xs italic text-muted-foreground">{t("mediaUsedInNone")}</span>
      ),
    },
    {
      label: t("mediaUsedInSchedules"),
      value: usedInSchedules.length > 0 ? (
        <div className="flex flex-wrap items-center gap-1">
          {usedInSchedules.map((s) => (
            <span
              key={s.id}
              title={s.name}
              className="inline-flex max-w-[180px] items-center gap-1 truncate rounded-full bg-accent/15 px-1.5 py-0.5 text-[11px] font-medium text-accent-foreground"
            >
              <Calendar className="h-3 w-3 shrink-0" />
              <span className="truncate">{s.name}</span>
            </span>
          ))}
        </div>
      ) : (
        <span className="text-xs italic text-muted-foreground">{t("mediaUsedInNone")}</span>
      ),
    },
  ];

  // Detect Kevin MacLeod / CC BY 4.0 attribution from original_name (e.g. "Bossa Antigua - Kevin MacLeod (CC BY 4.0).mp3")
  const attribution = (() => {
    if (item.type !== "audio") return null;
    const src = `${item.original_name || ""} ${item.name || ""}`;
    const isKM = /kevin\s*macleod/i.test(src);
    const isCCBY = /cc\s*by\s*4\.?0/i.test(src);
    if (!isKM && !isCCBY) return null;
    const titleMatch = (item.original_name || "").match(/^\s*([^-(]+?)\s*[-(]/);
    const trackTitle = titleMatch?.[1]?.trim() || item.name.replace(/\.[^.]+$/, "");
    return {
      title: trackTitle,
      author: isKM ? "Kevin MacLeod" : "Unknown",
      authorUrl: "https://incompetech.com/",
      license: "Creative Commons Attribution 4.0",
      licenseUrl: "https://creativecommons.org/licenses/by/4.0/",
    };
  })();

  return (
    <div className="space-y-3">
      <div className="rounded-lg border border-border bg-muted/30 p-3 text-xs">
        <table className="w-full">
          <tbody>
            {fields.map((f) => (
              <tr key={f.label} className="border-b border-border/40 last:border-0">
                <td className="py-1 pr-3 text-muted-foreground whitespace-nowrap w-[1%]">{f.label}</td>
                <td className="py-1 font-medium text-foreground break-all">{f.value}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {attribution && (
        <div className="rounded-lg border border-primary/30 bg-primary/5 p-3 text-xs">
          <div className="flex items-start gap-2">
            <Music className="w-4 h-4 text-primary mt-0.5 shrink-0" />
            <div className="space-y-1 flex-1 min-w-0">
              <div className="font-semibold text-foreground">{t("mediaAttributionTitle")}</div>
              <div className="text-muted-foreground leading-relaxed break-words">
                "{attribution.title}" {t("mediaAttributionBy")}{" "}
                <a href={attribution.authorUrl} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline font-medium">
                  {attribution.author}
                </a>
                {" "}— {t("mediaAttributionLicensedUnder")}{" "}
                <a href={attribution.licenseUrl} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline font-medium">
                  {attribution.license}
                </a>
                。
              </div>
              <div className="text-[10px] text-muted-foreground/80 italic">
                {t("mediaAttributionNotice")}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
