CREATE OR REPLACE FUNCTION public.search_users_for_admin(_query text)
RETURNS TABLE(user_id uuid, email text, display_name text, avatar_url text)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_caller uuid := auth.uid();
  v_q text := lower(trim(COALESCE(_query, '')));
BEGIN
  IF v_caller IS NULL OR NOT public.is_system_admin(v_caller) THEN
    RETURN;
  END IF;
  IF length(v_q) < 2 THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT u.id AS user_id,
         u.email::text,
         p.display_name,
         p.avatar_url
  FROM auth.users u
  LEFT JOIN public.profiles p ON p.user_id = u.id
  WHERE lower(u.email) LIKE '%' || v_q || '%'
     OR lower(COALESCE(p.display_name, '')) LIKE '%' || v_q || '%'
  ORDER BY
    CASE WHEN lower(u.email) = v_q THEN 0
         WHEN lower(u.email) LIKE v_q || '%' THEN 1
         ELSE 2 END,
    u.email
  LIMIT 20;
END;
$function$;