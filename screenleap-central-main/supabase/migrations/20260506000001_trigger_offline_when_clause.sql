-- Fix: Add WHEN clause to trg_screen_offline_push so PostgreSQL skips the
-- PL/pgSQL function entirely for heartbeat UPDATEs where online stays true.
--
-- Before: trigger fired for EVERY UPDATE that touched the `online` column
--         (even online=true → online=true no-ops), wasting ~1.3 ms per call
--         due to two app_settings lookups inside the function.
-- After:  trigger only fires when online genuinely transitions true → false,
--         eliminating all unnecessary function invocations.

DROP TRIGGER IF EXISTS trg_screen_offline_push ON public.screens;

CREATE TRIGGER trg_screen_offline_push
  AFTER UPDATE OF online ON public.screens
  FOR EACH ROW
  WHEN (OLD.online IS DISTINCT FROM NEW.online AND NEW.online = false)
  EXECUTE FUNCTION public.fn_notify_screen_offline();
