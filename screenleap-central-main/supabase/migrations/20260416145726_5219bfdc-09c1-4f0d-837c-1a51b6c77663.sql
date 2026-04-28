
-- 1. Fix function search_path for email queue functions
CREATE OR REPLACE FUNCTION public.delete_email(queue_name text, message_id bigint)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
BEGIN
  RETURN pgmq.delete(queue_name, message_id);
EXCEPTION WHEN undefined_table THEN
  RETURN FALSE;
END;
$function$;

CREATE OR REPLACE FUNCTION public.enqueue_email(queue_name text, payload jsonb)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
BEGIN
  RETURN pgmq.send(queue_name, payload);
EXCEPTION WHEN undefined_table THEN
  PERFORM pgmq.create(queue_name);
  RETURN pgmq.send(queue_name, payload);
END;
$function$;

CREATE OR REPLACE FUNCTION public.move_to_dlq(source_queue text, dlq_name text, message_id bigint, payload jsonb)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE new_id BIGINT;
BEGIN
  SELECT pgmq.send(dlq_name, payload) INTO new_id;
  PERFORM pgmq.delete(source_queue, message_id);
  RETURN new_id;
EXCEPTION WHEN undefined_table THEN
  BEGIN
    PERFORM pgmq.create(dlq_name);
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;
  SELECT pgmq.send(dlq_name, payload) INTO new_id;
  BEGIN
    PERFORM pgmq.delete(source_queue, message_id);
  EXCEPTION WHEN undefined_table THEN
    NULL;
  END;
  RETURN new_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.read_email_batch(queue_name text, batch_size integer, vt integer)
RETURNS TABLE(msg_id bigint, read_ct integer, message jsonb)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
BEGIN
  RETURN QUERY SELECT r.msg_id, r.read_ct, r.message FROM pgmq.read(queue_name, vt, batch_size) r;
EXCEPTION WHEN undefined_table THEN
  PERFORM pgmq.create(queue_name);
  RETURN;
END;
$function$;

-- 2. Fix IoT sensor readings INSERT policy (restrict to org members)
DROP POLICY IF EXISTS "Authenticated can insert sensor readings" ON public.iot_sensor_readings;
CREATE POLICY "Org members can insert sensor readings"
  ON public.iot_sensor_readings FOR INSERT TO authenticated
  WITH CHECK (
    has_role(auth.uid(), 'admin'::app_role)
    OR (org_id IS NOT NULL AND user_in_org(auth.uid(), org_id))
  );

-- 3. Fix playback_logs INSERT policy (restrict to org members)
DROP POLICY IF EXISTS "Authenticated users can insert playback logs" ON public.playback_logs;
CREATE POLICY "Org members can insert playback logs"
  ON public.playback_logs FOR INSERT TO authenticated
  WITH CHECK (
    has_role(auth.uid(), 'admin'::app_role)
    OR (org_id IS NOT NULL AND user_in_org(auth.uid(), org_id))
  );

-- 4. Fix chat_session_tags SELECT policy (restrict to admin/CS agent)
DROP POLICY IF EXISTS "Authenticated can view session tags" ON public.chat_session_tags;
CREATE POLICY "Admins can view session tags"
  ON public.chat_session_tags FOR SELECT TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role));

-- 5. Fix knowledge-files storage SELECT policy (restrict to org members)
DROP POLICY IF EXISTS "Authenticated users can view knowledge files" ON storage.objects;
CREATE POLICY "Authorized users can view knowledge files"
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'knowledge-files'
    AND (
      has_role(auth.uid(), 'admin'::app_role)
      OR is_active_cs_agent(auth.uid())
      OR EXISTS (
        SELECT 1 FROM public.knowledge_files kf
        JOIN public.knowledge_items ki ON ki.id = kf.knowledge_item_id
        WHERE kf.storage_path = name
          AND (ki.org_id IS NULL OR user_in_org(auth.uid(), ki.org_id))
      )
    )
  );

-- 6. Add Realtime authorization policy
CREATE POLICY "Authenticated users can use realtime"
  ON realtime.messages FOR SELECT TO authenticated
  USING (true);
