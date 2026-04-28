
-- =====================================================
-- 1) DROP OLD SCHEDULE TABLES
-- =====================================================
DROP TABLE IF EXISTS public.publish_records CASCADE;
DROP TABLE IF EXISTS public.schedule_bgm_items CASCADE;
DROP TABLE IF EXISTS public.schedule_items CASCADE;
DROP TABLE IF EXISTS public.schedules CASCADE;

-- =====================================================
-- 2) channels
-- =====================================================
CREATE TABLE public.channels (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text NOT NULL DEFAULT '',
  color text NOT NULL DEFAULT '#3b82f6',
  bgm_volume int NOT NULL DEFAULT 50 CHECK (bgm_volume BETWEEN 0 AND 100),
  enabled boolean NOT NULL DEFAULT true,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_channels_org_id ON public.channels(org_id);

ALTER TABLE public.channels ENABLE ROW LEVEL SECURITY;

CREATE POLICY "channels_select_org"
  ON public.channels FOR SELECT
  USING (public.user_in_org(auth.uid(), org_id) OR public.is_system_admin(auth.uid()));

CREATE POLICY "channels_insert_org_admin"
  ON public.channels FOR INSERT
  WITH CHECK (
    public.user_in_org(auth.uid(), org_id)
    AND (public.is_org_admin(auth.uid()) OR public.has_role(auth.uid(), 'admin'))
  );

CREATE POLICY "channels_update_org_admin"
  ON public.channels FOR UPDATE
  USING (
    public.user_in_org(auth.uid(), org_id)
    AND (public.is_org_admin(auth.uid()) OR public.has_role(auth.uid(), 'admin'))
  );

CREATE POLICY "channels_delete_org_admin"
  ON public.channels FOR DELETE
  USING (
    public.user_in_org(auth.uid(), org_id)
    AND (public.is_org_admin(auth.uid()) OR public.has_role(auth.uid(), 'admin'))
  );

CREATE TRIGGER trg_channels_updated
  BEFORE UPDATE ON public.channels
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- =====================================================
-- 3) channel_blocks (calendar OR weekly)
-- =====================================================
CREATE TABLE public.channel_blocks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  channel_id uuid NOT NULL REFERENCES public.channels(id) ON DELETE CASCADE,
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  design_project_id uuid REFERENCES public.design_projects(id) ON DELETE SET NULL,
  name text NOT NULL DEFAULT '',
  color text NOT NULL DEFAULT '#3b82f6',
  block_type text NOT NULL CHECK (block_type IN ('calendar','weekly')),
  -- calendar mode
  start_at timestamptz,
  end_at timestamptz,
  -- weekly mode
  weekdays text[] NOT NULL DEFAULT '{}',
  start_time time,
  end_time time,
  effective_from date,
  effective_to date,
  -- shared
  priority int NOT NULL DEFAULT 0,
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_channel_blocks_channel ON public.channel_blocks(channel_id);
CREATE INDEX idx_channel_blocks_org ON public.channel_blocks(org_id);
CREATE INDEX idx_channel_blocks_type ON public.channel_blocks(block_type);

ALTER TABLE public.channel_blocks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "channel_blocks_select_org"
  ON public.channel_blocks FOR SELECT
  USING (public.user_in_org(auth.uid(), org_id) OR public.is_system_admin(auth.uid()));

CREATE POLICY "channel_blocks_insert_org_admin"
  ON public.channel_blocks FOR INSERT
  WITH CHECK (
    public.user_in_org(auth.uid(), org_id)
    AND (public.is_org_admin(auth.uid()) OR public.has_role(auth.uid(), 'admin'))
  );

CREATE POLICY "channel_blocks_update_org_admin"
  ON public.channel_blocks FOR UPDATE
  USING (
    public.user_in_org(auth.uid(), org_id)
    AND (public.is_org_admin(auth.uid()) OR public.has_role(auth.uid(), 'admin'))
  );

CREATE POLICY "channel_blocks_delete_org_admin"
  ON public.channel_blocks FOR DELETE
  USING (
    public.user_in_org(auth.uid(), org_id)
    AND (public.is_org_admin(auth.uid()) OR public.has_role(auth.uid(), 'admin'))
  );

CREATE TRIGGER trg_channel_blocks_updated
  BEFORE UPDATE ON public.channel_blocks
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Validation trigger for block_type fields
CREATE OR REPLACE FUNCTION public.validate_channel_block()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.block_type = 'calendar' THEN
    IF NEW.start_at IS NULL OR NEW.end_at IS NULL THEN
      RAISE EXCEPTION 'calendar block requires start_at and end_at';
    END IF;
    IF NEW.end_at <= NEW.start_at THEN
      RAISE EXCEPTION 'calendar block end_at must be after start_at';
    END IF;
  ELSIF NEW.block_type = 'weekly' THEN
    IF NEW.start_time IS NULL OR NEW.end_time IS NULL THEN
      RAISE EXCEPTION 'weekly block requires start_time and end_time';
    END IF;
    IF array_length(NEW.weekdays, 1) IS NULL THEN
      RAISE EXCEPTION 'weekly block requires at least one weekday';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_validate_channel_block
  BEFORE INSERT OR UPDATE ON public.channel_blocks
  FOR EACH ROW EXECUTE FUNCTION public.validate_channel_block();

-- =====================================================
-- 4) channel_bgm_items
-- =====================================================
CREATE TABLE public.channel_bgm_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  channel_id uuid NOT NULL REFERENCES public.channels(id) ON DELETE CASCADE,
  media_id uuid NOT NULL REFERENCES public.media_items(id) ON DELETE CASCADE,
  sort_order int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_channel_bgm_channel ON public.channel_bgm_items(channel_id);

