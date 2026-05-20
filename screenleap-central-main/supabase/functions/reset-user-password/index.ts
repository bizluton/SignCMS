import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("authorization");
    if (!authHeader) {
      return json({ error: "Missing authorization" }, 401);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

    const userClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user: callingUser }, error: authError } = await userClient.auth.getUser();
    if (authError || !callingUser) return json({ error: "Unauthorized" }, 401);

    const body = await req.json().catch(() => ({}));
    const { target_user_id, mode, new_password, org_id } = body as {
      target_user_id?: string;
      mode?: "email" | "password";
      new_password?: string;
      org_id?: string;
    };

    if (!target_user_id || typeof target_user_id !== "string") {
      return json({ error: "Missing target_user_id" }, 400);
    }
    if (mode !== "email" && mode !== "password") {
      return json({ error: "Invalid mode" }, 400);
    }
    if (mode === "password") {
      if (!new_password || typeof new_password !== "string" || new_password.length < 8 || new_password.length > 72) {
        return json({ error: "Password must be 8-72 characters" }, 400);
      }
    }

    const adminClient = createClient(supabaseUrl, supabaseServiceKey);

    // Cannot reset a system admin unless the caller is also a system admin.
    const { data: targetSysAdmin } = await adminClient
      .from("system_admins").select("id").eq("user_id", target_user_id).maybeSingle();
    const { data: callerSysAdmin } = await adminClient
      .from("system_admins").select("id").eq("user_id", callingUser.id).maybeSingle();
    const callerIsSystemAdmin = !!callerSysAdmin;

    if (targetSysAdmin && !callerIsSystemAdmin) {
      return json({ error: "Cannot reset system administrator" }, 403);
    }

    // ── Org-scoped authorization ─────────────────────────────────────────
    // System admins may act cross-org. Other admins must specify the org_id
    // and be an org_admin / admin in THAT org, and the target must belong
    // to THAT org. Replaces the old "share any org" check that let
    // overlapping membership unlock cross-org password resets.
    if (!callerIsSystemAdmin) {
      if (!org_id || typeof org_id !== "string") {
        return json({ error: "org_id is required for non-system admins" }, 400);
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
        return json({ error: "Not an admin of this organization" }, 403);
      }
      if (!targetInOrg) {
        return json({ error: "Target user is not in this organization" }, 403);
      }
    }

    // Get target user's email
    const { data: targetUser, error: getErr } = await adminClient.auth.admin.getUserById(target_user_id);
    if (getErr || !targetUser?.user?.email) return json({ error: "Target user not found" }, 404);
    const targetEmail = targetUser.user.email;

    // Resolve audit info
    let targetOrgId: string | null = null;
    let targetOrgName = "";
    let targetName = targetEmail;
    try {
      const { data: tProfile } = await adminClient
        .from("profiles").select("display_name").eq("user_id", target_user_id).maybeSingle();
      if (tProfile?.display_name) targetName = tProfile.display_name;
      const { data: tOrgIds } = await adminClient.rpc("get_user_org_ids", { _user_id: target_user_id });
      const ids = (tOrgIds || []) as string[];
      if (ids.length > 0) {
        targetOrgId = ids[0];
        const { data: org } = await adminClient
          .from("organizations").select("name").eq("id", targetOrgId).maybeSingle();
        targetOrgName = org?.name || "";
      }
    } catch (e) {
      console.error("audit-info fetch failed", e);
    }

    if (mode === "password") {
      const { error: updErr } = await adminClient.auth.admin.updateUserById(target_user_id, {
        password: new_password,
      });
      if (updErr) return json({ error: updErr.message }, 500);
      await notifyUser(adminClient, target_user_id, "password");
      await logAudit(adminClient, req, callingUser.id, target_user_id, targetName, targetEmail, targetOrgId, targetOrgName, "reset_password_manual");
      return json({ success: true, mode: "password" });
    }

    // mode === email: send reset email via recovery link
    const origin = req.headers.get("origin") || "";
    const redirectTo = origin ? `${origin}/reset-password` : undefined;
    const { error: linkErr } = await adminClient.auth.resetPasswordForEmail(targetEmail, {
      redirectTo,
    });
    if (linkErr) return json({ error: linkErr.message }, 500);
    await notifyUser(adminClient, target_user_id, "email");
    await logAudit(adminClient, req, callingUser.id, target_user_id, targetName, targetEmail, targetOrgId, targetOrgName, "reset_password_email");
    return json({ success: true, mode: "email", email: targetEmail });
  } catch (error: any) {
    return json({ error: error?.message || "Unknown error" }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

const NOTIFY_TEXTS: Record<string, { title: string; email: string; password: string }> = {
  "zh-TW": {
    title: "您的密碼已被重置",
    email: "管理員已寄送密碼重置信至您的信箱，請查收並依信件指示完成重設。",
    password: "管理員已為您設定一組臨時密碼，請聯繫管理員取得，並於登入後立即修改密碼。",
  },
  "en": {
    title: "Your password has been reset",
    email: "An administrator has sent a password reset email to your inbox. Please check it and follow the instructions to complete the reset.",
    password: "An administrator has set a temporary password for your account. Please contact your administrator to obtain it, and change it immediately after logging in.",
  },
  "ja": {
    title: "パスワードがリセットされました",
    email: "管理者よりパスワードリセットのメールが送信されました。受信トレイをご確認のうえ、案内に従ってリセットを完了してください。",
    password: "管理者によって一時パスワードが設定されました。管理者にご連絡のうえ取得し、ログイン後すぐにパスワードを変更してください。",
  },
};

function pickLang(raw: string | null | undefined): "zh-TW" | "en" | "ja" {
  const v = (raw || "").toLowerCase();
  if (v.startsWith("ja")) return "ja";
  if (v.startsWith("en")) return "en";
  return "zh-TW";
}

async function notifyUser(adminClient: any, userId: string, mode: "email" | "password") {
  try {
    const { data: profile } = await adminClient
      .from("profiles")
      .select("preferred_lang")
      .eq("user_id", userId)
      .maybeSingle();
    const lang = pickLang(profile?.preferred_lang);
    const t = NOTIFY_TEXTS[lang];
    await adminClient.from("notifications").insert({
      user_id: userId,
      type: "security",
      title: t.title,
      body: mode === "email" ? t.email : t.password,
      link: "/",
    });
  } catch (e) {
    console.error("notifyUser failed", e);
  }
}

async function logAudit(
  adminClient: any,
  req: Request,
  actorId: string,
  targetId: string,
  targetName: string,
  targetEmail: string,
  orgId: string | null,
  orgName: string,
  action: "reset_password_email" | "reset_password_manual",
) {
  try {
    const detailParams = { email: targetEmail, org: orgName || "" };
    const detail = JSON.stringify({ tpl: action, params: detailParams });
    await adminClient.from("activity_logs").insert({
      user_id: actorId,
      org_id: orgId,
      category: "security",
      action,
      action_code: action,
      action_params: detailParams,
      target_type: "user",
      target_id: targetId,
      target_name: targetName,
      detail,
      detail_json: { tpl: action, params: detailParams },
      ip_address: req.headers.get("x-forwarded-for") || "",
    });
  } catch (e) {
    console.error("logAudit failed", e);
  }
}
