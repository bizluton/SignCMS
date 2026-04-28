CREATE TABLE public.device_models (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  sort_order integer NOT NULL DEFAULT 0,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.device_models ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can view device models"
ON public.device_models FOR SELECT TO authenticated USING (true);

CREATE POLICY "System admin can insert device models"
ON public.device_models FOR INSERT TO authenticated
WITH CHECK (public.is_system_admin(auth.uid()));

CREATE POLICY "System admin can update device models"
ON public.device_models FOR UPDATE TO authenticated
USING (public.is_system_admin(auth.uid()));

CREATE POLICY "System admin can delete device models"
ON public.device_models FOR DELETE TO authenticated
USING (public.is_system_admin(auth.uid()));

CREATE TRIGGER device_models_updated_at
BEFORE UPDATE ON public.device_models
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

INSERT INTO public.device_models (name, sort_order) VALUES
  ('Qbic BXP-300', 10),
  ('Bizlution SBC-320', 20),
  ('Bizlution SBC-350', 30);
