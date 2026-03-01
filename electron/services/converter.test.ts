// @vitest-environment node

import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  fromUriToLocalPath,
  saveConvertedRounds,
  toDeterministicInstallSourceKey,
  validateAndNormalizeSegments,
} from "./converter";

const mocks = vi.hoisted(() => {
  const savedRounds: Array<{ id: string; phash: string | null; startTime: number; endTime: number }> = [];
  const savedResources: Array<{ roundId: string; videoUri: string; phash: string | null }> = [];
  const deletedRoundIds: string[] = [];
  const deletedResourceRoundIds: string[] = [];
  const existingRoundFindResults: Array<{ id: string } | null> = [];
  const deleteRoundReturningIds: string[] = [];

  return {
    savedRounds,
    savedResources,
    deletedRoundIds,
    deletedResourceRoundIds,
    existingRoundFindResults,
    deleteRoundReturningIds,
    generateVideoPhash: vi.fn(),
    generateRoundPreviewImageDataUri: vi.fn(async () => null),
  };
});

vi.mock("./phash", () => ({
  generateVideoPhash: mocks.generateVideoPhash,
}));

vi.mock("./roundPreview", () => ({
  generateRoundPreviewImageDataUri: mocks.generateRoundPreviewImageDataUri,
}));

vi.mock("./db", () => ({
  getDb: () => ({
    transaction: async (callback: (tx: unknown) => Promise<unknown>) => callback(createMockTx()),
  }),
}));

function createMockTx() {
  return {
    query: {
      hero: {
        findFirst: vi.fn(async () => null),
      },
      round: {
        findFirst: vi.fn(async () => mocks.existingRoundFindResults.shift() ?? null),
      },
    },
    insert: vi.fn(() => ({
      values: vi.fn((value: Record<string, unknown>) => ({
        returning: vi.fn(async () => {
          if ("roundId" in value && "videoUri" in value) {
            mocks.savedResources.push({
              roundId: String(value.roundId),
              videoUri: String(value.videoUri),
              phash: typeof value.phash === "string" ? value.phash : null,
            });
            return [{ id: `resource-${mocks.savedResources.length}` }];
          }

          if ("installSourceKey" in value || "startTime" in value || "endTime" in value) {
            const id = `round-${mocks.savedRounds.length + 1}`;
            mocks.savedRounds.push({
              id,
              phash: typeof value.phash === "string" ? value.phash : null,
              startTime: Number(value.startTime),
              endTime: Number(value.endTime),
            });
            return [{ id }];
          }

          return [{ id: "hero-1" }];
        }),
      })),
    })),
    update: vi.fn(() => ({
      set: vi.fn(() => ({
        where: vi.fn((input: unknown) => ({
          returning: vi.fn(async () => [{ id: String(extractFirstSqlParam(input) ?? "round-updated") }]),
        })),
      })),
    })),
    delete: vi.fn(() => ({
      where: vi.fn((input: unknown) => {
        const id = extractFirstSqlParam(input);
        if (typeof id === "string") {
          mocks.deletedResourceRoundIds.push(id);
        }

        return {
          returning: vi.fn(async () => {
            const returnedId = mocks.deleteRoundReturningIds.shift();
            if (returnedId) {
              mocks.deletedRoundIds.push(returnedId);
              return [{ id: returnedId }];
            }
            return [];
          }),
        };
      }),
    })),
  };
}

function extractFirstSqlParam(input: unknown): unknown {
  const values: unknown[] = [];
  const visit = (node: unknown) => {
    if (!node) return;
    if (Array.isArray(node)) {
      node.forEach(visit);
      return;
    }
    if (typeof node !== "object") return;
    if ("value" in node) values.push(node.value);
    if ("queryChunks" in node && Array.isArray(node.queryChunks)) node.queryChunks.forEach(visit);
    if ("where" in node) visit(node.where);
  };
  visit(input);
  return values[0];
}

