import { useEffect, useMemo, useRef, useState } from "react";
import { useLanguage } from "@/contexts/LanguageContext";
import { useAuth } from "@/contexts/AuthContext";
import { useActiveOrg } from "@/contexts/ActiveOrgContext";
import { supabase } from "@/integrations/supabase/client";
import { uploadMediaFile } from "@/lib/uploadMedia";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { logActivity } from "@/lib/activityLogger";
import { format } from "date-fns";
import {
  LayoutTemplate, Upload, Tv, ArrowRight, ArrowLeft, CheckCircle2,
  Sparkles, Rocket, Loader2, Image as ImageIcon, FileVideo, X, Wifi, WifiOff,
  Monitor, Smartphone, Repeat, CalendarDays, Plus,
  Folder, Shapes, Layers, Gauge, ShieldCheck, ScanLine,
  Search, ArrowUpDown, LayoutGrid, List, Eye, Music, GripVertical, SlidersHorizontal, Trash2,
} from "lucide-react";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  type DragEndEvent,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  horizontalListSortingStrategy,
  sortableKeyboardCoordinates,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  STUDIO_DATA_VERSION,
  getStudioName,
  getStudioLayouts,
  getStudioTemplates,
  invalidateStudioSourceCache,
  type StudioZonePreset,
} from "@/lib/studioData";

type Step = 1 | 2 | 3;
type Orientation = "landscape" | "portrait";
type ScheduleMode = "loop" | "calendar";
type SourceTab = "layout" | "preset" | "mine";

interface TemplateOption { id: string; name: string; aspect: string; zones?: StudioZonePreset[]; }
interface ScreenOption { id: string; name: string; branch: string; online: boolean; }
interface ZoneMediaAssignment { id: string; name: string; type: "image" | "video"; url: string; thumbnail?: string; duration_seconds?: number | null; }
interface ZoneUploadState { name: string; type: "image" | "video"; previewUrl: string; progress: number; index: number; total: number; }
interface ZoneDragState { canUpload: boolean; reason: string; fileCount: number; }

const WEEKDAYS = [
  { code: "mon", zh: "一", en: "M", ja: "月" },
  { code: "tue", zh: "二", en: "T", ja: "火" },
  { code: "wed", zh: "三", en: "W", ja: "水" },
  { code: "thu", zh: "四", en: "T", ja: "木" },
  { code: "fri", zh: "五", en: "F", ja: "金" },
  { code: "sat", zh: "六", en: "S", ja: "土" },
  { code: "sun", zh: "日", en: "S", ja: "日" },
];

const STEP_KEYS = [
  { key: "template", icon: LayoutTemplate },
  { key: "upload", icon: Upload },
  { key: "publish", icon: Rocket },
] as const;

const L = {
  title: { zh: "快速發佈", en: "Quick Publish", ja: "クイック配信" },
  subtitle: { zh: "三步驟完成你的第一次發佈", en: "Three steps to your first broadcast", ja: "3 ステップで初配信を完了" },
  stepTemplate: { zh: "選擇版型", en: "Choose Template", ja: "テンプレート選択" },
  stepUpload: { zh: "上傳檔案", en: "Upload Media", ja: "ファイルアップロード" },
  stepPublish: { zh: "發佈設定", en: "Schedule & Send", ja: "配信設定" },
  orientation: { zh: "螢幕方向", en: "Orientation", ja: "画面方向" },
  landscape: { zh: "橫式", en: "Landscape", ja: "横向き" },
  portrait: { zh: "直式", en: "Portrait", ja: "縦向き" },
  noTemplates: { zh: "此方向尚無版型，請先到內容工坊建立。", en: "No templates for this orientation. Create one in Content Studio first.", ja: "この向きのテンプレートがありません。" },
  projectName: { zh: "專案名稱", en: "Project Name", ja: "プロジェクト名" },
  projectNamePh: { zh: "為這次發佈命名", en: "Name this broadcast", ja: "この配信の名前" },
  selectedTemplate: { zh: "已選版型", en: "Selected Template", ja: "選択中のテンプレート" },
  selectZone: { zh: "選擇區塊", en: "Select Zone", ja: "ゾーン選択" },
  zoneContent: { zh: "區塊素材", en: "Zone Content", ja: "ゾーン素材" },
  zoneEmpty: { zh: "尚未指定素材", en: "No media assigned", ja: "素材未指定" },
  zoneAssigned: { zh: "已指定", en: "Assigned", ja: "指定済み" },
  zoneRequired: { zh: "請為每個區塊指定素材", en: "Assign media to every zone", ja: "各ゾーンに素材を指定してください" },
  mediaLibrary: { zh: "媒體素材庫", en: "Media Library", ja: "メディアライブラリ" },
  clickToAdd: { zh: "點擊縮圖加入目前選取的區塊", en: "Click a thumbnail to add it to the selected zone", ja: "サムネイルをクリックして選択中ゾーンに追加" },
  timeline: { zh: "區塊時間軸", en: "Zone Timeline", ja: "ゾーンタイムライン" },
  playbackSeconds: { zh: "播放秒數", en: "Playback seconds", ja: "再生秒数" },
  totalPlayback: { zh: "累計總播放時間", en: "Total playback time", ja: "累計再生時間" },
  bgm: { zh: "背景樂", en: "BGM", ja: "BGM" },
  all: { zh: "全部", en: "All", ja: "すべて" },
  image: { zh: "圖片", en: "Images", ja: "画像" },
  video: { zh: "影片", en: "Videos", ja: "動画" },
  search: { zh: "搜尋", en: "Search", ja: "検索" },
  uploadZone: { zh: "點擊或拖曳上傳", en: "Click or drag to upload", ja: "クリックまたはドラッグ" },
  uploadHint: { zh: "上傳檔案將自動加入媒體櫃", en: "Uploaded files are auto-added to the media library", ja: "アップロードしたファイルは自動でライブラリに追加" },
  fromLibrary: { zh: "從媒體櫃添加", en: "From Media Library", ja: "メディアライブラリから追加" },
  fromLibraryHint: { zh: "選擇現有素材，無需重複上傳", en: "Pick existing assets without re-uploading", ja: "既存素材を選択して再アップロード不要" },
  uploading: { zh: "上傳中...", en: "Uploading...", ja: "アップロード中..." },
  uploadFailed: { zh: "上傳失敗", en: "Upload failed", ja: "アップロード失敗" },
  unsupportedFileType: { zh: "不支援的檔案類型", en: "Unsupported file type", ja: "未対応のファイル形式" },
  supportedFileTypes: { zh: "僅支援 JPG、PNG、MP4、MOV", en: "Only JPG, PNG, MP4, and MOV are supported", ja: "JPG、PNG、MP4、MOV のみ対応" },
  skippedUnsupportedFiles: { zh: "已跳過不支援的檔案", en: "Skipped unsupported files", ja: "未対応ファイルをスキップしました" },
  canUpload: { zh: "可上傳", en: "Ready to upload", ja: "アップロード可能" },
  cannotUpload: { zh: "不可上傳", en: "Cannot upload", ja: "アップロード不可" },
  dropFileOnly: { zh: "請拖放檔案", en: "Drop files only", ja: "ファイルのみドロップ" },
  scheduleMode: { zh: "排程模式", en: "Schedule Mode", ja: "スケジュールモード" },
  loopMode: { zh: "週循環", en: "Weekly Loop", ja: "週ループ" },
  loopModeHint: { zh: "選擇每週重複播放的日子", en: "Pick weekdays for repeating playback", ja: "繰り返し再生する曜日を選択" },
  calendarMode: { zh: "月曆排程", en: "Calendar Schedule", ja: "カレンダー" },
  calendarModeHint: { zh: "選擇特定日期播放", en: "Pick a specific date", ja: "特定の日付を選択" },
  pickDate: { zh: "選擇日期", en: "Pick a date", ja: "日付を選択" },
  startDate: { zh: "開始日期", en: "Start date", ja: "開始日" },
  endDate: { zh: "結束日期", en: "End date", ja: "終了日" },
  startTime: { zh: "開始時間", en: "Start", ja: "開始時刻" },
  endTime: { zh: "結束時間", en: "End", ja: "終了時刻" },
  selectScreens: { zh: "選擇播放主機", en: "Select Screens", ja: "スクリーン選択" },
  selectAll: { zh: "全選", en: "Select all", ja: "全て選択" },
  publish: { zh: "立即派送", en: "Dispatch Now", ja: "即時配信" },
  publishing: { zh: "派送中...", en: "Dispatching...", ja: "配信中..." },
  next: { zh: "下一步", en: "Next", ja: "次へ" },
  back: { zh: "上一步", en: "Back", ja: "戻る" },
  online: { zh: "上線", en: "Online", ja: "オンライン" },
  offline: { zh: "離線", en: "Offline", ja: "オフライン" },
  done: { zh: "派送完成！", en: "Sent!", ja: "配信完了！" },
  doneHint: { zh: "你的內容已下發至選定的主機", en: "Your content is on its way", ja: "コンテンツが配信されました" },
  doneAgain: { zh: "再發一次", en: "Publish again", ja: "もう一度" },
  noOrg: { zh: "請先選擇組織", en: "Please select an organization", ja: "組織を選択してください" },
  noFile: { zh: "請先上傳或選擇檔案", en: "Please upload or pick a file", ja: "ファイルが必要です" },
  noScreens: { zh: "請至少選一台螢幕", en: "Pick at least one screen", ja: "スクリーンを選択" },
  noWeekdays: { zh: "請至少選一天", en: "Pick at least one day", ja: "曜日を選択" },
  saved: { zh: "已自動儲存", en: "Auto-saved", ja: "自動保存済み" },
  tabLayout: { zh: "版型", en: "Layouts", ja: "レイアウト" },
  tabPreset: { zh: "樣板", en: "Presets", ja: "テンプレート" },
  tabMine: { zh: "我的專案", en: "My Projects", ja: "マイプロジェクト" },
  tabLayoutHint: { zh: "從基礎分割版型開始", en: "Start from a basic zone layout", ja: "基本レイアウトから開始" },
  tabPresetHint: { zh: "套用設計好的樣板", en: "Apply a designed preset", ja: "デザイン済みテンプレート" },
  tabMineHint: { zh: "選擇你已建立的專案", en: "Pick your saved project", ja: "作成済みプロジェクトから選択" },
  noPresets: { zh: "尚無樣板", en: "No presets yet", ja: "テンプレートなし" },
  noMine: { zh: "尚無自建專案", en: "No projects yet", ja: "プロジェクトなし" },
  qualityRes: { zh: "建議解析度", en: "Recommended resolution", ja: "推奨解像度" },
  qualitySafe: { zh: "安全邊界", en: "Safe margin", ja: "安全余白" },
  qualityFit: { zh: "適配比例", en: "Fit ratio", ja: "比率適合" },
  qualitySafeValue: { zh: "5% 內縮", en: "5% inset", ja: "5% 内側" },
  qualityFitValue: { zh: "無裁切", en: "No crop", ja: "切抜なし" },
};

