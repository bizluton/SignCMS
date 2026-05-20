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
 *
 * IMPORTANT: this module is imported by LanguageProvider. It MUST NOT
 * statically import the full translations matrix (all.ts) — doing so would
 * pull EN+JA dictionaries into the main bundle and defeat the lazy-load
 * strategy. The audit scanner that needs all 3 locales lives in
 * `i18nAudit.ts` and is only imported by TerminologyAuditPage.
 */
import type { TranslationKey } from "@/contexts/translations";

export type Locale = "zh" | "en" | "ja";
export type I18nOverrides = Partial<Record<TranslationKey, Partial<Record<Locale, string>>>>;

const STORAGE_KEY = "signcms-i18n-overrides";
const EVENT_NAME  = "signcms-i18n-overrides-changed";

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

export const __test = { STORAGE_KEY };
