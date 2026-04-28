import { useState, useMemo, useEffect, useCallback } from "react";
import { useLanguage } from "@/contexts/LanguageContext";
import { useActiveOrg } from "@/contexts/ActiveOrgContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DoorOpen, Plus, Trash2, CalendarPlus, Clock, MapPin, Users, Monitor, Smartphone, CheckCircle2, XCircle } from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";
import { cn } from "@/lib/utils";

interface Room {
  id: string;
  name: string;
  location: string;
  capacity: number;
}

interface Booking {
  id: string;
  roomId: string;
  title: string;
  organizer: string;
  startTime: string; // HH:mm
  endTime: string;
  date: string; // YYYY-MM-DD
}

const MeetingRoomPage = () => {
  const { language } = useLanguage();
  const { activeOrgId } = useActiveOrg();

  const mKey = (base: string) => activeOrgId ? `${base}:${activeOrgId}` : base;

  const [rooms, setRooms] = useState<Room[]>([]);
  const [bookings, setBookings] = useState<Booking[]>([]);

  const [addRoomOpen, setAddRoomOpen] = useState(false);
  const [bookingOpen, setBookingOpen] = useState(false);
  const [newRoom, setNewRoom] = useState({ name: "", location: "", capacity: 8 });
  const [newBooking, setNewBooking] = useState({ roomId: "", title: "", organizer: "", startTime: "09:00", endTime: "10:00", date: format(new Date(), "yyyy-MM-dd") });
  const [previewMode, setPreviewMode] = useState<"landscape" | "portrait">("landscape");

  const loadData = useCallback((oid: string | null) => {
    const k = (base: string) => oid ? `${base}:${oid}` : base;
    try { const s = localStorage.getItem(k("signboard-meeting-rooms")); setRooms(s ? JSON.parse(s) : []); } catch { setRooms([]); }
    try { const s = localStorage.getItem(k("signboard-meeting-bookings")); setBookings(s ? JSON.parse(s) : []); } catch { setBookings([]); }
  }, []);

  useEffect(() => { loadData(activeOrgId); }, [activeOrgId, loadData]);

  const persistRooms = (r: Room[]) => { setRooms(r); localStorage.setItem(mKey("signboard-meeting-rooms"), JSON.stringify(r)); };
  const persistBookings = (b: Booking[]) => { setBookings(b); localStorage.setItem(mKey("signboard-meeting-bookings"), JSON.stringify(b)); };

  const today = format(new Date(), "yyyy-MM-dd");
  const now = format(new Date(), "HH:mm");

  const todayBookings = useMemo(() => bookings.filter((b) => b.date === today), [bookings, today]);

  const getRoomStatus = (roomId: string): "available" | "in-use" | "upcoming" => {
    const roomBookings = todayBookings.filter((b) => b.roomId === roomId);
    for (const b of roomBookings) {
      if (now >= b.startTime && now < b.endTime) return "in-use";
    }
    const upcoming = roomBookings.find((b) => b.startTime > now);
    if (upcoming) return "upcoming";
    return "available";
  };

  const getCurrentBooking = (roomId: string) => todayBookings.find((b) => b.roomId === roomId && now >= b.startTime && now < b.endTime);
  const getNextBooking = (roomId: string) => todayBookings.filter((b) => b.roomId === roomId && b.startTime > now).sort((a, b) => a.startTime.localeCompare(b.startTime))[0];

  const texts = {
    pageTitle: { zh: "會議室管理", en: "Meeting Room Manager", ja: "会議室管理" },
    tabRooms: { zh: "會議室總覽", en: "Room Overview", ja: "会議室一覧" },
    tabBookings: { zh: "預約管理", en: "Bookings", ja: "予約管理" },
    addRoom: { zh: "新增會議室", en: "Add Room", ja: "会議室を追加" },
    addBooking: { zh: "新增預約", en: "New Booking", ja: "新規予約" },
    roomName: { zh: "會議室名稱", en: "Room Name", ja: "会議室名" },
    roomNamePh: { zh: "例如：A301 會議室", en: "e.g. Room A301", ja: "例：A301会議室" },
    location: { zh: "位置", en: "Location", ja: "場所" },
    locationPh: { zh: "例如：3F 東側", en: "e.g. 3F East Wing", ja: "例：3F東側" },
    capacity: { zh: "容納人數", en: "Capacity", ja: "定員" },
    bookTitle: { zh: "會議主題", en: "Meeting Title", ja: "会議タイトル" },
    bookTitlePh: { zh: "例如：週會、產品評審", en: "e.g. Weekly Standup", ja: "例：週次ミーティング" },
    organizer: { zh: "預約人", en: "Organizer", ja: "予約者" },
    organizerPh: { zh: "姓名", en: "Name", ja: "氏名" },
    selectRoom: { zh: "選擇會議室", en: "Select Room", ja: "会議室を選択" },
    startTime: { zh: "開始時間", en: "Start Time", ja: "開始時刻" },
    endTime: { zh: "結束時間", en: "End Time", ja: "終了時刻" },
    date: { zh: "日期", en: "Date", ja: "日付" },
    available: { zh: "空閒", en: "Available", ja: "空き" },
    inUse: { zh: "使用中", en: "In Use", ja: "使用中" },
    upcoming: { zh: "待使用", en: "Upcoming", ja: "まもなく" },
    noRooms: { zh: "尚未新增任何會議室", en: "No rooms added yet", ja: "会議室がまだありません" },
    noBookings: { zh: "今日尚無預約", en: "No bookings today", ja: "本日の予約はありません" },
    confirm: { zh: "確認", en: "Confirm", ja: "確認" },
    cancel: { zh: "取消", en: "Cancel", ja: "キャンセル" },
    preview: { zh: "螢幕預覽", en: "Screen Preview", ja: "プレビュー" },
    landscape: { zh: "橫式", en: "Landscape", ja: "横型" },
    portrait: { zh: "直式", en: "Portrait", ja: "縦型" },
    roomAdded: { zh: "已新增會議室", en: "Room added", ja: "会議室を追加しました" },
    bookingAdded: { zh: "已新增預約", en: "Booking added", ja: "予約を追加しました" },
    deleted: { zh: "已刪除", en: "Deleted", ja: "削除しました" },
    errorFill: { zh: "請填寫所有欄位", en: "Please fill in all fields", ja: "全項目を入力してください" },
    people: { zh: "人", en: "people", ja: "人" },
    current: { zh: "目前", en: "Current", ja: "現在" },
    next: { zh: "下一場", en: "Next", ja: "次" },
    freeAll: { zh: "今日無預約", en: "Free all day", ja: "本日予約なし" },
  };

  const t = (key: keyof typeof texts) => texts[key][language];

  const handleAddRoom = () => {
    if (!newRoom.name.trim() || !newRoom.location.trim()) { toast.error(t("errorFill")); return; }
    const room: Room = { id: crypto.randomUUID(), ...newRoom };
    persistRooms([...rooms, room]);
    setNewRoom({ name: "", location: "", capacity: 8 });
    setAddRoomOpen(false);
    toast.success(t("roomAdded"));
  };

  const handleAddBooking = () => {
    if (!newBooking.roomId || !newBooking.title.trim() || !newBooking.organizer.trim()) { toast.error(t("errorFill")); return; }
    const booking: Booking = { id: crypto.randomUUID(), ...newBooking };
    persistBookings([...bookings, booking]);
    setNewBooking({ roomId: "", title: "", organizer: "", startTime: "09:00", endTime: "10:00", date: today });
    setBookingOpen(false);
    toast.success(t("bookingAdded"));
  };

  const handleDeleteRoom = (id: string) => {
    persistRooms(rooms.filter((r) => r.id !== id));
    persistBookings(bookings.filter((b) => b.roomId !== id));
    toast.success(t("deleted"));
  };

  const handleDeleteBooking = (id: string) => {
    persistBookings(bookings.filter((b) => b.id !== id));
    toast.success(t("deleted"));
  };

  const statusBadge = (status: string) => {
    const map = {
      available: { label: t("available"), className: "bg-emerald-500/90 hover:bg-emerald-500 text-white" },
      "in-use": { label: t("inUse"), className: "bg-red-500/90 hover:bg-red-500 text-white" },
      upcoming: { label: t("upcoming"), className: "bg-amber-500/90 hover:bg-amber-500 text-white" },
    };
    const s = map[status as keyof typeof map];
    return <Badge className={s.className}>{s.label}</Badge>;
  };

  const getRoomName = (id: string) => rooms.find((r) => r.id === id)?.name || "—";

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-violet-500 to-purple-500 flex items-center justify-center shadow-lg">
            <DoorOpen className="h-5 w-5 text-white" />
          </div>
          <h1 className="text-2xl font-bold text-foreground">{t("pageTitle")}</h1>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setAddRoomOpen(true)}>
            <Plus className="mr-2 h-4 w-4" />{t("addRoom")}
          </Button>
          <Button onClick={() => setBookingOpen(true)} className="bg-gradient-to-r from-violet-500 to-purple-500 text-white border-0 hover:opacity-90">
            <CalendarPlus className="mr-2 h-4 w-4" />{t("addBooking")}
          </Button>
        </div>
      </div>

      <Tabs defaultValue="rooms" className="w-full">
        <TabsList className="mb-6">
          <TabsTrigger value="rooms" className="min-w-[140px]">{t("tabRooms")}</TabsTrigger>
          <TabsTrigger value="bookings" className="min-w-[140px]">
            {t("tabBookings")}
            {todayBookings.length > 0 && <Badge className="ml-2 bg-primary/20 text-primary text-xs">{todayBookings.length}</Badge>}
          </TabsTrigger>
        </TabsList>

        {/* ===== Rooms Overview ===== */}
        <TabsContent value="rooms">
          {rooms.length === 0 ? (
            <div className="text-center py-20 text-muted-foreground">
              <DoorOpen className="mx-auto h-12 w-12 mb-4 opacity-30" />
              <p className="text-lg">{t("noRooms")}</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
              {/* Room Cards */}
              <div className="xl:col-span-2 grid grid-cols-1 sm:grid-cols-2 gap-4">
                {rooms.map((room) => {
                  const status = getRoomStatus(room.id);
                  const current = getCurrentBooking(room.id);
                  const next = getNextBooking(room.id);
                  return (
                    <div key={room.id} className={cn(
                      "relative bg-card border rounded-2xl p-5 transition-all duration-300 hover:shadow-lg",
                      status === "in-use" ? "border-red-500/40" : status === "upcoming" ? "border-amber-500/40" : "border-border"
                    )}>
                      <button onClick={() => handleDeleteRoom(room.id)} className="absolute top-3 right-3 text-muted-foreground hover:text-destructive transition-colors" title={t("deleted")}>
                        <Trash2 className="h-4 w-4" />
                      </button>

                      <div className="flex items-start gap-3 mb-4">
                        <div className={cn(
                          "w-12 h-12 rounded-xl flex items-center justify-center shadow",
                          status === "in-use" ? "bg-red-500/20" : status === "upcoming" ? "bg-amber-500/20" : "bg-emerald-500/20"
                        )}>
                          <DoorOpen className={cn(
                            "h-6 w-6",
                            status === "in-use" ? "text-red-500" : status === "upcoming" ? "text-amber-500" : "text-emerald-500"
                          )} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <h3 className="font-bold text-lg text-foreground truncate">{room.name}</h3>
                          <div className="flex items-center gap-3 text-sm text-muted-foreground mt-0.5">
                            <span className="flex items-center gap-1"><MapPin className="h-3.5 w-3.5" />{room.location}</span>
                            <span className="flex items-center gap-1"><Users className="h-3.5 w-3.5" />{room.capacity} {t("people")}</span>
                          </div>
                        </div>
                      </div>

                      <div className="mb-3">{statusBadge(status)}</div>

                      {current && (
                        <div className="bg-red-500/10 rounded-lg p-3 mb-2">
                          <p className="text-xs text-muted-foreground font-medium">{t("current")}</p>
                          <p className="font-semibold text-foreground text-sm truncate">{current.title}</p>
                          <p className="text-xs text-muted-foreground">{current.startTime} – {current.endTime} · {current.organizer}</p>
                        </div>
                      )}

                      {next && (
                        <div className="bg-muted/50 rounded-lg p-3">
                          <p className="text-xs text-muted-foreground font-medium">{t("next")}</p>
                          <p className="font-semibold text-foreground text-sm truncate">{next.title}</p>
                          <p className="text-xs text-muted-foreground">{next.startTime} – {next.endTime} · {next.organizer}</p>
                        </div>
                      )}

                      {!current && !next && (
                        <p className="text-sm text-muted-foreground">{t("freeAll")}</p>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* Screen Preview */}
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <h2 className="text-lg font-semibold text-foreground flex items-center gap-2">
                    <Monitor className="h-5 w-5" />{t("preview")}
                  </h2>
                  <div className="flex items-center gap-1 bg-muted rounded-lg p-1">
                    <Button size="sm" variant={previewMode === "landscape" ? "default" : "ghost"} onClick={() => setPreviewMode("landscape")} className="text-xs h-7 gap-1">
                      <Monitor className="h-3 w-3" />{t("landscape")}
                    </Button>
                    <Button size="sm" variant={previewMode === "portrait" ? "default" : "ghost"} onClick={() => setPreviewMode("portrait")} className="text-xs h-7 gap-1">
                      <Smartphone className="h-3 w-3" />{t("portrait")}
                    </Button>
                  </div>
                </div>
                <div className="flex justify-center">
                  <div className={cn(
                    "relative bg-gradient-to-br from-gray-900 to-gray-800 rounded-xl border-4 border-gray-700 shadow-2xl overflow-hidden transition-all duration-300",
                    previewMode === "landscape" ? "w-full aspect-video" : "w-[220px] aspect-[9/16]"
                  )}>
                    <div className="absolute inset-0 p-3 flex flex-col gap-2 overflow-auto">
                      {/* Header */}
                      <div className="text-center mb-1">
                        <p className="text-white/50 text-[9px]">{format(new Date(), "yyyy/MM/dd HH:mm")}</p>
                        <h3 className={cn("text-white font-bold", previewMode === "landscape" ? "text-sm" : "text-xs")}>
                          {{ zh: "會議室狀態", en: "Room Status", ja: "会議室状況" }[language]}
                        </h3>
                      </div>
                      {/* Room status cards */}
                      {rooms.length === 0 ? (
                        <div className="flex-1 flex items-center justify-center">
                          <p className="text-white/30 text-xs">{t("noRooms")}</p>
                        </div>
                      ) : (
                        <div className={cn("grid gap-1.5", previewMode === "landscape" ? "grid-cols-2" : "grid-cols-1")}>
                          {rooms.map((room) => {
                            const status = getRoomStatus(room.id);
                            const current = getCurrentBooking(room.id);
                            const next = getNextBooking(room.id);
                            return (
                              <div key={room.id} className={cn(
                                "rounded-lg p-2 border",
                                status === "in-use" ? "bg-red-500/20 border-red-500/30" : status === "upcoming" ? "bg-amber-500/20 border-amber-500/30" : "bg-emerald-500/20 border-emerald-500/30"
                              )}>
                                <div className="flex items-center justify-between mb-0.5">
                                  <span className="text-white font-bold text-[10px] truncate">{room.name}</span>
                                  {status === "available" ? <CheckCircle2 className="h-3 w-3 text-emerald-400 shrink-0" /> : <XCircle className="h-3 w-3 text-red-400 shrink-0" />}
                                </div>
                                <p className="text-white/60 text-[8px] truncate">
                                  {current ? `${current.title} (${current.startTime}–${current.endTime})` : next ? `${t("next")}: ${next.title} ${next.startTime}` : t("freeAll")}
                                </p>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}
        </TabsContent>

        {/* ===== Bookings Tab ===== */}
        <TabsContent value="bookings">
          {todayBookings.length === 0 ? (
            <div className="text-center py-20 text-muted-foreground">
              <CalendarPlus className="mx-auto h-12 w-12 mb-4 opacity-30" />
              <p className="text-lg">{t("noBookings")}</p>
            </div>
          ) : (
            <div className="bg-card border border-border rounded-2xl overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-base">{{ zh: "會議室", en: "Room", ja: "会議室" }[language]}</TableHead>
                    <TableHead className="text-base">{{ zh: "會議主題", en: "Title", ja: "タイトル" }[language]}</TableHead>
                    <TableHead className="text-base">{{ zh: "預約人", en: "Organizer", ja: "予約者" }[language]}</TableHead>
                    <TableHead className="text-base">{{ zh: "時段", en: "Time", ja: "時間帯" }[language]}</TableHead>
                    <TableHead className="text-base">{{ zh: "狀態", en: "Status", ja: "ステータス" }[language]}</TableHead>
                    <TableHead className="text-base text-right">{{ zh: "操作", en: "Actions", ja: "操作" }[language]}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {todayBookings.sort((a, b) => a.startTime.localeCompare(b.startTime)).map((b) => {
                    const isNow = now >= b.startTime && now < b.endTime;
                    const isPast = now >= b.endTime;
                    return (
                      <TableRow key={b.id} className={isNow ? "bg-red-500/5" : ""}>
                        <TableCell className="font-semibold">{getRoomName(b.roomId)}</TableCell>
                        <TableCell className="font-medium">{b.title}</TableCell>
                        <TableCell className="text-muted-foreground">{b.organizer}</TableCell>
                        <TableCell className="tabular-nums">{b.startTime} – {b.endTime}</TableCell>
                        <TableCell>
                          {isNow ? statusBadge("in-use") : isPast ? <Badge variant="secondary" className="bg-muted text-muted-foreground">{{ zh: "已結束", en: "Ended", ja: "終了" }[language]}</Badge> : statusBadge("upcoming")}
                        </TableCell>
                        <TableCell className="text-right">
                          <Button size="sm" variant="ghost" onClick={() => handleDeleteBooking(b.id)} className="text-destructive hover:text-destructive">
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </TabsContent>
      </Tabs>

      {/* Add Room Dialog */}
      <Dialog open={addRoomOpen} onOpenChange={setAddRoomOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-violet-500 to-purple-500 flex items-center justify-center">
                <DoorOpen className="h-4 w-4 text-white" />
              </div>
              {t("addRoom")}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label className="text-base font-semibold">{t("roomName")}</Label>
              <Input value={newRoom.name} onChange={(e) => setNewRoom({ ...newRoom, name: e.target.value })} placeholder={t("roomNamePh")} className="h-11 text-base" />
            </div>
            <div className="space-y-2">
              <Label className="text-base font-semibold">{t("location")}</Label>
              <Input value={newRoom.location} onChange={(e) => setNewRoom({ ...newRoom, location: e.target.value })} placeholder={t("locationPh")} className="h-11 text-base" />
            </div>
            <div className="space-y-2">
              <Label className="text-base font-semibold">{t("capacity")}</Label>
              <Input type="number" value={newRoom.capacity} onChange={(e) => setNewRoom({ ...newRoom, capacity: Number(e.target.value) || 1 })} min={1} className="h-11 text-base" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddRoomOpen(false)}>{t("cancel")}</Button>
            <Button onClick={handleAddRoom} className="bg-gradient-to-r from-violet-500 to-purple-500 text-white border-0">{t("confirm")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Add Booking Dialog */}
      <Dialog open={bookingOpen} onOpenChange={setBookingOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-violet-500 to-purple-500 flex items-center justify-center">
                <CalendarPlus className="h-4 w-4 text-white" />
              </div>
              {t("addBooking")}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label className="text-base font-semibold">{t("selectRoom")}</Label>
              <Select value={newBooking.roomId} onValueChange={(v) => setNewBooking({ ...newBooking, roomId: v })}>
                <SelectTrigger className="h-11 text-base"><SelectValue placeholder={t("selectRoom")} /></SelectTrigger>
                <SelectContent>
                  {rooms.map((r) => <SelectItem key={r.id} value={r.id} className="text-base">{r.name} ({r.location})</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label className="text-base font-semibold">{t("bookTitle")}</Label>
              <Input value={newBooking.title} onChange={(e) => setNewBooking({ ...newBooking, title: e.target.value })} placeholder={t("bookTitlePh")} className="h-11 text-base" />
            </div>
            <div className="space-y-2">
              <Label className="text-base font-semibold">{t("organizer")}</Label>
              <Input value={newBooking.organizer} onChange={(e) => setNewBooking({ ...newBooking, organizer: e.target.value })} placeholder={t("organizerPh")} className="h-11 text-base" />
            </div>
            <div className="space-y-2">
              <Label className="text-base font-semibold">{t("date")}</Label>
              <Input type="date" value={newBooking.date} onChange={(e) => setNewBooking({ ...newBooking, date: e.target.value })} className="h-11 text-base" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label className="text-base font-semibold">{t("startTime")}</Label>
                <Input type="time" value={newBooking.startTime} onChange={(e) => setNewBooking({ ...newBooking, startTime: e.target.value })} className="h-11 text-base" />
              </div>
              <div className="space-y-2">
                <Label className="text-base font-semibold">{t("endTime")}</Label>
                <Input type="time" value={newBooking.endTime} onChange={(e) => setNewBooking({ ...newBooking, endTime: e.target.value })} className="h-11 text-base" />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setBookingOpen(false)}>{t("cancel")}</Button>
            <Button onClick={handleAddBooking} className="bg-gradient-to-r from-violet-500 to-purple-500 text-white border-0">{t("confirm")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default MeetingRoomPage;
