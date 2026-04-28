import { useAuth } from "@/contexts/AuthContext";
import { useUserRole } from "@/hooks/useUserRole";
import { useIsSystemAdmin } from "@/hooks/useIsSystemAdmin";
import { Navigate } from "react-router-dom";
import { Loader2 } from "lucide-react";

/** Route guard: only system admin or active cs_agents can access */
export function CSRoute({ children }: { children: React.ReactNode }) {
  const { user, loading: authLoading } = useAuth();
  const { isCsAgent, loading: roleLoading } = useUserRole();
  const { isSystemAdmin, loading: sysLoading } = useIsSystemAdmin();

  if (authLoading || roleLoading || sysLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/auth" replace />;
  }

  if (!isSystemAdmin && !isCsAgent) {
    return <Navigate to="/" replace />;
  }

  return <>{children}</>;
}
