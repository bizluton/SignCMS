import { translations, type TranslationKey } from "@/contexts/translations";
import type { Language } from "@/contexts/LanguageContext";
import {
  STUDIO_LAYOUT_PRESETS,
  STUDIO_TEMPLATE_PRESETS,
  type StudioIconKey,
  type StudioLayoutPreset,
  type StudioTemplatePreset,
  type StudioZonePreset,
} from "@/lib/studioPresets";

export type StudioSourceTab = "layout" | "preset" | "mine";
export type StudioSourceStatKey = "landscapeLayouts" | "portraitLayouts" | "templates" | "projects";

export const STUDIO_SOURCE = {
  layouts: STUDIO_LAYOUT_PRESETS,
  templates: STUDIO_TEMPLATE_PRESETS,
} as const;

export const STUDIO_DATA_VERSION = [
  ...STUDIO_LAYOUT_PRESETS.map((item) => `${item.id}:${item.aspect}:${item.zones.length}`),
  ...STUDIO_TEMPLATE_PRESETS.map((item) => `${item.id}:${item.aspect}:${item.zones.length}`),
].join("|");

const STUDIO_CACHE_VERSION_KEY = "signcms:studio-source-version";
let lastInvalidatedAt: string | null = null;
let studioSourceCache: {
  version: string;
  loadedAt: string;
  layouts: StudioLayoutPreset[];
  templates: StudioTemplatePreset[];
} | null = null;

const USER_SCENES_KEY = "signcms:user-scenes";

function getUserScenes(): StudioTemplatePreset[] {
  try {
    const raw = window.localStorage.getItem(USER_SCENES_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as StudioTemplatePreset[];
  } catch { return []; }
}

export function saveUserScene(scene: StudioTemplatePreset): void {
  const scenes = getUserScenes().filter((s) => s.id !== scene.id);
  scenes.unshift(scene);
  try { window.localStorage.setItem(USER_SCENES_KEY, JSON.stringify(scenes)); } catch { /* noop */ }
  studioSourceCache = null;
}

export function deleteUserScene(id: string): void {
  const scenes = getUserScenes().filter((s) => s.id !== id);
  try { window.localStorage.setItem(USER_SCENES_KEY, JSON.stringify(scenes)); } catch { /* noop */ }
  studioSourceCache = null;
}

function buildStudioSourceCache() {
  studioSourceCache = {
    version: STUDIO_DATA_VERSION,
    loadedAt: new Date().toISOString(),
    layouts: [...STUDIO_SOURCE.layouts],
    templates: [...STUDIO_SOURCE.templates, ...getUserScenes()],
  };
  return studioSourceCache;
}

function getStudioSourceCache() {
  if (!studioSourceCache || studioSourceCache.version !== STUDIO_DATA_VERSION) {
    return buildStudioSourceCache();
  }
  return studioSourceCache;
}

export function invalidateStudioSourceCache() {
  studioSourceCache = null;
  lastInvalidatedAt = new Date().toISOString();
  try {
    const previousVersion = window.localStorage.getItem(STUDIO_CACHE_VERSION_KEY);
    if (previousVersion !== STUDIO_DATA_VERSION) {
      window.localStorage.setItem(STUDIO_CACHE_VERSION_KEY, STUDIO_DATA_VERSION);
    }
  } catch { /* storage may be unavailable */ }
  return STUDIO_DATA_VERSION;
}

export function getStudioSourceCacheStatus() {
  const cache = getStudioSourceCache();
  return {
    source: "studioData.ts",
    version: cache.version,
    versionShort: cache.version.slice(0, 12),
    loadedAt: cache.loadedAt,
    invalidatedAt: lastInvalidatedAt,
    cacheState: "ready" as const,
    layouts: cache.layouts.length,
    templates: cache.templates.length,
  };
}

export function getStudioLayouts() {
  return [...getStudioSourceCache().layouts];
}

export function getStudioTemplates() {
  return [...getStudioSourceCache().templates];
}

export const STUDIO_SOURCE_STAT_LABELS: Record<StudioSourceStatKey, Record<Language, string>> = {
  landscapeLayouts: { zh: "橫式版型", en: "Landscape", ja: "横向き" },
  portraitLayouts: { zh: "直式版型", en: "Portrait", ja: "縦向き" },
  templates: { zh: "樣板庫", en: "Templates", ja: "テンプレート" },
  projects: { zh: "我的專案", en: "My Projects", ja: "マイプロジェクト" },
};

export function getStudioName(nameKey: string, language: Language) {
  return translations[nameKey as TranslationKey]?.[language] ?? nameKey;
}

export function getStudioSourceStats(projectCount: number) {
  const layouts = getStudioLayouts();
  const templates = getStudioTemplates();
  return {
    landscapeLayouts: layouts.filter((item) => item.aspect === "16:9").length,
    portraitLayouts: layouts.filter((item) => item.aspect === "9:16").length,
    templates: templates.length,
    projects: projectCount,
  } satisfies Record<StudioSourceStatKey, number>;
}

export function getStudioSourceStatRows(projectCount: number, language: Language) {
  const stats = getStudioSourceStats(projectCount);
  return (Object.keys(STUDIO_SOURCE_STAT_LABELS) as StudioSourceStatKey[]).map((key) => ({
    key,
    label: STUDIO_SOURCE_STAT_LABELS[key][language],
    value: stats[key],
  }));
}

export type { StudioIconKey, StudioLayoutPreset, StudioTemplatePreset, StudioZonePreset };