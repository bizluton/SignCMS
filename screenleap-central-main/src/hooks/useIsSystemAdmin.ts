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
          console.error("useIsSystemAdmin check failed:", error);
          // Retry once on transient errors rather than silently returning false
          const { data: retryData } = await supabase
            .from("system_admins")
            .select("user_id")
            .eq("user_id", user.id)
            .maybeSingle();
          if (!cancelled) setIsSystemAdmin(!!retryData);
        } else {
          setIsSystemAdmin(!!data);
        }
        if (!cancelled) setLoading(false);
      } catch (err) {
        if (cancelled) return;
        console.error("useIsSystemAdmin unexpected failure:", err);
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
