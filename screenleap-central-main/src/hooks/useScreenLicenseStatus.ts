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
 * Re-checks via the `check_screen_license_status` RPC whenever any
 * device_licenses row changes (we filter client-side because we don't yet
 * know the matching license_id ahead of time).
 */
export function useScreenLicenseStatus(screenId: string | null | undefined) {
  const [info, setInfo] = useState<ScreenLicenseInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const mounted = useRef(true);

  const refresh = useCallback(async () => {
    if (!screenId) {
      setInfo(null);
      setLoading(false);
      return;
    }
    const { data, error } = await (supabase as any).rpc("check_screen_license_status", {
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

  // Realtime: any change on device_licenses → re-check this screen's status.
  useEffect(() => {
    if (!screenId) return;
    const channel = (supabase as any)
      .channel(`screen-license-${screenId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "device_licenses" },
        () => {
          refresh();
        },
      )
      .subscribe();
    return () => {
      (supabase as any).removeChannel(channel);
    };
  }, [screenId, refresh]);

  return { info, loading, refresh };
}