# PR-1: Critical Security Hardening

> 修復 code review 找出的 7 個 P0 級資安漏洞。**這是阻塞性安全修補，建議優先合併**。

## Summary

| 漏洞 | 影響 | 修法 |
|---|---|---|
| MQTT 全部 device 共用一組密碼 | 任一 player 被反編譯 → 攻擊者可冒充任意螢幕 | per-device token + legacy fallback |
| `device_registrations` anon 可讀 device_token | 未登入用戶可爬全部 device_token | 移除 anon SELECT policy、停止寫 token 到表 |
| `scheduled-screen-health-report` 無認證 | 任何 URL 知情者可寄送 CSV 給任意 recipient | verify_jwt=true + service-role / admin 雙路徑 |
| `upload-media` 沒驗 org 成員 | 跨組織上傳到他人 quota | user_in_org / system_admin / CS-with-delegation 三選一 |
| `playback_logs` RLS `org_id IS NULL` 旁路 | 防禦性 cleanup（漏洞已於 2026-04 修） | DROP/CREATE policy + 清殘留 NULL 列 |
| 6 位數啟用碼可暴力 + race condition | 並行 claim、暴力枚舉劫持 pending 螢幕 | 原子 claim RPC + per-IP rate limit + crypto RNG |
| `reset-user-password` 變數打錯 | 非 system admin 一律 500（已壞掉一段時間） | 改名 `isSystemAdmin` → `callerIsSystemAdmin` |

## Background

完整 audit 報告：見 conversation transcript。這 7 個項目分類為 P0（Critical），定義是「未認證或可低成本利用 → 直接後果包含跨租戶資料外洩 / 帳號劫持 / 服務濫用」。

`upload-media`、`scheduled-screen-health-report`、`reset-user-password` 屬「已在 prod 但邏輯壞」；MQTT、device_registrations、activation_codes 屬「設計階段就埋下的漏洞」。

## What's in this PR

### Edge functions

- **`mqtt-auth/index.ts`** — `/user` 端點改用 `screens.device_token` per-device 認證。保留 `MQTT_DEVICE_PASS` legacy fallback（env var `MQTT_ALLOW_SHARED_PASSWORD` 可關閉）。`/superuser` 與 server publisher 路徑加 constant-time 比對。
- **`approve-device/index.ts`** — 停止把 `device_token` 寫進 `device_registrations`（只透過 Realtime broadcast）。產 6 位數 license code 改 `crypto.getRandomValues`。
- **`activate-device/index.ts`** — 改用新 RPC `claim_screen_activation_code(p_code)` 原子化 claim；進場呼叫 `device_activation_rate_ok` 檢查 per-IP 速率；任何成功 / 失敗都 log 進 `device_activation_attempts` 表。
- **`register-device/index.ts`** — Reload / fingerprint 重複路徑停止 HTTP 回傳 device_token；改成從 `screens.device_token` 讀取後透過 Realtime channel 重新 broadcast。
- **`scheduled-screen-health-report/index.ts`** + `config.toml` — `verify_jwt = true`；解析 JWT claims：service_role JWT → 跑全部 due schedule；user JWT → 必須帶 `schedule_id` 且 caller 在該 org 是 admin / org_admin / system_admin。
- **`upload-media/index.ts`** — 加 org-scope 權限：必須 `user_in_org(caller, org_id)`、OR system admin、OR active CS agent 有 active delegation 給 org 成員。
- **`reset-user-password/index.ts`** — 修正未宣告變數 `isSystemAdmin` → `callerIsSystemAdmin`。

### Migrations

1. **`20260520000001_playback_logs_null_org_defensive_cleanup.sql`**
   - DELETE 殘留 NULL `org_id` 列；重新宣告 SELECT policy 為 `is_system_admin OR (org_id NOT NULL AND user_in_org)`。
   - Audit 報告原本列為 P0，實際漏洞於 2026-04 已修；此 migration 為防禦性確認 + drift 防護。

2. **`20260520000002_device_registrations_close_anon_leak.sql`**
   - DROP `anon_read_own_registration` policy（關閉 anon SELECT 全表）。
   - 新增 SECURITY DEFINER RPC `device_registration_status(uuid)` 供 anon 輪詢 status（**不含 token**）。
   - `device_token` 欄位標 DEPRECATED；保留以維持已部署 player 相容。

3. **`20260520000003_device_activation_security.sql`**
   - 新 RPC `claim_screen_activation_code(p_code)` 用 `UPDATE … RETURNING` 原子 claim。
   - 新表 `device_activation_attempts(ip, code_hint, succeeded, attempted_at)` + 兩個 RPC：`device_activation_rate_ok(ip)`、`log_device_activation_attempt(ip, code, ok)`。Per-IP 5 分鐘 10 次失敗為門檻。
   - pg_cron 每小時清掉 24h 前的 attempts。

## Risk Assessment

