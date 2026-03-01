import * as z from "zod";
import type { InstalledRound } from "../services/db";
import {
  PERK_LIBRARY,
  getSinglePlayerAntiPerkPool,
  getSinglePlayerPerkPool,
} from "./data/perks";

export const SINGLE_PLAYER_SETUP_STORE_KEY = "game.singlePlayer.setup.v1";

const DEFAULT_ROUND_COUNT = 100;
const DEFAULT_SAFE_POINT_PRESET = [25, 50, 75];

const ZProbabilityConfig = z.object({
  initial: z.number().min(0).max(1),
  increasePerRound: z.number().min(0).max(1),
  max: z.number().min(0).max(1),
});

export const ZSinglePlayerSetup = z.object({
  version: z.literal(1).default(1),
  roundCount: z.number().int().min(1).max(500).default(DEFAULT_ROUND_COUNT),
  safePoints: z.object({
    enabled: z.boolean().default(true),
    indices: z.array(z.number().int()).default(DEFAULT_SAFE_POINT_PRESET),
  }),
  normalRoundOrder: z.array(z.string()).default([]),
  enabledCumRoundIds: z.array(z.string()).default([]),
  enabledPerkIds: z.array(z.string()).default([]),
  enabledAntiPerkIds: z.array(z.string()).default([]),
  perkTriggerChancePerRound: z.number().min(0).max(1).default(0.35),
  probabilities: z.object({
    intermediary: ZProbabilityConfig.default({
      initial: 0,
      increasePerRound: 0.02,
      max: 0.85,
    }),
    antiPerk: ZProbabilityConfig.default({
      initial: 0,
      increasePerRound: 0.015,
      max: 0.75,
    }),
  }),
});

export type SinglePlayerSetup = z.infer<typeof ZSinglePlayerSetup>;

export type SinglePlayerSessionPlan = {
  totalIndices: number;
  safePointIndices: number[];
  normalRoundIdsByIndex: Record<number, string>;
  cumRoundIds: string[];
  enabledPerkIds: string[];
  enabledAntiPerkIds: string[];
  perkTriggerChancePerRound: number;
  probabilities: {
    intermediary: {
      initial: number;
      increasePerRound: number;
      max: number;
    };
    antiPerk: {
      initial: number;
      increasePerRound: number;
      max: number;
    };
  };
};

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

const dedupeStringArray = (values: string[]): string[] => [...new Set(values)];

const sanitizeSafePointIndices = (indices: number[], roundCount: number): number[] =>
  [...new Set(indices.map((value) => Math.floor(value)))]
    .filter((value) => Number.isFinite(value) && value >= 1 && value < roundCount)
    .sort((a, b) => a - b);

const sanitizeOrderedIds = (ids: string[], validIds: Set<string>): string[] =>
  dedupeStringArray(ids).filter((id) => validIds.has(id));

const toRoundBuckets = (installedRounds: InstalledRound[]) => {
  const normals = installedRounds.filter((round) => (round.type ?? "Normal") === "Normal");
  const cums = installedRounds.filter((round) => round.type === "Cum");
  return { normals, cums };
};

export function createDefaultSinglePlayerSetup(installedRounds: InstalledRound[]): SinglePlayerSetup {
  const { normals, cums } = toRoundBuckets(installedRounds);
  const allowedPerkIds = getSinglePlayerPerkPool().map((perk) => perk.id);
  const allowedAntiPerkIds = getSinglePlayerAntiPerkPool().map((perk) => perk.id);
  return {
    version: 1,
    roundCount: DEFAULT_ROUND_COUNT,
    safePoints: {
      enabled: true,
      indices: DEFAULT_SAFE_POINT_PRESET,
    },
    normalRoundOrder: normals.map((round) => round.id),
    enabledCumRoundIds: cums.map((round) => round.id),
    enabledPerkIds: allowedPerkIds,
    enabledAntiPerkIds: allowedAntiPerkIds,
    perkTriggerChancePerRound: 0.35,
    probabilities: {
      intermediary: {
        initial: 0,
        increasePerRound: 0.02,
        max: 0.85,
      },
      antiPerk: {
        initial: 0,
        increasePerRound: 0.015,
        max: 0.75,
      },
    },
  };
}

