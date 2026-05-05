import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DateRangePicker } from "@/components/ui/date-range-picker";
import { ScrollTimePicker } from "@/components/ui/scroll-time-picker";
import { cn } from "@/lib/utils";
import { useLanguage } from "@/contexts/LanguageContext";
import { toast } from "sonner";
import type { ProjectSchedule } from "@/hooks/useProjectSchedules";
import { WEEKDAY_KEYS, type WeekdayKey } from "@/lib/weekdays";

const PRESET_COLORS = [
  "#3b82f6", "#6366f1", "#8b5cf6", "#ec4899", "#ef4444",
  "#f97316", "#eab308", "#22c55e", "#14b8a6", "#06b6d4",
];

const pad = (n: number) => String(n).padStart(2, "0");

function toLocalParts(iso: string | null): { date: string; time: string } {
  if (!iso) return { date: "", time: "" };
  const d = new Date(iso);
  return {
    date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
    time: `${pad(d.getHours())}:${pad(d.getMinutes())}`,
  };
}

function todayDateStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function startOfToday() { const x = new Date(); x.setHours(0, 0, 0, 0); return x; }

interface DesignProjectLite { id: string; name: string; aspect: string }

function aspectLabel(aspect: string) {
  return aspect === "9:16" ? "直式 9:16" : "橫式 16:9";
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  orgId: string;
  schedule: ProjectSchedule | null;
  designProjects: DesignProjectLite[];
  onSaved: () => void;
}

