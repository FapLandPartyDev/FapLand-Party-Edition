import { describe, expect, it } from "vitest";
import type { StoredPlaylist } from "../../services/playlists";
import {
  describeRelativeTime,
  getPlaylistBoardMode,
  getPlaylistRoundCount,
  getPlaylistUpdatedMs,
  getVisiblePlaylists,
  normalizeSearchQuery,
} from "./playlistPickerHelpers";

type BoardConfigOverride = unknown;

function makePlaylist(
  id: string,
  name: string,
  boardConfig: BoardConfigOverride,
  extra: { description?: string; updatedAt?: unknown; createdAt?: unknown } = {}
): StoredPlaylist {
  const config = {
    playlistVersion: 1,
    boardConfig,
    saveMode: "none",
    roundStartDelayMs: 20000,
    perkSelection: { optionsPerPick: 3, triggerChancePerCompletedRound: 0.35 },
    perkPool: { enabledPerkIds: [], enabledAntiPerkIds: [] },
    probabilityScaling: {
      initialIntermediaryProbability: 0,
      initialAntiPerkProbability: 0,
      intermediaryIncreasePerRound: 0.02,
      antiPerkIncreasePerRound: 0.015,
      maxIntermediaryProbability: 1,
      maxAntiPerkProbability: 0.75,
      resetIntermediaryProbabilityAfterTrigger: false,
      resetAntiPerkProbabilityAfterTrigger: false,
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
    disableDiceAnimation: false,
    dice: { min: 1, max: 6 },
  };
  return {
    id,
    name,
    description: extra.description ?? null,
    formatVersion: 1,
    createdAt: extra.createdAt ?? new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: extra.updatedAt ?? new Date("2026-01-01T00:00:00.000Z"),
    config,
  } as unknown as StoredPlaylist;
}

function linearPlaylist(id: string, name: string, roundCount = 3): StoredPlaylist {
  return makePlaylist(id, name, {
    mode: "linear",
    totalIndices: 10,
    safePointIndices: [],
    safePointRestMsByIndex: {},
    normalRoundRefsByIndex: {},
    normalRoundOrder: Array.from({ length: roundCount }, (_, i) => ({
      idHint: `r${i}`,
      name: `R${i}`,
    })),
    cumRoundRefs: [],
  });
}

function graphPlaylist(id: string, name: string, roundNodes: number): StoredPlaylist {
  return makePlaylist(id, name, {
    mode: "graph",
    startNodeId: "start",
    nodes: [
      { id: "start", name: "Start", kind: "start" },
      ...Array.from({ length: roundNodes }, (_, i) => ({
        id: `r${i}`,
        name: `Round ${i}`,
        kind: "round",
      })),
      { id: "end", name: "End", kind: "end" },
    ],
    edges: [],
    textAnnotations: [],
    randomRoundPools: [],
    cumRoundRefs: [],
  });
}

function endlessPlaylist(id: string, name: string, batchSize = 50): StoredPlaylist {
  return makePlaylist(id, name, {
    mode: "endless",
    safePointEveryN: 25,
    perkNodeEveryN: 5,
    initialBatchSize: batchSize,
    extendBatchSize: 25,
  });
}

describe("getPlaylistBoardMode", () => {
  it("reads the mode from the board config", () => {
    expect(getPlaylistBoardMode(linearPlaylist("a", "A"))).toBe("linear");
    expect(getPlaylistBoardMode(graphPlaylist("a", "A", 1))).toBe("graph");
    expect(getPlaylistBoardMode(endlessPlaylist("a", "A"))).toBe("endless");
  });

  it("falls back to linear for malformed configs", () => {
    const broken = makePlaylist("x", "X", {});
    expect(getPlaylistBoardMode(broken)).toBe("linear");
  });
});

describe("getPlaylistRoundCount", () => {
  it("counts linear normal round order length", () => {
    expect(getPlaylistRoundCount(linearPlaylist("a", "A", 0))).toBe(0);
    expect(getPlaylistRoundCount(linearPlaylist("a", "A", 4))).toBe(4);
  });

  it("counts graph round + randomRound nodes only", () => {
    const graph = makePlaylist("g", "G", {
      mode: "graph",
      startNodeId: "start",
      nodes: [
        { id: "start", name: "Start", kind: "start" },
        { id: "r1", name: "R1", kind: "round" },
        { id: "r2", name: "R2", kind: "randomRound" },
        { id: "p1", name: "P1", kind: "perk" },
        { id: "end", name: "End", kind: "end" },
      ],
      edges: [],
    });
    expect(getPlaylistRoundCount(graph)).toBe(2);
  });

  it("returns the endless initial batch size", () => {
    expect(getPlaylistRoundCount(endlessPlaylist("a", "A", 75))).toBe(75);
  });
});

describe("getPlaylistUpdatedMs", () => {
  it("reads Date instances", () => {
    const playlist = makePlaylist("a", "A", { mode: "linear" }, {
      updatedAt: new Date("2026-03-01T00:00:00.000Z"),
    });
    expect(getPlaylistUpdatedMs(playlist)).toBe(Date.parse("2026-03-01T00:00:00.000Z"));
  });

  it("falls back to createdAt then 0", () => {
    const playlist = {
      id: "a",
      name: "A",
      description: null,
      formatVersion: 1,
      createdAt: new Date("2026-02-01T00:00:00.000Z"),
      config: { boardConfig: { mode: "linear" } },
    } as unknown as StoredPlaylist;
    expect(getPlaylistUpdatedMs(playlist)).toBe(Date.parse("2026-02-01T00:00:00.000Z"));

    const neither = { id: "b", name: "B", config: {} } as unknown as StoredPlaylist;
    expect(getPlaylistUpdatedMs(neither)).toBe(0);
  });
});

describe("describeRelativeTime", () => {
  const now = Date.parse("2026-03-01T12:00:00.000Z");

  it("buckets into just-now / minutes / hours / days / date", () => {
    expect(describeRelativeTime(now, now)).toEqual({ key: "just-now", value: 0 });
    expect(describeRelativeTime(now - 5 * 60_000, now)).toEqual({ key: "minutes", value: 5 });
    expect(describeRelativeTime(now - 3 * 3_600_000, now)).toEqual({ key: "hours", value: 3 });
    expect(describeRelativeTime(now - 5 * 86_400_000, now)).toEqual({ key: "days", value: 5 });
    expect(describeRelativeTime(now - 60 * 86_400_000, now)).toEqual({
      key: "date",
      value: now - 60 * 86_400_000,
    });
  });

  it("treats future or invalid timestamps as just-now", () => {
    expect(describeRelativeTime(now + 1000, now)).toEqual({ key: "just-now", value: 0 });
    expect(describeRelativeTime(Number.NaN, now)).toEqual({ key: "just-now", value: 0 });
  });
});

describe("getVisiblePlaylists", () => {
  const playlists = [
    linearPlaylist("lin", "Alpha Linear", 2),
    graphPlaylist("grp", "Beta Graph", 5),
    endlessPlaylist("end", "Gamma Endless", 50),
  ];

  it("filters by mode", () => {
    const result = getVisiblePlaylists(playlists, "graph", "", "name-asc", "");
    expect(result.map((p) => p.id)).toEqual(["grp"]);
  });

  it("filters by search query against name and description", () => {
    const described = makePlaylist("desc", "Zeta", { mode: "linear" }, {
      description: "special keyword here",
    });
    const all = [...playlists, described];
    const result = getVisiblePlaylists(all, "all", normalizeSearchQuery("keyword"), "name-asc", "");
    expect(result.map((p) => p.id)).toEqual(["desc"]);
  });

  it("sorts by name descending", () => {
    const result = getVisiblePlaylists(playlists, "all", "", "name-desc", "");
    expect(result.map((p) => p.name)).toEqual(["Gamma Endless", "Beta Graph", "Alpha Linear"]);
  });

  it("always pins the active playlist to the top", () => {
    const result = getVisiblePlaylists(playlists, "all", "", "name-asc", "end");
    expect(result[0]!.id).toBe("end");
  });

  it("sorts by mode then name", () => {
    const result = getVisiblePlaylists(playlists, "all", "", "mode", "");
    expect(result.map((p) => p.id)).toEqual(["lin", "grp", "end"]);
  });

  it("returns empty list when nothing matches", () => {
    const result = getVisiblePlaylists(playlists, "all", normalizeSearchQuery("zzz"), "name-asc", "");
    expect(result).toEqual([]);
  });
});
