/**
 * Unified preferences hook – syncs server profile + cookie + localStorage + React state
 * Priority (logged in): server profile > cookie > localStorage > system default
 * Priority (logged out): cookie > localStorage > system default
 */

import { getCookie, setCookie, deleteCookie } from "@/lib/cookies";
import { fetchPreferences, patchPreferences, type UserPreferences } from "@/lib/api/preferences";

export type Theme = "dark" | "light";
export type Lang = "zh" | "en" | "ja";

const LANG_COOKIE = "user_lang";
const THEME_COOKIE = "user_theme";
const LANG_LS = "signboard-lang";
const THEME_LS = "signboard-theme";

// Map internal lang codes to cookie/server values and back
const langToCookie: Record<Lang, string> = { zh: "zh-TW", en: "en", ja: "ja" };
const cookieToLang: Record<string, Lang> = { "zh-TW": "zh", en: "en", ja: "ja", zh: "zh" };

/** Read initial language: cookie > localStorage > default "zh" */
export function getInitialLang(): Lang {
  const fromCookie = getCookie(LANG_COOKIE);
  if (fromCookie && cookieToLang[fromCookie]) return cookieToLang[fromCookie];
  const fromLS = localStorage.getItem(LANG_LS);
  if (fromLS && (fromLS === "zh" || fromLS === "en" || fromLS === "ja")) return fromLS;
  return "zh";
}

/** Read initial theme: cookie > localStorage > system preference > "light" */
export function getInitialTheme(): Theme {
  const fromCookie = getCookie(THEME_COOKIE);
  if (fromCookie === "dark" || fromCookie === "light") return fromCookie;
  const fromLS = localStorage.getItem(THEME_LS);
  if (fromLS === "dark" || fromLS === "light") return fromLS;
  return "light";
}

/** Persist language to cookie + localStorage */
export function persistLang(lang: Lang): void {
  setCookie(LANG_COOKIE, langToCookie[lang]);
  localStorage.setItem(LANG_LS, lang);
}

/** Persist theme to cookie + localStorage */
export function persistTheme(theme: Theme): void {
  setCookie(THEME_COOKIE, theme);
  localStorage.setItem(THEME_LS, theme);
}

/**
 * Initialize preferences from server profile (called after login).
 * Returns resolved lang/theme so callers can apply to React state.
 */
export function initFromProfile(profile: UserPreferences): { lang: Lang; theme: Theme } {
  const lang = cookieToLang[profile.preferred_lang] ?? "zh";
  const theme: Theme = profile.preferred_theme === "dark" ? "dark" : "light";
  // Write to cookie + localStorage for cross-domain caching
  persistLang(lang);
  persistTheme(theme);
  return { lang, theme };
}

/** Fetch profile from server and initialize local caches */
export async function initFromServer(): Promise<{ lang: Lang; theme: Theme } | null> {
  const prefs = await fetchPreferences();
  if (!prefs) return null;
  return initFromProfile(prefs);
}

// Debounced server sync
let syncTimer: ReturnType<typeof setTimeout> | null = null;

/** Sync current preferences to server with 500ms debounce */
export function syncToServer(lang: Lang, theme: Theme): void {
  if (syncTimer) clearTimeout(syncTimer);
  syncTimer = setTimeout(() => {
    patchPreferences({
      preferred_lang: langToCookie[lang],
      preferred_theme: theme,
    }).catch(() => { /* fire-and-forget */ });
  }, 500);
}

/**
 * Sync preferences to server immediately (bypasses debounce).
 * Resolves on success, rejects with the underlying error on failure so
 * callers can surface a toast while keeping the local change in place.
 */
export function syncToServerImmediate(lang: Lang, theme: Theme): Promise<void> {
  if (syncTimer) {
    clearTimeout(syncTimer);
    syncTimer = null;
  }
  return patchPreferences({
    preferred_lang: langToCookie[lang],
    preferred_theme: theme,
  }).then(() => undefined);
}

/** Clear all preference caches (called on logout) */
export function clearPreferences(): void {
  if (syncTimer) clearTimeout(syncTimer);
  deleteCookie(LANG_COOKIE);
  deleteCookie(THEME_COOKIE);
  localStorage.removeItem(LANG_LS);
  localStorage.removeItem(THEME_LS);
}
