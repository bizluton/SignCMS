/**
 * notify-screen
 *
 * Internal edge function called by the admin UI (and CI pipelines) after
 * schedule or content changes. Fetches the full player-sync payload for the
 * target screen(s) and publishes it as a retained MQTT message via the HTTP
 * Bridge so Management Software receives the update immediately — even if the
 * device was offline and just reconnected (Mosquitto retain semantics).
 *
 * POST /functions/v1/notify-screen
 * Authorization: Bearer {SUPABASE_SERVICE_ROLE_KEY}
 *
 * Body (one of):
 *   { "screen_id": "uuid" }             — notify a single screen
 *   { "org_id":    "uuid" }             — notify every licensed screen in the org
 *   { "screen_id": "uuid", "org_id": "uuid" }  — both (redundant but accepted)
 *
 * Response:
 *   { "published": ["screen_id", ...], "skipped": ["screen_id", ...] }
 *
 * Notes:
 * - Requires the MQTT_BRIDGE_URL and MQTT_BRIDGE_SECRET env vars to actually
 *   publish; if absent, the function still fetches sync data and returns 200
 *   (useful for checking that schedules build without error).
 * - Auth: accepts only the service-role key. Never expose this endpoint to
 *   the public or to anonymous callers.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.99.3";
import { mqttPublish, topicScreen, type MqttMessage } from "../_shared/mqttPublish.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const body = await req.json() as { screen_id?: string; org_id?: string };
    const { screen_id, org_id } = body;

    if (!screen_id && !org_id) {
      return json({ error: "screen_id or org_id is required" }, 400);
    }

    // ── Resolve target screen IDs ─────────────────────────────────────────────
    let targetScreenIds: string[];

    if (screen_id) {
      targetScreenIds = [screen_id];
    } else {
      // Fetch all screen IDs for the org
      const { data: screens, error: screensErr } = await supabase
        .from("screens")
        .select("id")
        .eq("org_id", org_id!);

      if (screensErr) {
        console.error("notify-screen: screen list error", screensErr);
        return json({ error: "screen_list_failed" }, 500);
      }
      targetScreenIds = (screens ?? []).map((s: { id: string }) => s.id);
    }

    if (targetScreenIds.length === 0) {
      return json({ published: [], skipped: [] });
    }

    // ── Fetch + publish each screen ───────────────────────────────────────────
    const playerSyncBase =
      `${Deno.env.get("SUPABASE_URL")}/functions/v1/player-sync`;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const published: string[] = [];
    const skipped:   string[] = [];

    // Run all fetches concurrently; Supabase edge functions share no state
    // between isolates so parallel calls are safe.
    await Promise.all(targetScreenIds.map(async (sid) => {
      try {
        const syncRes = await fetch(`${playerSyncBase}?screen_id=${sid}`, {
          headers: {
            "Authorization": `Bearer ${serviceKey}`,
            "apikey":        serviceKey,
          },
          signal: AbortSignal.timeout(15_000),
        });

        if (!syncRes.ok) {
          console.warn(`notify-screen: player-sync returned ${syncRes.status} for screen ${sid}`);
          skipped.push(sid);
          return;
        }

        const syncData = await syncRes.json();

        // Determine the org_id for the topic from the fetched data; fall back
        // to the body-provided org_id.
        const effectiveOrgId: string = syncData.screen?.org_id ?? org_id ?? "";
        if (!effectiveOrgId) {
          console.warn(`notify-screen: could not determine org_id for screen ${sid}`);
          skipped.push(sid);
          return;
        }

        const msg: MqttMessage = {
          v:         1,
          type:      "sync",
          ts:        new Date().toISOString(),
          org_id:    effectiveOrgId,
          screen_id: sid,
          payload:   syncData as Record<string, unknown>,
        };

        await mqttPublish(topicScreen(effectiveOrgId, sid), msg, {
          retain: true,
          qos:    1,
        });

        published.push(sid);
      } catch (err) {
        console.error(`notify-screen: error for screen ${sid}:`, err);
        skipped.push(sid);
      }
    }));

    return json({ published, skipped });

  } catch (err) {
    console.error("notify-screen error:", err);
    return json({ error: "internal_error" }, 500);
  }
});
