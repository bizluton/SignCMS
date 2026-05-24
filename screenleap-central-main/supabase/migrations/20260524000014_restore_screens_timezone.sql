-- Schema drift fix #3: screens.timezone declared in the auto-generated
-- types.ts but missing in the live DB. Default 'UTC' is safe (matches the
-- frontend fallback in ScreenHealthScheduleDialog and elsewhere).
ALTER TABLE public.screens
  ADD COLUMN IF NOT EXISTS timezone text DEFAULT 'UTC';
