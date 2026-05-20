// Re-export hub for the translations bundle.
//
// zh is imported statically because:
//   1. It is the default language for most users (no flash of untranslated keys).
//   2. It serves as the type source for TranslationKey — all other locales
//      are checked against zh's key set.
//
// en / ja are lazy-loaded by LanguageProvider via dynamic import().
// Vite splits them into separate chunks; switching language briefly shows
// the key until the chunk resolves (the existing `?? key` fallback in
// LanguageProvider already covers this case).

export { ZH } from "./zh";
export type TranslationKey = keyof typeof import("./zh").ZH;
