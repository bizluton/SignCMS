/**
 * QueueDisplayWidget — full-screen or overlay display of the currently-called
 * ticket number.  Subscribes to Supabase Realtime so the number updates the
 * moment a counter operator calls next.
 *
 * TTS (Web Speech API) is activated on the first user click to satisfy
 * browser autoplay policies.  After that every new "calling" ticket is
 * announced automatically.
 */
import { useState, useEffect, useRef, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Volume2, VolumeX, Users } from "lucide-react";
import { Button } from "@/components/ui/button";

// ── Types ─────────────────────────────────────────────────────────────────────

interface Queue {
  id: string;
  queue_name: string;
  prefix: string;
  current_number: number;
}

interface Ticket {
  id: string;
  queue_id: string;
  number: number;
  status: string;
  counter_name: string;
  called_at: string | null;
}

export interface QueueDisplayConfig {
  orgId: string;
  /** If set, only show queues belonging to this team */
  teamId?: string;
  /** If set, override teamId and only show these specific queues */
  queueIds?: string[];
  /** e.g. "zh-TW", "en-US", "ja-JP" */
  ttsLang?: string;
  /** Seconds between cycles when showing multiple queues (default 8) */
  cycleSeconds?: number;
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function QueueDisplayWidget({ config }: { config: QueueDisplayConfig }) {
  const { orgId, teamId, queueIds, ttsLang = "zh-TW", cycleSeconds = 8 } = config;

  const [queues, setQueues] = useState<Queue[]>([]);
  const [activeIdx, setActiveIdx] = useState(0);
  const [latestTicket, setLatestTicket] = useState<Ticket | null>(null);
  const [ttsEnabled, setTtsEnabled] = useState(false);
  const [loading, setLoading] = useState(true);

  const ttsEnabledRef = useRef(false);
  const announcedRef = useRef<Set<string>>(new Set());
  const cycleTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Load queues ────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!orgId) return;
    let q = supabase
      .from("queue_system_queues")
      .select("id, queue_name, prefix, current_number")
      .eq("org_id", orgId)
      .order("created_at");

    // Priority: explicit queueIds > teamId > all org queues
    if (queueIds && queueIds.length > 0) {
      q = q.in("id", queueIds);
    } else if (teamId) {
      q = q.eq("team_id", teamId);
    }

