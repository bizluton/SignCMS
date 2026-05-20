import { useState, useEffect, useCallback } from "react";
import { useLanguage } from "@/contexts/LanguageContext";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import {
import { formatUserError } from "@/lib/formatUserError";
  CheckCircle2, XCircle, PauseCircle, Clock, Loader2, Puzzle,
  ExternalLink, RefreshCw, Eye, ShieldCheck, GitBranch, FileCheck2,
} from "lucide-react";

// ── Types ─────────────────────────────────────────────────────────────────────

interface StoreApp {
  id: string;
  slug: string;
  name_i18n:   Record<string, string>;
  desc_i18n:   Record<string, string>;
  gradient:    string;
  publisher:   string;
  website_url:  string | null;
  webhook_url:  string | null;
  widget_url:   string | null;
  api_key:      string;
  status:       "pending" | "approved" | "rejected" | "suspended";
  submitted_by: string | null;
  reviewed_by:  string | null;
  active_version_id: string | null;
  created_at:  string;
  updated_at:  string;
}

interface AppVersion {
  id:             string;
  app_id:         string;
  version_tag:    string;
  widget_url:     string;
  changelog_i18n: Record<string, string>;
  status:         "draft" | "active" | "deprecated" | "rejected";
  review_note:    string | null;
  submitted_by:   string | null;
  reviewed_by:    string | null;
  created_at:     string;
  updated_at:     string;
  store_apps:     { slug: string; name_i18n: Record<string, string>; gradient: string; active_version_id: string | null };
}

// ── Static config ──────────────────────────────────────────────────────────────

const STATUS_TABS = ["all", "pending", "approved", "rejected", "suspended"] as const;

const STATUS_CONFIG: Record<string, {
  icon: React.ComponentType<{ className?: string }>;
  color: string;
  label: { zh: string; en: string; ja: string };
}> = {
  pending:    { icon: Clock,        color: "bg-yellow-500/10 text-yellow-600 border-yellow-500/30", label: { zh: "待審核", en: "Pending",   ja: "審査中" } },
  approved:   { icon: CheckCircle2, color: "bg-green-500/10  text-green-600  border-green-500/30",  label: { zh: "已通過", en: "Approved",  ja: "承認済" } },
  rejected:   { icon: XCircle,      color: "bg-red-500/10    text-red-600    border-red-500/30",    label: { zh: "已拒絕", en: "Rejected",  ja: "拒否"  } },
  suspended:  { icon: PauseCircle,  color: "bg-gray-500/10   text-gray-500   border-gray-500/30",   label: { zh: "已停用", en: "Suspended", ja: "停止中" } },
};

const VER_STATUS_CONFIG: Record<string, { color: string; label: { zh: string; en: string; ja: string } }> = {
  draft:      { color: "bg-yellow-500/10 text-yellow-600 border-yellow-500/30", label: { zh: "待審核", en: "Draft",      ja: "下書き" } },
  active:     { color: "bg-green-500/10  text-green-600  border-green-500/30",  label: { zh: "使用中", en: "Active",     ja: "使用中" } },
  deprecated: { color: "bg-gray-500/10   text-gray-400   border-gray-400/30",   label: { zh: "已棄用", en: "Deprecated", ja: "非推奨" } },
  rejected:   { color: "bg-red-500/10    text-red-600    border-red-500/30",    label: { zh: "已拒絕", en: "Rejected",   ja: "拒否"  } },
};

// ── Component ─────────────────────────────────────────────────────────────────

