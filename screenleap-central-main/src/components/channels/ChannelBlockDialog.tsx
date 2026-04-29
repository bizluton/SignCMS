import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
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
import type { ChannelBlock, Channel } from "@/hooks/useChannels";
import { WEEKDAY_KEYS, type WeekdayKey } from "@/lib/weekdays";

interface DesignProjectLite { id: string; name: string }

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

export function ChannelBlockDialog({ open, onOpenChange, channelId, orgId, block, channel, designProjects, onSaved }: Props) {
  const { t, language } = useLanguage();
  const { user } = useAuth();
  const [blockType, setBlockType] = useState<"calendar" | "weekly">("calendar");
  const [name, setName] = useState("");
  const [designProjectId, setDesignProjectId] = useState<string>("");
  const [allowedIds, setAllowedIds] = useState<string[]>([]);
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
  const [priority, setPriority] = useState(0);
  const [enabled, setEnabled] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setBlockType(block?.block_type ?? "calendar");
    setName(block?.name ?? "");
    // Default start to "now" when creating a new block; keep the existing value when editing.
    setStartAt(block?.start_at ? toLocalInputValue(block.start_at) : nowLocalInputValue(tz));
    setEndAt(toLocalInputValue(block?.end_at ?? null));
    setWeekdays((block?.weekdays as WeekdayKey[]) ?? []);
    setStartTime(block?.start_time?.slice(0, 5) ?? "09:00");
    setEndTime(block?.end_time?.slice(0, 5) ?? "18:00");
    setEffectiveFrom(block?.effective_from ?? "");
    setEffectiveTo(block?.effective_to ?? "");
    setPriority(block?.priority ?? 0);
    setEnabled(block?.enabled ?? true);
    // Load allowed projects for this channel; pre-select default
    (async () => {
      if (!channelId) { setAllowedIds([]); return; }
      const { data } = await supabase
        .from("channel_allowed_projects")
        .select("design_project_id")
        .eq("channel_id", channelId)
        .order("sort_order", { ascending: true });
      const ids = (data ?? []).map((r) => r.design_project_id) as string[];
      setAllowedIds(ids);
      const initial =
        block?.design_project_id
        ?? channel?.default_design_project_id
        ?? ids[0]
        ?? "";
      setDesignProjectId(initial);
    })();
  }, [open, block, channelId, channel]);

  const allowedProjects = designProjects.filter((p) => allowedIds.includes(p.id));

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
    setSaving(true);
    const payload: Record<string, unknown> = {
      channel_id: channelId,
      org_id: orgId,
      design_project_id: designProjectId || null,
      name,
      block_type: blockType,
      priority,
      enabled,
    };
    if (blockType === "calendar") {
      if (!startAt || !endAt) { toast.error(t("blockStartAt") + " / " + t("blockEndAt")); setSaving(false); return; }
      payload.start_at = new Date(startAt).toISOString();
      payload.end_at = new Date(endAt).toISOString();
      payload.weekdays = [];
      payload.start_time = null;
      payload.end_time = null;
      payload.effective_from = null;
      payload.effective_to = null;
    } else {
      if (weekdays.length === 0) { toast.error(t("blockWeekdays")); setSaving(false); return; }
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
    if (error) { toast.error(error.message); return; }
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
            <Label>{t("blockName")}</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div>
            <Label>{t("blockDesignProject")}</Label>
            <Select value={designProjectId} onValueChange={setDesignProjectId}>
              <SelectTrigger><SelectValue placeholder={t("blockSelectProject")} /></SelectTrigger>
              <SelectContent>
                {allowedProjects.length === 0 ? (
                  <div className="px-2 py-1.5 text-xs text-muted-foreground">{t("noAllowedProjects")}</div>
                ) : (
                  allowedProjects.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name}{channel?.default_design_project_id === p.id ? ` · ${t("default")}` : ""}
                    </SelectItem>
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
                <Label>{t("blockStartAt")}</Label>
                <DateTimePicker
                  value={startAt}
                  onChange={setStartAt}
                  disablePast
                  placeholder={t("blockStartAt")}
                  tz={tz}
                />
              </div>
              <div>
                <Label>{t("blockEndAt")}</Label>
                <DateTimePicker
                  value={endAt}
                  onChange={setEndAt}
                  disablePast
                  placeholder={t("blockEndAt")}
                  tz={tz}
                />
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
                      <Button
                        type="button"
                        variant="outline"
                        className={cn(
                          "flex-1 justify-start text-left font-normal h-10",
                          !effectiveFrom && "text-muted-foreground",
                        )}
                      >
                        <CalendarIcon className="mr-2 h-4 w-4" />
                        {effectiveFrom
                          ? format(new Date(effectiveFrom), "yyyy-MM-dd")
                          : <span>{t("blockEffectiveFrom")}</span>}
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0" align="start">
                      <Calendar
                        mode="single"
                        selected={effectiveFrom ? new Date(effectiveFrom) : undefined}
                        onSelect={(d) => {
                          if (!d) { setEffectiveFrom(""); return; }
                          const pad = (n: number) => String(n).padStart(2, "0");
                          setEffectiveFrom(`${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`);
                        }}
                        disabled={(d) => d < startOfToday()}
                        initialFocus
                        className={cn("p-3 pointer-events-auto")}
                      />
                    </PopoverContent>
                  </Popover>
                  {effectiveFrom && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-10 w-10 shrink-0"
                      onClick={() => setEffectiveFrom("")}
                      aria-label="Clear"
                      title="Clear"
                    >
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
                      <Button
                        type="button"
                        variant="outline"
                        className={cn(
                          "flex-1 justify-start text-left font-normal h-10",
                          !effectiveTo && "text-muted-foreground",
                        )}
                      >
                        <CalendarIcon className="mr-2 h-4 w-4" />
                        {effectiveTo
                          ? format(new Date(effectiveTo), "yyyy-MM-dd")
                          : <span>{t("blockEffectiveTo")}</span>}
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0" align="start">
                      <Calendar
                        mode="single"
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
                        initialFocus
                        className={cn("p-3 pointer-events-auto")}
                      />
                    </PopoverContent>
                  </Popover>
                  {effectiveTo && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-10 w-10 shrink-0"
                      onClick={() => setEffectiveTo("")}
                      aria-label="Clear"
                      title="Clear"
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  )}
                  </div>
                </div>
              </div>
            </TabsContent>
          </Tabs>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>{t("blockPriority")}</Label>
              <Input type="number" value={priority} onChange={(e) => setPriority(Number(e.target.value) || 0)} />
            </div>
            <div className="flex flex-col">
              <Label>{t("blockEnabled")}</Label>
              <div className="pt-2"><Switch checked={enabled} onCheckedChange={setEnabled} /></div>
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>{t("cancel")}</Button>
          <Button onClick={handleSave} disabled={saving}>{t("save")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}