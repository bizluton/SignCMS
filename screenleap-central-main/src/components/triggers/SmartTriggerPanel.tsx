import React, { useEffect, useMemo, useState } from "react";
import { Plus, Zap, Activity, Radio, Cpu, KeyRound, Webhook, Clock, Pencil, Trash2, Search, Loader2, CheckCircle2, XCircle, History, RefreshCw, Download, Copy, Check, Save, BookmarkCheck, X as XIcon } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useLanguage } from "@/contexts/LanguageContext";
import { useUserOrgs } from "@/hooks/useUserOrgs";
import { useUserRole } from "@/hooks/useUserRole";
import { useActiveOrg } from "@/contexts/ActiveOrgContext";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle,
} from "@/components/ui/sheet";
import { ScrollArea } from "@/components/ui/scroll-area";
import { toast } from "sonner";
import { SmartTriggerDialog, type SmartTriggerRule } from "./SmartTriggerDialog";
import { JsonPathTree } from "./JsonPathTree";
import { WebhookTokenCard } from "./WebhookTokenCard";
import { formatUserError } from "@/lib/formatUserError";

interface FilterPreset {
  id: string;
  name: string;
  search: string;
  modeFilter: "all" | "shortcut" | "automation";
  statusFilter: "all" | "failed_recent" | "success_recent";
  failedRange: "1h" | "6h" | "24h" | "7d";
  errorTypeFilter: string;
}

const PRESETS_STORAGE_KEY = "smart_trigger_filter_presets_v1";

type SupabaseFluentQuery = {
  select: (s: string) => SupabaseFluentQuery;
  eq: (k: string, v: string | boolean | null) => SupabaseFluentQuery;
  in: (k: string, v: string[]) => SupabaseFluentQuery;
  gte: (k: string, v: string) => SupabaseFluentQuery;
  lt: (k: string, v: string) => SupabaseFluentQuery;
  order: (k: string, o: { ascending: boolean }) => SupabaseFluentQuery;
  limit: (n: number) => Promise<{ data: Record<string, unknown>[] | null; error: { message: string } | null }>;
  insert: (row: Record<string, unknown>) => Promise<{ error: { message: string } | null }>;
  update: (patch: Record<string, unknown>) => SupabaseFluentQuery;
  delete: () => SupabaseFluentQuery;
};
type SupabaseDyn = { from: (t: string) => SupabaseFluentQuery };
const db = supabase as unknown as SupabaseDyn;

const SOURCE_META: Record<string, { icon: React.ElementType; color: string; label: { zh: string; en: string; ja: string } }> = {
  remote: { icon: Radio, color: "text-blue-500", label: { zh: "遙控器", en: "Remote", ja: "リモコン" } },
  gpio: { icon: Cpu, color: "text-purple-500", label: { zh: "GPIO", en: "GPIO", ja: "GPIO" } },
  api: { icon: KeyRound, color: "text-cyan-500", label: { zh: "API", en: "API", ja: "API" } },
  iot_sensor: { icon: Activity, color: "text-orange-500", label: { zh: "感測器", en: "Sensor", ja: "センサー" } },
  webhook: { icon: Webhook, color: "text-emerald-500", label: { zh: "Webhook", en: "Webhook", ja: "Webhook" } },
  schedule: { icon: Clock, color: "text-amber-500", label: { zh: "定時", en: "Scheduled", ja: "定時" } },
};

interface RuleRow extends SmartTriggerRule {
  id: string;
  target_name?: string;
}

interface LastRun {
  created_at: string;
  success: boolean;
  error_message: string | null;
  trigger_payload?: Record<string, unknown>;
  trigger_source?: string;
  trigger_key?: string;
}

