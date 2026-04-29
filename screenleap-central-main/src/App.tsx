import { lazy, Suspense } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes, useLocation } from "react-router-dom";
import { ThemeProvider } from "next-themes";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider } from "@/contexts/AuthContext";
import { LanguageProvider } from "@/contexts/LanguageProvider";
import { InstalledAppsProvider } from "@/contexts/InstalledAppsContext";
import { ActiveOrgProvider } from "@/contexts/ActiveOrgContext";
import { ProfilesProvider } from "@/contexts/ProfilesContext";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { AdminRoute } from "@/components/AdminRoute";
import { CSRoute } from "@/components/CSRoute";
import { SystemAdminRoute } from "@/components/SystemAdminRoute";
import { getInitialTheme } from "@/hooks/usePreferences";
import { ThemeSync } from "@/components/ThemeSync";
import Index from "./pages/Index.tsx";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { RouteSkeleton } from "./components/PageSkeleton";

// Lazy-loaded page chunks
const Admin = lazy(() => import("./pages/Admin.tsx"));
const Screens = lazy(() => import("./pages/Screens.tsx"));
const Media = lazy(() => import("./pages/Media.tsx"));
const Schedules = lazy(() => import("./pages/Schedules.tsx"));
const Publishing = lazy(() => import("./pages/Publishing.tsx"));
const DeviceLogs = lazy(() => import("./pages/DeviceLogs.tsx"));
const ContentStudio = lazy(() => import("./pages/ContentStudio.tsx"));
const AppStore = lazy(() => import("./pages/AppStore.tsx"));
const Announcement = lazy(() => import("./pages/Announcement.tsx"));
const Queue = lazy(() => import("./pages/Queue.tsx"));
const MeetingRoom = lazy(() => import("./pages/MeetingRoom.tsx"));
const CustomerServicePage = lazy(() => import("./pages/CustomerServicePage.tsx"));
const CSDashboardPage = lazy(() => import("./pages/CSDashboardPage.tsx"));
const CSTicketsPage = lazy(() => import("./pages/CSTicketsPage.tsx"));
const CSAgentsPage = lazy(() => import("./pages/CSAgentsPage.tsx"));
const CSLicensesPage = lazy(() => import("./pages/CSLicensesPage.tsx"));
const SystemSettingsPage = lazy(() => import("./pages/SystemSettingsPage.tsx"));
const SystemAdminPage = lazy(() => import("./pages/SystemAdminPage.tsx"));
const OrgManagementPage = lazy(() => import("./pages/OrgManagementPage.tsx"));
const UsageLeaderboardPage = lazy(() => import("./pages/UsageLeaderboardPage.tsx"));
const WidgetMgmtPage = lazy(() => import("./pages/WidgetMgmtPage.tsx"));
const SecurityAuditPage = lazy(() => import("./pages/SecurityAuditPage.tsx"));
const SecurityAuditHistoryPage = lazy(() => import("./pages/SecurityAuditHistoryPage.tsx"));
const MediaAuditPage = lazy(() => import("./pages/MediaAuditPage.tsx"));
const TerminologyAuditPage = lazy(() => import("./pages/TerminologyAuditPage.tsx"));
const KnowledgeBasePage = lazy(() => import("./pages/KnowledgeBasePage.tsx"));
const IoTDashboard = lazy(() => import("./pages/IoTDashboard.tsx"));
const PlayerPage = lazy(() => import("./pages/PlayerPage.tsx"));
const UnsubscribePage = lazy(() => import("./pages/UnsubscribePage.tsx"));
const LocalPlayerPage = lazy(() => import("./pages/LocalPlayerPage.tsx"));
const SmartTriggerTestPage = lazy(() => import("./pages/SmartTriggerTestPage.tsx"));
const QuickPublish = lazy(() => import("./pages/QuickPublish.tsx"));
const AuthPage = lazy(() => import("./pages/AuthPage.tsx"));
const ForgotPasswordPage = lazy(() => import("./pages/ForgotPasswordPage.tsx"));
const ResetPasswordPage = lazy(() => import("./pages/ResetPasswordPage.tsx"));
const OnboardingPage = lazy(() => import("./pages/OnboardingPage.tsx"));
const NotFound = lazy(() => import("./pages/NotFound.tsx"));
const ChatWidget = lazy(() => import("./components/ChatWidget.tsx"));

const PageLoader = () => <RouteSkeleton />;

const CHAT_WIDGET_HIDDEN_ROUTES = new Set(["/auth", "/forgot-password", "/reset-password"]);

