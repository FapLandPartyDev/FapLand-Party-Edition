import { afterEach, describe, expect, it, vi } from "vitest";
import {
  applyInventoryItemToSelf,
  completeRound,
  consumeInventoryItem,
  createInitialGameState,
  selectPerk,
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
      edgesById: {
        e1: { id: "e1", fromNodeId: "start", toNodeId: "path-1", gateCost: 0, weight: 1 },
      },
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
      enabledPerkIds: ["loaded-dice"],
      enabledAntiPerkIds: ["jammed-dice"],
    },
    probabilityScaling: {
      initialIntermediaryProbability: 0,
      initialAntiPerkProbability: 0,
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
    pendingPerkSelection,
  };
}

describe("engine inventory flow", () => {
  it("stores selected perk in inventory when applyDirectly is false", () => {
    const base = withPendingSelection(createInitialGameState(makeConfig()), "loaded-dice");
    const next = selectPerk(base, "loaded-dice", { applyDirectly: false });
    const player = next.players[next.currentPlayerIndex]!;

    expect(next.pendingPerkSelection).toBeNull();
    expect(player.money).toBe(0);
    expect(player.inventory).toHaveLength(1);
    expect(player.stats.diceMax).toBe(6);
  });

  it("applies perk immediately when applyDirectly is true", () => {
    const base = withPendingSelection(createInitialGameState(makeConfig()), "loaded-dice");
    const next = selectPerk(base, "loaded-dice", { applyDirectly: true });
    const player = next.players[next.currentPlayerIndex]!;

    expect(player.money).toBe(0);
    expect(player.inventory).toHaveLength(0);
    expect(player.stats.diceMax).toBe(8);
    expect(player.activePerkEffects).toHaveLength(1);
  });

  it("self-applies anti-perk when applyDirectly is true", () => {
    const initial = createInitialGameState(makeConfig());
    const withMoney: GameState = {
      ...initial,
      players: initial.players.map((player) => ({ ...player, money: 500 })),
    };
    const base = withPendingSelection(withMoney, "jammed-dice");
    const next = selectPerk(base, "jammed-dice", { applyDirectly: true });
    const player = next.players[next.currentPlayerIndex]!;

    expect(player.inventory).toHaveLength(0);
    expect(player.antiPerks).toContain("jammed-dice");
  });

  it("applies stored perk item to self and consumes it", () => {
    const stored = selectPerk(
      withPendingSelection(createInitialGameState(makeConfig()), "loaded-dice"),
      "loaded-dice",
      { applyDirectly: false }
    );
    const playerBefore = stored.players[stored.currentPlayerIndex]!;
    const itemId = playerBefore.inventory[0]?.itemId;
    if (!itemId) throw new Error("Missing inventory item");

    const next = applyInventoryItemToSelf(stored, { playerId: playerBefore.id, itemId });
    const playerAfter = next.players[next.currentPlayerIndex]!;

    expect(playerAfter.inventory).toHaveLength(0);
    expect(playerAfter.stats.diceMax).toBe(8);
  });

  it("consumes inventory item without applying effects", () => {
    const initial = createInitialGameState(makeConfig());
    const withMoney: GameState = {
      ...initial,
      players: initial.players.map((player) => ({ ...player, money: 500 })),
    };
    const stored = selectPerk(withPendingSelection(withMoney, "jammed-dice"), "jammed-dice", {
      applyDirectly: false,
    });
    const playerBefore = stored.players[stored.currentPlayerIndex]!;
    const itemId = playerBefore.inventory[0]?.itemId;
    if (!itemId) throw new Error("Missing inventory item");

    const next = consumeInventoryItem(stored, {
      playerId: playerBefore.id,
      itemId,
      reason: "Sent anti-perk.",
    });
    const playerAfter = next.players[next.currentPlayerIndex]!;

    expect(playerAfter.inventory).toHaveLength(0);
  });

  it("includes anti-perks in multiplayer perk choices when enabled", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    const config = makeConfig();
    const state = createInitialGameState({
      ...config,
      perkSelection: {
        ...config.perkSelection,
        triggerChancePerCompletedRound: 1,
        includeAntiPerksInChoices: true,
      },
    });

    const withActiveRound: GameState = {
      ...state,
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

    const next = completeRound(withActiveRound, undefined, []);
    const optionIds = new Set(next.pendingPerkSelection?.options.map((option) => option.id) ?? []);

    expect(optionIds.has("loaded-dice")).toBe(true);
    expect(optionIds.has("jammed-dice")).toBe(true);
  });

  it("does not purchase a perk when money is insufficient and logs the failure", () => {
    const base = withPendingSelection(createInitialGameState(makeConfig()), "steady-steps");
    const next = selectPerk(base, "steady-steps", { applyDirectly: true });
    const player = next.players[next.currentPlayerIndex]!;

    expect(player.money).toBe(120);
    expect(player.inventory).toHaveLength(0);
    expect(player.activePerkEffects).toHaveLength(0);
    expect(next.pendingPerkSelection).not.toBeNull();
    expect(next.log[0]).toContain("Not enough money");
    expect(next.log[0]).toContain("Need $180");
  });
});
