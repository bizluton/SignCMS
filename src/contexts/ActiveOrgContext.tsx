import { createContext, useContext, useState, useEffect, ReactNode } from "react";

const STORAGE_KEY = "signcms_active_org_id";

interface ActiveOrgContextType {
  activeOrgId: string | null;
  setActiveOrgId: (id: string | null) => void;
}

const ActiveOrgContext = createContext<ActiveOrgContextType>({
  activeOrgId: null,
  setActiveOrgId: () => {},
});

export const useActiveOrg = () => useContext(ActiveOrgContext);

export function ActiveOrgProvider({ children }: { children: ReactNode }) {
  const [activeOrgId, setActiveOrgIdState] = useState<string | null>(() => {
    try { return localStorage.getItem(STORAGE_KEY); } catch { return null; }
  });

  const setActiveOrgId = (id: string | null) => {
    setActiveOrgIdState(id);
    try {
      if (id) localStorage.setItem(STORAGE_KEY, id);
      else localStorage.removeItem(STORAGE_KEY);
    } catch {}
  };

  return (
    <ActiveOrgContext.Provider value={{ activeOrgId, setActiveOrgId }}>
      {children}
    </ActiveOrgContext.Provider>
  );
}