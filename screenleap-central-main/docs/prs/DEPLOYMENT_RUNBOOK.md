# Deployment Runbook — Security Hardening (PR-1 / PR-2 / PR-3)

> On-call 照本宣科即可。每個階段都有 **STOP** 條件 —— 觸發時暫停部署、評估、決定是否回滾。

---

## 0. 部署前 24 小時準備

### 0.1 通知

- [ ] 通知工程團隊本週要部署資安修補。
- [ ] 通知 CS：MQTT player 連線、邀請流程、密碼重置、Telegram bot 都會受影響但理論上無感。
- [ ] 取得 staging 與 prod 的部署窗口（建議夜間離峰）。

### 0.2 備份

- [ ] **DB 完整快照**（Supabase Dashboard → Database → Backups → "Make backup"）。
- [ ] 紀錄當前 `master` HEAD commit hash（回滾時要用）：

  ```bash
  git -C screenleap-central-main rev-parse master > /tmp/pre-deploy-master.txt
  cat /tmp/pre-deploy-master.txt
  ```

- [ ] 紀錄當前所有 edge function 版本（Supabase Dashboard → Edge Functions → 每個 function 的最新 deployment ID）。

### 0.3 環境變數預先檢查

到 Supabase Dashboard → Project Settings → Edge Functions Secrets 確認：

- [ ] `MQTT_DEVICE_PASS` 存在（PR-1 legacy fallback 仍需要）
- [ ] `MQTT_SERVER_PASS` 存在
- [ ] `HOOK_SECRET` 存在
- [ ] `PUSH_DELIVERY_KEY` 存在
- [ ] `RESEND_API_KEY` 存在
- [ ] `TELEGRAM_BOT_TOKEN` 存在
- [ ] **不要**在這個階段新增 `MQTT_ALLOW_SHARED_PASSWORD` —— 預設值 `true` 是正確的。
- [ ] **不要**在這個階段新增 `CORS_EXTRA_ORIGINS` —— 預設 allow-list 已含 prod / staging / localhost。

### 0.4 staging 預跑（強烈建議）

把 PR-1 + PR-2 + PR-3 全部先在 staging 跑一遍，依本文件的 smoke test 驗證後再進 prod。

---

## 1. Day 0 — PR-1 部署（Critical Security）

### 1.1 套用 migrations

執行順序由檔名排序決定。確認三個 migration 都成功：

```
20260520000001_playback_logs_null_org_defensive_cleanup.sql
20260520000002_device_registrations_close_anon_leak.sql
20260520000003_device_activation_security.sql
```

驗證：

```sql
-- 三個新 RPC 都存在
SELECT proname FROM pg_proc WHERE proname IN (
  'device_registration_status',
  'claim_screen_activation_code',
  'device_activation_rate_ok',
  'log_device_activation_attempt'
) ORDER BY proname;
-- 預期：4 列

-- device_activation_attempts 表存在
SELECT count(*) FROM public.device_activation_attempts;
-- 預期：0 列（剛建立）

-- anon SELECT policy 已 drop
SELECT polname FROM pg_policy
 WHERE polrelid = 'public.device_registrations'::regclass
   AND polname = 'anon_read_own_registration';
-- 預期：0 列
```

### 1.2 部署 edge functions

依任意順序部署：
- `mqtt-auth`
- `approve-device`
- `register-device`
- `activate-device`
- `scheduled-screen-health-report`
- `upload-media`
- `reset-user-password`

### 1.3 PR-1 Smoke Test

照下列順序操作（不要省略）：

#### 1.3.1 MQTT — 既有 player 不能掉

- [ ] **找 1 台 prod 中正在運行的 player**，觀察其 MQTT 連線狀態（在 Mosquitto log 或 player dashboard）。
- [ ] **STOP**：若 player 在部署後 5 分鐘內掉線且無法重連 → 立即回滾 mqtt-auth function 或設 `MQTT_ALLOW_SHARED_PASSWORD=true`（應已是預設）。

#### 1.3.2 MQTT — 新 player 用 device_token 連得上

