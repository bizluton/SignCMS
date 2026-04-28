/**
 * Localized labels for activity_logs.category, .action and .detail.
 *
 * Detail templating
 * -----------------
 * Newer rows store `detail` as a JSON string of the form:
 *   {"tpl":"<template_key>","params":{...}}
 * which we render via `localizeDetail` using the DETAIL_TPL table below.
 *
 * Legacy rows that contain plain text (often Chinese) are returned as-is
 * so historical data still reads correctly.
 */
export type Lang = "zh-TW" | "en" | "ja" | string;

type Tri = { zh: string; en: string; ja: string };

const CATEGORY: Record<string, Tri> = {
  admin: { zh: "系統管理", en: "Admin", ja: "管理" },
  auth: { zh: "認證", en: "Auth", ja: "認証" },
  media: { zh: "素材", en: "Media", ja: "メディア" },
  screen: { zh: "螢幕", en: "Screen", ja: "スクリーン" },
  schedule: { zh: "排程", en: "Schedule", ja: "スケジュール" },
  publish: { zh: "發佈", en: "Publish", ja: "公開" },
  security: { zh: "安全", en: "Security", ja: "セキュリティ" },
  user: { zh: "使用者", en: "User", ja: "ユーザー" },
  "customer-service": { zh: "客服", en: "Customer Service", ja: "カスタマーサービス" },
  general: { zh: "一般", en: "General", ja: "一般" },
};

