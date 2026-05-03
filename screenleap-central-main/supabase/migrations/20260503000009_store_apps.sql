-- ── store_apps: third-party app registry ──────────────────────────────────────
-- Third parties register via the register-app Edge Function; a system admin
-- then flips status to 'approved' for it to appear in the App Store.
CREATE TABLE public.store_apps (
  id           uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  slug         text        NOT NULL UNIQUE,          -- used as app_id in widgets table
  name_i18n    jsonb       NOT NULL DEFAULT '{}',    -- { zh, en, ja }
  desc_i18n    jsonb       NOT NULL DEFAULT '{}',
  icon_url     text,
  gradient     text        NOT NULL DEFAULT 'from-gray-500 to-gray-600',
  publisher    text        NOT NULL DEFAULT '',
  website_url  text,
  webhook_url  text,       -- POSTed on install / uninstall events
  widget_url   text,       -- iframe base URL (params appended at display time)
  api_key      text        NOT NULL UNIQUE,
  api_secret   text        NOT NULL,                 -- never returned to client
  status       text        NOT NULL DEFAULT 'pending'
                           CHECK (status IN ('pending','approved','rejected','suspended')),
  submitted_by uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  reviewed_by  uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_store_apps_status ON public.store_apps(status);
ALTER TABLE public.store_apps ENABLE ROW LEVEL SECURITY;

-- Approved apps visible to everyone (anon widget widgets read the slug/gradient).
-- api_secret is excluded — it is only accessible server-side via service role.
CREATE POLICY "public_read_approved_store_apps"
  ON public.store_apps FOR SELECT
  TO anon, authenticated
  USING (status = 'approved');

-- System admins can manage the full registry.
CREATE POLICY "system_admin_manage_store_apps"
  ON public.store_apps FOR ALL
  TO authenticated
  USING  (public.is_system_admin(auth.uid()))
  WITH CHECK (public.is_system_admin(auth.uid()));

-- ── org_installed_apps: per-org external app installs ─────────────────────────
-- Each install gets a stable token so third parties can correlate iframe requests
-- to a specific org without receiving the raw org UUID from the URL.
CREATE TABLE public.org_installed_apps (
  org_id        uuid        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  app_id        uuid        NOT NULL REFERENCES public.store_apps(id)    ON DELETE CASCADE,
  install_token text        NOT NULL UNIQUE DEFAULT encode(gen_random_bytes(32), 'hex'),
  installed_by  uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  installed_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, app_id)
);

CREATE INDEX idx_org_installed_apps_org ON public.org_installed_apps(org_id);
ALTER TABLE public.org_installed_apps ENABLE ROW LEVEL SECURITY;

-- Org members can see which apps their org has installed.
CREATE POLICY "org_member_read_installed_apps"
  ON public.org_installed_apps FOR SELECT
  TO authenticated
  USING (public.user_in_org(auth.uid(), org_id));

-- Org admins can install / uninstall (is_org_admin checks any-org role; user_in_org scopes it).
CREATE POLICY "org_admin_manage_installed_apps"
  ON public.org_installed_apps FOR ALL
  TO authenticated
  USING  (public.is_org_admin(auth.uid()) AND public.user_in_org(auth.uid(), org_id))
  WITH CHECK (public.is_org_admin(auth.uid()) AND public.user_in_org(auth.uid(), org_id));
