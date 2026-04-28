-- Soft-delete + 7-day restore window for auto media cleanup

-- 1. Add deleted_at column for soft-delete state
ALTER TABLE public.media_items
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz NULL;

CREATE INDEX IF NOT EXISTS idx_media_items_deleted_at
  ON public.media_items (deleted_at)
  WHERE deleted_at IS NOT NULL;

-- 2. Update auto_delete_unused_media to soft-delete (mark) instead of hard-delete.
--    Items already soft-deleted are not re-counted.
CREATE OR REPLACE FUNCTION public.auto_delete_unused_media()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_enabled boolean;
  v_retention integer;
  v_cutoff timestamptz;
  v_deleted integer := 0;
  v_used_media_ids uuid[];
BEGIN
  SELECT media_enabled, COALESCE(media_retention_days, 90)
    INTO v_enabled, v_retention
  FROM public.schedule_cleanup_settings
  WHERE id = 1;

  IF NOT COALESCE(v_enabled, false) THEN
    RETURN 0;
  END IF;

  IF v_retention < 1 THEN v_retention := 1; END IF;
  v_cutoff := now() - make_interval(days => v_retention);

  WITH active_projects AS (
    SELECT id FROM public._active_design_project_ids()
  ),
  zone_media AS (
    SELECT (mi->>'id')::uuid AS media_id
    FROM public.design_projects p
    JOIN active_projects ap ON ap.id = p.id,
         LATERAL jsonb_array_elements(COALESCE(p.zones, '[]'::jsonb)) AS z,
         LATERAL jsonb_array_elements(COALESCE(z->'content'->'mediaItems', '[]'::jsonb)) AS mi
    WHERE jsonb_typeof(p.zones) = 'array'
      AND (mi->>'id') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  ),
  overlay_media AS (
    SELECT (mi->>'id')::uuid AS media_id
    FROM public.design_projects p
    JOIN active_projects ap ON ap.id = p.id,
         LATERAL jsonb_array_elements(COALESCE(p.zones, '[]'::jsonb)) AS z,
         LATERAL jsonb_array_elements(COALESCE(z->'overlays', '[]'::jsonb)) AS ov,
         LATERAL jsonb_array_elements(COALESCE(ov->'content'->'mediaItems', '[]'::jsonb)) AS mi
    WHERE jsonb_typeof(p.zones) = 'array'
      AND (mi->>'id') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  ),
  bgm_zone_media AS (
    SELECT (a->>'id')::uuid AS media_id
    FROM public.design_projects p
    JOIN active_projects ap ON ap.id = p.id,
         LATERAL jsonb_array_elements(COALESCE(p.zones, '[]'::jsonb)) AS z,
         LATERAL jsonb_array_elements(COALESCE(z->'bgm'->'items', '[]'::jsonb)) AS a
    WHERE jsonb_typeof(p.zones) = 'array'
      AND (a->>'id') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  ),
  bound_media AS (
    SELECT m.id AS media_id
    FROM public.media_items m
    JOIN active_projects ap ON ap.id = m.design_project_id
  ),
  bgm_items AS (
    SELECT cbi.media_id FROM public.channel_bgm_items cbi
  )
  SELECT array_agg(DISTINCT media_id)
    INTO v_used_media_ids
  FROM (
    SELECT media_id FROM zone_media
    UNION ALL SELECT media_id FROM overlay_media
    UNION ALL SELECT media_id FROM bgm_zone_media
    UNION ALL SELECT media_id FROM bound_media
    UNION ALL SELECT media_id FROM bgm_items
  ) u
  WHERE media_id IS NOT NULL;

  IF v_used_media_ids IS NULL THEN
    v_used_media_ids := ARRAY[]::uuid[];
  END IF;

  -- Soft-delete: mark unused items, skip already-trashed and system items.
  WITH del AS (
    UPDATE public.media_items m
       SET deleted_at = now()
     WHERE m.is_system = false
       AND m.deleted_at IS NULL
       AND m.type IN ('image', 'video')
       AND m.created_at < v_cutoff
       AND NOT (m.id = ANY (v_used_media_ids))
    RETURNING m.id
  )
  SELECT count(*) INTO v_deleted FROM del;

  UPDATE public.schedule_cleanup_settings
     SET media_last_run_at = now(),
         media_last_deleted_count = v_deleted,
         updated_at = now()
   WHERE id = 1;

  INSERT INTO public.activity_logs (user_id, category, action, action_code, action_params, target_type, detail)
  VALUES (
    '00000000-0000-0000-0000-000000000000',
    'system',
    'media_cleanup_run',
    'system.media_cleanup_run',
    jsonb_build_object('deleted', v_deleted, 'retention_days', v_retention, 'mode', 'soft_delete'),
    'media',
    'Auto media cleanup soft-deleted ' || v_deleted || ' unused media item(s); restorable for 7 days'
  );

  RETURN v_deleted;
