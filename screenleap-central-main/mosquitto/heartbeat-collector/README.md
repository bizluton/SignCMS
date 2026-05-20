# SignCMS heartbeat-collector

> MQTT subscriber sidecar that funnels player heartbeats into a single
> Supabase bulk UPDATE per flush window. Designed to run on the same VM
> as the mosquitto broker.

## What it does

```
Player (60s, retained QoS 0)
   └─ publish signage/player/{screenId}/heartbeat  { "ts": "...", "disk_status": {...} }
                                                                    ↓
                                                       mosquitto broker
                                                                    ↓
                                            heartbeat-collector (this service)
                                            ├ subscribe signage/player/+/heartbeat
                                            ├ buffer in-memory, latest-wins per screen
                                            └ every 30s → flush
                                                                    ↓
                                            Supabase RPC update_screen_heartbeats(jsonb)
                                                                    ↓
                                            UPDATE screens SET last_ping_at, online, …
```

At 10K device scale: ~167 MQTT msg/s in (trivial for broker), 2 Supabase
RPC/min out. Edge-function invocations on the heartbeat hot path drop
from ~432M/mo (HTTP heartbeat) to ~86k/mo (RPC).

## Files

```
index.mjs                       Node.js service
package.json                    deps: mqtt, @supabase/supabase-js
heartbeat-collector.service     systemd unit
README.md                       this file
```

## Deployment

### 1. Install Node.js 20+ on the broker VM

```bash
# Debian/Ubuntu
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

node --version  # expect v20.x or higher
```

### 2. Copy this folder to the broker VM

```bash
sudo mkdir -p /opt/signcms/heartbeat-collector
sudo cp -r mosquitto/heartbeat-collector/* /opt/signcms/heartbeat-collector/
cd /opt/signcms/heartbeat-collector
sudo npm install --omit=dev
```

### 3. Create the user + log dir

```bash
sudo useradd --system --no-create-home --shell /usr/sbin/nologin signcms || true
sudo mkdir -p /var/log/signcms
sudo chown signcms:signcms /var/log/signcms
sudo chown -R signcms:signcms /opt/signcms
```

### 4. Provision env vars

```bash
sudo mkdir -p /etc/signcms
sudo tee /etc/signcms/heartbeat-collector.env > /dev/null <<'EOF'
MQTT_URL=mqtts://mqtt.signcms.net:18884
MQTT_USERNAME=signcms-server
MQTT_PASSWORD=<paste MQTT_SERVER_PASS value here>
MQTT_CA_FILE=/etc/mosquitto/certs/ca.crt
SUPABASE_URL=https://<project>.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<paste service role key here>
FLUSH_INTERVAL_MS=30000
MAX_BUFFER=50000
EOF
sudo chmod 600 /etc/signcms/heartbeat-collector.env
sudo chown signcms:signcms /etc/signcms/heartbeat-collector.env
```

**SECURITY**: this env file contains the `service_role` key. Audit access
carefully; rotate the key if the VM is compromised.

### 5. Install + start systemd unit

```bash
sudo cp heartbeat-collector.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now heartbeat-collector
sudo systemctl status heartbeat-collector
```

### 6. Verify

```bash
# Log output — should see MQTT connect + flush counts
sudo journalctl -u heartbeat-collector -f

# Force a heartbeat from a test client (use one of your device tokens):
mosquitto_pub \
  -h mqtt.signcms.net -p 18884 --tls \
  -u <screen-uuid> -P <device_token> \
  -t "signage/player/<screen-uuid>/heartbeat" \
  -r -q 0 \
  -m '{"ts":"2026-05-21T12:00:00Z"}'

# Within 30s, the screen's last_ping_at in Supabase should update.
```

## Operations

### Reading logs

```bash
sudo journalctl -u heartbeat-collector --since "10 min ago"
```

Look for `flushed N heartbeats, M rows updated in Xms`. Expected at 10K
device scale: `flushed ~5000 heartbeats, ~5000 rows updated in 200-800ms`.

### Restarting

```bash
sudo systemctl restart heartbeat-collector
```

In-flight buffer is flushed on shutdown (SIGTERM); any retained messages
the player has sent will be replayed on the next subscribe.

### Tuning

| Variable | Default | When to change |
|---|---|---|
| `FLUSH_INTERVAL_MS` | `30000` | Increase to 60000 if you want fewer RPC calls at the cost of slower `last_ping_at` freshness. Decrease to 10000 for tighter offline detection but more RPC load. |
| `MAX_BUFFER` | `50000` | Increase if you have >50k devices. Decrease if you want to detect a flooding bug sooner. |

### Failure modes

| Failure | Behaviour | Recovery |
|---|---|---|
| Supabase RPC fails | Batch is requeued; next flush retries | Supabase recovers → next flush succeeds |
| MQTT disconnect | mqtt-client auto-reconnects every 5s | Retained heartbeats deliver on resubscribe; no data loss |
| Service crashes | systemd restarts after 10s; retained messages replay | Buffer in flight is lost; recovered from retained on reconnect |
| Two collector instances run (split-brain) | Both write; UPDATE is idempotent (latest-wins) | Stop the duplicate; no data corruption |

### Scaling beyond 50k device

Single instance handles ~50k device comfortably. Above that:
- Run multiple collectors, each subscribed to a topic-prefix subset
  (e.g. `signage/player/0/*`, `signage/player/1/*` using shared subscriptions
  `$share/group/signage/player/+/heartbeat` if your broker supports MQTT 5).
- Or move to streaming: write to a Postgres `screen_heartbeat_stream` table
  via COPY, drop the RPC.

## Rollback

If you want to disable the MQTT heartbeat path and revert to HTTP-only:

```bash
sudo systemctl disable --now heartbeat-collector
```

Players will keep publishing heartbeats — they'll just accumulate as retained
messages in the broker (no harm; broker discards on next publish). HTTP
heartbeat path (`player-heartbeat` edge function) still works.

To roll back the DB side: drop the cron + RPC (see migration 20260521000008).

## Local development

```bash
# install
npm install

# create local .env
cp -n .env.example .env  # if you have one; otherwise create manually
export $(cat .env | xargs)

# run
node index.mjs
```

Or with docker (recommended for staging):

```bash
docker run --rm -it \
  --env-file /etc/signcms/heartbeat-collector.env \
  -v /etc/mosquitto/certs/ca.crt:/ca.crt:ro \
  -e MQTT_CA_FILE=/ca.crt \
  -v $PWD:/app -w /app \
  node:20 sh -c "npm install --omit=dev && node index.mjs"
```
