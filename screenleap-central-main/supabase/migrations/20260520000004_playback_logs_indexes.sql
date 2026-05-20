-- playback_logs is a high-volume table (projected ~430M rows/month at scale,
-- per the retention migration's comment). The original CREATE TABLE only
-- defined a primary key on id; an index on played_at was added later by
-- 20260506000003_playback_logs_retention.sql for the daily DELETE.
--
-- Every reporting query in the app filters by org_id or screen_id, sorted
-- by played_at — without these composite indexes each query scans the
-- whole partition / table.

CREATE INDEX IF NOT EXISTS idx_playback_logs_org_played
  ON public.playback_logs (org_id, played_at DESC);

CREATE INDEX IF NOT EXISTS idx_playback_logs_screen_played
  ON public.playback_logs (screen_id, played_at DESC);

-- media_id is occasionally used for "how often did media X play" queries.
-- Lower priority; add WITHOUT the played_at suffix to keep the index small.
CREATE INDEX IF NOT EXISTS idx_playback_logs_media
  ON public.playback_logs (media_id);
