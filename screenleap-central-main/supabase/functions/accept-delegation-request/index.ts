import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

import { corsHeaders, corsPreflight } from "../_shared/cors.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return corsPreflight(req);

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Missing auth" }), {
        status: 401,
        headers: { ...corsHeaders(req), "Content-Type": "application/json" },
      });
    }

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
    const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData?.user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders(req), "Content-Type": "application/json" },
      });
    }
    const user = userData.user;

    const body = await req.json().catch(() => ({}));
    const { request_id, action } = body as { request_id?: string; action?: "accept" | "decline" };
    if (!request_id || !action || !["accept", "decline"].includes(action)) {
      return new Response(JSON.stringify({ error: "Invalid params" }), {
        status: 400,
        headers: { ...corsHeaders(req), "Content-Type": "application/json" },
      });
    }

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE);

    // Load request
    const { data: reqRow, error: reqErr } = await admin
      .from("delegation_requests")
      .select("*")
      .eq("id", request_id)
      .maybeSingle();
    if (reqErr || !reqRow) {
      return new Response(JSON.stringify({ error: "Request not found" }), {
        status: 404,
        headers: { ...corsHeaders(req), "Content-Type": "application/json" },
      });
    }
    if (reqRow.customer_id !== user.id) {
      return new Response(JSON.stringify({ error: "Forbidden" }), {
        status: 403,
        headers: { ...corsHeaders(req), "Content-Type": "application/json" },
      });
    }
    if (reqRow.status !== "pending") {
      return new Response(JSON.stringify({ error: "Already resolved" }), {
        status: 409,
        headers: { ...corsHeaders(req), "Content-Type": "application/json" },
      });
    }
    if (reqRow.customer_id === reqRow.requester_id) {
      return new Response(
        JSON.stringify({ error: "客戶與客服為同一帳號，無法建立代理授權（請改用其他帳號測試）" }),
        { status: 400, headers: { ...corsHeaders(req), "Content-Type": "application/json" } },
      );
    }

    if (action === "decline") {
      await admin
        .from("delegation_requests")
        .update({ status: "declined", resolved_at: new Date().toISOString() })
        .eq("id", request_id);

      // System message in chat
      await admin.from("customer_chat_messages").insert({
        session_id: reqRow.session_id,
        sender_type: "system",
        sender_name: "系統",
        content: "客戶已婉拒代理授權請求。",
      });

      // Notify the agent
      await admin.from("notifications").insert({
        user_id: reqRow.requester_id,
        type: "delegation_request",
        title: "代理授權請求被婉拒",
        body: "客戶已婉拒您的代理授權請求",
        link: "/customer-service",
        created_by: user.id,
      });

      return new Response(JSON.stringify({ ok: true, status: "declined" }), {
        headers: { ...corsHeaders(req), "Content-Type": "application/json" },
      });
    }

    // Accept: create delegation_grants row (grantor=customer, grantee=cs agent)
    const expires = new Date(Date.now() + reqRow.hours * 3600_000).toISOString();
    const { data: grant, error: grantErr } = await admin
      .from("delegation_grants")
      .insert({
        grantor_id: reqRow.customer_id,
        grantee_id: reqRow.requester_id,
        grantee_scope: "cs_agent",
        reason: reqRow.reason || `客戶於對話中授權 (${reqRow.hours}h)`,
        expires_at: expires,
        status: "active",
      })
      .select()
      .single();

    if (grantErr || !grant) {
      return new Response(JSON.stringify({ error: grantErr?.message || "Grant failed" }), {
        status: 500,
        headers: { ...corsHeaders(req), "Content-Type": "application/json" },
      });
    }

    await admin
      .from("delegation_requests")
      .update({ status: "accepted", grant_id: grant.id, resolved_at: new Date().toISOString() })
      .eq("id", request_id);

    await admin.from("customer_chat_messages").insert({
      session_id: reqRow.session_id,
      sender_type: "system",
      sender_name: "系統",
      content: `客戶已同意代理授權，有效 ${reqRow.hours} 小時。`,
    });

    await admin.from("notifications").insert({
      user_id: reqRow.requester_id,
      type: "delegation_request",
      title: "代理授權已通過",
      body: `客戶已同意您的代理授權請求 (${reqRow.hours} 小時)`,
      link: "/customer-service",
      created_by: user.id,
    });

    return new Response(JSON.stringify({ ok: true, status: "accepted", grant_id: grant.id }), {
      headers: { ...corsHeaders(req), "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500,
      headers: { ...corsHeaders(req), "Content-Type": "application/json" },
    });
  }
});
