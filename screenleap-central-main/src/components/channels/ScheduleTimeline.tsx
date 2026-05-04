import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { CalendarPlus, ChevronLeft, ChevronRight, GripVertical } from "lucide-react";
import { cn } from "@/lib/utils";
import { useLanguage } from "@/contexts/LanguageContext";
import type { ChannelBlock } from "@/hooks/useChannels";
import { useChannelScheduleIntervals } from "@/hooks/useChannels";
import { normalizeDays } from "@/lib/weekdays";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export type TimelineView = "day" | "week" | "month";

interface DesignProjectLite { id: string; name: string }

interface Props {
  blocks: ChannelBlock[];
  designProjects: DesignProjectLite[];
  channelColor: string;
  onBlockClick?: (block: ChannelBlock) => void;
  onReorderProjects?: (orderedIds: string[]) => void;
  onAddBlock?: () => void;
  /**
   * When provided, per-day intervals are computed server-side via the
   * `get_channel_schedule_intervals` RPC using the user-selected timezone.
   * Falls back to client-side expansion of `blocks` when omitted or if the RPC
   * returns an empty result.
   */
  channelId?: string | null;
}

const HOUR_PX = 52; // day/week column width per hour
const ROW_PX = 60;  // row height per project
const LABEL_W = 184;
const TZ_LS_KEY = "schedule-timeline-tz";

/** Common time zones offered in the picker. Always includes the browser-detected zone. */
const COMMON_TIMEZONES = [
  "UTC",
  "America/Los_Angeles",
  "America/Denver",
  "America/Chicago",
  "America/New_York",
  "America/Sao_Paulo",
  "Europe/London",
  "Europe/Paris",
  "Europe/Berlin",
  "Africa/Johannesburg",
  "Asia/Dubai",
  "Asia/Kolkata",
  "Asia/Bangkok",
  "Asia/Shanghai",
  "Asia/Taipei",
  "Asia/Tokyo",
  "Asia/Seoul",
  "Australia/Sydney",
  "Pacific/Auckland",
];

function detectTz(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

function readStoredTz(): string {
  try {
    const v = localStorage.getItem(TZ_LS_KEY);
    if (v) return v;
  } catch { /* ignore */ }
  return detectTz();
}

function startOfDay(d: Date) { const x = new Date(d); x.setHours(0,0,0,0); return x; }
function addDays(d: Date, n: number) { const x = new Date(d); x.setDate(x.getDate()+n); return x; }
function startOfWeek(d: Date) {
  // Monday-start week
  const x = startOfDay(d);
  const day = x.getDay(); // 0=Sun
  const diff = (day === 0 ? -6 : 1 - day);
  return addDays(x, diff);
}
function startOfMonth(d: Date) { const x = startOfDay(d); x.setDate(1); return x; }
function endOfMonth(d: Date) { const x = startOfMonth(d); x.setMonth(x.getMonth()+1); return addDays(x, -1); }
function sameDay(a: Date, b: Date) { return a.getFullYear()===b.getFullYear() && a.getMonth()===b.getMonth() && a.getDate()===b.getDate(); }

function parseHHMM(t: string | null): number {
  if (!t) return 0;
  const [h, m] = t.split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
}

/** Compute "today" (midnight) as observed in `tz`, expressed as a local Date for comparison. */
function todayInTz(tz: string): Date {
  try {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(new Date());
    const y = Number(parts.find((p) => p.type === "year")?.value);
    const m = Number(parts.find((p) => p.type === "month")?.value);
    const d = Number(parts.find((p) => p.type === "day")?.value);
    if (y && m && d) return new Date(y, m - 1, d);
  } catch {
    /* fall through to local */
  }
  const x = new Date();
  x.setHours(0, 0, 0, 0);
  return x;
}

/** Compute the current wall-clock date/time in `tz`, expressed as a local Date. */
function nowInTz(tz: string): Date {
  try {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    }).formatToParts(new Date());
    const y = Number(parts.find((p) => p.type === "year")?.value);
    const m = Number(parts.find((p) => p.type === "month")?.value);
    const d = Number(parts.find((p) => p.type === "day")?.value);
    let h = Number(parts.find((p) => p.type === "hour")?.value);
    const min = Number(parts.find((p) => p.type === "minute")?.value);
    const sec = Number(parts.find((p) => p.type === "second")?.value);
    if (h === 24) h = 0;
    if (y && m && d) return new Date(y, m - 1, d, h || 0, min || 0, sec || 0, 0);
  } catch {
    /* fall through to local */
  }
  return new Date();
}

