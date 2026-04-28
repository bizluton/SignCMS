import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceRoleKey);

    const now = new Date();
    const reminderDays = [30, 7, 1];

    // Fetch all orgs with their license info
    const { data: orgs, error } = await supabase
      .from("organizations")
      .select("id, name, license_plan, license_expires_at, license_reminder_sent, created_by");

    if (error) throw error;

    const results: string[] = [];

    for (const org of orgs || []) {
      const expiresAt = new Date(org.license_expires_at);
      const daysLeft = Math.ceil((expiresAt.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
      const sentReminders: number[] = org.license_reminder_sent || [];

      for (const day of reminderDays) {
        if (daysLeft <= day && !sentReminders.includes(day)) {
          // Find org_admin users for this org
          const { data: teamMembers } = await supabase
            .from("team_members")
            .select("user_id, team_id");

          const { data: teams } = await supabase
            .from("teams")
            .select("id, org_id")
            .eq("org_id", org.id);

          const teamIds = new Set((teams || []).map((t: any) => t.id));
          const orgUserIds = (teamMembers || [])
            .filter((tm: any) => teamIds.has(tm.team_id))
            .map((tm: any) => tm.user_id);

          // Check which are org_admins
          const { data: adminRoles } = await supabase
            .from("user_roles")
            .select("user_id")
            .eq("role", "org_admin")
            .in("user_id", orgUserIds);

          const adminUserIds = (adminRoles || []).map((r: any) => r.user_id);

          // Send notifications to org admins
          for (const userId of adminUserIds) {
            await supabase.from("notifications").insert({
              user_id: userId,
              type: "license",
              title: daysLeft <= 0
                ? `授權已過期 - ${org.name}`
                : `授權即將到期 - ${org.name}`,
              body: daysLeft <= 0
                ? `組織「${org.name}」的${org.license_plan}授權已過期，請儘速續約。`
                : `組織「${org.name}」的${org.license_plan}授權將在 ${daysLeft} 天後到期，請及早續約。`,
              link: "/admin",
            });
          }

          // Update reminder_sent
          sentReminders.push(day);
          await supabase
            .from("organizations")
            .update({ license_reminder_sent: sentReminders })
            .eq("id", org.id);

          results.push(`Sent ${day}-day reminder for org ${org.name} to ${adminUserIds.length} admins`);
          break; // Only send the most urgent reminder
        }
      }
    }

    return new Response(JSON.stringify({ ok: true, results }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
