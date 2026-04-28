#!/usr/bin/env bash
# /opt/signcms/staging/scripts/deploy.sh
set -euo pipefail

TAG="${1:?需要 image tag}"
DIR="/opt/signcms/staging"
IMAGE="ghcr.io/bizlution/signcms-bff:${TAG}"
LOG="/var/log/signcms/staging/deploy.log"

ts() { echo "[$(date '+%H:%M:%S')]"; }
log() { echo "$(ts) $*" | tee -a "$LOG"; }

log "━━ Staging 部署：${TAG} ━━"

set -a; source "${DIR}/config/.env"; set +a
export IMAGE_TAG="$TAG"
cd "$DIR"

# 首次啟動需要建立 redis
docker compose up -d redis 2>/dev/null || true
sleep 2

# Rolling restart BFF
log "拉取 ${IMAGE}..."
docker pull "$IMAGE" 2>&1 | grep -E "Pulling|pulled|up to date" | \
  while read -r l; do log "  $l"; done

PREV=$(docker inspect signcms-staging-bff \
  --format='{{index .Config.Labels "org.opencontainers.image.version"}}' 2>/dev/null || echo "none")

IMAGE_TAG="$TAG" docker compose up -d --no-deps bff

# 健康確認
log "健康確認（最多 60s）..."
for i in $(seq 1 20); do
  curl -sf http://localhost:3001/health &>/dev/null && {
    VER=$(curl -sf http://localhost:3001/health | \
      python3 -c "import json,sys;print(json.load(sys.stdin).get('version','?'))" 2>/dev/null || echo "?")
    log "✅ Staging 就緒 — v${VER}"
    echo "$TAG" > "${DIR}/config/current_tag.txt"
    docker image prune -f --filter "until=24h" &>/dev/null || true
    exit 0
  }
  sleep 3
done

# 回滾
log "❌ 健康確認失敗，回滾至 ${PREV}"
IMAGE_TAG="$PREV" docker compose up -d --no-deps bff 2>/dev/null || true
exit 1