/** Resolve all (project_id, dayDate, startMin, endMin) intervals a block produces inside [from,to). */
function resolveBlockIntervals(
  b: ChannelBlock,
  from: Date,
  to: Date,
  tz: string,
): Array<{ day: Date; startMin: number; endMin: number }> {
  const out: Array<{ day: Date; startMin: number; endMin: number }> = [];
  if (!b.enabled) return out;

  if (b.block_type === "calendar") {
    if (!b.start_at || !b.end_at) return out;
    const s = new Date(b.start_at);
    const e = new Date(b.end_at);
    const filterDays = normalizeDays(b.weekdays);
    const DOW_KEYS = ["sun","mon","tue","wed","thu","fri","sat"] as const;
    let cursor = startOfDay(s < from ? from : s);
    const last = e > to ? to : e;
    while (cursor < last) {
      const dayStart = startOfDay(cursor);
      const dayEnd = addDays(dayStart, 1);
      if (filterDays.length === 0 || filterDays.includes(DOW_KEYS[cursor.getDay()] as never)) {
        const segStart = s > dayStart ? s : dayStart;
        const segEnd = e < dayEnd ? e : dayEnd;
        if (segEnd > segStart) {
          const startMin = (segStart.getTime() - dayStart.getTime()) / 60000;
          const endMin = (segEnd.getTime() - dayStart.getTime()) / 60000;
          out.push({ day: dayStart, startMin, endMin });
        }
      }
      cursor = dayEnd;
    }
    return out;
  }

  // weekly
  const days = normalizeDays(b.weekdays);
  if (days.length === 0) return out;
  const startMin = parseHHMM(b.start_time);
  const endMin = parseHHMM(b.end_time);
  if (endMin <= startMin) return out;
  // Default effective_from to "today in the selected timezone" when unset,
  // so past days are filtered out relative to the user's chosen TZ.
  const today = todayInTz(tz);
  const effFrom = b.effective_from ? startOfDay(new Date(b.effective_from)) : today;
  const effTo = b.effective_to ? startOfDay(new Date(b.effective_to)) : null;
  const KEYS = ["sun","mon","tue","wed","thu","fri","sat"] as const;
  let cursor = startOfDay(from);
  while (cursor < to) {
    const key = KEYS[cursor.getDay()];
    if (days.includes(key as never)) {
      if (cursor >= effFrom && (!effTo || cursor <= effTo)) {
        out.push({ day: new Date(cursor), startMin, endMin });
      }
    }
    cursor = addDays(cursor, 1);
  }
  return out;
}