const ACTION: Record<string, Tri> = {
  // English keys (new — preferred)
  delete_user: { zh: "刪除使用者", en: "Delete user", ja: "ユーザー削除" },
  reset_password_email: { zh: "寄送重置密碼信", en: "Send reset email", ja: "リセットメール送信" },
  reset_password_manual: { zh: "設定臨時密碼", en: "Set temporary password", ja: "一時パスワード設定" },
  change_role: { zh: "變更角色", en: "Change role", ja: "ロール変更" },
  sign_in: { zh: "登入", en: "Sign in", ja: "ログイン" },
  sign_out: { zh: "登出", en: "Sign out", ja: "ログアウト" },
  create_team: { zh: "新增團隊", en: "Create team", ja: "チーム作成" },
  edit_team: { zh: "編輯團隊", en: "Edit team", ja: "チーム編集" },
  delete_team: { zh: "刪除團隊", en: "Delete team", ja: "チーム削除" },
  create_org: { zh: "新增組織", en: "Create organization", ja: "組織作成" },
  edit_org: { zh: "編輯組織", en: "Edit organization", ja: "組織編集" },
  delete_org: { zh: "刪除組織", en: "Delete organization", ja: "組織削除" },
  change_org_plan_tier: { zh: "變更方案版本", en: "Change plan tier", ja: "プラン変更" },
  send_invitation: { zh: "發送邀請", en: "Send invitation", ja: "招待送信" },
  resend_invitation: { zh: "重新發送邀請", en: "Resend invitation", ja: "招待再送信" },
  delete_invitation: { zh: "刪除邀請", en: "Delete invitation", ja: "招待削除" },
  invite_cs_agent: { zh: "邀請客服人員", en: "Invite CS agent", ja: "カスタマーサービス担当招待" },
  resend_cs_invitation: { zh: "重新發送客服邀請", en: "Resend CS invitation", ja: "カスタマーサービス招待再送信" },
  remove_cs_agent: { zh: "移除客服人員", en: "Remove CS agent", ja: "カスタマーサービス担当削除" },
  upload_media: { zh: "上傳素材", en: "Upload media", ja: "メディアアップロード" },
  delete_media: { zh: "刪除素材", en: "Delete media", ja: "メディア削除" },
  soft_delete_media: { zh: "移到回收桶", en: "Move to trash", ja: "ゴミ箱へ移動" },
  restore_soft_deleted_media: { zh: "還原已刪除素材", en: "Restore deleted media", ja: "削除済みメディアを復元" },
  purge_soft_deleted_media_item: { zh: "永久刪除素材", en: "Permanently delete media", ja: "メディアを完全削除" },
  media_cleanup_run: { zh: "自動素材清除", en: "Auto media cleanup", ja: "メディア自動クリーンアップ" },
  media_cleanup_purge: { zh: "清空逾期回收桶", en: "Purge expired trash", ja: "期限切れゴミ箱を削除" },
  publish_now: { zh: "立即發佈", en: "Publish now", ja: "即時公開" },
  publish_scheduled: { zh: "排程發佈", en: "Schedule publish", ja: "スケジュール公開" },
  create_schedule: { zh: "新增排程", en: "Create schedule", ja: "スケジュール作成" },
  edit_schedule: { zh: "編輯排程", en: "Edit schedule", ja: "スケジュール編集" },
  delete_schedule: { zh: "刪除排程", en: "Delete schedule", ja: "スケジュール削除" },
  export_schedule: { zh: "匯出排程", en: "Export schedule", ja: "スケジュールエクスポート" },
  export_schedule_usb: { zh: "USB 匯出排程", en: "USB export schedule", ja: "USB スケジュールエクスポート" },
  export_schedule_usb_folder: { zh: "USB 匯出（資料夾）", en: "USB export (folder)", ja: "USB エクスポート（フォルダ）" },
  import_schedule: { zh: "匯入排程", en: "Import schedule", ja: "スケジュールインポート" },
  create_screen: { zh: "新增螢幕", en: "Create screen", ja: "スクリーン作成" },
  edit_screen: { zh: "編輯螢幕", en: "Edit screen", ja: "スクリーン編集" },
  delete_screen: { zh: "刪除螢幕", en: "Delete screen", ja: "スクリーン削除" },
  "delegation.grant": { zh: "授權代理", en: "Grant delegation", ja: "代理権限付与" },
  "delegation.revoke": { zh: "撤銷代理", en: "Revoke delegation", ja: "代理権限取り消し" },
  "delegation.end": { zh: "結束代理", en: "End delegation", ja: "代理を終了" },
  onboarding_create_success: { zh: "建立組織成功", en: "Create organization success", ja: "組織作成成功" },
  onboarding_create_failed: { zh: "建立組織失敗", en: "Create organization failed", ja: "組織作成失敗" },
  onboarding_join_success: { zh: "加入組織成功", en: "Join organization success", ja: "組織参加成功" },
  onboarding_join_failed: { zh: "加入組織失敗", en: "Join organization failed", ja: "組織参加失敗" },
  "system.media_retention_days_changed": {
    zh: "變更回收桶保留天數",
    en: "Change trash retention days",
    ja: "ゴミ箱保持日数を変更",
  },

  // Legacy Chinese-stored actions (kept for historical rows)
  "刪除使用者": { zh: "刪除使用者", en: "Delete user", ja: "ユーザー削除" },
  "刪除邀請": { zh: "刪除邀請", en: "Delete invitation", ja: "招待削除" },
  "新增團隊": { zh: "新增團隊", en: "Create team", ja: "チーム作成" },
  "編輯團隊": { zh: "編輯團隊", en: "Edit team", ja: "チーム編集" },
  "刪除團隊": { zh: "刪除團隊", en: "Delete team", ja: "チーム削除" },
  "新增組織": { zh: "新增組織", en: "Create organization", ja: "組織作成" },
  "編輯組織": { zh: "編輯組織", en: "Edit organization", ja: "組織編集" },
  "刪除組織": { zh: "刪除組織", en: "Delete organization", ja: "組織削除" },
  "發送邀請": { zh: "發送邀請", en: "Send invitation", ja: "招待送信" },
  "變更角色": { zh: "變更角色", en: "Change role", ja: "ロール変更" },
  "重新發送邀請": { zh: "重新發送邀請", en: "Resend invitation", ja: "招待再送信" },
  "重置使用者密碼": { zh: "重置使用者密碼", en: "Reset user password", ja: "ユーザーパスワードリセット" },
  "登入": { zh: "登入", en: "Sign in", ja: "ログイン" },
  "登出": { zh: "登出", en: "Sign out", ja: "ログアウト" },
  "移除客服人員": { zh: "移除客服人員", en: "Remove CS agent", ja: "カスタマーサービス担当削除" },
  "邀請客服人員": { zh: "邀請客服人員", en: "Invite CS agent", ja: "カスタマーサービス担当招待" },
  "重新發送客服邀請": { zh: "重新發送客服邀請", en: "Resend CS invitation", ja: "カスタマーサービス招待再送信" },
  "上傳素材": { zh: "上傳素材", en: "Upload media", ja: "メディアアップロード" },
  "刪除素材": { zh: "刪除素材", en: "Delete media", ja: "メディア削除" },
  "立即發佈": { zh: "立即發佈", en: "Publish now", ja: "即時公開" },
  "排程發佈": { zh: "排程發佈", en: "Schedule publish", ja: "スケジュール公開" },
  "新增排程": { zh: "新增排程", en: "Create schedule", ja: "スケジュール作成" },
  "編輯排程": { zh: "編輯排程", en: "Edit schedule", ja: "スケジュール編集" },
  "刪除排程": { zh: "刪除排程", en: "Delete schedule", ja: "スケジュール削除" },
  "新增螢幕": { zh: "新增螢幕", en: "Create screen", ja: "スクリーン作成" },
  "編輯螢幕": { zh: "編輯螢幕", en: "Edit screen", ja: "スクリーン編集" },
  "刪除螢幕": { zh: "刪除螢幕", en: "Delete screen", ja: "スクリーン削除" },
};

