import { useState, useEffect, useRef, useCallback } from "react";
import { useLanguage } from "@/contexts/LanguageContext";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import {
  Collapsible, CollapsibleContent, CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";
import {
  Code2, Upload, Globe, Loader2, Copy, Check, ExternalLink,
  CheckCircle2, Clock, XCircle, PauseCircle, Puzzle, RefreshCw,
  Key, Tag, Webhook, ChevronDown, ChevronRight, AlertTriangle,
  RotateCcw, Plus, FileCode2,
} from "lucide-react";

// ── Constants ──────────────────────────────────────────────────────────────────
const GRADIENT_PRESETS = [
  { label: "Orange",  value: "from-orange-500 to-amber-500" },
  { label: "Blue",    value: "from-blue-500 to-cyan-500" },
  { label: "Green",   value: "from-emerald-500 to-teal-500" },
  { label: "Pink",    value: "from-pink-500 to-rose-500" },
  { label: "Violet",  value: "from-violet-500 to-purple-500" },
  { label: "Sky",     value: "from-sky-500 to-indigo-500" },
  { label: "Amber",   value: "from-amber-500 to-yellow-500" },
  { label: "Red",     value: "from-red-500 to-orange-500" },
  { label: "Gray",    value: "from-gray-500 to-gray-600" },
];

// ── Types ──────────────────────────────────────────────────────────────────────
interface Submission {
  id: string;
  slug: string;
  name_i18n: Record<string, string>;
  publisher: string;
  status: string;
  api_key: string;
  widget_url: string | null;
  webhook_url: string | null;
  created_at: string;
  gradient: string;
}

interface AppVersion {
  id: string;
  app_id: string;
  version_tag: string;
  widget_url: string;
  changelog_i18n: Record<string, string>;
  status: "draft" | "active" | "deprecated";
  created_at: string;
}

interface WebhookLog {
  id: string;
  event_type: string;
  status_code: number | null;
  error_msg: string | null;
  delivered_at: string;
}

const STATUS_CONFIG: Record<string, {
  icon: React.ComponentType<{ className?: string }>;
  color: string;
  label: Record<string, string>;
}> = {
  pending:    { icon: Clock,        color: "bg-yellow-500/10 text-yellow-600 border-yellow-500/30", label: { zh: "審核中", en: "Pending",   ja: "審査中" } },
  approved:   { icon: CheckCircle2, color: "bg-green-500/10 text-green-600 border-green-500/30",   label: { zh: "已通過", en: "Approved",  ja: "承認済" } },
  rejected:   { icon: XCircle,      color: "bg-red-500/10 text-red-600 border-red-500/30",         label: { zh: "已拒絕", en: "Rejected",  ja: "拒否"  } },
  suspended:  { icon: PauseCircle,  color: "bg-gray-500/10 text-gray-500 border-gray-500/30",      label: { zh: "已停用", en: "Suspended", ja: "停止中" } },
  draft:      { icon: Clock,        color: "bg-blue-500/10 text-blue-600 border-blue-500/30",      label: { zh: "待審核", en: "Draft",     ja: "下書き" } },
  active:     { icon: CheckCircle2, color: "bg-green-500/10 text-green-600 border-green-500/30",   label: { zh: "現行版本", en: "Active",  ja: "現行" } },
  deprecated: { icon: XCircle,      color: "bg-gray-500/10 text-gray-400 border-gray-400/30",      label: { zh: "已棄用", en: "Deprecated", ja: "非推奨" } },
};

// ── Main component ─────────────────────────────────────────────────────────────
export default function DeveloperPortalPage() {
  const { language } = useLanguage();
  const { user } = useAuth();
  const lang = language as "zh" | "en" | "ja";

  // Submit form state
  const [slug, setSlug]           = useState("");
  const [nameZh, setNameZh]       = useState("");
  const [nameEn, setNameEn]       = useState("");
  const [nameJa, setNameJa]       = useState("");
  const [descZh, setDescZh]       = useState("");
  const [descEn, setDescEn]       = useState("");
  const [descJa, setDescJa]       = useState("");
  const [publisher, setPublisher] = useState("");
  const [websiteUrl, setWebsiteUrl]   = useState("");
  const [webhookUrl, setWebhookUrl]   = useState("");
  const [widgetUrl, setWidgetUrl]     = useState("");
  const [gradient, setGradient]   = useState(GRADIENT_PRESETS[0].value);
  const [htmlFile, setHtmlFile]   = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [uploading, setUploading]   = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  // Credentials dialog (shown once after register or rotate)
  const [credsDialog, setCredsDialog] = useState(false);
  const [credsTitle, setCredsTitle]   = useState("");
  const [creds, setCreds] = useState<{ api_key?: string; api_secret: string } | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  // My Apps state
  const [submissions, setSubmissions] = useState<Submission[]>([]);
  const [loadingSubs, setLoadingSubs] = useState(false);
  const [expandedApp, setExpandedApp] = useState<string | null>(null);

  // Per-app sub-state
  const [versions, setVersions]     = useState<Record<string, AppVersion[]>>({});
  const [webhookLogs, setWebhookLogs] = useState<Record<string, WebhookLog[]>>({});
  const [loadingVer, setLoadingVer] = useState<string | null>(null);
  const [loadingLog, setLoadingLog] = useState<string | null>(null);

  // New version form
  const [newVersionApp, setNewVersionApp]   = useState<string | null>(null);
  const [newVerTag, setNewVerTag]           = useState("");
  const [newVerUrl, setNewVerUrl]           = useState("");
  const [newVerClZh, setNewVerClZh]         = useState("");
  const [newVerClEn, setNewVerClEn]         = useState("");
  const [newVerHtml, setNewVerHtml]         = useState<File | null>(null);
  const [submittingVer, setSubmittingVer]   = useState(false);
  const verFileRef = useRef<HTMLInputElement>(null);

  // Rotating secret
  const [rotatingApp, setRotatingApp] = useState<string | null>(null);

  // ── i18n ────────────────────────────────────────────────────────────────────
  const T = {
    heading:     { zh: "開發者入口", en: "Developer Portal", ja: "開発者ポータル" },
    sub:         { zh: "將您的 Widget 提交至應用商店", en: "Submit your widget to the App Store", ja: "ウィジェットをアプリストアに申請" },
    tabSubmit:   { zh: "提交新應用", en: "Submit App", ja: "アプリを申請" },
    tabMine:     { zh: "我的應用", en: "My Apps", ja: "マイアプリ" },
    // Submit form
    slugLabel:   { zh: "應用識別碼 (slug)", en: "App Slug", ja: "スラッグ" },
    slugDesc:    { zh: "小寫英數字與連字符，例如 my-widget", en: "Lowercase alphanumeric + hyphens", ja: "小文字英数字とハイフン" },
    nameLabel:   { zh: "應用名稱", en: "App Name", ja: "アプリ名" },
    descLabel:   { zh: "應用說明", en: "Description", ja: "説明" },
    publisherLbl:{ zh: "發佈者", en: "Publisher", ja: "パブリッシャー" },
    websiteLbl:  { zh: "官方網站（選填）", en: "Website (optional)", ja: "公式サイト（任意）" },
    webhookLbl:  { zh: "Webhook URL（選填）", en: "Webhook URL (optional)", ja: "Webhook URL（任意）" },
    webhookDesc: { zh: "安裝/狀態變更時 POST，含 HMAC 簽名", en: "POSTed on install/status changes with HMAC", ja: "インストール/変更時にPOSTされます（HMAC署名付き）" },
    widgetUrlLbl:{ zh: "Widget URL（外部 iframe）", en: "Widget URL (external iframe)", ja: "Widget URL（外部iframe）" },
    orUpload:    { zh: "或上傳 HTML 檔案", en: "Or upload HTML file", ja: "または HTML をアップロード" },
    gradientLbl: { zh: "圖示漸層色", en: "Icon Gradient", ja: "アイコングラデーション" },
    submitBtn:   { zh: "提交審核", en: "Submit for Review", ja: "審査に提出" },
    noApps:      { zh: "尚無申請記錄", en: "No apps yet", ja: "申請がありません" },
    // Creds dialog
    credsRegTitle:    { zh: "提交成功！請保存憑證", en: "Submitted! Save your credentials", ja: "申請完了！認証情報を保存" },
    credsRotateTitle: { zh: "新 API Secret（僅顯示一次）", en: "New API Secret (shown once)", ja: "新しいAPIシークレット（一度のみ）" },
    credsDesc:        { zh: "api_secret 絕不會再次顯示，請立即複製。", en: "api_secret will never be shown again. Copy it now.", ja: "api_secretは二度と表示されません。今すぐコピーしてください。" },
    apiKey:      { zh: "API Key", en: "API Key", ja: "APIキー" },
    apiSecret:   { zh: "API Secret（僅顯示一次）", en: "API Secret (shown once)", ja: "APIシークレット（一度のみ）" },
    closeBtn:    { zh: "我已保存，關閉", en: "I've saved it, close", ja: "保存済み、閉じる" },
    // API key section
    apiKeySection: { zh: "API 金鑰", en: "API Keys", ja: "APIキー管理" },
    rotateBtn:     { zh: "輪換 Secret", en: "Rotate Secret", ja: "シークレット更新" },
    rotateConfirm: { zh: "輪換後舊 secret 立即失效，確定繼續？", en: "Old secret is invalidated immediately. Continue?", ja: "古いシークレットは即時無効になります。続けますか？" },
    // Versions section
    versionsSection: { zh: "版本管理", en: "Versions", ja: "バージョン管理" },
    submitVersion:   { zh: "提交新版本", en: "Submit New Version", ja: "新バージョンを提出" },
    verTagLabel:     { zh: "版本號（semver）", en: "Version Tag (semver)", ja: "バージョン番号（semver）" },
    verUrlLabel:     { zh: "Widget URL", en: "Widget URL", ja: "Widget URL" },
    verClLabel:      { zh: "更新說明", en: "Changelog", ja: "変更ログ" },
    verSubmitBtn:    { zh: "提交版本", en: "Submit Version", ja: "バージョンを提出" },
    noVersions:      { zh: "尚無版本紀錄", en: "No versions yet", ja: "バージョンがありません" },
    // Webhook logs section
    logsSection: { zh: "Webhook 紀錄", en: "Webhook Logs", ja: "Webhookログ" },
    noLogs:      { zh: "尚無 Webhook 紀錄", en: "No webhook logs yet", ja: "Webhookログがありません" },
    loadMore:    { zh: "重新整理", en: "Refresh", ja: "更新" },
    fileSelected:{ zh: "已選擇", en: "Selected", ja: "選択済" },
    uploadBtn:   { zh: "選擇 HTML 檔案", en: "Choose HTML file", ja: "HTMLファイルを選択" },
    loading:     { zh: "載入中…", en: "Loading…", ja: "読込中…" },
  };
  const t = (k: keyof typeof T) => T[k][lang] ?? T[k].zh;

  // ── Data loading ────────────────────────────────────────────────────────────
  const loadSubmissions = useCallback(async () => {
    if (!user) return;
    setLoadingSubs(true);
    const { data } = await supabase
      .from("store_apps")
      .select("id, slug, name_i18n, publisher, status, api_key, widget_url, webhook_url, gradient, created_at")
      .eq("submitted_by", user.id)
      .order("created_at", { ascending: false });
    setSubmissions((data as Submission[]) || []);
    setLoadingSubs(false);
  }, [user]);

  useEffect(() => { void loadSubmissions(); }, [loadSubmissions]);

  const loadVersions = useCallback(async (appId: string) => {
    setLoadingVer(appId);
    const { data } = await supabase
      .from("store_app_versions")
      .select("id, app_id, version_tag, widget_url, changelog_i18n, status, created_at")
      .eq("app_id", appId)
      .order("created_at", { ascending: false });
    setVersions((prev) => ({ ...prev, [appId]: (data as AppVersion[]) || [] }));
    setLoadingVer(null);
  }, []);

  const loadLogs = useCallback(async (appId: string) => {
    setLoadingLog(appId);
    const { data } = await supabase
      .from("store_app_webhook_logs")
      .select("id, event_type, status_code, error_msg, delivered_at")
      .eq("app_id", appId)
      .order("delivered_at", { ascending: false })
      .limit(20);
    setWebhookLogs((prev) => ({ ...prev, [appId]: (data as WebhookLog[]) || [] }));
    setLoadingLog(null);
  }, []);

  const handleExpand = (appId: string) => {
    if (expandedApp === appId) { setExpandedApp(null); return; }
    setExpandedApp(appId);
    void loadVersions(appId);
    void loadLogs(appId);
  };

  // ── Submit new app ──────────────────────────────────────────────────────────
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!slug || !publisher || (!widgetUrl && !htmlFile)) {
      toast.error("Slug, publisher, and widget URL (or HTML file) are required");
      return;
    }
    setSubmitting(true);
    let finalWidgetUrl = widgetUrl;

    try {
      if (htmlFile) {
        setUploading(true);
        const path = `widget-assets/ext-${slug}-${Date.now()}.html`;
        const { error: upErr } = await supabase.storage.from("media").upload(path, htmlFile, {
          contentType: "text/html; charset=utf-8", cacheControl: "31536000", upsert: false,
        });
        setUploading(false);
        if (upErr) { toast.error(`Upload failed: ${upErr.message}`); setSubmitting(false); return; }
        const { data: pub } = supabase.storage.from("media").getPublicUrl(path);
        finalWidgetUrl = pub.publicUrl;
      }

      const { data, error } = await supabase.functions.invoke("register-app", {
        body: {
          slug, publisher, gradient,
          name_i18n: { zh: nameZh, en: nameEn, ja: nameJa },
          desc_i18n: { zh: descZh, en: descEn, ja: descJa },
          website_url: websiteUrl || null,
          webhook_url: webhookUrl || null,
          widget_url: finalWidgetUrl,
        },
      });
      if (error || data?.error) { toast.error(data?.error || error?.message); setSubmitting(false); return; }

      setCreds({ api_key: data.api_key, api_secret: data.api_secret });
      setCredsTitle(t("credsRegTitle"));
      setCredsDialog(true);
      setSlug(""); setNameZh(""); setNameEn(""); setNameJa("");
      setDescZh(""); setDescEn(""); setDescJa("");
      setPublisher(""); setWebsiteUrl(""); setWebhookUrl(""); setWidgetUrl("");
      setHtmlFile(null);
      if (fileRef.current) fileRef.current.value = "";
      void loadSubmissions();
    } finally { setSubmitting(false); }
  };

  // ── Rotate secret ───────────────────────────────────────────────────────────
  const handleRotate = async (appId: string) => {
    if (!confirm(t("rotateConfirm"))) return;
    setRotatingApp(appId);
    const { data, error } = await supabase.functions.invoke("rotate-api-secret", { body: { appId } });
    setRotatingApp(null);
    if (error || data?.error) { toast.error(data?.error || error?.message); return; }
    setCreds({ api_secret: data.api_secret });
    setCredsTitle(t("credsRotateTitle"));
    setCredsDialog(true);
  };

  // ── Submit new version ──────────────────────────────────────────────────────
  const handleSubmitVersion = async (appId: string) => {
    if (!newVerTag) { toast.error("Version tag is required"); return; }
    if (!newVerUrl && !newVerHtml) { toast.error("Widget URL or HTML file is required"); return; }
    setSubmittingVer(true);

    let body: FormData | string;
    if (newVerHtml) {
      const fd = new FormData();
      fd.append("appId", appId);
      fd.append("versionTag", newVerTag);
      fd.append("widgetUrl", newVerUrl);
      fd.append("changelog", JSON.stringify({ zh: newVerClZh, en: newVerClEn }));
      fd.append("html", newVerHtml);
      body = fd as unknown as string; // supabase.functions.invoke handles FormData
      const { data, error } = await supabase.functions.invoke("submit-app-version", { body: fd });
      if (error || data?.error) { toast.error(data?.error || error?.message); setSubmittingVer(false); return; }
    } else {
      const { data, error } = await supabase.functions.invoke("submit-app-version", {
        body: { appId, versionTag: newVerTag, widgetUrl: newVerUrl, changelog: { zh: newVerClZh, en: newVerClEn } },
      });
      if (error || data?.error) { toast.error(data?.error || error?.message); setSubmittingVer(false); return; }
    }

    toast.success(`Version ${newVerTag} submitted for review`);
    setNewVersionApp(null);
    setNewVerTag(""); setNewVerUrl(""); setNewVerClZh(""); setNewVerClEn(""); setNewVerHtml(null);
    if (verFileRef.current) verFileRef.current.value = "";
    void loadVersions(appId);
    setSubmittingVer(false);
  };

  // ── Copy helper ─────────────────────────────────────────────────────────────
  const copyText = async (text: string, id: string) => {
    await navigator.clipboard.writeText(text);
    setCopied(id);
    setTimeout(() => setCopied(null), 2000);
  };

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-6 animate-fade-in max-w-4xl">
      {/* Banner */}
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-r from-indigo-600 via-violet-600 to-purple-600 p-8">
        <div className="absolute inset-0 opacity-20">
          <div className="absolute -top-8 -right-8 w-56 h-56 bg-white/20 rounded-full blur-3xl" />
        </div>
        <div className="relative z-10 flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-white/20 flex items-center justify-center">
            <Code2 className="h-5 w-5 text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-white">{t("heading")}</h1>
            <p className="text-white/75 text-sm mt-0.5">{t("sub")}</p>
          </div>
        </div>
      </div>

      <Tabs defaultValue="submit">
        <TabsList>
          <TabsTrigger value="submit">{t("tabSubmit")}</TabsTrigger>
          <TabsTrigger value="mine">
            {t("tabMine")}
            {submissions.length > 0 && <Badge className="ml-1.5 bg-primary/20 text-primary text-xs">{submissions.length}</Badge>}
          </TabsTrigger>
        </TabsList>

        {/* ── Submit App tab ── */}
        <TabsContent value="submit" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">{t("tabSubmit")}</CardTitle>
              <CardDescription>{t("sub")}</CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleSubmit} className="space-y-5">
                <div className="space-y-1.5">
                  <Label>{t("slugLabel")} *</Label>
                  <Input value={slug} onChange={(e) => setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))} placeholder="my-awesome-widget" required />
                  <p className="text-xs text-muted-foreground">{t("slugDesc")}</p>
                </div>
                <div className="space-y-2">
                  <Label>{t("nameLabel")} *</Label>
                  <div className="grid grid-cols-3 gap-2">
                    {[["中文", nameZh, setNameZh, "我的 Widget"], ["English", nameEn, setNameEn, "My Widget"], ["日本語", nameJa, setNameJa, "マイWidget"]].map(([lbl, val, setter, ph]) => (
                      <div key={lbl as string} className="space-y-1">
                        <Label className="text-xs text-muted-foreground">{lbl as string}</Label>
                        <Input value={val as string} onChange={(e) => (setter as (v: string) => void)(e.target.value)} placeholder={ph as string} />
                      </div>
                    ))}
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>{t("descLabel")}</Label>
                  <div className="grid grid-cols-3 gap-2">
                    <Textarea value={descZh} onChange={(e) => setDescZh(e.target.value)} placeholder="中文說明…" className="min-h-[68px] text-sm" />
                    <Textarea value={descEn} onChange={(e) => setDescEn(e.target.value)} placeholder="English…" className="min-h-[68px] text-sm" />
                    <Textarea value={descJa} onChange={(e) => setDescJa(e.target.value)} placeholder="日本語…" className="min-h-[68px] text-sm" />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <Label>{t("publisherLbl")} *</Label>
                    <Input value={publisher} onChange={(e) => setPublisher(e.target.value)} placeholder="Acme Inc." required />
                  </div>
                  <div className="space-y-1.5">
                    <Label>{t("websiteLbl")}</Label>
                    <Input value={websiteUrl} onChange={(e) => setWebsiteUrl(e.target.value)} placeholder="https://example.com" type="url" />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label>{t("webhookLbl")}</Label>
                  <Input value={webhookUrl} onChange={(e) => setWebhookUrl(e.target.value)} placeholder="https://example.com/signboard-webhook" type="url" />
                  <p className="text-xs text-muted-foreground">{t("webhookDesc")}</p>
                </div>
                <div className="space-y-3">
                  <div className="space-y-1.5">
                    <Label className="flex items-center gap-1.5"><Globe className="h-3.5 w-3.5" />{t("widgetUrlLbl")}</Label>
                    <Input value={widgetUrl} onChange={(e) => setWidgetUrl(e.target.value)} placeholder="https://example.com/widget" type="url" disabled={!!htmlFile} />
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="flex-1 border-t" /><span className="text-xs text-muted-foreground">{t("orUpload")}</span><div className="flex-1 border-t" />
                  </div>
                  <div className="flex items-center gap-3">
                    <Button type="button" variant="outline" size="sm" className="gap-2" onClick={() => fileRef.current?.click()} disabled={!!widgetUrl}>
                      <Upload className="h-3.5 w-3.5" />{t("uploadBtn")}
                    </Button>
                    {htmlFile && <span className="text-sm text-muted-foreground"><Check className="inline h-3.5 w-3.5 text-green-500 mr-1" />{t("fileSelected")}: {htmlFile.name}</span>}
                    <input ref={fileRef} type="file" accept=".html,text/html" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) setHtmlFile(f); }} />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>{t("gradientLbl")}</Label>
                  <div className="flex flex-wrap gap-2 items-center">
                    {GRADIENT_PRESETS.map((g) => (
                      <button key={g.value} type="button" onClick={() => setGradient(g.value)} title={g.label}
                        className={`w-9 h-9 rounded-lg bg-gradient-to-br ${g.value} transition-all ${gradient === g.value ? "ring-2 ring-offset-2 ring-primary scale-110" : "opacity-70 hover:opacity-100"}`} />
                    ))}
                    <div className={`w-9 h-9 rounded-lg bg-gradient-to-br ${gradient} flex items-center justify-center ml-2 shrink-0`}>
                      <Puzzle className="h-4 w-4 text-white" />
                    </div>
                  </div>
                </div>
                <Button type="submit" disabled={submitting} className="w-full sm:w-auto">
                  {submitting ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />{uploading ? "上傳中…" : "提交中…"}</> : <><Upload className="mr-2 h-4 w-4" />{t("submitBtn")}</>}
                </Button>
              </form>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── My Apps tab ── */}
        <TabsContent value="mine" className="mt-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">{t("tabMine")}</h2>
            <Button variant="ghost" size="sm" className="gap-1.5" onClick={loadSubmissions} disabled={loadingSubs}>
              <RefreshCw className={`h-3.5 w-3.5 ${loadingSubs ? "animate-spin" : ""}`} />
            </Button>
          </div>
          {loadingSubs ? (
            <div className="flex justify-center py-12 text-muted-foreground"><Loader2 className="h-6 w-6 animate-spin" /></div>
          ) : submissions.length === 0 ? (
            <div className="text-center py-14 text-muted-foreground">
              <Puzzle className="mx-auto h-10 w-10 mb-3 opacity-30" />
              <p>{t("noApps")}</p>
            </div>
          ) : (
            <div className="space-y-3">
              {submissions.map((s) => {
                const sc = STATUS_CONFIG[s.status] || STATUS_CONFIG.pending;
                const StatusIcon = sc.icon;
                const name = s.name_i18n[lang] || s.name_i18n.en || s.slug;
                const isExpanded = expandedApp === s.id;

                return (
                  <Card key={s.id} className={`transition-all ${isExpanded ? "ring-1 ring-primary/30" : ""}`}>
                    <CardContent className="p-0">
                      {/* App header row */}
                      <button
                        className="w-full flex items-center gap-4 p-4 text-left hover:bg-accent/30 transition-colors rounded-xl"
                        onClick={() => handleExpand(s.id)}
                      >
                        <div className={`shrink-0 w-11 h-11 rounded-xl bg-gradient-to-br ${s.gradient || "from-gray-500 to-gray-600"} flex items-center justify-center`}>
                          <Puzzle className="h-5 w-5 text-white" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-semibold text-sm">{name}</span>
                            <code className="text-xs bg-muted px-1.5 py-0.5 rounded">{s.slug}</code>
                            <Badge variant="outline" className={`text-xs ${sc.color}`}>
                              <StatusIcon className="mr-1 h-3 w-3" />{sc.label[lang]}
                            </Badge>
                          </div>
                          <p className="text-xs text-muted-foreground mt-0.5">{s.publisher} · {new Date(s.created_at).toLocaleDateString()}</p>
                        </div>
                        {isExpanded ? <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" /> : <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />}
                      </button>

                      {/* Expanded sections */}
                      {isExpanded && (
                        <div className="border-t px-4 pb-4 space-y-5 pt-4">

                          {/* ── API Keys ── */}
                          <SectionHeading icon={<Key className="h-3.5 w-3.5" />} title={t("apiKeySection")} />
                          <div className="bg-muted/50 rounded-lg p-3 space-y-2">
                            <div className="flex items-center gap-2">
                              <span className="text-xs text-muted-foreground w-24 shrink-0">{t("apiKey")}</span>
                              <code className="flex-1 text-xs font-mono truncate">{s.api_key}</code>
                              <Button size="icon" variant="ghost" className="h-6 w-6 shrink-0" onClick={() => copyText(s.api_key, `key-${s.id}`)}>
                                {copied === `key-${s.id}` ? <Check className="h-3 w-3 text-green-500" /> : <Copy className="h-3 w-3" />}
                              </Button>
                            </div>
                            <div className="flex items-center gap-2">
                              <span className="text-xs text-muted-foreground w-24 shrink-0">{t("apiSecret")}</span>
                              <code className="flex-1 text-xs text-muted-foreground">••••••••••••••••••••••••</code>
                              <Button size="sm" variant="outline" className="h-6 px-2 text-xs gap-1 shrink-0"
                                disabled={rotatingApp === s.id} onClick={() => handleRotate(s.id)}>
                                {rotatingApp === s.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <RotateCcw className="h-3 w-3" />}
                                {t("rotateBtn")}
                              </Button>
                            </div>
                          </div>

                          <Separator />

                          {/* ── Versions ── */}
                          <SectionHeading icon={<Tag className="h-3.5 w-3.5" />} title={t("versionsSection")}
                            action={
                              <Button size="sm" variant="outline" className="h-6 px-2 text-xs gap-1"
                                onClick={() => setNewVersionApp(newVersionApp === s.id ? null : s.id)}>
                                <Plus className="h-3 w-3" />{t("submitVersion")}
                              </Button>
                            }
                          />

                          {newVersionApp === s.id && (
                            <div className="bg-muted/40 rounded-lg p-3 space-y-3 border border-dashed">
                              <div className="grid grid-cols-2 gap-2">
                                <div className="space-y-1">
                                  <Label className="text-xs">{t("verTagLabel")}</Label>
                                  <Input value={newVerTag} onChange={(e) => setNewVerTag(e.target.value)} placeholder="1.0.0" className="h-7 text-xs" />
                                </div>
                                <div className="space-y-1">
                                  <Label className="text-xs">{t("verUrlLabel")}</Label>
                                  <Input value={newVerUrl} onChange={(e) => setNewVerUrl(e.target.value)} placeholder="https://…" className="h-7 text-xs" disabled={!!newVerHtml} />
                                </div>
                              </div>
                              <div className="grid grid-cols-2 gap-2">
                                <div className="space-y-1">
                                  <Label className="text-xs">{t("verClLabel")} (中文)</Label>
                                  <Textarea value={newVerClZh} onChange={(e) => setNewVerClZh(e.target.value)} className="min-h-[50px] text-xs" placeholder="修正…" />
                                </div>
                                <div className="space-y-1">
                                  <Label className="text-xs">{t("verClLabel")} (EN)</Label>
                                  <Textarea value={newVerClEn} onChange={(e) => setNewVerClEn(e.target.value)} className="min-h-[50px] text-xs" placeholder="Fixed…" />
                                </div>
                              </div>
                              <div className="flex items-center gap-2">
                                <Button type="button" variant="outline" size="sm" className="h-6 px-2 text-xs gap-1"
                                  onClick={() => verFileRef.current?.click()} disabled={!!newVerUrl}>
                                  <FileCode2 className="h-3 w-3" />{t("uploadBtn")}
                                </Button>
                                {newVerHtml && <span className="text-xs text-muted-foreground">{newVerHtml.name}</span>}
                                <input ref={verFileRef} type="file" accept=".html,text/html" className="hidden"
                                  onChange={(e) => { const f = e.target.files?.[0]; if (f) setNewVerHtml(f); }} />
                              </div>
                              <div className="flex gap-2 justify-end">
                                <Button size="sm" variant="ghost" className="h-6 px-2 text-xs" onClick={() => setNewVersionApp(null)}>取消</Button>
                                <Button size="sm" className="h-6 px-2 text-xs gap-1" disabled={submittingVer} onClick={() => handleSubmitVersion(s.id)}>
                                  {submittingVer ? <Loader2 className="h-3 w-3 animate-spin" /> : <Upload className="h-3 w-3" />}
                                  {t("verSubmitBtn")}
                                </Button>
                              </div>
                            </div>
                          )}

                          {loadingVer === s.id ? (
                            <div className="flex justify-center py-4 text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /></div>
                          ) : (versions[s.id] || []).length === 0 ? (
                            <p className="text-xs text-muted-foreground text-center py-2">{t("noVersions")}</p>
                          ) : (
                            <div className="space-y-1.5">
                              {(versions[s.id] || []).map((v) => {
                                const vs = STATUS_CONFIG[v.status] || STATUS_CONFIG.draft;
                                const VsIcon = vs.icon;
                                return (
                                  <div key={v.id} className="flex items-center gap-3 px-3 py-2 rounded-lg bg-muted/30 text-sm">
                                    <code className="font-mono text-xs font-semibold w-16 shrink-0">{v.version_tag}</code>
                                    <Badge variant="outline" className={`text-xs shrink-0 ${vs.color}`}>
                                      <VsIcon className="mr-1 h-3 w-3" />{vs.label[lang]}
                                    </Badge>
                                    <span className="text-xs text-muted-foreground flex-1 truncate">{v.changelog_i18n?.[lang] || v.changelog_i18n?.en || ""}</span>
                                    {v.widget_url && (
                                      <a href={v.widget_url} target="_blank" rel="noopener noreferrer" className="text-primary shrink-0">
                                        <ExternalLink className="h-3 w-3" />
                                      </a>
                                    )}
                                    <span className="text-xs text-muted-foreground shrink-0">{new Date(v.created_at).toLocaleDateString()}</span>
                                  </div>
                                );
                              })}
                            </div>
                          )}

                          <Separator />

                          {/* ── Webhook Logs ── */}
                          <SectionHeading icon={<Webhook className="h-3.5 w-3.5" />} title={t("logsSection")}
                            action={
                              <Button size="sm" variant="ghost" className="h-6 px-2 text-xs gap-1"
                                disabled={loadingLog === s.id} onClick={() => loadLogs(s.id)}>
                                <RefreshCw className={`h-3 w-3 ${loadingLog === s.id ? "animate-spin" : ""}`} />
                              </Button>
                            }
                          />
                          {loadingLog === s.id ? (
                            <div className="flex justify-center py-4 text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /></div>
                          ) : (webhookLogs[s.id] || []).length === 0 ? (
                            <p className="text-xs text-muted-foreground text-center py-2">{t("noLogs")}</p>
                          ) : (
                            <div className="space-y-1">
                              {(webhookLogs[s.id] || []).map((log) => (
                                <div key={log.id} className="flex items-center gap-3 px-3 py-1.5 rounded bg-muted/30 text-xs">
                                  <span className={`shrink-0 w-2 h-2 rounded-full ${log.error_msg ? "bg-red-500" : log.status_code && log.status_code < 300 ? "bg-green-500" : "bg-yellow-500"}`} />
                                  <code className="text-muted-foreground shrink-0 w-32">{log.event_type}</code>
                                  <span className="shrink-0 w-10 text-center font-mono">{log.status_code ?? "—"}</span>
                                  {log.error_msg && (
                                    <span className="text-red-500 truncate flex-1 flex items-center gap-1">
                                      <AlertTriangle className="h-3 w-3 shrink-0" />{log.error_msg}
                                    </span>
                                  )}
                                  <span className="text-muted-foreground ml-auto shrink-0">
                                    {new Date(log.delivered_at).toLocaleString()}
                                  </span>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </TabsContent>
      </Tabs>

      {/* ── Credentials dialog ── */}
      <Dialog open={credsDialog} onOpenChange={(o) => { if (!o) setCredsDialog(false); }}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <CheckCircle2 className="h-5 w-5 text-green-500" />{credsTitle}
            </DialogTitle>
            <DialogDescription>{t("credsDesc")}</DialogDescription>
          </DialogHeader>
          {creds && (
            <div className="space-y-4 py-2">
              {creds.api_key && (
                <CredRow label={t("apiKey")} value={creds.api_key} id="cred-key"
                  copied={copied === "cred-key"} onCopy={() => copyText(creds.api_key!, "cred-key")} />
              )}
              <CredRow label={t("apiSecret")} value={creds.api_secret} id="cred-secret"
                amber copied={copied === "cred-secret"} onCopy={() => copyText(creds.api_secret, "cred-secret")} />
            </div>
          )}
          <div className="flex justify-end pt-2">
            <Button onClick={() => setCredsDialog(false)}>{t("closeBtn")}</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ── Small helpers ──────────────────────────────────────────────────────────────
function SectionHeading({ icon, title, action }: { icon: React.ReactNode; title: string; action?: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-muted-foreground">{icon}</span>
      <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground flex-1">{title}</span>
      {action}
    </div>
  );
}

function CredRow({ label, value, id, amber, copied, onCopy }: {
  label: string; value: string; id: string; amber?: boolean; copied: boolean; onCopy: () => void;
}) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      <div className="flex items-center gap-2">
        <code className={`flex-1 text-sm p-2.5 rounded-lg font-mono break-all ${amber ? "bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 text-amber-800 dark:text-amber-200" : "bg-muted"}`}>
          {value}
        </code>
        <Button size="icon" variant="outline" className="shrink-0 h-9 w-9" onClick={onCopy}>
          {copied ? <Check className="h-3.5 w-3.5 text-green-500" /> : <Copy className="h-3.5 w-3.5" />}
        </Button>
      </div>
    </div>
  );
}
