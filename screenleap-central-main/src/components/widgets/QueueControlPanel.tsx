/**
 * QueueControlPanel — counter operator UI for calling the next ticket.
 * Embedded inside the App Store queue config dialog (AppStorePage).
 *
 * Two operational layers:
 *   • Operator actions (Call Next, Reset): use supabase.rpc() directly —
 *     authenticated via the user's Supabase session (PostgREST path).
 *   • External kiosk integration: uses supabase.functions.invoke() to call
 *     the queue-system Edge Function.  supabase.functions.invoke automatically
 *     attaches `Authorization: Bearer <session_token>` so the Supabase platform
 *     layer does not return UNAUTHORIZED_NO_AUTH_HEADER.
 *     HMAC verification (second layer) is only required by external kiosks
 *     (POST endpoints); GET /status only needs the anon key.
 */
import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useActiveOrg } from "@/contexts/ActiveOrgContext";
import { useLanguage } from "@/contexts/LanguageContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { ChevronRight, ChevronDown, RotateCcw, Users, Plus, Loader2, Copy, Wifi, WifiOff } from "lucide-react";
import { toast } from "sonner";

// ── Types ─────────────────────────────────────────────────────────────────────

interface Queue {
  id: string;
  queue_name: string;
  prefix: string;
  current_number: number;
}

