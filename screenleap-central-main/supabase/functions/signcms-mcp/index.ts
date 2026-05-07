// signcms-mcp: MCP Server for SignCMS Go PWA
// Implements JSON-RPC 2.0 over HTTP with the Model Context Protocol.
//
// Authentication: Bearer <mcp_token> (raw token, hashed to SHA-256 for DB lookup)
// CORS: open (PWA calls from any origin)
//
// Supported methods:
//   initialize          — MCP handshake
//   tools/list          — list all available tools
//   tools/call          — execute a tool
//
// Tools (18 total):
//   get_screens, get_screen_status, get_org_summary,
//   switch_screens_to_channel, switch_screens_to_media, restore_screens,
//   list_channels, get_channel_detail, list_schedules, apply_schedule_to_screen,
//   get_running_schedules, search_content, list_media,
//   emergency_broadcast, publish_channel, get_recent_publishes,
//   get_alerts, get_playback_stats, get_active_overrides

import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { notifySync, orgBroadcast } from "../_shared/mqtt.ts";

// ── CORS ──────────────────────────────────────────────────────────────────────
const CORS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
};

// ── Helpers ───────────────────────────────────────────────────────────────────
function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

function rpcError(id: unknown, code: number, message: string) {
  return json({ jsonrpc: "2.0", id, error: { code, message } });
}

function rpcOk(id: unknown, result: unknown) {
  return json({ jsonrpc: "2.0", id, result });
}

async function sha256hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

// ── Auth ──────────────────────────────────────────────────────────────────────
interface TokenClaims {
  tokenId:     string;
  orgId:       string;
  userId:      string;
  permissions: string[];
}

async function authenticate(
  authHeader: string | null,
  sb: SupabaseClient,
): Promise<TokenClaims | null> {
  if (!authHeader?.startsWith("Bearer ")) return null;
  const raw   = authHeader.slice(7).trim();
  const hash  = await sha256hex(raw);

  const { data } = await sb
    .from("mcp_tokens")
    .select("id, org_id, user_id, permissions, expires_at")
    .eq("token_hash", hash)
    .maybeSingle();

  if (!data) return null;
  if (data.expires_at && new Date(data.expires_at) < new Date()) return null;

  // Touch last_used_at (fire-and-forget)
  sb.from("mcp_tokens")
    .update({ last_used_at: new Date().toISOString() })
    .eq("id", data.id)
    .then(() => {});

  return {
    tokenId:     data.id,
    orgId:       data.org_id,
    userId:      data.user_id,
    permissions: data.permissions as string[],
  };
}

// ── Tool Registry ─────────────────────────────────────────────────────────────
interface ToolDef {
  name:        string;
  description: string;
  inputSchema: Record<string, unknown>;
}

