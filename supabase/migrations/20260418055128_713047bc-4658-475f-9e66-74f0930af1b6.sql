-- 1) Add transcode tracking columns to media_items
ALTER TABLE public.media_items
  ADD COLUMN IF NOT EXISTS transcode_status text NOT NULL DEFAULT 'ready',
  ADD COLUMN IF NOT EXISTS transcode_error text,
  ADD COLUMN IF NOT EXISTS source_fps numeric,
  ADD COLUMN IF NOT EXISTS source_bitrate bigint,
  ADD COLUMN IF NOT EXISTS source_codec text,
  ADD COLUMN IF NOT EXISTS source_container text,
  ADD COLUMN IF NOT EXISTS transcode_requested_at timestamptz,
  ADD COLUMN IF NOT EXISTS transcode_completed_at timestamptz;

-- Constrain status values
ALTER TABLE public.media_items
  DROP CONSTRAINT IF EXISTS media_items_transcode_status_check;
ALTER TABLE public.media_items
  ADD CONSTRAINT media_items_transcode_status_check
  CHECK (transcode_status IN ('ready','pending_transcode','transcoding','failed'));

-- Index for "pending transcode" listings
CREATE INDEX IF NOT EXISTS idx_media_items_transcode_status
  ON public.media_items (transcode_status)
  WHERE transcode_status <> 'ready';

-- 2) Trigger: prevent scheduling media that is not transcode-ready
CREATE OR REPLACE FUNCTION public.prevent_unready_media_in_schedule()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_status text;
BEGIN
  IF NEW.media_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT transcode_status INTO v_status
  FROM public.media_items
  WHERE id = NEW.media_id;

  IF v_status IS NOT NULL AND v_status <> 'ready' THEN
    RAISE EXCEPTION 'Media % is not ready (transcode_status=%). Please wait for transcoding to finish.', NEW.media_id, v_status
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_schedule_items_block_unready_media ON public.schedule_items;
CREATE TRIGGER trg_schedule_items_block_unready_media
  BEFORE INSERT OR UPDATE OF media_id ON public.schedule_items
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_unready_media_in_schedule();