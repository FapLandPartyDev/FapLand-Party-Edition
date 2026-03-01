import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const where = vi.fn().mockResolvedValue([]);
  const set = vi.fn(() => ({ where }));
  const update = vi.fn(() => ({ set }));
  const db = {
    query: {
      round: {
        findMany: vi.fn(),
      },
    },
    transaction: vi.fn(async (callback: (tx: { update: typeof update }) => Promise<void>) =>
      callback({ update })
    ),
  };
  return {
    db,
    update,
    set,
    where,
    readFunscriptActions: vi.fn(),
  };
});

vi.mock("./db", () => ({
  getDb: () => mocks.db,
}));

vi.mock("./funscript", () => ({
  readFunscriptActions: mocks.readFunscriptActions,
}));

vi.mock("./integrations", () => ({
  createResourceUriResolver: () => (input: unknown) => input,
}));

import { massTrimHeroes } from "./converterMassTrim";

describe("massTrimHeroes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.readFunscriptActions.mockResolvedValue([
      { at: 2_000, pos: 20 },
      { at: 4_000, pos: 80 },
    ]);
    mocks.db.query.round.findMany.mockResolvedValue([
      {
        id: "round-a",
        startTime: 0,
        endTime: 10_000,
        cutRangesJson: JSON.stringify([{ startTimeMs: 4_500, endTimeMs: 6_000 }]),
        resources: [
          {
            id: "resource-a",
            videoUri: "app://media/video",
            funscriptUri: "app://media/script",
            disabled: false,
          },
        ],
      },
      {
        id: "round-b",
        startTime: 0,
        endTime: 10_000,
        cutRangesJson: null,
        resources: [],
      },
    ]);
  });

  it("trims eligible sections transactionally and clips cuts", async () => {
    const result = await massTrimHeroes({
      heroIds: ["hero-a"],
      allowanceMs: 1_000,
    });

    expect(result).toEqual({
      selectedHeroCount: 1,
      sectionCount: 2,
      trimmedSectionCount: 1,
      unchangedSectionCount: 0,
      skippedSectionCount: 1,
    });
    expect(mocks.db.transaction).toHaveBeenCalledTimes(1);
    expect(mocks.set).toHaveBeenCalledWith(
      expect.objectContaining({
        startTime: 1_000,
        endTime: 5_000,
        cutRangesJson: JSON.stringify([{ startTimeMs: 4_500, endTimeMs: 5_000 }]),
        phash: null,
      })
    );
  });

  it("requires at least one selected hero", async () => {
    await expect(massTrimHeroes({ heroIds: [] })).rejects.toThrow(
      "Select at least one hero to trim."
    );
    expect(mocks.db.query.round.findMany).not.toHaveBeenCalled();
  });
});
