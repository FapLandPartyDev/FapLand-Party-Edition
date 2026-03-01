import { describe, expect, it } from "vitest";
import type { PlaylistConfig } from "../../game/playlistSchema";
import type { EditorGraphConfig } from "./EditorState";
import { buildMapEditorTestConfig } from "./buildMapEditorTestConfig";
import { ZMapEditorDraftSnapshot } from "./mapEditorDraft";

const makeEditorConfig = (): EditorGraphConfig => ({
  mode: "graph",
  startNodeId: "start",
  nodes: [
    { id: "start", name: "Start", kind: "start", styleHint: { x: 0, y: 0 } },
    { id: "path", name: "Work in progress", kind: "path", styleHint: { x: 200, y: 0 } },
    { id: "unused", name: "Later", kind: "path", styleHint: { x: 0, y: 200 } },
  ],
  edges: [{ id: "start-path", fromNodeId: "start", toNodeId: "path", gateCost: 0, weight: 1 }],
  textAnnotations: [],
  randomRoundPools: [],
  cumRoundRefs: [],
  pathChoiceTimeoutMs: 12000,
  perkSelection: { optionsPerPick: 3, triggerChancePerCompletedRound: 0.35 },
  perkPool: { enabledPerkIds: [], enabledAntiPerkIds: [] },
  intermediarySelection: { minPerTriggeredRound: 1, maxPerTriggeredRound: 1 },
  probabilityScaling: {
    initialIntermediaryProbability: 0.1,
    initialAntiPerkProbability: 0.1,
    intermediaryIncreasePerRound: 0.02,
    antiPerkIncreasePerRound: 0.02,
    maxIntermediaryProbability: 1,
    maxAntiPerkProbability: 1,
    resetIntermediaryProbabilityAfterTrigger: false,
    resetAntiPerkProbabilityAfterTrigger: false,
  },
  resetIntermediaryProbabilityAfterTrigger: false,
  resetAntiPerkProbabilityAfterTrigger: false,
  economy: { startingMoney: 0, scorePerCumRoundSuccess: 0 },
  dice: { min: 1, max: 6 },
  disableDiceAnimation: false,
  disableInterjectionsDuringCumRounds: false,
  allowPausingDuringFinalCumRound: true,
  saveMode: "none",
  requiredLevel: 1,
  style: {},
  music: { tracks: [], loop: true },
  automations: [],
});

const makePlaylistConfig = (editor: EditorGraphConfig): PlaylistConfig => ({
  playlistVersion: 1,
  boardConfig: {
    mode: "graph",
    startNodeId: "start",
    nodes: [
      { id: "start", name: "Start", kind: "start" },
      { id: "end", name: "End", kind: "end" },
    ],
    edges: [{ id: "edge", fromNodeId: "start", toNodeId: "end", gateCost: 0, weight: 1 }],
    textAnnotations: [],
    randomRoundPools: [],
    cumRoundRefs: [],
    pathChoiceTimeoutMs: 12000,
  },
  perkSelection: editor.perkSelection,
  perkPool: editor.perkPool,
  intermediarySelection: editor.intermediarySelection,
  probabilityScaling: editor.probabilityScaling,
  economy: {
    startingMoney: 0,
    moneyPerCompletedRound: 0,
    startingScore: 0,
    scorePerCompletedRound: 0,
    scorePerIntermediary: 0,
    scorePerActiveAntiPerk: 0,
    scorePerCumRoundSuccess: 0,
  },
  dice: editor.dice,
  saveMode: "none",
  requiredLevel: 1,
  roundStartDelayMs: 0,
  disableDiceAnimation: false,
  disableInterjectionsDuringCumRounds: editor.disableInterjectionsDuringCumRounds ?? true,
  allowPausingDuringFinalCumRound: editor.allowPausingDuringFinalCumRound,
});

describe("map editor drafts", () => {
  it("accepts an incomplete graph snapshot", () => {
    const config = makeEditorConfig();
    expect(
      ZMapEditorDraftSnapshot.safeParse({
        version: 1,
        name: "Unfinished",
        config,
        viewport: { x: 0, y: 0, zoom: 1 },
        showGrid: true,
        snapToGrid: true,
        sidebar: {
          activeTab: "heroes",
          activeCategory: "all",
          tileSearch: "",
          roundSearch: "",
          roundTypeFilter: "all",
          roundSort: "name",
          heroSearch: "demo",
          heroSort: "roundCount",
        },
      }).success
    ).toBe(true);
  });

  it("rejects malformed graph fields without enforcing playability", () => {
    const config = makeEditorConfig();
    config.nodes[0] = { ...config.nodes[0], styleHint: { x: Number.NaN, y: 0 } };
    expect(
      ZMapEditorDraftSnapshot.safeParse({
        version: 1,
        name: "Malformed",
        config,
        viewport: { x: 0, y: 0, zoom: 1 },
        showGrid: true,
        snapToGrid: true,
        sidebar: {
          activeTab: "tiles",
          activeCategory: "all",
          tileSearch: "",
          roundSearch: "",
          roundTypeFilter: "all",
          roundSort: "name",
          heroSearch: "",
          heroSort: "name",
        },
      }).success
    ).toBe(false);
  });

  it("builds a transient test graph without mutating the unfinished draft", () => {
    const config = makeEditorConfig();
    const original = structuredClone(config);
    const result = buildMapEditorTestConfig(config, makePlaylistConfig(config), []);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.repair.omittedNodeCount).toBe(1);
    expect(result.repair.temporaryExitCount).toBe(1);
    expect(result.config.boardConfig.mode).toBe("graph");
    expect(result.config.disableInterjectionsDuringCumRounds).toBe(false);
    expect(result.config.allowPausingDuringFinalCumRound).toBe(true);
    expect(config).toEqual(original);
  });

  it("retains previous nodes while testing from a selected node", () => {
    const config = makeEditorConfig();
    const result = buildMapEditorTestConfig(config, makePlaylistConfig(config), [], "unused");

    expect(result.ok).toBe(true);
    if (!result.ok || result.config.boardConfig.mode !== "graph") return;
    expect(result.config.boardConfig.startNodeId).toBe("start");
    expect(result.config.boardConfig.nodes.map((node) => node.id)).toEqual(
      expect.arrayContaining(["start", "path", "unused"])
    );
    expect(
      result.config.boardConfig.edges.some(
        (edge) => edge.fromNodeId === "start" && edge.toNodeId === "path"
      )
    ).toBe(true);
    expect(result.repair.omittedNodeCount).toBe(0);
  });
});
