-- Add optional team_id to announcements so a post can target a team subset.
-- NULL = org-wide; set = team-only.
ALTER TABLE public.announcements
  ADD COLUMN team_id uuid REFERENCES public.teams(id) ON DELETE SET NULL;

CREATE INDEX idx_announcements_team ON public.announcements(team_id)
  WHERE team_id IS NOT NULL;

-- Update the announcement widget's paramsSchema to include teamId.
-- orgId is now type "org-scope" (handled with a custom picker in ContentStudio).
UPDATE public.widgets
SET config = jsonb_set(
  config,
  '{paramsSchema}',
  '[
    {"key":"orgId",        "type":"org-scope",  "label":"Organisation",       "label_zh":"組織",         "default":""},
    {"key":"teamId",       "type":"team-scope", "label":"Team (optional)",    "label_zh":"團隊（可選）", "default":""},
    {"key":"lang",         "type":"select",     "label":"Language",           "label_zh":"語言",         "default":"zh",
     "options":[
       {"value":"zh","label":"中文",   "label_zh":"中文"},
       {"value":"en","label":"English","label_zh":"英文"},
       {"value":"ja","label":"日本語", "label_zh":"日文"}
     ]},
    {"key":"accentColor",  "type":"color",      "label":"Accent Color",       "label_zh":"強調色",       "default":"#f97316"},
    {"key":"bgColor",      "type":"color",      "label":"Background Color",   "label_zh":"背景顏色",     "default":"#0f172a"},
    {"key":"textColor",    "type":"color",      "label":"Text Color",         "label_zh":"文字顏色",     "default":"#ffffff"},
    {"key":"defaultDwell", "type":"number",     "label":"Default Dwell (s)",  "label_zh":"預設停留秒數", "default":10, "min":3}
  ]'::jsonb
)
WHERE widget_type = 'announcement';
