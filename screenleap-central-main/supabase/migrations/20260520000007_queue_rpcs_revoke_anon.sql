-- Tighten access on queue_system SECURITY DEFINER RPCs.
--
-- Original problem (audit P1-#16):
--   These functions were created as SECURITY DEFINER with no explicit
--   GRANT/REVOKE. In Postgres the default behaviour grants EXECUTE to
--   PUBLIC, which includes the `anon` role. That allows any unauthenticated
--   caller to mutate ticket state via queue_call_next / queue_issue_ticket /
--   queue_reset / queue_issue_liff_ticket on any queue id they can guess
--   (queue ids are exposed via the public anon_read_qs_queues policy).
--
-- Plus, none of the queue SECURITY DEFINER functions set search_path, which
-- is a schema-shadowing risk.
--
-- This migration:
--   1. Locks the function search_path to public, pg_temp.
--   2. Revokes from PUBLIC and grants only to authenticated.
--
-- Note: kiosks / display widgets that currently call these RPCs as anon
-- must move to the signed-widget-params flow (sign-widget-params edge
-- function → JWT → authenticated session).

-- ── Re-declare each function with SET search_path ───────────────────────────

CREATE OR REPLACE FUNCTION public.queue_call_next(
  p_queue_id uuid,
  p_counter  text DEFAULT ''
)
RETURNS public.queue_system_tickets
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_ticket public.queue_system_tickets;
  v_next   integer;
BEGIN
  UPDATE public.queue_system_tickets
  SET status       = 'calling',
      counter_name = p_counter,
      called_at    = now()
  WHERE id = (
    SELECT id FROM public.queue_system_tickets
    WHERE queue_id = p_queue_id AND status = 'waiting'
    ORDER BY number ASC
    LIMIT 1
    FOR UPDATE SKIP LOCKED
  )
  RETURNING * INTO v_ticket;

  IF v_ticket IS NOT NULL THEN
    UPDATE public.queue_system_queues
    SET current_number = v_ticket.number, updated_at = now()
    WHERE id = p_queue_id;
    RETURN v_ticket;
  END IF;

  UPDATE public.queue_system_queues
  SET current_number = current_number + 1, updated_at = now()
  WHERE id = p_queue_id
  RETURNING current_number INTO v_next;

  IF v_next IS NULL THEN
    RAISE EXCEPTION 'queue_not_found';
  END IF;

  INSERT INTO public.queue_system_tickets (queue_id, number, status, counter_name, called_at)
  VALUES (p_queue_id, v_next, 'calling', p_counter, now())
  RETURNING * INTO v_ticket;

  RETURN v_ticket;
END;
$$;

CREATE OR REPLACE FUNCTION public.queue_reset(p_queue_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  UPDATE public.queue_system_queues
  SET current_number = 0, updated_at = now()
  WHERE id = p_queue_id;

  UPDATE public.queue_system_tickets
  SET status = 'done'
  WHERE queue_id = p_queue_id AND status IN ('waiting', 'calling');
END;
$$;

-- Note: queue_issue_ticket and queue_issue_liff_ticket are also re-declared
-- in 20260520000008 (race-condition fix). REVOKE/GRANT here still applies
-- because the later migration uses CREATE OR REPLACE which preserves
-- privileges per-function name (we re-apply just in case below).

-- ── Lock down privileges ────────────────────────────────────────────────────

REVOKE EXECUTE ON FUNCTION public.queue_call_next(uuid, text)         FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.queue_issue_ticket(uuid)            FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.queue_reset(uuid)                   FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.queue_issue_liff_ticket(uuid, text) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.queue_call_next(uuid, text)         TO authenticated;
GRANT EXECUTE ON FUNCTION public.queue_issue_ticket(uuid)            TO authenticated;
GRANT EXECUTE ON FUNCTION public.queue_reset(uuid)                   TO authenticated;
GRANT EXECUTE ON FUNCTION public.queue_issue_liff_ticket(uuid, text) TO authenticated;
