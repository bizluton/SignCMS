
-- Invitations table for org-based user invitations
CREATE TABLE public.invitations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL,
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  invited_by uuid NOT NULL,
  token text NOT NULL UNIQUE DEFAULT encode(gen_random_bytes(32), 'hex'),
  status text NOT NULL DEFAULT 'pending',
  expires_at timestamp with time zone NOT NULL DEFAULT (now() + interval '7 days'),
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.invitations ENABLE ROW LEVEL SECURITY;

-- Admins can insert invitations for their orgs
CREATE POLICY "Admins can insert invitations"
ON public.invitations FOR INSERT TO authenticated
WITH CHECK (
  has_role(auth.uid(), 'admin'::app_role)
  AND (
    user_in_org(auth.uid(), org_id)
    OR auth.uid() = '3fbb2f97-7268-4cac-a511-7cff6654a8f7'
  )
);

-- Admins can view invitations in their orgs
CREATE POLICY "Admins can view invitations"
ON public.invitations FOR SELECT TO authenticated
USING (
  has_role(auth.uid(), 'admin'::app_role)
  AND (
    user_in_org(auth.uid(), org_id)
    OR auth.uid() = '3fbb2f97-7268-4cac-a511-7cff6654a8f7'
  )
);

-- Admins can delete invitations in their orgs
CREATE POLICY "Admins can delete invitations"
ON public.invitations FOR DELETE TO authenticated
USING (
  has_role(auth.uid(), 'admin'::app_role)
  AND (
    user_in_org(auth.uid(), org_id)
    OR auth.uid() = '3fbb2f97-7268-4cac-a511-7cff6654a8f7'
  )
);

-- Allow service role to update invitation status (for accepting)
CREATE POLICY "Service role can update invitations"
ON public.invitations FOR UPDATE TO public
USING (auth.role() = 'service_role'::text)
WITH CHECK (auth.role() = 'service_role'::text);

-- Index for token lookup
CREATE INDEX idx_invitations_token ON public.invitations(token);
CREATE INDEX idx_invitations_email ON public.invitations(email);
CREATE INDEX idx_invitations_org_id ON public.invitations(org_id);
