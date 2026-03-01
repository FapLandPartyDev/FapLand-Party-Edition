import { describe, expect, it } from "vitest";
import { DEBUG_LOG_LEVELS, DEFAULT_DEBUG_LOG_LEVEL, normalizeDebugLogLevel } from "./debugSettings";

describe("debugSettings", () => {
  it("normalizes supported log levels", () => {
    for (const level of DEBUG_LOG_LEVELS) {
      expect(normalizeDebugLogLevel(level)).toBe(level);
    }
  });

  it("defaults unknown values to off", () => {
    expect(normalizeDebugLogLevel(undefined)).toBe(DEFAULT_DEBUG_LOG_LEVEL);
    expect(normalizeDebugLogLevel(null)).toBe(DEFAULT_DEBUG_LOG_LEVEL);
    expect(normalizeDebugLogLevel("trace")).toBe(DEFAULT_DEBUG_LOG_LEVEL);
    expect(normalizeDebugLogLevel(1)).toBe(DEFAULT_DEBUG_LOG_LEVEL);
  });
});
