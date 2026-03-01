import type { InstalledRoundMediaResources } from "@/services/db";
import type { InstalledRoundCardAssets } from "@/services/db";
import type { RoundEditDraft, RoundLibraryEntry, HeroEditDraft } from "./types";
import { ROUND_DATE_FORMATTER } from "./constants";

export function isJsdomRuntime(): boolean {
  return typeof window !== "undefined" && /jsdom/i.test(window.navigator.userAgent);
}

export function reloadUiAfterHeroGroupConversion(): void {
  if (typeof window === "undefined") return;
  if (isJsdomRuntime()) return;
  window.location.reload();
}

export function getResourceFunscriptState(
  resource:
    | { funscriptUri?: string | null; hasFunscript?: boolean }
    | undefined
    | null
): { hasFunscript: boolean; funscriptUri: string | null } {
  if (!resource) return { hasFunscript: false, funscriptUri: null };
  const funscriptUri =
    "funscriptUri" in resource && typeof resource.funscriptUri === "string"
      ? resource.funscriptUri
      : null;
  return {
    hasFunscript:
      Boolean(funscriptUri) || ("hasFunscript" in resource && resource.hasFunscript === true),
    funscriptUri,
  };
}

export function roundHasPlayableResource(round: RoundLibraryEntry): boolean {
  return round.resources.length > 0;
}

export function roundHasFunscript(round: RoundLibraryEntry): boolean {
  return getResourceFunscriptState(round.resources[0]).hasFunscript;
}

export function isTemplateRound(round: RoundLibraryEntry): boolean {
  return round.resources.length === 0;
}

export function toRoundEditDraft(
  round: RoundLibraryEntry,
  mediaResources?: InstalledRoundMediaResources | null
): RoundEditDraft {
  const primaryResource = mediaResources?.resources[0] ?? round.resources[0] ?? null;
  const { funscriptUri } = getResourceFunscriptState(primaryResource ?? undefined);
  return {
    id: round.id,
    name: round.name,
    author: round.author ?? "",
    description: round.description ?? "",
    tagsText: (round.tags ?? []).join(", "),
    libraryLabel: round.libraryLabel ?? "",
    bpm: round.bpm == null ? "" : `${round.bpm}`,
    difficulty: round.difficulty == null ? "" : `${round.difficulty}`,
    startTime: round.startTime == null ? "" : `${round.startTime}`,
    endTime: round.endTime == null ? "" : `${round.endTime}`,
    type: round.type ?? "Normal",
    resourceId: primaryResource?.id ?? null,
    funscriptUri,
    funscriptOffsetMs:
      (primaryResource as { funscriptOffsetMs?: number | null } | null)?.funscriptOffsetMs == null
        ? ""
        : `${(primaryResource as { funscriptOffsetMs?: number | null }).funscriptOffsetMs}`,
    invertFunscript:
      (primaryResource as { invertFunscript?: boolean } | null)?.invertFunscript ?? false,
    excludeFromRandom: round.excludeFromRandom ?? false,
  };
}

export function toHeroEditDraft(
  round: RoundLibraryEntry,
  mediaResources?: InstalledRoundMediaResources | null
): HeroEditDraft | null {
  if (!round.heroId || !round.hero) return null;
  const primaryResource = mediaResources?.resources[0] ?? round.resources[0] ?? null;
  const { funscriptUri } = getResourceFunscriptState(primaryResource ?? undefined);
  return {
    id: round.heroId,
    name: round.hero.name ?? "",
    author: round.hero.author ?? "",
    description: round.hero.description ?? "",
    tagsText: (round.hero.tags ?? []).join(", "),
    funscriptUri,
    funscriptDirty: false,
  };
}

export function parseTagsInput(value: string): string[] {
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

export function parseOptionalInteger(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed)) return Number.NaN;
  return Math.max(0, Math.round(parsed));
}

