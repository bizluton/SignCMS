# PR-2: Systemic Security & Reliability

> 處理 code review 報告中 13 個 P1 結構性問題：跨租戶旁路、競爭條件、缺索引、錯誤呈現等。**依賴 PR-1 已合併**。

## Summary

| 領域 | 修補 |
|---|---|
| **跨租戶資料邊界** | `has_role('admin')` 等同 `is_system_admin`；`profiles` RLS 收緊到同 org / delegation；`delete-user` / `reset-user-password` 需明示 org_id |
| **CSRF 防護** | `_shared/cors.ts` allow-list helper；6 個高敏 mutation endpoint 套用 |
| **資料完整性** | `screens.serial_number` partial unique；email queue partial unique + Resend Idempotency-Key；invitation 表 tombstone duplicate |
| **競爭條件** | `queue_issue_ticket` / `queue_issue_liff_ticket` `FOR UPDATE` 鎖；`process-email-queue` 雙路 idempotency |
| **效能** | `playback_logs` 加 `(org_id, played_at)` / `(screen_id, played_at)` 複合索引 |
| **UX** | `formatUserError(err, t)` helper —— 把原始 Postgres / Supabase 錯誤映射到翻譯 key |
| **型別** | `rpc<T>()` helper —— 取代 `(supabase.rpc as unknown as ...)` 鏈 |
| **權限** | queue_* SECURITY DEFINER RPC 從 anon revoke + 加 search_path |

## Background

PR-1 封住了「外部可低成本利用」的漏洞；PR-2 處理的是「需要某種特權位置才能利用，但會把 SaaS 多租戶邊界戳穿」的問題。其中最重要的是 `has_role(uid, 'admin')` 的旁路：歷史上 `handle_new_user` trigger 把 `admin` 角色發給每個 org 的第一個用戶，導致每個 org 創立者都享有跨租戶讀權限。

策略上採用「**改函式語意 vs 改 222 處 policy**」的取捨：redefine `has_role` 讓 `admin` role 等同 `is_system_admin`，一次封住所有 220+ 個 policy 內的旁路。

## What's in this PR

### Migrations

1. **`20260520000004_playback_logs_indexes.sql`**
   - `(org_id, played_at DESC)`、`(screen_id, played_at DESC)`、`(media_id)` 複合索引。
   - 在 ~430M 列/月的高流量表上 reporting 查詢從全表掃改為 index seek。

2. **`20260520000005_screens_serial_number_unique.sql`**
   - 拿掉 `DEFAULT ''`；加 partial UNIQUE INDEX `(serial_number) WHERE NOT empty`。
   - 防禦性：若 prod 已有非空重複，NOTICE 跳過 index 建立、不阻擋部署。

3. **`20260520000006_profiles_rls_tighten.sql`**
   - DROP `"Users can view all profiles" USING (true)`。
   - 新 helper `users_share_org(viewer, target)`、`users_have_active_delegation(a, b)`。
   - 新 policy：self / `is_system_admin` / shared org / active delegation 任一即可看。

4. **`20260520000007_queue_rpcs_revoke_anon.sql`**
   - `queue_call_next`、`queue_reset` 重新宣告加 `SET search_path = public, pg_temp`。
   - 全部 queue RPC（含 issue_ticket / issue_liff_ticket）`REVOKE EXECUTE FROM PUBLIC` + `GRANT TO authenticated`。

5. **`20260520000008_queue_issue_ticket_for_update.sql`**
   - `queue_issue_ticket` 與 `queue_issue_liff_ticket` 重新宣告：取號前 `SELECT current_number … FOR UPDATE` 序列化 per queue。
   - 解決並行兩個 kiosk 取到同號的 race。

6. **`20260520000009_email_send_log_dedup.sql`**
   - `email_send_log (message_id) WHERE message_id IS NOT NULL AND status='sent'` partial UNIQUE INDEX。
   - 配合 `process-email-queue` 改動形成雙路 idempotency。

7. **`20260520000010_has_role_admin_means_system_admin.sql`**
   - **核心修補**：`has_role(_user_id, 'admin')` 改為 `is_system_admin(_user_id)`；其他 role 不變。
   - 等效於把 220+ 個 RLS policy 內的 `has_role(uid, 'admin')` 旁路全部收緊，不用實際改 policy 文字。
   - 部署時 DO block 會 NOTICE 列出受影響人數（持有 legacy `user_roles.role=admin` 但不在 `system_admins`），附查詢 SQL。

