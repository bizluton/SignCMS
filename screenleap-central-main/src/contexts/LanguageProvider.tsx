import { createContext, useCallback, useEffect, useState, type ReactNode } from "react";
import { getInitialLang, persistLang, syncToServer, type Lang, type Theme } from "@/hooks/usePreferences";
import { translations, type TranslationKey } from "./translations";
import { loadOverrides, onOverridesChange, type I18nOverrides } from "@/lib/i18nOverrides";

export type Language = "zh" | "en" | "ja";

export interface LanguageContextType {
  language: Language;
  setLanguage: (lang: Language) => void;
  t: (key: TranslationKey) => string;
}

export const LanguageContext = createContext<LanguageContextType | null>(null);

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [language, setLanguageState] = useState<Language>(getInitialLang);
  const [overrides, setOverrides] = useState<I18nOverrides>(() => loadOverrides());

  useEffect(() => {
    return onOverridesChange(() => setOverrides(loadOverrides()));
  }, []);

  const setLanguage = useCallback((lang: Language) => {
    setLanguageState(lang);
  }, []);

  useEffect(() => {
    persistLang(language);
    document.documentElement.lang = language === "zh" ? "zh-TW" : language === "ja" ? "ja" : "en";
    const currentTheme = (localStorage.getItem("signboard-theme") || "light") as Theme;
    syncToServer(language, currentTheme);
  }, [language]);

  useEffect(() => {
    const handler = (e: Event) => {
      const { lang } = (e as CustomEvent<{ lang: Lang; theme: Theme }>).detail;
      setLanguageState(lang);
    };

    window.addEventListener("prefs-synced", handler);
    return () => window.removeEventListener("prefs-synced", handler);
  }, []);

  const t = (key: TranslationKey): string => {
    const override = overrides[key]?.[language];
    if (typeof override === "string" && override.length > 0) return override;
    return translations[key]?.[language] ?? key;
  };

  return (
    <LanguageContext.Provider value={{ language, setLanguage, t }}>
      {children}
    </LanguageContext.Provider>
  );
}