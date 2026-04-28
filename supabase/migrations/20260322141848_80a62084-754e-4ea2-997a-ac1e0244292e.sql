
CREATE TABLE public.playback_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  screen_id uuid REFERENCES public.screens(id) ON DELETE SET NULL,
  media_id uuid REFERENCES public.media_items(id) ON DELETE SET NULL,
  media_name text NOT NULL DEFAULT '',
  duration_seconds integer NOT NULL DEFAULT 0,
  org_id uuid REFERENCES public.organizations(id) ON DELETE SET NULL,
  played_at timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE public.playback_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view playback logs in their org or admins see all"
  ON public.playback_logs FOR SELECT TO authenticated
  USING (
    has_role(auth.uid(), 'admin'::app_role)
    OR (org_id IS NULL)
    OR user_in_org(auth.uid(), org_id)
  );

CREATE POLICY "Authenticated users can insert playback logs"
  ON public.playback_logs FOR INSERT TO authenticated
  WITH CHECK (true);

-- Insert sample data for the past 7 days
INSERT INTO public.playback_logs (media_name, duration_seconds, played_at) VALUES
  ('品牌形象廣告 A', 30, now() - interval '0 days'),
  ('品牌形象廣告 A', 30, now() - interval '0 days' - interval '2 hours'),
  ('品牌形象廣告 A', 30, now() - interval '1 day'),
  ('品牌形象廣告 A', 30, now() - interval '1 day' - interval '3 hours'),
  ('品牌形象廣告 A', 30, now() - interval '2 days'),
  ('品牌形象廣告 A', 30, now() - interval '3 days'),
  ('品牌形象廣告 A', 30, now() - interval '4 days'),
  ('品牌形象廣告 A', 30, now() - interval '5 days'),
  ('品牌形象廣告 A', 30, now() - interval '6 days'),
  ('品牌形象廣告 A', 30, now() - interval '6 days' - interval '1 hour'),
  ('新品上市促銷 B', 15, now() - interval '0 days'),
  ('新品上市促銷 B', 15, now() - interval '1 day'),
  ('新品上市促銷 B', 15, now() - interval '1 day' - interval '4 hours'),
  ('新品上市促銷 B', 15, now() - interval '2 days'),
  ('新品上市促銷 B', 15, now() - interval '2 days' - interval '5 hours'),
  ('新品上市促銷 B', 15, now() - interval '3 days'),
  ('新品上市促銷 B', 15, now() - interval '4 days'),
  ('新品上市促銷 B', 15, now() - interval '5 days'),
  ('季節特賣活動 C', 20, now() - interval '0 days'),
  ('季節特賣活動 C', 20, now() - interval '1 day'),
  ('季節特賣活動 C', 20, now() - interval '2 days'),
  ('季節特賣活動 C', 20, now() - interval '3 days'),
  ('季節特賣活動 C', 20, now() - interval '3 days' - interval '6 hours'),
  ('季節特賣活動 C', 20, now() - interval '4 days'),
  ('季節特賣活動 C', 20, now() - interval '5 days'),
  ('季節特賣活動 C', 20, now() - interval '6 days'),
  ('會員招募海報 D', 10, now() - interval '0 days'),
  ('會員招募海報 D', 10, now() - interval '2 days'),
  ('會員招募海報 D', 10, now() - interval '4 days'),
  ('會員招募海報 D', 10, now() - interval '6 days'),
  ('節慶祝賀動畫 E', 25, now() - interval '1 day'),
  ('節慶祝賀動畫 E', 25, now() - interval '3 days'),
  ('節慶祝賀動畫 E', 25, now() - interval '5 days');
