export const LOCAL_PROFILE_ID = "local";
export const CHEAT_PROFILE_ID = "local-cheat";
export const MAX_CHEAT_LEVEL = 10_000;
export const MAX_CHEAT_XP = getTotalXpForLevel(MAX_CHEAT_LEVEL + 1) - 1;

export type ProgressionAwardOutcome = "success" | "failure";
export type ProgressionBlockReason = "cheat_mode" | "level_bypass" | "map_editor_test";

export type ProgressionAwardInput = {
  completedRounds: number;
  outcome: ProgressionAwardOutcome;
  blockReason?: ProgressionBlockReason | null;
  disabledSkillRanks?: number;
};

export type ProgressionAwardBreakdown = {
  participationXp: number;
  progressXp: number;
  completionXp: number;
  skillDeactivationBonusXp: number;
  skillDeactivationBonusPercent: number;
  totalXp: number;
};

export const XP_BONUS_PERCENT_PER_DISABLED_SKILL_RANK = 5;
export const MAX_SKILL_DEACTIVATION_XP_BONUS_PERCENT = 100;

export function getSkillDeactivationXpBonusPercent(disabledSkillRanks: number): number {
  const normalizedRanks = Math.max(0, Math.floor(disabledSkillRanks));
  return Math.min(
    MAX_SKILL_DEACTIVATION_XP_BONUS_PERCENT,
    normalizedRanks * XP_BONUS_PERCENT_PER_DISABLED_SKILL_RANK
  );
}

export function getXpToAdvance(level: number): number {
  const normalizedLevel = Math.max(1, Math.floor(level));
  const offset = normalizedLevel - 1;
  return 100 + 25 * offset + 2 * offset * offset;
}

export function getTotalXpForLevel(level: number): number {
  const normalizedLevel = Math.max(1, Math.floor(level));
  let total = 0;
  for (let current = 1; current < normalizedLevel; current += 1) {
    total += getXpToAdvance(current);
  }
  return total;
}

export function getLevelFromXp(totalXp: number): number {
  const normalizedXp = Math.max(0, Math.floor(totalXp));
  let level = 1;
  let remaining = normalizedXp;
  while (remaining >= getXpToAdvance(level)) {
    remaining -= getXpToAdvance(level);
    level += 1;
  }
  return level;
}

export function getLevelProgress(totalXp: number): {
  level: number;
  currentLevelXp: number;
  xpToNextLevel: number;
} {
  const level = getLevelFromXp(totalXp);
  const levelStartXp = getTotalXpForLevel(level);
  return {
    level,
    currentLevelXp: Math.max(0, Math.floor(totalXp) - levelStartXp),
    xpToNextLevel: getXpToAdvance(level),
  };
}

export function calculateProgressionAward(input: ProgressionAwardInput): ProgressionAwardBreakdown {
  if (input.blockReason) {
    return {
      participationXp: 0,
      progressXp: 0,
      completionXp: 0,
      skillDeactivationBonusXp: 0,
      skillDeactivationBonusPercent: 0,
      totalXp: 0,
    };
  }
  const completedRounds = Math.max(0, Math.floor(input.completedRounds));
  const participationXp = 10;
  const progressXp = Math.min(400, completedRounds * 4);
  const completionXp = input.outcome === "success" ? Math.min(100, completedRounds * 10) : 0;
  const baseXp = participationXp + progressXp + completionXp;
  const skillDeactivationBonusPercent = getSkillDeactivationXpBonusPercent(
    input.disabledSkillRanks ?? 0
  );
  const skillDeactivationBonusXp = Math.floor((baseXp * skillDeactivationBonusPercent) / 100);
  return {
    participationXp,
    progressXp,
    completionXp,
    skillDeactivationBonusXp,
    skillDeactivationBonusPercent,
    totalXp: baseXp + skillDeactivationBonusXp,
  };
}

export type ProgressionTitle = {
  id: string;
  name: string;
  safeName: string;
  requiredLevel: number;
};

