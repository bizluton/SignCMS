// Static load of all 3 locales merged into the legacy `translations` shape:
//   { keyName: { zh, en, ja }, ... }
//
// Only import this from code paths that genuinely need the full matrix:
//   - `src/lib/i18nOverrides.ts`  (audit tool — iterates every key/locale)
//   - `src/lib/studioData.ts`     (sync `getStudioName(key, language)` util)
//
// Everything else should use `useLanguage()` from LanguageContext, which
// lazy-loads only the active locale.

import { ZH } from "./zh";
import { EN } from "./en";
import { JA } from "./ja";
import type { TranslationKey } from "./index";

type RowShape = { zh: string; en: string; ja: string };

const merged: Record<string, RowShape> = {};
for (const k of Object.keys(ZH)) {
  merged[k] = {
    zh: (ZH as Record<string, string>)[k],
    en: (EN as Record<string, string>)[k] ?? (ZH as Record<string, string>)[k],
    ja: (JA as Record<string, string>)[k] ?? (ZH as Record<string, string>)[k],
  };
}

export const translations = merged as Record<TranslationKey, RowShape>;
export type { TranslationKey } from "./index";
