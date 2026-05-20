# PR-3: Defense-in-Depth & UX Cleanup

> 12 個 P2 加固項目：timing-safe / nonce / rate limit / retention 分批 / 全面 sweep。**依賴 PR-2 已合併**。風險低、可機械化驗證。

## Summary

| 領域 | 修補 |
|---|---|
| **Timing-safe compare** | `auth-email-hook` / `deliver-push` / `player-dashboard` 三個敏感 secret 比對改 XOR 迴圈 |
| **Replay & race** | `deliver-webhook` payload 加 nonce；`telegram-poll` row-level running lock；`activate-device` 已於 PR-1 |
| **Cost / abuse** | `knowledge-chat` 加 input cap + per-user 20 次/分鐘 rate limit |
| **資料完整性** | `transcode-callback` storage path 改 sha256（不允許 null）；`invitations.email` lowercase + partial unique |
| **效能** | `playback_logs` retention 改成分批 DELETE（pg_sleep 0.05s/批，最多 5M 列/次）|
| **DDL hygiene** | 補齊剩餘 5 個 `SECURITY DEFINER` 函式的 `search_path` |
| **UX** | `formatUserError` 全面 sweep ~25 個檔案；NotFound 改用 `<Link>` |
| **DX** | `src/lib/roles.ts` 集中 role 字串常數 + `isAdminLike` 等 predicate |
| **CORS sweep** | 再 8 個敏感 mutation endpoint 套 allow-list |
| **Soft-delete** | `media_items` 讀取補 `deleted_at IS NULL` 過濾 12 處 |

## Background

PR-3 處理的是「單獨看不致命，但累積起來會在規模成長後爆發」的問題。重點在**全面性**而非單點修補：把 PR-2 引入的 `_shared/cors.ts`、`formatUserError`、`is_system_admin` 等基礎建設**推到全 codebase**。

## What's in this PR

### Migrations

1. **`20260521000001_telegram_bot_state_running_lock.sql`**
   - `telegram_bot_state` 加 `running_at timestamptz`。
   - RPC `claim_telegram_poll_run(stale_after_seconds=300)` / `release_telegram_poll_run()`。
   - 並行 invocation 第二個被擋掉，5 分鐘 stale window 防 crash 後鎖死。

2. **`20260521000002_invitations_email_case_insensitive.sql`**
   - 把現有所有 `invitations.email` lowercase；重複 pending 改 `expired` 保留最新一筆。
   - 加 partial UNIQUE INDEX `(org_id, email) WHERE status='pending'`。
   - BEFORE INSERT/UPDATE trigger `normalize_invitation_email()` 強制 lower + trim。

3. **`20260521000003_security_definer_search_path_sweep.sql`**
   - 補齊剩餘 5 個 `SECURITY DEFINER` 函式的 `SET search_path = public, pg_temp`：
     - `enqueue_email` / `read_email_batch` / `delete_email` / `move_to_dlq`
     - `queue_call_specific`

4. **`20260521000004_playback_logs_retention_batched.sql`**
   - 新 RPC `purge_playback_logs_batched(older_than, batch_size=10000, max_batches=500)`。
   - 每批 `WITH ... FOR UPDATE SKIP LOCKED` + `pg_sleep(0.05)`，避免長鎖。
   - 重新 `cron.schedule('playback-logs-retention', '0 3 * * *', SELECT purge_…)`。
   - 長期應改 monthly partitioning，本 migration 是過渡期安全網。

### Edge functions

- **`_shared/timingSafeEqual.ts`** — `timingSafeEqual(a, b)` 與 `bearerEquals(authHeader, expected)` helper。
- **`auth-email-hook/index.ts`** — `HOOK_SECRET` 比對改 `bearerEquals`。
- **`deliver-push/index.ts`** — `PUSH_DELIVERY_KEY` 比對改 `bearerEquals`。
- **`player-dashboard/index.ts`** — service_role 比對改 `bearerEquals`。
- **`deliver-webhook/index.ts`** — `webhookPayload` 加 16 byte hex `nonce`。
- **`telegram-poll/index.ts`** — 進場 `claim_telegram_poll_run`；結束 `release_telegram_poll_run`。
- **`knowledge-chat/index.ts`** — `messages` 必須是陣列；上限 40 則 / 60_000 字元；每 user 每分鐘 20 次（記在 `activity_logs`）。
- **`transcode-callback/index.ts`** — storage path 改 `assets/${sha256}.mp4`；無 sha256 / md5 → fail 並標記 `missing_content_hash`。

### CORS sweep — 額外 8 個 endpoint

- `accept-delegation-request`
- `revoke-delegation-grant`
- `rotate-api-secret`
- `migrate-media-to-storage`
- `sign-widget-params`
- `submit-app-version`
- `register-app`
- `request-transcode`

