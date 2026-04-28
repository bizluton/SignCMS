import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

/**
 * Integration test: PlayerPage smart-trigger override + auto-restore.
 *
 * Mocks the supabase client so the PlayerPage:
 *  1. Loads a screen + a single long-duration image schedule item.
 *  2. Receives a simulated Realtime INSERT into `smart_trigger_logs`.
 *  3. Applies the rule's target design project as an override (UI shows project name).
 *  4. After `duration_seconds`, the override clears and the schedule resumes.
 */

type RealtimeHandler = (payload: { new: Record<string, unknown> }) => void;

const realtimeHandlers: RealtimeHandler[] = [];

const SCREEN_ID = "screen-1";
const ORG_ID = "org-1";
const RULE_ID = "rule-1";
const DP_ID = "dp-1";
const LOG_ID = "log-1";
const DURATION_S = 5;

const channelObj: any = {
  on(_evt: string, _opts: unknown, cb: RealtimeHandler) {
    realtimeHandlers.push(cb);
    return channelObj;
  },
  subscribe() {
    return channelObj;
  },
};

function makeQuery(table: string) {
  const state: { table: string; filters: Record<string, unknown> } = {
    table,
    filters: {},
  };
  const chain: any = {
    select() { return chain; },
    eq(col: string, val: unknown) { state.filters[col] = val; return chain; },
    order() { return chain; },
    insert() { return Promise.resolve({ data: null, error: null }); },
    async maybeSingle() {
      if (state.table === "screens") {
        return {
          data: { id: SCREEN_ID, name: "Test Screen", org_id: ORG_ID, resolution: "1920x1080" },
          error: null,
        };
      }
      if (state.table === "smart_trigger_rules") {
        return {
          data: {
            id: RULE_ID,
            name: "Promo Rule",
            scope: "screen",
            enabled: true,
            duration_seconds: DURATION_S,
            target_design_project_id: DP_ID,
            design_projects: { id: DP_ID, name: "Promo Project", zones: [] },
          },
          error: null,
        };
      }
      if (state.table === "screen_smart_trigger_overrides") {
        return { data: null, error: null };
      }
      return { data: null, error: null };
    },
    then(resolve: (v: unknown) => void) {
      if (state.table === "schedules") {
        return resolve({
          data: [
            {
              id: "sched-1",
              name: "Default Schedule",
              enabled: true,
              start_time: "00:00",
              end_time: "23:59",
              days: ["mon", "tue", "wed", "thu", "fri", "sat", "sun"],
              bgm_volume: 30,
              schedule_items: [
                {
                  id: "item-1",
                  media_id: "m-1",
                  design_project_id: null,
                  duration: 999,
                  item_type: "image",
                  sort_order: 0,
                  media_items: { id: "m-1", name: "Scheduled Image", type: "image", url: "" },
                  design_projects: null,
                },
              ],
              schedule_bgm_items: [],
            },
          ],
          error: null,
        });
      }
      return resolve({ data: [], error: null });
    },
  };
  return chain;
}

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (table: string) => makeQuery(table),
    channel: (_name: string) => channelObj,
    removeChannel: () => {},
  },
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

import PlayerPage from "./PlayerPage";
import { LanguageProvider } from "@/contexts/LanguageProvider";

function renderPlayer() {
  return render(
    <LanguageProvider>
      <MemoryRouter initialEntries={[`/player/${SCREEN_ID}`]}>
        <Routes>
          <Route path="/player/:screenId" element={<PlayerPage />} />
        </Routes>
      </MemoryRouter>
    </LanguageProvider>,
  );
}

describe("PlayerPage smart-trigger override", () => {
  beforeEach(() => {
    realtimeHandlers.length = 0;
    vi.useFakeTimers({ shouldAdvanceTime: true });
    // Wednesday noon UTC — within the schedule's 00:00–23:59 window.
    vi.setSystemTime(new Date("2026-04-22T12:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("switches to override design project then auto-restores after duration_seconds", async () => {
    renderPlayer();

    await waitFor(() => {
      expect(screen.getByText(/Test Screen/)).toBeInTheDocument();
    });
    await waitFor(() => {
      expect(screen.getByText(/Scheduled Image/)).toBeInTheDocument();
    });

    expect(realtimeHandlers.length).toBeGreaterThanOrEqual(1);

    await act(async () => {
      realtimeHandlers[0]({
        new: {
          id: LOG_ID,
          rule_id: RULE_ID,
          screen_id: SCREEN_ID,
          org_id: ORG_ID,
          success: true,
          trigger_key: "promo",
        },
      });
      await Promise.resolve();
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(screen.getByText(/Promo Project/)).toBeInTheDocument();
    });

    await act(async () => {
      vi.advanceTimersByTime(DURATION_S * 1000 + 250);
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(screen.queryByText(/Promo Project/)).not.toBeInTheDocument();
      expect(screen.getByText(/Scheduled Image/)).toBeInTheDocument();
    });
  });

  it("ignores Realtime inserts for a different screen_id", async () => {
    renderPlayer();
    await waitFor(() => expect(screen.getByText(/Scheduled Image/)).toBeInTheDocument());

    await act(async () => {
      realtimeHandlers[0]({
        new: {
          id: "log-other",
          rule_id: RULE_ID,
          screen_id: "screen-OTHER",
          org_id: ORG_ID,
          success: true,
          trigger_key: "promo",
        },
      });
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(screen.queryByText(/Promo Project/)).not.toBeInTheDocument();
    expect(screen.getByText(/Scheduled Image/)).toBeInTheDocument();
  });
});
