# Security & Reliability Hardening — 3-PR Plan

完整 code review 之後，將 32 個 commit 按**部署順序**與**獨立可 review**分成 3 個 PR。每個 PR 都可以獨立部署、獨立回滾。

| PR | 標題 | 範圍 | Commit 數 | Migration 數 | 風險 |
|---|---|---|---|---|---|
| [PR-1](./PR-1-critical-security.md) | Critical Security Hardening | 7 個 P0 資安洞 | 7 | 3 | 中（含 MQTT 認證遷移） |
| [PR-2](./PR-2-systemic-hardening.md) | Systemic Security & Reliability | 13 個 P1 結構性問題 | 13 | 7 | 中（has_role 行為變化） |
| [PR-3](./PR-3-defense-in-depth.md) | Defense-in-Depth & UX Cleanup | 12 個 P2 加固 + sweep | 12 | 4 | 低 |

## 為什麼要分 3 個 PR

1. **回滾粒度**：PR-1 修的是漏洞，必須儘快上線；PR-2 的 `has_role` 行為變更會影響權限路徑，需要更謹慎觀察；PR-3 多為機械 sweep，風險低但動的檔案多。分層後若 PR-2 出狀況可獨立回滾，不影響 PR-1 的修補。
2. **Review 認知負荷**：32 commit 一次看會疲乏；分成「漏洞 / 結構 / 加固」三層，每層的 review 重點不同。
3. **部署排序**：依序部署 PR-1 → PR-2 → PR-3，每層觀察 24~48 小時。

## 整體部署順序

```
Day 0    部署 PR-1（含 MQTT、device_registrations、activation_codes 三個 migration）
         觀察：MQTT 連線是否正常、device 重新註冊 / activate 是否成功

Day 1-2  觀察 PR-1 → 部署 PR-2（含 7 個 migration，has_role 行為變更）
         觀察：跨組織 admin 是否仍能正常運作；profiles 查詢是否回少了
         必要時：把 missing 出來的系統管理員手動補進 system_admins

Day 3-4  觀察 PR-2 → 部署 PR-3（含 4 個 migration，多為 idempotent 加固）
         觀察：telegram-poll / playback_logs retention cron 行為
```

## 環境變數 / 配置變動清單

| 變數 | 預設 | 何時設 | 影響 |
|---|---|---|---|
| `MQTT_ALLOW_SHARED_PASSWORD` | `true`（不設等同 true） | Player 全部升完 per-device token 後設為 `false` | 關閉 legacy MQTT shared password fallback |
| `CORS_EXTRA_ORIGINS` | 空 | 有 preview / staging origin 需要 CORS 放行時加入（逗號分隔） | 允許額外 origin 通過 CORS allow-list |
| `CRON_SECRET` | 不設 | 若 pg_cron 透過 net.http_post 呼叫 scheduled-screen-health-report 時 | 取代 verify_jwt=true 的服務 role JWT 也可 |

## 需手動執行（部署後）

部署完 PR-2 後，DB 會 RAISE NOTICE 列出受 `has_role('admin')` 收緊影響的人數。執行：

```sql
-- 找出失去全域 admin 權限的人
SELECT ur.user_id, p.display_name
  FROM public.user_roles ur
  LEFT JOIN public.system_admins sa USING (user_id)
  LEFT JOIN public.profiles p ON p.user_id = ur.user_id
 WHERE ur.role = 'admin' AND sa.user_id IS NULL;

-- 若有「真的應該是系統管理員」的人：
INSERT INTO public.system_admins (user_id) VALUES ('<their-uuid>');
```

部署完 PR-2 後，若 migration `20260520000005` 因 prod 已存在重複 `serial_number` 而 NOTICE 跳過 unique index，手動清理後重建：

```sql
-- 看誰重複
SELECT serial_number, count(*)
  FROM public.screens
 WHERE serial_number IS NOT NULL AND trim(serial_number) <> ''
 GROUP BY serial_number HAVING count(*) > 1;

-- 清理後手動建 index
CREATE UNIQUE INDEX screens_serial_number_unique_nonempty
  ON public.screens (serial_number)
  WHERE serial_number IS NOT NULL AND trim(serial_number) <> '';
```

## Follow-up（不在此 3 個 PR 範圍）

下列工作風險較高或範圍較大，建議獨立規劃，不要混入這次：

- `ContentStudioPage.tsx`（9982 行 / 135 useState）拆分
- `translations.ts`（2255 行）拆 per-locale lazy load
- `signcms-mcp/index.ts`（1427 行）拆 oauth / transport / tools
- `ChatWidget` 5 秒 polling → Realtime 改寫
- `React.memo` 套用 stable leaves（建議先 profiling）
- Regenerate `src/integrations/supabase/types.ts` 後清掉剩餘 `as unknown as` cast
- 27 個 migration 內硬編碼 `system_admin` UUID 全面 cleanup
- `playback_logs` 改 monthly partitioning（取代目前的分批 DELETE）
- `media_items` soft-delete 搬到 RLS（需先重構 trash UI）
