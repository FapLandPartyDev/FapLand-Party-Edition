import { describe, expect, it } from "vitest";
import {
  DEFAULT_THEHANDY_APP_API_KEY,
  THEHANDY_OFFSET_MAX_MS,
  THEHANDY_OFFSET_MIN_MS,
} from "../constants/theHandy";
import {
  clampHandyStrokeRatio,
  formatHandyStrokeBoundPercent,
  getHandyStrokeFromBounds,
  getHandyStrokeFromPercent,
  getHandyStrokePercent,
  normalizeHandyAppApiKeyOverride,
  normalizeHandyOffsetMs,
  normalizeHandyStrokeState,
  resolveHandyAppApiKey,
  type HandyStrokeState,
} from "./theHandyConfig";

describe("theHandyConfig", () => {
  it("resolves to the bundled default when no override is provided", () => {
    expect(resolveHandyAppApiKey("")).toBe(DEFAULT_THEHANDY_APP_API_KEY);
    expect(resolveHandyAppApiKey("   ")).toBe(DEFAULT_THEHANDY_APP_API_KEY);
  });

  it("prefers a trimmed override key over the bundled default", () => {
    expect(resolveHandyAppApiKey("  custom-key  ")).toBe("custom-key");
  });

  it("normalizes override values consistently", () => {
    expect(normalizeHandyAppApiKeyOverride("  custom-key  ")).toBe("custom-key");
    expect(normalizeHandyAppApiKeyOverride(undefined)).toBe("");
  });

  it("normalizes invalid offset values to zero", () => {
    expect(normalizeHandyOffsetMs(undefined)).toBe(0);
    expect(normalizeHandyOffsetMs(null)).toBe(0);
    expect(normalizeHandyOffsetMs("wat")).toBe(0);
  });

  it("clamps offset values into the supported range", () => {
    expect(normalizeHandyOffsetMs(THEHANDY_OFFSET_MIN_MS - 1)).toBe(THEHANDY_OFFSET_MIN_MS);
    expect(normalizeHandyOffsetMs(THEHANDY_OFFSET_MAX_MS + 1)).toBe(THEHANDY_OFFSET_MAX_MS);
  });

  it("rounds offset values to the nearest millisecond", () => {
    expect(normalizeHandyOffsetMs(12.4)).toBe(12);
    expect(normalizeHandyOffsetMs(12.5)).toBe(13);
  });

  it("clamps stroke ratios into the supported range", () => {
    expect(clampHandyStrokeRatio(-1)).toBe(0);
    expect(clampHandyStrokeRatio(2)).toBe(1);
    expect(clampHandyStrokeRatio("0.333")).toBe(0.333);
  });

  it("normalizes malformed stroke state values defensively", () => {
    expect(
      normalizeHandyStrokeState({
        min: 1.4,
        max: -0.1,
        minAbsolute: Number.NaN,
        maxAbsolute: 123,
      })
    ).toEqual({
      min: 0,
      max: 1,
      minAbsolute: null,
      maxAbsolute: 123,
    } satisfies HandyStrokeState);
  });

  it("calculates stroke percentages from min and max", () => {
    expect(getHandyStrokePercent({ min: 0, max: 1 })).toBe(100);
    expect(getHandyStrokePercent({ min: 0.12, max: 0.88 })).toBe(76);
    expect(formatHandyStrokeBoundPercent(0.12)).toBe(12);
    expect(formatHandyStrokeBoundPercent(0.88)).toBe(88);
  });

  it("shrinks stroke around the current center", () => {
    expect(getHandyStrokeFromPercent({ min: 0.1, max: 0.9 }, 60)).toEqual({
      min: 0.2,
      max: 0.8,
    });
  });

  it("expands stroke around the current center while clamping to the left edge", () => {
    expect(getHandyStrokeFromPercent({ min: 0.05, max: 0.35 }, 60)).toEqual({
      min: 0,
      max: 0.6,
    });
  });

  it("expands stroke around the current center while clamping to the right edge", () => {
    expect(getHandyStrokeFromPercent({ min: 0.65, max: 0.95 }, 60)).toEqual({
      min: 0.4,
      max: 1,
    });
  });

  it("resets to the full range when the target span reaches 100 percent", () => {
    expect(getHandyStrokeFromPercent({ min: 0.2, max: 0.7 }, 100)).toEqual({
      min: 0,
      max: 1,
    });
  });

  it("normalizes direct min and max stroke bounds", () => {
    expect(getHandyStrokeFromBounds(88, 12)).toEqual({
      min: 0.12,
      max: 0.88,
    });
  });
});
