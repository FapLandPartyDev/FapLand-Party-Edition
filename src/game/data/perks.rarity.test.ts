import { describe, expect, it } from "vitest";
import type { PerkRarity } from "../types";
import { PERK_LIBRARY } from "./perks";
import { fallbackRarityFromCost, resolvePerkRarity } from "./perkRarity";

describe("perk rarity", () => {
  it("maps fallback rarity from configured cost thresholds", () => {
    expect(fallbackRarityFromCost(0)).toBe("common");
    expect(fallbackRarityFromCost(179)).toBe("common");
    expect(fallbackRarityFromCost(180)).toBe("rare");
    expect(fallbackRarityFromCost(239)).toBe("rare");
    expect(fallbackRarityFromCost(240)).toBe("epic");
    expect(fallbackRarityFromCost(299)).toBe("epic");
    expect(fallbackRarityFromCost(300)).toBe("legendary");
  });

  it("prefers explicit rarity over fallback", () => {
    expect(resolvePerkRarity({ rarity: "legendary", cost: 120 })).toBe("legendary");
    expect(resolvePerkRarity({ rarity: "common", cost: 360 })).toBe("common");
  });

  it("resolves every configured perk to a valid rarity", () => {
    const validRarities = new Set<PerkRarity>(["common", "rare", "epic", "legendary"]);
    for (const perk of PERK_LIBRARY) {
      expect(validRarities.has(resolvePerkRarity(perk))).toBe(true);
    }
  });
});
