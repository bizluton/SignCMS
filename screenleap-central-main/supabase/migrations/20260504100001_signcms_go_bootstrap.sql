-- ── SignCMS Go Bootstrap ─────────────────────────────────────────────────────
-- Phase 0: New tables for MCP Player PWA infrastructure

-- ── 1. MCP Tokens ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.mcp_tokens (
  id           uuid        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  org_id       uuid        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id      uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  token_hash   text        NOT NULL UNIQUE,  -- SHA-256 hex of raw token; raw never stored
  name         text        NOT NULL,
  permissions  text[]      NOT NULL DEFAULT ARRAY['read','write'],
  last_used_at timestamptz,
  expires_at   timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_mcp_tokens_org  ON public.mcp_tokens(org_id);
CREATE INDEX idx_mcp_tokens_user ON public.mcp_tokens(user_id);
ALTER TABLE public.mcp_tokens ENABLE ROW LEVEL SECURITY;

CREATE POLICY "mcp_tokens_owner_all"
  ON public.mcp_tokens FOR ALL TO authenticated
  USING  (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "mcp_tokens_sysadmin_all"
  ON public.mcp_tokens FOR ALL TO authenticated
  USING  (public.is_system_admin(auth.uid()))
  WITH CHECK (public.is_system_admin(auth.uid()));

-- ── 2. Push Subscriptions ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.push_subscriptions (
  id          uuid        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id     uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  org_id      uuid        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  endpoint    text        NOT NULL,
  p256dh      text        NOT NULL,
  auth_key    text        NOT NULL,
  device_name text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, endpoint)
);

ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "push_subs_owner"
  ON public.push_subscriptions FOR ALL TO authenticated
  USING  (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- ── 3. Notification Log ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.notification_log (
  id             uuid        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  org_id         uuid        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  type           text        NOT NULL, -- 'screen_offline','license_expiry','emergency', etc.
  reference_id   text,                 -- screen_id, license_id, etc.
  payload        jsonb       NOT NULL DEFAULT '{}',
  sent_at        timestamptz NOT NULL DEFAULT now(),
  snoozed_until  timestamptz
);

CREATE INDEX idx_notif_log_org_type ON public.notification_log(org_id, type, sent_at DESC);
ALTER TABLE public.notification_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "notif_log_org_read"
  ON public.notification_log FOR SELECT TO authenticated
  USING (public.user_in_org(auth.uid(), org_id) OR public.is_system_admin(auth.uid()));

-- ── 4. MCP Audit Log ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.mcp_audit_log (
  id          uuid        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  org_id      uuid        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id     uuid,
  token_id    uuid        REFERENCES public.mcp_tokens(id) ON DELETE SET NULL,
  tool_name   text        NOT NULL,
  params      jsonb       NOT NULL DEFAULT '{}',
  result      jsonb,
  duration_ms integer,
  executed_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_mcp_audit_org  ON public.mcp_audit_log(org_id, executed_at DESC);
CREATE INDEX idx_mcp_audit_user ON public.mcp_audit_log(user_id, executed_at DESC);
ALTER TABLE public.mcp_audit_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "mcp_audit_org_read"
  ON public.mcp_audit_log FOR SELECT TO authenticated
  USING (public.user_in_org(auth.uid(), org_id) OR public.is_system_admin(auth.uid()));

-- Service role inserts (MCP server runs with service role)
CREATE POLICY "mcp_audit_service_insert"
  ON public.mcp_audit_log FOR INSERT TO authenticated
  WITH CHECK (true);

-- ── 5. Screen Footfall Patterns ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.screen_footfall_patterns (
  id           uuid    NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  screen_id    uuid    NOT NULL REFERENCES public.screens(id) ON DELETE CASCADE,
  org_id       uuid    NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  day_of_week  integer NOT NULL CHECK (day_of_week BETWEEN 0 AND 6), -- 0=Sun…6=Sat
  hour_of_day  integer NOT NULL CHECK (hour_of_day BETWEEN 0 AND 23),
  avg_footfall integer NOT NULL DEFAULT 0,
  source       text    NOT NULL DEFAULT 'manual', -- 'manual','iot','inferred'
  UNIQUE (screen_id, day_of_week, hour_of_day)
);

CREATE INDEX idx_footfall_screen ON public.screen_footfall_patterns(screen_id);
ALTER TABLE public.screen_footfall_patterns ENABLE ROW LEVEL SECURITY;

CREATE POLICY "footfall_org_all"
  ON public.screen_footfall_patterns FOR ALL TO authenticated
  USING  (public.user_in_org(auth.uid(), org_id) OR public.is_system_admin(auth.uid()))
  WITH CHECK (public.user_in_org(auth.uid(), org_id) OR public.is_system_admin(auth.uid()));

-- ── 6. Extend screens table ───────────────────────────────────────────────────
ALTER TABLE public.screens
  ADD COLUMN IF NOT EXISTS current_channel_id    uuid REFERENCES public.channels(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS channel_override_until timestamptz;

CREATE INDEX IF NOT EXISTS idx_screens_current_channel
  ON public.screens(current_channel_id)
  WHERE current_channel_id IS NOT NULL;
