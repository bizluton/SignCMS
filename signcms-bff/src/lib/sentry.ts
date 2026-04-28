/**
 * src/lib/sentry.ts
 *
 * Sentry 錯誤追蹤初始化
 *
 * 使用：在 server.ts 最頂端 import（必須第一個）
 *   import './lib/sentry.js'
 *
 * 設定環境變數：
 *   SENTRY_DSN=https://xxx@sentry.io/yyy
 *
 * 功能：
 *  - 自動捕捉未處理的 exception 和 rejection
 *  - Fastify request 追蹤（透過 Sentry Fastify plugin）
 *  - 效能 tracing（每 10% 的 request 採樣）
 *  - 環境標籤（development / production）
 *  - Release 版本（對應 git SHA）
 */

import * as Sentry from '@sentry/node'
import { env } from './env.js'

const SENTRY_DSN = process.env.SENTRY_DSN

if (SENTRY_DSN) {
  Sentry.init({
    dsn: SENTRY_DSN,
    environment: env.NODE_ENV,
    release: process.env.GIT_SHA ?? 'unknown',

    // 效能追蹤採樣率
    tracesSampleRate: env.NODE_ENV === 'production' ? 0.1 : 1.0,

    // 過濾不需要追蹤的錯誤
    beforeSend(event) {
      // 排除 JWT 過期（正常行為，不需要 alert）
      if (event.exception?.values?.[0]?.value?.includes('TokenExpiredError')) {
        return null
      }
      return event
    },
  })
  console.log(`✅ Sentry initialized (env: ${env.NODE_ENV})`)
} else {
  console.warn('⚠️  SENTRY_DSN 未設定，錯誤追蹤停用')
}

// 手動捕捉錯誤的 helper（用於 catch block）
export function captureError(err: unknown, context?: Record<string, unknown>): void {
  if (!SENTRY_DSN) return
  Sentry.withScope(scope => {
    if (context) scope.setExtras(context)
    Sentry.captureException(err)
  })
}

// 手動送出 message（用於重要業務事件）
export function captureMessage(
  message: string,
  level: 'info' | 'warning' | 'error' = 'info',
  context?: Record<string, unknown>
): void {
  if (!SENTRY_DSN) return
  Sentry.withScope(scope => {
    if (context) scope.setExtras(context)
    Sentry.captureMessage(message, level)
  })
}

export { Sentry }
