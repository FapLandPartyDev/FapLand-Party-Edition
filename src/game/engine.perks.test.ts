import { afterEach, describe, expect, it, vi } from "vitest";
import {
  applyPerkByIdToPlayer,
  completeRound,
  consumeAntiPerkById,
  createInitialGameState,
  rollTurn,
  selectPerk,
  triggerQueuedRound,
} from "./engine";
import { getPerkById } from "./data/perks";
import type { GameConfig, GameState, PendingPerkSelection } from "./types";

afterEach(() => {
  vi.restoreAllMocks();
});

function makeConfig(): GameConfig {
  return {
    board: [
      { id: "start", name: "Start", kind: "start" },
      { id: "path-1", name: "Path 1", kind: "path" },
    ],
    runtimeGraph: {
      startNodeId: "start",
      pathChoiceTimeoutMs: 6000,
      edges: [{ id: "e1", fromNodeId: "start", toNodeId: "path-1", gateCost: 0, weight: 1 }],
      edgesById: { e1: { id: "e1", fromNodeId: "start", toNodeId: "path-1", gateCost: 0, weight: 1 } },
      outgoingEdgeIdsByNodeId: { start: ["e1"] },
      randomRoundPoolsById: {},
      nodeIndexById: { start: 0, "path-1": 1 },
    },
    dice: { min: 1, max: 6 },
    perkSelection: {
      optionsPerPick: 3,
      triggerChancePerCompletedRound: 0,
      includeAntiPerksInChoices: true,
    },
    perkPool: {
      enabledPerkIds: [
        "pause",
        "skip",
        "heal",
        "shield",
        "cleaner",
        "doubler",
        "lazy-hero",
        "gooooal",
        "be-gentle",
        "treasure-magnet",
        "lucky-star",
        "coupon-clipper",
      ],
      enabledAntiPerkIds: [
        "jammed-dice",
        "cold-streak",
        "score-leech",
        "cement-boots",
        "panic-loop",
        "dry-spell",
        "bad-omen",
        "sticky-fingers",
        "snake-eyes",
      ],
    },
    probabilityScaling: {
      initialIntermediaryProbability: 0.4,
      initialAntiPerkProbability: 0.3,
      intermediaryIncreasePerRound: 0.02,
      antiPerkIncreasePerRound: 0.015,
      maxIntermediaryProbability: 1,
      maxAntiPerkProbability: 0.75,
    },
    singlePlayer: {
      totalIndices: 1,
      safePointIndices: [],
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
      scorePerCumRoundSuccess: 420,
    },
    roundStartDelayMs: 20000,
  };
}

function withPendingSelection(state: GameState, perkId: string): GameState {
  const perk = getPerkById(perkId);
  if (!perk) throw new Error(`Missing test perk: ${perkId}`);
  const player = state.players[state.currentPlayerIndex];
  if (!player) throw new Error("Missing player");

  const pendingPerkSelection: PendingPerkSelection = {
    playerId: player.id,
    fromFieldId: "perk-1",
    options: [perk],
  };

  return {
    ...state,
    players: state.players.map((entry) => ({ ...entry, money: 1000 })),
    pendingPerkSelection,
  };
}

