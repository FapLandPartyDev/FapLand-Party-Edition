import type { InstalledRound } from "../services/db";
import { getPerkById, getSinglePlayerAntiPerkPool, getSinglePlayerPerkPool } from "./data/perks";
import { resolvePerkRarity } from "./data/perkRarity";
import type {
  ActivePerkEffect,
  CompletedRoundSummary,
  CumRoundOutcome,
  GameConfig,
  GameEffect,
  GameState,
  InventoryItem,
  NumericDeltaEffect,
  PendingPathChoice,
  PendingPerkSelection,
  PerkDefinition,
  PerkKind,
  PlayerState,
  PlayerStats,
  RuntimeGraphEdge,
} from "./types";

function clamp(value: number, min?: number, max?: number): number {
  let result = value;
  if (typeof min === "number") result = Math.max(min, result);
  if (typeof max === "number") result = Math.min(max, result);
  return result;
}

function coerceFiniteNumber(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback;
}

function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function pickWeightedRoundId(
  entries: Array<{ roundId: string; weight: number }>,
  roll?: number
): string | null {
  if (entries.length === 0) return null;
  const totalWeight = entries.reduce((acc, entry) => acc + Math.max(0.000001, entry.weight), 0);
  const targetRoll = roll ?? Math.random();
  let target = targetRoll * totalWeight;
  for (const entry of entries) {
    target -= Math.max(0.000001, entry.weight);
    if (target <= 0) return entry.roundId;
  }
  return entries[entries.length - 1]?.roundId ?? null;
}

function pickUniqueWeighted<T>(
  items: T[],
  count: number,
  getWeight: (item: T) => number,
  rolls?: number[]
): T[] {
  const pool = [...items];
  const picked: T[] = [];

  while (pool.length > 0 && picked.length < count) {
    const weights = pool.map((item) => Math.max(0.000001, getWeight(item)));
    const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
    const targetRoll = rolls?.[picked.length] ?? Math.random();
    let target = targetRoll * totalWeight;
    let selectedIndex = 0;

    for (let index = 0; index < pool.length; index += 1) {
      target -= weights[index] ?? 0;
      if (target <= 0) {
        selectedIndex = index;
        break;
      }
    }

    const [next] = pool.splice(selectedIndex, 1);
    if (next) picked.push(next);
  }

  return picked;
}

function normalizeDice(stats: PlayerStats): PlayerStats {
  const diceMax = clamp(stats.diceMax, 1, 20);
  const diceMin = clamp(stats.diceMin, 1, diceMax);
  const roundPauseMs = coerceFiniteNumber(stats.roundPauseMs, 20_000);
  return {
    ...stats,
    diceMin,
    diceMax,
    roundPauseMs: clamp(roundPauseMs, 250, 30000),
    perkFrequency: clamp(stats.perkFrequency, -0.5, 0.5),
    perkLuck: clamp(stats.perkLuck, -1, 1),
  };
}

function updatePlayer(
  players: PlayerState[],
  playerId: string,
  updater: (player: PlayerState) => PlayerState
): PlayerState[] {
  return players.map((player) => (player.id === playerId ? updater(player) : player));
}

function applyNumericDelta(
  stats: PlayerStats,
  effect: NumericDeltaEffect,
  reverse = false
): PlayerStats {
  const direction = reverse ? -1 : 1;
  const nextStats: PlayerStats = { ...stats };
  nextStats[effect.stat] = clamp(
    nextStats[effect.stat] + effect.amount * direction,
    effect.min,
    effect.max
  );
  return normalizeDice(nextStats);
}

function getRoundControl(player: PlayerState): { pauseCharges: number; skipCharges: number } {
  return {
    pauseCharges: Math.max(0, player.roundControl?.pauseCharges ?? 0),
    skipCharges: Math.max(0, player.roundControl?.skipCharges ?? 0),
  };
}

function getShieldRounds(player: PlayerState): number {
  return Math.max(0, player.shieldRoundsRemaining ?? 0);
}

function stripPerkIdOnce(values: string[], id: string): string[] {
  const index = values.indexOf(id);
  if (index < 0) return values;
  return [...values.slice(0, index), ...values.slice(index + 1)];
}

function createInventoryItem(
  state: GameState,
  perk: PerkDefinition,
  playerId: string
): InventoryItem {
  return {
    itemId: `inv-${playerId}-${state.turn}-${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`,
    perkId: perk.id,
    kind: perk.kind,
    name: perk.name,
    cost: perk.cost,
    acquiredTurn: state.turn,
  };
}

function getRoundById(
  installedRounds: InstalledRound[],
  roundId: string
): InstalledRound | undefined {
  return installedRounds.find((round) => round.id === roundId);
}

function getInstalledCumRounds(installedRounds: InstalledRound[]): InstalledRound[] {
  return installedRounds.filter((round) => (round.type ?? "Normal") === "Cum");
}

function pickRandomEntry<T>(entries: T[]): T | null {
  if (entries.length === 0) return null;
  return entries[randomInt(0, entries.length - 1)] ?? null;
}

function resolveRoundDifficulty(round: InstalledRound): number {
  if (typeof round.difficulty === "number" && Number.isFinite(round.difficulty)) {
    return round.difficulty;
  }
  return 0;
}

function resolveRoundBpm(round: InstalledRound): number {
  if (typeof round.bpm === "number" && Number.isFinite(round.bpm)) {
    return round.bpm;
  }
  return 0;
}

function pickSuccubusRoundId(installedRounds: InstalledRound[]): string | null {
  const normals = installedRounds.filter((round) => (round.type ?? "Normal") === "Normal");
  if (normals.length === 0) return null;

  const highDifficulty = normals.filter((round) => resolveRoundDifficulty(round) >= 4);
  const source =
    highDifficulty.length > 0
      ? highDifficulty
      : [...normals]
        .sort((a, b) => {
          const diff = resolveRoundDifficulty(b) - resolveRoundDifficulty(a);
          if (diff !== 0) return diff;
          return resolveRoundBpm(b) - resolveRoundBpm(a);
        })
        .slice(0, Math.max(1, Math.ceil(normals.length * 0.25)));

  if (source.length === 0) return null;
  return source[randomInt(0, source.length - 1)]?.id ?? null;
}

function getEnabledPerkPool(config: GameConfig): PerkDefinition[] {
  const selected = new Set(config.perkPool.enabledPerkIds);
  return getSinglePlayerPerkPool().filter((perk) => selected.has(perk.id));
}

function getEnabledAntiPerkPool(config: GameConfig): PerkDefinition[] {
  const selected = new Set(config.perkPool.enabledAntiPerkIds);
  return getSinglePlayerAntiPerkPool().filter((perk) => selected.has(perk.id));
}

function getPerkChoicePool(config: GameConfig): PerkDefinition[] {
  const perks = getEnabledPerkPool(config);
  if (!config.perkSelection.includeAntiPerksInChoices) return perks;
  return [...perks, ...getEnabledAntiPerkPool(config)];
}

function getEffectivePerkTriggerChance(state: GameState, player: PlayerState): number {
  return clamp(
    state.config.perkSelection.triggerChancePerCompletedRound + player.stats.perkFrequency,
    0,
    1
  );
}

function getPerkRarityWeight(perk: PerkDefinition, player: PlayerState): number {
  const rarityBiasByTier = {
    common: -1.5,
    rare: -0.5,
    epic: 0.5,
    legendary: 1.5,
  } as const;
  const rarity = resolvePerkRarity(perk);
  const bias = rarityBiasByTier[rarity];
  return Math.exp(player.stats.perkLuck * bias);
}

