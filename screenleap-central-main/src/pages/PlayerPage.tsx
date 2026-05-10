import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Loader2, ArrowLeft, Pause, Play, SkipForward, Volume2, VolumeX, Maximize, Minimize, Sun, Moon, Music, ShieldOff } from "lucide-react";
import { toast } from "sonner";
import { useLanguage } from "@/contexts/LanguageContext";
import { useScreenLicenseStatus } from "@/hooks/useScreenLicenseStatus";
import { DesignStage } from "@/components/player/DesignStage";

interface BgmTrack {
  id: string;
  media_id: string;
  url: string;
  name: string;
}

interface PlaylistItem {
  id: string;
  media_id: string | null;
  duration: number;
  item_type: string;
  media_name: string;
  media_type: string;
  media_url: string;
  // For design-project items: BGM override embedded in the project's zones[0]._meta.
  design_project_id?: string | null;
  design_zones?: unknown[];
  design_bgm_tracks?: BgmTrack[];
  design_bgm_volume?: number | null;
  design_bgm_audio_source?: string | null;
}

interface ScreenInfo {
  id: string;
  name: string;
  org_id: string;
  resolution: string;
  default_playback: string | null;
  default_project_id: string | null;
  default_media_id: string | null;
}

interface Schedule {
  id: string;
  name: string;
  enabled: boolean;
  start_time: string;
  end_time: string;
  days: string[];
  items: PlaylistItem[];
  bgm_tracks: BgmTrack[];
  bgm_volume: number;
}

import { dayMatches } from "@/lib/weekdays";

function isScheduleActiveNow(s: Schedule, now: Date): boolean {
  if (!s.enabled) return false;
  if (!dayMatches(s.days, now.getDay())) return false;
  const [sh, sm] = (s.start_time || "00:00").split(":").map(Number);
  const [eh, em] = (s.end_time || "23:59").split(":").map(Number);
  const start = sh * 60 + sm;
  const end = eh * 60 + em;
  const cur = now.getHours() * 60 + now.getMinutes();
  return cur >= start && cur <= end;
}

interface ZoneItem {
  _meta?: boolean;
  bgm?: {
    items?: Array<{ id?: unknown; url?: unknown; name?: unknown }>;
    volume?: unknown;
    audioSource?: unknown;
  };
  [key: string]: unknown;
}

// Studio stores BGM as zones[0] = { _meta: true, bgm: { items, volume, audioSource } }.
function extractDesignBgm(zones: unknown): {
  tracks: BgmTrack[];
  volume: number | null;
  audioSource: string | null;
} {
  if (!Array.isArray(zones)) return { tracks: [], volume: null, audioSource: null };
  const meta = (zones as ZoneItem[]).find((z) => z && z._meta);
  const bgm = meta?.bgm;
  if (!bgm) return { tracks: [], volume: null, audioSource: null };
  const rawItems = Array.isArray(bgm.items) ? bgm.items : [];
  const tracks: BgmTrack[] = rawItems
    .map((it, idx: number) => ({
      id: String(it?.id ?? `dp-bgm-${idx}`),
      media_id: String(it?.id ?? ""),
      url: String(it?.url ?? ""),
      name: String(it?.name ?? "BGM"),
    }))
    .filter((t: BgmTrack) => !!t.url);
  const volume = typeof bgm.volume === "number" ? Math.max(0, Math.min(100, bgm.volume)) : null;
  const audioSource = typeof bgm.audioSource === "string" && bgm.audioSource ? bgm.audioSource : null;
  return { tracks, volume, audioSource };
}

