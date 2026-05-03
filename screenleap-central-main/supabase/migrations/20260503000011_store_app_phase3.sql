-- ── store_app_versions ────────────────────────────────────────────────────────
CREATE TABLE public.store_app_versions (
  id             uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  app_id         uuid        NOT NULL REFERENCES public.store_apps(id) ON DELETE CASCADE,
  version_tag    text        NOT NULL,
  widget_url     text        NOT NULL,
  changelog_i18n jsonb       NOT NULL DEFAULT '{}',
  status         text        NOT NULL DEFAULT 'draft'
                             CHECK (status IN ('draft','active','deprecated')),
  submitted_by   uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  reviewed_by    uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (app_id, version_tag)
);

CREATE INDEX idx_store_app_versions_app ON public.store_app_versions(app_id);
ALTER TABLE public.store_app_versions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "submitter_read_versions"
  ON public.store_app_versions FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.store_apps WHERE id = app_id AND submitted_by = auth.uid()
  ));

CREATE POLICY "submitter_insert_draft_versions"
  ON public.store_app_versions FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.store_apps WHERE id = app_id AND submitted_by = auth.uid())
  );

CREATE POLICY "system_admin_manage_versions"
  ON public.store_app_versions FOR ALL TO authenticated
  USING  (public.is_system_admin(auth.uid()))
  WITH CHECK (public.is_system_admin(auth.uid()));

-- ── store_app_webhook_logs ────────────────────────────────────────────────────
CREATE TABLE public.store_app_webhook_logs (
  id            uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  app_id        uuid        NOT NULL REFERENCES public.store_apps(id) ON DELETE CASCADE,
  event_type    text        NOT NULL,
  payload       jsonb       NOT NULL DEFAULT '{}',
  status_code   integer,
  response_body text,
  error_msg     text,
  delivered_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_webhook_logs_app_time
  ON public.store_app_webhook_logs(app_id, delivered_at DESC);
ALTER TABLE public.store_app_webhook_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "submitter_read_webhook_logs"
  ON public.store_app_webhook_logs FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.store_apps WHERE id = app_id AND submitted_by = auth.uid()
  ));

CREATE POLICY "system_admin_read_webhook_logs"
  ON public.store_app_webhook_logs FOR SELECT TO authenticated
  USING (public.is_system_admin(auth.uid()));

-- ── store_apps: add active version pointer ────────────────────────────────────
ALTER TABLE public.store_apps
  ADD COLUMN active_version_id uuid
    REFERENCES public.store_app_versions(id) ON DELETE SET NULL;
