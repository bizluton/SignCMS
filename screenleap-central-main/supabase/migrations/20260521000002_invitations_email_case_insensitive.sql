-- invitations.email is stored as text and code compares it case-sensitively.
-- Result: an admin can send `Foo@example.com` and another admin can send
-- `foo@example.com` and both invitations co-exist as pending; the user
-- can also accept the "wrong" one because Supabase auth.users.email is
-- lower-cased on signup but invitations.email is not. Both classes of bug
-- close with a case-insensitive uniqueness invariant.
--
-- Approach:
--   1. Normalise every existing invitation row to lower-case.
--   2. Resolve duplicates that emerge from #1: keep the most recent row
--      per (org_id, lower(email), status='pending'), mark the rest as
--      expired so the partial unique index can be created without conflict.
--   3. Add a partial UNIQUE INDEX (org_id, lower(email)) WHERE status='pending'.
--   4. Trigger to lower-case on INSERT / UPDATE.

-- 1. Backfill: lowercase every existing email.
UPDATE public.invitations
   SET email = lower(email)
 WHERE email <> lower(email);

-- 2. De-duplicate pending invitations per (org_id, lower(email)).
WITH ranked AS (
  SELECT id,
         row_number() OVER (
           PARTITION BY org_id, email
           ORDER BY created_at DESC
         ) AS rn
    FROM public.invitations
   WHERE status = 'pending'
)
UPDATE public.invitations inv
   SET status = 'expired'
  FROM ranked
 WHERE inv.id = ranked.id AND ranked.rn > 1;

-- 3. Partial unique index — only one pending invitation per (org, email).
CREATE UNIQUE INDEX IF NOT EXISTS invitations_org_email_pending_uniq
  ON public.invitations (org_id, email)
  WHERE status = 'pending';

-- 4. BEFORE INSERT / UPDATE trigger to enforce lowercase storage.
CREATE OR REPLACE FUNCTION public.normalize_invitation_email()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
BEGIN
  NEW.email := lower(trim(NEW.email));
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_normalize_invitation_email ON public.invitations;
CREATE TRIGGER trg_normalize_invitation_email
  BEFORE INSERT OR UPDATE OF email ON public.invitations
  FOR EACH ROW
  EXECUTE FUNCTION public.normalize_invitation_email();

COMMENT ON INDEX public.invitations_org_email_pending_uniq IS
  'Prevents duplicate pending invitations for the same email + org (case-insensitive). Resending should DELETE the old row first (see send-invitation edge function).';
