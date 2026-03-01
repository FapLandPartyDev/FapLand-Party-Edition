import * as z from "zod";

export const CURRENT_PLAYLIST_VERSION = 1;
export const PLAYLIST_FILE_FORMAT = "f-land.playlist";
export const PLAYLIST_FILE_VERSION = 1;
export const ZPlaylistSaveMode = z.enum(["none", "checkpoint", "everywhere"]);

export const ZRoundType = z.enum(["Normal", "Interjection", "Cum"]);
export const ZGraphBackgroundFit = z.enum(["cover", "contain", "stretch", "tile"]);
export const ZGraphBackgroundPosition = z.enum(["center", "top", "bottom", "left", "right"]);
export const ZGraphBackgroundMotion = z.enum(["fixed", "parallax"]);

const HEX_COLOR_PATTERN = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;
const ZHexColor = z
  .string()
  .trim()
  .regex(HEX_COLOR_PATTERN, "Color must be a #rgb or #rrggbb hex value.");
const IMAGE_BACKGROUND_EXTENSIONS = new Set([
  "png",
  "jpg",
  "jpeg",
  "webp",
  "gif",
  "avif",
  "bmp",
  "svg",
]);
const VIDEO_BACKGROUND_EXTENSIONS = new Set(["mp4", "webm", "mov", "m4v", "mkv"]);