function toAppMediaUri(filePath: string): string {
  return `app://media/${encodeURIComponent(filePath)}`;
}

let tempDirs: string[] = [];

beforeEach(() => {
  mocks.savedRounds.length = 0;
  mocks.savedResources.length = 0;
  mocks.deletedRoundIds.length = 0;
  mocks.deletedResourceRoundIds.length = 0;
  mocks.existingRoundFindResults.length = 0;
  mocks.deleteRoundReturningIds.length = 0;
  mocks.generateVideoPhash.mockReset();
  mocks.generateRoundPreviewImageDataUri.mockClear();
});

afterEach(async () => {
  const dirs = tempDirs;
  tempDirs = [];
  await Promise.all(dirs.map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

async function writeTempVideo(contents: string): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "fland-converter-"));
  tempDirs.push(dir);
  const filePath = path.join(dir, "source.mp4");
  await fs.writeFile(filePath, contents);
  return filePath;
}

describe("converter helpers", () => {
  it("sorts and validates segments", () => {
    const normalized = validateAndNormalizeSegments([
      { startTimeMs: 3000, endTimeMs: 6000, type: "Normal" },
      { startTimeMs: 0, endTimeMs: 2000, type: "Cum" },
    ]);

    expect(normalized).toEqual([
      { startTimeMs: 0, endTimeMs: 2000, type: "Cum", customName: null, bpm: null, difficulty: null },
      { startTimeMs: 3000, endTimeMs: 6000, type: "Normal", customName: null, bpm: null, difficulty: null },
    ]);
  });

  it("normalizes custom segment names", () => {
    const normalized = validateAndNormalizeSegments([
      { startTimeMs: 0, endTimeMs: 2000, type: "Normal", customName: "  Intro Segment  " },
      { startTimeMs: 3000, endTimeMs: 6000, type: "Cum", customName: "   " },
    ]);

    expect(normalized[0]?.customName).toBe("Intro Segment");
    expect(normalized[1]?.customName).toBeNull();
  });

  it("normalizes and validates bpm and difficulty", () => {
    const normalized = validateAndNormalizeSegments([
      { startTimeMs: 0, endTimeMs: 2000, type: "Normal", bpm: 119.7, difficulty: 4 },
      { startTimeMs: 3000, endTimeMs: 6000, type: "Cum", bpm: null, difficulty: null },
    ]);

    expect(normalized[0]?.bpm).toBe(120);
    expect(normalized[0]?.difficulty).toBe(4);
    expect(normalized[1]?.bpm).toBeNull();
    expect(normalized[1]?.difficulty).toBeNull();
  });

  it("rejects invalid bpm", () => {
    expect(() =>
      validateAndNormalizeSegments([{ startTimeMs: 0, endTimeMs: 2000, type: "Normal", bpm: 0 }]),
    ).toThrow(/bpm/i);
    expect(() =>
      validateAndNormalizeSegments([{ startTimeMs: 0, endTimeMs: 2000, type: "Normal", bpm: 401 }]),
    ).toThrow(/bpm/i);
    expect(() =>
      validateAndNormalizeSegments([{ startTimeMs: 0, endTimeMs: 2000, type: "Normal", bpm: Number.NaN }]),
    ).toThrow(/bpm/i);
  });

  it("rejects invalid difficulty", () => {
    expect(() =>
      validateAndNormalizeSegments([{ startTimeMs: 0, endTimeMs: 2000, type: "Normal", difficulty: 0 }]),
    ).toThrow(/difficulty/i);
    expect(() =>
      validateAndNormalizeSegments([{ startTimeMs: 0, endTimeMs: 2000, type: "Normal", difficulty: 6 }]),
    ).toThrow(/difficulty/i);
    expect(() =>
      validateAndNormalizeSegments([{ startTimeMs: 0, endTimeMs: 2000, type: "Normal", difficulty: 2.5 }]),
    ).toThrow(/difficulty/i);
  });

  it("rejects overlapping segments", () => {
    expect(() =>
      validateAndNormalizeSegments([
        { startTimeMs: 0, endTimeMs: 3000, type: "Normal" },
        { startTimeMs: 2000, endTimeMs: 4000, type: "Interjection" },
      ]),
    ).toThrow(/overlap/i);
  });

  it("builds deterministic install source keys", () => {
    const first = toDeterministicInstallSourceKey({
      heroName: "Test Hero",
      videoUri: "app://media/%2Ftmp%2Fvideo.mp4",
      funscriptUri: "app://media/%2Ftmp%2Fvideo.funscript",
      startTimeMs: 1000,
      endTimeMs: 5000,
    });

    const second = toDeterministicInstallSourceKey({
      heroName: "Test Hero",
      videoUri: "app://media/%2Ftmp%2Fvideo.mp4",
      funscriptUri: "app://media/%2Ftmp%2Fvideo.funscript",
      startTimeMs: 1000,
      endTimeMs: 5000,
    });

    const third = toDeterministicInstallSourceKey({
      heroName: "Test Hero",
      videoUri: "app://media/%2Ftmp%2Fvideo.mp4",
      funscriptUri: "app://media/%2Ftmp%2Fvideo.funscript",
      startTimeMs: 1200,
      endTimeMs: 5000,
    });

    expect(first).toBe(second);
    expect(third).not.toBe(first);
  });

  it("resolves app and file uris to local paths", () => {
    expect(fromUriToLocalPath("app://media/%2Ftmp%2Fvideo.mp4")).toBe("/tmp/video.mp4");
    expect(fromUriToLocalPath("https://cdn.example.com/video.mp4")).toBeNull();
  });
});

