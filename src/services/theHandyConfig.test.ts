import { describe, expect, it } from "vitest";
import {
  DEFAULT_THEHANDY_APP_API_KEY,
  THEHANDY_OFFSET_MAX_MS,
  THEHANDY_OFFSET_MIN_MS,
} from "../constants/theHandy";
import {
  normalizeHandyAppApiKeyOverride,
  normalizeHandyOffsetMs,
  resolveHandyAppApiKey,
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
});
