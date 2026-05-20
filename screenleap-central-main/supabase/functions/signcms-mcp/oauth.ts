// OAuth 2.0 Authorization Code + PKCE endpoints for Claude.ai MCP connector.
//
// Routes handled by this module:
//   GET  /.well-known/oauth-protected-resource    (RFC 9728)
//   GET  /.well-known/oauth-authorization-server  (RFC 8414)
//   GET  /.well-known/openid-configuration        (OIDC fallback)
//   POST /register                                (Dynamic Client Registration RFC 7591)
//   GET  /oauth/authorize                         (interactive or token-in-path/query fast path)
//   POST /oauth/authorize                         (form submit → 302 to client callback)
//   POST /oauth/token                             (authorization_code grant exchange)
//
// All endpoints validate against `public.mcp_tokens`; the raw MCP token acts
// as both the authorization code AND the resulting access_token (deliberate
// — the token already has an expiry and per-org scope).

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { CORS, json, htmlResponse, sha256hex } from "./shared.ts";
import { tokenFromPath } from "./auth.ts";

// Supabase edge functions are called via an internal URL that strips
// /functions/v1. Always reconstruct the canonical HTTPS public URL.
// If the user added a token in the path (e.g. /signcms-mcp/{64-hex-token}),
// include it in the base so all OAuth discovery URLs carry the same token prefix.
export function getMcpBase(req: Request): string {
  const parsed  = new URL(req.url);
  const host    = parsed.host;
  const HEX64   = /^\/([0-9a-f]{64})(\/|$)/i;
  const m       = parsed.pathname.match(HEX64);
  const token   = m ? `/${m[1]}` : "";
  return `https://${host}/functions/v1/signcms-mcp${token}`;
}

interface AuthorizePageParams {
  base: string; redirectUri: string; state: string;
  clientId: string; codeChallenge: string; error?: string;
}

function authorizePageHtml(params: AuthorizePageParams): string {
  const esc = (s: string) => s.replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return `<!DOCTYPE html>
<html lang="zh-TW">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>SignCMS — 授權 MCP 連線</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:system-ui,-apple-system,sans-serif;background:#0f172a;color:#f1f5f9;display:flex;align-items:center;justify-content:center;min-height:100vh;padding:16px}
.card{background:#1e293b;border-radius:16px;padding:36px 32px;max-width:420px;width:100%;box-shadow:0 8px 32px rgba(0,0,0,.5)}
.logo{font-size:1.5rem;font-weight:700;color:#38bdf8;margin-bottom:8px}
.sub{font-size:.875rem;color:#94a3b8;margin-bottom:28px;line-height:1.5}
label{display:block;font-size:.8rem;color:#94a3b8;font-weight:500;margin-bottom:6px;text-transform:uppercase;letter-spacing:.05em}
input{width:100%;padding:11px 14px;border:1.5px solid #334155;border-radius:10px;background:#0f172a;color:#f1f5f9;font-size:.875rem;font-family:monospace;transition:border .15s}
input:focus{outline:none;border-color:#38bdf8}
.hint{font-size:.75rem;color:#64748b;margin-top:8px;line-height:1.4}
btn{display:block;width:100%;padding:12px;background:#38bdf8;color:#0f172a;border:none;border-radius:10px;font-size:.9rem;font-weight:700;cursor:pointer;margin-top:20px;transition:background .15s}
button:hover{background:#7dd3fc}
.err{color:#f87171;background:#450a0a30;border:1px solid #f8717140;padding:10px 14px;border-radius:8px;font-size:.85rem;margin-bottom:18px}
</style>
</head>
<body>
<div class="card">
  <div class="logo">📺 SignCMS</div>
  <p class="sub">Claude 正在請求存取您的 SignCMS 組織。<br>請輸入在「系統設定 → MCP 金鑰」產生的 Token。</p>
  ${params.error ? `<div class="err">⚠️ ${esc(params.error)}</div>` : ""}
  <form method="POST" action="${esc(params.base)}/oauth/authorize">
    <input type="hidden" name="redirect_uri"    value="${esc(params.redirectUri)}">
    <input type="hidden" name="state"           value="${esc(params.state)}">
    <input type="hidden" name="client_id"       value="${esc(params.clientId)}">
    <input type="hidden" name="code_challenge"  value="${esc(params.codeChallenge)}">
    <label>MCP Token</label>
    <input type="text" name="token" placeholder="貼上您的 MCP Token…" autocomplete="off" required autofocus>
    <p class="hint">Token 從 SignCMS 系統設定 → MCP 金鑰 分頁產生，僅顯示一次。</p>
    <button type="submit">✓ 授權連線</button>
  </form>
</div>
</body>
</html>`;
}