### Edge functions

- **`delete-user/index.ts`** & **`reset-user-password/index.ts`** — 改成 org-scoped：non-system-admin 必須在 request 帶 `org_id`，caller 與 target 都必須在該 org，且 caller 是該 org 的 admin / org_admin。
- **`process-email-queue/index.ts`** — Resend 請求加 `Idempotency-Key: <message_id>`；INSERT 'sent' row 失敗 SQLSTATE 23505 → 視為「另一 worker 已標 sent」忽略。
- **PR-1 已動到的另一面**：本 PR 不再動 mqtt-auth / activate-device 等。

### Shared infrastructure（新增 / 已建）

- **`supabase/functions/_shared/cors.ts`** — `corsHeaders(req)` / `corsPreflight(req)` helper。allow-list 含 `signcms.net`、`www`、`staging`、`localhost:5173|8080`。可加 `CORS_EXTRA_ORIGINS` env var 補充。
- **`src/lib/formatUserError.ts`** — Translator-aware 錯誤映射；SQLSTATE 與訊息子字串對應翻譯 key。
- **`src/lib/db.ts`** — `rpc<T>(fn, args)` typed wrapper。

### CORS sweep（6 個 high-impact endpoint）

- `delete-user`
- `reset-user-password`
- `upload-media`
- `send-invitation`
- `approve-device`
- `scheduled-screen-health-report`

### formatUserError 套用（6 個高頻 React 檔）

- `SmartTriggerPanel.tsx`（5 處）
- `LicenseManagement.tsx`（2 處）
- `OrgManagement.tsx`（3 處）
- `CSAgentManagement.tsx`（3 處）
- `WebhookTokenCard.tsx`（2 處）
- `PendingDelegationButton.tsx`（1 處）

剩餘 sweep 由 PR-3 處理。

## Risk Assessment

| 風險 | 嚴重度 | 緩解 |
|---|---|---|
| `has_role('admin')` redefine 後 legacy org 創立者失去全域權 | **高** | 部署當下 NOTICE 列出受影響人數，運維端可手動加入 system_admins 補救。對 legitimate use case 來說，這些用戶仍可透過 `org_admin` 看到自己組織的資料 |
| `profiles` 新 policy 漏給 CS↔customer 顯示名稱 | 中 | policy 含 `users_have_active_delegation` 分支，已涵蓋 CS workflow；若有發現 chat 列表名稱變空白，補 delegation 即可 |
| `screens.serial_number` 重複資料阻擋 unique index | 低 | migration 設計就跳過、留 NOTICE，部署不會 fail |
| email queue partial unique 與 race 互動 | 低 | 雙路 idempotency（DB + Resend Idempotency-Key）兩端任一鬆掉，另一端仍守住 |
| CORS allow-list 把預覽部署擋掉 | 低 | `CORS_EXTRA_ORIGINS` env var 即時補上即可 |
| `rpc<T>()` helper 內仍是 `any` cast | 低 | helper 本身一個檔案，邊界清楚；待 `types.ts` regen 後再淘汰 |

## Deployment

1. **Apply migrations**（順序由檔名決定）。`20260520000010` 會 NOTICE 列出 legacy `admin` 持有者。
2. **執行 NOTICE 內附的 SQL**，把仍需要全域 admin 權限的人補進 `system_admins`：

   ```sql
   SELECT ur.user_id, p.display_name
     FROM public.user_roles ur
     LEFT JOIN public.system_admins sa USING (user_id)
     LEFT JOIN public.profiles p ON p.user_id = ur.user_id
    WHERE ur.role = 'admin' AND sa.user_id IS NULL;

   INSERT INTO public.system_admins (user_id) VALUES ('<their-uuid>');
   ```

3. **Deploy edge functions**。
4. **檢查 `screens_serial_number_unique_nonempty` 索引是否建立**：

   ```sql
   SELECT 1 FROM pg_indexes WHERE indexname = 'screens_serial_number_unique_nonempty';
   ```

   若無 → 表示有 prod 重複資料；清掉後手動建：

   ```sql
   SELECT serial_number, count(*) FROM screens
    WHERE serial_number IS NOT NULL AND trim(serial_number) <> ''
    GROUP BY serial_number HAVING count(*) > 1;

   -- 清掉重複後
   CREATE UNIQUE INDEX screens_serial_number_unique_nonempty
     ON public.screens (serial_number)
     WHERE serial_number IS NOT NULL AND trim(serial_number) <> '';
   ```

