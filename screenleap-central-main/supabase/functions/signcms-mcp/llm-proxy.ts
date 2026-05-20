// LLM proxy endpoint for the SignCMS Go PWA — POST /llm.
//
// The browser cannot call api.anthropic.com directly (CORS); this endpoint
// authenticates with the same MCP token bearer and forwards a streaming
// request. Currently only the Anthropic Messages API is wired up; the
// provider switch is left open for future OpenAI / etc. support.

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { CORS, json, rpcError } from "./shared.ts";
import { authenticate } from "./auth.ts";

export async function handleLlmProxy(req: Request, sb: SupabaseClient): Promise<Response> {
  const proxyClaims = await authenticate(req.headers.get("authorization"), sb);
  if (!proxyClaims) return rpcError(null, -32001, "Unauthorized");

  let proxyBody: Record<string, unknown>;
  try { proxyBody = await req.json(); } catch { return json({ error: "Parse error" }, 400); }

  const { provider, api_key, model, messages, system, tools } = proxyBody as {
    provider: string;
    api_key:  string;
    model:    string;
    messages: unknown[];
    system?:  string;
    tools?:   unknown[];
  };

  if (!provider || !api_key || !model || !messages) {
    return json({ error: "Missing required fields: provider, api_key, model, messages" }, 400);
  }

  if (provider === "anthropic") {
    const upstream: Record<string, unknown> = {
      model,
      max_tokens: 4096,
      stream:     true,
      messages,
    };
    if (system)        upstream.system = system;
    if (tools?.length) upstream.tools  = tools;

    const upstreamRes = await fetch("https://api.anthropic.com/v1/messages", {
      method:  "POST",
      headers: {
        "Content-Type":      "application/json",
        "x-api-key":         api_key,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(upstream),
    });

    if (!upstreamRes.ok) {
      return new Response(await upstreamRes.text(), {
        status:  upstreamRes.status,
        headers: { ...CORS, "Content-Type": "text/plain" },
      });
    }

    return new Response(upstreamRes.body, {
      headers: { ...CORS, "Content-Type": "text/event-stream", "Cache-Control": "no-cache" },
    });
  }

  return json({ error: `Unsupported provider: ${provider}` }, 400);
}