export const PROGRESSION_TITLES: readonly ProgressionTitle[] = [
  { id: "fresh-face", name: "Fresh Meat", safeName: "Fresh Recruit", requiredLevel: 1 },
  { id: "board-rookie", name: "Stroke Rookie", safeName: "Timing Rookie", requiredLevel: 5 },
  { id: "dice-tinkerer", name: "Fap Cadet", safeName: "Focus Cadet", requiredLevel: 10 },
  {
    id: "pause-artist",
    name: "Edging Apprentice",
    safeName: "Patience Apprentice",
    requiredLevel: 15,
  },
  {
    id: "lucky-menace",
    name: "Porn Pathfinder",
    safeName: "Pleasure Pathfinder",
    requiredLevel: 20,
  },
  {
    id: "perk-collector",
    name: "Gooning Initiate",
    safeName: "Ritual Initiate",
    requiredLevel: 25,
  },
  {
    id: "trailblazer",
    name: "Cock Commander",
    safeName: "Party Commander",
    requiredLevel: 30,
  },
  {
    id: "chaos-conductor",
    name: "Edging Expert",
    safeName: "Timing Expert",
    requiredLevel: 40,
  },
  { id: "party-veteran", name: "Fap Hero", safeName: "F-Land Hero", requiredLevel: 50 },
  {
    id: "loaded-legend",
    name: "Cum Conductor",
    safeName: "Climax Conductor",
    requiredLevel: 60,
  },
  {
    id: "unshakable",
    name: "Orgasm Denier",
    safeName: "Finale Denier",
    requiredLevel: 75,
  },
  { id: "board-royalty", name: "Goon Lord", safeName: "Marathon Lord", requiredLevel: 100 },
  {
    id: "run-whisperer",
    name: "Cock-Crazed Conqueror",
    safeName: "Focused Conqueror",
    requiredLevel: 125,
  },
  {
    id: "fortunes-favorite",
    name: "Cum-Hungry Champion",
    safeName: "Victory Champion",
    requiredLevel: 150,
  },
  {
    id: "endless-icon",
    name: "Edging Overlord",
    safeName: "Patience Overlord",
    requiredLevel: 200,
  },
  {
    id: "master-of-the-map",
    name: "Goon Cave Legend",
    safeName: "Endurance Legend",
    requiredLevel: 250,
  },
  {
    id: "mythic-menace",
    name: "Fapland's Filthiest",
    safeName: "F-Land Mythic",
    requiredLevel: 500,
  },
  {
    id: "beyond-the-board",
    name: "Eternal Cumlord",
    safeName: "Eternal Champion",
    requiredLevel: 1000,
  },
] as const;

export function getProgressionTitleDisplayName(
  title: Pick<ProgressionTitle, "name" | "safeName">,
  safeMode: boolean
): string {
  return safeMode ? title.safeName : title.name;
}

export function getTitleById(titleId: string | null | undefined): ProgressionTitle {
  const staticTitle = PROGRESSION_TITLES.find((title) => title.id === titleId);
  if (staticTitle) return staticTitle;
  const match = /^ascendant-(\d+)$/u.exec(titleId ?? "");
  const rank = match ? Number(match[1]) : 0;
  if (Number.isInteger(rank) && rank > 0) {
    return {
      id: `ascendant-${rank}`,
      name: `Ascendant Gooner ${rank}`,
      safeName: `Ascendant ${rank}`,
      requiredLevel: 1000 + rank * 250,
    };
  }
  return PROGRESSION_TITLES[0]!;
}

export function getTitleForLevel(level: number): ProgressionTitle {
  const unlocked = getTitlesForLevel(level);
  return unlocked.at(-1) ?? PROGRESSION_TITLES[0]!;
}

export function getTitlesForLevel(level: number): ProgressionTitle[] {
  const normalizedLevel = Math.max(1, Math.floor(level));
  const titles = PROGRESSION_TITLES.filter((title) => title.requiredLevel <= normalizedLevel);
  const ascendantRanks = Math.max(0, Math.floor((normalizedLevel - 1000) / 250));
  for (let rank = 1; rank <= ascendantRanks; rank += 1) {
    titles.push({
      id: `ascendant-${rank}`,
      name: `Ascendant Gooner ${rank}`,
      safeName: `Ascendant ${rank}`,
      requiredLevel: 1000 + rank * 250,
    });
  }
  return titles;
}

export type SkillBranchId =
  "control" | "dicecraft" | "economy" | "fortune" | "defense" | "endurance" | "scoring" | "arsenal";

export type SkillModifierKey =
  | "startingPauseCharges"
  | "pauseDurationMs"
  | "startingSkipCharges"
  | "diceMin"
  | "diceMax"
  | "startingMoney"
  | "moneyPerCompletedRound"
  | "startingScore"
  | "scorePerCompletedRound"
  | "optionsPerPick"
  | "perkTriggerChance"
  | "initialIntermediaryProbability"
  | "intermediaryIncreasePerRound"
  | "initialAntiPerkProbability"
  | "antiPerkIncreasePerRound"
  | "shieldRounds"
  | "pendingRollMultiplier"
  | "pendingIntensityCap";

