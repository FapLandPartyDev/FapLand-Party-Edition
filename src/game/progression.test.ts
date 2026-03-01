import { describe, expect, it } from "vitest";
import {
  buildProgressionModifiers,
  calculateProgressionAward,
  getLevelFromXp,
  getLevelProgress,
  getProgressionTitleDisplayName,
  getRequiredBranchRanks,
  getRespecTokensEarnedThroughLevel,
  getTitleById,
  getTitlesForLevel,
  getTotalXpForLevel,
  getXpToAdvance,
} from "./progression";

describe("progression curve", () => {
  it("starts at level one and crosses exact XP boundaries", () => {
    expect(getLevelFromXp(0)).toBe(1);
    expect(getXpToAdvance(1)).toBe(100);
    expect(getLevelFromXp(99)).toBe(1);
    expect(getLevelFromXp(100)).toBe(2);
    expect(getLevelProgress(100)).toEqual({
      level: 2,
      currentLevelXp: 0,
      xpToNextLevel: 127,
    });
  });

  it("keeps scaling without a level cap", () => {
    const level = 2_000;
    const threshold = getTotalXpForLevel(level);
    expect(getLevelFromXp(threshold)).toBe(level);
    expect(getXpToAdvance(level + 1)).toBeGreaterThan(getXpToAdvance(level));
  });
});

describe("run XP", () => {
  it("awards participation and capped progress for failures", () => {
    expect(
      calculateProgressionAward({
        completedRounds: 200,
        outcome: "failure",
        playtimeSec: 120,
      })
    ).toEqual({
      participationXp: 10,
      progressXp: 400,
      completionXp: 0,
      skillDeactivationBonusXp: 0,
      skillDeactivationBonusPercent: 0,
      totalXp: 410,
    });
  });

  it("adds a capped completion bonus", () => {
    expect(
      calculateProgressionAward({
        completedRounds: 12,
        outcome: "success",
        playtimeSec: 120,
      })
    ).toEqual({
      participationXp: 10,
      progressXp: 48,
      completionXp: 100,
      skillDeactivationBonusXp: 0,
      skillDeactivationBonusPercent: 0,
      totalXp: 158,
    });
  });

  it("adds five percent per disabled rank and floors fractional bonus XP", () => {
    expect(
      calculateProgressionAward({
        completedRounds: 12,
        outcome: "success",
        playtimeSec: 120,
        disabledSkillRanks: 3,
      })
    ).toEqual({
      participationXp: 10,
      progressXp: 48,
      completionXp: 100,
      skillDeactivationBonusXp: 23,
      skillDeactivationBonusPercent: 15,
      totalXp: 181,
    });
  });

  it("caps the skill deactivation bonus at one hundred percent", () => {
    const award = calculateProgressionAward({
      completedRounds: 12,
      outcome: "success",
      playtimeSec: 120,
      disabledSkillRanks: 999,
    });
    expect(award.skillDeactivationBonusPercent).toBe(100);
    expect(award.skillDeactivationBonusXp).toBe(158);
    expect(award.totalXp).toBe(316);
  });

  it.each(["cheat_mode", "level_bypass", "map_editor_test"] as const)(
    "blocks XP for %s",
    (blockReason) => {
      expect(
        calculateProgressionAward({
          completedRounds: 100,
          outcome: "success",
          playtimeSec: 120,
          blockReason,
        }).totalXp
      ).toBe(0);
    }
  );

  it("awards no XP when playtime is under two minutes", () => {
    expect(
      calculateProgressionAward({
        completedRounds: 100,
        outcome: "success",
        playtimeSec: 119,
        disabledSkillRanks: 20,
      })
    ).toEqual({
      participationXp: 0,
      progressXp: 0,
      completionXp: 0,
      skillDeactivationBonusXp: 0,
      skillDeactivationBonusPercent: 0,
      totalXp: 0,
    });
  });

  it("awards XP at exactly two minutes", () => {
    expect(
      calculateProgressionAward({
        completedRounds: 1,
        outcome: "failure",
        playtimeSec: 120,
      }).totalXp
    ).toBe(14);
  });
});

describe("progression unlocks", () => {
  it("grants the first respec at ten and repeats every 25 levels", () => {
    expect(getRespecTokensEarnedThroughLevel(9)).toBe(0);
    expect(getRespecTokensEarnedThroughLevel(10)).toBe(1);
    expect(getRespecTokensEarnedThroughLevel(25)).toBe(2);
    expect(getRespecTokensEarnedThroughLevel(50)).toBe(3);
  });

  it("generates infinite ascendant titles", () => {
    expect(getTitlesForLevel(1_249).some((title) => title.id === "ascendant-1")).toBe(false);
    expect(getTitlesForLevel(1_250).at(-1)).toEqual({
      id: "ascendant-1",
      name: "Ascendant Gooner 1",
      safeName: "Ascendant 1",
      requiredLevel: 1_250,
    });
    expect(getTitleById("ascendant-7").requiredLevel).toBe(2_750);
  });

  it("uses purpose-built censored title names in safe mode", () => {
    const title = getTitleById("beyond-the-board");
    expect(getProgressionTitleDisplayName(title, false)).toBe("Eternal Cumlord");
    expect(getProgressionTitleDisplayName(title, true)).toBe("Eternal Champion");
  });

  it("aggregates purchased skill ranks and starter inventory", () => {
    expect(
      buildProgressionModifiers({
        "pocket-pauses": 2,
        "reinforced-dice": 4,
        "nest-egg": 2,
        "arsenal-loaded-dice": 1,
      })
    ).toMatchObject({
      startingPauseCharges: 2,
      diceMax: 3,
      startingMoney: 50,
      starterPerkIds: ["loaded-dice"],
    });
  });

  it("keeps dice utility and defensive utility from granting hidden raw protection", () => {
    expect(
      buildProgressionModifiers({
        advantage: 3,
        momentum: 3,
        "reinforced-shield": 3,
        "thick-skin": 3,
      })
    ).toEqual({ starterPerkIds: [] });
  });

  it("places upper-tier skills deeper in their branch", () => {
    expect([1, 2, 3, 4].map((tier) => getRequiredBranchRanks(tier as 1 | 2 | 3 | 4))).toEqual([
      0, 4, 10, 16,
    ]);
  });

  it("does not apply modifiers from disabled purchased skills", () => {
    expect(
      buildProgressionModifiers(
        {
          "pocket-pauses": 2,
          "reinforced-dice": 3,
          "nest-egg": 2,
        },
        new Set(["pocket-pauses", "nest-egg"])
      )
    ).toEqual({
      diceMax: 3,
      starterPerkIds: [],
    });
  });
});
