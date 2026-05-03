-- Insert the Announcement Board widget into the widgets table.
-- scope='app' keeps it in the app catalog rather than the system widget row.
INSERT INTO public.widgets (
  id,
  scope,
  name,
  name_i18n,
  widget_type,
  app_id,
  sort_order,
  created_by,
  config
) VALUES (
  gen_random_uuid(),
  'app',
  'Announcement Board',
  '{"zh":"公告看板","en":"Announcement Board","ja":"お知らせ掲示板"}'::jsonb,
  'announcement',
  'announcement',
  0,
  '3fbb2f97-7268-4cac-a511-7cff6654a8f7',
  jsonb_build_object(
    'widgetType', 'announcement',
    'url', 'https://narhbpojjtnalyfiwxue.supabase.co/storage/v1/object/public/system-widgets/announcement_board/index.html',
    'bgColor', '#0f172a',
    'textColor', '#ffffff',
    'accentColor', '#f97316',
    'animation', 'none',
    'paramsSchema', '[
      {"key":"orgId",       "type":"text",   "label":"Organisation ID",   "label_zh":"組織 ID",     "default":""},
      {"key":"lang",        "type":"select", "label":"Language",          "label_zh":"語言",         "default":"zh",
       "options":[
         {"value":"zh","label":"中文",  "label_zh":"中文"},
         {"value":"en","label":"English","label_zh":"英文"},
         {"value":"ja","label":"日本語","label_zh":"日文"}
       ]},
      {"key":"accentColor", "type":"color",  "label":"Accent Color",      "label_zh":"強調色",       "default":"#f97316"},
      {"key":"bgColor",     "type":"color",  "label":"Background Color",  "label_zh":"背景顏色",     "default":"#0f172a"},
      {"key":"textColor",   "type":"color",  "label":"Text Color",        "label_zh":"文字顏色",     "default":"#ffffff"},
      {"key":"defaultDwell","type":"number", "label":"Default Dwell (s)", "label_zh":"預設停留秒數", "default":10, "min":3}
    ]'::jsonb
  )
)
ON CONFLICT DO NOTHING;
