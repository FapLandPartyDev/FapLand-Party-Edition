import type { InstalledRound } from "../services/db";
import {
  CURRENT_PLAYLIST_VERSION,
  ZPlaylistConfig,
  type EndlessBoardConfig,
  type GraphBoardConfig,
  type LinearBoardConfig,
  type PlaylistConfig,
  type PortableRoundRef,
} from "./playlistSchema";
import {
  type PlaylistResolutionRoundLike,
  resolvePortableRoundRefExact,
  toPortableRoundRefFromRound,
} from "./playlistResolution";
import {
  DICE_ANTIPERK_IDS,
  DICE_PERK_IDS,
  getSinglePlayerAntiPerkPool,
  getSinglePlayerPerkPool,
} from "./data/perks";
import type {
  BoardField,
  BoardFieldKind,
  EndlessGenerationConfig,
  GameConfig,
  RuntimeGraphConfig,
  RuntimeGraphEdge,
  RuntimeGraphRandomPool,
} from "./types";

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function randomIndex(length: number, randomValue: () => number): number {
  return Math.floor(clamp(randomValue(), 0, 0.999999) * length);
}

function buildRandomInstalledRoundPool(
  installedRounds: ReadonlyArray<InstalledRound>
): RuntimeGraphRandomPool {
  const eligible = installedRounds.filter(
    (round) => !round.excludeFromRandom && (round.type ?? "Normal") === "Normal"
  );
  return {
    id: "__installed-rounds__",
    candidates: eligible.map((round) => ({
      roundId: round.id,
      weight: 1,
    })),
  };
}

export function toPortableRoundRef(round: PlaylistResolutionRoundLike): PortableRoundRef {
  return toPortableRoundRefFromRound(round);
}

export function resolvePortableRoundRef<T extends PlaylistResolutionRoundLike>(
  ref: PortableRoundRef,
  installedRounds: ReadonlyArray<T>
): T | null {
  return resolvePortableRoundRefExact(ref, installedRounds);
}

function toBoardKind(kind: string): BoardFieldKind {
  if (kind === "start") return "start";
  if (kind === "end") return "end";
  if (kind === "safePoint") return "safePoint";
  if (kind === "campfire") return "campfire";
  if (kind === "round") return "round";
  if (kind === "randomRound") return "randomRound";
  if (kind === "perk") return "perk";
  if (kind === "event") return "event";
  if (kind === "catapult") return "catapult";
  return "path";
}

function buildRuntimeGraph(
  board: BoardField[],
  startNodeId: string,
  edges: RuntimeGraphEdge[],
  randomPools: RuntimeGraphRandomPool[],
  pathChoiceTimeoutMs: number
): RuntimeGraphConfig {
  const edgesById: Record<string, RuntimeGraphEdge> = {};
  const outgoingEdgeIdsByNodeId: Record<string, string[]> = {};
  for (const edge of edges) {
    edgesById[edge.id] = edge;
    const outgoing = outgoingEdgeIdsByNodeId[edge.fromNodeId];
    if (outgoing) {
      outgoing.push(edge.id);
    } else {
      outgoingEdgeIdsByNodeId[edge.fromNodeId] = [edge.id];
    }
  }

  const nodeIndexById = board.reduce<Record<string, number>>((acc, node, index) => {
    acc[node.id] = index;
    return acc;
  }, {});

  const randomRoundPoolsById: Record<string, RuntimeGraphRandomPool> = {};
  for (const pool of randomPools) {
    randomRoundPoolsById[pool.id] = pool;
  }

  return {
    startNodeId,
    pathChoiceTimeoutMs,
    edges,
    edgesById,
    outgoingEdgeIdsByNodeId,
    randomRoundPoolsById,
    nodeIndexById,
  };
}

function normalizeSafePoints(indices: number[], totalIndices: number): number[] {
  return [...new Set(indices.map((value) => Math.floor(value)))]
    .filter((value) => Number.isFinite(value) && value >= 1 && value < totalIndices)
    .sort((a, b) => a - b);
}

