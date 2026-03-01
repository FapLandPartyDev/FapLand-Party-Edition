import type { MessageDescriptor } from "@lingui/core";
import { msg } from "@lingui/core/macro";
import type { PerkDefinition } from "../types";
import { i18n } from "../../i18n";

// Pricing tiers for balancing against default economy (starting money 120 / +50 per round).
// Utility: 120-170, Strong: 180-240, Extreme: 250-360.

export const DICE_PERK_IDS: ReadonlySet<string> = new Set([
  "loaded-dice",
  "steady-steps",
  "doubler",
  "im-close",
]);

export const DICE_ANTIPERK_IDS: ReadonlySet<string> = new Set([
  "cold-streak",
  "jammed-dice",
  "cement-boots",
  "snake-eyes",
]);

export function isDiceRelatedPerk(perkId: string): boolean {
  return DICE_PERK_IDS.has(perkId) || DICE_ANTIPERK_IDS.has(perkId);
}

export const PERK_LIBRARY: PerkDefinition[] = [
  {
    id: "loaded-dice",
    name: "Loaded Dice",
    description: "Increase max dice roll by 2 for 3 rounds.",
    iconKey: "loadedDice",
    cost: 120,
    rarity: "common",
    kind: "perk",
    target: "self",
    durationRounds: 3,
    application: "persistent",
    effects: [{ kind: "numericDelta", stat: "diceMax", amount: 2, min: 1, max: 12 }],
  },
  {
    id: "steady-steps",
    name: "Steady Steps",
    description: "Increase minimum dice roll by 1 permanently.",
    iconKey: "steadySteps",
    cost: 180,
    rarity: "rare",
    kind: "perk",
    target: "self",
    durationRounds: null,
    application: "persistent",
    effects: [{ kind: "numericDelta", stat: "diceMin", amount: 1, min: 1, max: 10 }],
  },
  {
    id: "long-interlude",
    name: "Long Interlude",
    description: "Increase resting period by 1500ms for 2 rounds.",
    iconKey: "longInterlude",
    cost: 120,
    rarity: "common",
    kind: "perk",
    target: "self",
    durationRounds: 2,
    application: "persistent",
    effects: [{ kind: "numericDelta", stat: "roundPauseMs", amount: 1500, min: 500, max: 12000 }],
  },
  {
    id: "pause",
    name: "Pause",
    description: "Gain one 15-second pause you can trigger during a round.",
    iconKey: "pause",
    cost: 150,
    rarity: "common",
    kind: "perk",
    target: "self",
    application: "immediate",
    effects: [{ kind: "grantRoundControl", control: "pause", amount: 1 }],
  },
  {
    id: "skip",
    name: "Skip",
    description: "Gain one skip charge that immediately ends an active normal round.",
    iconKey: "skip",
    cost: 210,
    rarity: "rare",
    kind: "perk",
    target: "self",
    application: "immediate",
    effects: [{ kind: "grantRoundControl", control: "skip", amount: 1 }],
  },
  {
    id: "heal",
    name: "Heal",
    description:
      "Reduce intermediary chance by 10%; in singleplayer also reduce anti-perk chance by 10%.",
    iconKey: "heal",
    cost: 220,
    rarity: "rare",
    kind: "perk",
    target: "self",
    application: "immediate",
    effects: [
      { kind: "probabilityDelta", stat: "intermediaryProbability", amount: -0.1, min: 0, max: 1 },
      {
        kind: "probabilityDelta",
        stat: "antiPerkProbability",
        amount: -0.1,
        min: 0,
        max: 1,
        singlePlayerOnly: true,
      },
    ],
  },
  {
    id: "shield",
    name: "Shield",
    description: "Block incoming anti-perks for 2 rounds.",
    iconKey: "shield",
    cost: 240,
    rarity: "epic",
    kind: "perk",
    target: "self",
    application: "immediate",
    effects: [{ kind: "setShieldRounds", rounds: 2 }],
  },
  {
    id: "cleaner",
    name: "Cleaner",
    description: "Remove all anti-perks currently affecting you.",
    iconKey: "cleaner",
    cost: 250,
    rarity: "epic",
    kind: "perk",
    target: "self",
    application: "immediate",
    effects: [{ kind: "cleanseAntiPerks" }],
  },
  {
    id: "doubler",
    name: "Doubler",
    description: "Double your next dice roll.",
    iconKey: "doubler",
    cost: 230,
    rarity: "rare",
    kind: "perk",
    target: "self",
    application: "immediate",
    effects: [{ kind: "setPendingRollMultiplier", multiplier: 2 }],
  },
  {
    id: "lazy-hero",
    name: "Lazy Hero",
    description: "Permanently increase between-round pause by 5000ms.",
    iconKey: "lazyHero",
    cost: 210,
    rarity: "rare",
    kind: "perk",
    target: "self",
    durationRounds: null,
    application: "persistent",
    effects: [{ kind: "numericDelta", stat: "roundPauseMs", amount: 5000, min: 500, max: 30000 }],
  },
  {
    id: "gooooal",
    name: "Gooooal",
    description: "Instantly gain 150 score.",
    iconKey: "gooooal",
    cost: 190,
    rarity: "rare",
    kind: "perk",
    target: "self",
    application: "immediate",
    effects: [{ kind: "scoreDelta", amount: 150, min: 0 }],
  },
  {
    id: "be-gentle",
    name: "Be Gentle",
    description: "Cap the next round intensity to 50%.",
    iconKey: "beGentle",
    cost: 200,
    rarity: "rare",
    kind: "perk",
    target: "self",
    application: "immediate",
    effects: [{ kind: "setPendingIntensityCap", cap: 0.5 }],
    requiresHandy: true,
  },
  {
    id: "treasure-magnet",
    name: "Treasure Magnet",
    description: "Increase random perk offer chance by 15%.",
    iconKey: "treasureMagnet",
    cost: 180,
    rarity: "rare",
    kind: "perk",
    target: "self",
    durationRounds: null,
    application: "persistent",
    effects: [{ kind: "numericDelta", stat: "perkFrequency", amount: 0.15, min: -0.5, max: 0.5 }],
  },
  {
    id: "lucky-star",
    name: "Lucky Star",
    description: "Increase luck, making rare perks more likely to appear.",
    iconKey: "luckyStar",
    cost: 200,
    rarity: "rare",
    kind: "perk",
    target: "self",
    durationRounds: null,
    application: "persistent",
    effects: [{ kind: "numericDelta", stat: "perkLuck", amount: 0.4, min: -1, max: 1 }],
  },
  {
    id: "no-rest",
    name: "No Rest",
    description:
      "Handy performs a low-intensity filler sequence while you are on the board. Persistent until a round or another intermediary starts.",
    iconKey: "noRest",
    cost: 220,
    rarity: "rare",
    kind: "antiPerk",
    target: "self",
    durationRounds: null,
    application: "persistent",
    effects: [],
    requiresHandy: true,
  },
  {
    id: "coupon-clipper",
    name: "Coupon Clipper",
    description: "Increase random perk offer chance by 20%, but reduce luck.",
    iconKey: "couponClipper",
    cost: 190,
    rarity: "rare",
    kind: "perk",
    target: "self",
    durationRounds: null,
    application: "persistent",
    effects: [
      { kind: "numericDelta", stat: "perkFrequency", amount: 0.2, min: -0.5, max: 0.5 },
      { kind: "numericDelta", stat: "perkLuck", amount: -0.3, min: -1, max: 1 },
    ],
  },
  {
    id: "highspeed",
    name: "Highspeed",
    description: "Increase round playback speed to 1.2x for one round.",
    iconKey: "highspeed",
    cost: 240,
    rarity: "epic",
    kind: "antiPerk",
    target: "self",
    durationRounds: 2,
    application: "persistent",
    effects: [],
    requiresHandy: true,
  },
  {
    id: "virus",
    name: "Virus",
    description: "Increase interjection probability by 10%.",
    iconKey: "virus",
    cost: 260,
    rarity: "epic",
    kind: "antiPerk",
    target: "self",
    application: "immediate",
    effects: [{ kind: "probabilityDelta", stat: "intermediaryProbability", amount: 0.1, min: 0 }],
  },
  {
    id: "virus-max",
    name: "Virus Max",
    description: "Set interjection probability to the configured maximum.",
    iconKey: "virusMax",
    cost: 310,
    rarity: "legendary",
    kind: "antiPerk",
    target: "self",
    application: "immediate",
    effects: [{ kind: "probabilityDelta", stat: "intermediaryProbability", amount: 1, min: 0 }],
  },
  {
    id: "succubus",
    name: "Succubus",
    description: "Next round becomes a random high-difficulty installed round.",
    iconKey: "succubus",
    cost: 320,
    rarity: "legendary",
    kind: "antiPerk",
    target: "self",
    durationRounds: 2,
    application: "persistent",
    effects: [],
  },
  {
    id: "milker",
    name: "Milker",
    description: "Trigger a 30s booru sequence with generated Handy motion.",
    iconKey: "milker",
    cost: 340,
    rarity: "legendary",
    kind: "antiPerk",
    target: "self",
    durationRounds: 2,
    application: "persistent",
    effects: [],
    requiresHandy: true,
  },
  {
    id: "jackhammer",
    name: "Jackhammer",
    description: "Trigger a 15s high-speed booru sequence with generated Handy motion.",
    iconKey: "jackhammer",
    cost: 360,
    rarity: "legendary",
    kind: "antiPerk",
    target: "self",
    durationRounds: 2,
    application: "persistent",
    effects: [],
    requiresHandy: true,
  },
  {
    id: "cold-streak",
    name: "Cold Streak",
    description: "Anti-perk: reduce minimum dice roll by 1 for 2 rounds.",
    iconKey: "coldStreak",
    cost: 230,
    rarity: "rare",
    kind: "antiPerk",
    target: "self",
    durationRounds: 2,
    application: "persistent",
    effects: [{ kind: "numericDelta", stat: "diceMin", amount: -1, min: 1, max: 10 }],
  },
  {
    id: "jammed-dice",
    name: "Jammed Dice",
    description:
      "Anti-perk: reduce max dice, increase resting period, and spawn intermediary clips for 2 rounds.",
    iconKey: "jammedDice",
    cost: 240,
    rarity: "epic",
    kind: "antiPerk",
    target: "self",
    durationRounds: 2,
    application: "persistent",
    effects: [
      { kind: "numericDelta", stat: "diceMax", amount: -1, min: 1, max: 12 },
      { kind: "numericDelta", stat: "roundPauseMs", amount: 2000, min: 500, max: 30000 },
    ],
  },
  {
    id: "score-leech",
    name: "Score Leech",
    description: "Anti-perk: drain 125 score immediately.",
    iconKey: "scoreLeech",
    cost: 240,
    rarity: "epic",
    kind: "antiPerk",
    target: "self",
    application: "immediate",
    effects: [{ kind: "scoreDelta", amount: -125, min: 0 }],
  },
  {
    id: "cement-boots",
    name: "Cement Boots",
    description: "Anti-perk: reduce max dice roll by 2 for 3 rounds.",
    iconKey: "cementBoots",
    cost: 260,
    rarity: "epic",
    kind: "antiPerk",
    target: "self",
    durationRounds: 3,
    application: "persistent",
    effects: [{ kind: "numericDelta", stat: "diceMax", amount: -2, min: 1, max: 12 }],
  },
  {
    id: "panic-loop",
    name: "Panic Loop",
    description: "Anti-perk: increase interjection probability by 20%.",
    iconKey: "panicLoop",
    cost: 270,
    rarity: "epic",
    kind: "antiPerk",
    target: "self",
    application: "immediate",
    effects: [{ kind: "probabilityDelta", stat: "intermediaryProbability", amount: 0.2, min: 0 }],
  },
  {
    id: "moaning-loop",
    name: "Moaning Loop",
    description:
      "Anti-perk: next round plays continuous random moaning during the round, intermediary, and interjection.",
    iconKey: "panicLoop",
    cost: 280,
    rarity: "epic",
    kind: "antiPerk",
    target: "self",
    durationRounds: 2,
    application: "persistent",
    effects: [],
    requiresMoaning: true,
  },
  {
    id: "dry-spell",
    name: "Dry Spell",
    description: "Anti-perk: decrease random perk offer chance by 15%.",
    iconKey: "drySpell",
    cost: 230,
    rarity: "rare",
    kind: "antiPerk",
    target: "self",
    durationRounds: null,
    application: "persistent",
    effects: [{ kind: "numericDelta", stat: "perkFrequency", amount: -0.15, min: -0.5, max: 0.5 }],
  },
  {
    id: "bad-omen",
    name: "Bad Omen",
    description: "Anti-perk: reduce luck, making common perks more likely to appear.",
    iconKey: "badOmen",
    cost: 240,
    rarity: "epic",
    kind: "antiPerk",
    target: "self",
    durationRounds: null,
    application: "persistent",
    effects: [{ kind: "numericDelta", stat: "perkLuck", amount: -0.4, min: -1, max: 1 }],
  },
  {
    id: "sticky-fingers",
    name: "Sticky Fingers",
    description: "Anti-perk: remove one pause charge and one skip charge.",
    iconKey: "stickyFingers",
    cost: 280,
    rarity: "epic",
    kind: "antiPerk",
    target: "self",
    application: "immediate",
    effects: [
      { kind: "roundControlDelta", control: "pause", amount: 1 },
      { kind: "roundControlDelta", control: "skip", amount: 1 },
    ],
  },
  {
    id: "snake-eyes",
    name: "Snake Eyes",
    description: "Anti-perk: cap the next dice roll to 2.",
    iconKey: "snakeEyes",
    cost: 320,
    rarity: "legendary",
    kind: "antiPerk",
    target: "self",
    application: "immediate",
    effects: [{ kind: "setPendingRollCeiling", ceiling: 2 }],
  },
  {
    id: "im-close",
    name: "I'm close",
    description: "For two rounds, minimum dice roll increases to 9 and max to 15.",
    iconKey: "imClose",
    cost: 690,
    rarity: "legendary",
    kind: "perk",
    target: "self",
    durationRounds: 2,
    application: "persistent",
    effects: [
      { kind: "numericDelta", stat: "diceMin", amount: 8, min: 1, max: 15 },
      { kind: "numericDelta", stat: "diceMax", amount: 9, min: 1, max: 15 },
    ],
  },
];

