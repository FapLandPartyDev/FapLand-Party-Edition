import fs from "node:fs/promises";
import path from "node:path";
import { ZHeroSidecar, ZRoundSidecar } from "../../src/zod/installSidecar";
import { getDb } from "./db";
import { resolveInstallExportBaseDir } from "./appPaths";
import { asc } from "drizzle-orm";
import { round } from "./db/schema";
import { parseOptionalRoundCutRangesJson } from "../../src/utils/roundCuts";
import { exportSource } from "./acquisition";
import type { acquisitionSource } from "./db/schema";
export type RoundType = "Normal" | "Interjection" | "Cum";

export type ExportInstalledDatabaseInput = {
  includeResourceUris?: boolean;
  includeAcquisitionSources?: boolean;
};

export type ExportInstalledDatabaseResult = {
  exportDir: string;
  heroFiles: number;
  roundFiles: number;
  exportedRounds: number;
  includeResourceUris: boolean;
  acquisitionSources: number;
};

type SidecarResource = {
  videoUri: string;
  funscriptUri: string | null | undefined;
  funscriptOffsetMs?: number | null;
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
  cutRangesJson?: string | null;
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
  acquisitionCandidates?: Array<{
    sourceId: string;
    sourcePath: string;
    source: typeof acquisitionSource.$inferSelect;
  }>;
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

function uniqueSources(rounds: SidecarRound[]) {
  const byId = new Map<string, typeof acquisitionSource.$inferSelect>();
  for (const entry of rounds) {
    for (const candidate of entry.acquisitionCandidates ?? [])
      byId.set(candidate.sourceId, candidate.source);
  }
  return [...byId.values()].map(exportSource);
}

function toRoundSidecar(
  round: SidecarRound,
  includeResourceUris: boolean,
  includeAcquisitionSources: boolean,
  standalone = false
) {
  const candidates = includeAcquisitionSources
    ? (round.acquisitionCandidates ?? []).map((candidate) => ({
        sourceId: candidate.sourceId,
        filePath: candidate.sourcePath,
      }))
    : [];
  return ZRoundSidecar.parse({
    name: round.name,
    author: round.author ?? undefined,
    description: round.description ?? undefined,
    bpm: round.bpm ?? undefined,
    difficulty: round.difficulty ?? undefined,
    phash: round.phash ?? undefined,
    startTime: round.startTime ?? undefined,
    endTime: round.endTime ?? undefined,
    cutRanges: parseOptionalRoundCutRangesJson(round.cutRangesJson, round.startTime, round.endTime),
    type: round.type,
    resources: includeResourceUris
      ? round.resources.map((resource) => ({
          videoUri: resource.videoUri,
          funscriptUri: resource.funscriptUri ?? undefined,
          funscriptOffsetMs: resource.funscriptOffsetMs ?? undefined,
        }))
      : [],
    ...(standalone && candidates.length > 0
      ? {
          acquisition: {
            version: 1,
            sources: uniqueSources([round]),
            candidates,
          },
        }
      : {}),
  });
}

function toHeroSidecar(
  hero: NonNullable<SidecarRound["hero"]>,
  rounds: SidecarRound[],
  includeResourceUris: boolean,
  includeAcquisitionSources: boolean
) {
  const sources = includeAcquisitionSources ? uniqueSources(rounds) : [];
  return ZHeroSidecar.parse({
    name: hero.name,
    author: hero.author ?? undefined,
    description: hero.description ?? undefined,
    phash: hero.phash ?? undefined,
    ...(sources.length > 0 ? { acquisition: { version: 1, sources } } : {}),
    rounds: rounds.map((round) => ({
      ...toRoundSidecar(round, includeResourceUris, false),
      ...(includeAcquisitionSources && (round.acquisitionCandidates?.length ?? 0) > 0
        ? {
            acquisitionCandidates: (round.acquisitionCandidates ?? []).map((candidate) => ({
              sourceId: candidate.sourceId,
              filePath: candidate.sourcePath,
            })),
          }
        : {}),
    })),
  });
}

async function writeJsonFile(filePath: string, payload: unknown): Promise<void> {
  await fs.writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

export async function exportInstalledDatabase(
  input: ExportInstalledDatabaseInput = {}
): Promise<ExportInstalledDatabaseResult> {
  const includeResourceUris = input.includeResourceUris ?? false;
  const includeAcquisitionSources = input.includeAcquisitionSources ?? true;
  const now = new Date();
  const exportDir = path.join(resolveInstallExportBaseDir(), toSafeIsoTimestamp(now));

  const rounds = (await getDb().query.round.findMany({
    with: {
      hero: true,
      resources: true,
      acquisitionCandidates: { with: { source: true } },
    },
    orderBy: [asc(round.createdAt), asc(round.id)],
  })) as SidecarRound[];

  await fs.mkdir(exportDir, { recursive: true });

  const standaloneRounds = rounds.filter((round) => !round.heroId || !round.hero);
  const heroGroups = new Map<
    string,
    { hero: NonNullable<SidecarRound["hero"]>; rounds: SidecarRound[] }
  >();
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
    const sidecar = toRoundSidecar(round, includeResourceUris, includeAcquisitionSources, true);
    const fileName = `${toSlug(round.name)}__${round.id}.round`;
    await writeJsonFile(path.join(exportDir, fileName), sidecar);
    roundFiles += 1;
  }

  let heroFiles = 0;
  for (const [heroId, entry] of heroGroups) {
    const sidecar = toHeroSidecar(
      entry.hero,
      entry.rounds,
      includeResourceUris,
      includeAcquisitionSources
    );
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
    acquisitionSources: includeAcquisitionSources ? uniqueSources(rounds).length : 0,
  };
}
