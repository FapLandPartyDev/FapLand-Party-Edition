import { describe, expect, it } from "vitest";
import { enhancementProfileMaxRate, normalizeEnhancementSpeedProfile } from "./enhancementProfile";

describe("enhancement speed profiles", () => {
  it("uses connection defaults and normalizes custom speed budgets", () => {
    const automatic = normalizeEnhancementSpeedProfile(undefined);
    expect(enhancementProfileMaxRate(automatic, "multifunplayer")).toBe(1600);
    expect(enhancementProfileMaxRate(automatic, "thehandy")).toBe(400);
    expect(enhancementProfileMaxRate(automatic, "intiface")).toBe(400);
    expect(
      enhancementProfileMaxRate(
        normalizeEnhancementSpeedProfile({ preset: "custom", customRate: 9999 }),
        "multifunplayer"
      )
    ).toBe(2000);
    expect(
      enhancementProfileMaxRate(
        normalizeEnhancementSpeedProfile({ preset: "custom", customRate: -1 }),
        "multifunplayer"
      )
    ).toBe(1);
    expect(
      enhancementProfileMaxRate(
        normalizeEnhancementSpeedProfile({ preset: "responsive" }),
        "multifunplayer"
      )
    ).toBe(800);
  });
});
