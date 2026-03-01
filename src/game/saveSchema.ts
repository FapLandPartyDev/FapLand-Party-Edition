import * as z from "zod";
import { ZAutomationLibrary } from "./automation/schema";
import { ZPlaylistConfig, ZPlaylistSaveMode } from "./playlistSchema";

const ZGameEffect = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("numericDelta"),
    stat: z.enum(["diceMin", "diceMax", "roundPauseMs", "perkFrequency", "perkLuck"]),
    amount: z.number(),
    target: z.enum(["self", "opponent", "all"]).optional(),
    min: z.number().optional(),
    max: z.number().optional(),
  }),
  z.object({ kind: z.literal("triggerPerkChoice") }),
  z.object({
    kind: z.literal("probabilityDelta"),
    stat: z.enum(["intermediaryProbability", "antiPerkProbability"]),
    amount: z.number(),
    min: z.number().optional(),
    max: z.number().optional(),
    singlePlayerOnly: z.boolean().optional(),
  }),
  z.object({
    kind: z.literal("scoreDelta"),
    amount: z.number(),
    min: z.number().optional(),
    max: z.number().optional(),
    target: z.enum(["self", "opponent", "all"]).optional(),
  }),
  z.object({
    kind: z.literal("grantRoundControl"),
    control: z.enum(["pause", "skip"]),
    amount: z.number().int(),
  }),
  z.object({
    kind: z.literal("roundControlDelta"),
    control: z.enum(["pause", "skip"]),
    amount: z.number().int(),
  }),
  z.object({ kind: z.literal("setShieldRounds"), rounds: z.number().int() }),
  z.object({ kind: z.literal("cleanseAntiPerks") }),
  z.object({ kind: z.literal("setPendingRollMultiplier"), multiplier: z.number() }),
  z.object({ kind: z.literal("setPendingRollCeiling"), ceiling: z.number() }),
  z.object({ kind: z.literal("setPendingIntensityCap"), cap: z.number() }),
]);

const ZRoadPalette = z.object({
  presetId: z.string().optional(),
  body: z.string(),
  railA: z.string(),
  railB: z.string(),
  glow: z.string(),
  center: z.string(),
  gate: z.string(),
  marker: z.string(),
});

const ZBoardField = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  kind: z.enum([
    "start",
    "end",
    "path",
    "safePoint",
    "campfire",
    "round",
    "randomRound",
    "perk",
    "event",
    "catapult",
  ]),
  fixedRoundId: z.string().optional(),
  forceStop: z.boolean().optional(),
  skippable: z.boolean().optional(),
  randomPoolId: z.string().optional(),
  autoAdvanceAfterCompletion: z.boolean().optional(),
  hiddenFromMap: z.boolean().optional(),
  randomSelectionMode: z.enum(["installed", "pool"]).optional(),
  randomFilter: z
    .object({
      tags: z.array(z.string()).optional(),
      authorNames: z.array(z.string()).optional(),
      libraryLabels: z.array(z.string()).optional(),
    })
    .optional(),
  checkpointRestMs: z.number().int().optional(),
  cumPoint: z.boolean().optional(),
  pauseBonusMs: z.number().int().optional(),
  visualId: z.string().optional(),
  giftGuaranteedPerk: z.boolean().optional(),
  catapultForward: z.number().int().optional(),
  catapultLandingOnly: z.boolean().optional(),
  roundCountdownDurationSec: z.number().positive().max(15).optional(),
  roundOverlineLabel: z.string().optional(),
  roundTransitionPalette: ZRoadPalette.optional(),
  styleHint: z
    .object({
      x: z.number().optional(),
      y: z.number().optional(),
      color: z.string().optional(),
      icon: z.string().optional(),
      size: z.number().optional(),
      width: z.number().optional(),
      height: z.number().optional(),
    })
    .optional(),
  round: z.object({ slot: z.number().int() }).optional(),
  effects: z.array(ZGameEffect).optional(),
});

const ZMapTextAnnotation = z.object({
  id: z.string().min(1),
  text: z.string().min(1),
  styleHint: z.object({
    x: z.number(),
    y: z.number(),
    color: z.string().optional(),
    size: z.number().optional(),
  }),
});

