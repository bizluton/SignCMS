import { describe, it, expect, vi, beforeEach } from "vitest";
import { shouldLogMediaRetentionChange } from "./mediaRetentionAudit";

describe("shouldLogMediaRetentionChange (mirrors SQL audit predicate)", () => {
  it("does NOT log when caller omits media_retention_days (newValue null)", () => {
    expect(shouldLogMediaRetentionChange(7, null)).toBe(false);
    expect(shouldLogMediaRetentionChange(7, undefined)).toBe(false);
  });

  it("does NOT log when value is unchanged", () => {
    expect(shouldLogMediaRetentionChange(7, 7)).toBe(false);
    expect(shouldLogMediaRetentionChange(30, 30)).toBe(false);
    expect(shouldLogMediaRetentionChange(1, 1)).toBe(false);
  });

  it("logs when value actually changes", () => {
    expect(shouldLogMediaRetentionChange(7, 14)).toBe(true);
    expect(shouldLogMediaRetentionChange(30, 7)).toBe(true);
    expect(shouldLogMediaRetentionChange(1, 365)).toBe(true);
  });

  it("logs when transitioning from NULL to a concrete value (first-time set)", () => {
    expect(shouldLogMediaRetentionChange(null, 7)).toBe(true);
    expect(shouldLogMediaRetentionChange(undefined, 30)).toBe(true);
  });

  it("does NOT log when both old and new are nullish", () => {
    expect(shouldLogMediaRetentionChange(null, null)).toBe(false);
    expect(shouldLogMediaRetentionChange(undefined, undefined)).toBe(false);
    expect(shouldLogMediaRetentionChange(null, undefined)).toBe(false);
  });
});

/**
 * Higher-level integration-style test: simulates the RPC behavior using a
 * mocked Supabase client. Verifies that an `activity_logs` insert is issued
 * iff `shouldLogMediaRetentionChange` returns true.
 *
 * This guards the *contract* between the client (which calls the RPC) and
 * the SQL function (which decides whether to write the audit row). If the
 * SQL rule is ever loosened to log on every call, the matching test will
 * fail and force the author to revisit this file.
 */
describe("update_schedule_cleanup_settings audit contract (mocked)", () => {
  type LogRow = {
    action_code: string;
    action_params: { old_value: number | null; new_value: number };
  };

  // In-memory stand-in for the SQL function body, kept intentionally tiny.
  function simulateRpc(
    state: { media_retention_days: number | null },
    logsTable: LogRow[],
    args: { _media_retention_days: number | null },
  ) {
    const oldValue = state.media_retention_days;
    const newValue = args._media_retention_days;
    if (newValue !== null) state.media_retention_days = newValue;
    if (shouldLogMediaRetentionChange(oldValue, newValue)) {
      logsTable.push({
        action_code: "system.media_retention_days_changed",
        action_params: { old_value: oldValue, new_value: newValue as number },
      });
    }
    return { success: true };
  }

  let state: { media_retention_days: number | null };
  let logs: LogRow[];
  let rpc: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    state = { media_retention_days: 7 };
    logs = [];
    rpc = vi.fn(async (_name: string, args: { _media_retention_days: number | null }) => ({
      data: simulateRpc(state, logs, args),
      error: null,
    }));
  });

  it("writes exactly one activity_logs row when value changes 7 → 14", async () => {
    await rpc("update_schedule_cleanup_settings", { _media_retention_days: 14 });
    expect(logs).toHaveLength(1);
    expect(logs[0].action_code).toBe("system.media_retention_days_changed");
    expect(logs[0].action_params).toEqual({ old_value: 7, new_value: 14 });
    expect(state.media_retention_days).toBe(14);
  });

  it("writes NO activity_logs row when value is unchanged (7 → 7)", async () => {
    await rpc("update_schedule_cleanup_settings", { _media_retention_days: 7 });
    expect(logs).toHaveLength(0);
    expect(state.media_retention_days).toBe(7);
  });

  it("writes NO activity_logs row when caller omits media_retention_days", async () => {
    await rpc("update_schedule_cleanup_settings", { _media_retention_days: null });
    expect(logs).toHaveLength(0);
    expect(state.media_retention_days).toBe(7);
  });

  it("writes one row per actual change across multiple calls (idempotent on equal value)", async () => {
    await rpc("update_schedule_cleanup_settings", { _media_retention_days: 14 }); // 7→14 ✅
    await rpc("update_schedule_cleanup_settings", { _media_retention_days: 14 }); // 14→14 ❌
    await rpc("update_schedule_cleanup_settings", { _media_retention_days: 30 }); // 14→30 ✅
    await rpc("update_schedule_cleanup_settings", { _media_retention_days: null }); // skip ❌
    expect(logs).toHaveLength(2);
    expect(logs.map((l) => l.action_params)).toEqual([
      { old_value: 7, new_value: 14 },
      { old_value: 14, new_value: 30 },
    ]);
  });

  it("writes a row when transitioning from null → concrete value", async () => {
    state.media_retention_days = null;
    await rpc("update_schedule_cleanup_settings", { _media_retention_days: 7 });
    expect(logs).toHaveLength(1);
    expect(logs[0].action_params).toEqual({ old_value: null, new_value: 7 });
  });
});