type PerkMessageDescriptors = {
  name: MessageDescriptor;
  description: MessageDescriptor;
};

const PERK_MESSAGES: Record<string, PerkMessageDescriptors> = {
  "loaded-dice": {
    name: msg({ id: "perk.name.loaded-dice", message: "Loaded Dice" }),
    description: msg({
      id: "perk.description.loaded-dice",
      message: "Increase max dice roll by 2 for 3 rounds.",
    }),
  },
  "steady-steps": {
    name: msg({ id: "perk.name.steady-steps", message: "Steady Steps" }),
    description: msg({
      id: "perk.description.steady-steps",
      message: "Increase minimum dice roll by 1 permanently.",
    }),
  },
  "long-interlude": {
    name: msg({ id: "perk.name.long-interlude", message: "Long Interlude" }),
    description: msg({
      id: "perk.description.long-interlude",
      message: "Increase resting period by 1500ms for 2 rounds.",
    }),
  },
  pause: {
    name: msg({ id: "perk.name.pause", message: "Pause" }),
    description: msg({
      id: "perk.description.pause",
      message: "Gain one 15-second pause you can trigger during a round.",
    }),
  },
  skip: {
    name: msg({ id: "perk.name.skip", message: "Skip" }),
    description: msg({
      id: "perk.description.skip",
      message: "Gain one skip charge that immediately ends an active normal round.",
    }),
  },
  heal: {
    name: msg({ id: "perk.name.heal", message: "Heal" }),
    description: msg({
      id: "perk.description.heal",
      message:
        "Reduce intermediary chance by 10%; in singleplayer also reduce anti-perk chance by 10%.",
    }),
  },
  shield: {
    name: msg({ id: "perk.name.shield", message: "Shield" }),
    description: msg({
      id: "perk.description.shield",
      message: "Block incoming anti-perks for 2 rounds.",
    }),
  },
  cleaner: {
    name: msg({ id: "perk.name.cleaner", message: "Cleaner" }),
    description: msg({
      id: "perk.description.cleaner",
      message: "Remove all anti-perks currently affecting you.",
    }),
  },
  doubler: {
    name: msg({ id: "perk.name.doubler", message: "Doubler" }),
    description: msg({
      id: "perk.description.doubler",
      message: "Double your next dice roll.",
    }),
  },
  "lazy-hero": {
    name: msg({ id: "perk.name.lazy-hero", message: "Lazy Hero" }),
    description: msg({
      id: "perk.description.lazy-hero",
      message: "Permanently increase between-round pause by 5000ms.",
    }),
  },
  gooooal: {
    name: msg({ id: "perk.name.gooooal", message: "Gooooal" }),
    description: msg({
      id: "perk.description.gooooal",
      message: "Instantly gain 150 score.",
    }),
  },
  "be-gentle": {
    name: msg({ id: "perk.name.be-gentle", message: "Be Gentle" }),
    description: msg({
      id: "perk.description.be-gentle",
      message: "Cap the next round intensity to 50%.",
    }),
  },
  "treasure-magnet": {
    name: msg({ id: "perk.name.treasure-magnet", message: "Treasure Magnet" }),
    description: msg({
      id: "perk.description.treasure-magnet",
      message: "Increase random perk offer chance by 15%.",
    }),
  },
  "lucky-star": {
    name: msg({ id: "perk.name.lucky-star", message: "Lucky Star" }),
    description: msg({
      id: "perk.description.lucky-star",
      message: "Increase luck, making rare perks more likely to appear.",
    }),
  },
  "no-rest": {
    name: msg({ id: "perk.name.no-rest", message: "No Rest" }),
    description: msg({
      id: "perk.description.no-rest",
      message:
        "Handy performs a low-intensity filler sequence while you are on the board. Persistent until a round or another intermediary starts.",
    }),
  },
  "coupon-clipper": {
    name: msg({ id: "perk.name.coupon-clipper", message: "Coupon Clipper" }),
    description: msg({
      id: "perk.description.coupon-clipper",
      message: "Increase random perk offer chance by 20%, but reduce luck.",
    }),
  },
  highspeed: {
    name: msg({ id: "perk.name.highspeed", message: "Highspeed" }),
    description: msg({
      id: "perk.description.highspeed",
      message: "Increase round playback speed to 1.2x for one round.",
    }),
  },
  virus: {
    name: msg({ id: "perk.name.virus", message: "Virus" }),
    description: msg({
      id: "perk.description.virus",
      message: "Increase interjection probability by 10%.",
    }),
  },
  "virus-max": {
    name: msg({ id: "perk.name.virus-max", message: "Virus Max" }),
    description: msg({
      id: "perk.description.virus-max",
      message: "Set interjection probability to the configured maximum.",
    }),
  },
  succubus: {
    name: msg({ id: "perk.name.succubus", message: "Succubus" }),
    description: msg({
      id: "perk.description.succubus",
      message: "Next round becomes a random high-difficulty installed round.",
    }),
  },
  milker: {
    name: msg({ id: "perk.name.milker", message: "Milker" }),
    description: msg({
      id: "perk.description.milker",
      message: "Trigger a 30s booru sequence with generated Handy motion.",
    }),
  },
  jackhammer: {
    name: msg({ id: "perk.name.jackhammer", message: "Jackhammer" }),
    description: msg({
      id: "perk.description.jackhammer",
      message: "Trigger a 15s high-speed booru sequence with generated Handy motion.",
    }),
  },
  "cold-streak": {
    name: msg({ id: "perk.name.cold-streak", message: "Cold Streak" }),
    description: msg({
      id: "perk.description.cold-streak",
      message: "Anti-perk: reduce minimum dice roll by 1 for 2 rounds.",
    }),
  },
  "jammed-dice": {
    name: msg({ id: "perk.name.jammed-dice", message: "Jammed Dice" }),
    description: msg({
      id: "perk.description.jammed-dice",
      message:
        "Anti-perk: reduce max dice, increase resting period, and spawn intermediary clips for 2 rounds.",
    }),
  },
  "score-leech": {
    name: msg({ id: "perk.name.score-leech", message: "Score Leech" }),
    description: msg({
      id: "perk.description.score-leech",
      message: "Anti-perk: drain 125 score immediately.",
    }),
  },
  "cement-boots": {
    name: msg({ id: "perk.name.cement-boots", message: "Cement Boots" }),
    description: msg({
      id: "perk.description.cement-boots",
      message: "Anti-perk: reduce max dice roll by 2 for 3 rounds.",
    }),
  },
  "panic-loop": {
    name: msg({ id: "perk.name.panic-loop", message: "Panic Loop" }),
    description: msg({
      id: "perk.description.panic-loop",
      message: "Anti-perk: increase interjection probability by 20%.",
    }),
  },
  "moaning-loop": {
    name: msg({ id: "perk.name.moaning-loop", message: "Moaning Loop" }),
    description: msg({
      id: "perk.description.moaning-loop",
      message:
        "Anti-perk: next round plays continuous random moaning during the round, intermediary, and interjection.",
    }),
  },
  "dry-spell": {
    name: msg({ id: "perk.name.dry-spell", message: "Dry Spell" }),
    description: msg({
      id: "perk.description.dry-spell",
      message: "Anti-perk: decrease random perk offer chance by 15%.",
    }),
  },
  "bad-omen": {
    name: msg({ id: "perk.name.bad-omen", message: "Bad Omen" }),
    description: msg({
      id: "perk.description.bad-omen",
      message: "Anti-perk: reduce luck, making common perks more likely to appear.",
    }),
  },
  "sticky-fingers": {
    name: msg({ id: "perk.name.sticky-fingers", message: "Sticky Fingers" }),
    description: msg({
      id: "perk.description.sticky-fingers",
      message: "Anti-perk: remove one pause charge and one skip charge.",
    }),
  },
  "snake-eyes": {
    name: msg({ id: "perk.name.snake-eyes", message: "Snake Eyes" }),
    description: msg({
      id: "perk.description.snake-eyes",
      message: "Anti-perk: cap the next dice roll to 2.",
    }),
  },
  "im-close": {
    name: msg({ id: "perk.name.im-close", message: "I'm close" }),
    description: msg({
      id: "perk.description.im-close",
      message: "For two rounds, minimum dice roll increases to 9 and max to 15.",
    }),
  },
};

