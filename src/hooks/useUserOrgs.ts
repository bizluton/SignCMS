import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useUserRole } from "@/hooks/useUserRole";

interface UserOrg {
  id: string;
  name: string;
}

export function useUserOrgs() {
  const { user } = useAuth();
  const { isAdmin } = useUserRole();
  const [orgs, setOrgs] = useState<UserOrg[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) { setOrgs([]); setLoading(false); return; }

    const fetchOrgs = async () => {
      setLoading(true);
      if (isAdmin) {
        // Admins can see all organizations
        const { data } = await supabase.from("organizations").select("id, name").order("name");
        setOrgs((data || []) as UserOrg[]);
      } else {
        // Regular users only see orgs they belong to via team membership
        const { data: memberData } = await supabase
          .from("team_members")
          .select("team_id")
          .eq("user_id", user.id);

        if (memberData && memberData.length > 0) {
          const teamIds = memberData.map(m => m.team_id);
          const { data: teamData } = await supabase
            .from("teams")
            .select("org_id")
            .in("id", teamIds);

          if (teamData && teamData.length > 0) {
            const orgIds = [...new Set(teamData.map(t => t.org_id))];
            const { data: orgData } = await supabase
              .from("organizations")
              .select("id, name")
              .in("id", orgIds)
              .order("name");
            setOrgs((orgData || []) as UserOrg[]);
          } else {
            setOrgs([]);
          }
        } else {
          setOrgs([]);
        }
      }
      setLoading(false);
    };

    fetchOrgs();
  }, [user, isAdmin]);

  return { orgs, loading, defaultOrgId: orgs[0]?.id || null };
}
