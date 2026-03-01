import crypto from "node:crypto";
import type { Dirent } from "node:fs";
import fs from "node:fs/promises";
import { availableParallelism } from "node:os";
import path from "node:path";
import { ZodError } from "zod";
import { isVideoExtension } from "../../src/constants/videoFormats";
import { type PortableRoundRef } from "../../src/game/playlistSchema";
import {
  findBestSimilarPhashMatch,
  normalizePhashForSimilarity,
} from "../../src/utils/phashSimilarity";
import {
  ZHeroSidecar,
  ZRoundSidecar,
  type InstallResource,
  type InstallRound,
} from "../../src/zod/installSidecar";
import { ensureFpackExtracted, inspectFpack, type FpackExtractionManifest } from "./fpack";
import { approveDialogPath, assertApprovedDialogPath } from "./dialogPathApproval";
import { getDb } from "./db";
import { eq, asc, isNotNull } from "drizzle-orm";
import { hero, round, resource } from "./db/schema";
import {
  fromLocalMediaUri,
  isPackageRelativeMediaPath,
  resolveSidecarMediaPath,
  toLocalMediaUri,
} from "./localMedia";
export type RoundType = "Normal" | "Interjection" | "Cum";
type TransactionClient = Parameters<Parameters<ReturnType<typeof getDb>["transaction"]>[0]>[0];
import {
  generateVideoPhash,
  generateVideoPhashForNormalizedRange,
  getNormalizedVideoHashRange,
  toVideoHashRangeCacheKey,
  type NormalizedVideoHashRange,
} from "./phash";
import { getStore } from "./store";
import { syncExternalSources } from "./integrations";
import { importPlaylistFromFile } from "./playlists";
import { generateRoundPreviewImageDataUri } from "./roundPreview";
import { resolveVideoDurationMsForLocalPath } from "./videoDuration";
import { calculateFunscriptDifficultyFromUri } from "./funscript";
import {
  classifyTrustedUrl,
  collectUnknownRemoteSitesFromResources,
  type ImportSecurityWarning,
  type InstallSidecarSecurityAnalysis,
} from "./security";
import { parseWebsiteVideoProxyUri } from "./webVideo";
import { startWebsiteVideoScan } from "./webVideoScanService";
import {
  getPortableDataRelativePath,
  normalizeUserDataSuffix,
  resolvePortableMovedDataPath,
} from "./portable";

const AUTO_SCAN_FOLDERS_KEY = "install.autoScanFolders";
const MAX_TRACKED_ERRORS = 50;
const SIDECAR_EXTENSIONS = new Set([".round", ".hero", ".fplay"]);
const SIDECAR_AND_FPACK_EXTENSIONS = new Set([".round", ".hero", ".fplay", ".fpack"]);

export function isSupportedVideoFileExtension(extension: string): boolean {
  return isVideoExtension(extension);
}

type PreparedResource = {
  videoUri: string;
  funscriptUri: string | null;
  phash: string | null;
  durationMs: number | null;
};

type PreparedRoundResources = {
  resources: PreparedResource[];
  computedRoundPhash: string | null;
  previewImage: string | null;
};

type PrepareMediaOptions = {
  deferPhash?: boolean;
  deferPreview?: boolean;
  deferDuration?: boolean;
  lowPriorityMedia?: boolean;
};

const DEFAULT_PREPARE_MEDIA_OPTIONS: Required<PrepareMediaOptions> = {
  deferPhash: false,
  deferPreview: false,
  deferDuration: false,
  lowPriorityMedia: false,
};

const LEGACY_PREPARE_MEDIA_OPTIONS: Required<PrepareMediaOptions> = {
  deferPhash: true,
  deferPreview: true,
  deferDuration: true,
  lowPriorityMedia: true,
};

type HeroMetadataInput = {
  name: string;
  author?: string | null;
  description?: string | null;
  phash?: string | null;
};

type SidecarRoundData = {
  name: string;
  author: string | null;
  description: string | null;
  bpm: number | null;
  difficulty: number | null;
  phash: string | null;
  startTime: number | null;
  endTime: number | null;
  type: RoundType;
  excludeFromRandom?: boolean;
  resources: InstallResource[];
};

type VideoRangeResolution = {
  normalizedPath: string;
  normalizedRange: NormalizedVideoHashRange | null;
  normalizedStartTimeMs?: number;
  normalizedEndTimeMs?: number;
  cacheKey: string;
};

type ExistingHeroCacheEntry = {
  id: string;
  author: string | null;
  description: string | null;
  phash: string | null;
};

type ExistingRoundCacheEntry = {
  id: string;
  previewImage: string | null;
  heroId?: string | null;
  name?: string | null;
  phash?: string | null;
};

type SimilarPhashCandidate = {
  roundId?: string | null;
  videoUri: string;
  funscriptUri?: string | null;
  durationMs?: number | null;
  phash: string;
};

type ExistingTemplateRoundCandidate = {
  id: string;
  heroId: string | null;
  name: string;
  phash: string | null;
  installSourceKey: string | null;
  createdAt: Date;
  updatedAt: Date;
};

type ExistingHeroGroupRound = {
  id: string;
  name: string;
  heroId: string | null;
  phash: string | null;
  createdAt: Date;
  updatedAt: Date;
  resources: PreparedResource[];
};

type PreparedRoundWrite = {
  installSourceKey: string;
  round: SidecarRoundData;
  resources: PreparedResource[];
  previewImage: string | null;
  unresolved: boolean;
};

type PreparedInstallEntry =
  | { kind: "hero_round"; heroInput: HeroMetadataInput | null; writes: PreparedRoundWrite[] }
  | { kind: "playlist"; filePath: string; installSourceKeyOverride?: string };

type SidecarSourceMetadata = {
  sourceKind: "filesystem" | "fpack";
  archiveEntryPath?: string;
};

type ImportedSidecarDescriptor = {
  sidecarPath: string;
  source: SidecarSourceMetadata;
};

type InstallSessionContext = {
  db: ReturnType<typeof getDb>;
  heroByName: Map<string, ExistingHeroCacheEntry>;
  roundByInstallSourceKey: Map<string, ExistingRoundCacheEntry>;
  exactVideoUriByPhash: Map<string, string>;
  exactResourceByPhash: Map<string, PreparedResource>;
  similarPhashCandidates: SimilarPhashCandidate[];
  templateRounds: ExistingTemplateRoundCandidate[];
  heroById: Map<string, ExistingHeroCacheEntry & { name: string }>;
  hashCache: Map<string, Promise<string>>;
  previewCache: Map<string, Promise<string | null>>;
  normalizedRangeCache: Map<string, Promise<VideoRangeResolution>>;
  durationCache: Map<string, Promise<number | null>>;
  prepConcurrency: number;
  allowedBaseDomains: string[];
  securityWarnings: ImportSecurityWarning[];
};

function resolvePrepareMediaOptions(options?: PrepareMediaOptions): Required<PrepareMediaOptions> {
  return { ...DEFAULT_PREPARE_MEDIA_OPTIONS, ...(options ?? {}) };
}

function createAsyncLimiter(limit: number): <T>(task: () => Promise<T>) => Promise<T> {
  const queue: Array<() => void> = [];
  let activeCount = 0;

  const runNext = () => {
    if (activeCount >= limit) return;
    const next = queue.shift();
    if (!next) return;
    activeCount += 1;
    next();
  };

  return async <T>(task: () => Promise<T>): Promise<T> =>
    new Promise<T>((resolve, reject) => {
      queue.push(() => {
        task()
          .then(resolve, reject)
          .finally(() => {
            activeCount -= 1;
            runNext();
          });
      });
      runNext();
    });
}

const runImportMediaWork = createAsyncLimiter(1);

type PreparedLegacyEntry =
  | {
      kind: "checkpoint";
      label: string;
    }
  | {
      kind: "round";
      sourcePath: string;
      write: PreparedRoundWrite;
    };

type IndexedLegacyEntry =
  | {
      kind: "checkpoint";
      label: string;
      index: number;
    }
  | {
      kind: "round";
      write: PreparedRoundWrite;
      index: number;
    };

type PersistedLegacyEntry =
  | {
      kind: "checkpoint";
      label: string;
      index: number;
    }
  | {
      kind: "round";
      write: PreparedRoundWrite;
      index: number;
      persisted: { installed: number; updated: number; roundIds: string[] };
    };

export type InstallScanState = "idle" | "running" | "done" | "aborted" | "error";
export type InstallScanTrigger = "startup" | "manual";
export type InstallScanPhase =
  | "idle"
  | "inspecting-pack"
  | "extracting-pack"
  | "preparing-sidecars"
  | "persisting"
  | "syncing"
  | "done"
  | "aborted"
  | "error";

export type InstallScanPhaseProgress = {
  current: number;
  total: number;
  unit: "files" | "bytes";
};

export type InstallScanStats = {
  scannedFolders: number;
  sidecarsSeen: number;
  totalSidecars: number;
  installed: number;
  playlistsImported: number;
  updated: number;
  skipped: number;
  failed: number;
};

export type InstallScanError = {
  source: string;
  reason: string;
};

export type InstallScanStatus = {
  state: InstallScanState;
  triggeredBy: InstallScanTrigger;
  startedAt: string | null;
  finishedAt: string | null;
  phase: InstallScanPhase;
  phaseProgress: InstallScanPhaseProgress | null;
  stats: InstallScanStats;
  lastMessage: string | null;
  lastErrors: InstallScanError[];
  etaMs: number | null;
  lastPreviewImage: string | null;
  securityWarnings: ImportSecurityWarning[];
};

export type LegacyInstallImport = {
  roundIds: string[];
  playlistNameHint: string;
  orderedSlots: LegacyImportSlot[];
};

export type LegacyImportSlotPreview = {
  id: string;
  sourcePath: string;
  sourceLabel: string;
  originalOrder: number;
  defaultCheckpoint: boolean;
};

export type ReviewedLegacyImportSlot = {
  id: string;
  sourcePath: string;
  originalOrder: number;
  selectedAsCheckpoint: boolean;
  excludedFromImport: boolean;
};

export type InstallFolderInspectionResult =
  | {
      kind: "sidecar";
      folderPath: string;
      playlistNameHint: string;
      sidecarCount: number;
    }
  | {
      kind: "legacy";
      folderPath: string;
      playlistNameHint: string;
      legacySlots: LegacyImportSlotPreview[];
    }
  | {
      kind: "empty";
      folderPath: string;
      playlistNameHint: string;
    };

export type LegacyImportSlot =
  | {
      kind: "round";
      ref: PortableRoundRef;
    }
  | {
      kind: "checkpoint";
      label: string;
      restDurationMs?: number | null;
    };

export type InstallFolderScanResult = {
  status: InstallScanStatus;
  legacyImport?: LegacyInstallImport;
  securityWarnings?: ImportSecurityWarning[];
};

export type AddAutoScanFolderAndScanResult = {
  folders: string[];
  result: InstallFolderScanResult;
};

let activeScanPromise: Promise<InstallScanStatus> | null = null;
let activeManualFolderImport = false;
let abortRequested = false;
let scanStatus: InstallScanStatus = {
  state: "idle",
  triggeredBy: "manual",
  startedAt: null,
  finishedAt: null,
  phase: "idle",
  phaseProgress: null,
  stats: emptyStats(),
  lastMessage: null,
  lastErrors: [],
  etaMs: null,
  lastPreviewImage: null,
  securityWarnings: [],
};

function emptyStats(): InstallScanStats {
  return {
    scannedFolders: 0,
    sidecarsSeen: 0,
    totalSidecars: 0,
    installed: 0,
    playlistsImported: 0,
    updated: 0,
    skipped: 0,
    failed: 0,
  };
}

function formatImportStatsSummary(stats: InstallScanStats): string {
  return `Installed: ${stats.installed}, Playlists imported: ${stats.playlistsImported}, Updated: ${stats.updated}, Failed: ${stats.failed}.`;
}

function cloneStatus(status: InstallScanStatus): InstallScanStatus {
  return JSON.parse(JSON.stringify(status)) as InstallScanStatus;
}

function getPreparationConcurrency(): number {
  try {
    return Math.min(4, Math.max(2, availableParallelism() - 1));
  } catch {
    return 3;
  }
}

