import { describe, expect, it } from "vitest";
import {
  analyzePlaylistResolution,
  applyPlaylistResolutionMapping,
  collectPlaylistRefs,
  createPortableRoundRefResolver,
  resolvePortableRoundRefExact,
  type PlaylistResolutionRoundLike,
} from "./playlistResolution";
import { type PlaylistConfig } from "./playlistSchema";

function makeRound(
  input: Partial<PlaylistResolutionRoundLike> & Pick<PlaylistResolutionRoundLike, "id" | "name">
): PlaylistResolutionRoundLike {
  return {
    id: input.id,
    name: input.name,
    author: input.author ?? null,
    type: input.type ?? "Normal",
    difficulty: input.difficulty ?? null,
    phash: input.phash ?? null,
    installSourceKey: input.installSourceKey ?? null,
    resources: input.resources ?? [],
  };
}

function makeLinearConfig(): PlaylistConfig {
  return {
    playlistVersion: 1,
    boardConfig: {
      mode: "linear",
      totalIndices: 3,
      safePointIndices: [],
      safePointRestMsByIndex: {},
      normalRoundRefsByIndex: {
        "2": { name: "By Index", author: "Dex", type: "Normal" },
      },
      normalRoundOrder: [
        { name: "Exact Match", author: "Alice", type: "Normal", phash: "match-1" },
        { name: "Close Match Deluxe", author: "Bob", type: "Normal" },
      ],
      cumRoundRefs: [{ name: "Missing Cum", author: "Nobody", type: "Cum" }],
    },
    perkSelection: { optionsPerPick: 3, triggerChancePerCompletedRound: 0.35 },
    perkPool: { enabledPerkIds: [], enabledAntiPerkIds: [] },
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
    roundStartDelayMs: 20000,
    dice: { min: 1, max: 6 },
    saveMode: "none",
  };
}

function makeGraphConfig(): PlaylistConfig {
  return {
    playlistVersion: 1,
    boardConfig: {
      mode: "graph",
      startNodeId: "start",
      nodes: [
        { id: "start", name: "Start", kind: "start" },
        {
          id: "node-round",
          name: "Fork Round",
          kind: "round",
          roundRef: { name: "Graph Target", author: "G", type: "Normal" },
        },
        { id: "end", name: "End", kind: "end" },
      ],
      edges: [
        { id: "edge-1", fromNodeId: "start", toNodeId: "node-round", weight: 1 },
        { id: "edge-2", fromNodeId: "node-round", toNodeId: "end", weight: 1 },
      ],
      textAnnotations: [],
      randomRoundPools: [
        {
          id: "pool-1",
          name: "Pool One",
          candidates: [
            { roundRef: { name: "Pool Candidate", author: "P", type: "Normal" }, weight: 1 },
          ],
        },
      ],
      cumRoundRefs: [{ name: "Graph Cum", author: "GC", type: "Cum" }],
      pathChoiceTimeoutMs: 6000,
    },
    perkSelection: { optionsPerPick: 3, triggerChancePerCompletedRound: 0.35 },
    perkPool: { enabledPerkIds: [], enabledAntiPerkIds: [] },
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
    roundStartDelayMs: 20000,
    dice: { min: 1, max: 6 },
    saveMode: "none",
  };
}

