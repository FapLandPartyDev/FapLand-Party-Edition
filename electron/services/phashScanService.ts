import { isNull, and, eq } from "drizzle-orm";
import { fromLocalMediaUri } from "./localMedia";
import { getDb } from "./db";
import { round, resource } from "./db/schema";
import { getStore } from "./store";
import {
  BACKGROUND_PHASH_SCANNING_ENABLED_KEY,
  normalizeBackgroundPhashScanningEnabled,
} from "../../src/constants/phashSettings";
import { generateVideoPhash } from "./phash";
import { getInstallScanStatus } from "./installer";
import { getCachedWebsiteVideoLocalPath, isStashProxyUri } from "./webVideo";

export type PhashScanState = "idle" | "running" | "done" | "aborted" | "error";

export type PhashScanError = {
  roundId: string;
  roundName: string;
  reason: string;
};

export type PhashScanStatus = {
  state: PhashScanState;
  startedAt: string | null;
  finishedAt: string | null;
  totalCount: number;
  completedCount: number;
  skippedCount: number;
  failedCount: number;
  currentRoundName: string | null;
  errors: PhashScanError[];
};

const MAX_TRACKED_ERRORS = 20;
const INSTALL_SCAN_POLL_INTERVAL_MS = 500;
const MAX_INSTALL_SCAN_WAIT_MS = 300000;
const CONTINUOUS_SCAN_INTERVAL_MS = 5 * 60 * 1000;

let scanStatus: PhashScanStatus = {
  state: "idle",
  startedAt: null,
  finishedAt: null,
  totalCount: 0,
  completedCount: 0,
  skippedCount: 0,
  failedCount: 0,
  currentRoundName: null,
  errors: [],
};

let activeScanPromise: Promise<void> | null = null;
let abortRequested = false;
let continuousScanTimer: ReturnType<typeof setInterval> | null = null;
let rerunRequested = false;

function cloneStatus(status: PhashScanStatus): PhashScanStatus {
  return { ...status, errors: [...status.errors] };
}

type RoundWithoutPhashResource = {
  resourceId: string;
  videoUri: string;
};

type RoundWithoutPhash = {
  roundId: string;
  roundName: string;
  startTime: number | null;
  endTime: number | null;
  resources: RoundWithoutPhashResource[];
};

async function waitForInstallScan(): Promise<void> {
  const startTime = Date.now();
  while (Date.now() - startTime < MAX_INSTALL_SCAN_WAIT_MS) {
    const installStatus = getInstallScanStatus();
    if (installStatus.state !== "running") {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, INSTALL_SCAN_POLL_INTERVAL_MS));
  }
}

async function findRoundsWithoutPhash(): Promise<RoundWithoutPhash[]> {
  const db = getDb();

  const rounds = await db
    .select({
      roundId: round.id,
      roundName: round.name,
      resourceId: resource.id,
      videoUri: resource.videoUri,
      startTime: round.startTime,
      endTime: round.endTime,
    })
    .from(round)
    .innerJoin(resource, eq(resource.roundId, round.id))
    .where(and(isNull(round.phash), isNull(resource.phash), eq(resource.disabled, false)));

  const grouped = new Map<string, RoundWithoutPhash>();

  for (const row of rounds) {
    const existing = grouped.get(row.roundId);
    if (existing) {
      existing.resources.push({
        resourceId: row.resourceId,
        videoUri: row.videoUri,
      });
      continue;
    }

    grouped.set(row.roundId, {
      roundId: row.roundId,
      roundName: row.roundName,
      startTime: row.startTime,
      endTime: row.endTime,
      resources: [
        {
          resourceId: row.resourceId,
          videoUri: row.videoUri,
        },
      ],
    });
  }

  return [...grouped.values()];
}

function pushScanError(roundId: string, roundName: string, reason: string): void {
  scanStatus.failedCount += 1;
  if (scanStatus.errors.length >= MAX_TRACKED_ERRORS) return;
  scanStatus.errors.push({ roundId, roundName, reason });
}

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function resolvePhashVideoPath(videoUri: string): Promise<string | null> {
  if (isStashProxyUri(videoUri)) {
    return null;
  }

  const localVideoPath = fromLocalMediaUri(videoUri);
  if (localVideoPath) {
    return localVideoPath;
  }

  return getCachedWebsiteVideoLocalPath(videoUri);
}

async function runPhashScan(): Promise<void> {
  const roundsToProcess = await findRoundsWithoutPhash();

  scanStatus.totalCount = roundsToProcess.length;

  if (roundsToProcess.length === 0) {
    scanStatus.state = "done";
    scanStatus.finishedAt = new Date().toISOString();
    return;
  }

  const db = getDb();

  for (const row of roundsToProcess) {
    if (abortRequested) {
      scanStatus.state = "aborted";
      scanStatus.finishedAt = new Date().toISOString();
      return;
    }

    scanStatus.currentRoundName = row.roundName;

    let localVideoPath: string | null = null;
    let resolvedResourceId: string | null = null;

    for (const candidate of row.resources) {
      localVideoPath = await resolvePhashVideoPath(candidate.videoUri);
      if (!localVideoPath) continue;
      resolvedResourceId = candidate.resourceId;
      break;
    }

    if (!localVideoPath || !resolvedResourceId) {
      pushScanError(
        row.roundId,
        row.roundName,
        "Video is not available as a local file yet, cannot compute phash."
      );
      scanStatus.skippedCount += 1;
      continue;
    }

    try {
      const phash = await generateVideoPhash(
        localVideoPath,
        row.startTime ?? undefined,
        row.endTime ?? undefined,
        { lowPriority: true }
      );

      if (!phash || typeof phash !== "string" || phash.trim().length === 0) {
        pushScanError(row.roundId, row.roundName, "Phash generation returned empty result.");
        scanStatus.skippedCount += 1;
        continue;
      }

      await db
        .update(round)
        .set({ phash: phash.trim(), updatedAt: new Date() })
        .where(eq(round.id, row.roundId));

      await db.update(resource).set({ phash: phash.trim() }).where(eq(resource.id, resolvedResourceId));

      scanStatus.completedCount += 1;
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unknown error during phash generation.";
      pushScanError(row.roundId, row.roundName, message);
      scanStatus.skippedCount += 1;
    }

    await sleep(100);
  }

  scanStatus.state = "done";
  scanStatus.finishedAt = new Date().toISOString();
  scanStatus.currentRoundName = null;
}

