import { useEffect, useState } from "react";
import { Monitor, Image, CalendarClock, ShieldCheck, Brush, Send, FileText, Store, Megaphone, Users, CloudSun, Instagram, DoorOpen, Languages, Clock, HeadphonesIcon, BookOpen, Radio, BarChart3, AlertTriangle, UserCog, Key, Wrench, Building2, TrendingUp, Code2, LayoutGrid, History, Type, Puzzle, ClipboardCheck, Pin, PinOff, ChevronDown, ChevronRight } from "lucide-react";
import logoImg from "@/assets/logo.png";
import logoLightImg from "@/assets/logo-light.png";
import { useTheme } from "next-themes";
import { NavLink } from "@/components/NavLink";
import { Link, useLocation } from "react-router-dom";
import { useUserRole } from "@/hooks/useUserRole";
import { useIsSystemAdmin } from "@/hooks/useIsSystemAdmin";
import { useAuth } from "@/contexts/AuthContext";
import { useLanguage, Language } from "@/contexts/LanguageContext";
import { useInstalledApps, APP_DEFINITIONS } from "@/contexts/InstalledAppsContext";
import { useOrgPlan } from "@/hooks/useOrgPlan";
import type { TranslationKey } from "@/contexts/translations";
import { Separator } from "@/components/ui/separator";
import { useUnreadCustomerMessages } from "@/hooks/useUnreadCustomerMessages";
import { findActiveNavUrl } from "@/lib/navMatch";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";

const INSTALLED_ICONS: Record<string, React.ElementType> = {
  announcement: Megaphone,
  queue: Users,
  weather: CloudSun,
  social: Instagram,
  "meeting-room": DoorOpen,
  multilingual: Languages,
  attendance: Clock,
};

const SIDEBAR_AUTO_HIDE_KEY = "sidebar:autoHide";

type NavItem = { titleKey: TranslationKey; url: string; icon: React.ElementType };

const workItems: NavItem[] = [
  { titleKey: "navStudio", url: "/studio", icon: Brush },
  { titleKey: "navMedia", url: "/media", icon: Image },
  { titleKey: "navSchedules", url: "/schedules", icon: CalendarClock },
  { titleKey: "navPublishing", url: "/publishing", icon: Send },
];

const deviceItems: NavItem[] = [
  { titleKey: "navScreens", url: "/screens", icon: Monitor },
  { titleKey: "navDeviceLogs", url: "/device-logs", icon: FileText },
  { titleKey: "navIoTDashboard", url: "/iot-dashboard", icon: Radio },
];

