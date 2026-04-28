import { useEffect, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { Navigate, useLocation } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useUserRole } from "@/hooks/useUserRole";
import { useIsSystemAdmin } from "@/hooks/useIsSystemAdmin";

/**
 * Wraps ProtectedRoute children with an additional check:
 * if the authenticated user has no organization membership AND is not a system admin / CS agent,
 * redirect them to /onboarding to collect organization name.
 */
export function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const { isAdmin, loading: roleLoading } = useUserRole();
  const { isSystemAdmin, loading: systemAdminLoading } = useIsSystemAdmin();
  const location = useLocation();
  const [orgChecked, setOrgChecked] = useState(false);
  const [hasOrg, setHasOrg] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (!user) { setOrgChecked(true); return; }
    (async () => {
      // System admins and org admins bypass org membership gating here.
      if (isAdmin || isSystemAdmin) {
        if (!cancelled) { setHasOrg(true); setOrgChecked(true); }
        return;
      }
      // CS agent bypasses org check
      const { data: csData } = await supabase
        .from("cs_agents")
        .select("id")
        .eq("user_id", user.id)
        .eq("status", "active")
        .limit(1);
      if (csData && csData.length > 0) {
        if (!cancelled) { setHasOrg(true); setOrgChecked(true); }
        return;
      }
      const { data } = await supabase
        .from("team_members")
        .select("team_id")
        .eq("user_id", user.id)
        .limit(1);
      if (!cancelled) {
        setHasOrg(!!(data && data.length > 0));
        setOrgChecked(true);
      }
    })();
    return () => { cancelled = true; };
  }, [user, isAdmin, isSystemAdmin]);

  if (loading || roleLoading || systemAdminLoading || (user && !orgChecked)) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/auth" replace />;
  }

  if (!hasOrg && location.pathname !== "/onboarding") {
    return <Navigate to="/onboarding" replace />;
  }

  return <>{children}</>;
}