function buildLinearConfig(
  config: LinearBoardConfig,
  installedRounds: ReadonlyArray<InstalledRound>,
  randomValue: () => number
): GameConfig {
  const totalIndices = clamp(config.totalIndices, 1, 500);
  const safePointIndices = normalizeSafePoints(config.safePointIndices, totalIndices);
  const safeSet = new Set(safePointIndices);

  const orderedRounds = config.normalRoundOrder
    .map((ref) => resolvePortableRoundRef(ref, installedRounds))
    .filter((round): round is InstalledRound => Boolean(round));
  const orderedRoundIds = orderedRounds.map((round) => round.id);

  const explicitByIndex = Object.entries(config.normalRoundRefsByIndex).reduce<
    Record<number, string>
  >((acc, [rawIndex, ref]) => {
    const index = Number(rawIndex);
    if (!Number.isInteger(index) || index < 1 || index > totalIndices) return acc;
    const resolved = resolvePortableRoundRef(ref, installedRounds);
    if (!resolved) return acc;
    acc[index] = resolved.id;
    return acc;
  }, {});

  const normalRoundIdsByIndex: Record<number, string> = { ...explicitByIndex };
  const board: BoardField[] = [{ id: "start", name: "Start", kind: "start" }];
  let orderedCursor = 0;

  for (let index = 1; index <= totalIndices; index += 1) {
    if (safeSet.has(index)) {
      const checkpointRestMs = config.safePointRestMsByIndex[String(index)];
      board.push({
        id: `safe-${index}`,
        name: `Safe Point ${index}`,
        kind: "safePoint",
        checkpointRestMs: typeof checkpointRestMs === "number" ? checkpointRestMs : undefined,
      });
      continue;
    }

    const explicitRoundId = normalRoundIdsByIndex[index];
    let roundId = explicitRoundId;
    if (!roundId && orderedRoundIds.length > 0) {
      if (orderedCursor < orderedRoundIds.length) {
        roundId = orderedRoundIds[orderedCursor];
        orderedCursor += 1;
      } else {
        roundId = orderedRoundIds[randomIndex(orderedRoundIds.length, randomValue)];
      }
      if (roundId) {
        normalRoundIdsByIndex[index] = roundId;
      }
    }

    board.push({
      id: `round-${index}`,
      name: index === totalIndices ? `Final Round ${index}` : `Round ${index}`,
      kind: roundId ? "round" : "path",
      fixedRoundId: roundId,
    });
  }

  board.push({
    id: "end",
    name: "End",
    kind: "end",
  });

  const edges: RuntimeGraphEdge[] = [];
  for (let index = 0; index < board.length - 1; index += 1) {
    const from = board[index];
    const to = board[index + 1];
    if (!from || !to) continue;
    edges.push({
      id: `edge-${from.id}-${to.id}`,
      fromNodeId: from.id,
      toNodeId: to.id,
      gateCost: 0,
      weight: 1,
    });
  }

  const cumRoundIds = config.cumRoundRefs
    .map((ref) => resolvePortableRoundRef(ref, installedRounds)?.id)
    .filter((id): id is string => Boolean(id));

  return {
    board,
    mapTextAnnotations: [],
    mapStyle: undefined,
    runtimeGraph: buildRuntimeGraph(board, "start", edges, [], 6000),
    dice: { min: 1, max: 6 },
    perkSelection: {
      optionsPerPick: 3,
      triggerChancePerCompletedRound: 0.35,
    },
    perkPool: {
      enabledPerkIds: getSinglePlayerPerkPool().map((p) => p.id),
      enabledAntiPerkIds: getSinglePlayerAntiPerkPool().map((p) => p.id),
    },
    probabilityScaling: {
      initialIntermediaryProbability: 0.1,
      initialAntiPerkProbability: 0.1,
      intermediaryIncreasePerRound: 0.02,
      antiPerkIncreasePerRound: 0.015,
      maxIntermediaryProbability: 1,
      maxAntiPerkProbability: 0.75,
      resetIntermediaryProbabilityAfterTrigger: false,
      resetAntiPerkProbabilityAfterTrigger: false,
    },
    singlePlayer: {
      totalIndices,
      safePointIndices,
      normalRoundIdsByIndex,
      cumRoundIds,
    },
    economy: {
      startingMoney: 120,
      moneyPerCompletedRound: 50,
      startingScore: 0,
      scorePerCompletedRound: 100,
      scorePerIntermediary: 30,
      scorePerActiveAntiPerk: 25,
      scorePerCumRoundSuccess: 420,
    },
    roundStartDelayMs: 20000,
    disableDiceAnimation: false,
    automations: [],
  };
}

