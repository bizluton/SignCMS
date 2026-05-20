# Regenerate `src/integrations/supabase/types.ts` and clean up casts

> 此工作需要 Supabase project 的存取權限 / DB credential，本地端執行。
> 不是 dev 自己機器上跑就是 CI 跑。

## 為什麼要重做

`src/integrations/supabase/client.ts` 已經用 `createClient<Database>(...)`
做了型別注入，理論上所有 `supabase.from()` / `supabase.rpc()` 都該是強
型別的。

實際上整個 codebase 散落 **50 個 `as unknown as`** 在 22 個檔案內，原因
都一樣：開發者加 migration 後沒重新 generate `types.ts`，TS 報錯，就
直接 cast 掉。

每個 cast 都是一處潛在 bug —— compiler 不再幫忙檢查 schema 一致性。

## 步驟

### 1. 取得 Supabase access token

到 https://supabase.com/dashboard/account/tokens 產一個 personal access
token，然後：

```bash
export SUPABASE_ACCESS_TOKEN="<your-token>"
```

### 2. 找到 project ref

到 Supabase Dashboard → 該專案 → Project Settings → General → Reference
ID。或者：

```bash
npx supabase projects list
# 從輸出找 SignCMS 的 ref，例如 narhbpojjtnalyfiwxue
```

### 3. 重新 generate types

```bash
cd /path/to/screenleap-central-main

npx supabase gen types typescript \
  --project-id <project-ref> \
  --schema public \
  > src/integrations/supabase/types.ts
```

確認檔案被覆寫（行數應差不多 3000+，含所有新加的 table / RPC 簽章）。

### 4. 找出可以刪除的 cast

執行：

```bash
grep -rln "as unknown as" src/
```

**第一輪**：嘗試直接刪掉 cast 與旁邊的 manual type 宣告，看 TS 還能
不能編譯。能編譯就是 types.ts 接住了。

**典型 pattern 改法**：

```ts
// BEFORE
const { data, error } = await (supabase.rpc as unknown as (fn: string, args: Record<string, unknown>) => Promise<{ data: Record<string, unknown> | null; error: { message: string } | null }>)("generate_license_codes", { ... });

// AFTER (如果 RPC 已經在 types.ts 內)
const { data, error } = await supabase.rpc("generate_license_codes", { ... });
```

```ts
// BEFORE
const db = supabase as unknown as SupabaseDyn;
const { data } = await db.from("smart_triggers").select("*");

// AFTER
const { data } = await supabase.from("smart_triggers").select("*");
// 順手把 SupabaseDyn type 宣告也刪掉
```

### 5. 整理 commit

建議拆成多個 commit：

```
chore(types): regenerate src/integrations/supabase/types.ts
chore(types): drop as-unknown-as casts in admin/* (5 files)
chore(types): drop as-unknown-as casts in widgets/* (3 files)
chore(types): drop as-unknown-as casts in pages/* (8 files)
chore(types): drop as-unknown-as casts in player + studio
```

每個 commit 都跑 `npx tsc --noEmit` 確保沒新型別錯誤。

## 22 個受影響檔案（cast 數量）

| 檔案 | as unknown as 數 |
|---|---|
| `src/components/widgets/QueueControlPanel.tsx` | 多（≥ 12）|
| `src/components/triggers/SmartTriggerPanel.tsx` | 2 |
| `src/components/triggers/SmartTriggerDialog.tsx` | 1 |
| `src/components/admin/SystemAdminManagement.tsx` | 1 |
| `src/components/admin/DbHealthPanel.tsx` | 1 |
| `src/components/screens/TriggerTestConsoleDialog.tsx` | 1 |
| `src/components/player/DesignStage.tsx` | 2 |
| `src/components/SignCMSPlayer.tsx` | 2（Date patch — 與 supabase 無關，**保留**）|
| `src/components/widgets/MeetingRoomWidget.tsx` | 2（CSS container-type — **保留**）|
| `src/contexts/InstalledAppsContext.tsx` | 1 |
| `src/lib/db.ts` | 1（helper 內部，**保留**）|
| `src/lib/formatUserError.ts` | 1（unknown shape，**保留**）|
| `src/lib/referenceCheck.ts` | 1+ |
| `src/pages/AppReviewPage.tsx` | 1+ |
| `src/pages/ContentStudioPage.tsx` | 多 |
| `src/pages/DashboardPage.tsx` | 1+ |
| `src/pages/DeveloperPortalPage.tsx` | 1+ |
| `src/pages/MediaPage.tsx` | 1+ |
| `src/pages/PlayerPage.tsx` | 1+ |
| `src/pages/QueueLiffPage.tsx` | 1+ |
| `src/pages/QuickPublishPage.tsx` | 1+ |
| `src/pages/SecurityAuditPage.tsx` | 1+ |

排除「與 Supabase 無關，本來就需要 cast」的後預估可清掉 **35-40 處**。

## 風險 / 注意事項

- **跨 commit 不要混入語意改動**：每個 commit 只做機械替換，方便 review。
- **CI 必跑 `npx tsc --noEmit`**：避免新型別錯誤偷渡。
- **`Database` 型別包含 schema 內所有 RPC**：但只有 SECURITY DEFINER 並
  `GRANT EXECUTE TO authenticated` / `service_role` 的會被列入。若你呼
  叫的 RPC `types.ts` 抓不到，需在 DB 端確認 RPC 有 GRANT。
- **`src/lib/db.ts` 內的 `rpc<T>()` helper** 在型別接上後 partially 失效。
  屆時可直接 `supabase.rpc("...", {...})` 並刪除 db.ts；或 keep 為 thin
  wrapper for callers 期待統一 return shape 的場合。
- **`types.ts` 不能手動編輯**：每次 regen 都會覆寫。所有自定 type 都該
  放在 `src/lib/types/*.ts`。

## 後續

types regen 完成後，這些 follow-up 也可以重新評估：

- 既有 `Database["public"]["Functions"]["rpcname"]["Returns"]` 全部可直
  接拿來標 generic 參數
- `Tables<"foo">` 是基本 row 型別；`TablesInsert<"foo">` / `TablesUpdate<"foo">`
  分別給 insert / update 用，能擋掉「忘記欄位」的 bug
