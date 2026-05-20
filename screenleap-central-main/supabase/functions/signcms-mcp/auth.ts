// MCP token authentication helpers.
//
// Tokens are stored in `public.mcp_tokens` as SHA-256 hashes (column
// `token_hash`). The caller sends the raw token in `Authorization: Bearer …`
// or via path/query in the OAuth flow.

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { sha256hex } from "./shared.ts";

export interface TokenClaims {
  tokenId:     string;
  orgId:       string;
  userId:      string;
  permissions: string[];
}

export async function authenticate(
  authHeader: string | null,
  sb: SupabaseClient,
): Promise<TokenClaims | null> {
  if (!authHeader?.startsWith("Bearer ")) return null;
  const raw  = authHeader.slice(7).trim();
  const hash = await sha256hex(raw);

  const { data } = await sb
    .from("mcp_tokens")
    .select("id, org_id, user_id, permissions, expires_at")
    .eq("token_hash", hash)
    .maybeSingle();

  if (!data) return null;
  if (data.expires_at && new Date(data.expires_at) < new Date()) return null;

  // Touch last_used_at (fire-and-forget)
  sb.from("mcp_tokens")
    .update({ last_used_at: new Date().toISOString() })
    .eq("id", data.id)
    .then(() => {});

  return {
    tokenId:     data.id,
    orgId:       data.org_id,
    userId:      data.user_id,
    permissions: data.permissions as string[],
  };
}

// Extract a 64-hex token embedded in the request path (the "token-in-URL" flow).
export function tokenFromPath(req: Request): string | null {
  const HEX64 = /^\/([0-9a-f]{64})(\/|$)/i;
  const m = new URL(req.url).pathname.match(HEX64);
  return m ? m[1] : null;
}
