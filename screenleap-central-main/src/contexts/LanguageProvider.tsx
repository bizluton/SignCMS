import { createContext, useCallback, useEffect, useState, type ReactNode } from "react";
import { getInitialLang, persistLang, syncToServer, type Lang, type Theme } from "@/hooks/usePreferences";
import { ZH, type TranslationKey } from "./translations";
import { loadOverrides, onOverridesChange, type I18nOverrides } from "@/lib/i18nOverrides";

export type Language = "zh" | "en" | "ja";

export interface LanguageContextType {
  language: Language;
  setLanguage: (lang: Language) => void;
  t: (key: TranslationKey) => string;
}

export const LanguageContext = createContext<LanguageContextType | null>(null);

// Locale loaders. zh is bundled inline (default for most users + the
// TranslationKey type source). en / ja are dynamic import()s — Vite splits
// them into separate chunks so they're only fetched when the user switches.
type Dict = Record<string, string>;

const ZH_DICT = ZH as unknown as Dict;

const LOCALE_LOADERS: Record<Language, () => Promise<Dict>> = {
  zh: () => Promise.resolve(ZH_DICT),
  en: () => import("./translations/en").then((m) => m.EN as unknown as Dict),
  ja: () => import("./translations/ja").then((m) => m.JA as unknown as Dict),
};

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [language, setLanguageState] = useState<Language>(getInitialLang);
  const [overrides, setOverrides] = useState<I18nOverrides>(() => loadOverrides());
  // dict is the active locale's translations. zh starts pre-loaded; the
  // effect below swaps it when language changes. While a lazy chunk is
  // in-flight the previous dict stays in place, which avoids a flash of
  // untranslated keys mid-switch.
  const [dict, setDict] = useState<Dict>(ZH_DICT);

  useEffect(() => {
    return onOverridesChange(() => setOverrides(loadOverrides()));
  }, []);

  // Load the dict for the active language.
  useEffect(() => {
    let cancelled = false;
    LOCALE_LOADERS[language]().then((d) => {
      if (!cancelled) setDict(d);
    }).catch((err) => {
      // Network / chunk-load failure: keep the previous dict in place so
      // the UI stays usable. The `?? key` fallback in t() covers any
      // brand-new key that the previous locale didn't have.
      console.error(`Failed to load locale '${language}'`, err);
    });
    return () => { cancelled = true; };
  }, [language]);

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
    return dict[key] ?? key;
  };

  return (
    <LanguageContext.Provider value={{ language, setLanguage, t }}>
      {children}
    </LanguageContext.Provider>
  );
}