/**
 * Detail templates. `{name}` placeholders are replaced from `params`.
 * Use `{org}` consistently for the optional organization clause.
 */
const DETAIL_TPL: Record<string, Tri> = {
  publish_screens: {
    zh: "{count} 個螢幕",
    en: "{count} screen(s)",
    ja: "{count} 台のスクリーン",
  },
  invitation_org: {
    zh: "組織：{org}",
    en: "Org: {org}",
    ja: "組織：{org}",
  },
  role_change: {
    zh: "→ {role}",
    en: "→ {role}",
    ja: "→ {role}",
  },
  sign_in_email: {
    zh: "{email}",
    en: "{email}",
    ja: "{email}",
  },
  delete_user: {
    zh: "刪除使用者 {email}{orgClause}",
    en: "Delete user {email}{orgClause}",
    ja: "ユーザー削除 {email}{orgClause}",
  },
  reset_password_email: {
    zh: "寄送密碼重置信給 {email}{orgClause}",
    en: "Sent password reset email to {email}{orgClause}",
    ja: "{email} にパスワード再設定メール送信{orgClause}",
  },
  reset_password_manual: {
    zh: "為 {email} 設定臨時密碼{orgClause}",
    en: "Set temporary password for {email}{orgClause}",
    ja: "{email} の一時パスワード設定{orgClause}",
  },
  delegation_grant: {
    zh: "{scope}・到期 {expires_at}",
    en: "{scope} · expires {expires_at}",
    ja: "{scope}・期限 {expires_at}",
  },
  plan_tier_change: {
    zh: "方案版本：{from} → {to}",
    en: "Plan tier: {from} → {to}",
    ja: "プラン：{from} → {to}",
  },
  plan_tier_set: {
    zh: "方案版本：{tier}",
    en: "Plan tier: {tier}",
    ja: "プラン：{tier}",
  },
  schedule_export: {
    zh: "{itemCount} 項目・{mediaCount} 素材・{sizeMB} MB",
    en: "{itemCount} items · {mediaCount} media · {sizeMB} MB",
    ja: "{itemCount} 項目・{mediaCount} メディア・{sizeMB} MB",
  },
  schedule_import: {
    zh: "{itemCount} 項目・{mediaCount} 素材",
    en: "{itemCount} items · {mediaCount} media",
    ja: "{itemCount} 項目・{mediaCount} メディア",
  },
  media_retention_days_change: {
    zh: "保留天數：{old_value} → {new_value} 天",
    en: "Retention days: {old_value} → {new_value} day(s)",
    ja: "保持日数：{old_value} → {new_value} 日",
  },
};

/** "（組織：xxx）" / " (Org: xxx)" / "（組織：xxx）" — empty when no org */
function orgClause(org: string | undefined | null, lang: Lang): string {
  if (!org) return "";
  if (lang.startsWith("en")) return ` (Org: ${org})`;
  if (lang.startsWith("ja")) return `（組織：${org}）`;
  return `（組織：${org}）`;
}

function fmt(tpl: string, params: Record<string, string | number>): string {
  return tpl.replace(/\{(\w+)\}/g, (_, k) => {
    const v = params[k];
    return v === undefined || v === null ? "" : String(v);
  });
}

function pick(t: Tri | undefined, lang: Lang, fallback: string): string {
  if (!t) return fallback;
  if (lang.startsWith("ja")) return t.ja;
  if (lang.startsWith("en")) return t.en;
  return t.zh;
}

export function localizeCategory(category: string, lang: Lang): string {
  return pick(CATEGORY[category], lang, category);
}

export function localizeAction(action: string, lang: Lang): string {
  return pick(ACTION[action], lang, action);
}

