# 內容設計中心（ContentStudio）功能測試清單

> 對應 `src/pages/ContentStudioPage.tsx`（9925 行，路由 `/studio`）
> 用途：QA / 上線前 smoke + 完整功能 verify

---

## 靜態分析摘要（自動跑完）

| 項目 | 結果 |
|---|---|
| TypeScript `tsc --noEmit` | ✅ 0 errors |
| ESLint | ✅ 0 errors / ⚠️ 18 warnings（全部 `react-hooks/exhaustive-deps`，非 bug 但建議審） |
| 檔案大小 | ⚠️ 9925 行 — P3-7 已抽部分，但仍偏胖；之後可繼續拆 |
| DB tables touched | `design_projects` / `media_items` / `queue_system_*` / `teams` |
| Edge functions called | `sign-widget-params` |
| Storage 上傳 | `lib/uploadMedia.ts`（CAS dedup，server-side sha256） |

潛在風險：

- ⚠️ `localStorage` 緊急存檔（emergency save）— quota 撐爆會 silent fail；大型專案要注意
- ⚠️ 18 個 hook deps warning — 部分 `useCallback` 漏依賴可能讓老 closure 抓到舊 state
- ⚠️ 單檔 9925 行 — 維護負擔高，後續抽 ZoneList / PagesPanel / MediaPicker 等 leaf 更穩

---

## 測試前準備

- [ ] Staging 帳號（system_admin 或 org_admin）
- [ ] 至少 1 個 org，1 個 team
- [ ] media library 內有 ≥5 個影像 / 影片 / 音檔（含 mp4 用於 BGM）
- [ ] 至少 1 個現存 design_project（用來測 load / collab）
- [ ] Chrome / Edge / Safari 各一個視窗（瀏覽器相容性掃）
- [ ] DevTools console 全程開著看 error

---

## A. UI 進入點 + Smoke

| # | 測試 | 預期 | Pass |
|---|---|---|---|
| A1 | 從 sidebar 進「內容設計中心」 | 路由 `/studio`，頁面載入無 error | ☐ |
| A2 | URL 直接打 `/studio` 也能進 | 同上 | ☐ |
| A3 | 未登入時打 `/studio` | 被 ProtectedRoute 擋去 `/auth` | ☐ |
| A4 | 切換 active org（右上選單） | 頁面內容刷新，看到該 org 的專案 | ☐ |
| A5 | DevTools console | 0 error，0 warning（除已知 React deps warn） | ☐ |

## B. Sidebar — 「新專案」/「我的專案」分頁

| # | 測試 | 預期 | Pass |
|---|---|---|---|
| B1 | 切換「新專案」/「我的專案」 tab | 內容切換正常 | ☐ |
| B2 | 「新專案」內切「版型」/「場景」 | 版型列表 / 場景列表都顯示 | ☐ |
| B3 | 點某版型 → 拖到 canvas | Canvas 套用該版型 | ☐ |
| B4 | 「我的專案」列表顯示當前 org 全部 project | 含 team filter 若有 | ☐ |
| B5 | 點現有 project | handleLoad 載入 zones / pages / aspect 等 | ☐ |
| B6 | 對 project 按刪除 | 二次確認 → 刪除成功 + 列表移除 | ☐ |

## C. 畫布尺寸 / 解析度

| # | 測試 | 預期 | Pass |
|---|---|---|---|
| C1 | aspect 16:9 預設 | Canvas 1920×1080 區域 | ☐ |
| C2 | 切 9:16 | Canvas 旋轉成直式 1080×1920 | ☐ |
| C3 | 選 custom resolution | 寬高輸入框出現可改 | ☐ |
| C4 | 儲存成 my preset | 「我的預設」列表新增 | ☐ |
| C5 | 重整頁面 | 自訂 preset 應該還在（localStorage） | ☐ |

## D. Zone（區塊）CRUD + 互動

| # | 測試 | 預期 | Pass |
|---|---|---|---|
| D1 | 從 media picker 拖檔到 canvas | 建立新 zone，內容 = 該媒體 | ☐ |
| D2 | 點 zone | 出現選取邊框 + 工具列 | ☐ |
| D3 | 拖 zone | 位置變更，% 座標更新 | ☐ |
| D4 | 拖 zone 邊角 resize | 尺寸變更（無 overflow canvas） | ☐ |
| D5 | 多選 zones（cmd/ctrl + 點） | 多個邊框 + 群組移動 | ☐ |
| D6 | 刪除 zone（鍵盤 Delete / Backspace） | zone 移除，撤銷可救回 | ☐ |
| D7 | Z-order 上 / 下 | zones 順序變更，畫面層級反映 | ☐ |
| D8 | 複製 zone（⌘/Ctrl + D） | 複本出現在原 zone 旁 | ☐ |
| D9 | zone 動畫（fade / slide / zoom） | 設定 → 預覽動畫播放 | ☐ |

