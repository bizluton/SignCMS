import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DateRangePicker } from "@/components/ui/date-range-picker";
import { ScrollTimePicker } from "@/components/ui/scroll-time-picker";
import { cn } from "@/lib/utils";
import { useLanguage } from "@/contexts/LanguageContext";
import { toast } from "sonner";
import type { ChannelBlock, Channel } from "@/hooks/useChannels";
import { WEEKDAY_KEYS, type WeekdayKey } from "@/lib/weekdays";
import { formatUserError } from "@/lib/formatUserError";

interface DesignProjectLite { id: string; name: string; aspect: string }

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  channelId: string;
  orgId: string;
  block: ChannelBlock | null;
  channel: Channel | null;
  designProjects: DesignProjectLite[];
  onSaved: () => void;
}

function toLocalInputValue(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Current datetime as "YYYY-MM-DDTHH:mm" wall-clock in `tz` (or browser local). */
function nowLocalInputValue(tz?: string): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  if (!tz) {
    return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(now.getMinutes())}`;
  }
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", hour12: false,
    }).formatToParts(now);
    const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "00";
    let h = get("hour"); if (h === "24") h = "00";
    return `${get("year")}-${get("month")}-${get("day")}T${h}:${get("minute")}`;
  } catch {
    return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(now.getMinutes())}`;
  }
}

function startOfToday() {
  const x = new Date(); x.setHours(0, 0, 0, 0); return x;
}

const DOW_MAP: Record<string, number> = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };

/** Returns true if the given weekday key occurs at least once within [startMs, endMs). */
function hasWeekdayInRange(startMs: number, endMs: number, dowKey: string): boolean {
  const dow = DOW_MAP[dowKey];
  if (dow === undefined) return false;
  const msPerDay = 86_400_000;
  if (endMs - startMs >= 7 * msPerDay) return true;
  const startDow = new Date(startMs).getDay();
  const days = Math.ceil((endMs - startMs) / msPerDay);
  for (let i = 0; i < days; i++) {
    if ((startDow + i) % 7 === dow) return true;
  }
  return false;
}

function aspectLabel(aspect: string) {
  return aspect === "9:16" ? "直式 9:16" : "橫式 16:9";
}