function tickPerkDurations(state: GameState): GameState {
  const expiredLogs: string[] = [];
  let didChange = false;

  const nextPlayers = state.players.map((player) => {
    const currentShieldRounds = getShieldRounds(player);
    const decrementedShieldRounds = currentShieldRounds > 0 ? currentShieldRounds - 1 : 0;
    if (player.activePerkEffects.length === 0 && decrementedShieldRounds === currentShieldRounds)
      return player;

    let nextStats = { ...player.stats };
    let nextPerks = [...player.perks];
    let nextAntiPerks = [...player.antiPerks];
    const nextActivePerkEffects: ActivePerkEffect[] = [];

    for (const active of player.activePerkEffects) {
      if (active.remainingRounds === null) {
        nextActivePerkEffects.push(active);
        continue;
      }

      if (active.appliedTurn === state.turn && active.appliedAfterRoll) {
        nextActivePerkEffects.push(active);
        continue;
      }

      const remainingRounds = active.remainingRounds - 1;
      if (remainingRounds > 0) {
        didChange = true;
        nextActivePerkEffects.push({ ...active, remainingRounds });
        continue;
      }

      for (const effect of active.effects) {
        if (effect.kind === "numericDelta") {
          nextStats = applyNumericDelta(nextStats, effect, true);
        }
      }

      didChange = true;
      if (active.kind === "perk") nextPerks = stripPerkIdOnce(nextPerks, active.id);
      if (active.kind === "antiPerk") nextAntiPerks = stripPerkIdOnce(nextAntiPerks, active.id);
      expiredLogs.push(`${active.name ?? active.id} expired.`);
    }

    if (decrementedShieldRounds !== currentShieldRounds) didChange = true;

    return {
      ...player,
      stats: normalizeDice(nextStats),
      perks: nextPerks,
      antiPerks: nextAntiPerks,
      activePerkEffects: nextActivePerkEffects,
      shieldRoundsRemaining: decrementedShieldRounds,
      inventory: [...player.inventory],
    };
  });

  if (!didChange && expiredLogs.length === 0) return state;
  return {
    ...state,
    players: nextPlayers,
    log: expiredLogs.length > 0 ? [...expiredLogs, ...state.log].slice(0, 40) : state.log,
  };
}

function applyEffect(state: GameState, effect: GameEffect, sourcePlayerId: string): GameState {
  if (effect.kind === "numericDelta") {
    const target = effect.target ?? "self";
    const targetIds =
      target === "self"
        ? [sourcePlayerId]
        : target === "all"
          ? state.players.map((player) => player.id)
          : state.players
            .filter((player) => player.id !== sourcePlayerId)
            .map((player) => player.id);

    if (targetIds.length === 0) return state;

    const nextPlayers = state.players.map((player) => {
      if (!targetIds.includes(player.id)) return player;

      const nextStats: PlayerStats = { ...player.stats };
      nextStats[effect.stat] = clamp(
        nextStats[effect.stat] + effect.amount,
        effect.min,
        effect.max
      );

      return {
        ...player,
        stats: normalizeDice(nextStats),
      };
    });

    return { ...state, players: nextPlayers };
  }

  if (effect.kind === "probabilityDelta") {
    if (effect.singlePlayerOnly && state.players.length > 1) return state;
    if (effect.stat === "intermediaryProbability") {
      const fallbackMax = state.config.probabilityScaling.maxIntermediaryProbability;
      return {
        ...state,
        intermediaryProbability: clamp(
          state.intermediaryProbability + effect.amount,
          effect.min ?? 0,
          effect.max ?? fallbackMax
        ),
      };
    }
    const fallbackMax = state.config.probabilityScaling.maxAntiPerkProbability;
    return {
      ...state,
      antiPerkProbability: clamp(
        state.antiPerkProbability + effect.amount,
        effect.min ?? 0,
        effect.max ?? fallbackMax
      ),
    };
  }

  if (effect.kind === "scoreDelta") {
    const target = effect.target ?? "self";
    const targetIds =
      target === "self"
        ? [sourcePlayerId]
        : target === "all"
          ? state.players.map((player) => player.id)
          : state.players
            .filter((player) => player.id !== sourcePlayerId)
            .map((player) => player.id);

    if (targetIds.length === 0) return state;

    return {
      ...state,
      players: state.players.map((player) => {
        if (!targetIds.includes(player.id)) return player;
        return {
          ...player,
          score: clamp(player.score + effect.amount, effect.min ?? 0, effect.max),
        };
      }),
    };
  }

  if (effect.kind === "grantRoundControl") {
    return {
      ...state,
      players: updatePlayer(state.players, sourcePlayerId, (player) => {
        const controls = getRoundControl(player);
        return {
          ...player,
          roundControl:
            effect.control === "pause"
              ? {
                ...controls,
                pauseCharges: controls.pauseCharges + Math.max(0, Math.floor(effect.amount)),
              }
              : {
                ...controls,
                skipCharges: controls.skipCharges + Math.max(0, Math.floor(effect.amount)),
              },
        };
      }),
    };
  }

  if (effect.kind === "roundControlDelta") {
    return {
      ...state,
      players: updatePlayer(state.players, sourcePlayerId, (player) => {
        const controls = getRoundControl(player);
        const delta = Math.max(0, Math.floor(Math.abs(effect.amount)));
        return {
          ...player,
          roundControl:
            effect.control === "pause"
              ? { ...controls, pauseCharges: Math.max(0, controls.pauseCharges - delta) }
              : { ...controls, skipCharges: Math.max(0, controls.skipCharges - delta) },
        };
      }),
    };
  }

  if (effect.kind === "setShieldRounds") {
    const rounds = Math.max(0, Math.floor(effect.rounds));
    if (rounds <= 0) return state;
    return {
      ...state,
      players: updatePlayer(state.players, sourcePlayerId, (player) => ({
        ...player,
        shieldRoundsRemaining: Math.max(getShieldRounds(player), rounds),
      })),
    };
  }

  if (effect.kind === "cleanseAntiPerks") {
    return {
      ...state,
      queuedRoundAudioEffect: null,
      activeRoundAudioEffect: null,
      players: updatePlayer(state.players, sourcePlayerId, (player) => {
        if (
          player.antiPerks.length === 0 &&
          player.activePerkEffects.every((active) => active.kind !== "antiPerk")
        ) {
          return player;
        }

        let nextStats = { ...player.stats };
        const keepEffects: ActivePerkEffect[] = [];
        for (const active of player.activePerkEffects) {
          if (active.kind !== "antiPerk") {
            keepEffects.push(active);
            continue;
          }
          for (const effect of active.effects) {
            if (effect.kind === "numericDelta") {
              nextStats = applyNumericDelta(nextStats, effect, true);
            }
          }
        }

        return {
          ...player,
          stats: normalizeDice(nextStats),
          antiPerks: [],
          activePerkEffects: keepEffects,
        };
      }),
    };
  }

  if (effect.kind === "setPendingRollMultiplier") {
    const multiplier = Math.max(1, effect.multiplier);
    return {
      ...state,
      players: updatePlayer(state.players, sourcePlayerId, (player) => ({
        ...player,
        pendingRollMultiplier: multiplier,
      })),
    };
  }

  if (effect.kind === "setPendingRollCeiling") {
    const ceiling = clamp(Math.floor(effect.ceiling), 1, 12);
    return {
      ...state,
      players: updatePlayer(state.players, sourcePlayerId, (player) => ({
        ...player,
        pendingRollCeiling: ceiling,
      })),
    };
  }

  if (effect.kind === "setPendingIntensityCap") {
    const cap = clamp(effect.cap, 0.1, 1);
    return {
      ...state,
      players: updatePlayer(state.players, sourcePlayerId, (player) => ({
        ...player,
        pendingIntensityCap: cap,
      })),
    };
  }

  return state;
}

