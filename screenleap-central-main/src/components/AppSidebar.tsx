import { useEffect } from "react";
import { Monitor, Image, CalendarClock, ShieldCheck, Brush, Send, FileText, Store, Megaphone, Users, CloudSun, Instagram, DoorOpen, Languages, Clock, HeadphonesIcon, BookOpen, Radio, BarChart3, AlertTriangle, UserCog, Key, Settings, Wrench, Building2, TrendingUp, Code2, LayoutGrid, MonitorPlay, Rocket, History, Type, Puzzle, ClipboardCheck } from "lucide-react";
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

export function AppSidebar() {
  const { state, isMobile, setOpenMobile } = useSidebar();
  const collapsed = state === "collapsed";
  const location = useLocation();
  const { isAdmin, isOrgAdmin, isCsAgent } = useUserRole();
  const { t, language } = useLanguage();
  const { user } = useAuth();
  const { installedApps } = useInstalledApps();
  const { resolvedTheme } = useTheme();
  const unreadCS = useUnreadCustomerMessages();
  const currentLogo = resolvedTheme === "dark" ? logoLightImg : logoImg;

  // Auto-close sidebar on mobile when route changes
  useEffect(() => {
    if (isMobile) {
      setOpenMobile(false);
    }
  }, [location.pathname, isMobile, setOpenMobile]);

  const { isSystemAdmin } = useIsSystemAdmin();
  const canAccessCS = isSystemAdmin || isCsAgent;
  const canAccessAdmin = isAdmin || isOrgAdmin;

  const navItems = [
    { titleKey: "navQuickPublish" as const, url: "/quick-publish", icon: Rocket, adminOnly: false },
    { titleKey: "navStudio" as const, url: "/studio", icon: Brush, adminOnly: false },
    { titleKey: "navSchedules" as const, url: "/schedules", icon: CalendarClock, adminOnly: false },
    { titleKey: "navPublishing" as const, url: "/publishing", icon: Send, adminOnly: false },
    { titleKey: "navMedia" as const, url: "/media", icon: Image, adminOnly: false },
    { titleKey: "navScreens" as const, url: "/screens", icon: Monitor, adminOnly: false },
    { titleKey: "navDeviceLogs" as const, url: "/device-logs", icon: FileText, adminOnly: false },
    { titleKey: "navIoTDashboard" as const, url: "/iot-dashboard", icon: Radio, adminOnly: false },
    { titleKey: "navAdmin" as const, url: "/admin", icon: ShieldCheck, adminOnly: false },
  ];

  const filteredItems = navItems.filter((item) => {
    if (item.titleKey === "navAdmin") return canAccessAdmin;
    return true;
  });

  const installedAppDefs = APP_DEFINITIONS.filter((a) => installedApps.has(a.id));

  const sectionLabel: Record<Language, string> = { zh: "擴充應用", en: "Extensions", ja: "拡張アプリ" };
  const localPlayerLabel: Record<Language, string> = { zh: "本機播放器", en: "Local Player", ja: "ローカルプレーヤー" };

  return (
    <Sidebar collapsible="icon" className="border-r border-sidebar-border">
      <div className="p-3 sm:p-4 flex items-center gap-2">
        <Link to="/" aria-label="SignCMS" className="flex items-center gap-2 rounded-md hover:opacity-80 transition-opacity">
          <img src={currentLogo} alt="SignCMS" className="h-10 sm:h-12 shrink-0 object-contain" style={collapsed ? { width: 30 } : {}} />
          {!collapsed && (
            <span className="text-[10px] font-semibold uppercase tracking-wider text-orange-500 bg-orange-500/10 px-1.5 py-0.5 rounded">Trial</span>
          )}
        </Link>
      </div>
      <SidebarContent>
        {/* Main navigation */}
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              {(() => {
                // Resolve active nav via shared helper (handles ?query, #hash
                // and falls back to the closest parent route).
                const activeUrl = findActiveNavUrl(
                  filteredItems.map((it) => it.url),
                  location.pathname,
                );

                return filteredItems.map((item) => {
                  const active = item.url === activeUrl;
                  return (
                  <SidebarMenuItem key={item.titleKey}>
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
                });
              })()}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <Separator className="mx-3 my-1" />

        {/* Extensions section */}
        <SidebarGroup>
          <SidebarGroupLabel className="text-xs text-muted-foreground uppercase tracking-wider px-3">
            {!collapsed && sectionLabel[language]}
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton asChild>
                  <NavLink
                    to="/app-store"
                    className="hover:bg-sidebar-accent/60 rounded-lg transition-all duration-200"
                    activeClassName="bg-sidebar-accent text-sidebar-accent-foreground font-medium"
                  >
                    <Store className="mr-3 h-[18px] w-[18px]" />
                    {!collapsed && <span>{t("navAppStore")}</span>}
                  </NavLink>
                </SidebarMenuButton>
              </SidebarMenuItem>
              {installedAppDefs.map((app) => {
                const Icon = INSTALLED_ICONS[app.id] || Store;
                return (
                  <SidebarMenuItem key={app.id}>
                    <SidebarMenuButton asChild>
                      <NavLink
                        to={app.id === "announcement" ? "/announcement" : app.id === "queue" ? "/queue" : app.id === "meeting-room" ? "/meeting-room" : `/app-store?open=${app.id}`}
                        className="hover:bg-sidebar-accent/60 rounded-lg transition-all duration-200"
                        activeClassName="bg-sidebar-accent text-sidebar-accent-foreground font-medium"
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
              {/* Developer Portal link */}
              <SidebarMenuItem>
                <SidebarMenuButton asChild>
                  <NavLink
                    to="/developer-portal"
                    className="hover:bg-sidebar-accent/60 rounded-lg transition-all duration-200"
                    activeClassName="bg-sidebar-accent text-sidebar-accent-foreground font-medium"
                  >
                    <Puzzle className="mr-3 h-[18px] w-[18px]" />
                    {!collapsed && <span>{t("navDeveloperPortal")}</span>}
                  </NavLink>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <Separator className="mx-3 my-1" />

        {/* Customer Service section - admin only */}
        {canAccessCS && <SidebarGroup>
          <SidebarGroupLabel className="text-xs text-muted-foreground uppercase tracking-wider px-3">
            {!collapsed && t("navCustomerService")}
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton asChild>
                  <NavLink
                    to="/customer-service"
                    className="hover:bg-sidebar-accent/60 rounded-lg transition-all duration-200"
                    activeClassName="bg-sidebar-accent text-sidebar-accent-foreground font-medium"
                  >
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
                  <NavLink
                    to="/cs-dashboard"
                    className="hover:bg-sidebar-accent/60 rounded-lg transition-all duration-200"
                    activeClassName="bg-sidebar-accent text-sidebar-accent-foreground font-medium"
                  >
                    <BarChart3 className="mr-3 h-[18px] w-[18px]" />
                    {!collapsed && <span>{t("navCSDashboard")}</span>}
                  </NavLink>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton asChild>
                  <NavLink
                    to="/cs-tickets"
                    className="hover:bg-sidebar-accent/60 rounded-lg transition-all duration-200"
                    activeClassName="bg-sidebar-accent text-sidebar-accent-foreground font-medium"
                  >
                    <AlertTriangle className="mr-3 h-[18px] w-[18px]" />
                    {!collapsed && <span>{t("navCSTickets")}</span>}
                  </NavLink>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton asChild>
                  <NavLink
                    to="/knowledge-base"
                    className="hover:bg-sidebar-accent/60 rounded-lg transition-all duration-200"
                    activeClassName="bg-sidebar-accent text-sidebar-accent-foreground font-medium"
                  >
                    <BookOpen className="mr-3 h-[18px] w-[18px]" />
                    {!collapsed && <span>{t("navKnowledgeBase")}</span>}
                  </NavLink>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton asChild>
                  <NavLink
                    to="/cs-agents"
                    className="hover:bg-sidebar-accent/60 rounded-lg transition-all duration-200"
                    activeClassName="bg-sidebar-accent text-sidebar-accent-foreground font-medium"
                  >
                    <UserCog className="mr-3 h-[18px] w-[18px]" />
                    {!collapsed && <span>{t("navCSAgents")}</span>}
                  </NavLink>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton asChild>
                  <NavLink
                    to="/local-player"
                    className="hover:bg-sidebar-accent/60 rounded-lg transition-all duration-200"
                    activeClassName="bg-sidebar-accent text-sidebar-accent-foreground font-medium"
                  >
                    <MonitorPlay className="mr-3 h-[18px] w-[18px]" />
                    {!collapsed && <span>{localPlayerLabel[language]}</span>}
                  </NavLink>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>}

        {/* System Admin section - hardcoded system admin only */}
        {isSystemAdmin && (
          <>
            <Separator className="mx-3 my-1" />
            <SidebarGroup>
              <SidebarGroupLabel className="text-xs text-muted-foreground uppercase tracking-wider px-3">
                {!collapsed && t("navSysAdmin")}
              </SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu>
                  <SidebarMenuItem>
                    <SidebarMenuButton asChild>
                      <NavLink
                        to="/system-admin"
                        end
                        className="hover:bg-sidebar-accent/60 rounded-lg transition-all duration-200"
                        activeClassName="bg-sidebar-accent text-sidebar-accent-foreground font-medium"
                      >
                        <LayoutGrid className="mr-3 h-[18px] w-[18px]" />
                        {!collapsed && <span>{t("navSysAdminOverview")}</span>}
                      </NavLink>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                  <SidebarMenuItem>
                    <SidebarMenuButton asChild>
                      <NavLink
                        to="/system-settings"
                        className="hover:bg-sidebar-accent/60 rounded-lg transition-all duration-200"
                        activeClassName="bg-sidebar-accent text-sidebar-accent-foreground font-medium"
                      >
                        <Wrench className="mr-3 h-[18px] w-[18px]" />
                        {!collapsed && <span>{t("navSysSettings")}</span>}
                      </NavLink>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                  <SidebarMenuItem>
                    <SidebarMenuButton asChild>
                      <NavLink
                        to="/org-management"
                        className="hover:bg-sidebar-accent/60 rounded-lg transition-all duration-200"
                        activeClassName="bg-sidebar-accent text-sidebar-accent-foreground font-medium"
                      >
                        <Building2 className="mr-3 h-[18px] w-[18px]" />
                        {!collapsed && <span>{t("navOrgMgmt")}</span>}
                      </NavLink>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                  <SidebarMenuItem>
                    <SidebarMenuButton asChild>
                      <NavLink
                        to="/cs-licenses"
                        className="hover:bg-sidebar-accent/60 rounded-lg transition-all duration-200"
                        activeClassName="bg-sidebar-accent text-sidebar-accent-foreground font-medium"
                      >
                        <Key className="mr-3 h-[18px] w-[18px]" />
                        {!collapsed && <span>{t("navCSLicenses")}</span>}
                      </NavLink>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                  <SidebarMenuItem>
                    <SidebarMenuButton asChild>
                      <NavLink
                        to="/usage-leaderboard"
                        className="hover:bg-sidebar-accent/60 rounded-lg transition-all duration-200"
                        activeClassName="bg-sidebar-accent text-sidebar-accent-foreground font-medium"
                      >
                        <TrendingUp className="mr-3 h-[18px] w-[18px]" />
                        {!collapsed && <span>{t("tabUsageLeaderboard")}</span>}
                      </NavLink>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                  <SidebarMenuItem>
                    <SidebarMenuButton asChild>
                      <NavLink
                        to="/widget-mgmt"
                        className="hover:bg-sidebar-accent/60 rounded-lg transition-all duration-200"
                        activeClassName="bg-sidebar-accent text-sidebar-accent-foreground font-medium"
                      >
                        <Code2 className="mr-3 h-[18px] w-[18px]" />
                        {!collapsed && <span>{t("tabWidgetMgmt")}</span>}
                      </NavLink>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                  <SidebarMenuItem>
                    <SidebarMenuButton asChild>
                      <NavLink
                        to="/app-review"
                        className="hover:bg-sidebar-accent/60 rounded-lg transition-all duration-200"
                        activeClassName="bg-sidebar-accent text-sidebar-accent-foreground font-medium"
                      >
                        <ClipboardCheck className="mr-3 h-[18px] w-[18px]" />
                        {!collapsed && <span>{t("navAppReview")}</span>}
                      </NavLink>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                  <SidebarMenuItem>
                    <SidebarMenuButton asChild>
                      <NavLink
                        to="/media-audit"
                        className="hover:bg-sidebar-accent/60 rounded-lg transition-all duration-200"
                        activeClassName="bg-sidebar-accent text-sidebar-accent-foreground font-medium"
                      >
                        <History className="mr-3 h-[18px] w-[18px]" />
                        {!collapsed && <span>{t("navMediaAudit")}</span>}
                      </NavLink>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                  <SidebarMenuItem>
                    <SidebarMenuButton asChild>
                      <NavLink
                        to="/terminology-audit"
                        className="hover:bg-sidebar-accent/60 rounded-lg transition-all duration-200"
                        activeClassName="bg-sidebar-accent text-sidebar-accent-foreground font-medium"
                      >
                        <Type className="mr-3 h-[18px] w-[18px]" />
                        {!collapsed && <span>{t("navTermAudit")}</span>}
                      </NavLink>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          </>
        )}
      </SidebarContent>
    </Sidebar>
  );
}
