
-- Add preference columns to profiles table
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS preferred_lang TEXT DEFAULT 'zh-TW',
  ADD COLUMN IF NOT EXISTS preferred_theme TEXT DEFAULT 'light';