5. **Smoke test** → 觀察 24~48 小時 → 部署 PR-3。

### 必要 env vars / 配置

- `CORS_EXTRA_ORIGINS`（選擇性）：逗號分隔。預設 allow-list 已含 prod / staging / localhost。

## Smoke Test

- [ ] **`has_role` 收緊**：用 legacy `admin` role（非 system admin）帳號登入。應只能看自己組織的資料，不能跨組織。
- [ ] **`profiles` RLS**：同 org 用戶之間互看 display_name 正常；A 組登入查 B 組用戶 `select * from profiles where user_id='<B>'` 應回 0 列。
- [ ] **CS↔customer 名稱顯示**：CS agent 接 case 時應仍能看到 customer profile（透過 active delegation）。
- [ ] **`delete-user` / `reset-user-password`**：以 org_admin 從 UI 操作同組成員 → 成功；嘗試 curl 不帶 `org_id` → 400。
- [ ] **CORS**：從非 allow-list origin（例如某 codepen）fetch `/functions/v1/delete-user` → browser 應在 console 顯示 CORS 錯誤（不會 leak response）。
- [ ] **`screens.serial_number`**：嘗試手動插入兩筆相同 non-empty serial → 應 unique violation。
- [ ] **`queue_issue_ticket`**：兩個 client 同時打 → 兩個拿到不同號碼。
- [ ] **email queue**：模擬重複 enqueue 相同 `message_id` → 只寄出一次（檢查 Resend dashboard）。
- [ ] **`playback_logs` 查詢效能**：`EXPLAIN ANALYZE SELECT * FROM playback_logs WHERE org_id=? ORDER BY played_at DESC LIMIT 100` 應走 `idx_playback_logs_org_played`。
- [ ] **`formatUserError`**：故意造一個 RLS 違規（例如非 admin 嘗試 update 別人的 row）→ UI 應顯示翻譯後的「您沒有權限執行此操作」而非 Postgres 原文。

## Rollback

每個 migration 可獨立回滾。最有破壞性的是 `20260520000010`（has_role 行為變更）；回滾需：

```sql
-- 還原成只看 user_roles 的版本
CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role app_role)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role);
$$;
```

profiles policy 回滾：

```sql
DROP POLICY "Users can view profiles in shared scope" ON public.profiles;
CREATE POLICY "Users can view all profiles" ON public.profiles
  FOR SELECT TO authenticated USING (true);
```

其他 migration 多為加 INDEX 或新增欄位 / RPC，DROP 即可。

## Commits in this PR

```
bd60d00 chore(db): 把重複的 email_infra migration 改為 tombstone
6b37342 perf(db): playback_logs 加 (org_id, played_at) 與 (screen_id, played_at) 索引
2a59a29 fix(db): screens.serial_number 拿掉 DEFAULT '' + 加 partial unique index
2734c8c fix(security): profiles RLS 收緊（self / system_admin / 同 org / 有 delegation）
6199060 fix(security): queue_* SECURITY DEFINER RPC 從 anon 收回 + 加 search_path
dd56494 fix(db): queue_issue_ticket / queue_issue_liff_ticket 加 FOR UPDATE 鎖
9f5a593 fix(reliability): email 寄送 idempotency — Resend header + DB partial unique
78fbbf3 fix(security): has_role(uid, 'admin') 等同 is_system_admin —— 關掉全域 admin 旁路
ef06054 fix(security): delete-user / reset-user-password 改成 org-scoped 權限
991d23e fix(security): CORS allow-list 統一 helper + 套用 6 個敏感 endpoint
747a549 fix(ux): formatUserError helper —— 不再把原始 Postgres / Supabase 訊息丟給用戶
1b3cb7a chore(types): rpc<T>() helper —— 替代 (supabase.rpc as unknown as ...) 鏈
```

## Out of Scope

→ PR-3：
- 剩餘 `SECURITY DEFINER` 函式 search_path 補齊
- 剩餘 ~22 個 edge function 套 CORS helper
- 剩餘 ~25 個 React 檔套 formatUserError
- timing-safe compare 套用到 auth-email-hook / deliver-push / player-dashboard
- nonce / advisory lock / rate limit 等較窄面的補強