describe("playlistResolution", () => {
  it("collects stable reference keys across linear and graph playlists", () => {
    expect(collectPlaylistRefs(makeLinearConfig()).map((entry) => entry.key)).toEqual([
      "linear.normalRoundOrder.0",
      "linear.normalRoundOrder.1",
      "linear.normalRoundRefsByIndex.2",
      "linear.cumRoundRefs.0",
    ]);

    expect(collectPlaylistRefs(makeGraphConfig()).map((entry) => entry.key)).toEqual([
      "graph.node.node-round",
      "graph.randomPool.pool-1.0",
      "graph.cumRoundRefs.0",
    ]);
  });

  it("classifies exact, suggested, and missing refs", () => {
    const installedRounds = [
      makeRound({
        id: "round-exact",
        name: "Exact Match",
        author: "Alice",
        phash: "match-1",
        resources: [{ phash: null }],
      }),
      makeRound({
        id: "round-suggested",
        name: "Close Match",
        author: "Bob",
        difficulty: 4,
      }),
      makeRound({
        id: "round-index",
        name: "By Index",
        author: "Dex",
        difficulty: 2,
      }),
    ];

    const result = analyzePlaylistResolution(makeLinearConfig(), installedRounds);

    expect(result.counts).toEqual({
      exact: 2,
      suggested: 1,
      missing: 1,
    });
    expect(result.exactMapping["linear.normalRoundOrder.0"]).toBe("round-exact");
    expect(result.exactMapping["linear.normalRoundRefsByIndex.2"]).toBe("round-index");
    expect(result.suggestedMapping["linear.normalRoundOrder.1"]).toBe("round-suggested");
    expect(result.issues.map((issue) => issue.kind)).toEqual(["suggested", "missing"]);
    expect(result.issues[0]?.suggestions[0]?.roundId).toBe("round-suggested");
    expect(result.issues[1]?.key).toBe("linear.cumRoundRefs.0");
  });

  it("respects difficulty hints when ranking suggestions", () => {
    const config = makeLinearConfig();
    if (config.boardConfig.mode === "linear") {
      config.boardConfig.normalRoundOrder[1] = { name: "Difficulty Target", type: "Normal" };
    }

    const installedRounds = [
      makeRound({ id: "easy", name: "Difficulty Target Easy", difficulty: 1 }),
      makeRound({ id: "hard", name: "Difficulty Target Hard", difficulty: 8 }),
    ];

    const result = analyzePlaylistResolution(config, installedRounds, {
      difficultyHintsByRefKey: {
        "linear.normalRoundOrder.1": 8,
      },
    });

    expect(result.suggestedMapping["linear.normalRoundOrder.1"]).toBe("hard");
  });

  it("applies resolution mappings across linear and graph refs", () => {
    const installedRounds = [
      makeRound({ id: "linear-1", name: "Resolved Linear 1", author: "A" }),
      makeRound({ id: "linear-2", name: "Resolved Linear 2", author: "B" }),
      makeRound({ id: "linear-cum", name: "Resolved Linear Cum", author: "C", type: "Cum" }),
      makeRound({ id: "graph-node", name: "Resolved Graph Node", author: "G" }),
      makeRound({ id: "graph-pool", name: "Resolved Graph Pool", author: "P" }),
      makeRound({ id: "graph-cum", name: "Resolved Graph Cum", author: "GC", type: "Cum" }),
    ];

    const linearResolved = applyPlaylistResolutionMapping(
      makeLinearConfig(),
      {
        "linear.normalRoundOrder.0": "linear-1",
        "linear.normalRoundRefsByIndex.2": "linear-2",
        "linear.cumRoundRefs.0": "linear-cum",
      },
      installedRounds
    );

    expect(linearResolved.boardConfig.mode).toBe("linear");
    if (linearResolved.boardConfig.mode !== "linear") {
      throw new Error("Expected linear config");
    }
    expect(linearResolved.boardConfig.normalRoundOrder[0]?.idHint).toBe("linear-1");
    expect(linearResolved.boardConfig.normalRoundRefsByIndex["2"]?.idHint).toBe("linear-2");
    expect(linearResolved.boardConfig.cumRoundRefs[0]?.idHint).toBe("linear-cum");

    const graphResolved = applyPlaylistResolutionMapping(
      makeGraphConfig(),
      {
        "graph.node.node-round": "graph-node",
        "graph.randomPool.pool-1.0": "graph-pool",
        "graph.cumRoundRefs.0": "graph-cum",
      },
      installedRounds
    );

    expect(graphResolved.boardConfig.mode).toBe("graph");
    if (graphResolved.boardConfig.mode !== "graph") {
      throw new Error("Expected graph config");
    }
    expect(graphResolved.boardConfig.nodes[1]?.roundRef?.idHint).toBe("graph-node");
    expect(graphResolved.boardConfig.randomRoundPools[0]?.candidates[0]?.roundRef.idHint).toBe(
      "graph-pool"
    );
    expect(graphResolved.boardConfig.cumRoundRefs[0]?.idHint).toBe("graph-cum");
  });

  it("creates a reusable resolver that keeps exact match precedence", () => {
    const installedRounds = [
      makeRound({ id: "id-only", name: "Target", author: "Other", phash: "other-phash" }),
      makeRound({ id: "metadata", name: "Target", author: "Dex", type: "Normal" }),
      makeRound({ id: "phash", name: "Different", author: "Alice", phash: "match-1" }),
    ];
    const resolver = createPortableRoundRefResolver(installedRounds);

    expect(
      resolver.resolve({ name: "Ignored", author: "Nope", type: "Normal", phash: "match-1" })?.id
    ).toBe("phash");
    expect(resolver.resolve({ name: "Target", author: "Dex", type: "Normal" })?.id).toBe(
      "metadata"
    );
    expect(resolver.resolve({ idHint: "id-only", name: "Unknown", type: "Normal" })?.id).toBe(
      "id-only"
    );
  });

  it("resolves install source hints before metadata and id fallbacks", () => {
    const installedRounds = [
      makeRound({
        id: "source-match",
        name: "Renamed Round",
        author: "Dex",
        installSourceKey: "website:https://example.com/video-1",
      }),
      makeRound({ id: "metadata-match", name: "Reference Name", author: "Dex", type: "Normal" }),
    ];
    const resolver = createPortableRoundRefResolver(installedRounds);

    expect(
      resolver.resolve({
        name: "Reference Name",
        author: "Dex",
        type: "Normal",
        installSourceKeyHint: "website:https://example.com/video-1",
      })?.id
    ).toBe("source-match");
  });

  it("keeps exact resolution behavior aligned with playlist runtime", () => {
    const round = makeRound({
      id: "round-1",
      name: "Match Me",
      author: "Author",
      phash: "hash-1",
      resources: [{ phash: null }],
    });

    expect(
      resolvePortableRoundRefExact(
        {
          name: "Match Me",
          author: "Author",
          type: "Normal",
          phash: "hash-1",
        },
        [round]
      )?.id
    ).toBe("round-1");
  });

  it("resolves by similar phash when distance is within threshold", () => {
    const round = makeRound({
      id: "round-similar",
      name: "Installed Round",
      author: "Author",
      phash: "3ff",
      resources: [{ phash: null }],
    });

    expect(
      resolvePortableRoundRefExact(
        {
          name: "Different Name",
          author: "Different Author",
          type: "Normal",
          phash: "0",
        },
        [round]
      )?.id
    ).toBe("round-similar");
  });

  it("does not resolve by phash when similarity threshold is exceeded", () => {
    const round = makeRound({
      id: "round-far",
      name: "Installed Round",
      author: "Author",
      phash: "7ff",
      resources: [{ phash: null }],
    });

    expect(
      resolvePortableRoundRefExact(
        {
          name: "Different Name",
          author: "Different Author",
          type: "Normal",
          phash: "0",
        },
        [round]
      )
    ).toBeNull();
  });

  it("keeps sha fallback hashes exact-only", () => {
    const round = makeRound({
      id: "round-sha",
      name: "SHA Round",
      author: "Hasher",
      phash: "sha256:abc@0-1000",
      resources: [{ phash: null }],
    });

    expect(
      resolvePortableRoundRefExact(
        {
          name: "Different Name",
          author: "Different Author",
          type: "Normal",
          phash: "sha256:abd@0-1000",
        },
        [round]
      )
    ).toBeNull();

    expect(
      resolvePortableRoundRefExact(
        {
          name: "Different Name",
          author: "Different Author",
          type: "Normal",
          phash: "sha256:abc@0-1000",
        },
        [round]
      )?.id
    ).toBe("round-sha");
  });
});