export function ProjectScheduleDialog({ open, onOpenChange, orgId, schedule, designProjects, onSaved }: Props) {
  const { t, language } = useLanguage();
  const { user } = useAuth();

  const [name, setName] = useState("");
  const [blockType, setBlockType] = useState<"calendar" | "weekly">("calendar");
  const [designProjectId, setDesignProjectId] = useState<string>("");
  const [color, setColor] = useState(PRESET_COLORS[0]);
  const [weekdays, setWeekdays] = useState<WeekdayKey[]>([]);

  // Calendar tab
  const [calStartDate, setCalStartDate] = useState("");
  const [calStartTime, setCalStartTime] = useState("09:00");
  const [calEndDate, setCalEndDate] = useState("");
  const [calEndTime, setCalEndTime] = useState("18:00");

  // Weekly tab
  const [startTime, setStartTime] = useState("09:00");
  const [endTime, setEndTime] = useState("18:00");
  const [effectiveFrom, setEffectiveFrom] = useState("");
  const [effectiveTo, setEffectiveTo] = useState("");

  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setName(schedule?.name ?? "");
    setBlockType(schedule?.block_type ?? "calendar");
    setColor(schedule?.color ?? PRESET_COLORS[0]);
    setWeekdays((schedule?.weekdays as WeekdayKey[]) ?? []);
    setDesignProjectId(schedule?.design_project_id ?? designProjects[0]?.id ?? "");

    const startParts = toLocalParts(schedule?.start_at ?? null);
    setCalStartDate(startParts.date || todayDateStr());
    setCalStartTime(startParts.time || "09:00");

    const endParts = toLocalParts(schedule?.end_at ?? null);
    setCalEndDate(endParts.date);
    setCalEndTime(endParts.time || "18:00");

    setStartTime(schedule?.start_time?.slice(0, 5) ?? "09:00");
    setEndTime(schedule?.end_time?.slice(0, 5) ?? "18:00");
    setEffectiveFrom(schedule?.effective_from ?? "");
    setEffectiveTo(schedule?.effective_to ?? "");
  }, [open, schedule]);

  const toggleWeekday = (k: WeekdayKey) =>
    setWeekdays((prev) => (prev.includes(k) ? prev.filter((x) => x !== k) : [...prev, k]));

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
    if (!name.trim()) { toast.error("請輸入排程名稱"); return; }
    if (!designProjectId) { toast.error("請選擇設計專案"); return; }
    if (weekdays.length === 0) { toast.error(t("blockWeekdays")); return; }
    setSaving(true);
    const payload: Record<string, unknown> = {
      org_id: orgId,
      design_project_id: designProjectId,
      name: name.trim(),
      color,
      block_type: blockType,
      enabled: true,
    };
    if (blockType === "calendar") {
      if (!calStartDate || !calEndDate) {
        toast.error(t("blockStartAt") + " / " + t("blockEndAt"));
        setSaving(false); return;
      }
      payload.start_at = new Date(`${calStartDate}T${calStartTime}`).toISOString();
      payload.end_at = new Date(`${calEndDate}T${calEndTime}`).toISOString();
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
    if (schedule) {
      ({ error } = await supabase.from("project_schedules").update(payload).eq("id", schedule.id));
    } else {
      ({ error } = await supabase.from("project_schedules").insert({ ...payload, created_by: user?.id }));
    }
    setSaving(false);
    if (error) { toast.error(error.message); return; }
    toast.success(t("blockSaved"));
    onSaved();
    onOpenChange(false);
  };

  const pad = (n: number) => String(n).padStart(2, "0");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{schedule ? t("editBlock") : "新增專案排程"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">

          {/* Name */}
          <div>
            <Label>排程名稱 <span className="text-destructive">*</span></Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="排程名稱" />
          </div>

          {/* Design project */}
          <div>
            <Label>{t("blockDesignProject")} <span className="text-destructive">*</span></Label>
            <Select value={designProjectId} onValueChange={setDesignProjectId}>
              <SelectTrigger><SelectValue placeholder={t("blockSelectProject")} /></SelectTrigger>
              <SelectContent>
                {designProjects.length === 0 ? (
                  <div className="px-2 py-1.5 text-xs text-muted-foreground">{t("noAllowedProjects")}</div>
                ) : (
                  designProjects.map((p) => (
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
          </div>

          {designProjectId && (() => {
            const sel = designProjects.find((p) => p.id === designProjectId);
            return sel ? (
              <p className="text-[11px] text-muted-foreground -mt-2">{sel.name} · {aspectLabel(sel.aspect || "16:9")}</p>
            ) : null;
          })()}

          {/* Color */}
          <div>
            <Label>顏色</Label>
            <div className="flex gap-2 mt-2 flex-wrap">
              {PRESET_COLORS.map((c) => (
                <button
                  key={c} type="button"
                  onClick={() => setColor(c)}
                  className={cn(
                    "h-7 w-7 rounded-full border-2 transition-transform",
                    color === c ? "border-foreground scale-110" : "border-transparent hover:scale-105",
                  )}
                  style={{ backgroundColor: c }}
                />
              ))}
            </div>
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
                    <button key={k} type="button" onClick={() => toggleWeekday(k)}
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
                  from={calStartDate ? new Date(calStartDate) : undefined}
                  to={calEndDate ? new Date(calEndDate) : undefined}
                  onChange={({ from, to }) => {
                    setCalStartDate(from ? `${from.getFullYear()}-${pad(from.getMonth() + 1)}-${pad(from.getDate())}` : "");
                    setCalEndDate(to ? `${to.getFullYear()}-${pad(to.getMonth() + 1)}-${pad(to.getDate())}` : "");
                  }}
                  disabled={(d) => d < startOfToday()}
                  placeholder="選擇日期範圍"
                />
              </div>

              {/* Time range */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>{t("blockStartAt")} (時間)</Label>
                  <ScrollTimePicker value={calStartTime} onChange={setCalStartTime} />
                </div>
                <div>
                  <Label>{t("blockEndAt")} (時間)</Label>
                  <ScrollTimePicker value={calEndTime} onChange={setCalEndTime} />
                </div>
              </div>
            </TabsContent>

            <TabsContent value="weekly" className="space-y-3 pt-3">
              <div>
                <Label>{t("blockWeekdays")} <span className="text-destructive">*</span></Label>
                <div className="flex gap-1 mt-2 flex-wrap">
                  {WEEKDAY_KEYS.map((k) => (
                    <button key={k} type="button" onClick={() => toggleWeekday(k)}
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
                  from={effectiveFrom ? new Date(effectiveFrom) : undefined}
                  to={effectiveTo ? new Date(effectiveTo) : undefined}
                  onChange={({ from, to }) => {
                    setEffectiveFrom(from ? `${from.getFullYear()}-${pad(from.getMonth() + 1)}-${pad(from.getDate())}` : "");
                    setEffectiveTo(to ? `${to.getFullYear()}-${pad(to.getMonth() + 1)}-${pad(to.getDate())}` : "");
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