// ── Route handlers ─────────────────────────────────────────────────────────

export function handleProtectedResourceMetadata(req: Request): Response {
  const base = getMcpBase(req);
  return json({
    resource:              base,
    authorization_servers: [base],
    scopes_supported:      ["mcp"],
  });
}

export function handleAuthorizationServerMetadata(req: Request): Response {
  const base = getMcpBase(req);
  return json({
    issuer:                                base,
    authorization_endpoint:               `${base}/oauth/authorize`,
    token_endpoint:                        `${base}/oauth/token`,
    registration_endpoint:                 `${base}/register`,
    response_types_supported:             ["code"],
    grant_types_supported:                ["authorization_code"],
    code_challenge_methods_supported:     ["S256", "plain"],
    token_endpoint_auth_methods_supported: ["none"],
    scopes_supported:                     ["mcp"],
  });
}

export function handleOpenidConfiguration(req: Request): Response {
  const base = getMcpBase(req);
  return json({
    issuer:                                base,
    authorization_endpoint:               `${base}/oauth/authorize`,
    token_endpoint:                        `${base}/oauth/token`,
    registration_endpoint:                 `${base}/register`,
    response_types_supported:             ["code"],
    grant_types_supported:                ["authorization_code"],
    code_challenge_methods_supported:     ["S256", "plain"],
    token_endpoint_auth_methods_supported: ["none"],
    scopes_supported:                     ["mcp"],
    subject_types_supported:              ["public"],
    id_token_signing_alg_values_supported: ["RS256"],
  });
}

export async function handleDynamicClientRegistration(req: Request): Promise<Response> {
  const now = Math.floor(Date.now() / 1000);
  let regBody: Record<string, unknown> = {};
  try { regBody = await req.clone().json(); } catch { /* ignore parse errors */ }
  const redirectUris: string[] = Array.isArray(regBody.redirect_uris)
    ? regBody.redirect_uris as string[]
    : [];
  return json({
    client_id:                  crypto.randomUUID(),
    client_id_issued_at:        now,
    client_secret_expires_at:   0,
    token_endpoint_auth_method: "none",
    grant_types:                Array.isArray(regBody.grant_types)    ? regBody.grant_types    : ["authorization_code"],
    response_types:             Array.isArray(regBody.response_types) ? regBody.response_types : ["code"],
    redirect_uris:              redirectUris,
    ...(regBody.client_name ? { client_name: regBody.client_name } : {}),
    ...(regBody.scope       ? { scope:        regBody.scope       } : {}),
  }, 201);
}

export async function handleAuthorizeGet(req: Request, sb: SupabaseClient): Promise<Response> {
  const reqUrl       = new URL(req.url);
  const p            = reqUrl.searchParams;
  const redirectUri  = p.get("redirect_uri")   ?? "";
  const state        = p.get("state")          ?? "";
  const clientId     = p.get("client_id")      ?? "";
  const codeChallenge = p.get("code_challenge") ?? "";

  // Fast path A: token embedded in MCP server URL path.
  const pathToken  = tokenFromPath(req);
  // Fast path B: token appended as ?token= query param (manual link).
  const queryToken = (p.get("token") ?? "").trim();

  const autoToken  = pathToken ?? (queryToken || null);

  if (autoToken) {
    const hash = await sha256hex(autoToken);
    const { data: tokenRow } = await sb
      .from("mcp_tokens")
      .select("id, expires_at")
      .eq("token_hash", hash)
      .maybeSingle();

    if (!tokenRow || (tokenRow.expires_at && new Date(tokenRow.expires_at) < new Date())) {
      return json({
        error: "invalid_token",
        error_description: "MCP token invalid or expired. Regenerate in SignCMS → Settings → MCP Keys.",
      }, 400);
    }

    // Token valid → issue code = token, redirect to Claude.ai callback
    const redirectTo = new URL(redirectUri || "https://claude.ai/api/mcp/auth_callback");
    redirectTo.searchParams.set("code",  autoToken);
    redirectTo.searchParams.set("state", state);
    return new Response(null, {
      status:  302,
      headers: { ...CORS, Location: redirectTo.toString() },
    });
  }

  // Default: render the interactive token-entry form.
  return htmlResponse(authorizePageHtml({
    base: getMcpBase(req), redirectUri, state, clientId, codeChallenge,
  }));
}

