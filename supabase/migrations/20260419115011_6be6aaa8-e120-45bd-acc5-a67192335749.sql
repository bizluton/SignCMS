
-- Widgets table with three scopes: system / app / user
CREATE TABLE public.widgets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scope text NOT NULL CHECK (scope IN ('system','app','user')),
  name text NOT NULL,
  name_i18n jsonb NOT NULL DEFAULT '{}'::jsonb,
  widget_type text NOT NULL,
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  thumbnail text NOT NULL DEFAULT '',
  sort_order integer NOT NULL DEFAULT 0,

  -- scope='app' → references AppStore app id (string key like 'queue', 'weather'...)
  app_id text,

  -- scope='user' → owning org
  org_id uuid REFERENCES public.organizations(id) ON DELETE CASCADE,

  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  -- Scope integrity
  CONSTRAINT widgets_scope_fields_chk CHECK (
    (scope = 'system' AND app_id IS NULL AND org_id IS NULL) OR
    (scope = 'app'    AND app_id IS NOT NULL AND org_id IS NULL) OR
    (scope = 'user'   AND app_id IS NULL AND org_id IS NOT NULL)
  )
);

CREATE INDEX idx_widgets_scope ON public.widgets(scope);
CREATE INDEX idx_widgets_app_id ON public.widgets(app_id) WHERE app_id IS NOT NULL;
CREATE INDEX idx_widgets_org_id ON public.widgets(org_id) WHERE org_id IS NOT NULL;

CREATE TRIGGER trg_widgets_updated_at
  BEFORE UPDATE ON public.widgets
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.widgets ENABLE ROW LEVEL SECURITY;

-- SELECT: everyone authenticated can read system+app widgets; org members read their user widgets
CREATE POLICY "View system and app widgets"
  ON public.widgets FOR SELECT TO authenticated
  USING (scope IN ('system','app'));

CREATE POLICY "View own org user widgets"
  ON public.widgets FOR SELECT TO authenticated
  USING (scope = 'user' AND org_id IS NOT NULL AND public.user_in_org(auth.uid(), org_id));

CREATE POLICY "Admin views all widgets"
  ON public.widgets FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- INSERT: System admin manages system+app; org members create user widgets
CREATE POLICY "System admin can insert system/app widgets"
  ON public.widgets FOR INSERT TO authenticated
  WITH CHECK (
    auth.uid() = '3fbb2f97-7268-4cac-a511-7cff6654a8f7'::uuid
    AND scope IN ('system','app')
  );

CREATE POLICY "Org members can insert user widgets"
  ON public.widgets FOR INSERT TO authenticated
  WITH CHECK (
    scope = 'user'
    AND org_id IS NOT NULL
    AND public.user_in_org(auth.uid(), org_id)
    AND created_by = auth.uid()
  );

-- UPDATE
CREATE POLICY "System admin can update system/app widgets"
  ON public.widgets FOR UPDATE TO authenticated
  USING (
    auth.uid() = '3fbb2f97-7268-4cac-a511-7cff6654a8f7'::uuid
    AND scope IN ('system','app')
  )
  WITH CHECK (
    auth.uid() = '3fbb2f97-7268-4cac-a511-7cff6654a8f7'::uuid
    AND scope IN ('system','app')
  );

CREATE POLICY "Org admin can update user widgets"
  ON public.widgets FOR UPDATE TO authenticated
  USING (
    scope = 'user'
    AND org_id IS NOT NULL
    AND public.user_in_org(auth.uid(), org_id)
    AND public.is_org_admin(auth.uid())
  )
  WITH CHECK (
    scope = 'user'
    AND org_id IS NOT NULL
    AND public.user_in_org(auth.uid(), org_id)
    AND public.is_org_admin(auth.uid())
  );

-- DELETE
CREATE POLICY "System admin can delete system/app widgets"
  ON public.widgets FOR DELETE TO authenticated
  USING (
    auth.uid() = '3fbb2f97-7268-4cac-a511-7cff6654a8f7'::uuid
    AND scope IN ('system','app')
  );