- [ ] 在 admin UI 建立一個新螢幕 → 拿到 device_token → 用 mosquitto_sub 模擬：

  ```bash
  mosquitto_sub -h <mqtt-host> -p 8883 --tls \
    -u <screen-uuid> -P <device-token> \
    -t "signage/player/<screen-uuid>/command"
  ```

- [ ] 應能成功 subscribe（不是 Connection Refused）。

#### 1.3.3 `device_registrations` — anon 不能爬

```bash
curl -X GET "https://<project>.supabase.co/rest/v1/device_registrations?select=*" \
  -H "apikey: <anon-key>" \
  -H "Authorization: Bearer <anon-key>"
```

- [ ] **必須**回 `[]`（空陣列），不能列出任何 row。

#### 1.3.4 `device_registrations` — flow 完整

- [ ] 用 web player 開新註冊頁 → 取得 registrationId + claimSecret。
- [ ] admin UI 點「核准」 → web player 應 5 秒內收到 token 並開始播放。
- [ ] DB 查驗：

  ```sql
  SELECT id, status, screen_id, device_token IS NULL AS token_is_null
    FROM public.device_registrations ORDER BY created_at DESC LIMIT 5;
  -- 最新一列：status='approved', screen_id 非 null, token_is_null=true
  ```

#### 1.3.5 `activate-device` — atomic claim

- [ ] admin UI 建立 1 個 6 碼啟用碼。
- [ ] 用兩個瀏覽器同時 POST 同樣的碼 → **只能有一個成功**，另一個應 404 `invalid_code`。
- [ ] 同一個碼第三次 POST → 也應 404。

#### 1.3.6 `activate-device` — rate limit

- [ ] 從同一 IP 連續 11 次 POST 隨機 6 碼亂數 → 第 11 次回 429。
- [ ] 等 5 分鐘後再試 → 應恢復可呼叫。

#### 1.3.7 `scheduled-screen-health-report` 認證

```bash
# 未帶 Authorization
curl -X POST https://<project>.supabase.co/functions/v1/scheduled-screen-health-report
# 預期：401 Unauthorized
```

- [ ] admin 從 UI 按「立即執行」一個 schedule → 應正常跑、收到 email。

#### 1.3.8 `upload-media` cross-org block

- [ ] 以 A 組織用戶身份登入 → 抓出 B 組織的 org_id → 用 dev tools 改 form `org_id=B` → 上傳 → 應 403 Forbidden。

#### 1.3.9 `reset-user-password` 非 system admin

- [ ] 以 org_admin 身份（非 system_admin）重置同組成員密碼 → 應成功（不再 500）。

### 1.4 PR-1 觀察 24~48 小時

監測指標：

- [ ] Supabase Edge Function logs：`mqtt-auth` 4xx 比例不應暴增（pre-deploy 應為 baseline）。
- [ ] `device_activation_attempts` 表每小時 row 數（觀察是否有持續暴力嘗試）：

  ```sql
  SELECT date_trunc('hour', attempted_at) AS hr, count(*) FROM public.device_activation_attempts GROUP BY 1 ORDER BY 1 DESC LIMIT 24;
  ```

- [ ] Player 在線數（與 PR-1 部署前比較）。

### 1.5 PR-1 回滾條件 / 步驟

**觸發回滾**：
- MQTT 連線量比 baseline 跌 > 5%（player 大量掉線）
- `device_registrations` insert 失敗率 > 1%（web player 註冊全壞）
- 任一 P0 smoke test 步驟失敗

**回滾步驟**：

