-- 1. Plan tier enum
CREATE TYPE public.plan_tier AS ENUM ('evaluation','starter','business','professional','enterprise');

-- 2. Add plan_tier to organizations
ALTER TABLE public.organizations
  ADD COLUMN plan_tier public.plan_tier NOT NULL DEFAULT 'evaluation';

-- 3. Add size_bytes to media_items
ALTER TABLE public.media_items
  ADD COLUMN size_bytes bigint NOT NULL DEFAULT 0;

-- Best-effort backfill from existing text size (e.g. "2.5 MB", "512 KB", "1.2 GB", "800 B")
UPDATE public.media_items SET size_bytes = (
  CASE
    WHEN size IS NULL OR btrim(size) = '' THEN 0
    WHEN size ~* '([0-9]+\.?[0-9]*)\s*GB' THEN
      (regexp_replace(size, '[^0-9.]', '', 'g'))::numeric * 1024 * 1024 * 1024
    WHEN size ~* '([0-9]+\.?[0-9]*)\s*MB' THEN
      (regexp_replace(size, '[^0-9.]', '', 'g'))::numeric * 1024 * 1024
    WHEN size ~* '([0-9]+\.?[0-9]*)\s*KB' THEN
      (regexp_replace(size, '[^0-9.]', '', 'g'))::numeric * 1024
    WHEN size ~* '([0-9]+\.?[0-9]*)\s*B'  THEN
      (regexp_replace(size, '[^0-9.]', '', 'g'))::numeric
    ELSE 0
  END
)::bigint
WHERE size_bytes = 0;

-- 4. Plan limits helper. -1 means unlimited.
CREATE OR REPLACE FUNCTION public.get_plan_limits(_tier public.plan_tier)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE _tier
    WHEN 'evaluation'   THEN jsonb_build_object('media_bytes', 100*1024*1024::bigint, 'max_screens', 3,  'max_apps', 2)
    WHEN 'starter'      THEN jsonb_build_object('media_bytes', 100*1024*1024::bigint, 'max_screens', 3,  'max_apps', 0)
    WHEN 'business'     THEN jsonb_build_object('media_bytes', 500*1024*1024::bigint, 'max_screens', 10, 'max_apps', 2)
    WHEN 'professional' THEN jsonb_build_object('media_bytes', 1024*1024*1024::bigint, 'max_screens', 30, 'max_apps', 5)
    WHEN 'enterprise'   THEN jsonb_build_object('media_bytes', 5::bigint*1024*1024*1024, 'max_screens', -1,'max_apps', -1)
  END;
$$;

-- 5. Trigger: enforce screen count limit on insert
CREATE OR REPLACE FUNCTION public.enforce_screen_limit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tier public.plan_tier;
  v_max int;
  v_current int;
BEGIN
  SELECT plan_tier INTO v_tier FROM public.organizations WHERE id = NEW.org_id;
  IF v_tier IS NULL THEN RETURN NEW; END IF;
  v_max := (public.get_plan_limits(v_tier)->>'max_screens')::int;
  IF v_max < 0 THEN RETURN NEW; END IF;
  SELECT count(*) INTO v_current FROM public.screens WHERE org_id = NEW.org_id;
  IF v_current >= v_max THEN
    RAISE EXCEPTION 'screen_limit_exceeded: plan % allows max % screens', v_tier, v_max
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_screen_limit ON public.screens;
CREATE TRIGGER trg_enforce_screen_limit
BEFORE INSERT ON public.screens
FOR EACH ROW EXECUTE FUNCTION public.enforce_screen_limit();

-- 6. Trigger: enforce media library byte capacity on insert
CREATE OR REPLACE FUNCTION public.enforce_media_capacity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tier public.plan_tier;
  v_max bigint;
  v_current bigint;
BEGIN
  SELECT plan_tier INTO v_tier FROM public.organizations WHERE id = NEW.org_id;
  IF v_tier IS NULL THEN RETURN NEW; END IF;
  v_max := (public.get_plan_limits(v_tier)->>'media_bytes')::bigint;
  IF v_max < 0 THEN RETURN NEW; END IF;
  SELECT COALESCE(sum(size_bytes), 0) INTO v_current FROM public.media_items WHERE org_id = NEW.org_id;
  IF v_current + COALESCE(NEW.size_bytes, 0) > v_max THEN
    RAISE EXCEPTION 'media_capacity_exceeded: plan % allows max % bytes (current=%, new=%)',
      v_tier, v_max, v_current, COALESCE(NEW.size_bytes, 0)
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_media_capacity ON public.media_items;
CREATE TRIGGER trg_enforce_media_capacity
BEFORE INSERT ON public.media_items
FOR EACH ROW EXECUTE FUNCTION public.enforce_media_capacity();

-- 7. Allow system admin / CS agent to update plan_tier (CS agents already can update org license; this just clarifies via comment).
COMMENT ON COLUMN public.organizations.plan_tier IS 'Subscription plan tier; only system admin / CS agents update it via existing org update RLS.';