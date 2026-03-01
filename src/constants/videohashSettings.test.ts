import { describe, expect, it } from "vitest";
import { normalizeVideoHashFfmpegSourcePreference } from "./videohashSettings";

describe("normalizeVideoHashFfmpegSourcePreference", () => {
  it("defaults to auto", () => {
    expect(normalizeVideoHashFfmpegSourcePreference(undefined)).toBe("auto");
    expect(normalizeVideoHashFfmpegSourcePreference("invalid")).toBe("auto");
  });

  it("normalizes valid values", () => {
    expect(normalizeVideoHashFfmpegSourcePreference("system")).toBe("system");
    expect(normalizeVideoHashFfmpegSourcePreference("bundled")).toBe("bundled");
    expect(normalizeVideoHashFfmpegSourcePreference("  SYSTEM  ")).toBe("system");
  });
});