export function SmartTriggerPanel() {
  const { language, t } = useLanguage();
  const { orgs } = useUserOrgs();
  const { isAdmin } = useUserRole();
  const { activeOrgId } = useActiveOrg();
  const [orgId, setOrgId] = useState<string>(activeOrgId ?? orgs[0]?.id ?? "");
  const [rules, setRules] = useState<RuleRow[]>([]);
  const [lastRuns, setLastRuns] = useState<Record<string, LastRun>>({});
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [modeFilter, setModeFilter] = useState<"all" | "shortcut" | "automation">("all");
  const [statusFilter, setStatusFilter] = useState<"all" | "failed_recent" | "success_recent">("all");
  const [failedRange, setFailedRange] = useState<"1h" | "6h" | "24h" | "7d">("24h");
  const [errorTypeFilter, setErrorTypeFilter] = useState<string>("all");
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [copiedPath, setCopiedPath] = useState<string | null>(null);
  const [presets, setPresets] = useState<FilterPreset[]>([]);
  const [presetName, setPresetName] = useState("");
  const [activePresetId, setActivePresetId] = useState<string>("");
  const [retrying, setRetrying] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [detailsRule, setDetailsRule] = useState<RuleRow | null>(null);
  const [editing, setEditing] = useState<RuleRow | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [deleting, setDeleting] = useState<RuleRow | null>(null);
  const [attemptHistory, setAttemptHistory] = useState<LastRun[]>([]);
  const [selectedAttemptIdx, setSelectedAttemptIdx] = useState<number>(0);
  const [includeMetadata, setIncludeMetadata] = useState<boolean>(true);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [prettyPrint, setPrettyPrint] = useState<boolean>(true);
  const [historyHasMore, setHistoryHasMore] = useState<boolean>(false);
  const [loadingMoreHistory, setLoadingMoreHistory] = useState(false);
  const HISTORY_PAGE_SIZE = 20;

  useEffect(() => {
    if (!orgId && (activeOrgId || orgs[0]?.id)) setOrgId(activeOrgId ?? orgs[0]?.id ?? "");
  }, [activeOrgId, orgs, orgId]);

  const T = {
    title: { zh: "智能觸發規則", en: "Smart Trigger Rules", ja: "スマートトリガールール" }[language],
    subtitle: { zh: "建立組織級的捷徑與自動化規則，可套用到所有螢幕。", en: "Create org-wide shortcuts and automations that apply to screens.", ja: "組織レベルでショートカットと自動化を設定。" }[language],
    add: { zh: "新增規則", en: "New Rule", ja: "新規ルール" }[language],
    search: { zh: "搜尋規則名稱...", en: "Search rule name...", ja: "ルール名検索..." }[language],
    all: { zh: "全部", en: "All", ja: "すべて" }[language],
    shortcut: { zh: "捷徑", en: "Shortcut", ja: "ショートカット" }[language],
    automation: { zh: "自動化", en: "Automation", ja: "オートメーション" }[language],
    empty: { zh: "尚無規則。點「新增規則」開始建立。", en: "No rules yet. Click \"New Rule\" to get started.", ja: "ルールがありません。「新規ルール」から作成してください。" }[language],
    edit: { zh: "編輯", en: "Edit", ja: "編集" }[language],
    delete: { zh: "刪除", en: "Delete", ja: "削除" }[language],
    deleteTitle: { zh: "刪除規則", en: "Delete rule?", ja: "ルールを削除？" }[language],
    deleteDesc: { zh: "此操作無法復原。", en: "This cannot be undone.", ja: "この操作は元に戻せません。" }[language],
    deleted: { zh: "已刪除", en: "Deleted", ja: "削除しました" }[language],
    cancel: { zh: "取消", en: "Cancel", ja: "キャンセル" }[language],
    confirm: { zh: "確認刪除", en: "Confirm Delete", ja: "削除確認" }[language],
    when: { zh: "當", en: "WHEN", ja: "いつ" }[language],
    then: { zh: "就", en: "THEN", ja: "なら" }[language],
    duration: { zh: "持續", en: "for", ja: "継続" }[language],
    sec: { zh: "秒", en: "s", ja: "秒" }[language],
    noOrg: { zh: "請先選擇組織", en: "Select an organization first", ja: "組織を選択してください" }[language],
    org: { zh: "組織", en: "Organization", ja: "組織" }[language],
    lastRun: { zh: "最近執行", en: "Last run", ja: "最終実行" }[language],
    success: { zh: "成功", en: "Success", ja: "成功" }[language],
    failed: { zh: "失敗", en: "Failed", ja: "失敗" }[language],
    neverRun: { zh: "尚未執行", en: "Never run", ja: "未実行" }[language],
    statusAll: { zh: "全部狀態", en: "All status", ja: "すべての状態" }[language],
    failedRecent: { zh: "近 24h 失敗", en: "Failed in 24h", ja: "24h以内失敗" }[language],
    successRecent: { zh: "近期成功", en: "Recently succeeded", ja: "最近成功" }[language],
    rangeLabel: { zh: "失敗時間範圍", en: "Failure window", ja: "失敗時間範囲" }[language],
    range1h: { zh: "近 1 小時", en: "Last 1h", ja: "直近1時間" }[language],
    range6h: { zh: "近 6 小時", en: "Last 6h", ja: "直近6時間" }[language],
    range24h: { zh: "近 24 小時", en: "Last 24h", ja: "直近24時間" }[language],
    range7d: { zh: "近 7 天", en: "Last 7d", ja: "直近7日" }[language],
    retry: { zh: "立即重試", en: "Retry now", ja: "今すぐ再試行" }[language],
    retrying: { zh: "重試中...", en: "Retrying...", ja: "再試行中..." }[language],
    retryDone: { zh: "已記錄重試", en: "Retry recorded", ja: "再試行を記録" }[language],
    exportCsv: { zh: "匯出失敗紀錄", en: "Export failed logs", ja: "失敗ログを書出" }[language],
    exportEmpty: { zh: "範圍內沒有失敗紀錄", en: "No failed logs in range", ja: "範囲内に失敗ログなし" }[language],
    exportDone: { zh: "已下載 CSV", en: "CSV downloaded", ja: "CSVをダウンロード" }[language],
    errorTypeAll: { zh: "全部錯誤類型", en: "All error types", ja: "すべてのエラー種別" }[language],
    errorTypeLabel: { zh: "錯誤類型", en: "Error type", ja: "エラー種別" }[language],
    errorTotalLabel: { zh: "失敗總數", en: "Total failures", ja: "失敗合計" }[language],
    copy: { zh: "複製", en: "Copy", ja: "コピー" }[language],
    copied: { zh: "已複製", en: "Copied", ja: "コピーしました" }[language],
    copyPath: { zh: "複製路徑", en: "Copy path", ja: "パスをコピー" }[language],
    downloadJson: { zh: "下載 JSON", en: "Download JSON", ja: "JSONをダウンロード" }[language],
    downloadJsonEmpty: { zh: "沒有可下載的 Payload", en: "No payload to download", ja: "ダウンロードできるペイロードなし" }[language],
    downloadJsonInvalid: { zh: "Payload 含有無法序列化的值，無法下載", en: "Payload has non-serializable values; cannot download", ja: "ペイロードにシリアライズ不可な値があります" }[language],
    attemptLabel: { zh: "選擇嘗試", en: "Attempt", ja: "試行" }[language],
    attemptN: { zh: "第 {n} 次", en: "Attempt #{n}", ja: "{n}回目" }[language],
    attemptLatest: { zh: "（最新）", en: " (latest)", ja: "（最新）" }[language],
    attemptLoading: { zh: "載入嘗試紀錄...", en: "Loading attempts...", ja: "履歴を読み込み中..." }[language],
    attemptNone: { zh: "沒有歷史紀錄", en: "No previous attempts", ja: "履歴がありません" }[language],
    includeMeta: { zh: "包含 metadata", en: "Include metadata", ja: "メタデータを含む" }[language],
    includeMetaHint: { zh: "輸出檔加入規則名稱、觸發 ID、時間與錯誤", en: "Add rule name, trigger id, time and error to file", ja: "ルール名/ID/時刻/エラーをファイルに追加" }[language],
    prettyPrint: { zh: "格式化輸出", en: "Pretty print JSON", ja: "整形して出力" }[language],
    prettyPrintHint: { zh: "啟用時以縮排輸出，便於閱讀", en: "When on, indent the file for readability", ja: "オンでインデント出力" }[language],
    downloadContext: { zh: "下載失敗情境", en: "Download with context", ja: "コンテキスト付きで出力" }[language],
    downloadContextHint: { zh: "包含此次失敗與前後相鄰紀錄", en: "Includes this failure and surrounding logs", ja: "前後のログを含めます" }[language],
    loadMore: { zh: "載入更多", en: "Load more", ja: "もっと読み込む" }[language],
    loading: { zh: "載入中...", en: "Loading...", ja: "読込中..." }[language],
    presets: { zh: "篩選預設", en: "Presets", ja: "プリセット" }[language],
    savePreset: { zh: "儲存目前篩選", en: "Save current filter", ja: "現在の絞込を保存" }[language],
    presetNamePh: { zh: "預設名稱", en: "Preset name", ja: "プリセット名" }[language],
    presetSaved: { zh: "已儲存預設", en: "Preset saved", ja: "プリセットを保存しました" }[language],
    presetDeleted: { zh: "已刪除預設", en: "Preset deleted", ja: "プリセットを削除しました" }[language],
    presetEmpty: { zh: "尚無已儲存的預設", en: "No saved presets", ja: "保存済みプリセットなし" }[language],
    apply: { zh: "套用", en: "Apply", ja: "適用" }[language],
    presetNameRequired: { zh: "請輸入預設名稱", en: "Enter a preset name", ja: "プリセット名を入力" }[language],
    detailsTitle: { zh: "失敗詳情", en: "Failure details", ja: "失敗の詳細" }[language],
    detailsDesc: { zh: "最近一次執行的完整資訊", en: "Full info of the last run", ja: "最終実行の詳細情報" }[language],
    timestamp: { zh: "時間", en: "Timestamp", ja: "時刻" }[language],
    errorMsg: { zh: "錯誤訊息", en: "Error message", ja: "エラーメッセージ" }[language],
    payload: { zh: "觸發 Payload", en: "Trigger payload", ja: "トリガーペイロード" }[language],
    source: { zh: "來源", en: "Source", ja: "ソース" }[language],
    viewDetails: { zh: "查看詳情", en: "View details", ja: "詳細を見る" }[language],
  };

  const fetchRules = async () => {
    if (!orgId) return;
    setLoading(true);
    const { data, error } = await db
      .from("smart_trigger_rules")
      .select("*, design_projects:target_design_project_id(name)")
      .eq("org_id", orgId)
      .eq("scope", "org")
      .order("created_at", { ascending: false });
    setLoading(false);
    if (error) { toast.error(formatUserError(error, t)); return; }
    const ruleRows = (data || []).map((r) => ({ ...r, target_name: (r.design_projects as { name?: string } | null)?.name }));
    setRules(ruleRows as unknown as RuleRow[]);
    // Fetch latest log per rule
    const ids = ruleRows.map((r) => String(r.id));
    if (ids.length === 0) { setLastRuns({}); return; }
    const { data: logs } = await db
      .from("smart_trigger_logs")
      .select("rule_id, created_at, success, error_message, trigger_payload, trigger_source, trigger_key")
      .in("rule_id", ids)
      .order("created_at", { ascending: false })
      .limit(500);
    const map: Record<string, LastRun> = {};
    (logs || []).forEach((l) => {
      const ruleId = String(l.rule_id ?? "");
      if (ruleId && !map[ruleId]) {
        map[ruleId] = {
          created_at: String(l.created_at ?? ""),
          success: Boolean(l.success),
          error_message: l.error_message != null ? String(l.error_message) : null,
          trigger_payload: l.trigger_payload as Record<string, unknown> | undefined,
          trigger_source: l.trigger_source != null ? String(l.trigger_source) : undefined,
          trigger_key: l.trigger_key != null ? String(l.trigger_key) : undefined,
        };
      }
    });
    setLastRuns(map);
  };

  useEffect(() => { fetchRules(); /* eslint-disable-next-line */ }, [orgId]);

  // Fetch attempt history when the failure drawer opens for a rule.
  useEffect(() => {
    if (!detailsRule) {
      setAttemptHistory([]);
      setSelectedAttemptIdx(0);
      setHistoryHasMore(false);
      return;
    }
    let cancelled = false;
    (async () => {
      setLoadingHistory(true);
      const { data } = await db
        .from("smart_trigger_logs")
        .select("created_at, success, error_message, trigger_payload, trigger_source, trigger_key")
        .eq("rule_id", detailsRule.id)
        .order("created_at", { ascending: false })
        .limit(HISTORY_PAGE_SIZE);
      if (cancelled) return;
      const rows = (data || []) as LastRun[];
      setAttemptHistory(rows);
      setHistoryHasMore(rows.length === HISTORY_PAGE_SIZE);
      setSelectedAttemptIdx(0);
      setLoadingHistory(false);
    })();
    return () => { cancelled = true; };
  }, [detailsRule]);

  const loadMoreHistory = async () => {
    if (!detailsRule || loadingMoreHistory || !historyHasMore) return;
    setLoadingMoreHistory(true);
    const last = attemptHistory[attemptHistory.length - 1];
    const { data } = await db
      .from("smart_trigger_logs")
      .select("created_at, success, error_message, trigger_payload, trigger_source, trigger_key")
      .eq("rule_id", detailsRule.id)
      .order("created_at", { ascending: false })
      .lt("created_at", last?.created_at ?? new Date().toISOString())
      .limit(HISTORY_PAGE_SIZE);
    const rows = (data || []) as LastRun[];
    setAttemptHistory((prev) => [...prev, ...rows]);
    setHistoryHasMore(rows.length === HISTORY_PAGE_SIZE);
    setLoadingMoreHistory(false);
  };

  // Validate that a value can be safely serialized to JSON (no circular refs,
  // no functions / BigInt / undefined-only payloads). Returns the JSON string
  // on success or null on failure.
  const safeStringify = (value: unknown, indent: number = 2): string | null => {
    try {
      const seen = new WeakSet();
      const json = JSON.stringify(value, (_k, v) => {
        if (typeof v === "function") throw new Error("function");
        if (typeof v === "bigint") throw new Error("bigint");
        if (typeof v === "symbol") throw new Error("symbol");
        if (v && typeof v === "object") {
          if (seen.has(v)) throw new Error("circular");
          seen.add(v);
        }
        return v;
      }, indent);
      return typeof json === "string" ? json : null;
    } catch {
      return null;
    }
  };

  const rangeMs = useMemo(() => {
    switch (failedRange) {
      case "1h": return 60 * 60 * 1000;
      case "6h": return 6 * 60 * 60 * 1000;
      case "24h": return 24 * 60 * 60 * 1000;
      case "7d": return 7 * 24 * 60 * 60 * 1000;
    }
  }, [failedRange]);

  // Normalize an error message into a stable "type" pattern by stripping
  // numbers, UUIDs, quoted strings, and long hex sequences.
  const normalizeError = (msg: string | null | undefined): string => {
    if (!msg) return "";
    let s = msg.trim();
    s = s.replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, "<uuid>");
    s = s.replace(/"[^"]*"|'[^']*'/g, "<str>");
    s = s.replace(/\b\d+(\.\d+)?\b/g, "<n>");
    s = s.replace(/\s+/g, " ");
    return s.length > 120 ? s.slice(0, 120) + "…" : s;
  };

  const errorTypeOptions = useMemo(() => {
    const counts = new Map<string, number>();
    Object.values(lastRuns).forEach((lr) => {
      if (!lr.success && lr.error_message) {
        const key = normalizeError(lr.error_message);
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
    });
    return Array.from(counts.entries()).sort((a, b) => b[1] - a[1]).slice(0, 20);
  }, [lastRuns]);

  const errorTypeTotal = useMemo(() => {
    if (errorTypeFilter === "all") return 0;
    return errorTypeOptions.find(([k]) => k === errorTypeFilter)?.[1] ?? 0;
  }, [errorTypeFilter, errorTypeOptions]);

  // ---------- Filter presets (localStorage) ----------
  useEffect(() => {
    try {
      const raw = localStorage.getItem(PRESETS_STORAGE_KEY);
      if (raw) setPresets(JSON.parse(raw));
    } catch { /* ignore */ }
  }, []);

  const persistPresets = (next: FilterPreset[]) => {
    setPresets(next);
    try { localStorage.setItem(PRESETS_STORAGE_KEY, JSON.stringify(next)); } catch { /* ignore */ }
  };

  const handleSavePreset = () => {
    const name = presetName.trim();
    if (!name) { toast.error(T.presetNameRequired); return; }
    const id = `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const next: FilterPreset = { id, name, search, modeFilter, statusFilter, failedRange, errorTypeFilter };
    persistPresets([next, ...presets.filter((p) => p.name !== name)]);
    setActivePresetId(id);
    setPresetName("");
    toast.success(T.presetSaved);
  };

  const handleApplyPreset = (id: string) => {
    const p = presets.find((x) => x.id === id);
    if (!p) return;
    setSearch(p.search);
    setModeFilter(p.modeFilter);
    setStatusFilter(p.statusFilter);
    setFailedRange(p.failedRange);
    setErrorTypeFilter(p.errorTypeFilter);
    setActivePresetId(id);
  };

  const handleDeletePreset = (id: string) => {
    persistPresets(presets.filter((p) => p.id !== id));
    if (activePresetId === id) setActivePresetId("");
    toast.success(T.presetDeleted);
  };

  const copyToClipboard = async (text: string, key: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedKey(key);
      toast.success(T.copied);
      setTimeout(() => setCopiedKey((k) => (k === key ? null : k)), 1500);
    } catch {
      toast.error("Clipboard error");
    }
  };

  const handleCopyPath = (path: string) => {
    navigator.clipboard.writeText(path).then(() => {
      setCopiedPath(path);
      toast.success(`${T.copied}: ${path}`);
      setTimeout(() => setCopiedPath((p) => (p === path ? null : p)), 1500);
    }).catch(() => toast.error("Clipboard error"));
  };

  const filtered = useMemo(() => rules.filter((r) => {
    if (modeFilter !== "all" && r.mode !== modeFilter) return false;
    if (search.trim() && !r.name.toLowerCase().includes(search.toLowerCase())) return false;
    if (statusFilter === "failed_recent") {
      const lr = lastRuns[r.id];
      if (!lr || lr.success) return false;
      if (Date.now() - new Date(lr.created_at).getTime() > rangeMs) return false;
    }
    if (statusFilter === "success_recent") {
      const lr = lastRuns[r.id];
      if (!lr || !lr.success) return false;
      if (Date.now() - new Date(lr.created_at).getTime() > rangeMs) return false;
    }
    if (errorTypeFilter !== "all") {
      const lr = lastRuns[r.id];
      if (!lr || lr.success) return false;
      if (normalizeError(lr.error_message) !== errorTypeFilter) return false;
    }
    return true;
  }), [rules, modeFilter, search, statusFilter, lastRuns, rangeMs, errorTypeFilter]);

  const handleRetry = async (rule: RuleRow) => {
    setRetrying(rule.id);
    const { error } = await db.from("smart_trigger_logs").insert({
      org_id: orgId,
      rule_id: rule.id,
      screen_id: rule.screen_id ?? null,
      trigger_source: "manual",
      trigger_key: rule.trigger_key || "manual_retry",
      trigger_payload: { manual_retry: true, retried_at: new Date().toISOString() },
      success: true,
      error_message: null,
    });
    setRetrying(null);
    if (error) { toast.error(formatUserError(error, t)); return; }
    toast.success(T.retryDone);
    fetchRules();
  };

  const handleExportFailedCsv = async () => {
    if (!orgId) return;
    setExporting(true);
    const since = new Date(Date.now() - rangeMs).toISOString();
    const { data, error } = await db
      .from("smart_trigger_logs")
      .select("created_at, rule_id, trigger_source, trigger_key, error_message, trigger_payload")
      .eq("org_id", orgId)
      .eq("success", false)
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(2000);
    setExporting(false);
    if (error) { toast.error(formatUserError(error, t)); return; }
    if (!data || data.length === 0) { toast.info(T.exportEmpty); return; }
    const ruleNameById = new Map(rules.map((r) => [r.id, r.name]));
    const esc = (v: unknown) => {
      const s = v === null || v === undefined ? "" : typeof v === "string" ? v : JSON.stringify(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const header = ["created_at", "rule_id", "rule_name", "trigger_source", "trigger_key", "error_message", "trigger_payload"];
    const rows = data.map((l) => [
      l.created_at, l.rule_id, ruleNameById.get(String(l.rule_id ?? "")) || "",
      l.trigger_source, l.trigger_key, l.error_message, l.trigger_payload,
    ].map(esc).join(","));
    const csv = "\uFEFF" + header.join(",") + "\n" + rows.join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `smart_trigger_failed_${failedRange}_${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
    toast.success(T.exportDone);
  };

  const toggleEnabled = async (rule: RuleRow, enabled: boolean) => {
    setRules((prev) => prev.map((r) => r.id === rule.id ? { ...r, enabled } : r));
    const { error } = await db.from("smart_trigger_rules").update({ enabled }).eq("id", rule.id);
    if (error) {
      toast.error(formatUserError(error, t));
      setRules((prev) => prev.map((r) => r.id === rule.id ? { ...r, enabled: !enabled } : r));
    }
  };

  const handleDelete = async () => {
    if (!deleting) return;
    const { error } = await db.from("smart_trigger_rules").delete().eq("id", deleting.id);
    if (error) { toast.error(formatUserError(error, t)); return; }
    toast.success(T.deleted);
    setDeleting(null);
    fetchRules();
  };

  const openNew = () => { setEditing(null); setDialogOpen(true); };
  const openEdit = (r: RuleRow) => { setEditing(r); setDialogOpen(true); };

  return (
    <div className="space-y-4">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold flex items-center gap-2 text-foreground">
            <Zap className="w-5 h-5 text-primary" />
            {T.title}
          </h2>
          <p className="text-sm text-muted-foreground mt-1">{T.subtitle}</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {(isAdmin || orgs.length > 1) && (
            <Select value={orgId} onValueChange={setOrgId}>
              <SelectTrigger className="w-[200px] h-9">
                <SelectValue placeholder={T.org} />
              </SelectTrigger>
              <SelectContent>
                {orgs.map((o) => <SelectItem key={o.id} value={o.id}>{o.name}</SelectItem>)}
              </SelectContent>
            </Select>
          )}
          <Button onClick={openNew} disabled={!orgId} className="gap-2">
            <Plus className="w-4 h-4" />{T.add}
          </Button>
        </div>
      </div>

      {orgId && <WebhookTokenCard orgId={orgId} canManage={isAdmin} />}

      <Card className="p-3 flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={T.search} className="pl-9 h-9" />
        </div>
        <Select value={modeFilter} onValueChange={(v) => setModeFilter(v as "all" | "shortcut" | "automation")}>
          <SelectTrigger className="w-[140px] h-9"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{T.all}</SelectItem>
            <SelectItem value="shortcut">{T.shortcut}</SelectItem>
            <SelectItem value="automation">{T.automation}</SelectItem>
          </SelectContent>
        </Select>
        <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as "all" | "failed_recent" | "success_recent")}>
          <SelectTrigger className="w-[170px] h-9"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{T.statusAll}</SelectItem>
            <SelectItem value="failed_recent">{T.failedRecent}</SelectItem>
            <SelectItem value="success_recent">{T.successRecent}</SelectItem>
          </SelectContent>
        </Select>
        {(statusFilter === "failed_recent" || statusFilter === "success_recent") && (
          <Select value={failedRange} onValueChange={(v) => setFailedRange(v as "1h" | "6h" | "24h" | "7d")}>
            <SelectTrigger className="w-[140px] h-9" title={T.rangeLabel}><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="1h">{T.range1h}</SelectItem>
              <SelectItem value="6h">{T.range6h}</SelectItem>
              <SelectItem value="24h">{T.range24h}</SelectItem>
              <SelectItem value="7d">{T.range7d}</SelectItem>
            </SelectContent>
          </Select>
        )}
        {errorTypeOptions.length > 0 && (
          <div className="flex items-center gap-1.5">
            <Select value={errorTypeFilter} onValueChange={setErrorTypeFilter}>
              <SelectTrigger className="w-[220px] h-9" title={T.errorTypeLabel}><SelectValue /></SelectTrigger>
              <SelectContent className="max-w-[420px]">
                <SelectItem value="all">{T.errorTypeAll}</SelectItem>
                {errorTypeOptions.map(([key, count]) => (
                  <SelectItem key={key} value={key}>
                    <span className="truncate inline-block max-w-[320px] align-middle">{key}</span>
                    <span className="ml-2 text-muted-foreground text-xs">({count})</span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {errorTypeFilter !== "all" && (
              <Badge
                variant="outline"
                className="h-9 gap-1 bg-destructive/10 border-destructive/30 text-destructive px-2"
                title={T.errorTotalLabel}
              >
                <XCircle className="w-3.5 h-3.5" />
                <span className="text-xs font-semibold">{errorTypeTotal}</span>
                <button
                  type="button"
                  onClick={() => setErrorTypeFilter("all")}
                  className="ml-0.5 opacity-70 hover:opacity-100"
                  aria-label="Clear error type filter"
                >
                  <XIcon className="w-3 h-3" />
                </button>
              </Badge>
            )}
          </div>
        )}
        <Button
          variant="outline"
          size="sm"
          className="h-9 gap-2"
          onClick={handleExportFailedCsv}
          disabled={!orgId || exporting}
        >
          {exporting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
          {T.exportCsv}
        </Button>
      </Card>

      <Card className="p-3 flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
          <BookmarkCheck className="w-4 h-4" />
          {T.presets}
        </div>
        {presets.length === 0 ? (
          <span className="text-xs text-muted-foreground italic">{T.presetEmpty}</span>
        ) : (
          <div className="flex flex-wrap items-center gap-1.5">
            {presets.map((p) => (
              <Badge
                key={p.id}
                variant={activePresetId === p.id ? "default" : "outline"}
                className="h-7 gap-1 cursor-pointer pl-2 pr-1"
                onClick={() => handleApplyPreset(p.id)}
                title={T.apply}
              >
                <span className="text-xs">{p.name}</span>
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); handleDeletePreset(p.id); }}
                  className="ml-0.5 opacity-70 hover:opacity-100"
                  aria-label="Delete preset"
                >
                  <XIcon className="w-3 h-3" />
                </button>
              </Badge>
            ))}
          </div>
        )}
        <div className="flex items-center gap-1.5 ml-auto">
          <Input
            value={presetName}
            onChange={(e) => setPresetName(e.target.value)}
            placeholder={T.presetNamePh}
            className="h-9 w-[180px]"
            onKeyDown={(e) => { if (e.key === "Enter") handleSavePreset(); }}
          />
          <Button size="sm" variant="outline" className="h-9 gap-2" onClick={handleSavePreset}>
            <Save className="w-4 h-4" />
            {T.savePreset}
          </Button>
        </div>
      </Card>

      {!orgId ? (
        <Card className="p-12 text-center text-muted-foreground">{T.noOrg}</Card>
      ) : loading ? (
        <Card className="p-12 flex items-center justify-center text-muted-foreground"><Loader2 className="w-5 h-5 animate-spin mr-2" /> ...</Card>
      ) : filtered.length === 0 ? (
        <Card className="p-12 text-center text-muted-foreground">{T.empty}</Card>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {filtered.map((r) => {
            const meta = SOURCE_META[r.trigger_source];
            const Icon = meta?.icon ?? Zap;
            const cond = r.trigger_condition as { op?: string; value?: number };
            return (
              <Card key={r.id} className={`p-4 transition ${r.enabled ? "" : "opacity-60"}`}>
                <div className="flex items-start gap-3">
                  <div className={`shrink-0 w-10 h-10 rounded-lg bg-muted flex items-center justify-center ${meta?.color ?? "text-primary"}`}>
                    <Icon className="w-5 h-5" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className="font-semibold text-foreground truncate">{r.name}</h3>
                      <Badge variant={r.mode === "shortcut" ? "default" : "secondary"} className="text-[10px]">
                        {r.mode === "shortcut" ? T.shortcut : T.automation}
                      </Badge>
                    </div>
                    {r.description && <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1">{r.description}</p>}
                    <div className="mt-2 text-xs space-y-1">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <Badge variant="outline" className="bg-amber-500/10 border-amber-500/30 text-amber-700 dark:text-amber-400 px-1.5 py-0 text-[10px]">{T.when}</Badge>
                        <span className="text-muted-foreground">{meta?.label[language]}</span>
                        <code className="px-1.5 py-0.5 bg-muted rounded text-[10px]">{r.trigger_key || "—"}</code>
                        {r.trigger_source === "iot_sensor" && cond?.op && cond?.value !== undefined && (
                          <span className="text-muted-foreground">{cond.op === "gt" ? ">" : cond.op === "gte" ? "≥" : cond.op === "lt" ? "<" : cond.op === "lte" ? "≤" : "="} {cond.value}</span>
                        )}
                      </div>
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <Badge variant="outline" className="bg-emerald-500/10 border-emerald-500/30 text-emerald-700 dark:text-emerald-400 px-1.5 py-0 text-[10px]">{T.then}</Badge>
                        <span className="text-foreground font-medium truncate">{r.target_name || "—"}</span>
                        {r.duration_seconds > 0 && (
                          <span className="text-muted-foreground">· {T.duration} {r.duration_seconds}{T.sec}</span>
                        )}
                      </div>
                      {(() => {
                        const lr = lastRuns[r.id];
                        return (
                          <div className="flex items-start gap-1.5 flex-wrap pt-1 border-t border-border/40 mt-1">
                            <Badge variant="outline" className="bg-muted px-1.5 py-0 text-[10px] flex items-center gap-1">
                              <History className="w-3 h-3" />{T.lastRun}
                            </Badge>
                            {!lr ? (
                              <span className="text-muted-foreground italic">{T.neverRun}</span>
                            ) : (
                              <>
                                {lr.success ? (
                                  <span className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400 font-medium">
                                    <CheckCircle2 className="w-3 h-3" />{T.success}
                                  </span>
                                ) : (
                                  <button
                                    type="button"
                                    onClick={() => setDetailsRule(r)}
                                    className="inline-flex items-center gap-1 text-destructive font-medium hover:underline focus:outline-none focus:underline"
                                    title={T.viewDetails}
                                  >
                                    <XCircle className="w-3 h-3" />{T.failed}
                                  </button>
                                )}
                                <span className="text-muted-foreground" title={new Date(lr.created_at).toLocaleString()}>
                                  {new Date(lr.created_at).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                                </span>
                                {!lr.success && lr.error_message && (
                                  <span className="text-destructive/80 truncate max-w-full" title={lr.error_message}>· {lr.error_message}</span>
                                )}
                              </>
                            )}
                          </div>
                        );
                      })()}
                    </div>
                  </div>
                  <Switch checked={r.enabled} onCheckedChange={(v) => toggleEnabled(r, v)} />
                </div>
                <div className="mt-3 flex justify-end gap-1">
                  {lastRuns[r.id] && !lastRuns[r.id].success && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => handleRetry(r)}
                      disabled={retrying === r.id}
                      className="gap-1 h-8 text-amber-600 hover:text-amber-700 dark:text-amber-400"
                    >
                      {retrying === r.id
                        ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        : <RefreshCw className="w-3.5 h-3.5" />}
                      {retrying === r.id ? T.retrying : T.retry}
                    </Button>
                  )}
                  <Button size="sm" variant="ghost" onClick={() => openEdit(r)} className="gap-1 h-8">
                    <Pencil className="w-3.5 h-3.5" />{T.edit}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setDeleting(r)} className="gap-1 h-8 text-destructive hover:text-destructive">
                    <Trash2 className="w-3.5 h-3.5 text-destructive" />{T.delete}
                  </Button>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {orgId && (
        <SmartTriggerDialog
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          orgId={orgId}
          rule={editing}
          onSaved={fetchRules}
        />
      )}

      <AlertDialog open={!!deleting} onOpenChange={(o) => !o && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{T.deleteTitle}</AlertDialogTitle>
            <AlertDialogDescription>{deleting?.name} — {T.deleteDesc}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{T.cancel}</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} className="bg-destructive hover:bg-destructive/90">{T.confirm}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Sheet open={!!detailsRule} onOpenChange={(o) => !o && setDetailsRule(null)}>
        <SheetContent side="right" className="w-full sm:max-w-lg flex flex-col">
          <SheetHeader>
            <SheetTitle className="flex items-center gap-2">
              <XCircle className="w-5 h-5 text-destructive" />
              {T.detailsTitle}
            </SheetTitle>
            <SheetDescription>{detailsRule?.name} — {T.detailsDesc}</SheetDescription>
          </SheetHeader>
          <ScrollArea className="flex-1 mt-4 pr-4">
            {detailsRule && (() => {
              // Prefer the attempt picked from history; fall back to the
              // most-recent run cached on the card.
              const lr: LastRun | undefined =
                attemptHistory[selectedAttemptIdx] ?? lastRuns[detailsRule.id];
              if (!lr) {
                return loadingHistory
                  ? <p className="text-sm text-muted-foreground">{T.attemptLoading}</p>
                  : <p className="text-sm text-muted-foreground">{T.neverRun}</p>;
              }
              const handleDownload = () => {
                if (!lr.trigger_payload) { toast(T.downloadJsonEmpty); return; }
                const exportObj = includeMetadata
                  ? {
                      metadata: {
                        rule_id: detailsRule.id,
                        rule_name: detailsRule.name,
                        trigger_source: lr.trigger_source ?? null,
                        trigger_key: lr.trigger_key ?? null,
                        created_at: lr.created_at,
                        success: lr.success,
                        error_message: lr.error_message ?? null,
                        exported_at: new Date().toISOString(),
                      },
                      payload: lr.trigger_payload,
                    }
                  : lr.trigger_payload;
                const json = safeStringify(exportObj, prettyPrint ? 2 : 0);
                if (!json) { toast.error(T.downloadJsonInvalid); return; }
                const blob = new Blob([json], { type: "application/json;charset=utf-8" });
                const url = URL.createObjectURL(blob);
                const a = document.createElement("a");
                const ruleName = (detailsRule.name || "rule").replace(/[^a-zA-Z0-9_-]+/g, "_");
                const ts = new Date(lr.created_at).toISOString().replace(/[:.]/g, "-");
                a.href = url;
                a.download = `smart-trigger-payload_${ruleName}_${ts}.json`;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                URL.revokeObjectURL(url);
              };
              // Build a "failure context" export — selected attempt plus
              // surrounding attempts (up to 5 before, 2 after) for triage.
              const handleDownloadContext = () => {
                const i = selectedAttemptIdx;
                // history is sorted newest -> oldest, so "after" = lower idx.
                const after = attemptHistory.slice(Math.max(0, i - 2), i);
                const focus = attemptHistory[i];
                const before = attemptHistory.slice(i + 1, i + 6);
                if (!focus) { toast(T.downloadJsonEmpty); return; }
                const toEntry = (a: LastRun) => ({
                  created_at: a.created_at,
                  success: a.success,
                  trigger_source: a.trigger_source ?? null,
                  trigger_key: a.trigger_key ?? null,
                  error_message: a.error_message ?? null,
                  trigger_payload: a.trigger_payload ?? null,
                });
                const exportObj = {
                  metadata: {
                    rule_id: detailsRule.id,
                    rule_name: detailsRule.name,
                    exported_at: new Date().toISOString(),
                    focus_attempt_at: focus.created_at,
                    counts: { preceding: before.length, following: after.length },
                  },
                  focus: toEntry(focus),
                  preceding_logs: before.map(toEntry),
                  following_logs: after.map(toEntry),
                };
                const json = safeStringify(exportObj, prettyPrint ? 2 : 0);
                if (!json) { toast.error(T.downloadJsonInvalid); return; }
                const blob = new Blob([json], { type: "application/json;charset=utf-8" });
                const url = URL.createObjectURL(blob);
                const a = document.createElement("a");
                const ruleName = (detailsRule.name || "rule").replace(/[^a-zA-Z0-9_-]+/g, "_");
                const ts = new Date(focus.created_at).toISOString().replace(/[:.]/g, "-");
                a.href = url;
                a.download = `smart-trigger-context_${ruleName}_${ts}.json`;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                URL.revokeObjectURL(url);
              };
              return (
                <div className="space-y-4 text-sm">
                  {/* Attempt selector */}
                  <div className="rounded-md border border-border/60 bg-muted/30 p-3 space-y-2">
                    <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                      {T.attemptLabel}
                    </div>
                    {loadingHistory ? (
                      <div className="text-xs text-muted-foreground flex items-center gap-2">
                        <Loader2 className="w-3 h-3 animate-spin" /> {T.attemptLoading}
                      </div>
                    ) : attemptHistory.length === 0 ? (
                      <div className="text-xs text-muted-foreground">{T.attemptNone}</div>
                    ) : (
                      <Select
                        value={String(selectedAttemptIdx)}
                        onValueChange={(v) => setSelectedAttemptIdx(Number(v))}
                      >
                        <SelectTrigger className="h-8 text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent className="max-h-72">
                          {attemptHistory.map((a, i) => (
                            <SelectItem key={`${a.created_at}-${i}`} value={String(i)} className="text-xs">
                              <span className="flex items-center gap-2">
                                {a.success
                                  ? <CheckCircle2 className="w-3 h-3 text-emerald-500" />
                                  : <XCircle className="w-3 h-3 text-destructive" />}
                                {T.attemptN.replace("{n}", String(attemptHistory.length - i))}
                                {i === 0 ? T.attemptLatest : ""}
                                <span className="text-muted-foreground">
                                  · {new Date(a.created_at).toLocaleString()}
                                </span>
                              </span>
                            </SelectItem>
                          ))}
                          {historyHasMore && (
                            <div className="p-1 border-t border-border/60 sticky bottom-0 bg-popover">
                              <Button
                                size="sm"
                                variant="ghost"
                                className="w-full h-7 text-xs"
                                disabled={loadingMoreHistory}
                                onMouseDown={(e) => { e.preventDefault(); loadMoreHistory(); }}
                              >
                                {loadingMoreHistory
                                  ? <><Loader2 className="w-3 h-3 mr-1 animate-spin" />{T.loading}</>
                                  : <>{T.loadMore} (+{HISTORY_PAGE_SIZE})</>}
                              </Button>
                            </div>
                          )}
                        </SelectContent>
                      </Select>
                    )}
                  </div>

                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">{T.timestamp}</div>
                      <Button size="sm" variant="ghost" className="h-6 px-2 gap-1 text-xs"
                        onClick={() => copyToClipboard(new Date(lr.created_at).toISOString(), "ts")}>
                        {copiedKey === "ts" ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                        {copiedKey === "ts" ? T.copied : T.copy}
                      </Button>
                    </div>
                    <div className="text-foreground">{new Date(lr.created_at).toLocaleString()}</div>
                  </div>
                  <div>
                    <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">{T.source}</div>
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className="text-[10px]">{lr.trigger_source || "—"}</Badge>
                      {lr.trigger_key && (
                        <code className="px-1.5 py-0.5 bg-muted rounded text-xs">{lr.trigger_key}</code>
                      )}
                    </div>
                  </div>
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">{T.errorMsg}</div>
                      <Button size="sm" variant="ghost" className="h-6 px-2 gap-1 text-xs"
                        disabled={!lr.error_message}
                        onClick={() => copyToClipboard(lr.error_message || "", "err")}>
                        {copiedKey === "err" ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                        {copiedKey === "err" ? T.copied : T.copy}
                      </Button>
                    </div>
                    <pre className="bg-destructive/10 border border-destructive/30 text-destructive rounded-md p-3 text-xs whitespace-pre-wrap break-words">
                      {lr.error_message || "—"}
                    </pre>
                  </div>
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">{T.payload}</div>
                      <div className="flex items-center gap-1">
                        <Button size="sm" variant="ghost" className="h-6 px-2 gap-1 text-xs"
                          disabled={!lr.trigger_payload}
                          onClick={handleDownload}>
                          <Download className="w-3 h-3" />
                          {T.downloadJson}
                        </Button>
                        <Button size="sm" variant="ghost" className="h-6 px-2 gap-1 text-xs"
                          title={T.downloadContextHint}
                          disabled={attemptHistory.length === 0}
                          onClick={handleDownloadContext}>
                          <History className="w-3 h-3" />
                          {T.downloadContext}
                        </Button>
                        <Button size="sm" variant="ghost" className="h-6 px-2 gap-1 text-xs"
                          onClick={() => copyToClipboard(
                            lr.trigger_payload ? JSON.stringify(lr.trigger_payload, null, 2) : "{}",
                            "payload",
                          )}>
                          {copiedKey === "payload" ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                          {copiedKey === "payload" ? T.copied : T.copy}
                        </Button>
                      </div>
                    </div>
                    <label className="flex items-center gap-2 mb-2 text-[11px] text-muted-foreground select-none">
                      <Switch
                        checked={includeMetadata}
                        onCheckedChange={setIncludeMetadata}
                        className="scale-75 origin-left"
                      />
                      <span>
                        <span className="font-medium text-foreground">{T.includeMeta}</span>
                        {" — "}{T.includeMetaHint}
                      </span>
                    </label>
                    <label className="flex items-center gap-2 mb-2 text-[11px] text-muted-foreground select-none">
                      <Switch
                        checked={prettyPrint}
                        onCheckedChange={setPrettyPrint}
                        className="scale-75 origin-left"
                      />
                      <span>
                        <span className="font-medium text-foreground">{T.prettyPrint}</span>
                        {" — "}{T.prettyPrintHint}
                      </span>
                    </label>
                    <p className="text-[10px] text-muted-foreground mb-1">
                      {T.copyPath} — hover any field
                    </p>
                    <JsonPathTree
                      value={lr.trigger_payload ?? {}}
                      copiedPath={copiedPath}
                      onCopyPath={handleCopyPath}
                    />
                  </div>
                </div>
              );
            })()}
          </ScrollArea>
        </SheetContent>
      </Sheet>
    </div>
  );
}