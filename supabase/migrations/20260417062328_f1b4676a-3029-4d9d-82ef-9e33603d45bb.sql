-- Trigger to auto-create notifications when delegation status changes
CREATE OR REPLACE FUNCTION public.notify_delegation_status_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _grantor_name text;
  _grantee_name text;
  _notify_user uuid;
  _title text;
  _body text;
BEGIN
  -- Only react to status transitions out of 'active'
  IF NEW.status = OLD.status THEN
    RETURN NEW;
  END IF;
  IF OLD.status <> 'active' THEN
    RETURN NEW;
  END IF;

  SELECT display_name INTO _grantor_name FROM public.profiles WHERE user_id = NEW.grantor_id;
  SELECT display_name INTO _grantee_name FROM public.profiles WHERE user_id = NEW.grantee_id;
  _grantor_name := COALESCE(_grantor_name, substr(NEW.grantor_id::text, 1, 8));
  _grantee_name := COALESCE(_grantee_name, substr(NEW.grantee_id::text, 1, 8));

  IF NEW.status = 'ended' THEN
    -- Grantee ended their own delegation -> notify grantor
    _notify_user := NEW.grantor_id;
    _title := '代理已結束';
    _body := _grantee_name || ' 已主動結束您授予的代理權限';
  ELSIF NEW.status = 'revoked' THEN
    IF NEW.revoked_by = NEW.grantor_id THEN
      -- Grantor revoked -> notify grantee
      _notify_user := NEW.grantee_id;
      _title := '代理權限已被撤銷';
      _body := _grantor_name || ' 已撤銷您的代理權限';
    ELSE
      -- Grantee ended (some clients use 'revoked' for self-end) -> notify grantor
      _notify_user := NEW.grantor_id;
      _title := '代理已結束';
      _body := _grantee_name || ' 已主動結束您授予的代理權限';
    END IF;
  ELSE
    RETURN NEW;
  END IF;

  INSERT INTO public.notifications (user_id, type, title, body, link, created_by)
  VALUES (_notify_user, 'delegation', _title, _body, '/admin', NEW.revoked_by);

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_delegation_status_change ON public.delegation_grants;
CREATE TRIGGER trg_notify_delegation_status_change
AFTER UPDATE ON public.delegation_grants
FOR EACH ROW
EXECUTE FUNCTION public.notify_delegation_status_change();