// Smart Trigger Webhook - public endpoint for IoT/external systems
// Resolves effective rules for a screen as:
//   (org rules NOT disabled by per-screen override) UNION (screen-specific rules linked to the screen)
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

// ─── Module-level rule cache ────────────────────────────────────────────────
// Deno isolate instances handle multiple requests, so module-level Maps persist
// across calls within the same instance.  TTL of 5 minutes means a rule change
// takes at most 5 min to propagate — acceptable for IoT digital-signage triggers.
// The cache is keyed independently for token verification, rules, and overrides
// so a cache miss on one doesn't invalidate the others.
const CACHE_TTL_MS = 5 * 60 * 1000;

interface CacheEntry<T> { data: T; ts: number }
function isFresh<T>(e: CacheEntry<T> | undefined): e is CacheEntry<T> {
  return !!e && Date.now() - e.ts < CACHE_TTL_MS;
}

// org_id → { webhook_token }
const orgTokenCache = new Map<string, CacheEntry<string>>();
// `${orgId}:${trigger_source}:${trigger_key}` → rule rows
const orgRulesCache = new Map<string, CacheEntry<any[]>>();
// screen_id → linked rule rows
const screenRulesCache = new Map<string, CacheEntry<any[]>>();
// screen_id → override rows
const overridesCache = new Map<string, CacheEntry<any[]>>();

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-webhook-token, x-debug-id",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Expose-Headers": "x-debug-id",
};

interface WebhookBody {
  org_id: string;
  screen_id?: string | null;        // optional - if omitted, only org-scope rules without per-screen override apply
  trigger_source: "gpio" | "remote" | "api" | "iot_sensor" | "webhook" | "schedule";
  trigger_key?: string;
  payload?: Record<string, unknown>;
  /** Optional caller-supplied debug id for end-to-end tracing. If absent the server generates one. */
  debug_id?: string;
}