## E. Pages（多頁）

| # | 測試 | 預期 | Pass |
|---|---|---|---|
| E1 | 新增 page | 新空白頁出現，當前頁切過去 | ☐ |
| E2 | page 名稱重新命名 | 更新成功 | ☐ |
| E3 | 切換不同 page | zones 跟 overlays 隨頁切換 | ☐ |
| E4 | 拖動 page 順序 | 順序更新 | ☐ |
| E5 | 刪除 page | 確認 → 移除（不能刪到只剩 0） | ☐ |
| E6 | page transition（淡入 / 滑動 / 翻頁） | 設定 → 預覽切頁動畫 | ☐ |
| E7 | transition 觸發條件（時間 / GPIO / 遠端） | 三種模式都能設 | ☐ |

## F. Output Modes（多螢幕輸出）

| # | 測試 | 預期 | Pass |
|---|---|---|---|
| F1 | 預設「鏡像」(mirror) | 一份內容 | ☐ |
| F2 | 切「分割」(multi) + outputCount=2 | 兩個輸出區，獨立 pages | ☐ |
| F3 | outputCount 改成 3 | 第 3 輸出區建立預設內容 | ☐ |
| F4 | 切換 active output | 右側面板切到該 output 的 pages | ☐ |
| F5 | 各 output 獨立改 zones | 互不影響 | ☐ |

## G. Media（媒體 picker + 上傳）

| # | 測試 | 預期 | Pass |
|---|---|---|---|
| G1 | 點上傳按鈕 + 選檔 | uploadMediaFile → media_items 新增 | ☐ |
| G2 | 拖檔到 picker | 同上 | ☐ |
| G3 | 重複上傳同一檔 | server 回 409 duplicate（CAS sha256 dedup） | ☐ |
| G4 | 大檔（>50MB）上傳 | 顯示進度 + 完成 | ☐ |
| G5 | 不支援的副檔名（.exe） | 報錯 + 拒收 | ☐ |
| G6 | hover 媒體 | MediaHoverPreview 顯示 | ☐ |
| G7 | picker 內 search / filter | 即時過濾 | ☐ |
| G8 | picker 多選 + 一次拖入 canvas | 多個 zones 建立 | ☐ |

## H. BGM（背景音樂）

| # | 測試 | 預期 | Pass |
|---|---|---|---|
| H1 | BGM picker 拖檔上傳 mp3 | bgmItems 新增 | ☐ |
| H2 | 設 BGM volume slider | 即時改變音量 | ☐ |
| H3 | 切換 audio source（BGM / zone audio / both） | 行為對應 | ☐ |
| H4 | 移除 BGM | bgmItems 移除 | ☐ |

## I. Overlay（疊加層）

| # | 測試 | 預期 | Pass |
|---|---|---|---|
| I1 | 建 overlay（文字 / 圖片） | 出現在 canvas 上層 | ☐ |
| I2 | overlay 跨頁顯示 | 切換 page overlay 不消失（如果是 project-level） | ☐ |
| I3 | overlay 編輯 | 可改 text / 樣式 | ☐ |
| I4 | overlay z-order | 永遠在 zones 上面 | ☐ |

## J. 儲存 / 載入 / 刪除（CRUD）

| # | 測試 | 預期 | Pass |
|---|---|---|---|
| J1 | 「儲存」新專案（未儲存過） | 跳輸入名稱 dialog → insert design_projects | ☐ |
| J2 | 「儲存」已存在專案 | update 同一 row（updated_at 變新） | ☐ |
| J3 | 儲存失敗（網路斷） | toast error + 不丟資料 | ☐ |
| J4 | 載入 → 修改 → 不存就切走 | 跳「未儲存變更」確認對話 | ☐ |
| J5 | 載入 legacy 專案（單 page 格式） | 自動轉成 multi-page，無錯誤 | ☐ |
| J6 | 載入大 zones（>50 個） | 渲染 < 2 秒 | ☐ |
| J7 | 刪除專案 | DB row 軟刪 / 硬刪？確認跟後端一致 | ☐ |

