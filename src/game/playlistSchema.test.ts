import { describe, expect, it } from "vitest";
import {
  CURRENT_PLAYLIST_VERSION,
  PLAYLIST_FILE_FORMAT,
  PLAYLIST_FILE_VERSION,
  ZPlaylistConfig,
  ZPlaylistEnvelopeV1,
} from "./playlistSchema";
import { toGameConfigFromPlaylist } from "./playlistRuntime";
import { toEditorGraphConfig, toGraphBoardConfig } from "../features/map-editor/EditorState";
import type { InstalledRound } from "../services/db";

function buildConfig(boardConfig: unknown): Record<string, unknown> {
  return {
    boardConfig,
    perkSelection: {
      optionsPerPick: 3,
      triggerChancePerCompletedRound: 0.35,
    },
    perkPool: {
      enabledPerkIds: [],
      enabledAntiPerkIds: [],
    },
    probabilityScaling: {
      initialIntermediaryProbability: 0,
      initialAntiPerkProbability: 0,
      intermediaryIncreasePerRound: 0.02,
      antiPerkIncreasePerRound: 0.015,
      maxIntermediaryProbability: 1,
      maxAntiPerkProbability: 0.75,
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
  };
}

function makeRound(id: string, name: string, type: InstalledRound["type"] = "Normal"): InstalledRound {
  const now = new Date("2026-01-01T00:00:00.000Z");
  return {
    id,
    name,
    author: "Author",
    description: null,
    bpm: null,
    difficulty: null,
    phash: null,
    startTime: null,
    endTime: null,
    installSourceKey: null,
    previewImage: null,
    type,
    heroId: null,
    createdAt: now,
    updatedAt: now,
    hero: null,
    resources: [],
  };
}

describe("playlistSchema", () => {
  it("defaults playlistVersion to current version", () => {
    const parsed = ZPlaylistConfig.parse(
      buildConfig({
        mode: "linear",
        totalIndices: 10,
        safePointIndices: [3, 6],
        normalRoundRefsByIndex: {},
        normalRoundOrder: [],
        cumRoundRefs: [],
      }),
    );

    expect(parsed.playlistVersion).toBe(CURRENT_PLAYLIST_VERSION);
    expect(parsed.saveMode).toBe("none");
    expect(parsed.boardConfig.mode).toBe("linear");
  });

  it("rejects unsupported future playlistVersion", () => {
    const result = ZPlaylistConfig.safeParse({
      ...buildConfig({
        mode: "linear",
        totalIndices: 10,
        safePointIndices: [],
        normalRoundRefsByIndex: {},
        normalRoundOrder: [],
        cumRoundRefs: [],
      }),
      playlistVersion: CURRENT_PLAYLIST_VERSION + 1,
    });

    expect(result.success).toBe(false);
  });

  it("validates graph invariants", () => {
    const missingStart = ZPlaylistConfig.safeParse(
      buildConfig({
        mode: "graph",
        startNodeId: "start",
        nodes: [{ id: "n1", name: "Node", kind: "path" }],
        edges: [],
        randomRoundPools: [],
        cumRoundRefs: [],
        pathChoiceTimeoutMs: 6000,
      }),
    );
    expect(missingStart.success).toBe(false);

    const badEdgeRef = ZPlaylistConfig.safeParse(
      buildConfig({
        mode: "graph",
        startNodeId: "start",
        nodes: [
          { id: "start", name: "Start", kind: "start" },
          { id: "end", name: "End", kind: "end" },
        ],
        edges: [{ id: "e1", fromNodeId: "start", toNodeId: "missing" }],
        randomRoundPools: [],
        cumRoundRefs: [],
        pathChoiceTimeoutMs: 6000,
      }),
    );
    expect(badEdgeRef.success).toBe(false);
  });

  it("allows random round nodes without random pools", () => {
    const parsed = ZPlaylistConfig.safeParse(
      buildConfig({
        mode: "graph",
        startNodeId: "start",
        nodes: [
          { id: "start", name: "Start", kind: "start" },
          { id: "random-1", name: "Random", kind: "randomRound" },
          { id: "end", name: "End", kind: "end" },
        ],
        edges: [
          { id: "edge-a", fromNodeId: "start", toNodeId: "random-1" },
          { id: "edge-b", fromNodeId: "random-1", toNodeId: "end" },
        ],
        randomRoundPools: [],
        cumRoundRefs: [],
        pathChoiceTimeoutMs: 6000,
      }),
    );

    expect(parsed.success).toBe(true);
  });

  it("requires graph end nodes and forbids non-end dead ends", () => {
    const missingEnd = ZPlaylistConfig.safeParse(
      buildConfig({
        mode: "graph",
        startNodeId: "start",
        nodes: [
          { id: "start", name: "Start", kind: "start" },
          { id: "path-1", name: "Path", kind: "path" },
        ],
        edges: [{ id: "edge-a", fromNodeId: "start", toNodeId: "path-1" }],
        randomRoundPools: [],
        cumRoundRefs: [],
        pathChoiceTimeoutMs: 6000,
      }),
    );
    expect(missingEnd.success).toBe(false);

    const valid = ZPlaylistConfig.safeParse(
      buildConfig({
        mode: "graph",
        startNodeId: "start",
        nodes: [
          { id: "start", name: "Start", kind: "start" },
          { id: "end", name: "End", kind: "end" },
        ],
        edges: [{ id: "edge-a", fromNodeId: "start", toNodeId: "end" }],
        randomRoundPools: [],
        cumRoundRefs: [{ idHint: "cum-1", name: "Cum 1", type: "Cum" }],
        pathChoiceTimeoutMs: 6000,
      }),
    );
    expect(valid.success).toBe(true);
    if (valid.success && valid.data.boardConfig.mode === "graph") {
      expect(valid.data.boardConfig.cumRoundRefs).toHaveLength(1);
    }
  });

  it("parses export envelope with versioned config", () => {
    const envelope = ZPlaylistEnvelopeV1.parse({
      format: PLAYLIST_FILE_FORMAT,
      version: PLAYLIST_FILE_VERSION,
      metadata: {
        name: "My Playlist",
      },
      config: buildConfig({
        mode: "linear",
        totalIndices: 12,
        safePointIndices: [4, 8],
        normalRoundRefsByIndex: {},
        normalRoundOrder: [],
        cumRoundRefs: [],
      }),
    });

    expect(envelope.config.playlistVersion).toBe(CURRENT_PLAYLIST_VERSION);
    expect(envelope.config.boardConfig.mode).toBe("linear");
  });

  it("builds linear playlists with an explicit terminal end node", () => {
    const parsed = ZPlaylistConfig.parse(
      buildConfig({
        mode: "linear",
        totalIndices: 3,
        safePointIndices: [],
        safePointRestMsByIndex: {},
        normalRoundRefsByIndex: {},
        normalRoundOrder: [{ idHint: "round-1", name: "Round 1", type: "Normal" }],
        cumRoundRefs: [],
      }),
    );

    const config = toGameConfigFromPlaylist(parsed, [makeRound("round-1", "Round 1")]);
    expect(config.board.at(-1)?.id).toBe("end");
    expect(config.board.at(-1)?.kind).toBe("end");
    expect(config.runtimeGraph.edges.at(-1)?.toNodeId).toBe("end");
    expect(config.singlePlayer.totalIndices).toBe(3);
  });

  it("defaults cum bonus score when omitted", () => {
    const parsed = ZPlaylistConfig.parse({
      ...buildConfig({
        mode: "linear",
        totalIndices: 8,
        safePointIndices: [],
        normalRoundRefsByIndex: {},
        normalRoundOrder: [],
        cumRoundRefs: [],
      }),
      economy: {
        startingMoney: 120,
        moneyPerCompletedRound: 50,
        startingScore: 0,
        scorePerCompletedRound: 100,
        scorePerIntermediary: 30,
        scorePerActiveAntiPerk: 25,
      },
    });

    expect(parsed.economy.scorePerCumRoundSuccess).toBe(420);
  });

  it("converts graph cum round refs into runtime cum round ids", () => {
    const parsed = ZPlaylistConfig.parse(
      buildConfig({
        mode: "graph",
        startNodeId: "start",
        nodes: [
          { id: "start", name: "Start", kind: "start" },
          { id: "end", name: "End", kind: "end" },
        ],
        edges: [{ id: "edge-a", fromNodeId: "start", toNodeId: "end" }],
        randomRoundPools: [],
        cumRoundRefs: [{ idHint: "cum-1", name: "Cum 1", type: "Cum" }],
        pathChoiceTimeoutMs: 6000,
      }),
    );

    const config = toGameConfigFromPlaylist(parsed, [makeRound("cum-1", "Cum 1", "Cum")]);
    expect(config.singlePlayer.cumRoundIds).toEqual(["cum-1"]);
    expect(config.board.find((field) => field.id === "end")?.kind).toBe("end");
  });

  it("parses and round-trips forced-stop round nodes", () => {
    const parsed = ZPlaylistConfig.parse(
      buildConfig({
        mode: "graph",
        startNodeId: "start",
        nodes: [
          { id: "start", name: "Start", kind: "start" },
          { id: "round-1", name: "Round 1", kind: "round", roundRef: { idHint: "round-1", name: "Round 1" }, forceStop: true },
          { id: "end", name: "End", kind: "end" },
        ],
        edges: [
          { id: "edge-a", fromNodeId: "start", toNodeId: "round-1" },
          { id: "edge-b", fromNodeId: "round-1", toNodeId: "end" },
        ],
        randomRoundPools: [],
        cumRoundRefs: [],
        pathChoiceTimeoutMs: 6000,
      }),
    );

    expect(parsed.boardConfig.mode).toBe("graph");
    if (parsed.boardConfig.mode !== "graph") {
      throw new Error("Expected graph board config");
    }

    expect(parsed.boardConfig.nodes.find((node) => node.id === "round-1")?.forceStop).toBe(true);

    const editorConfig = toEditorGraphConfig(parsed.boardConfig);
    const roundTripped = toGraphBoardConfig(editorConfig);
    expect(roundTripped.nodes.find((node) => node.id === "round-1")?.forceStop).toBe(true);
  });

  it("parses and round-trips perk node force-stop and guaranteed gift settings", () => {
    const parsed = ZPlaylistConfig.parse(
      buildConfig({
        mode: "graph",
        startNodeId: "start",
        nodes: [
          { id: "start", name: "Start", kind: "start" },
          { id: "perk-1", name: "Perk 1", kind: "perk", forceStop: true, visualId: "loaded-dice", giftGuaranteedPerk: true },
          { id: "end", name: "End", kind: "end" },
        ],
        edges: [
          { id: "edge-a", fromNodeId: "start", toNodeId: "perk-1" },
          { id: "edge-b", fromNodeId: "perk-1", toNodeId: "end" },
        ],
        randomRoundPools: [],
        cumRoundRefs: [],
        pathChoiceTimeoutMs: 6000,
      }),
    );

    expect(parsed.boardConfig.mode).toBe("graph");
    if (parsed.boardConfig.mode !== "graph") {
      throw new Error("Expected graph board config");
    }

    const perkNode = parsed.boardConfig.nodes.find((node) => node.id === "perk-1");
    expect(perkNode?.forceStop).toBe(true);
    expect(perkNode?.giftGuaranteedPerk).toBe(true);

    const editorConfig = toEditorGraphConfig(parsed.boardConfig);
    const roundTripped = toGraphBoardConfig(editorConfig);
    expect(roundTripped.nodes.find((node) => node.id === "perk-1")?.forceStop).toBe(true);
    expect(roundTripped.nodes.find((node) => node.id === "perk-1")?.giftGuaranteedPerk).toBe(true);
  });

  it("parses and round-trips skippable round nodes", () => {
    const parsed = ZPlaylistConfig.parse(
      buildConfig({
        mode: "graph",
        startNodeId: "start",
        nodes: [
          { id: "start", name: "Start", kind: "start" },
          { id: "round-1", name: "Round 1", kind: "round", roundRef: { idHint: "round-1", name: "Round 1" }, skippable: true },
          { id: "end", name: "End", kind: "end" },
        ],
        edges: [
          { id: "edge-a", fromNodeId: "start", toNodeId: "round-1" },
          { id: "edge-b", fromNodeId: "round-1", toNodeId: "end" },
        ],
        randomRoundPools: [],
        cumRoundRefs: [],
        pathChoiceTimeoutMs: 6000,
      }),
    );

    expect(parsed.boardConfig.mode).toBe("graph");
    if (parsed.boardConfig.mode !== "graph") {
      throw new Error("Expected graph board config");
    }

    expect(parsed.boardConfig.nodes.find((node) => node.id === "round-1")?.skippable).toBe(true);

    const editorConfig = toEditorGraphConfig(parsed.boardConfig);
    const roundTripped = toGraphBoardConfig(editorConfig);
    expect(roundTripped.nodes.find((node) => node.id === "round-1")?.skippable).toBe(true);
  });

  it("parses and round-trips node color and size style hints", () => {
    const parsed = ZPlaylistConfig.parse(
      buildConfig({
        mode: "graph",
        startNodeId: "start",
        nodes: [
          { id: "start", name: "Start", kind: "start", styleHint: { x: 10, y: 20, color: "#10b981", size: 1.8 } },
          { id: "end", name: "End", kind: "end", styleHint: { x: 30, y: 40 } },
        ],
        edges: [{ id: "edge-a", fromNodeId: "start", toNodeId: "end" }],
        randomRoundPools: [],
        cumRoundRefs: [],
        pathChoiceTimeoutMs: 6000,
      }),
    );

    expect(parsed.boardConfig.mode).toBe("graph");
    if (parsed.boardConfig.mode !== "graph") {
      throw new Error("Expected graph board config");
    }

    const editorConfig = toEditorGraphConfig(parsed.boardConfig);
    expect(editorConfig.nodes.find((node) => node.id === "start")?.styleHint?.color).toBe("#10b981");
    expect(editorConfig.nodes.find((node) => node.id === "start")?.styleHint?.size).toBe(1.8);

    const roundTripped = toGraphBoardConfig(editorConfig);
    expect(roundTripped.nodes.find((node) => node.id === "start")?.styleHint?.color).toBe("#10b981");
    expect(roundTripped.nodes.find((node) => node.id === "start")?.styleHint?.size).toBe(1.8);

    const runtimeConfig = toGameConfigFromPlaylist(parsed, []);
    expect(runtimeConfig.board.find((node) => node.id === "start")?.styleHint?.color).toBe("#10b981");
    expect(runtimeConfig.board.find((node) => node.id === "start")?.styleHint?.size).toBe(1.8);
  });

  it("copies forced-stop round nodes into runtime board fields", () => {
    const parsed = ZPlaylistConfig.parse(
      buildConfig({
        mode: "graph",
        startNodeId: "start",
        nodes: [
          { id: "start", name: "Start", kind: "start" },
          { id: "round-1", name: "Round 1", kind: "round", roundRef: { idHint: "round-1", name: "Round 1" }, forceStop: true },
          { id: "end", name: "End", kind: "end" },
        ],
        edges: [
          { id: "edge-a", fromNodeId: "start", toNodeId: "round-1" },
          { id: "edge-b", fromNodeId: "round-1", toNodeId: "end" },
        ],
        randomRoundPools: [],
        cumRoundRefs: [],
        pathChoiceTimeoutMs: 6000,
      }),
    );

    const config = toGameConfigFromPlaylist(parsed, [makeRound("round-1", "Round 1")]);
    expect(config.board.find((field) => field.id === "round-1")?.forceStop).toBe(true);
  });

  it("copies perk node force-stop and guaranteed gift settings into runtime board fields", () => {
    const parsed = ZPlaylistConfig.parse(
      buildConfig({
        mode: "graph",
        startNodeId: "start",
        nodes: [
          { id: "start", name: "Start", kind: "start" },
          { id: "perk-1", name: "Perk 1", kind: "perk", forceStop: true, visualId: "loaded-dice", giftGuaranteedPerk: true },
          { id: "end", name: "End", kind: "end" },
        ],
        edges: [
          { id: "edge-a", fromNodeId: "start", toNodeId: "perk-1" },
          { id: "edge-b", fromNodeId: "perk-1", toNodeId: "end" },
        ],
        randomRoundPools: [],
        cumRoundRefs: [],
        pathChoiceTimeoutMs: 6000,
      }),
    );

    const config = toGameConfigFromPlaylist(parsed, [makeRound("round-1", "Round 1")]);
    const perkField = config.board.find((field) => field.id === "perk-1");
    expect(perkField?.forceStop).toBe(true);
    expect(perkField?.giftGuaranteedPerk).toBe(true);
  });

  it("copies skippable round nodes into runtime board fields", () => {
    const parsed = ZPlaylistConfig.parse(
      buildConfig({
        mode: "graph",
        startNodeId: "start",
        nodes: [
          { id: "start", name: "Start", kind: "start" },
          { id: "round-1", name: "Round 1", kind: "round", roundRef: { idHint: "round-1", name: "Round 1" }, skippable: true },
          { id: "end", name: "End", kind: "end" },
        ],
        edges: [
          { id: "edge-a", fromNodeId: "start", toNodeId: "round-1" },
          { id: "edge-b", fromNodeId: "round-1", toNodeId: "end" },
        ],
        randomRoundPools: [],
        cumRoundRefs: [],
        pathChoiceTimeoutMs: 6000,
      }),
    );

    const config = toGameConfigFromPlaylist(parsed, [makeRound("round-1", "Round 1")]);
    expect(config.board.find((field) => field.id === "round-1")?.skippable).toBe(true);
  });

  it("parses and defaults dice configuration", () => {
    const parsed = ZPlaylistConfig.parse(
      buildConfig({
        mode: "linear",
        totalIndices: 10,
        safePointIndices: [],
        normalRoundRefsByIndex: {},
        normalRoundOrder: [],
        cumRoundRefs: [],
      }),
    );

    expect(parsed.dice).toEqual({ min: 1, max: 6 });

    const withDice = ZPlaylistConfig.parse({
      ...buildConfig({
        mode: "linear",
        totalIndices: 10,
        safePointIndices: [],
        normalRoundRefsByIndex: {},
        normalRoundOrder: [],
        cumRoundRefs: [],
      }),
      dice: { min: 2, max: 12 },
    });
    expect(withDice.dice).toEqual({ min: 2, max: 12 });

    const invalidDice = ZPlaylistConfig.safeParse({
      ...buildConfig({
        mode: "linear",
        totalIndices: 10,
        safePointIndices: [],
        normalRoundRefsByIndex: {},
        normalRoundOrder: [],
        cumRoundRefs: [],
      }),
      dice: { min: 10, max: 5 },
    });
    expect(invalidDice.success).toBe(false);
  });
});