const PLAN_TIER: Record<string, Tri> = {
  evaluation: { zh: "評估版", en: "Evaluation", ja: "評価版" },
  starter: { zh: "入門版", en: "Starter", ja: "スターター" },
  business: { zh: "商業版", en: "Business", ja: "ビジネス" },
  professional: { zh: "專業版", en: "Professional", ja: "プロフェッショナル" },
  enterprise: { zh: "企業版", en: "Enterprise", ja: "エンタープライズ" },
};

export function localizePlanTier(tier: string, lang: Lang): string {
  return pick(PLAN_TIER[tier], lang, tier);
}

/**
 * Render a detail JSONB object `{ tpl, params }` or `{ text }` in the given lang.
 * Returns "" when the value is empty.
 */
export function localizeDetailJson(value: unknown, lang: Lang): string {
  if (!value || typeof value !== "object") return "";
  const obj = value as Record<string, unknown>;
  // Legacy plain-text wrapper
  if (typeof obj.text === "string" && !obj.tpl) return obj.text;
  if (typeof obj.tpl !== "string") return "";
  const tpl = DETAIL_TPL[obj.tpl];
  if (!tpl) return "";
  const params: Record<string, string | number> = { ...(obj.params as Record<string, string | number> || {}) };
  if (typeof params.org === "string") params.orgClause = orgClause(params.org as string, lang);
  else if (params.orgClause === undefined) params.orgClause = "";
  for (const key of ["from", "to", "tier"]) {
    if (typeof params[key] === "string" && PLAN_TIER[params[key] as string]) {
      params[key] = localizePlanTier(params[key] as string, lang);
    }
  }
  return fmt(pick(tpl, lang, tpl.zh), params);
}

/**
 * Localize a stored `detail` value (LEGACY text column).
 * - If it's a JSON `{tpl, params}`, render the template in the requested lang.
 * - Otherwise return the raw string (legacy plain-text rows).
 *
 * @deprecated Prefer reading `detail_json` and calling `localizeDetailJson`.
 */
export function localizeDetail(detail: string | null | undefined, lang: Lang): string {
  if (!detail) return "";
  const trimmed = detail.trim();
  if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) return detail;
  let parsed: any;
  try { parsed = JSON.parse(trimmed); } catch { return detail; }
  if (!parsed || typeof parsed !== "object" || typeof parsed.tpl !== "string") return detail;
  const tpl = DETAIL_TPL[parsed.tpl];
  if (!tpl) return detail;
  const params = { ...(parsed.params || {}) };
  // Auto-derive {orgClause} from {org} for templates that use it.
  if (typeof params.org === "string") {
    params.orgClause = orgClause(params.org, lang);
  } else if (params.orgClause === undefined) {
    params.orgClause = "";
  }
  // Auto-localize plan tier params for plan_tier_change / plan_tier_set
  for (const key of ["from", "to", "tier"]) {
    if (typeof params[key] === "string" && PLAN_TIER[params[key]]) {
      params[key] = localizePlanTier(params[key], lang);
    }
  }
  return fmt(pick(tpl, lang, tpl.zh), params);
}

/**
 * Helper for callers — build a detail JSON string ready to store.
 * Usage:  detail: buildDetail("publish_screens", { count: 3 })
 */
export function buildDetail(tpl: keyof typeof DETAIL_TPL | string, params: Record<string, string | number> = {}): string {
  return JSON.stringify({ tpl, params });
}

/**
 * --- Catalog introspection (used by the Audit Catalog dialog) ---
 *
 * Exposes every registered category / action / detail-template so admins can
 * see at a glance which event codes have i18n templates wired up and which
 * placeholders each detail template expects.
 */
export interface ActivityCatalogEntry {
  /** Stable identifier (English action key, plan tier code, category key, …) */
  code: string;
  /** Localized labels per language (empty string when missing) */
  labels: Tri;
  /** True iff every language slot has a non-empty label */
  hasAllLangs: boolean;
}

export interface ActivityDetailTplEntry extends ActivityCatalogEntry {
  /** Placeholder names parsed from the zh template (e.g. `count`, `email`) */
  params: string[];
  /** Action codes that resolve to this template via ACTION_CODE_TO_DETAIL_TPL */
  linkedActionCodes: string[];
}

const collectKeys = (tpl: string): string[] => {
  const out = new Set<string>();
  tpl.replace(/\{(\w+)\}/g, (_, k) => { out.add(k); return ""; });
  return Array.from(out);
};

