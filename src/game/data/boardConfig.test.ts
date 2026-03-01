import { describe, expect, it } from "vitest";
import { createSinglePlayerGameConfig } from "./boardConfig";
import type { SinglePlayerSessionPlan } from "../singlePlayerSetup";

function makePlan(overrides?: Partial<SinglePlayerSessionPlan>): SinglePlayerSessionPlan {
  return {
    totalIndices: 3,
    safePointIndices: [],
    normalRoundIdsByIndex: {
      1: "round-1",
      2: "round-2",
      3: "round-3",
    },
    cumRoundIds: [],
    enabledPerkIds: [],
    enabledAntiPerkIds: [],
    perkTriggerChancePerRound: 0.35,
    probabilities: {
      intermediary: {
        initial: 0.1,
        increasePerRound: 0.02,
        max: 1,
      },
      antiPerk: {
        initial: 0.1,
        increasePerRound: 0.015,
        max: 0.75,
      },
    },
    ...overrides,
  };
}

describe("createSinglePlayerGameConfig", () => {
  it("adds an explicit end node after the final board index", () => {
    const config = createSinglePlayerGameConfig(makePlan());

    expect(config.board.map((field) => field.id)).toEqual([
      "start",
      "round-1",
      "round-2",
      "round-3",
      "end",
    ]);
    expect(config.board.at(-1)?.kind).toBe("end");
    expect(config.runtimeGraph.edges.at(-1)?.fromNodeId).toBe("round-3");
    expect(config.runtimeGraph.edges.at(-1)?.toNodeId).toBe("end");
  });
});