describe("saveConvertedRounds phash fallback", () => {
  it("uses a sha256 fallback when video phash generation fails", async () => {
    mocks.generateVideoPhash.mockRejectedValue(new Error("phash failed"));
    const filePath = await writeTempVideo("video-data");
    const expectedHash = crypto.createHash("sha256").update("video-data").digest("hex");

    const result = await saveConvertedRounds({
      hero: { name: "Fallback Hero" },
      source: { videoUri: toAppMediaUri(filePath) },
      segments: [{ startTimeMs: 1000, endTimeMs: 2000, type: "Normal" }],
    });

    expect(result.rounds).toHaveLength(1);
    expect(result.rounds[0]?.phash).toBe(`sha256:${expectedHash}@1000-2000`);
    expect(mocks.savedRounds[0]?.phash).toBe(`sha256:${expectedHash}@1000-2000`);
  });

  it("shares one fallback file hash across concurrent failed segment phashes", async () => {
    mocks.generateVideoPhash.mockRejectedValue(new Error("phash failed"));
    const filePath = await writeTempVideo("shared-video-data");
    const expectedHash = crypto.createHash("sha256").update("shared-video-data").digest("hex");

    const result = await saveConvertedRounds({
      hero: { name: "Multi Segment Hero" },
      source: { videoUri: toAppMediaUri(filePath) },
      segments: [
        { startTimeMs: 1000, endTimeMs: 2000, type: "Normal" },
        { startTimeMs: 3000, endTimeMs: 4000, type: "Interjection" },
        { startTimeMs: 5000, endTimeMs: 6000, type: "Cum" },
      ],
    });

    expect(result.rounds.map((round) => round.phash)).toEqual([
      `sha256:${expectedHash}@1000-2000`,
      `sha256:${expectedHash}@3000-4000`,
      `sha256:${expectedHash}@5000-6000`,
    ]);
    expect(new Set(result.rounds.map((round) => round.phash?.split("@")[0]))).toEqual(
      new Set([`sha256:${expectedHash}`]),
    );
  });

  it("uses the generated video phash when available", async () => {
    mocks.generateVideoPhash.mockResolvedValue("phash-1");
    const filePath = await writeTempVideo("video-data");

    const result = await saveConvertedRounds({
      hero: { name: "Generated Phash Hero" },
      source: { videoUri: toAppMediaUri(filePath) },
      segments: [{ startTimeMs: 1000, endTimeMs: 2000, type: "Normal" }],
    });

    expect(result.rounds[0]?.phash).toBe("phash-1");
    expect(mocks.savedRounds[0]?.phash).toBe("phash-1");
  });
});

