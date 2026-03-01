import { describe, expect, it } from "vitest";
import { normalizeYtDlpBinaryPreference } from "./ytDlpSettings";

describe("normalizeYtDlpBinaryPreference", () => {
  it("defaults to auto", () => {
    expect(normalizeYtDlpBinaryPreference(undefined)).toBe("auto");
    expect(normalizeYtDlpBinaryPreference("invalid")).toBe("auto");
  });

  it("normalizes valid values", () => {
    expect(normalizeYtDlpBinaryPreference("system")).toBe("system");
    expect(normalizeYtDlpBinaryPreference("bundled")).toBe("bundled");
    expect(normalizeYtDlpBinaryPreference("  SYSTEM  ")).toBe("system");
  });
});
