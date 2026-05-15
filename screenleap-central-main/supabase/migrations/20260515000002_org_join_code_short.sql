-- Replace long 32-char join_token with a short 8-char uppercase hex join_code.
-- URL becomes: /web-player.html?join=491F1614  (~57 chars vs 88 before)
-- register-device edge function checks join_code first, falls back to join_token.

ALTER TABLE organizations ADD COLUMN IF NOT EXISTS join_code text;

-- Generate a unique 8-char uppercase hex code for every org that needs one
DO $$
DECLARE
  r    RECORD;
  code TEXT;
BEGIN
  FOR r IN SELECT id FROM organizations WHERE join_code IS NULL LOOP
    LOOP
      code := upper(substring(replace(gen_random_uuid()::text, '-', ''), 1, 8));
      BEGIN
        UPDATE organizations SET join_code = code WHERE id = r.id;
        EXIT;     -- success
      EXCEPTION WHEN unique_violation THEN
        NULL;     -- retry on collision (astronomically rare)
      END;
    END LOOP;
  END LOOP;
END;
$$;

-- Enforce uniqueness going forward
CREATE UNIQUE INDEX IF NOT EXISTS organizations_join_code_key ON organizations(join_code);
