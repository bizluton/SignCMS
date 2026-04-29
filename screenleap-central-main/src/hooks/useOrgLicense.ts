import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useActiveOrg } from "@/contexts/ActiveOrgContext";

export interface OrgLicense {
  plan: string;
  expiresAt: Date;
  daysLeft: number;
  expired: boolean;
  expiringSoon: boolean; // ≤30 days
}

/**
 * Returns the active org's license status.
 * `expired` = true means features should be restricted.
 * `expiringSoon` = true (≤30 days) means show a warning banner.
 */
export function useOrgLicense() {
  const { activeOrgId } = useActiveOrg();
  const [license, setLicense] = useState<OrgLicense | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!activeOrgId) {
      setLicense(null);
      setLoading(false);
      return;
    }

    const fetch = async () => {
      setLoading(true);
      const { data } = await supabase
        .from("organizations")
        .select("license_plan, license_expires_at")
        .eq("id", activeOrgId)
        .single();

      if (data) {
        const expiresAt = new Date(data.license_expires_at ?? "");
        const daysLeft = Math.ceil((expiresAt.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
        setLicense({
          plan: data.license_plan ?? "",
          expiresAt,
          daysLeft,
          expired: daysLeft <= 0,
          expiringSoon: daysLeft > 0 && daysLeft <= 30,
        });
      } else {
        setLicense(null);
      }
      setLoading(false);
    };

    fetch();
  }, [activeOrgId]);

  return { license, loading };
}
