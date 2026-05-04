import { useState, useEffect, useCallback, useRef } from "react";
import { useLanguage } from "@/contexts/LanguageContext";
import { useActiveOrg } from "@/contexts/ActiveOrgContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import {
  DoorOpen, RefreshCw, Monitor, Smartphone, Wifi, WifiOff,
  CalendarClock, CheckCircle2, XCircle, ExternalLink, Settings2,
} from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";
import { cn } from "@/lib/utils";
import MeetingRoomWidget from "@/components/widgets/MeetingRoomWidget";

// ── BizBooking API types ───────────────────────────────────────────────────────

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

// ── Component ──────────────────────────────────────────────────────────────────

const MeetingRoomPage = () => {
  const { language } = useLanguage();
  const { activeOrgId } = useActiveOrg();

  const isZh = language === "zh";
  const isJa = language === "ja";

  const t = (zh: string, en: string, ja: string) =>
    ({ zh, en, ja }[language] ?? en);

  // ── API settings ────────────────────────────────────────────────────────────
  const apiUrlKey = activeOrgId ? `bizbooking-api-url:${activeOrgId}` : "bizbooking-api-url";
  const [apiUrl, setApiUrl] = useState(() => {
    try { return localStorage.getItem(apiUrlKey) || ""; } catch { return ""; }
  });
  const [apiUrlInput, setApiUrlInput] = useState(apiUrl);
  const [apiStatus, setApiStatus] = useState<"unknown" | "ok" | "error">("unknown");
  const [settingsOpen, setSettingsOpen] = useState(!apiUrl);

  // Persist API URL
  const saveApiUrl = () => {
    const url = apiUrlInput.replace(/\/$/, "");
    setApiUrl(url);
    try { localStorage.setItem(apiUrlKey, url); } catch { /* ignore */ }
    setSettingsOpen(false);
    toast.success(t("已儲存 API 設定", "API settings saved", "API設定を保存しました"));
  };

  // ── Data ────────────────────────────────────────────────────────────────────
  const [rooms, setRooms]   = useState<BizRoom[]>([]);
  const [events, setEvents] = useState<BizEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedRoomId, setSelectedRoomId] = useState<string>("");
  const [previewMode, setPreviewMode] = useState<"landscape" | "portrait">("landscape");

  const fetchData = useCallback(async () => {
    if (!apiUrl) return;
    setLoading(true);
    const dateStr = format(new Date(), "yyyy-MM-dd");
    try {
      const [rRes, eRes] = await Promise.all([
        fetch(`${apiUrl}/api/v1/meeting-rooms`),
        fetch(`${apiUrl}/api/v1/events?date=${dateStr}`),
      ]);
      if (!rRes.ok || !eRes.ok) throw new Error("API error");
      const rData: BizRoom[]  = (await rRes.json()) as BizRoom[];
      const eData: BizEvent[] = (await eRes.json()) as BizEvent[];
      setRooms(Array.isArray(rData) ? rData.filter((r) => r.is_active) : []);
      setEvents(Array.isArray(eData) ? eData : []);
      setApiStatus("ok");
    } catch {
      setApiStatus("error");
      toast.error(t("無法連線到 BizBooking 伺服器", "Cannot reach BizBooking server", "BizBookingサーバーに接続できません"));
    } finally {
      setLoading(false);
    }
  }, [apiUrl]);

  useEffect(() => { if (apiUrl) void fetchData(); }, [apiUrl, fetchData]);

  // Auto-select first room
  useEffect(() => {
    if (rooms.length > 0 && !selectedRoomId) setSelectedRoomId(rooms[0].calendar_id);
  }, [rooms, selectedRoomId]);

  // ── Room status helpers ─────────────────────────────────────────────────────
  const nowStr   = format(new Date(), "HH:mm");
  const todayStr = format(new Date(), "yyyy-MM-dd");

  const getRoomEvents = (calId: string) =>
    events.filter((e) => e.calendar_id === calId);

  const getCurrentEvent = (calId: string) => {
    const nowTs = new Date().getTime();
    return getRoomEvents(calId).find((e) => {
      const s = new Date(e.start_at).getTime();
      const end = new Date(e.end_at).getTime();
      return s <= nowTs && end > nowTs;
    }) ?? null;
  };

  const getNextEvent = (calId: string) => {
    const nowTs = new Date().getTime();
    return getRoomEvents(calId)
      .filter((e) => new Date(e.start_at).getTime() > nowTs)
      .sort((a, b) => new Date(a.start_at).getTime() - new Date(b.start_at).getTime())[0] ?? null;
  };

  const fmtTime = (iso: string) => {
    const d = new Date(iso);
    return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  };

  const getRoomStatus = (calId: string): "available" | "in-use" | "starting-soon" => {
    if (getCurrentEvent(calId)) return "in-use";
    const next = getNextEvent(calId);
    if (next && (new Date(next.start_at).getTime() - Date.now()) < 15 * 60_000) return "starting-soon";
    return "available";
  };

  const statusBadge = (status: string) => {
    const map = {
      available:      { label: t("空閒", "Available", "空き"),       className: "bg-emerald-500/90 text-white" },
      "in-use":       { label: t("使用中", "In Use", "使用中"),      className: "bg-red-500/90 text-white" },
      "starting-soon":{ label: t("即將開始", "Soon", "まもなく"),    className: "bg-amber-500/90 text-white" },
    };
    const s = map[status as keyof typeof map] ?? map["available"];
    return <Badge className={s.className}>{s.label}</Badge>;
  };

  // ── Quick actions ───────────────────────────────────────────────────────────
  const postAction = async (eventId: string, path: string, body: Record<string, unknown>) => {
    if (!apiUrl) return;
    try {
      const res = await fetch(`${apiUrl}${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error("error");
      void fetchData();
      toast.success(t("操作成功", "Done", "完了しました"));
    } catch {
      toast.error(t("操作失敗", "Failed", "失敗しました"));
    }
  };

  const handleCheckIn  = (ev: BizEvent) => postAction(ev.id, `/api/v1/events/${ev.id}/check-in`,  { checked_in_at: new Date().toISOString() });
  const handleEndEarly = (ev: BizEvent) => postAction(ev.id, `/api/v1/events/${ev.id}/end-early`, { end_at: new Date().toISOString() });

  // ── Quick booking dialog ────────────────────────────────────────────────────
  const [bookOpen, setBookOpen] = useState(false);
  const [booking, setBooking] = useState({ calendarId: "", summary: "", organizer: "", startTime: "09:00", endTime: "10:00" });

  const handleBook = async () => {
    if (!booking.calendarId || !booking.summary.trim()) {
      toast.error(t("請填寫所有欄位", "Fill in all fields", "全項目を入力してください")); return;
    }
    const startAt = `${todayStr}T${booking.startTime}:00`;
    const endAt   = `${todayStr}T${booking.endTime}:00`;
    try {
      const res = await fetch(`${apiUrl}/api/v1/events`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          calendar_id: booking.calendarId,
          summary: booking.summary,
          organizer_email: booking.organizer,
          start_at: startAt,
          end_at: endAt,
        }),
      });
      if (!res.ok) throw new Error("error");
      void fetchData();
      setBookOpen(false);
      setBooking({ calendarId: "", summary: "", organizer: "", startTime: "09:00", endTime: "10:00" });
      toast.success(t("預約成功", "Booking created", "予約が完了しました"));
    } catch {
      toast.error(t("預約失敗", "Booking failed", "予約に失敗しました"));
    }
  };

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-6 animate-fade-in">
      {/* ── Header ── */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-violet-500 to-purple-500 flex items-center justify-center shadow-lg">
            <DoorOpen className="h-5 w-5 text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-foreground">
              {t("會議室管理", "Meeting Room Manager", "会議室管理")}
            </h1>
            <div className="flex items-center gap-1.5 mt-0.5">
              {apiUrl ? (
                apiStatus === "ok" ? (
                  <span className="flex items-center gap-1 text-xs text-emerald-500">
                    <Wifi className="h-3 w-3" /> {t("已連線", "Connected", "接続済み")} · {apiUrl}
                  </span>
                ) : apiStatus === "error" ? (
                  <span className="flex items-center gap-1 text-xs text-red-500">
                    <WifiOff className="h-3 w-3" /> {t("連線失敗", "Connection failed", "接続失敗")}
                  </span>
                ) : null
              ) : (
                <span className="text-xs text-muted-foreground">
                  {t("未設定 BizBooking API", "BizBooking API not configured", "BizBooking API 未設定")}
                </span>
              )}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {apiUrl && (
            <>
              <Button size="sm" variant="outline" onClick={() => void fetchData()} disabled={loading}>
                <RefreshCw className={cn("h-4 w-4 mr-1.5", loading && "animate-spin")} />
                {t("刷新", "Refresh", "更新")}
              </Button>
              <Button size="sm" variant="outline" onClick={() => setBookOpen(true)}>
                <CalendarClock className="h-4 w-4 mr-1.5" />
                {t("快速預約", "Quick Book", "すぐ予約")}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => { setApiUrlInput(apiUrl); setSettingsOpen(true); }}>
                <Settings2 className="h-4 w-4" />
              </Button>
            </>
          )}
          {!apiUrl && (
            <Button onClick={() => setSettingsOpen(true)} className="bg-gradient-to-r from-violet-500 to-purple-500 text-white border-0 hover:opacity-90">
              <Settings2 className="h-4 w-4 mr-2" />
              {t("設定 API", "Configure API", "APIを設定")}
            </Button>
          )}
        </div>
      </div>

      {/* ── No API configured callout ── */}
      {!apiUrl && (
        <div className="border border-violet-500/30 bg-violet-500/5 rounded-2xl p-6 flex flex-col items-center gap-3 text-center">
          <WifiOff className="h-10 w-10 text-violet-400 opacity-60" />
          <p className="font-semibold text-foreground">
            {t("尚未連接 BizBooking", "BizBooking not connected", "BizBookingが未接続")}
          </p>
          <p className="text-sm text-muted-foreground max-w-md">
            {t(
              "請輸入 BizBooking 後端 API 網址以啟用會議室即時狀態、預約管理與門口顯示功能。",
              "Enter your BizBooking backend API URL to enable live room status, booking management, and door display.",
              "BizBookingバックエンドAPIのURLを入力して、リアルタイム状態・予約管理・ドア表示を有効にします。",
            )}
          </p>
          <Button onClick={() => setSettingsOpen(true)} className="bg-gradient-to-r from-violet-500 to-purple-500 text-white border-0 mt-1">
            <Settings2 className="h-4 w-4 mr-2" />
            {t("立即設定", "Set Up Now", "今すぐ設定")}
          </Button>
        </div>
      )}

      {/* ── Tabs (shown only when API configured) ── */}
      {apiUrl && (
        <Tabs defaultValue="rooms" className="w-full">
          <TabsList className="mb-6">
            <TabsTrigger value="rooms" className="min-w-[120px]">
              {t("會議室總覽", "Rooms", "会議室一覧")}
              {rooms.length > 0 && <Badge className="ml-2 bg-primary/20 text-primary text-xs">{rooms.length}</Badge>}
            </TabsTrigger>
            <TabsTrigger value="schedule" className="min-w-[120px]">
              {t("今日排程", "Today's Schedule", "本日スケジュール")}
              {events.length > 0 && <Badge className="ml-2 bg-primary/20 text-primary text-xs">{events.length}</Badge>}
            </TabsTrigger>
          </TabsList>

          {/* ── Rooms tab ── */}
          <TabsContent value="rooms">
            {rooms.length === 0 ? (
              <div className="text-center py-20 text-muted-foreground">
                <DoorOpen className="mx-auto h-12 w-12 mb-4 opacity-30" />
                <p className="text-lg">{t("尚無會議室資料", "No rooms found", "会議室データがありません")}</p>
                <p className="text-sm mt-1">{t("請確認 API 網址是否正確", "Check your API URL", "API URLを確認してください")}</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
                {/* Room cards */}
                <div className="xl:col-span-2 grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {rooms.map((room) => {
                    const calId   = room.calendar_id;
                    const status  = getRoomStatus(calId);
                    const current = getCurrentEvent(calId);
                    const next    = getNextEvent(calId);
                    const name    = room.display_name ?? room.resource_name ?? room.name;
                    return (
                      <div
                        key={room.id}
                        className={cn(
                          "relative bg-card border rounded-2xl p-5 cursor-pointer transition-all duration-300 hover:shadow-lg",
                          status === "in-use" ? "border-red-500/40" : status === "starting-soon" ? "border-amber-500/40" : "border-border",
                          selectedRoomId === calId && "ring-2 ring-primary",
                        )}
                        onClick={() => setSelectedRoomId(calId)}
                      >
                        <div className="flex items-start gap-3 mb-4">
                          <div className={cn(
                            "w-12 h-12 rounded-xl flex items-center justify-center shadow",
                            status === "in-use" ? "bg-red-500/20" : status === "starting-soon" ? "bg-amber-500/20" : "bg-emerald-500/20",
                          )}>
                            <DoorOpen className={cn(
                              "h-6 w-6",
                              status === "in-use" ? "text-red-500" : status === "starting-soon" ? "text-amber-500" : "text-emerald-500",
                            )} />
                          </div>
                          <div className="flex-1 min-w-0">
                            <h3 className="font-bold text-lg text-foreground truncate">{name}</h3>
                            <p className="text-xs text-muted-foreground mt-0.5">
                              {room.building}{room.floor && ` · ${room.floor}`}
                              {room.capacity ? ` · ${room.capacity} ${t("人", "ppl", "名")}` : ""}
                            </p>
                          </div>
                        </div>

                        <div className="mb-3">{statusBadge(status)}</div>

                        {current && (
                          <div className="bg-red-500/10 rounded-lg p-3 mb-2 space-y-1.5">
                            <p className="text-xs text-muted-foreground font-medium">{t("使用中", "In progress", "進行中")}</p>
                            <p className="font-semibold text-foreground text-sm truncate">{current.summary}</p>
                            <p className="text-xs text-muted-foreground">{fmtTime(current.start_at)} – {fmtTime(current.end_at)} · {current.organizer_email}</p>
                            <div className="flex gap-2 pt-1">
                              {!current.checked_in_at && (
                                <button
                                  onClick={(e) => { e.stopPropagation(); void handleCheckIn(current); }}
                                  className="text-[11px] font-semibold rounded-full bg-emerald-500/20 text-emerald-500 border border-emerald-500/30 px-2.5 py-0.5 hover:bg-emerald-500/30 transition-colors"
                                >
                                  {t("✓ 報到", "✓ Check In", "✓ チェックイン")}
                                </button>
                              )}
                              {current.checked_in_at && (
                                <span className="text-[11px] text-emerald-500 flex items-center gap-1">
                                  <CheckCircle2 className="h-3 w-3" />{t("已報到", "Checked in", "チェックイン済み")}
                                </span>
                              )}
                              <button
                                onClick={(e) => { e.stopPropagation(); void handleEndEarly(current); }}
                                className="text-[11px] font-semibold rounded-full bg-red-500/20 text-red-500 border border-red-500/30 px-2.5 py-0.5 hover:bg-red-500/30 transition-colors"
                              >
                                {t("提前結束", "End Early", "早期終了")}
                              </button>
                            </div>
                          </div>
                        )}

                        {!current && next && (
                          <div className="bg-muted/50 rounded-lg p-3">
                            <p className="text-xs text-muted-foreground font-medium">{t("下一場", "Next", "次")}</p>
                            <p className="font-semibold text-foreground text-sm truncate">{next.summary}</p>
                            <p className="text-xs text-muted-foreground">{fmtTime(next.start_at)} – {fmtTime(next.end_at)}</p>
                          </div>
                        )}

                        {!current && !next && (
                          <p className="text-sm text-muted-foreground">{t("今日無預約", "Free all day", "本日予約なし")}</p>
                        )}
                      </div>
                    );
                  })}
                </div>

                {/* Door display preview */}
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <h2 className="text-lg font-semibold text-foreground flex items-center gap-2">
                      <Monitor className="h-5 w-5" />{t("門口機預覽", "Door Display Preview", "ドア表示プレビュー")}
                    </h2>
                    <div className="flex items-center gap-1 bg-muted rounded-lg p-1">
                      <Button size="sm" variant={previewMode === "landscape" ? "default" : "ghost"} onClick={() => setPreviewMode("landscape")} className="text-xs h-7 gap-1">
                        <Monitor className="h-3 w-3" />{t("橫式", "Wide", "横型")}
                      </Button>
                      <Button size="sm" variant={previewMode === "portrait" ? "default" : "ghost"} onClick={() => setPreviewMode("portrait")} className="text-xs h-7 gap-1">
                        <Smartphone className="h-3 w-3" />{t("直式", "Tall", "縦型")}
                      </Button>
                    </div>
                  </div>

                  {selectedRoomId ? (
                    <div className="flex justify-center">
                      <div className={cn(
                        "relative rounded-xl border-4 border-gray-700 shadow-2xl overflow-hidden transition-all duration-300",
                        previewMode === "landscape" ? "w-full aspect-video" : "w-[220px] aspect-[9/16]",
                      )}>
                        <MeetingRoomWidget config={{
                          apiUrl,
                          calendarId: selectedRoomId,
                          lang: (language === "zh" ? "zh-TW" : "en-US") as "zh-TW" | "en-US",
                          showTimeline: true,
                          refreshSeconds: 30,
                        }} />
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-center justify-center h-40 text-muted-foreground text-sm">
                      {t("請選擇一個會議室", "Select a room", "会議室を選択してください")}
                    </div>
                  )}
                </div>
              </div>
            )}
          </TabsContent>

          {/* ── Today's schedule tab ── */}
          <TabsContent value="schedule">
            {events.length === 0 ? (
              <div className="text-center py-20 text-muted-foreground">
                <CalendarClock className="mx-auto h-12 w-12 mb-4 opacity-30" />
                <p className="text-lg">{t("今日尚無預約", "No events today", "本日の予定はありません")}</p>
              </div>
            ) : (
              <div className="space-y-3">
                {rooms.map((room) => {
                  const calId = room.calendar_id;
                  const roomEvts = getRoomEvents(calId);
                  if (roomEvts.length === 0) return null;
                  const name = room.display_name ?? room.resource_name;
                  return (
                    <div key={room.id} className="bg-card border border-border rounded-2xl overflow-hidden">
                      <div className="flex items-center gap-2 px-5 py-3 bg-muted/30 border-b border-border">
                        <DoorOpen className="h-4 w-4 text-primary" />
                        <span className="font-semibold text-sm">{name}</span>
                        <Badge variant="secondary" className="text-xs">{roomEvts.length}</Badge>
                      </div>
                      <div className="divide-y divide-border/50">
                        {[...roomEvts]
                          .sort((a, b) => new Date(a.start_at).getTime() - new Date(b.start_at).getTime())
                          .map((ev) => {
                            const nowTs = Date.now();
                            const s = new Date(ev.start_at).getTime();
                            const end = new Date(ev.end_at).getTime();
                            const isNow  = s <= nowTs && end > nowTs;
                            const isPast = end <= nowTs;
                            return (
                              <div key={ev.id} className={cn("flex items-center gap-4 px-5 py-3", isNow && "bg-red-500/5")}>
                                <div className="w-20 shrink-0">
                                  <p className="text-xs font-mono font-semibold tabular-nums">{fmtTime(ev.start_at)}</p>
                                  <p className="text-xs font-mono text-muted-foreground tabular-nums">{fmtTime(ev.end_at)}</p>
                                </div>
                                <div className="flex-1 min-w-0">
                                  <p className="font-medium text-sm truncate">{ev.summary}</p>
                                  <p className="text-xs text-muted-foreground truncate">{ev.organizer_email}</p>
                                </div>
                                <div className="flex items-center gap-2 shrink-0">
                                  {isNow ? statusBadge("in-use") : isPast ? (
                                    <Badge variant="secondary" className="bg-muted text-muted-foreground text-xs">
                                      {t("已結束", "Ended", "終了")}
                                    </Badge>
                                  ) : statusBadge("available")}
                                  {isNow && !ev.checked_in_at && (
                                    <button
                                      onClick={() => void handleCheckIn(ev)}
                                      className="text-[11px] font-semibold rounded-full bg-emerald-500/20 text-emerald-500 border border-emerald-500/30 px-2 py-0.5 hover:bg-emerald-500/30 transition-colors"
                                    >
                                      {t("報到", "Check In", "チェックイン")}
                                    </button>
                                  )}
                                  {isNow && ev.checked_in_at && (
                                    <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                                  )}
                                </div>
                              </div>
                            );
                          })}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </TabsContent>
        </Tabs>
      )}

      {/* ── API Settings Dialog ── */}
      <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-violet-500 to-purple-500 flex items-center justify-center">
                <Settings2 className="h-4 w-4 text-white" />
              </div>
              {t("BizBooking API 設定", "BizBooking API Settings", "BizBooking API 設定")}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label className="text-sm font-semibold">
                {t("後端 API 網址", "Backend API URL", "バックエンド API URL")}
              </Label>
              <Input
                value={apiUrlInput}
                onChange={(e) => setApiUrlInput(e.target.value)}
                placeholder="http://your-server:8083"
                className="h-11 text-sm font-mono"
              />
              <p className="text-xs text-muted-foreground">
                {t(
                  "請輸入 BizBooking Go 後端的完整網址（包含 port）。",
                  "Enter the full URL of your BizBooking Go backend (including port).",
                  "BizBooking Go バックエンドの完全なURL（ポート含む）を入力してください。",
                )}
              </p>
            </div>

            <div className="rounded-lg bg-muted/50 p-3 space-y-1">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                {t("BizBooking 管理後台", "BizBooking Admin", "BizBooking 管理画面")}
              </p>
              {apiUrl ? (
                <a
                  href={`${apiUrl}/admin/dashboard`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-primary flex items-center gap-1 hover:underline"
                >
                  <ExternalLink className="h-3 w-3" />
                  {t("開啟 BizBooking 管理介面", "Open BizBooking Admin", "BizBooking管理画面を開く")}
                </a>
              ) : (
                <p className="text-xs text-muted-foreground">
                  {t("設定 API 網址後即可開啟", "Configure API URL first", "API URLを設定後に利用可能")}
                </p>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSettingsOpen(false)}>
              {t("取消", "Cancel", "キャンセル")}
            </Button>
            <Button
              onClick={saveApiUrl}
              className="bg-gradient-to-r from-violet-500 to-purple-500 text-white border-0 hover:opacity-90"
            >
              {t("儲存", "Save", "保存")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Quick booking dialog ── */}
      <Dialog open={bookOpen} onOpenChange={setBookOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-violet-500 to-purple-500 flex items-center justify-center">
                <CalendarClock className="h-4 w-4 text-white" />
              </div>
              {t("快速預約", "Quick Booking", "すぐ予約")}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label className="text-sm font-semibold">{t("會議室", "Room", "会議室")}</Label>
              <Select value={booking.calendarId} onValueChange={(v) => setBooking({ ...booking, calendarId: v })}>
                <SelectTrigger className="h-11"><SelectValue placeholder={t("選擇會議室", "Select room", "会議室を選択")} /></SelectTrigger>
                <SelectContent>
                  {rooms.map((r) => (
                    <SelectItem key={r.calendar_id} value={r.calendar_id}>
                      {r.display_name ?? r.resource_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label className="text-sm font-semibold">{t("會議主題", "Meeting Title", "会議タイトル")}</Label>
              <Input value={booking.summary} onChange={(e) => setBooking({ ...booking, summary: e.target.value })} placeholder={t("例：週會、產品討論", "e.g. Weekly Standup", "例：週次ミーティング")} className="h-11" />
            </div>
            <div className="space-y-2">
              <Label className="text-sm font-semibold">{t("預約人 Email", "Organizer Email", "予約者メール")}</Label>
              <Input value={booking.organizer} onChange={(e) => setBooking({ ...booking, organizer: e.target.value })} placeholder="user@example.com" className="h-11" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label className="text-sm font-semibold">{t("開始", "Start", "開始")}</Label>
                <Input type="time" value={booking.startTime} onChange={(e) => setBooking({ ...booking, startTime: e.target.value })} className="h-11" />
              </div>
              <div className="space-y-2">
                <Label className="text-sm font-semibold">{t("結束", "End", "終了")}</Label>
                <Input type="time" value={booking.endTime} onChange={(e) => setBooking({ ...booking, endTime: e.target.value })} className="h-11" />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setBookOpen(false)}>{t("取消", "Cancel", "キャンセル")}</Button>
            <Button onClick={() => void handleBook()} className="bg-gradient-to-r from-violet-500 to-purple-500 text-white border-0">
              {t("確認預約", "Confirm", "予約確認")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default MeetingRoomPage;
