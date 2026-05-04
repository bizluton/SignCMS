-- Register the Queue Display widget in the catalog.
-- scope='app' + app_id='queue' means it only appears for orgs that have
-- the queue app installed (gated by useWidgets installedApps filter).
INSERT INTO public.widgets (
  scope,
  name,
  name_i18n,
  widget_type,
  app_id,
  sort_order,
  created_by,
  config
) VALUES (
  'app',
  'Queue Display',
  '{"zh":"叫號顯示","en":"Queue Display","ja":"呼出し番号表示"}'::jsonb,
  'queue-display',
  'queue',
  0,
  '3fbb2f97-7268-4cac-a511-7cff6654a8f7',
  jsonb_build_object(
    'widgetType',    'queue-display',
    'ttsLang',       'zh-TW',
    'cycleSeconds',  8,
    'paramsSchema',  '[
      {"key":"orgId","type":"text","label":"Organisation ID","label_zh":"組織 ID","default":""},
      {"key":"ttsLang","type":"select","label":"TTS Language","label_zh":"語音語言","default":"zh-TW",
       "options":[
         {"value":"zh-TW","label":"中文(台灣)","label_zh":"中文(台灣)"},
         {"value":"en-US","label":"English","label_zh":"英文"},
         {"value":"ja-JP","label":"日本語","label_zh":"日文"}
       ]},
      {"key":"cycleSeconds","type":"number","label":"Cycle Seconds","label_zh":"輪播秒數","default":8,"min":3}
    ]'::jsonb
  )
)
ON CONFLICT DO NOTHING;
