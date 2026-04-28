DROP POLICY IF EXISTS "System admins can view telegram bot state" ON public.telegram_bot_state;
DROP POLICY IF EXISTS "System admins can modify telegram bot state" ON public.telegram_bot_state;

CREATE POLICY "System admins can view telegram bot state"
  ON public.telegram_bot_state
  FOR SELECT
  TO authenticated
  USING (public.is_system_admin(auth.uid()));

CREATE POLICY "System admins can modify telegram bot state"
  ON public.telegram_bot_state
  FOR ALL
  TO authenticated
  USING (public.is_system_admin(auth.uid()))
  WITH CHECK (public.is_system_admin(auth.uid()));