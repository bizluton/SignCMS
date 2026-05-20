import { useEffect, useState } from "react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { useLanguage } from "@/contexts/LanguageContext";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Mail, Bell, Loader2, Save, Database, Trash2, Play, Image as ImageIcon, CheckCircle2, AlertCircle, Key, Plus, Copy, ShieldCheck, ShieldAlert, Clock, Smartphone, ExternalLink, ChevronDown, ChevronUp, QrCode } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import DbHealthPanel from "@/components/admin/DbHealthPanel";
import { formatUserError } from "@/lib/formatUserError";

interface EmailState {
  id: number;
  batch_size: number;
  send_delay_ms: number;
  auth_email_ttl_minutes: number;
  transactional_email_ttl_minutes: number;
}

interface CleanupSettings {
  retention_days: number;
  enabled: boolean;
  last_run_at: string | null;
  last_deleted_count: number;
  last_run_by: string | null;
  last_run_status: string;
  last_run_error: string | null;
  media_enabled: boolean;
  media_retention_days: number;
  media_last_run_at: string | null;
  media_last_deleted_count: number;
  media_last_run_by: string | null;
  media_last_run_status: string;
  media_last_run_error: string | null;
}

interface McpToken {
  id: string;
  org_id: string;
  user_id: string;
  name: string;
  permissions: string[];
  token_hash: string;
  last_used_at: string | null;
  expires_at: string | null;
  created_at: string;
  org_name?: string;
}

interface OrgOption {
  id: string;
  name: string;
}

const MCP_PERMISSIONS = ["read", "write", "emergency"] as const;

async function sha256hex(message: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(message));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("");
}

function generateRawToken(): string {
  const arr = new Uint8Array(32);
  crypto.getRandomValues(arr);
  return Array.from(arr).map(b => b.toString(16).padStart(2, "0")).join("");
}

