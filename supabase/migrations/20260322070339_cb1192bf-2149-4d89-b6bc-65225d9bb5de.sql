
-- Add missing columns to screens
ALTER TABLE public.screens ADD COLUMN IF NOT EXISTS location text NOT NULL DEFAULT '';
ALTER TABLE public.screens ADD COLUMN IF NOT EXISTS online boolean NOT NULL DEFAULT false;

-- Add missing columns to schedules
ALTER TABLE public.schedules ADD COLUMN IF NOT EXISTS start_time text NOT NULL DEFAULT '09:00';
ALTER TABLE public.schedules ADD COLUMN IF NOT EXISTS end_time text NOT NULL DEFAULT '18:00';
ALTER TABLE public.schedules ADD COLUMN IF NOT EXISTS days text[] NOT NULL DEFAULT ARRAY['一','二','三','四','五'];
ALTER TABLE public.schedules ADD COLUMN IF NOT EXISTS enabled boolean NOT NULL DEFAULT true;