async function createInstallSessionContext(
  allowedBaseDomains: string[] = []
): Promise<InstallSessionContext> {
  const db = getDb();
  const [heroes, existingRounds, existingResources, existingTemplateRounds] = await Promise.all([
    db.query.hero.findMany({
      columns: {
        id: true,
        name: true,
        author: true,
        description: true,
        phash: true,
      },
    }),
    db.query.round.findMany({
      where: isNotNull(round.installSourceKey),
      columns: {
        id: true,
        installSourceKey: true,
        previewImage: true,
        heroId: true,
        name: true,
        phash: true,
      },
    }),
    db.query.resource.findMany({
      where: isNotNull(resource.phash),
      orderBy: [asc(resource.createdAt)],
      columns: {
        roundId: true,
        videoUri: true,
        funscriptUri: true,
        phash: true,
        durationMs: true,
      },
    }),
    db.query.round.findMany({
      with: {
        resources: true,
      },
      columns: {
        id: true,
        heroId: true,
        name: true,
        phash: true,
        installSourceKey: true,
        createdAt: true,
        updatedAt: true,
      },
    }),
  ]);

  const heroByName = new Map<string, ExistingHeroCacheEntry>();
  const heroById = new Map<string, ExistingHeroCacheEntry & { name: string }>();
  for (const entry of heroes) {
    heroByName.set(entry.name, {
      id: entry.id,
      author: entry.author,
      description: entry.description,
      phash: entry.phash,
    });
    heroById.set(entry.id, {
      id: entry.id,
      name: entry.name,
      author: entry.author,
      description: entry.description,
      phash: entry.phash,
    });
  }

  const roundByInstallSourceKey = new Map<string, ExistingRoundCacheEntry>();
  for (const entry of existingRounds) {
    const installSourceKey = normalizeText(entry.installSourceKey);
    if (!installSourceKey) continue;
    const existingRound = {
      id: entry.id,
      previewImage: entry.previewImage,
      heroId: entry.heroId,
      name: entry.name,
      phash: entry.phash,
    };
    roundByInstallSourceKey.set(installSourceKey, existingRound);

    const portableAlias = toPortableDataInstallSourceKeyAlias(installSourceKey);
    if (portableAlias && !roundByInstallSourceKey.has(portableAlias)) {
      roundByInstallSourceKey.set(portableAlias, existingRound);
    }
  }

  const exactVideoUriByPhash = new Map<string, string>();
  const exactResourceByPhash = new Map<string, PreparedResource>();
  const similarPhashCandidates: SimilarPhashCandidate[] = [];
  for (const entry of existingResources) {
    const normalizedPhash = normalizeText(entry.phash);
    if (!normalizedPhash) continue;

    if (!exactVideoUriByPhash.has(normalizedPhash)) {
      exactVideoUriByPhash.set(normalizedPhash, entry.videoUri);
    }
    if (!exactResourceByPhash.has(normalizedPhash)) {
      exactResourceByPhash.set(normalizedPhash, {
        videoUri: entry.videoUri,
        funscriptUri: entry.funscriptUri,
        phash: normalizedPhash,
        durationMs: entry.durationMs,
      });
    }

    const normalizedForSimilarity = normalizePhashForSimilarity(normalizedPhash);
    if (normalizedForSimilarity) {
      similarPhashCandidates.push({
        roundId: entry.roundId,
        videoUri: entry.videoUri,
        funscriptUri: entry.funscriptUri,
        durationMs: entry.durationMs,
        phash: normalizedForSimilarity,
      });
    }
  }

  const templateRounds = existingTemplateRounds
    .filter((entry) => entry.resources.length === 0)
    .map((entry) => ({
      id: entry.id,
      heroId: entry.heroId,
      name: entry.name,
      phash: entry.phash,
      installSourceKey: entry.installSourceKey,
      createdAt: entry.createdAt,
      updatedAt: entry.updatedAt,
    }));

  return {
    db,
    heroByName,
    heroById,
    roundByInstallSourceKey,
    exactVideoUriByPhash,
    exactResourceByPhash,
    similarPhashCandidates,
    templateRounds,
    hashCache: new Map(),
    previewCache: new Map(),
    normalizedRangeCache: new Map(),
    durationCache: new Map(),
    prepConcurrency: getPreparationConcurrency(),
    allowedBaseDomains: [...allowedBaseDomains],
    securityWarnings: [],
  };
}

function rememberPromise<K, V>(
  cache: Map<K, Promise<V>>,
  key: K,
  factory: () => Promise<V>
): Promise<V> {
  const existing = cache.get(key);
  if (existing) return existing;

  const pending = Promise.resolve().then(factory);
  cache.set(key, pending);
  pending.catch(() => {
    if (cache.get(key) === pending) {
      cache.delete(key);
    }
  });
  return pending;
}

async function mapWithConcurrencyLimit<T, R>(
  items: readonly T[],
  limit: number,
  mapper: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  if (items.length === 0) return [];

  const results = new Array<R>(items.length);
  let nextIndex = 0;
  let activeCount = 0;

  return await new Promise<R[]>((resolve, reject) => {
    let rejected = false;

    const launch = () => {
      if (rejected) return;
      if (nextIndex >= items.length) {
        if (activeCount === 0) {
          resolve(results);
        }
        return;
      }

      while (activeCount < limit && nextIndex < items.length) {
        const currentIndex = nextIndex;
        nextIndex += 1;
        activeCount += 1;

        Promise.resolve(mapper(items[currentIndex] as T, currentIndex))
          .then((result) => {
            results[currentIndex] = result;
            activeCount -= 1;
            launch();
          })
          .catch((error) => {
            rejected = true;
            reject(error);
          });
      }
    };

    launch();
  });
}

function normalizeText(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeScanFolder(input: string): string {
  const trimmed = input.trim();
  const resolvedPortablePath = resolvePortableMovedDataPath(
    trimmed,
    normalizeUserDataSuffix(process.env.FLAND_USER_DATA_SUFFIX)
  );
  const resolved = resolvedPortablePath ?? path.resolve(trimmed);
  return path.normalize(resolved);
}

function toPortableDataInstallSourceKey(filePath: string): string | null {
  const relativePath = getPortableDataRelativePath(
    filePath,
    normalizeUserDataSuffix(process.env.FLAND_USER_DATA_SUFFIX)
  );
  return relativePath ? `portable-data:${relativePath}` : null;
}

function toPortableDataInstallSourceKeyAlias(installSourceKey: string | null): string | null {
  const normalized = normalizeText(installSourceKey);
  if (!normalized || normalized.startsWith("portable-data:")) return null;

  const legacyPrefix = "legacy:";
  const isLegacy = normalized.startsWith(legacyPrefix);
  const keyBody = isLegacy ? normalized.slice(legacyPrefix.length) : normalized;
  const hashIndex = keyBody.lastIndexOf("#");
  const suffix = hashIndex >= 0 ? keyBody.slice(hashIndex) : "";
  const filePath = hashIndex >= 0 ? keyBody.slice(0, hashIndex) : keyBody;
  const portableKey = toPortableDataInstallSourceKey(filePath);
  if (!portableKey) return null;
  return `${isLegacy ? legacyPrefix : ""}${portableKey}${suffix}`;
}

function toFilesystemInstallSourceKey(filePath: string, index?: number): string {
  const resolved = path.resolve(filePath);
  const baseKey = toPortableDataInstallSourceKey(resolved) ?? resolved;
  return typeof index === "number" ? `${baseKey}#${index}` : baseKey;
}

const legacyFilenameCollator = new Intl.Collator(undefined, { sensitivity: "base", numeric: true });

function parseStoredFolderList(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];

  const deduped = new Set<string>();
  for (const entry of raw) {
    if (typeof entry !== "string") continue;
    const trimmed = entry.trim();
    if (!trimmed) continue;
    deduped.add(normalizeScanFolder(trimmed));
  }

  return Array.from(deduped);
}

async function isDirectory(folderPath: string): Promise<boolean> {
  try {
    const stat = await fs.stat(folderPath);
    return stat.isDirectory();
  } catch {
    return false;
  }
}

async function resolveApprovedInstallFolder(folderPath: string): Promise<string> {
  const normalizedFolder = assertApprovedDialogPath("installFolder", folderPath);
  if (!(await isDirectory(normalizedFolder))) {
    throw new Error("Folder does not exist or is not a directory.");
  }

  return normalizedFolder;
}

async function isFile(filePath: string): Promise<boolean> {
  try {
    const stat = await fs.stat(filePath);
    return stat.isFile();
  } catch {
    return false;
  }
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function pushScanError(status: InstallScanStatus, source: string, reason: string): void {
  status.stats.failed += 1;
  if (status.lastErrors.length >= MAX_TRACKED_ERRORS) return;
  status.lastErrors.push({ source, reason });
}

function updateRunningScanMessage(message: string): void {
  if (scanStatus.state !== "running") return;
  scanStatus = {
    ...scanStatus,
    lastMessage: message,
  };
}

function updateRunningScanPhase(
  phase: InstallScanPhase,
  options?: {
    message?: string;
    progress?: InstallScanPhaseProgress | null;
  }
): void {
  if (scanStatus.state !== "running") return;
  scanStatus = {
    ...scanStatus,
    phase,
    phaseProgress: options?.progress === undefined ? scanStatus.phaseProgress : options.progress,
    lastMessage: options?.message ?? scanStatus.lastMessage,
  };
}

function formatZodError(error: ZodError): string {
  return error.issues
    .map((issue) => {
      const issuePath = issue.path.length > 0 ? issue.path.join(".") : "$";
      return `${issuePath}: ${issue.message}`;
    })
    .join("; ");
}

class InstallAbortError extends Error {
  constructor() {
    super("Install aborted.");
    this.name = "InstallAbortError";
  }
}

function throwIfAbortRequested(): void {
  if (abortRequested) {
    throw new InstallAbortError();
  }
}

async function collectSidecarFiles(folderPath: string): Promise<ImportedSidecarDescriptor[]> {
  const output: ImportedSidecarDescriptor[] = [];
  const queue = [folderPath];

  while (queue.length > 0) {
    throwIfAbortRequested();
    const current = queue.pop();
    if (!current) continue;

    let entries: Dirent[];
    try {
      entries = await fs.readdir(current, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        queue.push(fullPath);
        continue;
      }

      if (!entry.isFile()) continue;
      const ext = path.extname(entry.name).toLowerCase();
      if (ext === ".fpack") {
        try {
          const { manifest } = await ensureFpackExtracted(fullPath);
          output.push(
            ...manifest.sidecarEntries.map(
              (sidecar): ImportedSidecarDescriptor => ({
                sidecarPath: sidecar.extractedPath,
                source: {
                  sourceKind: "fpack",
                  archiveEntryPath: sidecar.archiveEntryPath,
                },
              })
            )
          );
        } catch {
          // Skip invalid .fpack files silently.
        }
        continue;
      }
      if (SIDECAR_EXTENSIONS.has(ext)) {
        output.push({
          sidecarPath: fullPath,
          source: { sourceKind: "filesystem" },
        });
      }
    }
  }

  output.sort((a, b) => a.sidecarPath.localeCompare(b.sidecarPath));
  return output;
}

async function findSiblingVideo(basePath: string): Promise<string | null> {
  throwIfAbortRequested();
  const directory = path.dirname(basePath);
  const baseName = path.basename(basePath);

  let entries: Dirent[];
  try {
    entries = await fs.readdir(directory, { withFileTypes: true });
  } catch {
    return null;
  }

  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const parsed = path.parse(entry.name);
    if (parsed.name !== baseName) continue;
    if (!isSupportedVideoFileExtension(parsed.ext)) continue;
    return path.join(directory, entry.name);
  }

  return null;
}

async function computeSha256(filePath: string): Promise<string> {
  throwIfAbortRequested();
  const content = await fs.readFile(filePath);
  throwIfAbortRequested();
  return crypto.createHash("sha256").update(content).digest("hex");
}

function toOptionalMs(value: number | null | undefined): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  return Math.floor(value);
}

function toShaFallbackSuffix(
  normalizedRange: NormalizedVideoHashRange | null,
  startTimeMs?: number,
  endTimeMs?: number
): string | null {
  if (normalizedRange && !normalizedRange.isFullVideo) {
    return `${normalizedRange.startTimeMs}-${normalizedRange.endTimeMs}`;
  }

  if (normalizedRange) {
    return null;
  }

  if (typeof startTimeMs === "number" || typeof endTimeMs === "number") {
    return `${startTimeMs ?? 0}-${endTimeMs ?? -1}`;
  }

  return null;
}

function getRawVideoRangeCacheKey(
  localVideoPath: string,
  startTimeMs?: number | null,
  endTimeMs?: number | null
): string {
  const normalizedPath = path.normalize(localVideoPath);
  const normalizedStartTimeMs = toOptionalMs(startTimeMs);
  const normalizedEndTimeMs = toOptionalMs(endTimeMs);
  return `${normalizedPath}#raw:${normalizedStartTimeMs ?? ""}-${normalizedEndTimeMs ?? ""}`;
}