function evalCondition(cond: any, payload: Record<string, unknown> | undefined): boolean {
  if (!cond || typeof cond !== "object" || Object.keys(cond).length === 0) return true;
  if (!payload) return false;
  // Supported simple shape: { field: "x.y", op: "gt"|"gte"|"lt"|"lte"|"eq", value: number|string }
  const field: string | undefined = cond.field;
  const op: string | undefined = cond.op;
  const expected = cond.value;
  if (!field || !op) return true;
  const parts = field.split(".");
  let v: any = payload;
  for (const p of parts) { if (v == null) return false; v = v[p]; }
  if (v === undefined || v === null) return false;
  switch (op) {
    case "eq": return v == expected;
    case "gt": return Number(v) > Number(expected);
    case "gte": return Number(v) >= Number(expected);
    case "lt": return Number(v) < Number(expected);
    case "lte": return Number(v) <= Number(expected);
    default: return false;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  let body: WebhookBody;
  try { body = await req.json(); } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // ===== Debug ID =====
  // End-to-end trace id correlating the inbound request, the matched-rule logs
  // written to `smart_trigger_logs`, and the player's override application.
  // Accept caller-supplied id from header or body for already-instrumented
  // callers; otherwise generate one server-side.
  const incomingDebugId = (
    req.headers.get("x-debug-id") || req.headers.get("X-Debug-Id") || ""
  ).trim();
  const sanitize = (s: string) => s.replace(/[^A-Za-z0-9_\-:.]/g, "").slice(0, 64);
  const debugId = sanitize(incomingDebugId)
    || sanitize(typeof body.debug_id === "string" ? body.debug_id : "")
    || `stw_${Date.now().toString(36)}_${crypto.randomUUID().split("-")[0]}`;
  // Embed in every response so callers can grep both sides.
  const responseHeaders = { ...corsHeaders, "Content-Type": "application/json", "X-Debug-Id": debugId };
  const debugTag = `[smart-trigger-webhook][debug_id=${debugId}]`;
  console.log(`${debugTag} request received`, {
    org_id: body.org_id,
    screen_id: body.screen_id ?? null,
    trigger_source: body.trigger_source,
    trigger_key: body.trigger_key ?? "",
  });

  if (!body.org_id || !body.trigger_source) {
    return new Response(JSON.stringify({ error: "org_id and trigger_source are required" }), {
      status: 400, headers: responseHeaders,
    });
  }

  // Schema validation: org_id must be a UUID; screen_id, when present, must
  // be either null or a UUID. We reject empty strings / malformed values
  // early so cooldown scoping by screen_id is unambiguous.
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (typeof body.org_id !== "string" || !UUID_RE.test(body.org_id)) {
    return new Response(JSON.stringify({
      error: "invalid_org_id",
      message: "org_id must be a valid UUID.",
    }), {
      status: 400, headers: responseHeaders,
    });
  }
  if (body.screen_id !== undefined && body.screen_id !== null) {
    if (typeof body.screen_id !== "string" || !UUID_RE.test(body.screen_id)) {
      return new Response(JSON.stringify({
        error: "invalid_screen_id",
        message: "screen_id, when provided, must be a valid UUID or null.",
      }), {
        status: 400, headers: responseHeaders,
      });
    }
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // ===== Per-org API token authentication =====
  // Token must be provided via X-Webhook-Token header.
  // (Authorization header is reserved for the Supabase Gateway anon/JWT key.)
  const providedToken = (
    req.headers.get("x-webhook-token") || req.headers.get("X-Webhook-Token") || ""
  ).trim();

  if (!providedToken) {
    return new Response(JSON.stringify({
      error: "missing_webhook_token",
      message: "Webhook token required. Provide via 'X-Webhook-Token: <token>' header.",
    }), {
      status: 401, headers: responseHeaders,
    });
  }

  // Look up org and verify token matches (cached for CACHE_TTL_MS)
  let storedToken: string;
  const cachedToken = orgTokenCache.get(body.org_id);
  if (isFresh(cachedToken)) {
    storedToken = cachedToken.data;
  } else {
    const { data: orgRow, error: orgErr } = await supabase
      .from("organizations")
      .select("id, webhook_token")
      .eq("id", body.org_id)
      .maybeSingle();

    if (orgErr) {
      return new Response(JSON.stringify({
        error: "org_lookup_failed",
        message: orgErr.message,
      }), {
        status: 500, headers: responseHeaders,
      });
    }

    if (!orgRow) {
      return new Response(JSON.stringify({
        error: "org_not_found",
        message: `Organization '${body.org_id}' does not exist.`,
      }), {
        status: 404, headers: responseHeaders,
      });
    }

    storedToken = orgRow.webhook_token || "";
    orgTokenCache.set(body.org_id, { data: storedToken, ts: Date.now() });
  }

  // Constant-time comparison to mitigate timing attacks
  const a = providedToken;
  const b = storedToken;
  let mismatch = a.length !== b.length ? 1 : 0;
  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i++) {
    mismatch |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  }
  if (mismatch !== 0) {
    // Evict the cached token so a freshly-rotated token works on the next request.
    orgTokenCache.delete(body.org_id);
    // Best-effort audit log of failed auth
    try {
      await supabase.from("smart_trigger_logs").insert({
        org_id: body.org_id,
        screen_id: body.screen_id ?? null,
        trigger_source: body.trigger_source,
        trigger_key: body.trigger_key ?? "",
        trigger_payload: body.payload ?? {},
        success: false,
        error_message: "invalid_webhook_token",
        debug_id: debugId,
      });
    } catch { /* swallow */ }
    return new Response(JSON.stringify({
      error: "invalid_webhook_token",
      message: "The provided webhook token does not match this organization. Regenerate via the Publishing Center → Smart Triggers settings.",
      debug_id: debugId,
    }), {
      status: 403, headers: responseHeaders,
    });
  }
  // ===== End auth =====

  try {
    // 1) Org-scope rules for this org/source/key (cached)
    const orgRulesKey = `${body.org_id}:${body.trigger_source}:${body.trigger_key ?? ""}`;
    let orgRules_data: any[];
    const cachedOrgRules = orgRulesCache.get(orgRulesKey);
    if (isFresh(cachedOrgRules)) {
      orgRules_data = cachedOrgRules.data;
    } else {
      const orgQuery = supabase
        .from("smart_trigger_rules")
        .select("*")
        .eq("org_id", body.org_id)
        .eq("scope", "org")
        .eq("trigger_source", body.trigger_source)
        .eq("enabled", true);
      if (body.trigger_key) orgQuery.eq("trigger_key", body.trigger_key);
      const orgRes = await orgQuery;
      if (orgRes.error) throw orgRes.error;
      orgRules_data = orgRes.data || [];
      orgRulesCache.set(orgRulesKey, { data: orgRules_data, ts: Date.now() });
    }

    // 2) Screen-specific linked rules (cached per screenId)
    let screenLink_data: any[];
    if (body.screen_id) {
      const cachedLink = screenRulesCache.get(body.screen_id);
      if (isFresh(cachedLink)) {
        screenLink_data = cachedLink.data;
      } else {
        const linkRes = await supabase
          .from("screen_smart_trigger_rules")
          .select("smart_trigger_rules(*)")
          .eq("screen_id", body.screen_id);
        if (linkRes.error) throw linkRes.error;
        screenLink_data = linkRes.data || [];
        screenRulesCache.set(body.screen_id, { data: screenLink_data, ts: Date.now() });
      }
    } else {
      screenLink_data = [];
    }

    // 3) Per-screen overrides (cached per screenId)
    let overrides_data: any[];
    if (body.screen_id) {
      const cachedOvr = overridesCache.get(body.screen_id);
      if (isFresh(cachedOvr)) {
        overrides_data = cachedOvr.data;
      } else {
        const ovrRes = await supabase
          .from("screen_smart_trigger_overrides")
          .select("rule_id, enabled")
          .eq("screen_id", body.screen_id);
        if (ovrRes.error) throw ovrRes.error;
        overrides_data = ovrRes.data || [];
        overridesCache.set(body.screen_id, { data: overrides_data, ts: Date.now() });
      }
    } else {
      overrides_data = [];
    }

    // Build override map: rule_id -> enabled
    const overrideMap = new Map<string, boolean>();
    for (const o of overrides_data as any[]) overrideMap.set(o.rule_id, o.enabled);

    // Org rules NOT disabled by per-screen override
    const orgRules = (orgRules_data as any[]).filter((r) => {
      const ov = overrideMap.get(r.id);
      return ov === undefined ? true : ov === true;
    });

    // Screen-specific rules: filter by source/key/enabled
    const screenRules = (screenLink_data as any[])
      .map((row) => row.smart_trigger_rules)
      .filter((r) => r && r.enabled && r.trigger_source === body.trigger_source &&
        (!body.trigger_key || r.trigger_key === body.trigger_key));

    // Union (dedupe by id) and apply trigger_condition evaluation
    const seen = new Set<string>();
    const candidates: any[] = [];
    for (const r of [...screenRules, ...orgRules]) {
      if (seen.has(r.id)) continue;
      seen.add(r.id);
      if (evalCondition(r.trigger_condition, body.payload)) candidates.push(r);
    }

    // Sort by priority desc, then created_at asc
    candidates.sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0) ||
      String(a.created_at).localeCompare(String(b.created_at)));

    // ===== Cooldown enforcement =====
    // For each candidate, check the most recent successful firing of the same
    // rule (scoped to the same screen when provided). If the elapsed time is
    // less than rule.cooldown_seconds, skip the rule and write a
    // `cooldown_active` log entry instead of firing it again.
    const fired: any[] = [];
    const skipped: Array<{ rule: any; remaining_seconds: number; last_fired_at: string }> = [];

    await Promise.all(candidates.map(async (r) => {
      const cooldown = Number(r.cooldown_seconds ?? 0);
      if (!cooldown || cooldown <= 0) {
        fired.push(r);
        return;
      }
      const sinceIso = new Date(Date.now() - cooldown * 1000).toISOString();
      let q = supabase
        .from("smart_trigger_logs")
        .select("created_at")
        .eq("rule_id", r.id)
        .eq("success", true)
        .gte("created_at", sinceIso)
        .order("created_at", { ascending: false })
        .limit(1);
      // Scope cooldown by screen when one was provided so different screens
      // don't block each other for the same shared rule.
      if (body.screen_id) q = q.eq("screen_id", body.screen_id);
      const { data: recent, error: recentErr } = await q.maybeSingle();
      if (recentErr) {
        // On lookup failure, fail open and allow the rule to fire (we'd rather
        // double-fire than swallow a legitimate trigger silently).
        fired.push(r);
        return;
      }
      if (recent?.created_at) {
        const last = new Date(recent.created_at).getTime();
        const remaining = Math.max(0, Math.ceil((last + cooldown * 1000 - Date.now()) / 1000));
        skipped.push({ rule: r, remaining_seconds: remaining, last_fired_at: recent.created_at });
      } else {
        fired.push(r);
      }
    }));

    // Log fired rules
    const logRows = fired.map((r) => ({
      org_id: body.org_id,
      rule_id: r.id,
      screen_id: body.screen_id ?? null,
      trigger_source: body.trigger_source,
      trigger_key: body.trigger_key ?? "",
      trigger_payload: body.payload ?? {},
      success: true,
      debug_id: debugId,
    }));
    if (logRows.length > 0) {
      await supabase.from("smart_trigger_logs").insert(logRows);
      console.log(`${debugTag} fired ${logRows.length} rule(s)`, fired.map((r) => ({ id: r.id, name: r.name })));
    }

    // Log cooldown skips (success=false, error_message=cooldown_active)
    if (skipped.length > 0) {
      const skipRows = skipped.map(({ rule, remaining_seconds, last_fired_at }) => ({
        org_id: body.org_id,
        rule_id: rule.id,
        screen_id: body.screen_id ?? null,
        trigger_source: body.trigger_source,
        trigger_key: body.trigger_key ?? "",
        trigger_payload: {
          ...(body.payload ?? {}),
          _cooldown: {
            cooldown_seconds: Number(rule.cooldown_seconds ?? 0),
            remaining_seconds,
            last_fired_at,
          },
        },
        success: false,
        error_message: `cooldown_active: ${remaining_seconds}s remaining`,
        debug_id: debugId,
      }));
      await supabase.from("smart_trigger_logs").insert(skipRows);
      console.log(`${debugTag} skipped ${skipRows.length} rule(s) due to cooldown`);
    }

    if (logRows.length === 0 && skipped.length === 0) {
      // Log a no-match attempt for audit/debug
      await supabase.from("smart_trigger_logs").insert({
        org_id: body.org_id,
        screen_id: body.screen_id ?? null,
        trigger_source: body.trigger_source,
        trigger_key: body.trigger_key ?? "",
        trigger_payload: body.payload ?? {},
        success: false,
        error_message: "no_matching_rule",
        debug_id: debugId,
      });
      console.log(`${debugTag} no matching rule`);
    }

    return new Response(JSON.stringify({
      debug_id: debugId,
      matched_count: fired.length,
      skipped_count: skipped.length,
      matched_rules: fired.map((r) => ({
        id: r.id, name: r.name, scope: r.scope,
        target_design_project_id: r.target_design_project_id,
        duration_seconds: r.duration_seconds,
        restore_behavior: r.restore_behavior,
        restore_channel_id: r.restore_channel_id,
        cooldown_seconds: r.cooldown_seconds,
        priority: r.priority,
      })),
      skipped_rules: skipped.map(({ rule, remaining_seconds, last_fired_at }) => ({
        id: rule.id,
        name: rule.name,
        reason: "cooldown_active",
        cooldown_seconds: Number(rule.cooldown_seconds ?? 0),
        remaining_seconds,
        last_fired_at,
      })),
    }), {
      status: 200, headers: responseHeaders,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    // Best-effort failure log
    try {
      await supabase.from("smart_trigger_logs").insert({
        org_id: body.org_id,
        screen_id: body.screen_id ?? null,
        trigger_source: body.trigger_source,
        trigger_key: body.trigger_key ?? "",
        trigger_payload: body.payload ?? {},
        success: false,
        error_message: msg.slice(0, 500),
        debug_id: debugId,
      });
    } catch { /* swallow */ }
    console.error(`${debugTag} unhandled error`, msg);
    return new Response(JSON.stringify({ error: msg, debug_id: debugId }), {
      status: 500, headers: responseHeaders,
    });
  }
});