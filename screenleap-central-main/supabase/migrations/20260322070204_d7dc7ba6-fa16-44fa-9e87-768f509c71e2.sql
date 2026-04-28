
-- Screens table
CREATE TABLE public.screens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  branch text NOT NULL DEFAULT '',
  resolution text NOT NULL DEFAULT '1920×1080',
  status text NOT NULL DEFAULT 'offline',
  uploaded_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.screens ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view screens" ON public.screens FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins can insert screens" ON public.screens FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins can update screens" ON public.screens FOR UPDATE TO authenticated USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins can delete screens" ON public.screens FOR DELETE TO authenticated USING (public.has_role(auth.uid(), 'admin'));

-- Media items table
CREATE TABLE public.media_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  type text NOT NULL DEFAULT 'image',
  url text NOT NULL DEFAULT '',
  thumbnail text NOT NULL DEFAULT '',
  size text NOT NULL DEFAULT '',
  dimensions text NOT NULL DEFAULT '',
  duration text,
  uploaded_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.media_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view media" ON public.media_items FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins can insert media" ON public.media_items FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins can delete media" ON public.media_items FOR DELETE TO authenticated USING (public.has_role(auth.uid(), 'admin'));

-- Schedules table
CREATE TABLE public.schedules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  screen_id uuid REFERENCES public.screens(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'draft',
  start_date date,
  end_date date,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.schedules ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view schedules" ON public.schedules FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins can insert schedules" ON public.schedules FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins can update schedules" ON public.schedules FOR UPDATE TO authenticated USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins can delete schedules" ON public.schedules FOR DELETE TO authenticated USING (public.has_role(auth.uid(), 'admin'));

-- Schedule items table
CREATE TABLE public.schedule_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  schedule_id uuid NOT NULL REFERENCES public.schedules(id) ON DELETE CASCADE,
  media_id uuid REFERENCES public.media_items(id) ON DELETE SET NULL,
  sort_order int NOT NULL DEFAULT 0,
  duration int NOT NULL DEFAULT 10,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.schedule_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view schedule items" ON public.schedule_items FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins can insert schedule items" ON public.schedule_items FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins can update schedule items" ON public.schedule_items FOR UPDATE TO authenticated USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins can delete schedule items" ON public.schedule_items FOR DELETE TO authenticated USING (public.has_role(auth.uid(), 'admin'));
