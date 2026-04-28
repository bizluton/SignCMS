/**
 * src/server.ts — SignCMS BFF API Server（Week 5-6 最終版）
 *
 * Routes:
 *  /health, /health/deep   存活 + 深度探針
 *  /api/media/*            媒體上傳 + 轉檔
 *  /api/license/*          License 管理
 *  /api/webhook/*          Smart Trigger
 *  /api/knowledge/*        Knowledge Chat RAG
 *  /api/mcp                MCP Server
 *  /api/onboarding/*       客戶開通自動化（System Admin）
 *  /api/admin/*            客戶管理 Portal（System Admin）
 *  /api/docs/*             OpenAPI 文件 + Scalar UI
 */

import './lib/sentry.js'

import Fastify from 'fastify'
import cors from '@fastify/cors'
import helmet from '@fastify/helmet'
import rateLimit from '@fastify/rate-limit'
import multipart from '@fastify/multipart'
import jwt from '@fastify/jwt'

import { env } from './lib/env.js'
import { requestLogger } from './middleware/requestLogger.js'
import { startTranscodeWorker, stopTranscodeWorker } from './services/transcodeQueue.js'

import healthRoute           from './routes/health.js'
import mediaUploadRoute      from './routes/media/upload.js'
import transcodeCallbackRoute from './routes/media/transcodeCallback.js'
import licenseRoutes         from './routes/license/index.js'
import smartTriggerRoute     from './routes/webhook/smartTrigger.js'
import knowledgeChatRoute    from './routes/knowledge/chat.js'
import mcpRoute              from './routes/mcp/index.js'
import onboardingRoutes      from './routes/onboarding/index.js'
import adminPortalRoute      from './routes/admin/portal.js'
import openApiRoute          from './routes/openapi/spec.js'
import playerManifestRoute   from './routes/player/index.js'

const fastify = Fastify({
  logger: {
    level: env.NODE_ENV === 'production' ? 'info' : 'debug',
    transport:
      env.NODE_ENV !== 'production'
        ? { target: 'pino-pretty', options: { colorize: true } }
        : undefined,
  },
})

// rawBody（HMAC callback 驗章）
fastify.addContentTypeParser(
  'application/json',
  { parseAs: 'string' },
  (req, body, done) => {
    try {
      ;(req as any).rawBody = body
      done(null, JSON.parse(body as string))
    } catch (err) {
      done(err as Error, undefined)
    }
  }
)

await fastify.register(helmet, { contentSecurityPolicy: false })

await fastify.register(cors, {
  origin: [env.FRONTEND_ORIGIN, 'http://localhost:5173', 'http://localhost:3000'],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: [
    'Authorization', 'Content-Type',
    'X-Webhook-Token', 'X-Signature', 'X-Timestamp', 'X-Debug-Id',
  ],
  exposedHeaders: ['X-Debug-Id'],
})

await fastify.register(rateLimit, {
  global: true,
  max: 200,
  timeWindow: '1 minute',
  keyGenerator: (req) => {
    if (req.url.startsWith('/api/knowledge') || req.url.startsWith('/api/mcp')) {
      return (req as any).user?.id ?? req.ip
    }
    return req.ip
  },
  errorResponseBuilder: (_req, context) => ({
    ok: false, error: 'Too many requests', retryAfter: context.after,
  }),
})

await fastify.register(multipart, {
  limits: { fileSize: 52_428_800, files: 1 },
})

await fastify.register(jwt, {
  secret: env.SUPABASE_JWT_SECRET,
  verify: { algorithms: ['HS256'] },
})

fastify.addHook('onRequest', requestLogger)

fastify.addHook('onResponse', (request, reply, done) => {
  request.log.info({
    method: request.method, url: request.url,
    status: reply.statusCode, latency_ms: Math.round(reply.elapsedTime),
  }, 'response')
  done()
})

// ─── Routes ───────────────────────────────────────────────────

await fastify.register(healthRoute)
await fastify.register(mediaUploadRoute,       { prefix: '/api/media' })
await fastify.register(transcodeCallbackRoute, { prefix: '/api/media' })
await fastify.register(licenseRoutes,          { prefix: '/api/license' })
await fastify.register(smartTriggerRoute,      { prefix: '/api/webhook' })
await fastify.register(knowledgeChatRoute,     { prefix: '/api/knowledge' })
await fastify.register(mcpRoute,               { prefix: '/api/mcp' })
await fastify.register(onboardingRoutes,       { prefix: '/api/onboarding' })
await fastify.register(adminPortalRoute,       { prefix: '/api/admin' })
await fastify.register(openApiRoute,           { prefix: '/api/docs' })
await fastify.register(playerManifestRoute,    { prefix: '/api/player' })

fastify.setNotFoundHandler((_req, reply) => {
  reply.status(404).send({ ok: false, error: 'Route not found' })
})

fastify.setErrorHandler((error, request, reply) => {
  request.log.error({ err: error }, 'Unhandled error')
  if (error.validation) {
    return reply.status(400).send({ ok: false, error: 'Validation error', details: error.validation })
  }
  return reply.status(error.statusCode ?? 500).send({
    ok: false,
    error: env.NODE_ENV === 'production' ? 'Internal server error' : error.message,
  })
})

async function shutdown(signal: string) {
  fastify.log.info(`${signal} received, shutting down...`)
  await stopTranscodeWorker()
  await fastify.close()
  process.exit(0)
}
process.on('SIGTERM', () => shutdown('SIGTERM'))
process.on('SIGINT',  () => shutdown('SIGINT'))

async function start() {
  try {
    startTranscodeWorker()
    await fastify.listen({ port: env.PORT, host: env.HOST })
    fastify.log.info(`
╔══════════════════════════════════════════════════════════╗
║  SignCMS BFF  http://${env.HOST}:${env.PORT}                     ║
║  API Docs:    http://${env.HOST}:${env.PORT}/api/docs            ║
║  ENV: ${env.NODE_ENV.padEnd(16)}  Sentry: ${process.env.SENTRY_DSN ? 'ON ' : 'OFF'}  MCP: ON    ║
╚══════════════════════════════════════════════════════════╝`)
  } catch (err) {
    fastify.log.error(err)
    process.exit(1)
  }
}

start()
