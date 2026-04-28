import { useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ChevronDown, ChevronUp, PlayCircle, Clock } from "lucide-react";
import { useLanguage } from "@/contexts/LanguageContext";

type Schedule = {
  id: string;
  name: string;
  screen_id?: string | null;
  enabled?: boolean;
  start_time?: string | null; // "HH:MM" or "HH:MM:SS"
  end_time?: string | null;
};

type ScheduleItem = {
  id: string;
  schedule_id: string;
  duration?: number | null; // seconds
};

type Screen = { id: string; name: string; branch?: string };

interface Props {
  schedules: Schedule[];
  scheduleItems: ScheduleItem[];
  screens: Screen[];
}

// Convert "HH:MM" or "HH:MM:SS" to minutes since midnight; null if invalid
function timeToMinutes(t?: string | null): number | null {
  if (!t) return null;
  const [h, m] = t.split(":").map((x) => parseInt(x, 10));
  if (Number.isNaN(h) || Number.isNaN(m)) return null;
  return h * 60 + m;
}

function minutesToHHMM(mins: number): string {
  const h = Math.floor(mins / 60).toString().padStart(2, "0");
  const m = (mins % 60).toString().padStart(2, "0");
  return `${h}:${m}`;
}

export function EstimatedPlaysWidget({ schedules, scheduleItems, screens }: Props) {
  const { t } = useLanguage();

  const [from, setFrom] = useState("00:00");
  const [to, setTo] = useState("23:59");
  const [expanded, setExpanded] = useState(false);

  const screenById = useMemo(() => {
    const m = new Map<string, Screen>();
    screens.forEach((s) => m.set(s.id, s));
    return m;
  }, [screens]);

  const itemsBySchedule = useMemo(() => {
    const m = new Map<string, ScheduleItem[]>();
    scheduleItems.forEach((it) => {
      const arr = m.get(it.schedule_id) || [];
      arr.push(it);
      m.set(it.schedule_id, arr);
    });
    return m;
  }, [scheduleItems]);

  const rangeFrom = timeToMinutes(from) ?? 0;
  const rangeTo = timeToMinutes(to) ?? 24 * 60;

  const breakdown = useMemo(() => {
    const rows: Array<{
      id: string;
      name: string;
      screenName: string;
      windowLabel: string;
      itemCount: number;
      cycleSeconds: number;
      plays: number;
    }> = [];

    schedules.forEach((s) => {
      if (s.enabled === false) return;
      const items = itemsBySchedule.get(s.id) || [];
      if (items.length === 0) return;
      const cycleSeconds = items.reduce((sum, it) => sum + (Number(it.duration) || 0), 0);
      if (cycleSeconds <= 0) return;

      const sStart = timeToMinutes(s.start_time) ?? 0;
      const sEnd = timeToMinutes(s.end_time) ?? 24 * 60;
      // Overlap with selected range (in minutes)
      const overlapStart = Math.max(sStart, rangeFrom);
      const overlapEnd = Math.min(sEnd, rangeTo);
      const overlapSec = Math.max(0, (overlapEnd - overlapStart) * 60);
      if (overlapSec <= 0) return;

      const cycles = Math.floor(overlapSec / cycleSeconds);
      const plays = cycles * items.length;
      if (plays <= 0) return;

      const screen = s.screen_id ? screenById.get(s.screen_id) : undefined;
      rows.push({
        id: s.id,
        name: s.name,
        screenName: screen ? screen.name : t("dashEstPlaysAllScreens"),
        windowLabel: `${s.start_time?.slice(0, 5) || "00:00"} – ${s.end_time?.slice(0, 5) || "23:59"}`,
        itemCount: items.length,
        cycleSeconds,
        plays,
      });
    });

    rows.sort((a, b) => b.plays - a.plays);
    return rows;
  }, [schedules, itemsBySchedule, rangeFrom, rangeTo, screenById, t]);

  const totalPlays = breakdown.reduce((sum, r) => sum + r.plays, 0);

  const presets: Array<{ label: string; from: string; to: string }> = [
    { label: t("dashEstPlaysPresetAllDay"), from: "00:00", to: "23:59" },
    { label: t("dashEstPlaysPresetMorning"), from: "06:00", to: "12:00" },
    { label: t("dashEstPlaysPresetAfternoon"), from: "12:00", to: "18:00" },
    { label: t("dashEstPlaysPresetEvening"), from: "18:00", to: "23:59" },
  ];

  return (
    <Card className="p-5 animate-fade-in relative overflow-hidden">
      <div className="absolute -right-8 -top-8 w-40 h-40 bg-primary/5 rounded-full blur-3xl pointer-events-none" />

      <div className="flex items-start justify-between gap-3 mb-4 relative">
        <div className="flex items-center gap-2">
          <div className="w-9 h-9 rounded-xl bg-primary/10 flex items-center justify-center">
            <PlayCircle className="w-5 h-5 text-primary" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-foreground">{t("dashEstPlaysTitle")}</h3>
            <p className="text-xs text-muted-foreground">{t("dashEstPlaysSubtitle")}</p>
          </div>
        </div>
      </div>

      {/* Time range picker */}
      <div className="flex flex-col sm:flex-row sm:items-end gap-3 mb-4 relative">
        <div className="flex items-end gap-2">
          <div className="space-y-1">
            <label className="text-[11px] text-muted-foreground uppercase tracking-wider">
              {t("dashEstPlaysFrom")}
            </label>
            <Input
              type="time"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              className="w-32 h-9 tabular-nums"
            />
          </div>
          <div className="space-y-1">
            <label className="text-[11px] text-muted-foreground uppercase tracking-wider">
              {t("dashEstPlaysTo")}
            </label>
            <Input
              type="time"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              className="w-32 h-9 tabular-nums"
            />
          </div>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {presets.map((p) => {
            const active = from === p.from && to === p.to;
            return (
              <Button
                key={p.label}
                size="sm"
                variant={active ? "default" : "outline"}
                className="h-8 text-xs"
                onClick={() => {
                  setFrom(p.from);
                  setTo(p.to);
                }}
              >
                {p.label}
              </Button>
            );
          })}
        </div>
      </div>

      {/* Headline number */}
      <div className="flex items-baseline gap-3 mb-4 relative">
        <span className="text-5xl font-bold tracking-tight text-foreground tabular-nums">
          {totalPlays.toLocaleString()}
        </span>
        <span className="text-sm text-muted-foreground">
          {t("dashEstPlaysTimes")} · {minutesToHHMM(rangeFrom)} – {minutesToHHMM(rangeTo)}
        </span>
      </div>

      {/* Drill-down toggle */}
      <div className="flex items-center justify-between gap-2 relative">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Clock className="w-3.5 h-3.5" />
          <span>
            {t("dashEstPlaysContributors")}: <span className="font-semibold text-foreground">{breakdown.length}</span>
          </span>
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 gap-1 text-xs"
          onClick={() => setExpanded((v) => !v)}
          disabled={breakdown.length === 0}
        >
          {expanded ? (
            <>
              <ChevronUp className="w-3.5 h-3.5" />
              {t("dashEstPlaysHideDetails")}
            </>
          ) : (
            <>
              <ChevronDown className="w-3.5 h-3.5" />
              {t("dashEstPlaysShowDetails")}
            </>
          )}
        </Button>
      </div>

      {/* Drill-down table */}
      {expanded && (
        <div className="mt-4 border-t border-border/60 pt-3 relative animate-fade-in">
          {breakdown.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-6">
              {t("dashEstPlaysNoContributors")}
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-left text-muted-foreground border-b border-border/60">
                    <th className="py-2 pr-2 font-medium">{t("dashEstPlaysSchedule")}</th>
                    <th className="py-2 pr-2 font-medium">{t("dashEstPlaysScreen")}</th>
                    <th className="py-2 pr-2 font-medium">{t("dashEstPlaysWindow")}</th>
                    <th className="py-2 pr-2 font-medium text-right">{t("dashEstPlaysItems")}</th>
                    <th className="py-2 pr-2 font-medium text-right">{t("dashEstPlaysCycle")}</th>
                    <th className="py-2 pr-2 font-medium text-right">{t("dashEstPlaysPlays")}</th>
                  </tr>
                </thead>
                <tbody>
                  {breakdown.map((row) => (
                    <tr key={row.id} className="border-b border-border/40 last:border-0 hover:bg-muted/40">
                      <td className="py-2 pr-2 font-medium text-foreground">{row.name}</td>
                      <td className="py-2 pr-2 text-muted-foreground truncate max-w-[160px]">{row.screenName}</td>
                      <td className="py-2 pr-2 tabular-nums text-muted-foreground">{row.windowLabel}</td>
                      <td className="py-2 pr-2 tabular-nums text-right">{row.itemCount}</td>
                      <td className="py-2 pr-2 tabular-nums text-right text-muted-foreground">
                        {row.cycleSeconds}
                        {t("dashEstPlaysSeconds")}
                      </td>
                      <td className="py-2 pr-2 tabular-nums text-right">
                        <Badge variant="secondary" className="font-bold">{row.plays}</Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </Card>
  );
}