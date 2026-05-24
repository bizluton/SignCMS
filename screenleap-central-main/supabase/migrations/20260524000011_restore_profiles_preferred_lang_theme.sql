-- Schema drift fix: profiles.preferred_lang and preferred_theme were declared
-- in migration 20260416165933 (and the auto-generated types.ts file reflects
-- them), but they were missing from the live DB. The frontend's usePreferences
-- hook GETs and PATCHes these columns, causing 400 BAD REQUEST on every
-- dashboard page load. The cascading failure may also have been what surfaced
-- as the invitations 403 today.
--
-- Fix: restore the columns. Defaults match the original migration.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS preferred_lang TEXT DEFAULT 'zh-TW',
  ADD COLUMN IF NOT EXISTS preferred_theme TEXT DEFAULT 'light';