const TOOL_DEFS: ToolDef[] = [
  {
    name: "get_screens",
    description: "List all screens in the organisation with their online status, location, and branch.",
    inputSchema: {
      type: "object",
      properties: {
        online_only: { type: "boolean", description: "If true, return only online screens" },
        team_id:     { type: "string",  description: "Filter by team UUID" },
      },
    },
  },
  {
    name: "get_screen_status",
    description: "Get detailed status for a single screen: online state, current channel, firmware, last seen.",
    inputSchema: {
      type: "object",
      required: ["screen_id"],
      properties: {
        screen_id: { type: "string", description: "Screen UUID" },
      },
    },
  },
  {
    name: "get_org_summary",
    description: "Get a dashboard summary: total/online screens, running schedules, recent publishes.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "switch_screens_to_channel",
    description: "Switch one or more screens to a specific channel immediately. Optionally schedule an auto-restore time.",
    inputSchema: {
      type: "object",
      required: ["screen_ids", "channel_id"],
      properties: {
        screen_ids: {
          oneOf: [
            { type: "array",  items: { type: "string" }, description: "Array of screen UUIDs" },
            { type: "string", enum: ["all"],             description: "Pass \"all\" to switch every screen in the org" },
          ],
        },
        channel_id:  { type: "string", description: "Channel UUID to switch to" },
        restore_at:  { type: "string", description: "ISO 8601 datetime to auto-restore to previous channel" },
        note:        { type: "string", description: "Operator note recorded in audit log" },
      },
    },
  },
  {
    name: "switch_screens_to_media",
    description: "Override one or more screens to display a specific media item for a given duration.",
    inputSchema: {
      type: "object",
      required: ["screen_ids", "media_id"],
      properties: {
        screen_ids:       { oneOf: [{ type: "array", items: { type: "string" } }, { type: "string", enum: ["all"] }] },
        media_id:         { type: "string" },
        duration_minutes: { type: "number", description: "Auto-restore after N minutes" },
      },
    },
  },
  {
    name: "restore_screens",
    description: "Restore screens to their default channel, clearing any active override.",
    inputSchema: {
      type: "object",
      required: ["screen_ids"],
      properties: {
        screen_ids: { oneOf: [{ type: "array", items: { type: "string" } }, { type: "string", enum: ["all"] }] },
      },
    },
  },
  {
    name: "list_channels",
    description: "List channels in the organisation. Supports keyword search.",
    inputSchema: {
      type: "object",
      properties: {
        search:       { type: "string",  description: "Keyword to search in channel name" },
        enabled_only: { type: "boolean", description: "Return only enabled channels" },
      },
    },
  },
  {
    name: "get_channel_detail",
    description: "Get detail for a single channel including block count and total duration.",
    inputSchema: {
      type: "object",
      required: ["channel_id"],
      properties: { channel_id: { type: "string" } },
    },
  },
  {
    name: "list_schedules",
    description: "List schedules in the organisation, optionally filtered by screen.",
    inputSchema: {
      type: "object",
      properties: {
        screen_id: { type: "string", description: "Filter schedules for this screen" },
        search:    { type: "string" },
      },
    },
  },
  {
    name: "apply_schedule_to_screen",
    description: "Assign an existing schedule to a screen.",
    inputSchema: {
      type: "object",
      required: ["schedule_id", "screen_id"],
      properties: {
        schedule_id: { type: "string" },
        screen_id:   { type: "string" },
      },
    },
  },
  {
    name: "get_running_schedules",
    description: "Get all schedules currently marked as active for this organisation.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "search_content",
    description: "Unified keyword search across channels, schedules, and media. Use this to find content by name before switching screens.",
    inputSchema: {
      type: "object",
      required: ["query"],
      properties: {
        query: { type: "string", description: "Search keyword (supports Chinese, English, Japanese)" },
        types: {
          type: "array",
          items: { type: "string", enum: ["channel", "schedule", "media"] },
          description: "Limit search to specific content types",
        },
      },
    },
  },
  {
    name: "list_media",
    description: "List media items in the organisation's media library.",
    inputSchema: {
      type: "object",
      properties: {
        type:   { type: "string", enum: ["image", "video", "design", "widget"], description: "Filter by media type" },
        search: { type: "string" },
        limit:  { type: "number", default: 30 },
      },
    },
  },
  {
    name: "emergency_broadcast",
    description: "Immediately override all (or selected) screens with emergency content for a fixed duration, then auto-restore.",
    inputSchema: {
      type: "object",
      required: ["screen_ids", "channel_id", "duration_minutes"],
      properties: {
        screen_ids:       { oneOf: [{ type: "array", items: { type: "string" } }, { type: "string", enum: ["all"] }] },
        channel_id:       { type: "string", description: "Channel to broadcast" },
        duration_minutes: { type: "number" },
        reason:           { type: "string" },
      },
    },
  },
  {
    name: "publish_channel",
    description: "Publish a channel to one or more screens and record the action.",
    inputSchema: {
      type: "object",
      required: ["channel_id", "screen_ids"],
      properties: {
        channel_id: { type: "string" },
        screen_ids: { type: "array", items: { type: "string" } },
        note:       { type: "string" },
      },
    },
  },
  {
    name: "get_recent_publishes",
    description: "Get the most recent publish records for the organisation.",
    inputSchema: {
      type: "object",
      properties: { limit: { type: "number", default: 20 } },
    },
  },
  {
    name: "get_alerts",
    description: "Get current alerts: offline screens with duration, and any active emergency events.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "get_playback_stats",
    description: "Get playback statistics for a screen over the last N hours.",
    inputSchema: {
      type: "object",
      required: ["screen_id"],
      properties: {
        screen_id: { type: "string" },
        hours:     { type: "number", default: 24 },
      },
    },
  },
  {
    name: "get_active_overrides",
    description: "Get all currently active Smart Trigger overrides for the organisation.",
    inputSchema: {
      type: "object",
      properties: { screen_id: { type: "string" } },
    },
  },
  {
    name: "register_push_subscription",
    description: "Register this device for Web Push notifications (call after browser Notification permission is granted).",
    inputSchema: {
      type: "object",
      required: ["endpoint", "p256dh", "auth_key"],
      properties: {
        endpoint:    { type: "string", description: "Push subscription endpoint URL" },
        p256dh:      { type: "string", description: "P-256 ECDH public key (base64url)" },
        auth_key:    { type: "string", description: "Auth secret (base64url)" },
        device_name: { type: "string", description: "Friendly device label (optional)" },
      },
    },
  },
  {
    name: "unregister_push_subscription",
    description: "Remove this device from Web Push notifications.",
    inputSchema: {
      type: "object",
      required: ["endpoint"],
      properties: {
        endpoint: { type: "string" },
      },
    },
  },
  {
    name: "upload_media",
    description: "Upload an image or video file to the organisation's media library. Returns the new media item id and public URL.",
    inputSchema: {
      type: "object",
      required: ["filename", "mime_type", "base64_data"],
      properties: {
        filename:    { type: "string", description: "Original file name including extension" },
        mime_type:   { type: "string", description: "MIME type, e.g. image/jpeg, video/mp4" },
        base64_data: { type: "string", description: "Raw base64-encoded file content (no data URI prefix)" },
        file_size:   { type: "number", description: "File size in bytes (optional, for metadata)" },
        dimensions:  { type: "string", description: "WxH string, e.g. '1920x1080' (optional)" },
      },
    },
  },
];

// ── Tool Execution ─────────────────────────────────────────────────────────────

