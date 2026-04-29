import { createClient } from "https://esm.sh/@supabase/supabase-js@2.99.3";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function hmacHex(secret: string, message: string): Promise<string> {
  return crypto.subtle
    .importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"])
    .then((key) => crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message)))
    .then((buf) => Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join(""));
}

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
    const workerUrl = Deno.env.get("TRANSCODE_WORKER_URL");
    const hmacSecret = Deno.env.get("TRANSCODE_HMAC_SECRET");

    if (!workerUrl) return json({ error: "worker_not_configured" }, 503);
    if (!hmacSecret) return json({ error: "worker_not_configured" }, 503);

    const userClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: userError } = await userClient.auth.getUser();
    if (userError || !user) return json({ error: "Unauthorized" }, 401);

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Permission: admin / org_admin / uploader of the item
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

    // Fetch the media item (also used for uploader check)
    const { data: item, error: itemError } = await supabase
      .from("media_items")
      .select("id, url, org_id, transcode_status, uploaded_by")
      .eq("id", mediaId)
      .maybeSingle();

    if (itemError || !item) return json({ error: "media_not_found" }, 404);

    if (!isAuthorized && item.uploaded_by === user.id) isAuthorized = true;
    if (!isAuthorized) {
      // CS agents / org members may also transcode their org's media
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

    // Build the job payload
    const callbackUrl = `${supabaseUrl}/functions/v1/transcode-callback`;
    const jobPayload = JSON.stringify({
      job_id: mediaId,
      input_url: item.url,
      callback_url: callbackUrl,
      target: {
        container: "mp4",
        video_codec: "h264",
        max_height: 1080,
        fps: 30,
        video_bitrate: 8_000_000,
        pix_fmt: "yuv420p",
        audio_codec: "aac",
        audio_bitrate: 128_000,
      },
    });

    // HMAC-SHA256: sign timestamp + "." + body
    const timestamp = String(Date.now());
    const signature = await hmacHex(hmacSecret, timestamp + "." + jobPayload);

    // Send to worker
    const workerRes = await fetch(`${workerUrl}/jobs`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Signature": signature,
        "X-Timestamp": timestamp,
      },
      body: jobPayload,
    });

    if (!workerRes.ok) {
      const text = await workerRes.text().catch(() => "");
      console.error("Worker rejected job:", workerRes.status, text);
      return json({ error: "worker_rejected", detail: text.slice(0, 200) }, 502);
    }

    // Mark as transcoding
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
