import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DateTimePicker } from "@/components/ui/datetime-picker";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { CalendarIcon, X } from "lucide-react";
import { format } from "date-fns";
import { cn } from "@/lib/utils";
import { useLanguage } from "@/contexts/LanguageContext";
import { toast } from "sonner";
import type { ProjectSchedule } from "@/hooks/useProjectSchedules";
import { WEEKDAY_KEYS, type WeekdayKey } from "@/lib/weekdays";

interface DesignProjectLite { id: string; name: string }

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  orgId: string;
  schedule: ProjectSchedule | null;
  designProjects: DesignProjectLite[];
  onSaved: () => void;
}

function toLocalInputValue(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

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

function startOfToday() { const x = new Date(); x.setHours(0, 0, 0, 0); return x; }

export function ProjectScheduleDialog({ open, onOpenChange, orgId, schedule, designProjects, onSaved }: Props) {
  const { t, language } = useLanguage();
  const { user } = useAuth();
  const [blockType, setBlockType] = useState<"calendar" | "weekly">("calendar");
  const [designProjectId, setDesignProjectId] = useState<string>("");
  const [weekdays, setWeekdays] = useState<WeekdayKey[]>([]);
  const [startAt, setStartAt] = useState("");
  const [endAt, setEndAt] = useState("");
  const [startTime, setStartTime] = useState("09:00");
  const [endTime, setEndTime] = useState("18:00");
  const [effectiveFrom, setEffectiveFrom] = useState("");
  const [effectiveTo, setEffectiveTo] = useState("");
  const [saving, setSaving] = useState(false);
  const [tz] = useState<string | undefined>(() => {
    try {
      const v = localStorage.getItem("schedule-timeline-tz");
      if (v) return v;
    } catch { /* ignore */ }
    try { return Intl.DateTimeFormat().resolvedOptions().timeZone || undefined; }
    catch { return undefined; }
  });

  useEffect(() => {
    if (!open) return;
    setBlockType(schedule?.block_type ?? "calendar");
    setStartAt(schedule?.start_at ? toLocalInputValue(schedule.start_at) : nowLocalInputValue(tz));
    setEndAt(toLocalInputValue(schedule?.end_at ?? null));
    setWeekdays((schedule?.weekdays as WeekdayKey[]) ?? []);
    setStartTime(schedule?.start_time?.slice(0, 5) ?? "09:00");
    setEndTime(schedule?.end_time?.slice(0, 5) ?? "18:00");
    setEffectiveFrom(schedule?.effective_from ?? "");
    setEffectiveTo(schedule?.effective_to ?? "");
    setDesignProjectId(schedule?.design_project_id ?? designProjects[0]?.id ?? "");
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
    if (!designProjectId) { toast.error("請選擇設計專案"); return; }
    if (weekdays.length === 0) { toast.error(t("blockWeekdays")); return; }
    setSaving(true);
    const projectName = designProjects.find((p) => p.id === designProjectId)?.name ?? "—";
    const payload: Record<string, unknown> = {
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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{schedule ? t("editBlock") : "新增專案排程"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div>
            <Label>{t("blockDesignProject")} <span className="text-destructive">*</span></Label>
            <Select value={designProjectId} onValueChange={setDesignProjectId}>
              <SelectTrigger><SelectValue placeholder={t("blockSelectProject")} /></SelectTrigger>
              <SelectContent>
                {designProjects.length === 0 ? (
                  <div className="px-2 py-1.5 text-xs text-muted-foreground">{t("noAllowedProjects")}</div>
                ) : (
                  designProjects.map((p) => (
                    <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                  ))
                )}
              </SelectContent>
            </Select>
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
              <div>
                <Label>{t("blockStartAt")}</Label>
                <DateTimePicker value={startAt} onChange={setStartAt} disablePast placeholder={t("blockStartAt")} tz={tz} />
              </div>
              <div>
                <Label>{t("blockEndAt")}</Label>
                <DateTimePicker value={endAt} onChange={setEndAt} disablePast placeholder={t("blockEndAt")} tz={tz} />
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
                  <Input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} />
                </div>
                <div>
                  <Label>{t("blockEndTime")}</Label>
                  <Input type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>{t("blockEffectiveFrom")}</Label>
                  <div className="flex items-center gap-1">
                    <Popover>
                      <PopoverTrigger asChild>
                        <Button type="button" variant="outline"
                          className={cn("flex-1 justify-start text-left font-normal h-10", !effectiveFrom && "text-muted-foreground")}>
                          <CalendarIcon className="mr-2 h-4 w-4" />
                          {effectiveFrom ? format(new Date(effectiveFrom), "yyyy-MM-dd") : <span>{t("blockEffectiveFrom")}</span>}
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent className="w-auto p-0" align="start">
                        <Calendar mode="single"
                          selected={effectiveFrom ? new Date(effectiveFrom) : undefined}
                          onSelect={(d) => {
                            if (!d) { setEffectiveFrom(""); return; }
                            const pad = (n: number) => String(n).padStart(2, "0");
                            setEffectiveFrom(`${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`);
                          }}
                          disabled={(d) => d < startOfToday()}
                          initialFocus className={cn("p-3 pointer-events-auto")} />
                      </PopoverContent>
                    </Popover>
                    {effectiveFrom && (
                      <Button type="button" variant="ghost" size="icon" className="h-10 w-10 shrink-0" onClick={() => setEffectiveFrom("")}>
                        <X className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                </div>
                <div>
                  <Label>{t("blockEffectiveTo")}</Label>
                  <div className="flex items-center gap-1">
                    <Popover>
                      <PopoverTrigger asChild>
                        <Button type="button" variant="outline"
                          className={cn("flex-1 justify-start text-left font-normal h-10", !effectiveTo && "text-muted-foreground")}>
                          <CalendarIcon className="mr-2 h-4 w-4" />
                          {effectiveTo ? format(new Date(effectiveTo), "yyyy-MM-dd") : <span>{t("blockEffectiveTo")}</span>}
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent className="w-auto p-0" align="start">
                        <Calendar mode="single"
                          selected={effectiveTo ? new Date(effectiveTo) : undefined}
                          onSelect={(d) => {
                            if (!d) { setEffectiveTo(""); return; }
                            const pad = (n: number) => String(n).padStart(2, "0");
                            setEffectiveTo(`${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`);
                          }}
                          disabled={(d) => {
                            if (d < startOfToday()) return true;
                            if (effectiveFrom && d < new Date(effectiveFrom)) return true;
                            return false;
                          }}
                          initialFocus className={cn("p-3 pointer-events-auto")} />
                      </PopoverContent>
                    </Popover>
                    {effectiveTo && (
                      <Button type="button" variant="ghost" size="icon" className="h-10 w-10 shrink-0" onClick={() => setEffectiveTo("")}>
                        <X className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                </div>
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
