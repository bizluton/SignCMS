# Migration Style Guide

Rules to keep migrations consistent and audit-clean. Every PR adding a
migration should follow these.

## Naming

`<YYYYMMDDHHMMSS>_<short_purpose>.sql` — UTC timestamp first, then a
human-readable purpose. Don't include the supabase-generated random suffix
unless the migration was originally created by `supabase migration new`.

## Identity & permissions

### ❌ Don't reference any user UUID literally

```sql
-- BAD
USING (auth.uid() = '3fbb2f97-7268-4cac-a511-7cff6654a8f7'::uuid)
```

The hardcoded literal makes the policy break if that user is rotated,
removed, or the system is bootstrapped fresh in a new project. The repo
has historical drift from this anti-pattern; we ran a one-time cleanup in
`20260521000005_hardcoded_uuid_post_april_cleanup.sql`.

### ✅ Use the helpers

```sql
-- "is the caller the / a system admin"
USING (public.is_system_admin(auth.uid()))

-- "is the caller in this org"
USING (public.user_in_org(auth.uid(), org_id))

-- "is the caller a global admin role"  (note: equivalent to is_system_admin
-- since 20260520000010_has_role_admin_means_system_admin)
USING (public.has_role(auth.uid(), 'admin'))

-- "is the caller an org_admin"
USING (public.has_role(auth.uid(), 'org_admin'))
```

### ✅ Seeding rows that need a "system" owner

If a seed row needs `created_by` set to the root system admin, look it up
rather than hardcoding:

```sql
INSERT INTO public.widgets (..., created_by)
VALUES (..., (SELECT user_id FROM public.system_admins WHERE is_root = true LIMIT 1));
```

If you anticipate the migration running before any system admin exists
(rare), make the column nullable on insert and run a follow-up UPDATE in
a DO block:

```sql
DO $$
DECLARE v_root uuid;
BEGIN
  SELECT user_id INTO v_root FROM public.system_admins WHERE is_root = true LIMIT 1;
  IF v_root IS NULL THEN
    RAISE NOTICE 'No root admin yet — seed row left with NULL created_by';
    RETURN;
  END IF;
  UPDATE public.widgets SET created_by = v_root WHERE name = '...' AND created_by IS NULL;
END $$;
```

## SECURITY DEFINER functions

### ✅ Always set search_path

```sql
CREATE OR REPLACE FUNCTION public.foo(...)
RETURNS ...
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp      -- ← required
AS $$
  ...
$$;
```

Without a locked search_path a user who can `CREATE` in a writable schema
that's earlier on the path can override unqualified references in the
function body.

### ✅ Explicit grants

```sql
REVOKE EXECUTE ON FUNCTION public.foo(...)  FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.foo(...)  TO authenticated;   -- or service_role / anon when intentional
```

`SECURITY DEFINER` functions are created with `EXECUTE` granted to `PUBLIC`
by default. If the function does anything privileged, this is too open.

## RLS

### ✅ Always include an `is_system_admin` bypass when intent is "global admin"

```sql
CREATE POLICY "Users can view foo in their org"
  ON public.foo FOR SELECT TO authenticated
  USING (
    public.is_system_admin(auth.uid())
    OR (org_id IS NOT NULL AND public.user_in_org(auth.uid(), org_id))
  );
```

### ❌ Don't use `org_id IS NULL` as an admin shortcut

That historic pattern (`has_role(...) OR org_id IS NULL OR user_in_org(...)`)
turns any NULL `org_id` row into cross-tenant readable. If the column should
be NOT NULL, declare it so; don't paper over with an RLS bypass.

## Idempotency

Aim to make migrations safely re-runnable:

- `CREATE TABLE IF NOT EXISTS`
- `CREATE INDEX IF NOT EXISTS`
- `CREATE OR REPLACE FUNCTION`
- `DROP POLICY IF EXISTS ... CREATE POLICY ...` for policy updates
- `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`
- For policies that already exist with different `CREATE` defaults, wrap in
  `DO $$ BEGIN ... EXCEPTION WHEN duplicate_object THEN NULL; END $$`
- For seed `INSERT`s, add `ON CONFLICT DO NOTHING`

## Common helpers (existing — reuse them)

| Helper | Purpose |
|---|---|
| `public.is_system_admin(uuid)` | True if user is in `system_admins` |
| `public.has_role(uuid, app_role)` | True if user holds the given role; `'admin'` is delegated to `is_system_admin` |
| `public.user_in_org(uuid, uuid)` | True if user is a member of the org |
| `public.is_org_admin(uuid)` | True if user has `org_admin` role somewhere |
| `public.users_share_org(uuid, uuid)` | True if two users share at least one org |
| `public.users_have_active_delegation(uuid, uuid)` | True if there's a non-expired delegation_grant in either direction |

## Reference cleanup migrations

If you need to fix accumulated drift in policies / RPCs that already
shipped, see these two existing patterns:

- `20260420011350_*.sql` — Original hardcoded-UUID cleanup; rewrites
  every `pg_policy` row that matches a regex.
- `20260521000005_hardcoded_uuid_post_april_cleanup.sql` — Post-April
  follow-up using the same DO-block pattern. Copy this layout if you need
  to do another sweep.

## When in doubt

Open `docs/prs/PR-1-critical-security.md` / `PR-2-systemic-hardening.md` /
`PR-3-defense-in-depth.md` for examples of well-documented migrations
covering the various RLS / RPC / helper / index patterns.
