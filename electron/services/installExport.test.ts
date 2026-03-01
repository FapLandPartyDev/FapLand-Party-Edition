// @vitest-environment node

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { getDbMock, getAppPathMock } = vi.hoisted(() => ({
  getDbMock: vi.fn(),
  getAppPathMock: vi.fn(),
}));

vi.mock("electron", () => ({
  app: {
    getAppPath: getAppPathMock,
  },
}));

vi.mock("./db", () => ({
  getDb: getDbMock,
}));

type TestRound = {
  id: string;
  name: string;
  author: string | null;
  description: string | null;
  bpm: number | null;
  difficulty: number | null;
  phash: string | null;
  startTime: number | null;
  endTime: number | null;
  type: "Normal" | "Interjection" | "Cum";
  heroId: string | null;
  hero: {
    id: string;
    name: string;
    author: string | null;
    description: string | null;
    phash: string | null;
  } | null;
  resources: Array<{
    videoUri: string;
    funscriptUri: string | null;
  }>;
  createdAt: Date;
};

function buildTestRounds(): TestRound[] {
  return [
    {
      id: "round-standalone",
      name: "Solo Round",
      author: "A",
      description: "Standalone",
      bpm: 120,
      difficulty: 2,
      phash: null,
      startTime: null,
      endTime: null,
      type: "Normal",
      heroId: null,
      hero: null,
      resources: [{ videoUri: "https://cdn.example.com/solo.mp4", funscriptUri: "https://cdn.example.com/solo.funscript" }],
      createdAt: new Date("2026-03-05T12:00:00.000Z"),
    },
    {
      id: "round-hero-1",
      name: "Hero One Round 1",
      author: "B",
      description: "Hero Round 1",
      bpm: 110,
      difficulty: 3,
      phash: null,
      startTime: null,
      endTime: null,
      type: "Normal",
      heroId: "hero-1",
      hero: {
        id: "hero-1",
        name: "Hero One",
        author: "B",
        description: "Hero",
        phash: null,
      },
      resources: [{ videoUri: "https://cdn.example.com/hero1.mp4", funscriptUri: null }],
      createdAt: new Date("2026-03-05T12:01:00.000Z"),
    },
    {
      id: "round-hero-2",
      name: "Hero One Round 2",
      author: "B",
      description: "Hero Round 2",
      bpm: 130,
      difficulty: 4,
      phash: null,
      startTime: null,
      endTime: null,
      type: "Cum",
      heroId: "hero-1",
      hero: {
        id: "hero-1",
        name: "Hero One",
        author: "B",
        description: "Hero",
        phash: null,
      },
      resources: [{ videoUri: "https://cdn.example.com/hero2.mp4", funscriptUri: "https://cdn.example.com/hero2.funscript" }],
      createdAt: new Date("2026-03-05T12:02:00.000Z"),
    },
  ];
}

describe("exportInstalledDatabase", () => {
  let rootDir: string;

  beforeEach(async () => {
    rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "f-land-export-"));
    getAppPathMock.mockReturnValue(rootDir);
    getDbMock.mockReturnValue({
      query: {
        round: {
          findMany: vi.fn(async () => buildTestRounds()),
        },
      },
    });
  });

  afterEach(async () => {
    vi.clearAllMocks();
    await fs.rm(rootDir, { recursive: true, force: true });
  });

  it("exports hero rounds only inside hero files and excludes resource URIs by default", async () => {
    const { exportInstalledDatabase } = await import("./installExport");
    const result = await exportInstalledDatabase();

    expect(result.includeResourceUris).toBe(false);
    expect(result.roundFiles).toBe(1);
    expect(result.heroFiles).toBe(1);
    expect(result.exportedRounds).toBe(3);

    const fileNames = await fs.readdir(result.exportDir);
    expect(fileNames.filter((name) => name.endsWith(".round"))).toHaveLength(1);
    expect(fileNames.filter((name) => name.endsWith(".hero"))).toHaveLength(1);
    expect(fileNames.some((name) => name.includes("__round-hero-1.round"))).toBe(false);
    expect(fileNames.some((name) => name.includes("__round-hero-2.round"))).toBe(false);

    const roundFile = fileNames.find((name) => name.endsWith(".round"));
    const heroFile = fileNames.find((name) => name.endsWith(".hero"));
    expect(roundFile).toBeTruthy();
    expect(heroFile).toBeTruthy();

    const parsedRound = JSON.parse(await fs.readFile(path.join(result.exportDir, roundFile!), "utf8")) as { resources: unknown[] };
    const parsedHero = JSON.parse(await fs.readFile(path.join(result.exportDir, heroFile!), "utf8")) as {
      rounds: Array<{ resources: unknown[] }>;
    };

    expect(parsedRound.resources).toEqual([]);
    expect(parsedHero.rounds).toHaveLength(2);
    expect(parsedHero.rounds.every((round) => Array.isArray(round.resources) && round.resources.length === 0)).toBe(true);
  });

  it("includes resource URIs when explicitly enabled", async () => {
    const { exportInstalledDatabase } = await import("./installExport");
    const result = await exportInstalledDatabase({ includeResourceUris: true });

    expect(result.includeResourceUris).toBe(true);
    const fileNames = await fs.readdir(result.exportDir);
    const roundFile = fileNames.find((name) => name.endsWith(".round"));
    const heroFile = fileNames.find((name) => name.endsWith(".hero"));
    expect(roundFile).toBeTruthy();
    expect(heroFile).toBeTruthy();

    const parsedRound = JSON.parse(await fs.readFile(path.join(result.exportDir, roundFile!), "utf8")) as {
      resources: Array<{ videoUri: string; funscriptUri?: string }>;
    };
    const parsedHero = JSON.parse(await fs.readFile(path.join(result.exportDir, heroFile!), "utf8")) as {
      rounds: Array<{ resources: Array<{ videoUri: string; funscriptUri?: string }> }>;
    };

    expect(parsedRound.resources[0]?.videoUri).toBe("https://cdn.example.com/solo.mp4");
    expect(parsedHero.rounds[0]?.resources[0]?.videoUri).toContain("hero");
  });
});