function applyPerkToPlayer(
  state: GameState,
  sourcePlayerId: string,
  perk: PerkDefinition
): GameState {
  if (perk.kind === "antiPerk") {
    const target = state.players.find((player) => player.id === sourcePlayerId);
    if (target && getShieldRounds(target) > 0) {
      return {
        ...state,
        log: [`${target.name} blocked ${perk.name} with Shield.`, ...state.log].slice(0, 40),
      };
    }
  }

  let nextState = state;
  if (["milker", "jackhammer", "succubus"].includes(perk.id)) {
    nextState = consumeAntiPerkById(state, {
      playerId: sourcePlayerId,
      perkId: "no-rest",
      reason: `${perk.name} replaced No Rest.`,
    });
  }

  for (const effect of perk.effects) {
    nextState = applyEffect(nextState, effect, sourcePlayerId);
  }

  const persistentEffects = perk.effects.filter(
    (effect): effect is NumericDeltaEffect => effect.kind === "numericDelta"
  );
  const isImmediate = perk.application === "immediate";

  const remainingRounds = isImmediate ? 0 : (perk.durationRounds ?? null);
  const kind: PerkKind = perk.kind;
  const effectsToStore = isImmediate ? perk.effects : persistentEffects;
  const finalState: GameState = {
    ...nextState,
    queuedRoundAudioEffect:
      kind === "antiPerk" && perk.id === "moaning-loop"
        ? { kind: "continuousMoaning", sourcePerkId: perk.id }
        : nextState.queuedRoundAudioEffect,
    players: updatePlayer(nextState.players, sourcePlayerId, (player) => ({
      ...player,
      perks: kind === "perk" ? [perk.id, ...player.perks] : player.perks,
      antiPerks: kind === "antiPerk" ? [perk.id, ...player.antiPerks] : player.antiPerks,
      activePerkEffects: [
        ...player.activePerkEffects,
        {
          id: perk.id,
          name: perk.name,
          kind,
          remainingRounds,
          effects: effectsToStore,
          appliedTurn: state.turn,
          appliedAfterRoll: state.lastRoll !== null,
        },
      ],
    })),
  };

  return finalState;
}

function queueCumRound(state: GameState, installedRounds: InstalledRound[]): GameState {
  const selectedCumRounds = state.config.singlePlayer.cumRoundIds
    .map((roundId) => getRoundById(installedRounds, roundId))
    .filter((round): round is InstalledRound => Boolean(round));
  const fallbackCumRounds = getInstalledCumRounds(installedRounds);
  const selectedRound = pickRandomEntry(selectedCumRounds) ?? pickRandomEntry(fallbackCumRounds);
  if (!selectedRound) {
    return {
      ...state,
      sessionPhase: "completed",
      completionReason: "finished",
      log: ["Session completed.", ...state.log].slice(0, 40),
    };
  }

  return {
    ...state,
    sessionPhase: "cum",
    queuedRound: {
      fieldId: "cum-final",
      nodeId: "cum-final",
      roundId: selectedRound.id,
      roundName: selectedRound.name,
      selectionKind: "cum",
      poolId: null,
      phaseKind: "cum",
      campaignIndex: null,
    },
    nextCumRoundIndex: state.config.singlePlayer.cumRoundIds.length,
    log: [`Cum phase: ${selectedRound.name} queued.`, ...state.log].slice(0, 40),
  };
}

function startCumPhase(state: GameState, installedRounds: InstalledRound[]): GameState {
  if (state.sessionPhase !== "normal") return state;
  if (
    state.config.singlePlayer.cumRoundIds.length === 0 &&
    getInstalledCumRounds(installedRounds).length === 0
  ) {
    return {
      ...state,
      sessionPhase: "completed",
      completionReason: "finished",
      log: ["Final normal round reached. Session completed.", ...state.log].slice(0, 40),
    };
  }
  return queueCumRound(
    {
      ...state,
      sessionPhase: "cum",
      nextCumRoundIndex: 0,
    },
    installedRounds
  );
}

export function triggerPerkSelection(
  state: GameState,
  playerId: string,
  sourceFieldId: string,
  randoms?: {
    antiPerkTriggerRoll?: number;
    antiPerkIndex?: number;
    perkChoicesRolls?: number[];
  }
): GameState {
  if (
    state.pendingPerkSelection ||
    state.pendingPathChoice ||
    state.queuedRound ||
    state.activeRound
  )
    return state;
  const player = state.players.find((entry) => entry.id === playerId);
  if (!player) return state;

  const antiPerkTriggerRoll = randoms?.antiPerkTriggerRoll ?? Math.random();
  if (antiPerkTriggerRoll < state.antiPerkProbability) {
    const antiPool = getEnabledAntiPerkPool(state.config);
    const antiPerkIndex =
      randoms?.antiPerkIndex ?? (antiPool.length > 0 ? randomInt(0, antiPool.length - 1) : -1);
    const selectedAntiPerk = antiPool[antiPerkIndex];

    if (selectedAntiPerk) {
      const target = state.players.find((player) => player.id === playerId);
      if (target && getShieldRounds(target) > 0) {
        return {
          ...state,
          log: [`${target.name} blocked ${selectedAntiPerk.name} with Shield.`, ...state.log].slice(
            0,
            40
          ),
        };
      }
      const next = applyPerkToPlayer(state, playerId, selectedAntiPerk);
      const antiPerkDescription = selectedAntiPerk.description.trim();
      return {
        ...next,
        log: [
          antiPerkDescription.length > 0
            ? `Computer applied anti-perk: ${selectedAntiPerk.name} - ${antiPerkDescription}`
            : `Computer applied anti-perk: ${selectedAntiPerk.name}.`,
          ...next.log,
        ].slice(0, 40),
      };
    }
  }

  const perkChoicePool = getPerkChoicePool(state.config);
  const options = pickUniqueWeighted(
    perkChoicePool,
    state.config.perkSelection.optionsPerPick,
    (perk) => getPerkRarityWeight(perk, player),
    randoms?.perkChoicesRolls
  );
  if (options.length === 0) {
    return {
      ...state,
      log: ["Perk selection skipped: no perks enabled.", ...state.log].slice(0, 40),
    };
  }

  const pendingPerkSelection: PendingPerkSelection = {
    playerId,
    fromFieldId: sourceFieldId,
    options,
  };

  return {
    ...state,
    pendingPerkSelection,
    log: [`Perk selection triggered at ${sourceFieldId}.`, ...state.log].slice(0, 40),
  };
}

function advanceTurn(state: GameState): GameState {
  const withTickedPerks = tickPerkDurations(state);
  const nextPlayerIndex = (withTickedPerks.currentPlayerIndex + 1) % withTickedPerks.players.length;
  return {
    ...withTickedPerks,
    currentPlayerIndex: nextPlayerIndex,
    turn: withTickedPerks.turn + 1,
  };
}

function getValidOutgoingEdges(
  state: GameState,
  nodeId: string,
  playerMoney: number
): RuntimeGraphEdge[] {
  const edgeIds = state.config.runtimeGraph.outgoingEdgeIdsByNodeId[nodeId] ?? [];
  return edgeIds
    .map((edgeId) => state.config.runtimeGraph.edgesById[edgeId])
    .filter((edge): edge is RuntimeGraphEdge => Boolean(edge))
    .filter((edge) => playerMoney >= edge.gateCost);
}

function getRandomRoundHistoryKey(nodeId: string): string {
  return `__random-node__:${nodeId}`;
}

