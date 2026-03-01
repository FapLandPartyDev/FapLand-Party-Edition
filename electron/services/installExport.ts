import fs from "node:fs/promises";
import path from "node:path";
import { app } from "electron";
import { ZHeroSidecar, ZRoundSidecar } from "../../src/zod/installSidecar";
import { getDb } from "./db";
import { asc } from "drizzle-orm";
import { round } from "./db/schema";
export type RoundType = "Normal" | "Interjection" | "Cum";

export type ExportInstalledDatabaseInput = {
  includeResourceUris?: boolean;
};

export type ExportInstalledDatabaseResult = {
  exportDir: string;
  heroFiles: number;
  roundFiles: number;
  exportedRounds: number;
  includeResourceUris: boolean;
};

type SidecarResource = {
  videoUri: string;
  funscriptUri: string | null | undefined;
};

type SidecarRound = {
  id: string;
  name: string;
  author: string | null;
  description: string | null;
  bpm: number | null;
  difficulty: number | null;
  phash: string | null;
  startTime: number | null;
  endTime: number | null;
  type: RoundType;
  resources: SidecarResource[];
  heroId: string | null;
  hero: {
    id: string;
    name: string;
    author: string | null;
    description: string | null;
    phash: string | null;
  } | null;
};

function toSafeIsoTimestamp(date: Date): string {
  return date.toISOString().replaceAll(":", "-");
}

function toSlug(value: string): string {
  const normalized = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized || "unnamed";
}

function toRoundSidecar(round: SidecarRound, includeResourceUris: boolean) {
  return ZRoundSidecar.parse({
    name: round.name,
    author: round.author ?? undefined,
    description: round.description ?? undefined,
    bpm: round.bpm ?? undefined,
    difficulty: round.difficulty ?? undefined,
    phash: round.phash ?? undefined,
    startTime: round.startTime ?? undefined,
    endTime: round.endTime ?? undefined,
    type: round.type,
    resources: includeResourceUris
      ? round.resources.map((resource) => ({
        videoUri: resource.videoUri,
        funscriptUri: resource.funscriptUri ?? undefined,
      }))
      : [],
  });
}

function toHeroSidecar(
  hero: NonNullable<SidecarRound["hero"]>,
  rounds: SidecarRound[],
  includeResourceUris: boolean,
) {
  return ZHeroSidecar.parse({
    name: hero.name,
    author: hero.author ?? undefined,
    description: hero.description ?? undefined,
    phash: hero.phash ?? undefined,
    rounds: rounds.map((round) => toRoundSidecar(round, includeResourceUris)),
  });
}

async function writeJsonFile(filePath: string, payload: unknown): Promise<void> {
  await fs.writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

export async function exportInstalledDatabase(
  input: ExportInstalledDatabaseInput = {},
): Promise<ExportInstalledDatabaseResult> {
  const includeResourceUris = input.includeResourceUris ?? false;
  const now = new Date();
  const exportBaseDir = app.isPackaged ? app.getPath("userData") : app.getAppPath();
  const exportDir = path.join(exportBaseDir, "export", toSafeIsoTimestamp(now));

  const rounds = (await getDb().query.round.findMany({
    with: {
      hero: true,
      resources: true,
    },
    orderBy: [asc(round.createdAt), asc(round.id)],
  })) as SidecarRound[];

  await fs.mkdir(exportDir, { recursive: true });

  const standaloneRounds = rounds.filter((round) => !round.heroId || !round.hero);
  const heroGroups = new Map<string, { hero: NonNullable<SidecarRound["hero"]>; rounds: SidecarRound[] }>();
  for (const round of rounds) {
    if (!round.heroId || !round.hero) continue;
    const existing = heroGroups.get(round.heroId);
    if (existing) {
      existing.rounds.push(round);
      continue;
    }
    heroGroups.set(round.heroId, { hero: round.hero, rounds: [round] });
  }

  let roundFiles = 0;
  for (const round of standaloneRounds) {
    const sidecar = toRoundSidecar(round, includeResourceUris);
    const fileName = `${toSlug(round.name)}__${round.id}.round`;
    await writeJsonFile(path.join(exportDir, fileName), sidecar);
    roundFiles += 1;
  }

  let heroFiles = 0;
  for (const [heroId, entry] of heroGroups) {
    const sidecar = toHeroSidecar(entry.hero, entry.rounds, includeResourceUris);
    const fileName = `${toSlug(entry.hero.name)}__${heroId}.hero`;
    await writeJsonFile(path.join(exportDir, fileName), sidecar);
    heroFiles += 1;
  }

  return {
    exportDir,
    heroFiles,
    roundFiles,
    exportedRounds: rounds.length,
    includeResourceUris,
  };
}
