import { useState, useEffect, useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { useLanguage } from "@/contexts/LanguageContext";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Megaphone, Users, CloudSun, Instagram, Check, Download, Monitor, DoorOpen, Languages, Clock, Lock, Package, Puzzle } from "lucide-react";
import { toast } from "sonner";
import { useInstalledApps, type ExternalAppInfo } from "@/contexts/InstalledAppsContext";
import { useUserRole } from "@/hooks/useUserRole";
import { useOrgPlan, PLAN_LABELS } from "@/hooks/useOrgPlan";
import { PlanUsageBar } from "@/components/PlanUsageBar";

interface AppItem {
  id: string;
  icon: React.ReactNode;
  name: { zh: string; en: string; ja: string };
  description: { zh: string; en: string; ja: string };
  category: { zh: string; en: string; ja: string };
  color: string;
  hasConfig?: boolean;
  isExternal?: boolean;    // from store_apps DB table
  _externalUuid?: string;  // store_apps.id — needed for DB install/uninstall
}

const APPS: AppItem[] = [
  {
    id: "announcement",
    icon: <Megaphone className="h-7 w-7 text-white" />,
    name: { zh: "公告發佈管理", en: "Announcement Manager", ja: "お知らせ管理" },
    description: {
      zh: "在螢幕最下方加入跑馬燈或緊急全螢幕公告",
      en: "Add scrolling tickers or emergency full-screen alerts",
      ja: "画面下部にテロップや緊急フルスクリーン通知を追加",
    },
    category: { zh: "營運工具", en: "Operations", ja: "運用ツール" },
    color: "from-orange-500 to-amber-500",
  },
  {
    id: "queue",
    icon: <Users className="h-7 w-7 text-white" />,
    name: { zh: "排隊叫號管理", en: "Queue Management", ja: "順番呼出し管理" },
    description: {
      zh: "串接現場排隊系統，在螢幕角落顯示叫號資訊",
      en: "Connect queue systems to display ticket numbers on screen",
      ja: "現場の順番待ちシステムと連携し、画面に番号を表示",
    },
    category: { zh: "現場服務", en: "On-Site Service", ja: "現場サービス" },
    color: "from-blue-500 to-cyan-500",
    hasConfig: true,
  },
  {
    id: "weather",
    icon: <CloudSun className="h-7 w-7 text-white" />,
    name: { zh: "即時天氣與新聞", en: "Weather & News Feed", ja: "リアルタイム天気・ニュース" },
    description: {
      zh: "自動顯示當地的氣溫與頭條新聞",
      en: "Automatically display local weather and headline news",
      ja: "地元の天気と最新ニュースを自動表示",
    },
    category: { zh: "資訊服務", en: "Information", ja: "情報サービス" },
    color: "from-emerald-500 to-teal-500",
  },
  {
    id: "social",
    icon: <Instagram className="h-7 w-7 text-white" />,
    name: { zh: "社群互動牆", en: "Social Media Wall", ja: "ソーシャルメディアウォール" },
    description: {
      zh: "同步顯示品牌 Instagram 的最新貼文",
      en: "Sync and display your brand's latest Instagram posts",
      ja: "ブランドのInstagram最新投稿を同期表示",
    },
    category: { zh: "行銷工具", en: "Marketing", ja: "マーケティング" },
    color: "from-pink-500 to-rose-500",
  },
  {
    id: "meeting-room",
    icon: <DoorOpen className="h-7 w-7 text-white" />,
    name: { zh: "會議室管理", en: "Meeting Room Manager", ja: "会議室管理" },
    description: {
      zh: "在螢幕上顯示會議室預約狀態與即時排程",
      en: "Display meeting room bookings and real-time schedules on screen",
      ja: "会議室の予約状況とリアルタイムスケジュールを画面に表示",
    },
    category: { zh: "辦公管理", en: "Office", ja: "オフィス管理" },
    color: "from-violet-500 to-purple-500",
  },
  {
    id: "multilingual",
    icon: <Languages className="h-7 w-7 text-white" />,
    name: { zh: "多語言翻譯", en: "Multilingual Display", ja: "多言語翻訳表示" },
    description: {
      zh: "自動將公告內容翻譯為多國語言輪播顯示",
      en: "Auto-translate announcements and rotate in multiple languages",
      ja: "お知らせを自動翻訳し多言語でローテーション表示",
    },
    category: { zh: "國際化", en: "i18n", ja: "国際化" },
    color: "from-sky-500 to-indigo-500",
  },
  {
    id: "attendance",
    icon: <Clock className="h-7 w-7 text-white" />,
    name: { zh: "員工打卡系統", en: "Employee Attendance", ja: "勤怠管理システム" },
    description: {
      zh: "螢幕顯示員工出勤與打卡狀態，支援即時更新",
      en: "Display employee check-in/out status with real-time updates",
      ja: "従業員の出退勤状態をリアルタイムで画面に表示",
    },
    category: { zh: "人事管理", en: "HR", ja: "人事管理" },
    color: "from-amber-500 to-yellow-500",
  },
];