function resolveRandomInstalledRound(
  state: GameState,
  installedRounds: ReadonlyArray<InstalledRound>,
  nodeId: string
): { roundId: string | null; nextState: GameState; historyKey: string } {
  const historyKey = getRandomRoundHistoryKey(nodeId);
  const pool = state.config.runtimeGraph.randomRoundPoolsById["__installed-rounds__"];
  const candidates = pool?.candidates ?? installedRounds.map((round) => ({
    roundId: round.id,
    weight: 1,
  }));

  if (candidates.length === 0) {
    return { roundId: null, nextState: state, historyKey };
  }

  const playedSet = new Set(state.playedRoundIdsByPool[historyKey] ?? []);
  const unplayed = candidates.filter((candidate) => !playedSet.has(candidate.roundId));
  const source = unplayed.length > 0 ? unplayed : candidates;
  const pickedRoundId = pickWeightedRoundId(source);

  if (!pickedRoundId) {
    return { roundId: null, nextState: state, historyKey };
  }

  const knownPlayed = state.playedRoundIdsByPool[historyKey] ?? [];
  return {
    roundId: pickedRoundId,
    historyKey,
    nextState: {
      ...state,
      playedRoundIdsByPool: {
        ...state.playedRoundIdsByPool,
        [historyKey]: knownPlayed.includes(pickedRoundId) ? knownPlayed : [...knownPlayed, pickedRoundId],
      },
    },
  };
}

function queueRoundFromNode(
  state: GameState,
  installedRounds: InstalledRound[],
  nodeId: string,
  roundId: string,
  selectionKind: "fixed" | "random",
  poolId: string | null
): GameState {
  const round = getRoundById(installedRounds, roundId);
  const nodeIndex = state.config.runtimeGraph.nodeIndexById[nodeId];
  const field = typeof nodeIndex === "number" ? state.config.board[nodeIndex] : undefined;

  return {
    ...state,
    queuedRound: {
      fieldId: field?.id ?? nodeId,
      nodeId,
      roundId,
      roundName: round?.name ?? field?.name ?? roundId,
      skippable: field?.skippable,
      selectionKind,
      poolId,
      phaseKind: "normal",
      campaignIndex: typeof nodeIndex === "number" ? nodeIndex : null,
    },
    log: [
      `${state.players[state.currentPlayerIndex]?.name ?? "Player"} landed on ${field?.name ?? nodeId}. ${round?.name ?? field?.name ?? roundId} starts after countdown.`,
      ...state.log,
    ].slice(0, 40),
  };
}

function canSkipQueuedRound(state: GameState): boolean {
  return Boolean(state.queuedRound?.skippable && state.queuedRound?.phaseKind === "normal");
}

function movePlayerToNode(state: GameState, playerId: string, nodeId: string): GameState {
  const nodeIndex = state.config.runtimeGraph.nodeIndexById[nodeId] ?? 0;
  return {
    ...state,
    players: updatePlayer(state.players, playerId, (player) => ({
      ...player,
      currentNodeId: nodeId,
      position: nodeIndex,
    })),
  };
}

function resolveSafePointLanding(
  state: GameState,
  nodeId: string
): { state: GameState; stopMovement: boolean; stoppedAtSafePoint: boolean } {
  const nodeIndex = state.config.runtimeGraph.nodeIndexById[nodeId] ?? 0;
  const field = state.config.board[nodeIndex];

  if (!field) {
    return { state, stopMovement: false, stoppedAtSafePoint: false };
  }

  if (field.kind === "safePoint") {
    return {
      state: {
        ...state,
        bonusRolls: state.bonusRolls + 1,
        log: [
          `${state.players[state.currentPlayerIndex]?.name ?? "Player"} reached safe point ${field.name}. Movement stops and reroll is granted.`,
          ...state.log,
        ].slice(0, 40),
      },
      stopMovement: true,
      stoppedAtSafePoint: true,
    };
  }

  return { state, stopMovement: false, stoppedAtSafePoint: false };
}

function resolveForcedRoundLanding(
  state: GameState,
  installedRounds: InstalledRound[],
  nodeId: string
): { state: GameState; stopMovement: boolean; stoppedAtForcedRound: boolean } {
  const nodeIndex = state.config.runtimeGraph.nodeIndexById[nodeId] ?? 0;
  const field = state.config.board[nodeIndex];

  if (!field || !field.forceStop) {
    return { state, stopMovement: false, stoppedAtForcedRound: false };
  }

  if (field.kind === "round" && field.fixedRoundId) {
    return {
      state: queueRoundFromNode(state, installedRounds, nodeId, field.fixedRoundId, "fixed", null),
      stopMovement: true,
      stoppedAtForcedRound: true,
    };
  }

  if (field.kind === "perk") {
    return {
      state: resolveFinalNodeLanding(state, installedRounds),
      stopMovement: true,
      stoppedAtForcedRound: true,
    };
  }

  return { state, stopMovement: false, stoppedAtForcedRound: false };
}

function grantPerkToInventory(state: GameState, playerId: string, perk: PerkDefinition): GameState {
  const inventoryItem = createInventoryItem(state, perk, playerId);
  return {
    ...state,
    players: updatePlayer(state.players, playerId, (player) => ({
      ...player,
      inventory: [inventoryItem, ...player.inventory],
    })),
  };
}

function resolveTerminalLanding(
  state: GameState,
  installedRounds: InstalledRound[],
  nodeId: string
): { state: GameState; stopMovement: boolean; stoppedAtEnd: boolean } {
  const nodeIndex = state.config.runtimeGraph.nodeIndexById[nodeId] ?? 0;
  const field = state.config.board[nodeIndex];

  if (!field || field.kind !== "end") {
    return { state, stopMovement: false, stoppedAtEnd: false };
  }

  return {
    state: startCumPhase(state, installedRounds),
    stopMovement: true,
    stoppedAtEnd: true,
  };
}

function resolveFinalNodeLanding(
  state: GameState,
  installedRounds: InstalledRound[],
  randoms?: {
    antiPerkTriggerRoll?: number;
    antiPerkIndex?: number;
    perkChoicesRolls?: number[];
  }
): GameState {
  const player = state.players[state.currentPlayerIndex];
  if (!player) return state;

  const nodeId = player.currentNodeId;
  const nodeIndex = state.config.runtimeGraph.nodeIndexById[nodeId] ?? 0;
  const field = state.config.board[nodeIndex];
  if (!field) return state;

  if (player.antiPerks.includes("succubus")) {
    const forcedRoundId = pickSuccubusRoundId(installedRounds);
    if (forcedRoundId) {
      const queued = queueRoundFromNode(
        state,
        installedRounds,
        nodeId,
        forcedRoundId,
        "random",
        "succubus"
      );
      return consumeAntiPerkById(queued, {
        playerId: player.id,
        perkId: "succubus",
        reason: "Succubus forced a high-difficulty round.",
      });
    }
  }

  if (field.kind === "round" && field.fixedRoundId) {
    return queueRoundFromNode(state, installedRounds, nodeId, field.fixedRoundId, "fixed", null);
  }

  if (field.kind === "randomRound") {
    const resolved = resolveRandomInstalledRound(state, installedRounds, nodeId);
    if (!resolved.roundId) {
      return {
        ...resolved.nextState,
        log: [
          `Random round node ${field.name} has no installed rounds to play.`,
          ...resolved.nextState.log,
        ].slice(0, 40),
      };
    }

    return queueRoundFromNode(
      resolved.nextState,
      installedRounds,
      nodeId,
      resolved.roundId,
      "random",
      resolved.historyKey
    );
  }

  if (field.kind === "perk") {
    const configuredPerkId = typeof field.visualId === "string" ? field.visualId.trim() : "";
    if (configuredPerkId.length > 0) {
      const configuredPerk = getPerkById(configuredPerkId);
      if (!configuredPerk || configuredPerk.kind !== "perk") {
        return {
          ...state,
          log: [
            `Perk node ${field.name} references unknown perk ${configuredPerkId}.`,
            ...state.log,
          ].slice(0, 40),
        };
      }

      const applied = field.giftGuaranteedPerk
        ? grantPerkToInventory(state, player.id, configuredPerk)
        : applyPerkToPlayer(state, player.id, configuredPerk);
      return {
        ...applied,
        log: [
          field.giftGuaranteedPerk
            ? `Guaranteed perk gifted: ${configuredPerk.name}.`
            : `Guaranteed perk: ${configuredPerk.name}.`,
          ...applied.log,
        ].slice(0, 40),
      };
    }

    return triggerPerkSelection(state, player.id, field.id, randoms);
  }

  return state;
}

