// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { approveDialogPath, clearApprovedDialogPathsForTests } from "./dialogPathApproval";

const {
  readFileMock,
  getDbMock,
  getStoreMock,
} = vi.hoisted(() => ({
  readFileMock: vi.fn(),
  getDbMock: vi.fn(),
  getStoreMock: vi.fn(),
}));

vi.mock("node:fs/promises", () => ({
  default: {
    readFile: readFileMock,
    writeFile: vi.fn(),
    mkdir: vi.fn(),
  },
}));

vi.mock("./db", () => ({
  getDb: getDbMock,
}));

vi.mock("./store", () => ({
  getStore: getStoreMock,
}));

function makeEnvelope() {
  return {
    format: "f-land.playlist",
    version: 1,
    metadata: {
      name: "Imported Playlist",
      description: "From file",
      exportedAt: "2026-03-09T00:00:00.000Z",
    },
    config: {
      playlistVersion: 1,
      boardConfig: {
        mode: "linear",
        totalIndices: 3,
        safePointIndices: [],
        safePointRestMsByIndex: {},
        normalRoundRefsByIndex: {},
        normalRoundOrder: [
          { name: "Exact Round", author: "Alice", type: "Normal", phash: "hash-exact" },
          { name: "Close Match Deluxe", author: "Bob", type: "Normal" },
        ],
        cumRoundRefs: [
          { name: "Missing Cum", author: "Nobody", type: "Cum" },
        ],
      },
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
    },
  };
}

function buildDbMock() {
  return {
    query: {
      round: {
        findMany: vi.fn(async () => [
          {
            id: "round-exact",
            name: "Exact Round",
            author: "Alice",
            type: "Normal",
            difficulty: 2,
            phash: "hash-exact",
            installSourceKey: null,
            resources: [{ phash: null }],
          },
          {
            id: "round-suggested",
            name: "Close Match",
            author: "Bob",
            type: "Normal",
            difficulty: 5,
            phash: null,
            installSourceKey: null,
            resources: [{ phash: null }],
          },
          {
            id: "round-manual",
            name: "Manual Cum",
            author: "Curator",
            type: "Cum",
            difficulty: 8,
            phash: null,
            installSourceKey: null,
            resources: [{ phash: null }],
          },
        ]),
      },
      playlist: {
        findFirst: vi.fn(async () => null),
      },
    },
    insert: vi.fn(() => ({
      values: vi.fn((input: { name: string; description: string | null; configJson: string; formatVersion: number }) => ({
        returning: vi.fn(async () => [{
          id: "playlist-created",
          name: input.name,
          description: input.description,
          formatVersion: input.formatVersion,
          configJson: input.configJson,
          createdAt: new Date("2026-03-09T00:00:00.000Z"),
          updatedAt: new Date("2026-03-09T00:00:00.000Z"),
        }]),
      })),
    })),
  };
}

describe("playlist import analysis and finalize", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearApprovedDialogPathsForTests();
    getStoreMock.mockReturnValue({
      get: vi.fn(),
      set: vi.fn(),
    });
    getDbMock.mockReturnValue(buildDbMock());
    readFileMock.mockResolvedValue(JSON.stringify(makeEnvelope()));
  });

  afterEach(() => {
    clearApprovedDialogPathsForTests();
  });

  it("analyzes playlist imports with exact, suggested, and missing refs", async () => {
    approveDialogPath("playlistImportFile", "/tmp/imported.fplay");
    const { analyzePlaylistImportFile } = await import("./playlists");

    const result = await analyzePlaylistImportFile("/tmp/imported.fplay");

    expect(result.metadata.name).toBe("Imported Playlist");
    expect(result.resolution.counts).toEqual({
      exact: 1,
      suggested: 1,
      missing: 1,
    });
    expect(result.resolution.exactMapping["linear.normalRoundOrder.0"]).toBe("round-exact");
    expect(result.resolution.suggestedMapping["linear.normalRoundOrder.1"]).toBe("round-suggested");
    expect(result.resolution.issues[1]?.key).toBe("linear.cumRoundRefs.0");
  });

  it("imports playlists using exact, suggested, and manual mappings", async () => {
    approveDialogPath("playlistImportFile", "/tmp/imported.fplay");
    const { importPlaylistFromFile } = await import("./playlists");

    const result = await importPlaylistFromFile({
      filePath: "/tmp/imported.fplay",
      manualMappingByRefKey: {
        "linear.cumRoundRefs.0": "round-manual",
      },
    });

    expect(result.report.appliedMapping).toMatchObject({
      "linear.normalRoundOrder.0": "round-exact",
      "linear.normalRoundOrder.1": "round-suggested",
      "linear.cumRoundRefs.0": "round-manual",
    });
    expect(result.playlist.config.boardConfig.mode).toBe("linear");
    if (result.playlist.config.boardConfig.mode !== "linear") {
      throw new Error("Expected linear playlist");
    }
    expect(result.playlist.config.boardConfig.cumRoundRefs[0]?.idHint).toBe("round-manual");
    expect(result.playlist.config.boardConfig.normalRoundOrder[1]?.idHint).toBe("round-suggested");
  });
});
