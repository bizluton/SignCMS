/**
 * QuickPublishDialog — 3-step quick publish wizard
 *
 * Step 1: Design   – confirm the project (save if dirty)
 * Step 2: Schedule – choose when to play (now / calendar / weekly)
 * Step 3: Publish  – select screens and confirm
 */

import React, { useState, useEffect, useCallback } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  Check,
  AlertTriangle,
  Play,
  Calendar,
  Repeat,
  Rocket,
  ChevronRight,
  ChevronLeft,
  Monitor,
  Wifi,
  WifiOff,
  Save,
  Loader2,
  LayoutGrid,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useLanguage } from "@/contexts/LanguageContext";
import { ScrollTimePicker } from "@/components/ui/scroll-time-picker";
import { DateRangePicker } from "@/components/ui/date-range-picker";
import { toast } from "sonner";
import { format } from "date-fns";
import { cn } from "@/lib/utils";

// ── Types ──────────────────────────────────────────────────────────────────

type Step = 1 | 2 | 3;
type ScheduleType = "now" | "calendar" | "weekly";

interface Screen {
  id: string;
  name: string;
  branch: string | null;
  online: boolean | null;
}

interface DesignProjectLike {
  id: string;
  name: string | null;
  /** zones JSON stored in DB — used to compute total media duration */
  zones?: unknown[];
}

export interface QuickPublishDialogProps {
  open: boolean;
  onClose: () => void;
  /** The currently active (saved) project, or null if project doesn't exist yet */
  project: DesignProjectLike | null;
  /** Whether there are unsaved changes */
  isDirty: boolean;
  /** Call this to persist the project before publishing */
  onSaveFirst: () => Promise<void>;
  activeOrgId?: string;
  userId?: string;
}

// ── Constants ──────────────────────────────────────────────────────────────

const WEEKDAY_OPTIONS: { key: string; label: string }[] = [
  { key: "mon", label: "一" },
  { key: "tue", label: "二" },
  { key: "wed", label: "三" },
  { key: "thu", label: "四" },
  { key: "fri", label: "五" },
  { key: "sat", label: "六" },
  { key: "sun", label: "日" },
];

const ALL_DAYS = WEEKDAY_OPTIONS.map((d) => d.key);
const WORKDAYS = ["mon", "tue", "wed", "thu", "fri"];

// ── Helpers ────────────────────────────────────────────────────────────────

/** Compute total playback duration (seconds) from saved project zones JSON */
function computeProjectDuration(zones: unknown[] | undefined): number {
  if (!Array.isArray(zones)) return 10;
  const mediaZones = zones.filter(
    (z) => z && typeof z === "object" && !(z as Record<string, unknown>)._meta
  );
  const items = mediaZones.flatMap(
    (z) =>
      ((z as Record<string, unknown>).content as Record<string, unknown> | undefined)
        ?.mediaItems as Record<string, unknown>[] | undefined ?? []
  );
  const total = items.reduce(
    (sum, item) => sum + Math.max(1, Number(item.duration) || 5),
    0
  );
  return Math.max(1, total);
}

/** Build a human-readable schedule label for the publish record name */
function buildScheduleLabel(
  type: ScheduleType,
  startTime: string,
  endTime: string,
  weekdays: string[],
  dateFrom: Date | undefined,
  dateTo: Date | undefined
): string {
  if (type === "now") return "立即播放";
  if (type === "calendar") {
    const from = dateFrom ? format(dateFrom, "MM/dd") : "?";
    const to = dateTo ? format(dateTo, "MM/dd") : "?";
    return `${from}~${to} ${startTime}–${endTime}`;
  }
  const days = weekdays.map((d) => WEEKDAY_OPTIONS.find((o) => o.key === d)?.label ?? d).join("");
  return `每週${days} ${startTime}–${endTime}`;
}

// ── Step indicator ─────────────────────────────────────────────────────────

