import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";

export interface ProjectSchedule {
  id: string;
  org_id: string;
  design_project_id: string;
  name: string;
  color: string;
  block_type: "calendar" | "weekly";
  start_at: string | null;
  end_at: string | null;
  weekdays: string[];
  start_time: string | null;
  end_time: string | null;
  effective_from: string | null;
  effective_to: string | null;
  enabled: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  sort_order: number;
}

export function useProjectSchedules(orgId: string | null) {
  const [schedules, setSchedules] = useState<ProjectSchedule[]>([]);
  const [loading, setLoading] = useState(false);

  const reload = useCallback(async () => {
    if (!orgId) { setSchedules([]); return; }
    setLoading(true);
    const { data, error } = await supabase
      .from("project_schedules")
      .select("*")
      .eq("org_id", orgId)
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: true });
    if (!error && data) setSchedules(data as ProjectSchedule[]);
    setLoading(false);
  }, [orgId]);

  useEffect(() => { reload(); }, [reload]);

  return { schedules, loading, reload };
}