const AppRoutes = () => {
  const location = useLocation();
  const showChatWidget = !CHAT_WIDGET_HIDDEN_ROUTES.has(location.pathname);

  return (
    <ErrorBoundary>
      <Suspense fallback={<PageLoader />}>
        <Routes>
          <Route path="/auth" element={<AuthPage />} />
          <Route path="/unsubscribe" element={<UnsubscribePage />} />
          <Route path="/forgot-password" element={<ForgotPasswordPage />} />
          <Route path="/reset-password" element={<ResetPasswordPage />} />
          <Route path="/onboarding" element={<ProtectedRoute><OnboardingPage /></ProtectedRoute>} />
          <Route path="/" element={<ProtectedRoute><Index /></ProtectedRoute>} />
          <Route path="/quick-publish" element={<ProtectedRoute><QuickPublish /></ProtectedRoute>} />
          <Route path="/screens" element={<ProtectedRoute><Screens /></ProtectedRoute>} />
          <Route path="/media" element={<ProtectedRoute><Media /></ProtectedRoute>} />
          <Route path="/schedules" element={<ProtectedRoute><Schedules /></ProtectedRoute>} />
          <Route path="/studio" element={<ProtectedRoute><ContentStudio /></ProtectedRoute>} />
          <Route path="/publishing" element={<ProtectedRoute><Publishing /></ProtectedRoute>} />
          <Route path="/device-logs" element={<ProtectedRoute><DeviceLogs /></ProtectedRoute>} />
          <Route path="/app-store" element={<ProtectedRoute><AppStore /></ProtectedRoute>} />
          <Route path="/announcement" element={<ProtectedRoute><Announcement /></ProtectedRoute>} />
          <Route path="/queue" element={<ProtectedRoute><Queue /></ProtectedRoute>} />
          <Route path="/meeting-room" element={<ProtectedRoute><MeetingRoom /></ProtectedRoute>} />
          <Route path="/customer-service" element={<CSRoute><CustomerServicePage /></CSRoute>} />
          <Route path="/cs-dashboard" element={<CSRoute><CSDashboardPage /></CSRoute>} />
          <Route path="/cs-tickets" element={<CSRoute><CSTicketsPage /></CSRoute>} />
          <Route path="/cs-agents" element={<CSRoute><CSAgentsPage /></CSRoute>} />
          <Route path="/cs-licenses" element={<SystemAdminRoute><CSLicensesPage /></SystemAdminRoute>} />
          <Route path="/system-admin" element={<SystemAdminRoute><SystemAdminPage /></SystemAdminRoute>} />
          <Route path="/system-settings" element={<SystemAdminRoute><SystemSettingsPage /></SystemAdminRoute>} />
          <Route path="/org-management" element={<SystemAdminRoute><OrgManagementPage /></SystemAdminRoute>} />
          <Route path="/usage-leaderboard" element={<SystemAdminRoute><UsageLeaderboardPage /></SystemAdminRoute>} />
          <Route path="/widget-mgmt" element={<SystemAdminRoute><WidgetMgmtPage /></SystemAdminRoute>} />
          <Route path="/security-audit" element={<SystemAdminRoute><SecurityAuditPage /></SystemAdminRoute>} />
          <Route path="/security-audit/history" element={<SystemAdminRoute><SecurityAuditHistoryPage /></SystemAdminRoute>} />
          <Route path="/media-audit" element={<SystemAdminRoute><MediaAuditPage /></SystemAdminRoute>} />
          <Route path="/terminology-audit" element={<SystemAdminRoute><TerminologyAuditPage /></SystemAdminRoute>} />
          <Route path="/knowledge-base" element={<CSRoute><KnowledgeBasePage /></CSRoute>} />
          <Route path="/admin" element={<AdminRoute><Admin /></AdminRoute>} />
          <Route path="/iot-dashboard" element={<ProtectedRoute><IoTDashboard /></ProtectedRoute>} />
          <Route path="/player/:screenId" element={<ProtectedRoute><PlayerPage /></ProtectedRoute>} />
          <Route path="/local-player" element={<CSRoute><LocalPlayerPage /></CSRoute>} />
          <Route path="/smart-trigger-test" element={<ProtectedRoute><SmartTriggerTestPage /></ProtectedRoute>} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </Suspense>

      {showChatWidget ? (
        <Suspense fallback={null}>
          <ChatWidget />
        </Suspense>
      ) : null}
    </ErrorBoundary>
  );
};

// Caching: data stays fresh in memory for 5 min, GC after 10 min.
// refetchOnWindowFocus ensures multi-tab users see current state.
// refetchOnMount: false keeps instant navigation; explicit invalidation handles mutations.
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000,
      gcTime: 10 * 60 * 1000,
      refetchOnWindowFocus: true,
      refetchOnMount: false,
      retry: 1,
    },
  },
});

// App root component
const App = () => (
  <QueryClientProvider client={queryClient}>
    <ThemeProvider attribute="class" defaultTheme={getInitialTheme()} enableSystem={false}>
      <LanguageProvider>
        <TooltipProvider>
          <Toaster />
          <Sonner />
          <BrowserRouter>
            <ThemeSync />
            <ProfilesProvider>
            <AuthProvider>
              <ActiveOrgProvider>
              <InstalledAppsProvider>
              <AppRoutes />
              </InstalledAppsProvider>
              </ActiveOrgProvider>
            </AuthProvider>
            </ProfilesProvider>
          </BrowserRouter>
        </TooltipProvider>
      </LanguageProvider>
    </ThemeProvider>
  </QueryClientProvider>
);

export default App;
