// queue-system: external REST API for kiosk / POS integrations + LINE LIFF.
//
// Auth model (two layers):
//   Layer 1 — Supabase platform: every request must carry
//             `Authorization: Bearer <anon_key_or_service_role_key>`
//             This is enforced by the Supabase Edge Function runtime BEFORE
//             our handler runs. Callers without this header receive:
//             {"code":"UNAUTHORIZED_NO_AUTH_HEADER",...} from the platform.
//
//   Layer 2 — HMAC business logic (POST /call-next and POST /reset only):
//             The request body must include { ..., sig, ts, exp } where sig
//             is HMAC-SHA256 of the canonicalised payload using the org's
//             api_secret from queue_system_configs.
//
// Routes:
//   GET  /queue-system/status         query: org_id, queue_id
//                                     → only anon key needed (read-only)
//   POST /queue-system/call-next      body: { org_id, queue_id, counter, ts, exp, sig }
//   POST /queue-system/reset          body: { org_id, queue_id, ts, exp, sig }
//   POST /queue-system/issue-ticket   body: { queue_id, line_uid? }  — anon key only
//   POST /queue-system/join-ticket    body: { ticket_id, share_token, line_uid }
//   POST /queue-system/notify-calling body: { ticket_id }            — fire-and-forget LINE push
//
// The "exp" field (Unix seconds) must be ≥ now(); replay window is 5 min.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

// Standard Supabase Edge Function CORS headers — must include `authorization`
// so browser preflight passes when called from frontend code.
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-signcms-signature",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// Deterministic JSON serialisation (keys sorted recursively).
function canonicalize(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value))
    return "[" + (value as unknown[]).map(canonicalize).join(",") + "]";
  const keys = Object.keys(value as Record<string, unknown>).sort();
  return (
    "{" +
    keys
      .map(
        (k) =>
          JSON.stringify(k) +
          ":" +
          canonicalize((value as Record<string, unknown>)[k]),
      )
      .join(",") +
    "}"
  );
}

