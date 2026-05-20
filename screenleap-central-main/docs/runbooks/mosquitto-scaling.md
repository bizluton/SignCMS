# Mosquitto scaling runbook — 10K device target

> 配合 `mosquitto/mosquitto.conf`。設定檔是給 broker 本身的，本文件講
> **作業系統 / 部署層**的調整。

## 1. VM sizing

| 設備數 | CPU | RAM | 網路 | 磁碟 |
|---|---|---|---|---|
| 1k | 1 vCPU | 1 GB | 100 Mbps | 10 GB |
| 5k | 2 vCPU | 2 GB | 250 Mbps | 20 GB |
| **10k** | **2–4 vCPU** | **4 GB** | **500 Mbps** | **40 GB** |
| 50k | 4–8 vCPU | 8–16 GB | 1 Gbps | 100 GB |
| 100k+ | broker cluster |

10K device 經驗值：mosquitto 單一行程 ~400 MB RSS，CPU 在常態心跳下
~20–30% 一顆 vCPU。

## 2. Kernel ulimits

每個 TCP 連線吃一個 file descriptor。預設 `nofile=1024` 上 1K 就破。
編 `/etc/security/limits.conf`：

```
mosquitto soft nofile 65536
mosquitto hard nofile 65536
```

或 systemd unit override：

```ini
# /etc/systemd/system/mosquitto.service.d/limits.conf
[Service]
LimitNOFILE=65536
LimitNPROC=4096
```

驗證：

```bash
systemctl daemon-reload
systemctl restart mosquitto
cat /proc/$(pgrep mosquitto)/limits | grep "open files"
# Max open files            65536    65536    files
```

## 3. sysctl

`/etc/sysctl.d/mosquitto.conf`：

```sysctl
# TCP backlog — handle bursts of reconnects
net.core.somaxconn = 8192
net.ipv4.tcp_max_syn_backlog = 8192

# Conn tracking table — needed if iptables / nftables stateful
net.netfilter.nf_conntrack_max = 262144

# Time-wait recycling
net.ipv4.tcp_tw_reuse = 1
net.ipv4.tcp_fin_timeout = 30

# Local port range (for outbound — broker mostly listens, but mosquitto-go-auth
# makes outbound HTTPS to Supabase)
net.ipv4.ip_local_port_range = 10000 65000

# Buffer sizes
net.core.rmem_max = 16777216
net.core.wmem_max = 16777216
net.ipv4.tcp_rmem = 4096 87380 16777216
net.ipv4.tcp_wmem = 4096 65536 16777216
```

套用：

```bash
sysctl -p /etc/sysctl.d/mosquitto.conf
```

## 4. mosquitto-go-auth caching（broker 已配置）

`mosquitto.conf` 內已加：

```
auth_opt_cache_type           ristretto
auth_opt_auth_cache_seconds   300
auth_opt_acl_cache_seconds    300
auth_opt_auth_jitter_seconds  30
auth_opt_acl_jitter_seconds   30
auth_opt_auth_cache_reset_on_hit true
auth_opt_http_retry_count   3
auth_opt_http_retry_backoff 500ms
```

**為什麼這是 critical**：

每個 MQTT operation 都會觸發一次 auth check：
- CONNECT      → `/user` endpoint
- PUBLISH      → `/acl` endpoint (acc=2)
- SUBSCRIBE    → `/acl` endpoint (acc=1)
- UNSUBSCRIBE  → `/acl` endpoint (acc=4)

沒 cache 的話，一台正常的 player 每分鐘可能呼叫 5–10 次 ACL check。
10K device × 7 op/min = 70K Supabase invocations / min = **5M / 小時**。

開了 300s cache 後，同一條 (user, topic, acc) 5 分鐘內只打一次。穩態
下 10K device：~10K connections × 1 ACL check / 5min ≈ 2K / min ≈
2.88M / day。**降 35 倍以上**。

調整建議：
- 流量很穩 → 把 cache 拉到 1800（30 min）
- 客戶端非常多種 → 縮回 300（5 min）保留靈活性
- Reject 數量多 → 把 jitter 加大避免 cache miss storm

## 5. 部署層

### systemd unit hardening

`/etc/systemd/system/mosquitto.service`（或 override）：