function continueTraversalWithEdge(
  state: GameState,
  installedRounds: InstalledRound[],
  edge: RuntimeGraphEdge,
  remainingSteps: number,
  traversedNodeIds: string[]
): {
  state: GameState;
  stoppedAtSafePoint: boolean;
  stoppedAtForcedRound: boolean;
  stoppedAtEnd: boolean;
  remainingSteps: number;
  traversedNodeIds: string[];
} {
  const currentPlayer = state.players[state.currentPlayerIndex];
  if (!currentPlayer) {
    return {
      state,
      stoppedAtSafePoint: false,
      stoppedAtForcedRound: false,
      stoppedAtEnd: false,
      remainingSteps,
      traversedNodeIds,
    };
  }

  const afterPayment = {
    ...state,
    players: updatePlayer(state.players, currentPlayer.id, (player) => ({
      ...player,
      money: Math.max(0, player.money - edge.gateCost),
    })),
  };
  const moved = movePlayerToNode(afterPayment, currentPlayer.id, edge.toNodeId);
  const nextTraversed = [...traversedNodeIds, edge.toNodeId];
  const afterLanding = resolveSafePointLanding(moved, edge.toNodeId);
  const afterForcedRound = resolveForcedRoundLanding(
    afterLanding.state,
    installedRounds,
    edge.toNodeId
  );
  const afterTerminal = resolveTerminalLanding(
    afterForcedRound.state,
    installedRounds,
    edge.toNodeId
  );

  return {
    state: afterTerminal.state,
    stoppedAtSafePoint: afterLanding.stoppedAtSafePoint,
    stoppedAtForcedRound: afterForcedRound.stoppedAtForcedRound,
    stoppedAtEnd: afterTerminal.stoppedAtEnd,
    remainingSteps: remainingSteps - 1,
    traversedNodeIds: nextTraversed,
  };
}

function traverseMovement(
  state: GameState,
  installedRounds: InstalledRound[],
  remainingSteps: number,
  traversedNodeIds: string[],
  randoms?: {
    antiPerkTriggerRoll?: number;
    antiPerkIndex?: number;
    perkChoicesRolls?: number[];
  }
): { state: GameState; stoppedAtSafePoint: boolean } {
  let nextState = state;
  let steps = remainingSteps;
  let path = traversedNodeIds;
  let stoppedAtSafePoint = false;
  let stoppedAtForcedRound = false;
  let stoppedAtEnd = false;

  while (steps > 0) {
    const currentPlayer = nextState.players[nextState.currentPlayerIndex];
    if (!currentPlayer) break;

    const outgoing = getValidOutgoingEdges(
      nextState,
      currentPlayer.currentNodeId,
      currentPlayer.money
    );
    if (outgoing.length === 0) {
      break;
    }

    if (outgoing.length > 1) {
      const pendingPathChoice: PendingPathChoice = {
        playerId: currentPlayer.id,
        fromNodeId: currentPlayer.currentNodeId,
        remainingSteps: steps,
        traversedNodeIds: path,
        options: outgoing.map((edge) => {
          const targetIndex = nextState.config.runtimeGraph.nodeIndexById[edge.toNodeId] ?? 0;
          const targetField = nextState.config.board[targetIndex];
          return {
            edgeId: edge.id,
            toNodeId: edge.toNodeId,
            toFieldName: targetField?.name ?? edge.toNodeId,
            gateCost: edge.gateCost,
            label: edge.label,
          };
        }),
      };

      return {
        state: {
          ...nextState,
          pendingPathChoice,
          lastTraversalPathNodeIds: path,
          log: ["Path choice required.", ...nextState.log].slice(0, 40),
        },
        stoppedAtSafePoint,
      };
    }

    const selectedEdge = outgoing[0];
    if (!selectedEdge) break;
    const traversed = continueTraversalWithEdge(
      nextState,
      installedRounds,
      selectedEdge,
      steps,
      path
    );

    nextState = traversed.state;
    steps = traversed.remainingSteps;
    path = traversed.traversedNodeIds;
    stoppedAtSafePoint = traversed.stoppedAtSafePoint;
    stoppedAtForcedRound = traversed.stoppedAtForcedRound;
    stoppedAtEnd = traversed.stoppedAtEnd;

    if (
      stoppedAtSafePoint ||
      stoppedAtForcedRound ||
      stoppedAtEnd ||
      nextState.queuedRound ||
      nextState.activeRound ||
      nextState.pendingPerkSelection ||
      nextState.sessionPhase !== "normal"
    ) {
      break;
    }
  }

  if (
    !stoppedAtSafePoint &&
    !stoppedAtForcedRound &&
    !stoppedAtEnd &&
    !nextState.pendingPathChoice &&
    !nextState.pendingPerkSelection &&
    !nextState.queuedRound &&
    !nextState.activeRound &&
    nextState.sessionPhase === "normal"
  ) {
    nextState = resolveFinalNodeLanding(nextState, installedRounds, randoms);
  }

  return {
    state: {
      ...nextState,
      lastTraversalPathNodeIds: path,
    },
    stoppedAtSafePoint,
  };
}

export function selectPathEdge(
  state: GameState,
  edgeId: string,
  installedRounds: InstalledRound[],
  randoms?: {
    antiPerkTriggerRoll?: number;
    antiPerkIndex?: number;
    perkChoicesRolls?: number[];
  }
): GameState {
  const pending = state.pendingPathChoice;
  if (!pending) return state;

  const edge = state.config.runtimeGraph.edgesById[edgeId];
  if (!edge || edge.fromNodeId !== pending.fromNodeId) return state;

  const currentPlayer = state.players[state.currentPlayerIndex];
  if (
    !currentPlayer ||
    currentPlayer.id !== pending.playerId ||
    currentPlayer.money < edge.gateCost
  ) {
    return state;
  }

  const afterChoice = {
    ...state,
    pendingPathChoice: null,
  };

  const traversedFirst = continueTraversalWithEdge(
    afterChoice,
    installedRounds,
    edge,
    pending.remainingSteps,
    pending.traversedNodeIds
  );

  let next = {
    ...traversedFirst.state,
    lastTraversalPathNodeIds: traversedFirst.traversedNodeIds,
  };

  if (
    traversedFirst.stoppedAtSafePoint ||
    traversedFirst.stoppedAtForcedRound ||
    traversedFirst.stoppedAtEnd ||
    next.queuedRound ||
    next.activeRound ||
    next.pendingPerkSelection ||
    next.sessionPhase !== "normal"
  ) {
    return next;
  }

  if (traversedFirst.remainingSteps <= 0) {
    next = resolveFinalNodeLanding(next, installedRounds, randoms);
  } else {
    const continued = traverseMovement(
      next,
      installedRounds,
      traversedFirst.remainingSteps,
      traversedFirst.traversedNodeIds,
      randoms
    );
    next = continued.state;
    if (continued.stoppedAtSafePoint) {
      return next;
    }
  }
  if (
    next.pendingPathChoice ||
    next.queuedRound ||
    next.activeRound ||
    next.pendingPerkSelection ||
    next.sessionPhase !== "normal"
  ) {
    return next;
  }

  return advanceTurn(next);
}

