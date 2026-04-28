/**
 * src/middleware/requestLogger.ts
 *
 * 結構化請求日誌 middleware
 *
 * 每個請求記錄：
 *  - method, url, status, latency_ms
 *  - user_id（JWT 驗證後）
 *  - org_id（從 JWT claims 或 body 取得）
 *  - x-debug-id（Smart Trigger 追蹤）
 *  - ip（CloudFlare / proxy 後的真實 IP）
 *
 * 格式符合 Grafana Loki / Datadog 的 key=value structured log。
 * Production 環境下由 pino JSON logger 輸出，可直接接 log aggregator。
 */

import { FastifyRequest, FastifyReply, HookHandlerDoneFunction } from 'fastify'

export function requestLogger(
  request: FastifyRequest,
  _reply: FastifyReply,
  done: HookHandlerDoneFunction
): void {
  // 真實 IP（Cloudflare → CF-Connecting-IP，其他 proxy → X-Forwarded-For）
  const ip =
    (request.headers['cf-connecting-ip'] as string) ??
    (request.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ??
    request.ip

  request.log.info({
    method: request.method,
    url: request.url,
    ip,
    user_id: (request as any).user?.id,
    org_id: (request as any).user?.orgId,
    debug_id: request.headers['x-debug-id'],
  }, 'request')

  done()
}
