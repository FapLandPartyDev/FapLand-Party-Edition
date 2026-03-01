import type { BoardField, GameConfig } from "../types";
import type { SinglePlayerSessionPlan } from "../singlePlayerSetup";

function createCampaignBoard(plan: SinglePlayerSessionPlan): BoardField[] {
  const safeSet = new Set(plan.safePointIndices);
  const board: BoardField[] = [{ id: "start", name: "Start", kind: "start" }];

  for (let index = 1; index <= plan.totalIndices; index += 1) {
    if (safeSet.has(index)) {
      board.push({
        id: `safe-${index}`,
        name: `Safe Point ${index}`,
        kind: "safePoint",
      });
      continue;
    }

    board.push({
      id: `round-${index}`,
      name: index === plan.totalIndices ? `Final Round ${index}` : `Round ${index}`,
      kind: "round",
      fixedRoundId: plan.normalRoundIdsByIndex[index],
    });
  }

  board.push({
    id: "end",
    name: "End",
    kind: "end",
  });

  return board;
}

export function createSinglePlayerGameConfig(
  plan: SinglePlayerSessionPlan,
  economyOverrides?: Partial<GameConfig["economy"]>
): GameConfig {
  const defaultEconomy: GameConfig["economy"] = {
    startingMoney: 120,
    moneyPerCompletedRound: 50,
    startingScore: 0,
    scorePerCompletedRound: 100,
    scorePerIntermediary: 30,
    scorePerActiveAntiPerk: 25,
    scorePerCumRoundSuccess: 420,
  };

  const economy: GameConfig["economy"] = {
    ...defaultEconomy,
    ...economyOverrides,
  };
  const board = createCampaignBoard(plan);
  const edges = board.slice(0, -1).map((field, index) => ({
    id: `edge-${field.id}-${board[index + 1]?.id ?? "end"}`,
    fromNodeId: field.id,
    toNodeId: board[index + 1]?.id ?? field.id,
    gateCost: 0,
    weight: 1,
  }));
  const nodeIndexById = board.reduce<Record<string, number>>((acc, field, index) => {
    acc[field.id] = index;
    return acc;
  }, {});
  const edgesById = edges.reduce<Record<string, (typeof edges)[number]>>((acc, edge) => {
    acc[edge.id] = edge;
    return acc;
  }, {});
  const outgoingEdgeIdsByNodeId = edges.reduce<Record<string, string[]>>((acc, edge) => {
    acc[edge.fromNodeId] = [...(acc[edge.fromNodeId] ?? []), edge.id];
    return acc;
  }, {});

  return {
    board,
    runtimeGraph: {
      startNodeId: "start",
      pathChoiceTimeoutMs: 12000,
      edges,
      edgesById,
      outgoingEdgeIdsByNodeId,
      randomRoundPoolsById: {},
      nodeIndexById,
    },
    dice: {
      min: 1,
      max: 6,
    },
    perkSelection: {
      optionsPerPick: 3,
      triggerChancePerCompletedRound: plan.perkTriggerChancePerRound,
    },
    perkPool: {
      enabledPerkIds: [...plan.enabledPerkIds],
      enabledAntiPerkIds: [...plan.enabledAntiPerkIds],
    },
    probabilityScaling: {
      initialIntermediaryProbability: plan.probabilities.intermediary.initial,
      initialAntiPerkProbability: plan.probabilities.antiPerk.initial,
      intermediaryIncreasePerRound: plan.probabilities.intermediary.increasePerRound,
      antiPerkIncreasePerRound: plan.probabilities.antiPerk.increasePerRound,
      maxIntermediaryProbability: plan.probabilities.intermediary.max,
      maxAntiPerkProbability: plan.probabilities.antiPerk.max,
    },
    singlePlayer: {
      totalIndices: plan.totalIndices,
      safePointIndices: [...plan.safePointIndices],
      normalRoundIdsByIndex: { ...plan.normalRoundIdsByIndex },
      cumRoundIds: [...plan.cumRoundIds],
    },
    economy,
    roundStartDelayMs: 20000,
  };
}
