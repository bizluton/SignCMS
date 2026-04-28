/**
 * src/types/database.ts
 *
 * 從前端 src/integrations/supabase/types.ts 複製過來，
 * 保持 BFF 與前端的型別定義完全一致。
 * 未來可考慮抽成 shared npm package。
 */

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

// ─── 核心業務型別（從完整 types.ts 擷取常用部分）──────────────────

export interface Organization {
  id: string
  name: string
  created_at: string
  updated_at: string
  license_plan: string | null
  license_expires_at: string | null
  license_reminder_sent: Json | null
  slug: string | null
  logo_url: string | null
  webhook_token: string | null
}

export interface Screen {
  id: string
  org_id: string
  name: string
  is_online: boolean | null
  last_seen_at: string | null
  firmware_version: string | null
  model: string | null
  location: string | null
  created_at: string
  updated_at: string
}

export interface MediaItem {
  id: string
  org_id: string
  name: string
  url: string | null
  storage_path: string | null
  file_size: number | null
  mime_type: string | null
  duration_seconds: number | null
  transcode_status: 'none' | 'pending' | 'processing' | 'done' | 'failed'
  created_at: string
  updated_at: string
}

export interface LicenseCode {
  id: string
  code: string
  extend_days: number
  plan_name: string
  status: 'pending' | 'redeemed'
  redeemed_by: string | null
  redeemed_at: string | null
  created_at: string
}

export interface DeviceLicense {
  id: string
  org_id: string
  device_model: string
  device_serial: string
  code: string
  activated_at: string | null
  expires_at: string | null
  status: string
}

export interface UserRole {
  id: string
  user_id: string
  org_id: string | null
  role: string
  created_at: string
}