```bash
# 1. Edge functions：revert 對應 7 個 commit
git revert b2b19ac 6e527e7 adea939 2107c62 199b10d fc5a4a7 f8745f3
git push origin master

# 2. 重新 deploy 上述 7 個 edge function

# 3. Migrations 回滾（在 Supabase SQL Editor）
DROP FUNCTION IF EXISTS public.claim_screen_activation_code(text);
DROP FUNCTION IF EXISTS public.device_activation_rate_ok(text);
DROP FUNCTION IF EXISTS public.log_device_activation_attempt(text, text, boolean);
DROP TABLE     IF EXISTS public.device_activation_attempts;
DROP FUNCTION IF EXISTS public.device_registration_status(uuid);

-- 還原 anon SELECT policy（防止有 player 已假設可讀）
CREATE POLICY "anon_read_own_registration"
  ON public.device_registrations FOR SELECT TO anon USING (true);

-- playback_logs policy 還原（如果原本的版本 OK，不必動）
```

---

## 2. Day 2-3 — PR-2 部署（Systemic Hardening）

> **必須**先確認 PR-1 已穩定觀察 48 小時。

### 2.1 套用 migrations

```
20260520000004_playback_logs_indexes.sql
20260520000005_screens_serial_number_unique.sql
20260520000006_profiles_rls_tighten.sql
20260520000007_queue_rpcs_revoke_anon.sql
20260520000008_queue_issue_ticket_for_update.sql
20260520000009_email_send_log_dedup.sql
20260520000010_has_role_admin_means_system_admin.sql
```

**注意 20260520000005**：若 prod 已有重複 `serial_number`，會 RAISE NOTICE 並**跳過** unique index 建立（不阻擋部署）。

**注意 20260520000010**：DO block 會 RAISE NOTICE 列出失去全域 admin 權的人數。

### 2.2 立即執行的人工 SQL

#### 2.2.1 找出受 `has_role` 收緊影響的人

```sql
SELECT ur.user_id, p.display_name, au.email
  FROM public.user_roles ur
  LEFT JOIN public.system_admins sa USING (user_id)
  LEFT JOIN public.profiles p ON p.user_id = ur.user_id
  LEFT JOIN auth.users au ON au.id = ur.user_id
 WHERE ur.role = 'admin' AND sa.user_id IS NULL;
```

- [ ] 把 list 與工程 / 業務 confirm 「誰是真的 system admin」。
- [ ] 名單上的 system admin 加進 `system_admins`：

  ```sql
  INSERT INTO public.system_admins (user_id) VALUES
    ('<uuid-1>'),
    ('<uuid-2>')
  ON CONFLICT DO NOTHING;
  ```

#### 2.2.2 檢查 screens serial_number unique index

```sql
SELECT indexdef FROM pg_indexes
 WHERE indexname = 'screens_serial_number_unique_nonempty';
```

- 若有 → 索引建立成功，跳過。
- 若空 → 處理重複資料：

  ```sql
  -- 找重複
  SELECT serial_number, count(*), array_agg(id) AS screen_ids
    FROM public.screens
   WHERE serial_number IS NOT NULL AND trim(serial_number) <> ''
   GROUP BY serial_number HAVING count(*) > 1;
  ```

  - [ ] 與運維端 / 客戶決定保留哪一筆，把其餘 `UPDATE screens SET serial_number = NULL WHERE id IN (...)`。
  - [ ] 重複清完後手動建索引：

    ```sql
    CREATE UNIQUE INDEX screens_serial_number_unique_nonempty
      ON public.screens (serial_number)
      WHERE serial_number IS NOT NULL AND trim(serial_number) <> '';
    ```

### 2.3 部署 edge functions

- `delete-user`
- `reset-user-password`（PR-1 已動過；PR-2 再加 org_id 驗證）
- `process-email-queue`
- 配合的 frontend 變更也一併 deploy（含 AdminPage.tsx 改傳 org_id）

### 2.4 PR-2 Smoke Test

#### 2.4.1 `has_role` 收緊

- [ ] 用 legacy `admin` role（非 system admin）的測試帳號登入：
  - 應只看到自己 org 的 screens / media / playback_logs（透過 org_admin 路徑）
  - 不應看到別組的資料
- [ ] 用 system_admin 登入：所有資料仍應可見。

#### 2.4.2 `profiles` RLS

- [ ] A 組成員 fetch B 組某用戶的 profile → 0 列。
- [ ] CS agent 接 case 時，customer 與 agent 互相能看到 profile（透過 delegation_grants）。