export function resolvePathChoiceTimeout(
  state: GameState,
  installedRounds: InstalledRound[],
  randoms?: {
    pathChoiceRoll?: number;
    antiPerkTriggerRoll?: number;
    antiPerkIndex?: number;
    perkChoicesRolls?: number[];
  }
): GameState {
  const pending = state.pendingPathChoice;
  if (!pending || pending.options.length === 0) return state;

  const currentPlayer = state.players[state.currentPlayerIndex];
  if (!currentPlayer) return state;

  const validOptions = pending.options.filter((option) => {
    const edge = state.config.runtimeGraph.edgesById[option.edgeId];
    return edge && edge.fromNodeId === pending.fromNodeId && currentPlayer.money >= edge.gateCost;
  });

  if (validOptions.length === 0) {
    return {
      ...state,
      pendingPathChoice: null,
      log: ["No valid edge available. Turn continues.", ...state.log].slice(0, 40),
    };
  }

  const weighted = validOptions.map((option) => {
    const edge = state.config.runtimeGraph.edgesById[option.edgeId];
    return {
      edgeId: option.edgeId,
      weight: edge?.weight ?? 1,
    };
  });

  const selectedEdgeId = pickWeightedRoundId(
    weighted.map((entry) => ({ roundId: entry.edgeId, weight: entry.weight })),
    randoms?.pathChoiceRoll
  );
  if (!selectedEdgeId) return state;

  return selectPathEdge(state, selectedEdgeId, installedRounds, randoms);
}

export function createInitialGameState(
  config: GameConfig,
  options?: { initialHighscore?: number; playedRoundIdsByPool?: Record<string, string[]> }
): GameState {
  const initialHighscore = Math.max(0, options?.initialHighscore ?? 0);
  const startNodeId = config.runtimeGraph.startNodeId;
  const startIndex = config.runtimeGraph.nodeIndexById[startNodeId] ?? 0;

  return {
    config,
    players: [
      {
        id: "p1",
        name: "Player 1",
        currentNodeId: startNodeId,
        position: startIndex,
        stats: {
          diceMin: config.dice.min,
          diceMax: config.dice.max,
          roundPauseMs: coerceFiniteNumber(config.roundStartDelayMs, 20_000),
          perkFrequency: 0,
          perkLuck: 0,
        },
        money: config.economy.startingMoney,
        score: config.economy.startingScore,
        perks: [],
        antiPerks: [],
        inventory: [],
        activePerkEffects: [],
        roundControl: {
          pauseCharges: 0,
          skipCharges: 0,
        },
        shieldRoundsRemaining: 0,
        pendingRollMultiplier: null,
        pendingRollCeiling: null,
        pendingIntensityCap: null,
      },
    ],
    currentPlayerIndex: 0,
    turn: 1,
    sessionPhase: "normal",
    bonusRolls: 0,
    nextCumRoundIndex: 0,
    highscore: initialHighscore,
    intermediaryProbability: clamp(
      config.probabilityScaling.initialIntermediaryProbability,
      0,
      config.probabilityScaling.maxIntermediaryProbability
    ),
    antiPerkProbability: clamp(
      config.probabilityScaling.initialAntiPerkProbability,
      0,
      config.probabilityScaling.maxAntiPerkProbability
    ),
    queuedRound: null,
    activeRound: null,
    queuedRoundAudioEffect: null,
    activeRoundAudioEffect: null,
    pendingPathChoice: null,
    pendingPerkSelection: null,
    lastTraversalPathNodeIds: [startNodeId],
    playedRoundIdsByPool: { ...(options?.playedRoundIdsByPool ?? {}) },
    log: ["Game initialized."],
    lastRoll: null,
    completionReason: null,
  };
}

export function reportPlayerCum(state: GameState): GameState {
  if (state.sessionPhase === "completed") return state;
  return {
    ...state,
    sessionPhase: "completed",
    completionReason: "self_reported_cum",
    queuedRound: null,
    activeRound: null,
    queuedRoundAudioEffect: null,
    activeRoundAudioEffect: null,
    pendingPathChoice: null,
    pendingPerkSelection: null,
    log: ["Run ended: player confirmed cum.", ...state.log].slice(0, 40),
  };
}

export function rollTurn(
  state: GameState,
  installedRounds: InstalledRound[],
  forcedRoll?: number,
  randoms?: {
    baseRoll?: number;
    antiPerkTriggerRoll?: number;
    antiPerkIndex?: number;
    perkChoicesRolls?: number[];
  }
): GameState {
  if (state.sessionPhase !== "normal") return state;
  if (state.pendingPerkSelection || state.pendingPathChoice || state.activeRound) return state;
  if (state.queuedRound && !canSkipQueuedRound(state)) return state;

  const player = state.players[state.currentPlayerIndex];
  if (!player) return state;

  const baseRoll =
    typeof forcedRoll === "number"
      ? clamp(Math.floor(forcedRoll), player.stats.diceMin, player.stats.diceMax)
      : (randoms?.baseRoll ?? randomInt(player.stats.diceMin, player.stats.diceMax));
  const rollCeiling =
    player.pendingRollCeiling == null ? null : clamp(Math.floor(player.pendingRollCeiling), 1, 12);
  const cappedBaseRoll = rollCeiling == null ? baseRoll : Math.min(baseRoll, rollCeiling);
  const rollMultiplier = Math.max(1, Math.floor(player.pendingRollMultiplier ?? 1));
  const roll = Math.max(1, Math.floor(cappedBaseRoll * rollMultiplier));

  const movedState: GameState = {
    ...state,
    queuedRound: null,
    players: updatePlayer(state.players, player.id, (entry) => ({
      ...entry,
      pendingRollMultiplier: null,
      pendingRollCeiling: null,
      activePerkEffects: entry.activePerkEffects.filter(
        (effect) =>
          !(
            effect.remainingRounds === 0 &&
            effect.effects.some(
              (e) => e.kind === "setPendingRollCeiling" || e.kind === "setPendingRollMultiplier"
            )
          )
      ),
    })),
    lastRoll: roll,
    log: [
      rollCeiling !== null && cappedBaseRoll !== baseRoll
        ? rollMultiplier > 1
          ? `${player.name} rolled ${baseRoll}, Snake Eyes capped it to ${cappedBaseRoll}, and Doubler boosted it to ${roll}.`
          : `${player.name} rolled ${baseRoll}, but Snake Eyes capped it to ${roll}.`
        : rollMultiplier > 1
          ? `${player.name} rolled ${baseRoll} and Doubler boosted it to ${roll}.`
          : `${player.name} rolled ${roll}.`,
      ...state.log,
    ].slice(0, 40),
    lastTraversalPathNodeIds: [player.currentNodeId],
  };

  const resolved = traverseMovement(movedState, installedRounds, roll, [player.currentNodeId], {
    antiPerkTriggerRoll: randoms?.antiPerkTriggerRoll,
    antiPerkIndex: randoms?.antiPerkIndex,
    perkChoicesRolls: randoms?.perkChoicesRolls,
  });

  if (
    resolved.stoppedAtSafePoint ||
    resolved.state.pendingPathChoice ||
    resolved.state.pendingPerkSelection ||
    resolved.state.queuedRound ||
    resolved.state.activeRound ||
    resolved.state.sessionPhase !== "normal"
  ) {
    return resolved.state;
  }

  return advanceTurn(resolved.state);
}

export function triggerQueuedRound(state: GameState): GameState {
  if (!state.queuedRound) return state;
  const currentPlayerId = state.players[state.currentPlayerIndex]?.id;
  const withResolvedNoRest =
    currentPlayerId && state.players[state.currentPlayerIndex]?.antiPerks.includes("no-rest")
      ? consumeAntiPerkById(state, {
        playerId: currentPlayerId,
        perkId: "no-rest",
        reason: "No-rest ended when the round started.",
      })
      : state;
  return {
    ...withResolvedNoRest,
    activeRound: state.queuedRound,
    activeRoundAudioEffect: withResolvedNoRest.queuedRoundAudioEffect,
    queuedRound: null,
    queuedRoundAudioEffect: null,
    log: [`${state.queuedRound.roundName} started.`, ...withResolvedNoRest.log].slice(0, 40),
  };
}

