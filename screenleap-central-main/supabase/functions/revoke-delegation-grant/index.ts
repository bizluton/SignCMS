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
    const { grant_id } = body as { grant_id?: string };
    if (!grant_id) {
      return new Response(JSON.stringify({ error: "Invalid params" }), {
        status: 400,
        headers: { ...corsHeaders(req), "Content-Type": "application/json" },
      });
    }

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE);

    // Load grant
    const { data: grant, error: grantErr } = await admin
      .from("delegation_grants")
      .select("*")
      .eq("id", grant_id)
      .maybeSingle();
    if (grantErr || !grant) {
      return new Response(JSON.stringify({ error: "Grant not found" }), {
        status: 404,
        headers: { ...corsHeaders(req), "Content-Type": "application/json" },
      });
    }

    // Allow either grantee (agent ending own access) or grantor (customer revoking) to call
    if (grant.grantee_id !== user.id && grant.grantor_id !== user.id) {
      return new Response(JSON.stringify({ error: "Forbidden" }), {
        status: 403,
        headers: { ...corsHeaders(req), "Content-Type": "application/json" },
      });
    }
    if (grant.status !== "active") {
      return new Response(JSON.stringify({ error: "Grant is not active" }), {
        status: 409,
        headers: { ...corsHeaders(req), "Content-Type": "application/json" },
      });
    }

    // Determine new status: agent ending their own = 'ended', grantor revoking = 'revoked'
    const isAgentEnding = user.id === grant.grantee_id;
    const newStatus = isAgentEnding ? "ended" : "revoked";

    const { error: updErr } = await admin
      .from("delegation_grants")
      .update({
        status: newStatus,
        revoked_at: new Date().toISOString(),
        revoked_by: user.id,
      })
      .eq("id", grant_id);
    if (updErr) {
      return new Response(JSON.stringify({ error: updErr.message }), {
        status: 500,
        headers: { ...corsHeaders(req), "Content-Type": "application/json" },
      });
    }

    // Find the most recent chat session between agent and customer to write a system message
    const { data: session } = await admin
      .from("customer_chat_sessions")
      .select("id")
      .eq("user_id", grant.grantor_id)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    // Look up display names
    const { data: profs } = await admin
      .from("profiles")
      .select("user_id, display_name")
      .in("user_id", [grant.grantor_id, grant.grantee_id]);
    const nameMap = new Map((profs || []).map((p) => [p.user_id, p.display_name]));
    const granteeName = nameMap.get(grant.grantee_id) || "客服人員";

    if (session?.id) {
      await admin.from("customer_chat_messages").insert({
        session_id: session.id,
        sender_type: "system",
        sender_name: "系統",
        content: isAgentEnding
          ? `${granteeName} 已主動結束代理權限。`
          : `客戶已撤銷 ${granteeName} 的代理權限。`,
        is_read: false,
      });
    }

    // Note: the notify_delegation_status_change trigger handles bell notifications.

    return new Response(JSON.stringify({ ok: true, status: newStatus }), {
      headers: { ...corsHeaders(req), "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500,
      headers: { ...corsHeaders(req), "Content-Type": "application/json" },
    });
  }
});
