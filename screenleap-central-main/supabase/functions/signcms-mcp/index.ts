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
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "POST" && req.method !== "GET") {
    return json({ error: "Method not allowed" }, 405);
  }

  const sbService = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // ── GET / → capability discovery ─────────────────────────────────────────
  if (req.method === "GET") {
    return json({
      name:        "signcms-mcp",
      version:     "1.0.0",
      description: "SignCMS MCP Server — Digital Signage Management Tools",
      tools_count: TOOL_DEFS.length,
    });
  }

  // ── Authenticate ──────────────────────────────────────────────────────────
  const claims = await authenticate(req.headers.get("authorization"), sbService);
  if (!claims) return rpcError(null, -32001, "Unauthorized — invalid or expired MCP token");

  // ── Parse JSON-RPC body ───────────────────────────────────────────────────
  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return rpcError(null, -32700, "Parse error"); }

  if (body.jsonrpc !== "2.0") return rpcError(body.id, -32600, "Invalid JSON-RPC version");
  const method = body.method as string;
  const params = (body.params as Record<string, unknown>) || {};
  const id     = body.id;

  // ── Method dispatch ───────────────────────────────────────────────────────
  if (method === "initialize") {
    return rpcOk(id, {
      protocolVersion:     "2024-11-05",
      serverInfo:          { name: "signcms-mcp", version: "1.0.0" },
      capabilities:        { tools: { listChanged: false } },
      instructions:        "You are a SignCMS digital signage management assistant. Use tools to read screen status, switch content, and publish channels. Always confirm before bulk-switching all screens.",
    });
  }

  if (method === "tools/list") {
    return rpcOk(id, { tools: TOOL_DEFS });
  }

  if (method === "tools/call") {
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
      const msg = err instanceof Error ? err.message : String(err);
      writeAudit(sbService, claims, toolName, toolArgs, { error: msg }, Date.now() - t0);
      return rpcError(id, -32603, msg);
    }
  }

  return rpcError(id, -32601, `Method not found: ${method}`);
});
