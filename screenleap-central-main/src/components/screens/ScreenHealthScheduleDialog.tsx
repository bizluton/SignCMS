import { useEffect, useMemo, useState } from "react";
import { CalendarClock, Plus, Trash2, Send, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogTrigger,
  DialogDescription,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { useLanguage } from "@/contexts/LanguageContext";
import { useActiveOrg } from "@/contexts/ActiveOrgContext";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface Schedule {
  id: string;
  org_id: string;
  cadence: "daily" | "weekly";
  hour_utc: number;
  day_of_week: number | null;
  recipients: string[];
  include_offline_only: boolean;
  time_range_hours: number;
  enabled: boolean;
  last_run_at: string | null;
  last_status: string | null;
  last_error: string | null;
  timezone: string | null;
}

const DOW = [
  "scheduleDowSun",
  "scheduleDowMon",
  "scheduleDowTue",
  "scheduleDowWed",
  "scheduleDowThu",
  "scheduleDowFri",
  "scheduleDowSat",
] as const;

// Curated short list of common zones; the org/browser zone is added dynamically.
const COMMON_TIMEZONES = [
  "UTC",
  "Asia/Taipei",
  "Asia/Tokyo",
  "Asia/Shanghai",
  "Asia/Singapore",
  "Asia/Seoul",
  "Asia/Hong_Kong",
  "Australia/Sydney",
  "Europe/London",
  "Europe/Paris",
  "Europe/Berlin",
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
];

function detectBrowserTz(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

export function ScreenHealthScheduleDialog() {
  const { t } = useLanguage();
  const { activeOrgId } = useActiveOrg();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [orgTimezone, setOrgTimezone] = useState<string>("UTC");

  // form state
  const [cadence, setCadence] = useState<"daily" | "weekly">("daily");
  const [hourUtc, setHourUtc] = useState(8);
  const [dow, setDow] = useState(1);
  const [recipientsRaw, setRecipientsRaw] = useState("");
  const [includeOfflineOnly, setIncludeOfflineOnly] = useState(false);
  const [timeRangeHours, setTimeRangeHours] = useState(24);
  const [enabled, setEnabled] = useState(true);
  const [timezone, setTimezone] = useState<string>(detectBrowserTz());

  const tzOptions = useMemo(() => {
    const browser = detectBrowserTz();
    const set = new Set<string>([orgTimezone, browser, ...COMMON_TIMEZONES]);
    return Array.from(set).filter(Boolean);
  }, [orgTimezone]);

  const recipients = useMemo(
    () =>
      recipientsRaw
        .split(/[,\s;]+/)
        .map((r) => r.trim())
        .filter((r) => r && r.includes("@")),
    [recipientsRaw],
  );

  const load = async () => {
    if (!activeOrgId) return;
    setLoading(true);
    const [{ data, error }, orgRes] = await Promise.all([
      (supabase as any)
        .from("screen_health_report_schedules")
        .select("*")
        .eq("org_id", activeOrgId)
        .order("created_at", { ascending: false }),
      (supabase as any)
        .from("organizations")
        .select("timezone")
        .eq("id", activeOrgId)
        .maybeSingle(),
    ]);
    setLoading(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    setSchedules((data ?? []) as Schedule[]);
    const tz = (orgRes?.data as any)?.timezone || "UTC";
    setOrgTimezone(tz);
    // Default the form's tz to the org's tz (admins can still override).
    setTimezone((prev) => (prev && prev !== "UTC" ? prev : tz));
  };

  useEffect(() => {
    if (open) void load();
  }, [open, activeOrgId]);

  const resetForm = () => {
    setCadence("daily");
    setHourUtc(8);
    setDow(1);
    setRecipientsRaw("");
    setIncludeOfflineOnly(false);
    setTimeRangeHours(24);
    setEnabled(true);
    setTimezone(orgTimezone || detectBrowserTz());
  };

  const handleCreate = async () => {
    if (!activeOrgId) {
      toast.error(t("scheduleNoOrg"));
      return;
    }
    if (recipients.length === 0) {
      toast.error(t("scheduleNeedRecipient"));
      return;
    }
    setSaving(true);
    const { error } = await (supabase as any)
      .from("screen_health_report_schedules")
      .insert({
        org_id: activeOrgId,
        cadence,
        hour_utc: hourUtc,
        day_of_week: cadence === "weekly" ? dow : null,
        recipients,
        include_offline_only: includeOfflineOnly,
        time_range_hours: timeRangeHours,
        enabled,
        timezone: timezone || orgTimezone || "UTC",
      });
    setSaving(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success(t("scheduleCreated"));
    resetForm();
    void load();
  };

  const toggleEnabled = async (s: Schedule) => {
    const { error } = await (supabase as any)
      .from("screen_health_report_schedules")
      .update({ enabled: !s.enabled })
      .eq("id", s.id);
    if (error) toast.error(error.message);
    else void load();
  };

  const remove = async (s: Schedule) => {
    const { error } = await (supabase as any)
      .from("screen_health_report_schedules")
      .delete()
      .eq("id", s.id);
    if (error) toast.error(error.message);
    else {
      toast.success(t("scheduleDeleted"));
      void load();
    }
  };

  const runNow = async (s: Schedule) => {
    toast.info(t("scheduleSending"));
    const { data, error } = await supabase.functions.invoke(
      "scheduled-screen-health-report",
      { body: { schedule_id: s.id, force: true } },
    );
    if (error || !(data as any)?.ok) {
      toast.error((error as any)?.message || t("scheduleSendFailed"));
      return;
    }
    toast.success(t("scheduleSent"));
    void load();
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="gap-2">
          <CalendarClock className="w-4 h-4" />
          {t("scheduleHealthReport")}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CalendarClock className="w-4 h-4" />
            {t("scheduleDialogTitle")}
          </DialogTitle>
          <DialogDescription>{t("scheduleDialogDesc")}</DialogDescription>
        </DialogHeader>

        {/* Existing schedules */}
        <div className="space-y-2">
          <h3 className="text-sm font-semibold">{t("scheduleExisting")}</h3>
          {loading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="w-4 h-4 animate-spin" /> …
            </div>
          ) : schedules.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("scheduleNone")}</p>
          ) : (
            <div className="space-y-2">
              {schedules.map((s) => (
                <div
                  key={s.id}
                  className="flex flex-col gap-2 rounded-md border border-border bg-muted/20 p-3 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="space-y-1">
                    <div className="flex flex-wrap items-center gap-2 text-sm">
                      <Badge variant={s.enabled ? "default" : "secondary"}>
                        {s.enabled ? t("scheduleOn") : t("scheduleOff")}
                      </Badge>
                      <span className="font-medium">
                        {s.cadence === "daily"
                          ? t("scheduleDaily")
                          : `${t("scheduleWeekly")} · ${t(DOW[s.day_of_week ?? 1])}`}
                      </span>
                      <span className="text-muted-foreground">
                        @ {String(s.hour_utc).padStart(2, "0")}:00 {s.timezone || "UTC"}
                      </span>
                      <span className="text-muted-foreground">
                        · {s.time_range_hours}h
                      </span>
                      {s.include_offline_only ? (
                        <Badge variant="outline">{t("scheduleOfflineOnly")}</Badge>
                      ) : null}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {t("scheduleRecipients")}: {s.recipients.join(", ") || "-"}
                    </div>
                    {s.last_run_at ? (
                      <div className="text-xs text-muted-foreground">
                        {t("scheduleLastRun")}:{" "}
                        {new Date(s.last_run_at).toLocaleString()} ·{" "}
                        <span
                          className={
                            s.last_status === "failed"
                              ? "text-destructive"
                              : s.last_status === "sent"
                                ? "text-success"
                                : ""
                          }
                        >
                          {s.last_status ?? "-"}
                        </span>
                        {s.last_error ? ` (${s.last_error})` : ""}
                      </div>
                    ) : null}
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => runNow(s)}
                      className="gap-1"
                    >
                      <Send className="w-3.5 h-3.5" />
                      {t("scheduleRunNow")}
                    </Button>
                    <Switch
                      checked={s.enabled}
                      onCheckedChange={() => toggleEnabled(s)}
                    />
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => remove(s)}
                    >
                      <Trash2 className="w-4 h-4 text-destructive" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* New schedule */}
        <div className="mt-4 space-y-3 rounded-md border border-border bg-card p-4">
          <h3 className="text-sm font-semibold flex items-center gap-2">
            <Plus className="w-4 h-4" /> {t("scheduleNew")}
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-xs">{t("scheduleCadence")}</Label>
              <Select value={cadence} onValueChange={(v) => setCadence(v as any)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="daily">{t("scheduleDaily")}</SelectItem>
                  <SelectItem value="weekly">{t("scheduleWeekly")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">{t("scheduleHourUtc")}</Label>
              <Select
                value={String(hourUtc)}
                onValueChange={(v) => setHourUtc(Number(v))}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="max-h-64">
                  {Array.from({ length: 24 }, (_, i) => (
                    <SelectItem key={i} value={String(i)}>
                      {String(i).padStart(2, "0")}:00
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">{t("scheduleTimezone")}</Label>
              <Select value={timezone} onValueChange={setTimezone}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="max-h-64">
                  {tzOptions.map((tz) => (
                    <SelectItem key={tz} value={tz}>
                      {tz}
                      {tz === orgTimezone ? ` · ${t("scheduleTimezoneOrgDefault")}` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-[11px] text-muted-foreground">
                {t("scheduleTimezoneDstHint")}
              </p>
            </div>
            {cadence === "weekly" ? (
              <div className="space-y-1">
                <Label className="text-xs">{t("scheduleDow")}</Label>
                <Select value={String(dow)} onValueChange={(v) => setDow(Number(v))}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {DOW.map((k, i) => (
                      <SelectItem key={i} value={String(i)}>
                        {t(k)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ) : null}
            <div className="space-y-1">
              <Label className="text-xs">{t("scheduleRangeHours")}</Label>
              <Input
                type="number"
                min={1}
                max={720}
                value={timeRangeHours}
                onChange={(e) => setTimeRangeHours(Number(e.target.value))}
              />
            </div>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">{t("scheduleRecipientsLabel")}</Label>
            <Input
              placeholder="admin@example.com, ops@example.com"
              value={recipientsRaw}
              onChange={(e) => setRecipientsRaw(e.target.value)}
            />
            <p className="text-[11px] text-muted-foreground">
              {recipients.length} {t("scheduleValidRecipients")}
            </p>
          </div>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Switch
                checked={includeOfflineOnly}
                onCheckedChange={setIncludeOfflineOnly}
              />
              <Label className="text-xs">{t("scheduleOfflineOnly")}</Label>
            </div>
            <div className="flex items-center gap-2">
              <Switch checked={enabled} onCheckedChange={setEnabled} />
              <Label className="text-xs">{t("scheduleEnabled")}</Label>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button onClick={handleCreate} disabled={saving} className="gap-2">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
            {t("scheduleCreate")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}