-- ── Phase 3: Web Push notification infrastructure ────────────────────────────

-- ── 1. Enable pg_net (fire-and-forget HTTP from triggers) ────────────────────
CREATE EXTENSION IF NOT EXISTS pg_net SCHEMA extensions;

-- ── 2. App settings table (stores the push delivery key) ─────────────────────
-- The PUSH_DELIVERY_KEY is generated here, then the operator must also add it
-- as a Supabase secret (PUSH_DELIVERY_KEY) for the deliver-push edge function.
CREATE TABLE IF NOT EXISTS public.app_settings (
  key        text        NOT NULL PRIMARY KEY,
  value      text        NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "app_settings_sysadmin_all"
  ON public.app_settings FOR ALL TO authenticated
  USING  (public.is_system_admin(auth.uid()))
  WITH CHECK (public.is_system_admin(auth.uid()));

-- Generate and persist the push delivery key (only if not already set)
INSERT INTO public.app_settings (key, value)
VALUES ('push_delivery_key', 'pdlv_' || replace(gen_random_uuid()::text, '-', ''))
ON CONFLICT (key) DO NOTHING;

-- ── 3. Trigger function — calls deliver-push when screen goes offline ─────────
CREATE OR REPLACE FUNCTION public.fn_notify_screen_offline()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public, extensions
AS $$
DECLARE
  _key  text;
  _url  text;
BEGIN
  -- Only fire on online → offline transition
  IF OLD.online IS DISTINCT FROM NEW.online AND NEW.online = false THEN

    SELECT value INTO _key FROM public.app_settings WHERE key = 'push_delivery_key' LIMIT 1;
    IF _key IS NULL THEN RETURN NEW; END IF;

    -- Supabase project URL — stored in app_settings so it can be updated without migration
    SELECT value INTO _url FROM public.app_settings WHERE key = 'supabase_url' LIMIT 1;
    IF _url IS NULL THEN
      -- Fall back to the auto-set pg config parameter
      _url := current_setting('app.supabase_project_url', true);
    END IF;
    IF _url IS NULL OR _url = '' THEN RETURN NEW; END IF;

    -- Fire-and-forget HTTP POST (pg_net; 5-second timeout)
    PERFORM extensions.http_post(
      _url || '/functions/v1/deliver-push',
      json_build_object(
        'org_id',    NEW.org_id,
        'type',      'screen_offline',
        'reference', NEW.id::text,
        'payload',   json_build_object(
          'screen_name', NEW.name,
          'branch',      NEW.branch,
          'location',    NEW.location
        )
      )::text,
      'application/json',
      json_build_object('Authorization', 'Bearer ' || _key)::text
    );

  END IF;
  RETURN NEW;
END;
$$;

-- ── 4. Attach trigger to screens ──────────────────────────────────────────────
DROP TRIGGER IF EXISTS trg_screen_offline_push ON public.screens;

CREATE TRIGGER trg_screen_offline_push
  AFTER UPDATE OF online ON public.screens
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_notify_screen_offline();

-- ── 5. Store the Supabase project URL so the trigger can call the function ────
-- Update this if the project changes (or after applying this migration, set via:
--   UPDATE app_settings SET value = 'https://<ref>.supabase.co' WHERE key = 'supabase_url';
INSERT INTO public.app_settings (key, value)
VALUES ('supabase_url', 'https://narhbpojjtnalyfiwxue.supabase.co')
ON CONFLICT (key) DO NOTHING;