    q.then(({ data }) => {
      setQueues(data ?? []);
      setLoading(false);
    });
  }, [orgId, teamId, queueIds]);

  // ── Active queue ──────────────────────────────────────────────────────────
  const activeQueue = queues[activeIdx] ?? null;

  // ── Cycle timer (multi-queue) ─────────────────────────────────────────────
  useEffect(() => {
    if (queues.length <= 1) return;
    cycleTimerRef.current = setInterval(
      () => setActiveIdx((i) => (i + 1) % queues.length),
      cycleSeconds * 1000,
    );
    return () => {
      if (cycleTimerRef.current) clearInterval(cycleTimerRef.current);
    };
  }, [queues.length, cycleSeconds]);

  // ── TTS helper ────────────────────────────────────────────────────────────
  const speak = useCallback(
    (text: string) => {
      if (!ttsEnabledRef.current) return;
      if (!("speechSynthesis" in window)) return;
      window.speechSynthesis.cancel();
      const utt = new SpeechSynthesisUtterance(text);
      utt.lang = ttsLang;
      utt.rate = 0.9;
      window.speechSynthesis.speak(utt);
    },
    [ttsLang],
  );

  // ── Realtime: queue current_number changes ────────────────────────────────
  useEffect(() => {
    if (!activeQueue) return;

    // Initial latest calling ticket
    supabase
      .from("queue_system_tickets")
      .select("*")
      .eq("queue_id", activeQueue.id)
      .eq("status", "calling")
      .order("called_at", { ascending: false })
      .limit(1)
      .then(({ data }) => {
        if (data?.[0]) setLatestTicket(data[0] as Ticket);
      });

    const channel = supabase
      .channel(`qs-display-${activeQueue.id}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "queue_system_queues", filter: `id=eq.${activeQueue.id}` },
        (payload) => {
          setQueues((prev) =>
            prev.map((q) =>
              q.id === activeQueue.id
                ? { ...q, current_number: (payload.new as Queue).current_number }
                : q,
            ),
          );
        },
      )
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "queue_system_tickets", filter: `queue_id=eq.${activeQueue.id}` },
        (payload) => {
          const ticket = payload.new as Ticket;
          if (ticket.status !== "calling") return;
          setLatestTicket(ticket);

          if (!announcedRef.current.has(ticket.id)) {
            announcedRef.current.add(ticket.id);
            const prefix = activeQueue.prefix ?? "";
            const numStr = String(ticket.number).padStart(3, "0");
            const counter = ticket.counter_name;
            const ttsText =
              ttsLang.startsWith("zh")
                ? `請 ${prefix}${numStr} 號，到 ${counter || "服務台"}`
                : ttsLang.startsWith("ja")
                  ? `${prefix}${numStr}番のお客様、${counter || "カウンター"}へどうぞ`
                  : `Now serving ${prefix}${numStr} at ${counter || "the counter"}`;
            speak(ttsText);
          }
        },
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "queue_system_tickets", filter: `queue_id=eq.${activeQueue.id}` },
        (payload) => {
          const ticket = payload.new as Ticket;
          if (ticket.status !== "calling") return;
          setLatestTicket(ticket);

          if (!announcedRef.current.has(ticket.id)) {
            announcedRef.current.add(ticket.id);
            const prefix = activeQueue.prefix ?? "";
            const numStr = String(ticket.number).padStart(3, "0");
            const counter = ticket.counter_name;
            const ttsText =
              ttsLang.startsWith("zh")
                ? `請 ${prefix}${numStr} 號，到 ${counter || "服務台"}`
                : ttsLang.startsWith("ja")
                  ? `${prefix}${numStr}番のお客様、${counter || "カウンター"}へどうぞ`
                  : `Now serving ${prefix}${numStr} at ${counter || "the counter"}`;
            speak(ttsText);
          }
        },
      )
      .subscribe();

    return () => { void supabase.removeChannel(channel); };
    // activeQueue?.id is the meaningful change trigger; the full object reference
    // changes on every render so we only track the id to avoid repeated re-subscriptions.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeQueue?.id, speak, ttsLang]);

  // ── Enable TTS on first click ─────────────────────────────────────────────
  const handleEnableTts = () => {
    ttsEnabledRef.current = true;
    setTtsEnabled(true);
    // Warm up the speech engine
    if ("speechSynthesis" in window) {
      const warmup = new SpeechSynthesisUtterance(" ");
      warmup.volume = 0;
      window.speechSynthesis.speak(warmup);
    }
  };

  // ── Render ────────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-gray-950 text-white/40 text-lg">
        Loading…
      </div>
    );
  }

  if (queues.length === 0) {
    return (
      <div className="flex h-full w-full flex-col items-center justify-center gap-4 bg-gray-950 text-white/40">
        <Users className="h-16 w-16 opacity-30" />
        <p className="text-xl">尚無排隊隊列</p>
      </div>
    );
  }

  const prefix = activeQueue?.prefix ?? "";
  const number = latestTicket?.number ?? activeQueue?.current_number ?? 0;
  const displayNumber = number > 0 ? `${prefix}${String(number).padStart(3, "0")}` : "—";
  const counter = latestTicket?.counter_name ?? "";

  return (
    <div className="relative flex h-full w-full flex-col items-center justify-center overflow-hidden bg-gray-950 select-none">
      {/* Background gradient */}
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-blue-900/30 via-transparent to-cyan-900/20" />

      {/* Queue label */}
      <p className="relative z-10 mb-4 text-lg font-medium tracking-widest text-white/50 uppercase">
        {activeQueue?.queue_name ?? ""}
      </p>

      {/* Big number */}
      <div className="relative z-10 flex items-baseline gap-2">
        <span className="font-black tabular-nums tracking-tight text-white"
              style={{ fontSize: "clamp(5rem, 20vw, 14rem)", lineHeight: 1 }}>
          {displayNumber}
        </span>
      </div>

      {/* Counter label */}
      {counter && (
        <p className="relative z-10 mt-6 text-2xl font-semibold text-white/60">
          {ttsLang.startsWith("zh") ? `${counter}` : counter}
        </p>
      )}

      {/* Multi-queue dots */}
      {queues.length > 1 && (
        <div className="relative z-10 mt-8 flex gap-2">
          {queues.map((q, i) => (
            <button
              key={q.id}
              onClick={() => setActiveIdx(i)}
              className={`h-2 rounded-full transition-all ${i === activeIdx ? "w-6 bg-white" : "w-2 bg-white/30"}`}
            />
          ))}
        </div>
      )}

      {/* TTS toggle */}
      <div className="absolute bottom-4 right-4 z-10">
        {ttsEnabled ? (
          <Button
            size="icon"
            variant="ghost"
            className="text-white/40 hover:text-white/80"
            onClick={() => { ttsEnabledRef.current = false; setTtsEnabled(false); }}
            title="關閉語音播報"
          >
            <Volume2 className="h-5 w-5" />
          </Button>
        ) : (
          <Button
            size="sm"
            className="bg-white/10 text-white hover:bg-white/20 border border-white/20 text-xs gap-1.5"
            onClick={handleEnableTts}
          >
            <VolumeX className="h-4 w-4" />
            點擊啟用語音
          </Button>
        )}
      </div>
    </div>
  );
}
