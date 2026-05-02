import { createClient } from "https://esm.sh/@supabase/supabase-js@2.99.3";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const BUCKET = "media";
const OPTIMIZABLE_IMAGE_TYPES = new Set(["image/jpeg", "image/jpg", "image/png"]);
const MIN_OPTIMIZE_BYTES = 50_000; // skip files under 50 KB

function safeName(name: string): string {
  // Strip path components, keep ascii/digits/dot/dash/underscore.
  const base = name.split(/[\\/]/).pop() || "file";
  return base.replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 120) || "file";
}

function bytesToHuman(b: number): string {
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / (1024 * 1024)).toFixed(1)} MB`;
}

async function tryOptimizeWebP(bytes: Uint8Array): Promise<Uint8Array | null> {
  try {
    const { Image } = await import("https://deno.land/x/imagescript@1.2.15/mod.ts");
    const img = await Image.decode(bytes);
    const webp = new Uint8Array(await img.encodeWebP(85));
    // Only use WebP if it saves ≥5%
    return webp.byteLength < bytes.byteLength * 0.95 ? webp : null;
  } catch (e) {
    console.warn("[optimize] skipped:", (e as Error).message?.slice(0, 100));
    return null;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const userClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const token = authHeader.replace("Bearer ", "");
    const { data: claimsData, error: claimsError } = await userClient.auth.getClaims(token);
    if (claimsError || !claimsData?.claims) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const userId = claimsData.claims.sub as string;

    // Service role client for DB writes & storage upload (bypasses owner-RLS for storage)
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Permission check (admin / org_admin / cs_agent / org member)
    const { data: roleRows } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", userId)
      .in("role", ["admin", "org_admin"])
      .limit(1);
    let isAuthorized = !!(roleRows && roleRows.length > 0);

    if (!isAuthorized) {
      const { data: csRows } = await supabase
        .from("cs_agents")
        .select("id")
        .eq("user_id", userId)
        .eq("status", "active")
        .limit(1);
      isAuthorized = !!(csRows && csRows.length > 0);
    }

    if (!isAuthorized) {
      const { data: memberRows } = await supabase
        .from("team_members")
        .select("id")
        .eq("user_id", userId)
        .limit(1);
      isAuthorized = !!(memberRows && memberRows.length > 0);
    }

    if (!isAuthorized) {
      return new Response(JSON.stringify({ error: "Forbidden" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const formData = await req.formData();
    const file = formData.get("file") as File | null;
    const name = (formData.get("name") as string) || file?.name || "unknown";
    const originalName = (formData.get("original_name") as string) || file?.name || name;
    const md5 = ((formData.get("md5") as string) || "").toLowerCase();
    const type = (formData.get("type") as string) || "image";
    const widthRaw = formData.get("width") as string | null;
    const heightRaw = formData.get("height") as string | null;
    const durationSecRaw = formData.get("duration_seconds") as string | null;
    const projectId = formData.get("design_project_id") as string | null;
    const orgId = formData.get("org_id") as string | null;
    // Transcode metadata (from MediaInfo.js on the client)
    const sourceFpsRaw = formData.get("source_fps") as string | null;
    const sourceBitrateRaw = formData.get("source_bitrate") as string | null;
    const sourceCodec = (formData.get("source_codec") as string | null) || null;
    const sourceContainer = (formData.get("source_container") as string | null) || null;
    const needsTranscode = formData.get("needs_transcode") === "true";

    if (!file) {
      return new Response(JSON.stringify({ error: "No file provided" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    // Defensive: reject anything that looks like a base64 data URL being smuggled
    // through as a "file" or name. All media must go through Storage uploads only.
    if (
      (typeof file.name === "string" && file.name.startsWith("data:")) ||
      (typeof name === "string" && name.startsWith("data:")) ||
      (typeof originalName === "string" && originalName.startsWith("data:"))
    ) {
      return new Response(JSON.stringify({ error: "base64_not_allowed" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (!orgId) {
      return new Response(JSON.stringify({ error: "org_id is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (!/^[a-f0-9]{32}$/.test(md5)) {
      return new Response(JSON.stringify({ error: "invalid_md5" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Server-side duplicate check (org-scoped, md5 only — size may differ after optimization)
    const { data: dupRow } = await supabase
      .from("media_items")
      .select("id, original_name")
      .eq("org_id", orgId)
      .eq("md5", md5)
      .limit(1)
      .maybeSingle();

    if (dupRow) {
      return new Response(
        JSON.stringify({ error: "duplicate_file", original_name: (dupRow as any).original_name }),
        {
          status: 409,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    const ext = (file.name.split(".").pop() || "").toLowerCase();
    const mimeType = file.type || "application/octet-stream";

    // Attempt WebP conversion for JPEG/PNG images large enough to benefit
    let fileBytes = new Uint8Array(await file.arrayBuffer());
    let finalMime = mimeType;
    let finalExt = ext;

    if (OPTIMIZABLE_IMAGE_TYPES.has(mimeType) && file.size >= MIN_OPTIMIZE_BYTES) {
      const optimized = await tryOptimizeWebP(fileBytes);
      if (optimized) {
        const saving = Math.round((1 - optimized.byteLength / fileBytes.byteLength) * 100);
        console.log(`[optimize] ${originalName}: ${bytesToHuman(file.size)} → ${bytesToHuman(optimized.byteLength)} (−${saving}%)`);
        fileBytes = optimized;
        finalMime = "image/webp";
        finalExt = "webp";
      }
    }

    // Storage path uses MD5 as filename for cross-user dedup-friendliness; ext reflects final format.
    const storagePath = `${orgId}/${md5}${finalExt ? "." + finalExt : ""}`;

    const { error: uploadError } = await supabase.storage
      .from(BUCKET)
      .upload(storagePath, fileBytes, {
        contentType: finalMime,
        cacheControl: "3600",
        upsert: false,
      });

    if (uploadError) {
      // If the object already exists (e.g. partial prior upload), reuse it instead of failing.
      const msg = (uploadError as any).message || "";
      const alreadyExists = /already exists/i.test(msg) || (uploadError as any).statusCode === "409";
      if (!alreadyExists) {
        console.error("Storage upload error:", uploadError);
        return new Response(JSON.stringify({ error: "Storage upload failed", detail: msg }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    const { data: pub } = supabase.storage.from(BUCKET).getPublicUrl(storagePath);
    const publicUrl = pub.publicUrl;
    const thumbnail = type === "image" ? publicUrl : "";

    const sizeBytes = fileBytes.byteLength;
    const widthInt = widthRaw ? parseInt(widthRaw, 10) : NaN;
    const heightInt = heightRaw ? parseInt(heightRaw, 10) : NaN;
    const durSecNum = durationSecRaw ? parseFloat(durationSecRaw) : NaN;
    const sourceFps = sourceFpsRaw ? parseFloat(sourceFpsRaw) : NaN;
    const sourceBitrate = sourceBitrateRaw ? parseInt(sourceBitrateRaw, 10) : NaN;
    const insertData: Record<string, unknown> = {
      name: safeName(name),
      original_name: originalName,
      md5,
      mime_type: finalMime,
      type,
      url: publicUrl,
      thumbnail,
      size_bytes: sizeBytes,
      width: Number.isFinite(widthInt) && widthInt > 0 ? widthInt : null,
      height: Number.isFinite(heightInt) && heightInt > 0 ? heightInt : null,
      duration_seconds: Number.isFinite(durSecNum) && durSecNum > 0 ? durSecNum : null,
      uploaded_by: userId,
      design_project_id: projectId && projectId !== "__none__" ? projectId : null,
      org_id: orgId,
      // Transcode tracking
      transcode_status: needsTranscode ? "pending_transcode" : "ready",
      source_fps: Number.isFinite(sourceFps) && sourceFps > 0 ? sourceFps : null,
      source_bitrate: Number.isFinite(sourceBitrate) && sourceBitrate > 0 ? sourceBitrate : null,
      source_codec: sourceCodec || null,
      source_container: sourceContainer || null,
    };

    const { data, error } = await supabase
      .from("media_items")
      .insert(insertData)
      .select("id")
      .single();

    if (error) {
      // Roll back the uploaded object so we don't leak storage on plan-limit failures.
      await supabase.storage.from(BUCKET).remove([storagePath]).catch(() => {});
      console.error("Insert error:", error);
      const msg = error.message || "";
      if (msg.includes("media_capacity_exceeded")) {
        return new Response(JSON.stringify({ error: "media_capacity_exceeded" }), {
          status: 413,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      // Unique-violation on (org_id, md5)
      if ((error as any).code === "23505" || /media_items_org_md5/.test(msg)) {
        return new Response(JSON.stringify({ error: "duplicate_file" }), {
          status: 409,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ error: "Failed to save media" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(
      JSON.stringify({ success: true, id: data.id, url: publicUrl, storage_path: storagePath, transcode_status: needsTranscode ? "pending_transcode" : "ready" }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  } catch (err) {
    console.error("Upload error:", err);
    return new Response(JSON.stringify({ error: "Upload failed" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