const SystemSettingsPage = () => {
  const { t, language } = useLanguage();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [state, setState] = useState<EmailState | null>(null);

  const [cleanup, setCleanup] = useState<CleanupSettings | null>(null);
  const [cleanupLoading, setCleanupLoading] = useState(true);
  const [cleanupSaving, setCleanupSaving] = useState(false);
  const [runningNow, setRunningNow] = useState(false);
  const [runningMediaNow, setRunningMediaNow] = useState(false);
  const [runnerNames, setRunnerNames] = useState<Record<string, string>>({});
  const [confirmKind, setConfirmKind] = useState<null | "schedule" | "media">(null);
  const [runResult, setRunResult] = useState<
    null | { kind: "schedule" | "media"; success: boolean; deleted: number; error?: string; at: string }
  >(null);

  // MCP Tokens state
  const [mcpTokens, setMcpTokens] = useState<McpToken[]>([]);
  const [mcpLoading, setMcpLoading] = useState(true);
  const [orgs, setOrgs] = useState<OrgOption[]>([]);
  const [newTokenName, setNewTokenName] = useState("");
  const [newTokenOrgId, setNewTokenOrgId] = useState("");
  const [newTokenPerms, setNewTokenPerms] = useState<string[]>(["read", "write"]);
  const [creatingToken, setCreatingToken] = useState(false);
  const [createdRawToken, setCreatedRawToken] = useState<string | null>(null);
  const [showRawToken, setShowRawToken] = useState(false);
  const [revokeTarget,   setRevokeTarget]   = useState<McpToken | null>(null);
  const [reissueTarget,  setReissueTarget]  = useState<McpToken | null>(null);
  const [reissuing,      setReissuing]      = useState(false);

  // URL of the SignCMS Go PWA — shown in QR code & connect link.
  // Override via VITE_SIGNCMS_GO_URL in the dashboard's .env file.
  const GO_APP_URL: string =
    (import.meta.env as Record<string, string>).VITE_SIGNCMS_GO_URL || "https://go.signcms.com";

  const labels = {
    title: { zh: "系統設定", en: "System Settings", ja: "システム設定" },
    subtitle: { zh: "管理郵件佇列、通知與系統層級參數", en: "Manage email queue, notifications and system-level parameters", ja: "メールキュー、通知、システムレベルのパラメータを管理" },
    emailTab: { zh: "郵件設定", en: "Email", ja: "メール設定" },
    notifTab: { zh: "通知設定", en: "Notifications", ja: "通知設定" },
    queueTitle: { zh: "郵件佇列參數", en: "Email Queue Parameters", ja: "メールキューのパラメータ" },
    queueDesc: { zh: "調整郵件發送速率與超時設定，影響全系統郵件流量。", en: "Adjust email send rate and TTL. Affects all outgoing email throughput.", ja: "メール送信レートとTTLを調整。すべての送信メールに影響。" },
    batchSize: { zh: "每次批量大小 (batch_size)", en: "Batch size", ja: "バッチサイズ" },
    delay: { zh: "間隔毫秒 (send_delay_ms)", en: "Delay (ms)", ja: "遅延 (ms)" },
    authTtl: { zh: "Auth 郵件 TTL (分鐘)", en: "Auth email TTL (minutes)", ja: "認証メールTTL（分）" },
    txTtl: { zh: "交易郵件 TTL (分鐘)", en: "Transactional email TTL (minutes)", ja: "トランザクションメールTTL（分）" },
    save: { zh: "儲存設定", en: "Save", ja: "保存" },
    saved: { zh: "已儲存", en: "Saved", ja: "保存しました" },
    error: { zh: "儲存失敗", en: "Save failed", ja: "保存に失敗しました" },
    notifTitle: { zh: "通知設定", en: "Notifications", ja: "通知設定" },
    notifDesc: { zh: "目前通知由系統自動產生（授權到期、客服訊息等）。後續可在此擴充偏好設定。", en: "Notifications are currently auto-generated by the system (license expiry, CS messages, etc.). Preferences will be added here later.", ja: "通知は現在システムによって自動生成されます。今後ここで設定を拡張予定です。" },
    dbTab: { zh: "資料庫健康", en: "DB Health", ja: "DB 健全性" },
    cleanupTab: { zh: "排程清除", en: "Schedule Cleanup", ja: "スケジュール削除" },
    cleanupTitle: { zh: "排程自動清除設定", en: "Auto Schedule Cleanup", ja: "スケジュール自動削除" },
    cleanupDesc: {
      zh: "設定排程結束後保留天數，超過時間將永久刪除（不影響播放紀錄）。每日 03:15 UTC 自動執行。",
      en: "Configure how many days to keep finished schedule blocks. Expired ones will be permanently deleted (playback logs are kept). Runs daily at 03:15 UTC.",
      ja: "終了したスケジュールの保持日数を設定します。期限切れは永久削除されます（再生ログは保持）。毎日03:15 UTCに実行。",
    },
    retentionDays: { zh: "保留天數", en: "Retention days", ja: "保持日数" },
    cleanupEnabled: { zh: "啟用自動清除", en: "Enable auto cleanup", ja: "自動削除を有効化" },
    lastRun: { zh: "最近一次執行", en: "Last run", ja: "前回の実行" },
    lastDeleted: { zh: "最近清除筆數", en: "Last deleted", ja: "前回削除件数" },
    never: { zh: "尚未執行", en: "Never", ja: "未実行" },
    runNow: { zh: "立即執行清除", en: "Run cleanup now", ja: "今すぐ実行" },
    runSuccess: { zh: "已清除 {n} 筆過期排程", en: "Deleted {n} expired schedule(s)", ja: "{n}件の期限切れを削除しました" },
    runFailed: { zh: "執行失敗", en: "Run failed", ja: "実行失敗" },
    mediaCleanupTitle: { zh: "未使用媒體自動清除", en: "Unused Media Auto Cleanup", ja: "未使用メディアの自動削除" },
    mediaCleanupDesc: {
      zh: "刪除超過指定天數未被使用之圖片與影片。未使用是指：未綁定設計專案、未在頻道排程或事件觸發、未作為頻道 BGM。系統內建素材不會被刪除。",
      en: "Delete images/videos unused for the specified number of days. Unused means: not bound to any design project, not in channel schedules or smart triggers, and not used as channel BGM. System assets are never removed.",
      ja: "指定日数以上未使用の画像/動画を削除します。未使用とは：デザインプロジェクト未紐付け、チャンネルスケジュールやスマートトリガー未使用、BGM未使用。システム素材は削除されません。",
    },
    mediaRetentionDays: { zh: "未使用保留天數", en: "Unused retention days", ja: "未使用の保持日数" },
    mediaCleanupEnabled: { zh: "啟用媒體自動清除", en: "Enable media auto cleanup", ja: "メディア自動削除を有効化" },
    runMediaNow: { zh: "立即清除未使用媒體", en: "Run media cleanup now", ja: "今すぐメディアを削除" },
    runMediaSuccess: { zh: "已清除 {n} 筆未使用媒體", en: "Deleted {n} unused media item(s)", ja: "{n}件の未使用メディアを削除しました" },
    lastRunBy: { zh: "執行者", en: "Executed by", ja: "実行者" },
    statusLabel: { zh: "上次狀態", en: "Last status", ja: "前回の状態" },
    statusSuccess: { zh: "成功", en: "Success", ja: "成功" },
    statusFailed: { zh: "失敗", en: "Failed", ja: "失敗" },
    statusIdle: { zh: "尚未執行", en: "Not run yet", ja: "未実行" },
    systemRunner: { zh: "系統自動執行", en: "System (cron)", ja: "システム自動" },
    unknownUser: { zh: "未知使用者", en: "Unknown user", ja: "不明なユーザー" },
    confirmTitle: { zh: "確認執行清除？", en: "Run cleanup now?", ja: "クリーンアップを実行しますか？" },
    confirmScheduleDesc: {
      zh: "此操作將立即永久刪除超過保留天數的過期排程。已產生的播放紀錄不受影響，但排程資料無法復原。",
      en: "This will immediately and permanently delete expired schedule blocks beyond the retention window. Playback logs are kept, but schedule data cannot be recovered.",
      ja: "保持期間を超えた期限切れスケジュールを直ちに永久削除します。再生ログは残りますが、スケジュールデータは復元できません。",
    },
    confirmMediaDesc: {
      zh: "此操作將立即永久刪除超過保留天數且未被任何排程、設計專案、BGM 或觸發器使用的圖片與影片。檔案無法復原。",
      en: "This will immediately and permanently delete images and videos beyond the retention window that are not used by any schedule, design project, BGM, or trigger. Files cannot be recovered.",
      ja: "保持期間を超え、スケジュール・デザインプロジェクト・BGM・トリガーで未使用の画像と動画を直ちに永久削除します。復元できません。",
    },
    confirmRun: { zh: "確認執行", en: "Run now", ja: "実行する" },
    cancel: { zh: "取消", en: "Cancel", ja: "キャンセル" },
    resultTitle: { zh: "本次執行結果", en: "Latest run result", ja: "今回の実行結果" },
    resultAt: { zh: "完成時間", en: "Completed at", ja: "完了時刻" },
    resultDeleted: { zh: "刪除筆數", en: "Deleted count", ja: "削除件数" },
    resultKindSchedule: { zh: "排程清除", en: "Schedule cleanup", ja: "スケジュール削除" },
    resultKindMedia: { zh: "未使用媒體清除", en: "Unused media cleanup", ja: "未使用メディア削除" },
    dismiss: { zh: "關閉", en: "Dismiss", ja: "閉じる" },
    mcpTab: { zh: "MCP 金鑰", en: "MCP Tokens", ja: "MCPトークン" },
    mcpTitle: { zh: "MCP API 金鑰管理", en: "MCP API Token Management", ja: "MCP APIトークン管理" },
    mcpDesc: { zh: "為 SignCMS Go Player PWA 或其他 MCP 客戶端產生授權金鑰。金鑰原文僅顯示一次，請立即複製。", en: "Generate authorization tokens for SignCMS Go Player PWA or other MCP clients. The raw token is shown only once — copy it immediately.", ja: "SignCMS Go Player PWAまたは他のMCPクライアント向けの認証トークンを生成します。生トークンは一度しか表示されません。" },
    mcpNewTitle: { zh: "產生新金鑰", en: "Generate New Token", ja: "新しいトークンを生成" },
    mcpTokenName: { zh: "金鑰名稱", en: "Token name", ja: "トークン名" },
    mcpTokenNamePh: { zh: "e.g. 台北門市 iPad", en: "e.g. Taipei Store iPad", ja: "例: 東京店舗 iPad" },
    mcpOrg: { zh: "所屬組織", en: "Organization", ja: "組織" },
    mcpPerms: { zh: "權限", en: "Permissions", ja: "権限" },
    mcpGenerate: { zh: "產生金鑰", en: "Generate Token", ja: "トークンを生成" },
    mcpListTitle: { zh: "現有金鑰", en: "Existing Tokens", ja: "既存トークン" },
    mcpColName: { zh: "名稱", en: "Name", ja: "名前" },
    mcpColOrg: { zh: "組織", en: "Org", ja: "組織" },
    mcpColPerms: { zh: "權限", en: "Permissions", ja: "権限" },
    mcpColHash: { zh: "雜湊前綴", en: "Hash prefix", ja: "ハッシュ接頭辞" },
    mcpColLastUsed: { zh: "最近使用", en: "Last used", ja: "最終使用" },
    mcpColCreated: { zh: "建立時間", en: "Created", ja: "作成日時" },
    mcpRevoke: { zh: "撤銷", en: "Revoke", ja: "取り消す" },
    mcpRevokeTitle: { zh: "確認撤銷金鑰？", en: "Revoke this token?", ja: "トークンを取り消しますか？" },
    mcpRevokeDesc: { zh: "撤銷後所有使用此金鑰的客戶端將立即失去存取。此操作無法復原。", en: "All clients using this token will immediately lose access. This cannot be undone.", ja: "このトークンを使用する全クライアントのアクセスが直ちに失われます。取り消せません。" },
    mcpRevoked: { zh: "金鑰已撤銷", en: "Token revoked", ja: "トークンが取り消されました" },
    mcpCreatedTitle: { zh: "金鑰已產生", en: "Token generated", ja: "トークンが生成されました" },
    mcpCreatedDesc: { zh: "請立即複製此金鑰。關閉後將永遠無法再次查看。", en: "Copy this token now. It will never be shown again after you close this dialog.", ja: "今すぐコピーしてください。このダイアログを閉じると二度と表示されません。" },
    mcpCopy: { zh: "複製", en: "Copy", ja: "コピー" },
    mcpCopied: { zh: "已複製", en: "Copied!", ja: "コピーしました" },
    mcpClose: { zh: "我已複製，關閉", en: "I've copied it, close", ja: "コピー済み、閉じる" },
    mcpNeverUsed: { zh: "從未使用", en: "Never used", ja: "未使用" },
    mcpNoTokens: { zh: "尚無金鑰", en: "No tokens yet", ja: "トークンなし" },
  };
  const L = (k: keyof typeof labels) => labels[k][language];

  useEffect(() => {
    (async () => {
      const { data, error } = await supabase
        .from("email_send_state")
        .select("*")
        .eq("id", 1)
        .maybeSingle();
      if (!error && data) setState(data as EmailState);
      setLoading(false);
    })();
  }, []);

  const loadCleanup = async () => {
    setCleanupLoading(true);
    const { data, error } = await supabase
      .from("schedule_cleanup_settings")
      .select(
        "retention_days, enabled, last_run_at, last_deleted_count, last_run_by, last_run_status, last_run_error, media_enabled, media_retention_days, media_last_run_at, media_last_deleted_count, media_last_run_by, media_last_run_status, media_last_run_error",
      )
      .eq("id", 1)
      .maybeSingle();
    if (!error && data) {
      const c = data as CleanupSettings;
      setCleanup(c);
      const ids = Array.from(
        new Set([c.last_run_by, c.media_last_run_by].filter((x): x is string => !!x)),
      );
      if (ids.length > 0) {
        const { data: profs } = await supabase
          .from("profiles")
          .select("user_id, display_name")
          .in("user_id", ids);
        const map: Record<string, string> = {};
        (profs || []).forEach((p: { user_id: string; display_name: string | null }) => {
          map[p.user_id] = p.display_name || labels.unknownUser[language];
        });
        setRunnerNames(map);
      } else {
        setRunnerNames({});
      }
    }
    setCleanupLoading(false);
  };

  useEffect(() => {
    loadCleanup();
  }, []);

  const loadMcpTokens = async () => {
    setMcpLoading(true);
    const [tokRes, orgRes] = await Promise.all([
      supabase
        .from("mcp_tokens")
        .select("id, org_id, user_id, name, permissions, token_hash, last_used_at, expires_at, created_at, organizations(name)")
        .order("created_at", { ascending: false }),
      supabase.from("organizations").select("id, name").order("name"),
    ]);
    if (!tokRes.error && tokRes.data) {
      setMcpTokens(
        tokRes.data.map((t: any) => ({ ...t, org_name: t.organizations?.name })),
      );
    }
    if (!orgRes.error && orgRes.data) {
      setOrgs(orgRes.data as OrgOption[]);
      if (orgRes.data.length > 0) setNewTokenOrgId((prev) => prev || orgRes.data[0].id);
    }
    setMcpLoading(false);
  };

  useEffect(() => {
    loadMcpTokens();
  }, []);

  const handleCreateToken = async () => {
    if (!newTokenName.trim() || !newTokenOrgId || newTokenPerms.length === 0) return;
    setCreatingToken(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");
      const rawToken = generateRawToken();
      const tokenHash = await sha256hex(rawToken);
      const { error } = await supabase.from("mcp_tokens").insert({
        org_id: newTokenOrgId,
        user_id: user.id,
        name: newTokenName.trim(),
        token_hash: tokenHash,
        permissions: newTokenPerms,
      });
      if (error) throw error;
      setCreatedRawToken(rawToken);
      setNewTokenName("");
      setNewTokenPerms(["read", "write"]);
      await loadMcpTokens();
    } catch (e: any) {
      toast.error(formatUserError(e, t));
    } finally {
      setCreatingToken(false);
    }
  };

  // Re-issue: generate fresh raw token for an existing key, then show QR dialog.
  // Previous raw token is invalidated immediately in DB.
  const handleReissueToken = async () => {
    if (!reissueTarget) return;
    setReissuing(true);
    try {
      const rawToken  = generateRawToken();
      const tokenHash = await sha256hex(rawToken);
      const { error } = await supabase
        .from("mcp_tokens")
        .update({ token_hash: tokenHash, last_used_at: null, updated_at: new Date().toISOString() })
        .eq("id", reissueTarget.id);
      if (error) throw error;
      setReissueTarget(null);
      setShowRawToken(false);
      setCreatedRawToken(rawToken);   // reuse the existing QR dialog
      await loadMcpTokens();
    } catch (e: any) {
      toast.error(formatUserError(e, t));
    } finally {
      setReissuing(false);
    }
  };

  const handleRevokeToken = async () => {
    if (!revokeTarget) return;
    const { error } = await supabase.from("mcp_tokens").delete().eq("id", revokeTarget.id);
    if (error) {
      toast.error(formatUserError(error, t));
    } else {
      setMcpTokens((prev) => prev.filter((t) => t.id !== revokeTarget.id));
      toast.success(L("mcpRevoked"));
    }
    setRevokeTarget(null);
  };

  const handleSaveCleanup = async () => {
    if (!cleanup) return;
    setCleanupSaving(true);
    const { data, error } = await supabase.rpc("update_schedule_cleanup_settings", {
      _retention_days: cleanup.retention_days,
      _enabled: cleanup.enabled,
      _media_retention_days: cleanup.media_retention_days,
      _media_enabled: cleanup.media_enabled,
    });
    setCleanupSaving(false);
    const result = data as { success?: boolean; error?: string } | null;
    if (error || !result?.success) {
      toast.error(L("error"));
    } else {
      toast.success(L("saved"));
    }
  };

  const handleRunNow = async () => {
    setRunningNow(true);
    const { data, error } = await supabase.rpc("run_schedule_cleanup_now");
    setRunningNow(false);
    const result = data as { success?: boolean; deleted?: number; error?: string } | null;
    if (error || !result?.success) {
      const msg = error?.message || result?.error || L("runFailed");
      setRunResult({ kind: "schedule", success: false, deleted: 0, error: msg, at: new Date().toISOString() });
      toast.error(L("runFailed"));
      loadCleanup();
      return;
    }
    const n = result.deleted ?? 0;
    setRunResult({ kind: "schedule", success: true, deleted: n, at: new Date().toISOString() });
    toast.success(L("runSuccess").replace("{n}", String(n)));
    loadCleanup();
  };

  const handleRunMediaNow = async () => {
    setRunningMediaNow(true);
    const { data, error } = await supabase.rpc("run_media_cleanup_now");
    setRunningMediaNow(false);
    const result = data as { success?: boolean; deleted?: number; error?: string } | null;
    if (error || !result?.success) {
      const msg = error?.message || result?.error || L("runFailed");
      setRunResult({ kind: "media", success: false, deleted: 0, error: msg, at: new Date().toISOString() });
      toast.error(L("runFailed"));
      loadCleanup();
      return;
    }
    const n = result.deleted ?? 0;
    setRunResult({ kind: "media", success: true, deleted: n, at: new Date().toISOString() });
    toast.success(L("runMediaSuccess").replace("{n}", String(n)));
    loadCleanup();
  };

  const handleSave = async () => {
    if (!state) return;
    setSaving(true);
    const { error } = await supabase
      .from("email_send_state")
      .update({
        batch_size: state.batch_size,
        send_delay_ms: state.send_delay_ms,
        auth_email_ttl_minutes: state.auth_email_ttl_minutes,
        transactional_email_ttl_minutes: state.transactional_email_ttl_minutes,
      })
      .eq("id", 1);
    setSaving(false);
    if (error) {
      toast.error(L("error"));
    } else {
      toast.success(L("saved"));
    }
  };

  return (
    <DashboardLayout>
      <div className="flex flex-col h-full p-6 space-y-4 max-w-6xl">
        <div>
          <h1 className="text-xl font-bold text-foreground">{L("title")}</h1>
          <p className="text-sm text-muted-foreground mt-1">{L("subtitle")}</p>
        </div>

        <Tabs defaultValue="email" className="w-full">
          <TabsList>
            <TabsTrigger value="email"><Mail className="w-4 h-4 mr-1" />{L("emailTab")}</TabsTrigger>
            <TabsTrigger value="notif"><Bell className="w-4 h-4 mr-1" />{L("notifTab")}</TabsTrigger>
            <TabsTrigger value="db"><Database className="w-4 h-4 mr-1" />{L("dbTab")}</TabsTrigger>
            <TabsTrigger value="cleanup"><Trash2 className="w-4 h-4 mr-1 text-destructive" />{L("cleanupTab")}</TabsTrigger>
            <TabsTrigger value="mcp"><Key className="w-4 h-4 mr-1" />{L("mcpTab")}</TabsTrigger>
          </TabsList>

          <TabsContent value="email" className="mt-4">
            <Card>
              <CardHeader>
                <CardTitle>{L("queueTitle")}</CardTitle>
                <CardDescription>{L("queueDesc")}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {loading ? (
                  <div className="flex justify-center py-10">
                    <Loader2 className="w-6 h-6 animate-spin text-primary" />
                  </div>
                ) : state ? (
                  <>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div className="space-y-1.5">
                        <Label>{L("batchSize")}</Label>
                        <Input
                          type="number"
                          min={1}
                          value={state.batch_size}
                          onChange={(e) => setState({ ...state, batch_size: Number(e.target.value) })}
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label>{L("delay")}</Label>
                        <Input
                          type="number"
                          min={0}
                          value={state.send_delay_ms}
                          onChange={(e) => setState({ ...state, send_delay_ms: Number(e.target.value) })}
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label>{L("authTtl")}</Label>
                        <Input
                          type="number"
                          min={1}
                          value={state.auth_email_ttl_minutes}
                          onChange={(e) => setState({ ...state, auth_email_ttl_minutes: Number(e.target.value) })}
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label>{L("txTtl")}</Label>
                        <Input
                          type="number"
                          min={1}
                          value={state.transactional_email_ttl_minutes}
                          onChange={(e) => setState({ ...state, transactional_email_ttl_minutes: Number(e.target.value) })}
                        />
                      </div>
                    </div>
                    <div className="flex justify-end pt-2">
                      <Button onClick={handleSave} disabled={saving}>
                        {saving ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Save className="w-4 h-4 mr-1" />}
                        {L("save")}
                      </Button>
                    </div>
                  </>
                ) : null}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="notif" className="mt-4">
            <Card>
              <CardHeader>
                <CardTitle>{L("notifTitle")}</CardTitle>
                <CardDescription>{L("notifDesc")}</CardDescription>
              </CardHeader>
            </Card>
          </TabsContent>

          <TabsContent value="db" className="mt-4">
            <DbHealthPanel />
          </TabsContent>

          <TabsContent value="cleanup" className="mt-4">
            <Card>
              <CardHeader>
                <CardTitle>{L("cleanupTitle")}</CardTitle>
                <CardDescription>{L("cleanupDesc")}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {cleanupLoading ? (
                  <div className="flex justify-center py-10">
                    <Loader2 className="w-6 h-6 animate-spin text-primary" />
                  </div>
                ) : cleanup ? (
                  <>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div className="space-y-1.5">
                        <Label>{L("retentionDays")}</Label>
                        <Input
                          type="number"
                          min={1}
                          max={3650}
                          value={cleanup.retention_days}
                          onChange={(e) =>
                            setCleanup({ ...cleanup, retention_days: Number(e.target.value) })
                          }
                        />
                      </div>
                      <div className="flex items-center gap-3 pt-6">
                        <Switch
                          checked={cleanup.enabled}
                          onCheckedChange={(v) => setCleanup({ ...cleanup, enabled: v })}
                        />
                        <Label className="cursor-pointer">{L("cleanupEnabled")}</Label>
                      </div>
                    </div>

                    <div className="rounded-md border border-border bg-muted/30 p-4 space-y-2 text-sm">
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">{L("lastRun")}</span>
                        <span className="font-medium text-foreground">
                          {cleanup.last_run_at
                            ? new Date(cleanup.last_run_at).toLocaleString()
                            : L("never")}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">{L("lastDeleted")}</span>
                        <span className="font-medium text-foreground">{cleanup.last_deleted_count}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">{L("lastRunBy")}</span>
                        <span className="font-medium text-foreground">
                          {cleanup.last_run_at
                            ? cleanup.last_run_by
                              ? runnerNames[cleanup.last_run_by] || L("unknownUser")
                              : L("systemRunner")
                            : "—"}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">{L("statusLabel")}</span>
                        <span
                          className={
                            cleanup.last_run_status === "success"
                              ? "font-medium text-green-600 dark:text-green-400"
                              : cleanup.last_run_status === "failed"
                                ? "font-medium text-destructive"
                                : "font-medium text-muted-foreground"
                          }
                        >
                          {cleanup.last_run_status === "success"
                            ? L("statusSuccess")
                            : cleanup.last_run_status === "failed"
                              ? `${L("statusFailed")}${cleanup.last_run_error ? `: ${cleanup.last_run_error}` : ""}`
                              : L("statusIdle")}
                        </span>
                      </div>
                    </div>

                    <div className="flex justify-between pt-2 gap-2 flex-wrap">
                      <Button
                        variant="outline"
                        onClick={() => setConfirmKind("schedule")}
                        disabled={runningNow}
                      >
                        {runningNow ? (
                          <Loader2 className="w-4 h-4 mr-1 animate-spin" />
                        ) : (
                          <Play className="w-4 h-4 mr-1" />
                        )}
                        {L("runNow")}
                      </Button>
                      <Button onClick={handleSaveCleanup} disabled={cleanupSaving}>
                        {cleanupSaving ? (
                          <Loader2 className="w-4 h-4 mr-1 animate-spin" />
                        ) : (
                          <Save className="w-4 h-4 mr-1" />
                        )}
                        {L("save")}
                      </Button>
                    </div>
                  </>
                ) : null}
              </CardContent>
            </Card>

            {cleanup && (
              <Card className="mt-4">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <ImageIcon className="w-5 h-5" />
                    {L("mediaCleanupTitle")}
                  </CardTitle>
                  <CardDescription>{L("mediaCleanupDesc")}</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-1.5">
                      <Label>{L("mediaRetentionDays")}</Label>
                      <Input
                        type="number"
                        min={1}
                        max={3650}
                        value={cleanup.media_retention_days}
                        onChange={(e) =>
                          setCleanup({ ...cleanup, media_retention_days: Number(e.target.value) })
                        }
                      />
                    </div>
                    <div className="flex items-center gap-3 pt-6">
                      <Switch
                        checked={cleanup.media_enabled}
                        onCheckedChange={(v) => setCleanup({ ...cleanup, media_enabled: v })}
                      />
                      <Label className="cursor-pointer">{L("mediaCleanupEnabled")}</Label>
                    </div>
                  </div>

                  <div className="rounded-md border border-border bg-muted/30 p-4 space-y-2 text-sm">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">{L("lastRun")}</span>
                      <span className="font-medium text-foreground">
                        {cleanup.media_last_run_at
                          ? new Date(cleanup.media_last_run_at).toLocaleString()
                          : L("never")}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">{L("lastDeleted")}</span>
                      <span className="font-medium text-foreground">
                        {cleanup.media_last_deleted_count}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">{L("lastRunBy")}</span>
                      <span className="font-medium text-foreground">
                        {cleanup.media_last_run_at
                          ? cleanup.media_last_run_by
                            ? runnerNames[cleanup.media_last_run_by] || L("unknownUser")
                            : L("systemRunner")
                          : "—"}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">{L("statusLabel")}</span>
                      <span
                        className={
                          cleanup.media_last_run_status === "success"
                            ? "font-medium text-green-600 dark:text-green-400"
                            : cleanup.media_last_run_status === "failed"
                              ? "font-medium text-destructive"
                              : "font-medium text-muted-foreground"
                        }
                      >
                        {cleanup.media_last_run_status === "success"
                          ? L("statusSuccess")
                          : cleanup.media_last_run_status === "failed"
                            ? `${L("statusFailed")}${cleanup.media_last_run_error ? `: ${cleanup.media_last_run_error}` : ""}`
                            : L("statusIdle")}
                      </span>
                    </div>
                  </div>

                  <div className="flex justify-between pt-2 gap-2 flex-wrap">
                    <Button
                      variant="outline"
                      onClick={() => setConfirmKind("media")}
                      disabled={runningMediaNow}
                    >
                      {runningMediaNow ? (
                        <Loader2 className="w-4 h-4 mr-1 animate-spin" />
                      ) : (
                        <Play className="w-4 h-4 mr-1" />
                      )}
                      {L("runMediaNow")}
                    </Button>
                    <Button onClick={handleSaveCleanup} disabled={cleanupSaving}>
                      {cleanupSaving ? (
                        <Loader2 className="w-4 h-4 mr-1 animate-spin" />
                      ) : (
                        <Save className="w-4 h-4 mr-1" />
                      )}
                      {L("save")}
                    </Button>
                  </div>
                </CardContent>
              </Card>
            )}

            {runResult && (
              <Card
                className={`mt-4 border-2 ${
                  runResult.success
                    ? "border-green-500/50 bg-green-500/5"
                    : "border-destructive/50 bg-destructive/5"
                }`}
              >
                <CardHeader className="pb-3">
                  <CardTitle className="flex items-center justify-between gap-2 text-base">
                    <span className="flex items-center gap-2">
                      {runResult.success ? (
                        <CheckCircle2 className="w-5 h-5 text-green-600 dark:text-green-400" />
                      ) : (
                        <AlertCircle className="w-5 h-5 text-destructive" />
                      )}
                      {L("resultTitle")} ·{" "}
                      {runResult.kind === "schedule"
                        ? L("resultKindSchedule")
                        : L("resultKindMedia")}
                    </span>
                    <Button variant="ghost" size="sm" onClick={() => setRunResult(null)}>
                      {L("dismiss")}
                    </Button>
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-1.5 text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">{L("statusLabel")}</span>
                    <span
                      className={
                        runResult.success
                          ? "font-medium text-green-600 dark:text-green-400"
                          : "font-medium text-destructive"
                      }
                    >
                      {runResult.success ? L("statusSuccess") : L("statusFailed")}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">{L("resultDeleted")}</span>
                    <span className="font-medium text-foreground">{runResult.deleted}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">{L("resultAt")}</span>
                    <span className="font-medium text-foreground">
                      {new Date(runResult.at).toLocaleString()}
                    </span>
                  </div>
                  {!runResult.success && runResult.error && (
                    <div className="pt-1 text-destructive break-all">{runResult.error}</div>
                  )}
                </CardContent>
              </Card>
            )}
          </TabsContent>

          {/* ── MCP Tokens Tab ─────────────────────────────────── */}
          <TabsContent value="mcp" className="mt-4 space-y-6">
            {/* Generate new token */}
            <Card>
              <CardHeader>
                <CardTitle>{L("mcpNewTitle")}</CardTitle>
                <CardDescription>{L("mcpDesc")}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="space-y-1">
                    <Label>{L("mcpTokenName")}</Label>
                    <Input
                      placeholder={L("mcpTokenNamePh")}
                      value={newTokenName}
                      onChange={(e) => setNewTokenName(e.target.value)}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label>{L("mcpOrg")}</Label>
                    <Select value={newTokenOrgId} onValueChange={setNewTokenOrgId}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {orgs.map((o) => (
                          <SelectItem key={o.id} value={o.id}>{o.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <Label>{L("mcpPerms")}</Label>
                    <div className="flex flex-wrap gap-3 pt-1">
                      {MCP_PERMISSIONS.map((p) => (
                        <label key={p} className="flex items-center gap-1.5 cursor-pointer text-sm">
                          <Checkbox
                            checked={newTokenPerms.includes(p)}
                            onCheckedChange={(checked) =>
                              setNewTokenPerms((prev) =>
                                checked ? [...prev, p] : prev.filter((x) => x !== p),
                              )
                            }
                          />
                          {p}
                        </label>
                      ))}
                    </div>
                  </div>
                </div>
                <Button
                  onClick={handleCreateToken}
                  disabled={creatingToken || !newTokenName.trim() || !newTokenOrgId || newTokenPerms.length === 0}
                >
                  {creatingToken ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Plus className="w-4 h-4 mr-1" />}
                  {L("mcpGenerate")}
                </Button>
              </CardContent>
            </Card>

            {/* Token list */}
            <Card>
              <CardHeader>
                <CardTitle>{L("mcpListTitle")}</CardTitle>
              </CardHeader>
              <CardContent>
                {mcpLoading ? (
                  <div className="flex justify-center py-8">
                    <Loader2 className="w-6 h-6 animate-spin text-primary" />
                  </div>
                ) : mcpTokens.length === 0 ? (
                  <p className="text-sm text-muted-foreground py-4 text-center">{L("mcpNoTokens")}</p>
                ) : (
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>{L("mcpColName")}</TableHead>
                          <TableHead>{L("mcpColOrg")}</TableHead>
                          <TableHead>{L("mcpColPerms")}</TableHead>
                          <TableHead>{L("mcpColHash")}</TableHead>
                          <TableHead>{L("mcpColLastUsed")}</TableHead>
                          <TableHead>{L("mcpColCreated")}</TableHead>
                          <TableHead></TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {mcpTokens.map((tok) => (
                          <TableRow key={tok.id}>
                            <TableCell>
                              <div className="flex items-center gap-2">
                                <span className="font-medium">{tok.name}</span>
                                <button
                                  type="button"
                                  title="連線 QR Code"
                                  onClick={() => setReissueTarget(tok)}
                                  className="text-muted-foreground hover:text-primary transition-colors"
                                >
                                  <QrCode className="w-4 h-4" />
                                </button>
                              </div>
                            </TableCell>
                            <TableCell className="text-muted-foreground text-xs">{tok.org_name || tok.org_id.slice(0, 8)}</TableCell>
                            <TableCell>
                              <div className="flex flex-wrap gap-1">
                                {tok.permissions.map((p) => (
                                  <Badge key={p} variant={p === "emergency" ? "destructive" : "secondary"} className="text-xs">
                                    {p === "emergency" ? <ShieldAlert className="w-3 h-3 mr-0.5" /> : <ShieldCheck className="w-3 h-3 mr-0.5" />}
                                    {p}
                                  </Badge>
                                ))}
                              </div>
                            </TableCell>
                            <TableCell>
                              <code className="text-xs bg-muted px-1.5 py-0.5 rounded font-mono">
                                {tok.token_hash.slice(0, 12)}…
                              </code>
                            </TableCell>
                            <TableCell className="text-xs text-muted-foreground">
                              {tok.last_used_at ? (
                                <span className="flex items-center gap-1">
                                  <Clock className="w-3 h-3" />
                                  {new Date(tok.last_used_at).toLocaleString()}
                                </span>
                              ) : L("mcpNeverUsed")}
                            </TableCell>
                            <TableCell className="text-xs text-muted-foreground">
                              {new Date(tok.created_at).toLocaleDateString()}
                            </TableCell>
                            <TableCell>
                              <Button
                                size="sm"
                                variant="ghost"
                                className="text-destructive hover:text-destructive"
                                onClick={() => setRevokeTarget(tok)}
                              >
                                <Trash2 className="w-4 h-4 text-destructive" />
                              </Button>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>

      {/* Token created — QR connect dialog */}
      <Dialog open={!!createdRawToken} onOpenChange={(o) => { if (!o) { setCreatedRawToken(null); setShowRawToken(false); } }}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Smartphone className="w-5 h-5 text-primary" />
              掃描 QR Code 連線
            </DialogTitle>
            <DialogDescription>
              用手機掃描 QR Code，即可在 SignCMS Go 自動完成設定。
            </DialogDescription>
          </DialogHeader>

          {createdRawToken && (() => {
            const connectUrl = `${GO_APP_URL}?token=${createdRawToken}`;
            return (
              <div className="flex flex-col items-center gap-4 py-2">
                {/* QR Code */}
                <div className="p-3 bg-white rounded-2xl shadow-sm">
                  <QRCodeSVG
                    value={connectUrl}
                    size={200}
                    level="M"
                    includeMargin={false}
                  />
                </div>

                <p className="text-xs text-muted-foreground text-center px-2">
                  掃描後瀏覽器會開啟 SignCMS Go，Token 自動寫入設定。
                </p>

                {/* Copy connect URL */}
                <div className="w-full flex gap-2">
                  <div className="flex-1 bg-muted rounded-lg px-3 py-2 text-xs font-mono truncate text-muted-foreground select-all">
                    {GO_APP_URL}?token=••••••••…
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => { navigator.clipboard.writeText(connectUrl); toast.success("連線網址已複製"); }}
                  >
                    <Copy className="w-3.5 h-3.5" />
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => window.open(connectUrl, "_blank")}
                    title="在新分頁開啟"
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                  </Button>
                </div>

                {/* Collapsible raw token (advanced) */}
                <button
                  type="button"
                  onClick={() => setShowRawToken((x) => !x)}
                  className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
                >
                  {showRawToken ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                  顯示原始 Token（進階）
                </button>
                {showRawToken && (
                  <div className="w-full space-y-2">
                    <div className="p-2 bg-muted rounded-lg font-mono text-xs break-all select-all border border-border text-muted-foreground">
                      {createdRawToken}
                    </div>
                    <p className="text-[11px] text-amber-500 text-center">
                      ⚠ Token 僅顯示一次，關閉後無法再查看。
                    </p>
                    <Button
                      size="sm"
                      variant="outline"
                      className="w-full"
                      onClick={() => { navigator.clipboard.writeText(createdRawToken); toast.success(L("mcpCopied")); }}
                    >
                      <Copy className="w-3.5 h-3.5 mr-1" />
                      複製原始 Token
                    </Button>
                  </div>
                )}
              </div>
            );
          })()}

          <DialogFooter>
            <Button className="w-full" onClick={() => { setCreatedRawToken(null); setShowRawToken(false); }}>
              <CheckCircle2 className="w-4 h-4 mr-1" />
              已完成，關閉
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Re-issue confirmation — clicking QR icon on an existing token */}
      <AlertDialog open={!!reissueTarget} onOpenChange={(o) => !o && setReissueTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <QrCode className="w-5 h-5 text-primary" />
              產生連線 QR Code
            </AlertDialogTitle>
            <AlertDialogDescription>
              將為「<span className="font-semibold text-foreground">{reissueTarget?.name}</span>」重新產生 Token 並顯示 QR Code。
              <br />
              目前連線此金鑰的裝置將失效，需重新掃描。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={reissuing}>取消</AlertDialogCancel>
            <AlertDialogAction onClick={handleReissueToken} disabled={reissuing}>
              {reissuing
                ? <Loader2 className="w-4 h-4 mr-1 animate-spin" />
                : <QrCode   className="w-4 h-4 mr-1" />}
              產生 QR Code
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Revoke confirmation */}
      <AlertDialog open={!!revokeTarget} onOpenChange={(o) => !o && setRevokeTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{L("mcpRevokeTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              <span className="font-semibold">{revokeTarget?.name}</span> — {L("mcpRevokeDesc")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{L("cancel")}</AlertDialogCancel>
            <AlertDialogAction onClick={handleRevokeToken} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              {L("mcpRevoke")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={confirmKind !== null} onOpenChange={(o) => !o && setConfirmKind(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{L("confirmTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {confirmKind === "media" ? L("confirmMediaDesc") : L("confirmScheduleDesc")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{L("cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                const kind = confirmKind;
                setConfirmKind(null);
                if (kind === "schedule") handleRunNow();
                else if (kind === "media") handleRunMediaNow();
              }}
            >
              {L("confirmRun")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </DashboardLayout>
  );
};

export default SystemSettingsPage;
