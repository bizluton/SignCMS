// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  mapSupabaseAuthError,
  recordLoginFailure,
  getLoginLockRemainingMs,
  getLoginFailureCount,
  clearLoginLock,
  formatLockCountdown,
  LOGIN_MAX_FAILS,
  LOGIN_LOCKOUT_MS,
} from "./supabaseAuthErrors";

// ── localStorage stub ──────────────────────────────────────────────────────

const store: Record<string, string> = {};
const localStorageMock = {
  getItem: (k: string) => store[k] ?? null,
  setItem: (k: string, v: string) => { store[k] = v; },
  removeItem: (k: string) => { delete store[k]; },
  clear: () => { Object.keys(store).forEach((k) => delete store[k]); },
};

beforeEach(() => {
  vi.stubGlobal("localStorage", localStorageMock);
  localStorageMock.clear();
});
afterEach(() => {
  vi.unstubAllGlobals();
});

// ── mapSupabaseAuthError ───────────────────────────────────────────────────

describe("mapSupabaseAuthError", () => {
  it("returns null for null / undefined / empty", () => {
    expect(mapSupabaseAuthError(null)).toBeNull();
    expect(mapSupabaseAuthError(undefined)).toBeNull();
    expect(mapSupabaseAuthError("")).toBeNull();
  });

  it("maps invalid credentials variants", () => {
    expect(mapSupabaseAuthError("Invalid login credentials")).toBe("authErrInvalidCredentials");
    expect(mapSupabaseAuthError("invalid email or password")).toBe("authErrInvalidCredentials");
    expect(mapSupabaseAuthError("INVALID LOGIN CREDENTIALS")).toBe("authErrInvalidCredentials");
  });

  it("maps email not confirmed", () => {
    expect(mapSupabaseAuthError("email not confirmed")).toBe("authErrEmailNotConfirmed");
    expect(mapSupabaseAuthError("Please verify: email not confirmed")).toBe("authErrEmailNotConfirmed");
  });

  it("maps rate limit messages", () => {
    expect(mapSupabaseAuthError("rate limit exceeded")).toBe("authErrRateLimited");
    expect(mapSupabaseAuthError("too many requests")).toBe("authErrRateLimited");
    expect(mapSupabaseAuthError("over_email_send_rate_limit")).toBe("authErrRateLimited");
    expect(mapSupabaseAuthError("over_request_rate_limit")).toBe("authErrRateLimited");
  });

  it("maps weak password signals", () => {
    expect(mapSupabaseAuthError("password is known to be weak")).toBe("authErrWeakPassword");
    expect(mapSupabaseAuthError("pwned password")).toBe("authErrWeakPassword");
    expect(mapSupabaseAuthError("compromised in a breach")).toBe("authErrWeakPassword");
  });

  it("maps too-short password", () => {
    expect(mapSupabaseAuthError("Password should be at least 6 characters")).toBe("authErrPasswordTooShort");
    expect(mapSupabaseAuthError("password is too short")).toBe("authErrPasswordTooShort");
  });

  it("maps same-password reuse", () => {
    expect(mapSupabaseAuthError("new password should be different")).toBe("authErrSamePassword");
    expect(mapSupabaseAuthError("same password as before")).toBe("authErrSamePassword");
  });

  it("maps session expiry", () => {
    expect(mapSupabaseAuthError("session expired")).toBe("authErrSessionExpired");
    expect(mapSupabaseAuthError("Session not found")).toBe("authErrSessionExpired");
  });

  it("returns null for unmapped messages", () => {
    expect(mapSupabaseAuthError("server error 503")).toBeNull();
    expect(mapSupabaseAuthError("unexpected error occurred")).toBeNull();
  });
});

// ── formatLockCountdown ────────────────────────────────────────────────────