const ZMapBackgroundMedia = z.object({
  id: z.string().min(1).optional(),
  kind: z.enum(["image", "video"]),
  uri: z.string().min(1),
  name: z.string().optional(),
  fit: z.enum(["cover", "contain", "stretch", "tile"]),
  position: z.enum(["center", "top", "bottom", "left", "right"]),
  opacity: z.number(),
  blur: z.number(),
  dim: z.number(),
  scale: z.number(),
  offsetX: z.number(),
  offsetY: z.number(),
  motion: z.enum(["fixed", "parallax"]).optional(),
  parallaxStrength: z.number().optional(),
});

const ZMapStyle = z.object({
  background: ZMapBackgroundMedia.optional(),
  roadPalette: ZRoadPalette.optional(),
});

const ZRuntimeGraphEdge = z.object({
  id: z.string().min(1),
  fromNodeId: z.string().min(1),
  toNodeId: z.string().min(1),
  gateCost: z.number().int(),
  weight: z.number(),
  label: z.string().optional(),
});

const ZRuntimeGraphRandomPool = z.object({
  id: z.string().min(1),
  candidates: z.array(
    z.object({
      roundId: z.string().min(1),
      weight: z.number(),
    })
  ),
});

const ZGameConfig = z.object({
  board: z.array(ZBoardField),
  mapTextAnnotations: z.array(ZMapTextAnnotation).optional(),
  mapStyle: ZMapStyle.optional(),
  runtimeGraph: z.object({
    startNodeId: z.string().min(1),
    pathChoiceTimeoutMs: z.number().int(),
    edges: z.array(ZRuntimeGraphEdge),
    edgesById: z.record(z.string(), ZRuntimeGraphEdge),
    outgoingEdgeIdsByNodeId: z.record(z.string(), z.array(z.string())),
    randomRoundPoolsById: z.record(z.string(), ZRuntimeGraphRandomPool),
    nodeIndexById: z.record(z.string(), z.number().int()),
  }),
  dice: z.object({
    min: z.number().int(),
    max: z.number().int(),
  }),
  perkSelection: z.object({
    optionsPerPick: z.number().int(),
    triggerChancePerCompletedRound: z.number(),
    includeAntiPerksInChoices: z.boolean().optional(),
  }),
  perkPool: z.object({
    enabledPerkIds: z.array(z.string()),
    enabledAntiPerkIds: z.array(z.string()),
  }),
  probabilityScaling: z.object({
    initialIntermediaryProbability: z.number(),
    initialAntiPerkProbability: z.number(),
    intermediaryIncreasePerRound: z.number(),
    antiPerkIncreasePerRound: z.number(),
    maxIntermediaryProbability: z.number(),
    maxAntiPerkProbability: z.number(),
    resetIntermediaryProbabilityAfterTrigger: z.boolean().optional().default(false),
    resetAntiPerkProbabilityAfterTrigger: z.boolean().optional().default(false),
  }),
  singlePlayer: z.object({
    totalIndices: z.number().int(),
    safePointIndices: z.array(z.number().int()),
    normalRoundIdsByIndex: z.record(z.string(), z.string()),
    cumRoundIds: z.array(z.string()),
  }),
  economy: z.object({
    startingMoney: z.number().int(),
    moneyPerCompletedRound: z.number().int(),
    startingScore: z.number().int(),
    scorePerCompletedRound: z.number().int(),
    scorePerIntermediary: z.number().int(),
    scorePerActiveAntiPerk: z.number().int(),
    scorePerCumRoundSuccess: z.number().int(),
  }),
  roundStartDelayMs: z.number().int(),
  disableDiceAnimation: z.boolean().optional(),
  automations: ZAutomationLibrary.optional().default([]),
});

const ZInventoryItem = z.object({
  itemId: z.string().min(1),
  perkId: z.string().min(1),
  kind: z.enum(["perk", "antiPerk"]),
  name: z.string().min(1),
  cost: z.number().int(),
  acquiredTurn: z.number().int(),
});

const ZActivePerkEffect = z.object({
  id: z.string().min(1),
  name: z.string().optional(),
  kind: z.enum(["perk", "antiPerk"]),
  remainingRounds: z.number().int().nullable(),
  effects: z.array(ZGameEffect),
  appliedTurn: z.number().int(),
  appliedAfterRoll: z.boolean(),
});

