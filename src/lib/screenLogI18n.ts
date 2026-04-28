// Centralised i18n catalogue for structured screen_logs entries.
// Each event_code maps to a {title, detail} template per language.
// Detail templates use `{paramName}` placeholders that are filled
// from the row's event_params jsonb at render time.

import type { Language } from "@/contexts/LanguageContext";

type LangMap = Record<Language, string>;

interface EventTemplate {
  title: LangMap;
  detail?: LangMap; // optional; some events have no detail
}

const EVENTS: Record<string, EventTemplate> = {
  // ---- Schedule ----
  "schedule.created": {
    title: { zh: "排程已建立", en: "Schedule created", ja: "スケジュールを作成" },
    detail: {
      zh: "名稱：{name}｜時段：{startTime}-{endTime}｜項目數：{itemCount}",
      en: "Name: {name} | Time: {startTime}-{endTime} | Items: {itemCount}",
      ja: "名前：{name}｜時間：{startTime}-{endTime}｜項目数：{itemCount}",
    },
  },
  "schedule.updated": {
    title: { zh: "排程已更新", en: "Schedule updated", ja: "スケジュールを更新" },
    detail: {
      zh: "名稱：{name}｜時段：{startTime}-{endTime}｜項目數：{itemCount}",
      en: "Name: {name} | Time: {startTime}-{endTime} | Items: {itemCount}",
      ja: "名前：{name}｜時間：{startTime}-{endTime}｜項目数：{itemCount}",
    },
  },
  "schedule.deleted": {
    title: { zh: "排程已刪除", en: "Schedule deleted", ja: "スケジュールを削除" },
    detail: {
      zh: "名稱：{name}",
      en: "Name: {name}",
      ja: "名前：{name}",
    },
  },
  "schedule.enabled": {
    title: { zh: "排程已啟用", en: "Schedule enabled", ja: "スケジュールを有効化" },
    detail: { zh: "名稱：{name}", en: "Name: {name}", ja: "名前：{name}" },
  },
  "schedule.disabled": {
    title: { zh: "排程已停用", en: "Schedule disabled", ja: "スケジュールを無効化" },
    detail: { zh: "名稱：{name}", en: "Name: {name}", ja: "名前：{name}" },
  },
  "schedule.published_now": {
    title: { zh: "排程立即下發", en: "Schedule published now", ja: "スケジュールを即時配信" },
    detail: {
      zh: "播放清單：{scheduleName}｜立即下發",
      en: "Playlist: {scheduleName} | Immediate",
      ja: "プレイリスト：{scheduleName}｜即時配信",
    },
  },
  "schedule.published_scheduled": {
    title: { zh: "排程已預約下發", en: "Schedule queued", ja: "スケジュール予約配信" },
    detail: {
      zh: "播放清單：{scheduleName}｜預約：{scheduledAt}",
      en: "Playlist: {scheduleName} | Scheduled: {scheduledAt}",
      ja: "プレイリスト：{scheduleName}｜予約：{scheduledAt}",
    },
  },

  // ---- Screen ----
  "screen.created": {
    title: { zh: "螢幕已建立", en: "Screen created", ja: "スクリーンを作成" },
    detail: {
      zh: "名稱：{name}｜分組：{branch}",
      en: "Name: {name} | Group: {branch}",
      ja: "名前：{name}｜グループ：{branch}",
    },
  },
  "screen.deleted": {
    title: { zh: "螢幕已刪除", en: "Screen deleted", ja: "スクリーンを削除" },
    detail: { zh: "名稱：{name}", en: "Name: {name}", ja: "名前：{name}" },
  },
  "screen.config_updated": {
    title: { zh: "設定更新", en: "Settings updated", ja: "設定を更新" },
    detail: {
      zh: "名稱：{name}｜分組：{branch}｜位置：{location}｜解析度：{resolution}",
      en: "Name: {name} | Group: {branch} | Location: {location} | Resolution: {resolution}",
      ja: "名前：{name}｜グループ：{branch}｜場所：{location}｜解像度：{resolution}",
    },
  },
  "screen.group_renamed": {
    title: { zh: "分組已重新命名", en: "Group renamed", ja: "グループ名変更" },
    detail: {
      zh: "{oldName} → {newName}",
      en: "{oldName} → {newName}",
      ja: "{oldName} → {newName}",
    },
  },
  "screen.group_deleted": {
    title: { zh: "分組已刪除", en: "Group deleted", ja: "グループを削除" },
    detail: {
      zh: "原分組：{oldName}（已改為未分組）",
      en: "Old group: {oldName} (moved to ungrouped)",
      ja: "旧グループ：{oldName}（未分類へ移動）",
    },
  },

  // ---- System / Broadcast ----
  "system.emergency_broadcast": {
    title: { zh: "🚨 緊急廣播", en: "🚨 Emergency Broadcast", ja: "🚨 緊急放送" },
    detail: { zh: "{message}", en: "{message}", ja: "{message}" },
  },
  "system.restore_normal": {
    title: { zh: "恢復正常播放", en: "Restored to normal playback", ja: "通常再生に復帰" },
    detail: {
      zh: "已從緊急廣播恢復",
      en: "Restored from emergency broadcast",
      ja: "緊急放送から復帰しました",
    },
  },
};

