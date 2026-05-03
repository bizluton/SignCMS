-- announcement_categories: per-org categories with display color
CREATE TABLE public.announcement_categories (
  id          uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  org_id      uuid        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name        text        NOT NULL,
  color       text        NOT NULL DEFAULT '#6b7280',
  sort_order  integer     NOT NULL DEFAULT 0,
  created_by  uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_announcement_categories_org ON public.announcement_categories(org_id);
ALTER TABLE public.announcement_categories ENABLE ROW LEVEL SECURITY;

-- announcements: the published bulletin entries
CREATE TABLE public.announcements (
  id             uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  org_id         uuid        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  category_id    uuid        REFERENCES public.announcement_categories(id) ON DELETE SET NULL,
  subject        text        NOT NULL,
  content        text        NOT NULL DEFAULT '',
  image_url      text,
  department     text        NOT NULL DEFAULT '',
  pinned         boolean     NOT NULL DEFAULT false,
  dwell_seconds  integer     NOT NULL DEFAULT 10,
  start_at       timestamptz NOT NULL,
  end_at         timestamptz NOT NULL,
  created_by     uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_announcements_org        ON public.announcements(org_id);
CREATE INDEX idx_announcements_org_active ON public.announcements(org_id, start_at, end_at);
ALTER TABLE public.announcements ENABLE ROW LEVEL SECURITY;

-- ── RLS: announcement_categories ──────────────────────────────────────────────
-- Widget (anon) needs category name/color; org members manage their own
CREATE POLICY "anon_read_announcement_categories"
  ON public.announcement_categories FOR SELECT
  TO anon, authenticated
  USING (true);

CREATE POLICY "org_manage_announcement_categories"
  ON public.announcement_categories FOR ALL
  TO authenticated
  USING  (public.user_in_org(auth.uid(), org_id))
  WITH CHECK (public.user_in_org(auth.uid(), org_id));

-- ── RLS: announcements ────────────────────────────────────────────────────────
-- Anon (widget on screen) can read currently active announcements
CREATE POLICY "anon_read_active_announcements"
  ON public.announcements FOR SELECT
  TO anon
  USING (start_at <= now() AND end_at >= now());

-- Authenticated org members can read ALL of their org's announcements
-- (including pending/expired — needed for the management UI)
CREATE POLICY "auth_read_org_announcements"
  ON public.announcements FOR SELECT
  TO authenticated
  USING (public.user_in_org(auth.uid(), org_id));

CREATE POLICY "auth_insert_announcements"
  ON public.announcements FOR INSERT
  TO authenticated
  WITH CHECK (public.user_in_org(auth.uid(), org_id));

CREATE POLICY "auth_update_announcements"
  ON public.announcements FOR UPDATE
  TO authenticated
  USING  (public.user_in_org(auth.uid(), org_id))
  WITH CHECK (public.user_in_org(auth.uid(), org_id));

CREATE POLICY "auth_delete_announcements"
  ON public.announcements FOR DELETE
  TO authenticated
  USING (public.user_in_org(auth.uid(), org_id));
