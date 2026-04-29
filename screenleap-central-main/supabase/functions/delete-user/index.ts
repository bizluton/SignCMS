import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("authorization");
    if (!authHeader) return json({ error: "Missing authorization" }, 401);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

    const userClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user: callingUser }, error: authError } = await userClient.auth.getUser();
    if (authError || !callingUser) return json({ error: "Unauthorized" }, 401);

    const body = await req.json().catch(() => ({}));
    const { target_user_id } = body as { target_user_id?: string };

    if (!target_user_id || typeof target_user_id !== "string") {
      return json({ error: "Missing target_user_id" }, 400);
    }

    const adminClient = createClient(supabaseUrl, supabaseServiceKey);

    // Permission: caller must be admin OR org_admin OR system_admin
    const [{ data: callerRoles }, { data: callerSysAdmin }] = await Promise.all([
      adminClient.from("user_roles").select("role").eq("user_id", callingUser.id),
      adminClient.from("system_admins").select("id").eq("user_id", callingUser.id).maybeSingle(),
    ]);
    const roles = new Set((callerRoles || []).map((r: any) => r.role));
    const isSystemAdmin = !!callerSysAdmin;
    const isAdmin = roles.has("admin") || isSystemAdmin;
    const isOrgAdmin = roles.has("org_admin");

    if (!isAdmin && !isOrgAdmin) return json({ error: "Forbidden" }, 403);

    // Cannot delete a system admin
    const { data: targetSysAdmin } = await adminClient
      .from("system_admins").select("id").eq("user_id", target_user_id).maybeSingle();
    if (targetSysAdmin) {
      return json({ error: "Cannot delete system administrator" }, 403);
    }

    // Cannot delete self
    if (target_user_id === callingUser.id) {
      return json({ error: "Cannot delete yourself" }, 403);
    }

    // Org-scope check for non-system admin
    if (!isSystemAdmin) {
      const [{ data: callerOrgIds }, { data: targetOrgIds }] = await Promise.all([
        adminClient.rpc("get_user_org_ids", { _user_id: callingUser.id }),
        adminClient.rpc("get_user_org_ids", { _user_id: target_user_id }),
      ]);
      const callerSet = new Set((callerOrgIds || []) as string[]);
      const shared = ((targetOrgIds || []) as string[]).some((id) => callerSet.has(id));
      if (!shared) return json({ error: "Target user is not in your organization" }, 403);
    }

    // Resolve audit info
    let targetEmail = "";
    let targetName = "";
    let targetOrgId: string | null = null;
    let targetOrgName = "";
    try {
      const { data: targetAuth } = await adminClient.auth.admin.getUserById(target_user_id);
      targetEmail = targetAuth?.user?.email ?? "";
      const { data: targetProfile } = await adminClient
        .from("profiles").select("display_name").eq("user_id", target_user_id).maybeSingle();
      targetName = targetProfile?.display_name || targetEmail || target_user_id;
      const { data: targetOrgIds } = await adminClient.rpc("get_user_org_ids", { _user_id: target_user_id });
      const orgIds = (targetOrgIds || []) as string[];
      if (orgIds.length > 0) {
        targetOrgId = orgIds[0];
        const { data: org } = await adminClient
          .from("organizations").select("name").eq("id", targetOrgId).maybeSingle();
        targetOrgName = org?.name || "";
      }
    } catch (e) {
      console.error("audit-info fetch failed", e);
    }

    // Write audit log BEFORE deletion (structured detail for i18n)
    try {
      const detailParams = { email: targetEmail || target_user_id, org: targetOrgName || "" };
      await adminClient.from("activity_logs").insert({
        user_id: callingUser.id,
        org_id: targetOrgId,
        category: "user",
        action: "delete_user",
        action_code: "delete_user",
        action_params: detailParams,
        target_type: "user",
        target_id: target_user_id,
        target_name: targetName,
        detail: JSON.stringify({ tpl: "delete_user", params: detailParams }),
        detail_json: { tpl: "delete_user", params: detailParams },
        ip_address: req.headers.get("x-forwarded-for") || "",
      });
    } catch (e) {
      console.error("activity_log insert failed", e);
    }

    // Delete user data in order: team_members, user_roles, profiles, then auth user
    await adminClient.from("team_members").delete().eq("user_id", target_user_id);
    await adminClient.from("user_roles").delete().eq("user_id", target_user_id);
    await adminClient.from("profiles").delete().eq("user_id", target_user_id);

    const { error: delErr } = await adminClient.auth.admin.deleteUser(target_user_id);
    if (delErr) return json({ error: delErr.message }, 500);

    return json({ success: true });
  } catch (error: any) {
    console.error("delete-user error:", error);
    return json({ error: error?.message || "Internal error" }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
