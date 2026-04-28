import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useLanguage } from "@/contexts/LanguageContext";
import { useActiveDelegations } from "@/hooks/useActiveDelegations";
import { logActivity } from "@/lib/activityLogger";
import { Button } from "@/components/ui/button";
import { ShieldAlert, X } from "lucide-react";
import { toast } from "sonner";

/**
 * Shown to the GRANTEE while at least one delegation grant naming them is active.
 * All actions still happen under the grantee's own user_id.
 */
export function DelegationBanner() {
  const { user } = useAuth();
  const { t } = useLanguage();
  const { received, refresh } = useActiveDelegations();

  if (!user || received.length === 0) return null;

  const handleEnd = async (id: string, grantorName?: string) => {
    if (!confirm(t("delegationEndConfirm"))) return;
    const { error } = await (supabase as any)
      .from("delegation_grants")
      .update({ status: "revoked", revoked_by: user.id, revoked_at: new Date().toISOString() })
      .eq("id", id);
    if (error) {
      toast.error(error.message);
      return;
    }
    await logActivity({
      action: "delegation.end",
      category: "admin",
      targetType: "delegation",
      targetId: id,
      targetName: grantorName,
    });
    toast.success(t("delegationRevoked"));
    refresh();
  };

  return (
    <div className="space-y-2 mb-4">
      {received.map((g) => {
        const name = g.grantor_name || g.grantor_id.slice(0, 8);
        return (
          <div
            key={g.id}
            className="flex items-center justify-between gap-3 rounded-lg border border-amber-400/50 bg-amber-50 dark:bg-amber-950/20 px-4 py-2.5 text-sm text-amber-800 dark:text-amber-300"
          >
            <div className="flex items-start gap-2 min-w-0">
              <ShieldAlert className="w-5 h-5 shrink-0 mt-0.5" />
              <div className="min-w-0">
                <p className="font-semibold truncate">
                  {t("delegationActingAs").replace("{name}", name)}
                </p>
                <p className="text-xs opacity-80">{t("delegationActingHint")}</p>
              </div>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => handleEnd(g.id, g.grantor_name)}
              className="shrink-0"
            >
              <X className="w-4 h-4 mr-1" />
              {t("delegationEnd")}
            </Button>
          </div>
        );
      })}
    </div>
  );
}
