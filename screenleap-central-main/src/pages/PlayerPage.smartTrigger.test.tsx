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

// Track handlers keyed by channel name prefix so tests can target the right one.
const channelHandlers = new Map<string, RealtimeHandler[]>();

const SCREEN_ID = "screen-1";
const ORG_ID = "org-1";
const RULE_ID = "rule-1";
const DP_ID = "dp-1";
const LOG_ID = "log-1";
// 1 second: Math.max(1, 1) = 1 in the component, keeping the test fast.
const DURATION_S = 1;

function makeChannelObj(name: string): any {
  const handlers: RealtimeHandler[] = [];
  channelHandlers.set(name, handlers);
  const obj: any = {
    on(_evt: string, _opts: unknown, cb: RealtimeHandler) {
      handlers.push(cb);
      return obj;
    },
    subscribe() { return obj; },
    unsubscribe() { return obj; },
  };
  return obj;
}

/** Fire the first handler registered on the smart-trigger-logs channel. */
function fireSmartTriggerHandler(payload: { new: Record<string, unknown> }) {
  for (const [name, handlers] of channelHandlers.entries()) {
    if (name.startsWith("smart-trigger-logs")) {
      handlers.forEach((h) => h(payload));
      return;
    }
  }
  throw new Error("No smart-trigger-logs channel handler found");
}

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
    channel: (name: string) => makeChannelObj(name),
    removeChannel: () => {},
    rpc: vi.fn().mockResolvedValue({
      data: { licensed: true, status: "active", license_id: null, license_code: null },
      error: null,
    }),
  },
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

// Stable `t` prevents the re-render loop caused by LanguageProvider recreating
// `t` on every render, which in turn recreates fetchAll and applyTriggerOverride
// useCallback memos, causing effects to re-run and `loading` to oscillate.
vi.mock("@/contexts/LanguageContext", () => {
  const t = (key: string) => key;
  return {
    useLanguage: () => ({ language: "en" as const, t, setLanguage: () => {} }),
  };
});

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
    channelHandlers.clear();
    // Use real timers so React's scheduler and waitFor work reliably.
    // The mock schedule covers all days 00:00-23:59, so no time-faking needed.
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("switches to override design project then auto-restores after duration_seconds", async () => {
    renderPlayer();

    await waitFor(() => {
      expect(screen.getByText(/Test Screen/)).toBeInTheDocument();
    }, { timeout: 8_000 });
    await waitFor(() => {
      expect(screen.getByText(/Scheduled Image/)).toBeInTheDocument();
    }, { timeout: 8_000 });

    expect(channelHandlers.size).toBeGreaterThanOrEqual(1);

    // applyTriggerOverride is async (floating Promise — not awaited by the
    // Realtime callback). We drain microtasks inside act() so the mock resolves
    // and setOverrideItem is called before act() exits and flushes React state.
    await act(async () => {
      fireSmartTriggerHandler({
        new: {
          id: LOG_ID,
          rule_id: RULE_ID,
          screen_id: SCREEN_ID,
          org_id: ORG_ID,
          success: true,
          trigger_key: "promo",
        },
      });
      // Drain microtasks: applyTriggerOverride needs ~2 ticks for the mock to resolve.
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    // "Promo Project" appears in both the content <p> and the status header,
    // so we use getAllByText (allows multiple matches) instead of getByText.
    await waitFor(() => {
      expect(screen.getAllByText(/Promo Project/).length).toBeGreaterThan(0);
    }, { timeout: 3_000 });

    // DURATION_S = 1 → the override restore timer fires after ~1 s (real time).
    await new Promise((resolve) => setTimeout(resolve, DURATION_S * 1000 + 400));

    await waitFor(() => {
      // queryAllByText never throws; returns empty array when none found.
      expect(screen.queryAllByText(/Promo Project/).length).toBe(0);
      expect(screen.getByText(/Scheduled Image/)).toBeInTheDocument();
    }, { timeout: 3_000 });
  }, 15_000); // 200ms setup + 1s override + 400ms buffer + assertions

  it("ignores Realtime inserts for a different screen_id", async () => {
    renderPlayer();
    await waitFor(() => expect(screen.getByText(/Scheduled Image/)).toBeInTheDocument());

    await act(async () => {
      fireSmartTriggerHandler({
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

    expect(screen.queryAllByText(/Promo Project/).length).toBe(0);
    expect(screen.getByText(/Scheduled Image/)).toBeInTheDocument();
  });
});
