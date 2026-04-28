import { createContext, useContext, useEffect, useState } from "react";
import { User, Session } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { logActivity } from "@/lib/activityLogger";
import { initFromServer, clearPreferences } from "@/hooks/usePreferences";
import { useProfiles } from "@/contexts/ProfilesContext";

interface AuthContextType {
  user: User | null;
  session: Session | null;
  loading: boolean;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  session: null,
  loading: true,
  signOut: async () => {},
});

export const useAuth = () => useContext(AuthContext);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const { clearProfiles } = useProfiles();

  useEffect(() => {
    let initialCheckDone = false;
    let sawRecoveryEvent = false;

    const rememberMe = localStorage.getItem("signcms_remember_me");
    const sessionActive = sessionStorage.getItem("signcms_session_active");
    const hashParams = new URLSearchParams(window.location.hash.substring(1));
    const searchParams = new URLSearchParams(window.location.search);
    const isResetPasswordRoute = window.location.pathname === "/reset-password";
    const hasRecoveryParams = hashParams.get("type") === "recovery" || searchParams.has("code");

    const syncSession = (_session: Session | null) => {
      setSession(_session);
      setUser(_session?.user ?? null);
      setLoading(false);
    };

    const syncPreferencesIfNeeded = (_event: string, _session: Session | null) => {
      if ((_event === "SIGNED_IN" || _event === "PASSWORD_RECOVERY") && _session?.user) {
        void initFromServer()
          .then((prefs) => {
            if (prefs) {
              window.dispatchEvent(new CustomEvent("prefs-synced", { detail: prefs }));
            }
          })
          .catch((error) => {
            console.warn("Failed to sync preferences after auth change:", error);
          });
      }
    };

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event, newSession) => {
        if (event === "PASSWORD_RECOVERY") sawRecoveryEvent = true;
        if (!initialCheckDone && event !== "SIGNED_OUT" && event !== "PASSWORD_RECOVERY") return;
        syncSession(newSession);
        syncPreferencesIfNeeded(event, newSession);
      }
    );

    void supabase.auth.getSession()
      .then(({ data: { session: currentSession } }) => {
        const shouldPreserveRecoverySession =
          !!currentSession && (sawRecoveryEvent || (isResetPasswordRoute && (hasRecoveryParams || !!currentSession)));

        if (currentSession && rememberMe !== "true" && !sessionActive && !shouldPreserveRecoverySession) {
          void supabase.auth.signOut()
            .catch((error) => {
              console.warn("Failed to clear non-persistent session:", error);
            })
            .finally(() => {
              initialCheckDone = true;
              syncSession(null);
            });
          return;
        }

        initialCheckDone = true;
        syncSession(currentSession);

        if (currentSession?.user) {
          void initFromServer()
            .then((prefs) => {
              if (prefs) {
                window.dispatchEvent(new CustomEvent("prefs-synced", { detail: prefs }));
              }
            })
            .catch((error) => {
              console.warn("Failed to initialize preferences from server:", error);
            });
        }
      })
      .catch((error) => {
        console.warn("Failed to restore auth session:", error);
        initialCheckDone = true;
        syncSession(null);
      });

    return () => subscription.unsubscribe();
  }, []);

  const signOut = async () => {
    await logActivity({ action: "sign_out", category: "auth" });
    localStorage.removeItem("signcms_remember_me");
    sessionStorage.removeItem("signcms_session_active");
    clearPreferences();
    clearProfiles();
    await supabase.auth.signOut();
  };

  return (
    <AuthContext.Provider value={{ user, session, loading, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}
