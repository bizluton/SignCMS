-- Close the TOCTOU race in process-email-queue's "already sent" check.
--
-- Original flow:
--   SELECT id FROM email_send_log WHERE message_id=? AND status='sent'   ← 1
--   if not found, call Resend                                            ← 2
--   INSERT email_send_log status='sent'                                  ← 3
-- Two concurrent workers (cron + a re-invoked instance, or a pgmq visibility
-- timeout) can both pass step 1 and both call Resend at step 2, producing
-- duplicate sends.
--
-- This partial unique index prevents two rows from coexisting with the same
-- message_id AND status='sent'. Combined with the Idempotency-Key header
-- now sent to Resend, this makes the send pipeline idempotent end-to-end.

CREATE UNIQUE INDEX IF NOT EXISTS email_send_log_message_sent_uniq
  ON public.email_send_log (message_id)
  WHERE message_id IS NOT NULL AND status = 'sent';

COMMENT ON INDEX public.email_send_log_message_sent_uniq IS
  'Belt-and-suspenders against duplicate email sends. process-email-queue catches the unique_violation and treats it as "already sent".';