#### 2.4.3 `delete-user` / `reset-user-password`

- [ ] org_admin 從 UI 操作同組用戶 → 成功（UI 自動帶 activeOrgId）。
- [ ] 直接 curl 不帶 `org_id` 從 org_admin 帳號：

  ```bash
  curl -X POST https://<project>.supabase.co/functions/v1/delete-user \
    -H "Authorization: Bearer <org-admin-jwt>" \
    -H "Content-Type: application/json" \
    -d '{"target_user_id":"<some-uuid>"}'
  # 預期：400 "org_id is required for non-system admins"
  ```

#### 2.4.4 CORS allow-list

從 chromium dev tools console 在 https://google.com 開啟：

```js
fetch("https://<project>.supabase.co/functions/v1/delete-user", { method: "POST" });
```

- [ ] Console 應顯示 CORS error；response 在 browser 不可讀。

#### 2.4.5 queue 取號 race

- [ ] 用兩個 tab 同時打 `queue_issue_ticket(p_queue_id=<uuid>)` → 兩個應拿到**不同**號碼（連續整數）。

#### 2.4.6 email idempotency

- [ ] 模擬重複 enqueue 相同 `message_id`：

  ```sql
  SELECT public.enqueue_email('transactional_emails', '{"message_id":"test-dedup-1","to":"yourself@example.com","from":"SignCMS <noreply@signcms.net>","subject":"dedup test","html":"hi"}'::jsonb);
  SELECT public.enqueue_email('transactional_emails', '{"message_id":"test-dedup-1","to":"yourself@example.com","from":"SignCMS <noreply@signcms.net>","subject":"dedup test","html":"hi"}'::jsonb);
  ```

- [ ] 收信信箱應只收到 1 封；`email_send_log` 應只 1 列 `status='sent'`。

#### 2.4.7 `playback_logs` 索引

```sql
EXPLAIN ANALYZE SELECT * FROM public.playback_logs
 WHERE org_id = '<某 org>'
 ORDER BY played_at DESC LIMIT 100;
```

- [ ] 計畫應走 `idx_playback_logs_org_played`（不是全表掃）。

#### 2.4.8 `formatUserError`

- [ ] 用 org_admin 嘗試 update 別人組的 row（透過 dev tools）→ UI 應顯示「您沒有權限執行此操作」翻譯，不是 Postgres 原文。

### 2.5 PR-2 觀察 24~48 小時

監測：

- [ ] **legacy admin user 抱怨權限不足** → 確認是否該補進 `system_admins`。
- [ ] **profiles 查詢回少了** → 檢查 chat、組織管理頁是否有用戶名顯示為「未知」/ blank。
- [ ] Resend dashboard 重複寄信比例（應為 0）。
- [ ] queue_system_tickets 中是否仍出現重號（應為 0 重複）。

### 2.6 PR-2 回滾條件 / 步驟

**觸發回滾**：
- `has_role` 收緊後 system_admin 名單與預期差異過大、無法在 1 小時內 reconcile
- profiles 隱身嚴重影響 CS workflow（agent 看不到 customer）
- email 寄不出去（idempotency 路徑誤判）

**回滾**：

```bash
git revert 1b3cb7a 747a549 991d23e ef06054 78fbbf3 9f5a593 dd56494 6199060 2734c8c 2a59a29 6b37342 bd60d00
git push origin master

# 重 deploy edge functions

# 還原 has_role
psql -c "
CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role app_role)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS \$\$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id=_user_id AND role=_role);
\$\$;
"

# 還原 profiles policy（如果需要）
psql -c "
DROP POLICY IF EXISTS \"Users can view profiles in shared scope\" ON public.profiles;
CREATE POLICY \"Users can view all profiles\" ON public.profiles FOR SELECT TO authenticated USING (true);
"
```

---

## 3. Day 4-5 — PR-3 部署（Defense in Depth）

> **必須**先確認 PR-2 已穩定觀察 48 小時。

### 3.1 套用 migrations

