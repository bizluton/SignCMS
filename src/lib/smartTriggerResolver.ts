import { supabase } from "@/integrations/supabase/client";

/**
 * Resolve effective Smart Trigger rules for a given screen.
 * Effective set = (org rules NOT disabled by per-screen override) UNION (screen-specific rules linked to the screen).
 * Optionally filter by trigger_source/trigger_key.
 */
export interface ResolveOptions {
  orgId: string;
  screenId?: string | null;
  triggerSource?: string;
  triggerKey?: string;
  onlyEnabled?: boolean;
}

export async function resolveScreenSmartTriggerRules(opts: ResolveOptions) {
  const { orgId, screenId = null, triggerSource, triggerKey, onlyEnabled = true } = opts;

  let orgQuery: any = (supabase as any)
    .from("smart_trigger_rules")
    .select("*")
    .eq("org_id", orgId)
    .eq("scope", "org");
  if (onlyEnabled) orgQuery = orgQuery.eq("enabled", true);
  if (triggerSource) orgQuery = orgQuery.eq("trigger_source", triggerSource);
  if (triggerKey) orgQuery = orgQuery.eq("trigger_key", triggerKey);

  const screenLinkPromise = screenId
    ? (supabase as any)
        .from("screen_smart_trigger_rules")
        .select("smart_trigger_rules(*)")
        .eq("screen_id", screenId)
    : Promise.resolve({ data: [], error: null });

  const overridesPromise = screenId
    ? (supabase as any)
        .from("screen_smart_trigger_overrides")
        .select("rule_id, enabled")
        .eq("screen_id", screenId)
    : Promise.resolve({ data: [], error: null });

  const [orgRes, linkRes, ovrRes] = await Promise.all([orgQuery, screenLinkPromise, overridesPromise]);
  if (orgRes.error) throw orgRes.error;
  if (linkRes.error) throw linkRes.error;
  if (ovrRes.error) throw ovrRes.error;

  const overrideMap = new Map<string, boolean>();
  for (const o of (ovrRes.data || []) as any[]) overrideMap.set(o.rule_id, o.enabled);

  const orgRules = ((orgRes.data || []) as any[]).filter((r) => {
    const ov = overrideMap.get(r.id);
    return ov === undefined ? true : ov === true;
  });

  const screenRules = ((linkRes.data || []) as any[])
    .map((row: any) => row.smart_trigger_rules)
    .filter((r: any) => {
      if (!r) return false;
      if (onlyEnabled && !r.enabled) return false;
      if (triggerSource && r.trigger_source !== triggerSource) return false;
      if (triggerKey && r.trigger_key !== triggerKey) return false;
      return true;
    });

  // Union, dedupe by id, sort by priority desc then created_at asc
  const seen = new Set<string>();
  const merged: any[] = [];
  for (const r of [...screenRules, ...orgRules]) {
    if (seen.has(r.id)) continue;
    seen.add(r.id);
    merged.push(r);
  }
  merged.sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0) ||
    String(a.created_at).localeCompare(String(b.created_at)));

  return merged;
}