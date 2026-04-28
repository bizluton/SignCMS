
CREATE TABLE public.customer_satisfaction_ratings (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  session_id uuid NOT NULL REFERENCES public.customer_chat_sessions(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  rating integer NOT NULL,
  feedback text DEFAULT '',
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  UNIQUE (session_id)
);

ALTER TABLE public.customer_satisfaction_ratings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can insert rating for own sessions"
ON public.customer_satisfaction_ratings FOR INSERT
TO authenticated
WITH CHECK (
  auth.uid() = user_id
  AND EXISTS (
    SELECT 1 FROM public.customer_chat_sessions s
    WHERE s.id = customer_satisfaction_ratings.session_id AND s.user_id = auth.uid()
  )
);

CREATE POLICY "Users can view own ratings"
ON public.customer_satisfaction_ratings FOR SELECT
TO authenticated
USING (
  auth.uid() = user_id OR has_role(auth.uid(), 'admin'::app_role)
);
