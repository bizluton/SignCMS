// signcms-mcp: MCP Server for SignCMS Go PWA
// Implements JSON-RPC 2.0 over HTTP with the Model Context Protocol.
//
// Authentication: Bearer <mcp_token> (raw token, hashed to SHA-256 for DB lookup)
// CORS: open (PWA calls from any origin)
//
// Supported methods:
//   initialize          — MCP handshake
//   tools/list          — list all available tools
//   tools/call          — execute a tool
//
// Tools (22 total): see tools.ts > TOOL_DEFS
//
// This file is now a thin route dispatcher. The previous monolith (~1430
// lines) is split into:
//   shared.ts     — CORS / JSON / SHA-256 / JSON-RPC response shapes
//   auth.ts       — MCP token authentication
//   oauth.ts      — OAuth 2.0 endpoints for Claude.ai MCP connector
//   tools.ts      — Tool registry + executeTool dispatch + audit log writer
//   llm-proxy.ts  — POST /llm streaming proxy to Anthropic / etc.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { CORS, json, rpcError, rpcOk } from "./shared.ts";
import { authenticate } from "./auth.ts";
import {
  getMcpBase,
  handleProtectedResourceMetadata,
  handleAuthorizationServerMetadata,
  handleOpenidConfiguration,
  handleDynamicClientRegistration,
  handleAuthorizeGet,
  handleAuthorizePost,
  handleTokenExchange,
} from "./oauth.ts";
import { TOOL_DEFS, executeTool, writeAudit } from "./tools.ts";
import { handleLlmProxy } from "./llm-proxy.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });

  const reqUrl  = new URL(req.url);
  const reqPath = reqUrl.pathname;
  const method  = req.method;

  // Lazily created service client (only when needed for DB access)
  const sbService = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // ══════════════════════════════════════════════════════════════════════════
  // OAuth 2.0 (Authorization Code + PKCE) — for Claude.ai web connector
  // ══════════════════════════════════════════════════════════════════════════

  if (reqPath.includes("/.well-known/oauth-protected-resource")) {
    return handleProtectedResourceMetadata(req);
  }

  if (reqPath.includes("/.well-known/oauth-authorization-server")) {
    return handleAuthorizationServerMetadata(req);
  }

  if (method === "GET" && reqPath.includes("/.well-known/openid-configuration")) {
    return handleOpenidConfiguration(req);
  }

  if (method === "POST" && reqPath.endsWith("/register")) {
    return handleDynamicClientRegistration(req);
  }

  if (method === "GET" && reqPath.endsWith("/oauth/authorize")) {
    return handleAuthorizeGet(req, sbService);
  }

  if (method === "POST" && reqPath.endsWith("/oauth/authorize")) {
    return handleAuthorizePost(req, sbService);
  }

  if (method === "POST" && reqPath.endsWith("/oauth/token")) {
    return handleTokenExchange(req, sbService);
  }

  // ══════════════════════════════════════════════════════════════════════════
  // MCP / utility routes
  // ══════════════════════════════════════════════════════════════════════════

  if (method !== "POST" && method !== "GET") {
    return json({ error: "Method not allowed" }, 405);
  }

  // GET / → capability discovery
  if (method === "GET") {
    return json({
      name:        "signcms-mcp",
      version:     "1.0.0",
      description: "SignCMS MCP Server — Digital Signage Management Tools",
      tools_count: TOOL_DEFS.length,
    });
  }

  // POST /llm → LLM proxy (bypasses browser CORS for Anthropic/etc.)
  if (method === "POST" && reqPath.endsWith("/llm")) {
    return handleLlmProxy(req, sbService);
  }

  // ── Authenticate for JSON-RPC ─────────────────────────────────────────────
  // Return HTTP 401 (not 200) so Claude triggers the OAuth flow instead of
  // treating auth failure as "server unreachable".
  const claims = await authenticate(req.headers.get("authorization"), sbService);
  if (!claims) {
    const base = getMcpBase(req);
    return new Response(JSON.stringify({ error: "unauthorized", error_description: "Valid MCP token required" }), {
      status: 401,
      headers: {
        ...CORS,
        "Content-Type": "application/json",
        "WWW-Authenticate": `Bearer realm="${base}", resource_metadata="${base}/.well-known/oauth-protected-resource"`,
      },
    });
  }

  // ── Parse JSON-RPC body ───────────────────────────────────────────────────
  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return rpcError(null, -32700, "Parse error"); }

  if (body.jsonrpc !== "2.0") return rpcError(body.id, -32600, "Invalid JSON-RPC version");
  const rpcMethod = body.method as string;
  const params    = (body.params as Record<string, unknown>) || {};
  const id        = body.id;

  // ── Method dispatch ───────────────────────────────────────────────────────
  if (rpcMethod === "initialize") {
    return rpcOk(id, {
      protocolVersion: "2024-11-05",
      serverInfo:      { name: "signcms-mcp", version: "1.0.0" },
      capabilities:    { tools: { listChanged: false } },
      instructions:    "You are a SignCMS digital signage management assistant. Use tools to read screen status, switch content, and publish channels. Always confirm before bulk-switching all screens.",
    });
  }

  if (rpcMethod === "tools/list") {
    return rpcOk(id, { tools: TOOL_DEFS });
  }

  if (rpcMethod === "tools/call") {
    const toolName = params.name as string;
    const toolArgs = (params.arguments as Record<string, unknown>) || {};
    if (!toolName) return rpcError(id, -32602, "Missing tool name");

    const knownTool = TOOL_DEFS.find((t) => t.name === toolName);
    if (!knownTool) return rpcError(id, -32602, `Unknown tool: ${toolName}`);

    const t0 = Date.now();
    try {
      const result = await executeTool(toolName, toolArgs, claims, sbService);
      const ms     = Date.now() - t0;
      writeAudit(sbService, claims, toolName, toolArgs, result, ms);
      return rpcOk(id, {
        content: [{ type: "text", text: JSON.stringify(result) }],
      });
    } catch (err: unknown) {
      const msg = err instanceof Error
        ? err.message
        : (err as { message?: string })?.message ?? String(err);
      writeAudit(sbService, claims, toolName, toolArgs, { error: msg }, Date.now() - t0);
      return rpcError(id, -32603, msg);
    }
  }

  return rpcError(id, -32601, `Method not found: ${rpcMethod}`);
});
