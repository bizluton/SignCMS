/**
 * Runtime UI terminology overrides — System Admins approve rewrites in the
 * Terminology Audit page and the chosen replacements are persisted here.
 *
 * Storage shape (localStorage key `signcms-i18n-overrides`):
 *   { [translationKey]: { zh?: string; en?: string; ja?: string } }
 *
 * `LanguageProvider.t()` consults this map first, then falls back to the
 * built-in `translations` dictionary. We never mutate the source dictionary
 * at runtime — overrides are layered on top.
 */
import { translations, type TranslationKey } from "@/contexts/translations";

export type Locale = "zh" | "en" | "ja";
export type I18nOverrides = Partial<Record<TranslationKey, Partial<Record<Locale, string>>>>;

const STORAGE_KEY = "signcms-i18n-overrides";
const EVENT_NAME = "signcms-i18n-overrides-changed";

/** Keys whose i18n string contains the candidate token but should NOT be
 *  flagged. These describe the App Store / marketplace concept, not a
 *  storefront/tenant. */
const ALLOW_LIST = new Set<string>([
  // App Store / installable modules
  "navAppStore",
  "planLimitApps",
  "planUsageApps",
  // Self-reference: this page's own copy must literally name the audited
  // tokens (store / shop / branch / 店家 / 店舗 / 團隊 / Team / チーム),
  // so excluding them prevents the page from auditing itself.
  "termAuditTitle",
  "termAuditSubtitle",
]);

/** Tokens we consider "store/team" candidates per locale.
 *  zh/ja are matched as substrings; en uses word boundaries. */
const TOKENS: Record<Locale, RegExp> = {
  zh: /店家|店舗|店鋪|分店|商店/,
  en: /\b(stores?|shops?|branches?|branch)\b/i,
  ja: /店舗|店家|店鋪|支店/,
};

/** Suggested rewrites — applied per-locale. Picks the rewrite that best
 *  preserves grammar in each language. */
const REWRITES: Record<Locale, (s: string) => string> = {
  zh: (s) => s.replace(/店家|店舗|店鋪|分店|商店/g, "團隊"),
  en: (s) =>
    s
      .replace(/\bStores\b/g, "Teams")
      .replace(/\bStore\b/g, "Team")
      .replace(/\bShops\b/g, "Teams")
      .replace(/\bShop\b/g, "Team")
      .replace(/\bBranches\b/g, "Teams")
      .replace(/\bBranch\b/g, "Team")
      .replace(/\bstores\b/g, "teams")
      .replace(/\bstore\b/g, "team")
      .replace(/\bshops\b/g, "teams")
      .replace(/\bshop\b/g, "team")
      .replace(/\bbranches\b/g, "teams")
      .replace(/\bbranch\b/g, "team"),
  ja: (s) => s.replace(/店舗|店家|店鋪|支店/g, "チーム"),
};

export interface AuditCandidate {
  key: TranslationKey;
  locale: Locale;
  current: string;
  suggested: string;
  /** Original (pre-override) text — used for diffing & re-suggesting. */
  original: string;
}

/** Walk the translations dictionary and produce one candidate per (key, locale)
 *  whose current text still matches a token, excluding the allow-list. */
export function scanCandidates(overrides: I18nOverrides): AuditCandidate[] {
  const out: AuditCandidate[] = [];
  const dict = translations as Record<string, Record<Locale, string>>;
  for (const [key, val] of Object.entries(dict)) {
    if (ALLOW_LIST.has(key)) continue;
    for (const locale of ["zh", "en", "ja"] as const) {
      const original = val[locale];
      if (typeof original !== "string") continue;
      const overridden = overrides[key as TranslationKey]?.[locale];
      const current = overridden ?? original;
      if (!TOKENS[locale].test(current)) continue;
      const suggested = REWRITES[locale](current);
      // Skip rows where the suggested rewrite produces no change (e.g. the
      // token survived all replacement rules).
      if (suggested === current) continue;
      out.push({ key: key as TranslationKey, locale, current, suggested, original });
    }
  }
  return out.sort((a, b) =>
    a.key === b.key ? a.locale.localeCompare(b.locale) : a.key.localeCompare(b.key),
  );
}

export function loadOverrides(): I18nOverrides {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? (parsed as I18nOverrides) : {};
  } catch {
    return {};
  }
}

export function saveOverrides(next: I18nOverrides): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    window.dispatchEvent(new CustomEvent(EVENT_NAME));
  } catch {
    /* quota errors etc. — silently ignore */
  }
}

export function clearOverrides(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
    window.dispatchEvent(new CustomEvent(EVENT_NAME));
  } catch {
    /* noop */
  }
}

export function setOverride(
  prev: I18nOverrides,
  key: TranslationKey,
  locale: Locale,
  value: string,
): I18nOverrides {
  const entry = { ...(prev[key] ?? {}) };
  entry[locale] = value;
  return { ...prev, [key]: entry };
}

export function removeOverride(
  prev: I18nOverrides,
  key: TranslationKey,
  locale: Locale,
): I18nOverrides {
  const entry = { ...(prev[key] ?? {}) };
  delete entry[locale];
  const next = { ...prev };
  if (Object.keys(entry).length === 0) {
    delete next[key];
  } else {
    next[key] = entry;
  }
  return next;
}

/** Subscribe to override changes (cross-tab via `storage`, same-tab via custom). */
export function onOverridesChange(cb: () => void): () => void {
  const local = () => cb();
  const cross = (e: StorageEvent) => {
    if (e.key === STORAGE_KEY) cb();
  };
  window.addEventListener(EVENT_NAME, local);
  window.addEventListener("storage", cross);
  return () => {
    window.removeEventListener(EVENT_NAME, local);
    window.removeEventListener("storage", cross);
  };
}

export const __test = { ALLOW_LIST, TOKENS, REWRITES, STORAGE_KEY };