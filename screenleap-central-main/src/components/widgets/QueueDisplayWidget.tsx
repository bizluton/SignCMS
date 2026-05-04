/**
 * QueueDisplayWidget — full-screen or overlay display of the currently-called
 * ticket number.  Subscribes to Supabase Realtime so the number updates the
 * moment a counter operator calls next.
 *
 * Multi-counter mode (counterNames.length > 1):
 *   - Trigger priority: when any selected counter calls next, immediately show
 *     that counter's number for `cycleSeconds`, then resume rotation.
 *   - Fallback rotation: cycle through each counter's latest number.
 *
 * TTS (Web Speech API) is activated on the first user click to satisfy
 * browser autoplay policies.  After that every new "calling" ticket is
 * announced automatically.
 */
import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useActiveOrg } from "@/contexts/ActiveOrgContext";
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
  /** If set, only show tickets whose counter_name is in this list */
  counterNames?: string[];
  /** e.g. "zh-TW", "en-US", "ja-JP" */
  ttsLang?: string;
  /** Seconds between cycles when showing multiple queues/counters (default 8) */
  cycleSeconds?: number;
  /** Background color, or "transparent" for no background (default dark) */
  bgColor?: string;
  /** Main number color (default #ffffff) */
  textColor?: string;
  /** Font size of the main number as a cqi percentage (default 16) */
  numSize?: number;
  /** Queue/counter name label color (default white/50) */
  labelColor?: string;
  /** Queue/counter name label font size as cqi % (default 2.5) */
  labelSize?: number;
  /** Counter-name-below-number font size as cqi % (default 3) */
  subLabelSize?: number;
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function QueueDisplayWidget({ config }: { config: QueueDisplayConfig }) {
  const { activeOrgId } = useActiveOrg();
  const { teamId, queueIds, counterNames, ttsLang = "zh-TW", cycleSeconds = 8,
          bgColor, textColor, numSize = 16,
          labelColor, labelSize = 2.5, subLabelSize = 3 } = config;
  // Fallback to active org when config.orgId not yet persisted
  const orgId = config.orgId || activeOrgId || "";

  const isMultiCounter = !!counterNames && counterNames.length > 1;
  const hasSingleCounter = !!counterNames && counterNames.length === 1;
  // Stable key for effect deps (avoids re-subscribe on every render)
  const counterNamesKey = counterNames?.join(",") ?? "";

  // ── Shared state ──────────────────────────────────────────────────────────
  const [queues, setQueues]       = useState<Queue[]>([]);
  const [loading, setLoading]     = useState(true);
  const [ttsEnabled, setTtsEnabled] = useState(false);
  const ttsEnabledRef             = useRef(false);
  const announcedRef              = useRef<Set<string>>(new Set());

  // ── Single-counter / no-filter mode state ─────────────────────────────────
  const [activeIdx, setActiveIdx]         = useState(0);
  const [latestTicket, setLatestTicket]   = useState<Ticket | null>(null);
  const queueCycleRef                     = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Multi-counter mode state ───────────────────────────────────────────────
  const [ticketByCounter, setTicketByCounter] = useState<Record<string, Ticket>>({});
  const [triggeredCounter, setTriggeredCounter] = useState<string | null>(null);
  const [counterCycleIdx, setCounterCycleIdx]   = useState(0);
  const triggerTimerRef  = useRef<ReturnType<typeof setTimeout> | null>(null);
  const counterCycleRef  = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Load queues ────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!orgId) return;
    let q = supabase
      .from("queue_system_queues")
      .select("id, queue_name, prefix, current_number")
      .eq("org_id", orgId)
      .order("created_at");

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

  const activeQueue = queues[activeIdx] ?? null;
  const queueIdSet  = useMemo(() => new Set(queues.map((q) => q.id)), [queues]);

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

  const announcedTicket = useCallback(
    (ticket: Ticket, prefix: string) => {
      if (announcedRef.current.has(ticket.id)) return;
      announcedRef.current.add(ticket.id);
      const numStr  = String(ticket.number).padStart(3, "0");
      const counter = ticket.counter_name;
      const text =
        ttsLang.startsWith("zh")
          ? `請 ${prefix}${numStr} 號，到 ${counter || "服務台"}`
          : ttsLang.startsWith("ja")
            ? `${prefix}${numStr}番のお客様、${counter || "カウンター"}へどうぞ`
            : `Now serving ${prefix}${numStr} at ${counter || "the counter"}`;
      speak(text);
    },
    [speak, ttsLang],
  );

  // ── SINGLE / NO FILTER MODE ───────────────────────────────────────────────

  // Queue cycle timer
  useEffect(() => {
    if (isMultiCounter || queues.length <= 1) return;
    queueCycleRef.current = setInterval(
      () => setActiveIdx((i) => (i + 1) % queues.length),
      cycleSeconds * 1000,
    );
    return () => { if (queueCycleRef.current) clearInterval(queueCycleRef.current); };
  }, [isMultiCounter, queues.length, cycleSeconds]);

  // Realtime per-active-queue subscription (single/no-filter mode)
  useEffect(() => {
    if (isMultiCounter || !activeQueue) return;

    let initQ = supabase
      .from("queue_system_tickets")
      .select("*")
      .eq("queue_id", activeQueue.id)
      .eq("status", "calling")
      .order("called_at", { ascending: false })
      .limit(1);
    if (hasSingleCounter) initQ = (initQ as typeof initQ).eq("counter_name", counterNames![0]);
    initQ.then(({ data }) => { if (data?.[0]) setLatestTicket(data[0] as Ticket); });

    const channel = supabase
      .channel(`qs-display-${activeQueue.id}`)
      .on("postgres_changes",
        { event: "UPDATE", schema: "public", table: "queue_system_queues", filter: `id=eq.${activeQueue.id}` },
        (payload) => {
          setQueues((prev) =>
            prev.map((q) => q.id === activeQueue.id
              ? { ...q, current_number: (payload.new as Queue).current_number }
              : q),
          );
        },
      )
      .on("postgres_changes",
        { event: "INSERT", schema: "public", table: "queue_system_tickets", filter: `queue_id=eq.${activeQueue.id}` },
        (payload) => {
          const ticket = payload.new as Ticket;
          if (ticket.status !== "calling") return;
          if (hasSingleCounter && ticket.counter_name !== counterNames![0]) return;
          setLatestTicket(ticket);
          announcedTicket(ticket, activeQueue.prefix ?? "");
        },
      )
      .on("postgres_changes",
        { event: "UPDATE", schema: "public", table: "queue_system_tickets", filter: `queue_id=eq.${activeQueue.id}` },
        (payload) => {
          const ticket = payload.new as Ticket;
          if (ticket.status !== "calling") return;
          if (hasSingleCounter && ticket.counter_name !== counterNames![0]) return;
          setLatestTicket(ticket);
          announcedTicket(ticket, activeQueue.prefix ?? "");
        },
      )
      .subscribe();

    return () => { void supabase.removeChannel(channel); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeQueue?.id, isMultiCounter, hasSingleCounter, counterNamesKey, announcedTicket]);

  // ── MULTI-COUNTER MODE ────────────────────────────────────────────────────

  // Counter rotation (runs only when no trigger is active)
  useEffect(() => {
    if (!isMultiCounter || triggeredCounter) return;
    counterCycleRef.current = setInterval(
      () => setCounterCycleIdx((i) => (i + 1) % counterNames!.length),
      cycleSeconds * 1000,
    );
    return () => { if (counterCycleRef.current) clearInterval(counterCycleRef.current); };
  }, [isMultiCounter, triggeredCounter, counterNames?.length, cycleSeconds]);

  // Initial load + Realtime for all queues (multi-counter mode)
  useEffect(() => {
    if (!isMultiCounter || queues.length === 0) return;

    const qIds = [...queueIdSet];

    // Load latest calling ticket per counter
    void supabase
      .from("queue_system_tickets")
      .select("*")
      .in("queue_id", qIds)
      .eq("status", "calling")
      .in("counter_name", counterNames!)
      .order("called_at", { ascending: false })
      .limit(counterNames!.length * 5)
      .then(({ data }) => {
        const map: Record<string, Ticket> = {};
        for (const t of data ?? []) {
          if (!map[t.counter_name]) map[t.counter_name] = t as Ticket;
        }
        setTicketByCounter(map);
      });

    const onTicket = (ticket: Ticket) => {
      if (!queueIdSet.has(ticket.queue_id)) return;
      if (ticket.status !== "calling") return;
      if (!counterNames!.includes(ticket.counter_name)) return;

      // Update per-counter map
      setTicketByCounter((prev) => ({ ...prev, [ticket.counter_name]: ticket }));

      // Trigger priority: show this counter immediately for cycleSeconds
      setTriggeredCounter(ticket.counter_name);
      if (triggerTimerRef.current) clearTimeout(triggerTimerRef.current);
      triggerTimerRef.current = setTimeout(() => {
        setTriggeredCounter(null);
      }, cycleSeconds * 1000);

      // Find prefix for this ticket's queue
      const qInfo = queues.find((q) => q.id === ticket.queue_id);
      announcedTicket(ticket, qInfo?.prefix ?? "");
    };

    const channel = supabase
      .channel("qs-display-multi-counter")
      .on("postgres_changes",
        { event: "INSERT", schema: "public", table: "queue_system_tickets" },
        (payload) => onTicket(payload.new as Ticket),
      )
      .on("postgres_changes",
        { event: "UPDATE", schema: "public", table: "queue_system_tickets" },
        (payload) => onTicket(payload.new as Ticket),
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
      if (triggerTimerRef.current) clearTimeout(triggerTimerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isMultiCounter, queues, counterNamesKey, cycleSeconds, announcedTicket]);

  // ── Enable TTS on first click ─────────────────────────────────────────────
  const handleEnableTts = () => {
    ttsEnabledRef.current = true;
    setTtsEnabled(true);
    if ("speechSynthesis" in window) {
      const warmup = new SpeechSynthesisUtterance(" ");
      warmup.volume = 0;
      window.speechSynthesis.speak(warmup);
    }
  };

  // ── Derive display values ─────────────────────────────────────────────────
  const displayCounter = isMultiCounter
    ? (triggeredCounter ?? counterNames![counterCycleIdx % counterNames!.length])
    : null;

  const displayTicket = isMultiCounter
    ? (ticketByCounter[displayCounter!] ?? null)
    : latestTicket;

  // For prefix: in multi-counter mode, find the queue of the displayed ticket
  const displayQueue = isMultiCounter
    ? (queues.find((q) => q.id === displayTicket?.queue_id) ?? activeQueue)
    : activeQueue;

  const prefix        = displayQueue?.prefix ?? "";
  const number        = displayTicket?.number ?? (isMultiCounter ? 0 : (activeQueue?.current_number ?? 0));
  const displayNumber = number > 0 ? `${prefix}${String(number).padStart(3, "0")}` : "—";
  const counterLabel  = isMultiCounter ? (displayCounter ?? "") : (displayTicket?.counter_name ?? "");

  // Dots: multi-counter → counter dots; single mode → queue dots
  const dots = isMultiCounter ? counterNames! : queues.map((q) => q.queue_name);
  const dotIdx = isMultiCounter
    ? counterNames!.indexOf(displayCounter ?? "")
    : activeIdx;

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

  return (
    <div
      className="relative flex h-full w-full flex-col items-center justify-center overflow-hidden select-none"
      style={{
        containerType: "inline-size",
        background: bgColor === "transparent" ? "transparent" : (bgColor ?? "rgb(3,7,18)"),
      }}
    >
      {/* Background gradient — pulses amber when triggered */}
      <div className={`pointer-events-none absolute inset-0 transition-all duration-700 ${
        triggeredCounter
          ? "bg-gradient-to-br from-amber-900/40 via-transparent to-orange-900/30"
          : "bg-gradient-to-br from-blue-900/30 via-transparent to-cyan-900/20"
      }`} />

      {/* Queue / counter label */}
      <p
        className="relative z-10 font-medium tracking-widest uppercase"
        style={{
          fontSize: `clamp(0.45rem, ${labelSize}cqi, 2rem)`,
          marginBottom: "clamp(0.2rem, 1.5cqi, 1rem)",
          color: labelColor || "rgba(255,255,255,0.5)",
        }}
      >
        {isMultiCounter ? (displayCounter ?? "") : (displayQueue?.queue_name ?? "")}
      </p>

      {/* Big number */}
      <div className="relative z-10 flex items-baseline">
        <span
          className="font-black tabular-nums tracking-tight"
          style={{ fontSize: `clamp(2rem, ${numSize}cqi, 20rem)`, lineHeight: 1, color: textColor || "#ffffff" }}
        >
          {displayNumber}
        </span>
      </div>

      {/* Counter label (single/no-filter mode) */}
      {!isMultiCounter && counterLabel && (
        <p
          className="relative z-10 font-semibold"
          style={{
            fontSize: `clamp(0.6rem, ${subLabelSize}cqi, 3rem)`,
            marginTop: "clamp(0.25rem, 1.5cqi, 1.5rem)",
            color: labelColor || "rgba(255,255,255,0.6)",
          }}
        >
          {counterLabel}
        </p>
      )}

      {/* Dots */}
      {dots.length > 1 && (
        <div
          className="relative z-10 flex"
          style={{ gap: "clamp(3px, 0.6cqi, 8px)", marginTop: "clamp(0.4rem, 2cqi, 2rem)" }}
        >
          {dots.map((d, i) => (
            <button
              key={d}
              onClick={() => isMultiCounter ? setCounterCycleIdx(i) : setActiveIdx(i)}
              className={`rounded-full transition-all ${i === dotIdx ? "bg-white" : "bg-white/30"}`}
              style={{
                height: "clamp(3px, 0.6cqi, 8px)",
                width: i === dotIdx ? "clamp(10px, 2.2cqi, 24px)" : "clamp(3px, 0.6cqi, 8px)",
              }}
            />
          ))}
        </div>
      )}

      {/* TTS toggle */}
      <div
        className="absolute z-10"
        style={{ bottom: "clamp(3px, 1.2cqi, 16px)", right: "clamp(3px, 1.2cqi, 16px)" }}
      >
        {ttsEnabled ? (
          <Button
            size="icon"
            variant="ghost"
            className="text-white/40 hover:text-white/80"
            style={{ width: "clamp(20px, 2.8cqi, 40px)", height: "clamp(20px, 2.8cqi, 40px)" }}
            onClick={() => { ttsEnabledRef.current = false; setTtsEnabled(false); }}
            title="關閉語音播報"
          >
            <Volume2 style={{ width: "clamp(10px, 1.6cqi, 20px)", height: "clamp(10px, 1.6cqi, 20px)" }} />
          </Button>
        ) : (
          <Button
            size="sm"
            className="bg-white/10 text-white hover:bg-white/20 border border-white/20 gap-1"
            style={{ fontSize: "clamp(0.4rem, 1.3cqi, 0.75rem)", padding: "clamp(2px, 0.5cqi, 6px) clamp(4px, 1cqi, 12px)" }}
            onClick={handleEnableTts}
          >
            <VolumeX style={{ width: "clamp(8px, 1.4cqi, 16px)", height: "clamp(8px, 1.4cqi, 16px)" }} />
            點擊啟用語音
          </Button>
        )}
      </div>
    </div>
  );
}
