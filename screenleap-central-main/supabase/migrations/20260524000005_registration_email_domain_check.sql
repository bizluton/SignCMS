-- Registration domain check: block new signups when email domain is already claimed by an org.
--
-- Logic:
--   1. Add email_domain column to organizations (nullable — set to creator's domain on insert,
--      skipped for personal email providers).
--   2. Trigger: auto-populate email_domain on INSERT when creator_email is a business domain.
--   3. RPC: check_email_domain_registered(p_email) — returns { eligible, org_name? }.
--      Called by the frontend signup form (anon role) before creating the account.
--      Returns eligible=true for personal domains so they're never blocked.

-- ──────────────────────────────────────────────────────────────────────────────
-- 1. Add email_domain column
-- ──────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS email_domain text;

CREATE INDEX IF NOT EXISTS idx_organizations_email_domain
  ON public.organizations (email_domain);

-- ──────────────────────────────────────────────────────────────────────────────
-- 2. Trigger: populate email_domain from creator's email on org creation
-- ──────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.set_org_email_domain()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_email  text;
  v_domain text;
  personal_domains text[] := ARRAY[
    'gmail.com', 'googlemail.com',
    'yahoo.com', 'yahoo.co.jp', 'yahoo.com.tw', 'yahoo.co.uk',
    'hotmail.com', 'hotmail.co.uk', 'hotmail.fr',
    'outlook.com', 'outlook.co.jp',
    'live.com', 'live.co.uk',
    'msn.com',
    'icloud.com', 'me.com', 'mac.com',
    'qq.com', 'sina.com', 'sina.cn',
    '163.com', '126.com', 'foxmail.com',
    'protonmail.com', 'proton.me',
    'tutanota.com', 'zoho.com',
    'yandex.com', 'yandex.ru',
    'naver.com', 'daum.net'
  ];
BEGIN
  IF NEW.email_domain IS NOT NULL THEN
    RETURN NEW;  -- caller set it explicitly
  END IF;

  IF NEW.created_by IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT email INTO v_email
  FROM auth.users
  WHERE id = NEW.created_by;

  IF v_email IS NULL THEN
    RETURN NEW;
  END IF;

  v_domain := lower(split_part(v_email, '@', 2));

  IF v_domain = ANY(personal_domains) THEN
    RETURN NEW;  -- personal domain → leave email_domain NULL
  END IF;

  NEW.email_domain := v_domain;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_set_org_email_domain ON public.organizations;
CREATE TRIGGER trg_set_org_email_domain
  BEFORE INSERT ON public.organizations
  FOR EACH ROW
  EXECUTE FUNCTION public.set_org_email_domain();

-- ──────────────────────────────────────────────────────────────────────────────
-- 3. RPC: check_email_domain_registered
--    Returns jsonb { eligible: bool, org_name?: text }
--    eligible=true  → domain is free, signup is allowed
--    eligible=false → domain is claimed, show org_name and redirect to admin
-- ──────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.check_email_domain_registered(p_email text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_domain    text;
  v_org_name  text;
  personal_domains text[] := ARRAY[
    'gmail.com', 'googlemail.com',
    'yahoo.com', 'yahoo.co.jp', 'yahoo.com.tw', 'yahoo.co.uk',
    'hotmail.com', 'hotmail.co.uk', 'hotmail.fr',
    'outlook.com', 'outlook.co.jp',
    'live.com', 'live.co.uk',
    'msn.com',
    'icloud.com', 'me.com', 'mac.com',
    'qq.com', 'sina.com', 'sina.cn',
    '163.com', '126.com', 'foxmail.com',
    'protonmail.com', 'proton.me',
    'tutanota.com', 'zoho.com',
    'yandex.com', 'yandex.ru',
    'naver.com', 'daum.net'
  ];
BEGIN
  -- Validate input
  IF p_email IS NULL OR p_email NOT LIKE '%@%' THEN
    RETURN jsonb_build_object('eligible', true);
  END IF;

  v_domain := lower(split_part(p_email, '@', 2));

  -- Personal email providers are always eligible (never blocked)
  IF v_domain = ANY(personal_domains) THEN
    RETURN jsonb_build_object('eligible', true);
  END IF;

  -- Check if any org claims this domain
  SELECT name INTO v_org_name
  FROM public.organizations
  WHERE email_domain = v_domain
  LIMIT 1;

  IF v_org_name IS NOT NULL THEN
    RETURN jsonb_build_object('eligible', false, 'org_name', v_org_name);
  END IF;

  RETURN jsonb_build_object('eligible', true);
END;
$$;

-- Allow unauthenticated users to call this during signup
GRANT EXECUTE ON FUNCTION public.check_email_domain_registered(text) TO anon;
GRANT EXECUTE ON FUNCTION public.check_email_domain_registered(text) TO authenticated;