const fillTemplate = (tpl: string, params: Record<string, unknown>): string =>
  tpl.replace(/\{(\w+)\}/g, (_, key) => {
    const v = params?.[key];
    return v === undefined || v === null || v === "" ? "-" : String(v);
  });

export interface RenderedLog {
  title: string;
  detail: string;
}

/**
 * Render a screen_logs row for display.
 * Prefers the new structured `event_code` + `event_params`; falls back to
 * the legacy `event_title` / `event_detail` plain-text fields for old rows.
 */
export function renderScreenLog(
  row: {
    event_code?: string | null;
    event_params?: Record<string, unknown> | null;
    event_title?: string | null;
    event_detail?: string | null;
  },
  language: Language,
): RenderedLog {
  const code = row.event_code;
  if (code && EVENTS[code]) {
    const tpl = EVENTS[code];
    const params = row.event_params || {};
    return {
      title: tpl.title[language] ?? tpl.title.zh,
      detail: tpl.detail ? fillTemplate(tpl.detail[language] ?? tpl.detail.zh, params) : "",
    };
  }
  return {
    title: row.event_title ?? "",
    detail: row.event_detail ?? "",
  };
}

export type ScreenLogEventCode = keyof typeof EVENTS;

/**
 * --- Catalog introspection (used by the Audit Catalog dialog) ---
 */
export interface ScreenLogCatalogEntry {
  /** Stable event_code (e.g. `schedule.created`) */
  code: string;
  /** Localized title per language */
  title: Record<Language, string>;
  /** Localized detail template per language (empty when not provided) */
  detail: Record<Language, string>;
  /** Whether this event has any detail template at all */
  hasDetail: boolean;
  /** Placeholder names parsed from the zh detail template */
  params: string[];
  /** True iff every language has both title and (when present) detail */
  hasAllLangs: boolean;
}

const parseDetailParams = (tpl: string): string[] => {
  const out = new Set<string>();
  tpl.replace(/\{(\w+)\}/g, (_, k) => { out.add(k); return ""; });
  return Array.from(out);
};

export function getScreenLogCatalog(): ScreenLogCatalogEntry[] {
  return Object.entries(EVENTS)
    .map(([code, tpl]): ScreenLogCatalogEntry => {
      const title: Record<Language, string> = {
        zh: tpl.title.zh ?? "",
        en: tpl.title.en ?? "",
        ja: tpl.title.ja ?? "",
      };
      const detail: Record<Language, string> = tpl.detail
        ? { zh: tpl.detail.zh ?? "", en: tpl.detail.en ?? "", ja: tpl.detail.ja ?? "" }
        : { zh: "", en: "", ja: "" };
      const titleComplete = !!title.zh && !!title.en && !!title.ja;
      const detailComplete = tpl.detail ? !!detail.zh && !!detail.en && !!detail.ja : true;
      return {
        code,
        title,
        detail,
        hasDetail: !!tpl.detail,
        params: tpl.detail ? parseDetailParams(tpl.detail.zh) : [],
        hasAllLangs: titleComplete && detailComplete,
      };
    })
    .sort((a, b) => a.code.localeCompare(b.code));
}
