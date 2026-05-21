-- Bulk-create web player activation codes.
--
-- Used by the admin "新增 Web Player 螢幕" dialog when generating many codes
-- at once (e.g. provisioning 50 lobby screens). The single-create path stays
-- in the client for now (handleWebPlayerCreate uses Math.random() + insert);
-- this RPC handles the bulk case server-side so:
--
--   1. Codes are crypto-secure (gen_random_bytes instead of Math.random())
--   2. All N codes are generated in one transaction (atomic batch)
--   3. Collisions are retried inside the function (up to 20× per code)
--   4. Permission check is centralised here, not in the client

CREATE OR REPLACE FUNCTION public.bulk_create_screen_activation_codes(
  p_org_id uuid,
  p_prefix text,
  p_count  int
)
RETURNS TABLE (id uuid, name text, code text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_caller    uuid := auth.uid();
  v_i         int;
  v_attempt   int;
  v_padded    text;
  v_name      text;
  v_code      text;
  v_id        uuid;
BEGIN
  -- Auth: caller must be authenticated, and either system admin or org member.
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'unauthenticated';
  END IF;
  IF NOT (public.is_system_admin(v_caller)
          OR public.user_in_org(v_caller, p_org_id)) THEN
    RAISE EXCEPTION 'permission_denied';
  END IF;

  -- Input validation
  IF p_count IS NULL OR p_count < 1 OR p_count > 1000 THEN
    RAISE EXCEPTION 'count_out_of_range';
  END IF;
  IF p_prefix IS NULL OR length(trim(p_prefix)) = 0 THEN
    RAISE EXCEPTION 'prefix_required';
  END IF;
  IF length(p_prefix) > 80 THEN
    RAISE EXCEPTION 'prefix_too_long';
  END IF;

  FOR v_i IN 1..p_count LOOP
    -- Pad the sequence to 3 digits: "prefix-001", "prefix-002", ...
    v_padded := lpad(v_i::text, 3, '0');
    v_name   := p_prefix || v_padded;

    -- Try up to 20 times to insert (handle 6-digit code collisions)
    v_attempt := 0;
    LOOP
      v_attempt := v_attempt + 1;
      EXIT WHEN v_attempt > 20;

      -- Crypto-secure 6-digit decimal (100000..999999).
      -- Read 4 random bytes → uint32 → mod 900000 + 100000 → text padded to 6.
      v_code := lpad(
        (100000 + (
          (get_byte(extensions.gen_random_bytes(4), 0)::bigint << 24)
          | (get_byte(extensions.gen_random_bytes(4), 0)::bigint << 16)
          | (get_byte(extensions.gen_random_bytes(4), 0)::bigint << 8)
          |  get_byte(extensions.gen_random_bytes(4), 0)::bigint
        ) % 900000)::text,
        6, '0'
      );

      BEGIN
        INSERT INTO public.screen_activation_codes (org_id, name, code, status)
        VALUES (p_org_id, v_name, v_code, 'pending')
        RETURNING screen_activation_codes.id INTO v_id;
        EXIT;  -- success
      EXCEPTION
        WHEN unique_violation THEN
          -- code or (org_id, name) collision — retry
          CONTINUE;
      END;
    END LOOP;

    IF v_attempt > 20 THEN
      RAISE EXCEPTION 'code_generation_exhausted_at_index_%', v_i;
    END IF;

    id   := v_id;
    name := v_name;
    code := v_code;
    RETURN NEXT;
  END LOOP;

  RETURN;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.bulk_create_screen_activation_codes(uuid, text, int) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.bulk_create_screen_activation_codes(uuid, text, int) TO authenticated;

COMMENT ON FUNCTION public.bulk_create_screen_activation_codes(uuid, text, int) IS
  'Atomically create N screen activation codes for an org. Names are
   "<prefix>001", "<prefix>002", .... Codes are crypto-secure 6-digit decimals,
   retried on collision. Returns the created rows. Authenticated org members
   and system admins only; max 1000 per call.';
