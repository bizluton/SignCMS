
CREATE OR REPLACE FUNCTION public.notify_chat_assignment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Only notify when assigned_to is set on INSERT (auto-assign)
  IF NEW.assigned_to IS NOT NULL THEN
    INSERT INTO public.notifications (user_id, type, title, body, link)
    VALUES (
      NEW.assigned_to,
      'assignment',
      '新對話分派',
      '您已被自動分派處理一個新的客服對話',
      '/customer-service'
    );
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_notify_chat_assignment
AFTER INSERT ON public.customer_chat_sessions
FOR EACH ROW
EXECUTE FUNCTION public.notify_chat_assignment();