**刻意保留 wildcard** 的 endpoint（裝置 / 內部 service-to-service）：
- 裝置端 anon endpoint（web-player 任意 kiosk 域名）：`activate-device`, `register-device`, `verify-device-license`, `mqtt-auth`, `weather`, `weather-tw`
- 內部 service-to-service（非瀏覽器，CORS 無實質保護）：`deliver-push`, `deliver-webhook`, `transcode-callback`, `smart-trigger-webhook`, `signcms-mcp`, `license-reminder`, `knowledge-chat`, `queue-system`, `screen-reconnect`, `shadow-report`, `player-dashboard`, `player-sync`, `notify-install`, `trigger-share-sign`

### Frontend

- **`src/lib/roles.ts`** — `ROLE_ADMIN` / `ROLE_ORG_ADMIN` / `ROLE_CS_AGENT` / `ROLE_USER` 常數、`AppRole` 型別、`isAdminLike` / `isOrgAdmin` predicate。
- **`src/pages/NotFound.tsx`** — `<a href="/">` → `<Link to="/">`（HashRouter 不掉 session）。

### `formatUserError` 全面 sweep — 25 個檔案 / ~70 個呼叫點

主要受影響檔案（完整清單見 commit `acfe5a6`）：
- `pages/MediaPage.tsx`, `ContentStudioPage.tsx`, `ScreensPage.tsx`, `SchedulesPage.tsx`, `PublishingCenterPage.tsx`, `QuickPublishPage.tsx`, `SystemSettingsPage.tsx`, `IoTDashboardPage.tsx`, `AnnouncementPage.tsx`, `AppReviewPage.tsx`
- `components/admin/*`, `components/screens/*`, `components/channels/*`, `components/schedules/*`, `components/delegation/*`, `components/triggers/*`, `components/media/*`

兩個特殊處理：
- `DeviceLicenseManagement.tsx` 原本沒 `useLanguage`，加上 import + 解構。
- `AnnouncementPage.tsx` 有 local `t = (key: keyof typeof texts)`，shape 不相容；改用 `globalT`。

### Soft-delete 過濾補上（12 處）

- `src/lib/exportSchedule.ts` ×4
- `src/lib/referenceCheck.ts` ×1
- `src/lib/scheduleHealthCheck.ts` ×1
- `src/pages/QuickPublishPage.tsx` ×1
- `src/pages/ContentStudioPage.tsx` ×5

刻意未動：
- `MediaPage` 內部 trash UI 與檢視（需要看到 deleted）
- 對「剛建立的 row」`.eq("id", justCreatedId)` 不必要過濾

## Risk Assessment

| 風險 | 嚴重度 | 緩解 |
|---|---|---|
| `knowledge-chat` rate limit 過嚴擋掉 power user | 低 | `RATE_LIMIT_PER_MIN = 20` 可調；觀察 `activity_logs WHERE action='knowledge_chat_request'` |
| `telegram-poll` 鎖死（運維誤手動清掉 `running_at`） | 低 | RPC 內有 5 分鐘 stale window 自動 reclaim |
| `invitations.email` lowercase migration 把現有 mixed-case email 全洗成小寫 | 低 | Supabase auth.users.email 本就 lowercase，比對更一致；運維側無感 |
| `transcode-callback` 對 legacy null-md5 row fail | 低 | 標記 `transcode_status=failed` + `transcode_error=missing_content_hash`，運維可批次重轉 |
| `media_items` 補 soft-delete 過濾後 export 漏項 | 低 | 已有 `media_not_found_in_db` 警告路徑，UI 會顯示；行為更正確 |
| `deliver-webhook` 加 nonce 後 partner schema 失敗 | 低 | nonce 是新欄位，舊 receivers 應忽略未知欄位；簽章驗證仍兼容 |
| `formatUserError` sweep 中 `t` scope 問題 | 低 | 已 sanity scan 全部 25 檔，無未定義 `t` 引用 |
| 剩餘 ~20 個 anon / internal endpoint 沒套 CORS allow-list | 低 | 仍有 service-to-service 自身 auth；CORS 對它們沒實質意義 |

## Deployment

1. Apply migrations（皆 idempotent）。
2. Deploy edge functions。
3. Smoke test。
4. 觀察 24~48 小時 → 完成。

### 必要 env vars / 配置

- 無新增。本 PR 不引入新環境變數。

## Smoke Test

