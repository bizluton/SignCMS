import { supabase } from "@/integrations/supabase/client";
import { buildDetail } from "@/lib/activityLogI18n";

interface LogActivityParams {
  /**
   * Stable short code, e.g. "delete_user", "delegation.grant".
   * Used both as legacy `action` text and as the new `action_code`.
   */
  action: string;
  category: "auth" | "screen" | "media" | "schedule" | "publish" | "admin" | "studio" | "customer-service";
  targetType?: string;
  targetId?: string;
  targetName?: string;
  /**
   * Either:
   *  - a plain string (legacy, will be stored as-is in `detail`), or
   *  - a `{ tpl, params }` JSON string from `buildDetail(...)` (legacy path), or
   *  - omitted entirely when you provide `actionParams` instead.
   */
  detail?: string;
  /**
   * NEW: structured params for i18n rendering, stored in `action_params jsonb`.
   * When provided, the row is rendered through the action_code template at
   * display time and `detail` may be omitted.
   */
  actionParams?: Record<string, string | number | boolean | null>;
  orgId?: string | null;
}

let cachedIp: string | null = null;

async function getClientIp(): Promise<string> {
  if (cachedIp) return cachedIp;
  try {
    const res = await fetch("https://api.ipify.org?format=json");
    const data = await res.json();
    cachedIp = data.ip || "";
    return cachedIp;
  } catch {
    return "";
  }
}

export async function logActivity(params: LogActivityParams) {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const ip = await getClientIp();

    // Back-compat: if no explicit detail but actionParams present, also keep
    // legacy `detail` populated as a JSON tpl envelope keyed by action code.
    let legacyDetail = params.detail || "";
    if (!legacyDetail && params.actionParams) {
      legacyDetail = buildDetail(params.action, params.actionParams as Record<string, string | number>);
    }

    // New jsonb column: structured form preferred. If only plain detail string
    // is provided, wrap it as { text } for forward compat.
    let detailJson: Record<string, unknown> | null = null;
    if (params.actionParams && Object.keys(params.actionParams).length > 0) {
      detailJson = { tpl: params.action, params: params.actionParams };
    } else if (params.detail) {
      const trimmed = params.detail.trim();
      if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
        try { detailJson = JSON.parse(trimmed); } catch { detailJson = { text: params.detail }; }
      } else {
        detailJson = { text: params.detail };
      }
    }

    await (supabase as any).from("activity_logs").insert({
      user_id: user.id,
      action: params.action,
      action_code: params.action,
      action_params: params.actionParams || {},
      category: params.category,
      target_type: params.targetType || "",
      target_id: params.targetId || "",
      target_name: params.targetName || "",
      detail: legacyDetail,
      detail_json: detailJson,
      org_id: params.orgId || null,
      ip_address: ip,
    });
  } catch {
    // Silent fail - logging should never block user operations
  }
}