export function ScheduleTimeline({ blocks, designProjects, channelColor, onBlockClick, onReorderProjects, onAddBlock, channelId }: Props) {
  const { t, language } = useLanguage();
  const [view, setView] = useState<TimelineView>("week");
  const [anchor, setAnchor] = useState<Date>(() => todayInTz(readStoredTz()));
  const [headerHeight, setHeaderHeight] = useState(0);
  const headerRef = useRef<HTMLDivElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [dragRowIdx, setDragRowIdx] = useState<number | null>(null);
  const [dragOverRowIdx, setDragOverRowIdx] = useState<number | null>(null);
  const [tz, setTz] = useState<string>(() => readStoredTz());
  const previousTzRef = useRef<string>(readStoredTz());
  const { user } = useAuth();
  const userId = user?.id ?? null;
  // Track which user we last hydrated tz for, so we don't clobber a logged-in
  // user's saved value with the localStorage default on mount.
  const hydratedFor = useRef<string | null>(null);

  // Load preferred_tz from the profile when the user logs in.
  useEffect(() => {
    if (!userId) {
      hydratedFor.current = null;
      return;
    }
    if (hydratedFor.current === userId) return;
    let cancelled = false;
    void (async () => {
      const { data } = await supabase
        .from("profiles")
        .select("preferred_tz")
        .eq("user_id", userId)
        .maybeSingle();
      if (cancelled) return;
      hydratedFor.current = userId;
      const saved = (data?.preferred_tz as string | null) || "";
      if (saved) setTz(saved);
    })();
    return () => { cancelled = true; };
  }, [userId]);

  // Persist: profile row when logged in (also keep localStorage as a hint for
  // pre-login render); plain localStorage when logged out.
  useEffect(() => {
    try { localStorage.setItem(TZ_LS_KEY, tz); } catch { /* ignore */ }
    if (!userId) return;
    // Only persist after hydration to avoid overwriting the saved value with
    // the localStorage default on first render.
    if (hydratedFor.current !== userId) return;
    void supabase
      .from("profiles")
      .update({ preferred_tz: tz })
      .eq("user_id", userId);
  }, [tz, userId]);

  // Keep the timeline anchored to "today" when timezone hydration changes the
  // observed current date, without overriding manual navigation to other dates.
  useEffect(() => {
    const prevToday = todayInTz(previousTzRef.current);
    const nextToday = todayInTz(tz);
    setAnchor((current) => (sameDay(current, prevToday) ? nextToday : current));
    previousTzRef.current = tz;
  }, [tz]);

  const tzOptions = useMemo(() => {
    const set = new Set<string>(COMMON_TIMEZONES);
    set.add(detectTz());
    set.add(tz);
    return Array.from(set).sort();
  }, [tz]);

  const { from, to, days } = useMemo(() => {
    if (view === "day") {
      const f = startOfDay(anchor);
      return { from: f, to: addDays(f, 1), days: [f] };
    }
    if (view === "week") {
      const f = startOfWeek(anchor);
      const arr = Array.from({ length: 7 }, (_, i) => addDays(f, i));
      return { from: f, to: addDays(f, 7), days: arr };
    }
    const f = startOfMonth(anchor);
    const e = addDays(endOfMonth(anchor), 1);
    const arr: Date[] = [];
    let c = f;
    while (c < e) { arr.push(c); c = addDays(c, 1); }
    return { from: f, to: e, days: arr };
  }, [view, anchor]);

  // Server-side, TZ-aware expansion (only when a channelId is supplied).
  const { intervals: serverIntervals } = useChannelScheduleIntervals(
    channelId ?? null,
    tz,
    channelId ? from : null,
    channelId ? to : null,
  );

  const projects = useMemo(() => {
    // Only show lanes for projects in the channel's allowed list.
    // Add an "unassigned" lane only if a block in the visible set lacks a project.
    const allowedIds = new Set(designProjects.map((p) => p.id));
    const hasUnassigned = blocks.some((b) => !b.design_project_id);
    const list = [...designProjects];
    if (hasUnassigned) list.push({ id: "__unassigned__", name: t("timelineUnassigned") });
    return list;
  }, [designProjects, blocks, t]);

  const projectIndex = useMemo(() => {
    const m = new Map<string, number>();
    projects.forEach((p, i) => m.set(p.id, i));
    return m;
  }, [projects]);

  // Pre-compute placements
  const placements = useMemo(() => {
    type Item = { block: ChannelBlock; day: Date; startMin: number; endMin: number; rowIdx: number };
    const items: Item[] = [];
    // Prefer server-provided intervals when available, but fall back to
    // client-side expansion if the RPC returns no rows for any reason.
    if (channelId && serverIntervals.length > 0) {
      const blockMap = new Map(blocks.map((b) => [b.id, b]));
      for (const iv of serverIntervals) {
        const b = blockMap.get(iv.block_id);
        if (!b) continue;
        const rowKey = iv.design_project_id ?? "__unassigned__";
        const rowIdx = projectIndex.get(rowKey);
        if (rowIdx == null) continue;
        // Parse 'YYYY-MM-DD' as a local date to align with the day grid.
        const [yy, mm, dd] = iv.day.split("-").map(Number);
        const day = new Date(yy, (mm || 1) - 1, dd || 1);
        items.push({ block: b, day, startMin: iv.start_min, endMin: iv.end_min, rowIdx });
      }
      return items;
    }
    // Fallback: client-side expansion (original behavior).
    for (const b of blocks) {
      const rowKey = b.design_project_id ?? "__unassigned__";
      const rowIdx = projectIndex.get(rowKey);
      if (rowIdx == null) continue;
      const ints = resolveBlockIntervals(b, from, to, tz);
      for (const it of ints) items.push({ block: b, ...it, rowIdx });
    }
    return items;
  }, [blocks, projectIndex, from, to, tz, channelId, serverIntervals]);

  // Per-row lane info: assign a stable lane index per block id such that
  // overlapping blocks (same day) get distinct lanes, but non-overlapping
  // blocks reuse low lanes. This keeps row height tight and prevents cards
  // from overflowing the row when many blocks live on different days.
  const rowLaneInfo = useMemo(() => {
    const info = new Map<number, { laneByBlock: Map<string, number>; lanes: number }>();
    for (let r = 0; r < projects.length; r++) {
      const items = placements.filter((pl) => pl.rowIdx === r);
      const blockIds = Array.from(new Set(items.map((x) => x.block.id)));
      const meta = new Map<string, { priority: number; createdAt: string; id: string }>();
      for (const it of items) {
        if (!meta.has(it.block.id)) {
          meta.set(it.block.id, {
            priority: it.block.priority ?? 0,
            createdAt: it.block.created_at ?? "",
            id: it.block.id,
          });
        }
      }
      // Stable order: higher priority first, then older first, then id.
      blockIds.sort((a, b) => {
        const A = meta.get(a)!; const B = meta.get(b)!;
        if (B.priority !== A.priority) return B.priority - A.priority;
        if (A.createdAt !== B.createdAt) return A.createdAt < B.createdAt ? -1 : 1;
        return A.id < B.id ? -1 : 1;
      });
      // Days each block touches (within the visible window).
      const daysByBlock = new Map<string, Set<number>>();
      for (const it of items) {
        const dIdx = days.findIndex((d) => sameDay(d, it.day));
        if (dIdx < 0) continue;
        const set = daysByBlock.get(it.block.id) ?? new Set<number>();
        set.add(dIdx);
        daysByBlock.set(it.block.id, set);
      }
      // Greedy lane assignment: pick lowest lane not already used on any day
      // this block occupies.
      const lanesUsage: Set<number>[] = []; // lanesUsage[lane] = set of dayIdx
      const laneByBlock = new Map<string, number>();
      for (const id of blockIds) {
        const myDays = daysByBlock.get(id) ?? new Set<number>();
        let lane = 0;
        for (;; lane++) {
          if (!lanesUsage[lane]) { lanesUsage[lane] = new Set<number>(); break; }
          let conflict = false;
          for (const d of myDays) { if (lanesUsage[lane].has(d)) { conflict = true; break; } }
          if (!conflict) break;
        }
        for (const d of myDays) lanesUsage[lane].add(d);
        laneByBlock.set(id, lane);
      }
      const lanes = Math.max(1, lanesUsage.length);
      info.set(r, { laneByBlock, lanes });
    }
    return info;
  }, [placements, projects, days]);

  // Fixed card height (matches Media Library bar) + gap between stacked lanes.
  const CARD_H = 36;
  const LANE_GAP = 6;
  const ROW_PAD_Y = 8; // vertical padding inside a row
  const rowHeightFor = (rowIdx: number) => {
    const lanes = rowLaneInfo.get(rowIdx)?.lanes ?? 1;
    const needed = ROW_PAD_Y * 2 + lanes * CARD_H + Math.max(0, lanes - 1) * LANE_GAP;
    return Math.max(ROW_PX, needed);
  };
  const rowOffsets = useMemo(() => {
    const offs: number[] = [];
    let acc = 0;
    for (let r = 0; r < projects.length; r++) {
      offs.push(acc);
      acc += rowHeightFor(r);
    }
    return offs;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projects, rowLaneInfo]);

  const headerLabel = useMemo(() => {
    const fmt = new Intl.DateTimeFormat(language === "zh" ? "zh-TW" : language === "ja" ? "ja-JP" : "en-US", {
      year: "numeric", month: "long", day: view === "month" ? undefined : "numeric",
    });
    if (view === "week") {
      const last = addDays(from, 6);
      return `${fmt.format(from)} – ${fmt.format(last)}`;
    }
    return fmt.format(anchor);
  }, [view, from, anchor, language]);

  const shift = (dir: -1 | 1) => {
    if (view === "day") setAnchor((d) => addDays(d, dir));
    else if (view === "week") setAnchor((d) => addDays(d, 7 * dir));
    else {
      setAnchor((d) => { const x = new Date(d); x.setMonth(x.getMonth() + dir); return startOfMonth(x); });
    }
  };

  useEffect(() => {
    const node = headerRef.current;
    if (!node) return;

    const measure = () => setHeaderHeight(node.offsetHeight);
    measure();

    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, [view, days.length]);

  // Layout helpers
  const isMonth = view === "month";
  const dayColPx = isMonth ? 132 : 24 * HOUR_PX; // month: full-day cell; day/week: hours
  const totalWidth = LABEL_W + dayColPx * days.length;

  // "Now" marker position (only meaningful for day/week containing today)
  const now = nowInTz(tz);
  const nowDayIdx = days.findIndex((d) => sameDay(d, now));
  const nowLeft = !isMonth && nowDayIdx >= 0
    ? LABEL_W + nowDayIdx * dayColPx + ((now.getHours() * 60 + now.getMinutes()) / 60) * HOUR_PX
    : null;
  const isWeekend = (d: Date) => { const w = d.getDay(); return w === 0 || w === 6; };

  // Auto-scroll so "now" sits at ~1/4 of the visible lane area when view/anchor changes
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const now = nowInTz(tz);
    let targetLeft = 0;
    if (isMonth) {
      const idx = days.findIndex((d) => sameDay(d, now));
      if (idx < 0) { el.scrollTo({ left: 0, behavior: "smooth" }); return; }
      targetLeft = LABEL_W + idx * dayColPx;
    } else {
      const idx = days.findIndex((d) => sameDay(d, now));
      if (idx < 0) { el.scrollTo({ left: 0, behavior: "smooth" }); return; }
      targetLeft = LABEL_W + idx * dayColPx + ((now.getHours() * 60 + now.getMinutes()) / 60) * HOUR_PX;
    }
    // Place "now − 1 hour" flush against the left edge of the lane viewport so
    // the hour preceding the current time becomes the visible starting point.
    const offsetPx = isMonth ? 0 : HOUR_PX;
    const desired = targetLeft - LABEL_W - offsetPx;
    el.scrollTo({ left: Math.max(0, desired), behavior: "smooth" });
  }, [view, anchor, isMonth, dayColPx, days, tz, placements.length]);

  // Soft palette for project lane accents
  const laneAccents = [
    "hsl(217 91% 60%)", "hsl(280 65% 60%)", "hsl(160 60% 45%)",
    "hsl(25 95% 55%)", "hsl(340 75% 60%)", "hsl(190 80% 50%)",
    "hsl(45 90% 55%)", "hsl(245 70% 65%)",
  ];

  return (
    <div className="border rounded-xl overflow-hidden bg-card shadow-sm">
      {/* Toolbar */}
      <div className="flex items-center justify-between gap-2 px-4 py-2.5 border-b bg-gradient-to-b from-muted/40 to-muted/10 flex-wrap">
        <div className="flex items-center gap-1.5">
          <Button variant="outline" size="sm" className="h-8" onClick={() => setAnchor(todayInTz(tz))}>
            {t("timelineToday")}
          </Button>
          <div className="flex items-center rounded-md border bg-background overflow-hidden">
            <button onClick={() => shift(-1)} aria-label={t("timelinePrev")} className="h-8 w-8 inline-flex items-center justify-center hover:bg-accent transition-colors">
              <ChevronLeft className="h-4 w-4" />
            </button>
            <div className="w-px h-5 bg-border" />
            <button onClick={() => shift(1)} aria-label={t("timelineNext")} className="h-8 w-8 inline-flex items-center justify-center hover:bg-accent transition-colors">
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
          <span className="text-sm font-semibold ml-2 tracking-tight">{headerLabel}</span>
        </div>
        <div className="flex items-center gap-0.5 rounded-md border bg-background p-0.5 shadow-sm">
          {(["day", "week", "month"] as TimelineView[]).map((v) => (
            <button
              key={v}
              onClick={() => setView(v)}
              className={cn(
                "px-3 py-1 text-xs font-medium rounded transition-all",
                view === v
                  ? "bg-primary text-primary-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground hover:bg-accent",
              )}
            >
              {t(v === "day" ? "timelineViewDay" : v === "week" ? "timelineViewWeek" : "timelineViewMonth")}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-xs text-muted-foreground">{t("timelineTimezone")}</span>
          <Select value={tz} onValueChange={setTz}>
            <SelectTrigger className="h-8 w-[200px] text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="max-h-[320px]">
              {tzOptions.map((zone) => (
                <SelectItem key={zone} value={zone} className="text-xs">
                  {zone}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {projects.length === 0 ? (
        onAddBlock ? (
          <button
            onClick={onAddBlock}
            className="p-12 w-full flex flex-col items-center gap-3 text-muted-foreground/50 hover:text-primary transition-colors"
          >
            <div className="rounded-full border-2 border-dashed border-current p-3">
              <CalendarPlus className="h-6 w-6" />
            </div>
            <span className="text-sm font-medium">{t("newBlock")}</span>
          </button>
        ) : (
          <div className="p-8 text-center text-sm text-muted-foreground">{t("timelineNoProjects")}</div>
        )
      ) : (
        <div ref={scrollRef} className="overflow-auto max-h-[640px] [scrollbar-width:thin]">
          <div style={{ width: totalWidth }} className="relative">
            {/* Header row */}
            <div ref={headerRef} className="sticky top-0 z-20 flex bg-card/95 backdrop-blur border-b shadow-sm">
              <div className="flex-shrink-0 border-r bg-card/95" style={{ width: LABEL_W }} />
              {days.map((d) => {
                const today = sameDay(d, new Date());
                const weekend = isWeekend(d);
                const fmt = new Intl.DateTimeFormat(language === "zh" ? "zh-TW" : language === "ja" ? "ja-JP" : "en-US", {
                  weekday: "short",
                });
                const dayNum = d.getDate();
                const monthShort = new Intl.DateTimeFormat(language === "zh" ? "zh-TW" : language === "ja" ? "ja-JP" : "en-US", {
                  month: "short",
                }).format(d);
                return (
                  <div key={d.toISOString()} className={cn("border-r", weekend && "bg-muted/20")} style={{ width: dayColPx }}>
                    <div className={cn(
                      "px-3 py-2 border-b flex items-baseline gap-1.5",
                      today && "bg-primary/5",
                    )}>
                      <span className={cn(
                        "inline-flex items-center justify-center min-w-[1.5rem] h-6 px-1.5 rounded-md text-sm font-bold tabular-nums",
                        today
                          ? "bg-primary text-primary-foreground shadow-sm"
                          : weekend ? "text-muted-foreground" : "text-foreground",
                      )}>{dayNum}</span>
                      <span className={cn(
                        "text-[10px] uppercase tracking-wider font-semibold",
                        today ? "text-primary" : weekend ? "text-muted-foreground/70" : "text-muted-foreground",
                      )}>{fmt.format(d)}</span>
                      {(view === "day" || isMonth) && (
                        <span className="text-[10px] text-muted-foreground ml-auto">{monthShort}</span>
                      )}
                    </div>
                    {!isMonth && (
                      <div className="flex">
                        {Array.from({ length: 24 }, (_, h) => (
                          <div
                            key={h}
                            className={cn(
                              "text-[9px] text-muted-foreground/60 text-center border-r border-border/40 last:border-r-0 py-0.5 tabular-nums",
                              h % 6 === 0 && "text-foreground/70 font-medium",
                            )}
                            style={{ width: HOUR_PX }}
                          >
                            {h.toString().padStart(2, "0")}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Body rows */}
            {projects.map((p, rowIdx) => {
              const accent = laneAccents[rowIdx % laneAccents.length];
              const isUnassigned = p.id === "__unassigned__";
              const draggable = !!onReorderProjects && !isUnassigned;
              const isDragging = dragRowIdx === rowIdx;
              const isDragOver = dragOverRowIdx === rowIdx && dragRowIdx !== null && dragRowIdx !== rowIdx;
              return (
                <div
                  key={p.id}
                  className={cn(
                    "relative flex border-b last:border-b-0 group/row transition-colors",
                    rowIdx % 2 === 1 && "bg-muted/[0.15]",
                    isDragging && "opacity-50",
                    isDragOver && "ring-1 ring-primary ring-inset",
                  )}
                  style={{ height: rowHeightFor(rowIdx) }}
                >
                  <div
                    draggable={draggable}
                    onDragStart={(e) => {
                      if (!draggable) return;
                      setDragRowIdx(rowIdx);
                      e.dataTransfer.effectAllowed = "move";
                    }}
                    onDragOver={(e) => {
                      if (!onReorderProjects || dragRowIdx === null) return;
                      // Don't allow dropping onto unassigned lane
                      if (isUnassigned) return;
                      e.preventDefault();
                      e.dataTransfer.dropEffect = "move";
                      if (dragOverRowIdx !== rowIdx) setDragOverRowIdx(rowIdx);
                    }}
                    onDragLeave={() => {
                      if (dragOverRowIdx === rowIdx) setDragOverRowIdx(null);
                    }}
                    onDrop={(e) => {
                      if (!onReorderProjects || dragRowIdx === null) return;
                      e.preventDefault();
                      const from = dragRowIdx;
                      const to = rowIdx;
                      setDragRowIdx(null);
                      setDragOverRowIdx(null);
                      if (from === to) return;
                      // Reorder only the real (non-unassigned) project ids
                      const realIds = projects
                        .filter((pr) => pr.id !== "__unassigned__")
                        .map((pr) => pr.id);
                      // Translate row indices to real-id indices
                      const fromId = projects[from]?.id;
                      const toId = projects[to]?.id;
                      if (!fromId || !toId || fromId === "__unassigned__" || toId === "__unassigned__") return;
                      const fromIdx = realIds.indexOf(fromId);
                      const toIdx = realIds.indexOf(toId);
                      if (fromIdx < 0 || toIdx < 0) return;
                      const next = [...realIds];
                      const [moved] = next.splice(fromIdx, 1);
                      next.splice(toIdx, 0, moved);
                      onReorderProjects(next);
                    }}
                    onDragEnd={() => {
                      setDragRowIdx(null);
                      setDragOverRowIdx(null);
                    }}
                    className={cn(
                      "sticky left-0 z-10 flex-shrink-0 bg-card border-r flex items-center text-sm font-medium truncate group-hover/row:bg-accent/30 transition-colors",
                      draggable && "cursor-grab active:cursor-grabbing",
                    )}
                    style={{ width: LABEL_W }}
                    title={p.name}
                  >
                    <span className="w-1 self-stretch flex-shrink-0" style={{ backgroundColor: accent }} />
                    {draggable && (
                      <GripVertical className="h-3.5 w-3.5 text-muted-foreground/60 ml-2 flex-shrink-0" />
                    )}
                    <span className="px-3 truncate flex-1">{p.name}</span>
                  </div>
                  {days.map((d) => {
                    const weekend = isWeekend(d);
                    const today = sameDay(d, new Date());
                    return (
                      <div
                        key={d.toISOString()}
                        className={cn(
                          "relative border-r",
                          weekend && "bg-muted/[0.12]",
                          today && !isMonth && "bg-primary/[0.03]",
                        )}
                        style={{ width: dayColPx }}
                      >
                        {!isMonth && (
                          <div className="absolute inset-0 flex pointer-events-none">
                            {Array.from({ length: 24 }, (_, h) => (
                              <div
                                key={h}
                                className={cn(
                                  "border-r last:border-r-0",
                                  h % 6 === 0 ? "border-border/60" : "border-border/25",
                                )}
                                style={{ width: HOUR_PX }}
                              />
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                  {/* Block bars for this row — compute sub-lanes so overlapping
                      placements stack vertically instead of covering each other. */}
                  {(() => {
                    const rowItems = placements
                      .filter((pl) => pl.rowIdx === rowIdx)
                      .map((pl, i) => {
                        const dayIdx = days.findIndex((d) => sameDay(d, pl.day));
                        return { pl, i, dayIdx };
                      })
                      .filter((x) => x.dayIdx >= 0);
                    const info = rowLaneInfo.get(rowIdx);
                    const laneByBlock = info?.laneByBlock ?? new Map<string, number>();
                    return rowItems.map(({ pl, i, dayIdx }) => {
                    const lane = laneByBlock.get(pl.block.id) ?? 0;
                    // Bars are positioned relative to the row container.
                    // Day cells start AFTER the sticky LABEL_W column inside the row.
                    const left = LABEL_W + dayIdx * dayColPx + (isMonth ? 6 : (pl.startMin / 60) * HOUR_PX);
                    const width = isMonth
                      ? dayColPx - 12
                      : Math.max(6, ((pl.endMin - pl.startMin) / 60) * HOUR_PX);
                    // Fixed card height; rows grow to fit. Lanes are stacked with a small gap.
                    const laneH = CARD_H;
                    const top = ROW_PAD_Y + lane * (CARD_H + LANE_GAP);
                    // Card color follows the row (project lane) accent color.
                    const color = accent;
                    const sh = `${Math.floor(pl.startMin/60).toString().padStart(2,"0")}:${(pl.startMin%60).toString().padStart(2,"0")}`;
                    const eh = `${Math.floor(pl.endMin/60).toString().padStart(2,"0")}:${(pl.endMin%60).toString().padStart(2,"0")}`;
                    return (
                      <button
                        key={`${pl.block.id}-${i}`}
                        onClick={() => onBlockClick?.(pl.block)}
                        className="group/blk absolute rounded-[4px] text-[11px] text-left overflow-hidden ring-1 ring-black/5 shadow-[0_1px_2px_rgba(0,0,0,0.06),0_2px_8px_-2px_rgba(0,0,0,0.08)] hover:shadow-[0_4px_12px_-2px_rgba(0,0,0,0.18)] hover:-translate-y-px hover:z-10 transition-all duration-150"
                        style={{
                          left,
                          top,
                          width,
                          height: laneH,
                          background: `linear-gradient(135deg, ${color}38 0%, ${color}22 100%)`,
                          color: "hsl(var(--foreground))",
                        }}
                        title={`${pl.block.name}  ${sh} – ${eh}`}
                      >
                        {/* Left color stripe */}
                        <span
                          className="absolute left-0 top-0 bottom-0 w-1 rounded-l-[4px]"
                          style={{ backgroundColor: color }}
                        />
                        <div className="pl-2.5 pr-2 py-1 h-full flex flex-col justify-center">
                          <span className="font-semibold truncate leading-tight">{pl.block.name || "—"}</span>
                          {!isMonth && laneH > 28 && (
                            <span className="block opacity-75 text-[10px] tabular-nums truncate leading-tight mt-0.5">
                              {sh} – {eh}
                            </span>
                          )}
                        </div>
                      </button>
                    );
                  });
                  })()}
                </div>
              );
            })}

            {/* "Now" indicator line */}
            {nowLeft != null && (
              <div
                className="pointer-events-none absolute top-0 bottom-0 z-10"
                style={{ left: nowLeft }}
              >
                <div className="relative h-full">
                  <div className="absolute top-0 bottom-0 w-px bg-destructive/80" />
                  <div className="absolute -top-1 -left-1.5 h-3 w-3 rounded-full bg-destructive shadow-[0_0_0_3px_hsl(var(--background)),0_0_8px_hsl(var(--destructive)/0.5)]" />
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
