import { describe, expect, it } from "vitest";
import { meetsMinimumVideoLength, normalizeMinimumVideoLength } from "./sourceFilter";

describe("converter source video length filter", () => {
  it("keeps videos at or above the configured minimum length", () => {
    expect(meetsMinimumVideoLength(10 * 60_000, 10)).toBe(true);
    expect(meetsMinimumVideoLength(12 * 60_000, 10)).toBe(true);
  });

  it("filters videos below the configured minimum length", () => {
    expect(meetsMinimumVideoLength(9 * 60_000 + 59_999, 10)).toBe(false);
  });

  it("does not hide videos with unknown durations", () => {
    expect(meetsMinimumVideoLength(null, 10)).toBe(true);
  });

  it("disables the filter for zero or negative minimums", () => {
    expect(meetsMinimumVideoLength(1_000, 0)).toBe(true);
    expect(meetsMinimumVideoLength(1_000, -5)).toBe(true);
  });

  it("normalizes persisted slider values", () => {
    expect(normalizeMinimumVideoLength("15")).toBe(15);
    expect(normalizeMinimumVideoLength("-2")).toBe(0);
    expect(normalizeMinimumVideoLength("999")).toBe(120);
    expect(normalizeMinimumVideoLength("invalid")).toBe(0);
  });
});
