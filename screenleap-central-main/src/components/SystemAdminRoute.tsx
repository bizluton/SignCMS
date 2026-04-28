import { useAuth } from "@/contexts/AuthContext";
import { Navigate } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { useIsSystemAdmin } from "@/hooks/useIsSystemAdmin";

/** Route guard: only members of public.system_admins can access */
export function SystemAdminRoute({ children }: { children: React.ReactNode }) {
  const { user, loading: authLoading } = useAuth();
  const { isSystemAdmin, loading } = useIsSystemAdmin();

  if (authLoading || loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!user) return <Navigate to="/auth" replace />;
  if (!isSystemAdmin) return <Navigate to="/" replace />;

  return <>{children}</>;
}
