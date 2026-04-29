import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

export function useUserRole() {
  const { user } = useAuth();
  const [isAdmin, setIsAdmin] = useState(false);
  const [isOrgAdmin, setIsOrgAdmin] = useState(false);
  const [isCsAgent, setIsCsAgent] = useState(false);
  const [role, setRole] = useState<"admin" | "org_admin" | "user" | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    if (!user) {
      setIsAdmin(false);
      setIsOrgAdmin(false);
      setIsCsAgent(false);
      setRole(null);
      setLoading(false);
      return;
    }

    const fetchRole = async () => {
      setLoading(true);
      try {
        const [{ data: rolesData, error: rolesError }, { data: csData, error: csError }, { data: sysAdminData }] = await Promise.all([
          supabase
            .from("user_roles")
            .select("role")
            .eq("user_id", user.id),
          supabase
            .from("cs_agents")
            .select("id")
            .eq("user_id", user.id)
            .eq("status", "active")
            .maybeSingle(),
          supabase
            .from("system_admins")
            .select("user_id")
            .eq("user_id", user.id)
            .maybeSingle(),
        ]);

        if (cancelled) return;
        if (rolesError) throw rolesError;
        if (csError) throw csError;

        const roles = rolesData?.map((r) => r.role) ?? [];
        // System admins automatically inherit CS agent permissions
        const csAgent = !!csData || !!sysAdminData;
        const admin = roles.includes("admin");
        const orgAdmin = roles.includes("org_admin");

        setIsAdmin(admin);
        setIsOrgAdmin(orgAdmin);
        setIsCsAgent(csAgent);
        setRole(admin ? "admin" : orgAdmin ? "org_admin" : "user");
      } catch (error) {
        if (cancelled) return;
        console.warn("useUserRole fetch failed:", error);
        setIsAdmin(false);
        setIsOrgAdmin(false);
        setIsCsAgent(false);
        setRole("user");
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void fetchRole();

    return () => {
      cancelled = true;
    };
  }, [user]);

  return { isAdmin, isOrgAdmin, isCsAgent, role, loading };
}