export function shouldAutoStartQueuedRound(state: GameState): boolean {
  return Boolean(state.queuedRound && !canSkipQueuedRound(state));
}

export function completeRound(
  state: GameState,
  summary: CompletedRoundSummary | undefined,
  installedRounds: InstalledRound[],
  randoms?: {
    perkTriggerRoll?: number;
    antiPerkTriggerRoll?: number;
    antiPerkIndex?: number;
    perkChoicesRolls?: number[];
  }
): GameState {
  if (!state.activeRound) return state;

  const currentPlayer = state.players[state.currentPlayerIndex];
  if (!currentPlayer) return state;

  const activeRound = state.activeRound;
  if (activeRound.phaseKind === "cum") {
    const cumOutcome: CumRoundOutcome = summary?.cumOutcome ?? "did_not_cum";
    if (cumOutcome === "failed_instruction") {
      return {
        ...state,
        activeRound: null,
        sessionPhase: "completed",
        completionReason: "cum_instruction_failed",
        log: [`Cum round failed: ${activeRound.roundName}.`, ...state.log].slice(0, 40),
      };
    }

    const cumBonusScore = Math.max(0, state.config.economy.scorePerCumRoundSuccess);
    const nextPlayers = updatePlayer(state.players, currentPlayer.id, (player) => ({
      ...player,
      score: Math.max(0, player.score + cumBonusScore),
    }));
    const updatedPlayer = nextPlayers[state.currentPlayerIndex];
    const nextHighscore = Math.max(state.highscore, updatedPlayer?.score ?? 0);
    const nextAfterCum = {
      ...state,
      players: nextPlayers,
      highscore: nextHighscore,
      activeRound: null,
      log: [
        `Cum round success: ${activeRound.roundName}. +${cumBonusScore} score.`,
        ...state.log,
      ].slice(0, 40),
    };
    return {
      ...nextAfterCum,
      sessionPhase: "completed",
      completionReason: "finished",
      log: ["Session completed.", ...nextAfterCum.log].slice(0, 40),
    };
  }

  const intermediaryCount = Math.max(0, summary?.intermediaryCount ?? 0);
  const activeAntiPerkCount = Math.max(0, summary?.activeAntiPerkCount ?? 0);
  const moneyEarned = state.config.economy.moneyPerCompletedRound;
  const scoreEarned =
    state.config.economy.scorePerCompletedRound +
    intermediaryCount * state.config.economy.scorePerIntermediary +
    activeAntiPerkCount * state.config.economy.scorePerActiveAntiPerk;
  const nextIntermediaryProbability = clamp(
    state.intermediaryProbability + state.config.probabilityScaling.intermediaryIncreasePerRound,
    0,
    state.config.probabilityScaling.maxIntermediaryProbability
  );
  const nextAntiPerkProbability = clamp(
    state.antiPerkProbability + state.config.probabilityScaling.antiPerkIncreasePerRound,
    0,
    state.config.probabilityScaling.maxAntiPerkProbability
  );

  const nextPlayers = updatePlayer(state.players, currentPlayer.id, (player) => ({
    ...player,
    money: Math.max(0, player.money + moneyEarned),
    score: Math.max(0, player.score + scoreEarned),
    pendingIntensityCap: null,
    activePerkEffects: player.activePerkEffects.filter(
      (effect) =>
        !(
          effect.remainingRounds === 0 &&
          effect.effects.some((e) => e.kind === "setPendingIntensityCap")
        )
    ),
  }));
  const updatedPlayer = nextPlayers[state.currentPlayerIndex];
  const nextHighscore = Math.max(state.highscore, updatedPlayer?.score ?? 0);

  let next: GameState = {
    ...state,
    players: nextPlayers,
    highscore: nextHighscore,
    activeRound: null,
    activeRoundAudioEffect: null,
    intermediaryProbability: nextIntermediaryProbability,
    antiPerkProbability: nextAntiPerkProbability,
    log: [
      `Round finished. +$${moneyEarned}, +${scoreEarned} score (${intermediaryCount} intermediary, ${activeAntiPerkCount} anti-perks). Chances now ${Math.round(nextIntermediaryProbability * 100)}%/${Math.round(nextAntiPerkProbability * 100)}%.`,
      ...state.log,
    ].slice(0, 40),
  };

  if (state.activeRoundAudioEffect?.sourcePerkId && currentPlayer) {
    next = consumeAntiPerkById(next, {
      playerId: currentPlayer.id,
      perkId: state.activeRoundAudioEffect.sourcePerkId,
      reason: `${state.activeRoundAudioEffect.sourcePerkId} finished after the round ended.`,
    });
  }

  const currentNodeId = next.players[next.currentPlayerIndex]?.currentNodeId;
  const outgoing = currentNodeId
    ? (next.config.runtimeGraph.outgoingEdgeIdsByNodeId[currentNodeId] ?? [])
    : [];
  const hasExplicitEndNodes = next.config.board.some((field) => field.kind === "end");

  if (
    !hasExplicitEndNodes &&
    outgoing.length === 0 &&
    next.config.singlePlayer.cumRoundIds.length > 0
  ) {
    next = startCumPhase(next, installedRounds);
    if (
      next.pendingPerkSelection ||
      next.pendingPathChoice ||
      next.queuedRound ||
      next.activeRound ||
      next.sessionPhase === "completed"
    ) {
      return next;
    }
    return advanceTurn(next);
  }

  if (
    !hasExplicitEndNodes &&
    outgoing.length === 0 &&
    next.config.singlePlayer.cumRoundIds.length === 0
  ) {
    return {
      ...next,
      sessionPhase: "completed",
      completionReason: "finished",
      log: ["Session completed.", ...next.log].slice(0, 40),
    };
  }

  const updatedCurrentPlayer = next.players[next.currentPlayerIndex];
  const roundField = next.config.board.find((f) => f.id === activeRound.fieldId);
  const isPerkNode = roundField?.kind === "perk";
  const perkTriggerRoll = randoms?.perkTriggerRoll ?? Math.random();
  if (
    updatedCurrentPlayer &&
    !isPerkNode &&
    perkTriggerRoll < getEffectivePerkTriggerChance(next, updatedCurrentPlayer)
  ) {
    next = triggerPerkSelection(next, currentPlayer.id, activeRound.fieldId, {
      antiPerkTriggerRoll: randoms?.antiPerkTriggerRoll,
      antiPerkIndex: randoms?.antiPerkIndex,
      perkChoicesRolls: randoms?.perkChoicesRolls,
    });
    if (next.pendingPerkSelection || next.pendingPathChoice || next.queuedRound || next.activeRound)
      return next;
  }

  return advanceTurn(next);
}

export function selectPerk(
  state: GameState,
  perkId: string,
  options?: { applyDirectly?: boolean }
): GameState {
  const pending = state.pendingPerkSelection;
  if (!pending) return state;
  const selected = pending.options.find((option) => option.id === perkId);
  if (!selected) return state;
  const buyer = state.players.find((player) => player.id === pending.playerId);
  if (!buyer) return state;

  if (buyer.money < selected.cost) {
    return {
      ...state,
      log: [
        `Not enough money for ${selected.name}. Need $${selected.cost}, have $${buyer.money}.`,
        ...state.log,
      ].slice(0, 40),
    };
  }

  const afterPayment: GameState = {
    ...state,
    players: updatePlayer(state.players, pending.playerId, (player) => ({
      ...player,
      money: Math.max(0, player.money - selected.cost),
    })),
  };
  const shouldApplyDirectly = selected.kind === "perk" && options?.applyDirectly !== false;
  let nextState: GameState;
  if (shouldApplyDirectly) {
    const nextAfterPerk = applyPerkToPlayer(afterPayment, pending.playerId, selected);
    nextState = {
      ...nextAfterPerk,
      pendingPerkSelection: null,
      log: [
        selected.application === "immediate"
          ? `Immediate perk triggered: ${selected.name} (-$${selected.cost}).`
          : `Selected perk: ${selected.name} (-$${selected.cost}).`,
        ...nextAfterPerk.log,
      ].slice(0, 40),
    };
  } else {
    const inventoryItem = createInventoryItem(afterPayment, selected, pending.playerId);
    nextState = {
      ...afterPayment,
      pendingPerkSelection: null,
      players: updatePlayer(afterPayment.players, pending.playerId, (player) => ({
        ...player,
        inventory: [inventoryItem, ...player.inventory],
      })),
      log: [`Stored item: ${selected.name} (-$${selected.cost}).`, ...afterPayment.log].slice(
        0,
        40
      ),
    };
  }

  if (nextState.pendingPathChoice || nextState.queuedRound || nextState.activeRound)
    return nextState;
  return advanceTurn(nextState);
}