function buildGraphConfig(
  config: GraphBoardConfig,
  installedRounds: ReadonlyArray<InstalledRound>
): GameConfig {
  const resolvedRoundByNodeId = config.nodes.reduce<Record<string, string>>((acc, node) => {
    if (!node.roundRef) return acc;
    const resolved = resolvePortableRoundRef(node.roundRef, installedRounds);
    if (resolved) acc[node.id] = resolved.id;
    return acc;
  }, {});
  const resolvedPlaylistRoundIdsByNodeId = config.nodes.reduce<Record<string, string[]>>(
    (acc, node) => {
      if (node.kind !== "round") return acc;
      const refs = node.roundPlaylistRefs?.length
        ? node.roundPlaylistRefs
        : node.roundRef
          ? [node.roundRef]
          : [];
      const ids = refs
        .map((ref) => resolvePortableRoundRef(ref, installedRounds)?.id ?? null)
        .filter((id): id is string => Boolean(id));
      if (ids.length > 0) acc[node.id] = [...new Set(ids)];
      return acc;
    },
    {}
  );

  const board: BoardField[] = config.nodes.map((node) => ({
    id: node.id,
    name: node.name,
    kind: toBoardKind(node.kind),
    checkpointRestMs: typeof node.checkpointRestMs === "number" ? node.checkpointRestMs : undefined,
    pauseBonusMs: typeof node.pauseBonusMs === "number" ? node.pauseBonusMs : undefined,
    visualId: node.visualId,
    giftGuaranteedPerk: node.giftGuaranteedPerk,
    catapultForward:
      node.kind === "catapult"
        ? typeof (node as { catapultForward?: number }).catapultForward === "number"
          ? Math.max(1, Math.floor((node as { catapultForward: number }).catapultForward))
          : undefined
        : undefined,
    catapultLandingOnly:
      node.kind === "catapult"
        ? (node as { catapultLandingOnly?: boolean }).catapultLandingOnly
        : undefined,
    styleHint: node.styleHint,
    fixedRoundId: resolvedRoundByNodeId[node.id],
    playlistRoundIds: resolvedPlaylistRoundIdsByNodeId[node.id],
    forceStop: node.kind === "round" || node.kind === "perk" ? node.forceStop : undefined,
    skippable: node.kind === "round" ? node.skippable : undefined,
    randomPoolId: node.randomPoolId,
    autoAdvanceAfterCompletion:
      node.kind === "round" || node.kind === "randomRound"
        ? node.autoAdvanceAfterCompletion
        : undefined,
    hiddenFromMap:
      node.kind === "round" || node.kind === "randomRound" ? node.hiddenFromMap : undefined,
    randomSelectionMode:
      node.kind === "randomRound" ? (node.selectionMode ?? "installed") : undefined,
    randomFilter: node.kind === "randomRound" ? node.filter : undefined,
  }));

  const edges: RuntimeGraphEdge[] = config.edges.map((edge) => ({
    id: edge.id,
    fromNodeId: edge.fromNodeId,
    toNodeId: edge.toNodeId,
    gateCost: edge.gateCost ?? 0,
    weight: edge.weight ?? 1,
    label: edge.label,
  }));

  const randomPools: RuntimeGraphRandomPool[] = config.randomRoundPools.map((pool) => ({
    id: pool.id,
    candidates: pool.candidates
      .map((candidate) => {
        const resolved = resolvePortableRoundRef(candidate.roundRef, installedRounds);
        if (!resolved) return null;
        return {
          roundId: resolved.id,
          weight: candidate.weight,
        };
      })
      .filter((entry): entry is { roundId: string; weight: number } => Boolean(entry)),
  }));
  randomPools.push(buildRandomInstalledRoundPool(installedRounds));

  const cumRoundIds = config.cumRoundRefs
    .map((ref) => resolvePortableRoundRef(ref, installedRounds)?.id)
    .filter((id): id is string => Boolean(id));

  const safePointIndices = board
    .map((field, index) => ({ field, index }))
    .filter(({ field }) => field.kind === "safePoint")
    .map(({ index }) => index);

  return {
    board,
    mapTextAnnotations: (config.textAnnotations ?? []).map((annotation) => ({
      id: annotation.id,
      text: annotation.text,
      styleHint: { ...annotation.styleHint },
    })),
    mapStyle: config.style ? { ...config.style } : undefined,
    runtimeGraph: buildRuntimeGraph(
      board,
      config.startNodeId,
      edges,
      randomPools,
      config.pathChoiceTimeoutMs
    ),
    dice: { min: 1, max: 6 },
    perkSelection: {
      optionsPerPick: 3,
      triggerChancePerCompletedRound: 0.35,
    },
    perkPool: {
      enabledPerkIds: getSinglePlayerPerkPool().map((p) => p.id),
      enabledAntiPerkIds: getSinglePlayerAntiPerkPool().map((p) => p.id),
    },
    probabilityScaling: {
      initialIntermediaryProbability: 0.1,
      initialAntiPerkProbability: 0.1,
      intermediaryIncreasePerRound: 0.02,
      antiPerkIncreasePerRound: 0.015,
      maxIntermediaryProbability: 1,
      maxAntiPerkProbability: 0.75,
      resetIntermediaryProbabilityAfterTrigger: false,
      resetAntiPerkProbabilityAfterTrigger: false,
    },
    singlePlayer: {
      totalIndices: Math.max(1, board.length - 1),
      safePointIndices,
      normalRoundIdsByIndex: {},
      cumRoundIds,
    },
    economy: {
      startingMoney: 120,
      moneyPerCompletedRound: 50,
      startingScore: 0,
      scorePerCompletedRound: 100,
      scorePerIntermediary: 30,
      scorePerActiveAntiPerk: 25,
      scorePerCumRoundSuccess: 420,
    },
    roundStartDelayMs: 20000,
    automations: (config.automations ?? []).map((rule) => structuredClone(rule)),
  };
}

