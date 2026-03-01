import { describe, expect, it } from "vitest";
import { createInitialGameState } from "../engine";
import type { GameConfig } from "../types";
import { enqueueAutomationTestEvent } from "./testHelpers";
import { runAutomationPass } from "./execute";
import { applyGraphMutationAction } from "./graphMutations";

function makeConfig(): GameConfig {
  return {
    board: [
      { id: "start", name: "Start", kind: "start" },
      { id: "event-1", name: "Event 1", kind: "event" },
      { id: "end", name: "End", kind: "end" },
    ],
    mapTextAnnotations: [],
    mapStyle: undefined,
    runtimeGraph: {
      startNodeId: "start",
      pathChoiceTimeoutMs: 6000,
      edges: [
        { id: "edge-a", fromNodeId: "start", toNodeId: "event-1", gateCost: 0, weight: 1 },
        { id: "edge-b", fromNodeId: "event-1", toNodeId: "end", gateCost: 0, weight: 1 },
      ],
      edgesById: {
        "edge-a": {
          id: "edge-a",
          fromNodeId: "start",
          toNodeId: "event-1",
          gateCost: 0,
          weight: 1,
        },
        "edge-b": { id: "edge-b", fromNodeId: "event-1", toNodeId: "end", gateCost: 0, weight: 1 },
      },
      outgoingEdgeIdsByNodeId: {
        start: ["edge-a"],
        "event-1": ["edge-b"],
      },
      randomRoundPoolsById: {},
      nodeIndexById: {
        start: 0,
        "event-1": 1,
        end: 2,
      },
    },
    dice: { min: 1, max: 6 },
    perkSelection: {
      optionsPerPick: 3,
      triggerChancePerCompletedRound: 0.35,
    },
    perkPool: {
      enabledPerkIds: [],
      enabledAntiPerkIds: [],
    },
    probabilityScaling: {
      initialIntermediaryProbability: 0.1,
      initialAntiPerkProbability: 0.1,
      intermediaryIncreasePerRound: 0.02,
      antiPerkIncreasePerRound: 0.015,
      maxIntermediaryProbability: 1,
      maxAntiPerkProbability: 0.75,
    },
    singlePlayer: {
      totalIndices: 2,
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
    disableDiceAnimation: false,
    playlistMusic: {
      tracks: [{ id: "track-1", uri: "app://media/one.mp3", name: "One" }],
      loop: true,
    },
    automations: [
      {
        id: "rule-1",
        name: "Pause on enter",
        enabled: true,
        scope: { kind: "node", nodeId: "event-1" },
        trigger: { kind: "node.enter", nodeId: "event-1" },
        conditions: {
          operator: "all",
          conditions: [],
        },
        actions: [{ id: "step-1", action: { kind: "timer.pauseRest" } }],
        cooldownMs: 0,
        stopAfterMatch: false,
      },
    ],
  };
}

describe("automation.execute", () => {
  it("runs matching node enter rules", () => {
    const initial = createInitialGameState(makeConfig());
    const queued = enqueueAutomationTestEvent(initial, {
      kind: "node.enter",
      nodeId: "event-1",
      playerId: "p1",
    });
    const next = runAutomationPass(queued);
    expect(next.restTimerPaused).toBe(true);
  });

  it("applies music play-track actions", () => {
    const initial = createInitialGameState({
      ...makeConfig(),
      automations: [
        {
          id: "rule-2",
          name: "Track swap",
          enabled: true,
          scope: { kind: "global" },
          trigger: { kind: "session.timer", timer: "turnStarted" },
          conditions: {
            operator: "all",
            conditions: [],
          },
          actions: [{ id: "step-1", action: { kind: "music.playTrack", trackId: "track-1" } }],
          cooldownMs: 0,
          stopAfterMatch: false,
        },
      ],
    });
    const queued = enqueueAutomationTestEvent(initial, {
      kind: "session.timer",
      timer: "turnStarted",
      playerId: "p1",
      nodeId: "start",
    });
    const next = runAutomationPass(queued);
    expect(next.runtimeMusicState.currentTrackId).toBe("track-1");
    expect(next.runtimeMusicState.isPlaying).toBe(true);
  });

  it("rejects graph edge patches that would reference missing nodes", () => {
    const initial = createInitialGameState(makeConfig());

    const result = applyGraphMutationAction(initial, {
      kind: "graph.patchEdge",
      edgeId: "edge-a",
      patch: { toNodeId: "missing-node" },
    });

    expect(result.ok).toBe(false);
    expect(result.state.config.runtimeGraph.edgesById["edge-a"]?.toNodeId).toBe("event-1");
  });

  it("rejects removing an active graph node when the fallback is missing", () => {
    const initial = createInitialGameState(makeConfig());
    const onEventNode = {
      ...initial,
      players: initial.players.map((player) =>
        player.id === "p1" ? { ...player, currentNodeId: "event-1", position: 1 } : player
      ),
    };

    const result = applyGraphMutationAction(onEventNode, {
      kind: "graph.removeNode",
      nodeId: "event-1",
      fallbackNodeId: "missing-node",
    });

    expect(result.ok).toBe(false);
    expect(result.state.players[0]?.currentNodeId).toBe("event-1");
    expect(result.state.config.board.some((node) => node.id === "event-1")).toBe(true);
  });
});
