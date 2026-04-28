import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";

export interface Channel {
  id: string;
  org_id: string;
  name: string;
  description: string;
  color: string;
  bgm_volume: number;
  enabled: boolean;
  default_design_project_id: string | null;
  sort_order: number;
  team_id: string | null;
  collab_scope: "creator" | "team" | "org";
  created_at: string;
  updated_at: string;
}

export function useChannels(orgId: string | null) {
  const [channels, setChannels] = useState<Channel[]>([]);
  const [loading, setLoading] = useState(false);

  const reload = useCallback(async () => {
    if (!orgId) {
      setChannels([]);
      return;
    }
    setLoading(true);
    const { data, error } = await (supabase as any)
      .from("channels")
      .select("*")
      .eq("org_id", orgId)
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: true });
    if (!error && data) setChannels(data as Channel[]);
    setLoading(false);
  }, [orgId]);

  useEffect(() => {
    reload();
  }, [reload]);

  return { channels, loading, reload };
}

export interface ChannelBlock {
  id: string;
  channel_id: string;
  org_id: string;
  design_project_id: string | null;
  name: string;
  color: string;
  block_type: "calendar" | "weekly";
  start_at: string | null;
  end_at: string | null;
  weekdays: string[];
  start_time: string | null;
  end_time: string | null;
  effective_from: string | null;
  effective_to: string | null;
  priority: number;
  enabled: boolean;
  created_at: string;
  updated_at: string;
}

export function useChannelBlocks(channelId: string | null) {
  const [blocks, setBlocks] = useState<ChannelBlock[]>([]);
  const [loading, setLoading] = useState(false);

  const reload = useCallback(async () => {
    if (!channelId) {
      setBlocks([]);
      return;
    }
    setLoading(true);
    const { data, error } = await (supabase as any)
      .from("channel_blocks")
      .select("*")
      .eq("channel_id", channelId)
      .order("priority", { ascending: false })
      .order("created_at", { ascending: true });
    if (!error && data) setBlocks(data as ChannelBlock[]);
    setLoading(false);
  }, [channelId]);

  useEffect(() => {
    reload();
  }, [reload]);

  return { blocks, loading, reload };
}

/** Server-expanded interval row, one per (block, day). */
export interface ChannelScheduleInterval {
  block_id: string;
  design_project_id: string | null;
  name: string;
  color: string;
  block_type: "calendar" | "weekly";
  priority: number;
  day: string;       // 'YYYY-MM-DD' (calendar date in DB UTC; rendered as-is)
  start_min: number; // minutes from start of day
  end_min: number;   // minutes from start of day
}

/**
 * Fetch schedule intervals expanded server-side, with TZ-aware "past" filtering.
 * Pass the user-selected IANA timezone (e.g. "Asia/Taipei") plus a [from,to) window.
 */
export function useChannelScheduleIntervals(
  channelId: string | null,
  tz: string,
  from: Date | null,
  to: Date | null,
) {
  const [intervals, setIntervals] = useState<ChannelScheduleInterval[]>([]);
  const [loading, setLoading] = useState(false);

  const fromIso = from ? from.toISOString() : null;
  const toIso = to ? to.toISOString() : null;

  const reload = useCallback(async () => {
    if (!channelId || !fromIso || !toIso) {
      setIntervals([]);
      return;
    }
    setLoading(true);
    const { data, error } = await (supabase as any).rpc("get_channel_schedule_intervals", {
      _channel_id: channelId,
      _tz: tz || "UTC",
      _from: fromIso,
      _to: toIso,
    });
    if (!error && Array.isArray(data)) setIntervals(data as ChannelScheduleInterval[]);
    else if (error) setIntervals([]);
    setLoading(false);
  }, [channelId, tz, fromIso, toIso]);

  useEffect(() => {
    reload();
  }, [reload]);

  return { intervals, loading, reload };
}