async function resolveVideoRange(
  context: InstallSessionContext,
  localVideoPath: string,
  startTimeMs?: number | null,
  endTimeMs?: number | null
): Promise<VideoRangeResolution> {
  const rawKey = getRawVideoRangeCacheKey(localVideoPath, startTimeMs, endTimeMs);
  return rememberPromise(context.normalizedRangeCache, rawKey, async () => {
    throwIfAbortRequested();
    const normalizedPath = path.normalize(localVideoPath);
    const normalizedStartTimeMs = toOptionalMs(startTimeMs);
    const normalizedEndTimeMs = toOptionalMs(endTimeMs);

    let normalizedRange: NormalizedVideoHashRange | null = null;
    let cacheKey = rawKey;

    try {
      normalizedRange = await runImportMediaWork(() =>
        getNormalizedVideoHashRange(normalizedPath, normalizedStartTimeMs, normalizedEndTimeMs)
      );
      cacheKey = toVideoHashRangeCacheKey(normalizedPath, normalizedRange);
    } catch {
      normalizedRange = null;
    }

    return {
      normalizedPath,
      normalizedRange,
      normalizedStartTimeMs,
      normalizedEndTimeMs,
      cacheKey,
    };
  });
}

async function computeVideoHash(
  context: InstallSessionContext,
  localVideoPath: string,
  startTimeMs?: number | null,
  endTimeMs?: number | null,
  options?: PrepareMediaOptions
): Promise<string> {
  const mediaOptions = resolvePrepareMediaOptions(options);
  const range = await resolveVideoRange(context, localVideoPath, startTimeMs, endTimeMs);
  return rememberPromise(context.hashCache, range.cacheKey, async () => {
    let resolvedHash: string | null = null;

    try {
      throwIfAbortRequested();
      const normalizedRange = range.normalizedRange;
      const phash = normalizedRange
        ? await runImportMediaWork(() =>
            generateVideoPhashForNormalizedRange(range.normalizedPath, normalizedRange, {
              lowPriority: mediaOptions.lowPriorityMedia,
            })
          )
        : await runImportMediaWork(() =>
            generateVideoPhash(
              range.normalizedPath,
              range.normalizedStartTimeMs,
              range.normalizedEndTimeMs,
              { lowPriority: mediaOptions.lowPriorityMedia }
            )
          );
      const trimmed = typeof phash === "string" ? phash.trim() : "";
      if (trimmed.length > 0) {
        resolvedHash = trimmed;
      }
    } catch {
      resolvedHash = null;
    }

    if (!resolvedHash) {
      throwIfAbortRequested();
      const baseHash = `sha256:${await computeSha256(range.normalizedPath)}`;
      const suffix = toShaFallbackSuffix(
        range.normalizedRange,
        range.normalizedStartTimeMs,
        range.normalizedEndTimeMs
      );
      resolvedHash = suffix ? `${baseHash}@${suffix}` : baseHash;
    }

    return resolvedHash;
  });
}

async function computePreviewImage(
  context: InstallSessionContext,
  videoUri: string,
  startTimeMs?: number | null,
  endTimeMs?: number | null
): Promise<string | null> {
  const localVideoPath = fromLocalMediaUri(videoUri);
  let cacheKey = `${videoUri}#raw:${toOptionalMs(startTimeMs) ?? ""}-${toOptionalMs(endTimeMs) ?? ""}`;

  if (localVideoPath) {
    const range = await resolveVideoRange(context, localVideoPath, startTimeMs, endTimeMs);
    cacheKey = `preview:${range.cacheKey}`;
  }

  return rememberPromise(context.previewCache, cacheKey, async () => {
    throwIfAbortRequested();
    return await runImportMediaWork(() =>
      generateRoundPreviewImageDataUri({
        videoUri,
        startTimeMs,
        endTimeMs,
      })
    );
  });
}

async function resolveLocalVideoDurationMs(
  context: InstallSessionContext,
  localVideoPath: string | null
): Promise<number | null> {
  if (!localVideoPath) return null;
  return rememberPromise(context.durationCache, localVideoPath, async () => {
    return runImportMediaWork(() => resolveVideoDurationMsForLocalPath(localVideoPath));
  });
}

function toRoundType(input: string | null | undefined): RoundType {
  if (input === "Interjection") return "Interjection";
  if (input === "Cum") return "Cum";
  return "Normal";
}

function normalizeRoundData(input: InstallRound): SidecarRoundData {
  return {
    name: input.name,
    author: normalizeText(input.author),
    description: normalizeText(input.description),
    bpm: typeof input.bpm === "number" ? input.bpm : null,
    difficulty: typeof input.difficulty === "number" ? input.difficulty : null,
    phash: normalizeText(input.phash),
    startTime: typeof input.startTime === "number" ? input.startTime : null,
    endTime: typeof input.endTime === "number" ? input.endTime : null,
    type: toRoundType(input.type),
    ...(typeof input.excludeFromRandom === "boolean"
      ? { excludeFromRandom: input.excludeFromRandom }
      : {}),
    resources: input.resources,
  };
}

function resolveSidecarResourceUri(resourceUri: string, sidecarPath: string): string {
  const trimmed = resourceUri.trim();
  if (isPackageRelativeMediaPath(trimmed)) {
    return toLocalMediaUri(resolveSidecarMediaPath(sidecarPath, trimmed));
  }
  return trimmed;
}

function rememberSecurityWarning(
  context: InstallSessionContext,
  warning: Omit<ImportSecurityWarning, "message">
): void {
  context.securityWarnings.push({
    ...warning,
    message: `Blocked untrusted remote URLs from ${warning.baseDomain} during import.`,
  });
}

function filterTrustedRemoteUri(
  context: InstallSessionContext,
  uri: string | null,
  kind: "video" | "funscript"
): string | null {
  if (!uri) return null;
  const classified = classifyTrustedUrl(uri, context.allowedBaseDomains);
  if (!classified || classified.decision === "trusted") {
    return uri;
  }

  rememberSecurityWarning(context, {
    baseDomain: classified.baseDomain,
    host: classified.host,
    videoUrlCount: kind === "video" ? 1 : 0,
    funscriptUrlCount: kind === "funscript" ? 1 : 0,
  });
  return null;
}

async function prepareRoundResources(
  context: InstallSessionContext,
  sidecarPath: string,
  round: SidecarRoundData,
  allowLocalFallback: boolean,
  options?: PrepareMediaOptions
): Promise<PreparedRoundResources> {
  throwIfAbortRequested();
  const mediaOptions = resolvePrepareMediaOptions(options);
  const explicitRoundPhash = normalizeText(round.phash);
  const resources: Array<{
    videoUri: string;
    funscriptUri: string | null;
    localVideoPath: string | null;
  }> = [];

  if (round.resources.length > 0) {
    for (const resource of round.resources) {
      throwIfAbortRequested();
      const videoUri = filterTrustedRemoteUri(
        context,
        resolveSidecarResourceUri(resource.videoUri, sidecarPath),
        "video"
      );
      if (!videoUri) {
        continue;
      }
      const normalizedFunscriptUri = normalizeText(resource.funscriptUri);
      const funscriptUri = normalizedFunscriptUri
        ? filterTrustedRemoteUri(
            context,
            resolveSidecarResourceUri(normalizedFunscriptUri, sidecarPath),
            "funscript"
          )
        : null;
      resources.push({
        videoUri,
        funscriptUri,
        localVideoPath: fromLocalMediaUri(videoUri),
      });
    }
  } else if (allowLocalFallback) {
    throwIfAbortRequested();
    const basePath = sidecarPath.replace(/\.(round|hero)$/i, "");
    const localVideoPath = await findSiblingVideo(basePath);
    if (!localVideoPath) {
      return {
        resources: [],
        computedRoundPhash: explicitRoundPhash,
        previewImage: null,
      };
    }

    const funscriptPath = `${basePath}.funscript`;
    const localFunscriptExists = await fileExists(funscriptPath);

    resources.push({
      videoUri: toLocalMediaUri(localVideoPath),
      funscriptUri: localFunscriptExists ? toLocalMediaUri(funscriptPath) : null,
      localVideoPath,
    });
  }

  if (resources.length === 0) {
    return {
      resources: [],
      computedRoundPhash: explicitRoundPhash,
      previewImage: null,
    };
  }

  const previewSourceResource = resources[0];
  const [prepared, previewImage] = await Promise.all([
    Promise.all(
      resources.map(async (resource) => {
        throwIfAbortRequested();
        let resolvedPhash: string | null = explicitRoundPhash;

        if (!resolvedPhash && resource.localVideoPath && !mediaOptions.deferPhash) {
          resolvedPhash = await computeVideoHash(
            context,
            resource.localVideoPath,
            round.startTime,
            round.endTime,
            mediaOptions
          );
        }

        return {
          videoUri: resource.videoUri,
          funscriptUri: resource.funscriptUri,
          phash: resolvedPhash,
          durationMs: mediaOptions.deferDuration
            ? null
            : await resolveLocalVideoDurationMs(context, resource.localVideoPath),
        } satisfies PreparedResource;
      })
    ),
    previewSourceResource && !mediaOptions.deferPreview
      ? computePreviewImage(context, previewSourceResource.videoUri, round.startTime, round.endTime)
      : Promise.resolve(null),
  ]);

  const computedRoundPhash =
    explicitRoundPhash ?? prepared.find((resource) => normalizeText(resource.phash))?.phash ?? null;

  return {
    resources: prepared,
    computedRoundPhash,
    previewImage,
  };
}

async function ensureHeroWithMissingMetadata(
  tx: TransactionClient,
  context: InstallSessionContext,
  heroInput: HeroMetadataInput
): Promise<string> {
  const normalizedAuthor = normalizeText(heroInput.author);
  const normalizedDescription = normalizeText(heroInput.description);
  const normalizedPhash = normalizeText(heroInput.phash);

  const existing = context.heroByName.get(heroInput.name);
  if (!existing) {
    const [created] = await tx
      .insert(hero)
      .values({
        name: heroInput.name,
        author: normalizedAuthor,
        description: normalizedDescription,
        phash: normalizedPhash,
      })
      .returning({ id: hero.id });
    context.heroByName.set(heroInput.name, {
      id: created.id,
      author: normalizedAuthor,
      description: normalizedDescription,
      phash: normalizedPhash,
    });
    context.heroById.set(created.id, {
      id: created.id,
      name: heroInput.name,
      author: normalizedAuthor,
      description: normalizedDescription,
      phash: normalizedPhash,
    });
    return created.id;
  }

  const updateData: Partial<typeof hero.$inferInsert> = {};
  if (!normalizeText(existing.author) && normalizedAuthor) {
    updateData.author = normalizedAuthor;
  }
  if (!normalizeText(existing.description) && normalizedDescription) {
    updateData.description = normalizedDescription;
  }
  if (!normalizeText(existing.phash) && normalizedPhash) {
    updateData.phash = normalizedPhash;
  }

  if (Object.keys(updateData).length > 0) {
    await tx.update(hero).set(updateData).where(eq(hero.id, existing.id));
    context.heroByName.set(heroInput.name, {
      id: existing.id,
      author: updateData.author ?? existing.author,
      description: updateData.description ?? existing.description,
      phash: updateData.phash ?? existing.phash,
    });
    context.heroById.set(existing.id, {
      id: existing.id,
      name: heroInput.name,
      author: updateData.author ?? existing.author,
      description: updateData.description ?? existing.description,
      phash: updateData.phash ?? existing.phash,
    });
  }

  return existing.id;
}

function rememberCanonicalResource(
  context: InstallSessionContext,
  videoUri: string,
  phash: string | null,
  funscriptUri: string | null = null,
  durationMs: number | null = null
): void {
  const normalizedPhash = normalizeText(phash);
  if (!normalizedPhash) return;

  if (!context.exactVideoUriByPhash.has(normalizedPhash)) {
    context.exactVideoUriByPhash.set(normalizedPhash, videoUri);
  }
  if (!context.exactResourceByPhash.has(normalizedPhash)) {
    context.exactResourceByPhash.set(normalizedPhash, {
      videoUri,
      funscriptUri,
      phash: normalizedPhash,
      durationMs,
    });
  }

  const normalizedForSimilarity = normalizePhashForSimilarity(normalizedPhash);
  if (normalizedForSimilarity) {
    context.similarPhashCandidates.push({
      roundId: null,
      videoUri,
      funscriptUri,
      durationMs,
      phash: normalizedForSimilarity,
    });
  }
}

