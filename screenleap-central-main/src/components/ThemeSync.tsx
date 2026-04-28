import { useEffect } from "react";
import { useTheme } from "next-themes";
import { useLocation } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { getCookie } from "@/lib/cookies";
import type { Lang, Theme } from "@/hooks/usePreferences";

const THEME_COOKIE = "user_theme";

function readCookieTheme(): Theme | null {
  const v = getCookie(THEME_COOKIE);
  return v === "dark" || v === "light" ? v : null;
}

/** Make sure <html> has exactly the expected theme class + color-scheme. */
function ensureClass(theme: Theme) {
  const root = document.documentElement;
  const other = theme === "dark" ? "light" : "dark";
  if (!root.classList.contains(theme)) root.classList.add(theme);
  if (root.classList.contains(other)) root.classList.remove(other);
  root.style.colorScheme = theme;
}

/**
 * Global listener that keeps the active theme in sync with the user's
 * cookie/profile across:
 *   - login (`prefs-synced` event from AuthContext)
 *   - SPA navigation (route changes)
 *   - Supabase auth state changes (SIGNED_IN, TOKEN_REFRESHED)
 * Mounted inside next-themes' ThemeProvider.
 */
export function ThemeSync() {
  const { setTheme, theme } = useTheme();
  const location = useLocation();

  // 1) Server preferences arrived after login.
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<{ lang: Lang; theme: Theme }>).detail;
      if (!detail?.theme) return;
      ensureClass(detail.theme);
      if (detail.theme !== theme) setTheme(detail.theme);
    };
    window.addEventListener("prefs-synced", handler);
    return () => window.removeEventListener("prefs-synced", handler);
  }, [setTheme, theme]);

  // 2) Re-verify the cookie theme on every route change so login redirects
  //    (e.g. /auth -> /dashboard) can never leave a stale class on <html>.
  useEffect(() => {
    const cookieTheme = readCookieTheme();
    if (!cookieTheme) return;
    ensureClass(cookieTheme);
    if (cookieTheme !== theme) setTheme(cookieTheme);
  }, [location.pathname, setTheme, theme]);

  // 3) Re-verify on Supabase auth events (sign-in, token refresh).
  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event !== "SIGNED_IN" && event !== "TOKEN_REFRESHED" && event !== "INITIAL_SESSION") return;
      const cookieTheme = readCookieTheme();
      if (!cookieTheme) return;
      ensureClass(cookieTheme);
      if (cookieTheme !== theme) setTheme(cookieTheme);
    });
    return () => subscription.unsubscribe();
  }, [setTheme, theme]);

  return null;
}
