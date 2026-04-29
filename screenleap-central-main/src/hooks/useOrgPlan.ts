import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useActiveOrg } from "@/contexts/ActiveOrgContext";

export type PlanTier =
  | "evaluation"
  | "starter"
  | "business"
  | "professional"
  | "enterprise";

export interface PlanLimits {
  /** Bytes; -1 means unlimited */
  mediaBytes: number;
  /** Count; -1 means unlimited */
  maxScreens: number;
  /** Count; -1 means unlimited */
  maxApps: number;
}

export interface PlanUsage {
  mediaBytes: number;
  screens: number;
}

export const PLAN_LIMITS: Record<PlanTier, PlanLimits> = {
  evaluation:   { mediaBytes: 100 * 1024 * 1024,         maxScreens: 3,  maxApps: 2 },
  starter:      { mediaBytes: 100 * 1024 * 1024,         maxScreens: 3,  maxApps: 0 },
  business:     { mediaBytes: 500 * 1024 * 1024,         maxScreens: 10, maxApps: 2 },
  professional: { mediaBytes: 1024 * 1024 * 1024,        maxScreens: 30, maxApps: 5 },
  enterprise:   { mediaBytes: 5 * 1024 * 1024 * 1024,    maxScreens: -1, maxApps: -1 },
};

export const PLAN_LABELS: Record<PlanTier, { zh: string; en: string; ja: string }> = {
  evaluation:   { zh: "評估版",   en: "Evaluation",   ja: "評価版" },
  starter:      { zh: "入門版",   en: "Starter",      ja: "スターター" },
  business:     { zh: "商業版",   en: "Business",     ja: "ビジネス" },
  professional: { zh: "專業版",   en: "Professional", ja: "プロフェッショナル" },
  enterprise:   { zh: "企業版",   en: "Enterprise",   ja: "エンタープライズ" },
};

export function formatBytes(bytes: number): string {
  if (bytes < 0) return "∞";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export function useOrgPlan() {
  const { activeOrgId } = useActiveOrg();
  const [tier, setTier] = useState<PlanTier | null>(null);
  const [usage, setUsage] = useState<PlanUsage>({ mediaBytes: 0, screens: 0 });
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!activeOrgId) {
      setTier(null);
      setUsage({ mediaBytes: 0, screens: 0 });
      setLoading(false);
      return;
    }
    setLoading(true);
    const [{ data: org }, { data: media }, { count: screenCount }] = await Promise.all([
      supabase.from("organizations").select("plan_tier").eq("id", activeOrgId).single(),
      supabase.from("media_items").select("size_bytes").eq("org_id", activeOrgId).is("deleted_at", null),
      supabase.from("screens").select("id", { count: "exact", head: true }).eq("org_id", activeOrgId),
    ]);
    setTier((org?.plan_tier as PlanTier) ?? "evaluation");
    const totalBytes = (media || []).reduce(
      (sum: number, m: { size_bytes?: unknown }) => sum + (Number(m.size_bytes) || 0),
      0
    );
    setUsage({ mediaBytes: totalBytes, screens: screenCount ?? 0 });
    setLoading(false);
  }, [activeOrgId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const limits: PlanLimits = tier ? PLAN_LIMITS[tier] : PLAN_LIMITS.evaluation;

  return { tier, limits, usage, loading, refresh };
}