export function AppSidebar() {
  const { state, setOpen, isMobile, setOpenMobile } = useSidebar();
  const collapsed = state === "collapsed";
  const location = useLocation();

  // ── Auto-hide (hover-to-reveal) ──────────────────────────────────────────
  const [autoHide, setAutoHide] = useState<boolean>(() => {
    try {
      const stored = localStorage.getItem(SIDEBAR_AUTO_HIDE_KEY);
      return stored === null ? true : stored === "true";
    }
    catch { return true; }
  });

  useEffect(() => {
    if (autoHide && !isMobile) setOpen(false);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoHide, isMobile]);

  const handleMouseEnter = () => { if (autoHide && !isMobile) setOpen(true); };
  const handleMouseLeave = () => { if (autoHide && !isMobile) setOpen(false); };
  const toggleAutoHide = () => {
    const next = !autoHide;
    setAutoHide(next);
    try { localStorage.setItem(SIDEBAR_AUTO_HIDE_KEY, String(next)); } catch { /* ignore */ }
    if (!isMobile) setOpen(!next);
  };

  // ── Collapsible sections ─────────────────────────────────────────────────
  const [csOpen, setCsOpen] = useState(false);
  const [sysOpen, setSysOpen] = useState(false);

  const { isAdmin, isOrgAdmin, isCsAgent, isAgent } = useUserRole();
  const { tier } = useOrgPlan();
  const { t, language } = useLanguage();
  const { user } = useAuth();
  const { installedApps } = useInstalledApps();
  const { resolvedTheme } = useTheme();
  const unreadCS = useUnreadCustomerMessages();
  const currentLogo = resolvedTheme === "dark" ? logoLightImg : logoImg;

  // Auto-open CS section when user is a CS agent
  useEffect(() => { if (isCsAgent) setCsOpen(true); }, [isCsAgent]);

  // Auto-close sidebar on mobile when route changes
  useEffect(() => {
    if (isMobile) setOpenMobile(false);
  }, [location.pathname, isMobile, setOpenMobile]);

  const { isSystemAdmin } = useIsSystemAdmin();
  const canAccessCS = isSystemAdmin || isCsAgent;
  const canAccessAdmin = isAdmin || isOrgAdmin;
  // Per SIGNCMS組織權限規則: regular users cannot access 擴充應用商店 or 開發者入口.
  // Org admins, CS agents, system admins, and agents (view-only) can see app store.
  // Only system admin / CS agent / admin can see the developer portal.
  const canAccessAppStore = isAdmin || isOrgAdmin || isCsAgent || isSystemAdmin || isAgent;
  const canAccessDevPortal = isAdmin || isCsAgent || isSystemAdmin;

  // ── Section labels ───────────────────────────────────────────────────────
  const workspaceLabel: Record<Language, string> = { zh: "工作區", en: "Workspace", ja: "ワークスペース" };
  const devicesLabel: Record<Language, string> = { zh: "裝置", en: "Devices", ja: "デバイス" };
  const orgAdminLabel: Record<Language, string> = { zh: "組織管理", en: "Organization", ja: "組織管理" };
  const sectionLabel: Record<Language, string> = { zh: "擴充應用", en: "Extensions", ja: "拡張アプリ" };
  const sysSettingsLabel: Record<Language, string> = { zh: "設定", en: "Settings", ja: "設定" };
  const sysAnalyticsLabel: Record<Language, string> = { zh: "分析", en: "Analytics", ja: "分析" };
  const sysMaintenanceLabel: Record<Language, string> = { zh: "平台維護", en: "Maintenance", ja: "メンテナンス" };

  // ── Active URL resolution (main sections only) ───────────────────────────
  const mainNavUrls = [
    ...workItems.map(i => i.url),
    ...deviceItems.map(i => i.url),
    ...(canAccessAdmin ? ["/admin"] : []),
  ];
  const activeUrl = findActiveNavUrl(mainNavUrls, location.pathname);

  const renderNavItem = (item: NavItem) => {
    const active = item.url === activeUrl;
    return (
      <SidebarMenuItem key={item.url}>
        <SidebarMenuButton asChild isActive={active}>
          <NavLink
            to={item.url}
            end
            className="hover:bg-sidebar-accent/60 rounded-lg transition-all duration-200"
            activeClassName="bg-sidebar-accent text-sidebar-accent-foreground font-medium"
          >
            <item.icon className="mr-3 h-[18px] w-[18px]" />
            {!collapsed && <span>{t(item.titleKey)}</span>}
          </NavLink>
        </SidebarMenuButton>
      </SidebarMenuItem>
    );
  };

  const installedAppDefs = APP_DEFINITIONS.filter((a) => installedApps.has(a.id));

  // Shared NavLink class
  const navCls = "hover:bg-sidebar-accent/60 rounded-lg transition-all duration-200";
  const navActiveCls = "bg-sidebar-accent text-sidebar-accent-foreground font-medium";

  return (
    <Sidebar
      collapsible="icon"
      className="border-r border-sidebar-border"
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      <div className="p-3 sm:p-4 flex items-center gap-2">
        <Link to="/" aria-label="SignCMS" className="flex items-center gap-2 rounded-md hover:opacity-80 transition-opacity">
          <img src={currentLogo} alt="SignCMS" className="h-10 sm:h-12 shrink-0 object-contain" style={collapsed ? { width: 30 } : {}} />
          {!collapsed && tier && (
            <span className={`text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded ${tier === "evaluation" ? "text-orange-500 bg-orange-500/10" : "text-muted-foreground bg-muted"}`}>
              {t(`planTier${tier.charAt(0).toUpperCase() + tier.slice(1)}` as TranslationKey)}
            </span>
          )}
        </Link>
      </div>

      <SidebarContent>
        {/* ── 工作區 ────────────────────────────────────────────────────── */}
        <SidebarGroup>
          <SidebarGroupLabel className="text-xs text-muted-foreground uppercase tracking-wider px-3">
            {!collapsed && workspaceLabel[language]}
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {workItems.map(renderNavItem)}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <Separator className="mx-3 my-1" />

        {/* ── 裝置 ─────────────────────────────────────────────────────── */}
        <SidebarGroup>
          <SidebarGroupLabel className="text-xs text-muted-foreground uppercase tracking-wider px-3">
            {!collapsed && devicesLabel[language]}
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {deviceItems.map(renderNavItem)}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        {/* ── 組織管理 ─────────────────────────────────────────────────── */}
        {canAccessAdmin && (
          <SidebarGroup>
            <SidebarGroupLabel className="text-xs text-muted-foreground uppercase tracking-wider px-3">
              {!collapsed && orgAdminLabel[language]}
            </SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {renderNavItem({ titleKey: "navAdmin", url: "/admin", icon: ShieldCheck })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}

        <Separator className="mx-3 my-1" />

        {/* ── Extensions ───────────────────────────────────────────────── */}
        <SidebarGroup>
          <SidebarGroupLabel className="text-xs text-muted-foreground uppercase tracking-wider px-3">
            {!collapsed && sectionLabel[language]}
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {/* App Store — hidden from regular users per SIGNCMS組織權限規則 */}
              {canAccessAppStore && (
                <SidebarMenuItem>
                  <SidebarMenuButton asChild>
                    <NavLink to="/app-store" className={navCls} activeClassName={navActiveCls}>
                      <Store className="mr-3 h-[18px] w-[18px]" />
                      {!collapsed && <span>{t("navAppStore")}</span>}
                    </NavLink>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              )}
              {/* Installed apps */}
              {installedAppDefs.map((app) => {
                const Icon = INSTALLED_ICONS[app.id] || Store;
                return (
                  <SidebarMenuItem key={app.id}>
                    <SidebarMenuButton asChild>
                      <NavLink
                        to={app.id === "announcement" ? "/announcement" : app.id === "queue" ? "/queue" : app.id === "meeting-room" ? "/meeting-room" : `/app-store?open=${app.id}`}
                        className={navCls}
                        activeClassName={navActiveCls}
                      >
                        <div className={`mr-3 h-[18px] w-[18px] rounded bg-gradient-to-br ${app.color} flex items-center justify-center`}>
                          <Icon className="h-3 w-3 text-white" />
                        </div>
                        {!collapsed && <span className="text-sm">{app.name[language]}</span>}
                      </NavLink>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
              {/* Developer Portal — hidden from regular users and org_admins per SIGNCMS組織權限規則 */}
              {canAccessDevPortal && (
                <SidebarMenuItem>
                  <SidebarMenuButton asChild>
                    <NavLink to="/developer-portal" className={navCls} activeClassName={navActiveCls}>
                      <Puzzle className="mr-3 h-[18px] w-[18px]" />
                      {!collapsed && <span>{t("navDeveloperPortal")}</span>}
                    </NavLink>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              )}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        {/* ── Customer Service (collapsible) ───────────────────────────── */}
        {canAccessCS && (
          <>
            <Separator className="mx-3 my-1" />
            <SidebarGroup>
              {!collapsed && (
                <button
                  type="button"
                  onClick={() => setCsOpen(v => !v)}
                  className="flex w-full items-center justify-between px-3 py-1 text-[11px] text-muted-foreground/70 uppercase tracking-widest hover:text-muted-foreground transition-colors"
                >
                  <span className="flex items-center gap-2">
                    {t("navCustomerService")}
                    {unreadCS > 0 && (
                      <span className="h-4 min-w-4 px-0.5 rounded-full bg-destructive text-destructive-foreground text-[9px] font-bold flex items-center justify-center">
                        {unreadCS > 99 ? "99+" : unreadCS}
                      </span>
                    )}
                  </span>
                  {csOpen ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                </button>
              )}
              {(csOpen || collapsed) && (
                <SidebarGroupContent>
                  <SidebarMenu>
                    <SidebarMenuItem>
                      <SidebarMenuButton asChild>
                        <NavLink to="/customer-service" className={navCls} activeClassName={navActiveCls}>
                          <div className="relative mr-3">
                            <HeadphonesIcon className="h-[18px] w-[18px]" />
                            {unreadCS > 0 && (
                              <span className="absolute -top-1.5 -right-1.5 h-4 min-w-4 px-0.5 rounded-full bg-destructive text-destructive-foreground text-[9px] font-bold flex items-center justify-center">
                                {unreadCS > 99 ? "99+" : unreadCS}
                              </span>
                            )}
                          </div>
                          {!collapsed && (
                            <span className="flex items-center gap-2">
                              {t("navSupportCenter")}
                              {unreadCS > 0 && (
                                <span className="h-5 min-w-5 px-1 rounded-full bg-destructive text-destructive-foreground text-[10px] font-bold flex items-center justify-center">
                                  {unreadCS > 99 ? "99+" : unreadCS}
                                </span>
                              )}
                            </span>
                          )}
                        </NavLink>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                    <SidebarMenuItem>
                      <SidebarMenuButton asChild>
                        <NavLink to="/cs-dashboard" className={navCls} activeClassName={navActiveCls}>
                          <BarChart3 className="mr-3 h-[18px] w-[18px]" />
                          {!collapsed && <span>{t("navCSDashboard")}</span>}
                        </NavLink>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                    <SidebarMenuItem>
                      <SidebarMenuButton asChild>
                        <NavLink to="/cs-tickets" className={navCls} activeClassName={navActiveCls}>
                          <AlertTriangle className="mr-3 h-[18px] w-[18px]" />
                          {!collapsed && <span>{t("navCSTickets")}</span>}
                        </NavLink>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                    <SidebarMenuItem>
                      <SidebarMenuButton asChild>
                        <NavLink to="/knowledge-base" className={navCls} activeClassName={navActiveCls}>
                          <BookOpen className="mr-3 h-[18px] w-[18px]" />
                          {!collapsed && <span>{t("navKnowledgeBase")}</span>}
                        </NavLink>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                    <SidebarMenuItem>
                      <SidebarMenuButton asChild>
                        <NavLink to="/cs-agents" className={navCls} activeClassName={navActiveCls}>
                          <UserCog className="mr-3 h-[18px] w-[18px]" />
                          {!collapsed && <span>{t("navCSAgents")}</span>}
                        </NavLink>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  </SidebarMenu>
                </SidebarGroupContent>
              )}
            </SidebarGroup>
          </>
        )}

        {/* ── System Admin (collapsible, with sub-groups) ──────────────── */}
        {isSystemAdmin && (
          <>
            <Separator className="mx-3 my-1" />
            <SidebarGroup>
              {!collapsed && (
                <button
                  type="button"
                  onClick={() => setSysOpen(v => !v)}
                  className="flex w-full items-center justify-between px-3 py-1 text-[11px] text-muted-foreground/70 uppercase tracking-widest hover:text-muted-foreground transition-colors"
                >
                  <span>{t("navSysAdmin")}</span>
                  {sysOpen ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                </button>
              )}
              {(sysOpen || collapsed) && (
                <SidebarGroupContent>
                  <SidebarMenu>
                    {/* Sub-group: 設定 */}
                    {!collapsed && (
                      <div className="px-3 pt-2 pb-0.5 text-[10px] font-medium text-muted-foreground/50 uppercase tracking-wider">
                        {sysSettingsLabel[language]}
                      </div>
                    )}
                    <SidebarMenuItem>
                      <SidebarMenuButton asChild>
                        <NavLink to="/system-admin" end className={navCls} activeClassName={navActiveCls}>
                          <LayoutGrid className="mr-3 h-[18px] w-[18px]" />
                          {!collapsed && <span>{t("navSysAdminOverview")}</span>}
                        </NavLink>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                    <SidebarMenuItem>
                      <SidebarMenuButton asChild>
                        <NavLink to="/system-settings" className={navCls} activeClassName={navActiveCls}>
                          <Wrench className="mr-3 h-[18px] w-[18px]" />
                          {!collapsed && <span>{t("navSysSettings")}</span>}
                        </NavLink>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                    <SidebarMenuItem>
                      <SidebarMenuButton asChild>
                        <NavLink to="/org-management" className={navCls} activeClassName={navActiveCls}>
                          <Building2 className="mr-3 h-[18px] w-[18px]" />
                          {!collapsed && <span>{t("navOrgMgmt")}</span>}
                        </NavLink>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                    <SidebarMenuItem>
                      <SidebarMenuButton asChild>
                        <NavLink to="/cs-licenses" className={navCls} activeClassName={navActiveCls}>
                          <Key className="mr-3 h-[18px] w-[18px]" />
                          {!collapsed && <span>{t("navCSLicenses")}</span>}
                        </NavLink>
                      </SidebarMenuButton>
                    </SidebarMenuItem>

                    {/* Sub-group: 分析 */}
                    {!collapsed && (
                      <div className="px-3 pt-2 pb-0.5 text-[10px] font-medium text-muted-foreground/50 uppercase tracking-wider">
                        {sysAnalyticsLabel[language]}
                      </div>
                    )}
                    <SidebarMenuItem>
                      <SidebarMenuButton asChild>
                        <NavLink to="/usage-leaderboard" className={navCls} activeClassName={navActiveCls}>
                          <TrendingUp className="mr-3 h-[18px] w-[18px]" />
                          {!collapsed && <span>{t("tabUsageLeaderboard")}</span>}
                        </NavLink>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                    <SidebarMenuItem>
                      <SidebarMenuButton asChild>
                        <NavLink to="/media-audit" className={navCls} activeClassName={navActiveCls}>
                          <History className="mr-3 h-[18px] w-[18px]" />
                          {!collapsed && <span>{t("navMediaAudit")}</span>}
                        </NavLink>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                    <SidebarMenuItem>
                      <SidebarMenuButton asChild>
                        <NavLink to="/terminology-audit" className={navCls} activeClassName={navActiveCls}>
                          <Type className="mr-3 h-[18px] w-[18px]" />
                          {!collapsed && <span>{t("navTermAudit")}</span>}
                        </NavLink>
                      </SidebarMenuButton>
                    </SidebarMenuItem>

                    {/* Sub-group: 平台維護 */}
                    {!collapsed && (
                      <div className="px-3 pt-2 pb-0.5 text-[10px] font-medium text-muted-foreground/50 uppercase tracking-wider">
                        {sysMaintenanceLabel[language]}
                      </div>
                    )}
                    <SidebarMenuItem>
                      <SidebarMenuButton asChild>
                        <NavLink to="/widget-mgmt" className={navCls} activeClassName={navActiveCls}>
                          <Code2 className="mr-3 h-[18px] w-[18px]" />
                          {!collapsed && <span>{t("tabWidgetMgmt")}</span>}
                        </NavLink>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                    <SidebarMenuItem>
                      <SidebarMenuButton asChild>
                        <NavLink to="/app-review" className={navCls} activeClassName={navActiveCls}>
                          <ClipboardCheck className="mr-3 h-[18px] w-[18px]" />
                          {!collapsed && <span>{t("navAppReview")}</span>}
                        </NavLink>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  </SidebarMenu>
                </SidebarGroupContent>
              )}
            </SidebarGroup>
          </>
        )}
      </SidebarContent>

      {/* Auto-hide toggle — always visible at the bottom */}
      {!isMobile && (
        <div className="shrink-0 border-t border-sidebar-border p-2 flex items-center gap-2">
          <button
            type="button"
            onClick={toggleAutoHide}
            title={autoHide ? t("sidebarAutoHideOn") : t("sidebarAutoHideOff")}
            className="w-7 h-7 flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-sidebar-accent/70 transition-colors shrink-0"
          >
            {autoHide
              ? <PinOff className="w-[15px] h-[15px]" />
              : <Pin className="w-[15px] h-[15px]" />
            }
          </button>
          {!collapsed && (
            <span className="text-[11px] text-muted-foreground leading-tight select-none">
              {autoHide ? t("sidebarHoverLabel") : t("sidebarPinLabel")}
            </span>
          )}
        </div>
      )}
    </Sidebar>
  );
}
