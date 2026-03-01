import * as z from "zod";

const ZComparator = z.enum(["eq", "ne", "gt", "gte", "lt", "lte"]);
const ZConditionGroupOperator = z.enum(["all", "any"]);

export const ZAutomationRuleScope = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("global") }).strict(),
  z
    .object({
      kind: z.literal("node"),
      nodeId: z.string().trim().min(1),
    })
    .strict(),
]);

export const ZAutomationTrigger = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("node.enter"),
      nodeId: z.string().trim().min(1).optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("node.leave"),
      nodeId: z.string().trim().min(1).optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("node.stay"),
      nodeId: z.string().trim().min(1).optional(),
      elapsedMs: z.number().int().min(0).default(10_000),
      repeatMode: z.enum(["once", "repeat"]).default("once"),
    })
    .strict(),
  z
    .object({
      kind: z.literal("player.stateChanged"),
      stateKey: z.enum(["hasPerk", "hasAntiPerk", "shieldRounds", "money", "score"]),
    })
    .strict(),
  z
    .object({
      kind: z.literal("player.controlUsed"),
      control: z.enum(["pause", "skip"]).optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("round.lifecycle"),
      phase: z.enum(["queued", "started", "ended", "skipped"]),
    })
    .strict(),
  z
    .object({
      kind: z.literal("music.stateChanged"),
      state: z.enum(["trackStarted", "trackEnded", "paused", "resumed"]),
    })
    .strict(),
  z
    .object({
      kind: z.literal("session.timer"),
      timer: z.enum(["restPauseStarted", "restPauseElapsed", "turnStarted"]),
    })
    .strict(),
  z.object({ kind: z.literal("board.pathChoiceStarted") }).strict(),
  z.object({ kind: z.literal("board.pathChoiceResolved") }).strict(),
]);

const ZAutomationBaseCondition = z
  .object({
    id: z.string().trim().min(1).optional(),
    invert: z.boolean().optional(),
  })
  .strict();

const ZCurrentNodeCondition = ZAutomationBaseCondition.extend({
  kind: z.literal("currentNode"),
  comparator: z.enum(["is", "isNot"]).default("is"),
  nodeId: z.string().trim().min(1),
}).strict();

const ZTriggerNodeCondition = ZAutomationBaseCondition.extend({
  kind: z.literal("triggerNode"),
  comparator: z.enum(["is", "isNot"]).default("is"),
  nodeId: z.string().trim().min(1),
}).strict();

const ZHasPerkCondition = ZAutomationBaseCondition.extend({
  kind: z.literal("hasPerk"),
  perkId: z.string().trim().min(1),
}).strict();

const ZHasAntiPerkCondition = ZAutomationBaseCondition.extend({
  kind: z.literal("hasAntiPerk"),
  perkId: z.string().trim().min(1),
}).strict();

const ZNumericPlayerCondition = ZAutomationBaseCondition.extend({
  kind: z.enum(["playerMoney", "playerScore", "shieldRounds", "restRemainingMs"]),
  comparator: ZComparator,
  value: z.number().finite(),
}).strict();

const ZRestStateCondition = ZAutomationBaseCondition.extend({
  kind: z.literal("restState"),
  state: z.enum(["running", "paused"]),
}).strict();

const ZRoundStateCondition = ZAutomationBaseCondition.extend({
  kind: z.literal("roundState"),
  state: z.enum(["active", "queued", "none"]),
}).strict();

const ZMusicStateCondition = ZAutomationBaseCondition.extend({
  kind: z.literal("musicState"),
  state: z.enum(["playing", "paused", "stopped"]),
}).strict();

const ZCurrentTrackCondition = ZAutomationBaseCondition.extend({
  kind: z.literal("currentTrack"),
  comparator: z.enum(["is", "isNot"]).default("is"),
  trackId: z.string().trim().min(1),
}).strict();

const ZBackgroundCondition = ZAutomationBaseCondition.extend({
  kind: z.literal("background"),
  comparator: z.enum(["isSet", "isNotSet"]).default("isSet"),
}).strict();

const ZRuleCooldownCondition = ZAutomationBaseCondition.extend({
  kind: z.literal("ruleCooldown"),
  state: z.enum(["active", "inactive"]),
  ruleId: z.string().trim().min(1).optional(),
}).strict();

export const ZAutomationCondition = z.discriminatedUnion("kind", [
  ZCurrentNodeCondition,
  ZTriggerNodeCondition,
  ZHasPerkCondition,
  ZHasAntiPerkCondition,
  ZNumericPlayerCondition,
  ZRestStateCondition,
  ZRoundStateCondition,
  ZMusicStateCondition,
  ZCurrentTrackCondition,
  ZBackgroundCondition,
  ZRuleCooldownCondition,
]);

export type AutomationCondition = z.infer<typeof ZAutomationCondition>;
export type AutomationConditionGroup = {
  operator: "all" | "any";
  conditions: Array<AutomationCondition | AutomationConditionGroup>;
};

