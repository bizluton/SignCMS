/**
 * MeetingRoomWidget — full-screen door-display for a single meeting room.
 * Calls the BizBooking Go backend directly.  Auto-refreshes every
 * `refreshSeconds` and keeps a 1-second countdown clock.
 *
 * API endpoints used:
 *   GET  {apiUrl}/api/v1/meeting-rooms          → Room[]
 *   GET  {apiUrl}/api/v1/events?date=YYYY-MM-DD → Event[]
 *   POST {apiUrl}/api/v1/events/:id/check-in    → check-in
 *   POST {apiUrl}/api/v1/events/:id/end-early   → end early
 */
import { useState, useEffect, useCallback } from "react";
import { DoorOpen, CheckCircle, XCircle, CalendarClock } from "lucide-react";

// ── Types ──────────────────────────────────────────────────────────────────────

interface BizRoom {
  id: string;
  calendar_id: string;
  resource_name: string;
  display_name?: string;
  name?: string;
  capacity: number;
  building?: string;
  floor?: string;
  is_active: boolean;
}

interface BizEvent {
  id: string;
  calendar_id: string;
  summary: string;
  organizer_email: string;
  start_at: string;
  end_at: string;
  status: string;
  checked_in_at: string | null;
  ended_early_at: string | null;
}

