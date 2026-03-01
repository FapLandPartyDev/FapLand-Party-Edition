import { isNull, and, eq } from "drizzle-orm";
import { getDb } from "./db";
import { round, resource } from "./db/schema";
import { getStore } from "./store";
import {
  BACKGROUND_PHASH_SCANNING_ENABLED_KEY,
  BACKGROUND_PHASH_ROUNDS_PER_PASS_KEY,
  normalizeBackgroundPhashScanningEnabled,
  normalizeBackgroundPhashRoundsPerPass,
} from "../../src/constants/phashSettings";
import { generateVideoPhash } from "./phash";
import { getInstallScanStatus } from "./installer";
import { resolveDirectPlayableResolution, type DirectPlayableResolution } from "./integrations";
import { shouldDeferBackgroundWork } from "./rendererPerformance";
import { debugLog } from "./debugLogging";

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
const INITIAL_CONTINUOUS_SCAN_DELAY_MS = 60_000;

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
let initialContinuousScanTimer: ReturnType<typeof setTimeout> | null = null;
let rerunRequested = false;

type PhashScanMode = "background" | "manual";

type RunPhashScanOptions = {
  mode: PhashScanMode;
  maxRounds?: number;
};

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

async function resolvePhashVideoPath(videoUri: string): Promise<DirectPlayableResolution | null> {
  return resolveDirectPlayableResolution(videoUri);
}

async function runPhashScan(options: RunPhashScanOptions): Promise<void> {
  const allRoundsWithoutPhash = await findRoundsWithoutPhash();
  const roundsToProcess =
    options.mode === "background" && typeof options.maxRounds === "number"
      ? allRoundsWithoutPhash.slice(0, Math.max(0, options.maxRounds))
      : allRoundsWithoutPhash;

  scanStatus.totalCount = roundsToProcess.length;

  if (roundsToProcess.length === 0) {
    scanStatus.state = "done";
    scanStatus.finishedAt = new Date().toISOString();
    console.log("[PhashScan] No rounds without phash found. Scan finished.");
    debugLog.info("phashScan", "No rounds without phash found");
    return;
  }

  console.log(`[PhashScan] Started ${options.mode} scanning ${roundsToProcess.length} rounds...`);
  debugLog.info("phashScan", "Scan started", {
    mode: options.mode,
    totalCount: roundsToProcess.length,
  });

  const db = getDb();

  for (const row of roundsToProcess) {
    if (abortRequested) {
      scanStatus.state = "aborted";
      scanStatus.finishedAt = new Date().toISOString();
      console.log("[PhashScan] Scan aborted.");
      debugLog.warn("phashScan", "Scan aborted", scanStatus);
      return;
    }

    scanStatus.currentRoundName = row.roundName;

    const startTime = Date.now();
    console.log(
      `[PhashScan] Processing round "${row.roundName}" (${row.resources.length} resources)...`
    );

    try {
      let resolution: DirectPlayableResolution | null = null;
      let resolvedResourceId: string | null = null;

      for (const [index, candidate] of row.resources.entries()) {
        console.log(
          `[PhashScan] [${row.roundName}] Resolving path for resource ${index + 1}/${row.resources.length}: ${candidate.videoUri}`
        );
        resolution = await resolvePhashVideoPath(candidate.videoUri);
        console.log(`[PhashScan] [${row.roundName}] Result: ${resolution ? "found" : "not found"}`);
        if (resolution) {
          resolvedResourceId = candidate.resourceId;
          break;
        }
      }

      if (!resolution || !resolvedResourceId) {
        console.log(
          `[PhashScan] [${row.roundName}] Video is not available for phash computation yet.`
        );
        scanStatus.skippedCount += 1;
        continue;
      }

      console.log(`[PhashScan] [${row.roundName}] Generating phash...`);
      const phash = await generateVideoPhash(
        resolution.streamUrl,
        row.startTime ?? undefined,
        row.endTime ?? undefined,
        { lowPriority: true, headers: resolution.headers }
      );

      if (!phash || typeof phash !== "string" || phash.trim().length === 0) {
        pushScanError(row.roundId, row.roundName, "Phash generation returned empty result.");
        scanStatus.skippedCount += 1;
        continue;
      }

      const trimmedPhash = phash.trim();
      await db
        .update(round)
        .set({ phash: trimmedPhash, updatedAt: new Date() })
        .where(eq(round.id, row.roundId));

      await db
        .update(resource)
        .set({ phash: trimmedPhash })
        .where(eq(resource.id, resolvedResourceId));

      scanStatus.completedCount += 1;
      console.log(
        `[PhashScan] [${scanStatus.completedCount + scanStatus.skippedCount + scanStatus.failedCount}/${
          scanStatus.totalCount
        }] Successfully generated phash for "${row.roundName}"`
      );
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unknown error during phash generation.";
      pushScanError(row.roundId, row.roundName, message);
      scanStatus.skippedCount += 1;
      debugLog.warn("phashScan", "Round phash generation failed", {
        roundId: row.roundId,
        roundName: row.roundName,
        message,
      });
      console.log(
        `[PhashScan] [${scanStatus.completedCount + scanStatus.skippedCount + scanStatus.failedCount}/${
          scanStatus.totalCount
        }] Failed "${row.roundName}": ${message}`
      );
    } finally {
      const duration = Date.now() - startTime;
      console.log(`[PhashScan] Finished processing round "${row.roundName}" in ${duration}ms.`);
      debugLog.debug("phashScan", "Round processed", {
        roundId: row.roundId,
        roundName: row.roundName,
        durationMs: duration,
      });
    }

    await sleep(100);
  }

  console.log(
    `[PhashScan] Finished scanning. Completed: ${scanStatus.completedCount}, Skipped: ${scanStatus.skippedCount}, Failed: ${scanStatus.failedCount}`
  );
  debugLog.info("phashScan", "Scan finished", scanStatus);
  scanStatus.state = "done";
  scanStatus.finishedAt = new Date().toISOString();
  scanStatus.currentRoundName = null;
}