export function ChannelBlockDialog({ open, onOpenChange, channelId, orgId, block, channel, designProjects, onSaved }: Props) {
  const channelAspect = channel?.aspect ?? "16:9";
  const filteredProjects = designProjects.filter((p) => (p.aspect || "16:9") === channelAspect);
  const { t, language } = useLanguage();
  const { user } = useAuth();
  const [blockType, setBlockType] = useState<"calendar" | "weekly">("calendar");
  const [designProjectId, setDesignProjectId] = useState<string>("");
  const [startAt, setStartAt] = useState("");
  const [endAt, setEndAt] = useState("");
  const [weekdays, setWeekdays] = useState<WeekdayKey[]>([]);
  // TZ used for "now" / disabled-past comparisons in the date picker.
  // Priority: user profile preferred_tz > localStorage (set by ScheduleTimeline) > browser detected.
  const [tz, setTz] = useState<string | undefined>(() => {
    try {
      const v = localStorage.getItem("schedule-timeline-tz");
      if (v) return v;
    } catch { /* ignore */ }
    try { return Intl.DateTimeFormat().resolvedOptions().timeZone || undefined; }
    catch { return undefined; }
  });
  // Load preferred_tz from the profile when logged in so the calendar opens
  // on "today" in the persisted timezone, even on a fresh page load.
  useEffect(() => {
    if (!user?.id) return;
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("profiles")
        .select("preferred_tz")
        .eq("user_id", user.id)
        .maybeSingle();
      if (cancelled) return;
      const saved = (data?.preferred_tz as string | null) || "";
      if (saved) setTz(saved);
    })();
    return () => { cancelled = true; };
  }, [user?.id]);
  const [startTime, setStartTime] = useState("09:00");
  const [endTime, setEndTime] = useState("18:00");
  const [effectiveFrom, setEffectiveFrom] = useState("");
  const [effectiveTo, setEffectiveTo] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setBlockType(block?.block_type ?? "calendar");
    setStartAt(block?.start_at ? toLocalInputValue(block.start_at) : nowLocalInputValue(tz));
    setEndAt(toLocalInputValue(block?.end_at ?? null));
    setWeekdays(block ? ((block.weekdays as WeekdayKey[]) ?? []) : [...WEEKDAY_KEYS]);
    setStartTime(block?.start_time?.slice(0, 5) ?? "09:00");
    setEndTime(block?.end_time?.slice(0, 5) ?? "18:00");
    setEffectiveFrom(block?.effective_from ?? "");
    setEffectiveTo(block?.effective_to ?? "");
    const initial = block?.design_project_id ?? filteredProjects[0]?.id ?? "";
    setDesignProjectId(initial);
  }, [open, block]);

  const toggleWeekday = (k: WeekdayKey) => {
    setWeekdays((prev) => (prev.includes(k) ? prev.filter((x) => x !== k) : [...prev, k]));
  };

  const weekdayLabel = (k: WeekdayKey) => {
    const labels: Record<WeekdayKey, { zh: string; en: string; ja: string }> = {
      mon: { zh: "一", en: "Mon", ja: "月" }, tue: { zh: "二", en: "Tue", ja: "火" },
      wed: { zh: "三", en: "Wed", ja: "水" }, thu: { zh: "四", en: "Thu", ja: "木" },
      fri: { zh: "五", en: "Fri", ja: "金" }, sat: { zh: "六", en: "Sat", ja: "土" },
      sun: { zh: "日", en: "Sun", ja: "日" },
    };
    return labels[k][language as "zh" | "en" | "ja"] ?? labels[k].en;
  };

  const handleSave = async () => {
    if (!designProjectId) { toast.error("請選擇設計專案"); return; }
    if (weekdays.length === 0) { toast.error(t("blockWeekdays")); return; }
    setSaving(true);

    // Conflict check: same design project, same channel
    const { data: siblings } = await supabase
      .from("channel_blocks")
      .select("id, block_type, start_at, end_at, weekdays, start_time, end_time, effective_from, effective_to")
      .eq("channel_id", channelId)
      .eq("design_project_id", designProjectId)
      .eq("enabled", true);

    const candidates = (siblings ?? []).filter((b) => b.id !== block?.id);

    if (blockType === "calendar" && startAt && endAt) {
      const newS = new Date(startAt).getTime();
      const newE = new Date(endAt).getTime();
      const newDays = new Set(weekdays);

      // Self-validate: selected weekdays must actually occur within the chosen date range
      const activeDays = weekdays.filter((d) => hasWeekdayInRange(newS, newE, d));
      if (activeDays.length === 0) {
        toast.error("所選星期未出現在指定的日期範圍內，請調整日期或星期");
        setSaving(false); return;
      }

      for (const b of candidates) {
        if (b.block_type !== "calendar" || !b.start_at || !b.end_at) continue;
        const bS = new Date(b.start_at).getTime();
        const bE = new Date(b.end_at).getTime();
        if (newS >= bE || newE <= bS) continue; // date ranges don't overlap
        const overlapS = Math.max(newS, bS);
        const overlapE = Math.min(newE, bE);
        const bDays: string[] = (b.weekdays as string[]) ?? [];
        // Conflict only if a shared weekday actually falls within the overlap period
        const hasConflict = bDays
          .filter((d) => newDays.has(d as WeekdayKey))
          .some((d) => hasWeekdayInRange(overlapS, overlapE, d));
        if (hasConflict) {
          toast.error("與現有排程時間衝突，請重新選擇日期或星期");
          setSaving(false); return;
        }
      }
    }

    if (blockType === "weekly") {
      const newDays = new Set(weekdays);
      const toMins = (t: string) => { const [h, m] = t.split(":").map(Number); return h * 60 + m; };
      const newS = toMins(startTime);
      const newE = toMins(endTime);
      for (const b of candidates) {
        if (b.block_type !== "weekly") continue;
        const bDays: string[] = (b.weekdays as string[]) ?? [];
        if (!bDays.some((d) => newDays.has(d as WeekdayKey))) continue;
        const bS = toMins((b.start_time ?? "00:00").slice(0, 5));
        const bE = toMins((b.end_time ?? "23:59").slice(0, 5));
        if (newS >= bE || newE <= bS) continue;
        // Check effective date ranges — no conflict only if they don't overlap
        const newFrom = effectiveFrom ? new Date(effectiveFrom).getTime() : null;
        const newTo = effectiveTo ? new Date(effectiveTo).getTime() : null;
        const bFrom = b.effective_from ? new Date(b.effective_from as string).getTime() : null;
        const bTo = b.effective_to ? new Date(b.effective_to as string).getTime() : null;
        const datesDontOverlap =
          (newTo !== null && bFrom !== null && newTo < bFrom) ||
          (bTo !== null && newFrom !== null && bTo < newFrom);
        if (!datesDontOverlap) {
          toast.error("與現有週期排程時間衝突，請重新選擇星期、時間或有效日期");
          setSaving(false); return;
        }
      }
    }

    const projectName = filteredProjects.find((p) => p.id === designProjectId)?.name ?? "—";
    const payload: Record<string, unknown> = {
      channel_id: channelId,
      org_id: orgId,
      design_project_id: designProjectId,
      name: projectName,
      block_type: blockType,
      enabled: true,
    };
    if (blockType === "calendar") {
      if (!startAt || !endAt) { toast.error(t("blockStartAt") + " / " + t("blockEndAt")); setSaving(false); return; }
      payload.start_at = new Date(startAt).toISOString();
      payload.end_at = new Date(endAt).toISOString();
      payload.weekdays = weekdays;
      payload.start_time = null;
      payload.end_time = null;
      payload.effective_from = null;
      payload.effective_to = null;
    } else {
      payload.weekdays = weekdays;
      payload.start_time = startTime;
      payload.end_time = endTime;
      payload.effective_from = effectiveFrom || null;
      payload.effective_to = effectiveTo || null;
      payload.start_at = null;
      payload.end_at = null;
    }
    let error;
    if (block) {
      ({ error } = await supabase.from("channel_blocks").update(payload as Parameters<ReturnType<typeof supabase.from<"channel_blocks">>["update"]>[0]).eq("id", block.id));
    } else {
      ({ error } = await supabase.from("channel_blocks").insert(payload as Parameters<ReturnType<typeof supabase.from<"channel_blocks">>["insert"]>[0]));
    }
    setSaving(false);
    if (error) { toast.error(formatUserError(error, t)); return; }
    toast.success(t("blockSaved"));
    onSaved();
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{block ? t("editBlock") : t("newBlock")}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div>
            <Label>{t("blockDesignProject")} <span className="text-destructive">*</span></Label>
            <Select value={designProjectId} onValueChange={setDesignProjectId}>
              <SelectTrigger><SelectValue placeholder={t("blockSelectProject")} /></SelectTrigger>
              <SelectContent>
                {filteredProjects.length === 0 ? (
                  <div className="px-2 py-1.5 text-xs text-muted-foreground">{t("noAllowedProjects")}</div>
                ) : (
                  filteredProjects.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      <span className="flex items-center gap-2">
                        {p.name}
                        <span className="text-[10px] text-muted-foreground bg-muted rounded px-1 py-0">{aspectLabel(p.aspect || "16:9")}</span>
                      </span>
                    </SelectItem>
                  ))
                )}
              </SelectContent>
            </Select>
            {designProjectId && (() => {
              const sel = filteredProjects.find((p) => p.id === designProjectId);
              return sel ? (
                <p className="text-[11px] text-muted-foreground mt-1">{sel.name} · {aspectLabel(sel.aspect || "16:9")}</p>
              ) : null;
            })()}
          </div>
          <Tabs value={blockType} onValueChange={(v) => setBlockType(v as "calendar" | "weekly")}>
            <TabsList className="grid grid-cols-2 w-full">
              <TabsTrigger value="calendar">{t("blockTypeCalendar")}</TabsTrigger>
              <TabsTrigger value="weekly">{t("blockTypeWeekly")}</TabsTrigger>
            </TabsList>
            <TabsContent value="calendar" className="space-y-3 pt-3">
              <div>
                <Label>{t("blockWeekdays")} <span className="text-destructive">*</span></Label>
                <div className="flex gap-1 mt-2 flex-wrap">
                  {WEEKDAY_KEYS.map((k) => (
                    <button
                      key={k}
                      type="button"
                      onClick={() => toggleWeekday(k)}
                      className={`px-3 py-1.5 rounded-md text-sm border transition-colors ${
                        weekdays.includes(k)
                          ? "bg-primary text-primary-foreground border-primary"
                          : "bg-background border-border hover:bg-accent"
                      }`}
                    >{weekdayLabel(k)}</button>
                  ))}
                </div>
              </div>
              {/* Date range */}
              <div>
                <Label>{t("blockStartAt")} ~ {t("blockEndAt")} (日期)</Label>
                <DateRangePicker
                  from={(() => {
                    if (!startAt) return undefined;
                    const [y, mo, d] = (startAt.split("T")[0] ?? "").split("-").map(Number);
                    return y && mo && d ? new Date(y, mo - 1, d) : undefined;
                  })()}
                  to={(() => {
                    if (!endAt) return undefined;
                    const [y, mo, d] = (endAt.split("T")[0] ?? "").split("-").map(Number);
                    return y && mo && d ? new Date(y, mo - 1, d) : undefined;
                  })()}
                  onChange={({ from, to }) => {
                    const p = (n: number) => String(n).padStart(2, "0");
                    if (from) {
                      const ds = `${from.getFullYear()}-${p(from.getMonth()+1)}-${p(from.getDate())}`;
                      setStartAt(`${ds}T${startAt.split("T")[1] ?? "09:00"}`);
                    }
                    if (to) {
                      const ds = `${to.getFullYear()}-${p(to.getMonth()+1)}-${p(to.getDate())}`;
                      setEndAt(`${ds}T${endAt.split("T")[1] ?? "18:00"}`);
                    } else {
                      setEndAt("");
                    }
                  }}
                  disabled={(d) => d < startOfToday()}
                  placeholder="選擇日期範圍"
                />
              </div>
              {/* Time range */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>{t("blockStartAt")} (時間)</Label>
                  <ScrollTimePicker
                    value={startAt.split("T")[1] ?? "09:00"}
                    onChange={(tv) => {
                      const ds = startAt.split("T")[0] ?? "";
                      setStartAt(ds ? `${ds}T${tv}` : startAt);
                    }}
                  />
                </div>
                <div>
                  <Label>{t("blockEndAt")} (時間)</Label>
                  <ScrollTimePicker
                    value={endAt.split("T")[1] ?? "18:00"}
                    onChange={(tv) => {
                      const ds = endAt.split("T")[0] ?? "";
                      setEndAt(ds ? `${ds}T${tv}` : endAt);
                    }}
                  />
                </div>
              </div>
            </TabsContent>
            <TabsContent value="weekly" className="space-y-3 pt-3">
              <div>
                <Label>{t("blockWeekdays")}</Label>
                <div className="flex gap-1 mt-2 flex-wrap">
                  {WEEKDAY_KEYS.map((k) => (
                    <button
                      key={k}
                      type="button"
                      onClick={() => toggleWeekday(k)}
                      className={`px-3 py-1.5 rounded-md text-sm border transition-colors ${
                        weekdays.includes(k)
                          ? "bg-primary text-primary-foreground border-primary"
                          : "bg-background border-border hover:bg-accent"
                      }`}
                    >{weekdayLabel(k)}</button>
                  ))}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>{t("blockStartTime")}</Label>
                  <ScrollTimePicker value={startTime} onChange={setStartTime} />
                </div>
                <div>
                  <Label>{t("blockEndTime")}</Label>
                  <ScrollTimePicker value={endTime} onChange={setEndTime} />
                </div>
              </div>
              <div>
                <Label>{t("blockEffectiveFrom")} ~ {t("blockEffectiveTo")}</Label>
                <DateRangePicker
                  from={(() => {
                    if (!effectiveFrom) return undefined;
                    const [y, mo, d] = effectiveFrom.split("-").map(Number);
                    return y && mo && d ? new Date(y, mo - 1, d) : undefined;
                  })()}
                  to={(() => {
                    if (!effectiveTo) return undefined;
                    const [y, mo, d] = effectiveTo.split("-").map(Number);
                    return y && mo && d ? new Date(y, mo - 1, d) : undefined;
                  })()}
                  onChange={({ from, to }) => {
                    const p = (n: number) => String(n).padStart(2, "0");
                    setEffectiveFrom(from ? `${from.getFullYear()}-${p(from.getMonth()+1)}-${p(from.getDate())}` : "");
                    setEffectiveTo(to ? `${to.getFullYear()}-${p(to.getMonth()+1)}-${p(to.getDate())}` : "");
                  }}
                  disabled={(d) => d < startOfToday()}
                  placeholder={`${t("blockEffectiveFrom")} ~ ${t("blockEffectiveTo")}`}
                  clearable
                />
              </div>
            </TabsContent>
          </Tabs>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>{t("cancel")}</Button>
          <Button onClick={handleSave} disabled={saving}>{t("save")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
