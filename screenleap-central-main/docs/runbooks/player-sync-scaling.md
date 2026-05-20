# Player-sync scaling roadmap (10K device readiness)

## 現況

```
playerSync()  每 30s（Realtime 斷線時）或 300s（Realtime 連線時）打 POST /player-sync
```

`player-sync` edge function 內每次呼叫做 ~6 個 query：
1. `get_screen_by_device_token` RPC（auth）
2. `UPDATE screens` (heartbeat + optional disk_status)
3. `INSERT playback_logs` (if any)
4. `SELECT screens` (resolve channel + default project)
5. `SELECT screen_channel_subscriptions`
6. `SELECT channels` + `SELECT design_projects` + `SELECT media_items`(manifest)

## 在 10K device 規模下的成本

| 設備數 | polling 間隔 | Edge function 呼叫 / 月 | 主要 query / 月 |
|---|---|---|---|
| 10,000 | 300s（Realtime 連線常態） | ~86M | ~520M |
| 10,000 | 30s（fallback） | ~864M | ~5.2B |

Supabase tier 配額：
- **Pro**: 2M edge function / 月
- **Team**: 8M / 月（仍不夠 10K device）
- **Enterprise**: 客製

不改設計直接上 10K device → Team tier 大概第一週就破額度。

## 修法（雙端配合）

### Backend（這個 PR）

新增 `player-heartbeat` edge function（`supabase/functions/player-heartbeat/index.ts`）：

- 只做 2 個 query：auth + UPDATE screens.last_ping_at
- 可選擇性帶 `disk_status` 做輕量遙測
- 回 `{ ok, server_ts, next_action: "heartbeat" | "sync" }`

預估 cost ratio：**player-sync ≈ 3× player-heartbeat**（query 數比）。

### Player（需要 player 端各 codebase 改）

把 sync 邏輯改成：

```js
let lastFullSync = 0;
const FULL_SYNC_INTERVAL = 30 * 60 * 1000;  // 30 min — safety re-sync

setInterval(async () => {
  const realtimeUp  = realtimeConnected;
  const hasPendingLogs = pendingLogs.length > 0;
  const stale       = Date.now() - lastFullSync > FULL_SYNC_INTERVAL;

  if (realtimeUp && !hasPendingLogs && !stale) {
    await playerHeartbeat();     // ← 輕量
  } else {
    await playerSync();          // ← 重，含 manifest
    lastFullSync = Date.now();
  }
}, 60 * 1000);  // 1-minute tick
```

關鍵：穩態（Realtime 連著、沒新 log）下，每分鐘只打一次 heartbeat；
真的需要更新（Realtime 通知 / 30 分鐘 safety sync / 有 log）才打完整 sync。

預估在 10K device 規模下：
- heartbeat: 10K × 60 / hour × 24 × 30 ≈ **432M / 月**（仍多）
- full sync: 10K × 2 / hour × 24 × 30 ≈ **14.4M / 月**

heartbeat 仍多，但每個只 2 query；改成 1 分鐘 tick → 約 1 query / 設備 / 分鐘 = 432M query / 月，依然不少但比 player-sync 重 query 少 6 倍。

### 進階：MQTT 心跳取代 HTTP heartbeat

如果 broker 已穩定運行，可以把 heartbeat 從 HTTP 改成 MQTT publish：

```
device → MQTT publish signage/player/{screenId}/heartbeat (retained, QoS 0)
broker → mosquitto-go-auth 已經把連線狀態反映給 LWT（Last Will）
server-side cron 每分鐘讀一次 retained message 表，批次更新 screens.last_ping_at
```

這條路：edge function 完全跳過，cost = MQTT broker 容量（單機可 10K+）。
但實作複雜，建議先驗 heartbeat 方案再評估。

### 建議的播放器端動作

每個 player codebase（signcms-player-android / signcms-player-desktop / web player）
都應該做的改動：

```
[ ] 加 playerHeartbeat() 函式呼叫 POST /functions/v1/player-heartbeat
[ ] 主 sync loop tick 改為每 60s
[ ] 邏輯：if (realtimeConnected && !hasPendingLogs && !stale) → heartbeat
       else → playerSync
[ ] 加 FULL_SYNC_INTERVAL（30 min）做 safety re-sync 防止漏掉 Realtime push
[ ] 收到 Realtime "command" event 後強制下一 tick 改 playerSync
```

各 player 端的修改點：
- web player (`player/src/main.js`): `doSync()` 函式（line 440） + `startSyncLoop()`（line 421）
- Android player: 對應的 SyncService / WorkManager 邏輯
- Desktop player: 同 web player

## 部署順序

1. **本 commit**：deploy `player-heartbeat` edge function。**player 端不動**，不會主動呼叫，0 影響。
2. **下一輪 sprint**：依序更新 player 各端，每個 codebase 自己驗證。
3. **觀察 Supabase invocation count**：確認 player-sync invocations 降下、player-heartbeat 上升、總量大幅減少。
4. **裝置全升完後**才能宣稱可上 10K device 規模。

## 退場路徑

若 heartbeat endpoint 出問題：
- player 端 fallback 路徑：偵測 heartbeat fail → 直接呼叫 player-sync。
- backend 也可關掉 heartbeat 路徑：把 player-heartbeat 改回 redirect to player-sync。
- 完全回滾：DELETE supabase/functions/player-heartbeat/。
