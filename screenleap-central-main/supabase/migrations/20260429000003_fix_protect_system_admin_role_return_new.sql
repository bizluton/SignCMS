-- Fix: protect_system_admin_role() trigger was returning OLD instead of NEW
-- on the non-protected path, silently discarding every UPDATE to user_roles.
-- Also rebuilds sync_sysadmin_to_bizlution() to use UPSERT so adding a system
-- admin works even when the user already has an org_admin row with a different
-- (or null) org_id.
-- Backfills aec69a4a whose org_admin row had org_id=null instead of Bizlution.

CREATE OR REPLACE FUNCTION public.protect_system_admin_role()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF OLD.user_id = 'e07d7afb-0c88-4f41-80df-ee62a4aaf73d' AND OLD.role = 'admin' THEN
    RAISE EXCEPTION 'Cannot remove or modify the system administrator role';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.sync_sysadmin_to_bizlution()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_bizlution_id uuid;
BEGIN
  SELECT id INTO v_bizlution_id
  FROM public.organizations
  WHERE name = 'Bizlution'
  LIMIT 1;

  IF TG_OP = 'INSERT' THEN
    -- Upsert: handles the case where the user already has an org_admin row
    -- with a different/null org_id (unique constraint is on (user_id, role)).
    INSERT INTO public.user_roles (user_id, role, org_id)
    VALUES (NEW.user_id, 'org_admin', v_bizlution_id)
    ON CONFLICT (user_id, role) DO UPDATE SET org_id = v_bizlution_id;
    RETURN NEW;

  ELSIF TG_OP = 'DELETE' THEN
    DELETE FROM public.user_roles
    WHERE user_id = OLD.user_id
      AND role = 'org_admin'
      AND org_id = v_bizlution_id;
    RETURN OLD;
  END IF;

  RETURN NULL;
END;
$$;

-- Backfill: point existing aec69a4a org_admin row at Bizlution
UPDATE public.user_roles
SET org_id = (SELECT id FROM public.organizations WHERE name = 'Bizlution' LIMIT 1)
WHERE user_id = 'aec69a4a-b467-4def-8279-34c37e755c6e'
  AND role = 'org_admin';
