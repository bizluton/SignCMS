import { useState, useMemo, useEffect, useCallback } from "react";
import { useLanguage } from "@/contexts/LanguageContext";
import { useActiveOrg } from "@/contexts/ActiveOrgContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Users, Monitor, Smartphone, Plus, Minus, SkipForward, RotateCcw, Bell, Volume2, History } from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";
import { cn } from "@/lib/utils";

interface QueueRecord {
  id: string;
  number: number;
  counter: string;
  calledAt: Date;
  status: "called" | "served" | "skipped";
}

const COUNTERS = [
  { value: "counter-1", label: { zh: "1 號櫃檯", en: "Counter 1", ja: "カウンター1" } },
  { value: "counter-2", label: { zh: "2 號櫃檯", en: "Counter 2", ja: "カウンター2" } },
  { value: "counter-3", label: { zh: "3 號櫃檯", en: "Counter 3", ja: "カウンター3" } },
  { value: "counter-4", label: { zh: "取餐區", en: "Pickup Area", ja: "受取エリア" } },
];

const QueuePage = () => {
  const { language } = useLanguage();
  const { activeOrgId } = useActiveOrg();

  const qKey = (base: string) => activeOrgId ? `${base}:${activeOrgId}` : base;

  const [currentNumber, setCurrentNumber] = useState(1);
  const [counter, setCounter] = useState("counter-1");
  const [previewMode, setPreviewMode] = useState<"landscape" | "portrait">("landscape");
  const [records, setRecords] = useState<QueueRecord[]>([]);

  // Load data from org-scoped storage
  const loadData = useCallback((oid: string | null) => {
    const k = (base: string) => oid ? `${base}:${oid}` : base;
    try {
      const num = Number(localStorage.getItem(k("signboard-queue-number"))) || 1;
      setCurrentNumber(num);
    } catch { setCurrentNumber(1); }
    try {
      const saved = localStorage.getItem(k("signboard-queue-records"));
      if (saved) setRecords(JSON.parse(saved).map((r: any) => ({ ...r, calledAt: new Date(r.calledAt) })));
      else setRecords([]);
    } catch { setRecords([]); }
  }, []);

  useEffect(() => { loadData(activeOrgId); }, [activeOrgId, loadData]);

  const persist = (num: number, recs: QueueRecord[]) => {
    localStorage.setItem(qKey("signboard-queue-number"), String(num));
    localStorage.setItem(qKey("signboard-queue-records"), JSON.stringify(recs));
  };

  const texts = {
    pageTitle: { zh: "排隊叫號管理", en: "Queue Management", ja: "順番呼出し管理" },
    tabControl: { zh: "叫號控制台", en: "Queue Control", ja: "呼出しコントロール" },
    tabHistory: { zh: "叫號紀錄", en: "Call History", ja: "呼出し履歴" },
    currentNum: { zh: "目前叫號", en: "Current Number", ja: "現在の番号" },
    counterLabel: { zh: "服務櫃檯", en: "Counter", ja: "カウンター" },
    counterPh: { zh: "選擇櫃檯", en: "Select counter", ja: "カウンターを選択" },
    callNext: { zh: "叫下一號", en: "Call Next", ja: "次を呼出し" },
    skip: { zh: "跳過此號", en: "Skip", ja: "スキップ" },
    reset: { zh: "重置號碼", en: "Reset", ja: "リセット" },
    preview: { zh: "即時模擬預覽", en: "Live Preview", ja: "リアルタイムプレビュー" },
    landscape: { zh: "橫式螢幕", en: "Landscape", ja: "横型" },
    portrait: { zh: "直式螢幕", en: "Portrait", ja: "縦型" },
    callTo: { zh: "請", en: "Now serving", ja: "番号" },
    callToNum: { zh: "號", en: "", ja: "番" },
    callToSuffix: { zh: "至櫃檯取餐", en: "please proceed to counter", ja: "カウンターへどうぞ" },
    waiting: { zh: "等候中…", en: "Waiting…", ja: "お待ちください…" },
    colNumber: { zh: "號碼", en: "Number", ja: "番号" },
    colCounter: { zh: "櫃檯", en: "Counter", ja: "カウンター" },
    colTime: { zh: "呼叫時間", en: "Called At", ja: "呼出し時刻" },
    colStatus: { zh: "狀態", en: "Status", ja: "ステータス" },
    statusCalled: { zh: "已叫號", en: "Called", ja: "呼出し済" },
    statusServed: { zh: "已服務", en: "Served", ja: "対応済" },
    statusSkipped: { zh: "已跳過", en: "Skipped", ja: "スキップ" },
    noRecords: { zh: "尚無叫號紀錄", en: "No call records yet", ja: "呼出し履歴はまだありません" },
    calledToast: { zh: "已叫號", en: "Number called", ja: "呼出しました" },
    skippedToast: { zh: "已跳過", en: "Number skipped", ja: "スキップしました" },
    resetToast: { zh: "號碼已重置為 1", en: "Number reset to 1", ja: "番号を1にリセットしました" },
    servedBtn: { zh: "標記為已服務", en: "Mark Served", ja: "対応済にする" },
  };

  const t = (key: keyof typeof texts) => texts[key][language];

  const counterLabel = (val: string) => {
    const c = COUNTERS.find((x) => x.value === val);
    return c ? c.label[language] : val;
  };

  const handleCallNext = () => {
    const record: QueueRecord = {
      id: crypto.randomUUID(),
      number: currentNumber,
      counter,
      calledAt: new Date(),
      status: "called",
    };
    const next = currentNumber + 1;
    const updated = [record, ...records];
    setCurrentNumber(next);
    setRecords(updated);
    persist(next, updated);
    toast.success(`${t("calledToast")} #${currentNumber}`);
  };

  const handleSkip = () => {
    const record: QueueRecord = {
      id: crypto.randomUUID(),
      number: currentNumber,
      counter,
      calledAt: new Date(),
      status: "skipped",
    };
    const next = currentNumber + 1;
    const updated = [record, ...records];
    setCurrentNumber(next);
    setRecords(updated);
    persist(next, updated);
    toast.info(`${t("skippedToast")} #${currentNumber}`);
  };

  const handleReset = () => {
    setCurrentNumber(1);
    localStorage.setItem(qKey("signboard-queue-number"), "1");
    toast.success(t("resetToast"));
  };

  const handleMarkServed = (id: string) => {
    const updated = records.map((r) => r.id === id ? { ...r, status: "served" as const } : r);
    setRecords(updated);
    localStorage.setItem(qKey("signboard-queue-records"), JSON.stringify(updated));
  };

  const handleAdjust = (delta: number) => {
    const next = Math.max(1, currentNumber + delta);
    setCurrentNumber(next);
    localStorage.setItem(qKey("signboard-queue-number"), String(next));
  };

  const statusBadge = (status: string) => {
    const map = {
      called: { label: t("statusCalled"), className: "bg-blue-500/90 hover:bg-blue-500 text-white" },
      served: { label: t("statusServed"), className: "bg-emerald-500/90 hover:bg-emerald-500 text-white" },
      skipped: { label: t("statusSkipped"), className: "bg-muted text-muted-foreground" },
    };
    const s = map[status as keyof typeof map];
    return <Badge className={s.className}>{s.label}</Badge>;
  };

  const lastCalled = records.find((r) => r.status === "called");

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-500 to-cyan-500 flex items-center justify-center shadow-lg">
          <Users className="h-5 w-5 text-white" />
        </div>
        <h1 className="text-2xl font-bold text-foreground">{t("pageTitle")}</h1>
      </div>

      <Tabs defaultValue="control" className="w-full">
        <TabsList className="mb-6">
          <TabsTrigger value="control" className="min-w-[140px]">{t("tabControl")}</TabsTrigger>
          <TabsTrigger value="history" className="min-w-[140px]">
            {t("tabHistory")}
            {records.length > 0 && (
              <Badge className="ml-2 bg-primary/20 text-primary text-xs">{records.length}</Badge>
            )}
          </TabsTrigger>
        </TabsList>

        {/* ===== Control Tab ===== */}
        <TabsContent value="control">
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
            {/* Left: Controls */}
            <div className="space-y-6 bg-card border border-border rounded-2xl p-6">
              {/* Current Number Display */}
              <div className="space-y-3">
                <Label className="text-base font-semibold">{t("currentNum")}</Label>
                <div className="flex items-center justify-center gap-4">
                  <Button
                    variant="outline"
                    size="lg"
                    className="h-14 w-14 text-xl"
                    onClick={() => handleAdjust(-1)}
                    disabled={currentNumber <= 1}
                  >
                    <Minus className="h-6 w-6" />
                  </Button>
                  <div className="relative">
                    <Input
                      type="number"
                      value={currentNumber}
                      onChange={(e) => {
                        const v = Math.max(1, Number(e.target.value) || 1);
                        setCurrentNumber(v);
                        localStorage.setItem(qKey("signboard-queue-number"), String(v));
                      }}
                      className="text-center text-5xl font-black h-24 w-40 tabular-nums"
                      min={1}
                    />
                  </div>
                  <Button
                    variant="outline"
                    size="lg"
                    className="h-14 w-14 text-xl"
                    onClick={() => handleAdjust(1)}
                  >
                    <Plus className="h-6 w-6" />
                  </Button>
                </div>
              </div>

              {/* Counter Select */}
              <div className="space-y-2">
                <Label className="text-base font-semibold">{t("counterLabel")}</Label>
                <Select value={counter} onValueChange={setCounter}>
                  <SelectTrigger className="h-12 text-base">
                    <SelectValue placeholder={t("counterPh")} />
                  </SelectTrigger>
                  <SelectContent>
                    {COUNTERS.map((c) => (
                      <SelectItem key={c.value} value={c.value} className="text-base">
                        {c.label[language]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Action Buttons */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <Button
                  onClick={handleCallNext}
                  size="lg"
                  className="h-14 text-lg font-bold bg-gradient-to-r from-blue-500 to-cyan-500 hover:opacity-90 border-0 text-white shadow-lg col-span-1 sm:col-span-2"
                >
                  <Bell className="mr-2 h-5 w-5" />
                  {t("callNext")}
                </Button>
                <Button
                  onClick={handleSkip}
                  variant="outline"
                  size="lg"
                  className="h-14 text-base font-semibold"
                >
                  <SkipForward className="mr-2 h-4 w-4" />
                  {t("skip")}
                </Button>
              </div>

              <Button
                onClick={handleReset}
                variant="ghost"
                className="w-full text-muted-foreground hover:text-destructive"
              >
                <RotateCcw className="mr-2 h-4 w-4" />
                {t("reset")}
              </Button>

              {/* Recent calls summary */}
              {records.length > 0 && (
                <div className="border border-border rounded-xl p-4 space-y-2">
                  <p className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                    <History className="h-4 w-4" />
                    {{ zh: "最近叫號", en: "Recent Calls", ja: "最近の呼出し" }[language]}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {records.slice(0, 8).map((r) => (
                      <Badge
                        key={r.id}
                        variant={r.status === "skipped" ? "secondary" : "default"}
                        className={cn(
                          "text-sm tabular-nums",
                          r.status === "called" && "bg-blue-500/90",
                          r.status === "served" && "bg-emerald-500/90",
                        )}
                      >
                        #{r.number}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Right: Live Preview */}
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-semibold text-foreground flex items-center gap-2">
                  <Monitor className="h-5 w-5" />
                  {t("preview")}
                </h2>
                <div className="flex items-center gap-1 bg-muted rounded-lg p-1">
                  <Button
                    size="sm"
                    variant={previewMode === "landscape" ? "default" : "ghost"}
                    onClick={() => setPreviewMode("landscape")}
                    className="text-xs h-8 gap-1"
                  >
                    <Monitor className="h-3.5 w-3.5" />
                    {t("landscape")}
                  </Button>
                  <Button
                    size="sm"
                    variant={previewMode === "portrait" ? "default" : "ghost"}
                    onClick={() => setPreviewMode("portrait")}
                    className="text-xs h-8 gap-1"
                  >
                    <Smartphone className="h-3.5 w-3.5" />
                    {t("portrait")}
                  </Button>
                </div>
              </div>

              {/* Simulated screen */}
              <div className="flex justify-center">
                <div
                  className={cn(
                    "relative bg-gradient-to-br from-gray-900 to-gray-800 rounded-xl border-4 border-gray-700 shadow-2xl overflow-hidden transition-all duration-300",
                    previewMode === "landscape" ? "w-full aspect-video" : "w-[280px] aspect-[9/16]"
                  )}
                >
                  <div className="absolute inset-0 bg-[url('/placeholder.svg')] bg-cover opacity-5" />

                  {/* Main content area */}
                  <div className="absolute inset-0 flex flex-col">
                    {/* Upper area - mock content */}
                    <div className="flex-1 flex items-center justify-center">
                      <div className="text-center space-y-2 opacity-30">
                        <div className="w-20 h-14 mx-auto bg-white/10 rounded-lg" />
                        <div className="w-32 h-2 mx-auto bg-white/10 rounded" />
                        <div className="w-24 h-2 mx-auto bg-white/10 rounded" />
                      </div>
                    </div>

                    {/* Queue overlay bar */}
                    <div className="bg-gradient-to-t from-blue-600/95 to-blue-500/90 px-4 py-3 backdrop-blur-sm">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <div className="bg-white/20 rounded-lg p-1.5">
                            <Volume2 className={cn("text-white", previewMode === "landscape" ? "h-5 w-5" : "h-4 w-4")} />
                          </div>
                          <div>
                            <p className={cn("text-white/90 font-medium", previewMode === "landscape" ? "text-sm" : "text-xs")}>
                              {t("callTo")}
                            </p>
                            <p className={cn("text-white/60", previewMode === "landscape" ? "text-[10px]" : "text-[9px]")}>
                              {counterLabel(counter)}
                            </p>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className={cn(
                            "text-white font-black tabular-nums tracking-wider",
                            previewMode === "landscape" ? "text-4xl" : "text-3xl",
                            lastCalled ? "animate-pulse" : ""
                          )}>
                            {lastCalled ? lastCalled.number : currentNumber}
                          </span>
                          <span className={cn("text-white/80 font-bold", previewMode === "landscape" ? "text-lg" : "text-sm")}>
                            {t("callToNum")}
                          </span>
                        </div>
                      </div>
                      <p className="text-white/60 text-[10px] mt-1 text-right">{t("callToSuffix")}</p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </TabsContent>

        {/* ===== History Tab ===== */}
        <TabsContent value="history">
          {records.length === 0 ? (
            <div className="text-center py-20 text-muted-foreground">
              <Users className="mx-auto h-12 w-12 mb-4 opacity-30" />
              <p className="text-lg">{t("noRecords")}</p>
            </div>
          ) : (
            <div className="bg-card border border-border rounded-2xl overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-base">{t("colNumber")}</TableHead>
                    <TableHead className="text-base">{t("colCounter")}</TableHead>
                    <TableHead className="text-base">{t("colTime")}</TableHead>
                    <TableHead className="text-base">{t("colStatus")}</TableHead>
                    <TableHead className="text-base text-right">{{ zh: "操作", en: "Actions", ja: "操作" }[language]}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {records.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell className="font-black text-xl tabular-nums">#{r.number}</TableCell>
                      <TableCell className="text-base">{counterLabel(r.counter)}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {format(r.calledAt, "HH:mm:ss")}
                      </TableCell>
                      <TableCell>{statusBadge(r.status)}</TableCell>
                      <TableCell className="text-right">
                        {r.status === "called" && (
                          <Button size="sm" variant="outline" onClick={() => handleMarkServed(r.id)} className="text-xs">
                            {t("servedBtn")}
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default QueuePage;
