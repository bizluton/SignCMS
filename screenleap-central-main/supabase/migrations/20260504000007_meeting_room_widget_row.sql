-- Register the Meeting Room Display widget in the catalog.
-- scope='app' + app_id='meeting-room' means it only appears for orgs that
-- have the meeting-room app installed (gated by useWidgets installedApps filter).
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
  'Meeting Room Display',
  '{"zh":"會議室門口機","en":"Meeting Room Display","ja":"会議室ドア表示"}'::jsonb,
  'meeting-room',
  'meeting-room',
  0,
  '3fbb2f97-7268-4cac-a511-7cff6654a8f7',
  jsonb_build_object(
    'widgetType',      'meeting-room',
    'paramsSchema',    '[
      {"key":"apiUrl","type":"text","label":"BizBooking API URL","label_zh":"BizBooking API 網址","default":"http://localhost:8083"},
      {"key":"calendarId","type":"text","label":"Room Calendar ID","label_zh":"會議室行事曆 ID","default":""},
      {"key":"lang","type":"select","label":"Language","label_zh":"語言","default":"zh-TW",
       "options":[
         {"value":"zh-TW","label":"中文(台灣)","label_zh":"中文(台灣)"},
         {"value":"en-US","label":"English","label_zh":"英文"}
       ]},
      {"key":"showTimeline","type":"toggle","label":"Show Schedule","label_zh":"顯示排程","default":true},
      {"key":"refreshSeconds","type":"number","label":"Refresh Interval (s)","label_zh":"刷新間隔(秒)","default":30,"min":10}
    ]'::jsonb
  )
)
ON CONFLICT DO NOTHING;