```
20260521000001_telegram_bot_state_running_lock.sql
20260521000002_invitations_email_case_insensitive.sql
20260521000003_security_definer_search_path_sweep.sql
20260521000004_playback_logs_retention_batched.sql
```

驗證：

```sql
SELECT proname FROM pg_proc WHERE proname IN (
  'claim_telegram_poll_run',
  'release_telegram_poll_run',
  'purge_playback_logs_batched',
  'normalize_invitation_email'
) ORDER BY proname;
-- 預期：4 列

-- invitations 重複 pending 已 expire
SELECT org_id, email, count(*)
  FROM public.invitations
 WHERE status='pending'
 GROUP BY 1,2 HAVING count(*) > 1;
-- 預期：0 列

-- playback-logs-retention cron 已更新
SELECT command FROM cron.job WHERE jobname = 'playback-logs-retention';
-- 預期：SELECT public.purge_playback_logs_batched()
```

### 3.2 部署 edge functions

PR-3 動到的 9 個 edge function（含 PR-1 已動過的兩個再加新增 import）：
- `auth-email-hook`
- `deliver-push`
- `player-dashboard`
- `deliver-webhook`
- `telegram-poll`
- `knowledge-chat`
- `transcode-callback`
- 加 8 個 CORS sweep：`accept-delegation-request`、`revoke-delegation-grant`、`rotate-api-secret`、`migrate-media-to-storage`、`sign-widget-params`、`submit-app-version`、`register-app`、`request-transcode`

### 3.3 PR-3 Smoke Test

#### 3.3.1 timing-safe

從 console 帶錯密碼打 auth-email-hook → 401，但時間應穩定（不能用 timing 區分密碼正確程度）。

#### 3.3.2 `telegram-poll` 並行鎖

- [ ] 在 dashboard 連續觸發兩次 telegram-poll：
  - 第一次 → `{ ok: true, processed: N, finalOffset: ... }`
  - 第二次（5 秒內）→ `{ skipped: true, reason: 'another_invocation_running' }`

#### 3.3.3 `deliver-webhook` nonce

- [ ] 觸發任一個 webhook 事件 → 在 receiver 端看到 payload 含 `nonce` 欄位、signature 仍可驗證。

#### 3.3.4 `knowledge-chat` rate limit

- [ ] 用同帳號連續打 21 次 → 第 21 次應回 429。
- [ ] 用 41 則 messages 打一次 → 應回 400 `too_many_messages`。

#### 3.3.5 `invitations.email`

- [ ] 邀請 `Foo@Example.COM` → DB 內應為 `foo@example.com`。
- [ ] 再邀同 email 同 org → 由 send-invitation 進入 resend 流程（不會 409 unique violation）。

#### 3.3.6 `transcode-callback`

- [ ] 新上傳一個影片 → 轉碼完成後 `media_items.url` 應指向 `assets/<sha256>.mp4`。

#### 3.3.7 `playback_logs` 分批 retention

- [ ] 手動執行：

  ```sql
  SELECT public.purge_playback_logs_batched(INTERVAL '90 days', 1000, 5);
  ```

- [ ] 應回傳整數列數，不應 lock 數十秒；其他 session 在執行期間能正常 INSERT。

#### 3.3.8 CORS sweep

從非 allow-list origin（codepen / `null` origin）打 `accept-delegation-request` → CORS error。

#### 3.3.9 `formatUserError` 全面

隨機在 5 個不同頁面觸發錯誤（例如刻意斷網、嘗試刪除受參照的 media） → 看到的訊息都是翻譯後的人話。

#### 3.3.10 NotFound `<Link>`

- [ ] 在 SPA 內進入不存在的 route → 點返回 → 不應整頁 reload（保留 session）。

### 3.4 PR-3 觀察 24 小時

監測：

- [ ] knowledge-chat 429 比例（觀察 RATE_LIMIT_PER_MIN 是否過嚴）。
- [ ] telegram-poll `skipped` 比例（應佔少數，否則表示 schedule 重疊太頻繁）。
- [ ] activity_logs 內 `knowledge_chat_request` 持續累積，沒爆量。

