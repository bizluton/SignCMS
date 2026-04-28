-- 1. Add org_admin to app_role enum
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'org_admin';

-- 2. Drop duplicate cs_agent trigger
DROP TRIGGER IF EXISTS on_auth_user_created_link_cs_agent ON auth.users;
DROP FUNCTION IF EXISTS public.handle_cs_agent_signup();