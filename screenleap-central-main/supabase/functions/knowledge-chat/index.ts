import { createClient } from "https://esm.sh/@supabase/supabase-js@2.99.3";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const MODEL = "claude-haiku-4-5-20251001";
const ANTHROPIC_API = "https://api.anthropic.com/v1/messages";
const MAX_TOKENS = 1024;

/**
 * Converts Anthropic's SSE stream to OpenAI-compatible SSE format
 * so the existing frontend (knowledgeChat.ts) needs no changes.
 *
 * Anthropic delta events:
 *   event: content_block_delta
 *   data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"..."}}
 *
 * OpenAI delta events (what frontend expects):
 *   data: {"choices":[{"delta":{"content":"..."}}]}
 *   data: [DONE]
 */
function anthropicToOpenAIStream(anthropicBody: ReadableStream<Uint8Array>): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  let buffer = "";

  return new ReadableStream({
    async start(controller) {
      const reader = anthropicBody.getReader();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });

          let newlineIdx: number;
          while ((newlineIdx = buffer.indexOf("\n")) !== -1) {
            const line = buffer.slice(0, newlineIdx).replace(/\r$/, "");
            buffer = buffer.slice(newlineIdx + 1);

            if (!line.startsWith("data: ")) continue;
            const jsonStr = line.slice(6).trim();
            if (!jsonStr) continue;

            let event: any;
            try { event = JSON.parse(jsonStr); } catch { continue; }

            if (event.type === "content_block_delta" && event.delta?.type === "text_delta") {
              const chunk = JSON.stringify({ choices: [{ delta: { content: event.delta.text } }] });
              controller.enqueue(encoder.encode(`data: ${chunk}\n\n`));
            } else if (event.type === "message_stop" || event.delta?.stop_reason) {
              controller.enqueue(encoder.encode("data: [DONE]\n\n"));
            }
          }
        }
        // Emit DONE if stream ended without a message_stop event
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      } catch (err) {
        controller.error(err);
      } finally {
        reader.releaseLock();
        controller.close();
      }
    },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");

    if (!ANTHROPIC_API_KEY) {
      console.error("ANTHROPIC_API_KEY is not configured");
      return json({ error: "AI 服務尚未設定，請聯繫管理員" }, 500);
    }

    // Authenticate user
    const authHeader = req.headers.get("authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return json({ error: "Unauthorized" }, 401);
    }

    const anonClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const token = authHeader.replace("Bearer ", "");
    const { data: claimsData, error: claimsError } = await anonClient.auth.getClaims(token);
    if (claimsError || !claimsData?.claims) {
      return json({ error: "Unauthorized" }, 401);
    }

    const { messages } = await req.json();

    // Fetch knowledge base content for context
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const { data: knowledgeItems } = await supabase
      .from("knowledge_items")
      .select("title, description, category, sub_category")
      .eq("synced", true)
      .limit(50);

    let knowledgeContext = "";
    if (knowledgeItems && knowledgeItems.length > 0) {
      knowledgeContext = knowledgeItems
        .map((item: any) => `【${item.title}】(${item.sub_category})\n${item.description}`)
        .join("\n\n");
    }

    const systemPrompt = `你是一個專業的客戶服務 AI 助手，隸屬於 SignCMS Enterprise 數位看板管理平台。

你的職責：
- 根據知識庫內容，準確回答客戶關於產品使用、操作流程、故障排除等問題
- 回答要簡潔明瞭，使用繁體中文
- 如果知識庫中沒有相關資訊，誠實告知客戶並建議轉接真人客服
- 保持友善、專業的語氣
- 適當使用條列式說明步驟

以下是目前已同步的知識庫內容，請根據這些知識回答客戶問題：

${knowledgeContext || "（目前知識庫尚無內容）"}`;

    // Call Anthropic Messages API with streaming
    const response = await fetch(ANTHROPIC_API, {
      method: "POST",
      headers: {
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: MAX_TOKENS,
        system: systemPrompt,
        messages,
        stream: true,
      }),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      console.error("Anthropic API error:", response.status, body.slice(0, 300));
      if (response.status === 429) {
        return json({ error: "請求過於頻繁，請稍後再試" }, 429);
      }
      if (response.status === 402 || response.status === 403) {
        return json({ error: "AI 額度不足，請聯繫管理員" }, 402);
      }
      return json({ error: "AI 服務暫時無法使用" }, 500);
    }

    // Convert Anthropic SSE → OpenAI SSE so frontend needs no changes
    const openaiStream = anthropicToOpenAIStream(response.body!);

    return new Response(openaiStream, {
      headers: {
        ...corsHeaders,
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
      },
    });
  } catch (e) {
    console.error("knowledge-chat error:", e);
    return json({ error: "伺服器錯誤，請稍後再試" }, 500);
  }
});