export function normalizeSinglePlayerSetup(
  input: unknown,
  installedRounds: InstalledRound[],
): SinglePlayerSetup {
  const defaults = createDefaultSinglePlayerSetup(installedRounds);
  const parsed = ZSinglePlayerSetup.safeParse(input);
  const raw = parsed.success ? parsed.data : defaults;

  const roundCount = clamp(Math.floor(raw.roundCount), 1, 500);
  const { normals, cums } = toRoundBuckets(installedRounds);
  const normalIds = new Set(normals.map((round) => round.id));
  const cumIds = new Set(cums.map((round) => round.id));
  const allowedPerkIds = new Set(getSinglePlayerPerkPool().map((perk) => perk.id));
  const allowedAntiPerkIds = new Set(getSinglePlayerAntiPerkPool().map((perk) => perk.id));

  const safePoints = raw.safePoints.enabled
    ? sanitizeSafePointIndices(raw.safePoints.indices, roundCount)
    : [];
  const orderedNormalIds = sanitizeOrderedIds(raw.normalRoundOrder, normalIds);
  const enabledCumRoundIds = sanitizeOrderedIds(raw.enabledCumRoundIds, cumIds);
  const enabledPerkIds = sanitizeOrderedIds(raw.enabledPerkIds, allowedPerkIds);
  const enabledAntiPerkIds = sanitizeOrderedIds(raw.enabledAntiPerkIds, allowedAntiPerkIds);

  return {
    version: 1,
    roundCount,
    safePoints: {
      enabled: raw.safePoints.enabled,
      indices: safePoints,
    },
    normalRoundOrder: orderedNormalIds,
    enabledCumRoundIds,
    enabledPerkIds,
    enabledAntiPerkIds,
    perkTriggerChancePerRound: clamp(raw.perkTriggerChancePerRound, 0, 1),
    probabilities: {
      intermediary: {
        initial: clamp(raw.probabilities.intermediary.initial, 0, 1),
        increasePerRound: clamp(raw.probabilities.intermediary.increasePerRound, 0, 1),
        max: clamp(raw.probabilities.intermediary.max, 0, 1),
      },
      antiPerk: {
        initial: clamp(raw.probabilities.antiPerk.initial, 0, 1),
        increasePerRound: clamp(raw.probabilities.antiPerk.increasePerRound, 0, 1),
        max: clamp(raw.probabilities.antiPerk.max, 0, 1),
      },
    },
  };
}

export function buildSinglePlayerSessionPlan(
  setup: SinglePlayerSetup,
  installedRounds: InstalledRound[],
  randomValue: () => number = Math.random,
): SinglePlayerSessionPlan {
  const { normals, cums } = toRoundBuckets(installedRounds);
  const normalById = new Map(normals.map((round) => [round.id, round]));
  const selectedNormals = setup.normalRoundOrder.filter((id) => normalById.has(id));
  const safePointIndices = setup.safePoints.enabled
    ? sanitizeSafePointIndices(setup.safePoints.indices, setup.roundCount)
    : [];
  const safeSet = new Set(safePointIndices);
  const playableIndices: number[] = [];
  for (let index = 1; index <= setup.roundCount; index += 1) {
    if (!safeSet.has(index)) playableIndices.push(index);
  }

  const normalRoundIdsByIndex: Record<number, string> = {};
  if (selectedNormals.length > 0) {
    playableIndices.forEach((index, orderIndex) => {
      const roundId =
        orderIndex < selectedNormals.length
          ? selectedNormals[orderIndex]
          : selectedNormals[Math.floor(clamp(randomValue(), 0, 0.999999) * selectedNormals.length)];
      if (roundId) {
        normalRoundIdsByIndex[index] = roundId;
      }
    });
  }

  const cumById = new Map(cums.map((round) => [round.id, round]));
  const cumRoundIds = setup.enabledCumRoundIds.filter((id) => cumById.has(id));

  const perkIdSet = new Set(PERK_LIBRARY.filter((perk) => perk.kind === "perk").map((perk) => perk.id));
  const antiPerkIdSet = new Set(
    getSinglePlayerAntiPerkPool().map((perk) => perk.id),
  );

  return {
    totalIndices: setup.roundCount,
    safePointIndices,
    normalRoundIdsByIndex,
    cumRoundIds,
    enabledPerkIds: setup.enabledPerkIds.filter((id) => perkIdSet.has(id)),
    enabledAntiPerkIds: setup.enabledAntiPerkIds.filter((id) => antiPerkIdSet.has(id)),
    perkTriggerChancePerRound: clamp(setup.perkTriggerChancePerRound, 0, 1),
    probabilities: {
      intermediary: {
        initial: clamp(setup.probabilities.intermediary.initial, 0, 1),
        increasePerRound: clamp(setup.probabilities.intermediary.increasePerRound, 0, 1),
        max: clamp(setup.probabilities.intermediary.max, 0, 1),
      },
      antiPerk: {
        initial: clamp(setup.probabilities.antiPerk.initial, 0, 1),
        increasePerRound: clamp(setup.probabilities.antiPerk.increasePerRound, 0, 1),
        max: clamp(setup.probabilities.antiPerk.max, 0, 1),
      },
    },
  };
}