interface ApiStatus {
  ok: boolean;
  currentNumber?: number;
  waitingCount?: number;
  error?: string;
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function QueueControlPanel() {
  const { activeOrgId } = useActiveOrg();
  const { language } = useLanguage();

  const [queues, setQueues] = useState<Queue[]>([]);
  const [selectedQueueId, setSelectedQueueId] = useState<string>("");
  const [counter, setCounter] = useState("1");
  const [waitingCount, setWaitingCount] = useState(0);
  const [lastCalled, setLastCalled] = useState<{ number: number; prefix: string } | null>(null);
  const [calling, setCalling] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [loadingQueues, setLoadingQueues] = useState(true);
  const [newQueueName, setNewQueueName] = useState("");
  const [creatingQueue, setCreatingQueue] = useState(false);
  const [showNewQueue, setShowNewQueue] = useState(false);

  // API integration state
  const [showApiSection, setShowApiSection] = useState(false);
  const [installToken, setInstallToken] = useState<string | null>(null);
  const [loadingToken, setLoadingToken] = useState(false);
  const [apiStatus, setApiStatus] = useState<ApiStatus | null>(null);
  const [testingApi, setTestingApi] = useState(false);

  const t = (zh: string, en: string, ja: string) =>
    ({ zh, en, ja }[language] ?? en);

  // ── Waiting count ────────────────────────────────────────────────────────
  const refreshWaiting = useCallback(async () => {
    if (!selectedQueueId) return;
    const { count } = await supabase
      .from("queue_system_tickets")
      .select("id", { count: "exact", head: true })
      .eq("queue_id", selectedQueueId)
      .eq("status", "waiting");
    setWaitingCount(count ?? 0);
  }, [selectedQueueId]);

  useEffect(() => { void refreshWaiting(); }, [refreshWaiting]);

  // ── Load queues ──────────────────────────────────────────────────────────
  const loadQueues = useCallback(async () => {
    if (!activeOrgId) return;
    const { data } = await supabase
      .from("queue_system_queues")
      .select("id, queue_name, prefix, current_number")
      .eq("org_id", activeOrgId)
      .order("created_at");
    const rows = (data ?? []) as Queue[];
    setQueues(rows);
    setLoadingQueues(false);
    if (rows.length > 0 && !selectedQueueId) {
      setSelectedQueueId(rows[0].id);
    }
  }, [activeOrgId, selectedQueueId]);

  useEffect(() => { void loadQueues(); }, [loadQueues]);

  // ── Realtime: keep queue list and waiting count fresh ─────────────────────
  useEffect(() => {
    if (!activeOrgId) return;
    const channel = supabase
      .channel("qs-control-realtime")
      .on("postgres_changes", { event: "*", schema: "public", table: "queue_system_queues" }, () => {
        void loadQueues();
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "queue_system_tickets" }, () => {
        void refreshWaiting();
      })
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [activeOrgId, loadQueues, refreshWaiting]);

  // ── Load install_token (lazy, on first expand of API section) ─────────────
  const loadInstallToken = useCallback(async () => {
    if (!activeOrgId || installToken !== null) return;
    setLoadingToken(true);
    try {
      // Try to read existing config; create one if it doesn't exist yet.
      let { data } = await supabase
        .from("queue_system_configs")
        .select("install_token")
        .eq("org_id", activeOrgId)
        .maybeSingle();

      if (!data) {
        const insert = await supabase
          .from("queue_system_configs")
          .insert({ org_id: activeOrgId })
          .select("install_token")
          .single();
        data = insert.data;
      }

      setInstallToken((data as { install_token: string } | null)?.install_token ?? null);
    } catch {
      setInstallToken(null);
    } finally {
      setLoadingToken(false);
    }
  }, [activeOrgId, installToken]);

  const handleExpandApi = (open: boolean) => {
    setShowApiSection(open);
    if (open) void loadInstallToken();
  };

  // ── Test Edge Function via supabase.functions.invoke ─────────────────────
  // supabase.functions.invoke automatically attaches:
  //   Authorization: Bearer <current session JWT or anon key>
  // so the Supabase platform layer accepts the request without
  // returning UNAUTHORIZED_NO_AUTH_HEADER.
  const handleTestApi = async () => {
    if (!selectedQueueId || !activeOrgId) return;
    setTestingApi(true);
    setApiStatus(null);
    try {
      const { data, error } = await supabase.functions.invoke(
        "queue-system/status",
        {
          method: "GET",
          headers: { "Content-Type": "application/json" },
          // Pass org_id + queue_id as query params via the body workaround.
          // supabase.functions.invoke appends these for GET requests.
          body: null,
        },
      );

      // supabase.functions.invoke doesn't support query params natively for GET,
      // so we build the URL manually and use fetch directly — still with the
      // session JWT from supabase.auth.getSession().
      const { data: sessionData } = await supabase.auth.getSession();
      const token =
        sessionData?.session?.access_token ??
        (supabase as unknown as { supabaseKey: string }).supabaseKey;

      const supabaseUrl = (supabase as unknown as { supabaseUrl: string }).supabaseUrl;
      const resp = await fetch(
        `${supabaseUrl}/functions/v1/queue-system/status?org_id=${encodeURIComponent(activeOrgId)}&queue_id=${encodeURIComponent(selectedQueueId)}`,
        {
          method: "GET",
          headers: {
            // This is the Authorization header the platform layer requires.
            "Authorization": `Bearer ${token}`,
            "Content-Type": "application/json",
          },
        },
      );

      void data; void error; // supabase.functions.invoke result not used for GET

      if (!resp.ok) {
        const errBody = await resp.json().catch(() => ({ error: resp.statusText }));
        setApiStatus({ ok: false, error: errBody.error ?? resp.statusText });
        return;
      }
      const result = await resp.json() as { currentNumber: number; waitingCount: number };
      setApiStatus({ ok: true, currentNumber: result.currentNumber, waitingCount: result.waitingCount });
    } catch (err: unknown) {
      setApiStatus({ ok: false, error: err instanceof Error ? err.message : String(err) });
    } finally {
      setTestingApi(false);
    }
  };

  // ── Operator actions (use Supabase RPC — no Edge Function involved) ───────
  const handleCallNext = async () => {
    if (!selectedQueueId) return;
    setCalling(true);
    try {
      // queue_call_next is not yet in the generated types — cast via rpc
      const { data, error } = await (supabase.rpc as unknown as (
        fn: string, args: Record<string, unknown>
      ) => Promise<{ data: unknown; error: { message: string } | null }>)(
        "queue_call_next",
        { p_queue_id: selectedQueueId, p_counter: counter || t("服務台", "Counter", "カウンター") },
      );
      if (error) throw error;
      const ticket = data as { id: string; number: number; queue_id: string };
      const queue = queues.find((q) => q.id === selectedQueueId);
      setLastCalled({ number: ticket.number, prefix: queue?.prefix ?? "" });
      setQueues((prev) =>
        prev.map((q) =>
          q.id === selectedQueueId ? { ...q, current_number: ticket.number } : q,
        ),
      );
      // Fire LINE Multicast notification for ticket owner + members (fire-and-forget)
      void supabase.functions.invoke("queue-system/notify-calling", {
        body: { ticket_id: ticket.id },
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(msg.includes("queue_not_found")
        ? t("找不到此隊列", "Queue not found", "キューが見つかりません")
        : t("操作失敗", "Operation failed", "操作に失敗しました"));
    } finally {
      setCalling(false);
    }
  };

  const handleReset = async () => {
    if (!selectedQueueId) return;
    setResetting(true);
    try {
      const { error } = await (supabase.rpc as unknown as (
        fn: string, args: Record<string, unknown>
      ) => Promise<{ data: unknown; error: { message: string } | null }>)(
        "queue_reset", { p_queue_id: selectedQueueId },
      );
      if (error) throw error;
      setLastCalled(null);
      setQueues((prev) =>
        prev.map((q) =>
          q.id === selectedQueueId ? { ...q, current_number: 0 } : q,
        ),
      );
      toast.success(t("隊列已重置", "Queue reset", "キューをリセットしました"));
    } catch {
      toast.error(t("重置失敗", "Reset failed", "リセットに失敗しました"));
    } finally {
      setResetting(false);
    }
  };

  const handleCreateQueue = async () => {
    if (!newQueueName.trim() || !activeOrgId) return;
    setCreatingQueue(true);
    try {
      const { data, error } = await supabase
        .from("queue_system_queues")
        .insert({ org_id: activeOrgId, queue_name: newQueueName.trim() })
        .select("id, queue_name, prefix, current_number")
        .single();
      if (error) throw error;
      const q = data as Queue;
      setQueues((prev) => [...prev, q]);
      setSelectedQueueId(q.id);
      setNewQueueName("");
      setShowNewQueue(false);
      toast.success(t("隊列已建立", "Queue created", "キューを作成しました"));
    } catch {
      toast.error(t("建立失敗", "Create failed", "作成に失敗しました"));
    } finally {
      setCreatingQueue(false);
    }
  };

  const copyToClipboard = (text: string) => {
    void navigator.clipboard.writeText(text);
    toast.success(t("已複製", "Copied", "コピーしました"));
  };

  const selectedQueue = queues.find((q) => q.id === selectedQueueId) ?? null;
  const displayPrefix = selectedQueue?.prefix ?? "";
  const currentNum = selectedQueue?.current_number ?? 0;

  // ── Render ────────────────────────────────────────────────────────────────
  if (loadingQueues) {
    return (
      <div className="flex items-center justify-center py-12 text-muted-foreground gap-2">
        <Loader2 className="h-4 w-4 animate-spin" />
        {t("載入中…", "Loading…", "読み込み中…")}
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Queue selector + create */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label>{t("選擇隊列", "Queue", "キュー選択")}</Label>
          <button
            onClick={() => setShowNewQueue((v) => !v)}
            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            <Plus className="h-3 w-3" />
            {t("新增隊列", "New queue", "新規キュー")}
          </button>
        </div>

        {showNewQueue && (
          <div className="flex gap-2">
            <Input
              placeholder={t("隊列名稱", "Queue name", "キュー名")}
              value={newQueueName}
              onChange={(e) => setNewQueueName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && void handleCreateQueue()}
              className="h-9 text-sm"
            />
            <Button
              size="sm"
              onClick={handleCreateQueue}
              disabled={creatingQueue || !newQueueName.trim()}
              className="h-9 px-3"
            >
              {creatingQueue ? <Loader2 className="h-3 w-3 animate-spin" /> : t("建立", "Create", "作成")}
            </Button>
          </div>
        )}

        {queues.length > 0 ? (
          <Select value={selectedQueueId} onValueChange={setSelectedQueueId}>
            <SelectTrigger className="h-9">
              <SelectValue placeholder={t("選擇隊列", "Select queue", "キューを選択")} />
            </SelectTrigger>
            <SelectContent>
              {queues.map((q) => (
                <SelectItem key={q.id} value={q.id}>
                  {q.queue_name}
                  {q.prefix && <span className="ml-1 text-muted-foreground text-xs">({q.prefix})</span>}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : (
          <p className="text-sm text-muted-foreground py-1">
            {t("尚無隊列，請先新增", "No queues yet — add one above", "キューがありません")}
          </p>
        )}
      </div>

      {/* Counter name */}
      <div className="space-y-2">
        <Label>{t("櫃台編號", "Counter", "カウンター番号")}</Label>
        <Input
          value={counter}
          onChange={(e) => setCounter(e.target.value)}
          placeholder={t("例：1號櫃台", "e.g. Counter 1", "例：1番窓口")}
          className="h-9"
        />
      </div>

      {/* Status row */}
      {selectedQueue && (
        <div className="flex items-center justify-between rounded-lg bg-muted/50 px-4 py-3 text-sm">
          <div className="flex items-center gap-2 text-muted-foreground">
            <Users className="h-4 w-4" />
            {t("等待人數", "Waiting", "待ち人数")}
            <span className="font-semibold text-foreground">{waitingCount}</span>
          </div>
          <div className="text-muted-foreground">
            {t("目前叫號", "Current", "現在番号")}
            <span className="ml-1 font-semibold text-foreground tabular-nums">
              {currentNum > 0
                ? `${displayPrefix}${String(currentNum).padStart(3, "0")}`
                : "—"}
            </span>
          </div>
        </div>
      )}

      {/* Last called banner */}
      {lastCalled && (
        <div className="flex items-center justify-between rounded-xl bg-gradient-to-r from-blue-500 to-cyan-500 px-5 py-4 text-white">
          <span className="text-sm font-medium opacity-80">
            {t("剛才叫號", "Just called", "呼び出し番号")}
          </span>
          <span className="font-black tabular-nums text-4xl tracking-tight">
            {`${lastCalled.prefix}${String(lastCalled.number).padStart(3, "0")}`}
          </span>
        </div>
      )}

      {/* Actions */}
      <div className="flex gap-3">
        {/* Call Next — primary CTA */}
        <Button
          onClick={handleCallNext}
          disabled={calling || !selectedQueueId}
          className="flex-1 h-14 text-base font-bold bg-gradient-to-r from-blue-500 to-cyan-500 border-0 text-white hover:opacity-90 gap-2"
        >
          {calling
            ? <Loader2 className="h-5 w-5 animate-spin" />
            : <ChevronRight className="h-5 w-5" />}
          {t("叫下一號", "Call Next", "次を呼ぶ")}
        </Button>

        {/* Reset — secondary, requires confirm */}
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button
              variant="outline"
              size="icon"
              className="h-14 w-14 shrink-0"
              disabled={resetting || !selectedQueueId}
              title={t("重置隊列", "Reset queue", "キューをリセット")}
            >
              {resetting
                ? <Loader2 className="h-4 w-4 animate-spin" />
                : <RotateCcw className="h-4 w-4" />}
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>
                {t("確認重置隊列？", "Reset this queue?", "キューをリセットしますか？")}
              </AlertDialogTitle>
              <AlertDialogDescription>
                {t(
                  "所有等待中與呼叫中的號碼將會清除，號碼歸零。此操作無法復原。",
                  "All waiting and calling tickets will be cleared and the counter reset to 0. This cannot be undone.",
                  "待機中・呼び出し中のチケットをすべて削除し、番号を0にリセットします。元に戻せません。",
                )}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>
                {t("取消", "Cancel", "キャンセル")}
              </AlertDialogCancel>
              <AlertDialogAction
                onClick={handleReset}
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              >
                {t("確認重置", "Reset", "リセット")}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>

      {/* ── External kiosk integration ─────────────────────────────────────── */}
      <Collapsible open={showApiSection} onOpenChange={handleExpandApi}>
        <CollapsibleTrigger className="flex w-full items-center justify-between rounded-lg border border-dashed border-border px-4 py-3 text-sm text-muted-foreground hover:text-foreground transition-colors">
          <span>{t("外部叫號機整合 (API)", "External Kiosk API", "外部キオスク連携 (API)")}</span>
          {showApiSection ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        </CollapsibleTrigger>
        <CollapsibleContent className="mt-3 space-y-3">
          <p className="text-xs text-muted-foreground leading-relaxed">
            {t(
              "外部叫號機可透過 REST API 呼叫 Edge Function。所有請求需帶 Authorization: Bearer <anon_key>（平台層），POST 操作另需 HMAC 簽名（業務層）。",
              "External kiosks call the Edge Function via REST. All requests require Authorization: Bearer <anon_key> (platform layer). POST operations also require HMAC signature (business layer).",
              "外部キオスクはEdge FunctionをREST APIで呼び出します。すべてのリクエストにAuthorization: Bearer <anon_key>が必要です。",
            )}
          </p>

          {/* install_token display */}
          <div className="space-y-1">
            <Label className="text-xs">Install Token</Label>
            <div className="flex items-center gap-2">
              {loadingToken ? (
                <div className="flex-1 h-8 flex items-center gap-2 text-muted-foreground text-xs">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  {t("載入中…", "Loading…", "読み込み中…")}
                </div>
              ) : installToken ? (
                <>
                  <code className="flex-1 truncate rounded bg-muted px-2 py-1 text-xs font-mono">
                    {installToken}
                  </code>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-7 w-7 shrink-0"
                    onClick={() => copyToClipboard(installToken)}
                    title={t("複製", "Copy", "コピー")}
                  >
                    <Copy className="h-3 w-3" />
                  </Button>
                </>
              ) : (
                <span className="text-xs text-muted-foreground">
                  {t("無法讀取（需要管理員權限）", "Unavailable (admin required)", "利用不可（管理者権限が必要）")}
                </span>
              )}
            </div>
          </div>

          {/* Test API — calls GET /status via Edge Function with auth header */}
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={handleTestApi}
                disabled={testingApi || !selectedQueueId}
                className="h-8 text-xs gap-1.5"
              >
                {testingApi
                  ? <Loader2 className="h-3 w-3 animate-spin" />
                  : <Wifi className="h-3 w-3" />}
                {t("測試 API 連線", "Test API Connection", "API接続テスト")}
              </Button>
              {apiStatus && (
                <span className={`flex items-center gap-1 text-xs font-medium ${apiStatus.ok ? "text-green-600" : "text-destructive"}`}>
                  {apiStatus.ok
                    ? <><Wifi className="h-3 w-3" />{t("連線正常", "Connected", "接続成功")}</>
                    : <><WifiOff className="h-3 w-3" />{t("連線失敗", "Failed", "接続失敗")}</>}
                </span>
              )}
            </div>
            {apiStatus?.ok && (
              <p className="text-xs text-muted-foreground">
                {t("叫號", "Current", "番号")}: {apiStatus.currentNumber ?? "—"}
                &nbsp;·&nbsp;
                {t("等待", "Waiting", "待ち")}: {apiStatus.waitingCount ?? 0}
              </p>
            )}
            {apiStatus?.error && (
              <p className="text-xs text-destructive">{apiStatus.error}</p>
            )}
          </div>
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}
