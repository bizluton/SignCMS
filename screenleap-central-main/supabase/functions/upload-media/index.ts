/**
 * upload-media — SignCMS media upload endpoint
 *
 * CAS Phase 2: server-side SHA-256 computation.
 *
 * Storage layout:
 *   Legacy (pre-CAS):  media/{orgId}/{md5}.{ext}
 *   CAS (Phase 2+):    media/assets/{sha256}.{ext}   ← global, cross-org dedup
 *
 * Dedup priority:
 *   1. org-level sha256 match → 409 (same content already in this org)
 *   2. global sha256 match    → reuse Storage URL, no upload (cross-org dedup)
 *   3. org-level md5+size     → 409 (legacy rows that predate sha256)
 *   4. no match               → upload to assets/{sha256}.{ext}
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.99.3";
import { corsHeaders, corsPreflight } from "../_shared/cors.ts";

const BUCKET = "media";

function err(req: Request, body: Record<string, unknown>, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(req), "Content-Type": "application/json" },
  });
}

function ok(req: Request, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { ...corsHeaders(req), "Content-Type": "application/json" },
  });
}

function safeName(name: string): string {
  const base = name.split(/[\\/]/).pop() || "file";
  return base.replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 120) || "file";
}

/** Compute SHA-256 hex from an ArrayBuffer (Web Crypto — available in Deno). */
async function sha256Hex(buffer: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", buffer);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return corsPreflight(req);

  try {
    // ── Auth ─────────────────────────────────────────────────────────────────
    const authHeader = req.headers.get("authorization");
    if (!authHeader?.startsWith("Bearer ")) return err(req, { error: "Unauthorized" }, 401);

    const supabaseUrl        = Deno.env.get("SUPABASE_URL")!;
    const supabaseAnonKey    = Deno.env.get("SUPABASE_ANON_KEY")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const userClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const token = authHeader.slice("Bearer ".length);
    const { data: claimsData, error: claimsError } = await userClient.auth.getClaims(token);
    if (claimsError || !claimsData?.claims) return err(req, { error: "Unauthorized" }, 401);

    const userId  = claimsData.claims.sub as string;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // ── Parse form data ───────────────────────────────────────────────────────
    const formData     = await req.formData();
    const file         = formData.get("file") as File | null;
    const name         = (formData.get("name")          as string) || file?.name || "unknown";
    const originalName = (formData.get("original_name") as string) || file?.name || name;
    const md5Client    = ((formData.get("md5")          as string) || "").toLowerCase();
    const type         = (formData.get("type")          as string) || "image";
    const orgId        = formData.get("org_id")         as string | null;
    const projectId    = formData.get("design_project_id") as string | null;

    // ── Org-scoped permission check ──────────────────────────────────────────
    // Caller must either:
    //   (a) be a member of the target org (user_in_org), OR
    //   (b) be a system admin (cross-org by design), OR
    //   (c) be an active CS agent WITH an active, non-expired delegation grant
    //       from any member of the target org.
    //
    // Note: the previous version only checked "is this user in ANY team / role",
    // which let a member of org A upload into org B by sending org_id=B.
    if (!orgId) return err(req, { error: "org_id is required" }, 400);

    const [
      { data: inOrg },
      { data: sysAdmin },
      { data: csAgent },
    ] = await Promise.all([
      supabase.rpc("user_in_org", { _user_id: userId, _org_id: orgId }),
      supabase.from("system_admins").select("id").eq("user_id", userId).maybeSingle(),
      supabase.from("cs_agents").select("id").eq("user_id", userId).eq("status", "active").maybeSingle(),
    ]);

    let authorized = !!inOrg || !!sysAdmin;

    if (!authorized && csAgent) {
      // CS agents only act on orgs that have actively delegated to them.
      const nowIso = new Date().toISOString();
      const { data: grants } = await supabase
        .from("delegation_grants")
        .select("grantor_id")
        .eq("grantee_id", userId)
        .eq("status", "active")
        .gt("expires_at", nowIso);

      const grantorIds = (grants || []).map((g: any) => g.grantor_id);
      if (grantorIds.length > 0) {
        // Does any grantor belong to the target org?
        const checks = await Promise.all(
          grantorIds.map((gid: string) =>
            supabase.rpc("user_in_org", { _user_id: gid, _org_id: orgId })
          ),
        );
        authorized = checks.some((r) => r.data === true);
      }
    }

    if (!authorized) return err(req, { error: "Forbidden" }, 403);

    const widthRaw          = formData.get("width")            as string | null;
    const heightRaw         = formData.get("height")           as string | null;
    const durationSecRaw    = formData.get("duration_seconds") as string | null;
    const sourceFpsRaw      = formData.get("source_fps")       as string | null;
    const sourceBitrateRaw  = formData.get("source_bitrate")   as string | null;
    const sourceCodec       = (formData.get("source_codec")    as string | null) || null;
    const sourceContainer   = (formData.get("source_container") as string | null) || null;
    const needsTranscode    = formData.get("needs_transcode") === "true";

    // ── Basic validation ──────────────────────────────────────────────────────
    if (!file) return err(req, { error: "No file provided" }, 400);

    if (
      file.name.startsWith("data:") ||
      name.startsWith("data:")       ||
      originalName.startsWith("data:")
    ) return err(req, { error: "base64_not_allowed" }, 400);

    // md5 is still accepted from clients for backward compat; validate format
    // if provided, but no longer required (sha256 is now the authoritative hash).
    if (md5Client && !/^[a-f0-9]{32}$/.test(md5Client)) {
      return err(req, { error: "invalid_md5" }, 400);
    }

    // ── Compute SHA-256 server-side (CAS Phase 2) ─────────────────────────────
    // Read the entire file into memory once; reuse buffer for storage upload.
    const fileBuffer = await file.arrayBuffer();
    const sha256     = await sha256Hex(fileBuffer);
    const mimeType   = file.type || "application/octet-stream";
    const sizeBytes  = file.size;
    const ext        = (file.name.split(".").pop() || "").toLowerCase();
    const extStr     = ext ? `.${ext}` : "";

    // ── Dedup checks (parallel) ───────────────────────────────────────────────
    const [orgSha256Res, globalSha256Res, orgMd5Res] = await Promise.all([
      // 1. org-level sha256 dedup
      supabase.from("media_items")
        .select("id, original_name")
        .eq("org_id", orgId)
        .eq("sha256", sha256)
        .is("deleted_at", null)
        .limit(1)
        .maybeSingle(),
      // 2. global sha256 — find existing Storage URL to reuse (cross-org dedup)
      supabase.from("media_items")
        .select("url")
        .eq("sha256", sha256)
        .is("deleted_at", null)
        .limit(1)
        .maybeSingle(),
      // 3. org-level md5+size — catch legacy rows that predate sha256
      md5Client
        ? supabase.from("media_items")
            .select("id, original_name")
            .eq("org_id", orgId)
            .eq("md5", md5Client)
            .eq("size_bytes", sizeBytes)
            .is("deleted_at", null)
            .limit(1)
            .maybeSingle()
        : Promise.resolve({ data: null }),
    ]);

    // 1 → 409: same content already exists in this org
    if (orgSha256Res.data) {
      return err(req, {
        error:         "duplicate_file",
        original_name: (orgSha256Res.data as any).original_name,
        dedup_by:      "sha256",
      }, 409);
    }

    // 3 → 409: legacy md5+size match in same org
    if (orgMd5Res.data) {
      return err(req, {
        error:         "duplicate_file",
        original_name: (orgMd5Res.data as any).original_name,
        dedup_by:      "md5",
      }, 409);
    }

    // ── Storage upload (or reuse) ─────────────────────────────────────────────
    const casPath   = `assets/${sha256}${extStr}`;  // CAS path (global, cross-org)
    let   publicUrl: string;

    // Optional: rewrite the publicUrl host so player downloads hit our
    // Cloudflare Worker (which caches storage paths for 1 year). At 10k
    // device scale the Supabase Storage egress saving is real ($0.09/GB).
    // Set env var MEDIA_CDN_BASE_URL=https://cdn.signcms.net (or whatever
    // host the worker is mapped to). If unset, fall back to Supabase URL.
    const mediaCdnBase = (Deno.env.get("MEDIA_CDN_BASE_URL") ?? "").replace(/\/$/, "");
    const rewriteHost = (raw: string): string => {
      if (!mediaCdnBase) return raw;
      try {
        const u   = new URL(raw);
        const cdn = new URL(mediaCdnBase);
        u.protocol = cdn.protocol;
        u.host     = cdn.host;
        return u.toString();
      } catch {
        return raw;
      }
    };

    if (globalSha256Res.data?.url) {
      // 2 → reuse existing Storage object from another org; no upload needed
      publicUrl = rewriteHost(globalSha256Res.data.url);
      console.log(`[upload] cross-org dedup hit: ${sha256.slice(0, 16)}… reusing existing URL`);
    } else {
      // New content — upload to CAS path
      const { error: uploadError } = await supabase.storage
        .from(BUCKET)
        .upload(casPath, fileBuffer, {
          contentType:  mimeType,
          cacheControl: "31536000, immutable",  // content-addressed → immutable forever
          upsert:       false,
        });

      if (uploadError) {
        const msg         = (uploadError as any).message || "";
        const alreadyExists = /already exists/i.test(msg) || (uploadError as any).statusCode === "409";
        if (!alreadyExists) {
          console.error("Storage upload error:", uploadError);
          return err(req, { error: "Storage upload failed", detail: msg }, 500);
        }
        // Storage object exists (concurrent upload race) — fall through and get URL
      }

      const { data: pub } = supabase.storage.from(BUCKET).getPublicUrl(casPath);
      publicUrl = rewriteHost(pub.publicUrl);
    }

    const thumbnail = type === "image" ? publicUrl : "";

    // ── Insert media_items row ────────────────────────────────────────────────
    const widthInt      = widthRaw         ? parseInt(widthRaw, 10)         : NaN;
    const heightInt     = heightRaw        ? parseInt(heightRaw, 10)        : NaN;
    const durSecNum     = durationSecRaw   ? parseFloat(durationSecRaw)     : NaN;
    const sourceFps     = sourceFpsRaw     ? parseFloat(sourceFpsRaw)       : NaN;
    const sourceBitrate = sourceBitrateRaw ? parseInt(sourceBitrateRaw, 10) : NaN;

    const insertData: Record<string, unknown> = {
      name:          safeName(name),
      original_name: originalName,
      md5:           md5Client || null,
      sha256,                                           // server-computed ✓
      mime_type:     mimeType,
      type,
      url:           publicUrl,
      thumbnail,
      size_bytes:    sizeBytes,
      width:         Number.isFinite(widthInt)      && widthInt      > 0 ? widthInt      : null,
      height:        Number.isFinite(heightInt)     && heightInt     > 0 ? heightInt     : null,
      duration_seconds: Number.isFinite(durSecNum)  && durSecNum     > 0 ? durSecNum     : null,
      uploaded_by:   userId,
      design_project_id: projectId && projectId !== "__none__" ? projectId : null,
      org_id:        orgId,
      transcode_status: needsTranscode ? "pending_transcode" : "ready",
      source_fps:       Number.isFinite(sourceFps)     && sourceFps     > 0 ? sourceFps     : null,
      source_bitrate:   Number.isFinite(sourceBitrate) && sourceBitrate > 0 ? sourceBitrate : null,
      source_codec:     sourceCodec    || null,
      source_container: sourceContainer || null,
    };

    const { data: inserted, error: insertError } = await supabase
      .from("media_items")
      .insert(insertData)
      .select("id")
      .single();

    if (insertError) {
      // Roll back storage upload only if we actually uploaded (not reused)
      if (!globalSha256Res.data?.url) {
        await supabase.storage.from(BUCKET).remove([casPath]).catch(() => {});
      }
      console.error("Insert error:", insertError);
      const msg = insertError.message || "";
      if (msg.includes("media_capacity_exceeded")) {
        return err(req, { error: "media_capacity_exceeded" }, 413);
      }
      if (
        (insertError as any).code === "23505" ||
        /media_items_org_sha256_uniq|media_items_org_md5_size_uniq/.test(msg)
      ) {
        return err(req, { error: "duplicate_file", dedup_by: "db_constraint" }, 409);
      }
      return err(req, { error: "Failed to save media" }, 500);
    }

    return ok(req, {
      success:          true,
      id:               inserted.id,
      url:              publicUrl,
      sha256,
      storage_path:     casPath,
      transcode_status: needsTranscode ? "pending_transcode" : "ready",
    });

  } catch (e) {
    console.error("Upload error:", e);
    return err(req, { error: "Upload failed" }, 500);
  }
});
