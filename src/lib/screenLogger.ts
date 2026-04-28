import { supabase } from "@/integrations/supabase/client";

export type ScreenLogEventType = "status" | "config" | "schedule" | "system";

interface LogScreenEventParams {
  screenId: string;
  orgId: string;
  eventType: ScreenLogEventType;
  /** Structured event code (preferred) — rendered via renderScreenLog */
  eventCode?: string;
  /** Structured params filled into the event template */
  eventParams?: Record<string, unknown>;
  /** Legacy plain-text title — still written for back-compat / search */
  eventTitle: string;
  /** Legacy plain-text detail — still written for back-compat / search */
  eventDetail?: string;
}

/**
 * Insert a screen_logs row. Silent failure - never blocks user operations.
 */
export async function logScreenEvent(params: LogScreenEventParams) {
  try {
    if (!params.screenId || !params.orgId) return;
    const { data: { user } } = await supabase.auth.getUser();
    await (supabase as any).from("screen_logs").insert({
      screen_id: params.screenId,
      org_id: params.orgId,
      event_type: params.eventType,
      event_code: params.eventCode ?? null,
      event_params: params.eventParams ?? {},
      event_title: params.eventTitle,
      event_detail: params.eventDetail || "",
      created_by: user?.id || null,
    });
  } catch {
    // silent
  }
}

/**
 * Bulk insert screen_logs rows. Useful for publish/emergency broadcast across many screens.
 */
export async function logScreenEvents(rows: Array<LogScreenEventParams>) {
  try {
    const valid = rows.filter((r) => r.screenId && r.orgId);
    if (valid.length === 0) return;
    const { data: { user } } = await supabase.auth.getUser();
    const payload = valid.map((r) => ({
      screen_id: r.screenId,
      org_id: r.orgId,
      event_type: r.eventType,
      event_code: r.eventCode ?? null,
      event_params: r.eventParams ?? {},
      event_title: r.eventTitle,
      event_detail: r.eventDetail || "",
      created_by: user?.id || null,
    }));
    await (supabase as any).from("screen_logs").insert(payload);
  } catch {
    // silent
  }
}
