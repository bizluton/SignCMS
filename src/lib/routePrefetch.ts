// Route → dynamic import map. Used by NavLink hover/focus to warm up the
// page chunk before the user clicks. Each entry returns the same promise the
// React.lazy() in App.tsx will request, so Vite/Rollup dedupes the network
// fetch and the module is already cached when the route mounts.
//
// Keep this list aligned with the lazy() imports in App.tsx.
const prefetchers: Record<string, () => Promise<unknown>> = {
  "/": () => import("@/pages/Index"),
  "/screens": () => import("@/pages/Screens"),
  "/media": () => import("@/pages/Media"),
  "/schedules": () => import("@/pages/Schedules"),
  "/studio": () => import("@/pages/ContentStudio"),
  "/publishing": () => import("@/pages/Publishing"),
  "/device-logs": () => import("@/pages/DeviceLogs"),
  "/app-store": () => import("@/pages/AppStore"),
  "/announcement": () => import("@/pages/Announcement"),
  "/queue": () => import("@/pages/Queue"),
  "/meeting-room": () => import("@/pages/MeetingRoom"),
  "/customer-service": () => import("@/pages/CustomerServicePage"),
  "/cs-dashboard": () => import("@/pages/CSDashboardPage"),
  "/cs-tickets": () => import("@/pages/CSTicketsPage"),
  "/cs-agents": () => import("@/pages/CSAgentsPage"),
  "/cs-licenses": () => import("@/pages/CSLicensesPage"),
  "/knowledge-base": () => import("@/pages/KnowledgeBasePage"),
  "/admin": () => import("@/pages/Admin"),
  "/iot-dashboard": () => import("@/pages/IoTDashboard"),
};

const triggered = new Set<string>();

/** Trigger a one-shot dynamic import for the given route (no-op after first call). */
export function prefetchRoute(path: string) {
  if (triggered.has(path)) return;
  // Strip query string just in case ("/app-store?open=...").
  const key = path.split("?")[0];
  const fn = prefetchers[key];
  if (!fn) return;
  triggered.add(key);
  // Fire and forget — failures are fine, the real navigation will retry.
  fn().catch(() => triggered.delete(key));
}