const QP_SPACE = {
  page: "px-3 py-4 sm:px-6 sm:py-6 lg:px-8 lg:py-7",
  hero: "p-5 sm:p-8 lg:p-10",
  section: "p-4 sm:p-5 lg:p-6",
  stack: "space-y-6",
  grid: "gap-3 sm:gap-4 lg:gap-5",
  control: "h-12 rounded-xl",
  footer: "mt-8 p-3",
} as const;

const QP_TYPE = {
  heroTitle: "text-3xl sm:text-4xl lg:text-5xl font-bold tracking-tight",
  heroSubtitle: "text-base sm:text-lg text-muted-foreground",
  sectionLabel: "text-sm font-semibold text-muted-foreground",
  cardTitle: "text-sm font-semibold leading-tight",
  cardMeta: "text-xs text-muted-foreground leading-relaxed",
  micro: "text-[10px] text-muted-foreground leading-none",
} as const;

const QP_SURFACE = {
  shell: "rounded-[1.75rem] border bg-card/70 shadow-[0_18px_70px_-52px_hsl(var(--foreground)/0.7)] backdrop-blur",
  card: "rounded-[1.35rem] border bg-background/80 shadow-sm transition-all duration-300 ease-out hover:-translate-y-1 hover:shadow-[0_18px_45px_-32px_hsl(var(--foreground)/0.65)] active:scale-[0.985] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/45",
  selected: "border-primary bg-primary/5 ring-4 ring-primary/10 shadow-[0_18px_55px_-32px_hsl(var(--primary)/0.9)] animate-in zoom-in-95 duration-200",
  unselected: "border-border hover:border-primary/50 hover:bg-card",
  choice: "rounded-2xl border bg-background/80 transition-all duration-300 ease-out hover:-translate-y-0.5 hover:shadow-sm active:scale-[0.99] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/45",
  choiceSelected: "border-primary bg-primary/10 shadow-[0_18px_45px_-32px_hsl(var(--primary)/0.8)] ring-4 ring-primary/10",
} as const;

const QP_CARD_SIZE = {
  landscape: "min-h-[196px] sm:min-h-[220px]",
  portrait: "min-h-[244px] sm:min-h-[268px]",
  action: "min-h-[104px]",
  upload: "min-h-[280px]",
} as const;

const QP_THUMB_SIZE = {
  landscape: "aspect-[16/9] min-h-[108px] sm:min-h-[124px]",
  portrait: "aspect-[9/16] min-h-[156px] sm:min-h-[176px]",
} as const;

const QUICK_PUBLISH_ACCEPTED_TYPES = new Set(["image/jpeg", "image/png", "video/mp4", "video/quicktime"]);
const DEFAULT_IMAGE_DURATION_SECONDS = 7;
const QUICK_PUBLISH_TIMELINE_PX_PER_SECOND = 34;

const isQuickPublishSupportedFile = (file: File) => QUICK_PUBLISH_ACCEPTED_TYPES.has(file.type);
const getZoneItemDuration = (item: ZoneMediaAssignment) => Math.max(1, Math.round(Number(item.duration_seconds) || DEFAULT_IMAGE_DURATION_SECONDS));
const getTimelineItemWidth = (item: ZoneMediaAssignment) => Math.max(180, getZoneItemDuration(item) * QUICK_PUBLISH_TIMELINE_PX_PER_SECOND);

const mapAssignmentsToStudioZones = (zones: StudioZonePreset[], assignments: Record<string, ZoneMediaAssignment[]>) =>
  zones.map((zone) => {
    const items = assignments[zone.id] || [];
    if (items.length === 0) return { ...zone };
    return {
      ...zone,
      content: {
        type: "media",
        value: "",
        mediaItems: items.map((item) => ({
          id: item.id,
          type: item.type,
          url: item.url,
          name: item.name,
          duration: getZoneItemDuration(item),
        })),
      },
    };
  });

const mapStudioZonesToAssignments = (zones: StudioZonePreset[]) => {
  const next: Record<string, ZoneMediaAssignment[]> = {};
  zones.forEach((zone) => {
    const mediaItems = Array.isArray((zone as any).content?.mediaItems) ? (zone as any).content.mediaItems : [];
    if (mediaItems.length === 0) return;
    next[zone.id] = mediaItems
      .filter((item: any) => item?.id && (item.type === "image" || item.type === "video"))
      .map((item: any) => ({
        id: String(item.id),
        name: String(item.name || item.id),
        type: item.type,
        url: String(item.url || ""),
        duration_seconds: Number(item.duration) || DEFAULT_IMAGE_DURATION_SECONDS,
      }));
  });
  return next;
};

const getQuickPublishDragState = (dataTransfer: DataTransfer, supportedLabel: string, fileOnlyLabel: string): ZoneDragState => {
  const items = Array.from(dataTransfer.items || []).filter((item) => item.kind === "file");
  if (items.length === 0) return { canUpload: false, reason: fileOnlyLabel, fileCount: 0 };
  const supportedCount = items.filter((item) => item.type && QUICK_PUBLISH_ACCEPTED_TYPES.has(item.type)).length;
  if (supportedCount === 0) return { canUpload: false, reason: supportedLabel, fileCount: items.length };
  return { canUpload: true, reason: supportedLabel, fileCount: items.length };
};

// ── Shared studio presets ────────────────────────────────────────
type ZoneDef = Pick<StudioZonePreset, "x" | "y" | "w" | "h" | "label">;

function LayoutThumb({ zones, aspect }: { zones: ZoneDef[]; aspect: "16:9" | "9:16" }) {
  const vbW = aspect === "9:16" ? 36 : 64;
  const vbH = aspect === "9:16" ? 64 : 36;
  return (
    <svg viewBox={`0 0 ${vbW} ${vbH}`} className="w-full h-full drop-shadow-sm" preserveAspectRatio="xMidYMid meet" aria-hidden>
      <rect x={0} y={0} width={vbW} height={vbH} rx={4} className="fill-background stroke-border" strokeWidth={0.6} />
      {zones.map((z, i) => (
        <rect key={i}
          x={(z.x / 100) * vbW + 1}
          y={(z.y / 100) * vbH + 1}
          width={(z.w / 100) * vbW - 2}
          height={(z.h / 100) * vbH - 2}
          rx={2}
          className="fill-primary/20 stroke-primary/70"
          strokeWidth={0.6}
        />
      ))}
    </svg>
  );
}

