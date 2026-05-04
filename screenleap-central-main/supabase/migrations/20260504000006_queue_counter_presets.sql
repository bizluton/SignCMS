-- Add counter_names preset array to queues so operators can define
-- their counter list once and quick-select instead of re-typing.
ALTER TABLE public.queue_system_queues
  ADD COLUMN IF NOT EXISTS counter_names text[] NOT NULL DEFAULT '{}';