export type SkillDefinition = {
  id: string;
  branch: SkillBranchId;
  name: string;
  description: string;
  maxRank: number;
  tier: 1 | 2 | 3 | 4;
  modifier?: {
    key: SkillModifierKey;
    amountPerRank: number;
  };
  starterPerkId?: string;
};

const SKILL_BRANCH_FALLBACKS: Partial<
  Record<SkillBranchId, { key: SkillModifierKey; amountPerRank: number; description: string }>
> = {
  control: {
    key: "startingPauseCharges",
    amountPerRank: 1,
    description: "+1 starting pause per rank.",
  },
  economy: {
    key: "startingMoney",
    amountPerRank: 20,
    description: "+20 starting money per rank.",
  },
  fortune: {
    key: "perkTriggerChance",
    amountPerRank: 0.03,
    description: "+3% perk-offer chance per rank.",
  },
  endurance: {
    key: "pauseDurationMs",
    amountPerRank: 1000,
    description: "+1 second between rounds per rank.",
  },
  scoring: {
    key: "startingScore",
    amountPerRank: 20,
    description: "+20 starting score per rank.",
  },
};

const skill = (
  branch: SkillBranchId,
  id: string,
  name: string,
  description: string,
  maxRank: number,
  tier: 1 | 2 | 3 | 4,
  modifier?: SkillDefinition["modifier"],
  starterPerkId?: string
): SkillDefinition => ({
  branch,
  id,
  name,
  description:
    modifier || starterPerkId || branch === "arsenal"
      ? description
      : (SKILL_BRANCH_FALLBACKS[branch]?.description ?? description),
  maxRank,
  tier,
  modifier,
  starterPerkId,
});