CREATE POLICY "Org admin can delete user widgets"
  ON public.widgets FOR DELETE TO authenticated
  USING (
    scope = 'user'
    AND org_id IS NOT NULL
    AND public.user_in_org(auth.uid(), org_id)
    AND public.is_org_admin(auth.uid())
  );

-- Seed 8 system widgets (created_by = system admin)
INSERT INTO public.widgets (scope, name, name_i18n, widget_type, config, sort_order, created_by) VALUES
('system','Clock',
  '{"zh":"時鐘","en":"Clock","ja":"時計"}'::jsonb,
  'clock',
  '{"widgetType":"clock","clockStyle":"digital","format":"24","showDate":true,"timezone":"Asia/Taipei","bgColor":"#0f172a","textColor":"#ffffff","fontSize":"large","animation":"fadeIn"}'::jsonb,
  10, '3fbb2f97-7268-4cac-a511-7cff6654a8f7'),
('system','Date',
  '{"zh":"日期","en":"Date","ja":"日付"}'::jsonb,
  'date',
  '{"widgetType":"date","bgColor":"#1e293b","textColor":"#ffffff","fontSize":"large","animation":"fadeIn"}'::jsonb,
  20, '3fbb2f97-7268-4cac-a511-7cff6654a8f7'),
('system','Webpage',
  '{"zh":"網頁","en":"Webpage","ja":"ウェブページ"}'::jsonb,
  'webpage',
  '{"widgetType":"webpage","url":"https://example.com","bgColor":"#ffffff","textColor":"#000000","animation":"none"}'::jsonb,
  30, '3fbb2f97-7268-4cac-a511-7cff6654a8f7'),
('system','Marquee',
  '{"zh":"跑馬燈","en":"Marquee","ja":"マーキー"}'::jsonb,
  'marquee',
  '{"widgetType":"marquee","text":"Welcome to SignCMS","speed":"normal","bgColor":"#0f172a","textColor":"#fbbf24","fontSize":"large","animation":"none"}'::jsonb,
  40, '3fbb2f97-7268-4cac-a511-7cff6654a8f7'),
('system','QR Code',
  '{"zh":"QR Code","en":"QR Code","ja":"QRコード"}'::jsonb,
  'qrcode',
  '{"widgetType":"qrcode","qrcodeContent":"https://signcms.com","qrcodeSize":200,"bgColor":"#ffffff","textColor":"#000000","animation":"fadeIn"}'::jsonb,
  50, '3fbb2f97-7268-4cac-a511-7cff6654a8f7'),
('system','Countdown',
  '{"zh":"倒數計時","en":"Countdown","ja":"カウントダウン"}'::jsonb,
  'countdown',
  '{"widgetType":"countdown","countdownTitle":"Countdown","targetDate":"2030-01-01T00:00:00","bgColor":"#1e293b","textColor":"#ffffff","fontSize":"large","animation":"zoomIn"}'::jsonb,
  60, '3fbb2f97-7268-4cac-a511-7cff6654a8f7'),
('system','YouTube',
  '{"zh":"YouTube","en":"YouTube","ja":"YouTube"}'::jsonb,
  'youtube',
  '{"widgetType":"youtube","youtubeUrl":"https://www.youtube.com/watch?v=dQw4w9WgXcQ","bgColor":"#000000","textColor":"#ffffff","animation":"none"}'::jsonb,
  70, '3fbb2f97-7268-4cac-a511-7cff6654a8f7'),
('system','Weather',
  '{"zh":"天氣","en":"Weather","ja":"天気"}'::jsonb,
  'weather',
  '{"widgetType":"weather","city":"Taipei","bgColor":"#0ea5e9","textColor":"#ffffff","fontSize":"large","animation":"fadeIn"}'::jsonb,
  80, '3fbb2f97-7268-4cac-a511-7cff6654a8f7');