describe("engine new perks", () => {
  it("grants pause and skip round controls", () => {
    const withPause = selectPerk(withPendingSelection(createInitialGameState(makeConfig()), "pause"), "pause", { applyDirectly: true });
    const pausePlayer = withPause.players[withPause.currentPlayerIndex]!;
    expect(pausePlayer.roundControl?.pauseCharges ?? 0).toBeGreaterThan(0);

    const withSkip = selectPerk(withPendingSelection(createInitialGameState(makeConfig()), "skip"), "skip", { applyDirectly: true });
    const skipPlayer = withSkip.players[withSkip.currentPlayerIndex]!;
    expect(skipPlayer.roundControl?.skipCharges ?? 0).toBeGreaterThan(0);
  });

  it("applies heal and gooooal immediately", () => {
    const healed = selectPerk(withPendingSelection(createInitialGameState(makeConfig()), "heal"), "heal", { applyDirectly: true });
    expect(healed.intermediaryProbability).toBeCloseTo(0.3);
    expect(healed.antiPerkProbability).toBeCloseTo(0.2);

    const scored = selectPerk(withPendingSelection(createInitialGameState(makeConfig()), "gooooal"), "gooooal", { applyDirectly: true });
    const player = scored.players[scored.currentPlayerIndex]!;
    expect(player.score).toBe(150);
  });

  it("applies persistent perk frequency and luck modifiers", () => {
    const magnet = selectPerk(withPendingSelection(createInitialGameState(makeConfig()), "treasure-magnet"), "treasure-magnet", { applyDirectly: true });
    const magnetPlayer = magnet.players[magnet.currentPlayerIndex]!;
    expect(magnetPlayer.stats.perkFrequency).toBeCloseTo(0.15);

    const lucky = selectPerk(withPendingSelection(createInitialGameState(makeConfig()), "lucky-star"), "lucky-star", { applyDirectly: true });
    const luckyPlayer = lucky.players[lucky.currentPlayerIndex]!;
    expect(luckyPlayer.stats.perkLuck).toBeCloseTo(0.4);

    const couponClipper = selectPerk(withPendingSelection(createInitialGameState(makeConfig()), "coupon-clipper"), "coupon-clipper", { applyDirectly: true });
    const couponPlayer = couponClipper.players[couponClipper.currentPlayerIndex]!;
    expect(couponPlayer.stats.perkFrequency).toBeCloseTo(0.2);
    expect(couponPlayer.stats.perkLuck).toBeCloseTo(-0.3);
  });

  it("doubles the next roll and consumes the multiplier", () => {
    const doubled = selectPerk(withPendingSelection(createInitialGameState(makeConfig()), "doubler"), "doubler", { applyDirectly: true });
    const rolled = rollTurn(doubled, [], 3);
    const player = rolled.players[rolled.currentPlayerIndex]!;
    expect(rolled.lastRoll).toBe(6);
    expect(player.pendingRollMultiplier ?? null).toBeNull();
  });

  it("blocks incoming anti-perks while shield is active", () => {
    const shielded = selectPerk(withPendingSelection(createInitialGameState(makeConfig()), "shield"), "shield", { applyDirectly: true });
    const playerId = shielded.players[shielded.currentPlayerIndex]!.id;
    const blocked = applyPerkByIdToPlayer(shielded, { targetPlayerId: playerId, perkId: "jammed-dice", sourceLabel: "test" });
    const player = blocked.players[blocked.currentPlayerIndex]!;
    expect(player.antiPerks).toHaveLength(0);
    expect(blocked.log[0]).toContain("blocked");
  });

  it("cleaner removes active anti-perks and restores stats", () => {
    const base = createInitialGameState(makeConfig());
    const playerId = base.players[base.currentPlayerIndex]!.id;
    const afflicted = applyPerkByIdToPlayer(base, { targetPlayerId: playerId, perkId: "jammed-dice", sourceLabel: "test" });
    expect(afflicted.players[afflicted.currentPlayerIndex]!.antiPerks).toContain("jammed-dice");
    expect(afflicted.players[afflicted.currentPlayerIndex]!.stats.diceMax).toBe(5);

    const cleaned = selectPerk(withPendingSelection(afflicted, "cleaner"), "cleaner", { applyDirectly: true });
    const player = cleaned.players[cleaned.currentPlayerIndex]!;
    expect(player.antiPerks).toHaveLength(0);
    expect(player.stats.diceMax).toBe(6);
  });

  it("applies lazy hero permanently and clears be-gentle after a completed round", () => {
    const lazy = selectPerk(withPendingSelection(createInitialGameState(makeConfig()), "lazy-hero"), "lazy-hero", { applyDirectly: true });
    const lazyPlayer = lazy.players[lazy.currentPlayerIndex]!;
    expect(lazyPlayer.stats.roundPauseMs).toBeGreaterThanOrEqual(25000);

    const gentle = selectPerk(withPendingSelection(createInitialGameState(makeConfig()), "be-gentle"), "be-gentle", { applyDirectly: true });
    const withActiveRound: GameState = {
      ...gentle,
      activeRound: {
        fieldId: "path-1",
        nodeId: "path-1",
        roundId: "round-1",
        roundName: "Round 1",
        selectionKind: "fixed",
        poolId: null,
        phaseKind: "normal",
        campaignIndex: 1,
      },
    };
    const afterRound = completeRound(withActiveRound, undefined, []);
    const playerAfterRound = afterRound.players[afterRound.currentPlayerIndex]!;
    expect(playerAfterRound.pendingIntensityCap ?? null).toBeNull();
  });

  it("applies virus and virus max to intermediary probability", () => {
    const base = createInitialGameState(makeConfig());
    const playerId = base.players[base.currentPlayerIndex]!.id;

    const withVirus = applyPerkByIdToPlayer(base, {
      targetPlayerId: playerId,
      perkId: "virus",
      sourceLabel: "test",
    });
    expect(withVirus.intermediaryProbability).toBeCloseTo(0.5);

    const withVirusMax = applyPerkByIdToPlayer(withVirus, {
      targetPlayerId: playerId,
      perkId: "virus-max",
      sourceLabel: "test",
    });
    expect(withVirusMax.intermediaryProbability).toBeCloseTo(withVirusMax.config.probabilityScaling.maxIntermediaryProbability);
  });

  it("keeps highspeed active after one turn advance", () => {
    const base = createInitialGameState(makeConfig());
    const playerId = base.players[base.currentPlayerIndex]!.id;
    const withHighspeed = applyPerkByIdToPlayer(base, {
      targetPlayerId: playerId,
      perkId: "highspeed",
      sourceLabel: "test",
    });
    const afterAdvance = rollTurn(withHighspeed, [], 1);
    expect(afterAdvance.players[afterAdvance.currentPlayerIndex]!.antiPerks).toContain("highspeed");
  });

  it("keeps cement boots active after one turn advance", () => {
    const base = createInitialGameState(makeConfig());
    const playerId = base.players[base.currentPlayerIndex]!.id;
    const withCementBoots = applyPerkByIdToPlayer(base, {
      targetPlayerId: playerId,
      perkId: "cement-boots",
      sourceLabel: "test",
    });
    expect(withCementBoots.players[withCementBoots.currentPlayerIndex]!.stats.diceMax).toBe(4);

    const afterAdvance = rollTurn(withCementBoots, [], 1);
    expect(afterAdvance.players[afterAdvance.currentPlayerIndex]!.antiPerks).toContain("cement-boots");
  });

  it("restores cold streak after it expires", () => {
    const config = makeConfig();
    config.runtimeGraph.edges = [
      { id: "e1", fromNodeId: "start", toNodeId: "path-1", gateCost: 0, weight: 1 },
      { id: "e2", fromNodeId: "path-1", toNodeId: "start", gateCost: 0, weight: 1 },
    ];
    config.runtimeGraph.edgesById = {
      e1: { id: "e1", fromNodeId: "start", toNodeId: "path-1", gateCost: 0, weight: 1 },
      e2: { id: "e2", fromNodeId: "path-1", toNodeId: "start", gateCost: 0, weight: 1 },
    };
    config.runtimeGraph.outgoingEdgeIdsByNodeId = {
      start: ["e1"],
      "path-1": ["e2"],
    };

    const base = createInitialGameState(config);
    const playerId = base.players[base.currentPlayerIndex]!.id;
    const prepared = {
      ...base,
      players: base.players.map((player) => ({
        ...player,
        stats: {
          ...player.stats,
          diceMin: 3,
        },
      })),
    };
    const withColdStreak = applyPerkByIdToPlayer(prepared, {
      targetPlayerId: playerId,
      perkId: "cold-streak",
      sourceLabel: "test",
    });
    expect(withColdStreak.players[withColdStreak.currentPlayerIndex]!.stats.diceMin).toBe(2);

    const advancedOnce = rollTurn(withColdStreak, [], 1);
    expect(advancedOnce.players[advancedOnce.currentPlayerIndex]!.antiPerks).toContain("cold-streak");

    const advancedTwice = rollTurn(advancedOnce, [], 1);
    expect(advancedTwice.players[advancedTwice.currentPlayerIndex]!.antiPerks).not.toContain("cold-streak");
    expect(advancedTwice.players[advancedTwice.currentPlayerIndex]!.stats.diceMin).toBe(3);
  });

  it("applies score leech immediately and clamps score at zero", () => {
    const base = createInitialGameState(makeConfig());
    const playerId = base.players[base.currentPlayerIndex]!.id;
    const withScore = {
      ...base,
      players: base.players.map((player) => ({ ...player, score: 100 })),
    };

    const leeched = applyPerkByIdToPlayer(withScore, {
      targetPlayerId: playerId,
      perkId: "score-leech",
      sourceLabel: "test",
    });
    expect(leeched.players[leeched.currentPlayerIndex]!.score).toBe(0);
  });

  it("applies panic loop to intermediary probability", () => {
    const base = createInitialGameState(makeConfig());
    const playerId = base.players[base.currentPlayerIndex]!.id;

    const withPanicLoop = applyPerkByIdToPlayer(base, {
      targetPlayerId: playerId,
      perkId: "panic-loop",
      sourceLabel: "test",
    });
    expect(withPanicLoop.intermediaryProbability).toBeCloseTo(0.6);
  });

  it("applies anti-perks that reduce perk frequency and luck", () => {
    const base = createInitialGameState(makeConfig());
    const playerId = base.players[base.currentPlayerIndex]!.id;

    const withDrySpell = applyPerkByIdToPlayer(base, {
      targetPlayerId: playerId,
      perkId: "dry-spell",
      sourceLabel: "test",
    });
    expect(withDrySpell.players[withDrySpell.currentPlayerIndex]!.stats.perkFrequency).toBeCloseTo(-0.15);

    const withBadOmen = applyPerkByIdToPlayer(withDrySpell, {
      targetPlayerId: playerId,
      perkId: "bad-omen",
      sourceLabel: "test",
    });
    expect(withBadOmen.players[withBadOmen.currentPlayerIndex]!.stats.perkLuck).toBeCloseTo(-0.4);
  });

  it("uses perk frequency to change post-round offer chance", () => {
    const config = makeConfig();
    config.perkSelection.triggerChancePerCompletedRound = 0.1;
    config.perkPool.enabledPerkIds = ["treasure-magnet"];
    config.perkPool.enabledAntiPerkIds = [];

    const boosted = selectPerk(withPendingSelection(createInitialGameState(config), "treasure-magnet"), "treasure-magnet", { applyDirectly: true });
    const activeRoundState: GameState = {
      ...boosted,
      activeRound: {
        fieldId: "path-1",
        nodeId: "path-1",
        roundId: "round-1",
        roundName: "Round 1",
        selectionKind: "fixed",
        poolId: null,
        phaseKind: "normal",
        campaignIndex: 1,
      },
    };

    vi.spyOn(Math, "random").mockReturnValue(0.2);
    const afterRound = completeRound(activeRoundState, undefined, []);
    expect(afterRound.pendingPerkSelection?.options[0]?.id).toBe("treasure-magnet");
  });

  it("uses luck to bias perk rarity", () => {
    const config = makeConfig();
    config.perkSelection.triggerChancePerCompletedRound = 1;
    config.perkSelection.optionsPerPick = 1;
    config.perkPool.enabledPerkIds = ["loaded-dice", "shield", "lucky-star"];
    config.perkPool.enabledAntiPerkIds = [];

    const luckyState = selectPerk(withPendingSelection(createInitialGameState(config), "lucky-star"), "lucky-star", { applyDirectly: true });
    const activeRoundState: GameState = {
      ...luckyState,
      activeRound: {
        fieldId: "path-1",
        nodeId: "path-1",
        roundId: "round-1",
        roundName: "Round 1",
        selectionKind: "fixed",
        poolId: null,
        phaseKind: "normal",
        campaignIndex: 1,
      },
    };

    vi.spyOn(Math, "random")
      .mockReturnValueOnce(0.1)
      .mockReturnValueOnce(0.5)
      .mockReturnValueOnce(0.6);
    const afterRound = completeRound(activeRoundState, undefined, []);
    expect(afterRound.pendingPerkSelection?.options[0]?.id).toBe("shield");
  });

  it("sticky fingers removes round control charges without underflow", () => {
    const base = createInitialGameState(makeConfig());
    const playerId = base.players[base.currentPlayerIndex]!.id;
    const prepared = {
      ...base,
      players: base.players.map((player) => ({
        ...player,
        roundControl: {
          pauseCharges: 1,
          skipCharges: 0,
        },
      })),
    };

    const drained = applyPerkByIdToPlayer(prepared, {
      targetPlayerId: playerId,
      perkId: "sticky-fingers",
      sourceLabel: "test",
    });
    expect(drained.players[drained.currentPlayerIndex]!.roundControl?.pauseCharges).toBe(0);
    expect(drained.players[drained.currentPlayerIndex]!.roundControl?.skipCharges).toBe(0);
  });

  it("caps the next roll with snake eyes and then clears it", () => {
    const doubled = selectPerk(withPendingSelection(createInitialGameState(makeConfig()), "doubler"), "doubler", { applyDirectly: true });
    const playerId = doubled.players[doubled.currentPlayerIndex]!.id;
    const snakeEyed = applyPerkByIdToPlayer(doubled, {
      targetPlayerId: playerId,
      perkId: "snake-eyes",
      sourceLabel: "test",
    });

    const rolled = rollTurn(snakeEyed, [], 6);
    const player = rolled.players[rolled.currentPlayerIndex]!;
    expect(rolled.lastRoll).toBe(4);
    expect(player.pendingRollMultiplier ?? null).toBeNull();
    expect(player.pendingRollCeiling ?? null).toBeNull();
    expect(rolled.log[0]).toContain("Snake Eyes capped it to 2");
  });

  it("forces a high-difficulty random round with succubus", () => {
    const base = createInitialGameState(makeConfig());
    const playerId = base.players[base.currentPlayerIndex]!.id;
    const withSuccubus = applyPerkByIdToPlayer(base, {
      targetPlayerId: playerId,
      perkId: "succubus",
      sourceLabel: "test",
    });

    const installedRounds = [
      {
        id: "normal-low",
        name: "Normal Low",
        type: "Normal",
        difficulty: 2,
        bpm: 100,
        resources: [{ videoUri: "low.mp4", funscriptUri: "low.funscript" }],
      },
      {
        id: "normal-high",
        name: "Normal High",
        type: "Normal",
        difficulty: 5,
        bpm: 160,
        resources: [{ videoUri: "high.mp4", funscriptUri: "high.funscript" }],
      },
    ] as any;

    const afterRoll = rollTurn(withSuccubus, installedRounds, 1);
    expect(afterRoll.queuedRound?.roundId).toBe("normal-high");
    expect(afterRoll.players[afterRoll.currentPlayerIndex]?.antiPerks.includes("succubus")).toBe(false);
  });

  it("tracks and resolves no-rest as a board sequence anti-perk", () => {
    const base = createInitialGameState(makeConfig());
    const playerId = base.players[base.currentPlayerIndex]!.id;
    const withNoRest = applyPerkByIdToPlayer(base, {
      targetPlayerId: playerId,
      perkId: "no-rest",
      sourceLabel: "test",
    });
    expect(withNoRest.players[withNoRest.currentPlayerIndex]!.antiPerks).toContain("no-rest");

    const resolved = consumeAntiPerkById(withNoRest, {
      playerId,
      perkId: "no-rest",
      reason: "No-rest completed.",
    });
    expect(resolved.players[resolved.currentPlayerIndex]!.antiPerks).not.toContain("no-rest");
  });

  it("consumes no-rest when the queued round starts", () => {
    const base = createInitialGameState(makeConfig());
    const playerId = base.players[base.currentPlayerIndex]!.id;
    const withNoRest = applyPerkByIdToPlayer(base, {
      targetPlayerId: playerId,
      perkId: "no-rest",
      sourceLabel: "test",
    });
    const withQueuedRound = {
      ...withNoRest,
      queuedRound: {
        fieldId: "round-field",
        nodeId: "path-1",
        roundId: "round-1",
        roundName: "Round 1",
        skippable: true,
        selectionKind: "fixed" as const,
        poolId: null,
        phaseKind: "normal" as const,
        campaignIndex: 1,
      },
    };

    const started = triggerQueuedRound(withQueuedRound);

    expect(started.activeRound?.roundId).toBe("round-1");
    expect(started.queuedRound).toBeNull();
    expect(started.players[started.currentPlayerIndex]!.antiPerks).not.toContain("no-rest");
    expect(started.log).toContain("No-rest ended when the round started.");
  });

  it("replaces no-rest when milker is applied", () => {
    const base = createInitialGameState(makeConfig());
    const playerId = base.players[base.currentPlayerIndex]!.id;
    const withNoRest = applyPerkByIdToPlayer(base, {
      targetPlayerId: playerId,
      perkId: "no-rest",
      sourceLabel: "test",
    });
    expect(withNoRest.players[withNoRest.currentPlayerIndex]!.antiPerks).toContain("no-rest");

    const withMilker = applyPerkByIdToPlayer(withNoRest, {
      targetPlayerId: playerId,
      perkId: "milker",
      sourceLabel: "test",
    });
    expect(withMilker.players[withMilker.currentPlayerIndex]!.antiPerks).toContain("milker");
    expect(withMilker.players[withMilker.currentPlayerIndex]!.antiPerks).not.toContain("no-rest");
    expect(withMilker.log.some(line => line.includes("Milker replaced No Rest."))).toBe(true);
  });

  it("skips random post-round perk selection if the round was played on a perk node", () => {
    const config = makeConfig();
    // Configure path-1 as a perk node with a fixed round
    config.board[1] = {
      id: "path-1",
      name: "Perk Round Node",
      kind: "perk",
      fixedRoundId: "round-1",
    };
    config.perkSelection.triggerChancePerCompletedRound = 1.0; // Always trigger post-round perk normally

    const base = createInitialGameState(config);
    const activeRoundState: GameState = {
      ...base,
      activeRound: {
        fieldId: "path-1",
        nodeId: "path-1",
        roundId: "round-1",
        roundName: "Round 1",
        selectionKind: "fixed",
        poolId: null,
        phaseKind: "normal",
        campaignIndex: 1,
      },
    };

    // Even with 100% trigger chance, it should be skipped because it's a perk node
    const afterRound = completeRound(activeRoundState, undefined, []);
    expect(afterRound.pendingPerkSelection).toBeNull();
    // And it should advance the turn because no perk was triggered
    expect(afterRound.turn).toBe(base.turn + 1);
  });
});