const ENDLESS_COLUMNS = 4;
const ENDLESS_TILE_SIZE = 160;
const ENDLESS_ROW_GAP = 120;

function endlessNodePosition(
  index: number,
  totalColumns: number,
  totalRows: number
): { x: number; y: number } {
  const row = Math.floor(index / totalColumns);
  const col = row % 2 === 0 ? index % totalColumns : totalColumns - 1 - (index % totalColumns);
  return {
    x: 160 + col * ENDLESS_TILE_SIZE,
    y: 360 + (totalRows > 0 ? row : 0) * ENDLESS_ROW_GAP,
  };
}

function buildEndlessNodeBatch(
  startIndex: number,
  count: number,
  safePointEveryN: number,
  perkNodeEveryN: number,
  totalExistingNodes: number
): { nodes: BoardField[]; edges: RuntimeGraphEdge[] } {
  const nodes: BoardField[] = [];
  const edges: RuntimeGraphEdge[] = [];
  const totalGridNodes = totalExistingNodes + count;
  const totalRows = Math.ceil(totalGridNodes / ENDLESS_COLUMNS);

  for (let i = 0; i < count; i++) {
    const globalIndex = startIndex + i;
    const nodeId = `endless-${globalIndex}`;
    const gridIndex = totalExistingNodes + i;
    const pos = endlessNodePosition(gridIndex, ENDLESS_COLUMNS, totalRows);

    let kind: BoardFieldKind;
    const relativeIndex = globalIndex;

    if (relativeIndex % safePointEveryN === 0 && safePointEveryN > 0) {
      kind = "safePoint";
    } else if (relativeIndex % perkNodeEveryN === 0 && perkNodeEveryN > 0) {
      kind = "perk";
    } else {
      kind = "randomRound";
    }

    nodes.push({
      id: nodeId,
      name:
        kind === "safePoint"
          ? `Checkpoint ${globalIndex}`
          : kind === "perk"
            ? `Perk ${globalIndex}`
            : `Round ${globalIndex}`,
      kind,
      forceStop: kind === "perk",
      randomSelectionMode: kind === "randomRound" ? "installed" : undefined,
      styleHint: { x: pos.x, y: pos.y },
    });

    const prevNodeId = i === 0 ? undefined : nodes[i - 1]!.id;
    if (prevNodeId) {
      edges.push({
        id: `edge-${prevNodeId}-${nodeId}`,
        fromNodeId: prevNodeId,
        toNodeId: nodeId,
        gateCost: 0,
        weight: 1,
      });
    }
  }

  return { nodes, edges };
}