describe("saveConvertedRounds source replacement", () => {
  it("removes all stale imported hero source rounds after saving edited segments", async () => {
    mocks.generateVideoPhash.mockResolvedValue("phash");
    mocks.deleteRoundReturningIds.push("source-1", "source-2", "source-3", "source-4");
    const filePath = await writeTempVideo("hero-video-data");

    const result = await saveConvertedRounds({
      hero: { name: "Imported Hero" },
      source: {
        videoUri: toAppMediaUri(filePath),
        sourceRoundIds: ["source-1", "source-2", "source-3", "source-4"],
        removeSourceRound: true,
      },
      segments: [
        { startTimeMs: 0, endTimeMs: 2000, type: "Normal" },
        { startTimeMs: 2000, endTimeMs: 3000, type: "Normal" },
        { startTimeMs: 3000, endTimeMs: 4000, type: "Cum" },
      ],
    });

    expect(result.rounds).toHaveLength(3);
    expect(result.stats).toMatchObject({ created: 3, updated: 0, removedSources: 4 });
    expect(result.removedSourceRound).toBe(true);
    expect(result.removedSourceRoundIds).toEqual([
      "source-1",
      "source-2",
      "source-3",
      "source-4",
    ]);
    expect(mocks.deletedRoundIds).toEqual(["source-1", "source-2", "source-3", "source-4"]);
  });

  it("keeps converter-created source rounds that are updated in place", async () => {
    mocks.generateVideoPhash.mockResolvedValue("phash");
    mocks.deleteRoundReturningIds.push("source-1", "source-2");
    const filePath = await writeTempVideo("converter-video-data");
    const videoUri = toAppMediaUri(filePath);

    mocks.existingRoundFindResults.push(null, { id: "source-3" }, { id: "source-4" });

    const result = await saveConvertedRounds({
      hero: { name: "Converter Hero" },
      source: {
        videoUri,
        sourceRoundIds: ["source-1", "source-2", "source-3", "source-4"],
        removeSourceRound: true,
      },
      segments: [
        { startTimeMs: 0, endTimeMs: 2000, type: "Normal" },
        { startTimeMs: 2000, endTimeMs: 3000, type: "Normal" },
        { startTimeMs: 3000, endTimeMs: 4000, type: "Cum" },
      ],
    });

    expect(result.stats).toMatchObject({ created: 1, updated: 2, removedSources: 2 });
    expect(result.removedSourceRoundIds).toEqual(["source-1", "source-2"]);
    expect(mocks.deletedRoundIds).toEqual(["source-1", "source-2"]);
    expect(mocks.deletedRoundIds).not.toContain("source-3");
    expect(mocks.deletedRoundIds).not.toContain("source-4");
  });

  it("keeps backwards compatibility with singular sourceRoundId replacement", async () => {
    mocks.generateVideoPhash.mockResolvedValue("phash");
    mocks.deleteRoundReturningIds.push("source-round");
    const filePath = await writeTempVideo("single-source-video-data");

    const result = await saveConvertedRounds({
      hero: { name: "Single Source Hero" },
      source: {
        videoUri: toAppMediaUri(filePath),
        sourceRoundId: "source-round",
        removeSourceRound: true,
      },
      segments: [{ startTimeMs: 0, endTimeMs: 2000, type: "Normal" }],
    });

    expect(result.stats.removedSources).toBe(1);
    expect(result.removedSourceRound).toBe(true);
    expect(result.removedSourceRoundIds).toEqual(["source-round"]);
    expect(mocks.deletedRoundIds).toEqual(["source-round"]);
  });
});
