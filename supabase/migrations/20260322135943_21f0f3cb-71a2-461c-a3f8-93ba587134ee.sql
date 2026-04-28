-- Create activity_logs table for user operation tracking
CREATE TABLE public.activity_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  org_id uuid REFERENCES public.organizations(id) ON DELETE SET NULL,
  action text NOT NULL,
  category text NOT NULL DEFAULT 'general',
  target_type text DEFAULT '',
  target_id text DEFAULT '',
  target_name text DEFAULT '',
  detail text DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.activity_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can view all activity logs"
  ON public.activity_logs FOR SELECT TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Users can view own activity logs"
  ON public.activity_logs FOR SELECT TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "Authenticated users can insert activity logs"
  ON public.activity_logs FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE INDEX idx_activity_logs_user_id ON public.activity_logs(user_id);
CREATE INDEX idx_activity_logs_created_at ON public.activity_logs(created_at DESC);
CREATE INDEX idx_activity_logs_category ON public.activity_logs(category);