function getUriExtension(uri: string): string | null {
  const clean = uri.split(/[?#]/u)[0] ?? uri;
  const decoded = (() => {
    try {
      return decodeURIComponent(clean);
    } catch {
      return clean;
    }
  })();
  const match = /\.([a-z0-9]+)$/iu.exec(decoded);
  return match?.[1]?.toLowerCase() ?? null;
}

export const ZGraphBackgroundMedia = z
  .object({
    kind: z.enum(["image", "video"]),
    uri: z.string().trim().min(1),
    name: z.string().trim().min(1).optional(),
    fit: ZGraphBackgroundFit.default("cover"),
    position: ZGraphBackgroundPosition.default("center"),
    opacity: z.number().min(0).max(1).default(0.55),
    blur: z.number().min(0).max(24).default(0),
    dim: z.number().min(0).max(1).default(0.35),
    scale: z.number().min(0.25).max(4).default(1),
    offsetX: z.number().finite().default(0),
    offsetY: z.number().finite().default(0),
    motion: ZGraphBackgroundMotion.default("fixed"),
    parallaxStrength: z.number().min(0).max(1).default(0.18),
  })
  .strict()
  .superRefine((value, context) => {
    const extension = getUriExtension(value.uri);
    if (!extension) return;
    const valid =
      value.kind === "image"
        ? IMAGE_BACKGROUND_EXTENSIONS.has(extension)
        : VIDEO_BACKGROUND_EXTENSIONS.has(extension);
    if (!valid) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Background ${value.kind} URI must use a supported ${value.kind} extension.`,
        path: ["uri"],
      });
    }
  });

export const ZGraphRoadPalette = z
  .object({
    presetId: z.string().trim().min(1).optional(),
    body: ZHexColor,
    railA: ZHexColor,
    railB: ZHexColor,
    glow: ZHexColor,
    center: ZHexColor,
    gate: ZHexColor,
    marker: ZHexColor,
  })
  .strict();

export const ZGraphBoardStyle = z
  .object({
    background: ZGraphBackgroundMedia.optional(),
    roadPalette: ZGraphRoadPalette.optional(),
  })
  .strict();

export const ZPortableRoundRef = z
  .object({
    idHint: z.string().trim().min(1).optional(),
    phash: z.string().trim().min(1).optional(),
    installSourceKeyHint: z.string().trim().min(1).optional(),
    name: z.string().trim().min(1),
    author: z.string().trim().min(1).optional(),
    type: ZRoundType.optional(),
  })
  .strict();

export const ZLinearBoardConfig = z
  .object({
    mode: z.literal("linear").default("linear"),
    totalIndices: z.number().int().min(1).max(500).default(100),
    safePointIndices: z.array(z.number().int()).default([25, 50, 75]),
    safePointRestMsByIndex: z.record(z.string(), z.number().int().min(0)).default({}),
    normalRoundRefsByIndex: z.record(z.string(), ZPortableRoundRef).default({}),
    normalRoundOrder: z.array(ZPortableRoundRef).default([]),
    cumRoundRefs: z.array(ZPortableRoundRef).default([]),
  })
  .strict()
  .superRefine((value, context) => {
    const validSafePoints = new Set(value.safePointIndices.map((entry) => Math.floor(entry)));
    for (const key of Object.keys(value.safePointRestMsByIndex)) {
      const index = Number.parseInt(key, 10);
      if (!Number.isInteger(index) || index < 1 || index > value.totalIndices) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: `safePointRestMsByIndex contains invalid index ${key}`,
          path: ["safePointRestMsByIndex", key],
        });
        continue;
      }
      if (!validSafePoints.has(index)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: `safePointRestMsByIndex index ${key} is not a safe point`,
          path: ["safePointRestMsByIndex", key],
        });
      }
    }
  });

export const ZGraphNodeKind = z.enum([
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
]);

export const ZGraphNode = z
  .object({
    id: z.string().trim().min(1),
    name: z.string().trim().min(1),
    kind: ZGraphNodeKind,
    roundRef: ZPortableRoundRef.optional(),
    forceStop: z.boolean().optional(),
    skippable: z.boolean().optional(),
    randomPoolId: z.string().trim().min(1).optional(),
    checkpointRestMs: z.number().int().min(0).optional(),
    pauseBonusMs: z.number().int().min(0).optional(),
    visualId: z.string().trim().min(1).optional(),
    giftGuaranteedPerk: z.boolean().optional(),
    catapultForward: z.number().int().min(1).optional(),
    catapultLandingOnly: z.boolean().optional(),
    styleHint: z
      .object({
        x: z.number().finite().optional(),
        y: z.number().finite().optional(),
        color: z.string().trim().min(1).optional(),
        icon: z.string().trim().min(1).optional(),
        size: z.number().finite().positive().optional(),
        width: z.number().finite().positive().optional(),
        height: z.number().finite().positive().optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

export const ZGraphEdge = z
  .object({
    id: z.string().trim().min(1),
    fromNodeId: z.string().trim().min(1),
    toNodeId: z.string().trim().min(1),
    gateCost: z.number().int().min(0).optional(),
    weight: z.number().positive().optional(),
    label: z.string().trim().min(1).optional(),
  })
  .strict();

export const ZGraphTextAnnotation = z
  .object({
    id: z.string().trim().min(1),
    text: z.string().trim().min(1).max(500),
    styleHint: z
      .object({
        x: z.number().finite(),
        y: z.number().finite(),
        color: z.string().trim().min(1).optional(),
        size: z.number().finite().positive().optional(),
      })
      .strict(),
  })
  .strict();

export const ZRoundPoolCandidate = z
  .object({
    roundRef: ZPortableRoundRef,
    weight: z.number().positive().default(1),
  })
  .strict();

export const ZRoundPool = z
  .object({
    id: z.string().trim().min(1),
    name: z.string().trim().min(1).optional(),
    candidates: z.array(ZRoundPoolCandidate).min(1),
  })
  .strict();

export const ZGraphBoardConfig = z
  .object({
    mode: z.literal("graph"),
    startNodeId: z.string().trim().min(1),
    nodes: z.array(ZGraphNode).min(1),
    edges: z.array(ZGraphEdge).default([]),
    textAnnotations: z.array(ZGraphTextAnnotation).optional().default([]),
    randomRoundPools: z.array(ZRoundPool).default([]),
    cumRoundRefs: z.array(ZPortableRoundRef).default([]),
    pathChoiceTimeoutMs: z.number().int().min(1000).max(30000).default(12000),
    style: ZGraphBoardStyle.optional(),
  })
  .strict()
  .superRefine((value, context) => {
    const nodeIds = new Set<string>();
    const edgeIds = new Set<string>();
    const outgoingCountByNodeId = new Map<string, number>();

    for (const node of value.nodes) {
      if (nodeIds.has(node.id)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Duplicate node id: ${node.id}`,
          path: ["nodes"],
        });
      }
      nodeIds.add(node.id);

      if (node.kind === "round" && !node.roundRef) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Round node ${node.id} must define roundRef`,
          path: ["nodes"],
        });
      }

      if (node.kind !== "round" && node.kind !== "perk" && typeof node.forceStop === "boolean") {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Only round and perk nodes may define forceStop (${node.id})`,
          path: ["nodes"],
        });
      }

      if (node.kind !== "round" && typeof node.skippable === "boolean") {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Only round nodes may define skippable (${node.id})`,
          path: ["nodes"],
        });
      }

      if (node.kind !== "safePoint" && typeof node.checkpointRestMs === "number") {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Only safePoint nodes may define additional rest (${node.id})`,
          path: ["nodes"],
        });
      }

      if (node.kind !== "campfire" && typeof node.pauseBonusMs === "number") {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Only campfire nodes may define pauseBonusMs (${node.id})`,
          path: ["nodes"],
        });
      }

      if (node.kind !== "perk" && typeof node.giftGuaranteedPerk === "boolean") {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Only perk nodes may define giftGuaranteedPerk (${node.id})`,
          path: ["nodes"],
        });
      }

      if (node.kind === "end" && node.roundRef) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: `End node ${node.id} must not define roundRef`,
          path: ["nodes"],
        });
      }

      if (node.kind === "end" && node.randomPoolId) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: `End node ${node.id} must not define randomPoolId`,
          path: ["nodes"],
        });
      }

      if (node.kind !== "catapult" && typeof node.catapultForward === "number") {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Only catapult nodes may define catapultForward (${node.id})`,
          path: ["nodes"],
        });
      }

      if (node.kind !== "catapult" && typeof node.catapultLandingOnly === "boolean") {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Only catapult nodes may define catapultLandingOnly (${node.id})`,
          path: ["nodes"],
        });
      }
    }

    const startNode = value.nodes.find((node) => node.id === value.startNodeId);
    if (!startNode) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: `startNodeId ${value.startNodeId} does not exist`,
        path: ["startNodeId"],
      });
    } else if (startNode.kind !== "start") {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "startNodeId must reference a node with kind 'start'",
        path: ["startNodeId"],
      });
    }

    const endNodes = value.nodes.filter((node) => node.kind === "end");
    if (endNodes.length === 0) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Graph must contain at least one end node",
        path: ["nodes"],
      });
    }

    for (const edge of value.edges) {
      if (edgeIds.has(edge.id)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Duplicate edge id: ${edge.id}`,
          path: ["edges"],
        });
      }
      edgeIds.add(edge.id);

      if (!nodeIds.has(edge.fromNodeId)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Edge ${edge.id} references unknown fromNodeId ${edge.fromNodeId}`,
          path: ["edges"],
        });
      }
      if (!nodeIds.has(edge.toNodeId)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Edge ${edge.id} references unknown toNodeId ${edge.toNodeId}`,
          path: ["edges"],
        });
      }

      outgoingCountByNodeId.set(
        edge.fromNodeId,
        (outgoingCountByNodeId.get(edge.fromNodeId) ?? 0) + 1
      );
    }

    const poolIds = new Set<string>();
    for (const pool of value.randomRoundPools) {
      if (poolIds.has(pool.id)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Duplicate random pool id: ${pool.id}`,
          path: ["randomRoundPools"],
        });
      }
      poolIds.add(pool.id);
    }

    for (const node of value.nodes) {
      const outgoingCount = outgoingCountByNodeId.get(node.id) ?? 0;
      if (node.kind === "end" && outgoingCount > 0) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: `End node ${node.id} must not have outgoing edges`,
          path: ["edges"],
        });
      }
      if (node.kind !== "end" && outgoingCount === 0) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Node ${node.id} must lead to at least one end node path; only end nodes may be dead ends`,
          path: ["nodes"],
        });
      }
    }
  });

export const ZBoardConfig = z.union([ZLinearBoardConfig, ZGraphBoardConfig]);

export const ZPlaylistMusicTrack = z
  .object({
    id: z.string().trim().min(1),
    uri: z.string().trim().min(1),
    name: z.string().trim().min(1),
  })
  .strict();

export const ZPlaylistMusic = z
  .object({
    tracks: z.array(ZPlaylistMusicTrack).default([]),
    loop: z.boolean().default(true),
  })
  .strict();

export const ZPlaylistConfig = z
  .object({
    playlistVersion: z.number().int().min(1).default(CURRENT_PLAYLIST_VERSION),
    boardConfig: ZBoardConfig,
    music: ZPlaylistMusic.optional(),
    saveMode: ZPlaylistSaveMode.default("none"),
    roundStartDelayMs: z.number().int().min(0).max(300000).default(20000),
    dice: z
      .object({
        min: z.number().int().min(1).max(20).default(1),
        max: z.number().int().min(1).max(20).default(6),
      })
      .default({ min: 1, max: 6 })
      .superRefine((value, context) => {
        if (value.min > value.max) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            message: "dice.min must be less than or equal to dice.max",
            path: ["min"],
          });
        }
      }),
    perkSelection: z
      .object({
        optionsPerPick: z.number().int().min(1).max(10).default(3),
        triggerChancePerCompletedRound: z.number().min(0).max(1).default(0.35),
      })
      .strict(),
    perkPool: z
      .object({
        enabledPerkIds: z.array(z.string()).default([]),
        enabledAntiPerkIds: z.array(z.string()).default([]),
      })
      .strict(),
    probabilityScaling: z
      .object({
        initialIntermediaryProbability: z.number().min(0).max(1).default(0.1),
        initialAntiPerkProbability: z.number().min(0).max(1).default(0.1),
        intermediaryIncreasePerRound: z.number().min(0).max(1).default(0.02),
        antiPerkIncreasePerRound: z.number().min(0).max(1).default(0.015),
        maxIntermediaryProbability: z.number().min(0).max(1).default(1),
        maxAntiPerkProbability: z.number().min(0).max(1).default(0.75),
      })
      .strict(),
    economy: z
      .object({
        startingMoney: z.number().int().min(0).default(120),
        moneyPerCompletedRound: z.number().int().min(0).default(50),
        startingScore: z.number().int().min(0).default(0),
        scorePerCompletedRound: z.number().int().min(0).default(100),
        scorePerIntermediary: z.number().int().min(0).default(30),
        scorePerActiveAntiPerk: z.number().int().min(0).default(25),
        scorePerCumRoundSuccess: z.number().int().min(0).default(420),
      })
      .strict(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.playlistVersion > CURRENT_PLAYLIST_VERSION) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Unsupported playlistVersion ${value.playlistVersion}. Current supported version is ${CURRENT_PLAYLIST_VERSION}.`,
        path: ["playlistVersion"],
      });
    }
  });

