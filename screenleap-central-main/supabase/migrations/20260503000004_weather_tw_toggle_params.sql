-- Add showUV and showAQ display-toggle params to the weather_tw widget
-- Remove weatherColor (no longer used since switching to Meteocons full-color icons)

UPDATE public.widgets
SET config =
  -- 1. Add new defaults to params
  jsonb_set(
  jsonb_set(config,
    '{params,showUV}', 'true'::jsonb),
    '{params,showAQ}', 'true'::jsonb
  )
  -- 2. Append two toggle entries to paramsSchema (and drop weatherColor)
  || jsonb_build_object(
    'paramsSchema',
    (
      SELECT jsonb_agg(elem)
      FROM   jsonb_array_elements(config->'paramsSchema') elem
      WHERE  elem->>'key' != 'weatherColor'
    ) ||
    '[
      {"key":"showUV","type":"toggle","label":"Show UV Index","label_zh":"顯示 UV 指數","default":true},
      {"key":"showAQ","type":"toggle","label":"Show Air Quality","label_zh":"顯示空氣品質","default":true}
    ]'::jsonb
  )
WHERE widget_type = 'weather_tw' AND scope = 'system';
