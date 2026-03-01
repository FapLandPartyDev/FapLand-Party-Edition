import type { InstalledRound } from "../db";
import {
  analyzePlaylistResolution,
  applyPlaylistResolutionMapping,
  collectPlaylistRefs,
  type PlaylistResolutionAnalysis,
  type PlaylistResolutionIssue,
  type PlaylistResolutionSuggestion,
} from "../../game/playlistResolution";
import {
  type PlaylistConfig,
  ZPlaylistConfig,
} from "../../game/playlistSchema";
import { resolvePortableRoundRef } from "../../game/playlistRuntime";

export type PlaylistConflictSuggestion = PlaylistResolutionSuggestion;

export type PlaylistConflict = PlaylistResolutionIssue;

export type PlaylistResolutionReport = PlaylistResolutionAnalysis & {
  mapping: Record<string, string>;
  unresolved: PlaylistConflict[];
};

export type MultiplayerPlaylistSnapshot = {
  config: PlaylistConfig;
  difficultyHintsByRefKey: Record<string, number | null>;
  exportedAt: string;
};

export function extractPlaylistConfigFromSnapshot(snapshot: unknown): PlaylistConfig {
  if (snapshot && typeof snapshot === "object" && "config" in snapshot) {
    return ZPlaylistConfig.parse((snapshot as { config: unknown }).config);
  }

  return ZPlaylistConfig.parse(snapshot);
}

export function extractDifficultyHintsFromSnapshot(snapshot: unknown): Record<string, number | null> {
  if (!snapshot || typeof snapshot !== "object") return {};
  if (!("difficultyHintsByRefKey" in snapshot)) return {};

  const raw = (snapshot as { difficultyHintsByRefKey: unknown }).difficultyHintsByRefKey;
  if (!raw || typeof raw !== "object") return {};

  return Object.entries(raw as Record<string, unknown>).reduce<Record<string, number | null>>((acc, [key, value]) => {
    if (typeof value === "number" && Number.isFinite(value)) {
      acc[key] = value;
      return acc;
    }

    acc[key] = null;
    return acc;
  }, {});
}

export function buildMultiplayerPlaylistSnapshot(config: PlaylistConfig, installedRounds: InstalledRound[]): MultiplayerPlaylistSnapshot {
  const difficultyHintsByRefKey = collectPlaylistRefs(config).reduce<Record<string, number | null>>((acc, entry) => {
    const resolved = resolvePortableRoundRef(entry.ref, installedRounds);
    acc[entry.key] = typeof resolved?.difficulty === "number" ? resolved.difficulty : null;
    return acc;
  }, {});

  return {
    config,
    difficultyHintsByRefKey,
    exportedAt: new Date().toISOString(),
  };
}

export function resolvePlaylistConflicts(
  snapshot: unknown,
  installedRounds: InstalledRound[],
): PlaylistResolutionReport {
  const config = extractPlaylistConfigFromSnapshot(snapshot);
  const difficultyHints = extractDifficultyHintsFromSnapshot(snapshot);
  const analysis = analyzePlaylistResolution(config, installedRounds, {
    difficultyHintsByRefKey: difficultyHints,
  });

  return {
    ...analysis,
    mapping: {
      ...analysis.exactMapping,
      ...analysis.suggestedMapping,
    },
    unresolved: analysis.issues.filter((issue) => issue.kind === "missing"),
  };
}

export function applyMultiplayerPlaylistResolution(
  snapshot: unknown,
  mapping: Record<string, string | null | undefined>,
  installedRounds: InstalledRound[],
): PlaylistConfig {
  const config = extractPlaylistConfigFromSnapshot(snapshot);
  return applyPlaylistResolutionMapping(config, mapping, installedRounds);
}

export function resolveMultiplayerRoundByMappedKey(
  snapshot: unknown,
  key: string,
  mapping: Record<string, string | null | undefined>,
  installedRounds: InstalledRound[],
): InstalledRound | null {
  const resolvedConfig = applyMultiplayerPlaylistResolution(snapshot, mapping, installedRounds);
  const analysis = analyzePlaylistResolution(resolvedConfig, installedRounds);
  const roundId = analysis.exactMapping[key];
  if (roundId) {
    return installedRounds.find((round) => round.id === roundId) ?? null;
  }

  const issue = analysis.issues.find((entry) => entry.key === key);
  if (!issue) return null;
  return resolvePortableRoundRef(issue.ref, installedRounds);
}