const ZPlayerState = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  currentNodeId: z.string().min(1),
  position: z.number().int(),
  stats: z.object({
    diceMin: z.number(),
    diceMax: z.number(),
    roundPauseMs: z.number(),
    perkFrequency: z.number(),
    perkLuck: z.number(),
  }),
  money: z.number().int(),
  score: z.number().int(),
  perks: z.array(z.string()),
  antiPerks: z.array(z.string()),
  inventory: z.array(ZInventoryItem),
  activePerkEffects: z.array(ZActivePerkEffect),
  roundControl: z
    .object({
      pauseCharges: z.number().int(),
      skipCharges: z.number().int(),
    })
    .optional(),
  shieldRoundsRemaining: z.number().int().optional(),
  pendingRollMultiplier: z.number().nullable().optional(),
  pendingRollCeiling: z.number().nullable().optional(),
  pendingIntensityCap: z.number().nullable().optional(),
});

const ZActiveRound = z.object({
  fieldId: z.string().min(1),
  nodeId: z.string().min(1),
  roundId: z.string().min(1),
  playlistRoundIds: z.array(z.string().min(1)).min(1).optional(),
  roundName: z.string().min(1),
  skippable: z.boolean().optional(),
  selectionKind: z.enum(["fixed", "random", "cum", "cumPoint"]),
  poolId: z.string().nullable(),
  phaseKind: z.enum(["normal", "cum", "cumPoint"]),
  campaignIndex: z.number().int().nullable(),
  roundCountdownDurationSec: z.number().positive().max(15).optional(),
  roundOverlineLabel: z.string().optional(),
  roundTransitionPalette: ZRoadPalette.optional(),
});

const ZRoundAudioEffect = z.object({
  kind: z.literal("continuousMoaning"),
  sourcePerkId: z.string().min(1),
});

const ZPendingPathChoice = z.object({
  playerId: z.string().min(1),
  fromNodeId: z.string().min(1),
  remainingSteps: z.number().int(),
  traversedNodeIds: z.array(z.string()),
  options: z.array(
    z.object({
      edgeId: z.string().min(1),
      toNodeId: z.string().min(1),
      toFieldName: z.string().min(1),
      gateCost: z.number().int(),
      label: z.string().optional(),
    })
  ),
});

const ZPendingPerkSelection = z.object({
  playerId: z.string().min(1),
  fromFieldId: z.string().min(1),
  options: z.array(
    z.object({
      id: z.string().min(1),
      name: z.string().min(1),
      description: z.string(),
      iconKey: z.string().min(1),
      cost: z.number().int(),
      rarity: z.enum(["common", "rare", "epic", "legendary"]).optional(),
      kind: z.enum(["perk", "antiPerk"]),
      target: z.enum(["self", "opponent"]),
      durationRounds: z.number().int().nullable().optional(),
      application: z.enum(["persistent", "immediate"]).optional(),
      effects: z.array(ZGameEffect),
      requiresHandy: z.boolean().optional(),
      requiresMoaning: z.boolean().optional(),
    })
  ),
});

const ZAutomationRuntimeEvent = z.object({
  id: z.string().min(1),
  kind: z.enum([
    "node.enter",
    "node.leave",
    "node.stay",
    "player.stateChanged",
    "player.controlUsed",
    "round.lifecycle",
    "music.stateChanged",
    "session.timer",
    "board.pathChoiceStarted",
    "board.pathChoiceResolved",
  ]),
  playerId: z.string().min(1).optional(),
  nodeId: z.string().min(1).optional(),
  previousNodeId: z.string().min(1).optional(),
  elapsedMs: z.number().int().optional(),
  repeatMode: z.enum(["once", "repeat"]).optional(),
  control: z.enum(["pause", "skip"]).optional(),
  roundPhase: z.enum(["queued", "started", "ended", "skipped"]).optional(),
  musicState: z.enum(["trackStarted", "trackEnded", "paused", "resumed"]).optional(),
  timer: z.enum(["restPauseStarted", "restPauseElapsed", "turnStarted"]).optional(),
  stateKey: z.enum(["hasPerk", "hasAntiPerk", "shieldRounds", "money", "score"]).optional(),
  timestampMs: z.number().int().nonnegative(),
});

