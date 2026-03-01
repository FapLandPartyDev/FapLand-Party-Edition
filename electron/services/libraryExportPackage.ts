import crypto from "node:crypto";
import type { ChildProcess } from "node:child_process";
import { createReadStream, createWriteStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { app } from "electron";
import { inArray } from "drizzle-orm";
import { ZHeroSidecar, ZRoundSidecar } from "../../src/zod/installSidecar";
import { parseOptionalRoundCutRangesJson } from "../../src/utils/roundCuts";
import { getDb } from "./db";
import { round as roundTable } from "./db/schema";
import { createFpackFromDirectory } from "./fpack";
import { fetchStashMediaWithAuth } from "./integrations/stashClient";
import { stashProvider } from "./integrations/providers/stashProvider";
import { listExternalSources, normalizeBaseUrl } from "./integrations/store";
import { fromLocalMediaUri, toPortableRelativePath } from "./localMedia";
import {
  detectAv1Encoder,
  estimateCompressionForProbes,
  getParallelJobsForEncoder,
  isAv1Codec,
  normalizeCompressionStrength,
  probeLocalVideo,
  transcodeVideoToAv1,
  type Av1TranscodeProgress,
  type Av1EncoderDetails,
  type PlaylistExportCompressionEncoderKind,
  type PlaylistExportEstimate,
  type PlaylistExportCompressionMode,
  type PlaylistExportCompressionPhase,
  type PlaylistExportVideoProbe,
} from "./playlistExportCompression";
import { resolvePhashBinaries } from "./phash/binaries";
import { getCachedWebsiteVideoLocalPath } from "./webVideo";

export type LibraryExportPackageInput = {
  roundIds?: string[];
  heroIds?: string[];
  includeMedia?: boolean;
  directoryPath?: string;
  asFpack?: boolean;
  compressionMode?: PlaylistExportCompressionMode;
  compressionStrength?: number;
};

type AnalyzeLibraryExportPackageInput = {
  roundIds?: string[];
  heroIds?: string[];
  includeMedia?: boolean;
  compressionMode?: PlaylistExportCompressionMode;
  compressionStrength?: number;
};

export type LibraryExportPackageState = "idle" | "running" | "done" | "aborted" | "error";

export type LibraryExportPackageCompressionStatus = {
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

export type LibraryExportPackageStatus = {
  state: LibraryExportPackageState;
  phase: PlaylistExportCompressionPhase;
  startedAt: string | null;
  finishedAt: string | null;
  lastMessage: string | null;
  progress: {
    completed: number;
    total: number;
  };
  stats: {
    heroFiles: number;
    roundFiles: number;
    videoFiles: number;
    funscriptFiles: number;
  };
  compression: LibraryExportPackageCompressionStatus | null;
};

export type LibraryExportPackageResult = {
  exportDir: string;
  fpackPath?: string;
  heroFiles: number;
  roundFiles: number;
  videoFiles: number;
  funscriptFiles: number;
  exportedRounds: number;
  includeMedia: boolean;
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

export type LibraryExportPackageAnalysis = {
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
  cutRangesJson?: string | null;
  type: "Normal" | "Interjection" | "Cum";
  excludeFromRandom: boolean;
  installSourceKey: string | null;
  heroId: string | null;
  hero: ExportableHero | null;
  resources: ExportableResource[];
};

type ExportedMediaFile = {
  absolutePath: string;
  relativePath: string;
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

type ResourceReference = {
  round: ExportableRound;
  resource: ExportableResource;
  preferredBaseName: string;
};

type RoundResourceEntry = {
  round: ExportableRound;
  resource: ExportableResource;
  materialized: {
    canonicalVideoKey: string;
    video: ExportedMediaFile | null;
    funscript: ExportedMediaFile | null;
  };
};

type PreparedLibraryExport = {
  rounds: ExportableRound[];
  resourceReferences: ResourceReference[];
  videoTasks: VideoTask[];
  funscriptTasks: FunscriptTask[];
  encoder: Av1EncoderDetails | null;
  effectiveCompressionMode: PlaylistExportCompressionMode;
  compressionStrength: number;
  parallelJobs: number;
  includeMedia: boolean;
  analysis: LibraryExportPackageAnalysis;
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
    super("Library export aborted.");
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

let exportStatus: LibraryExportPackageStatus = {
  state: "idle",
  phase: "idle",
  startedAt: null,
  finishedAt: null,
  lastMessage: null,
  progress: { completed: 0, total: 0 },
  stats: { heroFiles: 0, roundFiles: 0, videoFiles: 0, funscriptFiles: 0 },
  compression: null,
};

let activeExportPromise: Promise<LibraryExportPackageResult> | null = null;
let abortRequested = false;
const activeTransferAbortControllers = new Set<AbortController>();
const activeEncodeChildren = new Set<ChildProcess>();

function cloneStatus(status: LibraryExportPackageStatus): LibraryExportPackageStatus {
  return JSON.parse(JSON.stringify(status)) as LibraryExportPackageStatus;
}

function throwIfAbortRequested(): void {
  if (abortRequested) {
    throw new ExportAbortError();
  }
}

function createCompressionLiveProgress(
  totalDurationMs = 0
): LibraryExportPackageCompressionStatus["liveProgress"] {
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

function toSafeIsoTimestamp(date: Date): string {
  return date.toISOString().replace(/:/g, "-");
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

async function writeJsonFile(filePath: string, payload: unknown): Promise<void> {
  throwIfAbortRequested();
  await fs.writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
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

function updateStatus(updates: Partial<LibraryExportPackageStatus>): void {
  exportStatus = { ...exportStatus, ...updates };
}

function updatePhase(phase: PlaylistExportCompressionPhase, message?: string): void {
  if (exportStatus.state !== "running") return;
  exportStatus = {
    ...exportStatus,
    phase,
    lastMessage: message ?? exportStatus.lastMessage,
  };
}

function setProgress(input: Partial<LibraryExportPackageStatus["progress"]>): void {
  if (exportStatus.state !== "running") return;
  exportStatus = {
    ...exportStatus,
    progress: { ...exportStatus.progress, ...input },
  };
}

function incrementProgress(amount = 1): void {
  setProgress({ completed: exportStatus.progress.completed + amount });
}

function incrementStat(key: keyof LibraryExportPackageStatus["stats"]): void {
  if (exportStatus.state !== "running") return;
  exportStatus = {
    ...exportStatus,
    stats: { ...exportStatus.stats, [key]: exportStatus.stats[key] + 1 },
  };
}

function setCompressionStatus(input: Partial<LibraryExportPackageCompressionStatus>): void {
  if (exportStatus.state !== "running" || !exportStatus.compression) return;
  exportStatus = {
    ...exportStatus,
    compression: {
      ...exportStatus.compression,
      ...input,
    },
  };
}

function registerEncodeChild(child: ChildProcess): void {
  activeEncodeChildren.add(child);
}

function unregisterEncodeChild(child: ChildProcess): void {
  activeEncodeChildren.delete(child);
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
    cutRanges: parseOptionalRoundCutRangesJson(
      entry.round.cutRangesJson,
      entry.round.startTime,
      entry.round.endTime
    ),
    type: entry.round.type,
    excludeFromRandom: entry.round.excludeFromRandom ? true : undefined,
    resources: [
      {
        videoUri: includeMedia
          ? (entry.materialized.video?.relativePath ?? entry.resource.videoUri)
          : entry.resource.videoUri,
        funscriptUri:
          entry.materialized.funscript?.relativePath ?? entry.resource.funscriptUri ?? undefined,
      },
    ],
  });
}

function toHeroSidecarPayload(
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
        cutRanges: parseOptionalRoundCutRangesJson(
          entry.round.cutRangesJson,
          entry.round.startTime,
          entry.round.endTime
        ),
        type: entry.round.type,
        excludeFromRandom: entry.round.excludeFromRandom ? true : undefined,
        resources: [
          {
            videoUri: includeMedia
              ? (entry.materialized.video?.relativePath ?? entry.resource.videoUri)
              : entry.resource.videoUri,
            funscriptUri:
              entry.materialized.funscript?.relativePath ??
              entry.resource.funscriptUri ??
              undefined,
          },
        ],
      })),
  });
}

function buildResourceInventory(rounds: ExportableRound[]): {
  resourceReferences: ResourceReference[];
  videoTasks: VideoTask[];
  funscriptTasks: FunscriptTask[];
} {
  const resourceReferences: ResourceReference[] = [];
  const videoTaskByKey = new Map<string, VideoTask>();
  const funscriptTaskByKey = new Map<string, FunscriptTask>();

  for (const round of rounds) {
    if (round.resources.length === 0) continue;

    for (const resource of round.resources) {
      const preferredBaseName = round.hero ? round.hero.name : round.name;
      resourceReferences.push({ round, resource, preferredBaseName });

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

async function loadRoundsForExport(
  input: Pick<AnalyzeLibraryExportPackageInput, "roundIds" | "heroIds">
): Promise<ExportableRound[]> {
  throwIfAbortRequested();

  if (input.roundIds?.length || input.heroIds?.length) {
    const roundIds = input.roundIds ?? [];
    const heroIds = input.heroIds ?? [];
    const queries: Promise<ExportableRound[]>[] = [];

    if (roundIds.length > 0) {
      queries.push(
        getDb().query.round.findMany({
          where: inArray(roundTable.id, roundIds),
          with: { hero: true, resources: true },
        }) as Promise<ExportableRound[]>
      );
    }

    if (heroIds.length > 0) {
      queries.push(
        getDb().query.round.findMany({
          where: inArray(roundTable.heroId, heroIds),
          with: { hero: true, resources: true },
        }) as Promise<ExportableRound[]>
      );
    }

    const results = await Promise.all(queries);
    const seenIds = new Set<string>();
    const rounds: ExportableRound[] = [];
    for (const batch of results) {
      for (const round of batch) {
        if (!seenIds.has(round.id)) {
          seenIds.add(round.id);
          rounds.push(round);
        }
      }
    }
    return rounds;
  }

  return (await getDb().query.round.findMany({
    with: { hero: true, resources: true },
  })) as ExportableRound[];
}

async function prepareLibraryExport(
  input: AnalyzeLibraryExportPackageInput = {}
): Promise<PreparedLibraryExport> {
  const includeMedia = input.includeMedia ?? true;
  const rounds = await loadRoundsForExport(input);

  if (rounds.length === 0) {
    throw new Error("No rounds found to export.");
  }

  const binaries = await resolvePhashBinaries();
  const encoder = await detectAv1Encoder(binaries.ffmpegPath);
  const compressionStrength = normalizeCompressionStrength(input.compressionStrength);
  const defaultMode: PlaylistExportCompressionMode = encoder ? "av1" : "copy";
  const requestedMode = input.compressionMode ?? defaultMode;
  const effectiveCompressionMode =
    includeMedia && requestedMode === "av1" && encoder ? "av1" : "copy";
  const parallelJobs = getParallelJobsForEncoder(encoder?.kind ?? null);
  const { resourceReferences, videoTasks, funscriptTasks } = buildResourceInventory(rounds);

  if (includeMedia) {
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
  }

  const localVideos = includeMedia
    ? videoTasks.filter((task) => task.probe.codecName !== null).length
    : 0;
  const remoteVideos = includeMedia ? videoTasks.length - localVideos : 0;
  const alreadyAv1Videos = includeMedia
    ? videoTasks.filter((task) => isAv1Codec(task.probe.codecName)).length
    : 0;
  const estimatedReencodeVideos =
    includeMedia && effectiveCompressionMode === "av1"
      ? videoTasks.filter((task) => !isAv1Codec(task.probe.codecName)).length
      : 0;

  const estimate =
    includeMedia && effectiveCompressionMode === "av1" && encoder
      ? estimateCompressionForProbes({
          probes: videoTasks.map((task) => task.probe),
          strength: compressionStrength,
          encoderKind: encoder.kind,
          parallelJobs,
        })
      : ({
          sourceVideoBytes: includeMedia
            ? videoTasks.reduce((sum, task) => sum + (task.probe.fileSizeBytes ?? 0), 0)
            : 0,
          expectedVideoBytes: includeMedia
            ? videoTasks.reduce((sum, task) => sum + (task.probe.fileSizeBytes ?? 0), 0)
            : 0,
          savingsBytes: 0,
          estimatedCompressionSeconds: 0,
          approximate: includeMedia
            ? videoTasks.some((task) => task.probe.fileSizeBytes === null)
            : false,
        } satisfies PlaylistExportEstimate);

  let warning: string | null = null;
  if (includeMedia) {
    if (!encoder) {
      warning =
        "No AV1 encoder is available in the configured ffmpeg build. Compression is disabled.";
    } else if (encoder.kind === "software") {
      warning =
        "No AV1 hardware encoder was detected. Reencoding on this system may take multiple hours.";
    }
  }

  return {
    rounds,
    resourceReferences,
    videoTasks,
    funscriptTasks,
    encoder,
    effectiveCompressionMode,
    compressionStrength,
    parallelJobs,
    includeMedia,
    analysis: {
      videoTotals: {
        uniqueVideos: includeMedia ? videoTasks.length : 0,
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

function estimateExportWork(input: PreparedLibraryExport) {
  let standaloneRoundFiles = 0;
  const heroIds = new Set<string>();

  for (const entry of input.resourceReferences) {
    if (entry.round.heroId && entry.round.hero) {
      heroIds.add(entry.round.heroId);
    } else {
      standaloneRoundFiles += 1;
    }
  }

  return {
    videoFiles: input.includeMedia ? input.videoTasks.length : 0,
    funscriptFiles: input.funscriptTasks.length,
    roundFiles: standaloneRoundFiles,
    heroFiles: heroIds.size,
    total:
      (input.includeMedia ? input.videoTasks.length : 0) +
      input.funscriptTasks.length +
      standaloneRoundFiles +
      heroIds.size,
  };
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
  throwIfAbortRequested();
  const output = input.task.output;
  if (!output) {
    throw new Error("Video output path was not allocated.");
  }

  const localPath = await resolveLocalSourcePath(input.task.uri);
  const shouldTryCompression = input.compressionMode === "av1" && input.encoder;
  const knownAv1 = isAv1Codec(input.task.probe.codecName);
  const outputFileName = path.basename(output.absolutePath);

  if (!shouldTryCompression) {
    updatePhase("copying", `Exporting video ${outputFileName}...`);
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
    incrementStat("videoFiles");
    incrementProgress();
    return {
      reencoded: false,
      alreadyAv1Copied: false,
      outputBytes: stats.size,
    };
  }

  if (knownAv1 && localPath) {
    updatePhase("copying", `Copying AV1 video ${outputFileName}...`);
    await ensureLocalSourceExists(localPath, "video");
    await copyLocalFile(localPath, output.absolutePath);
    const stats = await fs.stat(output.absolutePath);
    incrementStat("videoFiles");
    incrementProgress();
    setCompressionStatus({
      alreadyAv1Copied: (exportStatus.compression?.alreadyAv1Copied ?? 0) + 1,
    });
    if (input.compressionLiveTracker) {
      skipCompressionJob(input.compressionLiveTracker, input.task.canonicalKey);
    }
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
    updatePhase("copying", `Preparing source video ${outputFileName}...`);
    await copyLocalFile(localPath, stagedSourcePath);
    sourcePath = stagedSourcePath;
    shouldDeleteSourcePath = true;
  } else if (!sourcePath) {
    const tempSourcePath = path.join(
      input.workDir,
      `${crypto.randomUUID()}${sanitizeExtension(input.task.originalExtension, ".mp4")}`
    );
    updatePhase("copying", `Downloading source video ${outputFileName}...`);
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
      updatePhase("copying", `Copying AV1 video ${outputFileName}...`);
      if (shouldDeleteSourcePath) {
        await fs.rename(sourcePath, output.absolutePath);
      } else {
        await copyLocalFile(sourcePath, output.absolutePath);
      }
      const stats = await fs.stat(output.absolutePath);
      incrementStat("videoFiles");
      incrementProgress();
      setCompressionStatus({
        alreadyAv1Copied: (exportStatus.compression?.alreadyAv1Copied ?? 0) + 1,
        reencodedTotal: Math.max(0, (exportStatus.compression?.reencodedTotal ?? 0) - 1),
      });
      if (input.compressionLiveTracker) {
        skipCompressionJob(input.compressionLiveTracker, input.task.canonicalKey);
      }
      return {
        reencoded: false,
        alreadyAv1Copied: true,
        outputBytes: stats.size,
      };
    }

    if (!input.encoder) {
      throw new Error("AV1 compression was requested, but no AV1 encoder is available.");
    }

    updatePhase("compressing", `Compressing video ${outputFileName} to AV1...`);
    if (input.compressionLiveTracker) {
      startCompressionJob(
        input.compressionLiveTracker,
        input.task.canonicalKey,
        probedSource.durationMs
      );
    }
    setCompressionStatus({
      activeJobs: (exportStatus.compression?.activeJobs ?? 0) + 1,
    });
    let encodedSuccessfully = false;
    try {
      await transcodeVideoToAv1({
        ffmpegPath: input.ffmpegPath,
        sourcePath,
        outputPath: output.absolutePath,
        encoder: input.encoder,
        strength: input.compressionStrength,
        onSpawn: registerEncodeChild,
        onProgress: input.compressionLiveTracker
          ? (progress) =>
              updateCompressionJobProgress(
                input.compressionLiveTracker!,
                input.task.canonicalKey,
                progress
              )
          : undefined,
      });
      encodedSuccessfully = true;
    } finally {
      for (const child of activeEncodeChildren) {
        if (child.exitCode !== null || child.killed) {
          unregisterEncodeChild(child);
        }
      }
      setCompressionStatus({
        activeJobs: Math.max(0, (exportStatus.compression?.activeJobs ?? 1) - 1),
      });
      if (encodedSuccessfully) {
        setCompressionStatus({
          reencodedCompleted: (exportStatus.compression?.reencodedCompleted ?? 0) + 1,
        });
        if (input.compressionLiveTracker) {
          finishCompressionJob(input.compressionLiveTracker, input.task.canonicalKey);
        }
      } else if (input.compressionLiveTracker) {
        syncCompressionLiveProgress(input.compressionLiveTracker);
      }
    }

    const stats = await fs.stat(output.absolutePath);
    incrementStat("videoFiles");
    incrementProgress();
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
  throwIfAbortRequested();
  if (!task.output) {
    throw new Error("Funscript output path was not allocated.");
  }

  updateStatus({
    lastMessage: `Exporting funscript ${path.basename(task.output.absolutePath)}...`,
  });

  const localPath = await resolveLocalSourcePath(task.uri);
  if (localPath) {
    await copyLocalFile(localPath, task.output.absolutePath);
  } else {
    await downloadRemoteResource(task.uri, task.installSourceKey, task.output.absolutePath);
  }

  incrementStat("funscriptFiles");
  incrementProgress();
}

export function getLibraryExportPackageStatus(): LibraryExportPackageStatus {
  return cloneStatus(exportStatus);
}

export async function analyzeLibraryExportPackage(
  input: AnalyzeLibraryExportPackageInput = {}
): Promise<LibraryExportPackageAnalysis> {
  const prepared = await prepareLibraryExport(input);
  return prepared.analysis;
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

export function requestLibraryExportPackageAbort(): LibraryExportPackageStatus {
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

async function packResultAsFpack(
  result: LibraryExportPackageResult,
  asFpack: boolean
): Promise<LibraryExportPackageResult> {
  if (!asFpack) return result;
  const fpackFileName = `${path.basename(result.exportDir)}.fpack`;
  const fpackPath = path.join(path.dirname(result.exportDir), fpackFileName);
  updateStatus({ lastMessage: "Packing .fpack file..." });
  await createFpackFromDirectory(result.exportDir, fpackPath);
  await fs.rm(result.exportDir, { recursive: true, force: true });
  return { ...result, exportDir: path.dirname(result.exportDir), fpackPath };
}

export async function exportLibraryPackage(
  input: LibraryExportPackageInput = {}
): Promise<LibraryExportPackageResult> {
  if (activeExportPromise) {
    throw new Error("A library export is already running.");
  }

  abortRequested = false;
  activeTransferAbortControllers.clear();
  activeEncodeChildren.clear();
  const includeMedia = input.includeMedia ?? true;
  const now = new Date();
  const compressionStrength = normalizeCompressionStrength(input.compressionStrength);

  const exportBaseDir =
    input.directoryPath ?? (app.isPackaged ? app.getPath("userData") : app.getAppPath());
  const exportDir = path.join(exportBaseDir, "export", toSafeIsoTimestamp(now));
  const workDir = path.join(exportDir, ".work");

  exportStatus = {
    state: "running",
    phase: "analyzing",
    startedAt: now.toISOString(),
    finishedAt: null,
    lastMessage: "Preparing export...",
    progress: { completed: 0, total: 0 },
    stats: { heroFiles: 0, roundFiles: 0, videoFiles: 0, funscriptFiles: 0 },
    compression:
      includeMedia && input.compressionMode === "av1"
        ? {
            enabled: true,
            encoderName: null,
            encoderKind: null,
            strength: compressionStrength,
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
    updateStatus({ lastMessage: "Loading rounds from database..." });
    const prepared = await prepareLibraryExport({
      roundIds: input.roundIds,
      heroIds: input.heroIds,
      includeMedia,
      compressionMode: input.compressionMode,
      compressionStrength,
    });
    const binaries = await resolvePhashBinaries();
    const compressionLiveTracker =
      prepared.effectiveCompressionMode === "av1"
        ? createCompressionLiveTracker(prepared.videoTasks)
        : null;
    const workEstimate = estimateExportWork(prepared);

    setProgress({ completed: 0, total: workEstimate.total });
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

    updateStatus({ lastMessage: "Preparing export directory..." });
    await fs.mkdir(exportDir, { recursive: true });
    await fs.mkdir(workDir, { recursive: true });

    const usedMediaNames = new Set<string>();
    const usedSidecarNames = new Set<string>();

    if (includeMedia) {
      allocateMediaOutputs({
        tasks: prepared.videoTasks,
        usedNames: usedMediaNames,
        packageDir: exportDir,
        compressionMode: prepared.effectiveCompressionMode,
      });
    }

    allocateMediaOutputs({
      tasks: prepared.funscriptTasks,
      usedNames: usedMediaNames,
      packageDir: exportDir,
      compressionMode: prepared.effectiveCompressionMode,
    });

    let actualVideoBytes = 0;
    let reencodedVideos = 0;
    let alreadyAv1Copied = 0;

    if (includeMedia) {
      for (const task of prepared.videoTasks) {
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
    }

    for (const task of prepared.funscriptTasks) {
      await materializeFunscriptTask(task);
    }

    const videoOutputByKey = new Map<string, ExportedMediaFile>(
      includeMedia
        ? prepared.videoTasks
            .filter((task): task is VideoTask & { output: ExportedMediaFile } =>
              Boolean(task.output)
            )
            .map((task) => [`video:${task.canonicalKey}`, task.output])
        : []
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
        video = videoOutputByKey.get(videoKey) ?? null;
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

    let roundFiles = 0;
    let heroFiles = 0;
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
      updatePhase("writing", `Writing sidecar ${fileName}...`);
      await writeJsonFile(
        path.join(exportDir, fileName),
        toRoundSidecarPayload(entry, includeMedia)
      );
      incrementStat("roundFiles");
      incrementProgress();
      roundFiles += 1;
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
      updatePhase("writing", `Writing sidecar ${fileName}...`);
      await writeJsonFile(
        path.join(exportDir, fileName),
        toHeroSidecarPayload(group.hero, group.entries, includeMedia)
      );
      incrementStat("heroFiles");
      incrementProgress();
      heroFiles += 1;
    }

    await fs.rm(workDir, { recursive: true, force: true }).catch(() => {});

    const rawResult: LibraryExportPackageResult = {
      exportDir,
      heroFiles,
      roundFiles,
      videoFiles: includeMedia ? prepared.videoTasks.length : 0,
      funscriptFiles: prepared.funscriptTasks.length,
      exportedRounds: prepared.rounds.length,
      includeMedia,
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

    const result = await packResultAsFpack(rawResult, input.asFpack ?? false);
    exportStatus = {
      ...exportStatus,
      state: "done",
      phase: "done",
      finishedAt: new Date().toISOString(),
      lastMessage: result.compression.enabled
        ? `Export finished. ${result.compression.reencodedVideos} videos reencoded, ${result.heroFiles} heroes, ${result.roundFiles} standalone rounds.`
        : `Export finished. ${result.heroFiles} heroes, ${result.roundFiles} standalone rounds, ${result.funscriptFiles} funscripts.`,
      progress: { completed: exportStatus.progress.total, total: exportStatus.progress.total },
      stats: {
        ...exportStatus.stats,
        heroFiles: result.heroFiles,
        roundFiles: result.roundFiles,
        videoFiles: result.videoFiles,
        funscriptFiles: result.funscriptFiles,
      },
    };
    return result;
  })();

  try {
    return await activeExportPromise;
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

    const message = error instanceof Error ? error.message : "Export failed.";
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
