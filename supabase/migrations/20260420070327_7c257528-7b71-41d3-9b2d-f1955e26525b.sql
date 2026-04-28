
-- ============================================================
-- 資料庫結構優化 (P0 + P1 + P2 核心)
-- P0: 補全 FK 索引
-- P1: ON DELETE CASCADE / SET NULL
-- P2: detail → jsonb、profiles.user_id NOT NULL
-- ============================================================

-- ---------- P0: FK / 熱門查詢索引 ----------
CREATE INDEX IF NOT EXISTS idx_team_members_user_id          ON public.team_members(user_id);
CREATE INDEX IF NOT EXISTS idx_team_members_team_id          ON public.team_members(team_id);
CREATE INDEX IF NOT EXISTS idx_teams_org_id                  ON public.teams(org_id);
CREATE INDEX IF NOT EXISTS idx_user_roles_user_id            ON public.user_roles(user_id);

CREATE INDEX IF NOT EXISTS idx_activity_logs_org_created     ON public.activity_logs(org_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_activity_logs_user_created    ON public.activity_logs(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_chat_sessions_org             ON public.customer_chat_sessions(org_id);
CREATE INDEX IF NOT EXISTS idx_chat_sessions_assigned        ON public.customer_chat_sessions(assigned_to);
CREATE INDEX IF NOT EXISTS idx_chat_sessions_user            ON public.customer_chat_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_chat_messages_session_created ON public.customer_chat_messages(session_id, created_at);

CREATE INDEX IF NOT EXISTS idx_design_projects_org           ON public.design_projects(org_id);
CREATE INDEX IF NOT EXISTS idx_design_projects_created_by    ON public.design_projects(created_by);

CREATE INDEX IF NOT EXISTS idx_iot_devices_org               ON public.iot_devices(org_id);
CREATE INDEX IF NOT EXISTS idx_iot_devices_screen            ON public.iot_devices(screen_id);

CREATE INDEX IF NOT EXISTS idx_knowledge_files_item          ON public.knowledge_files(knowledge_item_id);
CREATE INDEX IF NOT EXISTS idx_knowledge_items_org           ON public.knowledge_items(org_id);

CREATE INDEX IF NOT EXISTS idx_media_items_design_project    ON public.media_items(design_project_id);
CREATE INDEX IF NOT EXISTS idx_media_items_uploaded_by       ON public.media_items(uploaded_by);

CREATE INDEX IF NOT EXISTS idx_playback_logs_media           ON public.playback_logs(media_id);
CREATE INDEX IF NOT EXISTS idx_playback_logs_screen          ON public.playback_logs(screen_id);
CREATE INDEX IF NOT EXISTS idx_playback_logs_org_played      ON public.playback_logs(org_id, played_at DESC);

CREATE INDEX IF NOT EXISTS idx_publish_records_screen        ON public.publish_records(screen_id);
CREATE INDEX IF NOT EXISTS idx_publish_records_schedule      ON public.publish_records(schedule_id);
CREATE INDEX IF NOT EXISTS idx_publish_records_created       ON public.publish_records(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_schedule_items_schedule_sort  ON public.schedule_items(schedule_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_schedule_items_media          ON public.schedule_items(media_id);
CREATE INDEX IF NOT EXISTS idx_schedule_items_design_project ON public.schedule_items(design_project_id);

CREATE INDEX IF NOT EXISTS idx_schedules_org                 ON public.schedules(org_id);
CREATE INDEX IF NOT EXISTS idx_schedules_screen              ON public.schedules(screen_id);

CREATE INDEX IF NOT EXISTS idx_screen_logs_org_created       ON public.screen_logs(org_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_support_tickets_session       ON public.support_tickets(session_id);
CREATE INDEX IF NOT EXISTS idx_support_tickets_assigned      ON public.support_tickets(assigned_to);
CREATE INDEX IF NOT EXISTS idx_ticket_comments_ticket_created ON public.ticket_comments(ticket_id, created_at);

CREATE INDEX IF NOT EXISTS idx_delegation_grants_grantor_status ON public.delegation_grants(grantor_id, status);
CREATE INDEX IF NOT EXISTS idx_delegation_grants_grantee_status ON public.delegation_grants(grantee_id, status);

CREATE INDEX IF NOT EXISTS idx_notifications_user_created    ON public.notifications(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_user_unread     ON public.notifications(user_id) WHERE is_read = false;

CREATE INDEX IF NOT EXISTS idx_invitations_org               ON public.invitations(org_id);
CREATE INDEX IF NOT EXISTS idx_license_codes_org_status      ON public.license_codes(assigned_org_id, status);


-- ---------- P1: ON DELETE CASCADE / SET NULL ----------
-- team_members → teams: CASCADE
ALTER TABLE public.team_members DROP CONSTRAINT IF EXISTS team_members_team_id_fkey;
ALTER TABLE public.team_members
  ADD CONSTRAINT team_members_team_id_fkey
  FOREIGN KEY (team_id) REFERENCES public.teams(id) ON DELETE CASCADE;

-- teams → organizations: CASCADE
ALTER TABLE public.teams DROP CONSTRAINT IF EXISTS teams_org_id_fkey;
ALTER TABLE public.teams
  ADD CONSTRAINT teams_org_id_fkey
  FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE CASCADE;

-- schedule_items → schedules: CASCADE
ALTER TABLE public.schedule_items DROP CONSTRAINT IF EXISTS schedule_items_schedule_id_fkey;
ALTER TABLE public.schedule_items
  ADD CONSTRAINT schedule_items_schedule_id_fkey
  FOREIGN KEY (schedule_id) REFERENCES public.schedules(id) ON DELETE CASCADE;

-- schedule_bgm_items → schedules: CASCADE
ALTER TABLE public.schedule_bgm_items DROP CONSTRAINT IF EXISTS schedule_bgm_items_schedule_id_fkey;
ALTER TABLE public.schedule_bgm_items
  ADD CONSTRAINT schedule_bgm_items_schedule_id_fkey
  FOREIGN KEY (schedule_id) REFERENCES public.schedules(id) ON DELETE CASCADE;

-- iot_sensor_readings → iot_devices: CASCADE
ALTER TABLE public.iot_sensor_readings DROP CONSTRAINT IF EXISTS iot_sensor_readings_device_id_fkey;
ALTER TABLE public.iot_sensor_readings
  ADD CONSTRAINT iot_sensor_readings_device_id_fkey
  FOREIGN KEY (device_id) REFERENCES public.iot_devices(id) ON DELETE CASCADE;

-- knowledge_files → knowledge_items: CASCADE
ALTER TABLE public.knowledge_files DROP CONSTRAINT IF EXISTS knowledge_files_knowledge_item_id_fkey;
ALTER TABLE public.knowledge_files
  ADD CONSTRAINT knowledge_files_knowledge_item_id_fkey
  FOREIGN KEY (knowledge_item_id) REFERENCES public.knowledge_items(id) ON DELETE CASCADE;

-- knowledge_item_tags → knowledge_items: CASCADE
ALTER TABLE public.knowledge_item_tags DROP CONSTRAINT IF EXISTS knowledge_item_tags_knowledge_item_id_fkey;
ALTER TABLE public.knowledge_item_tags
  ADD CONSTRAINT knowledge_item_tags_knowledge_item_id_fkey
  FOREIGN KEY (knowledge_item_id) REFERENCES public.knowledge_items(id) ON DELETE CASCADE;

-- knowledge_item_shares → knowledge_items: CASCADE
ALTER TABLE public.knowledge_item_shares DROP CONSTRAINT IF EXISTS knowledge_item_shares_knowledge_item_id_fkey;
ALTER TABLE public.knowledge_item_shares
  ADD CONSTRAINT knowledge_item_shares_knowledge_item_id_fkey
  FOREIGN KEY (knowledge_item_id) REFERENCES public.knowledge_items(id) ON DELETE CASCADE;

-- chat_session_notes → customer_chat_sessions: CASCADE
ALTER TABLE public.chat_session_notes DROP CONSTRAINT IF EXISTS chat_session_notes_session_id_fkey;
ALTER TABLE public.chat_session_notes
  ADD CONSTRAINT chat_session_notes_session_id_fkey
  FOREIGN KEY (session_id) REFERENCES public.customer_chat_sessions(id) ON DELETE CASCADE;

-- chat_session_tags → customer_chat_sessions: CASCADE
ALTER TABLE public.chat_session_tags DROP CONSTRAINT IF EXISTS chat_session_tags_session_id_fkey;
ALTER TABLE public.chat_session_tags
  ADD CONSTRAINT chat_session_tags_session_id_fkey
  FOREIGN KEY (session_id) REFERENCES public.customer_chat_sessions(id) ON DELETE CASCADE;

-- ticket_comments → support_tickets: CASCADE
ALTER TABLE public.ticket_comments DROP CONSTRAINT IF EXISTS ticket_comments_ticket_id_fkey;
ALTER TABLE public.ticket_comments
  ADD CONSTRAINT ticket_comments_ticket_id_fkey
  FOREIGN KEY (ticket_id) REFERENCES public.support_tickets(id) ON DELETE CASCADE;

-- screens → organizations: CASCADE
ALTER TABLE public.screens DROP CONSTRAINT IF EXISTS screens_org_id_fkey;
ALTER TABLE public.screens
  ADD CONSTRAINT screens_org_id_fkey
  FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE CASCADE;

-- schedules → organizations: CASCADE; → screens: SET NULL
ALTER TABLE public.schedules DROP CONSTRAINT IF EXISTS schedules_org_id_fkey;
ALTER TABLE public.schedules
  ADD CONSTRAINT schedules_org_id_fkey
  FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE CASCADE;
ALTER TABLE public.schedules DROP CONSTRAINT IF EXISTS schedules_screen_id_fkey;
ALTER TABLE public.schedules
  ADD CONSTRAINT schedules_screen_id_fkey
  FOREIGN KEY (screen_id) REFERENCES public.screens(id) ON DELETE SET NULL;

-- design_projects → organizations: CASCADE
ALTER TABLE public.design_projects DROP CONSTRAINT IF EXISTS design_projects_org_id_fkey;
ALTER TABLE public.design_projects
  ADD CONSTRAINT design_projects_org_id_fkey
  FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE CASCADE;

-- knowledge_items → organizations: CASCADE
ALTER TABLE public.knowledge_items DROP CONSTRAINT IF EXISTS knowledge_items_org_id_fkey;
ALTER TABLE public.knowledge_items
  ADD CONSTRAINT knowledge_items_org_id_fkey
  FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE CASCADE;

-- media_items → organizations: CASCADE; design_project: SET NULL
ALTER TABLE public.media_items DROP CONSTRAINT IF EXISTS media_items_org_id_fkey;
ALTER TABLE public.media_items
  ADD CONSTRAINT media_items_org_id_fkey
  FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE CASCADE;
ALTER TABLE public.media_items DROP CONSTRAINT IF EXISTS media_items_design_project_id_fkey;
ALTER TABLE public.media_items
  ADD CONSTRAINT media_items_design_project_id_fkey
  FOREIGN KEY (design_project_id) REFERENCES public.design_projects(id) ON DELETE SET NULL;

-- iot_devices → organizations / screens: CASCADE
ALTER TABLE public.iot_devices DROP CONSTRAINT IF EXISTS iot_devices_org_id_fkey;
ALTER TABLE public.iot_devices
  ADD CONSTRAINT iot_devices_org_id_fkey
  FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE CASCADE;
ALTER TABLE public.iot_devices DROP CONSTRAINT IF EXISTS iot_devices_screen_id_fkey;
ALTER TABLE public.iot_devices
  ADD CONSTRAINT iot_devices_screen_id_fkey
  FOREIGN KEY (screen_id) REFERENCES public.screens(id) ON DELETE CASCADE;

-- iot_sensor_readings → org / screen: CASCADE
ALTER TABLE public.iot_sensor_readings DROP CONSTRAINT IF EXISTS iot_sensor_readings_org_id_fkey;
ALTER TABLE public.iot_sensor_readings
  ADD CONSTRAINT iot_sensor_readings_org_id_fkey
  FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE CASCADE;
ALTER TABLE public.iot_sensor_readings DROP CONSTRAINT IF EXISTS iot_sensor_readings_screen_id_fkey;
ALTER TABLE public.iot_sensor_readings
  ADD CONSTRAINT iot_sensor_readings_screen_id_fkey
  FOREIGN KEY (screen_id) REFERENCES public.screens(id) ON DELETE CASCADE;

-- invitations → organizations: CASCADE
ALTER TABLE public.invitations DROP CONSTRAINT IF EXISTS invitations_org_id_fkey;
ALTER TABLE public.invitations
  ADD CONSTRAINT invitations_org_id_fkey
  FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE CASCADE;

-- widgets → organizations: CASCADE
ALTER TABLE public.widgets DROP CONSTRAINT IF EXISTS widgets_org_id_fkey;
ALTER TABLE public.widgets
  ADD CONSTRAINT widgets_org_id_fkey
  FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE CASCADE;

-- screen_logs → org / screen: CASCADE
ALTER TABLE public.screen_logs DROP CONSTRAINT IF EXISTS screen_logs_org_id_fkey;
ALTER TABLE public.screen_logs
  ADD CONSTRAINT screen_logs_org_id_fkey
  FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE CASCADE;
ALTER TABLE public.screen_logs DROP CONSTRAINT IF EXISTS screen_logs_screen_id_fkey;
ALTER TABLE public.screen_logs
  ADD CONSTRAINT screen_logs_screen_id_fkey
  FOREIGN KEY (screen_id) REFERENCES public.screens(id) ON DELETE CASCADE;

-- activity_logs → organizations: SET NULL（保留歷史審計）
ALTER TABLE public.activity_logs DROP CONSTRAINT IF EXISTS activity_logs_org_id_fkey;
ALTER TABLE public.activity_logs
  ADD CONSTRAINT activity_logs_org_id_fkey
  FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE SET NULL;

-- publish_records → schedules / screens: SET NULL（保留歷史）
ALTER TABLE public.publish_records DROP CONSTRAINT IF EXISTS publish_records_schedule_id_fkey;
ALTER TABLE public.publish_records
  ADD CONSTRAINT publish_records_schedule_id_fkey
  FOREIGN KEY (schedule_id) REFERENCES public.schedules(id) ON DELETE SET NULL;
ALTER TABLE public.publish_records DROP CONSTRAINT IF EXISTS publish_records_screen_id_fkey;
ALTER TABLE public.publish_records
  ADD CONSTRAINT publish_records_screen_id_fkey
  FOREIGN KEY (screen_id) REFERENCES public.screens(id) ON DELETE SET NULL;

-- playback_logs → media / screen / org: SET NULL / CASCADE
ALTER TABLE public.playback_logs DROP CONSTRAINT IF EXISTS playback_logs_media_id_fkey;
ALTER TABLE public.playback_logs
  ADD CONSTRAINT playback_logs_media_id_fkey
  FOREIGN KEY (media_id) REFERENCES public.media_items(id) ON DELETE SET NULL;
ALTER TABLE public.playback_logs DROP CONSTRAINT IF EXISTS playback_logs_screen_id_fkey;
ALTER TABLE public.playback_logs
  ADD CONSTRAINT playback_logs_screen_id_fkey
  FOREIGN KEY (screen_id) REFERENCES public.screens(id) ON DELETE SET NULL;
ALTER TABLE public.playback_logs DROP CONSTRAINT IF EXISTS playback_logs_org_id_fkey;
ALTER TABLE public.playback_logs
  ADD CONSTRAINT playback_logs_org_id_fkey
  FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE CASCADE;

-- ---------- P2: profiles.user_id NOT NULL ----------
ALTER TABLE public.profiles ALTER COLUMN user_id SET NOT NULL;

-- ---------- P2: activity_logs.detail 增設 jsonb 鏡像欄位（保留 text 相容性）----------
-- 注意：現有程式碼仍使用 detail (text)，新增 detail_json (jsonb) 供未來查詢使用，可漸進遷移
ALTER TABLE public.activity_logs ADD COLUMN IF NOT EXISTS detail_json jsonb;
CREATE INDEX IF NOT EXISTS idx_activity_logs_detail_json ON public.activity_logs USING GIN (detail_json);
COMMENT ON COLUMN public.activity_logs.detail IS 'DEPRECATED: 請寫入 action_code + action_params (jsonb)。新欄位 detail_json 為 jsonb 格式鏡像。';

-- ---------- 統計信息更新 ----------
ANALYZE public.team_members;
ANALYZE public.activity_logs;
ANALYZE public.media_items;
ANALYZE public.schedules;
ANALYZE public.schedule_items;
