import { useEffect, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";

/**
 * Checks whether the current user is a system administrator (member of public.system_admins).
 * Replaces the legacy hardcoded UUID check.
 *
 * Returns { isSystemAdmin, loading }. While `loading` is true, components should
 * defer destructive UI decisions (e.g. sidebar group visibility may stay hidden).
 */
export function useIsSystemAdmin() {
  const { user, loading: authLoading } = useAuth();
  const [isSystemAdmin, setIsSystemAdmin] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    if (authLoading) return;
    if (!user) {
      setIsSystemAdmin(false);
      setLoading(false);
      return;
    }
    setLoading(true);
    void (async () => {
      try {
        const { data, error } = await supabase
          .from("system_admins")
          .select("user_id")
          .eq("user_id", user.id)
          .maybeSingle();

        if (cancelled) return;
        if (error) {
          console.warn("useIsSystemAdmin check failed:", error);
          setIsSystemAdmin(false);
        } else {
          setIsSystemAdmin(!!data);
        }
        setLoading(false);
      } catch (error) {
        if (cancelled) return;
        console.warn("useIsSystemAdmin unexpected failure:", error);
        setIsSystemAdmin(false);
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user, authLoading]);

  return { isSystemAdmin, loading: loading || authLoading };
}
