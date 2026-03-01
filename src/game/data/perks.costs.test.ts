import { describe, expect, it } from "vitest";
import type { PerkRarity } from "../types";
import { resolvePerkRarity } from "./perkRarity";
import { getPerkById } from "./perks";

const EXPECTED_COSTS: Record<string, number> = {
  "loaded-dice": 120,
  "steady-steps": 180,
  "long-interlude": 120,
  pause: 150,
  skip: 210,
  heal: 220,
  shield: 240,
  cleaner: 250,
  doubler: 230,
  "lazy-hero": 210,
  gooooal: 190,
  "be-gentle": 200,
  "no-rest": 220,
  highspeed: 240,
  virus: 260,
  "virus-max": 310,
  succubus: 320,
  milker: 340,
  jackhammer: 360,
  "cold-streak": 230,
  "jammed-dice": 240,
  "score-leech": 240,
  "cement-boots": 260,
  "panic-loop": 270,
  "sticky-fingers": 280,
  "snake-eyes": 320,
};

const EXPECTED_RARITIES: Record<string, PerkRarity> = {
  "loaded-dice": "common",
  "steady-steps": "rare",
  "long-interlude": "common",
  pause: "common",
  skip: "rare",
  heal: "rare",
  shield: "epic",
  cleaner: "epic",
  doubler: "rare",
  "lazy-hero": "rare",
  gooooal: "rare",
  "be-gentle": "rare",
  "no-rest": "rare",
  highspeed: "epic",
  virus: "epic",
  "virus-max": "legendary",
  succubus: "legendary",
  milker: "legendary",
  jackhammer: "legendary",
  "cold-streak": "rare",
  "jammed-dice": "epic",
  "score-leech": "epic",
  "cement-boots": "epic",
  "panic-loop": "epic",
  "sticky-fingers": "epic",
  "snake-eyes": "legendary",
};

describe("perk cost balance", () => {
  it("keeps configured costs stable", () => {
    for (const [perkId, expectedCost] of Object.entries(EXPECTED_COSTS)) {
      const perk = getPerkById(perkId);
      expect(perk, `Missing perk definition for ${perkId}`).toBeDefined();
      expect(perk?.cost).toBe(expectedCost);
    }
  });

  it("keeps configured rarities stable", () => {
    for (const [perkId, expectedRarity] of Object.entries(EXPECTED_RARITIES)) {
      const perk = getPerkById(perkId);
      expect(perk, `Missing perk definition for ${perkId}`).toBeDefined();
      expect(perk?.rarity).toBe(expectedRarity);
      if (!perk) continue;
      expect(resolvePerkRarity(perk)).toBe(expectedRarity);
    }
  });

  it("keeps extreme-tier entries at or above 240", () => {
    const extremeIds = [
      "shield",
      "cleaner",
      "virus-max",
      "succubus",
      "milker",
      "jackhammer",
      "jammed-dice",
      "panic-loop",
      "sticky-fingers",
      "snake-eyes",
    ];
    for (const perkId of extremeIds) {
      const perk = getPerkById(perkId);
      expect(perk, `Missing perk definition for ${perkId}`).toBeDefined();
      expect(perk?.cost ?? 0).toBeGreaterThanOrEqual(240);
    }
  });
});
