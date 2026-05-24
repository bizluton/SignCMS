import { DashboardLayout } from "@/components/DashboardLayout";
import { useLanguage } from "@/contexts/LanguageContext";
import AgentManagement from "@/components/admin/AgentManagement";

/**
 * Independent page for managing SI 代理商 (agents).
 *
 * Lives under the System Admin section in the sidebar so that only system
 * admins reach it — the `/system-agents` route is wrapped by
 * SystemAdminRoute in App.tsx, which redirects non-system-admins away.
 * Per SIGNCMS組織權限規則: SI 代理商由系統管理員邀請 — 組織管理員不可見此功能.
 */
export default function SystemAgentsPage() {
  const { language } = useLanguage();

  const labels = {
    zh: { title: "SI 代理商管理", subtitle: "邀請、指派與管理跨組織之SI 代理商" },
    en: { title: "SI Agent Management", subtitle: "Invite, assign, and manage cross-org SI agents (system integrators)" },
    ja: { title: "SI 代理店管理", subtitle: "複数組織にまたがるSI 代理店の招待・割当・管理" },
  } as const;
  const t = labels[language] || labels.en;

  return (
    <DashboardLayout>
      <div className="space-y-6 max-w-5xl">
        <div className="animate-fade-in">
          <h1 className="text-2xl font-bold text-foreground">{t.title}</h1>
          <p className="text-sm text-muted-foreground mt-1">{t.subtitle}</p>
        </div>
        <AgentManagement />
      </div>
    </DashboardLayout>
  );
}