function launchPhashScanRun(): void {
  activeScanPromise = runPhashScan()
    .catch((error) => {
      scanStatus.state = "error";
      scanStatus.finishedAt = new Date().toISOString();
      scanStatus.currentRoundName = null;

      const message = error instanceof Error ? error.message : "Unknown phash scan error.";
      scanStatus.errors.push({
        roundId: "scan",
        roundName: "Phash Scan",
        reason: message,
      });
    })
    .finally(() => {
      activeScanPromise = null;

      const shouldRerun = rerunRequested && !abortRequested;
      rerunRequested = false;

      if (shouldRerun) {
        abortRequested = false;
        scanStatus = {
          state: "running",
          startedAt: new Date().toISOString(),
          finishedAt: null,
          totalCount: 0,
          completedCount: 0,
          skippedCount: 0,
          failedCount: 0,
          currentRoundName: null,
          errors: [],
        };
        launchPhashScanRun();
        return;
      }

      abortRequested = false;
    });
}

export function getPhashScanStatus(): PhashScanStatus {
  return cloneStatus(scanStatus);
}

export function requestPhashScanAbort(): PhashScanStatus {
  if (!activeScanPromise || scanStatus.state !== "running") {
    return cloneStatus(scanStatus);
  }

  abortRequested = true;
  scanStatus = {
    ...scanStatus,
    currentRoundName: null,
  };

  return cloneStatus(scanStatus);
}

export async function startPhashScan(): Promise<PhashScanStatus> {
  const store = getStore();
  const isEnabled = normalizeBackgroundPhashScanningEnabled(
    store.get(BACKGROUND_PHASH_SCANNING_ENABLED_KEY)
  );

  if (!isEnabled) {
    return cloneStatus(scanStatus);
  }

  if (activeScanPromise) {
    rerunRequested = true;
    return cloneStatus(scanStatus);
  }

  await waitForInstallScan();

  if (abortRequested) {
    scanStatus.state = "aborted";
    scanStatus.finishedAt = new Date().toISOString();
    return cloneStatus(scanStatus);
  }

  abortRequested = false;
  scanStatus = {
    state: "running",
    startedAt: new Date().toISOString(),
    finishedAt: null,
    totalCount: 0,
    completedCount: 0,
    skippedCount: 0,
    failedCount: 0,
    currentRoundName: null,
    errors: [],
  };

  rerunRequested = false;
  launchPhashScanRun();

  await activeScanPromise;
  return cloneStatus(scanStatus);
}

export async function startPhashScanManual(): Promise<PhashScanStatus> {
  if (activeScanPromise) {
    rerunRequested = true;
    return cloneStatus(scanStatus);
  }

  await waitForInstallScan();

  if (abortRequested) {
    scanStatus.state = "aborted";
    scanStatus.finishedAt = new Date().toISOString();
    return cloneStatus(scanStatus);
  }

  abortRequested = false;
  scanStatus = {
    state: "running",
    startedAt: new Date().toISOString(),
    finishedAt: null,
    totalCount: 0,
    completedCount: 0,
    skippedCount: 0,
    failedCount: 0,
    currentRoundName: null,
    errors: [],
  };

  rerunRequested = false;
  launchPhashScanRun();

  await activeScanPromise;
  return cloneStatus(scanStatus);
}

export function startContinuousPhashScan(): void {
  const store = getStore();
  const isEnabled = normalizeBackgroundPhashScanningEnabled(
    store.get(BACKGROUND_PHASH_SCANNING_ENABLED_KEY)
  );

  if (!isEnabled) {
    stopContinuousPhashScan();
    return;
  }

  if (continuousScanTimer) {
    return;
  }

  continuousScanTimer = setInterval(async () => {
    const currentSetting = normalizeBackgroundPhashScanningEnabled(
      getStore().get(BACKGROUND_PHASH_SCANNING_ENABLED_KEY)
    );

    if (!currentSetting) {
      stopContinuousPhashScan();
      return;
    }

    if (activeScanPromise) {
      return;
    }

    try {
      await startPhashScan();
    } catch (error) {
      console.error("Continuous phash scan error:", error);
    }
  }, CONTINUOUS_SCAN_INTERVAL_MS);

  void startPhashScan().catch((error) => {
    console.error("Initial continuous phash scan error:", error);
  });
}

export function stopContinuousPhashScan(): void {
  if (continuousScanTimer) {
    clearInterval(continuousScanTimer);
    continuousScanTimer = null;
  }
}

export function isContinuousPhashScanRunning(): boolean {
  return continuousScanTimer !== null;
}
