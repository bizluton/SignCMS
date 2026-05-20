// Shared primitives for the signcms-mcp edge function.
// CORS / JSON / JSON-RPC response shapes / SHA-256 helper.
//
// Kept in its own file because every other module (auth, oauth, tools,
// llm-proxy, the Deno.serve handler) needs them. Importing from index.ts
// would create cycles.

export const CORS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
};

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

export function rpcError(id: unknown, code: number, message: string): Response {
  return json({ jsonrpc: "2.0", id, error: { code, message } });
}

export function rpcOk(id: unknown, result: unknown): Response {
  return json({ jsonrpc: "2.0", id, result });
}

export async function sha256hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function htmlResponse(body: string, status = 200): Response {
  return new Response(body, {
    status,
    headers: { ...CORS, "Content-Type": "text/html; charset=utf-8" },
  });
}