export const ZAutomationConditionGroup: z.ZodType<AutomationConditionGroup> = z.lazy(() =>
  z
    .object({
      operator: ZConditionGroupOperator.default("all"),
      conditions: z.array(z.union([ZAutomationCondition, ZAutomationConditionGroup])).default([]),
    })
    .strict()
);

const ZGraphNodeMutationStyleHint = z
  .object({
    x: z.number().finite().optional(),
    y: z.number().finite().optional(),
    color: z.string().trim().min(1).optional(),
    icon: z.string().trim().min(1).optional(),
    size: z.number().finite().positive().optional(),
    width: z.number().finite().positive().optional(),
    height: z.number().finite().positive().optional(),
  })
  .strict();

const ZRoundRef = z
  .object({
    idHint: z.string().trim().min(1).optional(),
    phash: z.string().trim().min(1).optional(),
    installSourceKeyHint: z.string().trim().min(1).optional(),
    name: z.string().trim().min(1),
    author: z.string().trim().min(1).optional(),
    type: z.enum(["Normal", "Interjection", "Cum"]).optional(),
  })
  .strict();

const ZRandomRoundFilter = z
  .object({
    tags: z.array(z.string().trim().min(1)).optional(),
    authorNames: z.array(z.string().trim().min(1)).optional(),
    libraryLabels: z.array(z.string().trim().min(1)).optional(),
  })
  .strict();

const ZGraphNodeMutation = z
  .object({
    id: z.string().trim().min(1),
    name: z.string().trim().min(1),
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
    roundRef: ZRoundRef.optional(),
    forceStop: z.boolean().optional(),
    skippable: z.boolean().optional(),
    randomPoolId: z.string().trim().min(1).optional(),
    autoAdvanceAfterCompletion: z.boolean().optional(),
    hiddenFromMap: z.boolean().optional(),
    selectionMode: z.enum(["installed", "pool"]).optional(),
    filter: ZRandomRoundFilter.optional(),
    checkpointRestMs: z.number().int().min(0).optional(),
    pauseBonusMs: z.number().int().min(0).optional(),
    visualId: z.string().trim().min(1).optional(),
    giftGuaranteedPerk: z.boolean().optional(),
    catapultForward: z.number().int().min(1).optional(),
    catapultLandingOnly: z.boolean().optional(),
    styleHint: ZGraphNodeMutationStyleHint.optional(),
  })
  .strict();