ALTER TABLE public.channel_bgm_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "channel_bgm_select_org"
  ON public.channel_bgm_items FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.channels c
      WHERE c.id = channel_id
        AND (public.user_in_org(auth.uid(), c.org_id) OR public.is_system_admin(auth.uid()))
    )
  );

CREATE POLICY "channel_bgm_modify_org_admin"
  ON public.channel_bgm_items FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.channels c
      WHERE c.id = channel_id
        AND public.user_in_org(auth.uid(), c.org_id)
        AND (public.is_org_admin(auth.uid()) OR public.has_role(auth.uid(), 'admin'))
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.channels c
      WHERE c.id = channel_id
        AND public.user_in_org(auth.uid(), c.org_id)
        AND (public.is_org_admin(auth.uid()) OR public.has_role(auth.uid(), 'admin'))
    )
  );

-- =====================================================
-- 5) screen_channel_subscriptions (many-to-many)
-- =====================================================
CREATE TABLE public.screen_channel_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  screen_id uuid NOT NULL REFERENCES public.screens(id) ON DELETE CASCADE,
  channel_id uuid NOT NULL REFERENCES public.channels(id) ON DELETE CASCADE,
  is_default boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (screen_id, channel_id)
);
CREATE INDEX idx_screen_subs_screen ON public.screen_channel_subscriptions(screen_id);
CREATE INDEX idx_screen_subs_channel ON public.screen_channel_subscriptions(channel_id);

ALTER TABLE public.screen_channel_subscriptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "screen_subs_select_org"
  ON public.screen_channel_subscriptions FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.screens s
      WHERE s.id = screen_id
        AND (public.user_in_org(auth.uid(), s.org_id) OR public.is_system_admin(auth.uid()))
    )
  );

CREATE POLICY "screen_subs_modify_org_admin"
  ON public.screen_channel_subscriptions FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.screens s
      WHERE s.id = screen_id
        AND public.user_in_org(auth.uid(), s.org_id)
        AND (public.is_org_admin(auth.uid()) OR public.has_role(auth.uid(), 'admin'))
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.screens s
      WHERE s.id = screen_id
        AND public.user_in_org(auth.uid(), s.org_id)
        AND (public.is_org_admin(auth.uid()) OR public.has_role(auth.uid(), 'admin'))
    )
  );

-- =====================================================
-- 6) screen_channel_switch_triggers (separate from layout triggers)
-- =====================================================
CREATE TABLE public.screen_channel_switch_triggers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  screen_id uuid NOT NULL REFERENCES public.screens(id) ON DELETE CASCADE,
  trigger_type text NOT NULL CHECK (trigger_type IN ('gpio','remote','api')),
  trigger_value text NOT NULL DEFAULT '',
  target_channel_id uuid NOT NULL REFERENCES public.channels(id) ON DELETE CASCADE,
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_switch_triggers_screen ON public.screen_channel_switch_triggers(screen_id);
CREATE INDEX idx_switch_triggers_channel ON public.screen_channel_switch_triggers(target_channel_id);

ALTER TABLE public.screen_channel_switch_triggers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "switch_triggers_select_org"
  ON public.screen_channel_switch_triggers FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.screens s
      WHERE s.id = screen_id
        AND (public.user_in_org(auth.uid(), s.org_id) OR public.is_system_admin(auth.uid()))
    )
  );

CREATE POLICY "switch_triggers_modify_org_admin"
  ON public.screen_channel_switch_triggers FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.screens s
      WHERE s.id = screen_id
        AND public.user_in_org(auth.uid(), s.org_id)
        AND (public.is_org_admin(auth.uid()) OR public.has_role(auth.uid(), 'admin'))
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.screens s
      WHERE s.id = screen_id
        AND public.user_in_org(auth.uid(), s.org_id)
        AND (public.is_org_admin(auth.uid()) OR public.has_role(auth.uid(), 'admin'))
    )
  );

CREATE TRIGGER trg_switch_triggers_updated
  BEFORE UPDATE ON public.screen_channel_switch_triggers
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- =====================================================
-- 7) publish_records (rebuilt for channel publishing)
-- =====================================================
CREATE TABLE public.publish_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  channel_id uuid REFERENCES public.channels(id) ON DELETE SET NULL,
  channel_name text NOT NULL DEFAULT '',
  screen_id uuid REFERENCES public.screens(id) ON DELETE SET NULL,
  screen_name text NOT NULL DEFAULT '',
  published_by uuid,
  scheduled_at timestamptz,
  status text NOT NULL DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_publish_records_channel ON public.publish_records(channel_id);
CREATE INDEX idx_publish_records_screen ON public.publish_records(screen_id);
CREATE INDEX idx_publish_records_created ON public.publish_records(created_at DESC);

ALTER TABLE public.publish_records ENABLE ROW LEVEL SECURITY;

CREATE POLICY "publish_records_select_org"
  ON public.publish_records FOR SELECT
  USING (
    public.is_system_admin(auth.uid())
    OR EXISTS (
      SELECT 1 FROM public.screens s
      WHERE s.id = screen_id AND public.user_in_org(auth.uid(), s.org_id)
    )
    OR EXISTS (
      SELECT 1 FROM public.channels c
      WHERE c.id = channel_id AND public.user_in_org(auth.uid(), c.org_id)
    )
  );

CREATE POLICY "publish_records_insert_org"
  ON public.publish_records FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.channels c
      WHERE c.id = channel_id
        AND public.user_in_org(auth.uid(), c.org_id)
        AND (public.is_org_admin(auth.uid()) OR public.has_role(auth.uid(), 'admin'))
    )
  );
