// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";

const { getDbMock, removeCachedWebsiteVideoMock } = vi.hoisted(() => ({
  getDbMock: vi.fn(),
  removeCachedWebsiteVideoMock: vi.fn(),
}));

vi.mock("../../services/db", () => ({
  getDb: getDbMock,
}));

vi.mock("../../services/installExport", () => ({
  exportInstalledDatabase: vi.fn(),
}));

vi.mock("../../services/store", () => ({
  getStore: vi.fn(() => ({
    clear: vi.fn(),
  })),
}));

vi.mock("../../services/webVideo", () => ({
  clearWebsiteVideoCache: vi.fn(),
  getWebsiteVideoCacheState: vi.fn(async () => "not_applicable"),
  getWebsiteVideoTargetUrl: vi.fn((uri: string) => {
    const trimmed = uri.trim();
    if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
      return trimmed;
    }
    return null;
  }),
  removeCachedWebsiteVideo: removeCachedWebsiteVideoMock,
  resolveWebsiteVideoStream: vi.fn(),
}));

import { round as roundTable } from "../../services/db/schema";
import { dbRouter } from "./db";

type RoundRow = {
  id: string;
  name: string;
};

type ResourceRow = {
  id: string;
  roundId: string;
  videoUri: string;
};

function extractSqlParams(input: unknown): unknown[] {
  const values: unknown[] = [];
  const visit = (node: unknown) => {
    if (!node) return;
    if (Array.isArray(node)) {
      for (const item of node) visit(item);
      return;
    }
    if (typeof node !== "object") return;
    if ("value" in node) {
      values.push((node as { value: unknown }).value);
    }
    if ("queryChunks" in node && Array.isArray((node as { queryChunks?: unknown[] }).queryChunks)) {
      for (const chunk of (node as { queryChunks: unknown[] }).queryChunks) {
        visit(chunk);
      }
    }
  };
  visit(input);
  return values;
}

function createRendererCaller() {
  return dbRouter.createCaller({ event: { sender: {} } } as never);
}

describe("dbRouter deleteRound website cache cleanup", () => {
  let roundsById: Map<string, RoundRow>;
  let resourcesById: Map<string, ResourceRow>;

  beforeEach(() => {
    vi.clearAllMocks();

    roundsById = new Map<string, RoundRow>([
      ["round-1", { id: "round-1", name: "Website Round" }],
      ["round-2", { id: "round-2", name: "Other Round" }],
    ]);
    resourcesById = new Map<string, ResourceRow>([
      [
        "resource-1",
        {
          id: "resource-1",
          roundId: "round-1",
          videoUri: "https://example.com/watch?v=1",
        },
      ],
      [
        "resource-2",
        {
          id: "resource-2",
          roundId: "round-2",
          videoUri: "file:///tmp/local.mp4",
        },
      ],
    ]);

    getDbMock.mockReturnValue({
      query: {
        round: {
          findFirst: vi.fn(async (input: { where: unknown }) => {
            const [id] = extractSqlParams(input.where);
            const existingId = typeof id === "string" ? id : "round-1";
            const existing = roundsById.get(existingId);
            if (!existing) {
              return null;
            }
            return {
              ...existing,
              resources: [...resourcesById.values()]
                .filter((entry) => entry.roundId === existingId)
                .map((entry) => ({ videoUri: entry.videoUri })),
            };
          }),
          findMany: vi.fn(async (input: { where: unknown }) => {
            const ids = new Set(
              extractSqlParams(input.where).filter(
                (value): value is string => typeof value === "string"
              )
            );
            return [...roundsById.values()]
              .filter((entry) => ids.has(entry.id))
              .map((entry) => ({
                ...entry,
                resources: [...resourcesById.values()]
                  .filter((resourceEntry) => resourceEntry.roundId === entry.id)
                  .map((resourceEntry) => ({ videoUri: resourceEntry.videoUri })),
              }));
          }),
        },
        resource: {
          findMany: vi.fn(async () =>
            [...resourcesById.values()].map((entry) => ({ videoUri: entry.videoUri }))
          ),
        },
      },
      delete: vi.fn((table: unknown) => ({
        where: async (whereClause: unknown) => {
          const ids = extractSqlParams(whereClause).filter(
            (value): value is string => typeof value === "string"
          );
          const deleteIds = ids.length > 0 ? ids : ["round-1"];
          if (table === roundTable) {
            for (const deleteId of deleteIds) {
              roundsById.delete(deleteId);
              for (const [resourceId, entry] of resourcesById.entries()) {
                if (entry.roundId === deleteId) {
                  resourcesById.delete(resourceId);
                }
              }
            }
          }
          return [];
        },
      })),
    });
  });

  it("removes website cache when deleting the last round that references it", async () => {
    const caller = createRendererCaller();

    await expect(caller.deleteRound({ id: "round-1" })).resolves.toEqual({ deleted: true });

    expect(removeCachedWebsiteVideoMock).toHaveBeenCalledWith("https://example.com/watch?v=1");
  });

  it("keeps shared website cache when another round still references the same url", async () => {
    resourcesById.set("resource-3", {
      id: "resource-3",
      roundId: "round-2",
      videoUri: "https://example.com/watch?v=1",
    });

    const caller = createRendererCaller();
    await expect(caller.deleteRound({ id: "round-1" })).resolves.toEqual({ deleted: true });

    expect(removeCachedWebsiteVideoMock).not.toHaveBeenCalled();
  });

  it("deletes multiple rounds and reports missing ids", async () => {
    resourcesById.set("resource-3", {
      id: "resource-3",
      roundId: "round-2",
      videoUri: "https://example.com/watch?v=2",
    });

    const caller = createRendererCaller();
    await expect(
      caller.deleteRounds({ ids: ["round-1", "round-1", "round-2", "missing-round"] })
    ).resolves.toEqual({
      deleted: true,
      deletedCount: 2,
      requestedCount: 3,
      missingIds: ["missing-round"],
    });

    expect(roundsById.has("round-1")).toBe(false);
    expect(roundsById.has("round-2")).toBe(false);
    expect(removeCachedWebsiteVideoMock).toHaveBeenCalledWith("https://example.com/watch?v=1");
    expect(removeCachedWebsiteVideoMock).toHaveBeenCalledWith("https://example.com/watch?v=2");
  });

  it("keeps shared website cache when bulk deletion leaves another reference", async () => {
    roundsById.set("round-3", { id: "round-3", name: "Remaining Website Round" });
    resourcesById.set("resource-3", {
      id: "resource-3",
      roundId: "round-3",
      videoUri: "https://example.com/watch?v=1",
    });

    const caller = createRendererCaller();
    await expect(caller.deleteRounds({ ids: ["round-1", "round-2"] })).resolves.toEqual({
      deleted: true,
      deletedCount: 2,
      requestedCount: 2,
      missingIds: [],
    });

    expect(removeCachedWebsiteVideoMock).not.toHaveBeenCalledWith("https://example.com/watch?v=1");
  });
});