export function getPerkPool(includeAntiPerks = false): PerkDefinition[] {
  return PERK_LIBRARY.filter((perk) => includeAntiPerks || perk.kind === "perk");
}

export function isSinglePlayerAllowedAntiPerk(perk: PerkDefinition): boolean {
  if (perk.kind !== "antiPerk") return false;
  if (perk.target === "opponent") return false;
  return perk.effects.every((effect) => {
    if (effect.kind !== "numericDelta") return true;
    return (effect.target ?? "self") === "self";
  });
}

export function getSinglePlayerPerkPool(): PerkDefinition[] {
  return PERK_LIBRARY.filter((perk) => perk.kind === "perk");
}

export function getSinglePlayerAntiPerkPool(): PerkDefinition[] {
  return PERK_LIBRARY.filter((perk) => isSinglePlayerAllowedAntiPerk(perk));
}

export function getPerkById(perkId: string): PerkDefinition | undefined {
  return PERK_LIBRARY.find((perk) => perk.id === perkId);
}

export function getPerkDisplayName(perkId: string): string {
  const perk = getPerkById(perkId);
  if (!perk) return perkId;
  const descriptor = PERK_MESSAGES[perk.id]?.name;
  return descriptor ? i18n._(descriptor) : perk.name;
}

export function getPerkDescription(perkId: string): string {
  const perk = getPerkById(perkId);
  if (!perk) return "";
  const descriptor = PERK_MESSAGES[perk.id]?.description;
  return descriptor ? i18n._(descriptor) : perk.description;
}

export function getPerksRequiringHandy(): Set<string> {
  return new Set(PERK_LIBRARY.filter((perk) => perk.requiresHandy).map((perk) => perk.id));
}

export function getPerksRequiringMoaning(): Set<string> {
  return new Set(PERK_LIBRARY.filter((perk) => perk.requiresMoaning).map((perk) => perk.id));
}

export function filterPerkIdsByHandyConnection(
  perkIds: string[],
  handyConnected: boolean
): string[] {
  if (handyConnected) return perkIds;
  const requiresHandy = getPerksRequiringHandy();
  return perkIds.filter((id) => !requiresHandy.has(id));
}

export function filterPerkIdsByGameplayCapabilities(
  perkIds: string[],
  input: { handyConnected: boolean; moaningAvailable: boolean }
): string[] {
  const afterHandy = filterPerkIdsByHandyConnection(perkIds, input.handyConnected);
  if (input.moaningAvailable) return afterHandy;
  const requiresMoaning = getPerksRequiringMoaning();
  return afterHandy.filter((id) => !requiresMoaning.has(id));
}
