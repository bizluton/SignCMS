/**
 * src/lib/supabase.ts
 *
 * BFF 使用兩種 Supabase client：
 *
 * 1. supabaseAdmin  — service_role key，繞過 RLS，用於後端業務邏輯
 * 2. supabaseAsUser — 透過使用者 JWT 建立，讓 RLS 生效（用於權限敏感操作）
 *
 * 規則：
 *  - SELECT 查詢如果已在前端透過 Supabase client 完成，BFF 不需重複
 *  - BFF 只用 supabaseAdmin 做寫入/管理操作，或需要繞過 RLS 的查詢
 *  - 凡涉及 user 資料隔離的查詢，用 supabaseAsUser 讓 RLS 當第二道防線
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '../types/database.js'
import { env } from './env.js'

// ─── Admin client（singleton）────────────────────────────────────

let _adminClient: SupabaseClient<Database> | null = null

export function supabaseAdmin(): SupabaseClient<Database> {
  if (!_adminClient) {
    _adminClient = createClient<Database>(
      env.SUPABASE_URL,
      env.SUPABASE_SERVICE_ROLE_KEY,
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false,
        },
      }
    )
  }
  return _adminClient
}

// ─── Per-request user client（使用 JWT）────────────────────────

export function supabaseAsUser(userJwt: string): SupabaseClient<Database> {
  return createClient<Database>(
    env.SUPABASE_URL,
    env.SUPABASE_ANON_KEY,
    {
      global: {
        headers: { Authorization: `Bearer ${userJwt}` },
      },
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    }
  )
}

// ─── 常用 helper：驗證使用者在指定 org 內有角色 ─────────────────

export async function assertUserInOrg(
  userId: string,
  orgId: string
): Promise<boolean> {
  const db = supabaseAdmin()
  const { data } = await db.rpc('user_in_org', {
    _user_id: userId,
    _org_id: orgId,
  })
  return !!data
}

export async function assertUserHasRole(
  userId: string,
  role: 'admin' | 'org_admin'
): Promise<boolean> {
  const db = supabaseAdmin()
  const { data } = await db.rpc('has_role', {
    _user_id: userId,
    _role: role,
  })
  return !!data
}

export async function isSystemAdmin(userId: string): Promise<boolean> {
  const db = supabaseAdmin()
  const { data } = await db
    .from('system_admins')
    .select('id')
    .eq('user_id', userId)
    .limit(1)
    .single()
  return !!data
}
