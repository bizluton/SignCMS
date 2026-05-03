-- Insert Global Weather system widget
-- HTML hosted at:
--   system-widgets/global_weather/index.html
-- Public URL:
--   https://narhbpojjtnalyfiwxue.supabase.co/storage/v1/object/public/system-widgets/global_weather/index.html
INSERT INTO public.widgets (scope, name, name_i18n, widget_type, config, sort_order, created_by)
VALUES (
  'system',
  'Weather Global',
  '{"zh":"全球天氣","en":"Weather Global","ja":"グローバル天気"}'::jsonb,
  'weather',
  jsonb_build_object(
    'widgetType',   'weather',
    'url',          'https://narhbpojjtnalyfiwxue.supabase.co/storage/v1/object/public/system-widgets/global_weather/index.html',
    'bgColor',      '#0f172a',
    'textColor',    '#cccccc',
    'animation',    'fadeIn',
    'params', jsonb_build_object(
      'city',         'Tokyo',
      'country',      'JP',
      'lat',          '',
      'lon',          '',
      'fontColor',    '#cccccc',
      'wallColor',    '#0f172a',
      'weatherColor', '#ffffff',
      'layoutMode',   'auto'
    ),
    'paramsSchema', '[
      {"key":"city","type":"text","label":"City","label_zh":"城市","default":"Tokyo"},
      {"key":"country","type":"text","label":"Country Code","label_zh":"國家代碼","default":"JP"},
      {"key":"lat","type":"text","label":"Latitude (optional)","label_zh":"緯度（選填）","default":""},
      {"key":"lon","type":"text","label":"Longitude (optional)","label_zh":"經度（選填）","default":""},
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
  86,
  '3fbb2f97-7268-4cac-a511-7cff6654a8f7'
)
ON CONFLICT DO NOTHING;
