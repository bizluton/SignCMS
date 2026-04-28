// @vitest-environment node
import { describe, it, expect } from "vitest";
import { extractToken, validateTokenShape, UUID_RE } from "./inviteToken";

const VALID_UUID = "11111111-2222-4333-8444-555555555555";

describe("UUID_RE", () => {
  it("accepts valid UUID v4-shaped strings", () => {
    expect(UUID_RE.test(VALID_UUID)).toBe(true);
    expect(UUID_RE.test(VALID_UUID.toUpperCase())).toBe(true);
  });
  it("rejects non-UUID strings", () => {
    expect(UUID_RE.test("not-a-uuid")).toBe(false);
    expect(UUID_RE.test("zzzzzzzz-zzzz-zzzz-zzzz-zzzzzzzzzzzz")).toBe(false);
    expect(UUID_RE.test("")).toBe(false);
  });
});

describe("extractToken", () => {
  it("returns empty string for empty / whitespace input", () => {
    expect(extractToken("")).toBe("");
    expect(extractToken("   ")).toBe("");
  });

  it("trims and returns plain tokens unchanged", () => {
    expect(extractToken(`  ${VALID_UUID}  `)).toBe(VALID_UUID);
    expect(extractToken("abc123")).toBe("abc123");
  });

  it("extracts UUID from a full invite URL", () => {
    expect(
      extractToken(`https://app.example.com/auth?invite=${VALID_UUID}`),
    ).toBe(VALID_UUID);
  });

  it("extracts UUID when surrounded by other query params", () => {
    expect(
      extractToken(
        `https://trial.signcms.com/auth?foo=bar&invite=${VALID_UUID}&utm=email`,
      ),
    ).toBe(VALID_UUID);
  });

  it("falls back to trimmed input for malformed URL containing invite=", () => {
    // `not a url` cannot parse → fallback to trimmed original
    const raw = "  not a url invite=xxx  ";
    expect(extractToken(raw)).toBe(raw.trim());
  });
});

describe("validateTokenShape", () => {
  it("returns 'onboardingTokenRequired' for empty input", () => {
    expect(validateTokenShape("")).toBe("onboardingTokenRequired");
    expect(validateTokenShape("   ")).toBe("onboardingTokenRequired");
  });

  it("returns 'onboardingTokenTooShort' for short input", () => {
    expect(validateTokenShape("abc123")).toBe("onboardingTokenTooShort");
  });

  it("returns 'onboardingTokenBadFormat' for long non-UUID input", () => {
    expect(validateTokenShape("z".repeat(32))).toBe("onboardingTokenBadFormat");
  });

  it("returns null for a valid UUID", () => {
    expect(validateTokenShape(VALID_UUID)).toBeNull();
    expect(validateTokenShape(`  ${VALID_UUID}  `)).toBeNull();
  });

  it("returns null for a full invite URL with valid UUID", () => {
    expect(
      validateTokenShape(`https://app.example.com/auth?invite=${VALID_UUID}`),
    ).toBeNull();
    expect(
      validateTokenShape(
        `https://trial.signcms.com/auth?foo=bar&invite=${VALID_UUID}&utm=email`,
      ),
    ).toBeNull();
  });
});
