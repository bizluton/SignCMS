/**
 * src/lib/env.ts
 * 啟動時驗證所有必要環境變數，缺少任何必填項目立即 crash（快速失敗原則）
 */

import { z } from 'zod'

const envSchema = z.object({
  PORT: z.coerce.number().default(3001),
  HOST: z.string().default('0.0.0.0'),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),

  // Supabase（必填）
  SUPABASE_URL: z.string().url(),
  SUPABASE_ANON_KEY: z.string().min(10),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(10),
  SUPABASE_JWT_SECRET: z.string().min(10),

  // Redis
  REDIS_URL: z.string().default('redis://localhost:6379'),

  // ffmpeg worker（選填）
  TRANSCODE_WORKER_URL: z.string().url().optional(),
  TRANSCODE_HMAC_SECRET: z.string().min(16).optional(),
  BFF_PUBLIC_URL: z.string().url().optional(),

  // S3（選填，transcode worker 需要）
  S3_ENDPOINT: z.string().optional(),
  S3_BUCKET: z.string().optional(),

  // AI（Week 3+）
  ANTHROPIC_API_KEY: z.string().optional(),
  CLAUDE_MODEL: z.string().default('claude-haiku-4-5-20251001'),

  // CORS
  FRONTEND_ORIGIN: z.string().default('http://localhost:5173'),

  // 監控（選填）
  SENTRY_DSN: z.string().url().optional(),
  GIT_SHA: z.string().optional(),
})

const parsed = envSchema.safeParse(process.env)

if (!parsed.success) {
  console.error('❌ 環境變數驗證失敗：')
  console.error(parsed.error.flatten().fieldErrors)
  process.exit(1)
}

export const env = parsed.data
export type Env = typeof env
