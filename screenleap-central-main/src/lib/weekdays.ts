// Canonical weekday format used throughout the app: lowercase English short ("mon"..."sun").
// This module also handles legacy data (Chinese chars, full names, numeric strings)
// so we can normalize on read and always write the canonical form.

export const WEEKDAY_KEYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
export type WeekdayKey = (typeof WEEKDAY_KEYS)[number];

// Aliases per canonical key. First element is the canonical value.
const ALIASES: Record<WeekdayKey, string[]> = {
  mon: ["mon", "monday", "一", "週一", "周一", "星期一", "1"],
  tue: ["tue", "tuesday", "二", "週二", "周二", "星期二", "2"],
  wed: ["wed", "wednesday", "三", "週三", "周三", "星期三", "3"],
  thu: ["thu", "thursday", "四", "週四", "周四", "星期四", "4"],
  fri: ["fri", "friday", "五", "週五", "周五", "星期五", "5"],
  sat: ["sat", "saturday", "六", "週六", "周六", "星期六", "6"],
  sun: ["sun", "sunday", "日", "週日", "周日", "星期日", "星期天", "0", "7"],
};

const ALIAS_TO_KEY: Map<string, WeekdayKey> = new Map();
for (const k of WEEKDAY_KEYS) {
  for (const a of ALIASES[k]) ALIAS_TO_KEY.set(a.toLowerCase(), k);
}

/** Normalize a single value (any supported alias) to the canonical English short form, or null. */
export function normalizeDay(value: unknown): WeekdayKey | null {
  if (value == null) return null;
  return ALIAS_TO_KEY.get(String(value).trim().toLowerCase()) ?? null;
}

/** Normalize an array of mixed values into canonical, deduped, in WEEKDAY_KEYS order. */
export function normalizeDays(values: unknown): WeekdayKey[] {
  if (!Array.isArray(values)) return [];
  const set = new Set<WeekdayKey>();
  for (const v of values) {
    const k = normalizeDay(v);
    if (k) set.add(k);
  }
  return WEEKDAY_KEYS.filter((k) => set.has(k));
}

/** JS Date.getDay() returns 0..6 with Sunday=0. Map to our canonical key. */
const JS_DAY_TO_KEY: WeekdayKey[] = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

/** Returns true if `days` (any aliases accepted) includes the given JS getDay() value. Empty list = always true. */
export function dayMatches(days: unknown, jsDay: number): boolean {
  const normalized = normalizeDays(days);
  if (normalized.length === 0) return true;
  return normalized.includes(JS_DAY_TO_KEY[jsDay]);
}