async function executeTool(
  name: string,
  args: Record<string, unknown>,
  claims: TokenClaims,
  sb: SupabaseClient,
): Promise<unknown> {
  const orgId = claims.orgId;
  const hasWrite = claims.permissions.includes("write") || claims.permissions.includes("emergency");

  // ── Helper: resolve "all" screen_ids ──────────────────────────────────────
  async function resolveScreenIds(input: string[] | string): Promise<string[]> {
    if (input !== "all") return input as string[];
    const { data } = await sb.from("screens").select("id").eq("org_id", orgId);
    return (data || []).map((r: { id: string }) => r.id);
  }

  switch (name) {

    // ── get_screens ────────────────────────────────────────────────────────
    case "get_screens": {
      let q = sb.from("screens")
        .select("id, name, branch, location, resolution, online, team_id, ip_address, firmware_version, current_channel_id, channel_override_until, updated_at")
        .eq("org_id", orgId)
        .order("branch").order("name");
      if (args.online_only) q = q.eq("online", true);
      if (args.team_id)     q = q.eq("team_id", args.team_id as string);
      const { data, error } = await q;
      if (error) throw error;
      return data;
    }

    // ── get_screen_status ──────────────────────────────────────────────────
    case "get_screen_status": {
      const { data: screen, error } = await sb.from("screens")
        .select("id, name, branch, location, online, firmware_version, ip_address, current_channel_id, channel_override_until, updated_at")
        .eq("id", args.screen_id as string)
        .eq("org_id", orgId)
        .maybeSingle();
      if (error) throw error;
      if (!screen) throw new Error("Screen not found");

      // Get current channel name
      let currentChannel = null;
      if (screen.current_channel_id) {
        const { data: ch } = await sb.from("channels")
          .select("id, name").eq("id", screen.current_channel_id).maybeSingle();
        currentChannel = ch;
      }

      // Get default subscribed channel
      const { data: subs } = await sb.from("screen_channel_subscriptions")
        .select("channel_id, is_default, channels:channel_id(name)")
        .eq("screen_id", args.screen_id as string)
        .eq("is_default", true)
        .limit(1);

      // Get footfall for this hour
      const now = new Date();
      const { data: footfall } = await sb.from("screen_footfall_patterns")
        .select("avg_footfall")
        .eq("screen_id", args.screen_id as string)
        .eq("day_of_week", now.getDay())
        .eq("hour_of_day", now.getHours())
        .maybeSingle();

      const offlineMinutes = screen.online ? 0 : Math.round((Date.now() - new Date(screen.updated_at).getTime()) / 60000);

      return {
        ...screen,
        current_channel: currentChannel,
        default_channel: subs?.[0]?.channels ?? null,
        offline_minutes: offlineMinutes,
        footfall_now:    footfall?.avg_footfall ?? null,
      };
    }

    // ── get_org_summary ───────────────────────────────────────────────────
    case "get_org_summary": {
      const [screenRes, schedRes, pubRes] = await Promise.all([
        sb.from("screens").select("id, online").eq("org_id", orgId),
        sb.from("schedules").select("id").eq("org_id", orgId),
        sb.from("publish_records")
          .select("id, channel_name, screen_name, status, created_at")
          .eq("org_id", orgId)
          .order("created_at", { ascending: false })
          .limit(1),
      ]);

      const screens   = screenRes.data || [];
      const total     = screens.length;
      const online    = screens.filter((s: { online: boolean }) => s.online).length;
      const offline   = screens.filter((s: { online: boolean }) => !s.online);

      return {
        total_screens:   total,
        online_screens:  online,
        offline_screens: offline.length,
        total_schedules: (schedRes.data || []).length,
        last_publish:    pubRes.data?.[0] ?? null,
        offline_screen_ids: offline.map((s: { id: string }) => s.id),
      };
    }

    // ── switch_screens_to_channel ─────────────────────────────────────────
    case "switch_screens_to_channel": {
      if (!hasWrite) throw new Error("write permission required");
      const screenIds = await resolveScreenIds(args.screen_ids as string[] | string);
      if (screenIds.length === 0) return { affected_count: 0 };

      const channelId = args.channel_id as string;
      const restoreAt = args.restore_at as string | undefined;

      // Verify channel belongs to this org
      const { data: ch } = await sb.from("channels")
        .select("id, name").eq("id", channelId).eq("org_id", orgId).maybeSingle();
      if (!ch) throw new Error("Channel not found in this organisation");

      // Fetch screen names for publish_records
      const { data: screenRows } = await sb.from("screens")
        .select("id, name").in("id", screenIds).eq("org_id", orgId);
      const screenMap = Object.fromEntries((screenRows || []).map((s: { id: string; name: string }) => [s.id, s.name]));

      // Update screens: set current_channel_id + optional override_until
      await sb.from("screens").update({
        current_channel_id:    channelId,
        channel_override_until: restoreAt ?? null,
      }).in("id", screenIds).eq("org_id", orgId);

      // Upsert screen_channel_subscriptions
      const subUpserts = screenIds.map((sid) => ({
        screen_id:  sid,
        channel_id: channelId,
        is_default: true,
      }));
      await sb.from("screen_channel_subscriptions")
        .upsert(subUpserts, { onConflict: "screen_id,channel_id" });

      // Insert publish_records
      const pubInserts = screenIds.map((sid) => ({
        channel_id:   channelId,
        channel_name: ch.name,
        screen_id:    sid,
        screen_name:  screenMap[sid] || sid,
        org_id:       orgId,
        status:       "playing",
        published_by: claims.userId,
      }));
      await sb.from("publish_records").insert(pubInserts);

      // ── MQTT: push switch_channel command to each screen ─────────────────
      await notifySync(orgId, screenIds);

      return {
        affected_count:    screenIds.length,
        channel_name:      ch.name,
        restore_scheduled: !!restoreAt,
        restore_at:        restoreAt ?? null,
      };
    }

    // ── switch_screens_to_media ───────────────────────────────────────────
    case "switch_screens_to_media": {
      if (!hasWrite) throw new Error("write permission required");
      const screenIds = await resolveScreenIds(args.screen_ids as string[] | string);
      if (screenIds.length === 0) return { affected_count: 0 };

      const mediaId = args.media_id as string;
      const mins    = (args.duration_minutes as number) || 0;
      const restoreAt = mins > 0 ? new Date(Date.now() + mins * 60000).toISOString() : null;

      const { data: media } = await sb.from("media_items")
        .select("id, name").eq("id", mediaId).maybeSingle();
      if (!media) throw new Error("Media item not found");

      await sb.from("screens").update({
        channel_override_until: restoreAt,
      }).in("id", screenIds).eq("org_id", orgId);

      return { affected_count: screenIds.length, media_name: media.name, restore_at: restoreAt };
    }

    // ── restore_screens ───────────────────────────────────────────────────
    case "restore_screens": {
      if (!hasWrite) throw new Error("write permission required");
      const screenIds = await resolveScreenIds(args.screen_ids as string[] | string);
      if (screenIds.length === 0) return { restored_count: 0 };

      await sb.from("screens").update({
        current_channel_id:    null,
        channel_override_until: null,
      }).in("id", screenIds).eq("org_id", orgId);

      // ── MQTT: tell restored screens to sync immediately ───────────────────
      await notifySync(orgId, screenIds);

      return { restored_count: screenIds.length };
    }

    // ── list_channels ─────────────────────────────────────────────────────
    case "list_channels": {
      let q = sb.from("channels")
        .select("id, name, color, enabled, sort_order, team_id")
        .eq("org_id", orgId)
        .order("sort_order", { ascending: true });
      if (args.enabled_only) q = q.eq("enabled", true);
      if (args.search) q = q.ilike("name", `%${args.search}%`);
      const { data, error } = await q;
      if (error) throw error;
      return data;
    }

    // ── get_channel_detail ────────────────────────────────────────────────
    case "get_channel_detail": {
      const { data: ch, error } = await sb.from("channels")
        .select("id, name, color, enabled, sort_order, team_id, created_at, updated_at")
        .eq("id", args.channel_id as string)
        .eq("org_id", orgId)
        .maybeSingle();
      if (error) throw error;
      if (!ch) throw new Error("Channel not found");

      const { count: blockCount } = await sb.from("channel_blocks")
        .select("id", { count: "exact", head: true })
        .eq("channel_id", args.channel_id as string);

      return { ...ch, blocks_count: blockCount ?? 0 };
    }

    // ── list_schedules ────────────────────────────────────────────────────
    case "list_schedules": {
      let q = sb.from("schedules")
        .select("id, name, org_id, screen_id, screens:screen_id(name)")
        .eq("org_id", orgId)
        .order("name");
      if (args.screen_id) q = q.eq("screen_id", args.screen_id as string);
      if (args.search)    q = q.ilike("name", `%${args.search}%`);
      const { data, error } = await q;
      if (error) throw error;
      return data;
    }

    // ── apply_schedule_to_screen ──────────────────────────────────────────
    case "apply_schedule_to_screen": {
      if (!hasWrite) throw new Error("write permission required");

      // Verify schedule belongs to org
      const { data: sched } = await sb.from("schedules")
        .select("id, name").eq("id", args.schedule_id as string).eq("org_id", orgId).maybeSingle();
      if (!sched) throw new Error("Schedule not found in this organisation");

      // Verify screen belongs to org
      const { data: scr } = await sb.from("screens")
        .select("id, name").eq("id", args.screen_id as string).eq("org_id", orgId).maybeSingle();
      if (!scr) throw new Error("Screen not found in this organisation");

      const { error } = await sb.from("schedules")
        .update({ screen_id: args.screen_id as string }).eq("id", args.schedule_id as string);
      if (error) throw error;

      return { ok: true, schedule_name: sched.name, screen_name: scr.name };
    }

    // ── get_running_schedules ─────────────────────────────────────────────
    case "get_running_schedules": {
      const { data, error } = await sb.from("schedules")
        .select("id, name, screen_id, screens:screen_id(name, online)")
        .eq("org_id", orgId)
        .not("screen_id", "is", null);
      if (error) throw error;
      return data;
    }

    // ── search_content ────────────────────────────────────────────────────
    case "search_content": {
      const q      = `%${args.query}%`;
      const types  = (args.types as string[] | undefined) ?? ["channel", "schedule", "media"];
      const results: Record<string, unknown[]> = {};

      await Promise.all([
        types.includes("channel") && sb.from("channels")
          .select("id, name, color, enabled").eq("org_id", orgId).ilike("name", q).limit(10)
          .then(({ data }) => { results.channels = data ?? []; }),

        types.includes("schedule") && sb.from("schedules")
          .select("id, name, screen_id").eq("org_id", orgId).ilike("name", q).limit(10)
          .then(({ data }) => { results.schedules = data ?? []; }),

        types.includes("media") && sb.from("media_items")
          .select("id, name, type, url, thumbnail").eq("org_id", orgId).ilike("name", q).limit(10)
          .then(({ data }) => { results.media = data ?? []; }),
      ]);

      return results;
    }

    // ── list_media ────────────────────────────────────────────────────────
    case "list_media": {
      const limit = Math.min((args.limit as number) || 30, 100);
      let q = sb.from("media_items")
        .select("id, name, type, url, thumbnail, size_bytes, created_at")
        .eq("org_id", orgId)
        .is("deleted_at", null)
        .order("created_at", { ascending: false })
        .limit(limit);
      if (args.type)   q = q.eq("type", args.type as string);
      if (args.search) q = q.ilike("name", `%${args.search}%`);
      const { data, error } = await q;
      if (error) throw error;
      return data;
    }

    // ── emergency_broadcast ───────────────────────────────────────────────
    case "emergency_broadcast": {
      if (!claims.permissions.includes("emergency") && !claims.permissions.includes("write")) {
        throw new Error("emergency permission required");
      }
      const screenIds  = await resolveScreenIds(args.screen_ids as string[] | string);
      const channelId  = args.channel_id as string;
      const mins       = (args.duration_minutes as number);
      const restoreAt  = new Date(Date.now() + mins * 60000).toISOString();

      const { data: ch } = await sb.from("channels")
        .select("id, name").eq("id", channelId).eq("org_id", orgId).maybeSingle();
      if (!ch) throw new Error("Channel not found");

      const { data: screenRows } = await sb.from("screens")
        .select("id, name").in("id", screenIds).eq("org_id", orgId);
      const screenMap = Object.fromEntries((screenRows || []).map((s: { id: string; name: string }) => [s.id, s.name]));

      await sb.from("screens").update({
        current_channel_id:    channelId,
        channel_override_until: restoreAt,
      }).in("id", screenIds).eq("org_id", orgId);

      await sb.from("publish_records").insert(
        screenIds.map((sid) => ({
          channel_id:   channelId,
          channel_name: ch.name,
          screen_id:    sid,
          screen_name:  screenMap[sid] || sid,
          org_id:       orgId,
          status:       "playing",
          published_by: claims.userId,
        }))
      );

      // Log as notification
      await sb.from("notification_log").insert({
        org_id:      orgId,
        type:        "emergency_broadcast",
        payload:     { channel_id: channelId, screen_ids: screenIds, reason: args.reason, restore_at: restoreAt },
      });

      // ── MQTT: push switch_channel command to all affected screens ─────────
      await orgBroadcast(orgId, screenIds, "content", "switch_channel", {
        channel_id: channelId,
        restore_at: restoreAt,
        reason:     args.reason ?? "",
      });

      return {
        affected_count: screenIds.length,
        channel_name:   ch.name,
        expires_at:     restoreAt,
      };
    }

    // ── publish_channel ───────────────────────────────────────────────────
    case "publish_channel": {
      if (!hasWrite) throw new Error("write permission required");
      const screenIds  = args.screen_ids as string[];
      const channelId  = args.channel_id as string;

      const { data: ch } = await sb.from("channels")
        .select("id, name").eq("id", channelId).eq("org_id", orgId).maybeSingle();
      if (!ch) throw new Error("Channel not found");

      const { data: screenRows } = await sb.from("screens")
        .select("id, name").in("id", screenIds).eq("org_id", orgId);
      const screenMap = Object.fromEntries((screenRows || []).map((s: { id: string; name: string }) => [s.id, s.name]));

      const inserts = screenIds.map((sid) => ({
        channel_id:   channelId,
        channel_name: ch.name,
        screen_id:    sid,
        screen_name:  screenMap[sid] || sid,
        org_id:       orgId,
        status:       "playing",
        published_by: claims.userId,
      }));
      const { data: inserted, error } = await sb.from("publish_records").insert(inserts).select("id");
      if (error) throw error;

      // ── MQTT: notify each published screen to sync immediately ─────────────
      await notifySync(orgId, screenIds);

      return { published_count: inserted?.length ?? 0, channel_name: ch.name };
    }

    // ── get_recent_publishes ──────────────────────────────────────────────
    case "get_recent_publishes": {
      const limit = Math.min((args.limit as number) || 20, 50);
      const { data, error } = await sb.from("publish_records")
        .select("id, channel_name, screen_name, status, scheduled_at, created_at, published_by")
        .eq("org_id", orgId)
        .order("created_at", { ascending: false })
        .limit(limit);
      if (error) throw error;
      return data;
    }

    // ── get_alerts ────────────────────────────────────────────────────────
    case "get_alerts": {
      const { data: screens } = await sb.from("screens")
        .select("id, name, branch, location, online, updated_at")
        .eq("org_id", orgId);

      const now = Date.now();
      const offlineScreens = (screens || [])
        .filter((s: { online: boolean }) => !s.online)
        .map((s: { id: string; name: string; branch: string; location: string; online: boolean; updated_at: string }) => ({
          id:               s.id,
          name:             s.name,
          branch:           s.branch,
          location:         s.location,
          offline_minutes:  Math.round((now - new Date(s.updated_at).getTime()) / 60000),
        }));

      // Get footfall context for offline screens
      const dayOfWeek = new Date().getDay();
      const hourOfDay = new Date().getHours();
      const offlineIds = offlineScreens.map((s: { id: string }) => s.id);
      if (offlineIds.length > 0) {
        const { data: fp } = await sb.from("screen_footfall_patterns")
          .select("screen_id, avg_footfall")
          .in("screen_id", offlineIds)
          .eq("day_of_week", dayOfWeek)
          .eq("hour_of_day", hourOfDay);
        const fpMap = Object.fromEntries((fp || []).map((f: { screen_id: string; avg_footfall: number }) => [f.screen_id, f.avg_footfall]));
        for (const s of offlineScreens) {
          (s as Record<string, unknown>).footfall_now = fpMap[s.id] ?? 0;
        }
      }

      return {
        offline_screens: offlineScreens,
        alert_count:     offlineScreens.length,
      };
    }

    // ── get_playback_stats ────────────────────────────────────────────────
    case "get_playback_stats": {
      const hours   = (args.hours as number) || 24;
      const since   = new Date(Date.now() - hours * 3600000).toISOString();

      const { data: logs } = await sb.from("playback_logs")
        .select("id, channel_id, channel_name, played_at")
        .eq("screen_id", args.screen_id as string)
        .gte("played_at", since)
        .order("played_at", { ascending: false });

      const total       = (logs || []).length;
      const channelFreq: Record<string, number> = {};
      for (const l of logs || []) {
        const key = (l as { channel_name?: string }).channel_name || "unknown";
        channelFreq[key] = (channelFreq[key] || 0) + 1;
      }
      const mostPlayed = Object.entries(channelFreq).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;

      return { total_plays: total, most_played_channel: mostPlayed, hours, breakdown: channelFreq };
    }

    // ── get_active_overrides ──────────────────────────────────────────────
    case "get_active_overrides": {
      let q = sb.from("screen_smart_trigger_overrides")
        .select("id, screen_id, rule_id, overrides_enabled, created_at, screens:screen_id(name, org_id)")
        .eq("screens.org_id", orgId);
      if (args.screen_id) q = q.eq("screen_id", args.screen_id as string);
      const { data, error } = await q;
      if (error) throw error;
      return data;
    }

    // ── register_push_subscription ────────────────────────────────────────
    case "register_push_subscription": {
      const { error } = await sb.from("push_subscriptions").upsert({
        user_id:     claims.userId,
        org_id:      orgId,
        endpoint:    args.endpoint as string,
        p256dh:      args.p256dh  as string,
        auth_key:    args.auth_key as string,
        device_name: (args.device_name as string | undefined) ?? null,
      }, { onConflict: "user_id,endpoint" });
      if (error) throw error;
      return { ok: true };
    }

    // ── unregister_push_subscription ──────────────────────────────────────
    case "unregister_push_subscription": {
      const { error } = await sb.from("push_subscriptions")
        .delete()
        .eq("user_id", claims.userId)
        .eq("endpoint", args.endpoint as string);
      if (error) throw error;
      return { ok: true };
    }

    // ── upload_media ───────────────────────────────────────────────────────
    case "upload_media": {
      if (!args.filename)    throw new Error("filename is required");
      if (!args.mime_type)   throw new Error("mime_type is required");
      if (!args.base64_data) throw new Error("base64_data is required");

      const filename  = args.filename  as string;
      const mimeType  = args.mime_type as string;
      const b64       = (args.base64_data as string).replace(/^data:[^;]+;base64,/, "");
      const fileSize  = (args.file_size as number | undefined) ?? 0;
      const dims      = (args.dimensions as string | undefined) ?? "unknown";

      // Decode base64 → Uint8Array
      const binary = atob(b64);
      const bytes  = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);

      // Unique storage key: orgId/timestamp_random.ext
      const ext     = filename.split(".").pop()?.toLowerCase() ?? "bin";
      const fileKey = `${orgId}/${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`;

      const { error: uploadError } = await sb.storage
        .from("media")
        .upload(fileKey, bytes, { contentType: mimeType, upsert: false });
      if (uploadError) throw new Error(uploadError.message);

      const { data: urlData } = sb.storage.from("media").getPublicUrl(fileKey);
      const publicUrl = urlData.publicUrl;

      const mediaType = mimeType.startsWith("video/") ? "video" : "image";
      const baseName  = filename.replace(/\.[^.]+$/, "");

      const { data: item, error: insertError } = await sb.from("media_items").insert({
        org_id:        orgId,
        name:          baseName,
        type:          mediaType,
        url:           publicUrl,
        thumbnail:     publicUrl,
        size:          String(fileSize || bytes.length),
        dimensions:    dims,
        is_system:     false,
        uploaded_by:   claims.userId,
        original_name: filename,
        mime_type:     mimeType,
        size_bytes:    fileSize || bytes.length,
        storage_path:  fileKey,
      }).select("id, name, url").single();
      if (insertError) throw new Error(insertError.message);

      return { id: item.id, name: item.name, url: item.url };
    }

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

// ── Audit log writer ──────────────────────────────────────────────────────────
async function writeAudit(
  sb: SupabaseClient,
  claims: TokenClaims,
  toolName: string,
  params: unknown,
  result: unknown,
  durationMs: number,
) {
  await sb.from("mcp_audit_log").insert({
    org_id:      claims.orgId,
    user_id:     claims.userId,
    token_id:    claims.tokenId,
    tool_name:   toolName,
    params:      params,
    result:      result,
    duration_ms: durationMs,
  }).then(() => {});
}

// ── Main Handler ──────────────────────────────────────────────────────────────
// ── OAuth 2.0 helpers ─────────────────────────────────────────────────────────
function getMcpBase(req: Request): string {
  // Supabase edge functions are called via an internal URL that strips /functions/v1.
  // Always reconstruct the canonical HTTPS public URL.
  // If the user added a token in the path (e.g. /signcms-mcp/{64-hex-token}),
  // include it in the base so all OAuth discovery URLs carry the same token prefix.
  const parsed  = new URL(req.url);
  const host    = parsed.host;
  const HEX64   = /^\/([0-9a-f]{64})(\/|$)/i;
  const m       = parsed.pathname.match(HEX64);
  const token   = m ? `/${m[1]}` : "";
  return `https://${host}/functions/v1/signcms-mcp${token}`;
}

// Extract a 64-hex token embedded in the request path (the "token-in-URL" flow).
function tokenFromPath(req: Request): string | null {
  const HEX64 = /^\/([0-9a-f]{64})(\/|$)/i;
  const m = new URL(req.url).pathname.match(HEX64);
  return m ? m[1] : null;
}

function htmlResponse(body: string, status = 200) {
  return new Response(body, { status, headers: { ...CORS, "Content-Type": "text/html; charset=utf-8" } });
}

function authorizePageHtml(params: {
  base: string; redirectUri: string; state: string;
  clientId: string; codeChallenge: string; error?: string;
}) {
  const esc = (s: string) => s.replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return `<!DOCTYPE html>
<html lang="zh-TW">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>SignCMS — 授權 MCP 連線</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:system-ui,-apple-system,sans-serif;background:#0f172a;color:#f1f5f9;display:flex;align-items:center;justify-content:center;min-height:100vh;padding:16px}
.card{background:#1e293b;border-radius:16px;padding:36px 32px;max-width:420px;width:100%;box-shadow:0 8px 32px rgba(0,0,0,.5)}
.logo{font-size:1.5rem;font-weight:700;color:#38bdf8;margin-bottom:8px}
.sub{font-size:.875rem;color:#94a3b8;margin-bottom:28px;line-height:1.5}
label{display:block;font-size:.8rem;color:#94a3b8;font-weight:500;margin-bottom:6px;text-transform:uppercase;letter-spacing:.05em}
input{width:100%;padding:11px 14px;border:1.5px solid #334155;border-radius:10px;background:#0f172a;color:#f1f5f9;font-size:.875rem;font-family:monospace;transition:border .15s}
input:focus{outline:none;border-color:#38bdf8}
.hint{font-size:.75rem;color:#64748b;margin-top:8px;line-height:1.4}
btn{display:block;width:100%;padding:12px;background:#38bdf8;color:#0f172a;border:none;border-radius:10px;font-size:.9rem;font-weight:700;cursor:pointer;margin-top:20px;transition:background .15s}
button:hover{background:#7dd3fc}
.err{color:#f87171;background:#450a0a30;border:1px solid #f8717140;padding:10px 14px;border-radius:8px;font-size:.85rem;margin-bottom:18px}
</style>
</head>
<body>
<div class="card">
  <div class="logo">📺 SignCMS</div>
  <p class="sub">Claude 正在請求存取您的 SignCMS 組織。<br>請輸入在「系統設定 → MCP 金鑰」產生的 Token。</p>
  ${params.error ? `<div class="err">⚠️ ${esc(params.error)}</div>` : ""}
  <form method="POST" action="${esc(params.base)}/oauth/authorize">
    <input type="hidden" name="redirect_uri"    value="${esc(params.redirectUri)}">
    <input type="hidden" name="state"           value="${esc(params.state)}">
    <input type="hidden" name="client_id"       value="${esc(params.clientId)}">
    <input type="hidden" name="code_challenge"  value="${esc(params.codeChallenge)}">
    <label>MCP Token</label>
    <input type="text" name="token" placeholder="貼上您的 MCP Token…" autocomplete="off" required autofocus>
    <p class="hint">Token 從 SignCMS 系統設定 → MCP 金鑰 分頁產生，僅顯示一次。</p>
    <button type="submit">✓ 授權連線</button>
  </form>
</div>
</body>
</html>`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });

  const reqUrl  = new URL(req.url);
  const reqPath = reqUrl.pathname;
  const method  = req.method;

  // Lazily created service client (only when needed for DB access)
  const sbService = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // ══════════════════════════════════════════════════════════════════════════
  // OAuth 2.0  (Authorization Code + PKCE)
  // Required for Claude.ai web connector — no static Bearer token UI exists
  // ══════════════════════════════════════════════════════════════════════════

  // ── 1a. OAuth Protected Resource Metadata (RFC 9728) ────────────────────
  // Claude.ai reads this after receiving 401 + WWW-Authenticate: Bearer resource_metadata=
  if (reqPath.includes("/.well-known/oauth-protected-resource")) {
    const base = getMcpBase(req);
    return json({
      resource:             base,
      authorization_servers: [base],
      scopes_supported:     ["mcp"],
    });
  }

  // ── 1b. OAuth Authorization Server Metadata (RFC 8414) ───────────────────
  if (reqPath.includes("/.well-known/oauth-authorization-server")) {
    const base = getMcpBase(req);
    return json({
      issuer:                                base,
      authorization_endpoint:               `${base}/oauth/authorize`,
      token_endpoint:                        `${base}/oauth/token`,
      registration_endpoint:                 `${base}/register`,
      response_types_supported:             ["code"],
      grant_types_supported:                ["authorization_code"],
      code_challenge_methods_supported:     ["S256", "plain"],
      token_endpoint_auth_methods_supported: ["none"],
      scopes_supported:                     ["mcp"],
    });
  }

  // ── 2. Dynamic Client Registration (RFC 7591) ─────────────────────────────
  // Claude.ai calls /register with its redirect_uris; we must echo them back
  // so Claude proceeds to open the authorization page.
  if (method === "POST" && reqPath.endsWith("/register")) {
    const now = Math.floor(Date.now() / 1000);
    let regBody: Record<string, unknown> = {};
    try { regBody = await req.clone().json(); } catch { /* ignore parse errors */ }
    const redirectUris: string[] = Array.isArray(regBody.redirect_uris)
      ? regBody.redirect_uris as string[]
      : [];
    return json({
      client_id:                  crypto.randomUUID(),
      client_id_issued_at:        now,
      client_secret_expires_at:   0,
      token_endpoint_auth_method: "none",
      grant_types:                Array.isArray(regBody.grant_types)   ? regBody.grant_types   : ["authorization_code"],
      response_types:             Array.isArray(regBody.response_types) ? regBody.response_types : ["code"],
      redirect_uris:              redirectUris,
      ...(regBody.client_name ? { client_name: regBody.client_name } : {}),
      ...(regBody.scope       ? { scope:        regBody.scope       } : {}),
    }, 201);
  }

  // ── 3a. Authorization endpoint — GET ─────────────────────────────────────
  if (method === "GET" && reqPath.endsWith("/oauth/authorize")) {
    const p            = reqUrl.searchParams;
    const redirectUri  = p.get("redirect_uri")   ?? "";
    const state        = p.get("state")          ?? "";
    const clientId     = p.get("client_id")      ?? "";
    const codeChallenge = p.get("code_challenge") ?? "";

    // ── Fast path A: token embedded in the MCP server URL path ───────────────
    // e.g. user added https://…/signcms-mcp/{token} as the MCP server URL.
    // No user interaction needed — OAuth completes automatically.
    const pathToken  = tokenFromPath(req);
    // ── Fast path B: token appended as ?token= query param (manual link) ─────
    const queryToken = (p.get("token") ?? "").trim();

    const autoToken  = pathToken ?? (queryToken || null);

    if (autoToken) {
      const hash = await sha256hex(autoToken);
      const { data: tokenRow } = await sbService
        .from("mcp_tokens")
        .select("id, expires_at")
        .eq("token_hash", hash)
        .maybeSingle();

      if (!tokenRow || (tokenRow.expires_at && new Date(tokenRow.expires_at) < new Date())) {
        return json({ error: "invalid_token", error_description: "MCP token invalid or expired. Regenerate in SignCMS → Settings → MCP Keys." }, 400);
      }

      // Token valid → issue code = token, redirect to Claude.ai callback
      const redirectTo = new URL(redirectUri || "https://claude.ai/api/mcp/auth_callback");
      redirectTo.searchParams.set("code",  autoToken);
      redirectTo.searchParams.set("state", state);
      return new Response(null, {
        status: 302,
        headers: { ...CORS, Location: redirectTo.toString() },
      });
    }

    // ── Default: render the interactive token-entry form ──────────────────────
    return htmlResponse(authorizePageHtml({
      base: getMcpBase(req), redirectUri, state, clientId, codeChallenge,
    }));
  }

  // ── 3b. Authorization endpoint — validate token, issue code (POST) ────────
  if (method === "POST" && reqPath.endsWith("/oauth/authorize")) {
    let formRedirectUri = "", formState = "", formClientId = "", formCodeChallenge = "", formToken = "";
    try {
      const ct = req.headers.get("content-type") ?? "";
      if (ct.includes("application/x-www-form-urlencoded")) {
        const fd = new URLSearchParams(await req.text());
        formRedirectUri   = fd.get("redirect_uri")   ?? "";
        formState         = fd.get("state")          ?? "";
        formClientId      = fd.get("client_id")      ?? "";
        formCodeChallenge = fd.get("code_challenge")  ?? "";
        formToken         = (fd.get("token") ?? "").trim();
      } else {
        const body = await req.json() as Record<string, string>;
        formRedirectUri   = body.redirect_uri   ?? "";
        formState         = body.state          ?? "";
        formClientId      = body.client_id      ?? "";
        formCodeChallenge = body.code_challenge ?? "";
        formToken         = (body.token ?? "").trim();
      }
    } catch {
      return htmlResponse(authorizePageHtml({
        base: getMcpBase(req), redirectUri: "", state: "", clientId: "", codeChallenge: "",
        error: "請求格式無效，請重試。",
      }), 400);
    }

    if (!formToken) {
      return htmlResponse(authorizePageHtml({
        base: getMcpBase(req), redirectUri: formRedirectUri, state: formState,
        clientId: formClientId, codeChallenge: formCodeChallenge, error: "請輸入 MCP Token。",
      }), 400);
    }

    // Validate token exists in DB
    const hash = await sha256hex(formToken);
    const { data: tokenRow } = await sbService
      .from("mcp_tokens")
      .select("id, expires_at")
      .eq("token_hash", hash)
      .maybeSingle();

    if (!tokenRow) {
      return htmlResponse(authorizePageHtml({
        base: getMcpBase(req), redirectUri: formRedirectUri, state: formState,
        clientId: formClientId, codeChallenge: formCodeChallenge, error: "Token 無效，請確認後重試。",
      }), 400);
    }
    if (tokenRow.expires_at && new Date(tokenRow.expires_at) < new Date()) {
      return htmlResponse(authorizePageHtml({
        base: getMcpBase(req), redirectUri: formRedirectUri, state: formState,
        clientId: formClientId, codeChallenge: formCodeChallenge, error: "Token 已過期，請重新產生。",
      }), 400);
    }

    // Issue auth code = raw token (transported securely over HTTPS)
    const redirectTo = new URL(formRedirectUri);
    redirectTo.searchParams.set("code",  formToken);
    redirectTo.searchParams.set("state", formState);
    return new Response(null, {
      status: 302,
      headers: { ...CORS, Location: redirectTo.toString() },
    });
  }

  // ── 4. Token endpoint — exchange code for access_token ───────────────────
  if (method === "POST" && reqPath.endsWith("/oauth/token")) {
    let grantType = "", code = "";
    try {
      const ct = req.headers.get("content-type") ?? "";
      if (ct.includes("application/x-www-form-urlencoded")) {
        const fd = new URLSearchParams(await req.text());
        grantType = fd.get("grant_type") ?? "";
        code      = (fd.get("code") ?? "").trim();
      } else {
        const body = await req.json() as Record<string, string>;
        grantType = body.grant_type ?? "";
        code      = (body.code ?? "").trim();
      }
    } catch {
      return json({ error: "invalid_request" }, 400);
    }

    if (grantType !== "authorization_code") {
      return json({ error: "unsupported_grant_type" }, 400);
    }
    if (!code) {
      return json({ error: "invalid_request", error_description: "missing code" }, 400);
    }

    // Validate code (= MCP token)
    const hash = await sha256hex(code);
    const { data: tokenRow } = await sbService
      .from("mcp_tokens")
      .select("id, expires_at")
      .eq("token_hash", hash)
      .maybeSingle();

    if (!tokenRow || (tokenRow.expires_at && new Date(tokenRow.expires_at) < new Date())) {
      return json({ error: "invalid_grant" }, 400);
    }

    // Touch last_used_at
    sbService.from("mcp_tokens").update({ last_used_at: new Date().toISOString() })
      .eq("id", tokenRow.id).then(() => {});

    return json({
      access_token: code,            // The MCP token is used directly as access_token
      token_type:   "Bearer",
      expires_in:   365 * 24 * 3600, // 1 year (matches MCP token lifetime)
    });
  }

  // ══════════════════════════════════════════════════════════════════════════
  // Existing MCP / utility routes
  // ══════════════════════════════════════════════════════════════════════════

  if (method !== "POST" && method !== "GET") {
    return json({ error: "Method not allowed" }, 405);
  }

  // ── GET / → capability discovery ─────────────────────────────────────────
  // ── 1c. OpenID Connect Discovery (RFC 8414 / OIDC Core §4) ─────────────────
  // Claude.ai tries this path as a fallback when looking for auth server metadata
  if (method === "GET" && reqPath.includes("/.well-known/openid-configuration")) {
    const base = getMcpBase(req);
    return json({
      issuer:                                base,
      authorization_endpoint:               `${base}/oauth/authorize`,
      token_endpoint:                        `${base}/oauth/token`,
      registration_endpoint:                 `${base}/register`,
      response_types_supported:             ["code"],
      grant_types_supported:                ["authorization_code"],
      code_challenge_methods_supported:     ["S256", "plain"],
      token_endpoint_auth_methods_supported: ["none"],
      scopes_supported:                     ["mcp"],
      subject_types_supported:              ["public"],
      id_token_signing_alg_values_supported: ["RS256"],
    });
  }

  if (method === "GET") {
    return json({
      name:        "signcms-mcp",
      version:     "1.0.0",
      description: "SignCMS MCP Server — Digital Signage Management Tools",
      tools_count: TOOL_DEFS.length,
    });
  }

  // ── POST /llm → LLM proxy (bypasses browser CORS for Anthropic/etc.) ─────
  if (method === "POST" && reqPath.endsWith("/llm")) {
    const proxyClaims = await authenticate(req.headers.get("authorization"), sbService);
    if (!proxyClaims) return rpcError(null, -32001, "Unauthorized");

    let proxyBody: Record<string, unknown>;
    try { proxyBody = await req.json(); } catch { return json({ error: "Parse error" }, 400); }

    const { provider, api_key, model, messages, system, tools } = proxyBody as {
      provider: string;
      api_key:  string;
      model:    string;
      messages: unknown[];
      system?:  string;
      tools?:   unknown[];
    };

    if (!provider || !api_key || !model || !messages) {
      return json({ error: "Missing required fields: provider, api_key, model, messages" }, 400);
    }

    if (provider === "anthropic") {
      const upstream: Record<string, unknown> = {
        model,
        max_tokens: 4096,
        stream:     true,
        messages,
      };
      if (system)        upstream.system = system;
      if (tools?.length) upstream.tools  = tools;

      const upstreamRes = await fetch("https://api.anthropic.com/v1/messages", {
        method:  "POST",
        headers: {
          "Content-Type":      "application/json",
          "x-api-key":         api_key,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify(upstream),
      });

      if (!upstreamRes.ok) {
        return new Response(await upstreamRes.text(), {
          status:  upstreamRes.status,
          headers: { ...CORS, "Content-Type": "text/plain" },
        });
      }

      return new Response(upstreamRes.body, {
        headers: { ...CORS, "Content-Type": "text/event-stream", "Cache-Control": "no-cache" },
      });
    }

    return json({ error: `Unsupported provider: ${provider}` }, 400);
  }

  // ── Authenticate ──────────────────────────────────────────────────────────
  // Return HTTP 401 (not 200) so Claude triggers the OAuth flow instead of
  // treating auth failure as "server unreachable".
  const claims = await authenticate(req.headers.get("authorization"), sbService);
  if (!claims) {
    const base = getMcpBase(req);
    return new Response(JSON.stringify({ error: "unauthorized", error_description: "Valid MCP token required" }), {
      status: 401,
      headers: {
        ...CORS,
        "Content-Type": "application/json",
        "WWW-Authenticate": `Bearer realm="${base}", resource_metadata="${base}/.well-known/oauth-protected-resource"`,
      },
    });
  }

  // ── Parse JSON-RPC body ───────────────────────────────────────────────────
  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return rpcError(null, -32700, "Parse error"); }

  if (body.jsonrpc !== "2.0") return rpcError(body.id, -32600, "Invalid JSON-RPC version");
  const rpcMethod = body.method as string;
  const params    = (body.params as Record<string, unknown>) || {};
  const id        = body.id;

  // ── Method dispatch ───────────────────────────────────────────────────────
  if (rpcMethod === "initialize") {
    return rpcOk(id, {
      protocolVersion:     "2024-11-05",
      serverInfo:          { name: "signcms-mcp", version: "1.0.0" },
      capabilities:        { tools: { listChanged: false } },
      instructions:        "You are a SignCMS digital signage management assistant. Use tools to read screen status, switch content, and publish channels. Always confirm before bulk-switching all screens.",
    });
  }

  if (rpcMethod === "tools/list") {
    return rpcOk(id, { tools: TOOL_DEFS });
  }

  if (rpcMethod === "tools/call") {
    const toolName = params.name as string;
    const toolArgs = (params.arguments as Record<string, unknown>) || {};
    if (!toolName) return rpcError(id, -32602, "Missing tool name");

    const knownTool = TOOL_DEFS.find((t) => t.name === toolName);
    if (!knownTool) return rpcError(id, -32602, `Unknown tool: ${toolName}`);

    const t0 = Date.now();
    try {
      const result = await executeTool(toolName, toolArgs, claims, sbService);
      const ms     = Date.now() - t0;
      writeAudit(sbService, claims, toolName, toolArgs, result, ms);
      return rpcOk(id, {
        content: [{ type: "text", text: JSON.stringify(result) }],
      });
    } catch (err: unknown) {
      const msg = err instanceof Error
        ? err.message
        : (err as { message?: string })?.message ?? String(err);
      writeAudit(sbService, claims, toolName, toolArgs, { error: msg }, Date.now() - t0);
      return rpcError(id, -32603, msg);
    }
  }

  return rpcError(id, -32601, `Method not found: ${rpcMethod}`);
});