## K. 緊急存檔 / 草稿恢復（draft recovery）

| # | 測試 | 預期 | Pass |
|---|---|---|---|
| K1 | 修改沒存 → 關分頁 | beforeunload 阻擋 + emergency save 寫 localStorage | ☐ |
| K2 | 重開分頁進 /studio | 跳「發現未存草稿」對話，可恢復 | ☐ |
| K3 | 取消恢復 | localStorage 清掉，乾淨進入 | ☐ |
| K4 | localStorage 滿（手動塞滿 quota） | 不會 crash，toast 提示存檔失敗 | ☐ |
| K5 | 多個專案各自的草稿 | 各自獨立恢復（按 project ID） | ☐ |

## L. Team Collaboration（協作）

| # | 測試 | 預期 | Pass |
|---|---|---|---|
| L1 | 儲存時選「Team」協作 + 選 team | DB row 寫 team_id + collab_scope='team' | ☐ |
| L2 | 同 team 成員登入看「我的專案」 | 看得到該 project | ☐ |
| L3 | 非 team 成員登入 | 看不到該 project | ☐ |
| L4 | 同時兩人改同一專案 → 都按存 | 後存的覆蓋前存（未來可加 optimistic lock） | ☐ |
| L5 | 切「Creator only」 | 只 owner 看得到 | ☐ |

## M. 鍵盤 / 滑鼠互動

| # | 測試 | 預期 | Pass |
|---|---|---|---|
| M1 | ⌘/Ctrl + Z 撤銷 | zone / overlay 修改撤銷 | ☐ |
| M2 | ⌘/Ctrl + ⇧ + Z 重做 | 重做 | ☐ |
| M3 | ⌘/Ctrl + S | 觸發儲存 | ☐ |
| M4 | Delete / Backspace 刪選取 zone | 移除 | ☐ |
| M5 | 方向鍵微調 zone 位置（1px） | 移動 | ☐ |
| M6 | ⇧ + 方向鍵（10px） | 大步移動 | ☐ |
| M7 | Esc 取消選取 | 邊框消失 | ☐ |

## N. 行動裝置 / 響應式

| # | 測試 | 預期 | Pass |
|---|---|---|---|
| N1 | iPad 直式（768×1024） | 介面可用，sidebar 摺疊 | ☐ |
| N2 | iPhone（375×667） | useIsMobile 觸發，simplified UI | ☐ |
| N3 | Touch 拖 zone | 可運作 | ☐ |
| N4 | Pinch zoom canvas | 不破壞 layout | ☐ |

## O. 效能 / 邊界

| # | 測試 | 預期 | Pass |
|---|---|---|---|
| O1 | 200 zones 在同一 page | 操作不延遲超過 100ms | ☐ |
| O2 | 50 個 pages | 切頁瞬間（< 300ms） | ☐ |
| O3 | media_items 列表 1000+ | picker 可分頁 / virtualized | ☐ |
| O4 | 連續快速儲存 5 次 | 不會重複 insert（race condition） | ☐ |
| O5 | localStorage 50KB 大 zones | emergency save 還能完整存 | ☐ |

## P. 瀏覽器相容性

| # | 瀏覽器 | 版本 | Pass |
|---|---|---|---|
| P1 | Chrome | latest | ☐ |
| P2 | Edge | latest | ☐ |
| P3 | Safari | latest | ☐ |
| P4 | Firefox | latest | ☐ |

## Q. 上線後 production 確認

| # | 測試 | 預期 | Pass |
|---|---|---|---|
| Q1 | Lighthouse / DevTools Performance | TTI < 4s | ☐ |
| Q2 | 從 production 連 staging Supabase（如果有環境變數錯） | 不會發生（檢查 build config） | ☐ |
| Q3 | 大專案存檔 / 載入 → player 收到並正確播放 | 端對端跑通 | ☐ |

---

## 已知議題（修了再測比較順）

- ESLint 18 個 hooks/exhaustive-deps warn — 評估是否要修
- 9925 行單檔 — 後續考慮再拆 leaf component

## 完成後

- 全部 ☐ 變 ☑ → 簽核準上線
- 任何 ✗ → 開 issue，標上 section + test number
- 補充新 test case：直接在這個 markdown 上加 row
