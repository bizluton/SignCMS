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
 * Polls the device-license status of a single screen every 60 seconds.
 *
 * Why polling instead of Realtime:
 *   At 10 K screens each holding one postgres_changes channel the Supabase
 *   Realtime connection limit (Pro: 500, Team: 3 000) is blown long before we
 *   reach scale.  License revocations are rare, admin-initiated events;
 *   a worst-case 60-second propagation delay is acceptable for digital signage.
 *
 * The `orgId` parameter is kept for API compatibility but is no longer used
 * to open a Realtime subscription.  Callers may still pass it safely.
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

  // Initial fetch
  useEffect(() => {
    mounted.current = true;
    setLoading(true);
    refresh();
    return () => {
      mounted.current = false;
    };
  }, [refresh]);

  // Poll every 60 s — covers revocations within one minute while keeping
  // the Realtime connection count at zero for player screens.
  useEffect(() => {
    if (!screenId) return;
    const id = setInterval(refresh, 60_000);
    return () => clearInterval(id);
  }, [screenId, refresh]);

  // orgId is accepted but intentionally unused — retained so existing call
  // sites (PlayerPage) don't need a signature change.
  void orgId;

  return { info, loading, refresh };
}