async function upsertRoundWithResources(
  tx: TransactionClient,
  context: InstallSessionContext,
  params: {
    installSourceKey: string;
    round: SidecarRoundData;
    heroId: string | null;
    resources: PreparedResource[];
    previewImage?: string | null;
  }
): Promise<{ updated: boolean; roundId: string }> {
  throwIfAbortRequested();
  const existingRound = context.roundByInstallSourceKey.get(params.installSourceKey) ?? null;
  const previewImage =
    params.previewImage === null && existingRound?.previewImage
      ? existingRound.previewImage
      : (params.previewImage ?? null);

  const roundPayload = {
    name: params.round.name,
    author: params.round.author,
    description: params.round.description,
    bpm: params.round.bpm,
    difficulty: params.round.difficulty,
    phash: params.round.phash,
    startTime: params.round.startTime,
    endTime: params.round.endTime,
    type: params.round.type,
    ...(params.round.excludeFromRandom !== undefined
      ? { excludeFromRandom: params.round.excludeFromRandom }
      : {}),
    heroId: params.heroId,
    installSourceKey: params.installSourceKey,
    previewImage,
  };

  let roundId = "";
  if (existingRound) {
    const [updated] = await tx
      .update(round)
      .set({ ...roundPayload, updatedAt: new Date() })
      .where(eq(round.id, existingRound.id))
      .returning({ id: round.id });
    roundId = updated.id;
  } else {
    const [inserted] = await tx.insert(round).values(roundPayload).returning({ id: round.id });
    roundId = inserted.id;
  }
  context.roundByInstallSourceKey.set(params.installSourceKey, {
    id: roundId,
    previewImage,
    heroId: params.heroId,
    name: params.round.name,
    phash: params.round.phash,
  });

  const dedupedResources: PreparedResource[] = [];
  for (const res of params.resources) {
    throwIfAbortRequested();
    let canonicalVideoUri = res.videoUri;
    if (res.phash) {
      const existing = context.exactVideoUriByPhash.get(res.phash);
      if (existing) {
        canonicalVideoUri = existing;
      } else {
        const normalizedPhash = normalizePhashForSimilarity(res.phash);
        if (normalizedPhash) {
          const similarMatch = findBestSimilarPhashMatch(
            normalizedPhash,
            context.similarPhashCandidates,
            (candidate) => candidate.phash
          );
          if (similarMatch?.item.videoUri) {
            canonicalVideoUri = similarMatch.item.videoUri;
          }
        }
      }
    }

    dedupedResources.push({
      videoUri: canonicalVideoUri,
      funscriptUri: res.funscriptUri,
      phash: res.phash,
      durationMs: res.durationMs,
    });
  }

  await tx.delete(resource).where(eq(resource.roundId, roundId));

  if (dedupedResources.length > 0) {
    await tx.insert(resource).values(
      dedupedResources.map((r) => ({
        roundId,
        videoUri: r.videoUri,
        funscriptUri: r.funscriptUri,
        phash: r.phash,
        durationMs: r.durationMs,
      }))
    );

    for (const entry of dedupedResources) {
      rememberCanonicalResource(
        context,
        entry.videoUri,
        entry.phash,
        entry.funscriptUri,
        entry.durationMs
      );
    }
  }

  context.templateRounds = context.templateRounds.filter((entry) => entry.id !== roundId);
  if (dedupedResources.length === 0) {
    context.templateRounds.push({
      id: roundId,
      heroId: params.heroId,
      name: params.round.name,
      phash: params.round.phash,
      installSourceKey: params.installSourceKey,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  }

  return { updated: Boolean(existingRound), roundId };
}

function isWebUri(uri: string): boolean {
  return uri.startsWith("http://") || uri.startsWith("https://");
}

function toWebsiteBackedVideoUri(uri: string): string | null {
  const proxiedWebsiteUri = parseWebsiteVideoProxyUri(uri)?.targetUrl ?? null;
  if (proxiedWebsiteUri) {
    return proxiedWebsiteUri;
  }
  return isWebUri(uri) ? uri : null;
}

function toWebsiteRoundInstallSourceKey(
  name: string,
  videoUri: string,
  funscriptUri: string | null
): string {
  const payload = [
    "website-round:v1",
    name.trim().toLowerCase(),
    videoUri.trim(),
    funscriptUri?.trim() ?? "",
  ].join("|");
  const digest = crypto.createHash("sha256").update(payload).digest("hex");
  return `website:${digest}`;
}

async function prepareRoundWrite(
  context: InstallSessionContext,
  installSourceKey: string,
  sidecarPath: string,
  roundInput: InstallRound,
  allowLocalFallback: boolean,
  options?: PrepareMediaOptions
): Promise<PreparedRoundWrite> {
  const normalizedRound = normalizeRoundData(roundInput);
  const existingRound = context.roundByInstallSourceKey.get(installSourceKey) ?? null;
  const roundForPreparation =
    normalizedRound.phash || !existingRound?.phash
      ? normalizedRound
      : { ...normalizedRound, phash: existingRound.phash };
  const prepared = await prepareRoundResources(
    context,
    sidecarPath,
    roundForPreparation,
    allowLocalFallback,
    options
  );
  const calculatedDifficulty =
    normalizedRound.difficulty ??
    (await calculateMissingDifficultyFromResources(prepared.resources));

  let resolvedInstallSourceKey = installSourceKey;
  const websiteVideoUris = prepared.resources.map((res) => toWebsiteBackedVideoUri(res.videoUri));
  if (websiteVideoUris.length > 0 && websiteVideoUris.every((uri) => uri !== null)) {
    const firstWebsiteVideoUri = websiteVideoUris[0];
    const firstResource = prepared.resources[0];
    resolvedInstallSourceKey = toWebsiteRoundInstallSourceKey(
      normalizedRound.name,
      firstWebsiteVideoUri,
      firstResource.funscriptUri
    );
  }

  return {
    installSourceKey: resolvedInstallSourceKey,
    round:
      normalizedRound.phash || !prepared.computedRoundPhash
        ? { ...normalizedRound, difficulty: calculatedDifficulty }
        : {
            ...normalizedRound,
            difficulty: calculatedDifficulty,
            phash: prepared.computedRoundPhash,
          },
    resources: prepared.resources,
    previewImage: prepared.previewImage,
    unresolved: prepared.resources.length === 0,
  };
}

async function calculateMissingDifficultyFromResources(
  resources: PreparedResource[]
): Promise<number | null> {
  for (const resource of resources) {
    const difficulty = await calculateFunscriptDifficultyFromUri(resource.funscriptUri);
    if (difficulty !== null) {
      return difficulty;
    }
  }
  return null;
}

type ParsedSidecarInspectionEntry =
  | {
      kind: "playlist";
      filePath: string;
      name: string;
      resources: [];
    }
  | {
      kind: "hero_round";
      filePath: string;
      name: string;
      resources: Array<{ videoUri: string; funscriptUri: string | null }>;
    };

function normalizeFpackInstallEntryPath(entryPath: string): string {
  const normalized = path.posix.normalize(entryPath.replaceAll("\\", "/")).replace(/^\/+/u, "");
  if (
    !normalized ||
    normalized === "." ||
    normalized.startsWith("../") ||
    normalized.includes("/../")
  ) {
    throw new Error(`Invalid .fpack entry path: ${entryPath}`);
  }
  return normalized;
}

function toFpackInstallSourceKey(entryPath: string, index?: number): string {
  const normalized = normalizeFpackInstallEntryPath(entryPath);
  return index === undefined ? `fpack-entry:${normalized}` : `fpack-entry:${normalized}#${index}`;
}

async function parseSidecarForInspection(
  sidecarPath: string
): Promise<ParsedSidecarInspectionEntry> {
  const ext = path.extname(sidecarPath).toLowerCase();
  if (ext === ".fplay") {
    return {
      kind: "playlist",
      filePath: sidecarPath,
      name: path.basename(sidecarPath, ".fplay"),
      resources: [],
    };
  }

  const content = await fs.readFile(sidecarPath, "utf8");
  const parsedJson = JSON.parse(content) as unknown;

  if (ext === ".round") {
    const parsed = ZRoundSidecar.parse(parsedJson);
    return {
      kind: "hero_round",
      filePath: sidecarPath,
      name: parsed.name,
      resources: parsed.resources.map((resource) => ({
        videoUri: resolveSidecarResourceUri(resource.videoUri, sidecarPath),
        funscriptUri: resource.funscriptUri
          ? resolveSidecarResourceUri(resource.funscriptUri, sidecarPath)
          : null,
      })),
    };
  }

  if (ext === ".hero") {
    const parsed = ZHeroSidecar.parse(parsedJson);
    return {
      kind: "hero_round",
      filePath: sidecarPath,
      name: parsed.name,
      resources: parsed.rounds.flatMap((round) =>
        round.resources.map((resource) => ({
          videoUri: resolveSidecarResourceUri(resource.videoUri, sidecarPath),
          funscriptUri: resource.funscriptUri
            ? resolveSidecarResourceUri(resource.funscriptUri, sidecarPath)
            : null,
        }))
      ),
    };
  }

  return {
    kind: "hero_round",
    filePath: sidecarPath,
    name: path.basename(sidecarPath),
    resources: [],
  };
}

async function prepareRoundSidecar(
  context: InstallSessionContext,
  sidecarPath: string,
  source: SidecarSourceMetadata = { sourceKind: "filesystem" }
): Promise<PreparedInstallEntry> {
  throwIfAbortRequested();
  const content = await fs.readFile(sidecarPath, "utf8");
  const parsedJson = JSON.parse(content) as unknown;
  const parsed = ZRoundSidecar.safeParse(parsedJson);

  if (!parsed.success) {
    throw parsed.error;
  }

  return {
    kind: "hero_round",
    heroInput: parsed.data.hero ?? null,
    writes: [
      await prepareRoundWrite(
        context,
        source.archiveEntryPath
          ? toFpackInstallSourceKey(source.archiveEntryPath)
          : toFilesystemInstallSourceKey(sidecarPath),
        sidecarPath,
        parsed.data,
        true
      ),
    ],
  };
}

async function prepareHeroSidecar(
  context: InstallSessionContext,
  sidecarPath: string,
  source: SidecarSourceMetadata = { sourceKind: "filesystem" }
): Promise<PreparedInstallEntry> {
  throwIfAbortRequested();
  const content = await fs.readFile(sidecarPath, "utf8");
  const parsedJson = JSON.parse(content) as unknown;
  const parsed = ZHeroSidecar.safeParse(parsedJson);

  if (!parsed.success) {
    throw parsed.error;
  }

  return {
    kind: "hero_round",
    heroInput: parsed.data,
    writes: await Promise.all(
      parsed.data.rounds.map(async (entry, index) => {
        throwIfAbortRequested();
        return await prepareRoundWrite(
          context,
          source.archiveEntryPath
            ? toFpackInstallSourceKey(source.archiveEntryPath, index)
            : toFilesystemInstallSourceKey(sidecarPath, index),
          sidecarPath,
          { ...entry, hero: undefined },
          false
        );
      })
    ),
  };
}

async function preparePlaylistSidecar(
  _context: InstallSessionContext,
  sidecarPath: string,
  source: SidecarSourceMetadata = { sourceKind: "filesystem" }
): Promise<PreparedInstallEntry> {
  throwIfAbortRequested();
  updateRunningScanMessage(`Preparing playlist ${path.basename(sidecarPath)}...`);
  return {
    kind: "playlist",
    filePath: sidecarPath,
    installSourceKeyOverride: source.archiveEntryPath
      ? toFpackInstallSourceKey(source.archiveEntryPath)
      : undefined,
  };
}

async function prepareSidecar(
  context: InstallSessionContext,
  sidecarPath: string,
  source: SidecarSourceMetadata = { sourceKind: "filesystem" }
): Promise<PreparedInstallEntry> {
  throwIfAbortRequested();
  const ext = path.extname(sidecarPath).toLowerCase();
  if (ext === ".round") {
    return await prepareRoundSidecar(context, sidecarPath, source);
  }

  if (ext === ".hero") {
    return await prepareHeroSidecar(context, sidecarPath, source);
  }

  if (ext === ".fplay") {
    return await preparePlaylistSidecar(context, sidecarPath, source);
  }

  return {
    kind: "hero_round",
    heroInput: null,
    writes: [],
  };
}

async function persistPreparedEntry(
  context: InstallSessionContext,
  entry: PreparedInstallEntry
): Promise<{ installed: number; playlistsImported: number; updated: number; roundIds: string[] }> {
  if (entry.kind === "playlist") {
    approveDialogPath("playlistImportFile", entry.filePath);
    await importPlaylistFromFile({
      filePath: entry.filePath,
      installSourceKey:
        entry.installSourceKeyOverride ?? toFilesystemInstallSourceKey(entry.filePath),
    });
    return {
      installed: 0,
      playlistsImported: 1,
      updated: 0,
      roundIds: [],
    };
  }

  return await context.db.transaction(async (tx) => {
    let heroId: string | null = null;
    if (entry.heroInput) {
      heroId = await ensureHeroWithMissingMetadata(tx, context, entry.heroInput);
    }

    let installed = 0;
    let updated = 0;
    const roundIds: string[] = [];

    for (const payload of entry.writes) {
      throwIfAbortRequested();
      const upserted = await upsertRoundWithResources(tx, context, {
        installSourceKey: payload.installSourceKey,
        round: payload.round,
        heroId,
        resources: payload.resources,
        previewImage: payload.previewImage,
      });
      roundIds.push(upserted.roundId);

      if (upserted.updated) {
        updated += 1;
      } else {
        installed += 1;
      }
    }

    return { installed, playlistsImported: 0, updated, roundIds };
  });
}

function stripInstallSourceFragment(installSourceKey: string | null | undefined): string | null {
  const normalized = normalizeText(installSourceKey);
  if (!normalized) return null;
  return normalized.replace(/#\d+$/u, "");
}

type ReconciliationRoundRow = {
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
  excludeFromRandom: boolean;
  installSourceKey: string | null;
  heroId: string | null;
};

function toSidecarRoundDataFromExistingRound(row: ReconciliationRoundRow): SidecarRoundData {
  return {
    name: row.name,
    author: row.author,
    description: row.description,
    bpm: row.bpm,
    difficulty: row.difficulty,
    phash: row.phash,
    startTime: row.startTime,
    endTime: row.endTime,
    type: row.type,
    excludeFromRandom: row.excludeFromRandom,
    resources: [],
  };
}

async function findRoundByIdForReconciliation(
  db: ReturnType<typeof getDb>,
  roundId: string
): Promise<ReconciliationRoundRow | null> {
  return (
    (await db.query.round.findFirst({
      where: eq(round.id, roundId),
      columns: {
        id: true,
        name: true,
        author: true,
        description: true,
        bpm: true,
        difficulty: true,
        phash: true,
        startTime: true,
        endTime: true,
        type: true,
        excludeFromRandom: true,
        installSourceKey: true,
        heroId: true,
      },
    })) ?? null
  );
}

async function buildPreparedResourcesFromInstalledRound(
  db: ReturnType<typeof getDb>,
  installedRoundId: string
): Promise<PreparedResource[]> {
  const sourceRound = await db.query.round.findFirst({
    where: eq(round.id, installedRoundId),
    with: {
      resources: true,
    },
    columns: {
      id: true,
    },
  });
  if (!sourceRound) {
    throw new Error("Installed source round not found.");
  }
  const sourceResources = sourceRound.resources.filter((entry) => !entry.disabled);
  if (sourceResources.length === 0) {
    throw new Error("Selected source round has no usable resources.");
  }
  return sourceResources.map((entry) => ({
    videoUri: entry.videoUri,
    funscriptUri: entry.funscriptUri,
    phash: entry.phash,
    durationMs: entry.durationMs,
  }));
}

async function computePreviewForExistingRound(
  context: InstallSessionContext,
  roundRow: ReconciliationRoundRow,
  resources: PreparedResource[]
): Promise<string | null> {
  const firstResource = resources[0];
  if (!firstResource) return null;
  return await computePreviewImage(
    context,
    firstResource.videoUri,
    roundRow.startTime,
    roundRow.endTime
  );
}

async function attachResourcesToTemplateRound(
  tx: TransactionClient,
  context: InstallSessionContext,
  roundRow: ReconciliationRoundRow,
  resources: PreparedResource[]
): Promise<void> {
  const installSourceKey = normalizeText(roundRow.installSourceKey);
  if (!installSourceKey) {
    throw new Error("Template round is missing installSourceKey.");
  }
  const previewImage = await computePreviewForExistingRound(context, roundRow, resources);
  await upsertRoundWithResources(tx, context, {
    installSourceKey,
    round: toSidecarRoundDataFromExistingRound(roundRow),
    heroId: roundRow.heroId,
    resources,
    previewImage,
  });
}

async function tryResolveTemplateRoundFromFilesystem(
  context: InstallSessionContext,
  roundRow: ReconciliationRoundRow
): Promise<PreparedResource[] | null> {
  if (roundRow.heroId) return null;
  const sidecarPath = stripInstallSourceFragment(roundRow.installSourceKey);
  if (!sidecarPath) return null;
  const basePath = sidecarPath.replace(/\.(round|hero)$/iu, "");
  const localVideoPath = await findSiblingVideo(basePath);
  if (!localVideoPath) return null;
  const funscriptPath = `${basePath}.funscript`;
  const localFunscriptExists = await fileExists(funscriptPath);
  return [
    {
      videoUri: toLocalMediaUri(localVideoPath),
      funscriptUri: localFunscriptExists ? toLocalMediaUri(funscriptPath) : null,
      phash: roundRow.phash,
      durationMs: await resolveLocalVideoDurationMs(context, localVideoPath),
    },
  ];
}

function tryResolveTemplateRoundFromInstalledRounds(
  context: InstallSessionContext,
  roundRow: ReconciliationRoundRow
): PreparedResource[] | null {
  const normalizedPhash = normalizeText(roundRow.phash);
  if (!normalizedPhash) return null;
  const exact = context.exactResourceByPhash.get(normalizedPhash);
  if (exact) {
    return [{ ...exact }];
  }
  const normalizedForSimilarity = normalizePhashForSimilarity(normalizedPhash);
  if (!normalizedForSimilarity) return null;
  const similarMatch = findBestSimilarPhashMatch(
    normalizedForSimilarity,
    context.similarPhashCandidates,
    (candidate) => candidate.phash
  );
  if (!similarMatch) return null;
  return [
    {
      videoUri: similarMatch.item.videoUri,
      funscriptUri: similarMatch.item.funscriptUri ?? null,
      phash: normalizedPhash,
      durationMs: similarMatch.item.durationMs ?? null,
    },
  ];
}

async function findHeroRounds(
  db: ReturnType<typeof getDb>,
  heroId: string
): Promise<ExistingHeroGroupRound[]> {
  const rows = await db.query.round.findMany({
    where: eq(round.heroId, heroId),
    with: {
      resources: true,
    },
    orderBy: [asc(round.createdAt), asc(round.id)],
    columns: {
      id: true,
      name: true,
      heroId: true,
      phash: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  return rows.map((entry) => ({
    id: entry.id,
    name: entry.name,
    heroId: entry.heroId,
    phash: entry.phash,
    createdAt: entry.createdAt,
    updatedAt: entry.updatedAt,
    resources: entry.resources
      .filter((resourceEntry) => !resourceEntry.disabled)
      .map((resourceEntry) => ({
        videoUri: resourceEntry.videoUri,
        funscriptUri: resourceEntry.funscriptUri,
        phash: resourceEntry.phash,
        durationMs: resourceEntry.durationMs,
      })),
  }));
}

function buildHeroRoundAssignmentsFromMatchedHero(
  templateRounds: ExistingHeroGroupRound[],
  sourceRounds: ExistingHeroGroupRound[]
): Array<{ templateRoundId: string; sourceRoundId: string }> {
  const sourceById = new Map(sourceRounds.map((entry) => [entry.id, entry]));
  const remainingSourceIds = new Set(
    sourceRounds.filter((entry) => entry.resources.length > 0).map((entry) => entry.id)
  );
  const assignments: Array<{ templateRoundId: string; sourceRoundId: string }> = [];

  for (const templateRound of templateRounds) {
    const exactNameMatch = sourceRounds.find(
      (candidate) =>
        remainingSourceIds.has(candidate.id) &&
        candidate.resources.length > 0 &&
        candidate.name === templateRound.name
    );
    if (!exactNameMatch) continue;
    assignments.push({ templateRoundId: templateRound.id, sourceRoundId: exactNameMatch.id });
    remainingSourceIds.delete(exactNameMatch.id);
  }

  const unmatchedTemplates = templateRounds.filter(
    (entry) => !assignments.some((assignment) => assignment.templateRoundId === entry.id)
  );
  const fallbackSources = [...remainingSourceIds]
    .map((id) => sourceById.get(id))
    .filter((entry): entry is ExistingHeroGroupRound => Boolean(entry))
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id));

  unmatchedTemplates
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id))
    .forEach((templateRound, index) => {
      const fallback = fallbackSources[index];
      if (!fallback) return;
      assignments.push({ templateRoundId: templateRound.id, sourceRoundId: fallback.id });
    });

  return assignments;
}

function tryResolveTemplateHeroByHeroPhash(
  context: InstallSessionContext,
  heroId: string
): string | null {
  const heroEntry = context.heroById.get(heroId);
  const normalizedHeroPhash = normalizeText(heroEntry?.phash);
  if (!normalizedHeroPhash) return null;

  for (const candidate of context.heroById.values()) {
    if (candidate.id === heroId) continue;
    if (normalizeText(candidate.phash) === normalizedHeroPhash) {
      return candidate.id;
    }
  }

  const normalizedTarget = normalizePhashForSimilarity(normalizedHeroPhash);
  if (!normalizedTarget) return null;
  const candidates = [...context.heroById.values()]
    .filter((candidate) => candidate.id !== heroId)
    .map((candidate) => ({
      id: candidate.id,
      phash: normalizePhashForSimilarity(candidate.phash ?? "") ?? "",
    }))
    .filter((candidate) => candidate.phash.length > 0);
  const similarMatch = findBestSimilarPhashMatch(
    normalizedTarget,
    candidates,
    (candidate) => candidate.phash
  );
  return similarMatch?.item.id ?? null;
}

async function attachResourcesToTemplateHeroRounds(
  tx: TransactionClient,
  context: InstallSessionContext,
  heroId: string,
  assignments: Array<{ templateRoundId: string; sourceRoundId: string }>
): Promise<number> {
  let linked = 0;
  for (const assignment of assignments) {
    const templateRound = await findRoundByIdForReconciliation(
      context.db,
      assignment.templateRoundId
    );
    if (!templateRound || templateRound.heroId !== heroId) continue;
    const resources = await buildPreparedResourcesFromInstalledRound(
      context.db,
      assignment.sourceRoundId
    );
    await attachResourcesToTemplateRound(tx, context, templateRound, resources);
    linked += 1;
  }
  return linked;
}

async function reconcileTemplateRounds(
  context: InstallSessionContext,
  input?: { roundId?: string; heroId?: string }
): Promise<{ linkedRoundIds: string[]; linkedHeroIds: string[] }> {
  const linkedRoundIds: string[] = [];
  const linkedHeroIds = new Set<string>();
  const roundsToInspect = context.templateRounds.filter((entry) => {
    if (input?.roundId && entry.id !== input.roundId) return false;
    if (input?.heroId && entry.heroId !== input.heroId) return false;
    return true;
  });

  for (const templateEntry of roundsToInspect.filter((entry) => !entry.heroId)) {
    const roundRow = await findRoundByIdForReconciliation(context.db, templateEntry.id);
    if (!roundRow) continue;
    const fromFilesystem = await tryResolveTemplateRoundFromFilesystem(context, roundRow);
    const resources =
      fromFilesystem ?? tryResolveTemplateRoundFromInstalledRounds(context, roundRow);
    if (!resources || resources.length === 0) continue;
    await context.db.transaction(async (tx) => {
      await attachResourcesToTemplateRound(tx, context, roundRow, resources);
    });
    linkedRoundIds.push(roundRow.id);
  }

  const heroIds = new Set(
    roundsToInspect
      .map((entry) => entry.heroId)
      .filter((entry): entry is string => typeof entry === "string" && entry.length > 0)
  );

  for (const heroId of heroIds) {
    const sourceHeroId = tryResolveTemplateHeroByHeroPhash(context, heroId);
    if (!sourceHeroId) continue;
    const [templateRounds, sourceRounds] = await Promise.all([
      findHeroRounds(context.db, heroId),
      findHeroRounds(context.db, sourceHeroId),
    ]);
    const unresolvedTemplateRounds = templateRounds.filter((entry) => entry.resources.length === 0);
    if (unresolvedTemplateRounds.length === 0) continue;
    const assignments = buildHeroRoundAssignmentsFromMatchedHero(
      unresolvedTemplateRounds,
      sourceRounds
    );
    if (assignments.length === 0) continue;
    await context.db.transaction(async (tx) => {
      await attachResourcesToTemplateHeroRounds(tx, context, heroId, assignments);
    });
    linkedHeroIds.add(heroId);
  }

  return {
    linkedRoundIds,
    linkedHeroIds: [...linkedHeroIds],
  };
}

export async function retryTemplateLinking(input?: {
  roundId?: string;
  heroId?: string;
}): Promise<{ linkedRoundIds: string[]; linkedHeroIds: string[] }> {
  const context = await createInstallSessionContext();
  return await reconcileTemplateRounds(context, input);
}

export async function repairTemplateRound(
  roundId: string,
  installedRoundId: string
): Promise<{ repairedRoundId: string }> {
  const context = await createInstallSessionContext();
  const roundRow = await findRoundByIdForReconciliation(context.db, roundId);
  if (!roundRow) {
    throw new Error("Template round not found.");
  }
  if (roundRow.heroId) {
    throw new Error("Round belongs to a hero template. Use hero repair instead.");
  }
  const resources = await buildPreparedResourcesFromInstalledRound(context.db, installedRoundId);
  await context.db.transaction(async (tx) => {
    await attachResourcesToTemplateRound(tx, context, roundRow, resources);
  });
  return { repairedRoundId: roundId };
}

export async function repairTemplateHero(
  heroId: string,
  sourceHeroId: string,
  assignments?: Array<{ roundId: string; installedRoundId: string }>
): Promise<{ repairedHeroId: string; repairedRoundCount: number }> {
  const context = await createInstallSessionContext();
  const templateRounds = await findHeroRounds(context.db, heroId);
  const unresolvedTemplateRounds = templateRounds.filter((entry) => entry.resources.length === 0);
  if (unresolvedTemplateRounds.length === 0) {
    return { repairedHeroId: heroId, repairedRoundCount: 0 };
  }

  let resolvedAssignments =
    assignments?.map((entry) => ({
      templateRoundId: entry.roundId,
      sourceRoundId: entry.installedRoundId,
    })) ?? [];

  if (resolvedAssignments.length === 0) {
    const sourceRounds = await findHeroRounds(context.db, sourceHeroId);
    resolvedAssignments = buildHeroRoundAssignmentsFromMatchedHero(
      unresolvedTemplateRounds,
      sourceRounds
    );
  }

  if (resolvedAssignments.length === 0) {
    throw new Error("No hero round assignments could be resolved.");
  }

  let repairedRoundCount = 0;
  await context.db.transaction(async (tx) => {
    repairedRoundCount = await attachResourcesToTemplateHeroRounds(
      tx,
      context,
      heroId,
      resolvedAssignments
    );
  });
  return { repairedHeroId: heroId, repairedRoundCount };
}

async function prepareLegacyRoundEntry(
  context: InstallSessionContext,
  sourcePath: string,
  options?: PrepareMediaOptions
): Promise<PreparedLegacyEntry> {
  const absoluteVideoPath = path.resolve(sourcePath);
  const parsed = path.parse(absoluteVideoPath);
  const funscriptPath = path.join(parsed.dir, `${parsed.name}.funscript`);
  const hasFunscript = await fileExists(funscriptPath);

  return {
    kind: "round",
    sourcePath: absoluteVideoPath,
    write: await prepareRoundWrite(
      context,
      `legacy:${toPortableDataInstallSourceKey(absoluteVideoPath) ?? absoluteVideoPath}`,
      absoluteVideoPath,
      {
        name: parsed.name,
        author: null,
        description: null,
        bpm: null,
        difficulty: null,
        phash: null,
        startTime: null,
        endTime: null,
        type: "Normal",
        resources: [
          {
            videoUri: toLocalMediaUri(absoluteVideoPath),
            funscriptUri: hasFunscript ? toLocalMediaUri(funscriptPath) : null,
          },
        ],
      },
      false,
      { ...LEGACY_PREPARE_MEDIA_OPTIONS, ...(options ?? {}) }
    ),
  };
}

function recordInstallError(status: InstallScanStatus, source: string, error: unknown): void {
  if (error instanceof ZodError) {
    pushScanError(status, source, `Validation failed: ${formatZodError(error)}`);
    return;
  }

  if (error instanceof SyntaxError) {
    pushScanError(status, source, `Invalid JSON: ${error.message}`);
    return;
  }

  const message = error instanceof Error ? error.message : "Unknown installation error.";
  pushScanError(status, source, message);
}

function toPortableRoundRef(input: {
  roundId: string;
  installSourceKey: string;
  phash: string | null;
  name: string;
  author: string | null;
  type: RoundType;
}): PortableRoundRef {
  return {
    idHint: input.roundId,
    installSourceKeyHint: input.installSourceKey,
    phash: normalizeText(input.phash) ?? undefined,
    name: input.name,
    author: normalizeText(input.author) ?? undefined,
    type: input.type,
  };
}

async function collectLegacyVideoFiles(folderPath: string): Promise<string[]> {
  throwIfAbortRequested();
  let entries: Dirent[];
  try {
    entries = await fs.readdir(folderPath, { withFileTypes: true });
  } catch {
    return [];
  }

  const files = entries
    .filter((entry) => entry.isFile())
    .filter((entry) => isSupportedVideoFileExtension(path.extname(entry.name).toLowerCase()))
    .map((entry) => path.join(folderPath, entry.name));

  files.sort((a, b) => {
    const byName = legacyFilenameCollator.compare(path.basename(a), path.basename(b));
    if (byName !== 0) return byName;
    return a.localeCompare(b);
  });
  return files;
}

function isLegacyCheckpointName(name: string): boolean {
  return name.toLowerCase().includes("checkpoint");
}

function buildLegacySlotPreview(videoPaths: string[]): LegacyImportSlotPreview[] {
  return videoPaths.map((videoPath, index) => {
    const parsed = path.parse(path.resolve(videoPath));
    return {
      id: `legacy-slot:${index}:${parsed.base.toLowerCase()}`,
      sourcePath: path.resolve(videoPath),
      sourceLabel: parsed.name,
      originalOrder: index,
      defaultCheckpoint: isLegacyCheckpointName(parsed.name),
    };
  });
}

function toPlaylistNameHint(folderPath: string): string {
  const basename = path.basename(folderPath).trim();
  return basename.length > 0 ? basename : "Legacy Playlist";
}

async function importLegacyFolderAsRounds(
  folderPath: string,
  options?: { omitCheckpointRounds?: boolean } & PrepareMediaOptions
): Promise<{
  installed: number;
  updated: number;
  roundIds: string[];
  orderedSlots: LegacyImportSlot[];
  playlistNameHint: string;
}> {
  throwIfAbortRequested();
  const videoPaths = await collectLegacyVideoFiles(folderPath);
  if (videoPaths.length === 0) {
    throw new Error("No supported video files found in selected folder.");
  }

  const omitCheckpointRounds = options?.omitCheckpointRounds ?? true;
  const context = await createInstallSessionContext();
  const roundIds: string[] = [];
  const orderedSlots: LegacyImportSlot[] = [];
  let installed = 0;
  let updated = 0;
  const preparedEntries = await mapWithConcurrencyLimit(
    videoPaths,
    context.prepConcurrency,
    async (videoPath, index): Promise<IndexedLegacyEntry | null> => {
      throwIfAbortRequested();
      const absoluteVideoPath = path.resolve(videoPath);
      const parsed = path.parse(absoluteVideoPath);
      updateRunningScanMessage(`Preparing ${parsed.base}...`);
      if (omitCheckpointRounds && isLegacyCheckpointName(parsed.name) && index > 0) {
        return {
          kind: "checkpoint",
          label: parsed.name,
          index,
        };
      }
      if (omitCheckpointRounds && isLegacyCheckpointName(parsed.name)) {
        return null;
      }

      const preparedEntry = await prepareLegacyRoundEntry(context, absoluteVideoPath, options);
      if (preparedEntry.kind !== "round") {
        throw new Error("Unexpected checkpoint result from prepareLegacyRoundEntry");
      }
      return {
        kind: "round",
        write: preparedEntry.write,
        index,
      };
    }
  );

  const entriesToPersist = preparedEntries.filter((e): e is IndexedLegacyEntry => e !== null);
  const persistedResults = await mapWithConcurrencyLimit<IndexedLegacyEntry, PersistedLegacyEntry>(
    entriesToPersist,
    1 /* Use sequential persistence to avoid SQLITE_BUSY */,
    async (entry): Promise<PersistedLegacyEntry> => {
      throwIfAbortRequested();

      if (entry.kind === "checkpoint") {
        return entry;
      }

      const parsed = path.parse(entry.write.installSourceKey);
      updateRunningScanMessage(`Persisting ${parsed.base}...`);

      const persisted = await persistPreparedEntry(context, {
        kind: "hero_round",
        heroInput: null,
        writes: [entry.write],
      });

      return {
        ...entry,
        persisted,
      };
    }
  );

  const sortedResults = persistedResults.sort((a, b) => a.index - b.index);
  for (const result of sortedResults) {
    if (result.kind === "checkpoint") {
      orderedSlots.push({
        kind: "checkpoint",
        label: result.label,
        restDurationMs: null,
      });
      continue;
    }

    const roundId = result.persisted.roundIds[0];
    if (!roundId) continue;

    installed += result.persisted.installed;
    updated += result.persisted.updated;
    roundIds.push(roundId);
    orderedSlots.push({
      kind: "round",
      ref: toPortableRoundRef({
        roundId,
        installSourceKey: result.write.installSourceKey,
        phash: result.write.round.phash,
        name: result.write.round.name,
        author: result.write.round.author,
        type: result.write.round.type,
      }),
    });
  }

  const playlistNameHint = toPlaylistNameHint(folderPath);

  return {
    installed,
    updated,
    roundIds,
    orderedSlots,
    playlistNameHint,
  };
}

function updateEta(startedAt: number, completed: number, total: number): void {
  const elapsedMs = Date.now() - startedAt;
  if (elapsedMs > 0 && completed > 0) {
    const rate = elapsedMs / completed;
    const remaining = total - completed;
    scanStatus.etaMs = Math.round(remaining * rate);
  }
}

async function importLegacyFolderFromReviewedSlots(
  folderPath: string,
  reviewedSlots: ReviewedLegacyImportSlot[],
  options?: PrepareMediaOptions
): Promise<LegacyInstallImport & { installed: number; updated: number }> {
  throwIfAbortRequested();
  const normalizedFolder = path.resolve(folderPath);
  const discoveredVideoPaths = await collectLegacyVideoFiles(normalizedFolder);
  if (discoveredVideoPaths.length === 0) {
    throw new Error("No supported video files found in selected folder.");
  }

  const discoveredSlots = buildLegacySlotPreview(discoveredVideoPaths);
  if (reviewedSlots.length !== discoveredSlots.length) {
    throw new Error("Legacy import plan no longer matches the selected folder contents.");
  }

  const reviewedByOrder = [...reviewedSlots].sort((a, b) => a.originalOrder - b.originalOrder);
  for (let index = 0; index < discoveredSlots.length; index += 1) {
    const discovered = discoveredSlots[index];
    const reviewed = reviewedByOrder[index];
    if (
      !reviewed ||
      reviewed.id !== discovered.id ||
      path.resolve(reviewed.sourcePath) !== discovered.sourcePath ||
      reviewed.originalOrder !== discovered.originalOrder
    ) {
      throw new Error("Legacy import plan no longer matches the selected folder contents.");
    }
  }

  const context = await createInstallSessionContext();
  const slotsToImport = reviewedByOrder.filter((r) => !r.excludedFromImport);
  const totalToProcess = slotsToImport.length;
  scanStatus.stats.totalSidecars = totalToProcess;

  const startedAt = scanStatus.startedAt ? new Date(scanStatus.startedAt).getTime() : Date.now();
  let prepared = 0;
  let processed = 0;
  let installed = 0;
  let updated = 0;
  const roundIds: string[] = [];
  const orderedSlots: LegacyImportSlot[] = [];

  const preparedEntries = await mapWithConcurrencyLimit<
    ReviewedLegacyImportSlot,
    IndexedLegacyEntry | null
  >(
    reviewedByOrder,
    context.prepConcurrency,
    async (reviewed): Promise<IndexedLegacyEntry | null> => {
      throwIfAbortRequested();
      if (reviewed.excludedFromImport) {
        return null;
      }

      const parsed = path.parse(reviewed.sourcePath);
      updateRunningScanMessage(`Preparing ${parsed.base}...`);
      if (reviewed.selectedAsCheckpoint) {
        prepared += 1;
        updateEta(startedAt, prepared + processed, totalToProcess * 2);
        return {
          kind: "checkpoint" as const,
          label: parsed.name,
          index: reviewed.originalOrder,
        };
      }

      const preparedEntry = await prepareLegacyRoundEntry(context, reviewed.sourcePath, options);
      if (preparedEntry.kind !== "round") {
        throw new Error("Unexpected checkpoint result from prepareLegacyRoundEntry");
      }
      prepared += 1;
      updateEta(startedAt, prepared + processed, totalToProcess * 2);
      return {
        kind: "round" as const,
        write: preparedEntry.write,
        index: reviewed.originalOrder,
      };
    }
  );

  const entriesToPersist = preparedEntries.filter((e): e is IndexedLegacyEntry => e !== null);
  const persistedResults = await mapWithConcurrencyLimit<IndexedLegacyEntry, PersistedLegacyEntry>(
    entriesToPersist,
    1 /* Use sequential persistence to avoid SQLITE_BUSY */,
    async (entry): Promise<PersistedLegacyEntry> => {
      throwIfAbortRequested();

      if (entry.kind === "checkpoint") {
        return entry;
      }

      const parsed = path.parse(entry.write.installSourceKey);
      updateRunningScanMessage(`Persisting ${parsed.base}...`);

      const persisted = await persistPreparedEntry(context, {
        kind: "hero_round",
        heroInput: null,
        writes: [entry.write],
      });

      processed += 1;
      updateEta(startedAt, prepared + processed, totalToProcess * 2);
      scanStatus.stats.installed = installed;
      scanStatus.stats.updated = updated;

      return {
        ...entry,
        persisted,
      };
    }
  );

  for (const result of persistedResults) {
    if (result.kind === "checkpoint") {
      orderedSlots.push({
        kind: "checkpoint",
        label: result.label,
        restDurationMs: null,
      });
      continue;
    }

    const roundId = result.persisted.roundIds[0];
    if (!roundId) continue;

    installed += result.persisted.installed;
    updated += result.persisted.updated;
    roundIds.push(roundId);
    orderedSlots.push({
      kind: "round",
      ref: toPortableRoundRef({
        roundId,
        installSourceKey: result.write.installSourceKey,
        phash: result.write.round.phash,
        name: result.write.round.name,
        author: result.write.round.author,
        type: result.write.round.type,
      }),
    });
  }

  return {
    installed,
    updated,
    roundIds,
    orderedSlots,
    playlistNameHint: toPlaylistNameHint(normalizedFolder),
  };
}

export async function inspectInstallFolder(
  folderPath: string
): Promise<InstallFolderInspectionResult> {
  const normalizedFolder = await resolveApprovedInstallFolder(folderPath);
  approveDialogPath("installFolder", normalizedFolder);

  const sidecars = await collectSidecarFiles(normalizedFolder);
  if (sidecars.length > 0) {
    return {
      kind: "sidecar",
      folderPath: normalizedFolder,
      playlistNameHint: toPlaylistNameHint(normalizedFolder),
      sidecarCount: sidecars.length,
    };
  }

  const videoPaths = await collectLegacyVideoFiles(normalizedFolder);
  if (videoPaths.length === 0) {
    return {
      kind: "empty",
      folderPath: normalizedFolder,
      playlistNameHint: toPlaylistNameHint(normalizedFolder),
    };
  }

  return {
    kind: "legacy",
    folderPath: normalizedFolder,
    playlistNameHint: toPlaylistNameHint(normalizedFolder),
    legacySlots: buildLegacySlotPreview(videoPaths),
  };
}

export function getInstallScanStatus(): InstallScanStatus {
  return cloneStatus(scanStatus);
}

export function requestInstallScanAbort(): InstallScanStatus {
  if ((!activeScanPromise && !activeManualFolderImport) || scanStatus.state !== "running") {
    return cloneStatus(scanStatus);
  }

  abortRequested = true;
  scanStatus = {
    ...scanStatus,
    lastMessage: "Abort requested. Waiting for the current import step to finish...",
  };
  return cloneStatus(scanStatus);
}

export async function inspectInstallSidecarFile(
  filePath: string
): Promise<InstallSidecarSecurityAnalysis> {
  const normalizedFile = assertApprovedDialogPath("installSidecarFile", filePath, {
    consume: false,
  });
  if (!(await isFile(normalizedFile))) {
    throw new Error("Selected file does not exist or is not a file.");
  }

  const ext = path.extname(normalizedFile).toLowerCase();
  if (!SIDECAR_AND_FPACK_EXTENSIONS.has(ext)) {
    throw new Error("Selected file must be a .round, .hero, .fplay, or .fpack import file.");
  }

  if (ext === ".fpack") {
    const inspection = await inspectFpack(normalizedFile);
    const allResources = inspection.sidecars.flatMap((sidecar) => sidecar.resources);
    return collectUnknownRemoteSitesFromResources(
      normalizedFile,
      inspection.sidecarCount === 1
        ? (inspection.sidecars[0]?.contentName ?? path.basename(normalizedFile, ".fpack"))
        : `${path.basename(normalizedFile, ".fpack")} (${inspection.sidecarCount} items)`,
      allResources
    );
  }

  const parsed = await parseSidecarForInspection(normalizedFile);
  return collectUnknownRemoteSitesFromResources(normalizedFile, parsed.name, parsed.resources);
}

export async function importInstallSidecarFile(
  filePath: string,
  allowedBaseDomains: string[] = []
): Promise<InstallFolderScanResult> {
  activeManualFolderImport = true;

  try {
    const normalizedFile = assertApprovedDialogPath("installSidecarFile", filePath);
    if (!(await isFile(normalizedFile))) {
      throw new Error("Selected file does not exist or is not a file.");
    }

    const ext = path.extname(normalizedFile).toLowerCase();
    if (!SIDECAR_AND_FPACK_EXTENSIONS.has(ext)) {
      throw new Error("Selected file must be a .round, .hero, .fplay, or .fpack import file.");
    }

    if (ext === ".fpack") {
      scanStatus = {
        state: "running",
        triggeredBy: "manual",
        startedAt: new Date().toISOString(),
        finishedAt: null,
        phase: "inspecting-pack",
        phaseProgress: null,
        stats: emptyStats(),
        lastMessage: "Inspecting pack contents...",
        lastErrors: [],
        etaMs: null,
        lastPreviewImage: null,
        securityWarnings: [],
      };

      const { manifest } = await ensureFpackExtracted(normalizedFile, {
        onProgress: (progress) => {
          scanStatus = {
            ...scanStatus,
            phase: "extracting-pack",
            phaseProgress: progress,
            lastMessage: "Extracting pack files...",
          };
        },
      });

      return await importPreparedSidecars(
        toImportedSidecarDescriptorsFromManifest(manifest),
        allowedBaseDomains,
        `Importing ${path.basename(normalizedFile)}...`
      );
    }

    const nextStatus: InstallScanStatus = {
      state: "running",
      triggeredBy: "manual",
      startedAt: new Date().toISOString(),
      finishedAt: null,
      phase: "preparing-sidecars",
      phaseProgress: null,
      stats: {
        ...emptyStats(),
        sidecarsSeen: 1,
        totalSidecars: 1,
      },
      lastMessage: `Importing ${path.basename(normalizedFile)}...`,
      lastErrors: [],
      etaMs: null,
      lastPreviewImage: null,
      securityWarnings: [],
    };
    scanStatus = nextStatus;

    const context = await createInstallSessionContext(allowedBaseDomains);
    try {
      const prepared = await prepareSidecar(context, normalizedFile, {
        sourceKind: "filesystem",
      });
      updateRunningScanPhase("persisting", {
        message: `Persisting ${path.basename(normalizedFile)}...`,
        progress: null,
      });
      const result = await persistPreparedEntry(context, prepared);
      nextStatus.stats.installed += result.installed;
      nextStatus.stats.playlistsImported += result.playlistsImported;
      nextStatus.stats.updated += result.updated;
      nextStatus.securityWarnings = [...context.securityWarnings];
      await reconcileTemplateRounds(context);
    } catch (error) {
      recordInstallError(nextStatus, normalizedFile, error);
    }

    try {
      throwIfAbortRequested();
      updateRunningScanPhase("syncing", {
        message: "Syncing external sources...",
        progress: null,
      });
      await syncExternalSources("manual");
    } catch (error) {
      const message = error instanceof Error ? error.message : "External source sync failed.";
      pushScanError(nextStatus, "external", message);
    }

    nextStatus.state = "done";
    nextStatus.finishedAt = new Date().toISOString();
    nextStatus.phase = "done";
    nextStatus.phaseProgress = null;
    nextStatus.lastMessage = `Import finished. ${formatImportStatsSummary(nextStatus.stats)}`;

    scanStatus = nextStatus;
    return {
      status: cloneStatus(nextStatus),
      securityWarnings: [...context.securityWarnings],
    };
  } catch (error) {
    if (error instanceof InstallAbortError) {
      const abortedStatus: InstallScanStatus = {
        ...scanStatus,
        state: "aborted",
        finishedAt: new Date().toISOString(),
        phase: "aborted",
        phaseProgress: null,
        lastMessage: "Import aborted by user.",
      };
      scanStatus = abortedStatus;
      return { status: cloneStatus(abortedStatus) };
    }

    throw error;
  } finally {
    activeManualFolderImport = false;
    abortRequested = false;
  }
}

export function getAutoScanFolders(): string[] {
  const store = getStore();
  const parsed = parseStoredFolderList(store.get(AUTO_SCAN_FOLDERS_KEY));
  store.set(AUTO_SCAN_FOLDERS_KEY, parsed);
  return parsed;
}

export async function addAutoScanFolder(folderPath: string): Promise<string[]> {
  const normalized = await resolveApprovedInstallFolder(folderPath);

  const next = new Set(getAutoScanFolders());
  next.add(normalized);
  const list = Array.from(next).sort((a, b) => a.localeCompare(b));
  getStore().set(AUTO_SCAN_FOLDERS_KEY, list);
  return list;
}

export async function addAutoScanFolderAndScan(
  folderPath: string
): Promise<AddAutoScanFolderAndScanResult> {
  const normalizedFolder = await resolveApprovedInstallFolder(folderPath);

  const next = new Set(getAutoScanFolders());
  next.add(normalizedFolder);
  const folders = Array.from(next).sort((a, b) => a.localeCompare(b));
  getStore().set(AUTO_SCAN_FOLDERS_KEY, folders);

  const result = await scanInstallFolderOnceWithLegacySupportResolved(normalizedFolder, {
    omitCheckpointRounds: true,
  });

  return { folders, result };
}

export function removeAutoScanFolder(folderPath: string): string[] {
  const normalized = normalizeScanFolder(folderPath);
  const next = getAutoScanFolders().filter((entry) => entry !== normalized);
  getStore().set(AUTO_SCAN_FOLDERS_KEY, next);
  return next;
}

function resolveScanFolders(folderPaths?: string[]): string[] {
  if (!folderPaths) {
    return getAutoScanFolders();
  }

  const unique = new Set<string>();
  for (const folderPath of folderPaths) {
    if (typeof folderPath !== "string") continue;
    const trimmed = folderPath.trim();
    if (!trimmed) continue;
    unique.add(normalizeScanFolder(trimmed));
  }

  return Array.from(unique).sort((a, b) => a.localeCompare(b));
}

async function runScanWithFolders(
  triggeredBy: InstallScanTrigger,
  folders: string[]
): Promise<InstallScanStatus> {
  const nextStatus: InstallScanStatus = {
    state: "running",
    triggeredBy,
    startedAt: new Date().toISOString(),
    finishedAt: null,
    phase: "preparing-sidecars",
    phaseProgress: null,
    stats: emptyStats(),
    lastMessage: "Scanning install folders...",
    lastErrors: [],
    etaMs: null,
    lastPreviewImage: null,
    securityWarnings: [],
  };

  scanStatus = nextStatus;
  const allSidecars: ImportedSidecarDescriptor[] = [];

  for (const folder of folders) {
    nextStatus.stats.scannedFolders += 1;

    if (!(await isDirectory(folder))) {
      nextStatus.stats.skipped += 1;
      pushScanError(nextStatus, folder, "Folder does not exist or is not a directory.");
      continue;
    }

    const discovered = await collectSidecarFiles(folder);
    allSidecars.push(...discovered);
  }

  nextStatus.stats.sidecarsSeen = allSidecars.length;

  const byBasename = new Map<string, Set<string>>();
  for (const { sidecarPath } of allSidecars) {
    const ext = path.extname(sidecarPath).toLowerCase();
    const basePath = sidecarPath.slice(0, -ext.length);
    if (!byBasename.has(basePath)) {
      byBasename.set(basePath, new Set());
    }
    byBasename.get(basePath)?.add(ext);
  }

  const blockedSidecars = new Set<string>();
  for (const [basePath, extensions] of byBasename.entries()) {
    if (extensions.has(".round") && extensions.has(".hero")) {
      blockedSidecars.add(`${basePath}.round`);
      blockedSidecars.add(`${basePath}.hero`);
      nextStatus.stats.skipped += 2;
      pushScanError(
        nextStatus,
        basePath,
        "Found both .round and .hero sidecars for the same basename."
      );
    }
  }

  const context = await createInstallSessionContext();
  const preparedSidecars = await mapWithConcurrencyLimit(
    allSidecars,
    context.prepConcurrency,
    async ({ sidecarPath, source }) => {
      throwIfAbortRequested();
      if (blockedSidecars.has(sidecarPath)) {
        return {
          sidecarPath,
          entry: null,
          error: null,
        };
      }

      try {
        return {
          sidecarPath,
          entry: await prepareSidecar(context, sidecarPath, source),
          error: null,
        };
      } catch (error) {
        if (error instanceof InstallAbortError) {
          throw error;
        }

        return {
          sidecarPath,
          entry: null,
          error,
        };
      }
    }
  );

  for (const prepared of preparedSidecars) {
    throwIfAbortRequested();
    if (!prepared.entry) {
      if (prepared.error) {
        recordInstallError(nextStatus, prepared.sidecarPath, prepared.error);
      }
      continue;
    }

    try {
      const result = await persistPreparedEntry(context, prepared.entry);
      nextStatus.stats.installed += result.installed;
      nextStatus.stats.playlistsImported += result.playlistsImported;
      nextStatus.stats.updated += result.updated;
    } catch (error) {
      recordInstallError(nextStatus, prepared.sidecarPath, error);
    }
  }

  try {
    void startWebsiteVideoScan().catch((error) => {
      console.error("Failed to queue website video caching", error);
    });
  } catch {
    // Non-critical, continue
  }

  try {
    await reconcileTemplateRounds(context);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Template linking failed.";
    pushScanError(nextStatus, "templates", message);
  }

  nextStatus.securityWarnings = [...context.securityWarnings];

  try {
    throwIfAbortRequested();
    await syncExternalSources(triggeredBy);
  } catch (error) {
    const message = error instanceof Error ? error.message : "External source sync failed.";
    pushScanError(nextStatus, "external", message);
  }

  nextStatus.state = "done";
  nextStatus.finishedAt = new Date().toISOString();
  nextStatus.phase = "done";
  nextStatus.phaseProgress = null;
  nextStatus.lastMessage = `Scan finished. ${formatImportStatsSummary(nextStatus.stats)}`;

  scanStatus = nextStatus;
  return cloneStatus(nextStatus);
}

function toImportedSidecarDescriptorsFromManifest(
  manifest: FpackExtractionManifest
): ImportedSidecarDescriptor[] {
  return manifest.sidecarEntries.map((entry) => ({
    sidecarPath: entry.extractedPath,
    source: {
      sourceKind: "fpack",
      archiveEntryPath: entry.archiveEntryPath,
    },
  }));
}

async function importPreparedSidecars(
  sidecars: ImportedSidecarDescriptor[],
  allowedBaseDomains: string[] = [],
  initialMessage = "Importing content..."
): Promise<InstallFolderScanResult> {
  const nextStatus: InstallScanStatus = {
    state: "running",
    triggeredBy: "manual",
    startedAt: new Date().toISOString(),
    finishedAt: null,
    phase: "preparing-sidecars",
    phaseProgress: null,
    stats: {
      ...emptyStats(),
      sidecarsSeen: sidecars.length,
      totalSidecars: sidecars.length,
    },
    lastMessage: initialMessage,
    lastErrors: [],
    etaMs: null,
    lastPreviewImage: null,
    securityWarnings: [],
  };
  scanStatus = nextStatus;

  const context = await createInstallSessionContext(allowedBaseDomains);
  const preparedSidecars = await mapWithConcurrencyLimit(
    sidecars,
    context.prepConcurrency,
    async ({ sidecarPath, source }) => {
      throwIfAbortRequested();
      try {
        updateRunningScanPhase("preparing-sidecars", {
          message: `Preparing ${path.basename(sidecarPath)}...`,
          progress: null,
        });
        return {
          sidecarPath,
          entry: await prepareSidecar(context, sidecarPath, source),
          error: null,
        };
      } catch (error) {
        if (error instanceof InstallAbortError) {
          throw error;
        }
        return {
          sidecarPath,
          entry: null,
          error,
        };
      }
    }
  );

  for (const prepared of preparedSidecars) {
    throwIfAbortRequested();
    if (!prepared.entry) {
      if (prepared.error) {
        recordInstallError(nextStatus, prepared.sidecarPath, prepared.error);
      }
      continue;
    }

    updateRunningScanPhase("persisting", {
      message: `Persisting ${path.basename(prepared.sidecarPath)}...`,
      progress: null,
    });
    try {
      const result = await persistPreparedEntry(context, prepared.entry);
      nextStatus.stats.installed += result.installed;
      nextStatus.stats.playlistsImported += result.playlistsImported;
      nextStatus.stats.updated += result.updated;
    } catch (error) {
      recordInstallError(nextStatus, prepared.sidecarPath, error);
    }
  }

  try {
    await reconcileTemplateRounds(context);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Template linking failed.";
    pushScanError(nextStatus, "templates", message);
  }

  nextStatus.securityWarnings = [...context.securityWarnings];

  try {
    throwIfAbortRequested();
    updateRunningScanPhase("syncing", {
      message: "Syncing external sources...",
      progress: null,
    });
    await syncExternalSources("manual");
  } catch (error) {
    const message = error instanceof Error ? error.message : "External source sync failed.";
    pushScanError(nextStatus, "external", message);
  }

  nextStatus.state = "done";
  nextStatus.finishedAt = new Date().toISOString();
  nextStatus.phase = "done";
  nextStatus.phaseProgress = null;
  nextStatus.lastMessage = `Import finished. ${formatImportStatsSummary(nextStatus.stats)}`;
  scanStatus = nextStatus;

  return {
    status: cloneStatus(nextStatus),
    securityWarnings: [...context.securityWarnings],
  };
}

async function scanInstallFolderOnceWithLegacySupportResolved(
  normalizedFolder: string,
  options?: { omitCheckpointRounds?: boolean } & PrepareMediaOptions
): Promise<InstallFolderScanResult> {
  activeManualFolderImport = true;

  try {
    const status = await scanInstallSources("manual", [normalizedFolder]);
    if (status.state !== "done") {
      return { status };
    }

    if (
      status.stats.installed > 0 ||
      status.stats.playlistsImported > 0 ||
      status.stats.updated > 0
    ) {
      return { status };
    }

    scanStatus = {
      ...cloneStatus(status),
      state: "running",
      finishedAt: null,
      phase: "preparing-sidecars",
      phaseProgress: null,
      lastMessage: "No sidecars found. Preparing legacy video import...",
    };

    throwIfAbortRequested();
    const legacy = await importLegacyFolderAsRounds(normalizedFolder, options);
    const nextStatus: InstallScanStatus = cloneStatus(scanStatus);
    nextStatus.state = "done";
    nextStatus.finishedAt = new Date().toISOString();
    nextStatus.phase = "done";
    nextStatus.phaseProgress = null;
    nextStatus.stats.installed += legacy.installed;
    nextStatus.stats.updated += legacy.updated;
    nextStatus.lastMessage = `Legacy import finished. ${formatImportStatsSummary(nextStatus.stats)}`;

    scanStatus = nextStatus;
    return {
      status: nextStatus,
      legacyImport: {
        roundIds: legacy.roundIds,
        orderedSlots: legacy.orderedSlots,
        playlistNameHint: legacy.playlistNameHint,
      },
    };
  } catch (error) {
    if (error instanceof InstallAbortError) {
      const abortedStatus: InstallScanStatus = {
        ...scanStatus,
        state: "aborted",
        finishedAt: new Date().toISOString(),
        phase: "aborted",
        phaseProgress: null,
        lastMessage: "Import aborted by user.",
      };
      scanStatus = abortedStatus;
      return { status: cloneStatus(abortedStatus) };
    }

    throw error;
  } finally {
    activeManualFolderImport = false;
    abortRequested = false;
  }
}

export async function scanInstallFolderOnceWithLegacySupport(
  folderPath: string,
  options?: { omitCheckpointRounds?: boolean } & PrepareMediaOptions
): Promise<InstallFolderScanResult> {
  const normalizedFolder = await resolveApprovedInstallFolder(folderPath);
  return scanInstallFolderOnceWithLegacySupportResolved(normalizedFolder, options);
}

export async function importLegacyFolderWithPlan(
  folderPath: string,
  reviewedSlots: ReviewedLegacyImportSlot[],
  options?: PrepareMediaOptions
): Promise<InstallFolderScanResult> {
  activeManualFolderImport = true;

  try {
    const normalizedFolder = await resolveApprovedInstallFolder(folderPath);
    const nextStatus: InstallScanStatus = {
      state: "running",
      triggeredBy: "manual",
      startedAt: new Date().toISOString(),
      finishedAt: null,
      phase: "preparing-sidecars",
      phaseProgress: null,
      stats: emptyStats(),
      lastMessage: "Preparing reviewed legacy video import...",
      lastErrors: [],
      etaMs: null,
      lastPreviewImage: null,
      securityWarnings: [],
    };
    scanStatus = nextStatus;

    throwIfAbortRequested();
    const legacy = await importLegacyFolderFromReviewedSlots(
      normalizedFolder,
      reviewedSlots,
      options
    );
    nextStatus.state = "done";
    nextStatus.finishedAt = new Date().toISOString();
    nextStatus.phase = "done";
    nextStatus.phaseProgress = null;
    nextStatus.stats.scannedFolders = 1;
    nextStatus.stats.installed = legacy.installed;
    nextStatus.stats.updated = legacy.updated;
    nextStatus.lastMessage = `Legacy import finished. ${formatImportStatsSummary(nextStatus.stats)}`;
    scanStatus = nextStatus;

    return {
      status: cloneStatus(nextStatus),
      legacyImport: {
        roundIds: legacy.roundIds,
        orderedSlots: legacy.orderedSlots,
        playlistNameHint: legacy.playlistNameHint,
      },
    };
  } catch (error) {
    if (error instanceof InstallAbortError) {
      const abortedStatus: InstallScanStatus = {
        ...scanStatus,
        state: "aborted",
        finishedAt: new Date().toISOString(),
        phase: "aborted",
        phaseProgress: null,
        lastMessage: "Import aborted by user.",
      };
      scanStatus = abortedStatus;
      return { status: cloneStatus(abortedStatus) };
    }

    throw error;
  } finally {
    activeManualFolderImport = false;
    abortRequested = false;
  }
}

export async function scanInstallSources(
  triggeredBy: InstallScanTrigger,
  folderPaths?: string[]
): Promise<InstallScanStatus> {
  if (activeScanPromise) {
    return activeScanPromise;
  }

  const folders = resolveScanFolders(folderPaths);
  abortRequested = false;

  activeScanPromise = runScanWithFolders(triggeredBy, folders)
    .catch((error) => {
      if (error instanceof InstallAbortError) {
        const abortedStatus: InstallScanStatus = {
          ...scanStatus,
          state: "aborted",
          finishedAt: new Date().toISOString(),
          phase: "aborted",
          phaseProgress: null,
          lastMessage: "Import aborted by user.",
        };
        scanStatus = abortedStatus;
        return cloneStatus(abortedStatus);
      }

      const failedStatus: InstallScanStatus = {
        ...scanStatus,
        state: "error",
        finishedAt: new Date().toISOString(),
        phase: "error",
        phaseProgress: null,
        lastMessage: error instanceof Error ? error.message : "Scan failed.",
      };

      if (error instanceof Error) {
        pushScanError(failedStatus, "scan", error.message);
      } else {
        pushScanError(failedStatus, "scan", "Unknown scan error.");
      }

      scanStatus = failedStatus;
      return cloneStatus(failedStatus);
    })
    .finally(() => {
      activeScanPromise = null;
      if (!activeManualFolderImport) {
        abortRequested = false;
      }
    });

  return activeScanPromise;
}
