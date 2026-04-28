CREATE TABLE public.publish_records (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  schedule_id uuid REFERENCES public.schedules(id) ON DELETE SET NULL,
  screen_id uuid REFERENCES public.screens(id) ON DELETE SET NULL,
  schedule_name text NOT NULL DEFAULT '',
  screen_name text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'sending',
  scheduled_at timestamp with time zone,
  published_by uuid,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE public.publish_records ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view publish records"
  ON public.publish_records FOR SELECT TO authenticated
  USING (true);

CREATE POLICY "Admins can insert publish records"
  ON public.publish_records FOR INSERT TO authenticated
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Admins can update publish records"
  ON public.publish_records FOR UPDATE TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Admins can delete publish records"
  ON public.publish_records FOR DELETE TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role));