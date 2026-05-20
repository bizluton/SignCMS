/**
 * Terminology audit — walks the full translations matrix and flags strings
 * that still use deprecated terms (store/shop/branch → team).
 *
 * **Loads all 3 locales statically** via the `all.ts` shim. Importing this
 * file pulls EN+JA dictionaries into whatever chunk imports it. That's
 * intentional: only the TerminologyAuditPage uses it, and that page is a
 * separate route → Vite splits it into its own chunk, so the audit's
 * static dependency on all 3 locales doesn't pollute the main bundle.
 *
 * Override CRUD (loadOverrides / saveOverrides / setOverride / …) lives
 * separately in `i18nOverrides.ts` — LanguageProvider imports that file
 * for runtime overrides, so it must NOT transitively pull EN/JA.
 */
import { translations, type TranslationKey } from "@/contexts/translations/all";
import type { I18nOverrides, Locale } from "./i18nOverrides";

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

export const __test = { ALLOW_LIST, TOKENS, REWRITES };
