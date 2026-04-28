// @vitest-environment node
import { describe, it, expect } from "vitest";
import {
  formatBytes,
  formatBytesCompact,
  getSizeBytes,
  formatDimensions,
  getDurationSec,
  formatDuration,
} from "./mediaFormat";

describe("formatBytes", () => {
  it("formats GB / MB / KB / B", () => {
    expect(formatBytes(2 * 1024 ** 3)).toBe("2.00 GB");
    expect(formatBytes(1.5 * 1024 * 1024)).toBe("1.5 MB");
    expect(formatBytes(2048)).toBe("2.0 KB");
    expect(formatBytes(512)).toBe("512 B");
  });

  it("returns empty string for null/undefined/0/negative/NaN", () => {
    expect(formatBytes(null)).toBe("");
    expect(formatBytes(undefined)).toBe("");
    expect(formatBytes(0)).toBe("");
    expect(formatBytes(-100)).toBe("");
    expect(formatBytes(NaN)).toBe("");
    expect(formatBytes(Infinity)).toBe("");
  });
});

describe("formatBytesCompact", () => {
  it("formats compact MB / KB / B without space", () => {
    expect(formatBytesCompact(1.2 * 1048576)).toBe("1.2MB");
    expect(formatBytesCompact(2048)).toBe("2KB");
    expect(formatBytesCompact(512)).toBe("512B");
  });

  it("returns empty string for null/0/NaN", () => {
    expect(formatBytesCompact(null)).toBe("");
    expect(formatBytesCompact(undefined)).toBe("");
    expect(formatBytesCompact(0)).toBe("");
    expect(formatBytesCompact(NaN)).toBe("");
  });
});

describe("getSizeBytes", () => {
  it("returns numeric size_bytes when positive", () => {
    expect(getSizeBytes({ size_bytes: 1234 })).toBe(1234);
  });

  it("returns 0 for null / 0 / negative / undefined", () => {
    expect(getSizeBytes({ size_bytes: null })).toBe(0);
    expect(getSizeBytes({ size_bytes: 0 })).toBe(0);
    expect(getSizeBytes({ size_bytes: -5 })).toBe(0);
    expect(getSizeBytes({})).toBe(0);
  });
});

describe("formatDimensions", () => {
  it("formats width×height when both positive", () => {
    expect(formatDimensions({ width: 1920, height: 1080 })).toBe("1920×1080");
  });

  it("returns empty string when either dimension is missing/zero/null", () => {
    expect(formatDimensions({ width: 1920, height: 0 })).toBe("");
    expect(formatDimensions({ width: 0, height: 1080 })).toBe("");
    expect(formatDimensions({ width: null, height: 1080 })).toBe("");
    expect(formatDimensions({ width: 1920, height: null })).toBe("");
    expect(formatDimensions({})).toBe("");
  });
});

describe("getDurationSec", () => {
  it("returns numeric duration when positive", () => {
    expect(getDurationSec({ duration_seconds: 12.5 })).toBe(12.5);
  });

  it("returns 0 for null / 0 / negative / undefined", () => {
    expect(getDurationSec({ duration_seconds: null })).toBe(0);
    expect(getDurationSec({ duration_seconds: 0 })).toBe(0);
    expect(getDurationSec({ duration_seconds: -3 })).toBe(0);
    expect(getDurationSec({})).toBe(0);
  });
});

describe("formatDuration", () => {
  it("formats m:ss for under an hour", () => {
    expect(formatDuration({ duration_seconds: 65 })).toBe("1:05");
    expect(formatDuration({ duration_seconds: 5 })).toBe("0:05");
    expect(formatDuration({ duration_seconds: 599 })).toBe("9:59");
  });

  it("formats h:mm:ss for one hour or more", () => {
    expect(formatDuration({ duration_seconds: 3661 })).toBe("1:01:01");
    expect(formatDuration({ duration_seconds: 3600 })).toBe("1:00:00");
    expect(formatDuration({ duration_seconds: 7325 })).toBe("2:02:05");
  });

  it("rounds fractional seconds", () => {
    expect(formatDuration({ duration_seconds: 12.6 })).toBe("0:13");
    expect(formatDuration({ duration_seconds: 12.4 })).toBe("0:12");
  });

  it("returns empty string for null / 0 / negative / undefined", () => {
    expect(formatDuration({ duration_seconds: null })).toBe("");
    expect(formatDuration({ duration_seconds: 0 })).toBe("");
    expect(formatDuration({ duration_seconds: -1 })).toBe("");
    expect(formatDuration({})).toBe("");
  });
});
