-- Drop the service-role-only policy we just created
DROP POLICY IF EXISTS "Service role can insert notifications" ON public.notifications;

-- Allow authenticated users to insert only when created_by matches their uid
CREATE POLICY "Users can insert notifications with own identity"
  ON public.notifications
  FOR INSERT
  TO authenticated
  WITH CHECK (created_by = auth.uid());

-- Also allow service_role (for triggers like notify_chat_assignment)
CREATE POLICY "Service role can insert notifications"
  ON public.notifications
  FOR INSERT
  TO public
  WITH CHECK (auth.role() = 'service_role');

-- Update the notify_chat_assignment trigger to also handle UPDATE (reassignment)
CREATE OR REPLACE FUNCTION public.notify_chat_assignment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
BEGIN
  -- On INSERT: notify if assigned_to is set
  IF TG_OP = 'INSERT' AND NEW.assigned_to IS NOT NULL THEN
    INSERT INTO public.notifications (user_id, type, title, body, link)
    VALUES (
      NEW.assigned_to,
      'assignment',
      '新對話分派',
      '您已被自動分派處理一個新的客服對話',
      '/customer-service'
    );
  END IF;

  -- On UPDATE: notify if assigned_to changed
  IF TG_OP = 'UPDATE' AND NEW.assigned_to IS DISTINCT FROM OLD.assigned_to AND NEW.assigned_to IS NOT NULL THEN
    INSERT INTO public.notifications (user_id, type, title, body, link)
    VALUES (
      NEW.assigned_to,
      'assignment',
      '新對話分派',
      '您已被分派處理一個客服對話',
      '/customer-service'
    );
  END IF;

  RETURN NEW;
END;
$$;

-- Make sure the trigger fires on both INSERT and UPDATE
DROP TRIGGER IF EXISTS on_chat_session_assigned ON public.customer_chat_sessions;
CREATE TRIGGER on_chat_session_assigned
  AFTER INSERT OR UPDATE ON public.customer_chat_sessions
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_chat_assignment();
