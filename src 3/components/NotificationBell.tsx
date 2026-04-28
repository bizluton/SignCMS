import { useState, useEffect, useCallback } from "react";
import { Bell, ShieldCheck, Loader2, Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Popover, PopoverContent, PopoverTrigger,
} from "@/components/ui/popover";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useLanguage } from "@/contexts/LanguageContext";
import { cn } from "@/lib/utils";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";

interface Notification {
  id: string;
  type: string;
  title: string;
  body: string;
  link: string;
  is_read: boolean;
  created_at: string;
  created_by: string | null;
}

interface PendingDelegationReq {
  id: string;
  requester_id: string;
  customer_id: string;
  hours: number;
  status: string;
  created_at: string;
}

const formatRelative = (iso: string) => {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "剛剛";
  if (mins < 60) return `${mins} 分鐘前`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs} 小時前`;
  return `${Math.floor(hrs / 24)} 天前`;
};

export function NotificationBell() {
  const { user } = useAuth();
  const { t } = useLanguage();
  const navigate = useNavigate();
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [pendingReqs, setPendingReqs] = useState<PendingDelegationReq[]>([]);
  const [open, setOpen] = useState(false);
  const [actingId, setActingId] = useState<string | null>(null);

  // Request browser notification permission on mount
  useEffect(() => {
    if ("Notification" in window && Notification.permission === "default") {
      Notification.requestPermission();
    }
  }, []);

  const showBrowserNotification = useCallback((title: string, body: string, link?: string) => {
    if ("Notification" in window && Notification.permission === "granted" && document.hidden) {
      const n = new Notification(title, { body, icon: "/favicon.ico", tag: "signcms-notify" });
      n.onclick = () => {
        window.focus();
        if (link) navigate(link);
        n.close();
      };
    }
  }, [navigate]);

  const load = useCallback(async () => {
    if (!user) return;
    const { data } = await supabase
      .from("notifications")
      .select("*")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(30);
    if (data) setNotifications(data as Notification[]);
  }, [user]);

  const loadPendingReqs = useCallback(async () => {
    if (!user) return;
    const { data } = await (supabase as any)
      .from("delegation_requests")
      .select("id, requester_id, customer_id, hours, status, created_at")
      .eq("customer_id", user.id)
      .eq("status", "pending")
      .order("created_at", { ascending: false })
      .limit(20);
    if (data) setPendingReqs(data);
  }, [user]);

  useEffect(() => {
    load();
    loadPendingReqs();
  }, [load, loadPendingReqs]);

  // Realtime subscription
  useEffect(() => {
    if (!user) return;
    const notifChannel = supabase
      .channel(`user-notifications:${user.id}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "notifications",
          filter: `user_id=eq.${user.id}`,
        },
        (payload) => {
          load();
          const row = payload.new as any;
          if (row?.type === "delegation_request") loadPendingReqs();
          if (row?.title) {
            showBrowserNotification(row.title, row.body || "", row.link);
          }
        }
      )
      .subscribe();

    const reqChannel = supabase
      .channel(`user-deleg-reqs-${user.id}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "delegation_requests",
          filter: `customer_id=eq.${user.id}`,
        },
        () => loadPendingReqs(),
      )
      .subscribe();

    return () => {
      supabase.removeChannel(notifChannel);
      supabase.removeChannel(reqChannel);
    };
  }, [user, load, loadPendingReqs, showBrowserNotification]);

  const unreadCount = notifications.filter(n => !n.is_read).length;

  const markAllRead = async () => {
    if (!user || unreadCount === 0) return;
    const unreadIds = notifications.filter(n => !n.is_read).map(n => n.id);
    await supabase.from("notifications").update({ is_read: true }).in("id", unreadIds);
    setNotifications(prev => prev.map(n => ({ ...n, is_read: true })));
  };

  const handleClick = async (n: Notification) => {
    if (!n.is_read) {
      await supabase.from("notifications").update({ is_read: true }).eq("id", n.id);
      setNotifications(prev => prev.map(x => x.id === n.id ? { ...x, is_read: true } : x));
    }
    if (n.link) {
      navigate(n.link);
      setOpen(false);
    }
  };

  const clearAll = async () => {
    if (!user) return;
    await supabase.from("notifications").delete().eq("user_id", user.id);
    setNotifications([]);
  };

  /**
   * For a delegation_request notification, find the matching pending request.
   * Match by requester_id (= notification.created_by) and pick the request
   * created closest in time before the notification.
   */
  const findPendingForNotification = (n: Notification): PendingDelegationReq | null => {
    if (n.type !== "delegation_request" || !n.created_by) return null;
    const notifTime = new Date(n.created_at).getTime();
    const candidates = pendingReqs.filter(
      r => r.requester_id === n.created_by &&
        Math.abs(new Date(r.created_at).getTime() - notifTime) < 60_000,
    );
    return candidates[0] || null;
  };

  const respondToRequest = async (
    notification: Notification,
    requestId: string,
    action: "accept" | "decline",
  ) => {
    setActingId(requestId);
    const { data, error } = await supabase.functions.invoke("accept-delegation-request", {
      body: { request_id: requestId, action },
    });
    setActingId(null);
    if (error || (data as any)?.error) {
      toast.error(t("delegationRequestActionFailed") + (error?.message || (data as any)?.error));
      return;
    }
    toast.success(action === "accept" ? t("delegationRequestAcceptedToast") : t("delegationRequestDeclinedToast"));
    // Mark notification as read after action
    if (!notification.is_read) {
      await supabase.from("notifications").update({ is_read: true }).eq("id", notification.id);
      setNotifications(prev => prev.map(x => x.id === notification.id ? { ...x, is_read: true } : x));
    }
    loadPendingReqs();
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="relative w-8 h-8">
          <Bell className="h-4 w-4" />
          {unreadCount > 0 && (
            <span className="absolute -top-0.5 -right-0.5 h-4 min-w-[16px] px-1 rounded-full bg-destructive text-destructive-foreground text-[10px] font-bold flex items-center justify-center">
              {unreadCount > 99 ? "99+" : unreadCount}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0">
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-border">
          <span className="text-sm font-semibold">通知</span>
          <div className="flex items-center gap-1">
            {unreadCount > 0 && (
              <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={markAllRead}>
                全部已讀
              </Button>
            )}
            {notifications.length > 0 && (
              <Button variant="ghost" size="sm" className="h-7 text-xs text-muted-foreground" onClick={clearAll}>
                清除
              </Button>
            )}
          </div>
        </div>
        <ScrollArea className="max-h-80">
          {notifications.length === 0 ? (
            <div className="py-8 text-center text-sm text-muted-foreground">暫無通知</div>
          ) : (
            notifications.map(n => {
              const pending = findPendingForNotification(n);
              const isActing = pending && actingId === pending.id;
              return (
                <div
                  key={n.id}
                  className={cn(
                    "border-b border-border/50",
                    !n.is_read && "bg-primary/5",
                  )}
                >
                  <button
                    onClick={() => handleClick(n)}
                    className="w-full text-left px-4 py-3 hover:bg-muted/50 transition-colors"
                  >
                    <div className="flex items-start gap-2">
                      {!n.is_read && <span className="mt-1.5 h-2 w-2 rounded-full bg-primary shrink-0" />}
                      {n.type === "delegation_request" && (
                        <ShieldCheck className="mt-0.5 h-4 w-4 text-primary shrink-0" />
                      )}
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{n.title}</p>
                        <p className="text-xs text-muted-foreground line-clamp-2 mt-0.5">{n.body}</p>
                        <p className="text-[10px] text-muted-foreground mt-1">{formatRelative(n.created_at)}</p>
                      </div>
                    </div>
                  </button>
                  {pending && (
                    <div className="flex gap-2 px-4 pb-3">
                      <Button
                        size="sm"
                        className="flex-1 h-7 text-xs"
                        onClick={() => respondToRequest(n, pending.id, "accept")}
                        disabled={isActing}
                      >
                        {isActing ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
                        <span className="ml-1">{t("delegationRequestAccept")}</span>
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="flex-1 h-7 text-xs"
                        onClick={() => respondToRequest(n, pending.id, "decline")}
                        disabled={isActing}
                      >
                        <X className="h-3 w-3" />
                        <span className="ml-1">{t("delegationRequestDecline")}</span>
                      </Button>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </ScrollArea>
      </PopoverContent>
    </Popover>
  );
}
