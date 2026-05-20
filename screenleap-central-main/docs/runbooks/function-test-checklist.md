# Function Test Checklist

本檔列出**本機自動化測試已完成的部分**＋**需要您執行的環境相關測試**。

---

## A. 本機自動化測試（已通過）

| 項目 | 命令 | 結果 |
|---|---|---|
| TypeScript 編譯 | `npx tsc --noEmit -p tsconfig.app.json` | 451 errors（全 pre-existing，stale types.ts；refactor 沒造成新 error） |
| ESLint | `npm run lint` | 0 errors / 117 warnings（pre-existing） |
| Vitest unit test | `npm test` | 76 / 76 ✓ |
| Vite production build | `npm run build` | ✓ in ~7.5s |
| 自製 activity-log lint | `npm run lint:activity-log` | ✓ |
| 自製 screen-log lint | `npm run lint:screen-log` | ✓ |
| Bundle 分割驗證 | `ls dist/assets/` | en-*.js 88 kB / ja-*.js 108 kB 獨立 chunk，主 bundle 從 456 → 229 kB |

回滾這層只要 `git revert 81fd0f5` 即可。

---

## B. Playwright E2E（需要本機跑 dev server）

```bash
# Terminal A
npm run dev          # 等到 vite 提示 "Local: http://localhost:5173"

# Terminal B
npm run test:e2e
```

如果沒辦法跑全部，至少跑 onboarding 子集：

```bash
npm run test:e2e:onboarding
```

現有 E2E 涵蓋（`tests/`）：

- [ ] `auth-signin.spec.ts` — 登入流程
- [ ] `auth-signup.spec.ts` — 註冊流程
- [ ] `auth-password-reset.spec.ts` — 密碼重置
- [ ] `auth-route-guards.spec.ts` — 路由守衛
- [ ] `auth-brute-force.spec.ts` — 失敗登入鎖定
- [ ] `onboarding-i18n.spec.ts` — onboarding 多語言
- [ ] `onboarding-onblur.spec.ts` — onboarding 失焦驗證
- [ ] `onboarding-join-onblur.spec.ts` — join token 驗證

**特別檢查**（與這批改動有關）：
- onboarding-i18n 應仍綠 → 確認 translations lazy-load 不破壞 fallback 路徑
- auth-password-reset 應仍綠 → 確認 P0-7 變數打錯修補沒倒退
- auth-route-guards 應仍綠 → 確認 has_role 收緊（P1-9）沒擋掉合法路徑

---

## C. Staging / Prod smoke test（需要連 supabase）

完整清單見 `docs/prs/DEPLOYMENT_RUNBOOK.md` §1.3 / §2.4 / §3.3。
摘要本批改動最關鍵的 12 個 smoke：

### C.1 P0 安全洞驗證

1. **MQTT per-device token**（PR-1 b2b19ac）—— prod player 連線正常；新 player 用 device_token 連得上。
2. **device_registrations anon 鎖**（PR-1 adea939）—— anon `select * from device_registrations` 回空陣列。
3. **scheduled-screen-health-report 401**（PR-1 fc5a4a7）—— `curl -X POST` 無 auth 回 401。
4. **upload-media cross-org block**（PR-1 199b10d）—— A 組成員送 `org_id=B` 回 403。
5. **activate-device atomic claim**（PR-1 6e527e7）—— 兩個並行 POST 同一 code，只一個成功。
6. **reset-user-password 非 system admin**（PR-1 f8745f3）—— org_admin 重置同組成員密碼成功。

### C.2 P1 systemic 驗證

7. **has_role('admin') 等同 system_admin**（PR-2 78fbbf3）—— 部署 migration 後 NOTICE 列受影響人數；補 system_admins。
8. **CORS allow-list**（PR-2 991d23e + P2-11 7aee333）—— 從 google.com console fetch 該 endpoint → CORS error。
9. **queue_issue_ticket FOR UPDATE**（PR-2 dd56494）—— 兩 tab 同時取號 → 不同號碼。

### C.3 P2 / P3 加固驗證

10. **email queue idempotency**（PR-3 9f5a593）—— 重複 enqueue 同 message_id → 只寄一封。
11. **telegram-poll lock**（PR-3 62d05d2）—— 並行兩次觸發 → 第二次 skipped。
12. **signcms-mcp refactor**（P3-2 1186467）—— GET / 回 tools_count=22；Claude.ai OAuth 仍可走完。

---

## D. 仍無法自動化的部分

| 項目 | 為什麼 | 應如何處理 |
|---|---|---|
| `types.ts` 已過時導致 451 個 TS error | 需要 Supabase project access token + `npx supabase gen types` | 跟 `docs/regenerate-supabase-types.md` 走，CI / 本地跑一次 |
| MQTT broker 端認證 | 需要 mosquitto-go-auth 跑起來連 supabase | staging broker 部署完跑 §C.1.1 |
| OAuth flow with Claude.ai | 需要 prod URL + Claude.ai web | staging 部署完手動驗 §C.3.12 |
| Player APK 升級 per-device token | 需要 player codebase + 編譯 | 另外 sprint |
| pg_cron 行為（每月新 partition、retention） | 需要 prod DB 觀察 24h+ | 部署後排觀察 |

---

## 建議 review 流程

1. **這個 session 的 commit history**（master 已 push）—— 用 GitHub UI 看 diff。
2. **跑 §B 的 E2E**（您手動執行）—— 確保 auth flow 不爛。
3. **依 `DEPLOYMENT_RUNBOOK.md` §1 部署 PR-1**（P0 改動）—— 跑 §C.1 smoke。
4. **觀察 24h，再部署 PR-2 / PR-3**。
5. **P3 follow-up（types regen、partition cutover、ContentStudio 拆分）排下一輪 sprint**。
