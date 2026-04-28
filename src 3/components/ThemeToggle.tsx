import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useLanguage } from "@/contexts/LanguageContext";
import { persistTheme, syncToServerImmediate, type Lang, type Theme } from "@/hooks/usePreferences";

export function ThemeToggle() {
  const { theme, resolvedTheme, setTheme } = useTheme();
  const { t, language } = useLanguage();
  const [saving, setSaving] = useState(false);
  const current = (resolvedTheme ?? theme) === "dark" ? "dark" : "light";
  const currentLabel = current === "dark" ? t("darkMode") : t("lightMode");

  const toggle = () => {
    if (saving) return;
    const next: Theme = current === "dark" ? "light" : "dark";
    // Apply locally first — keep this change even if server sync fails.
    persistTheme(next);
    setTheme(next);
    setSaving(true);
    syncToServerImmediate(language as Lang, next)
      .catch((err) => {
        console.warn("Failed to sync theme to server:", err);
        toast.error(t("themeSaveFailed"));
      })
      .finally(() => setSaving(false));
  };

  // Listen for server profile sync (after login)
  useEffect(() => {
    const handler = (e: Event) => {
      const { theme: serverTheme } = (e as CustomEvent<{ lang: Lang; theme: Theme }>).detail;
      setTheme(serverTheme);
    };
    window.addEventListener("prefs-synced", handler);
    return () => window.removeEventListener("prefs-synced", handler);
  }, [setTheme]);

  return (
    <Button
      variant="ghost"
      size="sm"
      className="h-8 gap-1.5 px-2"
      onClick={toggle}
      disabled={saving}
      title={current === "dark" ? t("lightMode") : t("darkMode")}
      aria-label={current === "dark" ? t("lightMode") : t("darkMode")}
    >
      <span className="relative inline-flex h-4 w-4 items-center justify-center">
        <Sun className="absolute h-4 w-4 rotate-0 scale-100 transition-transform dark:-rotate-90 dark:scale-0" />
        <Moon className="absolute h-4 w-4 rotate-90 scale-0 transition-transform dark:rotate-0 dark:scale-100" />
      </span>
      <span className="text-xs font-medium hidden sm:inline">{currentLabel}</span>
    </Button>
  );
}
