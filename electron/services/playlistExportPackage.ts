import crypto from "node:crypto";
import type { ChildProcess } from "node:child_process";
import { createReadStream, createWriteStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { eq } from "drizzle-orm";
import {
  PLAYLIST_FILE_FORMAT,
  PLAYLIST_FILE_VERSION,
  ZPlaylistConfig,
  ZPlaylistEnvelopeV1,
  type PlaylistConfig,
  type PortableRoundRef,
} from "../../src/game/playlistSchema";
import { resolvePortableRoundRefExact } from "../../src/game/playlistResolution";
import { ZHeroSidecar, ZRoundSidecar } from "../../src/zod/installSidecar";
import { getDb } from "./db";
import { playlist as playlistTable } from "./db/schema";
import { assertApprovedDialogPath } from "./dialogPathApproval";
import { fetchStashMediaWithAuth } from "./integrations/stashClient";
import { stashProvider } from "./integrations/providers/stashProvider";
import { listExternalSources, normalizeBaseUrl } from "./integrations/store";
import { fromLocalMediaUri, toPortableRelativePath } from "./localMedia";
import {
  buildAv1EncodeArgs,
  detectAv1Encoder,
  estimateCompressionForProbes,
  getParallelJobsForEncoder,
  getCompressionStrengthLabel,
  isAv1Codec,
  normalizeCompressionStrength,
  probeLocalVideo,
  transcodeVideoToAv1,
  type Av1TranscodeProgress,
  type Av1EncoderDetails,
  type PlaylistExportCompressionEncoderKind,
  type PlaylistExportCompressionMode,
  type PlaylistExportCompressionPhase,
  type PlaylistExportEstimate,
  type PlaylistExportVideoProbe,
} from "./playlistExportCompression";
import { resolvePhashBinaries } from "./phash/binaries";
import { getCachedWebsiteVideoLocalPath } from "./webVideo";

type ExportPackageInput = {
  playlistId: string;
  directoryPath: string;
  compressionMode?: PlaylistExportCompressionMode;
  compressionStrength?: number;
  includeMedia?: boolean;
  asFpack?: boolean;
};

type AnalyzeExportPackageInput = {
  playlistId: string;
  compressionMode?: PlaylistExportCompressionMode;
  compressionStrength?: number;
  includeMedia?: boolean;
};

export type PlaylistExportPackageState = "idle" | "running" | "done" | "aborted" | "error";

export type PlaylistExportPackageCompressionStatus = {
  enabled: boolean;
  encoderName: string | null;
  encoderKind: PlaylistExportCompressionEncoderKind | null;
  strength: number;
  reencodedCompleted: number;
  reencodedTotal: number;
  alreadyAv1Copied: number;
  activeJobs: number;
  expectedVideoBytes: number;
  estimatedCompressionSeconds: number;
  approximate: boolean;
  liveProgress: {
    completedDurationMs: number;
    totalDurationMs: number;
    percent: number;
    etaSecondsRemaining: number | null;
  };
};

export type PlaylistExportPackageStatus = {
  state: PlaylistExportPackageState;
  phase: PlaylistExportCompressionPhase;
  startedAt: string | null;
  finishedAt: string | null;
  lastMessage: string | null;
  progress: {
    completed: number;
    total: number;
  };
  stats: {
    playlistFiles: number;
    sidecarFiles: number;
    videoFiles: number;
    funscriptFiles: number;
  };
  compression: PlaylistExportPackageCompressionStatus | null;
};

export type ExportPackageResult = {
  exportDir: string;
  playlistFilePath: string;
  sidecarFiles: number;
  videoFiles: number;
  funscriptFiles: number;
  referencedRounds: number;
  compression: {
    enabled: boolean;
    encoderName: string | null;
    encoderKind: PlaylistExportCompressionEncoderKind | null;
    strength: number;
    reencodedVideos: number;
    alreadyAv1Copied: number;
    actualVideoBytes: number;
  };
};

export type PlaylistExportPackageAnalysis = {
  videoTotals: {
    uniqueVideos: number;
    localVideos: number;
    remoteVideos: number;
    alreadyAv1Videos: number;
    estimatedReencodeVideos: number;
  };
  compression: {
    supported: boolean;
    defaultMode: PlaylistExportCompressionMode;
    encoderName: string | null;
    encoderKind: PlaylistExportCompressionEncoderKind | null;
    warning: string | null;
    strength: number;
    estimate: PlaylistExportEstimate;
  };
  settings: {
    outputContainer: "mp4";
    audioCodec: "aac";
    audioBitrateKbps: 128;
    lowPriority: true;
    parallelJobs: number;
  };
  estimate: PlaylistExportEstimate;
};

type ExportableResource = {
  videoUri: string;
  funscriptUri: string | null;
  phash: string | null;
  durationMs: number | null;
};

type ExportableHero = {
  id: string;
  name: string;
  author: string | null;
  description: string | null;
  phash: string | null;
};

type ExportableRound = {
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
  excludeFromRandom: boolean;
  installSourceKey: string | null;
  heroId: string | null;
  hero: ExportableHero | null;
  resources: ExportableResource[];
};

type PlaylistRow = {
  id: string;
  name: string;
  description: string | null;
  configJson: string;
};

type ResolvedPlaylistExport = {
  playlist: {
    id: string;
    name: string;
    description: string | null;
    config: PlaylistConfig;
  };
  rounds: ExportableRound[];
};

type PortableRefEntry = {
  key: string;
  ref: PortableRoundRef;
};

type ExportedMediaFile = {
  absolutePath: string;
  relativePath: string;
};

type MaterializedResource = {
  canonicalVideoKey: string;
  video: ExportedMediaFile | null;
  funscript: ExportedMediaFile | null;
};

type RoundResourceEntry = {
  round: ExportableRound;
  resource: ExportableResource;
  materialized: MaterializedResource | null;
};

type ResourceReference = {
  round: ExportableRound;
  resource: ExportableResource;
  preferredBaseName: string;
};

type VideoTask = {
  canonicalKey: string;
  uri: string;
  installSourceKey: string | null;
  preferredBaseName: string;
  originalExtension: string;
  probe: PlaylistExportVideoProbe;
  output: ExportedMediaFile | null;
};

type FunscriptTask = {
  canonicalKey: string;
  uri: string;
  installSourceKey: string | null;
  preferredBaseName: string;
  output: ExportedMediaFile | null;
};

type PreparedPlaylistExport = {
  loaded: ResolvedPlaylistExport;
  videoTasks: VideoTask[];
  funscriptTasks: FunscriptTask[];
  resourceReferences: ResourceReference[];
  encoder: Av1EncoderDetails | null;
  effectiveCompressionMode: PlaylistExportCompressionMode;
  compressionStrength: number;
  parallelJobs: number;
  analysis: PlaylistExportPackageAnalysis;
};

type CompressionLiveTracker = {
  startedAtMs: number | null;
  totalDurationMs: number;
  completedDurationMs: number;
  expectedDurationMsByTaskKey: Map<string, number>;
  activeByTaskKey: Map<string, { durationMs: number; encodedDurationMs: number }>;
};

class ExportAbortError extends Error {
  constructor() {
    super("Playlist export aborted.");
  }
}

function isAbortLikeError(error: unknown): boolean {
  if (error instanceof ExportAbortError) return true;
  if (!(error instanceof Error)) return false;
  return error.name === "AbortError" || error.message === "Aborted";
}

const WINDOWS_RESERVED_BASENAMES = new Set([
  "CON",
  "PRN",
  "AUX",
  "NUL",
  "COM1",
  "COM2",
  "COM3",
  "COM4",
  "COM5",
  "COM6",
  "COM7",
  "COM8",
  "COM9",
  "LPT1",
  "LPT2",
  "LPT3",
  "LPT4",
  "LPT5",
  "LPT6",
  "LPT7",
  "LPT8",
  "LPT9",
]);

let activeExportPromise: Promise<ExportPackageResult> | null = null;
let abortRequested = false;
const activeTransferAbortControllers = new Set<AbortController>();
const activeEncodeChildren = new Set<ChildProcess>();
let exportStatus: PlaylistExportPackageStatus = {
  state: "idle",
  phase: "idle",
  startedAt: null,
  finishedAt: null,
  lastMessage: null,
  progress: {
    completed: 0,
    total: 0,
  },
  stats: {
    playlistFiles: 0,
    sidecarFiles: 0,
    videoFiles: 0,
    funscriptFiles: 0,
  },
  compression: null,
};

function cloneStatus(status: PlaylistExportPackageStatus): PlaylistExportPackageStatus {
  return JSON.parse(JSON.stringify(status)) as PlaylistExportPackageStatus;
}

function throwIfAbortRequested(): void {
  if (abortRequested) {
    throw new ExportAbortError();
  }
}

function updateExportPhase(phase: PlaylistExportCompressionPhase, message?: string): void {
  if (exportStatus.state !== "running") return;
  exportStatus = {
    ...exportStatus,
    phase,
    lastMessage: message ?? exportStatus.lastMessage,
  };
}

function setExportProgress(input: Partial<PlaylistExportPackageStatus["progress"]>): void {
  if (exportStatus.state !== "running") return;
  exportStatus = {
    ...exportStatus,
    progress: {
      ...exportStatus.progress,
      ...input,
    },
  };
}

function incrementExportProgress(amount = 1): void {
  setExportProgress({ completed: exportStatus.progress.completed + amount });
}

function incrementExportStat(key: keyof PlaylistExportPackageStatus["stats"]): void {
  if (exportStatus.state !== "running") return;
  exportStatus = {
    ...exportStatus,
    stats: {
      ...exportStatus.stats,
      [key]: exportStatus.stats[key] + 1,
    },
  };
}

function setCompressionStatus(input: Partial<PlaylistExportPackageCompressionStatus>): void {
  if (exportStatus.state !== "running" || !exportStatus.compression) return;
  exportStatus = {
    ...exportStatus,
    compression: {
      ...exportStatus.compression,
      ...input,
    },
  };
}

function createCompressionLiveProgress(
  totalDurationMs = 0
): PlaylistExportPackageCompressionStatus["liveProgress"] {
  return {
    completedDurationMs: 0,
    totalDurationMs,
    percent: 0,
    etaSecondsRemaining: null,
  };
}

function createCompressionLiveTracker(tasks: VideoTask[]): CompressionLiveTracker {
  const expectedDurationMsByTaskKey = new Map<string, number>();
  let totalDurationMs = 0;
  for (const task of tasks) {
    if (isAv1Codec(task.probe.codecName)) continue;
    const durationMs = Math.max(0, task.probe.durationMs ?? 0);
    expectedDurationMsByTaskKey.set(task.canonicalKey, durationMs);
    totalDurationMs += durationMs;
  }

  return {
    startedAtMs: null,
    totalDurationMs,
    completedDurationMs: 0,
    expectedDurationMsByTaskKey,
    activeByTaskKey: new Map(),
  };
}

function syncCompressionLiveProgress(tracker: CompressionLiveTracker): void {
  if (exportStatus.state !== "running" || !exportStatus.compression) return;

  let activeDurationMs = 0;
  for (const entry of tracker.activeByTaskKey.values()) {
    activeDurationMs += Math.min(Math.max(0, entry.encodedDurationMs), entry.durationMs);
  }

  const completedDurationMs = Math.min(
    tracker.totalDurationMs,
    Math.max(0, tracker.completedDurationMs + activeDurationMs)
  );
  const totalDurationMs = Math.max(0, tracker.totalDurationMs);
  const percent =
    totalDurationMs > 0 ? Math.max(0, Math.min(1, completedDurationMs / totalDurationMs)) : 0;

  let etaSecondsRemaining: number | null = null;
  if (totalDurationMs > 0) {
    const remainingDurationMs = Math.max(0, totalDurationMs - completedDurationMs);
    if (remainingDurationMs === 0) {
      etaSecondsRemaining = 0;
    } else {
      const baselineEtaSeconds = Math.ceil(
        (exportStatus.compression.estimatedCompressionSeconds || 0) * (1 - percent)
      );
      etaSecondsRemaining = baselineEtaSeconds > 0 ? baselineEtaSeconds : null;

      if (tracker.startedAtMs !== null && completedDurationMs > 0) {
        const elapsedSeconds = Math.max(0, (Date.now() - tracker.startedAtMs) / 1000);
        if (elapsedSeconds >= 5) {
          const processedDurationPerSecond = completedDurationMs / 1000 / elapsedSeconds;
          if (processedDurationPerSecond > 0) {
            etaSecondsRemaining = Math.max(
              1,
              Math.ceil(remainingDurationMs / 1000 / processedDurationPerSecond)
            );
          }
        }
      }
    }
  }

  setCompressionStatus({
    liveProgress: {
      completedDurationMs,
      totalDurationMs,
      percent,
      etaSecondsRemaining,
    },
  });
}

function ensureExpectedTaskDuration(
  tracker: CompressionLiveTracker,
  taskKey: string,
  durationMs: number | null | undefined
): number {
  const normalizedDurationMs = Math.max(0, durationMs ?? 0);
  const previousDurationMs = tracker.expectedDurationMsByTaskKey.get(taskKey) ?? 0;
  if (previousDurationMs !== normalizedDurationMs) {
    tracker.expectedDurationMsByTaskKey.set(taskKey, normalizedDurationMs);
    tracker.totalDurationMs = Math.max(
      0,
      tracker.totalDurationMs - previousDurationMs + normalizedDurationMs
    );
  }
  syncCompressionLiveProgress(tracker);
  return normalizedDurationMs;
}

function startCompressionJob(
  tracker: CompressionLiveTracker,
  taskKey: string,
  durationMs: number | null | undefined
): number {
  const normalizedDurationMs = ensureExpectedTaskDuration(tracker, taskKey, durationMs);
  if (tracker.startedAtMs === null) {
    tracker.startedAtMs = Date.now();
  }
  tracker.activeByTaskKey.set(taskKey, {
    durationMs: normalizedDurationMs,
    encodedDurationMs: 0,
  });
  syncCompressionLiveProgress(tracker);
  return normalizedDurationMs;
}

function updateCompressionJobProgress(
  tracker: CompressionLiveTracker,
  taskKey: string,
  progress: Av1TranscodeProgress
): void {
  const activeEntry = tracker.activeByTaskKey.get(taskKey);
  if (!activeEntry) return;
  const nextDurationMs =
    activeEntry.durationMs > 0
      ? Math.min(activeEntry.durationMs, Math.max(0, progress.encodedDurationMs))
      : Math.max(0, progress.encodedDurationMs);
  tracker.activeByTaskKey.set(taskKey, {
    ...activeEntry,
    encodedDurationMs: nextDurationMs,
  });
  syncCompressionLiveProgress(tracker);
}

function finishCompressionJob(tracker: CompressionLiveTracker, taskKey: string): void {
  const activeEntry = tracker.activeByTaskKey.get(taskKey);
  if (!activeEntry) return;
  tracker.completedDurationMs += activeEntry.durationMs;
  tracker.activeByTaskKey.delete(taskKey);
  syncCompressionLiveProgress(tracker);
}

function skipCompressionJob(tracker: CompressionLiveTracker, taskKey: string): void {
  const previousDurationMs = tracker.expectedDurationMsByTaskKey.get(taskKey) ?? 0;
  tracker.totalDurationMs = Math.max(0, tracker.totalDurationMs - previousDurationMs);
  tracker.expectedDurationMsByTaskKey.delete(taskKey);
  tracker.activeByTaskKey.delete(taskKey);
  syncCompressionLiveProgress(tracker);
}

function parsePlaylistConfig(raw: string): PlaylistConfig {
  return ZPlaylistConfig.parse(JSON.parse(raw) as unknown);
}

function toSafeIsoTimestamp(date: Date): string {
  return date.toISOString().replaceAll(":", "-");
}

export function sanitizeFileSystemName(value: string, fallback = "unnamed"): string {
  const trimmed = value.trim();
  const stripped = trimmed
    // eslint-disable-next-line no-control-regex
    .replace(/[<>:"/\\|?*\u0000-\u001F]+/g, " ")
    .replace(/\s+/g, " ")
    .replace(/[. ]+$/g, "")
    .trim();
  const normalized = stripped.length > 0 ? stripped : fallback;
  const reservedSafe = WINDOWS_RESERVED_BASENAMES.has(normalized.toUpperCase())
    ? `${normalized}_`
    : normalized;
  return reservedSafe || fallback;
}

function sanitizeExtension(value: string, fallback: string): string {
  const normalized = value.trim().toLowerCase();
  if (/^\.[a-z0-9]{1,12}$/i.test(normalized)) {
    return normalized;
  }
  return fallback;
}

function inferExtensionFromUri(uri: string, fallback: string): string {
  const localPath = fromLocalMediaUri(uri);
  if (localPath) {
    return sanitizeExtension(path.extname(localPath), fallback);
  }

  try {
    const parsed = new URL(uri);
    return sanitizeExtension(path.posix.extname(decodeURIComponent(parsed.pathname)), fallback);
  } catch {
    return fallback;
  }
}

function canonicalizeResourceKey(uri: string): string {
  const localPath = fromLocalMediaUri(uri);
  if (localPath) {
    return `local:${path.normalize(localPath)}`;
  }

  try {
    return new URL(uri).toString();
  } catch {
    return uri.trim();
  }
}

async function resolveLocalSourcePath(uri: string): Promise<string | null> {
  const localPath = fromLocalMediaUri(uri);
  if (localPath) return localPath;
  return getCachedWebsiteVideoLocalPath(uri);
}

function collectPortableRefs(config: PlaylistConfig): PortableRefEntry[] {
  if (config.boardConfig.mode === "linear") {
    const refs: PortableRefEntry[] = [];
    for (const [index, ref] of config.boardConfig.normalRoundOrder.entries()) {
      refs.push({ key: `linear.normalRoundOrder.${index}`, ref });
    }
    for (const [indexKey, ref] of Object.entries(config.boardConfig.normalRoundRefsByIndex)) {
      refs.push({ key: `linear.normalRoundRefsByIndex.${indexKey}`, ref });
    }
    for (const [index, ref] of config.boardConfig.cumRoundRefs.entries()) {
      refs.push({ key: `linear.cumRoundRefs.${index}`, ref });
    }
    return refs;
  }

  const refs: PortableRefEntry[] = [];
  for (const node of config.boardConfig.nodes) {
    if (node.roundRef) {
      refs.push({ key: `graph.nodes.${node.id}.roundRef`, ref: node.roundRef });
    }
  }
  for (const pool of config.boardConfig.randomRoundPools) {
    for (const [index, candidate] of pool.candidates.entries()) {
      refs.push({
        key: `graph.randomRoundPools.${pool.id}.candidates.${index}`,
        ref: candidate.roundRef,
      });
    }
  }
  for (const [index, ref] of config.boardConfig.cumRoundRefs.entries()) {
    refs.push({ key: `graph.cumRoundRefs.${index}`, ref });
  }
  return refs;
}

function createPlaylistEnvelope(playlist: ResolvedPlaylistExport["playlist"]) {
  return ZPlaylistEnvelopeV1.parse({
    format: PLAYLIST_FILE_FORMAT,
    version: PLAYLIST_FILE_VERSION,
    metadata: {
      name: playlist.name,
      description: playlist.description ?? undefined,
      exportedAt: new Date().toISOString(),
    },
    config: playlist.config,
  });
}

async function ensurePathDoesNotExist(targetPath: string): Promise<void> {
  throwIfAbortRequested();
  try {
    await fs.stat(targetPath);
    throw new Error(`Export target already exists: ${targetPath}`);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException | undefined)?.code;
    if (code === "ENOENT") return;
    if (error instanceof Error) throw error;
    throw new Error(`Export target already exists: ${targetPath}`);
  }
}

async function loadPlaylistForExport(playlistId: string): Promise<ResolvedPlaylistExport> {
  throwIfAbortRequested();
  const playlistRow = (await getDb().query.playlist.findFirst({
    where: eq(playlistTable.id, playlistId),
  })) as PlaylistRow | null;

  if (!playlistRow) {
    throw new Error("Playlist not found.");
  }

  const config = parsePlaylistConfig(playlistRow.configJson);
  const installedRounds = (await getDb().query.round.findMany({
    with: {
      hero: true,
      resources: true,
    },
  })) as ExportableRound[];

  const unresolvedKeys: string[] = [];
  const roundById = new Map<string, ExportableRound>();
  for (const entry of collectPortableRefs(config)) {
    const resolved = resolvePortableRoundRefExact(entry.ref, installedRounds);
    if (!resolved) {
      unresolvedKeys.push(entry.key);
      continue;
    }
    roundById.set(resolved.id, resolved as ExportableRound);
  }

  if (unresolvedKeys.length > 0) {
    throw new Error(
      `Playlist export failed because some round refs are unresolved: ${unresolvedKeys.join(", ")}`
    );
  }

  return {
    playlist: {
      id: playlistRow.id,
      name: playlistRow.name,
      description: playlistRow.description,
      config,
    },
    rounds: Array.from(roundById.values()).sort((a, b) => {
      const byName = a.name.localeCompare(b.name, undefined, {
        sensitivity: "base",
        numeric: true,
      });
      if (byName !== 0) return byName;
      return a.id.localeCompare(b.id);
    }),
  };
}

async function writeJsonFile(filePath: string, payload: unknown): Promise<void> {
  throwIfAbortRequested();
  await fs.writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

function toUniqueCaseInsensitiveFileName(
  usedNames: Set<string>,
  baseName: string,
  extension: string
): string {
  const normalizedExtension = extension.startsWith(".") ? extension : `.${extension}`;
  let candidate = `${baseName}${normalizedExtension}`;
  let suffix = 2;
  while (usedNames.has(candidate.toLowerCase())) {
    candidate = `${baseName}-${suffix}${normalizedExtension}`;
    suffix += 1;
  }
  usedNames.add(candidate.toLowerCase());
  return candidate;
}

function registerTransferController(controller: AbortController): void {
  activeTransferAbortControllers.add(controller);
}

function unregisterTransferController(controller: AbortController): void {
  activeTransferAbortControllers.delete(controller);
}

async function withTransferAbort<T>(
  runner: (controller: AbortController) => Promise<T>
): Promise<T> {
  throwIfAbortRequested();
  const controller = new AbortController();
  registerTransferController(controller);
  try {
    return await runner(controller);
  } catch (error) {
    if (isAbortLikeError(error)) {
      throw new ExportAbortError();
    }
    throw error;
  } finally {
    unregisterTransferController(controller);
  }
}

type ExternalSourceRecord = ReturnType<typeof listExternalSources>[number];

async function resolveRemoteResponse(
  uri: string,
  installSourceKey: string | null,
  request: Request
): Promise<Response> {
  const enabledSources = listExternalSources().filter((source) => source.enabled);
  for (const source of enabledSources) {
    if (source.kind !== "stash") continue;
    const shouldUseByInstallSource = installSourceKey?.startsWith(
      `stash:${normalizeBaseUrl(source.baseUrl)}:scene:`
    );
    const shouldUseByUri = stashProvider.canHandleUri(uri, source);
    if (!shouldUseByInstallSource && !shouldUseByUri) continue;
    return fetchStashMediaWithAuth(source as ExternalSourceRecord, uri, request);
  }
  return fetch(uri, {
    method: request.method,
    headers: request.headers,
    signal: request.signal,
  });
}

async function copyLocalFile(sourcePath: string, destinationPath: string): Promise<void> {
  await withTransferAbort(async (controller) => {
    let completed = false;
    try {
      await pipeline(createReadStream(sourcePath), createWriteStream(destinationPath), {
        signal: controller.signal,
      });
      throwIfAbortRequested();
      completed = true;
    } finally {
      if (!completed) {
        await fs.rm(destinationPath, { force: true }).catch(() => {});
      }
    }
  });
}

async function ensureLocalSourceExists(sourcePath: string, resourceLabel: string): Promise<void> {
  try {
    const stats = await fs.stat(sourcePath);
    if (!stats.isFile()) {
      throw new Error(`Local ${resourceLabel} source is not a file: ${sourcePath}`);
    }
  } catch (error) {
    const code = (error as NodeJS.ErrnoException | undefined)?.code;
    if (code === "ENOENT") {
      throw new Error(`Local ${resourceLabel} source is missing: ${sourcePath}`);
    }
    throw error;
  }
}

async function downloadRemoteResource(
  uri: string,
  installSourceKey: string | null,
  destinationPath: string
): Promise<void> {
  await withTransferAbort(async (controller) => {
    let completed = false;
    try {
      const response = await resolveRemoteResponse(
        uri,
        installSourceKey,
        new Request(uri, { method: "GET", signal: controller.signal })
      );
      if (!response.ok) {
        throw new Error(
          `Failed to download resource: ${response.status} ${response.statusText}`.trim()
        );
      }
      if (!response.body) {
        throw new Error("Failed to download resource: empty response body.");
      }
      await pipeline(
        Readable.fromWeb(response.body as unknown as import("node:stream/web").ReadableStream),
        createWriteStream(destinationPath),
        { signal: controller.signal }
      );
      throwIfAbortRequested();
      completed = true;
    } finally {
      if (!completed) {
        await fs.rm(destinationPath, { force: true }).catch(() => {});
      }
    }
  });
}

function parseContentLength(headers: Headers): number | null {
  const raw = headers.get("content-length");
  if (!raw) return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function parseContentRange(headers: Headers): number | null {
  const raw = headers.get("content-range");
  if (!raw) return null;
  const match = raw.match(/\/(\d+)\s*$/);
  if (!match) return null;
  const parsed = Number(match[1]);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

async function fetchRemoteVideoMetadata(task: VideoTask): Promise<PlaylistExportVideoProbe> {
  let fileSizeBytes: number | null = null;

  try {
    await withTransferAbort(async (controller) => {
      try {
        const headResponse = await resolveRemoteResponse(
          task.uri,
          task.installSourceKey,
          new Request(task.uri, { method: "HEAD", signal: controller.signal })
        );
        if (headResponse.ok) {
          fileSizeBytes = parseContentLength(headResponse.headers);
        }
      } catch {
        // Best effort only.
      }
    });
  } catch (error) {
    if (error instanceof ExportAbortError) throw error;
  }

  if (fileSizeBytes === null) {
    try {
      await withTransferAbort(async (controller) => {
        try {
          const rangeResponse = await resolveRemoteResponse(
            task.uri,
            task.installSourceKey,
            new Request(task.uri, {
              method: "GET",
              headers: new Headers({ Range: "bytes=0-0" }),
              signal: controller.signal,
            })
          );
          if (rangeResponse.ok || rangeResponse.status === 206) {
            fileSizeBytes =
              parseContentRange(rangeResponse.headers) ?? parseContentLength(rangeResponse.headers);
          }
        } catch {
          // Best effort only.
        }
      });
    } catch (error) {
      if (error instanceof ExportAbortError) throw error;
    }
  }

  return {
    codecName: null,
    width: null,
    height: null,
    durationMs: task.probe.durationMs,
    fileSizeBytes,
  };
}

function buildResourceInventory(loaded: ResolvedPlaylistExport): {
  resourceReferences: ResourceReference[];
  videoTasks: VideoTask[];
  funscriptTasks: FunscriptTask[];
} {
  const resourceReferences: ResourceReference[] = [];
  const videoTaskByKey = new Map<string, VideoTask>();
  const funscriptTaskByKey = new Map<string, FunscriptTask>();

  for (const round of loaded.rounds) {
    if (round.resources.length === 0) {
      throw new Error(`Round "${round.name}" has no resources to export.`);
    }

    for (const resource of round.resources) {
      const preferredBaseName = round.hero ? round.hero.name : round.name;
      resourceReferences.push({
        round,
        resource,
        preferredBaseName,
      });

      const canonicalVideoKey = canonicalizeResourceKey(resource.videoUri);
      if (!videoTaskByKey.has(canonicalVideoKey)) {
        videoTaskByKey.set(canonicalVideoKey, {
          canonicalKey: canonicalVideoKey,
          uri: resource.videoUri,
          installSourceKey: round.installSourceKey,
          preferredBaseName,
          originalExtension: inferExtensionFromUri(resource.videoUri, ".mp4"),
          probe: {
            codecName: null,
            width: null,
            height: null,
            durationMs: resource.durationMs ?? null,
            fileSizeBytes: null,
          },
          output: null,
        });
      } else if (resource.durationMs && !videoTaskByKey.get(canonicalVideoKey)?.probe.durationMs) {
        const existing = videoTaskByKey.get(canonicalVideoKey);
        if (existing) {
          existing.probe.durationMs = resource.durationMs;
        }
      }

      if (resource.funscriptUri) {
        const canonicalFunscriptKey = canonicalizeResourceKey(resource.funscriptUri);
        if (!funscriptTaskByKey.has(canonicalFunscriptKey)) {
          funscriptTaskByKey.set(canonicalFunscriptKey, {
            canonicalKey: canonicalFunscriptKey,
            uri: resource.funscriptUri,
            installSourceKey: round.installSourceKey,
            preferredBaseName,
            output: null,
          });
        }
      }
    }
  }

  const sortByKey = <T extends { preferredBaseName: string; canonicalKey: string }>(
    left: T,
    right: T
  ) => {
    const byName = left.preferredBaseName.localeCompare(right.preferredBaseName, undefined, {
      sensitivity: "base",
      numeric: true,
    });
    if (byName !== 0) return byName;
    return left.canonicalKey.localeCompare(right.canonicalKey, undefined, {
      sensitivity: "base",
      numeric: true,
    });
  };

  return {
    resourceReferences,
    videoTasks: Array.from(videoTaskByKey.values()).sort(sortByKey),
    funscriptTasks: Array.from(funscriptTaskByKey.values()).sort(sortByKey),
  };
}

async function preparePlaylistExport(
  input: AnalyzeExportPackageInput
): Promise<PreparedPlaylistExport> {
  const loaded = await loadPlaylistForExport(input.playlistId);
  const binaries = await resolvePhashBinaries();
  const encoder = await detectAv1Encoder(binaries.ffmpegPath);
  const compressionStrength = normalizeCompressionStrength(input.compressionStrength);
  const defaultMode: PlaylistExportCompressionMode = encoder ? "av1" : "copy";
  const requestedMode = input.compressionMode ?? defaultMode;
  const effectiveCompressionMode = requestedMode === "av1" && encoder ? "av1" : "copy";
  const parallelJobs = getParallelJobsForEncoder(encoder?.kind ?? null);
  const { resourceReferences, videoTasks, funscriptTasks } = buildResourceInventory(loaded);

  for (const task of videoTasks) {
    const localPath = await resolveLocalSourcePath(task.uri);
    if (localPath) {
      task.probe = await probeLocalVideo(binaries.ffprobePath, localPath);
      if (task.probe.durationMs === null && resourceReferences.length > 0) {
        const matching = resourceReferences.find(
          (entry) => canonicalizeResourceKey(entry.resource.videoUri) === task.canonicalKey
        );
        task.probe.durationMs = matching?.resource.durationMs ?? null;
      }
      continue;
    }
    task.probe = await fetchRemoteVideoMetadata(task);
  }

  const localVideos = videoTasks.filter((task) => task.probe.codecName !== null).length;
  const remoteVideos = videoTasks.length - localVideos;
  const alreadyAv1Videos = videoTasks.filter((task) => isAv1Codec(task.probe.codecName)).length;
  const estimatedReencodeVideos =
    effectiveCompressionMode === "av1"
      ? videoTasks.filter((task) => !isAv1Codec(task.probe.codecName)).length
      : 0;

  const estimate =
    effectiveCompressionMode === "av1" && encoder
      ? estimateCompressionForProbes({
          probes: videoTasks.map((task) => task.probe),
          strength: compressionStrength,
          encoderKind: encoder.kind,
          parallelJobs,
        })
      : ({
          sourceVideoBytes: videoTasks.reduce(
            (sum, task) => sum + (task.probe.fileSizeBytes ?? 0),
            0
          ),
          expectedVideoBytes: videoTasks.reduce(
            (sum, task) => sum + (task.probe.fileSizeBytes ?? 0),
            0
          ),
          savingsBytes: 0,
          estimatedCompressionSeconds: 0,
          approximate: videoTasks.some((task) => task.probe.fileSizeBytes === null),
        } satisfies PlaylistExportEstimate);

  let warning: string | null = null;
  if (!encoder) {
    warning =
      "No AV1 encoder is available in the configured ffmpeg build. Compression is disabled.";
  } else if (encoder.kind === "software") {
    warning =
      "No AV1 hardware encoder was detected. Reencoding on this system may take multiple hours.";
  }

  return {
    loaded,
    videoTasks,
    funscriptTasks,
    resourceReferences,
    encoder,
    effectiveCompressionMode,
    compressionStrength,
    parallelJobs,
    analysis: {
      videoTotals: {
        uniqueVideos: videoTasks.length,
        localVideos,
        remoteVideos,
        alreadyAv1Videos,
        estimatedReencodeVideos,
      },
      compression: {
        supported: Boolean(encoder),
        defaultMode,
        encoderName: encoder?.name ?? null,
        encoderKind: encoder?.kind ?? null,
        warning,
        strength: compressionStrength,
        estimate,
      },
      settings: {
        outputContainer: "mp4",
        audioCodec: "aac",
        audioBitrateKbps: 128,
        lowPriority: true,
        parallelJobs,
      },
      estimate,
    },
  };
}

function estimateExportWork(input: PreparedPlaylistExport) {
  let standaloneSidecars = 0;
  const heroGroups = new Set<string>();

  for (const entry of input.resourceReferences) {
    if (entry.round.heroId && entry.round.hero) {
      heroGroups.add(`${entry.round.heroId}::${canonicalizeResourceKey(entry.resource.videoUri)}`);
    } else {
      standaloneSidecars += 1;
    }
  }

  return {
    videoFiles: input.videoTasks.length,
    funscriptFiles: input.funscriptTasks.length,
    sidecarFiles: standaloneSidecars + heroGroups.size,
    total:
      input.videoTasks.length +
      input.funscriptTasks.length +
      standaloneSidecars +
      heroGroups.size +
      1,
  };
}

function toRoundSidecarPayload(entry: RoundResourceEntry, includeMedia: boolean) {
  return ZRoundSidecar.parse({
    name: entry.round.name,
    author: entry.round.author ?? undefined,
    description: entry.round.description ?? undefined,
    bpm: entry.round.bpm ?? undefined,
    difficulty: entry.round.difficulty ?? undefined,
    phash: entry.round.phash ?? undefined,
    startTime: entry.round.startTime ?? undefined,
    endTime: entry.round.endTime ?? undefined,
    type: entry.round.type,
    excludeFromRandom: entry.round.excludeFromRandom ? true : undefined,
    resources: [
      {
        videoUri:
          includeMedia && entry.materialized?.video
            ? entry.materialized.video.relativePath
            : entry.resource.videoUri,
        funscriptUri: entry.materialized?.funscript
          ? entry.materialized.funscript.relativePath
          : entry.resource.funscriptUri,
      },
    ],
  });
}

function createHeroSidecarPayload(
  hero: ExportableHero,
  entries: RoundResourceEntry[],
  includeMedia: boolean
) {
  return ZHeroSidecar.parse({
    name: hero.name,
    author: hero.author ?? undefined,
    description: hero.description ?? undefined,
    phash: hero.phash ?? undefined,
    rounds: entries
      .slice()
      .sort((a, b) =>
        a.round.name.localeCompare(b.round.name, undefined, { sensitivity: "base", numeric: true })
      )
      .map((entry) => ({
        name: entry.round.name,
        author: entry.round.author ?? undefined,
        description: entry.round.description ?? undefined,
        bpm: entry.round.bpm ?? undefined,
        difficulty: entry.round.difficulty ?? undefined,
        phash: entry.round.phash ?? undefined,
        startTime: entry.round.startTime ?? undefined,
        endTime: entry.round.endTime ?? undefined,
        type: entry.round.type,
        excludeFromRandom: entry.round.excludeFromRandom ? true : undefined,
        resources: [
          {
            videoUri:
              includeMedia && entry.materialized?.video
                ? entry.materialized.video.relativePath
                : entry.resource.videoUri,
            funscriptUri: entry.materialized?.funscript
              ? entry.materialized.funscript.relativePath
              : entry.resource.funscriptUri,
          },
        ],
      })),
  });
}

function formatByteSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  const digits = value >= 100 || unitIndex === 0 ? 0 : value >= 10 ? 1 : 2;
  return `${value.toFixed(digits)} ${units[unitIndex]}`;
}

function formatDurationEstimate(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return "0 min";
  const rounded = Math.max(1, Math.round(seconds));
  const hours = Math.floor(rounded / 3600);
  const minutes = Math.floor((rounded % 3600) / 60);
  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  return `${Math.max(1, minutes)} min`;
}

async function runLimited<T>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<void>
): Promise<void> {
  if (items.length === 0) return;
  const concurrency = Math.max(1, limit);
  let index = 0;

  const runners = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (index < items.length) {
      throwIfAbortRequested();
      const current = items[index];
      index += 1;
      if (!current) continue;
      await worker(current);
    }
  });

  await Promise.all(runners);
}

function allocateMediaOutputs(input: {
  tasks: VideoTask[] | FunscriptTask[];
  usedNames: Set<string>;
  packageDir: string;
  compressionMode: PlaylistExportCompressionMode;
}): void {
  for (const task of input.tasks) {
    const baseName = sanitizeFileSystemName(task.preferredBaseName, "media");
    const extension =
      "probe" in task && input.compressionMode === "av1" && !isAv1Codec(task.probe.codecName)
        ? ".mp4"
        : "probe" in task
          ? sanitizeExtension(task.originalExtension, ".mp4")
          : sanitizeExtension(inferExtensionFromUri(task.uri, ".funscript"), ".funscript");
    const fileName = toUniqueCaseInsensitiveFileName(input.usedNames, baseName, extension);
    const absolutePath = path.join(input.packageDir, fileName);
    task.output = {
      absolutePath,
      relativePath: toPortableRelativePath(input.packageDir, absolutePath),
    };
  }
}

function registerEncodeChild(child: ChildProcess): void {
  activeEncodeChildren.add(child);
}

function unregisterEncodeChild(child: ChildProcess): void {
  activeEncodeChildren.delete(child);
}

async function materializeVideoTask(input: {
  task: VideoTask;
  workDir: string;
  ffmpegPath: string;
  ffprobePath: string;
  encoder: Av1EncoderDetails | null;
  compressionMode: PlaylistExportCompressionMode;
  compressionStrength: number;
  compressionLiveTracker: CompressionLiveTracker | null;
}): Promise<{ reencoded: boolean; alreadyAv1Copied: boolean; outputBytes: number }> {
  const output = input.task.output;
  if (!output) {
    throw new Error("Video output path was not allocated.");
  }

  const localPath = await resolveLocalSourcePath(input.task.uri);
  const shouldTryCompression = input.compressionMode === "av1" && input.encoder;
  const knownAv1 = isAv1Codec(input.task.probe.codecName);
  const outputFileName = path.basename(output.absolutePath);

  if (!shouldTryCompression) {
    updateExportPhase("copying", `Exporting video ${outputFileName}...`);
    if (localPath) {
      await ensureLocalSourceExists(localPath, "video");
      await copyLocalFile(localPath, output.absolutePath);
    } else {
      await downloadRemoteResource(
        input.task.uri,
        input.task.installSourceKey,
        output.absolutePath
      );
    }
    const stats = await fs.stat(output.absolutePath);
    incrementExportStat("videoFiles");
    incrementExportProgress();
    return {
      reencoded: false,
      alreadyAv1Copied: false,
      outputBytes: stats.size,
    };
  }

  if (knownAv1 && localPath) {
    updateExportPhase("copying", `Copying AV1 video ${outputFileName}...`);
    await ensureLocalSourceExists(localPath, "video");
    await copyLocalFile(localPath, output.absolutePath);
    const stats = await fs.stat(output.absolutePath);
    incrementExportStat("videoFiles");
    incrementExportProgress();
    setCompressionStatus({
      alreadyAv1Copied: (exportStatus.compression?.alreadyAv1Copied ?? 0) + 1,
    });
    return {
      reencoded: false,
      alreadyAv1Copied: true,
      outputBytes: stats.size,
    };
  }

  let sourcePath = localPath;
  let shouldDeleteSourcePath = false;
  if (localPath) {
    await ensureLocalSourceExists(localPath, "video");
    const stagedSourcePath = path.join(
      input.workDir,
      `${crypto.randomUUID()}${sanitizeExtension(input.task.originalExtension, ".mp4")}`
    );
    updateExportPhase("copying", `Preparing source video ${outputFileName}...`);
    await copyLocalFile(localPath, stagedSourcePath);
    sourcePath = stagedSourcePath;
    shouldDeleteSourcePath = true;
  } else if (!sourcePath) {
    const tempSourcePath = path.join(
      input.workDir,
      `${crypto.randomUUID()}${sanitizeExtension(input.task.originalExtension, ".mp4")}`
    );
    updateExportPhase("copying", `Downloading source video ${outputFileName}...`);
    await downloadRemoteResource(input.task.uri, input.task.installSourceKey, tempSourcePath);
    sourcePath = tempSourcePath;
    shouldDeleteSourcePath = true;
  }

  try {
    if (!sourcePath) {
      throw new Error("Video source path could not be resolved.");
    }

    const probedSource = localPath
      ? input.task.probe
      : await probeLocalVideo(input.ffprobePath, sourcePath);

    if (isAv1Codec(probedSource.codecName)) {
      updateExportPhase("copying", `Copying AV1 video ${outputFileName}...`);
      if (input.compressionLiveTracker) {
        skipCompressionJob(input.compressionLiveTracker, input.task.canonicalKey);
      }
      if (shouldDeleteSourcePath) {
        await fs.rename(sourcePath, output.absolutePath);
      } else {
        await copyLocalFile(sourcePath, output.absolutePath);
      }
      const stats = await fs.stat(output.absolutePath);
      incrementExportStat("videoFiles");
      incrementExportProgress();
      setCompressionStatus({
        alreadyAv1Copied: (exportStatus.compression?.alreadyAv1Copied ?? 0) + 1,
        reencodedTotal: Math.max(0, (exportStatus.compression?.reencodedTotal ?? 0) - 1),
      });
      return {
        reencoded: false,
        alreadyAv1Copied: true,
        outputBytes: stats.size,
      };
    }

    if (!input.encoder) {
      throw new Error("AV1 compression was requested, but no AV1 encoder is available.");
    }

    if (input.compressionLiveTracker) {
      startCompressionJob(
        input.compressionLiveTracker,
        input.task.canonicalKey,
        probedSource.durationMs
      );
    }
    updateExportPhase("compressing", `Compressing video ${outputFileName} to AV1...`);
    setCompressionStatus({
      activeJobs: (exportStatus.compression?.activeJobs ?? 0) + 1,
    });
    let encodedSuccessfully = false;
    const compressionLiveTracker = input.compressionLiveTracker;
    try {
      await transcodeVideoToAv1({
        ffmpegPath: input.ffmpegPath,
        sourcePath,
        outputPath: output.absolutePath,
        encoder: input.encoder,
        strength: input.compressionStrength,
        onSpawn: registerEncodeChild,
        onProgress: compressionLiveTracker
          ? (progress) => {
              updateCompressionJobProgress(
                compressionLiveTracker,
                input.task.canonicalKey,
                progress
              );
            }
          : undefined,
      });
      encodedSuccessfully = true;
    } catch (error) {
      if (error instanceof Error && error.message.includes("signal")) {
        throw new ExportAbortError();
      }
      throw error;
    } finally {
      if (compressionLiveTracker) {
        if (encodedSuccessfully) {
          finishCompressionJob(compressionLiveTracker, input.task.canonicalKey);
        } else {
          compressionLiveTracker.activeByTaskKey.delete(input.task.canonicalKey);
          syncCompressionLiveProgress(compressionLiveTracker);
        }
      }
      for (const child of activeEncodeChildren) {
        if (child.exitCode !== null || child.killed) {
          unregisterEncodeChild(child);
        }
      }
      setCompressionStatus({
        activeJobs: Math.max(0, (exportStatus.compression?.activeJobs ?? 1) - 1),
      });
    }

    const stats = await fs.stat(output.absolutePath);
    incrementExportStat("videoFiles");
    incrementExportProgress();
    setCompressionStatus({
      reencodedCompleted: (exportStatus.compression?.reencodedCompleted ?? 0) + 1,
    });
    return {
      reencoded: true,
      alreadyAv1Copied: false,
      outputBytes: stats.size,
    };
  } finally {
    if (shouldDeleteSourcePath && sourcePath) {
      await fs.rm(sourcePath, { force: true }).catch(() => {});
    }
  }
}

async function materializeFunscriptTask(task: FunscriptTask): Promise<void> {
  if (!task.output) {
    throw new Error("Funscript output path was not allocated.");
  }

  updateExportPhase("copying", `Exporting funscript ${path.basename(task.output.absolutePath)}...`);
  const localPath = await resolveLocalSourcePath(task.uri);
  if (localPath) {
    await copyLocalFile(localPath, task.output.absolutePath);
  } else {
    await downloadRemoteResource(task.uri, task.installSourceKey, task.output.absolutePath);
  }
  incrementExportStat("funscriptFiles");
  incrementExportProgress();
}

function buildReadmeContent(input: {
  videoNames: string[];
  result: ExportPackageResult["compression"];
  encoder: Av1EncoderDetails | null;
  parallelJobs: number;
}): string {
  const lines = [
    "# Welcome to Fap Land Party Edition!",
    "",
    "For the best experience, please install **Fap Land Party Edition** from:",
    "https://github.com/FapLandPartyDev/FapLand-Party-Edition/releases",
    "",
    "## Installation Instructions",
    "",
    '1.  Download and install "Fap Land Party Edition" from the link above.',
    "2.  Launch the application.",
    '3.  Click **"Install rounds"**.',
    "4.  Select this folder as the source.",
    "",
    "## Video Compression",
    "",
    `- Compression enabled: ${input.result.enabled ? "yes" : "no"}`,
    `- Encoder: ${input.result.encoderName ?? "none"}`,
    `- Encoder kind: ${input.result.encoderKind ?? "none"}`,
    `- Compression strength: ${input.result.strength}% (${getCompressionStrengthLabel(input.result.strength)})`,
    `- Reencoded videos: ${input.result.reencodedVideos}`,
    `- Already AV1 and copied unchanged: ${input.result.alreadyAv1Copied}`,
    "- Output container for reencoded videos: mp4",
    "- Audio codec: aac",
    "- Audio bitrate: 128 kbps",
    `- Parallel jobs: ${input.parallelJobs}`,
    `- Final exported video size: ${formatByteSize(input.result.actualVideoBytes)}`,
    "",
    "## Exported Videos",
    "",
    "This package contains the following videos:",
    "",
    ...input.videoNames.map((name) => `- ${name}`),
    "",
  ];
  return lines.join("\n");
}

async function runExportPlaylistPackage(input: ExportPackageInput): Promise<ExportPackageResult> {
  const parentDirectory = assertApprovedDialogPath("playlistExportDirectory", input.directoryPath);
  updateExportPhase("analyzing", "Resolving playlist references...");
  const prepared = await preparePlaylistExport(input);
  const workEstimate = estimateExportWork(prepared);
  setExportProgress({
    completed: 0,
    total: workEstimate.total,
  });

  const safeFolderName = sanitizeFileSystemName(prepared.loaded.playlist.name, "playlist");
  const finalDir = path.join(parentDirectory, safeFolderName);
  const tempDir = path.join(
    parentDirectory,
    `${safeFolderName}.tmp-${toSafeIsoTimestamp(new Date())}-${crypto.randomUUID()}`
  );
  const workDir = path.join(tempDir, ".work");
  await ensurePathDoesNotExist(finalDir);
  await ensurePathDoesNotExist(tempDir);

  const usedMediaNames = new Set<string>();
  const usedSidecarNames = new Set<string>();

  try {
    await fs.mkdir(tempDir, { recursive: true });
    await fs.mkdir(workDir, { recursive: true });
    allocateMediaOutputs({
      tasks: prepared.videoTasks,
      usedNames: usedMediaNames,
      packageDir: tempDir,
      compressionMode: prepared.effectiveCompressionMode,
    });
    allocateMediaOutputs({
      tasks: prepared.funscriptTasks,
      usedNames: usedMediaNames,
      packageDir: tempDir,
      compressionMode: prepared.effectiveCompressionMode,
    });

    const binaries = await resolvePhashBinaries();
    let actualVideoBytes = 0;
    let reencodedVideos = 0;
    let alreadyAv1Copied = 0;
    const includeMedia = input.includeMedia ?? true;

    if (includeMedia) {
      const compressionLiveTracker =
        prepared.effectiveCompressionMode === "av1"
          ? createCompressionLiveTracker(prepared.videoTasks)
          : null;
      if (compressionLiveTracker) {
        syncCompressionLiveProgress(compressionLiveTracker);
      }

      await runLimited(
        prepared.videoTasks,
        prepared.effectiveCompressionMode === "av1" ? prepared.parallelJobs : 1,
        async (task) => {
          const result = await materializeVideoTask({
            task,
            workDir,
            ffmpegPath: binaries.ffmpegPath,
            ffprobePath: binaries.ffprobePath,
            encoder: prepared.encoder,
            compressionMode: prepared.effectiveCompressionMode,
            compressionStrength: prepared.compressionStrength,
            compressionLiveTracker,
          });
          actualVideoBytes += result.outputBytes;
          if (result.reencoded) reencodedVideos += 1;
          if (result.alreadyAv1Copied) alreadyAv1Copied += 1;
        }
      );
    }

    for (const task of prepared.funscriptTasks) {
      await materializeFunscriptTask(task);
    }

    const videoOutputByKey = new Map<string, ExportedMediaFile>(
      prepared.videoTasks
        .filter((task): task is VideoTask & { output: ExportedMediaFile } => Boolean(task.output))
        .map((task) => [`video:${task.canonicalKey}`, task.output])
    );
    const funscriptOutputByKey = new Map<string, ExportedMediaFile>(
      prepared.funscriptTasks
        .filter((task): task is FunscriptTask & { output: ExportedMediaFile } =>
          Boolean(task.output)
        )
        .map((task) => [`funscript:${task.canonicalKey}`, task.output])
    );

    const materializedEntries: RoundResourceEntry[] = prepared.resourceReferences.map((entry) => {
      const funscriptKey = entry.resource.funscriptUri
        ? `funscript:${canonicalizeResourceKey(entry.resource.funscriptUri)}`
        : null;
      let video = null;

      if (includeMedia) {
        const videoKey = `video:${canonicalizeResourceKey(entry.resource.videoUri)}`;
        video = videoOutputByKey.get(videoKey);
        if (!video) {
          throw new Error(`Exported video output is missing for ${entry.resource.videoUri}`);
        }
      }

      return {
        round: entry.round,
        resource: entry.resource,
        materialized: {
          canonicalVideoKey: canonicalizeResourceKey(entry.resource.videoUri),
          video: video ?? null,
          funscript: funscriptKey ? (funscriptOutputByKey.get(funscriptKey) ?? null) : null,
        },
      };
    });

    const playlistFileName = toUniqueCaseInsensitiveFileName(
      usedSidecarNames,
      sanitizeFileSystemName(prepared.loaded.playlist.name, "playlist"),
      ".fplay"
    );
    const playlistFilePath = path.join(tempDir, playlistFileName);
    updateExportPhase("writing", `Writing playlist ${playlistFileName}...`);
    await writeJsonFile(playlistFilePath, createPlaylistEnvelope(prepared.loaded.playlist));
    incrementExportStat("playlistFiles");
    incrementExportProgress();

    let sidecarFiles = 0;
    const heroGroups = new Map<string, { hero: ExportableHero; entries: RoundResourceEntry[] }>();
    for (const entry of materializedEntries) {
      if (entry.round.heroId && entry.round.hero) {
        const key = entry.round.heroId;
        const existing = heroGroups.get(key);
        if (existing) {
          existing.entries.push(entry);
        } else {
          heroGroups.set(key, { hero: entry.round.hero, entries: [entry] });
        }
        continue;
      }

      const sidecarBaseName = sanitizeFileSystemName(entry.round.name, `round__${entry.round.id}`);
      const fileName = toUniqueCaseInsensitiveFileName(usedSidecarNames, sidecarBaseName, ".round");
      updateExportPhase("writing", `Writing sidecar ${fileName}...`);
      await writeJsonFile(path.join(tempDir, fileName), toRoundSidecarPayload(entry, includeMedia));
      incrementExportStat("sidecarFiles");
      incrementExportProgress();
      sidecarFiles += 1;
    }

    const sortedHeroGroups = Array.from(heroGroups.values()).sort((a, b) => {
      const byName = a.hero.name.localeCompare(b.hero.name, undefined, {
        sensitivity: "base",
        numeric: true,
      });
      if (byName !== 0) return byName;
      return a.hero.id.localeCompare(b.hero.id);
    });
    for (const group of sortedHeroGroups) {
      const sidecarBaseName = sanitizeFileSystemName(group.hero.name, `hero__${group.hero.id}`);
      const fileName = toUniqueCaseInsensitiveFileName(usedSidecarNames, sidecarBaseName, ".hero");
      updateExportPhase("writing", `Writing sidecar ${fileName}...`);
      await writeJsonFile(
        path.join(tempDir, fileName),
        createHeroSidecarPayload(group.hero, group.entries, includeMedia)
      );
      incrementExportStat("sidecarFiles");
      incrementExportProgress();
      sidecarFiles += 1;
    }

    const videoNames = prepared.videoTasks
      .map((task) => path.basename(task.output?.absolutePath ?? ""))
      .filter((name) => name.length > 0)
      .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base", numeric: true }));

    if (videoNames.length > 0) {
      updateExportPhase("writing", "Writing README.md...");
      const readmePath = path.join(tempDir, "README.md");
      const compressionResult = {
        enabled: prepared.effectiveCompressionMode === "av1" && Boolean(prepared.encoder),
        encoderName: prepared.encoder?.name ?? null,
        encoderKind: prepared.encoder?.kind ?? null,
        strength: prepared.compressionStrength,
        reencodedVideos,
        alreadyAv1Copied,
        actualVideoBytes,
      } satisfies ExportPackageResult["compression"];
      await fs.writeFile(
        readmePath,
        buildReadmeContent({
          videoNames,
          result: compressionResult,
          encoder: prepared.encoder,
          parallelJobs: prepared.parallelJobs,
        }),
        "utf8"
      );
    }

    updateExportPhase("writing", "Finalizing export package...");
    await fs.rm(workDir, { recursive: true, force: true }).catch(() => {});
    await fs.rename(tempDir, finalDir);
    return {
      exportDir: finalDir,
      playlistFilePath: path.join(finalDir, playlistFileName),
      sidecarFiles,
      videoFiles: prepared.videoTasks.length,
      funscriptFiles: prepared.funscriptTasks.length,
      referencedRounds: prepared.loaded.rounds.length,
      compression: {
        enabled: prepared.effectiveCompressionMode === "av1" && Boolean(prepared.encoder),
        encoderName: prepared.encoder?.name ?? null,
        encoderKind: prepared.encoder?.kind ?? null,
        strength: prepared.compressionStrength,
        reencodedVideos,
        alreadyAv1Copied,
        actualVideoBytes,
      },
    };
  } catch (error) {
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
    throw error;
  }
}

export async function analyzePlaylistExportPackage(
  input: AnalyzeExportPackageInput
): Promise<PlaylistExportPackageAnalysis> {
  const prepared = await preparePlaylistExport(input);
  return prepared.analysis;
}

export function getPlaylistExportPackageStatus(): PlaylistExportPackageStatus {
  return cloneStatus(exportStatus);
}

function terminateActiveEncodeChildren(): void {
  for (const child of activeEncodeChildren) {
    try {
      child.kill("SIGTERM");
    } catch {
      // Best effort only.
    }
    setTimeout(() => {
      if (child.exitCode === null && !child.killed) {
        try {
          child.kill("SIGKILL");
        } catch {
          // Best effort only.
        }
      }
    }, 1500);
  }
}

export function requestPlaylistExportPackageAbort(): PlaylistExportPackageStatus {
  if (!activeExportPromise || exportStatus.state !== "running") {
    return cloneStatus(exportStatus);
  }

  abortRequested = true;
  for (const controller of activeTransferAbortControllers) {
    controller.abort();
  }
  terminateActiveEncodeChildren();
  exportStatus = {
    ...exportStatus,
    lastMessage: "Abort requested. Waiting for the current export step to finish...",
  };
  return cloneStatus(exportStatus);
}

export async function exportPlaylistPackage(
  input: ExportPackageInput
): Promise<ExportPackageResult> {
  if (activeExportPromise) {
    throw new Error("A playlist export is already running.");
  }

  abortRequested = false;
  activeTransferAbortControllers.clear();
  activeEncodeChildren.clear();
  const normalizedStrength = normalizeCompressionStrength(input.compressionStrength);
  exportStatus = {
    state: "running",
    phase: "analyzing",
    startedAt: new Date().toISOString(),
    finishedAt: null,
    lastMessage: "Preparing export package...",
    progress: {
      completed: 0,
      total: 0,
    },
    stats: {
      playlistFiles: 0,
      sidecarFiles: 0,
      videoFiles: 0,
      funscriptFiles: 0,
    },
    compression:
      input.compressionMode === "av1"
        ? {
            enabled: true,
            encoderName: null,
            encoderKind: null,
            strength: normalizedStrength,
            reencodedCompleted: 0,
            reencodedTotal: 0,
            alreadyAv1Copied: 0,
            activeJobs: 0,
            expectedVideoBytes: 0,
            estimatedCompressionSeconds: 0,
            approximate: true,
            liveProgress: createCompressionLiveProgress(),
          }
        : null,
  };

  activeExportPromise = (async () => {
    const prepared = await preparePlaylistExport({
      playlistId: input.playlistId,
      compressionMode: input.compressionMode,
      compressionStrength: normalizedStrength,
    });
    if (prepared.effectiveCompressionMode === "av1") {
      exportStatus = {
        ...exportStatus,
        compression: {
          enabled: true,
          encoderName: prepared.encoder?.name ?? null,
          encoderKind: prepared.encoder?.kind ?? null,
          strength: prepared.compressionStrength,
          reencodedCompleted: 0,
          reencodedTotal: prepared.analysis.videoTotals.estimatedReencodeVideos,
          alreadyAv1Copied: 0,
          activeJobs: 0,
          expectedVideoBytes: prepared.analysis.estimate.expectedVideoBytes,
          estimatedCompressionSeconds: prepared.analysis.estimate.estimatedCompressionSeconds,
          approximate: prepared.analysis.estimate.approximate,
          liveProgress: createCompressionLiveProgress(
            prepared.videoTasks
              .filter((task) => !isAv1Codec(task.probe.codecName))
              .reduce((sum, task) => sum + Math.max(0, task.probe.durationMs ?? 0), 0)
          ),
        },
      };
    } else {
      exportStatus = {
        ...exportStatus,
        compression: null,
      };
    }
    return runExportPlaylistPackage({
      ...input,
      compressionMode: prepared.effectiveCompressionMode,
      compressionStrength: prepared.compressionStrength,
    });
  })();

  try {
    const result = await activeExportPromise;
    exportStatus = {
      ...exportStatus,
      state: "done",
      phase: "done",
      finishedAt: new Date().toISOString(),
      lastMessage: result.compression.enabled
        ? `Export finished. ${result.compression.reencodedVideos} videos reencoded, ${result.sidecarFiles} sidecars written.`
        : `Export finished. ${result.sidecarFiles} sidecars, ${result.videoFiles} videos, ${result.funscriptFiles} funscripts.`,
    };
    return result;
  } catch (caughtError) {
    let error: unknown = caughtError;
    if (abortRequested && isAbortLikeError(error)) {
      error = new ExportAbortError();
    }

    if (error instanceof ExportAbortError) {
      exportStatus = {
        ...exportStatus,
        state: "aborted",
        phase: "aborted",
        finishedAt: new Date().toISOString(),
        lastMessage: "Export aborted by user.",
      };
      throw new Error("Export aborted by user.");
    }

    const message = error instanceof Error ? error.message : "Playlist export failed.";
    exportStatus = {
      ...exportStatus,
      state: "error",
      phase: "error",
      finishedAt: new Date().toISOString(),
      lastMessage: message,
    };
    throw error;
  } finally {
    activeTransferAbortControllers.clear();
    for (const child of activeEncodeChildren) {
      unregisterEncodeChild(child);
    }
    abortRequested = false;
    activeExportPromise = null;
  }
}

export { buildAv1EncodeArgs, formatByteSize, formatDurationEstimate };
