-- Private table to hold a single HMAC secret used to sign trigger-test share links.
-- Only the service role accesses it; no client-side access.
CREATE TABLE IF NOT EXISTS public.trigger_share_keys (
  id integer PRIMARY KEY DEFAULT 1,
  secret text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT trigger_share_keys_singleton CHECK (id = 1)
);

ALTER TABLE public.trigger_share_keys ENABLE ROW LEVEL SECURITY;

-- Deny everything to anon/authenticated; only the service role bypasses RLS.
REVOKE ALL ON public.trigger_share_keys FROM anon, authenticated;