function launchPhashScanRun(options: RunPhashScanOptions): void {
  activeScanPromise = runPhashScan(options)
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
      console.error(`[PhashScan] Scan failed: ${message}`);
      debugLog.error("phashScan", "Scan failed", error);
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
        launchPhashScanRun(options);
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
  const roundsPerPass = normalizeBackgroundPhashRoundsPerPass(
    store.get(BACKGROUND_PHASH_ROUNDS_PER_PASS_KEY)
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
  launchPhashScanRun({ mode: "background", maxRounds: roundsPerPass });

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
  launchPhashScanRun({ mode: "manual" });

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

  if (!initialContinuousScanTimer) {
    initialContinuousScanTimer = setTimeout(() => {
      initialContinuousScanTimer = null;
      const currentSetting = normalizeBackgroundPhashScanningEnabled(
        getStore().get(BACKGROUND_PHASH_SCANNING_ENABLED_KEY)
      );
      if (!currentSetting || activeScanPromise || shouldDeferBackgroundWork()) return;

      void startPhashScan().catch((error) => {
        console.error("Initial continuous phash scan error:", error);
      });
    }, INITIAL_CONTINUOUS_SCAN_DELAY_MS);
  }

  continuousScanTimer = setInterval(async () => {
    const currentSetting = normalizeBackgroundPhashScanningEnabled(
      getStore().get(BACKGROUND_PHASH_SCANNING_ENABLED_KEY)
    );

    if (!currentSetting) {
      stopContinuousPhashScan();
      return;
    }

    if (activeScanPromise || shouldDeferBackgroundWork()) {
      return;
    }

    try {
      await startPhashScan();
    } catch (error) {
      console.error("Continuous phash scan error:", error);
    }
  }, CONTINUOUS_SCAN_INTERVAL_MS);
}

export function stopContinuousPhashScan(): void {
  if (initialContinuousScanTimer) {
    clearTimeout(initialContinuousScanTimer);
    initialContinuousScanTimer = null;
  }
  if (continuousScanTimer) {
    clearInterval(continuousScanTimer);
    continuousScanTimer = null;
  }
}

export function isContinuousPhashScanRunning(): boolean {
  return continuousScanTimer !== null;
}
