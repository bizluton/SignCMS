export interface ActivityLog {
  id: string;
  action: string;
  /** New: stable short code (mirrors `action`). Optional for legacy rows. */
  action_code?: string | null;
  /** New: structured params (jsonb). May be `{}` or any JSON shape for legacy rows. */
  action_params?: unknown;
  category: string;
  target_name: string | null;
  target_id?: string | null;
  target_type?: string | null;
  ip_address?: string | null;
  org_id?: string | null;
  /** Legacy text detail. Kept for backward compat with old rows; new rows should use `detail_json`. */
  detail: string | null;
  /** Structured detail (jsonb). Preferred over `detail`. Shape: `{ tpl, params }` or `{ text }` for legacy plain. */
  detail_json?: unknown;
  created_at: string;
  user_id: string;
  display_name?: string;
}

export const ACTIVITY_LOG_PAGE_SIZE = 50;