const isComplete = (t: Tri): boolean => Boolean(t.zh && t.en && t.ja);

const toEntry = (code: string, t: Tri): ActivityCatalogEntry => ({
  code,
  labels: { zh: t.zh ?? "", en: t.en ?? "", ja: t.ja ?? "" },
  hasAllLangs: isComplete(t),
});

export interface ActivityCatalog {
  categories: ActivityCatalogEntry[];
  actions: ActivityCatalogEntry[];
  planTiers: ActivityCatalogEntry[];
  detailTemplates: ActivityDetailTplEntry[];
  /** Reverse map: action_code → detail tpl key (only entries that override) */
  actionToDetailTpl: Record<string, string>;
}

export function getActivityCatalog(): ActivityCatalog {
  const categories = Object.entries(CATEGORY).map(([k, v]) => toEntry(k, v));
  const actions = Object.entries(ACTION).map(([k, v]) => toEntry(k, v));
  const planTiers = Object.entries(PLAN_TIER).map(([k, v]) => toEntry(k, v));

  // Reverse the static action→tpl map so each detail template lists which
  // action codes drive it (defaults to the same code when not overridden).
  const reverse: Record<string, string[]> = {};
  for (const [action, tpl] of Object.entries(ACTION_CODE_TO_DETAIL_TPL)) {
    (reverse[tpl] ||= []).push(action);
  }

  const detailTemplates: ActivityDetailTplEntry[] = Object.entries(DETAIL_TPL).map(
    ([k, v]) => ({
      ...toEntry(k, v),
      params: collectKeys(v.zh),
      linkedActionCodes: reverse[k] ? [...reverse[k]].sort() : [],
    })
  );

  return {
    categories: categories.sort((a, b) => a.code.localeCompare(b.code)),
    actions: actions.sort((a, b) => a.code.localeCompare(b.code)),
    planTiers,
    detailTemplates: detailTemplates.sort((a, b) => a.code.localeCompare(b.code)),
    actionToDetailTpl: { ...ACTION_CODE_TO_DETAIL_TPL },
  };
}

/**
 * Map from action_code → detail template key. When a row has `action_code` +
 * `action_params` but the detail template name differs from the action code,
 * declare the mapping here. Falls back to the action code itself.
 */
const ACTION_CODE_TO_DETAIL_TPL: Record<string, string> = {
  sign_in: "sign_in_email",
  send_invitation: "invitation_org",
  resend_invitation: "invitation_org",
  change_role: "role_change",
  publish_now: "publish_screens",
  publish_scheduled: "publish_screens",
  create_org: "plan_tier_set",
  change_org_plan_tier: "plan_tier_change",
  "delegation.grant": "delegation_grant",
  export_schedule: "schedule_export",
  export_schedule_usb: "schedule_export",
  export_schedule_usb_folder: "schedule_export",
  import_schedule: "schedule_import",
  "system.media_retention_days_changed": "media_retention_days_change",
};

/**
 * Render a structured activity log row using `action_code` + `action_params`.
 * Falls back to legacy `detail` rendering when the new fields are absent.
 */
export function localizeActivityDetail(
  row: { action_code?: string | null; action_params?: unknown; detail?: string | null; detail_json?: unknown },
  lang: Lang
): string {
  const code = row.action_code;
  const params = row.action_params as Record<string, unknown> | null | undefined;
  if (code && params && typeof params === "object" && Object.keys(params).length > 0) {
    const tplKey = ACTION_CODE_TO_DETAIL_TPL[code] || code;
    const tpl = DETAIL_TPL[tplKey];
    if (tpl) {
      const merged: Record<string, string | number> = { ...(params as Record<string, string | number>) };
      if (typeof merged.org === "string") merged.orgClause = orgClause(merged.org as string, lang);
      else if (merged.orgClause === undefined) merged.orgClause = "";
      for (const key of ["from", "to", "tier"]) {
        if (typeof merged[key] === "string" && PLAN_TIER[merged[key] as string]) {
          merged[key] = localizePlanTier(merged[key] as string, lang);
        }
      }
      return fmt(pick(tpl, lang, tpl.zh), merged);
    }
  }
  // Prefer new jsonb column when present
  if (row.detail_json && typeof row.detail_json === "object") {
    const rendered = localizeDetailJson(row.detail_json, lang);
    if (rendered) return rendered;
  }
  // Fallback: legacy `detail` text column
  return localizeDetail(row.detail, lang);
}