export async function handleAuthorizePost(req: Request, sb: SupabaseClient): Promise<Response> {
  let formRedirectUri = "", formState = "", formClientId = "", formCodeChallenge = "", formToken = "";
  try {
    const ct = req.headers.get("content-type") ?? "";
    if (ct.includes("application/x-www-form-urlencoded")) {
      const fd = new URLSearchParams(await req.text());
      formRedirectUri   = fd.get("redirect_uri")   ?? "";
      formState         = fd.get("state")          ?? "";
      formClientId      = fd.get("client_id")      ?? "";
      formCodeChallenge = fd.get("code_challenge")  ?? "";
      formToken         = (fd.get("token") ?? "").trim();
    } else {
      const body = await req.json() as Record<string, string>;
      formRedirectUri   = body.redirect_uri   ?? "";
      formState         = body.state          ?? "";
      formClientId      = body.client_id      ?? "";
      formCodeChallenge = body.code_challenge ?? "";
      formToken         = (body.token ?? "").trim();
    }
  } catch {
    return htmlResponse(authorizePageHtml({
      base: getMcpBase(req), redirectUri: "", state: "", clientId: "", codeChallenge: "",
      error: "請求格式無效，請重試。",
    }), 400);
  }

  if (!formToken) {
    return htmlResponse(authorizePageHtml({
      base: getMcpBase(req), redirectUri: formRedirectUri, state: formState,
      clientId: formClientId, codeChallenge: formCodeChallenge, error: "請輸入 MCP Token。",
    }), 400);
  }

  // Validate token exists in DB
  const hash = await sha256hex(formToken);
  const { data: tokenRow } = await sb
    .from("mcp_tokens")
    .select("id, expires_at")
    .eq("token_hash", hash)
    .maybeSingle();

  if (!tokenRow) {
    return htmlResponse(authorizePageHtml({
      base: getMcpBase(req), redirectUri: formRedirectUri, state: formState,
      clientId: formClientId, codeChallenge: formCodeChallenge, error: "Token 無效，請確認後重試。",
    }), 400);
  }
  if (tokenRow.expires_at && new Date(tokenRow.expires_at) < new Date()) {
    return htmlResponse(authorizePageHtml({
      base: getMcpBase(req), redirectUri: formRedirectUri, state: formState,
      clientId: formClientId, codeChallenge: formCodeChallenge, error: "Token 已過期，請重新產生。",
    }), 400);
  }

  // Issue auth code = raw token (transported securely over HTTPS)
  const redirectTo = new URL(formRedirectUri);
  redirectTo.searchParams.set("code",  formToken);
  redirectTo.searchParams.set("state", formState);
  return new Response(null, {
    status:  302,
    headers: { ...CORS, Location: redirectTo.toString() },
  });
}

export async function handleTokenExchange(req: Request, sb: SupabaseClient): Promise<Response> {
  let grantType = "", code = "";
  try {
    const ct = req.headers.get("content-type") ?? "";
    if (ct.includes("application/x-www-form-urlencoded")) {
      const fd = new URLSearchParams(await req.text());
      grantType = fd.get("grant_type") ?? "";
      code      = (fd.get("code") ?? "").trim();
    } else {
      const body = await req.json() as Record<string, string>;
      grantType = body.grant_type ?? "";
      code      = (body.code ?? "").trim();
    }
  } catch {
    return json({ error: "invalid_request" }, 400);
  }

  if (grantType !== "authorization_code") {
    return json({ error: "unsupported_grant_type" }, 400);
  }
  if (!code) {
    return json({ error: "invalid_request", error_description: "missing code" }, 400);
  }

  // Validate code (= MCP token)
  const hash = await sha256hex(code);
  const { data: tokenRow } = await sb
    .from("mcp_tokens")
    .select("id, expires_at")
    .eq("token_hash", hash)
    .maybeSingle();

  if (!tokenRow || (tokenRow.expires_at && new Date(tokenRow.expires_at) < new Date())) {
    return json({ error: "invalid_grant" }, 400);
  }

  // Touch last_used_at
  sb.from("mcp_tokens").update({ last_used_at: new Date().toISOString() })
    .eq("id", tokenRow.id).then(() => {});

  return json({
    access_token: code,            // The MCP token is used directly as access_token
    token_type:   "Bearer",
    expires_in:   365 * 24 * 3600, // 1 year (matches MCP token lifetime)
  });
}
