import { useEffect, useMemo, useRef, useState, useCallback, type ReactNode } from "react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Play, Pause, RotateCcw, Volume2, VolumeX } from "lucide-react";
import { useLanguage } from "@/contexts/LanguageContext";

interface BgmItem {
  id: string;
  url: string;
  name: string;
  duration?: number;
}

interface StudioPreviewDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Editor canvas pixel size (zones use %, overlays use px relative to this). */
  editorW: number;
  editorH: number;
  /** Project resolution (for label). */
  resolutionLabel?: string;
  /** Total project duration in seconds (max of zone/overlay/bgm timelines, fallback 30). */
  totalDurationSec: number;
  /** BGM playlist (audio playback only — does not affect visual timing). */
  bgmItems: BgmItem[];
  bgmVolume: number;
  bgmAudioSource: string; // "bgm" plays the playlist, "mute" silences, others = use video sound (skipped here)
  /** Render the stage content with the current playing state so carousels can pause their timers. */
  renderStage: (playing: boolean) => ReactNode;
}

export function StudioPreviewDialog({
  open,
  onOpenChange,
  editorW,
  editorH,
  resolutionLabel,
  totalDurationSec,
  bgmItems,
  bgmVolume,
  bgmAudioSource,
  renderStage,
}: StudioPreviewDialogProps) {
  const { t } = useLanguage();
  const totalSec = Math.max(1, Math.round(totalDurationSec || 30));

  const [playing, setPlaying] = useState(true);
  const [elapsed, setElapsed] = useState(0); // seconds
  const [runKey, setRunKey] = useState(0); // increment to remount stage
  const [muteAll, setMuteAll] = useState(false);

  const stageRef = useRef<HTMLDivElement>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [bgmIdx, setBgmIdx] = useState(0);

  // Reset on open
  useEffect(() => {
    if (open) {
      setElapsed(0);
      setPlaying(true);
      setRunKey((k) => k + 1);
      setBgmIdx(0);
    }
  }, [open]);

  // Stage container fit: scale editorW × editorH to fit available area
  const stageWrapRef = useRef<HTMLDivElement>(null);
  const [stageScale, setStageScale] = useState(1);
  useEffect(() => {
    if (!open) return;
    const el = stageWrapRef.current;
    if (!el || !editorW || !editorH) return;
    const compute = () => {
      const r = el.getBoundingClientRect();
      const sx = r.width / editorW;
      const sy = r.height / editorH;
      setStageScale(Math.max(0.05, Math.min(sx, sy)));
    };
    compute();
    const ro = new ResizeObserver(compute);
    ro.observe(el);
    return () => ro.disconnect();
  }, [open, editorW, editorH]);

  // Elapsed counter (rAF)
  useEffect(() => {
    if (!open || !playing) return;
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = (now - last) / 1000;
      last = now;
      setElapsed((e) => {
        const next = e + dt;
        if (next >= totalSec) {
          // Play once then stop at the end
          setPlaying(false);
          return totalSec;
        }
        return next;
      });
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [open, playing, totalSec]);

  // Pause/resume all media inside the stage when playing toggles
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const vids = Array.from(stage.querySelectorAll<HTMLVideoElement>("video"));
    const auds = Array.from(stage.querySelectorAll<HTMLAudioElement>("audio"));
    if (playing) {
      vids.forEach((v) => {
        v.muted = muteAll || (v.dataset.naturalMuted === "1");
        const vol = parseFloat(v.dataset.volume ?? "1");
        if (!isNaN(vol)) v.volume = Math.max(0, Math.min(1, vol));
        v.play().catch(() => {});
      });
      auds.forEach((a) => { a.muted = muteAll; a.play().catch(() => {}); });
    } else {
      vids.forEach((v) => { try { v.pause(); } catch { /* ignore */ } });
      auds.forEach((a) => { try { a.pause(); } catch { /* ignore */ } });
    }
  }, [playing, runKey, muteAll]);

  // Detect if any video in the stage is currently playing with audible sound
  const [videoAudioActive, setVideoAudioActive] = useState(false);
  useEffect(() => {
    if (!open) return;
    const stage = stageRef.current;
    if (!stage) return;
    const check = () => {
      const vids = Array.from(stage.querySelectorAll<HTMLVideoElement>("video"));
      const active = vids.some(
        (v) => !v.paused && !v.ended && !v.muted && v.volume > 0 && v.readyState >= 2,
      );
      setVideoAudioActive(active);
    };
    check();
    const id = window.setInterval(check, 250);
    return () => window.clearInterval(id);
  }, [open, runKey, playing, muteAll]);

  // BGM audio playlist — fade-duck when a video with sound is playing
  const fadeRafRef = useRef<number | null>(null);
  const fadeBgmTo = useCallback((target: number, durationMs: number, onDone?: () => void) => {
    const el = audioRef.current;
    if (!el) return;
    if (fadeRafRef.current) cancelAnimationFrame(fadeRafRef.current);
    const start = el.volume;
    const startTs = performance.now();
    const step = (now: number) => {
      const t = Math.min(1, (now - startTs) / Math.max(1, durationMs));
      el.volume = Math.max(0, Math.min(1, start + (target - start) * t));
      if (t < 1) {
        fadeRafRef.current = requestAnimationFrame(step);
      } else {
        fadeRafRef.current = null;
        onDone?.();
      }
    };
    fadeRafRef.current = requestAnimationFrame(step);
  }, []);

  useEffect(() => {
    if (!open) return;
    if (bgmAudioSource !== "bgm" || bgmItems.length === 0) {
      // tear down — cancel any running fade first so it can't revive the audio
      if (fadeRafRef.current) { cancelAnimationFrame(fadeRafRef.current); fadeRafRef.current = null; }
      if (audioRef.current) { try { audioRef.current.pause(); } catch { /* ignore */ } audioRef.current = null; }
      return;
    }
    let el = audioRef.current;
    const isFirstInit = !el;
    if (!el) {
      el = new Audio();
      el.preload = "auto";
      el.volume = 0; // start silent so we can fade in
      audioRef.current = el;
      el.addEventListener("ended", () => {
        setBgmIdx((i) => (bgmItems.length > 0 ? (i + 1) % bgmItems.length : 0));
      });
    }
    const cur = bgmItems[bgmIdx % bgmItems.length];
    const srcChanged = !!cur && el.src !== cur.url;
    if (cur && srcChanged) {
      el.src = cur.url;
    }
    const targetVol = Math.max(0, Math.min(1, (bgmVolume || 0) / 100));
    el.muted = muteAll;

    const shouldPlay = playing && !muteAll;
    const shouldDuck = videoAudioActive;

    if (shouldPlay) {
      // Ensure playback is running, then fade volume to target
      const ensurePlay = () => { el!.play().catch(() => {}); };
      if (shouldDuck) {
        // Fade out to 0 over 500ms, then pause
        fadeBgmTo(0, 500, () => { try { el!.pause(); } catch { /* ignore */ } });
      } else {
        if (el.paused) ensurePlay();
        fadeBgmTo(targetVol, isFirstInit ? 500 : 500);
      }
    } else {
      // Paused or muted: stop any fade and pause immediately
      if (fadeRafRef.current) { cancelAnimationFrame(fadeRafRef.current); fadeRafRef.current = null; }
      try { el.pause(); } catch { /* ignore */ }
    }
    return () => { /* keep element */ };
  }, [open, bgmAudioSource, bgmItems, bgmIdx, bgmVolume, playing, muteAll, videoAudioActive, fadeBgmTo]);

  // On Restart (runKey changes), rewind BGM to the beginning of the current track.
  useEffect(() => {
    if (!open) return;
    const el = audioRef.current;
    if (!el) return;
    try { el.currentTime = 0; } catch { /* ignore */ }
  }, [runKey, open]);

  // Cleanup on close
  useEffect(() => {
    if (!open && audioRef.current) {
      try { audioRef.current.pause(); } catch { /* ignore */ }
      audioRef.current = null;
    }
  }, [open]);

  const fmt = useCallback((s: number) => {
    const total = Math.max(0, Math.round(s));
    const m = Math.floor(total / 60);
    const sec = total % 60;
    return `${m}:${sec.toString().padStart(2, "0")}`;
  }, []);

  const handleSeek = useCallback((v: number[]) => {
    setElapsed(Math.max(0, Math.min(totalSec, v[0])));
  }, [totalSec]);

  const handleRestart = useCallback(() => {
    setElapsed(0);
    setBgmIdx(0);
    setRunKey((k) => k + 1);
    setPlaying(true);
  }, []);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-[min(96vw,1400px)] w-[96vw] h-[92vh] p-0 gap-0 bg-background border-border overflow-hidden flex flex-col"
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        {/* Header */}
        <div className="shrink-0 flex items-center justify-between px-4 py-2 border-b border-border bg-card">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold">{t("studioPreviewTitle")}</span>
            {resolutionLabel && (
              <span className="text-[11px] text-muted-foreground tabular-nums">{resolutionLabel}</span>
            )}
          </div>
        </div>

        {/* Stage area */}
        <div className="flex-1 min-h-0 bg-black flex items-center justify-center overflow-hidden p-4">
          <div ref={stageWrapRef} className="w-full h-full flex items-center justify-center">
            {editorW > 0 && editorH > 0 && (
              <div
                ref={stageRef}
                key={runKey}
                className="relative shadow-2xl"
                style={{
                  width: editorW,
                  height: editorH,
                  transform: `scale(${stageScale})`,
                  transformOrigin: "center center",
                  background: "hsl(0 0% 0%)",
                }}
              >
                {renderStage(playing)}
              </div>
            )}
          </div>
        </div>

        {/* Controls */}
        <div className="shrink-0 px-4 py-3 border-t border-border bg-card space-y-2">
          <div className="flex items-center gap-3">
            <Button
              variant="ghost"
              size="icon"
              className="h-9 w-9"
              onClick={() => {
                // If playback already ended, treat Play as Restart-from-beginning
                if (!playing && elapsed >= totalSec) {
                  handleRestart();
                } else {
                  setPlaying((p) => !p);
                }
              }}
              title={playing ? t("studioPreviewPause") : t("studioPreviewPlay")}
            >
              {playing ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
            </Button>
            <Button variant="ghost" size="icon" className="h-9 w-9" onClick={handleRestart} title={t("studioPreviewRestart")}>
              <RotateCcw className="w-4 h-4" />
            </Button>
            <span className="text-xs font-mono tabular-nums text-muted-foreground min-w-[80px]">
              {fmt(elapsed)} / {fmt(totalSec)}
            </span>
            <div className="flex-1">
              <Slider
                value={[Math.min(elapsed, totalSec)]}
                min={0}
                max={totalSec}
                step={0.1}
                onValueChange={handleSeek}
              />
            </div>
            <Button variant="ghost" size="icon" className="h-9 w-9" onClick={() => setMuteAll((m) => !m)} title={muteAll ? t("studioPreviewUnmute") : t("studioPreviewMute")}>
              {muteAll ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
            </Button>
          </div>
          <p className="text-[10px] text-muted-foreground leading-tight">
            {t("studioPreviewHint")}
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
