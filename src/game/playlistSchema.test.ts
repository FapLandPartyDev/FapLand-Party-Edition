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
      maxIntermediaryProbability: 0.85,
      maxAntiPerkProbability: 0.75,
    },
    economy: {
      startingMoney: 120,
      moneyPerCompletedRound: 50,
      startingScore: 0,
      scorePerCompletedRound: 100,
      scorePerIntermediary: 30,
      scorePerActiveAntiPerk: 25,
      scorePerCumRoundSuccess: 120,
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

    expect(parsed.economy.scorePerCumRoundSuccess).toBe(120);
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
});
