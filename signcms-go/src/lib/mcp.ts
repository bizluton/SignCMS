import type { MCPConfig, MCPToolCall, MCPToolResult } from "@/types";

let _reqId = 1;

export interface MCPTool {
  name:        string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export class MCPClient {
  constructor(private cfg: MCPConfig) {}

  private async rpc(method: string, params: Record<string, unknown>): Promise<unknown> {
    const res = await fetch(this.cfg.serverUrl, {
      method:  "POST",
      headers: {
        "Content-Type":  "application/json",
        Authorization:   `Bearer ${this.cfg.token}`,
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: _reqId++, method, params }),
    });

    const data = await res.json();
    if (data.error) throw new Error(data.error.message ?? String(data.error));
    return data.result;
  }

  async initialize(): Promise<void> {
    await this.rpc("initialize", {});
  }

  async listTools(): Promise<MCPTool[]> {
    const result = await this.rpc("tools/list", {}) as { tools: MCPTool[] };
    return result.tools;
  }

  async callTool(call: MCPToolCall): Promise<MCPToolResult> {
    const result = await this.rpc("tools/call", {
      name:      call.name,
      arguments: call.arguments,
    }) as MCPToolResult;
    return result;
  }

  /**
   * Test connectivity AND auth by sending an initialize RPC.
   * GET / returns 200 without a token, so we must use POST to verify the Bearer token.
   */
  async ping(): Promise<boolean> {
    try {
      await this.rpc("initialize", {
        protocolVersion: "2024-11-05",
        capabilities:    {},
        clientInfo:      { name: "signcms-go", version: "1.0" },
      });
      return true;
    } catch {
      return false;
    }
  }
}

export function makeMCPClient(cfg: MCPConfig): MCPClient {
  return new MCPClient(cfg);
}