export default function PlayerPage() {
  const { screenId } = useParams<{ screenId: string }>();
  const navigate = useNavigate();
  const { t, language } = useLanguage();
  const { info: licenseInfo, loading: licenseLoading } = useScreenLicenseStatus(screenId || null);
  const [screen, setScreen] = useState<ScreenInfo | null>(null);
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [defaultItem, setDefaultItem] = useState<PlaylistItem | null>(null);
  const [loading, setLoading] = useState(true);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const [muted, setMuted] = useState(true);
  const [progress, setProgress] = useState(0);
  const [elapsedSec, setElapsedSec] = useState(0);
  const itemStartRef = useRef<number>(Date.now());
  const lastLoggedRef = useRef<string>("");
  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const wakeLockRef = useRef<WakeLockSentinel | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [wakeLockOn, setWakeLockOn] = useState(false);

  // BGM state
  const bgmAudioRef = useRef<HTMLAudioElement | null>(null);
  const [bgmIndex, setBgmIndex] = useState(0);

  // ===== Smart-trigger override =====
  const [overrideItem, setOverrideItem] = useState<PlaylistItem | null>(null);
  const overrideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastFiredLogIdRef = useRef<string>("");

  const clearOverride = useCallback(() => {
    if (overrideTimerRef.current) {
      clearTimeout(overrideTimerRef.current);
      overrideTimerRef.current = null;
    }
    setOverrideItem(null);
  }, []);

  const applyTriggerOverride = useCallback(async (logRow: {
    id: string;
    rule_id: string | null;
    screen_id: string | null;
    success: boolean;
    trigger_key: string | null;
    debug_id?: string | null;
  }) => {
    if (!screenId) return;
    if (!logRow.success || !logRow.rule_id) return;
    if (lastFiredLogIdRef.current === logRow.id) return;
    lastFiredLogIdRef.current = logRow.id;

    if (logRow.screen_id && logRow.screen_id !== screenId) return;

    const debugTag = `[smart-trigger][debug_id=${logRow.debug_id ?? "n/a"}]`;
    console.log(`${debugTag} player received log`, {
      log_id: logRow.id,
      rule_id: logRow.rule_id,
      screen_id: logRow.screen_id,
      trigger_key: logRow.trigger_key,
    });

    const { data: rule } = await supabase
      .from("smart_trigger_rules")
      .select(
        "id, name, scope, enabled, duration_seconds, target_design_project_id, " +
        "design_projects:target_design_project_id(id, name, zones)"
      )
      .eq("id", logRow.rule_id)
      .maybeSingle();

    if (!rule || !rule.enabled || !rule.target_design_project_id) {
      console.warn(`${debugTag} rule lookup failed or no target project`, { rule_id: logRow.rule_id });
      return;
    }
    const dp = rule.design_projects;
    if (!dp) {
      console.warn(`${debugTag} target design project not found`, { dp_id: rule.target_design_project_id });
      return;
    }

    if (rule.scope === "org") {
      const { data: ov } = await supabase
        .from("screen_smart_trigger_overrides")
        .select("enabled")
        .eq("screen_id", screenId)
        .eq("rule_id", rule.id)
        .maybeSingle();
      if (ov && ov.enabled === false) {
        console.log(`${debugTag} per-screen override disabled — skipping`);
        return;
      }
    }

    const bgm = extractDesignBgm(dp.zones);
    const dur = Math.max(1, Number(rule.duration_seconds) || 30);
    const item: PlaylistItem = {
      id: `trigger-${logRow.id}`,
      media_id: null,
      duration: dur,
      item_type: "design_project",
      media_name: dp.name || rule.name || "Smart Trigger",
      media_type: "design",
      media_url: "",
      design_project_id: rule.target_design_project_id,
      design_zones: dp.zones as unknown[] | undefined,
      design_bgm_tracks: bgm.tracks,
      design_bgm_volume: bgm.volume,
      design_bgm_audio_source: bgm.audioSource,
    };

    if (overrideTimerRef.current) clearTimeout(overrideTimerRef.current);
    setOverrideItem(item);
    console.log(`${debugTag} override applied`, {
      design_project_id: rule.target_design_project_id,
      duration_seconds: dur,
    });
    toast.success(
      (t("playerSmartTriggerFired") ?? "Smart trigger") + `：${item.media_name}`,
    );
    overrideTimerRef.current = setTimeout(() => {
      setOverrideItem(null);
      overrideTimerRef.current = null;
      console.log(`${debugTag} override expired — restoring schedule`);
    }, dur * 1000);
  }, [screenId, t]);

  useEffect(() => {
    if (!screenId) return;
    const channel = supabase
      .channel(`smart-trigger-logs-${screenId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "smart_trigger_logs",
          filter: `screen_id=eq.${screenId}`,
        },
        (payload) => {
          const row = payload.new as Record<string, unknown>;
          applyTriggerOverride({
            id: String(row.id ?? ""),
            rule_id: row.rule_id != null ? String(row.rule_id) : null,
            screen_id: row.screen_id != null ? String(row.screen_id) : null,
            success: Boolean(row.success),
            trigger_key: row.trigger_key != null ? String(row.trigger_key) : null,
            debug_id: row.debug_id != null ? String(row.debug_id) : null,
          });
        },
      )
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "smart_trigger_logs",
          filter: `screen_id=is.null`,
        },
        (payload) => {
          const row = payload.new as Record<string, unknown>;
          if (!screen || row.org_id !== screen.org_id) return;
          applyTriggerOverride({
            id: String(row.id ?? ""),
            rule_id: row.rule_id != null ? String(row.rule_id) : null,
            screen_id: row.screen_id != null ? String(row.screen_id) : null,
            success: Boolean(row.success),
            trigger_key: row.trigger_key != null ? String(row.trigger_key) : null,
            debug_id: row.debug_id != null ? String(row.debug_id) : null,
          });
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [screenId, screen?.org_id, applyTriggerOverride, screen]);

  useEffect(() => () => {
    if (overrideTimerRef.current) clearTimeout(overrideTimerRef.current);
  }, []);

  useEffect(() => {
    const handler = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", handler);
    return () => document.removeEventListener("fullscreenchange", handler);
  }, []);

  const toggleFullscreen = useCallback(async () => {
    try {
      if (!document.fullscreenElement) {
        await containerRef.current?.requestFullscreen();
      } else {
        await document.exitFullscreen();
      }
    } catch {
      toast.error(t("playerFullscreenFailed"));
    }
  }, [t]);

  const releaseWakeLock = useCallback(async () => {
    try { await wakeLockRef.current?.release(); } catch { /* noop */ }
    wakeLockRef.current = null;
    setWakeLockOn(false);
  }, []);

  const acquireWakeLock = useCallback(async () => {
    const nav = navigator as Navigator & { wakeLock?: { request: (type: string) => Promise<WakeLockSentinel> } };
    if (!nav.wakeLock?.request) {
      toast.error(t("playerWakeLockUnsupported"));
      return;
    }
    try {
      wakeLockRef.current = await nav.wakeLock.request("screen");
      setWakeLockOn(true);
      wakeLockRef.current.addEventListener("release", () => setWakeLockOn(false));
      toast.success(t("playerWakeLockOn"));
    } catch {
      toast.error(t("playerWakeLockUnsupported"));
    }
  }, [t]);

  const toggleWakeLock = useCallback(() => {
    if (wakeLockOn) {
      releaseWakeLock();
      toast.success(t("playerWakeLockOff"));
    } else {
      acquireWakeLock();
    }
  }, [wakeLockOn, acquireWakeLock, releaseWakeLock, t]);

  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState === "visible" && wakeLockOn && !wakeLockRef.current) {
        acquireWakeLock();
      }
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [wakeLockOn, acquireWakeLock]);

  useEffect(() => () => { releaseWakeLock(); }, [releaseWakeLock]);

  const fetchAll = useCallback(async () => {
    if (!screenId) return;
    if (licenseLoading) return;
    const scrFields = "id, name, org_id, resolution, default_playback, default_project_id, default_media_id";
    if (licenseInfo && !licenseInfo.licensed) {
      setLoading(false);
      const { data: scr } = await supabase.from("screens").select(scrFields).eq("id", screenId).maybeSingle();
      if (scr) setScreen(scr as unknown as ScreenInfo);
      return;
    }
    setLoading(true);
    const { data: scr } = await supabase.from("screens").select(scrFields).eq("id", screenId).maybeSingle();
    if (!scr) {
      toast.error(t("playerScreenNotFound"));
      setLoading(false);
      return;
    }
    setScreen(scr as unknown as ScreenInfo);

    const scrTyped = scr as unknown as ScreenInfo;
    let resolved: PlaylistItem | null = null;
    if (scrTyped.default_playback === "project" && scrTyped.default_project_id) {
      const { data: dp } = await (supabase as any)
        .from("design_projects")
        .select("id, name, zones")
        .eq("id", scrTyped.default_project_id)
        .maybeSingle();
      if (dp) {
        const bgm = extractDesignBgm(dp.zones);
        resolved = {
          id: `default-${dp.id}`,
          media_id: null,
          duration: 0,
          item_type: "design_project",
          media_name: dp.name || "預設畫面",
          media_type: "design",
          media_url: "",
          design_project_id: dp.id,
          design_zones: dp.zones as unknown[],
          design_bgm_tracks: bgm.tracks,
          design_bgm_volume: bgm.volume,
          design_bgm_audio_source: bgm.audioSource,
        };
      }
    } else if (scrTyped.default_playback === "media" && scrTyped.default_media_id) {
      const { data: media } = await (supabase as any)
        .from("media_items")
        .select("id, name, type, url")
        .eq("id", scrTyped.default_media_id)
        .maybeSingle();
      if (media) {
        resolved = {
          id: `default-${media.id}`,
          media_id: media.id,
          duration: 0,
          item_type: "media",
          media_name: media.name || "預設畫面",
          media_type: media.type || "image",
          media_url: media.url || "",
        };
      }
    }
    setDefaultItem(resolved);

    interface RawScheduleItem {
      id: string;
      media_id: string | null;
      design_project_id: string | null;
      duration: number;
      item_type: string;
      sort_order: number;
      media_items?: { id: string; name: string; type: string; url: string } | null;
      design_projects?: { id: string; name: string; zones: unknown } | null;
    }
    interface RawBgmItem {
      id: string;
      media_id: string;
      sort_order: number;
      media_items?: { id: string; name: string; url: string } | null;
    }
    interface RawScheduleRow {
      id: string;
      name: string;
      enabled: boolean;
      start_time: string;
      end_time: string;
      days: string[];
      bgm_volume: number | null;
      schedule_items?: RawScheduleItem[];
      schedule_bgm_items?: RawBgmItem[];
    }

    const { data: schedRows } = await supabase
      .from("schedules" as never)
      .select(
        "id, name, enabled, start_time, end_time, days, bgm_volume, " +
          "schedule_items(id, media_id, design_project_id, duration, item_type, sort_order, " +
            "media_items(id, name, type, url), " +
            "design_projects(id, name, zones)" +
          "), " +
          "schedule_bgm_items(id, media_id, sort_order, media_items(id, name, url))"
      )
      .eq("screen_id", screenId)
      .order("created_at");

    const parsed: Schedule[] = ((schedRows as unknown as RawScheduleRow[]) || []).map((s) => ({
      id: s.id,
      name: s.name,
      enabled: s.enabled,
      start_time: s.start_time,
      end_time: s.end_time,
      days: s.days || [],
      bgm_volume: typeof s.bgm_volume === "number" ? s.bgm_volume : 30,
      items: (s.schedule_items || [])
        .sort((a, b) => a.sort_order - b.sort_order)
        .map((it) => {
          const isDesign = it.item_type === "design_project" && it.design_projects;
          if (isDesign) {
            const dp = it.design_projects;
            const bgm = extractDesignBgm(dp?.zones);
            return {
              id: it.id,
              media_id: null,
              duration: it.duration || 10,
              item_type: it.item_type,
              media_name: dp?.name || "(已刪除設計專案)",
              media_type: "design",
              media_url: "",
              design_project_id: it.design_project_id,
              design_zones: dp?.zones as unknown[] | undefined,
              design_bgm_tracks: bgm.tracks,
              design_bgm_volume: bgm.volume,
              design_bgm_audio_source: bgm.audioSource,
            } as PlaylistItem;
          }
          return {
            id: it.id,
            media_id: it.media_id,
            duration: it.duration || 10,
            item_type: it.item_type,
            media_name: it.media_items?.name || "(已刪除素材)",
            media_type: it.media_items?.type || "image",
            media_url: it.media_items?.url || "",
          } as PlaylistItem;
        }),
      bgm_tracks: (s.schedule_bgm_items || [])
        .sort((a, b) => a.sort_order - b.sort_order)
        .map((b) => ({
          id: b.id,
          media_id: b.media_id,
          url: b.media_items?.url || "",
          name: b.media_items?.name || "BGM",
        }))
        .filter((b: BgmTrack) => !!b.url),
    }));
    setSchedules(parsed);
    setLoading(false);
  }, [screenId, t, licenseLoading, licenseInfo?.licensed]);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  useEffect(() => {
    if (licenseInfo && !licenseInfo.licensed) {
      setPaused(true);
    }
  }, [licenseInfo?.licensed]);

  const activeSchedule = useMemo(() => {
    const now = new Date();
    return schedules.find((s) => isScheduleActiveNow(s, now) && s.items.length > 0) ?? null;
  }, [schedules]);

  const items = activeSchedule?.items ?? [];
  const scheduledItem = items[currentIndex] ?? null;
  const currentItem = overrideItem ?? scheduledItem;
  const isOverride = !!overrideItem;

  const isDesignWithBgm = !!(currentItem && currentItem.media_type === "design" && (currentItem.design_bgm_tracks?.length ?? 0) > 0);

  const bgmTracks = isDesignWithBgm
    ? (currentItem!.design_bgm_tracks as BgmTrack[])
    : (activeSchedule?.bgm_tracks ?? []);
  const bgmVolume = isDesignWithBgm && typeof currentItem!.design_bgm_volume === "number"
    ? (currentItem!.design_bgm_volume as number)
    : (activeSchedule?.bgm_volume ?? 30);
  const designAudioSource = isDesignWithBgm ? currentItem!.design_bgm_audio_source : null;
  const designForcesMute = isDesignWithBgm && designAudioSource !== null && designAudioSource !== "bgm";

  const currentBgm = bgmTracks[bgmIndex] ?? null;

  const bgmShouldPause = paused || muted || !currentItem || currentItem.media_type === "video" || designForcesMute;

  useEffect(() => {
    setBgmIndex(0);
  }, [activeSchedule?.id, isDesignWithBgm ? currentItem?.id : null]);

  useEffect(() => {
    const a = bgmAudioRef.current;
    if (!a) return;
    const target = Math.max(0, Math.min(1, bgmVolume / 100));
    const RAMP_MS = 200;
    const STEP_MS = 20;
    const steps = Math.max(1, Math.round(RAMP_MS / STEP_MS));
    let cancelled = false;
    let timer: ReturnType<typeof setInterval> | null = null;

    const ramp = (from: number, to: number, onDone?: () => void) => {
      let i = 0;
      a.volume = Math.max(0, Math.min(1, from));
      timer = setInterval(() => {
        if (cancelled) { if (timer) clearInterval(timer); return; }
        i += 1;
        const v = from + (to - from) * (i / steps);
        a.volume = Math.max(0, Math.min(1, v));
        if (i >= steps) {
          if (timer) clearInterval(timer);
          timer = null;
          onDone?.();
        }
      }, STEP_MS);
    };

    if (bgmShouldPause) {
      ramp(a.volume, 0, () => { try { a.pause(); } catch { /* ignore */ } });
    } else {
      a.volume = 0;
      a.play()
        .then(() => { if (!cancelled) ramp(0, target); })
        .catch(() => { /* user-interaction-required; ignored */ });
    }

    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
    };
  }, [bgmShouldPause, bgmVolume, currentBgm?.id]);

  useEffect(() => {
    if (currentIndex >= items.length && items.length > 0) {
      setCurrentIndex(0);
    }
  }, [items.length, currentIndex]);

  useEffect(() => {
    if (!currentItem) return;
    itemStartRef.current = Date.now();
    setElapsedSec(0);
    setProgress(0);
  }, [currentItem?.id]);

  const logPlayback = useCallback(async (item: PlaylistItem, durationSec: number) => {
    if (!screen || !item.media_id) return;
    const key = `${item.id}-${itemStartRef.current}`;
    if (lastLoggedRef.current === key) return;
    lastLoggedRef.current = key;
    try {
      await supabase.from("playback_logs").insert({
        media_id: item.media_id,
        media_name: item.media_name,
        screen_id: screen.id,
        org_id: screen.org_id,
        duration_seconds: Math.max(1, Math.round(durationSec)),
        played_at: new Date().toISOString(),
      });
    } catch {
      /* silent */
    }
  }, [screen]);

  const advance = useCallback(() => {
    if (!currentItem) return;
    const dur = (Date.now() - itemStartRef.current) / 1000;
    logPlayback(currentItem, dur);
    setCurrentIndex((i) => (items.length > 0 ? (i + 1) % items.length : 0));
  }, [currentItem, items.length, logPlayback]);

  useEffect(() => {
    if (paused || !currentItem) return;
    const interval = setInterval(() => {
      const elapsed = (Date.now() - itemStartRef.current) / 1000;
      setElapsedSec(elapsed);
      const pct = Math.min(100, (elapsed / currentItem.duration) * 100);
      setProgress(pct);
      if (currentItem.media_type !== "video" && elapsed >= currentItem.duration) {
        if (isOverride) {
          clearOverride();
        } else {
          advance();
        }
      }
    }, 200);
    return () => clearInterval(interval);
  }, [paused, currentItem, advance, isOverride, clearOverride]);

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    if (paused) v.pause();
    else v.play().catch(() => {});
  }, [paused, currentItem?.id]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!screen) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-background gap-4">
        <p className="text-muted-foreground">{t("playerScreenNotFound")}</p>
        <Button onClick={() => navigate("/screens")}>{t("playerBackToScreens")}</Button>
      </div>
    );
  }

  if (!licenseLoading && licenseInfo && !licenseInfo.licensed) {
    const isRevoked = licenseInfo.status === "revoked";
    const title = isRevoked
      ? { zh: "設備授權已撤銷", en: "Device License Revoked", ja: "デバイスライセンスが取り消されました" }[language]
      : { zh: "未授權設備", en: "Unauthorized Device", ja: "未承認のデバイス" }[language];
    const desc = isRevoked
      ? { zh: "此螢幕的設備授權已被撤銷，已停止播放並禁止連線。請聯絡系統管理員或客服恢復授權。", en: "This screen's device license has been revoked. Playback is stopped and connections are blocked. Contact your administrator to restore the license.", ja: "このスクリーンのデバイスライセンスは取り消されました。再生は停止され、接続もブロックされています。管理者に連絡してライセンスを復元してください。" }[language]
      : { zh: "找不到對應的有效設備授權，無法啟用播放。請先在「設備授權管理」中為此設備建立或啟用授權。", en: "No active device license is bound to this screen. Playback is disabled. Please create or activate a license in Device License Management.", ja: "このスクリーンに有効なデバイスライセンスが見つかりません。「デバイスライセンス管理」で発行・有効化してください。" }[language];
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-background gap-6 p-8 text-center">
        <div className="w-20 h-20 rounded-full bg-destructive/10 flex items-center justify-center">
          <ShieldOff className="w-10 h-10 text-destructive" />
        </div>
        <div className="space-y-2 max-w-lg">
          <h1 className="text-2xl font-semibold text-destructive">{title}</h1>
          <p className="text-sm text-muted-foreground">{desc}</p>
          {isRevoked && licenseInfo.revoked_at && (
            <p className="text-xs text-muted-foreground font-mono">
              {{ zh: "撤銷時間", en: "Revoked at", ja: "取消日時" }[language]}: {new Date(licenseInfo.revoked_at).toLocaleString()}
            </p>
          )}
          <p className="text-xs text-muted-foreground">
            {{ zh: "螢幕", en: "Screen", ja: "スクリーン" }[language]}: <span className="font-medium text-foreground">{screen.name}</span>
          </p>
        </div>
        <Button variant="outline" onClick={() => navigate("/screens")}>
          <ArrowLeft className="w-4 h-4 mr-2" />
          {t("playerBackToScreens")}
        </Button>
      </div>
    );
  }

  const stageContent = (() => {
    const item = currentItem ?? (defaultItem ?? null);
    if (!item) {
      return (
        <div className="text-center text-muted-foreground space-y-2">
          <p className="text-lg">📺 {t("playerNoSchedule")}</p>
          <p className="text-sm">{t("playerCreateScheduleHint")}</p>
        </div>
      );
    }
    if (item.media_type === "design" && item.design_project_id && item.design_zones) {
      return (
        <DesignStage
          key={item.id}
          project={{ id: item.design_project_id, name: item.media_name, zones: item.design_zones }}
          resolveMediaUrl={() => null}
          muted={muted}
          playing={!paused}
        />
      );
    }
    if (item.media_type === "video") {
      return (
        <video
          key={item.id}
          ref={item === currentItem ? videoRef : undefined}
          src={item.media_url}
          className="max-w-full max-h-full"
          autoPlay
          loop={!currentItem}
          muted={muted}
          playsInline
          onEnded={item === currentItem ? advance : undefined}
          onError={item === currentItem ? advance : undefined}
        />
      );
    }
    return (
      <img
        key={item.id}
        src={item.media_url}
        alt={item.media_name}
        className="max-w-full max-h-full object-contain"
        onError={item === currentItem ? advance : undefined}
      />
    );
  })();

  return (
    <div ref={containerRef} className="h-screen w-screen bg-black relative overflow-hidden">
      {currentBgm && (
        <audio
          key={currentBgm.id}
          ref={bgmAudioRef}
          src={currentBgm.url}
          autoPlay
          onEnded={() => setBgmIndex((i) => (bgmTracks.length > 0 ? (i + 1) % bgmTracks.length : 0))}
          onError={() => setBgmIndex((i) => (bgmTracks.length > 0 ? (i + 1) % bgmTracks.length : 0))}
          className="hidden"
        />
      )}

      <div className="absolute inset-0 flex items-center justify-center">
        {stageContent}
      </div>

      <div className="absolute top-0 left-0 right-0 z-20 flex items-center justify-between px-3 py-1.5 bg-black/70 backdrop-blur-sm border-b border-white/10">
        <div className="flex items-center gap-2 min-w-0">
          <Button variant="ghost" size="sm" className="text-white/80 hover:text-white hover:bg-white/10 shrink-0" onClick={() => navigate("/screens")}>
            <ArrowLeft className="w-4 h-4 mr-1" /> {t("playerBack")}
          </Button>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-white truncate">🖥 {screen.name}</p>
            <p className="text-xs text-white/60 truncate">
              {isOverride
                ? `⚡ ${t("playerSmartTriggerBadge")}`
                : activeSchedule
                ? t("playerPlaying").replace("{name}", activeSchedule.name)
                : defaultItem
                ? t("playerNoActiveSchedule")
                : t("playerNoActiveSchedule")}
              {items.length > 0 && currentItem && ` · ${currentIndex + 1}/${items.length} · ${currentItem.media_name}`}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {currentBgm && (
            <div className="hidden sm:flex items-center gap-1 px-2 py-0.5 rounded bg-white/10 text-white/70 text-xs">
              <Music className="w-3 h-3" />
              <span className="max-w-[100px] truncate">{currentBgm.name}</span>
              <span className="text-[10px] opacity-60">{bgmVolume}%</span>
            </div>
          )}
          <Button variant="ghost" size="sm" className="text-white/80 hover:text-white hover:bg-white/10 h-7 w-7 p-0" onClick={() => setPaused((p) => !p)} disabled={!currentItem}>
            {paused ? <Play className="w-3.5 h-3.5" /> : <Pause className="w-3.5 h-3.5" />}
          </Button>
          <Button variant="ghost" size="sm" className="text-white/80 hover:text-white hover:bg-white/10 h-7 w-7 p-0" onClick={advance} disabled={!currentItem}>
            <SkipForward className="w-3.5 h-3.5" />
          </Button>
          <Button variant="ghost" size="sm" className="text-white/80 hover:text-white hover:bg-white/10 h-7 w-7 p-0" onClick={() => setMuted((m) => !m)}>
            {muted ? <VolumeX className="w-3.5 h-3.5" /> : <Volume2 className="w-3.5 h-3.5" />}
          </Button>
          <Button variant="ghost" size="sm" className="text-white/80 hover:text-white hover:bg-white/10 h-7 w-7 p-0" onClick={toggleWakeLock} title={wakeLockOn ? t("playerWakeLockOff") : t("playerWakeLockOn")}>
            {wakeLockOn ? <Sun className="w-3.5 h-3.5" /> : <Moon className="w-3.5 h-3.5" />}
          </Button>
          <Button variant="ghost" size="sm" className="text-white/80 hover:text-white hover:bg-white/10 h-7 w-7 p-0" onClick={toggleFullscreen} title={isFullscreen ? t("playerExitFullscreen") : t("playerEnterFullscreen")}>
            {isFullscreen ? <Minimize className="w-3.5 h-3.5" /> : <Maximize className="w-3.5 h-3.5" />}
          </Button>
        </div>
      </div>

      {currentItem && (
        <div className="absolute bottom-0 left-0 right-0 z-20 px-3 py-1.5 bg-black/70 backdrop-blur-sm border-t border-white/10">
          <div className="h-1 bg-white/20 rounded-full overflow-hidden">
            <div className="h-full bg-primary transition-all" style={{ width: `${progress}%` }} />
          </div>
          <div className="flex items-center justify-between mt-1 text-[10px] text-white/50">
            <span>{Math.floor(elapsedSec)}s / {currentItem.duration}s</span>
            <span>
              {currentItem.media_type === "video" ? t("playerVideo") : currentItem.media_type === "design" ? (t("playerDesignProject") ?? "設計專案") : t("playerImage")}
              {" · "}{t("playerSchedule")}：{activeSchedule?.name}
              {isDesignWithBgm && <span className="ml-1.5 text-primary">· BGM</span>}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