### 3.5 PR-3 回滾條件 / 步驟

PR-3 改動多但風險都偏低。**單一回滾**：對應 commit `git revert` + redeploy 該 function。**全部回滾**：

```bash
git revert acfe5a6 7aee333 f4c9a52 32882fe 9df586a 99332f8 bfbef7e 48776e7 a6b7a60 62d05d2 79897b8 bb5e941
git push origin master
# 重 deploy 受影響 functions

# Migration 回滾
psql -c "
ALTER TABLE public.telegram_bot_state DROP COLUMN IF EXISTS running_at;
DROP FUNCTION IF EXISTS public.claim_telegram_poll_run(int);
DROP FUNCTION IF EXISTS public.release_telegram_poll_run();
DROP TRIGGER IF EXISTS trg_normalize_invitation_email ON public.invitations;
DROP FUNCTION IF EXISTS public.normalize_invitation_email();
DROP INDEX  IF EXISTS public.invitations_org_email_pending_uniq;
SELECT cron.unschedule('playback-logs-retention');
SELECT cron.schedule('playback-logs-retention', '0 3 * * *',
  'DELETE FROM public.playback_logs WHERE played_at < now() - INTERVAL ''90 days''');
DROP FUNCTION IF EXISTS public.purge_playback_logs_batched(interval, int, int);
"
```

---

## 3.6 PR-3 + `signcms-mcp` 拆分（commit 1186467）

`signcms-mcp/index.ts` (1427 行) 拆成 6 個 sibling 檔（shared.ts /
auth.ts / oauth.ts / tools.ts / llm-proxy.ts + index.ts dispatcher）。
**無語意變更**，但因為 Edge Function 部署是整個目錄一起上，需要驗證
Supabase 真的有把 5 個新檔案傳上去。

部署後 smoke test：

- [ ] **GET /functions/v1/signcms-mcp**（無 auth）→ 應回
  `{ name: "signcms-mcp", tools_count: 22, ... }`（200）。
- [ ] **GET /functions/v1/signcms-mcp/.well-known/oauth-authorization-server**
  → 應回 OAuth metadata JSON（200）。
- [ ] **POST /functions/v1/signcms-mcp** 未帶 Authorization → 401 +
  `WWW-Authenticate` header（OAuth 觸發點）。
- [ ] **MCP token 走 JSON-RPC**：用合法 MCP token 打 `tools/list` →
  回 22 個 tool 定義。
- [ ] **`tools/call` get_screens**：應正常回該 org 的螢幕列表。
- [ ] **Claude.ai 端**：嘗試重連 SignCMS MCP server → OAuth 流程跑得起來。

回滾：`git revert 1186467` —— sibling 檔案會跟著回到不存在；index.ts
回到 monolith 版本。

---

## 4. 全部完成後 — 收尾

- [ ] 在工程 Slack / Notion 發布部署完成通知，附本 runbook 連結。
- [ ] 把 `pre-deploy-master.txt` 內容保留（紀錄 baseline）。
- [ ] **3 天後**確認 prod 穩定，把 PR 文件中標示為 "Out of Scope" 的工作排進下一輪 sprint：
  - 拆 `ContentStudioPage` / `translations.ts`
  - regenerate `supabase types.ts` → 清掉 cast
  - `playback_logs` monthly partitioning
  - `media_items` soft-delete 搬 RLS
  - `MQTT_ALLOW_SHARED_PASSWORD=false`（等所有 player 升完）

---

## 5. 緊急聯絡

- **Migration / DB 問題**：Supabase Dashboard SQL Editor + `pg_stat_activity` 看鎖
- **Edge function 502 / timeout**：Supabase Dashboard → Edge Functions → 該 function logs
- **MQTT 連線異常**：mosquitto-go-auth log（在 broker 機器上）
- **完全救不回來**：用 0.2 的 DB 快照 restore，git push --force-with-lease 把 master 推回 `pre-deploy-master.txt` 內容
