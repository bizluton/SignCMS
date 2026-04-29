import { useEffect, useState, useCallback, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useLanguage } from "@/contexts/LanguageContext";
import { toast } from "sonner";

export interface DelegationGrant {
  id: string;
  grantor_id: string;
  grantee_id: string;
  grantee_scope: "org_admin" | "cs_agent";
  reason: string | null;
  expires_at: string;
  status: "active" | "revoked" | "expired";
  created_at: string;
  grantor_name?: string;
  grantee_name?: string;
}

/**
 * Returns delegations relevant to the current user:
 * - granted: grants this user gave to others (active)
 * - received: grants given to this user (active and unexpired) — the user is currently acting as delegate for these
 */
export function useActiveDelegations() {
  const { user } = useAuth();
  const { t } = useLanguage();
  const [granted, setGranted] = useState<DelegationGrant[]>([]);
  const [received, setReceived] = useState<DelegationGrant[]>([]);
  const [loading, setLoading] = useState(true);
  const timersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  const refresh = useCallback(async () => {
    if (!user) {
      setGranted([]);
      setReceived([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const nowIso = new Date().toISOString();
    const [{ data: g }, { data: r }] = await Promise.all([
      supabase
        .from("delegation_grants")
        .select("*")
        .eq("grantor_id", user.id)
        .eq("status", "active")
        .gt("expires_at", nowIso)
        .order("created_at", { ascending: false }),
      supabase
        .from("delegation_grants")
        .select("*")
        .eq("grantee_id", user.id)
        .eq("status", "active")
        .gt("expires_at", nowIso)
        .order("created_at", { ascending: false }),
    ]);

    const grantedRows = (g || []) as DelegationGrant[];
    const receivedRows = (r || []) as DelegationGrant[];

    // Resolve display names
    const ids = Array.from(
      new Set([
        ...grantedRows.map((x) => x.grantee_id),
        ...receivedRows.map((x) => x.grantor_id),
      ])
    );
    if (ids.length > 0) {
      const { data: profiles } = await supabase
        .from("profiles")
        .select("user_id, display_name")
        .in("user_id", ids);
      const nameMap = new Map((profiles || []).map((p) => [p.user_id, p.display_name]));
      grantedRows.forEach((x) => (x.grantee_name = nameMap.get(x.grantee_id) || undefined));
      receivedRows.forEach((x) => (x.grantor_name = nameMap.get(x.grantor_id) || undefined));
    }

    setGranted(grantedRows);
    setReceived(receivedRows);
    setLoading(false);
  }, [user]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Schedule per-grant expiry: when a received delegation expires, toast + refresh to hide banner
  useEffect(() => {
    const timers = timersRef.current;
    // Clear stale timers
    timers.forEach((tid) => clearTimeout(tid));
    timers.clear();

    received.forEach((g) => {
      const ms = new Date(g.expires_at).getTime() - Date.now();
      if (ms <= 0 || ms > 2_147_483_000) return; // skip past or absurdly-far
      const tid = setTimeout(() => {
        const name = g.grantor_name || g.grantor_id.slice(0, 8);
        toast.info(t("delegationExpiredToast").replace("{name}", name));
        refresh();
      }, ms + 500);
      timers.set(g.id, tid);
    });

    return () => {
      timers.forEach((tid) => clearTimeout(tid));
      timers.clear();
    };
  }, [received, refresh, t]);

  // Realtime: react to status changes on grants where current user is grantee or grantor
  useEffect(() => {
    if (!user) return;
    const channel = supabase
      .channel(`delegation-grants-${user.id}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "delegation_grants",
          filter: `grantee_id=eq.${user.id}`,
        },
        (payload: { new: { id: string; status: string; grantor_id: string } }) => {
          const newRow = payload.new;
          if (newRow?.status === "revoked") {
            const wasActive = received.find((g) => g.id === newRow.id);
            if (wasActive) {
              const name = wasActive.grantor_name || newRow.grantor_id.slice(0, 8);
              toast.warning(t("delegationRevokedToast").replace("{name}", name));
            }
            refresh();
          }
        }
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "delegation_grants",
          filter: `grantor_id=eq.${user.id}`,
        },
        (payload: { new: { id: string; status: string; grantee_id: string } }) => {
          const newRow = payload.new;
          if (newRow?.status === "ended") {
            const wasActive = granted.find((g) => g.id === newRow.id);
            if (wasActive) {
              const name = wasActive.grantee_name || newRow.grantee_id.slice(0, 8);
              toast.info(t("delegationEndedToast").replace("{name}", name));
            }
            refresh();
          } else if (newRow?.status !== "active") {
            // any non-active transition (revoked/expired) — keep list in sync
            refresh();
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user, received, granted, refresh, t]);

  return { granted, received, loading, refresh };
}