export const SKILL_LIBRARY: readonly SkillDefinition[] = [
  skill("control", "pocket-pauses", "Pocket Pauses", "+1 starting pause per rank.", 3, 1, {
    key: "startingPauseCharges",
    amountPerRank: 1,
  }),
  skill("control", "long-timeout", "Long Timeout", "Pauses last 5 seconds longer per rank.", 3, 1, {
    key: "pauseDurationMs",
    amountPerRank: 5000,
  }),
  skill(
    "control",
    "quick-recovery",
    "Quick Recovery",
    "Restore pauses as rounds are completed.",
    3,
    2
  ),
  skill("control", "skip-ticket", "Skip Ticket", "+1 starting skip per rank.", 2, 2, {
    key: "startingSkipCharges",
    amountPerRank: 1,
  }),
  skill("control", "recycled-ticket", "Recycled Ticket", "Chance to refund a used skip.", 3, 3),
  skill("control", "camp-refill", "Camp Refill", "Campfires restore round controls.", 2, 3),
  skill(
    "control",
    "emergency-stop",
    "Emergency Stop",
    "Dangerous rounds can grant an emergency pause.",
    1,
    4
  ),
  skill("control", "master-of-time", "Master of Time", "The first pause each run is free.", 1, 4),

  skill("dicecraft", "reinforced-dice", "Reinforced Dice", "+1 maximum roll per rank.", 3, 1, {
    key: "diceMax",
    amountPerRank: 1,
  }),
  skill("dicecraft", "steady-hand", "Steady Hand", "+1 minimum roll per rank.", 1, 1, {
    key: "diceMin",
    amountPerRank: 1,
  }),
  skill("dicecraft", "advantage", "Advantage", "Early rolls use the better of two dice.", 3, 2),
  skill("dicecraft", "momentum", "Momentum", "Maximum rolls improve the next roll.", 3, 2),
  skill("dicecraft", "hot-streak", "Hot Streak", "Maximum rolls can grant a bonus roll.", 3, 3),
  skill(
    "dicecraft",
    "bounce-back",
    "Bounce Back",
    "Minimum rolls improve the next roll floor.",
    3,
    3
  ),
  skill("dicecraft", "pocket-doubler", "Pocket Doubler", "Start with a doubled roll ready.", 1, 4, {
    key: "pendingRollMultiplier",
    amountPerRank: 2,
  }),
  skill("dicecraft", "dice-sovereign", "Dice Sovereign", "Gain one manual reroll each run.", 1, 4),

  skill("economy", "nest-egg", "Nest Egg", "+25 starting money per rank.", 5, 1, {
    key: "startingMoney",
    amountPerRank: 25,
  }),
  skill("economy", "payday", "Payday", "+10 money after each round per rank.", 5, 1, {
    key: "moneyPerCompletedRound",
    amountPerRank: 10,
  }),
  skill("economy", "coupon-book", "Coupon Book", "Reduce perk prices.", 4, 2),
  skill("economy", "toll-pass", "Toll Pass", "Reduce path gate costs.", 3, 2),
  skill("economy", "compound-interest", "Compound Interest", "Earn interest at safe points.", 3, 3),
  skill("economy", "treasure-tile", "Treasure Tile", "Perk nodes award bonus money.", 3, 3),
  skill("economy", "salvager", "Salvager", "Discarded inventory refunds money.", 3, 4),
  skill(
    "economy",
    "first-ones-free",
    "First One's Free",
    "The first purchased perk is free.",
    1,
    4
  ),

  skill("fortune", "open-hand", "Open Hand", "+1 perk option per rank.", 3, 1, {
    key: "optionsPerPick",
    amountPerRank: 1,
  }),
  skill("fortune", "treasure-sense", "Treasure Sense", "+5% perk-offer chance per rank.", 4, 1, {
    key: "perkTriggerChance",
    amountPerRank: 0.05,
  }),
  skill("fortune", "rare-taste", "Rare Taste", "Favor rarer perk offers.", 4, 2),
  skill("fortune", "mulligan", "Mulligan", "Reroll perk offers during a run.", 3, 2),
  skill(
    "fortune",
    "lucky-pocket",
    "Lucky Pocket",
    "Offers can be added directly to inventory.",
    3,
    3
  ),
  skill("fortune", "serendipity", "Serendipity", "Rounds can produce a second offer.", 3, 3),
  skill(
    "fortune",
    "bad-luck-protection",
    "Bad-Luck Protection",
    "Common offers improve future rarity.",
    3,
    4
  ),
  skill(
    "fortune",
    "fortunes-favorite",
    "Fortune's Favorite",
    "The first offer includes a rare perk.",
    1,
    4
  ),

  skill("defense", "pocket-shield", "Pocket Shield", "+1 starting shield round.", 1, 1, {
    key: "shieldRounds",
    amountPerRank: 1,
  }),
  skill("defense", "reinforced-shield", "Reinforced Shield", "Shields last longer.", 3, 1),
  skill(
    "defense",
    "low-profile",
    "Low Profile",
    "Reduce initial anti-perk probability by 1% per rank.",
    4,
    2,
    { key: "initialAntiPerkProbability", amountPerRank: -0.01 }
  ),
  skill(
    "defense",
    "slow-escalation",
    "Slow Escalation",
    "Reduce anti-perk growth by 0.1% per rank.",
    3,
    2,
    { key: "antiPerkIncreasePerRound", amountPerRank: -0.001 }
  ),
  skill("defense", "thick-skin", "Thick Skin", "Shorten timed anti-perks.", 3, 3),
  skill("defense", "camp-cleanse", "Camp Cleanse", "Campfires remove anti-perks.", 2, 3),
  skill("defense", "hazard-pay", "Hazard Pay", "Gain money when afflicted.", 3, 4),
  skill("defense", "guardian-angel", "Guardian Angel", "Block the first incoming anti-perk.", 1, 4),

  skill("endurance", "slow-burn", "Slow Burn", "+1 second between rounds per rank.", 5, 1, {
    key: "pauseDurationMs",
    amountPerRank: 1000,
  }),
  skill("endurance", "camp-regular", "Camp Regular", "Campfires provide longer recovery.", 3, 1),
  skill(
    "endurance",
    "gentle-opening",
    "Gentle Opening",
    "Cap intensity at the beginning of a run.",
    3,
    2,
    { key: "pendingIntensityCap", amountPerRank: -0.1 }
  ),
  skill("endurance", "safety-valve", "Safety Valve", "Start with intensity safety charges.", 2, 2),
  skill(
    "endurance",
    "calm-mind",
    "Calm Mind",
    "Reduce initial intermediary probability by 3% per rank.",
    4,
    3,
    { key: "initialIntermediaryProbability", amountPerRank: -0.03 }
  ),
  skill(
    "endurance",
    "steady-pulse",
    "Steady Pulse",
    "Reduce intermediary growth by 0.3% per rank.",
    3,
    3,
    { key: "intermediaryIncreasePerRound", amountPerRank: -0.003 }
  ),
  skill(
    "endurance",
    "deep-recovery",
    "Deep Recovery",
    "Campfires reduce danger probabilities.",
    3,
    4
  ),
  skill(
    "endurance",
    "unshakable",
    "Unshakable",
    "Every fifth round suppresses danger growth.",
    1,
    4
  ),

  skill("scoring", "head-start", "Head Start", "+25 starting score per rank.", 5, 1, {
    key: "startingScore",
    amountPerRank: 25,
  }),
  skill("scoring", "finisher", "Finisher", "+10 completed-round score per rank.", 5, 1, {
    key: "scorePerCompletedRound",
    amountPerRank: 10,
  }),
  skill(
    "scoring",
    "interjection-hunter",
    "Interjection Hunter",
    "Intermediaries award bonus score.",
    3,
    2
  ),
  skill(
    "scoring",
    "living-dangerously",
    "Living Dangerously",
    "Active anti-perks award bonus score.",
    3,
    2
  ),
  skill(
    "scoring",
    "clutch-finish",
    "Clutch Finish",
    "Successful climax rounds award bonus score.",
    3,
    3
  ),
  skill(
    "scoring",
    "combo-artist",
    "Combo Artist",
    "Consecutive rounds build a score multiplier.",
    3,
    3
  ),
  skill("scoring", "perfect-landing", "Perfect Landing", "Exact-roll landings award score.", 3, 4),
  skill(
    "scoring",
    "score-sovereign",
    "Score Sovereign",
    "Successful runs convert money into score.",
    1,
    4
  ),

  skill(
    "arsenal",
    "arsenal-loaded-dice",
    "Loaded Pocket",
    "Start with Loaded Dice.",
    1,
    1,
    undefined,
    "loaded-dice"
  ),
  skill(
    "arsenal",
    "arsenal-pause",
    "Pause Pocket",
    "Start with a Pause perk.",
    1,
    1,
    undefined,
    "pause"
  ),
  skill(
    "arsenal",
    "arsenal-skip",
    "Skip Pocket",
    "Start with a Skip perk.",
    1,
    2,
    undefined,
    "skip"
  ),
  skill(
    "arsenal",
    "arsenal-shield",
    "Shield Pocket",
    "Start with a Shield perk.",
    1,
    2,
    undefined,
    "shield"
  ),
  skill(
    "arsenal",
    "arsenal-cleaner",
    "Cleaner Pocket",
    "Start with a Cleaner perk.",
    1,
    3,
    undefined,
    "cleaner"
  ),
  skill(
    "arsenal",
    "arsenal-heal",
    "Heal Pocket",
    "Start with a Heal perk.",
    1,
    3,
    undefined,
    "heal"
  ),
  skill(
    "arsenal",
    "arsenal-doubler",
    "Doubler Pocket",
    "Start with a Doubler perk.",
    1,
    4,
    undefined,
    "doubler"
  ),
  skill("arsenal", "arsenal-mystery", "Mystery Pocket", "Start with a random enabled perk.", 1, 4),
] as const;