END;
$$;

-- 3. Purge soft-deleted items older than 7 days (hard delete from DB).
CREATE OR REPLACE FUNCTION public.purge_soft_deleted_media()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_purged integer := 0;
BEGIN
  WITH del AS (
    DELETE FROM public.media_items
     WHERE deleted_at IS NOT NULL
       AND deleted_at < now() - interval '7 days'
    RETURNING 1
  )
  SELECT count(*) INTO v_purged FROM del;

  IF v_purged > 0 THEN
    INSERT INTO public.activity_logs (user_id, category, action, action_code, action_params, target_type, detail)
    VALUES (
      '00000000-0000-0000-0000-000000000000',
      'system',
      'media_cleanup_purge',
      'system.media_cleanup_purge',
      jsonb_build_object('purged', v_purged),
      'media',
      'Permanently purged ' || v_purged || ' soft-deleted media item(s) past 7-day window'
    );
  END IF;

  RETURN v_purged;
END;
$$;

-- 4. Restore a single soft-deleted media item (caller must be in same org or system admin).
CREATE OR REPLACE FUNCTION public.restore_soft_deleted_media(_media_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_org_id uuid;
  v_deleted_at timestamptz;
BEGIN
  IF v_uid IS NULL OR auth.role() <> 'authenticated' THEN
    RETURN jsonb_build_object('success', false, 'error', 'unauthenticated');
  END IF;

  SELECT org_id, deleted_at INTO v_org_id, v_deleted_at
    FROM public.media_items WHERE id = _media_id;

  IF v_org_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'not_found');
  END IF;
  IF v_deleted_at IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'not_deleted');
  END IF;
  IF v_deleted_at < now() - interval '7 days' THEN
    RETURN jsonb_build_object('success', false, 'error', 'restore_window_expired');
  END IF;
  IF NOT (public.is_system_admin(v_uid) OR public.user_in_org(v_uid, v_org_id)) THEN
    RETURN jsonb_build_object('success', false, 'error', 'forbidden');
  END IF;

  UPDATE public.media_items SET deleted_at = NULL WHERE id = _media_id;

  INSERT INTO public.activity_logs (user_id, category, action, action_code, target_type, target_id, detail, org_id)
  VALUES (
    v_uid, 'media', 'restore_soft_deleted_media', 'media.restore_soft_deleted',
    'media', _media_id::text,
    'Restored soft-deleted media item ' || _media_id::text,
    v_org_id
  );

  RETURN jsonb_build_object('success', true);
END;
$$;

-- 5. Manually purge a soft-deleted item now (admin/org member).
CREATE OR REPLACE FUNCTION public.purge_soft_deleted_media_item(_media_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_org_id uuid;
  v_deleted_at timestamptz;
BEGIN
  IF v_uid IS NULL OR auth.role() <> 'authenticated' THEN
    RETURN jsonb_build_object('success', false, 'error', 'unauthenticated');
  END IF;

  SELECT org_id, deleted_at INTO v_org_id, v_deleted_at
    FROM public.media_items WHERE id = _media_id;

  IF v_org_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'not_found');
  END IF;
  IF v_deleted_at IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'not_deleted');
  END IF;
  IF NOT (public.is_system_admin(v_uid) OR public.user_in_org(v_uid, v_org_id)) THEN
    RETURN jsonb_build_object('success', false, 'error', 'forbidden');
  END IF;

  DELETE FROM public.media_items WHERE id = _media_id;

  INSERT INTO public.activity_logs (user_id, category, action, action_code, target_type, target_id, detail, org_id)
  VALUES (
    v_uid, 'media', 'purge_soft_deleted_media_item', 'media.purge_soft_deleted_item',
    'media', _media_id::text,
    'Permanently purged soft-deleted media item ' || _media_id::text,
    v_org_id
  );

  RETURN jsonb_build_object('success', true);
END;
$$;

-- Lock down execute privileges
REVOKE ALL ON FUNCTION public.purge_soft_deleted_media() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.restore_soft_deleted_media(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.purge_soft_deleted_media_item(uuid) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.restore_soft_deleted_media(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.purge_soft_deleted_media_item(uuid) TO authenticated;
-- purge_soft_deleted_media is intended for cron / system use; do not grant broadly.