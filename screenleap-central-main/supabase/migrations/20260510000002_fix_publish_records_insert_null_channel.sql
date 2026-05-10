-- Fix publish_records_insert_org RLS policy.
--
-- Problem: the original WITH CHECK only passed when channel_id IS NOT NULL because
--   EXISTS (SELECT 1 FROM channels WHERE c.id = publish_records.channel_id ...)
-- evaluates to FALSE when channel_id IS NULL  (c.id = NULL is never true in SQL).
--
-- This blocked INSERT for "play-now" publish records created for screens that have
-- no channel subscription — the record is intentionally channel_id = NULL but RLS
-- rejected it, surfacing as "發佈失敗，請重試" in the Quick Publish dialog.
--
-- Fix: split into two OR branches:
--   1. channel_id IS NOT NULL → existing channel-join check
--   2. channel_id IS NULL     → fall back to the screen's org_id check

DROP POLICY IF EXISTS publish_records_insert_org ON publish_records;

CREATE POLICY publish_records_insert_org ON publish_records
  FOR INSERT
  WITH CHECK (
    -- Branch 1: channel-based publish record (normal scheduled/channel play)
    (
      channel_id IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM channels c
        WHERE c.id = publish_records.channel_id
          AND user_in_org(auth.uid(), c.org_id)
          AND (is_org_admin(auth.uid()) OR has_role(auth.uid(), 'admin'::app_role))
      )
    )
    OR
    -- Branch 2: direct screen publish record (channel_id NULL, e.g. "play now"
    --           for a screen with no channel subscription)
    (
      channel_id IS NULL
      AND EXISTS (
        SELECT 1 FROM screens s
        WHERE s.id = publish_records.screen_id
          AND user_in_org(auth.uid(), s.org_id)
          AND (is_org_admin(auth.uid()) OR has_role(auth.uid(), 'admin'::app_role))
      )
    )
  );
