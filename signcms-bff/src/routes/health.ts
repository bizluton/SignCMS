/**
 * src/routes/health.ts
 *
 * GET  /health         — 快速存活探針（load balancer / k8s liveness）
 * GET  /health/deep    — 深度健康檢查（Redis + Supabase + 轉檔 worker）
 *
 * /health/deep 由監控系統（UptimeRobot / BetterUptime）每分鐘呼叫，
 * 任一依賴不通則回 503，觸發告警。
 */

import { FastifyPluginAsync } from 'fastify'
import { supabaseAdmin } from '../lib/supabase.js'
import { transcodeQueue } from '../services/transcodeQueue.js'
import { env } from '../lib/env.js'

interface CheckResult {
  status: 'ok' | 'error'
  latency_ms?: number
  error?: string
}

async function checkSupabase(): Promise<CheckResult> {
  const start = Date.now()
  try {
    const db = supabaseAdmin()
    const { error } = await db.from('organizations').select('id').limit(1)
    if (error) return { status: 'error', error: error.message }
    return { status: 'ok', latency_ms: Date.now() - start }
  } catch (e: any) {
    return { status: 'error', error: e.message }
  }
}

async function checkRedis(): Promise<CheckResult> {
  const start = Date.now()
  try {
    // BullMQ queue.client 暴露 ioredis instance
    const client = await (transcodeQueue as any).client
    await client.ping()
    return { status: 'ok', latency_ms: Date.now() - start }
  } catch (e: any) {
    return { status: 'error', error: e.message }
  }
}

async function checkTranscodeWorker(): Promise<CheckResult> {
  if (!env.TRANSCODE_WORKER_URL) {
    return { status: 'ok', error: 'not configured (optional)' }
  }
  const start = Date.now()
  try {
    const res = await fetch(`${env.TRANSCODE_WORKER_URL}/health`, {
      signal: AbortSignal.timeout(3000),
    })
    if (!res.ok) return { status: 'error', error: `HTTP ${res.status}` }
    return { status: 'ok', latency_ms: Date.now() - start }
  } catch (e: any) {
    return { status: 'error', error: e.message }
  }
}

const healthRoute: FastifyPluginAsync = async (fastify) => {

  // ── GET /health — 快速存活探針 ──────────────────────────────
  fastify.get('/health', async () => ({
    status: 'ok',
    version: process.env.npm_package_version ?? '1.0.0',
    timestamp: new Date().toISOString(),
    uptime_seconds: Math.floor(process.uptime()),
    env: env.NODE_ENV,
    features: {
      transcode: !!env.TRANSCODE_WORKER_URL,
      ai_chat: !!env.ANTHROPIC_API_KEY,
      mcp: true,
      sentry: !!process.env.SENTRY_DSN,
    },
  }))

  // ── GET /health/deep — 深度依賴檢查 ─────────────────────────
  fastify.get('/health/deep', async (_request, reply) => {
    const [supabase, redis, worker] = await Promise.all([
      checkSupabase(),
      checkRedis(),
      checkTranscodeWorker(),
    ])

    const allOk = supabase.status === 'ok' && redis.status === 'ok'
    // worker 是 optional，不影響整體 status

    const response = {
      status: allOk ? 'ok' : 'degraded',
      timestamp: new Date().toISOString(),
      checks: { supabase, redis, transcode_worker: worker },
    }

    return reply.status(allOk ? 200 : 503).send(response)
  })
}

export default healthRoute
