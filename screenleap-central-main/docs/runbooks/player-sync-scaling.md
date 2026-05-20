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

### 進階（已實作）：MQTT 心跳取代 HTTP heartbeat

當需要更短的偵測延遲（< 1 分鐘）+ 10K device 不能破 Supabase tier 額度，
把 heartbeat 走 MQTT broker：

```
Player (每 60s, retained QoS 0)
  └─ MQTT publish signage/player/{screenId}/heartbeat  { "ts", "disk_status"? }
                                                                ↓
                                                       Mosquitto broker
                                                                ↓
                                              heartbeat-collector (sidecar)
                                              ├ subscribe signage/player/+/heartbeat
                                              ├ buffer 30s（latest-wins per screen）
                                              └ flush → Supabase RPC
                                                                ↓
                                              update_screen_heartbeats(jsonb)
                                                                ↓
                                              bulk UPDATE screens
                                                                ↓
                                              pg_cron 每分鐘 mark_stale_screens_offline()
                                              （> 3 分鐘沒 heartbeat 標為 offline）
```

成本對比：

| 方案 | 10K device 月 Supabase invocation | 月 DB query |
|---|---|---|
| HTTP heartbeat 60s | 432M | 864M |
| **MQTT heartbeat 60s** | **~86k**（每分鐘 2 個 RPC） | ~86k UPDATE（每次 bulk 5K rows） |

**MQTT 心跳省 5000 倍 edge function 額度。**

#### 實作

**Backend（已 commit）**：
- `supabase/migrations/20260521000008_screen_heartbeat_bulk_update.sql`
  - `update_screen_heartbeats(jsonb)` RPC（service_role only）
  - `mark_stale_screens_offline(seconds)` + 每分鐘 pg_cron
- `mosquitto/heartbeat-collector/`
  - Node.js subscriber service
  - systemd unit + Dockerfile
  - 部署 SOP 見 `mosquitto/heartbeat-collector/README.md`

**Player（待 player codebase 各自更新）**：

```js
// 1. Connect MQTT (already done for command receiving)
const mqttClient = mqtt.connect(MQTT_URL, {
  username: screenId,
  password: deviceToken,
});

// 2. Publish heartbeat every 60s
setInterval(() => {
  if (mqttClient.connected) {
    mqttClient.publish(
      `signage/player/${screenId}/heartbeat`,
      JSON.stringify({
        ts: new Date().toISOString(),
        disk_status: getDiskStatus(),  // optional
      }),
      { qos: 0, retain: true },         // ← retain=true 是關鍵
    );
  }
}, 60_000);

// 3. HTTP player-sync 改成 safety net 而非每 5 分鐘
//    僅在以下情境呼叫：
//    - 初次連線（first sync）
//    - Realtime 推 "command" 事件
//    - 30 分鐘沒 full sync（FULL_SYNC_INTERVAL）
//    - 收到 command 但未訂閱 Realtime（推 fallback）
```

#### 部署順序

1. **DB migration**：`20260521000008` 上線。
2. **heartbeat-collector**：部署到 broker VM、`systemctl enable --now`。觀察 24h；確認 `mark_stale_screens_offline` 沒誤殺活螢幕。
3. **Player codebase 升級**：依各 codebase 進度，逐批更新。期間 HTTP `player-heartbeat`（Scale-2 加的）跟 MQTT heartbeat 可以共存——backend 兩條路徑都更新 `last_ping_at`。
4. **完成後**：HTTP heartbeat polling 可拉長到 30 分（safety），主要 heartbeat 走 MQTT。

#### 回滾

```
# 1. 停 collector
sudo systemctl disable --now heartbeat-collector

# 2. Player MQTT publish 可不動，broker 接收後沒 collector 處理也不會壞
# 3. pg_cron mark-stale-screens-offline 可保留（HTTP heartbeat 仍會更新 last_ping_at）

# 4. 想完全還原：
DROP FUNCTION public.update_screen_heartbeats(jsonb);
DROP FUNCTION public.mark_stale_screens_offline(int);
SELECT cron.unschedule('mark-stale-screens-offline');
```

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
