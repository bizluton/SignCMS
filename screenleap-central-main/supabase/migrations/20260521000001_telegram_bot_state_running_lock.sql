-- Add a row-level "running" lock to telegram_bot_state so two concurrent
-- telegram-poll invocations can't both consume the same Telegram updates.
--
-- Supabase edge functions run on PgBouncer in transaction mode, so
-- session-level advisory locks aren't reliable. The cleanest approach is
-- an atomic UPDATE-on-condition that flips a `running_at` column only when
-- the previous run has finished (or expired beyond a safety stale window).

ALTER TABLE public.telegram_bot_state
  ADD COLUMN IF NOT EXISTS running_at timestamptz;

COMMENT ON COLUMN public.telegram_bot_state.running_at IS
  'Non-null while a telegram-poll invocation is consuming updates. Cleared on completion. Stale entries (older than ~5 min) are reclaimable; see the claim_telegram_poll_run RPC.';

-- Atomically claim the right to run. Returns TRUE if the caller now holds
-- the lock; FALSE if another worker is already running.
CREATE OR REPLACE FUNCTION public.claim_telegram_poll_run(p_stale_after_seconds int DEFAULT 300)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_claimed int;
BEGIN
  UPDATE public.telegram_bot_state
     SET running_at = now(),
         updated_at = now()
   WHERE id = 1
     AND (running_at IS NULL OR running_at < now() - make_interval(secs => p_stale_after_seconds));
  GET DIAGNOSTICS v_claimed = ROW_COUNT;
  RETURN v_claimed = 1;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.claim_telegram_poll_run(int) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.claim_telegram_poll_run(int) TO service_role;

-- Release the lock at end of run.
CREATE OR REPLACE FUNCTION public.release_telegram_poll_run()
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  UPDATE public.telegram_bot_state SET running_at = NULL WHERE id = 1;
$$;

REVOKE EXECUTE ON FUNCTION public.release_telegram_poll_run() FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.release_telegram_poll_run() TO service_role;
