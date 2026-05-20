-- Set `search_path = public, pg_temp` on the remaining SECURITY DEFINER
-- functions that were declared without one. A SECURITY DEFINER function
-- without a locked search_path is vulnerable to schema-shadowing: a user
-- who can CREATE OBJECT in a writable schema that's earlier on the path
-- can override an unqualified reference inside the function.
--
-- Functions covered here (the four found by sweep):
--   public.enqueue_email
--   public.read_email_batch
--   public.delete_email
--   public.move_to_dlq
--   public.queue_call_specific
--
-- All other SECURITY DEFINER funcs in the codebase already set search_path
-- (verified by grep).

CREATE OR REPLACE FUNCTION public.enqueue_email(queue_name TEXT, payload JSONB)
RETURNS BIGINT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  RETURN pgmq.send(queue_name, payload);
EXCEPTION WHEN undefined_table THEN
  PERFORM pgmq.create(queue_name);
  RETURN pgmq.send(queue_name, payload);
END;
$$;

CREATE OR REPLACE FUNCTION public.read_email_batch(queue_name TEXT, batch_size INT, vt INT)
RETURNS TABLE(msg_id BIGINT, read_ct INT, message JSONB)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  RETURN QUERY SELECT r.msg_id, r.read_ct, r.message FROM pgmq.read(queue_name, vt, batch_size) r;
EXCEPTION WHEN undefined_table THEN
  PERFORM pgmq.create(queue_name);
  RETURN;
END;
$$;

CREATE OR REPLACE FUNCTION public.delete_email(queue_name TEXT, message_id BIGINT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  RETURN pgmq.delete(queue_name, message_id);
EXCEPTION WHEN undefined_table THEN
  RETURN FALSE;
END;
$$;

CREATE OR REPLACE FUNCTION public.move_to_dlq(
  source_queue TEXT, dlq_name TEXT, message_id BIGINT, payload JSONB
)
RETURNS BIGINT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
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
$$;

CREATE OR REPLACE FUNCTION public.queue_call_specific(
  p_queue_id uuid,
  p_number   integer,
  p_counter  text DEFAULT ''
)
RETURNS public.queue_system_tickets
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_ticket public.queue_system_tickets;
BEGIN
  UPDATE public.queue_system_tickets
  SET status       = 'calling',
      counter_name = p_counter,
      called_at    = now()
  WHERE id = (
    SELECT id FROM public.queue_system_tickets
    WHERE queue_id = p_queue_id AND number = p_number AND status = 'waiting'
    ORDER BY created_at ASC
    LIMIT 1
    FOR UPDATE SKIP LOCKED
  )
  RETURNING * INTO v_ticket;

  IF v_ticket IS NULL THEN
    INSERT INTO public.queue_system_tickets (queue_id, number, status, counter_name, called_at)
    VALUES (p_queue_id, p_number, 'calling', p_counter, now())
    RETURNING * INTO v_ticket;
  END IF;

  UPDATE public.queue_system_queues
  SET current_number = GREATEST(current_number, p_number),
      updated_at     = now()
  WHERE id = p_queue_id;

  RETURN v_ticket;
END;
$$;

-- Keep existing privileges intact; redeclaring above does not change
-- ownership or per-grantee EXECUTE. queue_call_specific should be
-- authenticated-only; the earlier P1-16 sweep already revoked from anon.
REVOKE EXECUTE ON FUNCTION public.queue_call_specific(uuid, integer, text) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.queue_call_specific(uuid, integer, text) TO authenticated;