export interface MeetingRoomConfig {
  apiUrl: string;
  calendarId: string;
  lang?: "zh-TW" | "en-US";
  showTimeline?: boolean;
  refreshSeconds?: number;
  bgColor?: string;
  textColor?: string;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function fmtTime(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function fmtCountdown(ms: number): string {
  const secs = Math.floor(ms / 1000);
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = secs % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

// ── Component ──────────────────────────────────────────────────────────────────

export default function MeetingRoomWidget({ config }: { config: MeetingRoomConfig }) {
  const {
    apiUrl,
    calendarId,
    lang = "zh-TW",
    showTimeline = true,
    refreshSeconds = 30,
    bgColor,
    textColor = "#ffffff",
  } = config;

  const isZh = lang.startsWith("zh");

  const [room, setRoom]     = useState<BizRoom | null>(null);
  const [events, setEvents] = useState<BizEvent[]>([]);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState<string | null>(null);
  const [now, setNow]           = useState(() => new Date());

  // 1-second clock
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  // Fetch rooms + today's events
  const fetchData = useCallback(async () => {
    if (!apiUrl || !calendarId) { setLoading(false); return; }
    const dateStr = new Date().toISOString().slice(0, 10);
    try {
      const [rRes, eRes] = await Promise.all([
        fetch(`${apiUrl}/api/v1/meeting-rooms`),
        fetch(`${apiUrl}/api/v1/events?date=${dateStr}`),
      ]);
      if (!rRes.ok || !eRes.ok) throw new Error("API error");
      const rooms: BizRoom[]  = (await rRes.json()) as BizRoom[];
      const evts: BizEvent[]  = (await eRes.json()) as BizEvent[];
      setRoom(rooms.find((r) => r.calendar_id === calendarId) ?? null);
      setEvents(evts.filter((e) => e.calendar_id === calendarId));
      setError(null);
    } catch {
      setError(isZh ? "無法連線到 BizBooking 伺服器" : "Cannot reach BizBooking server");
    } finally {
      setLoading(false);
    }
  }, [apiUrl, calendarId, isZh]);

  useEffect(() => {
    void fetchData();
    const id = setInterval(() => void fetchData(), refreshSeconds * 1000);
    return () => clearInterval(id);
  }, [fetchData, refreshSeconds]);

  // ── Derive display values ──────────────────────────────────────────────────
  const nowTs = now.getTime();
  const sorted = [...events].sort(
    (a, b) => new Date(a.start_at).getTime() - new Date(b.start_at).getTime(),
  );

  const current = sorted.find((e) => {
    const s = new Date(e.start_at).getTime();
    const end = new Date(e.end_at).getTime();
    return s <= nowTs && end > nowTs;
  }) ?? null;

  const upcoming = sorted.filter((e) => new Date(e.start_at).getTime() > nowTs).slice(0, 3);

  const status: "available" | "in-meeting" | "starting-soon" =
    current ? "in-meeting"
    : upcoming[0] && (new Date(upcoming[0].start_at).getTime() - nowTs) < 15 * 60_000
    ? "starting-soon"
    : "available";

  const remaining = current ? Math.max(0, new Date(current.end_at).getTime() - nowTs) : 0;

  const statusColor = status === "in-meeting" ? "#ef4444"
    : status === "starting-soon" ? "#f59e0b"
    : "#10b981";

  const statusLabel = {
    available:     isZh ? "空閒" : "Available",
    "in-meeting":  isZh ? "使用中" : "In Meeting",
    "starting-soon": isZh ? "即將開始" : "Starting Soon",
  }[status];

  const roomName = room?.display_name ?? room?.resource_name ?? room?.name
    ?? (isZh ? "會議室" : "Meeting Room");

  // ── Actions ────────────────────────────────────────────────────────────────
  const postAction = async (path: string, body: Record<string, unknown>) => {
    try {
      await fetch(`${apiUrl}${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      void fetchData();
    } catch { /* silent */ }
  };

  const handleCheckIn  = () => current && postAction(`/api/v1/events/${current.id}/check-in`, { checked_in_at: new Date().toISOString() });
  const handleEndEarly = () => current && postAction(`/api/v1/events/${current.id}/end-early`, { end_at: new Date().toISOString() });

  // ── Empty / error states ───────────────────────────────────────────────────
  const emptyStyle: React.CSSProperties = {
    background: bgColor === "transparent" ? "transparent" : (bgColor ?? "rgb(3,7,18)"),
    containerType: "inline-size" as unknown as undefined,
  };

  if (!apiUrl || !calendarId) return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-3 select-none" style={emptyStyle}>
      <DoorOpen style={{ width: "clamp(24px,8cqi,80px)", height: "clamp(24px,8cqi,80px)", color: textColor, opacity: 0.25 }} />
      <p style={{ color: textColor, opacity: 0.4, fontSize: "clamp(0.5rem,2cqi,1rem)", textAlign: "center" }}>
        {isZh ? "請設定 API 網址與行事曆 ID" : "Configure API URL and Calendar ID"}
      </p>
    </div>
  );

  if (loading) return (
    <div className="flex h-full w-full items-center justify-center select-none" style={emptyStyle}>
      <p style={{ color: textColor, opacity: 0.35, fontSize: "clamp(0.5rem,2cqi,1rem)" }}>
        {isZh ? "連線中…" : "Connecting…"}
      </p>
    </div>
  );

  if (error) return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-2 select-none" style={{ ...emptyStyle, containerType: "inline-size" as unknown as undefined }}>
      <XCircle style={{ color: "#ef4444", width: "clamp(16px,5cqi,48px)", height: "clamp(16px,5cqi,48px)" }} />
      <p style={{ color: textColor, opacity: 0.5, fontSize: "clamp(0.45rem,1.5cqi,0.8rem)", textAlign: "center", padding: "0 1rem" }}>{error}</p>
    </div>
  );

  // ── Main render ────────────────────────────────────────────────────────────
  return (
    <div
      className="relative flex h-full w-full flex-col overflow-hidden select-none"
      style={{
        background: bgColor === "transparent" ? "transparent" : (bgColor ?? "rgb(3,7,18)"),
        // @ts-expect-error — container queries
        containerType: "inline-size",
      }}
    >
      {/* Status accent bar */}
      <div style={{ height: "clamp(3px,0.8cqi,10px)", background: statusColor, flexShrink: 0, transition: "background 0.6s" }} />

      {/* Header: room name + clock + status badge */}
      <div className="flex items-center justify-between shrink-0"
        style={{ padding: "clamp(6px,1.8cqi,24px) clamp(8px,2.2cqi,32px)" }}
      >
        <div className="flex items-center gap-2 min-w-0">
          <DoorOpen style={{ width: "clamp(10px,2.2cqi,28px)", height: "clamp(10px,2.2cqi,28px)", color: statusColor, flexShrink: 0 }} />
          <span className="font-bold truncate" style={{ color: textColor, fontSize: "clamp(0.6rem,2.2cqi,2rem)" }}>
            {roomName}
          </span>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className="font-mono tabular-nums" style={{ color: `${statusColor}cc`, fontSize: "clamp(0.5rem,1.6cqi,1.1rem)" }}>
            {now.toLocaleTimeString(lang, { hour: "2-digit", minute: "2-digit" })}
          </span>
          <span className="font-semibold rounded-full"
            style={{
              background: `${statusColor}22`,
              color: statusColor,
              border: `1px solid ${statusColor}44`,
              fontSize: "clamp(0.4rem,1.1cqi,0.75rem)",
              padding: "clamp(2px,0.4cqi,5px) clamp(5px,1cqi,12px)",
              whiteSpace: "nowrap",
            }}
          >
            {statusLabel}
          </span>
        </div>
      </div>

      {/* Main content */}
      <div className="flex-1 flex flex-col justify-center overflow-hidden"
        style={{ padding: "0 clamp(8px,2.2cqi,32px)" }}
      >
        {status === "available" ? (
          // ── Available ────────────────────────────────────────────────────
          <div className="flex flex-col items-center justify-center gap-3">
            <CheckCircle style={{ color: "#10b981", width: "clamp(24px,7cqi,72px)", height: "clamp(24px,7cqi,72px)", opacity: 0.9 }} />
            <p className="font-black" style={{ color: "#10b981", fontSize: "clamp(1rem,5cqi,4.5rem)", lineHeight: 1 }}>
              {isZh ? "空閒" : "Available"}
            </p>
            {upcoming[0] ? (
              <p style={{ color: `${textColor}70`, fontSize: "clamp(0.45rem,1.6cqi,1rem)", textAlign: "center" }}>
                {isZh ? "下一場：" : "Next: "}{fmtTime(upcoming[0].start_at)}–{fmtTime(upcoming[0].end_at)}&nbsp;
                {upcoming[0].summary}
              </p>
            ) : (
              <p style={{ color: `${textColor}40`, fontSize: "clamp(0.4rem,1.4cqi,0.85rem)" }}>
                {isZh ? "今日無預約" : "No more meetings today"}
              </p>
            )}
          </div>
        ) : (
          // ── In Meeting / Starting Soon ────────────────────────────────────
          <div className="flex flex-col gap-1">
            {/* Meeting title */}
            <p className="font-black leading-tight"
              style={{ color: textColor, fontSize: "clamp(0.75rem,3.2cqi,3rem)", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}
            >
              {current?.summary ?? upcoming[0]?.summary ?? "—"}
            </p>

            {/* Organizer */}
            <p style={{ color: `${textColor}60`, fontSize: "clamp(0.4rem,1.4cqi,0.9rem)" }}>
              {current?.organizer_email ?? upcoming[0]?.organizer_email ?? ""}
            </p>

            {/* Countdown (only for in-meeting) */}
            {status === "in-meeting" && (
              <>
                <p className="font-mono font-black tabular-nums"
                  style={{ color: statusColor, fontSize: "clamp(1rem,6cqi,5rem)", lineHeight: 1, marginTop: "clamp(4px,0.5cqi,8px)" }}
                >
                  {fmtCountdown(remaining)}
                </p>
                <p style={{ color: `${textColor}45`, fontSize: "clamp(0.38rem,1.1cqi,0.7rem)" }}>
                  {current && `${fmtTime(current.start_at)} – ${fmtTime(current.end_at)}`}
                </p>

                {/* Quick actions */}
                <div className="flex gap-2" style={{ marginTop: "clamp(4px,0.8cqi,12px)" }}>
                  {!current?.checked_in_at ? (
                    <button onClick={handleCheckIn}
                      className="rounded-full font-semibold transition-opacity hover:opacity-80"
                      style={{ background: "#10b98122", border: "1px solid #10b98155", color: "#10b981",
                        fontSize: "clamp(0.38rem,1.1cqi,0.7rem)", padding: "clamp(2px,0.4cqi,5px) clamp(6px,1.2cqi,14px)" }}
                    >
                      {isZh ? "✓ 報到" : "✓ Check In"}
                    </button>
                  ) : (
                    <span style={{ color: "#10b981", fontSize: "clamp(0.38rem,1.1cqi,0.7rem)" }}>
                      ✓ {isZh ? "已報到" : "Checked In"}
                    </span>
                  )}
                  <button onClick={handleEndEarly}
                    className="rounded-full font-semibold transition-opacity hover:opacity-80"
                    style={{ background: "#ef444422", border: "1px solid #ef444455", color: "#ef4444",
                      fontSize: "clamp(0.38rem,1.1cqi,0.7rem)", padding: "clamp(2px,0.4cqi,5px) clamp(6px,1.2cqi,14px)" }}
                  >
                    {isZh ? "提前結束" : "End Early"}
                  </button>
                </div>
              </>
            )}

            {/* Starting soon: show time */}
            {status === "starting-soon" && upcoming[0] && (
              <p style={{ color: statusColor, fontSize: "clamp(0.5rem,1.8cqi,1.1rem)", marginTop: "clamp(4px,0.5cqi,8px)" }}>
                {isZh ? "開始時間：" : "Starts at "}{fmtTime(upcoming[0].start_at)}
              </p>
            )}
          </div>
        )}
      </div>

      {/* Today's schedule timeline */}
      {showTimeline && upcoming.length > 0 && (
        <div className="shrink-0"
          style={{ borderTop: `1px solid ${textColor}12`, padding: "clamp(5px,1.2cqi,18px) clamp(8px,2.2cqi,32px)" }}
        >
          <div className="flex items-center gap-1.5" style={{ marginBottom: "clamp(3px,0.5cqi,8px)" }}>
            <CalendarClock style={{ width: "clamp(8px,1.2cqi,16px)", height: "clamp(8px,1.2cqi,16px)", color: `${textColor}35` }} />
            <p style={{ color: `${textColor}35`, fontSize: "clamp(0.35rem,0.9cqi,0.6rem)", textTransform: "uppercase", letterSpacing: "0.1em" }}>
              {isZh ? "今日排程" : "Today's Schedule"}
            </p>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: "clamp(2px,0.4cqi,6px)" }}>
            {upcoming.map((e) => (
              <div key={e.id} className="flex items-center gap-2">
                <span className="tabular-nums shrink-0" style={{ color: `${textColor}55`, fontSize: "clamp(0.35rem,1cqi,0.65rem)" }}>
                  {fmtTime(e.start_at)}–{fmtTime(e.end_at)}
                </span>
                <span className="truncate" style={{ color: `${textColor}75`, fontSize: "clamp(0.35rem,1cqi,0.65rem)" }}>
                  {e.summary}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
