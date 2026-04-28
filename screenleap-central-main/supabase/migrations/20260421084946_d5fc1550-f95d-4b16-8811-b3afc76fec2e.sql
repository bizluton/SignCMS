
-- 1. Fix knowledge_tags UPDATE policy: restrict to creator, admins, org_admins, or active CS agents
DROP POLICY IF EXISTS "Authenticated can update knowledge_tags" ON public.knowledge_tags;
CREATE POLICY "Creators or admins can update knowledge_tags"
ON public.knowledge_tags
FOR UPDATE
TO authenticated
USING (
  created_by = auth.uid()
  OR public.has_role(auth.uid(), 'admin'::public.app_role)
  OR public.is_org_admin(auth.uid())
  OR public.is_active_cs_agent(auth.uid())
)
WITH CHECK (
  created_by = auth.uid()
  OR public.has_role(auth.uid(), 'admin'::public.app_role)
  OR public.is_org_admin(auth.uid())
  OR public.is_active_cs_agent(auth.uid())
);

-- 2. Fix screen_logs SELECT: drop the policy with the open `org_id IS NULL` branch.
-- The other SELECT policy ("Users can view screen logs in their org") already
-- correctly handles org-scoped reads + admin override.
DROP POLICY IF EXISTS "Users can view logs in their org or admins see all" ON public.screen_logs;

-- 3. Fix get_plan_limits: set immutable search_path
CREATE OR REPLACE FUNCTION public.get_plan_limits(_tier public.plan_tier)
 RETURNS jsonb
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  SELECT CASE _tier
    WHEN 'evaluation'   THEN jsonb_build_object('media_bytes', 100*1024*1024::bigint, 'max_screens', 3,  'max_apps', 2)
    WHEN 'starter'      THEN jsonb_build_object('media_bytes', 100*1024*1024::bigint, 'max_screens', 3,  'max_apps', 0)
    WHEN 'business'     THEN jsonb_build_object('media_bytes', 500*1024*1024::bigint, 'max_screens', 10, 'max_apps', 2)
    WHEN 'professional' THEN jsonb_build_object('media_bytes', 1024*1024*1024::bigint, 'max_screens', 30, 'max_apps', 5)
    WHEN 'enterprise'   THEN jsonb_build_object('media_bytes', 5::bigint*1024*1024*1024, 'max_screens', -1,'max_apps', -1)
  END;
$function$;

-- 4. Fix realtime.messages: replace the always-true policy with a topic-scoped one.
-- Authenticated users may only subscribe to topics that include their own user id,
-- system admins, org_admins, and active CS agents may subscribe to any topic
-- (they need broad visibility for support / admin dashboards).
DROP POLICY IF EXISTS "Authenticated users can use realtime" ON realtime.messages;

CREATE POLICY "Users can subscribe to their own or postgres_changes topics"
ON realtime.messages
FOR SELECT
TO authenticated
USING (
  -- Privileged roles can subscribe to anything (admins, org_admins, CS agents)
  public.has_role(auth.uid(), 'admin'::public.app_role)
  OR public.is_org_admin(auth.uid())
  OR public.is_active_cs_agent(auth.uid())
  -- Per-user scoped topics must contain the caller's uid
  OR realtime.topic() LIKE '%' || auth.uid()::text || '%'
  -- Postgres changes channels (table-level RLS still applies on row delivery)
  OR realtime.topic() LIKE 'realtime:%'
);

CREATE POLICY "Users can broadcast to their own topics"
ON realtime.messages
FOR INSERT
TO authenticated
WITH CHECK (
  public.has_role(auth.uid(), 'admin'::public.app_role)
  OR public.is_org_admin(auth.uid())
  OR public.is_active_cs_agent(auth.uid())
  OR realtime.topic() LIKE '%' || auth.uid()::text || '%'
);