export function applyInventoryItemToSelf(
  state: GameState,
  input: {
    playerId: string;
    itemId: string;
  }
): GameState {
  const player = state.players.find((entry) => entry.id === input.playerId);
  if (!player) return state;
  const item = player.inventory.find((entry) => entry.itemId === input.itemId);
  if (!item || item.kind !== "perk") return state;

  const perk = getPerkById(item.perkId);
  if (!perk) {
    return {
      ...state,
      log: [`Unknown inventory perk: ${item.perkId}.`, ...state.log].slice(0, 40),
    };
  }

  const afterConsumption = {
    ...state,
    players: updatePlayer(state.players, input.playerId, (entry) => ({
      ...entry,
      inventory: entry.inventory.filter((candidate) => candidate.itemId !== input.itemId),
    })),
  };
  const next = applyPerkToPlayer(afterConsumption, input.playerId, perk);

  return {
    ...next,
    log: [`Applied item: ${perk.name}.`, ...next.log].slice(0, 40),
  };
}

export function consumeInventoryItem(
  state: GameState,
  input: {
    playerId: string;
    itemId: string;
    reason?: string;
  }
): GameState {
  const player = state.players.find((entry) => entry.id === input.playerId);
  if (!player) return state;
  const item = player.inventory.find((entry) => entry.itemId === input.itemId);
  if (!item) return state;

  const reason = input.reason?.trim() || `Consumed item: ${item.name}.`;
  return {
    ...state,
    players: updatePlayer(state.players, input.playerId, (entry) => ({
      ...entry,
      inventory: entry.inventory.filter((candidate) => candidate.itemId !== input.itemId),
    })),
    log: [reason, ...state.log].slice(0, 40),
  };
}

export function consumeAntiPerkById(
  state: GameState,
  input: {
    playerId: string;
    perkId: string;
    reason?: string;
  }
): GameState {
  const player = state.players.find((entry) => entry.id === input.playerId);
  if (!player) return state;
  const hadPerk = player.antiPerks.includes(input.perkId);
  const matchingEffects = player.activePerkEffects.filter(
    (active) => active.kind === "antiPerk" && active.id === input.perkId
  );
  if (!hadPerk && matchingEffects.length === 0) return state;

  let nextStats = { ...player.stats };
  for (const active of matchingEffects) {
    for (const effect of active.effects) {
      if (effect.kind === "numericDelta") {
        nextStats = applyNumericDelta(nextStats, effect, true);
      }
    }
  }

  const reason = input.reason?.trim() || `${input.perkId} resolved.`;
  return {
    ...state,
    queuedRoundAudioEffect:
      state.queuedRoundAudioEffect?.sourcePerkId === input.perkId ? null : state.queuedRoundAudioEffect,
    activeRoundAudioEffect:
      state.activeRoundAudioEffect?.sourcePerkId === input.perkId ? null : state.activeRoundAudioEffect,
    players: updatePlayer(state.players, input.playerId, (entry) => ({
      ...entry,
      stats: normalizeDice(nextStats),
      antiPerks: entry.antiPerks.filter((id) => id !== input.perkId),
      activePerkEffects: entry.activePerkEffects.filter(
        (active) => !(active.kind === "antiPerk" && active.id === input.perkId)
      ),
    })),
    log: [reason, ...state.log].slice(0, 40),
  };
}

export function useRoundControl(
  state: GameState,
  input: {
    playerId: string;
    control: "pause" | "skip";
  }
): GameState {
  const player = state.players.find((entry) => entry.id === input.playerId);
  if (!player) return state;
  const controls = getRoundControl(player);
  const available = input.control === "pause" ? controls.pauseCharges : controls.skipCharges;
  if (available <= 0) return state;

  const nextControls =
    input.control === "pause"
      ? { ...controls, pauseCharges: controls.pauseCharges - 1 }
      : { ...controls, skipCharges: controls.skipCharges - 1 };

  return {
    ...state,
    players: updatePlayer(state.players, input.playerId, (entry) => ({
      ...entry,
      roundControl: nextControls,
    })),
    log: [`Used ${input.control} charge.`, ...state.log].slice(0, 40),
  };
}

export function skipPerkSelection(state: GameState): GameState {
  if (!state.pendingPerkSelection) return state;

  const nextState: GameState = {
    ...state,
    pendingPerkSelection: null,
    log: ["Perk selection timed out. No perk selected.", ...state.log].slice(0, 40),
  };

  if (nextState.pendingPathChoice || nextState.queuedRound || nextState.activeRound)
    return nextState;
  return advanceTurn(nextState);
}

export function applyPerkByIdToPlayer(
  state: GameState,
  input: {
    targetPlayerId: string;
    perkId: string;
    sourceLabel?: string;
  }
): GameState {
  const targetPlayer = state.players.find((player) => player.id === input.targetPlayerId);
  if (!targetPlayer) return state;

  const perk = getPerkById(input.perkId);
  if (!perk) {
    return {
      ...state,
      log: [`Unknown external perk: ${input.perkId}.`, ...state.log].slice(0, 40),
    };
  }

  if (perk.kind === "antiPerk" && getShieldRounds(targetPlayer) > 0) {
    return {
      ...state,
      log: [`${targetPlayer.name} blocked ${perk.name} with Shield.`, ...state.log].slice(0, 40),
    };
  }

  const next = applyPerkToPlayer(state, targetPlayer.id, perk);
  const source = input.sourceLabel?.trim();
  const actor = source && source.length > 0 ? source : "Computer";
  const kindLabel = perk.kind === "antiPerk" ? "anti-perk" : "perk";

  return {
    ...next,
    log: [`${actor} applied ${kindLabel}: ${perk.name} - ${perk.description}`, ...next.log].slice(
      0,
      40
    ),
  };
}

export function adjustPlayerMoney(
  state: GameState,
  input: {
    playerId: string;
    delta: number;
    reason?: string;
  }
): GameState {
  const player = state.players.find((entry) => entry.id === input.playerId);
  if (!player) return state;

  const delta = Math.trunc(input.delta);
  if (delta === 0) return state;
  const nextMoney = Math.max(0, player.money + delta);
  const reason = input.reason?.trim() ?? "External economy adjustment.";
  const sign = delta >= 0 ? "+" : "";

  return {
    ...state,
    players: updatePlayer(state.players, input.playerId, (entry) => ({
      ...entry,
      money: nextMoney,
    })),
    log: [`${reason} (${sign}${delta}).`, ...state.log].slice(0, 40),
  };
}

export function describePerkEffects(perk: PerkDefinition): string {
  return perk.effects
    .map((effect) => {
      if (effect.kind !== "numericDelta") return "special effect";
      const sign = effect.amount >= 0 ? "+" : "";
      return `${effect.stat} ${sign}${effect.amount}`;
    })
    .join(", ");
}