function QualityStrip({ items }: { items: { icon: any; label: string; value: string }[] }) {
  if (items.length === 0) return null;
  return (
    <div className="grid grid-cols-1 gap-2 rounded-2xl border bg-primary/5 p-3 animate-in fade-in slide-in-from-top-2 duration-300 sm:grid-cols-3">
      {items.map(({ icon: Icon, label, value }) => (
        <div key={label} className="flex min-h-[64px] items-center gap-3 rounded-xl bg-card/80 px-3 py-2 ring-1 ring-primary/10">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground shadow-sm">
            <Icon className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <div className="text-[10px] font-semibold uppercase text-muted-foreground">{label}</div>
            <div className="truncate text-sm font-semibold text-foreground">{value}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

function SortableZoneMediaItem({
  dragId,
  item,
  index,
  playbackSecondsLabel,
  onDurationChange,
  onRemove,
  onPreview,
}: {
  dragId: string;
  item: ZoneMediaAssignment;
  index: number;
  playbackSecondsLabel: string;
  onDurationChange: (value: string) => void;
  onRemove: () => void;
  onPreview: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: dragId });
  const handleDurationResizeStart = (event: React.PointerEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    const startX = event.clientX;
    const startDuration = getZoneItemDuration(item);
    const onMove = (moveEvent: PointerEvent) => {
      const next = Math.max(1, Math.round(startDuration + (moveEvent.clientX - startX) / QUICK_PUBLISH_TIMELINE_PX_PER_SECOND));
      onDurationChange(String(next));
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };
  return (
    <span
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition, width: getTimelineItemWidth(item) }}
      className={cn("flex shrink-0 flex-col text-foreground", isDragging && "z-20 opacity-70")}
    >
      <label className="sr-only">{playbackSecondsLabel}</label>
      <span className={cn("relative flex w-full flex-col overflow-hidden rounded-lg border bg-background shadow-sm", isDragging && "ring-2 ring-primary/30")}>
        <button type="button" className="relative h-16 w-full overflow-hidden bg-muted text-left" onClick={(event) => { event.stopPropagation(); onPreview(); }}>
          {item.type === "video" && !item.thumbnail ? (
            <span className="flex h-16 w-full items-center justify-center bg-foreground/90"><FileVideo className="h-6 w-6 text-background" /></span>
          ) : (
            <img src={item.thumbnail || item.url} alt="" className="h-16 w-full object-cover" loading="lazy" />
          )}
        </button>
        <button type="button" aria-label={playbackSecondsLabel} className="absolute right-0 top-0 h-16 w-2 cursor-ew-resize bg-primary/0 hover:bg-primary/25" onPointerDown={handleDurationResizeStart} />
        <span className="flex h-9 cursor-grab items-center gap-1 border-t bg-background px-1.5 active:cursor-grabbing" {...attributes} {...listeners}>
          <span className="shrink-0 rounded-md p-1 text-muted-foreground">
            <GripVertical className="h-4 w-4" />
          </span>
          <span className="min-w-0 flex-1 truncate text-xs font-medium text-foreground">{index + 1}. {item.name}</span>
          <button type="button" className="shrink-0 rounded-md p-1 text-muted-foreground hover:bg-muted" onClick={(event) => { event.stopPropagation(); const next = window.prompt(playbackSecondsLabel, String(getZoneItemDuration(item))); if (next) onDurationChange(next); }}>
            <SlidersHorizontal className="h-4 w-4" />
          </button>
          <button type="button" className="shrink-0 rounded-md p-1 text-muted-foreground hover:bg-muted" onClick={(event) => event.stopPropagation()}>
            <Eye className="h-4 w-4" />
          </button>
          <button type="button" className="shrink-0 rounded-md p-1 text-destructive hover:bg-destructive/10" onClick={(event) => { event.stopPropagation(); onRemove(); }}>
            <Trash2 className="h-4 w-4" />
          </button>
        </span>
      </span>
    </span>
  );
}

function TimelineRuler({ duration }: { duration: number }) {
  const safeDuration = Math.max(1, duration);
  const width = Math.max(180, safeDuration * QUICK_PUBLISH_TIMELINE_PX_PER_SECOND);
  return (
    <div className="relative h-7 shrink-0 border-b border-border/80 text-[10px] text-muted-foreground" style={{ width }}>
      {Array.from({ length: safeDuration + 1 }, (_, second) => (
        <span key={second} className="absolute bottom-0 flex h-full flex-col items-center justify-end" style={{ left: second * QUICK_PUBLISH_TIMELINE_PX_PER_SECOND }}>
          <span className={cn("mb-1 h-3 w-px bg-border", second % 5 === 0 && "h-5 bg-muted-foreground")} />
          {(second === 0 || second === safeDuration || second % 5 === 0) && <span className="-translate-x-1/2">{second}s</span>}
        </span>
      ))}
    </div>
  );
}

function QuickPublishZonePreview({
  zones,
  aspect,
  activeZoneId,
  assignments,
  uploadStates,
  dragOverZoneId,
  dragStates,
  onSelect,
  onUploadRequest,
  onDropFiles,
  onDragOverZone,
  onDragStateChange,
  getDragState,
  canUploadLabel,
  cannotUploadLabel,
}: {
  zones: StudioZonePreset[];
  aspect: string;
  activeZoneId: string | null;
  assignments: Record<string, ZoneMediaAssignment[]>;
  uploadStates: Record<string, ZoneUploadState>;
  dragOverZoneId: string | null;
  dragStates: Record<string, ZoneDragState>;
  onSelect: (id: string) => void;
  onUploadRequest: (id: string) => void;
  onDropFiles: (id: string, files: File[]) => void;
  onDragOverZone: (id: string | null) => void;
  onDragStateChange: (id: string, state: ZoneDragState | null) => void;
  getDragState: (dataTransfer: DataTransfer) => ZoneDragState;
  canUploadLabel: string;
  cannotUploadLabel: string;
}) {
  return (
    <div className={cn("relative mx-auto w-full overflow-hidden rounded-2xl border bg-muted/30", aspect === "9:16" ? "max-w-[280px] aspect-[9/16]" : "aspect-video")}> 
      {zones.map((zone) => {
        const active = activeZoneId === zone.id;
        const assigned = assignments[zone.id]?.[0];
        const uploadingState = uploadStates[zone.id];
        const dragging = dragOverZoneId === zone.id;
        const dragState = dragStates[zone.id];
        return (
          <button
            key={zone.id}
            type="button"
            onClick={() => {
              onSelect(zone.id);
              onUploadRequest(zone.id);
            }}
            onDragEnter={(event) => {
              event.preventDefault();
              onSelect(zone.id);
              onDragOverZone(zone.id);
              onDragStateChange(zone.id, getDragState(event.dataTransfer));
            }}
            onDragOver={(event) => {
              event.preventDefault();
              const nextDragState = getDragState(event.dataTransfer);
              event.dataTransfer.dropEffect = nextDragState.canUpload ? "copy" : "none";
              onDragOverZone(zone.id);
              onDragStateChange(zone.id, nextDragState);
            }}
            onDragLeave={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
                onDragOverZone(null);
                onDragStateChange(zone.id, null);
              }
            }}
            onDrop={(event) => {
              event.preventDefault();
              onDragOverZone(null);
              onDragStateChange(zone.id, null);
              const files = Array.from(event.dataTransfer.files || []);
              if (files.length > 0) onDropFiles(zone.id, files);
            }}
            className={cn(
              "absolute overflow-hidden border text-left transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60",
              active ? "z-10 border-primary bg-primary/20 ring-4 ring-primary/15" : "border-primary/35 bg-card/70 hover:bg-primary/10",
              dragging && "z-20 border-primary bg-primary/25 ring-4 ring-primary/25",
            )}
            style={{ left: `${zone.x}%`, top: `${zone.y}%`, width: `${zone.w}%`, height: `${zone.h}%` }}
          >
            {(uploadingState || assigned) && (
              (uploadingState?.type || assigned?.type) === "video" ? (
                <video src={uploadingState?.previewUrl || assigned?.url} className="absolute inset-0 h-full w-full object-cover opacity-80" muted />
              ) : (
                <img src={uploadingState?.previewUrl || assigned?.thumbnail || assigned?.url} alt="" className="absolute inset-0 h-full w-full object-cover opacity-80" loading="lazy" />
              )
            )}
            <span className={cn("absolute left-2 top-2 flex h-7 min-w-7 items-center justify-center rounded-full px-2 text-xs font-bold shadow-sm", active ? "bg-primary text-primary-foreground" : "bg-background/85 text-foreground")}>{zone.label}</span>
            {uploadingState ? (
              <div className="absolute inset-x-2 bottom-2 rounded-xl bg-background/85 p-2 shadow-sm backdrop-blur-sm">
                <div className="mb-1 flex items-center justify-between gap-2 text-[10px] font-semibold text-foreground">
                  <span className="truncate">{uploadingState.name}</span>
                  <span className="shrink-0 text-primary">{uploadingState.progress}%</span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                  <div className="h-full rounded-full bg-primary transition-all duration-300" style={{ width: `${uploadingState.progress}%` }} />
                </div>
                {uploadingState.total > 1 && <div className="mt-1 text-[10px] text-muted-foreground">{uploadingState.index}/{uploadingState.total}</div>}
              </div>
            ) : assigned && <CheckCircle2 className="absolute right-2 top-2 h-5 w-5 rounded-full bg-primary text-primary-foreground" />}
            {dragging && dragState && (
              <span className={cn(
                "absolute inset-3 flex flex-col items-center justify-center rounded-xl border border-dashed bg-background/80 px-2 text-center text-xs font-semibold backdrop-blur-sm",
                dragState.canUpload ? "border-primary text-primary" : "border-destructive text-destructive",
              )}>
                <span>{dragState.canUpload ? canUploadLabel : cannotUploadLabel}</span>
                <span className="mt-1 max-w-full truncate text-[10px] text-muted-foreground">{dragState.reason}</span>
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

export default function QuickPublishPage() {
  const { language } = useLanguage();
  const t = (k: keyof typeof L) => L[k][language];
  const studioText = (key: string) => getStudioName(key, language);
  const { user } = useAuth();
  const { activeOrgId } = useActiveOrg();

  const [step, setStep] = useState<Step>(1);
  const [templates, setTemplates] = useState<TemplateOption[]>([]);
  const [screens, setScreens] = useState<ScreenOption[]>([]);
  const [orientation, setOrientation] = useState<Orientation>("landscape");
  const [templateId, setTemplateId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<SourceTab>("layout");

  // Step 2
  const [projectName, setProjectName] = useState("");
  const [zoneAssignments, setZoneAssignments] = useState<Record<string, ZoneMediaAssignment[]>>({});
  const [zoneUploadStates, setZoneUploadStates] = useState<Record<string, ZoneUploadState>>({});
  const [activeZoneId, setActiveZoneId] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [dragOverZoneId, setDragOverZoneId] = useState<string | null>(null);
  const [zoneDragStates, setZoneDragStates] = useState<Record<string, ZoneDragState>>({});
  const fileRef = useRef<HTMLInputElement>(null);
  const pendingUploadZoneRef = useRef<string | null>(null);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const [libraryItems, setLibraryItems] = useState<any[]>([]);
  const [libraryLoading, setLibraryLoading] = useState(false);
  const [librarySearch, setLibrarySearch] = useState("");
  const [libraryFilter, setLibraryFilter] = useState<"all" | "image" | "video">("all");
  const [libraryView, setLibraryView] = useState<"grid" | "list">("grid");
  const [previewItem, setPreviewItem] = useState<ZoneMediaAssignment | null>(null);

  // Step 3
  const [scheduleMode, setScheduleMode] = useState<ScheduleMode>("loop");
  const [weekdays, setWeekdays] = useState<Set<string>>(new Set(["mon", "tue", "wed", "thu", "fri"]));
  const [calendarStart, setCalendarStart] = useState<Date | undefined>();
  const [calendarEnd, setCalendarEnd] = useState<Date | undefined>();
  const [startTime, setStartTime] = useState("09:00");
  const [endTime, setEndTime] = useState("18:00");
  const [selectedScreens, setSelectedScreens] = useState<Set<string>>(new Set());
  const [publishing, setPublishing] = useState(false);
  const [completed, setCompleted] = useState(false);

  const studioSources = useMemo(() => {
    invalidateStudioSourceCache();
    return { layouts: getStudioLayouts(), templates: getStudioTemplates() };
  }, [STUDIO_DATA_VERSION]);

  useEffect(() => {
    if (!activeOrgId) return;
    setTemplates([]);
    setScreens([]);
    (async () => {
      const [tplRes, scrRes] = await Promise.all([
        (supabase as any).from("design_projects").select("id, name, aspect, zones")
          .eq("org_id", activeOrgId).order("updated_at", { ascending: false }).limit(48),
        (supabase as any).from("screens").select("id, name, branch, online")
          .eq("org_id", activeOrgId).order("name"),
      ]);
      setTemplates(tplRes.data || []);
      setScreens(scrRes.data || []);
    })();
  }, [activeOrgId, STUDIO_DATA_VERSION]);

  const filteredTemplates = templates;

  // Resolve current selection across all 3 tabs (my-projects / built-in layouts / design presets)
  const selectedTpl = useMemo(() => {
    if (!templateId) return null;
    const own = templates.find((x) => x.id === templateId);
    if (own) return { id: own.id, name: own.name, aspect: own.aspect, zones: own.zones || [] } as TemplateOption;
    const lay = studioSources.layouts.find((x) => x.id === templateId);
    if (lay) return { id: lay.id, name: studioText(lay.nameKey), aspect: lay.aspect, zones: lay.zones };
    const pre = studioSources.templates.find((x) => x.id === templateId);
    if (pre) return { id: pre.id, name: studioText(pre.nameKey), aspect: pre.aspect, zones: pre.zones };
    return null;
  }, [templateId, templates, language, studioSources]);

  const selectedZones = useMemo(() => selectedTpl?.zones?.filter((z) => !((z as any)._meta)) || [], [selectedTpl]);
  const assignedZoneCount = useMemo(() => selectedZones.filter((z) => (zoneAssignments[z.id]?.length || 0) > 0).length, [selectedZones, zoneAssignments]);
  const activeAssignment = activeZoneId ? zoneAssignments[activeZoneId]?.[0] : null;
  useEffect(() => {
    setZoneAssignments(mapStudioZonesToAssignments(selectedZones));
    setActiveZoneId(selectedZones[0]?.id || null);
    setZoneDragStates({});
  }, [templateId, selectedZones]);

  const qualityIndicators = useMemo(() => {
    if (!selectedTpl) return [];
    const portrait = selectedTpl.aspect === "9:16";
    return [
      { icon: Gauge, label: t("qualityRes"), value: portrait ? "2160×3840" : "3840×2160" },
      { icon: ShieldCheck, label: t("qualitySafe"), value: t("qualitySafeValue") },
      { icon: ScanLine, label: t("qualityFit"), value: `${selectedTpl.aspect} · ${t("qualityFitValue")}` },
    ];
  }, [selectedTpl, language]);

  // Auto-save to step 2 (just updates state — no DB row needed for draft)
  const goToStep3 = () => {
    if (selectedZones.length === 0 || assignedZoneCount < selectedZones.length) { toast.error(t("zoneRequired")); return; }
    toast.success(t("saved"), { duration: 1500 });
    setStep(3);
  };

  const handleFileChosen = async (f: File | null | undefined, targetZoneId = pendingUploadZoneRef.current || activeZoneId, progressMeta?: { index: number; total: number }) => {
    pendingUploadZoneRef.current = null;
    if (!f || !activeOrgId || !targetZoneId) return;
    const previewUrl = URL.createObjectURL(f);
    const progressTimer = window.setInterval(() => {
      setZoneUploadStates((prev) => {
        const current = prev[targetZoneId];
        if (!current) return prev;
        return { ...prev, [targetZoneId]: { ...current, progress: Math.min(current.progress + 12, 92) } };
      });
    }, 350);
    setZoneUploadStates((prev) => ({
      ...prev,
      [targetZoneId]: {
        name: f.name,
        type: f.type.startsWith("video/") ? "video" : "image",
        previewUrl,
        progress: 5,
        index: progressMeta?.index || 1,
        total: progressMeta?.total || 1,
      },
    }));
    setUploading(true);
    const result = await uploadMediaFile(f, { orgId: activeOrgId, displayName: projectName.trim() || f.name });
    window.clearInterval(progressTimer);
    setUploading(false);
    if (!result.ok) {
      URL.revokeObjectURL(previewUrl);
      setZoneUploadStates((prev) => {
        const next = { ...prev };
        delete next[targetZoneId];
        return next;
      });
      toast.error(t("uploadFailed") + (result.errorDetail ? `: ${result.errorDetail}` : ""));
      return;
    }
    const { data: m } = await (supabase as any).from("media_items").select("url, thumbnail, type, duration_seconds").eq("id", result.data!.id).maybeSingle();
    if (m) {
      setZoneAssignments((prev) => ({
        ...prev,
        [targetZoneId]: [
          ...(prev[targetZoneId] || []),
          { id: result.data!.id, name: result.data!.original_name, type: m.type, url: m.url, thumbnail: m.thumbnail, duration_seconds: m.duration_seconds },
        ],
      }));
    }
    setZoneUploadStates((prev) => ({ ...prev, [targetZoneId]: { ...prev[targetZoneId], progress: 100 } }));
    window.setTimeout(() => {
      URL.revokeObjectURL(previewUrl);
      setZoneUploadStates((prev) => {
        const next = { ...prev };
        delete next[targetZoneId];
        return next;
      });
    }, 500);
  };

  const handleFilesDroppedToZone = async (files: File[], targetZoneId: string) => {
    if (!files.length || !targetZoneId) return;
    const supportedFiles = files.filter(isQuickPublishSupportedFile);
    const unsupportedFiles = files.filter((file) => !isQuickPublishSupportedFile(file));
    if (unsupportedFiles.length > 0) {
      toast.error(`${t("skippedUnsupportedFiles")}: ${unsupportedFiles.map((file) => file.name).join(", ")}`, { description: t("supportedFileTypes") });
    }
    if (supportedFiles.length === 0) {
      return;
    }
    setActiveZoneId(targetZoneId);
    pendingUploadZoneRef.current = null;
    for (const [index, file] of supportedFiles.entries()) {
      await handleFileChosen(file, targetZoneId, { index: index + 1, total: supportedFiles.length });
    }
  };

  const loadLibrary = async () => {
    if (!activeOrgId) return;
    setLibraryLoading(true);
    const { data } = await (supabase as any)
      .from("media_items")
      .select("id, original_name, type, url, thumbnail, duration_seconds")
      .eq("org_id", activeOrgId)
      .in("type", ["image", "video"])
      .order("created_at", { ascending: false })
      .limit(60);
    setLibraryItems(data || []);
    setLibraryLoading(false);
  };

  useEffect(() => { if (step === 2) loadLibrary(); }, [step, activeOrgId]);

  const filteredLibraryItems = useMemo(() => {
    const q = librarySearch.trim().toLocaleLowerCase();
    return libraryItems.filter((item) => {
      if (libraryFilter !== "all" && item.type !== libraryFilter) return false;
      if (!q) return true;
      return String(item.original_name || item.name || "").toLocaleLowerCase().includes(q);
    });
  }, [libraryItems, librarySearch, libraryFilter]);

  const pickFromLibrary = (item: any) => {
    if (!activeZoneId) return;
    setZoneAssignments((prev) => ({
      ...prev,
      [activeZoneId]: [
        ...(prev[activeZoneId] || []),
        { id: item.id, name: item.original_name, type: item.type, url: item.url, thumbnail: item.thumbnail, duration_seconds: item.duration_seconds },
      ],
    }));
  };

  const updateZoneItemDuration = (zoneId: string, itemIndex: number, value: string) => {
    const seconds = Math.max(1, Math.round(Number(value) || DEFAULT_IMAGE_DURATION_SECONDS));
    setZoneAssignments((prev) => ({
      ...prev,
      [zoneId]: (prev[zoneId] || []).map((item, index) =>
        index === itemIndex ? { ...item, duration_seconds: seconds } : item,
      ),
    }));
  };

  const removeZoneItem = (zoneId: string, itemIndex: number) => {
    setZoneAssignments((prev) => ({
      ...prev,
      [zoneId]: (prev[zoneId] || []).filter((_, index) => index !== itemIndex),
    }));
  };

  const handleZoneMediaDragEnd = (zoneId: string, event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    setZoneAssignments((prev) => {
      const items = prev[zoneId] || [];
      const ids = items.map((item, index) => `${zoneId}:${item.id}:${index}`);
      const oldIndex = ids.indexOf(String(active.id));
      const newIndex = ids.indexOf(String(over.id));
      if (oldIndex < 0 || newIndex < 0) return prev;
      return { ...prev, [zoneId]: arrayMove(items, oldIndex, newIndex) };
    });
  };

  const toggleScreen = (id: string) => {
    const next = new Set(selectedScreens);
    if (next.has(id)) next.delete(id); else next.add(id);
    setSelectedScreens(next);
  };
  const toggleAll = () => {
    if (selectedScreens.size === screens.length) setSelectedScreens(new Set());
    else setSelectedScreens(new Set(screens.map((s) => s.id)));
  };
  const toggleWeekday = (code: string) => {
    const next = new Set(weekdays);
    if (next.has(code)) next.delete(code); else next.add(code);
    setWeekdays(next);
  };

  const handlePublish = async () => {
    if (!activeOrgId || assignedZoneCount < selectedZones.length) return;
    if (selectedScreens.size === 0) { toast.error(t("noScreens")); return; }
    if (scheduleMode === "loop" && weekdays.size === 0) { toast.error(t("noWeekdays")); return; }
    if (scheduleMode === "calendar" && (!calendarStart || !calendarEnd)) { toast.error(t("pickDate")); return; }
    if (scheduleMode === "calendar" && calendarStart && calendarEnd && calendarEnd < calendarStart) {
      toast.error(t("pickDate")); return;
    }

    setPublishing(true);
    const baseName = projectName.trim() || selectedTpl?.name || "Quick";
    const scheduleLabel = scheduleMode === "loop"
      ? `🔁 ${Array.from(weekdays).join(",")} ${startTime}-${endTime}`
      : `📅 ${calendarStart ? format(calendarStart, "yyyy-MM-dd") : ""} ~ ${calendarEnd ? format(calendarEnd, "yyyy-MM-dd") : ""} ${startTime}-${endTime}`;

    const scheduledAt = scheduleMode === "calendar" && calendarStart
      ? new Date(`${format(calendarStart, "yyyy-MM-dd")}T${startTime}:00`).toISOString()
      : null;

    const quickPublishZones = mapAssignmentsToStudioZones(selectedZones, zoneAssignments);
    const { data: quickProject, error: projectError } = await (supabase as any)
      .from("design_projects")
      .insert({
        name: baseName,
        aspect: selectedTpl?.aspect || "16:9",
        zones: quickPublishZones,
        created_by: user?.id,
        org_id: activeOrgId,
        collab_scope: "creator",
        updated_at: new Date().toISOString(),
      })
      .select("id")
      .single();
    if (projectError) { setPublishing(false); toast.error(projectError.message); return; }

    const quickProjectDuration = Math.max(
      1,
      Math.max(...Object.values(zoneAssignments).map((items) => items.reduce((sum, item) => sum + getZoneItemDuration(item), 0))),
    );
    const inserts = Array.from(selectedScreens).map((sid) => ({
        org_id: activeOrgId,
        screen_id: sid,
        name: `⚡ ${baseName}`,
        enabled: true,
        start_time: startTime,
        end_time: endTime,
        days: scheduleMode === "loop" ? Array.from(weekdays) : [],
      }));
    const { data: schedulesData, error: scheduleError } = await (supabase as any).from("schedules").insert(inserts).select("id, screen_id");
    if (scheduleError) { setPublishing(false); toast.error(scheduleError.message); return; }

    const scheduleItems = (schedulesData || []).map((schedule: any) => ({
      schedule_id: schedule.id,
      design_project_id: quickProject.id,
      item_type: "design_project",
      sort_order: 0,
      duration: quickProjectDuration,
    }));
    if (scheduleItems.length > 0) {
      const { error: itemError } = await (supabase as any).from("schedule_items").insert(scheduleItems);
      if (itemError) { setPublishing(false); toast.error(itemError.message); return; }
    }

    const records = Array.from(selectedScreens).map((sid) => {
      const sc = screens.find((s) => s.id === sid);
      return {
        schedule_id: null,
        channel_id: null,
        screen_id: sid,
        schedule_name: `⚡ ${baseName} · ${scheduleLabel}`,
        channel_name: "",
        screen_name: sc?.name || "",
        status: scheduledAt ? "scheduled" : "published",
        scheduled_at: scheduledAt,
        published_by: user?.id,
      };
    });
    const { error } = await (supabase as any).from("publish_records").insert(records);
    setPublishing(false);
    if (error) { toast.error(error.message); return; }
    logActivity({
      action: "quick_publish",
      category: "publish",
      actionParams: { count: selectedScreens.size, template: selectedTpl?.name, mode: scheduleMode, zones: assignedZoneCount },
    });
    toast.success(t("done"));
    setCompleted(true);
  };

  const reset = () => {
    setStep(1); setTemplateId(null); setZoneAssignments({}); setActiveZoneId(null);
    setProjectName(""); setSelectedScreens(new Set()); setCompleted(false);
    setCalendarStart(undefined); setCalendarEnd(undefined);
  };

  if (!activeOrgId) return <div className="p-8 text-muted-foreground">{t("noOrg")}</div>;

  if (completed) {
    return (
      <div className="min-h-[80vh] flex items-center justify-center p-6">
        <div className="text-center max-w-md animate-in fade-in zoom-in-95 duration-500">
          <div className="relative mx-auto mb-6 h-24 w-24">
            <div className="absolute inset-0 rounded-full bg-gradient-to-br from-primary/30 to-primary/5 blur-2xl" />
            <div className="relative h-24 w-24 rounded-full bg-gradient-to-br from-primary to-primary/70 flex items-center justify-center shadow-2xl">
              <CheckCircle2 className="h-12 w-12 text-primary-foreground" />
            </div>
          </div>
          <h2 className="text-3xl font-bold tracking-tight mb-2">{t("done")}</h2>
          <p className="text-muted-foreground mb-8">{t("doneHint")}</p>
          <Button size="lg" onClick={reset} className="gap-2">
            <Sparkles className="h-4 w-4" /> {t("doneAgain")}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className={cn("min-h-[80vh] max-w-7xl mx-auto", QP_SPACE.page)}>
      {/* Hero */}
      <div className={cn("relative mb-7 overflow-hidden rounded-[2rem] border bg-[radial-gradient(circle_at_15%_15%,hsl(var(--primary)/0.18),transparent_28%),linear-gradient(135deg,hsl(var(--card)),hsl(var(--secondary)/0.55),hsl(var(--background)))] shadow-[0_24px_80px_-48px_hsl(var(--foreground)/0.45)]", QP_SPACE.hero)}>
        <div className="absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-transparent via-primary/50 to-transparent" />
        <div className="relative flex flex-wrap items-center gap-3 mb-4">
          <div className="h-12 w-12 rounded-2xl bg-[linear-gradient(135deg,hsl(var(--primary)),hsl(var(--primary)/0.68))] flex items-center justify-center shadow-[0_18px_45px_-18px_hsl(var(--primary)/0.85)]">
            <Rocket className="h-5 w-5 text-primary-foreground" />
          </div>
          <h1 className={cn("flex flex-wrap items-baseline gap-x-3 gap-y-1", QP_TYPE.heroTitle)}>
            <span className="rounded-2xl bg-primary px-4 py-1 text-primary-foreground shadow-[0_18px_45px_-22px_hsl(var(--primary)/0.9)] ring-4 ring-primary/10">
              3-Step
            </span>
            <span>{t("title")}</span>
          </h1>
        </div>
        <p className={cn("relative mt-3", QP_TYPE.heroSubtitle)}>{t("subtitle")}</p>
      </div>

      {/* Stepper */}
      <div className="relative mb-9 overflow-hidden rounded-[1.75rem] border bg-card/85 p-3 shadow-[0_18px_60px_-48px_hsl(var(--foreground)/0.65)] backdrop-blur">
        <div className="absolute inset-x-8 top-1/2 hidden h-px -translate-y-1/2 bg-gradient-to-r from-transparent via-border to-transparent sm:block" />
        <div className="grid gap-2 sm:grid-cols-3">
          {STEP_KEYS.map((s, i) => {
            const idx = (i + 1) as Step;
            const active = step === idx;
            const done = step > idx;
            const Icon = s.icon;
            const labels = [t("stepTemplate"), t("stepUpload"), t("stepPublish")];
            return (
              <div
                key={s.key}
                className={cn(
                  "relative flex min-h-[72px] items-center gap-3 rounded-2xl border px-3 py-3 transition-all duration-300 ease-out",
                  active && "border-primary bg-primary/10 shadow-[0_16px_45px_-32px_hsl(var(--primary)/0.9)] ring-4 ring-primary/10 animate-scale-in",
                  done && "border-primary/40 bg-primary/5",
                  !active && !done && "border-border bg-background/70 text-muted-foreground",
                )}
              >
                <div className={cn(
                  "flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border transition-all duration-300",
                  (active || done) ? "border-primary bg-primary text-primary-foreground shadow-sm" : "border-border bg-muted text-muted-foreground",
                )}>
                  {done ? <CheckCircle2 className="h-5 w-5" /> : <Icon className="h-5 w-5" />}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-[10px] font-bold uppercase text-muted-foreground">Step {idx}</div>
                  <div className={cn("truncate text-sm font-semibold", active ? "text-foreground" : done ? "text-primary" : "text-muted-foreground")}>
                    {labels[i]}
                  </div>
                  <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
                    <div className={cn("h-full rounded-full bg-primary transition-all duration-500", done ? "w-full" : active ? "w-2/3" : "w-0")} />
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="animate-in fade-in slide-in-from-bottom-4 duration-300" key={step}>
        {/* ============== STEP 1: TEMPLATE ============== */}
        {step === 1 && (
          <div className={cn(QP_SURFACE.shell, QP_SPACE.section, QP_SPACE.stack, "min-h-[560px]")}>
            {/* Orientation toggle */}
            <div>
              <div className={cn("mb-2", QP_TYPE.sectionLabel)}>{t("orientation")}</div>
              <div className="inline-flex rounded-2xl border bg-background/70 p-1.5 shadow-inner">
                {([
                  { v: "landscape" as const, label: t("landscape"), Icon: Monitor },
                  { v: "portrait" as const, label: t("portrait"), Icon: Smartphone },
                ]).map(({ v, label, Icon }) => (
                  <button
                    key={v}
                    onClick={() => { setOrientation(v); setTemplateId(null); }}
                    className={cn(
                      "flex items-center gap-2 px-5 py-3 rounded-xl text-sm font-semibold transition-all",
                      orientation === v
                        ? "bg-primary text-primary-foreground shadow-[0_12px_30px_-16px_hsl(var(--primary)/0.9)]"
                        : "text-muted-foreground hover:bg-card hover:text-foreground",
                    )}
                  >
                    <Icon className="h-4 w-4" /> {label}
                  </button>
                ))}
              </div>
            </div>

            {/* Template grid */}
            {/* Source tabs */}
            <div>
              <div className="inline-flex gap-1 rounded-2xl border bg-background/70 p-1.5 shadow-inner">
                {([
                  { v: "layout" as const, label: t("tabLayout"), Icon: Shapes },
                  { v: "preset" as const, label: t("tabPreset"), Icon: Layers },
                  { v: "mine" as const, label: t("tabMine"), Icon: Folder },
                ]).map(({ v, label, Icon }) => (
                  <button
                    key={v}
                    onClick={() => { setActiveTab(v); setTemplateId(null); }}
                    className={cn(
                      "flex items-center gap-2 px-4 sm:px-5 py-3 rounded-xl text-sm font-semibold transition-all",
                      activeTab === v
                        ? "bg-primary text-primary-foreground shadow-[0_12px_30px_-16px_hsl(var(--primary)/0.9)]"
                        : "text-muted-foreground hover:bg-card hover:text-foreground",
                    )}
                  >
                    <Icon className="h-4 w-4" /> {label}
                  </button>
                ))}
              </div>
              <div className="text-xs text-muted-foreground mt-2 px-1">
                {activeTab === "layout" ? t("tabLayoutHint") : activeTab === "preset" ? t("tabPresetHint") : t("tabMineHint")}
              </div>
            </div>

            {/* Tab: Layouts (built-in) */}
            {activeTab === "layout" && (() => {
              const layouts = studioSources.layouts.filter((l) =>
                orientation === "portrait" ? l.aspect === "9:16" : l.aspect === "16:9");
              return (
                <div className={cn(
                   "grid",
                   QP_SPACE.grid,
                  orientation === "portrait"
                    ? "grid-cols-2 sm:grid-cols-4 lg:grid-cols-6"
                    : "grid-cols-1 min-[480px]:grid-cols-2 sm:grid-cols-3 lg:grid-cols-4",
                )}>
                  {layouts.map((lay) => {
                    const selected = templateId === lay.id;
                    const isPortrait = lay.aspect === "9:16";
                    return (
                      <button key={lay.id} onClick={() => setTemplateId(lay.id)}
                        className={cn(
                          "group relative p-3 sm:p-4 text-left overflow-hidden",
                          QP_SURFACE.card,
                          isPortrait ? QP_CARD_SIZE.portrait : QP_CARD_SIZE.landscape,
                          selected ? QP_SURFACE.selected : QP_SURFACE.unselected,
                        )}>
                        <div className="relative flex h-full flex-col gap-3">
                          <div className={cn("min-h-0 rounded-xl bg-secondary/40 p-2 ring-1 ring-primary/10", isPortrait ? QP_THUMB_SIZE.portrait : QP_THUMB_SIZE.landscape)}>
                            <LayoutThumb zones={lay.zones} aspect={lay.aspect} />
                          </div>
                          <div className="shrink-0 pb-0.5">
                            <div className={cn(QP_TYPE.cardTitle, "truncate")}>{studioText(lay.nameKey)}</div>
                            <div className={QP_TYPE.micro}>{lay.zones.length} zones · {lay.aspect}</div>
                          </div>
                        </div>
                        {selected && (
                          <div className="absolute top-2 right-2 h-6 w-6 rounded-full bg-primary text-primary-foreground flex items-center justify-center shadow-md animate-in zoom-in-50 duration-200">
                            <CheckCircle2 className="h-4 w-4" />
                          </div>
                        )}
                      </button>
                    );
                  })}
                </div>
              );
            })()}

            {/* Tab: Presets (designed) */}
            {activeTab === "preset" && (() => {
              const presets = studioSources.templates;
              if (presets.length === 0) {
                return <Card className="p-8 text-center text-muted-foreground border-dashed">{t("noPresets")}</Card>;
              }
              return (
                <div className={cn(
                  "grid",
                  QP_SPACE.grid,
                  orientation === "portrait"
                    ? "grid-cols-2 sm:grid-cols-4 lg:grid-cols-6"
                    : "grid-cols-1 min-[480px]:grid-cols-2 sm:grid-cols-3 lg:grid-cols-4",
                )}>
                  {presets.map((pre) => {
                    const selected = templateId === pre.id;
                    const isPortrait = pre.aspect === "9:16";
                    return (
                      <button key={pre.id} onClick={() => { setTemplateId(pre.id); setOrientation(pre.aspect === "9:16" ? "portrait" : "landscape"); }}
                        className={cn(
                          "group relative text-left overflow-hidden",
                          QP_SURFACE.card,
                          isPortrait ? QP_CARD_SIZE.portrait : QP_CARD_SIZE.landscape,
                          selected ? QP_SURFACE.selected : QP_SURFACE.unselected,
                        )}>
                        <div className="absolute inset-0" style={{ background: `linear-gradient(135deg, ${pre.color}, hsl(var(--primary)), hsl(var(--card)))` }} />
                        <div className="absolute inset-0 bg-gradient-to-t from-foreground/70 via-foreground/10 to-transparent" />
                        <div className="relative h-full flex flex-col justify-between p-3">
                          <Badge variant="secondary" className="self-start text-[10px] backdrop-blur bg-background/30 text-primary-foreground border-0">{studioText(pre.nameKey)}</Badge>
                          <div>
                             <div className="text-sm font-semibold leading-tight text-primary-foreground drop-shadow truncate">{studioText(pre.nameKey)}</div>
                             <div className="text-[10px] leading-none text-primary-foreground/80">{pre.aspect}</div>
                          </div>
                        </div>
                        {selected && (
                          <div className="absolute top-2 right-2 h-6 w-6 rounded-full bg-primary text-primary-foreground flex items-center justify-center shadow-md animate-in zoom-in-50 duration-200">
                            <CheckCircle2 className="h-4 w-4" />
                          </div>
                        )}
                      </button>
                    );
                  })}
                </div>
              );
            })()}

            {/* Tab: My projects */}
            {activeTab === "mine" && (
              filteredTemplates.length === 0 ? (
                <Card className="p-8 text-center text-muted-foreground border-dashed">{t("noMine")}</Card>
              ) : (
                <div className={cn(
                  "grid",
                  QP_SPACE.grid,
                  orientation === "portrait"
                    ? "grid-cols-2 sm:grid-cols-4 lg:grid-cols-6"
                    : "grid-cols-1 min-[480px]:grid-cols-2 sm:grid-cols-3 lg:grid-cols-4",
                )}>
                  {filteredTemplates.map((tpl) => {
                    const selected = templateId === tpl.id;
                    const isPortrait = tpl.aspect === "9:16";
                    return (
                      <button key={tpl.id} onClick={() => setTemplateId(tpl.id)}
                        className={cn(
                          "group relative p-3 sm:p-4 text-left overflow-hidden",
                          QP_SURFACE.card,
                          isPortrait ? QP_CARD_SIZE.portrait : QP_CARD_SIZE.landscape,
                          selected ? QP_SURFACE.selected : QP_SURFACE.unselected,
                        )}>
                        <div className="relative flex flex-col h-full justify-between">
                          <div className={cn(
                            "rounded-lg bg-gradient-to-br from-primary/15 to-primary/5 flex items-center justify-center",
                            isPortrait ? "h-10 w-10" : "h-12 w-12",
                          )}>
                            <Folder className={cn(isPortrait ? "h-5 w-5" : "h-6 w-6", "text-primary")} />
                          </div>
                          <div>
                             <div className={cn(QP_TYPE.cardTitle, "truncate")}>{tpl.name}</div>
                             <div className={cn(QP_TYPE.micro, "mt-1")}>{tpl.aspect}</div>
                          </div>
                        </div>
                        {selected && (
                          <div className="absolute top-2 right-2 h-6 w-6 rounded-full bg-primary text-primary-foreground flex items-center justify-center shadow-md animate-in zoom-in-50 duration-200">
                            <CheckCircle2 className="h-4 w-4" />
                          </div>
                        )}
                      </button>
                    );
                  })}
                </div>
              )
            )}
            <QualityStrip items={qualityIndicators} />
          </div>
        )}

        {/* ============== STEP 2: UPLOAD ============== */}
        {step === 2 && (
          <div className={cn(QP_SURFACE.shell, QP_SPACE.section, QP_SPACE.stack, "min-h-[560px]")}>
            {/* Selected template preview */}
            {selectedTpl && (
               <Card className={cn("flex min-h-[88px] items-center gap-4 rounded-2xl bg-[linear-gradient(135deg,hsl(var(--primary)/0.1),hsl(var(--card)),hsl(var(--secondary)/0.45))] border-primary/20 shadow-sm", QP_SPACE.section)}>
                <div className={cn(
                  "rounded-xl bg-primary/15 flex items-center justify-center shrink-0 ring-1 ring-primary/20",
                  selectedTpl.aspect === "9:16" ? "h-12 w-8" : "h-10 w-14",
                )}>
                  <LayoutTemplate className="h-5 w-5 text-primary" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className={QP_TYPE.cardMeta}>{t("selectedTemplate")}</div>
                  <div className={cn(QP_TYPE.cardTitle, "truncate")}>{selectedTpl.name}</div>
                </div>
                <Badge variant="outline">{selectedTpl.aspect}</Badge>
              </Card>
            )}
            <QualityStrip items={qualityIndicators} />

            {selectedZones.length > 0 && selectedTpl && (
              <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
                <div className="space-y-4">
                  <Card className="rounded-2xl bg-background/80 p-3 shadow-sm">
                    <div className="mb-2 flex items-center justify-between">
                      <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
                        <LayoutGrid className="h-4 w-4 text-primary" /> {t("selectZone")}
                      </div>
                      <Badge variant="outline" className="gap-1"><span className="h-2 w-2 rounded-full bg-primary" />3840×2160</Badge>
                    </div>
                    <QuickPublishZonePreview
                      zones={selectedZones}
                      aspect={selectedTpl.aspect}
                      activeZoneId={activeZoneId}
                      assignments={zoneAssignments}
                      uploadStates={zoneUploadStates}
                      dragOverZoneId={dragOverZoneId}
                      dragStates={zoneDragStates}
                      onSelect={setActiveZoneId}
                      onUploadRequest={(zoneId) => {
                        pendingUploadZoneRef.current = zoneId;
                        fileRef.current?.click();
                      }}
                      onDropFiles={(zoneId, files) => {
                        handleFilesDroppedToZone(files, zoneId);
                      }}
                      onDragOverZone={setDragOverZoneId}
                      onDragStateChange={(zoneId, state) => {
                        setZoneDragStates((prev) => {
                          const next = { ...prev };
                          if (state) next[zoneId] = state;
                          else delete next[zoneId];
                          return next;
                        });
                      }}
                      getDragState={(dataTransfer) => getQuickPublishDragState(dataTransfer, t("supportedFileTypes"), t("dropFileOnly"))}
                      canUploadLabel={t("canUpload")}
                      cannotUploadLabel={t("cannotUpload")}
                    />
                  </Card>

                  <Card className="overflow-hidden rounded-2xl bg-card shadow-sm">
                    <div className="flex items-center gap-2 border-b px-3 py-2">
                      <Layers className="h-4 w-4 text-primary" />
                      <span className="text-sm font-semibold">{t("timeline")}</span>
                      <Button variant="ghost" size="sm" className="ml-auto h-7 text-xs">全部顯示</Button>
                      <Button variant="ghost" size="sm" className="h-7 text-xs">全部隱藏</Button>
                    </div>
                    <div className="divide-y">
                      <div className="grid min-h-[64px] grid-cols-[150px_1fr] bg-accent/5">
                        <div className="border-r p-3 text-xs font-semibold"><Music className="mr-1 inline h-3 w-3" />{t("bgm")}</div>
                        <div className="flex items-center justify-center text-xs text-muted-foreground">尚未加入音樂，從右側媒體櫃拖曳音訊素材到此處</div>
                      </div>
                      {selectedZones.map((zone) => {
                        const active = activeZoneId === zone.id;
                        const assignedItems = zoneAssignments[zone.id] || [];
                        const totalDuration = assignedItems.reduce((sum, item) => sum + getZoneItemDuration(item), 0);
                        return (
                          <button key={zone.id} type="button" onClick={() => setActiveZoneId(zone.id)} className={cn("grid min-h-[96px] w-full grid-cols-[150px_1fr] text-left transition-colors", active ? "bg-primary/5" : "hover:bg-muted/40")}>
                            <div className={cn("border-r p-3 text-xs font-semibold", active ? "text-primary" : "text-foreground")}>區塊 {zone.label}<div className="mt-1 font-normal text-muted-foreground">{assignedItems.length} · {t("totalPlayback")} {totalDuration}s</div></div>
                            <div className="flex min-w-0 items-center px-3 py-2 text-xs text-muted-foreground">
                              {assignedItems.length > 0 ? (
                                <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={(event) => handleZoneMediaDragEnd(zone.id, event)}>
                                  <SortableContext items={assignedItems.map((item, index) => `${zone.id}:${item.id}:${index}`)} strategy={horizontalListSortingStrategy}>
                                    <div className="w-full min-w-0 overflow-x-auto pb-1">
                                      <div className="flex min-w-max flex-col">
                                        <TimelineRuler duration={totalDuration} />
                                        <div className="flex gap-2 pt-2">
                                          {assignedItems.map((item, index) => (
                                            <SortableZoneMediaItem
                                              key={`${item.id}-${index}`}
                                              dragId={`${zone.id}:${item.id}:${index}`}
                                              item={item}
                                              index={index}
                                              playbackSecondsLabel={t("playbackSeconds")}
                                              onDurationChange={(value) => updateZoneItemDuration(zone.id, index, value)}
                                              onRemove={() => removeZoneItem(zone.id, index)}
                                              onPreview={() => setPreviewItem(item)}
                                            />
                                          ))}
                                        </div>
                                      </div>
                                    </div>
                                  </SortableContext>
                                </DndContext>
                              ) : "此區塊尚未加入任何素材，從右側媒體櫃點擊縮圖以加入。"}
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </Card>
                </div>

                <Card className="overflow-hidden rounded-2xl bg-card shadow-sm">
                  <div className="flex items-center gap-2 border-b px-3 py-2">
                    <ImageIcon className="h-4 w-4 text-primary" />
                    <div className="min-w-0 flex-1"><div className="truncate text-sm font-semibold">{t("mediaLibrary")}</div><div className="truncate text-[10px] text-muted-foreground">{t("clickToAdd")}</div></div>
                    <Button variant="outline" size="sm" className="h-8 gap-1" disabled={uploading} onClick={() => fileRef.current?.click()}><Upload className="h-3.5 w-3.5" />{uploading ? t("uploading") : "點選選檔"}</Button>
                  </div>
                  <input
                    ref={fileRef}
                    type="file"
                    className="hidden"
                    accept="image/jpeg,image/png,video/mp4,video/quicktime"
                    multiple
                    onChange={(e) => {
                      handleFilesDroppedToZone(Array.from(e.target.files || []), pendingUploadZoneRef.current || activeZoneId || "");
                      e.currentTarget.value = "";
                    }}
                  />
                  <div className="flex items-center gap-2 border-b p-3">
                    <div className="relative flex-1"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" /><Input value={librarySearch} onChange={(e) => setLibrarySearch(e.target.value)} placeholder={t("search")} className="h-9 rounded-xl pl-9" /></div>
                    {(["all", "image", "video"] as const).map((filter) => <Button key={filter} variant={libraryFilter === filter ? "default" : "ghost"} size="sm" className="h-8 rounded-full" onClick={() => setLibraryFilter(filter)}>{t(filter === "all" ? "all" : filter === "image" ? "image" : "video")}</Button>)}
                    <Button variant="ghost" size="icon" className="h-8 w-8"><ArrowUpDown className="h-4 w-4" /></Button>
                    <Button variant={libraryView === "grid" ? "default" : "ghost"} size="icon" className="h-8 w-8" onClick={() => setLibraryView("grid")}><LayoutGrid className="h-4 w-4" /></Button>
                    <Button variant={libraryView === "list" ? "default" : "ghost"} size="icon" className="h-8 w-8" onClick={() => setLibraryView("list")}><List className="h-4 w-4" /></Button>
                  </div>
                  <div className="max-h-[620px] overflow-y-auto p-3">
                    {libraryLoading ? <div className="flex justify-center p-8"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div> : (
                      <div className={cn(libraryView === "grid" ? "grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-3" : "space-y-2")}>
                        {filteredLibraryItems.map((it) => (
                          <button key={it.id} type="button" onClick={() => pickFromLibrary(it)} className={cn("group relative overflow-hidden rounded-xl border bg-muted text-left transition-all hover:border-primary", libraryView === "grid" ? "aspect-video" : "flex h-16 items-center gap-2 p-2", activeAssignment?.id === it.id && "border-primary ring-2 ring-primary/30")}>
                            <div className={cn(libraryView === "grid" ? "absolute inset-0" : "relative h-12 w-20 shrink-0 overflow-hidden rounded-lg bg-muted")}>
                              {it.type === "video" ? <div className="flex h-full w-full items-center justify-center bg-foreground/90"><FileVideo className="h-6 w-6 text-background" /></div> : <img src={it.thumbnail || it.url} alt="" className="h-full w-full object-cover" loading="lazy" />}
                            </div>
                            <div className={cn(libraryView === "grid" ? "absolute inset-x-0 bottom-0 bg-gradient-to-t from-foreground/80 to-transparent p-2" : "min-w-0 flex-1")}><div className={cn("truncate text-xs font-medium", libraryView === "grid" ? "text-primary-foreground" : "text-foreground")}>{it.original_name}</div></div>
                            <Badge className="absolute bottom-1 right-1 h-5 px-1.5 text-[9px]" variant="secondary">{it.type === "video" ? "VID" : "IMG"}</Badge>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </Card>
              </div>
            )}

            {/* Project name */}
            <div>
              <label className={cn("mb-2 block", QP_TYPE.sectionLabel)}>{t("projectName")}</label>
              <Input
                value={projectName}
                onChange={(e) => setProjectName(e.target.value)}
                placeholder={t("projectNamePh")}
                className={cn(QP_SPACE.control, "bg-background/80 text-base")}
              />
            </div>

          </div>
        )}

        {/* ============== STEP 3: SCHEDULE & SCREENS ============== */}
        {step === 3 && (
          <div className={cn(QP_SURFACE.shell, QP_SPACE.section, QP_SPACE.stack, "min-h-[560px]")}>
            {/* Schedule mode toggle */}
            <div>
              <div className={cn("mb-2", QP_TYPE.sectionLabel)}>{t("scheduleMode")}</div>
              <div className="grid grid-cols-2 gap-4">
                {([
                  { v: "loop" as const, label: t("loopMode"), hint: t("loopModeHint"), Icon: Repeat },
                  { v: "calendar" as const, label: t("calendarMode"), hint: t("calendarModeHint"), Icon: CalendarDays },
                ]).map(({ v, label, hint, Icon }) => (
                  <button
                    key={v}
                    onClick={() => setScheduleMode(v)}
                    className={cn(
                  "flex min-h-[120px] items-start gap-4 p-5 text-left",
                  QP_SURFACE.choice,
                      scheduleMode === v
                        ? QP_SURFACE.choiceSelected
                        : "border-border hover:border-primary/40",
                    )}
                  >
                    <div className={cn(
                      "h-11 w-11 rounded-xl flex items-center justify-center shrink-0",
                      scheduleMode === v ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground",
                    )}>
                      <Icon className="h-5 w-5" />
                    </div>
                    <div className="min-w-0">
                      <div className={QP_TYPE.cardTitle}>{label}</div>
                      <div className={cn(QP_TYPE.cardMeta, "mt-1")}>{hint}</div>
                    </div>
                  </button>
                ))}
              </div>
            </div>

            {/* Schedule details */}
            <Card className="min-h-[184px] p-5 space-y-5 rounded-2xl bg-background/80 shadow-sm">
              {scheduleMode === "loop" ? (
                <div>
                  <div className={cn("mb-3", QP_TYPE.cardMeta)}>{t("loopMode")}</div>
                  <div className="flex flex-wrap gap-2">
                    {WEEKDAYS.map((d) => {
                      const on = weekdays.has(d.code);
                      return (
                        <button
                          key={d.code}
                          onClick={() => toggleWeekday(d.code)}
                          className={cn(
                            "h-11 w-11 rounded-2xl text-sm font-semibold transition-all border-2",
                            on
                              ? "bg-primary border-primary text-primary-foreground shadow-md scale-105"
                              : "border-border bg-card text-muted-foreground hover:border-primary/40",
                          )}
                        >
                          {d[language as "zh" | "en" | "ja"] || d.en}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className={cn("mb-1.5 block", QP_TYPE.cardMeta)}>{t("startDate")}</label>
                    <Popover>
                      <PopoverTrigger asChild>
                         <Button variant="outline" className={cn("w-full justify-start gap-2 font-normal", QP_SPACE.control)}>
                          <CalendarDays className="h-4 w-4" />
                          {calendarStart ? format(calendarStart, "PPP") : t("pickDate")}
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent className="w-auto p-0" align="start">
                        <Calendar
                          mode="single"
                          selected={calendarStart}
                          onSelect={(d) => {
                            setCalendarStart(d);
                            if (d && calendarEnd && calendarEnd < d) setCalendarEnd(d);
                          }}
                          initialFocus
                          className={cn("p-3 pointer-events-auto")}
                        />
                      </PopoverContent>
                    </Popover>
                  </div>
                  <div>
                    <label className={cn("mb-1.5 block", QP_TYPE.cardMeta)}>{t("endDate")}</label>
                    <Popover>
                      <PopoverTrigger asChild>
                         <Button variant="outline" className={cn("w-full justify-start gap-2 font-normal", QP_SPACE.control)} disabled={!calendarStart}>
                          <CalendarDays className="h-4 w-4" />
                          {calendarEnd ? format(calendarEnd, "PPP") : t("pickDate")}
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent className="w-auto p-0" align="start">
                        <Calendar
                          mode="single"
                          selected={calendarEnd}
                          onSelect={setCalendarEnd}
                          disabled={(d) => (calendarStart ? d < calendarStart : false)}
                          initialFocus
                          className={cn("p-3 pointer-events-auto")}
                        />
                      </PopoverContent>
                    </Popover>
                  </div>
                </div>
              )}

              <div className="grid grid-cols-2 gap-3 pt-2 border-t">
                <div>
                  <label className={cn("mb-1.5 block", QP_TYPE.cardMeta)}>{t("startTime")}</label>
                  <Input className={cn(QP_SPACE.control, "bg-card")} type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} />
                </div>
                <div>
                  <label className={cn("mb-1.5 block", QP_TYPE.cardMeta)}>{t("endTime")}</label>
                  <Input className={cn(QP_SPACE.control, "bg-card")} type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} />
                </div>
              </div>
            </Card>

            {/* Screen selection */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <div className={QP_TYPE.sectionLabel}>{t("selectScreens")}</div>
                {screens.length > 0 && (
                  <button onClick={toggleAll} className="text-xs font-medium text-primary hover:underline">
                    {t("selectAll")} ({selectedScreens.size}/{screens.length})
                  </button>
                )}
              </div>
              {screens.length === 0 ? (
                <Card className="p-8 text-center text-muted-foreground border-dashed">—</Card>
              ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {screens.map((sc) => {
                    const selected = selectedScreens.has(sc.id);
                    return (
                      <button
                        key={sc.id}
                        onClick={() => toggleScreen(sc.id)}
                        className={cn(
                          "flex min-h-[96px] items-center gap-4 p-4 text-left",
                          QP_SURFACE.choice,
                          selected ? QP_SURFACE.choiceSelected : "border-border hover:border-primary/40",
                        )}
                      >
                        <div className={cn(
                          "h-11 w-11 rounded-xl flex items-center justify-center shrink-0",
                          selected ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground",
                        )}>
                          <Tv className="h-5 w-5" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className={cn(QP_TYPE.cardTitle, "truncate")}>{sc.name}</div>
                          <div className={cn("flex items-center gap-1.5 mt-1", QP_TYPE.cardMeta)}>
                            {sc.online ? (<><Wifi className="h-3 w-3 text-success" /> {t("online")}</>) : (<><WifiOff className="h-3 w-3" /> {t("offline")}</>)}
                            {sc.branch && <span className="truncate">· {sc.branch}</span>}
                          </div>
                        </div>
                        <Checkbox checked={selected} className="pointer-events-none" />
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      <Dialog open={Boolean(previewItem)} onOpenChange={(open) => !open && setPreviewItem(null)}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle className="truncate">{previewItem?.name || "檔案詳細資訊"}</DialogTitle>
          </DialogHeader>
          {previewItem && (
            <div className="grid gap-4 md:grid-cols-[1.4fr_1fr]">
              <div className="overflow-hidden rounded-xl border bg-muted">
                {previewItem.type === "video" ? (
                  <video src={previewItem.url} className="max-h-[420px] w-full bg-foreground object-contain" controls />
                ) : (
                  <img src={previewItem.thumbnail || previewItem.url} alt={previewItem.name} className="max-h-[420px] w-full object-contain" />
                )}
              </div>
              <div className="space-y-3 rounded-xl border bg-card p-4 text-sm">
                <div><div className="text-xs text-muted-foreground">檔名</div><div className="break-all font-medium">{previewItem.name}</div></div>
                <div><div className="text-xs text-muted-foreground">類型</div><div className="font-medium">{previewItem.type === "video" ? "影片" : "圖片"}</div></div>
                <div><div className="text-xs text-muted-foreground">播放秒數</div><div className="font-medium">{getZoneItemDuration(previewItem)}s</div></div>
                <div><div className="text-xs text-muted-foreground">檔案 ID</div><div className="break-all font-mono text-xs">{previewItem.id}</div></div>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Footer */}
      <div className={cn("sticky bottom-4 z-10 flex items-center justify-between rounded-2xl border bg-card/90 shadow-[0_18px_60px_-36px_hsl(var(--foreground)/0.75)] backdrop-blur", QP_SPACE.footer)}>
        <Button
          variant="ghost"
          onClick={() => setStep((s) => (s > 1 ? ((s - 1) as Step) : s))}
          disabled={step === 1 || uploading || publishing}
          className="gap-2 rounded-xl"
        >
          <ArrowLeft className="h-4 w-4" /> {t("back")}
        </Button>

        {step === 1 && (
          <Button onClick={() => setStep(2)} disabled={!templateId} className="gap-2 min-w-32 rounded-xl shadow-sm">
            {t("next")} <ArrowRight className="h-4 w-4" />
          </Button>
        )}
        {step === 2 && (
          <Button onClick={goToStep3} disabled={uploading || selectedZones.length === 0 || assignedZoneCount < selectedZones.length} className="gap-2 min-w-32 rounded-xl shadow-sm">
            {t("next")} <ArrowRight className="h-4 w-4" />
          </Button>
        )}
        {step === 3 && (
          <Button
            onClick={handlePublish}
            disabled={publishing || selectedScreens.size === 0}
            className="gap-2 min-w-36 rounded-xl bg-primary hover:bg-primary/90 shadow-sm"
          >
            {publishing ? (<><Loader2 className="h-4 w-4 animate-spin" /> {t("publishing")}</>) : (<><Rocket className="h-4 w-4" /> {t("publish")}</>)}
          </Button>
        )}
      </div>
    </div>
  );
}
