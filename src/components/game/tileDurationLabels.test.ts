import { describe, expect, it } from "vitest";
import type { BoardField } from "../../game/types";
import type { InstalledRound } from "../../services/db";
import { buildTileDurationLabelByFieldId } from "./tileDurationLabels";

function createRound(
  overrides: Partial<InstalledRound> & Pick<InstalledRound, "id" | "name">
): InstalledRound {
  return {
    id: overrides.id,
    name: overrides.name,
    author: overrides.author ?? null,
    description: overrides.description ?? null,
    bpm: overrides.bpm ?? null,
    difficulty: overrides.difficulty ?? null,
    startTime: overrides.startTime ?? null,
    endTime: overrides.endTime ?? null,
    type: overrides.type ?? "Normal",
    createdAt: overrides.createdAt ?? new Date().toISOString(),
    updatedAt: overrides.updatedAt ?? new Date().toISOString(),
    heroId: overrides.heroId ?? null,
    hero: overrides.hero ?? null,
    phash: overrides.phash ?? null,
    installSourceKey: overrides.installSourceKey ?? null,
    previewImage: overrides.previewImage ?? null,
    resources: overrides.resources ?? [],
  } as unknown as InstalledRound;
}

describe("buildTileDurationLabelByFieldId", () => {
  it("maps deterministic round tiles to formatted duration labels", () => {
    const board: BoardField[] = [
      { id: "start", name: "Start", kind: "start" },
      { id: "round-1", name: "Round 1", kind: "round", fixedRoundId: "r1" },
    ];
    const installedRounds = [
      createRound({
        id: "r1",
        name: "Round 1",
        resources: [
          {
            id: "res-1",
            roundId: "r1",
            videoUri: "file:///round-1.mp4",
            funscriptUri: null,
            funscriptOffsetMs: null,
            invertFunscript: false,
            phash: null,
            durationMs: 185_000,
            disabled: false,
            websiteVideoCacheStatus: "not_applicable" as const,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        ],
      }),
    ];

    const result = buildTileDurationLabelByFieldId(board, installedRounds);

    expect(result.get("round-1")).toBe("3:05");
  });

  it("skips tiles whose round duration is unknown", () => {
    const board: BoardField[] = [
      { id: "round-1", name: "Round 1", kind: "round", fixedRoundId: "r1" },
    ];
    const installedRounds = [
      createRound({
        id: "r1",
        name: "Round 1",
        resources: [
          {
            id: "res-1",
            roundId: "r1",
            videoUri: "file:///round-1.mp4",
            funscriptUri: null,
            funscriptOffsetMs: null,
            invertFunscript: false,
            phash: null,
            durationMs: null,
            disabled: false,
            websiteVideoCacheStatus: "not_applicable" as const,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        ],
      }),
    ];

    const result = buildTileDurationLabelByFieldId(board, installedRounds);

    expect(result.has("round-1")).toBe(false);
  });

  it("does not label non-round or random-pool tiles without a fixed round", () => {
    const board: BoardField[] = [
      { id: "start", name: "Start", kind: "start" },
      { id: "safe-1", name: "Safe Point", kind: "safePoint" },
      { id: "random-1", name: "Random", kind: "randomRound", randomPoolId: "pool-a" },
      { id: "event-1", name: "Event", kind: "event" },
    ];
    const installedRounds = [
      createRound({
        id: "r1",
        name: "Round 1",
        resources: [
          {
            id: "res-1",
            roundId: "r1",
            videoUri: "file:///round-1.mp4",
            funscriptUri: null,
            funscriptOffsetMs: null,
            invertFunscript: false,
            phash: null,
            durationMs: 90_000,
            disabled: false,
            websiteVideoCacheStatus: "not_applicable" as const,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        ],
      }),
    ];

    const result = buildTileDurationLabelByFieldId(board, installedRounds);

    expect(result.size).toBe(0);
  });

  it("labels graph round nodes with fixed rounds while leaving random nodes empty", () => {
    const board: BoardField[] = [
      { id: "graph-round", name: "Round", kind: "round", fixedRoundId: "r1" },
      { id: "graph-random", name: "Random", kind: "randomRound", randomPoolId: "pool-a" },
    ];
    const installedRounds = [
      createRound({
        id: "r1",
        name: "Round 1",
        resources: [
          {
            id: "res-1",
            roundId: "r1",
            videoUri: "file:///round-1.mp4",
            funscriptUri: null,
            funscriptOffsetMs: null,
            invertFunscript: false,
            phash: null,
            durationMs: 610_000,
            disabled: false,
            websiteVideoCacheStatus: "not_applicable" as const,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        ],
      }),
    ];

    const result = buildTileDurationLabelByFieldId(board, installedRounds);

    expect(result.get("graph-round")).toBe("10:10");
    expect(result.has("graph-random")).toBe(false);
  });
});
