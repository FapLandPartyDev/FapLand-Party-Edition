import { describe, expect, it } from "vitest";
import {
  DEFAULT_ANTI_PERK_BEATBAR_ENABLED,
  normalizeAntiPerkBeatbarEnabled,
} from "./roundVideoOverlaySettings";

describe("roundVideoOverlaySettings", () => {
  it("normalizes explicit anti-perk beatbar booleans and strings", () => {
    expect(normalizeAntiPerkBeatbarEnabled(true)).toBe(true);
    expect(normalizeAntiPerkBeatbarEnabled(false)).toBe(false);
    expect(normalizeAntiPerkBeatbarEnabled("true")).toBe(true);
    expect(normalizeAntiPerkBeatbarEnabled("false")).toBe(false);
    expect(normalizeAntiPerkBeatbarEnabled(1)).toBe(true);
    expect(normalizeAntiPerkBeatbarEnabled(0)).toBe(false);
  });

  it("falls back to the default anti-perk beatbar setting for invalid values", () => {
    expect(normalizeAntiPerkBeatbarEnabled("wat")).toBe(DEFAULT_ANTI_PERK_BEATBAR_ENABLED);
    expect(normalizeAntiPerkBeatbarEnabled(null)).toBe(DEFAULT_ANTI_PERK_BEATBAR_ENABLED);
    expect(normalizeAntiPerkBeatbarEnabled(undefined)).toBe(DEFAULT_ANTI_PERK_BEATBAR_ENABLED);
  });
});
