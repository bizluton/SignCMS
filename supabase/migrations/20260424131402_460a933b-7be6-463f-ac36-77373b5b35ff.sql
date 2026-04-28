-- Enrich audit logging for media soft-delete lifecycle:
-- record explicit status (success/failed) and capture failed restore/purge attempts.

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
  v_media_name text;
  v_error text;
BEGIN
  IF v_uid IS NULL OR auth.role() <> 'authenticated' THEN
    RETURN jsonb_build_object('success', false, 'error', 'unauthenticated');
  END IF;

  SELECT org_id, deleted_at, COALESCE(original_name, name)
    INTO v_org_id, v_deleted_at, v_media_name
    FROM public.media_items WHERE id = _media_id;

  IF v_org_id IS NULL THEN
    v_error := 'not_found';
  ELSIF v_deleted_at IS NULL THEN
    v_error := 'not_deleted';
  ELSIF v_deleted_at < now() - interval '7 days' THEN
    v_error := 'restore_window_expired';
  ELSIF NOT (public.is_system_admin(v_uid) OR public.user_in_org(v_uid, v_org_id)) THEN
    v_error := 'forbidden';
  END IF;

  IF v_error IS NOT NULL THEN
    INSERT INTO public.activity_logs (user_id, category, action, action_code, action_params, target_type, target_id, target_name, detail, org_id)
    VALUES (
      v_uid, 'media', 'restore_soft_deleted_media', 'media.restore_soft_deleted',
      jsonb_build_object('status', 'failed', 'error', v_error, 'media_id', _media_id::text),
      'media', _media_id::text, COALESCE(v_media_name, ''),
      'Restore failed (' || v_error || ') for media item ' || _media_id::text,
      v_org_id
    );
    RETURN jsonb_build_object('success', false, 'error', v_error);
  END IF;

  UPDATE public.media_items SET deleted_at = NULL WHERE id = _media_id;

  INSERT INTO public.activity_logs (user_id, category, action, action_code, action_params, target_type, target_id, target_name, detail, org_id)
  VALUES (
    v_uid, 'media', 'restore_soft_deleted_media', 'media.restore_soft_deleted',
    jsonb_build_object('status', 'success', 'media_id', _media_id::text, 'restored_at', now()),
    'media', _media_id::text, COALESCE(v_media_name, ''),
    'Restored soft-deleted media item ' || COALESCE(v_media_name, _media_id::text),
    v_org_id
  );

  RETURN jsonb_build_object('success', true);
END;
$$;

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
  v_media_name text;
  v_error text;
BEGIN
  IF v_uid IS NULL OR auth.role() <> 'authenticated' THEN
    RETURN jsonb_build_object('success', false, 'error', 'unauthenticated');
  END IF;

  SELECT org_id, deleted_at, COALESCE(original_name, name)
    INTO v_org_id, v_deleted_at, v_media_name
    FROM public.media_items WHERE id = _media_id;

  IF v_org_id IS NULL THEN
    v_error := 'not_found';
  ELSIF v_deleted_at IS NULL THEN
    v_error := 'not_deleted';
  ELSIF NOT (public.is_system_admin(v_uid) OR public.user_in_org(v_uid, v_org_id)) THEN
    v_error := 'forbidden';
  END IF;

  IF v_error IS NOT NULL THEN
    INSERT INTO public.activity_logs (user_id, category, action, action_code, action_params, target_type, target_id, target_name, detail, org_id)
    VALUES (
      v_uid, 'media', 'purge_soft_deleted_media_item', 'media.purge_soft_deleted_item',
      jsonb_build_object('status', 'failed', 'error', v_error, 'media_id', _media_id::text),
      'media', _media_id::text, COALESCE(v_media_name, ''),
      'Purge failed (' || v_error || ') for media item ' || _media_id::text,
      v_org_id
    );
    RETURN jsonb_build_object('success', false, 'error', v_error);
  END IF;

  DELETE FROM public.media_items WHERE id = _media_id;

  INSERT INTO public.activity_logs (user_id, category, action, action_code, action_params, target_type, target_id, target_name, detail, org_id)
  VALUES (
    v_uid, 'media', 'purge_soft_deleted_media_item', 'media.purge_soft_deleted_item',
    jsonb_build_object('status', 'success', 'media_id', _media_id::text, 'purged_at', now()),
    'media', _media_id::text, COALESCE(v_media_name, ''),
    'Permanently purged soft-deleted media item ' || COALESCE(v_media_name, _media_id::text),
    v_org_id
  );

  RETURN jsonb_build_object('success', true);
END;
$$;