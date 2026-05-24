import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { corsHeaders, corsPreflight } from "../_shared/cors.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return corsPreflight(req);

  try {
    const authHeader = req.headers.get("authorization");
    if (!authHeader) return json(req, { error: "Missing authorization" }, 401);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

    const userClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user: callingUser }, error: authError } = await userClient.auth.getUser();
    if (authError || !callingUser) return json(req, { error: "Unauthorized" }, 401);

    const body = await req.json().catch(() => ({}));
    const { target_user_id, org_id } = body as {
      target_user_id?: string;
      org_id?: string;
    };

    if (!target_user_id || typeof target_user_id !== "string") {
      return json(req, { error: "Missing target_user_id" }, 400);
    }

    const adminClient = createClient(supabaseUrl, supabaseServiceKey);

    // Cannot delete self.
    if (target_user_id === callingUser.id) {
      return json(req, { error: "Cannot delete yourself" }, 403);
    }

    // Cannot delete a root system admin. Per SIGNCMS組織權限規則, root admins
    // (service@bizlution.com, service@signcms.net) are 原生管理員 — immune to
    // deletion by anyone, including other system admins.
    const { data: targetSysAdmin } = await adminClient
      .from("system_admins").select("id, is_root").eq("user_id", target_user_id).maybeSingle();
    if (targetSysAdmin?.is_root) {
      return json(req, { error: "Cannot delete root system administrator" }, 403);
    }
    if (targetSysAdmin) {
      return json(req, { error: "Cannot delete system administrator" }, 403);
    }

    // ── Org-scoped authorization ─────────────────────────────────────────
    // System admins may act cross-org.
    // Any other admin must specify the org_id and be an org_admin / admin
    // in THAT org, and the target must be a member of THAT org. The old
    // "share any org" check let a member of unrelated orgs delete each
    // other if they happened to overlap somewhere — close that.
    const { data: callerSysAdmin } = await adminClient
      .from("system_admins").select("id").eq("user_id", callingUser.id).maybeSingle();
    const callerIsSystemAdmin = !!callerSysAdmin;

    if (!callerIsSystemAdmin) {
      if (!org_id || typeof org_id !== "string") {
        return json(req, { error: "org_id is required for non-system admins" }, 400);
      }

      const [{ data: callerRoles }, { data: inOrg }, { data: targetInOrg }] = await Promise.all([
        adminClient
          .from("user_roles")
          .select("role")
          .eq("user_id", callingUser.id),
        adminClient.rpc("user_in_org", { _user_id: callingUser.id, _org_id: org_id }),
        adminClient.rpc("user_in_org", { _user_id: target_user_id, _org_id: org_id }),
      ]);

      const roles = new Set((callerRoles || []).map((r: any) => r.role));
      const isAdminInOrg = roles.has("admin") || roles.has("org_admin");
      if (!inOrg || !isAdminInOrg) {
        return json(req, { error: "Not an admin of this organization" }, 403);
      }
      if (!targetInOrg) {
        return json(req, { error: "Target user is not in this organization" }, 403);
      }
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
    if (delErr) return json(req, { error: delErr.message }, 500);

    return json(req, { success: true });
  } catch (error: any) {
    console.error("delete-user error:", error);
    return json(req, { error: error?.message || "Internal error" }, 500);
  }
});

function json(req: Request, body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(req), "Content-Type": "application/json" },
  });
}
