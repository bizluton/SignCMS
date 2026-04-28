#!/usr/bin/env bash
# /opt/signcms/production/scripts/deploy.sh
set -euo pipefail

TAG="${1:?需要 image tag}"
DIR="/opt/signcms/production"
IMAGE="ghcr.io/bizlution/signcms-bff:${TAG}"
LOG="/var/log/signcms/production/deploy.log"

ts()  { echo "[$(date '+%H:%M:%S')]"; }
log() { echo "$(ts) $*" | tee -a "$LOG"; }

log "━━ Production 部署：${TAG} ━━"

set -a; source "${DIR}/config/.env"; set +a
export IMAGE_TAG="$TAG"
cd "$DIR"

docker compose up -d redis 2>/dev/null || true
sleep 2

log "拉取 ${IMAGE}..."
docker pull "$IMAGE" 2>&1 | grep -E "Pulling|pulled|up to date" | \
  while read -r l; do log "  $l"; done

PREV=$(docker inspect signcms-production-bff \
  --format='{{index .Config.Labels "org.opencontainers.image.version"}}' 2>/dev/null || echo "none")

# 備份設定 + 記錄回滾點
cp "${DIR}/config/.env" "${DIR}/config/.env.backup-$(date +%Y%m%d-%H%M%S)" 2>/dev/null || true
echo "$PREV" > "${DIR}/config/previous_tag.txt"

IMAGE_TAG="$TAG" docker compose up -d --no-deps bff

log "健康確認（最多 90s）..."
for i in $(seq 1 30); do
  curl -sf http://localhost:3000/health &>/dev/null && {
    VER=$(curl -sf http://localhost:3000/health | \
      python3 -c "import json,sys;print(json.load(sys.stdin).get('version','?'))" 2>/dev/null || echo "?")
    log "✅ Production 就緒 — v${VER}"
    echo "$TAG" > "${DIR}/config/current_tag.txt"
    echo "$(date -Iseconds) ${TAG}" >> "${DIR}/config/deploy_history.txt"
    docker image prune -f --filter "until=24h" &>/dev/null || true
    exit 0
  }
  sleep 3
done

# 自動回滾
log "❌ 健康確認失敗，自動回滾至 ${PREV}"
IMAGE_TAG="$PREV" docker compose up -d --no-deps bff 2>/dev/null || true
sleep 15
curl -sf http://localhost:3000/health &>/dev/null && \
  log "⚠️ 已回滾至 ${PREV}" || \
  log "🚨 回滾失敗！請立即介入：docker logs signcms-production-bff"
exit 1