describe("formatLockCountdown", () => {
  it("formats 10 minutes exactly", () => {
    expect(formatLockCountdown(600_000)).toBe("10:00");
  });

  it("formats 9 min 59 sec (599_001 ms → ceil to 600s)", () => {
    expect(formatLockCountdown(599_001)).toBe("10:00");
  });

  it("formats 1 min 30 sec", () => {
    expect(formatLockCountdown(90_000)).toBe("1:30");
  });

  it("formats 0 ms as 0:00", () => {
    expect(formatLockCountdown(0)).toBe("0:00");
  });

  it("formats negative ms as 0:00", () => {
    expect(formatLockCountdown(-5000)).toBe("0:00");
  });

  it("formats 1 sec (1000 ms)", () => {
    expect(formatLockCountdown(1000)).toBe("0:01");
  });

  it("pads single-digit seconds", () => {
    expect(formatLockCountdown(65_000)).toBe("1:05");
  });
});

// ── brute-force lockout ────────────────────────────────────────────────────

describe("brute-force lockout", () => {
  it("starts with 0 failures and no lock", () => {
    expect(getLoginFailureCount()).toBe(0);
    expect(getLoginLockRemainingMs()).toBe(0);
  });

  it("counts failures incrementally up to threshold", () => {
    for (let i = 1; i < LOGIN_MAX_FAILS; i++) {
      const remaining = recordLoginFailure();
      expect(remaining).toBe(0); // no lock yet
      expect(getLoginFailureCount()).toBe(i);
    }
  });

  it(`locks on the ${LOGIN_MAX_FAILS}th failure`, () => {
    for (let i = 0; i < LOGIN_MAX_FAILS - 1; i++) recordLoginFailure();
    const lockMs = recordLoginFailure();
    expect(lockMs).toBe(LOGIN_LOCKOUT_MS);
    expect(getLoginLockRemainingMs()).toBeGreaterThan(0);
  });

  it("keeps returning lock remaining on subsequent calls", () => {
    for (let i = 0; i < LOGIN_MAX_FAILS; i++) recordLoginFailure();
    const r1 = getLoginLockRemainingMs();
    const r2 = getLoginLockRemainingMs();
    expect(r1).toBeGreaterThan(0);
    expect(r1 - r2).toBeLessThan(100); // same tick, negligible difference
  });

  it("clearLoginLock resets everything", () => {
    for (let i = 0; i < LOGIN_MAX_FAILS; i++) recordLoginFailure();
    clearLoginLock();
    expect(getLoginLockRemainingMs()).toBe(0);
    expect(getLoginFailureCount()).toBe(0);
  });

  it("fail window resets: old failures beyond FAIL_WINDOW_MS are ignored", () => {
    // Manually write a fail state with firstAt = 16 min ago (beyond 15 min window)
    const oldState = { count: LOGIN_MAX_FAILS - 1, firstAt: Date.now() - 16 * 60 * 1000 };
    localStorage.setItem("signcms_login_fails", JSON.stringify(oldState));
    expect(getLoginFailureCount()).toBe(0); // window expired → reset
    // Recording a new failure should start a fresh count
    const lockMs = recordLoginFailure();
    expect(lockMs).toBe(0); // only 1 failure, no lock
    expect(getLoginFailureCount()).toBe(1);
  });

  it("expired lock is cleared automatically on read", () => {
    const pastExpiry = String(Date.now() - 1000); // expired 1 s ago
    localStorage.setItem("signcms_login_lock", pastExpiry);
    expect(getLoginLockRemainingMs()).toBe(0);
    expect(localStorage.getItem("signcms_login_lock")).toBeNull();
  });

  it("multiple recordLoginFailure calls beyond threshold don't extend lock further", () => {
    for (let i = 0; i < LOGIN_MAX_FAILS; i++) recordLoginFailure();
    const lockAfterThreshold = getLoginLockRemainingMs();
    recordLoginFailure(); // extra call
    const lockAfterExtra = getLoginLockRemainingMs();
    // Should be roughly equal (same lock timestamp)
    expect(Math.abs(lockAfterThreshold - lockAfterExtra)).toBeLessThan(200);
  });
});
