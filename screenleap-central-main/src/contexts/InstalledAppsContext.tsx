import { createContext, useContext, useState, useEffect, useCallback, ReactNode } from "react";
import { useActiveOrg } from "@/contexts/ActiveOrgContext";
import { supabase } from "@/integrations/supabase/client";

const STORAGE_PREFIX = "signboard-installed-apps";

function getStorageKey(orgId: string | null) {
  return orgId ? `${STORAGE_PREFIX}:${orgId}` : STORAGE_PREFIX;
}

function loadBuiltinApps(orgId: string | null): Set<string> {
  try {
    const saved = localStorage.getItem(getStorageKey(orgId));
    return saved ? new Set(JSON.parse(saved)) : new Set<string>();
  } catch {
    return new Set<string>();
  }
}

function saveBuiltinApps(orgId: string | null, apps: Set<string>) {
  try {
    localStorage.setItem(getStorageKey(orgId), JSON.stringify([...apps]));
  } catch {}
}

export interface ExternalAppInfo {
  id: string;           // store_apps.id (uuid)
  slug: string;         // store_apps.slug — used as app_id in widgets table
  nameI18n: { zh?: string; en?: string; ja?: string };
  descI18n:  { zh?: string; en?: string; ja?: string };
  iconUrl:   string | null;
  gradient:  string;
  publisher: string;
  widgetUrl: string | null;
}

interface InstalledAppsContextType {
  installedApps: Set<string>;           // slugs of all installed apps (builtin + external)
  externalApps: ExternalAppInfo[];      // approved external apps from store_apps table
  installApp:   (id: string, externalAppUuid?: string) => Promise<void>;
  uninstallApp: (id: string, externalAppUuid?: string) => Promise<void>;
}

const InstalledAppsContext = createContext<InstalledAppsContextType | null>(null);

export function InstalledAppsProvider({ children }: { children: ReactNode }) {
  const { activeOrgId } = useActiveOrg();

  const [builtinApps, setBuiltinApps] = useState<Set<string>>(() => loadBuiltinApps(activeOrgId));
  const [externalInstalledSlugs, setExternalInstalledSlugs] = useState<Set<string>>(new Set());
  const [externalApps, setExternalApps] = useState<ExternalAppInfo[]>([]);

  // Reload builtin apps when org changes
  useEffect(() => {
    setBuiltinApps(loadBuiltinApps(activeOrgId));
  }, [activeOrgId]);

  // Fetch all approved external apps (for App Store listing)
  useEffect(() => {
    supabase
      .from("store_apps")
      .select("id, slug, name_i18n, desc_i18n, icon_url, gradient, publisher, widget_url")
      .eq("status", "approved")
      .then(({ data }) => {
        if (!data) return;
        setExternalApps(
          data.map((r) => ({
            id:        r.id,
            slug:      r.slug,
            nameI18n:  (r.name_i18n as ExternalAppInfo["nameI18n"]) || {},
            descI18n:  (r.desc_i18n  as ExternalAppInfo["descI18n"]) || {},
            iconUrl:   r.icon_url   ?? null,
            gradient:  r.gradient   ?? "from-gray-500 to-gray-600",
            publisher: r.publisher  ?? "",
            widgetUrl: r.widget_url ?? null,
          })),
        );
      });
  }, []);

  // Fetch external app installs for the active org
  useEffect(() => {
    if (!activeOrgId) { setExternalInstalledSlugs(new Set()); return; }
    supabase
      .from("org_installed_apps")
      .select("store_apps(slug)")
      .eq("org_id", activeOrgId)
      .then(({ data }) => {
        if (!data) return;
        const slugs = new Set<string>();
        for (const row of data) {
          const app = row.store_apps as unknown as { slug: string } | null;
          if (app?.slug) slugs.add(app.slug);
        }
        setExternalInstalledSlugs(slugs);
      });
  }, [activeOrgId]);

  // Combined set: builtin (localStorage) + external (DB)
  const installedApps = new Set<string>([...builtinApps, ...externalInstalledSlugs]);

  const installApp = useCallback(async (slug: string, externalAppUuid?: string) => {
    if (externalAppUuid && activeOrgId) {
      // External app: write to DB then call webhook
      const { error } = await supabase.from("org_installed_apps").insert({
        org_id: activeOrgId,
        app_id: externalAppUuid,
      });
      if (!error) {
        setExternalInstalledSlugs((prev) => new Set(prev).add(slug));
        // Fire-and-forget webhook notification
        supabase.functions.invoke("notify-install", {
          body: { appId: externalAppUuid, orgId: activeOrgId, event: "install" },
        });
      }
    } else {
      // Builtin app: localStorage
      setBuiltinApps((prev) => {
        const next = new Set(prev).add(slug);
        saveBuiltinApps(activeOrgId, next);
        return next;
      });
    }
  }, [activeOrgId]);

  const uninstallApp = useCallback(async (slug: string, externalAppUuid?: string) => {
    if (externalAppUuid && activeOrgId) {
      // Fire webhook BEFORE deleting so install_token is still available
      await supabase.functions.invoke("notify-install", {
        body: { appId: externalAppUuid, orgId: activeOrgId, event: "uninstall" },
      });
      const { error } = await supabase
        .from("org_installed_apps")
        .delete()
        .eq("org_id", activeOrgId)
        .eq("app_id", externalAppUuid);
      if (!error) {
        setExternalInstalledSlugs((prev) => {
          const next = new Set(prev);
          next.delete(slug);
          return next;
        });
      }
    } else {
      setBuiltinApps((prev) => {
        const next = new Set(prev);
        next.delete(slug);
        saveBuiltinApps(activeOrgId, next);
        return next;
      });
    }
  }, [activeOrgId]);

  return (
    <InstalledAppsContext.Provider value={{ installedApps, externalApps, installApp, uninstallApp }}>
      {children}
    </InstalledAppsContext.Provider>
  );
}

export function useInstalledApps() {
  const ctx = useContext(InstalledAppsContext);
  if (!ctx) throw new Error("useInstalledApps must be used within InstalledAppsProvider");
  return ctx;
}

// Shared builtin app definitions
export interface AppDef {
  id: string;
  name: { zh: string; en: string; ja: string };
  color: string;
  hasConfig?: boolean;
}

export const APP_DEFINITIONS: AppDef[] = [
  { id: "announcement", name: { zh: "公告發佈", en: "Announcements", ja: "お知らせ" }, color: "from-orange-500 to-amber-500" },
  { id: "queue", name: { zh: "排隊叫號", en: "Queue", ja: "順番呼出し" }, color: "from-blue-500 to-cyan-500", hasConfig: true },
  { id: "weather", name: { zh: "天氣新聞", en: "Weather", ja: "天気" }, color: "from-emerald-500 to-teal-500" },
  { id: "social", name: { zh: "社群牆", en: "Social", ja: "SNS" }, color: "from-pink-500 to-rose-500" },
  { id: "meeting-room", name: { zh: "會議室管理", en: "Meeting Room", ja: "会議室管理" }, color: "from-violet-500 to-purple-500" },
  { id: "multilingual", name: { zh: "多語言翻譯", en: "Multilingual", ja: "多言語翻訳" }, color: "from-sky-500 to-indigo-500" },
  { id: "attendance", name: { zh: "員工打卡", en: "Attendance", ja: "勤怠管理" }, color: "from-amber-500 to-yellow-500" },
];
