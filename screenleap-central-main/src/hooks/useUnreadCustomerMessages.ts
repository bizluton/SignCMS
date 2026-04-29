import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useActiveOrg } from "@/contexts/ActiveOrgContext";

/** Returns total unread customer messages across open sessions scoped to the active org. */
export function useUnreadCustomerMessages() {
  const [count, setCount] = useState(0);
  const { user } = useAuth();
  const { activeOrgId } = useActiveOrg();

  useEffect(() => {
    if (!user || !activeOrgId) { setCount(0); return; }

    let cancelled = false;

    const fetchCount = async () => {
      const { data: sessions } = await supabase
        .from("customer_chat_sessions")
        .select("id")
        .eq("status", "open")
        .eq("org_id", activeOrgId);

      if (cancelled) return;
      if (!sessions || sessions.length === 0) { setCount(0); return; }

      const ids = sessions.map((s) => s.id);
      const { count: c } = await supabase
        .from("customer_chat_messages")
        .select("id", { count: "exact", head: true })
        .in("session_id", ids)
        .eq("sender_type", "customer")
        .eq("is_read", false);

      if (!cancelled) setCount(c || 0);
    };

    void fetchCount();

    // Realtime only — no polling timer needed
    const channel = supabase
      .channel(`sidebar-unread:${user.id}:${activeOrgId}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "customer_chat_messages" }, () => {
        void fetchCount();
      })
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "customer_chat_messages" }, () => {
        void fetchCount();
      })
      .subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, [user, activeOrgId]);

  return count;
}
