import { useEffect, useState, useCallback, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";

export type ScreenLicenseStatus =
  | "active"
  | "revoked"
  | "no_license"
  | "screen_not_found"
  | "permission_denied"
  | "unauthenticated"
  | "unknown";

export interface ScreenLicenseInfo {
  licensed: boolean;
  status: ScreenLicenseStatus;
  license_id?: string;
  license_code?: string;
  device_model?: string;
  revoked_at?: string;
}

/**
 * Subscribes to the live device-license status of a single screen.
 * Re-checks via the `check_screen_license_status` RPC whenever a
 * device_licenses row for this screen's org changes.
 *
 * Pass `orgId` so the Realtime filter is scoped to the org — without it the
 * subscription would broadcast to ALL screens across ALL orgs on every single
 * license change (thundering-herd risk at 10 K+ screens).  When orgId is not
 * yet known (e.g. still loading) the subscription is held back until it
 * becomes available; the initial RPC check still runs immediately.
 */
export function useScreenLicenseStatus(
  screenId: string | null | undefined,
  orgId?: string | null,
) {
  const [info, setInfo] = useState<ScreenLicenseInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const mounted = useRef(true);

  const refresh = useCallback(async () => {
    if (!screenId) {
      setInfo(null);
      setLoading(false);
      return;
    }
    const { data, error } = await supabase.rpc("check_screen_license_status", {
      _screen_id: screenId,
    });
    if (!mounted.current) return;
    if (error) {
      setInfo({ licensed: false, status: "unknown" });
    } else {
      setInfo((data as ScreenLicenseInfo) || { licensed: false, status: "unknown" });
    }
    setLoading(false);
  }, [screenId]);

  useEffect(() => {
    mounted.current = true;
    setLoading(true);
    refresh();
    return () => {
      mounted.current = false;
    };
  }, [refresh]);

  // Realtime: any change on device_licenses for THIS org → re-check status.
  // Scoped to orgId so a single revocation only wakes screens in the same org
  // instead of broadcasting to every screen globally.
  // We skip subscribing until orgId is known to avoid an unfiltered global
  // subscription (which would be replaced anyway once orgId arrives).
  useEffect(() => {
    if (!screenId || !orgId) return;
    const channel = supabase
      .channel(`screen-license-${screenId}-${orgId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "device_licenses",
          filter: `org_id=eq.${orgId}`,
        },
        () => {
          refresh();
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [screenId, orgId, refresh]);

  return { info, loading, refresh };
}
