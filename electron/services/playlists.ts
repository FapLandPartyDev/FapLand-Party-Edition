import fs from "node:fs/promises";
import path from "node:path";
import {
  CURRENT_PLAYLIST_VERSION,
  ZPlaylistConfig,
  ZPlaylistEnvelopeV1,
  type PlaylistConfig,
} from "../../src/game/playlistSchema";
import {
  analyzePlaylistResolution,
  applyPlaylistResolutionMapping,
  resolveRoundPhash,
  type PlaylistResolutionAnalysis,
} from "../../src/game/playlistResolution";
import { approveDialogPath, assertApprovedDialogPath } from "./dialogPathApproval";
import { getDb } from "./db";
import { eq, desc, isNotNull, and } from "drizzle-orm";
import { playlist, playlistTrackPlay, round } from "./db/schema";
import { getStore } from "./store";
import { isPackageRelativeMediaPath, toLocalMediaUri } from "./localMedia";

const ACTIVE_PLAYLIST_STORE_KEY = "game.playlist.activeId";

export type PlaylistRecord = {
  id: string;
  name: string;
  description: string | null;
  formatVersion: number;
  config: PlaylistConfig;
  installSourceKey: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export type PlaylistImportAnalysis = {
  metadata: {
    name: string;
    description: string | null;
    exportedAt: string | null;
  };
  config: PlaylistConfig;
  resolution: PlaylistResolutionAnalysis;
};

export type PlaylistImportReport = PlaylistResolutionAnalysis & {
  appliedMapping: Record<string, string>;
};

function parseConfigJson(raw: string): PlaylistConfig {
  const parsed = JSON.parse(raw) as unknown;
  return ZPlaylistConfig.parse(parsed);
}

function serializeConfig(config: PlaylistConfig): string {
  const normalized = ZPlaylistConfig.parse(config);
  return JSON.stringify(normalized);
}

function rowToRecord(row: {
  id: string;
  name: string;
  description: string | null;
  formatVersion: number;
  configJson: string;
  installSourceKey: string | null;
  createdAt: Date;
  updatedAt: Date;
}): PlaylistRecord {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    formatVersion: row.formatVersion,
    config: parseConfigJson(row.configJson),
    installSourceKey: row.installSourceKey,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

async function loadInstalledRounds() {
  return await getDb().query.round.findMany({
    with: { resources: true },
  });
}

async function readPlaylistImportAnalysis(filePath: string): Promise<PlaylistImportAnalysis> {
  const approvedPath = assertApprovedDialogPath("playlistImportFile", filePath);
  approveDialogPath("playlistImportFile", approvedPath);
  const content = await fs.readFile(approvedPath, "utf8");
  const raw = JSON.parse(content) as unknown;
  const parsed = ZPlaylistEnvelopeV1.parse(raw);
  const config = resolvePlaylistRelativeMedia(parsed.config, path.dirname(approvedPath));
  const installedRounds = await loadInstalledRounds();
  const resolution = analyzePlaylistResolution(config, installedRounds);

  return {
    metadata: {
      name: parsed.metadata.name,
      description: parsed.metadata.description ?? null,
      exportedAt: parsed.metadata.exportedAt ?? null,
    },
    config,
    resolution,
  };
}

function resolvePlaylistRelativeMedia(
  config: PlaylistConfig,
  playlistDirectory: string
): PlaylistConfig {
  let result = config;

  if (result.boardConfig.mode === "graph") {
    const background = result.boardConfig.style?.background;
    if (background && isPackageRelativeMediaPath(background.uri)) {
      result = {
        ...result,
        boardConfig: {
          ...result.boardConfig,
          style: {
            ...result.boardConfig.style,
            background: {
              ...background,
              uri: toLocalMediaUri(path.resolve(playlistDirectory, background.uri)),
            },
          },
        },
      };
    }
  }

  if (result.music && result.music.tracks.length > 0) {
    const resolvedTracks = result.music.tracks.map((track) => {
      if (isPackageRelativeMediaPath(track.uri)) {
        return {
          ...track,
          uri: toLocalMediaUri(path.resolve(playlistDirectory, track.uri)),
        };
      }
      return track;
    });
    result = {
      ...result,
      music: {
        ...result.music,
        tracks: resolvedTracks,
      },
    };
  }

  return result;
}

async function createDefaultConfigFromInstalledRounds(): Promise<PlaylistConfig> {
  const rounds = await getDb().query.round.findMany({
    with: { resources: true },
    orderBy: [desc(round.createdAt)],
  });

  const normalRoundOrder = rounds
    .filter((round) => round.type === "Normal")
    .map((round) => ({
      idHint: round.id,
      installSourceKeyHint: round.installSourceKey ?? undefined,
      phash: resolveRoundPhash(round) ?? undefined,
      name: round.name,
      author: round.author ?? undefined,
      type: "Normal" as const,
    }));

  const cumRoundRefs = rounds
    .filter((round) => round.type === "Cum")
    .map((round) => ({
      idHint: round.id,
      installSourceKeyHint: round.installSourceKey ?? undefined,
      phash: resolveRoundPhash(round) ?? undefined,
      name: round.name,
      author: round.author ?? undefined,
      type: "Cum" as const,
    }));

  return ZPlaylistConfig.parse({
    playlistVersion: CURRENT_PLAYLIST_VERSION,
    boardConfig: {
      mode: "linear",
      totalIndices: 100,
      safePointIndices: [25, 50, 75],
      normalRoundRefsByIndex: {},
      normalRoundOrder,
      cumRoundRefs,
    },
    perkSelection: {
      optionsPerPick: 3,
      triggerChancePerCompletedRound: 0.51,
    },
    perkPool: {
      enabledPerkIds: [],
      enabledAntiPerkIds: [],
    },
    probabilityScaling: {
      initialIntermediaryProbability: 0.1,
      initialAntiPerkProbability: 0.1,
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
      scorePerCumRoundSuccess: 120,
    },
  });
}

export async function listPlaylists(): Promise<PlaylistRecord[]> {
  const rows = await getDb().query.playlist.findMany({ orderBy: [desc(playlist.updatedAt)] });
  return rows.map(rowToRecord);
}

export async function getPlaylistById(playlistId: string): Promise<PlaylistRecord | null> {
  const row = await getDb().query.playlist.findFirst({ where: eq(playlist.id, playlistId) });
  return row ? rowToRecord(row) : null;
}

export async function createPlaylist(input: {
  name: string;
  description?: string | null;
  config?: unknown;
  installSourceKey?: string | null;
}): Promise<PlaylistRecord> {
  const config = input.config
    ? ZPlaylistConfig.parse(input.config)
    : await createDefaultConfigFromInstalledRounds();

  const [created] = await getDb()
    .insert(playlist)
    .values({
      name: input.name.trim(),
      description: input.description?.trim() || null,
      formatVersion: 1,
      configJson: serializeConfig(config),
      installSourceKey: input.installSourceKey ?? null,
    })
    .returning();

  return rowToRecord(created);
}

export async function updatePlaylist(input: {
  playlistId: string;
  name?: string;
  description?: string | null;
  config?: unknown;
}): Promise<PlaylistRecord> {
  const nextData: Partial<typeof playlist.$inferInsert> = { updatedAt: new Date() };

  if (typeof input.name === "string") {
    nextData.name = input.name.trim();
  }
  if (input.description !== undefined) {
    nextData.description = input.description?.trim() || null;
  }
  if (input.config !== undefined) {
    nextData.configJson = serializeConfig(ZPlaylistConfig.parse(input.config));
  }

  const [updated] = await getDb()
    .update(playlist)
    .set(nextData)
    .where(eq(playlist.id, input.playlistId))
    .returning();

  return rowToRecord(updated);
}

export async function duplicatePlaylist(playlistId: string): Promise<PlaylistRecord> {
  const source = await getDb().query.playlist.findFirst({ where: eq(playlist.id, playlistId) });
  if (!source) throw new Error("Playlist not found.");

  const [duplicated] = await getDb()
    .insert(playlist)
    .values({
      name: `${source.name} (Copy)`,
      description: source.description,
      formatVersion: source.formatVersion,
      configJson: source.configJson,
    })
    .returning();

  return rowToRecord(duplicated);
}

export async function deletePlaylist(playlistId: string): Promise<void> {
  await getDb().delete(playlist).where(eq(playlist.id, playlistId));

  const active = getStore().get(ACTIVE_PLAYLIST_STORE_KEY);
  if (active === playlistId) {
    const fallback = await getDb().query.playlist.findFirst({
      orderBy: [desc(playlist.updatedAt)],
    });
    getStore().set(ACTIVE_PLAYLIST_STORE_KEY, fallback?.id ?? null);
  }
}

export async function getActivePlaylist(): Promise<PlaylistRecord | null> {
  const activeId = getStore().get(ACTIVE_PLAYLIST_STORE_KEY);

  if (typeof activeId === "string" && activeId.length > 0) {
    const active = await getPlaylistById(activeId);
    if (active) return active;
  }

  const fallback = await getDb().query.playlist.findFirst({ orderBy: [desc(playlist.updatedAt)] });
  if (!fallback) {
    getStore().set(ACTIVE_PLAYLIST_STORE_KEY, null);
    return null;
  }

  const nextActive = rowToRecord(fallback);
  getStore().set(ACTIVE_PLAYLIST_STORE_KEY, nextActive.id);
  return nextActive;
}

export async function setActivePlaylist(playlistId: string): Promise<PlaylistRecord> {
  const playlist = await getPlaylistById(playlistId);
  if (!playlist) {
    throw new Error("Playlist not found.");
  }

  getStore().set(ACTIVE_PLAYLIST_STORE_KEY, playlist.id);
  return playlist;
}

export async function analyzePlaylistImportFile(filePath: string): Promise<PlaylistImportAnalysis> {
  return await readPlaylistImportAnalysis(filePath);
}

export async function importPlaylistFromFile(input: {
  filePath: string;
  manualMappingByRefKey?: Record<string, string | null | undefined>;
  installSourceKey?: string | null;
}): Promise<{ playlist: PlaylistRecord; report: PlaylistImportReport }> {
  const analysis = await readPlaylistImportAnalysis(input.filePath);
  const installedRounds = await loadInstalledRounds();

  const combinedMapping: Record<string, string> = {
    ...analysis.resolution.exactMapping,
    ...analysis.resolution.suggestedMapping,
  };

  for (const [key, value] of Object.entries(input.manualMappingByRefKey ?? {})) {
    if (value === null) {
      delete combinedMapping[key];
      continue;
    }
    if (typeof value === "string" && value.trim().length > 0) {
      combinedMapping[key] = value;
    }
  }

  const resolvedConfig = applyPlaylistResolutionMapping(
    analysis.config,
    combinedMapping,
    installedRounds
  );

  const installSourceKey = input.installSourceKey ?? null;
  if (installSourceKey) {
    const existing = await getDb().query.playlist.findFirst({
      where: eq(playlist.installSourceKey, installSourceKey),
    });

    if (existing) {
      const updated = await updatePlaylist({
        playlistId: existing.id,
        name: analysis.metadata.name,
        description: analysis.metadata.description,
        config: resolvedConfig,
      });

      return {
        playlist: updated,
        report: {
          ...analysis.resolution,
          appliedMapping: combinedMapping,
        },
      };
    }
  }

  const created = await createPlaylist({
    name: analysis.metadata.name,
    description: analysis.metadata.description,
    config: resolvedConfig,
    installSourceKey,
  });

  return {
    playlist: created,
    report: {
      ...analysis.resolution,
      appliedMapping: combinedMapping,
    },
  };
}

export async function exportPlaylistToFile(input: {
  playlistId: string;
  filePath: string;
}): Promise<void> {
  const approvedPath = assertApprovedDialogPath("playlistExportFile", input.filePath);
  const playlist = await getPlaylistById(input.playlistId);
  if (!playlist) {
    throw new Error("Playlist not found.");
  }

  const payload = ZPlaylistEnvelopeV1.parse({
    format: "f-land.playlist",
    version: 1,
    metadata: {
      name: playlist.name,
      description: playlist.description ?? undefined,
      exportedAt: new Date().toISOString(),
    },
    config: playlist.config,
  });

  const directory = path.dirname(approvedPath);
  await fs.mkdir(directory, { recursive: true });
  await fs.writeFile(approvedPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

export async function recordPlaylistTrackPlay(input: {
  playlistId: string;
  roundId: string;
  nodeId?: string | null;
  poolId?: string | null;
}): Promise<void> {
  await getDb()
    .insert(playlistTrackPlay)
    .values({
      playlistId: input.playlistId,
      roundId: input.roundId,
      nodeId: input.nodeId ?? null,
      poolId: input.poolId ?? null,
    });
}

export async function getDistinctPlayedByPool(
  playlistId: string
): Promise<Record<string, string[]>> {
  // Drizzle doesn't have a direct equivalent for distinct ON specific columns out of the box with the query API yet.
  // We can just fetch them and distinct in-memory, or use the query builder.
  const rows = await getDb()
    .select({ poolId: playlistTrackPlay.poolId, roundId: playlistTrackPlay.roundId })
    .from(playlistTrackPlay)
    .where(and(eq(playlistTrackPlay.playlistId, playlistId), isNotNull(playlistTrackPlay.poolId)));

  const distinctPairs = new Set<string>();
  const distinctRows: Array<{ poolId: string; roundId: string }> = [];
  for (const row of rows) {
    if (!row.poolId) continue;
    const key = `${row.poolId}|${row.roundId}`;
    if (!distinctPairs.has(key)) {
      distinctPairs.add(key);
      distinctRows.push({ poolId: row.poolId, roundId: row.roundId });
    }
  }

  return distinctRows.reduce<Record<string, string[]>>((acc, row) => {
    if (!row.poolId) return acc;
    acc[row.poolId] = [...(acc[row.poolId] ?? []), row.roundId];
    return acc;
  }, {});
}

export async function getPlaylistPlayHistory(playlistId: string): Promise<
  Array<{
    id: string;
    roundId: string;
    nodeId: string | null;
    poolId: string | null;
    playedAt: Date;
  }>
> {
  return getDb().query.playlistTrackPlay.findMany({
    where: eq(playlistTrackPlay.playlistId, playlistId),
    columns: {
      id: true,
      roundId: true,
      nodeId: true,
      poolId: true,
      playedAt: true,
    },
    orderBy: [desc(playlistTrackPlay.playedAt)],
  });
}