const ZAutomationScheduledStep = z.object({
  executionId: z.string().min(1),
  ruleId: z.string().min(1),
  stepIndex: z.number().int().nonnegative(),
  runAtMs: z.number().int().nonnegative(),
  event: ZAutomationRuntimeEvent,
});

export const ZPersistedGameState = z.object({
  config: ZGameConfig,
  players: z.array(ZPlayerState),
  currentPlayerIndex: z.number().int(),
  turn: z.number().int(),
  sessionPhase: z.enum(["normal", "cum", "completed"]),
  bonusRolls: z.number().int(),
  nextCumRoundIndex: z.number().int(),
  highscore: z.number().int(),
  intermediaryProbability: z.number(),
  antiPerkProbability: z.number(),
  queuedRound: ZActiveRound.nullable(),
  activeRound: ZActiveRound.nullable(),
  queuedRoundAudioEffect: ZRoundAudioEffect.nullable()
    .optional()
    .transform((value) => value ?? null),
  activeRoundAudioEffect: ZRoundAudioEffect.nullable()
    .optional()
    .transform((value) => value ?? null),
  pendingPathChoice: ZPendingPathChoice.nullable(),
  pendingPerkSelection: ZPendingPerkSelection.nullable(),
  pendingCumPointChoice: z
    .object({
      playerId: z.string().min(1),
      nodeId: z.string().min(1),
    })
    .nullable()
    .optional()
    .transform((value) => value ?? null),
  lastTraversalPathNodeIds: z.array(z.string()),
  playedRoundIdsByPool: z.record(z.string(), z.array(z.string())),
  automationState: z
    .object({
      queuedEvents: z.array(ZAutomationRuntimeEvent),
      scheduledSteps: z.array(ZAutomationScheduledStep),
      nowMs: z.number().int().nonnegative(),
      executionCountThisTick: z.number().int().nonnegative(),
    })
    .optional()
    .default({
      queuedEvents: [],
      scheduledSteps: [],
      nowMs: 0,
      executionCountThisTick: 0,
    }),
  runtimeMapOverrides: z
    .object({
      backgroundOverride: ZMapBackgroundMedia.nullable(),
    })
    .optional()
    .default({
      backgroundOverride: null,
    }),
  runtimeMusicState: z
    .object({
      currentTrackId: z.string().min(1).nullable(),
      currentTrackName: z.string().min(1).nullable(),
      isPlaying: z.boolean(),
      loop: z.boolean(),
    })
    .optional()
    .default({
      currentTrackId: null,
      currentTrackName: null,
      isPlaying: false,
      loop: true,
    }),
  recentAutomationEvents: z.array(ZAutomationRuntimeEvent).optional().default([]),
  ruleCooldownsById: z.record(z.string(), z.number().int().nonnegative()).optional().default({}),
  automationRuleOverrides: z
    .record(
      z.string(),
      z.object({
        enabled: z.boolean().optional(),
        cooldownMs: z.number().int().min(0).optional(),
      })
    )
    .optional()
    .default({}),
  restTimerPaused: z.boolean().default(false),
  restTimerRemainingMsOverride: z.number().int().min(0).nullable().default(null),
  log: z.array(z.string()),
  lastRoll: z.number().int().nullable(),
  endlessRoundsCompleted: z.number().int().default(0),
  antiPerkTriggeredThisRound: z.boolean().optional().default(false),
  completionReason: z
    .enum([
      "finished",
      "self_reported_cum",
      "cum_instruction_failed",
      "cum_point",
      "cum_point_instruction_failed",
      "player_ended_endless",
    ])
    .nullable(),
});

export const ZSinglePlayerRunSaveSnapshot = z.object({
  version: z.literal(1),
  playlistId: z.string().min(1),
  playlistFormatVersion: z.number().int().min(1).nullable(),
  playlistConfig: ZPlaylistConfig,
  saveMode: ZPlaylistSaveMode,
  gameState: ZPersistedGameState,
  sessionStartedAtMs: z.number().int().nonnegative(),
  savedAtMs: z.number().int().nonnegative(),
});

export type PersistedGameState = z.infer<typeof ZPersistedGameState>;
export type SinglePlayerRunSaveSnapshot = z.infer<typeof ZSinglePlayerRunSaveSnapshot>;