| 風險 | 嚴重度 | 緩解 |
|---|---|---|
| MQTT 認證遷移把現有 player 鎖在外 | 高 | `MQTT_ALLOW_SHARED_PASSWORD=true`（預設）保留 legacy shared password；新 player 用 device_token，老 player 仍可連 |
| `scheduled-screen-health-report` 改 verify_jwt=true 後 pg_cron 失效 | 中 | 需確認 pg_cron 設定有送 service_role JWT；若沒送，臨時可改回 false 配合 code-level header 檢查 |
| `device_registrations.device_token` 標 DEPRECATED 後某地仍 read | 低 | grep src + edge functions 確認只有 approve-device / register-device 觸及，皆已改 |
| `upload-media` 拒絕 CS agent 沒 delegation 的上傳 | 低 | 若 CS workflow 中有「未 delegation 直接上傳」的合法路徑，需明示加 grant |
| `playback_logs` 殘留 NULL 列被 DELETE | 低 | 種子資料早期已隨 NOT NULL 補上；DELETE 是 idempotent |

## Deployment

1. Apply migrations（順序由檔名決定，皆 idempotent）。
2. Deploy edge functions（**MQTT player 端先更新或保留 shared password env 不變**）。
3. Smoke test（見下）。
4. 觀察 24~48 小時 → 部署 PR-2。

### 必要 env vars / 配置

- `MQTT_ALLOW_SHARED_PASSWORD`：不設 = 預設 `true`。Player 全部升完後設 `false` 才會關閉 legacy 路徑。
- `verify_jwt = true` 在 `supabase/config.toml` 內已更新；scheduled-screen-health-report 的 cron 需確認帶 service_role JWT。

## Smoke Test

部署後手動驗證：

- [ ] **MQTT**：用一台已存在的 player 重連，仍應通過（legacy fallback）；新註冊一台 player 用 device_token 連線，也應通過。
- [ ] **`device_registrations`**：以未登入 client（curl）`POST register-device` → 返回 registrationId 與 realtimeChannel；訂閱 channel；用 admin 帳號 `POST approve-device` → 收到 broadcast 帶 token；DB 中 `device_registrations.device_token` 應為 NULL。
- [ ] **匿名 SELECT 已關**：以 anon key 嘗試 `select * from device_registrations` → 應回 0 列。
- [ ] **`activate-device`**：建立一個 6 碼 activation code → 用 device 端 POST 帶碼 → 拿到 token。重複 POST 同樣的碼 → 應回 `invalid_code`。
- [ ] **Rate limit**：連續 11 次帶錯碼從同一 IP POST → 第 11 次應回 429 `rate_limited`。
- [ ] **`scheduled-screen-health-report`**：未帶 Authorization 直接 POST → 401；admin 從 UI 按「立即執行」應正常跑 schedule。
- [ ] **`upload-media`**：A 組成員嘗試以 form `org_id=B` 上傳 → 應 403 Forbidden。
- [ ] **`reset-user-password`**：org_admin（非 system admin）重置同組成員密碼 → 應成功。

## Rollback

每個 commit 都是獨立可回滾的。Migration 不影響舊 code 路徑，且 RPC 為新建，回滾只需 `DROP FUNCTION` + DROP TABLE：

```sql
DROP FUNCTION IF EXISTS public.claim_screen_activation_code(text);
DROP FUNCTION IF EXISTS public.device_activation_rate_ok(text);
DROP FUNCTION IF EXISTS public.log_device_activation_attempt(text, text, boolean);
DROP TABLE     IF EXISTS public.device_activation_attempts;
DROP FUNCTION IF EXISTS public.device_registration_status(uuid);
```

回滾 edge functions：`git revert` 對應 commit 即可。**注意：回滾 MQTT 認證後若 player 已升上 device_token，會連不上**——這也是為什麼保留 legacy fallback。

## Commits in this PR

```
f8745f3 fix(security): reset-user-password 變數打錯導致非系統管理員一律 500
fc5a4a7 fix(security): scheduled-screen-health-report 加上 JWT 認證與授權
199b10d fix(security): upload-media 加上 org 範圍權限檢查
2107c62 fix(security): playback_logs RLS NULL bypass 防禦性 cleanup
adea939 fix(security): 關掉 device_registrations 匿名讀取漏洞 + 停寫 token 到表
6e527e7 fix(security): activate-device 加原子 claim + per-IP rate limit + crypto RNG
b2b19ac fix(security): MQTT 改為 per-device token 認證（保留 legacy fallback）
```

## Out of Scope

下列 P1+ 項目延後到 PR-2 / PR-3：
- 跨組 admin / org_admin 權限細修（→ PR-2 #12）
- CORS allow-list（→ PR-2 #8）
- 全域 admin 旁路（→ PR-2 #9/#10）
- timing-safe compare 其他 endpoint（→ PR-3 #1）
