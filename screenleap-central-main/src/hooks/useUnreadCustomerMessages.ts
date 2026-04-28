import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

/** Returns total unread customer messages across all open sessions (for admin sidebar badge). */
export function useUnreadCustomerMessages() {
  const [count, setCount] = useState(0);
  const { user } = useAuth();

  useEffect(() => {
    const fetch = async () => {
      // Get all open session ids
      const { data: sessions } = await supabase
        .from("customer_chat_sessions")
        .select("id")
        .eq("status", "open");

      if (!sessions || sessions.length === 0) { setCount(0); return; }

      const ids = sessions.map((s) => s.id);
      const { count: c } = await supabase
        .from("customer_chat_messages")
        .select("id", { count: "exact", head: true })
        .in("session_id", ids)
        .eq("sender_type", "customer")
        .eq("is_read", false);

      setCount(c || 0);
    };

    void fetch();
    const id = window.setInterval(fetch, 5000);

    // Also listen for realtime inserts (per-user channel topic for natural scoping)
    const channel = supabase
      .channel(`sidebar-unread:${user?.id ?? "anon"}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "customer_chat_messages" }, () => {
        void fetch();
      })
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "customer_chat_messages" }, () => {
        void fetch();
      })
      .subscribe();

    return () => {
      window.clearInterval(id);
      supabase.removeChannel(channel);
    };
  }, [user?.id]);

  return count;
}
