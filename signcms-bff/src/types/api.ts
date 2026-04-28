/**
 * src/types/api.ts
 * 統一 API 回應格式
 */

export interface ApiSuccess<T = unknown> {
  ok: true
  data: T
}

export interface ApiError {
  ok: false
  error: string
  code?: string
  details?: unknown
}

export type ApiResponse<T = unknown> = ApiSuccess<T> | ApiError

// ─── JWT Payload（Supabase 簽發）────────────────────────────────

export interface SupabaseJwtPayload {
  sub: string          // user UUID
  email?: string
  role: string         // 'authenticated' | 'anon' | 'service_role'
  aud: string
  exp: number
  iat: number
  // Supabase custom claims（透過 auth hook 注入）
  org_id?: string
  user_role?: string
}

// ─── 驗證過後掛在 request 上的 user context ────────────────────

export interface RequestUser {
  id: string           // user UUID
  email?: string
  orgId?: string
  role?: string
}

// ─── Fastify 型別擴充 ─────────────────────────────────────────

declare module 'fastify' {
  interface FastifyRequest {
    user?: RequestUser
  }
}
