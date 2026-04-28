/**
 * Server-side preference persistence via Supabase profiles table.
 */
import { supabase } from "@/integrations/supabase/client";

export interface UserPreferences {
  preferred_lang: string;
  preferred_theme: string;
}

/** Fetch current user's preferences from profile */
export async function fetchPreferences(): Promise<UserPreferences | null> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const { data, error } = await supabase
    .from("profiles")
    .select("preferred_lang, preferred_theme")
    .eq("user_id", user.id)
    .maybeSingle();

  if (error || !data) return null;
  return {
    preferred_lang: data.preferred_lang ?? "zh-TW",
    preferred_theme: data.preferred_theme ?? "light",
  };
}

/** Update current user's preferences (fire-and-forget safe) */
export async function patchPreferences(prefs: Partial<UserPreferences>): Promise<void> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return;

  await supabase
    .from("profiles")
    .update(prefs)
    .eq("user_id", user.id);
}
