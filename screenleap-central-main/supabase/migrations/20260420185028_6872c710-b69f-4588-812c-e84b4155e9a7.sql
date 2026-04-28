
INSERT INTO public.channel_blocks (channel_id, org_id, name, block_type, start_at, end_at, weekdays, priority, enabled)
VALUES ('7e025138-a2c2-42c0-9499-01af01d9f986', 'b8ad07e1-4e5d-490b-bee8-4035d3ef8a62', '日曆區塊1', 'calendar', '2026-04-21 09:00:00+00', '2026-04-21 18:00:00+00', '{}', 0, true);

INSERT INTO public.channel_blocks (channel_id, org_id, name, block_type, weekdays, start_time, end_time, priority, enabled)
VALUES ('7e025138-a2c2-42c0-9499-01af01d9f986', 'b8ad07e1-4e5d-490b-bee8-4035d3ef8a62', '週循環區塊1', 'weekly', ARRAY['mon','wed','fri'], '09:00:00', '12:00:00', 0, true);