function toBase64Url(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function hmacVerify(
  secret: string,
  payload: Record<string, unknown>,
  sig: string,
): Promise<boolean> {
  const keyBytes = new TextEncoder().encode(secret);
  const key = await crypto.subtle.importKey(
    "raw",
    keyBytes,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const data = new TextEncoder().encode(canonicalize(payload));
  const raw = await crypto.subtle.sign("HMAC", key, data);
  return toBase64Url(new Uint8Array(raw)) === sig;
}

async function resolveSecret(
  sbService: ReturnType<typeof createClient>,
  orgId: string,
): Promise<string | null> {
  const { data } = await sbService
    .from("queue_system_configs")
    .select("api_secret")
    .eq("org_id", orgId)
    .maybeSingle();
  return data?.api_secret ?? null;
}

// Verifies HMAC signature on POST body payloads.
// Returns { ok: true } on success, or an error Response.
async function verifyHmac(
  sbService: ReturnType<typeof createClient>,
  params: Record<string, unknown>,
): Promise<{ ok: true } | Response> {
  const { sig, ...rest } = params;
  if (typeof sig !== "string") return json({ error: "sig required" }, 400);

  const orgId = rest["org_id"];
  if (typeof orgId !== "string") return json({ error: "org_id required" }, 400);

  const exp = rest["exp"];
  if (typeof exp !== "number" || exp < Math.floor(Date.now() / 1000)) {
    return json({ error: "expired or missing exp" }, 401);
  }

  const secret = await resolveSecret(sbService, orgId);
  if (!secret) return json({ error: "org not configured — run app setup first" }, 404);

  const valid = await hmacVerify(secret, rest as Record<string, unknown>, sig);
  if (!valid) return json({ error: "invalid signature" }, 403);

  return { ok: true };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const url = new URL(req.url);
  const route = url.pathname.replace(/.*\/queue-system/, "");

  // Use service role for all DB operations so RLS does not block edge function access.
  const sbService = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // ── GET /status ────────────────────────────────────────────────────────────
  // Read-only: only requires Supabase anon key (Layer 1).
  // No HMAC needed — the platform JWT check is sufficient for a public status query.
  if (req.method === "GET" && route === "/status") {
    const queueId = url.searchParams.get("queue_id");
    const orgId = url.searchParams.get("org_id");

    if (!queueId || !orgId) {
      return json({ error: "org_id and queue_id query params required" }, 400);
    }

    const { data: queue } = await sbService
      .from("queue_system_queues")
      .select("id, queue_name, prefix, current_number")
      .eq("id", queueId)
      .eq("org_id", orgId)
      .maybeSingle();

    if (!queue) return json({ error: "queue not found" }, 404);

    const { count } = await sbService
      .from("queue_system_tickets")
      .select("id", { count: "exact", head: true })
      .eq("queue_id", queue.id)
      .eq("status", "waiting");

    return json({
      queueId: queue.id,
      queueName: queue.queue_name,
      prefix: queue.prefix,
      currentNumber: queue.current_number,
      waitingCount: count ?? 0,
    });
  }

  // ── POST endpoints — require HMAC (Layer 2) in addition to anon key ────────
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ error: "invalid JSON body" }, 400);
  }

  // ── POST /call-next ────────────────────────────────────────────────────────
  if (route === "/call-next") {
    const check = await verifyHmac(sbService, body);
    if (check instanceof Response) return check;

    const queueId = body["queue_id"];
    const counter = typeof body["counter"] === "string" ? body["counter"] : "";
    if (typeof queueId !== "string") return json({ error: "queue_id required" }, 400);

    const { data: ticket, error } = await sbService.rpc("queue_call_next", {
      p_queue_id: queueId,
      p_counter: counter,
    });

    if (error) {
      if (error.message.includes("queue_not_found"))
        return json({ error: "queue not found" }, 404);
      return json({ error: error.message }, 500);
    }

    return json({ ok: true, ticket });
  }

  // ── POST /reset ────────────────────────────────────────────────────────────
  if (route === "/reset") {
    const check = await verifyHmac(sbService, body);
    if (check instanceof Response) return check;

    const queueId = body["queue_id"];
    if (typeof queueId !== "string") return json({ error: "queue_id required" }, 400);

    const { error } = await sbService.rpc("queue_reset", { p_queue_id: queueId });
    if (error) return json({ error: error.message }, 500);

    return json({ ok: true });
  }

  // ── POST /issue-ticket ─────────────────────────────────────────────────────
  // LIFF / kiosk: issue a waiting ticket. Anon key sufficient (no HMAC).
  // If line_uid supplied: idempotent — returns existing waiting ticket for UID.
  if (route === "/issue-ticket") {
    const queueId = body["queue_id"];
    const lineUid = typeof body["line_uid"] === "string" ? body["line_uid"] : null;
    if (typeof queueId !== "string") return json({ error: "queue_id required" }, 400);

    const { data: ticket, error } = await sbService.rpc("queue_issue_liff_ticket", {
      p_queue_id: queueId,
      p_line_uid: lineUid,
    });

    if (error) {
      if (error.message.includes("queue_not_found"))
        return json({ error: "queue not found" }, 404);
      return json({ error: error.message }, 500);
    }

    const t = ticket as { id: string; number: number; share_token: string; queue_id: string };

    // Resolve prefix for display
    const { data: queue } = await sbService
      .from("queue_system_queues")
      .select("prefix")
      .eq("id", queueId)
      .maybeSingle();

    return json({
      ok: true,
      ticketId: t.id,
      number: t.number,
      shareToken: t.share_token,
      prefix: queue?.prefix ?? "",
    });
  }

  // ── POST /join-ticket ──────────────────────────────────────────────────────
  // LIFF friend share: append line_uid to an existing ticket's line_member_ids.
  if (route === "/join-ticket") {
    const ticketId   = body["ticket_id"];
    const shareToken = body["share_token"];
    const lineUid    = body["line_uid"];

    if (
      typeof ticketId   !== "string" ||
      typeof shareToken !== "string" ||
      typeof lineUid    !== "string"
    ) {
      return json({ error: "ticket_id, share_token, and line_uid required" }, 400);
    }

    const { data: ticket } = await sbService
      .from("queue_system_tickets")
      .select("id, share_token, line_member_ids, number, status")
      .eq("id", ticketId)
      .maybeSingle();

    if (!ticket) return json({ error: "ticket not found" }, 404);
    if ((ticket as { share_token: string }).share_token !== shareToken) {
      return json({ error: "invalid share token" }, 403);
    }

    const members: string[] = (ticket as { line_member_ids: string[] }).line_member_ids ?? [];
    if (!members.includes(lineUid)) {
      members.push(lineUid);
      await sbService
        .from("queue_system_tickets")
        .update({ line_member_ids: members })
        .eq("id", ticketId);
    }

    return json({ ok: true, number: (ticket as { number: number }).number, status: (ticket as { status: string }).status });
  }

  // ── POST /notify-calling ───────────────────────────────────────────────────
  // Called by QueueControlPanel after call-next.  Fires LINE Multicast to the
  // ticket owner + members, then returns 200 immediately.
  if (route === "/notify-calling") {
    const ticketId = body["ticket_id"];
    if (typeof ticketId !== "string") return json({ error: "ticket_id required" }, 400);

    const channelToken = Deno.env.get("LINE_CHANNEL_ACCESS_TOKEN");
    if (!channelToken) return json({ ok: true, skipped: "no LINE token configured" });

    const { data: ticket } = await sbService
      .from("queue_system_tickets")
      .select("number, counter_name, line_owner_id, line_member_ids, queue_id")
      .eq("id", ticketId)
      .maybeSingle();

    if (!ticket) return json({ error: "ticket not found" }, 404);

    const t = ticket as {
      number: number;
      counter_name: string;
      line_owner_id: string | null;
      line_member_ids: string[];
      queue_id: string;
    };

    const recipients = [
      ...(t.line_owner_id ? [t.line_owner_id] : []),
      ...(t.line_member_ids ?? []),
    ].filter(Boolean);

    if (recipients.length === 0) return json({ ok: true, skipped: "no recipients" });

    const { data: queue } = await sbService
      .from("queue_system_queues")
      .select("prefix, queue_name")
      .eq("id", t.queue_id)
      .maybeSingle();

    const prefix     = (queue as { prefix: string } | null)?.prefix ?? "";
    const queueName  = (queue as { queue_name: string } | null)?.queue_name ?? "";
    const numStr     = `${prefix}${String(t.number).padStart(3, "0")}`;
    const counterStr = t.counter_name || "服務台";

    const flexMessage = {
      type: "flex",
      altText: `叫號通知：${numStr} 請前往 ${counterStr}`,
      contents: {
        type: "bubble",
        body: {
          type: "box",
          layout: "vertical",
          contents: [
            { type: "text", text: queueName || "排隊叫號", weight: "bold", size: "sm", color: "#6B7280" },
            { type: "text", text: numStr, weight: "bold", size: "5xl", color: "#1D4ED8", align: "center", margin: "md" },
            { type: "text", text: `請前往 ${counterStr}`, size: "md", color: "#374151", align: "center", margin: "sm" },
          ],
        },
      },
    };

    const sendNotify = async () => {
      for (let i = 0; i < recipients.length; i += 500) {
        const chunk = recipients.slice(i, i + 500);
        await fetch("https://api.line.me/v2/bot/message/multicast", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${channelToken}`,
          },
          body: JSON.stringify({ to: chunk, messages: [flexMessage] }),
        });
      }
    };

    // @ts-expect-error — EdgeRuntime available in Supabase Deno runtime
    if (typeof EdgeRuntime !== "undefined") {
      // @ts-expect-error — EdgeRuntime.waitUntil is a Supabase Deno extension
      EdgeRuntime.waitUntil(sendNotify());
    } else {
      await sendNotify();
    }

    return json({ ok: true });
  }

  return json({ error: "not found" }, 404);
});