export const ZPlaylistEnvelopeV1 = z
  .object({
    format: z.literal(PLAYLIST_FILE_FORMAT),
    version: z.literal(PLAYLIST_FILE_VERSION),
    metadata: z
      .object({
        name: z.string().trim().min(1),
        description: z.string().optional(),
        exportedAt: z.string().optional(),
      })
      .strict(),
    config: ZPlaylistConfig,
  })
  .strict();

export type PortableRoundRef = z.infer<typeof ZPortableRoundRef>;
export type LinearBoardConfig = z.infer<typeof ZLinearBoardConfig>;
export type GraphBackgroundFit = z.infer<typeof ZGraphBackgroundFit>;
export type GraphBackgroundPosition = z.infer<typeof ZGraphBackgroundPosition>;
export type GraphBackgroundMotion = z.infer<typeof ZGraphBackgroundMotion>;
export type GraphBackgroundMedia = z.infer<typeof ZGraphBackgroundMedia>;
export type GraphRoadPalette = z.infer<typeof ZGraphRoadPalette>;
export type GraphBoardStyle = z.infer<typeof ZGraphBoardStyle>;
export type GraphTextAnnotation = z.infer<typeof ZGraphTextAnnotation>;
export type GraphBoardConfig = z.infer<typeof ZGraphBoardConfig>;
export type BoardConfig = z.infer<typeof ZBoardConfig>;
export type PlaylistConfig = z.infer<typeof ZPlaylistConfig>;
export type PlaylistEnvelopeV1 = z.infer<typeof ZPlaylistEnvelopeV1>;
export type PlaylistSaveMode = z.infer<typeof ZPlaylistSaveMode>;
export type PlaylistMusicTrack = z.infer<typeof ZPlaylistMusicTrack>;
export type PlaylistMusic = z.infer<typeof ZPlaylistMusic>;

export function isLinearBoardConfig(config: BoardConfig): config is LinearBoardConfig {
  return config.mode === "linear";
}

export function isGraphBoardConfig(config: BoardConfig): config is GraphBoardConfig {
  return config.mode === "graph";
}
