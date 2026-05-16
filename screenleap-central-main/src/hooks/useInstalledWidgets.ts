import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useActiveOrg } from "@/contexts/ActiveOrgContext";

export function useInstalledWidgets() {
  const { activeOrgId } = useActiveOrg();
  const [installedIds, setInstalledIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    if (!activeOrgId) { setInstalledIds(new Set()); setLoading(false); return; }
    setLoading(true);
    const { data } = await supabase
      .from("installed_widgets")
      .select("widget_id")
      .eq("org_id", activeOrgId);
    setInstalledIds(new Set((data || []).map((r) => r.widget_id)));
    setLoading(false);
  }, [activeOrgId]);

  useEffect(() => { reload(); }, [reload]);

  // Real-time sync
  useEffect(() => {
    const channel = supabase
      .channel("useInstalledWidgets-realtime")
      .on("postgres_changes", { event: "*", schema: "public", table: "installed_widgets" }, () => { void reload(); })
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [reload]);

  const install = useCallback(async (widgetId: string): Promise<boolean> => {
    if (!activeOrgId) return false;
    const { error } = await supabase
      .from("installed_widgets")
      .insert({ org_id: activeOrgId, widget_id: widgetId });
    if (!error) { void reload(); return true; }
    return false;
  }, [activeOrgId, reload]);

  const uninstall = useCallback(async (widgetId: string): Promise<boolean> => {
    if (!activeOrgId) return false;
    const { error } = await supabase
      .from("installed_widgets")
      .delete()
      .eq("org_id", activeOrgId)
      .eq("widget_id", widgetId);
    if (!error) { void reload(); return true; }
    return false;
  }, [activeOrgId, reload]);

  return { installedIds, loading, install, uninstall, reload };
}
