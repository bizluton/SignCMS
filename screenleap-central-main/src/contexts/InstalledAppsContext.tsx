import { createContext, useContext, useState, useEffect, useCallback, ReactNode } from "react";
import { useActiveOrg } from "@/contexts/ActiveOrgContext";

const STORAGE_PREFIX = "signboard-installed-apps";

function getStorageKey(orgId: string | null) {
  return orgId ? `${STORAGE_PREFIX}:${orgId}` : STORAGE_PREFIX;
}

function loadApps(orgId: string | null): Set<string> {
  try {
    const saved = localStorage.getItem(getStorageKey(orgId));
    return saved ? new Set(JSON.parse(saved)) : new Set<string>();
  } catch {
    return new Set<string>();
  }
}

function saveApps(orgId: string | null, apps: Set<string>) {
  try {
    localStorage.setItem(getStorageKey(orgId), JSON.stringify([...apps]));
  } catch {}
}

interface InstalledAppsContextType {
  installedApps: Set<string>;
  installApp: (id: string) => void;
  uninstallApp: (id: string) => void;
}

const InstalledAppsContext = createContext<InstalledAppsContextType | null>(null);

export function InstalledAppsProvider({ children }: { children: ReactNode }) {
  const { activeOrgId } = useActiveOrg();
  const [installedApps, setInstalledApps] = useState<Set<string>>(() => loadApps(activeOrgId));

  // Reload apps when org changes
  useEffect(() => {
    setInstalledApps(loadApps(activeOrgId));
  }, [activeOrgId]);

  const installApp = useCallback((id: string) => {
    setInstalledApps((prev) => {
      const next = new Set(prev).add(id);
      saveApps(activeOrgId, next);
      return next;
    });
  }, [activeOrgId]);

  const uninstallApp = useCallback((id: string) => {
    setInstalledApps((prev) => {
      const next = new Set(prev);
      next.delete(id);
      saveApps(activeOrgId, next);
      return next;
    });
  }, [activeOrgId]);

  return (
    <InstalledAppsContext.Provider value={{ installedApps, installApp, uninstallApp }}>
      {children}
    </InstalledAppsContext.Provider>
  );
}

export function useInstalledApps() {
  const ctx = useContext(InstalledAppsContext);
  if (!ctx) throw new Error("useInstalledApps must be used within InstalledAppsProvider");
  return ctx;
}

// Shared app definitions (icon-free for sidebar use; AppStorePage adds its own icons)
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
