import { createClient } from "https://esm.sh/@supabase/supabase-js@2.99.3";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  try {
    const authHeader = req.headers.get("authorization");
    if (!authHeader?.startsWith("Bearer ")) return json({ error: "Unauthorized" }, 401);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const muxTokenId = Deno.env.get("MUX_TOKEN_ID");
    const muxTokenSecret = Deno.env.get("MUX_TOKEN_SECRET");

    if (!muxTokenId || !muxTokenSecret) return json({ error: "transcode_not_configured" }, 503);

    const userClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: userError } = await userClient.auth.getUser();
    if (userError || !user) return json({ error: "Unauthorized" }, 401);

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { data: roleRows } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", user.id)
      .in("role", ["admin", "org_admin"])
      .limit(1);
    let isAuthorized = !!(roleRows && roleRows.length > 0);

    const body = await req.json();
    const mediaId = body?.media_id as string | undefined;
    if (!mediaId) return json({ error: "media_id is required" }, 400);

    const { data: item, error: itemError } = await supabase
      .from("media_items")
      .select("id, url, org_id, transcode_status, uploaded_by")
      .eq("id", mediaId)
      .maybeSingle();

    if (itemError || !item) return json({ error: "media_not_found" }, 404);

    if (!isAuthorized && item.uploaded_by === user.id) isAuthorized = true;
    if (!isAuthorized) {
      const { data: memberRows } = await supabase
        .from("team_members")
        .select("id")
        .eq("user_id", user.id)
        .limit(1);
      isAuthorized = !!(memberRows && memberRows.length > 0);
    }
    if (!isAuthorized) return json({ error: "Forbidden" }, 403);

    if (!["pending_transcode", "failed"].includes(item.transcode_status ?? "")) {
      return json({ error: "not_pending" }, 409);
    }

    // Submit to Mux — mp4_support enables static MP4 renditions for download
    const muxAuth = btoa(`${muxTokenId}:${muxTokenSecret}`);
    const muxRes = await fetch("https://api.mux.com/video/v1/assets", {
      method: "POST",
      headers: {
        "Authorization": `Basic ${muxAuth}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        input: [{ url: item.url }],
        playback_policy: ["public"],
        mp4_support: "standard",
        passthrough: mediaId,
      }),
    });

    if (!muxRes.ok) {
      const text = await muxRes.text().catch(() => "");
      console.error("Mux rejected job:", muxRes.status, text);
      return json({ error: "transcode_rejected", detail: text.slice(0, 200) }, 502);
    }

    await supabase
      .from("media_items")
      .update({ transcode_status: "transcoding", transcode_requested_at: new Date().toISOString() })
      .eq("id", mediaId);

    return json({ success: true });
  } catch (err) {
    console.error("request-transcode error:", err);
    return json({ error: "Internal error" }, 500);
  }
});
