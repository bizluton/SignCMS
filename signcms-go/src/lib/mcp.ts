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

  async ping(): Promise<boolean> {
    try {
      const res = await fetch(this.cfg.serverUrl, { method: "GET" });
      return res.ok;
    } catch {
      return false;
    }
  }
}

export function makeMCPClient(cfg: MCPConfig): MCPClient {
  return new MCPClient(cfg);
}