export default function AppReviewPage() {
  const { language, t } = useLanguage();
  const { user } = useAuth();
  const lang = language as "zh" | "en" | "ja";

  // Apps state
  const [apps, setApps] = useState<StoreApp[]>([]);
  const [appsLoading, setAppsLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<string>("all");
  const [detailApp, setDetailApp] = useState<StoreApp | null>(null);
  const [confirmAction, setConfirmAction] = useState<{ app: StoreApp; action: "approve" | "reject" | "suspend" } | null>(null);
  const [actioning, setActioning] = useState(false);

  // Versions state
  const [draftVersions, setDraftVersions] = useState<AppVersion[]>([]);
  const [versionsLoading, setVersionsLoading] = useState(false);
  const [confirmVersion, setConfirmVersion] = useState<{ version: AppVersion; action: "approve" | "reject" } | null>(null);
  const [rejectNote, setRejectNote] = useState("");
  const [versionActioning, setVersionActioning] = useState(false);

  // ── Translations ─────────────────────────────────────────────────────────────
  const T = {
    title:        { zh: "應用商店審核", en: "App Store Review",  ja: "アプリストア審査" },
    desc:         { zh: "審核第三方開發者的 Widget 申請與版本更新", en: "Review third-party widget submissions and version updates", ja: "サードパーティウィジェットの申請とバージョン更新を審査" },
    sectionApps:  { zh: "應用申請", en: "Applications", ja: "アプリ申請" },
    sectionVers:  { zh: "版本審核", en: "Version Review", ja: "バージョン審査" },
    tabAll:       { zh: "全部",   en: "All",       ja: "すべて"  },
    tabPending:   { zh: "待審核", en: "Pending",   ja: "審査中"  },
    tabApproved:  { zh: "已通過", en: "Approved",  ja: "承認済"  },
    tabRejected:  { zh: "已拒絕", en: "Rejected",  ja: "拒否"    },
    tabSuspended: { zh: "已停用", en: "Suspended", ja: "停止中"  },
    approve:      { zh: "通過",   en: "Approve",   ja: "承認"    },
    reject:       { zh: "拒絕",   en: "Reject",    ja: "拒否"    },
    suspend:      { zh: "停用",   en: "Suspend",   ja: "停止"    },
    detail:       { zh: "詳情",   en: "Details",   ja: "詳細"    },
    noApps:       { zh: "此分類沒有申請", en: "No apps in this category", ja: "この分類に申請はありません" },
    noDraftVers:  { zh: "目前沒有待審核的版本", en: "No pending version reviews", ja: "審査待ちバージョンはありません" },
    confirmApproveTitle:  { zh: "確認通過此申請？",   en: "Approve this app?",     ja: "このアプリを承認しますか？"       },
    confirmApproveDesc:   { zh: "通過後會在應用商店上架，並自動建立對應 Widget 項目。", en: "The app will appear in the App Store and a widget entry will be created automatically.", ja: "承認するとアプリストアに公開され、Widgetエントリが自動作成されます。" },
    confirmRejectTitle:   { zh: "確認拒絕此申請？",   en: "Reject this app?",      ja: "このアプリを拒否しますか？"       },
    confirmRejectDesc:    { zh: "拒絕後開發者可重新修改提交。", en: "The developer can revise and resubmit.", ja: "開発者は修正して再提出できます。" },
    confirmSuspendTitle:  { zh: "確認停用此應用？",   en: "Suspend this app?",     ja: "このアプリを停止しますか？"       },
    confirmSuspendDesc:   { zh: "停用後此應用將從商店下架，已安裝組織仍保留記錄。", en: "The app will be removed from the store. Existing installs remain in the database.", ja: "停止するとストアから削除されます。既存のインストール記録は保持されます。" },
    confirmVerApproveTitle: { zh: "確認發布此版本？",  en: "Publish this version?",  ja: "このバージョンを公開しますか？"   },
    confirmVerApproveDesc:  { zh: "舊的 active 版本將自動標記為 deprecated，Widget URL 將更新為新版本。", en: "The previous active version will be deprecated and the widget URL updated to this release.", ja: "既存のactiveバージョンはdeprecatedになり、Widget URLが新バージョンに更新されます。" },
    confirmVerRejectTitle:  { zh: "確認拒絕此版本？",  en: "Reject this version?",   ja: "このバージョンを拒否しますか？"   },
    confirmVerRejectDesc:   { zh: "開發者可在開發者入口查看拒絕備注後重新提交。", en: "The developer will see your note and can resubmit.", ja: "開発者はメモを確認し再提出できます。" },
    rejectNotePlaceholder:  { zh: "拒絕原因（選填）", en: "Reason for rejection (optional)", ja: "拒否理由（任意）" },
    confirmBtn:   { zh: "確認", en: "Confirm", ja: "確認" },
    cancelBtn:    { zh: "取消", en: "Cancel",  ja: "キャンセル" },
    successApprove:      { zh: "已通過審核",     en: "App approved",          ja: "承認しました"         },
    successReject:       { zh: "已拒絕申請",     en: "App rejected",          ja: "拒否しました"         },
    successSuspend:      { zh: "已停用應用",     en: "App suspended",         ja: "停止しました"         },
    successVerApprove:   { zh: "版本已發布",     en: "Version published",     ja: "バージョンを公開しました" },
    successVerReject:    { zh: "版本已拒絕",     en: "Version rejected",      ja: "バージョンを拒否しました" },
    publisher:    { zh: "發佈者",   en: "Publisher",  ja: "パブリッシャー" },
    slug:         { zh: "識別碼",   en: "Slug",       ja: "スラッグ"     },
    widgetUrl:    { zh: "Widget URL",  en: "Widget URL",  ja: "Widget URL"  },
    webhookUrl:   { zh: "Webhook URL", en: "Webhook URL", ja: "Webhook URL" },
    apiKey:       { zh: "API Key",     en: "API Key",     ja: "APIキー"     },
    submittedAt:  { zh: "提交日期",   en: "Submitted",  ja: "申請日"       },
    changelog:    { zh: "更新說明",   en: "Changelog",  ja: "更新内容"     },
    close:        { zh: "關閉",       en: "Close",      ja: "閉じる"       },
    versionTag:   { zh: "版本號",     en: "Version",    ja: "バージョン"   },
    appName:      { zh: "應用名稱",   en: "App Name",   ja: "アプリ名"     },
  };
  const t = (k: keyof typeof T) => T[k][lang] ?? T[k].zh;

  // ── Data loaders ──────────────────────────────────────────────────────────────

  const loadApps = useCallback(async () => {
    setAppsLoading(true);
    const { data, error } = await supabase
      .from("store_apps")
      .select("id, slug, name_i18n, desc_i18n, gradient, publisher, website_url, webhook_url, widget_url, api_key, status, submitted_by, reviewed_by, active_version_id, created_at, updated_at")
      .order("created_at", { ascending: false });
    if (!error) setApps((data as StoreApp[]) || []);
    setAppsLoading(false);
  }, []);

  const loadVersions = useCallback(async () => {
    setVersionsLoading(true);
    const { data, error } = await supabase
      .from("store_app_versions")
      .select("id, app_id, version_tag, widget_url, changelog_i18n, status, review_note, submitted_by, reviewed_by, created_at, updated_at, store_apps(slug, name_i18n, gradient, active_version_id)")
      .eq("status", "draft")
      .order("created_at", { ascending: true });
    if (!error) setDraftVersions((data as unknown as AppVersion[]) || []);
    setVersionsLoading(false);
  }, []);

  useEffect(() => { void loadApps(); void loadVersions(); }, [loadApps, loadVersions]);

  // ── App actions ───────────────────────────────────────────────────────────────

  const handleAppAction = async () => {
    if (!confirmAction || !user) return;
    const { app, action } = confirmAction;
    setActioning(true);

    const newStatus = action === "approve" ? "approved" : action === "reject" ? "rejected" : "suspended";
    const { error } = await supabase
      .from("store_apps")
      .update({ status: newStatus, reviewed_by: user.id, updated_at: new Date().toISOString() })
      .eq("id", app.id);

    if (error) { toast.error(formatUserError(error, t)); setActioning(false); return; }

    if (action === "approve") {
      const widgetName = app.name_i18n[lang] || app.name_i18n.en || app.slug;
      await supabase.from("widgets").upsert({
        scope:       "external",
        widget_type: app.slug,
        app_id:      app.slug,
        name:        widgetName,
        name_i18n:   app.name_i18n,
        config:      { url: app.widget_url, widgetType: app.slug, widgetScope: "external", widgetAppId: app.id },
        thumbnail:   "",
        sort_order:  999,
        created_by:  user.id,
        updated_at:  new Date().toISOString(),
      }, { onConflict: "widget_type" });

      supabase.functions.invoke("deliver-webhook", {
        body: { appId: app.id, eventType: "app.approved" },
      }).catch(() => {});
    }

    if (action === "reject") {
      supabase.functions.invoke("deliver-webhook", {
        body: { appId: app.id, eventType: "app.rejected" },
      }).catch(() => {});
    }

    if (action === "suspend") {
      supabase.functions.invoke("deliver-webhook", {
        body: { appId: app.id, eventType: "app.suspended" },
      }).catch(() => {});
    }

    toast.success(t(action === "approve" ? "successApprove" : action === "reject" ? "successReject" : "successSuspend"));
    setConfirmAction(null);
    setActioning(false);
    void loadApps();
  };

  // ── Version actions ───────────────────────────────────────────────────────────

  const handleVersionAction = async () => {
    if (!confirmVersion || !user) return;
    const { version, action } = confirmVersion;
    setVersionActioning(true);

    try {
      if (action === "approve") {
        // Deprecate the current active version if any
        const currentActiveId = version.store_apps?.active_version_id;
        if (currentActiveId && currentActiveId !== version.id) {
          await supabase.from("store_app_versions")
            .update({ status: "deprecated", updated_at: new Date().toISOString() })
            .eq("id", currentActiveId);
        }

        // Activate this version
        const { error: e1 } = await supabase.from("store_app_versions")
          .update({ status: "active", reviewed_by: user.id, updated_at: new Date().toISOString() })
          .eq("id", version.id);
        if (e1) throw e1;

        // Update the parent app's active pointer and widget_url
        const { error: e2 } = await supabase.from("store_apps")
          .update({ active_version_id: version.id, widget_url: version.widget_url, updated_at: new Date().toISOString() })
          .eq("id", version.app_id);
        if (e2) throw e2;

        // Keep the widgets row's config.url in sync
        const { data: wRow } = await supabase.from("widgets")
          .select("config")
          .eq("widget_type", version.store_apps.slug)
          .maybeSingle();
        if (wRow) {
          await supabase.from("widgets")
            .update({ config: { ...(wRow.config as Record<string, unknown>), url: version.widget_url }, updated_at: new Date().toISOString() })
            .eq("widget_type", version.store_apps.slug);
        }

        // Fire webhook (non-fatal)
        supabase.functions.invoke("deliver-webhook", {
          body: { appId: version.app_id, eventType: "version.approved", extraPayload: { versionTag: version.version_tag, widgetUrl: version.widget_url } },
        }).catch(() => {});

        toast.success(t("successVerApprove"));

      } else {
        const { error } = await supabase.from("store_app_versions")
          .update({ status: "rejected", reviewed_by: user.id, review_note: rejectNote || null, updated_at: new Date().toISOString() })
          .eq("id", version.id);
        if (error) throw error;

        supabase.functions.invoke("deliver-webhook", {
          body: { appId: version.app_id, eventType: "version.rejected", extraPayload: { versionTag: version.version_tag } },
        }).catch(() => {});

        toast.success(t("successVerReject"));
      }

      setConfirmVersion(null);
      setRejectNote("");
      void loadVersions();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : String(err));
    }
    setVersionActioning(false);
  };

  // ── Render helpers ────────────────────────────────────────────────────────────

  const filtered = activeTab === "all" ? apps : apps.filter((a) => a.status === activeTab);
  const tabCount = (tab: typeof STATUS_TABS[number]) =>
    tab === "all" ? apps.length : apps.filter((a) => a.status === tab).length;

  const renderAppCard = (app: StoreApp) => {
    const sc = STATUS_CONFIG[app.status] || STATUS_CONFIG.pending;
    const StatusIcon = sc.icon;
    const name = app.name_i18n[lang] || app.name_i18n.en || app.slug;
    return (
      <div key={app.id} className="flex items-start gap-4 p-4 rounded-xl border bg-card hover:bg-accent/20 transition-colors">
        <div className={`shrink-0 w-12 h-12 rounded-xl bg-gradient-to-br ${app.gradient || "from-gray-500 to-gray-600"} flex items-center justify-center shadow-sm`}>
          <Puzzle className="h-6 w-6 text-white" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold text-sm">{name}</span>
            <code className="text-xs bg-muted px-1.5 py-0.5 rounded">{app.slug}</code>
            <Badge variant="outline" className={`text-xs ${sc.color}`}>
              <StatusIcon className="mr-1 h-3 w-3" />{sc.label[lang]}
            </Badge>
          </div>
          <div className="mt-0.5 flex items-center gap-3 flex-wrap text-xs text-muted-foreground">
            <span>{app.publisher}</span>
            <span>·</span>
            <span>{new Date(app.created_at).toLocaleDateString()}</span>
            {app.widget_url && (
              <a href={app.widget_url} target="_blank" rel="noopener noreferrer"
                className="text-primary flex items-center gap-1 hover:underline">
                Widget <ExternalLink className="h-3 w-3" />
              </a>
            )}
          </div>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <Button size="sm" variant="outline" className="h-7 px-2 text-xs gap-1" onClick={() => setDetailApp(app)}>
            <Eye className="h-3 w-3" />{t("detail")}
          </Button>
          {app.status !== "approved" && (
            <Button size="sm" variant="outline" className="h-7 px-2 text-xs gap-1 text-green-600 hover:text-green-600 hover:border-green-500"
              onClick={() => setConfirmAction({ app, action: "approve" })}>
              <CheckCircle2 className="h-3 w-3" />{t("approve")}
            </Button>
          )}
          {app.status !== "rejected" && app.status !== "suspended" && (
            <Button size="sm" variant="outline" className="h-7 px-2 text-xs gap-1 text-red-600 hover:text-red-600 hover:border-red-500"
              onClick={() => setConfirmAction({ app, action: "reject" })}>
              <XCircle className="h-3 w-3" />{t("reject")}
            </Button>
          )}
          {app.status === "approved" && (
            <Button size="sm" variant="outline" className="h-7 px-2 text-xs gap-1 text-gray-500 hover:text-gray-500"
              onClick={() => setConfirmAction({ app, action: "suspend" })}>
              <PauseCircle className="h-3 w-3" />{t("suspend")}
            </Button>
          )}
        </div>
      </div>
    );
  };

  const renderVersionCard = (ver: AppVersion) => {
    const appName = ver.store_apps?.name_i18n?.[lang] || ver.store_apps?.name_i18n?.en || ver.store_apps?.slug || ver.app_id;
    const cl = ver.changelog_i18n?.[lang] || ver.changelog_i18n?.en || "";
    return (
      <div key={ver.id} className="flex items-start gap-4 p-4 rounded-xl border bg-card hover:bg-accent/20 transition-colors">
        <div className={`shrink-0 w-12 h-12 rounded-xl bg-gradient-to-br ${ver.store_apps?.gradient || "from-gray-500 to-gray-600"} flex items-center justify-center shadow-sm`}>
          <GitBranch className="h-6 w-6 text-white" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold text-sm">{appName}</span>
            <Badge variant="outline" className="text-xs bg-yellow-500/10 text-yellow-600 border-yellow-500/30">
              v{ver.version_tag}
            </Badge>
          </div>
          {cl && <p className="mt-1 text-xs text-muted-foreground line-clamp-2">{cl}</p>}
          <div className="mt-1 flex items-center gap-3 flex-wrap text-xs text-muted-foreground">
            <span>{new Date(ver.created_at).toLocaleDateString()}</span>
            {ver.widget_url && (
              <a href={ver.widget_url} target="_blank" rel="noopener noreferrer"
                className="text-primary flex items-center gap-1 hover:underline">
                Widget URL <ExternalLink className="h-3 w-3" />
              </a>
            )}
          </div>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <Button size="sm" variant="outline" className="h-7 px-2 text-xs gap-1 text-green-600 hover:text-green-600 hover:border-green-500"
            onClick={() => setConfirmVersion({ version: ver, action: "approve" })}>
            <CheckCircle2 className="h-3 w-3" />{t("approve")}
          </Button>
          <Button size="sm" variant="outline" className="h-7 px-2 text-xs gap-1 text-red-600 hover:text-red-600 hover:border-red-500"
            onClick={() => { setRejectNote(""); setConfirmVersion({ version: ver, action: "reject" }); }}>
            <XCircle className="h-3 w-3" />{t("reject")}
          </Button>
        </div>
      </div>
    );
  };

  // ── JSX ───────────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6 animate-fade-in max-w-5xl">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <ShieldCheck className="h-6 w-6 text-primary" />
            {t("title")}
          </h1>
          <p className="text-sm text-muted-foreground mt-1">{t("desc")}</p>
        </div>
        <Button variant="outline" size="sm" className="gap-1.5"
          onClick={() => { void loadApps(); void loadVersions(); }}
          disabled={appsLoading || versionsLoading}>
          <RefreshCw className={`h-3.5 w-3.5 ${(appsLoading || versionsLoading) ? "animate-spin" : ""}`} />
        </Button>
      </div>

      {/* Top-level section tabs */}
      <Tabs defaultValue="apps">
        <TabsList>
          <TabsTrigger value="apps" className="gap-1.5">
            <Puzzle className="h-3.5 w-3.5" />{t("sectionApps")}
            {apps.filter((a) => a.status === "pending").length > 0 && (
              <Badge className="ml-0.5 text-xs px-1.5 bg-yellow-500/20 text-yellow-700">
                {apps.filter((a) => a.status === "pending").length}
              </Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="versions" className="gap-1.5">
            <FileCheck2 className="h-3.5 w-3.5" />{t("sectionVers")}
            {draftVersions.length > 0 && (
              <Badge className="ml-0.5 text-xs px-1.5 bg-yellow-500/20 text-yellow-700">
                {draftVersions.length}
              </Badge>
            )}
          </TabsTrigger>
        </TabsList>

        {/* ── Applications section ── */}
        <TabsContent value="apps" className="mt-4">
          <Tabs value={activeTab} onValueChange={setActiveTab}>
            <TabsList>
              {STATUS_TABS.map((tab) => (
                <TabsTrigger key={tab} value={tab} className="gap-1.5">
                  {T[`tab${tab.charAt(0).toUpperCase() + tab.slice(1)}` as keyof typeof T]?.[lang] ?? tab}
                  {tabCount(tab) > 0 && (
                    <Badge className={`ml-0.5 text-xs px-1.5 ${
                      tab === "pending"  ? "bg-yellow-500/20 text-yellow-700" :
                      tab === "approved" ? "bg-green-500/20 text-green-700" :
                      "bg-muted text-muted-foreground"
                    }`}>{tabCount(tab)}</Badge>
                  )}
                </TabsTrigger>
              ))}
            </TabsList>
            {STATUS_TABS.map((tab) => (
              <TabsContent key={tab} value={tab} className="mt-4">
                <Card>
                  <CardContent className="pt-4">
                    {appsLoading ? (
                      <div className="flex justify-center py-12 text-muted-foreground">
                        <Loader2 className="h-6 w-6 animate-spin" />
                      </div>
                    ) : filtered.length === 0 ? (
                      <div className="text-center py-12 text-muted-foreground">
                        <Puzzle className="mx-auto h-10 w-10 mb-3 opacity-30" />
                        <p>{t("noApps")}</p>
                      </div>
                    ) : (
                      <div className="space-y-2">{filtered.map(renderAppCard)}</div>
                    )}
                  </CardContent>
                </Card>
              </TabsContent>
            ))}
          </Tabs>
        </TabsContent>

        {/* ── Versions section ── */}
        <TabsContent value="versions" className="mt-4">
          <Card>
            <CardContent className="pt-4">
              {versionsLoading ? (
                <div className="flex justify-center py-12 text-muted-foreground">
                  <Loader2 className="h-6 w-6 animate-spin" />
                </div>
              ) : draftVersions.length === 0 ? (
                <div className="text-center py-12 text-muted-foreground">
                  <GitBranch className="mx-auto h-10 w-10 mb-3 opacity-30" />
                  <p>{t("noDraftVers")}</p>
                </div>
              ) : (
                <div className="space-y-2">{draftVersions.map(renderVersionCard)}</div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* ── App detail dialog ── */}
      <Dialog open={!!detailApp} onOpenChange={(o) => { if (!o) setDetailApp(null); }}>
        <DialogContent className="sm:max-w-lg">
          {detailApp && (() => {
            const sc = STATUS_CONFIG[detailApp.status] || STATUS_CONFIG.pending;
            const StatusIcon = sc.icon;
            const name = detailApp.name_i18n[lang] || detailApp.name_i18n.en || detailApp.slug;
            return (
              <>
                <DialogHeader>
                  <DialogTitle className="flex items-center gap-3">
                    <div className={`w-10 h-10 rounded-xl bg-gradient-to-br ${detailApp.gradient} flex items-center justify-center`}>
                      <Puzzle className="h-5 w-5 text-white" />
                    </div>
                    {name}
                  </DialogTitle>
                  <DialogDescription>
                    <Badge variant="outline" className={`text-xs ${sc.color}`}>
                      <StatusIcon className="mr-1 h-3 w-3" />{sc.label[lang]}
                    </Badge>
                  </DialogDescription>
                </DialogHeader>
                <div className="space-y-3 py-2 text-sm">
                  <Row label={t("slug")}><code className="bg-muted px-1.5 py-0.5 rounded text-xs">{detailApp.slug}</code></Row>
                  <Row label={t("publisher")}>{detailApp.publisher}</Row>
                  {detailApp.widget_url && <Row label={t("widgetUrl")}><a href={detailApp.widget_url} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline text-xs break-all flex items-center gap-1">{detailApp.widget_url}<ExternalLink className="h-3 w-3 shrink-0" /></a></Row>}
                  {detailApp.webhook_url && <Row label={t("webhookUrl")}><span className="text-xs break-all text-muted-foreground">{detailApp.webhook_url}</span></Row>}
                  {detailApp.website_url && <Row label="Website"><a href={detailApp.website_url} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline text-xs">{detailApp.website_url}</a></Row>}
                  <Row label={t("apiKey")}><code className="text-xs bg-muted px-1.5 py-0.5 rounded">{detailApp.api_key}</code></Row>
                  <Row label={t("submittedAt")}>{new Date(detailApp.created_at).toLocaleString()}</Row>
                  {detailApp.desc_i18n[lang] && (
                    <div>
                      <span className="text-xs font-medium text-muted-foreground">Description</span>
                      <p className="mt-1 text-sm text-foreground/80">{detailApp.desc_i18n[lang]}</p>
                    </div>
                  )}
                </div>
                <DialogFooter className="gap-2 flex-wrap">
                  {detailApp.status !== "approved" && (
                    <Button size="sm" className="gap-1.5 bg-green-600 hover:bg-green-700 text-white"
                      onClick={() => { setDetailApp(null); setConfirmAction({ app: detailApp, action: "approve" }); }}>
                      <CheckCircle2 className="h-3.5 w-3.5" />{t("approve")}
                    </Button>
                  )}
                  {detailApp.status !== "rejected" && detailApp.status !== "suspended" && (
                    <Button size="sm" variant="outline" className="gap-1.5 text-red-600 border-red-300 hover:bg-red-50"
                      onClick={() => { setDetailApp(null); setConfirmAction({ app: detailApp, action: "reject" }); }}>
                      <XCircle className="h-3.5 w-3.5" />{t("reject")}
                    </Button>
                  )}
                  {detailApp.status === "approved" && (
                    <Button size="sm" variant="outline" className="gap-1.5 text-gray-500"
                      onClick={() => { setDetailApp(null); setConfirmAction({ app: detailApp, action: "suspend" }); }}>
                      <PauseCircle className="h-3.5 w-3.5" />{t("suspend")}
                    </Button>
                  )}
                  <Button variant="outline" size="sm" onClick={() => setDetailApp(null)}>{t("close")}</Button>
                </DialogFooter>
              </>
            );
          })()}
        </DialogContent>
      </Dialog>

      {/* ── App confirm dialog ── */}
      <AlertDialog open={!!confirmAction} onOpenChange={(o) => { if (!o) setConfirmAction(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirmAction && t(`confirm${confirmAction.action.charAt(0).toUpperCase() + confirmAction.action.slice(1)}Title` as keyof typeof T)}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirmAction && t(`confirm${confirmAction.action.charAt(0).toUpperCase() + confirmAction.action.slice(1)}Desc` as keyof typeof T)}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={actioning}>{t("cancelBtn")}</AlertDialogCancel>
            <AlertDialogAction onClick={handleAppAction} disabled={actioning}
              className={confirmAction?.action === "reject" ? "bg-red-600 hover:bg-red-700" :
                         confirmAction?.action === "approve" ? "bg-green-600 hover:bg-green-700" : ""}>
              {actioning ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              {t("confirmBtn")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ── Version confirm dialog ── */}
      <AlertDialog open={!!confirmVersion} onOpenChange={(o) => { if (!o) { setConfirmVersion(null); setRejectNote(""); } }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirmVersion?.action === "approve" ? t("confirmVerApproveTitle") : t("confirmVerRejectTitle")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirmVersion?.action === "approve" ? t("confirmVerApproveDesc") : t("confirmVerRejectDesc")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {confirmVersion?.action === "reject" && (
            <Textarea
              className="mt-2 text-sm"
              placeholder={t("rejectNotePlaceholder")}
              rows={3}
              value={rejectNote}
              onChange={(e) => setRejectNote(e.target.value)}
            />
          )}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={versionActioning}>{t("cancelBtn")}</AlertDialogCancel>
            <AlertDialogAction onClick={handleVersionAction} disabled={versionActioning}
              className={confirmVersion?.action === "reject" ? "bg-red-600 hover:bg-red-700" : "bg-green-600 hover:bg-green-700"}>
              {versionActioning ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              {t("confirmBtn")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-3">
      <span className="text-xs font-medium text-muted-foreground w-24 shrink-0 pt-0.5">{label}</span>
      <div className="flex-1">{children}</div>
    </div>
  );
}
