-- Backfill existing media_items.url + thumbnail to use the CDN host.
--
-- New uploads (upload-media) and transcoded MP4s (transcode-callback)
-- already rewrite the host when MEDIA_CDN_BASE_URL is set. This migration
-- updates the historical rows so all players consistently hit the CDN.
--
-- The migration is INERT until the operator picks a CDN host:
--   SELECT public.rewrite_media_urls_to_cdn('narhbpojjtnalyfiwxue.supabase.co', 'cdn.signcms.net');
--
-- It does a single bulk UPDATE over media_items, swapping the host portion
-- of url + thumbnail. Idempotent: re-running with the same args is a no-op.
--
-- To roll back:
--   SELECT public.rewrite_media_urls_to_cdn('cdn.signcms.net', 'narhbpojjtnalyfiwxue.supabase.co');

CREATE OR REPLACE FUNCTION public.rewrite_media_urls_to_cdn(
  p_from_host text,
  p_to_host   text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_url_changed   int;
  v_thumb_changed int;
  v_from text;
  v_to   text;
BEGIN
  IF NOT public.is_system_admin(auth.uid()) THEN
    RETURN jsonb_build_object('success', false, 'error', 'forbidden');
  END IF;
  IF p_from_host IS NULL OR length(trim(p_from_host)) = 0 OR
     p_to_host   IS NULL OR length(trim(p_to_host))   = 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'invalid_hosts');
  END IF;

  -- We match against the canonical "https://<host>/" prefix to avoid
  -- accidentally substring-replacing the host inside a query parameter.
  v_from := 'https://' || p_from_host || '/';
  v_to   := 'https://' || p_to_host   || '/';

  -- Bulk URL rewrite. Skip rows whose URL doesn't start with v_from (no-op).
  WITH upd AS (
    UPDATE public.media_items
       SET url = v_to || substring(url FROM length(v_from) + 1)
     WHERE url LIKE v_from || '%'
    RETURNING 1
  )
  SELECT count(*) INTO v_url_changed FROM upd;

  WITH upd AS (
    UPDATE public.media_items
       SET thumbnail = v_to || substring(thumbnail FROM length(v_from) + 1)
     WHERE thumbnail LIKE v_from || '%'
    RETURNING 1
  )
  SELECT count(*) INTO v_thumb_changed FROM upd;

  INSERT INTO public.activity_logs (
    user_id, category, action, action_code, action_params,
    target_type, detail
  ) VALUES (
    auth.uid(),
    'system',
    'rewrite_media_urls_to_cdn',
    'system.rewrite_media_urls_to_cdn',
    jsonb_build_object(
      'from_host',     p_from_host,
      'to_host',       p_to_host,
      'url_updated',   v_url_changed,
      'thumb_updated', v_thumb_changed
    ),
    'media_items',
    format('Rewrote %s url + %s thumbnail rows: %s → %s',
           v_url_changed, v_thumb_changed, p_from_host, p_to_host)
  );

  RETURN jsonb_build_object(
    'success', true,
    'url_updated',   v_url_changed,
    'thumb_updated', v_thumb_changed
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.rewrite_media_urls_to_cdn(text, text) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.rewrite_media_urls_to_cdn(text, text) TO authenticated;

COMMENT ON FUNCTION public.rewrite_media_urls_to_cdn(text, text) IS
  'Bulk-rewrite media_items.url + .thumbnail host. System admin only. Idempotent and reversible.';
