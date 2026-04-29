/**
 * ProfilesContext — global cache for user profile metadata (display_name, avatar_url).
 *
 * Why: many pages (Media, ActivityLog, DeviceLogs, Tickets, ...) need to render
 * uploader / operator / agent names + avatars. Without a shared cache each page
 * issues its own `from("profiles")` query, sometimes per-row.
 *
 * Usage:
 *   const { ensureProfiles, getProfile, profilesVersion } = useProfiles();
 *   useEffect(() => { ensureProfiles(userIds); }, [userIds.join(",")]);
 *   const p = getProfile(someUserId); // { display_name, avatar_url } | undefined
 *
 * `profilesVersion` bumps whenever new profiles are merged in, so consumers can
 * include it in `useMemo` deps to re-render when missing entries arrive.
 *
 * On logout: AuthContext.signOut() calls `clearProfiles()` to evict the cache
 * so the next account does not see stale names/avatars.
 *
 * On profile edits (display_name / avatar_url): callers should invoke
 * `refreshProfiles([userId])` (or use the `updateProfile` helper) so every
 * mounted consumer re-renders with the new value.
 */
import { createContext, useCallback, useContext, useRef, useState, ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";

export interface ProfileLite {
  user_id: string;
  display_name: string | null;
  avatar_url: string | null;
}

interface ProfilesContextType {
  /** Ensure these user IDs are loaded. Skips IDs already cached (or in-flight). */
  ensureProfiles: (userIds: (string | null | undefined)[]) => Promise<void>;
  /** Get a cached profile (undefined if not yet loaded). */
  getProfile: (userId: string | null | undefined) => ProfileLite | undefined;
  /** Convenience: best-effort display name with fallback. */
  getDisplayName: (userId: string | null | undefined, fallback?: string) => string;
  /** Bumps when the cache changes — use in `useMemo` deps. */
  profilesVersion: number;
  /** Force refresh given IDs from server (ignores cache). */
  refreshProfiles: (userIds: string[]) => Promise<void>;
  /** Clear the entire cache (e.g. on logout). */
  clearProfiles: () => void;
  /**
   * Update a profile's display_name / avatar_url AND refresh the cache so
   * every consumer re-renders. Returns the Supabase error if any.
   */
  updateProfile: (
    userId: string,
    patch: { display_name?: string | null; avatar_url?: string | null }
  ) => Promise<{ error: unknown } | { error: null }>;
}

const ProfilesContext = createContext<ProfilesContextType>({
  ensureProfiles: async () => {},
  getProfile: () => undefined,
  getDisplayName: (_id, fallback = "") => fallback,
  profilesVersion: 0,
  refreshProfiles: async () => {},
  clearProfiles: () => {},
  updateProfile: async () => ({ error: null }),
});

export const useProfiles = () => useContext(ProfilesContext);

export function ProfilesProvider({ children }: { children: ReactNode }) {
  // Refs so callbacks stay stable across renders.
  const cacheRef = useRef<Map<string, ProfileLite>>(new Map());
  const inFlightRef = useRef<Map<string, Promise<void>>>(new Map());
  const [profilesVersion, setProfilesVersion] = useState(0);

  const fetchAndStore = useCallback(async (idsToFetch: string[]) => {
    if (idsToFetch.length === 0) return;
    const { data } = await supabase
      .from("profiles")
      .select("user_id, display_name, avatar_url")
      .in("user_id", idsToFetch);
    for (const p of (data || []) as ProfileLite[]) {
      cacheRef.current.set(p.user_id, p);
    }
    // Mark IDs that returned no row, so we don't re-query them constantly.
    for (const id of idsToFetch) {
      if (!cacheRef.current.has(id)) {
        cacheRef.current.set(id, { user_id: id, display_name: null, avatar_url: null });
      }
    }
    setProfilesVersion((v) => v + 1);
  }, []);

  const ensureProfiles = useCallback(async (userIds: (string | null | undefined)[]) => {
    const unique = Array.from(new Set(userIds.filter((id): id is string => !!id)));
    const missing = unique.filter((id) => !cacheRef.current.has(id) && !inFlightRef.current.has(id));
    if (missing.length === 0) {
      // Still await any in-flight ones the caller cares about.
      const pending = unique.map((id) => inFlightRef.current.get(id)).filter(Boolean) as Promise<void>[];
      if (pending.length) await Promise.all(pending);
      return;
    }
    const promise = fetchAndStore(missing).finally(() => {
      for (const id of missing) inFlightRef.current.delete(id);
    });
    for (const id of missing) inFlightRef.current.set(id, promise);
    await promise;
  }, [fetchAndStore]);

  const refreshProfiles = useCallback(async (userIds: string[]) => {
    const unique = Array.from(new Set(userIds.filter(Boolean)));
    if (unique.length === 0) return;
    for (const id of unique) cacheRef.current.delete(id);
    await fetchAndStore(unique);
  }, [fetchAndStore]);

  const getProfile = useCallback((userId: string | null | undefined) => {
    if (!userId) return undefined;
    return cacheRef.current.get(userId);
  }, []);

  const getDisplayName = useCallback((userId: string | null | undefined, fallback = "") => {
    if (!userId) return fallback;
    return cacheRef.current.get(userId)?.display_name || fallback;
  }, []);

  const clearProfiles = useCallback(() => {
    cacheRef.current.clear();
    inFlightRef.current.clear();
    setProfilesVersion((v) => v + 1);
  }, []);

  const updateProfile = useCallback(async (
    userId: string,
    patch: { display_name?: string | null; avatar_url?: string | null }
  ) => {
    const { error } = await supabase
      .from("profiles")
      .update(patch)
      .eq("user_id", userId);
    if (error) return { error };
    await refreshProfiles([userId]);
    return { error: null };
  }, [refreshProfiles]);

  return (
    <ProfilesContext.Provider
      value={{ ensureProfiles, getProfile, getDisplayName, profilesVersion, refreshProfiles, clearProfiles, updateProfile }}
    >
      {children}
    </ProfilesContext.Provider>
  );
}
