# ─── Stage 1: 安裝依賴 ────────────────────────────────────────
FROM node:20-alpine AS deps
WORKDIR /app
COPY package*.json ./
RUN npm ci --ignore-scripts

# ─── Stage 2: TypeScript 編譯 ─────────────────────────────────
FROM deps AS builder
COPY tsconfig.json ./
COPY src ./src
# 接收 CI 注入的版本號
ARG BUILD_VERSION=0.0.0-dev
ARG BUILD_SHA=unknown
ENV npm_package_version=$BUILD_VERSION
RUN npm run build

# ─── Stage 3: Production Image ────────────────────────────────
FROM node:20-alpine AS production
WORKDIR /app

# 安全：非 root 執行
RUN addgroup -g 1001 -S nodejs \
 && adduser -S bff -u 1001

# 只安裝 production 依賴
COPY package*.json ./
RUN npm ci --omit=dev --ignore-scripts \
 && npm cache clean --force

# 複製編譯結果
COPY --from=builder /app/dist ./dist

# 版本資訊（讓 /health 能回傳正確版本）
ARG BUILD_VERSION=0.0.0-dev
ARG BUILD_SHA=unknown
ENV npm_package_version=$BUILD_VERSION \
    BUILD_SHA=$BUILD_SHA \
    NODE_ENV=production

# 切換到非 root
USER bff

EXPOSE 3001

# Docker 內建健康檢查（docker ps 可見狀態）
HEALTHCHECK --interval=30s --timeout=10s --start-period=20s --retries=3 \
  CMD wget -qO- http://localhost:3001/health || exit 1

CMD ["node", "dist/server.js"]