const ZGraphNodePatch = z
  .object({
    name: z.string().trim().min(1).optional(),
    kind: z
      .enum([
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
      ])
      .optional(),
    roundRef: ZRoundRef.optional(),
    forceStop: z.boolean().optional(),
    skippable: z.boolean().optional(),
    randomPoolId: z.string().trim().min(1).optional(),
    autoAdvanceAfterCompletion: z.boolean().optional(),
    hiddenFromMap: z.boolean().optional(),
    selectionMode: z.enum(["installed", "pool"]).optional(),
    filter: ZRandomRoundFilter.optional(),
    checkpointRestMs: z.number().int().min(0).optional(),
    pauseBonusMs: z.number().int().min(0).optional(),
    visualId: z.string().trim().min(1).optional(),
    giftGuaranteedPerk: z.boolean().optional(),
    catapultForward: z.number().int().min(1).optional(),
    catapultLandingOnly: z.boolean().optional(),
    styleHint: ZGraphNodeMutationStyleHint.optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, "Patch must update at least one field.");

const ZGraphEdgeMutation = z
  .object({
    id: z.string().trim().min(1),
    fromNodeId: z.string().trim().min(1),
    toNodeId: z.string().trim().min(1),
    gateCost: z.number().int().min(0).optional(),
    weight: z.number().positive().optional(),
    label: z.string().trim().min(1).optional(),
  })
  .strict();

const ZGraphEdgePatch = z
  .object({
    fromNodeId: z.string().trim().min(1).optional(),
    toNodeId: z.string().trim().min(1).optional(),
    gateCost: z.number().int().min(0).optional(),
    weight: z.number().positive().optional(),
    label: z.string().trim().min(1).optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, "Patch must update at least one field.");

const ZBackgroundPreset = z
  .object({
    kind: z.enum(["image", "video"]),
    uri: z.string().trim().min(1),
    name: z.string().trim().min(1).optional(),
    fit: z.enum(["cover", "contain", "stretch", "tile"]).default("cover"),
    position: z.enum(["center", "top", "bottom", "left", "right"]).default("center"),
    opacity: z.number().min(0).max(1).default(0.55),
    blur: z.number().min(0).max(24).default(0),
    dim: z.number().min(0).max(1).default(0.35),
    scale: z.number().min(0.25).max(4).default(1),
    offsetX: z.number().finite().default(0),
    offsetY: z.number().finite().default(0),
    motion: z.enum(["fixed", "parallax"]).default("fixed"),
    parallaxStrength: z.number().min(0).max(1).default(0.18),
  })
  .strict();

export const ZAutomationActionStep = z
  .object({
    id: z.string().trim().min(1),
    delayMs: z.number().int().min(0).optional(),
    continueOnError: z.boolean().optional(),
    action: z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("timer.pauseRest") }).strict(),
      z.object({ kind: z.literal("timer.resumeRest") }).strict(),
      z
        .object({
          kind: z.literal("timer.setRestRemainingMs"),
          remainingMs: z.number().int().min(0),
        })
        .strict(),
      z
        .object({
          kind: z.literal("player.grantPauseCharge"),
          amount: z.number().int().min(1).default(1),
        })
        .strict(),
      z
        .object({
          kind: z.literal("player.grantSkipCharge"),
          amount: z.number().int().min(1).default(1),
        })
        .strict(),
      z.object({ kind: z.literal("player.adjustMoney"), amount: z.number().int() }).strict(),
      z.object({ kind: z.literal("player.adjustScore"), amount: z.number().int() }).strict(),
      z.object({ kind: z.literal("player.applyPerk"), perkId: z.string().trim().min(1) }).strict(),
      z.object({ kind: z.literal("player.removePerk"), perkId: z.string().trim().min(1) }).strict(),
      z
        .object({
          kind: z.literal("player.applyAntiPerk"),
          perkId: z.string().trim().min(1),
        })
        .strict(),
      z
        .object({
          kind: z.literal("player.removeAntiPerk"),
          perkId: z.string().trim().min(1),
        })
        .strict(),
      z.object({ kind: z.literal("music.playTrack"), trackId: z.string().trim().min(1) }).strict(),
      z.object({ kind: z.literal("music.pause") }).strict(),
      z.object({ kind: z.literal("music.resume") }).strict(),
      z.object({ kind: z.literal("music.stop") }).strict(),
      z.object({ kind: z.literal("music.nextTrack") }).strict(),
      z
        .object({
          kind: z.literal("music.setPlaylistLoop"),
          loop: z.boolean(),
        })
        .strict(),
      z
        .object({
          kind: z.literal("background.setPreset"),
          preset: ZBackgroundPreset,
        })
        .strict(),
      z.object({ kind: z.literal("background.clearOverride") }).strict(),
      z
        .object({
          kind: z.literal("ui.showToast"),
          message: z.string().trim().min(1),
          variant: z.enum(["error", "success", "info"]).optional(),
        })
        .strict(),
      z.object({ kind: z.literal("graph.addNode"), node: ZGraphNodeMutation }).strict(),
      z
        .object({
          kind: z.literal("graph.removeNode"),
          nodeId: z.string().trim().min(1),
          fallbackNodeId: z.string().trim().min(1).optional(),
        })
        .strict(),
      z
        .object({
          kind: z.literal("graph.patchNode"),
          nodeId: z.string().trim().min(1),
          patch: ZGraphNodePatch,
        })
        .strict(),
      z.object({ kind: z.literal("graph.addEdge"), edge: ZGraphEdgeMutation }).strict(),
      z
        .object({
          kind: z.literal("graph.removeEdge"),
          edgeId: z.string().trim().min(1),
        })
        .strict(),
      z
        .object({
          kind: z.literal("graph.patchEdge"),
          edgeId: z.string().trim().min(1),
          patch: ZGraphEdgePatch,
        })
        .strict(),
      z
        .object({
          kind: z.literal("graph.setStartNode"),
          nodeId: z.string().trim().min(1),
        })
        .strict(),
      z
        .object({
          kind: z.literal("rule.enable"),
          ruleId: z.string().trim().min(1),
        })
        .strict(),
      z
        .object({
          kind: z.literal("rule.disable"),
          ruleId: z.string().trim().min(1),
        })
        .strict(),
      z
        .object({
          kind: z.literal("rule.setCooldownMs"),
          ruleId: z.string().trim().min(1),
          cooldownMs: z.number().int().min(0),
        })
        .strict(),
    ]),
  })
  .strict();

export const ZAutomationRule = z
  .object({
    id: z.string().trim().min(1),
    name: z.string().trim().min(1),
    enabled: z.boolean().default(true),
    scope: ZAutomationRuleScope,
    trigger: ZAutomationTrigger,
    conditions: ZAutomationConditionGroup.optional(),
    actions: z.array(ZAutomationActionStep).min(1),
    cooldownMs: z.number().int().min(0).default(0),
    stopAfterMatch: z.boolean().default(false),
  })
  .strict();

export const ZAutomationLibrary = z.array(ZAutomationRule).default([]);

export type AutomationRuleScope = z.infer<typeof ZAutomationRuleScope>;
export type AutomationTrigger = z.infer<typeof ZAutomationTrigger>;
export type AutomationActionStep = z.infer<typeof ZAutomationActionStep>;
export type AutomationRule = z.infer<typeof ZAutomationRule>;
export type AutomationLibrary = z.infer<typeof ZAutomationLibrary>;
