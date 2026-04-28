import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { MessageSquare, Ticket, MessagesSquare } from "lucide-react";
 
import { supabase } from "@/integrations/supabase/client";
import { useLanguage } from "@/contexts/LanguageContext";
import { useNavigate } from "react-router-dom";

export function CSAgentCards() {
  const { t } = useLanguage();
  const navigate = useNavigate();
  const [unreadMessages, setUnreadMessages] = useState(0);
  const [openTickets, setOpenTickets] = useState(0);
  const [todaySessions, setTodaySessions] = useState(0);

  useEffect(() => {
    const fetchStats = async () => {
      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);

      const [openSessionsRes, ticketsRes, todaySessionsRes] = await Promise.all([
        supabase.from("customer_chat_sessions").select("id").eq("status", "open"),
        supabase.from("support_tickets").select("id", { count: "exact", head: true }).in("status", ["open", "in_progress"]),
        supabase.from("customer_chat_sessions").select("id", { count: "exact", head: true }).gte("created_at", todayStart.toISOString()),
      ]);

      const sessionIds = (openSessionsRes.data || []).map((s: any) => s.id);
      if (sessionIds.length > 0) {
        const { count } = await supabase
          .from("customer_chat_messages")
          .select("id", { count: "exact", head: true })
          .in("session_id", sessionIds)
          .eq("sender_type", "customer")
          .eq("is_read", false);
        setUnreadMessages(count || 0);
      } else {
        setUnreadMessages(0);
      }

      setOpenTickets(ticketsRes.count || 0);
      setTodaySessions(todaySessionsRes.count || 0);
    };

    void fetchStats();
    const timer = setInterval(fetchStats, 30000);
    return () => clearInterval(timer);
  }, []);

  return (
    <div className="space-y-2 animate-fade-in">
      <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
        <MessagesSquare className="w-4 h-4 text-primary" />
        {t("dashCSSection")}
      </h3>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Card
          className="p-4 hover-lift shadow-sm cursor-pointer border-primary/20"
          onClick={() => navigate("/customer-service")}
          title={t("dashCSUnread")}
        >
          <div className="flex items-center justify-between mb-2">
            <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center">
              <MessageSquare className="w-4.5 h-4.5 text-primary" />
            </div>
            {unreadMessages > 0 && (
              <span className="w-2 h-2 rounded-full bg-destructive animate-pulse" />
            )}
          </div>
          <p className="text-2xl font-bold tracking-tight text-foreground">{unreadMessages}</p>
          <p className="text-xs text-muted-foreground mt-0.5">{t("dashCSUnread")}</p>
        </Card>

        <Card
          className="p-4 hover-lift shadow-sm cursor-pointer border-amber-500/20"
          onClick={() => navigate("/cs/tickets")}
          title={t("dashCSOpenTickets")}
        >
          <div className="flex items-center justify-between mb-2">
            <div className="w-9 h-9 rounded-lg bg-amber-500/10 flex items-center justify-center">
              <Ticket className="w-4.5 h-4.5 text-amber-500" />
            </div>
          </div>
          <p className="text-2xl font-bold tracking-tight text-foreground">{openTickets}</p>
          <p className="text-xs text-muted-foreground mt-0.5">{t("dashCSOpenTickets")}</p>
        </Card>

        <Card
          className="p-4 hover-lift shadow-sm cursor-pointer border-emerald-500/20"
          onClick={() => navigate("/cs/dashboard")}
          title={t("dashCSTodaySessions")}
        >
          <div className="flex items-center justify-between mb-2">
            <div className="w-9 h-9 rounded-lg bg-emerald-500/10 flex items-center justify-center">
              <MessagesSquare className="w-4.5 h-4.5 text-emerald-500" />
            </div>
          </div>
          <p className="text-2xl font-bold tracking-tight text-foreground">{todaySessions}</p>
          <p className="text-xs text-muted-foreground mt-0.5">{t("dashCSTodaySessions")}</p>
        </Card>
      </div>
    </div>
  );
}
