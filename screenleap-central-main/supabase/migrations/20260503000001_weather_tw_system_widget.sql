-- Create public system-widgets bucket for hosting HTML widget files
INSERT INTO storage.buckets (id, name, public)
VALUES ('system-widgets', 'system-widgets', true)
ON CONFLICT (id) DO UPDATE SET public = true;

-- Anyone can read (needed for iframe srcdoc fetch + direct playback on devices)
DROP POLICY IF EXISTS "system_widgets_public_read" ON storage.objects;
CREATE POLICY "system_widgets_public_read"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'system-widgets');

-- System admin can upload / update / delete
DROP POLICY IF EXISTS "system_widgets_admin_all" ON storage.objects;
CREATE POLICY "system_widgets_admin_all"
  ON storage.objects FOR ALL TO authenticated
  USING  (bucket_id = 'system-widgets' AND auth.uid() = '3fbb2f97-7268-4cac-a511-7cff6654a8f7'::uuid)
  WITH CHECK (bucket_id = 'system-widgets' AND auth.uid() = '3fbb2f97-7268-4cac-a511-7cff6654a8f7'::uuid);

-- Insert Weather_Taiwan system widget
-- The HTML file must be uploaded to:
--   system-widgets/taiwan_weather/index.html
-- Public URL (update project ref if needed):
--   https://narhbpojjtnalyfiwxue.supabase.co/storage/v1/object/public/system-widgets/taiwan_weather/index.html
INSERT INTO public.widgets (scope, name, name_i18n, widget_type, config, sort_order, created_by)
VALUES (
  'system',
  'Weather Taiwan',
  '{"zh":"台灣天氣","en":"Weather Taiwan","ja":"台湾天気"}'::jsonb,
  'weather_tw',
  jsonb_build_object(
    'widgetType',   'weather_tw',
    'url',          'https://narhbpojjtnalyfiwxue.supabase.co/storage/v1/object/public/system-widgets/taiwan_weather/index.html',
    'bgColor',      '#0f172a',
    'textColor',    '#cccccc',
    'animation',    'fadeIn',
    'params', jsonb_build_object(
      'locationName', '臺北市',
      'regionName',   '信義區',
      'fontColor',    '#cccccc',
      'wallColor',    '#0f172a',
      'weatherColor', '#ffffff',
      'layoutMode',   'auto'
    ),
    'paramsSchema', '[
      {"key":"locationName","type":"select","label":"County","label_zh":"縣市","default":"臺北市","options":[
        {"value":"臺北市","label":"Taipei City","label_zh":"臺北市"},
        {"value":"新北市","label":"New Taipei","label_zh":"新北市"},
        {"value":"桃園市","label":"Taoyuan","label_zh":"桃園市"},
        {"value":"臺中市","label":"Taichung","label_zh":"臺中市"},
        {"value":"臺南市","label":"Tainan","label_zh":"臺南市"},
        {"value":"高雄市","label":"Kaohsiung","label_zh":"高雄市"},
        {"value":"基隆市","label":"Keelung","label_zh":"基隆市"},
        {"value":"新竹縣","label":"Hsinchu County","label_zh":"新竹縣"},
        {"value":"新竹市","label":"Hsinchu City","label_zh":"新竹市"},
        {"value":"苗栗縣","label":"Miaoli","label_zh":"苗栗縣"},
        {"value":"彰化縣","label":"Changhua","label_zh":"彰化縣"},
        {"value":"南投縣","label":"Nantou","label_zh":"南投縣"},
        {"value":"雲林縣","label":"Yunlin","label_zh":"雲林縣"},
        {"value":"嘉義縣","label":"Chiayi County","label_zh":"嘉義縣"},
        {"value":"嘉義市","label":"Chiayi City","label_zh":"嘉義市"},
        {"value":"屏東縣","label":"Pingtung","label_zh":"屏東縣"},
        {"value":"宜蘭縣","label":"Yilan","label_zh":"宜蘭縣"},
        {"value":"花蓮縣","label":"Hualien","label_zh":"花蓮縣"},
        {"value":"臺東縣","label":"Taitung","label_zh":"臺東縣"},
        {"value":"澎湖縣","label":"Penghu","label_zh":"澎湖縣"},
        {"value":"金門縣","label":"Kinmen","label_zh":"金門縣"},
        {"value":"連江縣","label":"Lienchiang","label_zh":"連江縣"}
      ]},
      {"key":"regionName","type":"text","label":"District","label_zh":"鄉鎮區","default":"信義區"},
      {"key":"layoutMode","type":"select","label":"Layout","label_zh":"版面模式","default":"auto","options":[
        {"value":"auto","label":"Auto","label_zh":"自動"},
        {"value":"portrait","label":"Portrait","label_zh":"直式"},
        {"value":"landscape","label":"Landscape","label_zh":"橫式"}
      ]},
      {"key":"fontColor","type":"color","label":"Text Color","label_zh":"文字顏色","default":"#cccccc"},
      {"key":"weatherColor","type":"color","label":"Icon Color","label_zh":"圖示顏色","default":"#ffffff"},
      {"key":"wallColor","type":"color","label":"Background","label_zh":"背景顏色","default":"#0f172a"}
    ]'::jsonb
  ),
  85,
  '3fbb2f97-7268-4cac-a511-7cff6654a8f7'
)
ON CONFLICT DO NOTHING;