function buildEndlessConfig(
  config: EndlessBoardConfig,
  installedRounds: ReadonlyArray<InstalledRound>
): GameConfig {
  const batchSize = config.initialBatchSize;
  const safePointEveryN = config.safePointEveryN;
  const perkNodeEveryN = config.perkNodeEveryN;

  const startNode: BoardField = {
    id: "start",
    name: "Start",
    kind: "start",
    styleHint: endlessNodePosition(
      0,
      ENDLESS_COLUMNS,
      Math.ceil((batchSize + 2) / ENDLESS_COLUMNS)
    ),
  };

  const endNode: BoardField = {
    id: "end",
    name: "End",
    kind: "end",
    styleHint: endlessNodePosition(
      batchSize + 1,
      ENDLESS_COLUMNS,
      Math.ceil((batchSize + 2) / ENDLESS_COLUMNS)
    ),
  };

  const batch = buildEndlessNodeBatch(1, batchSize, safePointEveryN, perkNodeEveryN, 2);

  const firstNodeEdge: RuntimeGraphEdge = {
    id: "edge-start-endless-1",
    fromNodeId: "start",
    toNodeId: batch.nodes[0]!.id,
    gateCost: 0,
    weight: 1,
  };

  const lastNodeEdge: RuntimeGraphEdge = {
    id: `edge-${batch.nodes[batch.nodes.length - 1]!.id}-end`,
    fromNodeId: batch.nodes[batch.nodes.length - 1]!.id,
    toNodeId: "end",
    gateCost: 0,
    weight: 1,
  };

  const board = [startNode, ...batch.nodes, endNode];
  const edges = [firstNodeEdge, ...batch.edges, lastNodeEdge];

  const randomPools = [buildRandomInstalledRoundPool(installedRounds)];
  const safePointIndices = board
    .map((field, index) => ({ field, index }))
    .filter(({ field }) => field.kind === "safePoint")
    .map(({ index }) => index);

  const endlessGeneration: EndlessGenerationConfig = {
    safePointEveryN,
    perkNodeEveryN,
    initialBatchSize: batchSize,
    extendBatchSize: config.extendBatchSize,
    roundCounter: 0,
    randomFilter: config.randomFilter,
  };

  return {
    board,
    runtimeGraph: buildRuntimeGraph(board, "start", edges, randomPools, 12000),
    dice: { min: 1, max: 1 },
    perkSelection: {
      optionsPerPick: 3,
      triggerChancePerCompletedRound: 0.35,
    },
    perkPool: {
      enabledPerkIds: getSinglePlayerPerkPool()
        .map((p) => p.id)
        .filter((id) => !DICE_PERK_IDS.has(id)),
      enabledAntiPerkIds: getSinglePlayerAntiPerkPool()
        .map((p) => p.id)
        .filter((id) => !DICE_ANTIPERK_IDS.has(id)),
    },
    probabilityScaling: {
      initialIntermediaryProbability: 0.1,
      initialAntiPerkProbability: 0.1,
      intermediaryIncreasePerRound: 0.02,
      antiPerkIncreasePerRound: 0.015,
      maxIntermediaryProbability: 1,
      maxAntiPerkProbability: 0.75,
      resetIntermediaryProbabilityAfterTrigger: false,
      resetAntiPerkProbabilityAfterTrigger: false,
    },
    singlePlayer: {
      totalIndices: Math.max(1, board.length - 1),
      safePointIndices,
      normalRoundIdsByIndex: {},
      cumRoundIds: [],
    },
    economy: {
      startingMoney: 120,
      moneyPerCompletedRound: 50,
      startingScore: 0,
      scorePerCompletedRound: 100,
      scorePerIntermediary: 30,
      scorePerActiveAntiPerk: 25,
      scorePerCumRoundSuccess: 0,
    },
    roundStartDelayMs: 20000,
    disableDiceAnimation: true,
    endlessGeneration,
  };
}

export function normalizePlaylistConfig(input: unknown): PlaylistConfig {
  const parsed = ZPlaylistConfig.parse(input);
  if (parsed.playlistVersion < 1) {
    return {
      ...parsed,
      playlistVersion: CURRENT_PLAYLIST_VERSION,
    };
  }
  return parsed;
}

export function toGameConfigFromPlaylist(
  playlistConfig: PlaylistConfig,
  installedRounds: ReadonlyArray<InstalledRound>,
  randomValue: () => number = Math.random
): GameConfig {
  const boardConfig = playlistConfig.boardConfig;
  const config =
    boardConfig.mode === "linear"
      ? buildLinearConfig(boardConfig, installedRounds, randomValue)
      : boardConfig.mode === "graph"
        ? buildGraphConfig(boardConfig, installedRounds)
        : buildEndlessConfig(boardConfig, installedRounds);

  return {
    ...config,
    roundStartDelayMs: playlistConfig.roundStartDelayMs,
    disableDiceAnimation: playlistConfig.disableDiceAnimation,
    dice: playlistConfig.dice,
    perkSelection: playlistConfig.perkSelection,
    perkPool: playlistConfig.perkPool,
    probabilityScaling: playlistConfig.probabilityScaling,
    economy: playlistConfig.economy,
    automations:
      boardConfig.mode === "graph"
        ? (boardConfig.automations ?? []).map((rule) => structuredClone(rule))
        : [],
    playlistMusic:
      playlistConfig.music && playlistConfig.music.tracks.length > 0
        ? {
            tracks: playlistConfig.music.tracks.map((track) => ({
              ...track,
            })),
            loop: playlistConfig.music.loop,
          }
        : undefined,
  };
}

