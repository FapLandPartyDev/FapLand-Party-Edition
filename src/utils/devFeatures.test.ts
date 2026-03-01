import { describe, expect, it } from "vitest";
import { areDevFeaturesEnabled, isGameDevelopmentMode } from "./devFeatures";

describe("devFeatures", () => {
  it("enables dev features in vite dev mode", () => {
    expect(areDevFeaturesEnabled({ DEV: true })).toBe(true);
  });

  it("enables dev features when the explicit flag is set", () => {
    expect(areDevFeaturesEnabled({ DEV: false, FLAND_ENABLE_DEV_FEATURES: "true" })).toBe(true);
    expect(areDevFeaturesEnabled({ DEV: false, FLAND_ENABLE_DEV_FEATURES: "1" })).toBe(true);
  });

  it("treats VITE_GAME_ENV=development as development mode", () => {
    expect(isGameDevelopmentMode({ DEV: false, VITE_GAME_ENV: "development" })).toBe(true);
    expect(isGameDevelopmentMode({ DEV: false, VITE_GAME_ENV: "production" })).toBe(false);
  });
});