```ini
[Service]
LimitNOFILE=65536
LimitNPROC=4096
Restart=on-failure
RestartSec=5s
# 重啟後 5 秒內所有 10K device 都會 reconnect → mosquitto-go-auth cache
# 會被同時 ramp。jitter 設定降低同秒尖峰。
```

### Reverse proxy / Load balancer

10K device 全部直接打 broker IP → 單一機器 bottleneck。建議：

- **HAProxy / nginx stream**：TCP passthrough（TLS 在 broker 端終止）
- 或 **Cloud-native LB**（AWS NLB / GCP TCP LB）
- 健康檢查走 `localhost:1884` 第二 listener（plain TCP，allow_anonymous）

避免 7-layer load balancer—mosquitto 是 stateful，session sticky 必須。

### Cluster（>= 50K device）

mosquitto 本身不 cluster。選項：
- **EMQX** / **VerneMQ** / **HiveMQ** — 商業 / OSS broker 有 cluster 支援
- mosquitto 多實例 + bridge — 各 broker 之間用 MQTT bridge 串
- 商業托管（HiveMQ Cloud / EMQX Cloud）— 直接買容量

10K device 還沒到需要 cluster 的階段；單機 + 備援即可。

## 6. 監控指標

裝 mosquitto exporter（[mosquitto-exporter](https://github.com/sapcc/mosquitto-exporter)）+ Prometheus + Grafana：

| 指標 | 警示閾值（10k 規模） |
|---|---|
| `mosquitto_clients_connected` | < 8000（多 20% 掉線就警示） |
| `mosquitto_load_messages_received_5min` / sec | > 5000（暴衝） |
| `mosquitto_load_messages_sent_5min` / sec | > 5000 |
| `mosquitto_memory_used_bytes` | > 80% RAM |
| `mosquitto_open_sockets` | > 0.9 × nofile limit |
| Auth cache hit rate（自製） | < 0.95 表示快取沒生效 |
| Supabase invocation count（每小時）/ mqtt-auth | > 100K |

## 7. 測試 / 壓力測試

### 連接風暴測試

`mqtt-bench`：

```bash
# 模擬 10k device 同時 connect + 訂閱
mqtt-bench --action sub --broker mqtts://mqtt.signcms.net:18884 \
  --clients 10000 --topic 'signage/player/+/command' \
  --keepalive 60 --qos 1
```

預期：
- broker CPU 短暫拉高、約 5–10 秒穩定
- Supabase invocation 在第 1 分鐘 spike，5 分鐘後降回常態

### 心跳壓測

```bash
# 模擬 10k device 每 30 秒 publish 心跳
mqtt-bench --action pub --broker mqtts://mqtt.signcms.net:18884 \
  --clients 10000 --topic 'signage/player/$client/heartbeat' \
  --message 'ok' --qos 0 --interval 30000 --duration 600
```

預期：
- 心跳流量 ~333 msg/s，broker CPU < 30%
- Supabase ACL invocation 因 cache 大部分 hit，~< 10/s

## 8. 災難恢復

| 場景 | 復原方式 |
|---|---|
| broker 行程 crash | systemd restart；retained messages 自動從 `/var/lib/mosquitto/` 復原；10K device 5 分鐘內 reconnect 完 |
| broker 機器整台掛 | 從備份 image 起新機；DNS 切換 `mqtt.signcms.net` |
| Supabase mqtt-auth 不通 | broker cache 撐 5 分鐘；超過則新連線 reject、既有連線維持 |
| 認證後門洩漏（device_token） | 在 admin UI 對該 screen 觸發 issue_screen_device_token；舊 token 立即失效（broker 下次 cache 過期後 disconnect 該 device） |

## 9. checklist：部署前

- [ ] 套用 `mosquitto.conf` 並重啟
- [ ] 套用 `/etc/sysctl.d/mosquitto.conf` 並 `sysctl -p`
- [ ] 套用 `LimitNOFILE=65536` systemd override
- [ ] 確認 TLS 憑證正確（不是 self-signed 或過期）
- [ ] 確認 mosquitto-go-auth 從 cache hit rate dashboard 看得到 > 95%
- [ ] 模擬 10k connection 風暴跑一次，量 Supabase invocation
- [ ] 設 alert：clients_connected drop > 10% 或 memory > 80%