const STEP_LABELS = ["設計", "排程", "發佈"];

function StepBar({ step }: { step: Step }) {
  return (
    <div className="flex items-center gap-0 mb-6">
      {([1, 2, 3] as Step[]).map((s, idx) => (
        <React.Fragment key={s}>
          <div className="flex flex-col items-center gap-1">
            <div
              className={cn(
                "w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold transition-colors",
                step > s
                  ? "bg-primary text-primary-foreground"
                  : step === s
                  ? "bg-primary text-primary-foreground ring-2 ring-primary/30 ring-offset-2"
                  : "bg-muted text-muted-foreground"
              )}
            >
              {step > s ? <Check className="w-4 h-4" /> : s}
            </div>
            <span
              className={cn(
                "text-[10px] font-medium whitespace-nowrap",
                step === s ? "text-primary" : "text-muted-foreground"
              )}
            >
              {STEP_LABELS[idx]}
            </span>
          </div>
          {idx < 2 && (
            <div
              className={cn(
                "flex-1 h-px mx-2 mb-4 transition-colors",
                step > s ? "bg-primary" : "bg-border"
              )}
            />
          )}
        </React.Fragment>
      ))}
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────

export function QuickPublishDialog({
  open,
  onClose,
  project,
  isDirty,
  onSaveFirst,
  activeOrgId,
  userId,
}: QuickPublishDialogProps) {
  const { t } = useLanguage();

  // ── Wizard state ────────────────────────────────────────────────────────
  const [step, setStep] = useState<Step>(1);
  const [saving, setSaving] = useState(false);

  // Step 2 — schedule
  const [scheduleType, setScheduleType] = useState<ScheduleType>("now");
  const [startTime, setStartTime] = useState("09:00");
  const [endTime, setEndTime] = useState("18:00");
  const [weekdays, setWeekdays] = useState<string[]>(WORKDAYS);
  const [dateFrom, setDateFrom] = useState<Date | undefined>(undefined);
  const [dateTo, setDateTo] = useState<Date | undefined>(undefined);

  // Step 3 — screens
  const [screens, setScreens] = useState<Screen[]>([]);
  const [screensLoading, setScreensLoading] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [publishing, setPublishing] = useState(false);

  // Reset when dialog opens
  useEffect(() => {
    if (!open) return;
    setStep(1);
    setSaving(false);
    setScheduleType("now");
    setStartTime("09:00");
    setEndTime("18:00");
    setWeekdays(WORKDAYS);
    setDateFrom(undefined);
    setDateTo(undefined);
    setSelectedIds(new Set());
    setPublishing(false);
  }, [open]);

  // Fetch screens when entering step 3
  useEffect(() => {
    if (step !== 3 || !activeOrgId) return;
    setScreensLoading(true);
    supabase
      .from("screens")
      .select("id, name, branch, online")
      .eq("org_id", activeOrgId)
      .order("branch")
      .order("name")
      .then(({ data }) => {
        setScreens(data ?? []);
        // Pre-select all online screens
        const ids = new Set((data ?? []).filter((s) => s.online).map((s) => s.id));
        setSelectedIds(ids);
      })
      .finally(() => setScreensLoading(false));
  }, [step, activeOrgId]);

  // ── Helpers ─────────────────────────────────────────────────────────────

  const toggleWeekday = useCallback((key: string) => {
    setWeekdays((prev) =>
      prev.includes(key) ? prev.filter((d) => d !== key) : [...prev, key]
    );
  }, []);

  const toggleScreen = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const toggleAll = useCallback(() => {
    setSelectedIds((prev) =>
      prev.size === screens.length ? new Set() : new Set(screens.map((s) => s.id))
    );
  }, [screens]);

  // Group screens by branch
  const grouped = React.useMemo(() => {
    const map = new Map<string, Screen[]>();
    screens.forEach((s) => {
      const b = s.branch || "其他";
      if (!map.has(b)) map.set(b, []);
      map.get(b)!.push(s);
    });
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [screens]);

  // ── Navigation guards ────────────────────────────────────────────────────

  const canNext1 = !!project; // must have a saved project
  const canNext2 =
    scheduleType === "now" ||
    (scheduleType === "calendar" && !!dateFrom) ||
    (scheduleType === "weekly" && weekdays.length > 0);
  const canPublish = selectedIds.size > 0;

  const goNext = useCallback(async () => {
    if (step === 1) {
      // Save if dirty first
      if (isDirty) {
        setSaving(true);
        try {
          await onSaveFirst();
        } catch {
          toast.error("儲存失敗，請重試");
          setSaving(false);
          return;
        }
        setSaving(false);
      }
      setStep(2);
    } else if (step === 2) {
      setStep(3);
    }
  }, [step, isDirty, onSaveFirst]);

  const goBack = useCallback(() => {
    if (step > 1) setStep((s) => (s - 1) as Step);
  }, [step]);

  // ── Publish ──────────────────────────────────────────────────────────────

  const handlePublish = useCallback(async () => {
    if (!project || selectedIds.size === 0 || !activeOrgId) return;
    setPublishing(true);

    try {
      const duration = computeProjectDuration(project.zones);
      const projectName = project.name?.trim() || "未命名專案";
      const scheduleLabel = buildScheduleLabel(
        scheduleType, startTime, endTime, weekdays, dateFrom, dateTo
      );
      const scheduleName = `⚡ ${projectName} · ${scheduleLabel}`;

      const screenList = screens.filter((s) => selectedIds.has(s.id));

      // Build schedules inserts
      const scheduleDays =
        scheduleType === "now"
          ? ALL_DAYS
          : scheduleType === "weekly"
          ? weekdays
          : [];

      const schedInserts = screenList.map((s) => ({
        org_id: activeOrgId,
        screen_id: s.id,
        name: scheduleName,
        enabled: true,
        start_time: scheduleType === "now" ? "00:00" : startTime,
        end_time: scheduleType === "now" ? "23:59" : endTime,
        days: scheduleDays,
      }));

      const { data: createdSchedules, error: schedError } = await supabase
        .from("schedules")
        .insert(schedInserts)
        .select("id, screen_id");

      if (schedError) throw schedError;

      // Build schedule_items inserts
      const itemInserts = (createdSchedules ?? []).map((sc) => ({
        schedule_id: sc.id,
        design_project_id: project.id,
        item_type: "design_project",
        sort_order: 0,
        duration,
      }));

      const { error: itemError } = await supabase
        .from("schedule_items")
        .insert(itemInserts);

      if (itemError) throw itemError;

      // Determine publish status & scheduled_at
      let status: string;
      let scheduledAt: string | null = null;
      if (scheduleType === "now") {
        status = "playing";
      } else if (scheduleType === "calendar" && dateFrom) {
        status = "scheduled";
        const d = format(dateFrom, "yyyy-MM-dd");
        scheduledAt = new Date(`${d}T${startTime}:00`).toISOString();
      } else {
        status = "published";
      }

      // Build publish_records inserts
      const recordInserts = screenList.map((s) => ({
        screen_id: s.id,
        channel_id: null as string | null,
        screen_name: s.name,
        channel_name: "",
        schedule_name: scheduleName,
        status,
        scheduled_at: scheduledAt,
        published_by: userId ?? null,
      }));

      const { error: recError } = await supabase
        .from("publish_records")
        .insert(recordInserts);

      if (recError) throw recError;

      toast.success(`已成功發佈至 ${selectedIds.size} 台螢幕`);
      onClose();
    } catch (err) {
      console.error(err);
      toast.error("發佈失敗，請重試");
    } finally {
      setPublishing(false);
    }
  }, [
    project, selectedIds, activeOrgId, screens,
    scheduleType, startTime, endTime, weekdays, dateFrom, dateTo, userId, onClose,
  ]);

  // ── Render ───────────────────────────────────────────────────────────────

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="sm:max-w-lg p-0 overflow-hidden gap-0">
        <DialogHeader className="px-6 pt-6 pb-0">
          <DialogTitle className="flex items-center gap-2 text-base">
            <Rocket className="w-4 h-4 text-primary" />
            快速發佈
          </DialogTitle>
        </DialogHeader>

        <div className="px-6 pt-5 pb-4">
          <StepBar step={step} />

          {/* ── Step 1: Design confirmation ─────────────────────────────── */}
          {step === 1 && (
            <div className="space-y-4">
              <p className="text-sm font-semibold text-foreground">確認設計內容</p>

              {!project ? (
                <div className="rounded-lg border border-dashed border-border p-6 flex flex-col items-center gap-2 text-center text-muted-foreground">
                  <LayoutGrid className="w-8 h-8 opacity-40" />
                  <p className="text-sm">請先在內容設計中心建立並儲存一個專案</p>
                </div>
              ) : (
                <div className="rounded-lg border border-border bg-muted/20 p-4 flex items-start gap-3">
                  <div className="w-12 h-12 rounded-md bg-primary/10 flex items-center justify-center shrink-0">
                    <LayoutGrid className="w-6 h-6 text-primary/60" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-foreground truncate">
                      {project.name || "未命名專案"}
                    </p>
                    <p className="text-[11px] text-muted-foreground mt-0.5">
                      ID: {project.id.slice(0, 8)}…
                    </p>
                  </div>
                  {!isDirty && (
                    <span className="shrink-0 text-[10px] font-medium text-emerald-600 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-full">
                      已儲存
                    </span>
                  )}
                </div>
              )}

              {isDirty && project && (
                <div className="flex items-start gap-2 rounded-md bg-amber-50 border border-amber-200 text-amber-700 px-3 py-2 text-xs">
                  <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                  <span>有未儲存的變更，點擊「繼續」將自動儲存後進行下一步。</span>
                </div>
              )}
            </div>
          )}

          {/* ── Step 2: Schedule ─────────────────────────────────────────── */}
          {step === 2 && (
            <div className="space-y-4">
              <p className="text-sm font-semibold text-foreground">設定播放排程</p>

              {/* Mode selector */}
              <div className="grid grid-cols-3 gap-2">
                {([
                  { type: "now" as const, icon: <Play className="w-4 h-4" />, label: "立即播放", desc: "馬上開始播放" },
                  { type: "calendar" as const, icon: <Calendar className="w-4 h-4" />, label: "日期區間", desc: "指定播放日期" },
                  { type: "weekly" as const, icon: <Repeat className="w-4 h-4" />, label: "每週排程", desc: "固定每週時段" },
                ]).map(({ type, icon, label, desc }) => (
                  <button
                    key={type}
                    type="button"
                    onClick={() => setScheduleType(type)}
                    className={cn(
                      "flex flex-col items-center gap-1.5 rounded-lg border p-3 text-center transition-colors",
                      scheduleType === type
                        ? "border-primary bg-primary/8 text-primary"
                        : "border-border hover:bg-muted/50 text-foreground"
                    )}
                  >
                    {icon}
                    <span className="text-xs font-semibold leading-tight">{label}</span>
                    <span className="text-[10px] text-muted-foreground leading-tight">{desc}</span>
                  </button>
                ))}
              </div>

              {/* NOW: no extra settings */}
              {scheduleType === "now" && (
                <div className="rounded-md bg-primary/5 border border-primary/20 px-3 py-2 text-xs text-primary flex items-center gap-2">
                  <Play className="w-3.5 h-3.5 shrink-0" />
                  內容將立即在所選螢幕上開始播放，不設時段限制。
                </div>
              )}

              {/* CALENDAR */}
              {scheduleType === "calendar" && (
                <div className="space-y-3">
                  <div>
                    <label className="text-[11px] font-medium text-muted-foreground mb-1 block">播放日期區間</label>
                    <DateRangePicker
                      from={dateFrom}
                      to={dateTo}
                      onChange={({ from, to }) => { setDateFrom(from); setDateTo(to); }}
                      disabled={(d) => d < new Date(new Date().setHours(0, 0, 0, 0))}
                      placeholder="選擇日期範圍"
                      clearable
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-[11px] font-medium text-muted-foreground mb-1 block">開始時間</label>
                      <ScrollTimePicker value={startTime} onChange={setStartTime} placeholder="開始時間" />
                    </div>
                    <div>
                      <label className="text-[11px] font-medium text-muted-foreground mb-1 block">結束時間</label>
                      <ScrollTimePicker value={endTime} onChange={setEndTime} placeholder="結束時間" />
                    </div>
                  </div>
                </div>
              )}

              {/* WEEKLY */}
              {scheduleType === "weekly" && (
                <div className="space-y-3">
                  <div>
                    <div className="flex items-center justify-between mb-1.5">
                      <label className="text-[11px] font-medium text-muted-foreground">播放星期</label>
                      <div className="flex gap-1">
                        <button type="button" onClick={() => setWeekdays(WORKDAYS)} className="text-[10px] text-primary hover:underline">工作日</button>
                        <span className="text-muted-foreground/40 text-[10px]">·</span>
                        <button type="button" onClick={() => setWeekdays(ALL_DAYS)} className="text-[10px] text-primary hover:underline">每天</button>
                      </div>
                    </div>
                    <div className="flex gap-1.5">
                      {WEEKDAY_OPTIONS.map((d) => (
                        <button
                          key={d.key}
                          type="button"
                          onClick={() => toggleWeekday(d.key)}
                          className={cn(
                            "flex-1 h-8 rounded-md text-xs font-bold border transition-colors",
                            weekdays.includes(d.key)
                              ? "bg-primary text-primary-foreground border-primary"
                              : "border-border text-muted-foreground hover:border-primary/50 hover:bg-muted/50"
                          )}
                        >
                          {d.label}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-[11px] font-medium text-muted-foreground mb-1 block">開始時間</label>
                      <ScrollTimePicker value={startTime} onChange={setStartTime} placeholder="開始時間" />
                    </div>
                    <div>
                      <label className="text-[11px] font-medium text-muted-foreground mb-1 block">結束時間</label>
                      <ScrollTimePicker value={endTime} onChange={setEndTime} placeholder="結束時間" />
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ── Step 3: Screen selection + Confirm ──────────────────────── */}
          {step === 3 && (
            <div className="space-y-4">
              {/* Summary card */}
              <div className="rounded-lg border border-border bg-muted/20 px-3 py-2.5 space-y-1.5 text-xs">
                <div className="flex items-center gap-2">
                  <LayoutGrid className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                  <span className="font-medium">{project?.name || "未命名專案"}</span>
                </div>
                <div className="flex items-center gap-2 text-muted-foreground">
                  {scheduleType === "now" && <Play className="w-3.5 h-3.5 shrink-0" />}
                  {scheduleType === "calendar" && <Calendar className="w-3.5 h-3.5 shrink-0" />}
                  {scheduleType === "weekly" && <Repeat className="w-3.5 h-3.5 shrink-0" />}
                  <span>
                    {buildScheduleLabel(scheduleType, startTime, endTime, weekdays, dateFrom, dateTo)}
                  </span>
                </div>
              </div>

              {/* Screen list */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <p className="text-sm font-semibold text-foreground">選擇螢幕</p>
                  {screens.length > 0 && (
                    <button
                      type="button"
                      onClick={toggleAll}
                      className="text-[10px] text-primary hover:underline"
                    >
                      {selectedIds.size === screens.length ? "取消全選" : "全選"}
                    </button>
                  )}
                </div>

                {screensLoading ? (
                  <div className="flex items-center justify-center py-8 text-muted-foreground gap-2">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span className="text-sm">載入螢幕中…</span>
                  </div>
                ) : screens.length === 0 ? (
                  <div className="rounded-lg border border-dashed border-border py-6 flex flex-col items-center gap-2 text-center text-muted-foreground">
                    <Monitor className="w-7 h-7 opacity-40" />
                    <p className="text-sm">找不到螢幕，請先在螢幕管理頁面新增螢幕</p>
                  </div>
                ) : (
                  <div className="max-h-52 overflow-y-auto rounded-lg border border-border divide-y divide-border">
                    {grouped.map(([branch, branchScreens]) => (
                      <div key={branch}>
                        {grouped.length > 1 && (
                          <div className="px-3 py-1.5 bg-muted/40 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                            {branch}
                          </div>
                        )}
                        {branchScreens.map((s) => (
                          <label
                            key={s.id}
                            className={cn(
                              "flex items-center gap-3 px-3 py-2.5 cursor-pointer transition-colors select-none",
                              selectedIds.has(s.id) ? "bg-primary/5" : "hover:bg-muted/40"
                            )}
                          >
                            <input
                              type="checkbox"
                              className="accent-primary w-4 h-4 shrink-0"
                              checked={selectedIds.has(s.id)}
                              onChange={() => toggleScreen(s.id)}
                            />
                            <div className="flex items-center gap-2 min-w-0 flex-1">
                              <Monitor className="w-3.5 h-3.5 shrink-0 text-muted-foreground" />
                              <span className="text-sm truncate">{s.name}</span>
                            </div>
                            {s.online ? (
                              <Wifi className="w-3.5 h-3.5 shrink-0 text-emerald-500" title="線上" />
                            ) : (
                              <WifiOff className="w-3.5 h-3.5 shrink-0 text-muted-foreground/40" title="離線" />
                            )}
                          </label>
                        ))}
                      </div>
                    ))}
                  </div>
                )}

                {selectedIds.size > 0 && (
                  <p className="text-[11px] text-muted-foreground mt-1.5 text-right">
                    已選 {selectedIds.size} / {screens.length} 台
                  </p>
                )}
              </div>
            </div>
          )}
        </div>

        {/* ── Footer buttons ──────────────────────────────────────────────── */}
        <div className="border-t border-border px-6 py-3 flex items-center justify-between bg-muted/10">
          <Button
            variant="ghost"
            size="sm"
            onClick={step === 1 ? onClose : goBack}
            disabled={publishing || saving}
          >
            {step === 1 ? (
              "取消"
            ) : (
              <>
                <ChevronLeft className="w-3.5 h-3.5 mr-1" /> 上一步
              </>
            )}
          </Button>

          {step < 3 ? (
            <Button
              size="sm"
              onClick={goNext}
              disabled={!canNext1 && step === 1 || (!canNext2 && step === 2) || saving}
              className="gap-1.5"
            >
              {saving ? (
                <><Loader2 className="w-3.5 h-3.5 animate-spin" /> 儲存中…</>
              ) : isDirty && step === 1 && project ? (
                <><Save className="w-3.5 h-3.5" /> 儲存並繼續</>
              ) : (
                <>下一步 <ChevronRight className="w-3.5 h-3.5" /></>
              )}
            </Button>
          ) : (
            <Button
              size="sm"
              onClick={handlePublish}
              disabled={!canPublish || publishing}
              className="gap-1.5 bg-primary hover:bg-primary/90"
            >
              {publishing ? (
                <><Loader2 className="w-3.5 h-3.5 animate-spin" /> 發佈中…</>
              ) : (
                <><Rocket className="w-3.5 h-3.5" /> 確認發佈</>
              )}
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