export type ProgressionModifiers = Partial<Record<SkillModifierKey, number>> & {
  starterPerkIds: string[];
};

export function buildProgressionModifiers(
  ranks: Readonly<Record<string, number>>,
  disabledSkillIds: ReadonlySet<string> = new Set()
): ProgressionModifiers {
  const modifiers: ProgressionModifiers = { starterPerkIds: [] };
  for (const definition of SKILL_LIBRARY) {
    if (disabledSkillIds.has(definition.id)) continue;
    const rank = Math.min(definition.maxRank, Math.max(0, Math.floor(ranks[definition.id] ?? 0)));
    if (rank === 0) continue;
    if (definition.modifier) {
      const current = modifiers[definition.modifier.key] ?? 0;
      modifiers[definition.modifier.key] = current + definition.modifier.amountPerRank * rank;
    }
    if (definition.starterPerkId) modifiers.starterPerkIds.push(definition.starterPerkId);
    if (!definition.modifier && !definition.starterPerkId) {
      const fallback = SKILL_BRANCH_FALLBACKS[definition.branch];
      if (fallback) {
        modifiers[fallback.key] = (modifiers[fallback.key] ?? 0) + fallback.amountPerRank * rank;
      }
      if (definition.branch === "arsenal") modifiers.starterPerkIds.push("__random__");
    }
  }
  return modifiers;
}

export function getRequiredBranchRanks(tier: SkillDefinition["tier"]): number {
  if (tier === 1) return 0;
  if (tier === 2) return 4;
  if (tier === 3) return 10;
  return 16;
}

export function getRespecTokensEarnedThroughLevel(level: number): number {
  const normalized = Math.max(1, Math.floor(level));
  return (normalized >= 10 ? 1 : 0) + Math.floor(normalized / 25);
}