export function parseOptionalSignedInteger(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed)) return Number.NaN;
  return parsed;
}

export function parseOptionalFloat(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed)) return Number.NaN;
  return parsed;
}

export function normalizeHttpUrl(value: string): string | null {
  try {
    const parsed = new URL(value.trim());
    if (!(parsed.protocol === "http:" || parsed.protocol === "https:")) {
      return null;
    }
    return parsed.toString();
  } catch {
    return null;
  }
}

export function pickHeroGroupRoundToKeep<TRound extends RoundLibraryEntry>(
  rounds: TRound[]
): TRound | null {
  if (rounds.length === 0) return null;
  const [first, ...rest] = rounds;
  if (!first) return null;
  return rest.reduce((best, current) => {
    const bestCreated = new Date(best.createdAt).getTime();
    const currentCreated = new Date(current.createdAt).getTime();
    if (currentCreated !== bestCreated) {
      return currentCreated < bestCreated ? current : best;
    }
    return current.id < best.id ? current : best;
  }, first);
}

export function formatDate(value: Date | string): string {
  if (typeof value === "string") {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
    if (match) {
      return ROUND_DATE_FORMATTER.format(
        new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
      );
    }
  }
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return typeof value === "string" ? value : "";
  return ROUND_DATE_FORMATTER.format(date);
}

export function formatMediaTimestamp(valueMs: number): string {
  const totalSeconds = Math.max(0, Math.floor(valueMs / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }

  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

type Translator = (template: TemplateStringsArray, ...expressions: unknown[]) => string;

export function formatWindow(
  startTime: number | null,
  endTime: number | null,
  t: Translator
): string {
  if (typeof startTime !== "number" || !Number.isFinite(startTime)) {
    return t`Full`;
  }
  const startLabel = formatMediaTimestamp(startTime);
  if (typeof endTime !== "number" || !Number.isFinite(endTime) || endTime <= startTime) {
    return `${startLabel}+`;
  }
  return `${startLabel}-${formatMediaTimestamp(endTime)}`;
}

export function formatEta(
  ms: number | null | undefined,
  t: Translator
): string {
  if (ms === null || ms === undefined) return "";
  const totalSeconds = Math.round(ms / 1000);
  if (totalSeconds <= 0) return "";
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes > 0 ? t`~ ${minutes}m ${seconds}s remaining` : t`~ ${seconds}s remaining`;
}

export function getRoundInstallSourceLabel(
  installSourceKey: string | null | undefined,
  labels: { stash: string; web: string; local: string }
): string {
  if (installSourceKey?.startsWith("stash:")) {
    return labels.stash;
  }

  if (installSourceKey?.startsWith("website:")) {
    return labels.web;
  }

  return labels.local;
}

export function getRoundDisplayType(
  type: string | null | undefined,
  normalLabel: string
): string {
  return typeof type === "string" && type.trim().length > 0 ? type : normalLabel;
}

export function summarizeHeroGroupPreviewState(
  rounds: RoundLibraryEntry[],
  cardAssetsByRoundId: ReadonlyMap<string, InstalledRoundCardAssets>,
  isWebsiteVideoCaching: boolean
): { pendingCacheCount: number; pendingPreviewCount: number } {
  let pendingCacheCount = 0;
  let pendingPreviewCount = 0;

  for (const round of rounds) {
    const cardAssets = cardAssetsByRoundId.get(round.id);
    const cacheStatus = cardAssets?.websiteVideoCacheStatus ?? "not_applicable";
    if (cacheStatus === "pending") {
      pendingCacheCount += 1;
      continue;
    }

    const isWebsiteRound = round.installSourceKey?.startsWith("website:") ?? false;
    if (isWebsiteVideoCaching && isWebsiteRound && cardAssets != null && !cardAssets.previewImage) {
      pendingPreviewCount += 1;
    }
  }

  return { pendingCacheCount, pendingPreviewCount };
}