export function createDefaultPlaylistConfig<T extends PlaylistResolutionRoundLike>(
  installedRounds: ReadonlyArray<T>
): PlaylistConfig {
  const normalRoundOrder = installedRounds
    .filter((round) => (round.type ?? "Normal") === "Normal")
    .map(toPortableRoundRef);

  const cumRoundRefs = installedRounds
    .filter((round) => round.type === "Cum")
    .map(toPortableRoundRef);

  return {
    playlistVersion: CURRENT_PLAYLIST_VERSION,
    boardConfig: {
      mode: "linear",
      totalIndices: 100,
      safePointIndices: [25, 50, 75],
      safePointRestMsByIndex: {},
      normalRoundRefsByIndex: {},
      normalRoundOrder,
      cumRoundRefs,
    },
    roundStartDelayMs: 20000,
    disableDiceAnimation: false,
    perkSelection: {
      optionsPerPick: 3,
      triggerChancePerCompletedRound: 0.35,
    },
    perkPool: {
      enabledPerkIds: getSinglePlayerPerkPool().map((p) => p.id),
      enabledAntiPerkIds: getSinglePlayerAntiPerkPool().map((p) => p.id),
    },
    probabilityScaling: {
      initialIntermediaryProbability: 0.1,
      initialAntiPerkProbability: 0.1,
      intermediaryIncreasePerRound: 0.02,
      antiPerkIncreasePerRound: 0.015,
      maxIntermediaryProbability: 1,
      maxAntiPerkProbability: 0.75,
      resetIntermediaryProbabilityAfterTrigger: false,
      resetAntiPerkProbabilityAfterTrigger: false,
    },
    economy: {
      startingMoney: 120,
      moneyPerCompletedRound: 50,
      startingScore: 0,
      scorePerCompletedRound: 100,
      scorePerIntermediary: 30,
      scorePerActiveAntiPerk: 25,
      scorePerCumRoundSuccess: 420,
    },
    dice: {
      min: 1,
      max: 6,
    },
    saveMode: "checkpoint",
  };
}

export function createDefaultEndlessPlaylistConfig(): PlaylistConfig {
  return {
    playlistVersion: CURRENT_PLAYLIST_VERSION,
    boardConfig: {
      mode: "endless",
      safePointEveryN: 25,
      perkNodeEveryN: 5,
      initialBatchSize: 50,
      extendBatchSize: 25,
    },
    roundStartDelayMs: 20000,
    disableDiceAnimation: true,
    perkSelection: {
      optionsPerPick: 3,
      triggerChancePerCompletedRound: 0.35,
    },
    perkPool: {
      enabledPerkIds: getSinglePlayerPerkPool()
        .map((p) => p.id)
        .filter((id) => !DICE_PERK_IDS.has(id)),
      enabledAntiPerkIds: getSinglePlayerAntiPerkPool()
        .map((p) => p.id)
        .filter((id) => !DICE_ANTIPERK_IDS.has(id)),
    },
    probabilityScaling: {
      initialIntermediaryProbability: 0.1,
      initialAntiPerkProbability: 0.1,
      intermediaryIncreasePerRound: 0.02,
      antiPerkIncreasePerRound: 0.015,
      maxIntermediaryProbability: 1,
      maxAntiPerkProbability: 0.75,
      resetIntermediaryProbabilityAfterTrigger: false,
      resetAntiPerkProbabilityAfterTrigger: false,
    },
    economy: {
      startingMoney: 120,
      moneyPerCompletedRound: 50,
      startingScore: 0,
      scorePerCompletedRound: 100,
      scorePerIntermediary: 30,
      scorePerActiveAntiPerk: 25,
      scorePerCumRoundSuccess: 0,
    },
    dice: {
      min: 1,
      max: 1,
    },
    saveMode: "checkpoint",
  };
}
