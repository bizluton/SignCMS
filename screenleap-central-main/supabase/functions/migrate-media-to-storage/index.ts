import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Decode a data:<mime>;base64,<payload> URL → { mimeType, bytes }
function decodeDataUrl(url: string): { mimeType: string; bytes: Uint8Array } | null {
  const match = url.match(/^data:([^;]+);base64,(.*)$/);
  if (!match) return null;
  const mimeType = match[1];
  const binary = atob(match[2]);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return { mimeType, bytes };
}

function extFromMime(mime: string, fallback: string) {
  const map: Record<string, string> = {
    "image/png": "png", "image/jpeg": "jpg", "image/jpg": "jpg", "image/webp": "webp", "image/gif": "gif",
    "video/mp4": "mp4", "video/webm": "webm", "video/quicktime": "mov",
    "audio/mpeg": "mp3", "audio/mp3": "mp3", "audio/wav": "wav", "audio/ogg": "ogg",
  };
  return map[mime?.toLowerCase()] || fallback;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // Auth check: only system admins can run this
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return new Response(JSON.stringify({ error: "no auth" }), { status: 401, headers: corsHeaders });
    const { data: userData } = await supabase.auth.getUser(authHeader.replace("Bearer ", ""));
    if (!userData?.user?.id) return new Response(JSON.stringify({ error: "forbidden" }), { status: 403, headers: corsHeaders });
    const { data: sysAdminRow } = await supabase
      .from("system_admins").select("id").eq("user_id", userData.user.id).maybeSingle();
    if (!sysAdminRow) {
      return new Response(JSON.stringify({ error: "forbidden" }), { status: 403, headers: corsHeaders });
    }

    const body = await req.json().catch(() => ({}));
    const limit = Math.min(Number(body.limit) || 5, 20);

    // Fetch only id + minimal columns first (avoid timeout)
    const { data: candidates, error: listErr } = await supabase
      .from("media_items")
      .select("id, name, type, org_id")
      .order("created_at", { ascending: false })
      .limit(500);
    if (listErr) throw listErr;

    const results: any[] = [];
    let processed = 0;

    for (const item of candidates ?? []) {
      if (processed >= limit) break;

      // Fetch url + thumbnail for this single row only
      const { data: row, error: rowErr } = await supabase
        .from("media_items")
        .select("url, thumbnail")
        .eq("id", item.id)
        .single();
      if (rowErr) continue;

      const url: string = row?.url || "";
      const thumb: string = row?.thumbnail || "";
      const urlIsB64 = url.startsWith("data:");
      const thumbIsB64 = thumb.startsWith("data:");
      if (!urlIsB64 && !thumbIsB64) continue; // already migrated

      const updates: Record<string, string> = {};
      const stepResults: Record<string, string> = {};

      // Migrate url
      if (urlIsB64) {
        try {
          const decoded = decodeDataUrl(url);
          if (!decoded) {
            stepResults.url = "skip_invalid_data";
          } else {
            const ext = extFromMime(decoded.mimeType, (item.name?.split(".").pop() || "bin").toLowerCase());
            const storagePath = `${item.org_id || "system"}/${item.id}.${ext}`;
            const { error: upErr } = await supabase.storage
              .from("media")
              .upload(storagePath, decoded.bytes, { contentType: decoded.mimeType, upsert: true });
            if (upErr) throw upErr;
            const { data: pub } = supabase.storage.from("media").getPublicUrl(storagePath);
            updates.url = pub.publicUrl;
            stepResults.url = "migrated";
          }
        } catch (e: any) {
          stepResults.url = `error: ${String(e?.message || e)}`;
        }
      }

      // Migrate thumbnail (separate object so removing thumbnail won't break original media)
      if (thumbIsB64) {
        try {
          const decoded = decodeDataUrl(thumb);
          if (!decoded) {
            stepResults.thumbnail = "skip_invalid_data";
          } else {
            const ext = extFromMime(decoded.mimeType, "jpg");
            const storagePath = `${item.org_id || "system"}/${item.id}.thumb.${ext}`;
            const { error: upErr } = await supabase.storage
              .from("media")
              .upload(storagePath, decoded.bytes, { contentType: decoded.mimeType, upsert: true });
            if (upErr) throw upErr;
            const { data: pub } = supabase.storage.from("media").getPublicUrl(storagePath);
            updates.thumbnail = pub.publicUrl;
            stepResults.thumbnail = "migrated";
          }
        } catch (e: any) {
          stepResults.thumbnail = `error: ${String(e?.message || e)}`;
        }
      }

      if (Object.keys(updates).length > 0) {
        const { error: updErr } = await supabase
          .from("media_items")
          .update(updates)
          .eq("id", item.id);
        if (updErr) {
          stepResults._dbUpdate = `error: ${String(updErr.message)}`;
        } else {
          stepResults._dbUpdate = "ok";
        }
      }

      results.push({ id: item.id, name: item.name, type: item.type, ...stepResults });
      processed++;
    }

    // Estimate remaining work using a HEAD count on rows that still have data: URLs
    const { count: remainingUrl } = await supabase
      .from("media_items")
      .select("id", { count: "exact", head: true })
      .like("url", "data:%");
    const { count: remainingThumb } = await supabase
      .from("media_items")
      .select("id", { count: "exact", head: true })
      .like("thumbnail", "data:%");

    return new Response(
      JSON.stringify({
        processed,
        results,
        remaining: { url_base64: remainingUrl ?? 0, thumbnail_base64: remainingThumb ?? 0 },
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e: any) {
    return new Response(
      JSON.stringify({ error: String(e?.message || e) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
