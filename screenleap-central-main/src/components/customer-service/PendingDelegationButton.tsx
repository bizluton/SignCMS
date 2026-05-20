import { useEffect, useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { ShieldCheck, Clock, X, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useLanguage } from "@/contexts/LanguageContext";
import { toast } from "sonner";
import { formatUserError } from "@/lib/formatUserError";

interface Props {
  sessionId: string;
  customerId: string;
  isSelf: boolean;
  onRequest: () => void;
}

interface PendingReq {
  id: string;
  created_at: string;
  hours: number;
}

// Pending request TTL window (client-side display): 10 minutes
const PENDING_TTL_MS = 10 * 60 * 1000;

const formatRemaining = (ms: number) => {
  if (ms <= 0) return "0:00";
  const total = Math.ceil(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
};

export default function PendingDelegationButton({ sessionId, customerId, isSelf, onRequest }: Props) {
  const { user } = useAuth();
  const { t } = useLanguage();
  const [pending, setPending] = useState<PendingReq | null>(null);
  const [now, setNow] = useState(Date.now());
  const [cancelling, setCancelling] = useState(false);

  const load = useCallback(async () => {
    if (!user) return;
    const { data } = await supabase
      .from("delegation_requests")
      .select("id, created_at, hours")
      .eq("session_id", sessionId)
      .eq("requester_id", user.id)
      .eq("status", "pending")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    setPending(data || null);
  }, [sessionId, user]);

  useEffect(() => { load(); }, [load]);

  // Realtime subscription for status changes
  useEffect(() => {
    if (!user) return;
    const channel = supabase
      .channel(`pending-deleg:${user.id}:${sessionId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "delegation_requests", filter: `session_id=eq.${sessionId}` },
        () => { load(); },
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [sessionId, user, load]);

  // Tick every second when pending
  useEffect(() => {
    if (!pending) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [pending]);

  const handleCancel = async () => {
    if (!pending || cancelling) return;
    setCancelling(true);
    const { error } = await supabase
      .from("delegation_requests")
      .update({ status: "cancelled", resolved_at: new Date().toISOString() })
      .eq("id", pending.id);
    setCancelling(false);
    if (error) {
      toast.error(formatUserError(error, t, t("delegationRequestCancelFailed")));
      return;
    }
    toast.success(t("delegationRequestCancelled"));
    setPending(null);
  };

  if (pending) {
    const expiresAt = new Date(pending.created_at).getTime() + PENDING_TTL_MS;
    const remaining = expiresAt - now;
    const expired = remaining <= 0;

    return (
      <div className="flex items-center gap-1.5 rounded-md border border-warning/40 bg-warning/10 px-2 py-1">
        <Clock className="h-3.5 w-3.5 text-warning" />
        <span className="text-xs font-medium text-foreground">
          {t("delegationRequestPending")}
        </span>
        {!expired && (
          <span className="text-xs tabular-nums text-muted-foreground">
            {t("delegationRequestExpiresIn").replace("{time}", formatRemaining(remaining))}
          </span>
        )}
        <Button
          variant="ghost"
          size="sm"
          className="h-6 px-1.5 ml-1 text-destructive hover:text-destructive"
          onClick={handleCancel}
          disabled={cancelling}
          title={t("delegationRequestCancelBtn")}
        >
          {cancelling ? <Loader2 className="h-3 w-3 animate-spin" /> : <X className="h-3 w-3" />}
          <span className="text-xs ml-1">{t("delegationRequestCancelBtn")}</span>
        </Button>
      </div>
    );
  }

  return (
    <Button
      variant="outline"
      size="sm"
      className="gap-1.5"
      onClick={onRequest}
      disabled={isSelf}
      title={isSelf ? t("delegationRequestSelfDisabled") : undefined}
    >
      <ShieldCheck className="h-3.5 w-3.5" />
      {t("delegationRequestBtn")}
    </Button>
  );
}