- [ ] **timing-safe compare**：以錯誤密碼打 `auth-email-hook`、`deliver-push` → 401，response 時間應與正確密碼 length-mismatch case 相似。
- [ ] **`telegram-poll` 並行**：在 dashboard 手動連續觸發兩次 → 第二次 response 應為 `{ skipped: true, reason: 'another_invocation_running' }`。
- [ ] **`deliver-webhook` nonce**：呼叫某個有 webhook 的事件 → partner receiver 應在 payload 看到 `nonce` 欄位 + 簽章驗證仍通過。
- [ ] **`knowledge-chat` rate limit**：以同一 user 連續打 21 次 → 第 21 次回 429。
- [ ] **`knowledge-chat` input cap**：以 41 則 messages 打 → 400 `too_many_messages`。
- [ ] **`invitations.email`**：以 mixed case (e.g. `Foo@example.com`) 邀請 → DB 內 email 應為 `foo@example.com`；同 email 再邀一次同 org → 失敗 unique_violation（或被 send-invitation 改走 resend 路徑）。
- [ ] **`transcode-callback`**：新上傳 → 轉碼完成後 storage path 應為 `assets/<sha256>.mp4`，不是 `<org>/<md5>.mp4`。
- [ ] **`playback_logs` retention**：手動執行 `SELECT public.purge_playback_logs_batched(INTERVAL '90 days', 100, 5);` → 不應 lock 太久，回傳整數列數。
- [ ] **CORS sweep**：從非 allow-list origin 打 `accept-delegation-request` → CORS error。
- [ ] **`formatUserError`**：故意觸發任一處錯誤（例如 RLS 違規）→ UI 應顯示翻譯文案。
- [ ] **NotFound `<Link>`**：在 SPA 內部點 404 頁的「返回」連結 → 不應整頁 reload（dev console 看不到 navigation timing > 200ms 的 hard reload）。
- [ ] **soft-delete 過濾**：把一個媒體 soft-delete（`update media_items set deleted_at=now() where id=...`）→ ContentStudio 媒體庫應立即看不到該媒體；trash UI 仍能看到。

## Rollback

Migration 全部可獨立 DROP 回滾：

```sql
-- telegram-poll 鎖
ALTER TABLE public.telegram_bot_state DROP COLUMN IF EXISTS running_at;
DROP FUNCTION IF EXISTS public.claim_telegram_poll_run(int);
DROP FUNCTION IF EXISTS public.release_telegram_poll_run();

-- invitations email
DROP TRIGGER IF EXISTS trg_normalize_invitation_email ON public.invitations;
DROP FUNCTION IF EXISTS public.normalize_invitation_email();
DROP INDEX IF EXISTS public.invitations_org_email_pending_uniq;

-- playback_logs retention
SELECT cron.unschedule('playback-logs-retention');
SELECT cron.schedule('playback-logs-retention', '0 3 * * *',
  'DELETE FROM public.playback_logs WHERE played_at < now() - INTERVAL ''90 days''');
DROP FUNCTION IF EXISTS public.purge_playback_logs_batched(interval, int, int);

-- SECURITY DEFINER search_path：用 git revert 對應 commit 即可（CREATE OR REPLACE 把舊定義救回）
```

Edge function / frontend 改動全部用 `git revert <commit>` 即可。

## Commits in this PR

```
bb5e941 fix(security): 三個敏感 secret 比對改用 constant-time
79897b8 fix(media): transcode-callback storage path 用 sha256 取代 md5（不允許 null）
62d05d2 fix(reliability): telegram-poll 加 row-level running lock 避免並行雙重消費
a6b7a60 fix(security): deliver-webhook 簽章加 nonce 防止 5 分鐘內 replay
48776e7 fix(db): invitations.email 大小寫不敏感 + 防重複 pending invitation
bfbef7e fix(security): 補齊剩餘 SECURITY DEFINER 函式的 search_path
99332f8 fix(security): knowledge-chat 加 input cap + per-user rate limit
9df586a perf(db): playback_logs retention 改成分批 DELETE 避免長鎖
32882fe chore: NotFound 用 Link 不用 a；新增 roles 字串常數檔
f4c9a52 fix(data): media_items 讀取補上 deleted_at IS NULL 過濾
7aee333 fix(security): CORS allow-list 再 sweep 8 個敏感 mutation endpoint
acfe5a6 fix(ux): formatUserError sweep — 把剩餘 ~25 個檔案的 toast.error 統一
```

## Out of Scope（已記於 docs/prs/README.md）

下列均為大改 / 高風險、應獨立 PR：
- 拆 `ContentStudioPage` / `translations.ts` / `signcms-mcp`
- `ChatWidget` polling → Realtime
- `React.memo` 套用 stable leaves
- Regenerate `supabase types.ts` 後清掉剩餘 `as unknown as` cast
- 27 個 migration 內硬編碼 system_admin UUID cleanup
- `playback_logs` 改 monthly partitioning
- `media_items` soft-delete 搬到 RLS
- 剩餘 ~20 個 anon / internal endpoint 套 CORS（風險低，視需求做）
