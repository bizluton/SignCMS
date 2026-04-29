import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";

type RealtimeCb = (payload: unknown) => void;
type ChannelHandlers = { handlers: RealtimeCb[]; subscribed: boolean };

const channels = new Map<string, ChannelHandlers>();
const rpcMock = vi.fn();
const removedChannels: unknown[] = [];

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: (...args: unknown[]) => rpcMock(...args),
    channel: (name: string) => {
      const entry: ChannelHandlers = { handlers: [], subscribed: false };
      channels.set(name, entry);
      const obj: any = {
        on: (_evt: string, _opts: unknown, cb: RealtimeCb) => {
          entry.handlers.push(cb);
          return obj;
        },
        subscribe: () => { entry.subscribed = true; return obj; },
      };
      return obj;
    },
    removeChannel: (ch: unknown) => { removedChannels.push(ch); },
  },
}));

import { useScreenLicenseStatus } from "./useScreenLicenseStatus";

describe("useScreenLicenseStatus", () => {
  beforeEach(() => {
    channels.clear();
    rpcMock.mockReset();
    removedChannels.length = 0;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("starts in loading state and resolves with the RPC payload", async () => {
    rpcMock.mockResolvedValue({
      data: { licensed: true, status: "active", license_id: "lic-1", license_code: "ABC" },
      error: null,
    });

    const { result } = renderHook(() => useScreenLicenseStatus("screen-1"));

    expect(result.current.loading).toBe(true);
    expect(result.current.info).toBeNull();

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.info).toEqual({
      licensed: true, status: "active", license_id: "lic-1", license_code: "ABC",
    });
    expect(rpcMock).toHaveBeenCalledWith("check_screen_license_status", { _screen_id: "screen-1" });
  });

  it("falls back to unknown status when RPC errors", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: "boom" } });

    const { result } = renderHook(() => useScreenLicenseStatus("screen-2"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.info).toEqual({ licensed: false, status: "unknown" });
  });

  it("treats null screenId as no-op (info stays null, loading false)", async () => {
    const { result } = renderHook(() => useScreenLicenseStatus(null));
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.info).toBeNull();
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("re-runs the RPC when a device_licenses Realtime change fires", async () => {
    rpcMock
      .mockResolvedValueOnce({
        data: { licensed: true, status: "active", license_id: null, license_code: null },
        error: null,
      })
      .mockResolvedValueOnce({
        data: { licensed: false, status: "revoked", license_id: null, license_code: null },
        error: null,
      });

    const { result } = renderHook(() => useScreenLicenseStatus("screen-3"));
    await waitFor(() => expect(result.current.info?.licensed).toBe(true));

    const ch = channels.get("screen-license-screen-3");
    expect(ch?.subscribed).toBe(true);
    expect(ch?.handlers.length).toBe(1);

    await act(async () => { ch!.handlers[0]({ eventType: "UPDATE" }); });

    await waitFor(() => expect(result.current.info?.licensed).toBe(false));
    expect(result.current.info?.status).toBe("revoked");
    expect(rpcMock).toHaveBeenCalledTimes(2);
  });

  it("removes its Realtime channel on unmount", async () => {
    rpcMock.mockResolvedValue({
      data: { licensed: true, status: "active", license_id: null, license_code: null },
      error: null,
    });

    const { unmount } = renderHook(() => useScreenLicenseStatus("screen-4"));
    await waitFor(() => expect(channels.has("screen-license-screen-4")).toBe(true));

    unmount();
    expect(removedChannels.length).toBeGreaterThan(0);
  });
});