// Convert a DB external app to the AppItem shape used by renderCard
function externalToAppItem(ext: ExternalAppInfo, language: string): AppItem {
  const lang = language as "zh" | "en" | "ja";
  return {
    id:     ext.slug,
    _externalUuid: ext.id,
    icon:   <Puzzle className="h-7 w-7 text-white" />,
    name: {
      zh: ext.nameI18n.zh || ext.nameI18n.en || ext.slug,
      en: ext.nameI18n.en || ext.nameI18n.zh || ext.slug,
      ja: ext.nameI18n.ja || ext.nameI18n.en || ext.slug,
    },
    description: {
      zh: ext.descI18n.zh || ext.descI18n.en || "",
      en: ext.descI18n.en || ext.descI18n.zh || "",
      ja: ext.descI18n.ja || ext.descI18n.en || "",
    },
    category: { zh: "第三方應用", en: "Third-party", ja: "サードパーティ" },
    color:    ext.gradient,
    isExternal: true,
  };
}

const AppStorePage = () => {
  const { language } = useLanguage();
  const { installedApps, externalApps, installApp, uninstallApp } = useInstalledApps();
  const [searchParams] = useSearchParams();
  const [queueDialogOpen, setQueueDialogOpen] = useState(false);
  const [queueNumber, setQueueNumber] = useState("105");
  const { isAdmin, isOrgAdmin } = useUserRole();
  const canManageApps = isAdmin || isOrgAdmin;
  const { tier, limits } = useOrgPlan();

  // Handle deep-link from sidebar
  useEffect(() => {
    const openId = searchParams.get("open");
    if (openId === "queue" && installedApps.has("queue")) {
      setQueueDialogOpen(true);
    }
  }, [searchParams, installedApps]);

  const texts = {
    bannerTitle: { zh: "探索更多商用插件", en: "Discover Business Plugins", ja: "ビジネスプラグインを探す" },
    bannerSub: { zh: "一鍵安裝，無限擴充你的電子看板功能", en: "One-click install to extend your digital signage", ja: "ワンクリックでデジタルサイネージを拡張" },
    tabAll: { zh: "所有應用 (Marketplace)", en: "Marketplace", ja: "マーケットプレイス" },
    tabInstalled: { zh: "我的應用 (Installed)", en: "Installed Apps", ja: "インストール済み" },
    install: { zh: "安裝", en: "Install", ja: "インストール" },
    open: { zh: "開啟", en: "Open", ja: "開く" },
    installed: { zh: "已安裝", en: "Installed", ja: "インストール済" },
    noInstalled: { zh: "尚未安裝任何應用，去商城逛逛吧！", en: "No apps installed yet. Browse the marketplace!", ja: "まだアプリがインストールされていません。" },
    queueTitle: { zh: "排隊叫號設定", en: "Queue Number Settings", ja: "順番呼出し設定" },
    currentNum: { zh: "目前叫號號碼", en: "Current Number", ja: "現在の番号" },
    preview: { zh: "螢幕預覽", en: "Screen Preview", ja: "プレビュー" },
    confirm: { zh: "確認更新", en: "Update", ja: "更新" },
    callTo: { zh: "請", en: "Now serving #", ja: "番号" },
    callToSuffix: { zh: "號至櫃檯取餐", en: "— please proceed to counter", ja: "番のお客様、カウンターへどうぞ" },
    successInstall: { zh: "已成功安裝", en: "Successfully installed", ja: "インストール完了" },
    successUninstall: { zh: "已成功卸載", en: "Successfully uninstalled", ja: "アンインストール完了" },
    successUpdate: { zh: "叫號已更新", en: "Queue number updated", ja: "番号を更新しました" },
    uninstall: { zh: "卸載", en: "Uninstall", ja: "アンインストール" },
    noPermission: { zh: "僅組織管理員可操作", en: "Only org admins can manage apps", ja: "組織管理者のみ操作可能" },
    planLimitApps: { zh: "已安裝的應用商店模組數已達方案上限", en: "Installed app count reached plan limit", ja: "インストール済みアプリ数がプラン上限に達しました" },
  };

  const t = (key: keyof typeof texts) => texts[key][language];

  // Merge builtin APPS with approved external apps from DB
  const allApps = useMemo<AppItem[]>(() => {
    const externalItems = externalApps
      .filter((e) => !APPS.find((a) => a.id === e.slug)) // skip if slug clashes with builtin
      .map((e) => externalToAppItem(e, language));
    return [...APPS, ...externalItems];
  }, [externalApps, language]);

  const handleInstall = (app: AppItem) => {
    if (!canManageApps) {
      toast.error(t("noPermission"));
      return;
    }
    if (app.hasConfig && installedApps.has(app.id)) {
      setQueueDialogOpen(true);
      return;
    }
    // Plan limit: max apps (-1 means unlimited)
    if (limits.maxApps >= 0 && installedApps.size >= limits.maxApps) {
      toast.error(`${t("planLimitApps")} (${installedApps.size}/${limits.maxApps})`);
      return;
    }
    installApp(app.id, app._externalUuid);
    toast.success(`${app.name[language]} ${t("successInstall")}`);
    if (app.hasConfig) {
      setQueueDialogOpen(true);
    }
  };

  const handleUninstall = (app: AppItem) => {
    if (!canManageApps) {
      toast.error(t("noPermission"));
      return;
    }
    uninstallApp(app.id, app._externalUuid);
    toast.success(`${app.name[language]} ${t("successUninstall")}`);
  };

  const handleQueueUpdate = () => {
    setQueueDialogOpen(false);
    toast.success(t("successUpdate"));
  };

  const renderCard = (app: AppItem) => {
    const isInstalled = installedApps.has(app.id);
    return (
      <div
        key={app.id}
        className="group relative bg-card border border-border rounded-2xl p-6 hover:shadow-xl hover:-translate-y-1 transition-all duration-300 flex flex-col"
      >
        <div className="flex items-start gap-4 mb-4">
          <div className={`shrink-0 w-14 h-14 rounded-xl bg-gradient-to-br ${app.color} flex items-center justify-center shadow-lg`}>
            {app.icon}
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="font-semibold text-foreground text-base leading-tight mb-1 truncate">
              {app.name[language]}
            </h3>
            <Badge variant="secondary" className="text-xs font-normal">
              {app.category[language]}
            </Badge>
          </div>
        </div>
        <p className="text-muted-foreground text-sm leading-relaxed mb-5 flex-1">
          {app.description[language]}
        </p>
        <div className="flex gap-2">
          {isInstalled ? (
            <>
              {app.hasConfig && (
                <Button
                  onClick={() => setQueueDialogOpen(true)}
                  variant="outline"
                  className="flex-1"
                >
                  <Monitor className="mr-2 h-4 w-4" />{t("open")}
                </Button>
              )}
              <Button
                onClick={() => handleUninstall(app)}
                variant="outline"
                className="flex-1 text-destructive hover:text-destructive"
                disabled={!canManageApps}
                title={!canManageApps ? t("noPermission") : ""}
              >
                {!canManageApps && <Lock className="mr-2 h-4 w-4" />}
                {t("uninstall")}
              </Button>
            </>
          ) : (
            <Button
              onClick={() => handleInstall(app)}
              disabled={!canManageApps}
              className={`w-full ${canManageApps ? `bg-gradient-to-r ${app.color} border-0 text-white hover:opacity-90` : ""}`}
              title={!canManageApps ? t("noPermission") : ""}
            >
              {!canManageApps ? <Lock className="mr-2 h-4 w-4" /> : <Download className="mr-2 h-4 w-4" />}
              {t("install")}
            </Button>
          )}
        </div>
      </div>
    );
  };

  const installedAppsList = allApps.filter((a) => installedApps.has(a.id));

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Banner */}
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-r from-violet-600 via-purple-600 to-indigo-600 p-8 md:p-12">
        <div className="absolute inset-0 opacity-20">
          <div className="absolute -top-10 -right-10 w-64 h-64 bg-white/20 rounded-full blur-3xl" />
          <div className="absolute -bottom-10 -left-10 w-48 h-48 bg-white/15 rounded-full blur-2xl" />
        </div>
        <div className="relative z-10 max-w-2xl">
          <h1 className="text-3xl md:text-4xl font-bold text-white mb-3 tracking-tight">
            🧩 {t("bannerTitle")}
          </h1>
          <p className="text-white/80 text-lg">{t("bannerSub")}</p>
        </div>
      </div>

      {/* Plan usage */}
      <PlanUsageBar
        icon={Package}
        label={{ zh: "應用商店模組", en: "App modules", ja: "アプリ" }[language]}
        used={installedAppsList.length}
        limit={limits.maxApps}
        planLabel={tier ? PLAN_LABELS[tier][language] : undefined}
        usedSuffix={{ zh: "已使用", en: "used", ja: "使用済み" }[language]}
      />

      {/* Tabs */}
      <Tabs defaultValue="marketplace" className="w-full">
        <TabsList className="mb-6">
          <TabsTrigger value="marketplace" className="min-w-[160px]">{t("tabAll")}</TabsTrigger>
          <TabsTrigger value="installed" className="min-w-[160px]">
            {t("tabInstalled")}
            {installedAppsList.length > 0 && (
              <Badge className="ml-2 bg-primary/20 text-primary text-xs">{installedAppsList.length}</Badge>
            )}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="marketplace">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
            {allApps.map(renderCard)}
          </div>
        </TabsContent>

        <TabsContent value="installed">
          {installedAppsList.length === 0 ? (
            <div className="text-center py-20 text-muted-foreground">
              <Download className="mx-auto h-12 w-12 mb-4 opacity-30" />
              <p className="text-lg">{t("noInstalled")}</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
              {installedAppsList.map(renderCard)}
            </div>
          )}
        </TabsContent>
      </Tabs>

      {/* Queue Config Dialog */}
      <Dialog open={queueDialogOpen} onOpenChange={setQueueDialogOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-blue-500 to-cyan-500 flex items-center justify-center">
                <Users className="h-4 w-4 text-white" />
              </div>
              {t("queueTitle")}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-5 py-2">
            <div className="space-y-2">
              <Label>{t("currentNum")}</Label>
              <Input
                type="number"
                value={queueNumber}
                onChange={(e) => setQueueNumber(e.target.value)}
                className="text-2xl font-bold text-center h-14"
                min={1}
              />
            </div>
            <div className="space-y-2">
              <Label>{t("preview")}</Label>
              <div className="relative rounded-xl overflow-hidden bg-gradient-to-br from-gray-900 to-gray-800 aspect-video flex items-center justify-center">
                <div className="absolute inset-0 bg-[url('/placeholder.svg')] bg-cover opacity-10" />
                {/* Simulated screen with queue overlay */}
                <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-blue-600/95 to-blue-500/90 px-6 py-4 backdrop-blur-sm">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="bg-white/20 rounded-lg p-2">
                        <Users className="h-5 w-5 text-white" />
                      </div>
                      <span className="text-white/90 text-sm font-medium">
                        {t("callTo")}
                      </span>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-white text-4xl font-black tabular-nums tracking-wider animate-pulse">
                        {queueNumber || "—"}
                      </span>
                    </div>
                  </div>
                  <p className="text-white/70 text-xs mt-1 text-right">{t("callToSuffix")}</p>
                </div>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setQueueDialogOpen(false)}>
              {{ zh: "取消", en: "Cancel", ja: "キャンセル" }[language]}
            </Button>
            <Button onClick={handleQueueUpdate} className="bg-gradient-to-r from-blue-500 to-cyan-500 text-white border-0">
              {t("confirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default AppStorePage;
