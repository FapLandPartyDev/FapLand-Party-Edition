import { and, eq } from "drizzle-orm";
import { getDb } from "./db";
import { round, resource } from "./db/schema";
import { getInstallScanStatus } from "./installer";
import { toLocalMediaUri } from "./localMedia";
import { startPhashScanManual } from "./phashScanService";
import { generateRoundPreviewImageDataUri } from "./roundPreview";
import {
  ensureWebsiteVideoCached,
  getCachedWebsiteVideoMetadata,
  getWebsiteVideoTargetUrl,
  isStashProxyUri,
} from "./webVideo";
import { shouldDeferBackgroundWork } from "./rendererPerformance";
import { debugLog } from "./debugLogging";

export type WebsiteVideoScanState = "idle" | "running" | "done" | "aborted" | "error";

export type WebsiteVideoScanError = {
  resourceId: string;
  roundId: string;
  roundName: string;
  url: string;
  reason: string;
};

export type WebsiteVideoScanStatus = {
  state: WebsiteVideoScanState;
  startedAt: string | null;
  finishedAt: string | null;
  totalCount: number;
  completedCount: number;
  skippedCount: number;
  failedCount: number;
  currentRoundName: string | null;
  currentUrl: string | null;
  errors: WebsiteVideoScanError[];
};

type WebsiteVideoCandidateRow = {
  resourceId: string;
  roundId: string;
  roundName: string;
  installSourceKey: string | null;
  videoUri: string;
};

type PendingWebsiteVideo = {
  resourceId: string;
  roundId: string;
  roundName: string;
  url: string;
};

type PendingWebsiteVideoDiscoveryError = PendingWebsiteVideo & {
  reason: string;
};

type WebsiteVideoScanMode = "background" | "manual";

type WebsiteRoundPreviewCandidate = {
  roundId: string;
  resourceId: string;
  startTime: number | null;
  endTime: number | null;
  previewImage: string | null;
};

const MAX_TRACKED_ERRORS = 20;
const INSTALL_SCAN_POLL_INTERVAL_MS = 500;
const MAX_INSTALL_SCAN_WAIT_MS = 300000;
const CONTINUOUS_SCAN_INTERVAL_MS = 5 * 60 * 1000;
const INITIAL_CONTINUOUS_SCAN_DELAY_MS = 60_000;
const WEBSITE_VIDEO_SCAN_CONCURRENCY = 3;

let scanStatus: WebsiteVideoScanStatus = {
  state: "idle",
  startedAt: null,
  finishedAt: null,
  totalCount: 0,
  completedCount: 0,
  skippedCount: 0,
  failedCount: 0,
  currentRoundName: null,
  currentUrl: null,
  errors: [],
};

let activeScanPromise: Promise<void> | null = null;
let abortRequested = false;
let continuousScanTimer: ReturnType<typeof setInterval> | null = null;
let initialContinuousScanTimer: ReturnType<typeof setTimeout> | null = null;
const activeItemsByUrl = new Map<string, PendingWebsiteVideo>();
let rerunRequested = false;

function cloneStatus(status: WebsiteVideoScanStatus): WebsiteVideoScanStatus {
  return { ...status, errors: [...status.errors] };
}

function syncCurrentItemSummary(): void {
  const activeItems = [...activeItemsByUrl.values()];
  if (activeItems.length === 0) {
    scanStatus.currentRoundName = null;
    scanStatus.currentUrl = null;
    return;
  }

  const [firstActive] = activeItems;
  if (!firstActive) {
    scanStatus.currentRoundName = null;
    scanStatus.currentUrl = null;
    return;
  }

  scanStatus.currentRoundName =
    activeItems.length > 1
      ? `${firstActive.roundName} (+${activeItems.length - 1} more)`
      : firstActive.roundName;
  scanStatus.currentUrl = firstActive.url;
}

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForInstallScan(): Promise<void> {
  const startTime = Date.now();
  while (Date.now() - startTime < MAX_INSTALL_SCAN_WAIT_MS) {
    const installStatus = getInstallScanStatus();
    if (installStatus.state !== "running") {
      return;
    }
    await sleep(INSTALL_SCAN_POLL_INTERVAL_MS);
  }
}

async function findUncachedWebsiteVideos(): Promise<{
  items: PendingWebsiteVideo[];
  discoveryErrors: PendingWebsiteVideoDiscoveryError[];
}> {
  const db = getDb();
  const rows = await db
    .select({
      resourceId: resource.id,
      roundId: round.id,
      roundName: round.name,
      installSourceKey: round.installSourceKey,
      videoUri: resource.videoUri,
    })
    .from(round)
    .innerJoin(resource, eq(resource.roundId, round.id))
    .where(and(eq(resource.disabled, false)));

  const pendingItemsByUrl = new Map<string, PendingWebsiteVideo>();
  const seenTargetUrls = new Set<string>();
  const discoveryErrors: PendingWebsiteVideoDiscoveryError[] = [];

  for (const row of rows as WebsiteVideoCandidateRow[]) {
    if (row.installSourceKey?.startsWith("stash:") || isStashProxyUri(row.videoUri)) continue;

    let normalizedTargetUrl: string | null = null;
    try {
      normalizedTargetUrl = getWebsiteVideoTargetUrl(row.videoUri);
      if (!normalizedTargetUrl) continue;
      if (seenTargetUrls.has(normalizedTargetUrl)) continue;
      seenTargetUrls.add(normalizedTargetUrl);

      const cachedMetadata = await getCachedWebsiteVideoMetadata(normalizedTargetUrl);
      if (cachedMetadata) {
        console.log(`Skipping ${row.videoUri} - already cached`);
        continue;
      }
    } catch (error) {
      const reason =
        error instanceof Error ? error.message : "Unknown website video cache discovery error.";
      discoveryErrors.push({
        resourceId: row.resourceId,
        roundId: row.roundId,
        roundName: row.roundName,
        url: normalizedTargetUrl ?? row.videoUri,
        reason,
      });
      continue;
    }

    pendingItemsByUrl.set(normalizedTargetUrl, {
      resourceId: row.resourceId,
      roundId: row.roundId,
      roundName: row.roundName,
      url: normalizedTargetUrl,
    });
  }

  return {
    items: [...pendingItemsByUrl.values()],
    discoveryErrors,
  };
}

function pushScanError(item: PendingWebsiteVideo, reason: string): void {
  scanStatus.failedCount += 1;
  if (scanStatus.errors.length >= MAX_TRACKED_ERRORS) return;
  scanStatus.errors.push({
    resourceId: item.resourceId,
    roundId: item.roundId,
    roundName: item.roundName,
    url: item.url,
    reason,
  });
}

async function generateMissingPreviewImagesForCachedWebsiteVideo(
  item: PendingWebsiteVideo,
  finalFilePath: string
): Promise<void> {
  const db = getDb();
  const rows = await db
    .select({
      roundId: round.id,
      resourceId: resource.id,
      startTime: round.startTime,
      endTime: round.endTime,
      previewImage: round.previewImage,
    })
    .from(round)
    .innerJoin(resource, eq(resource.roundId, round.id))
    .where(and(eq(resource.videoUri, item.url), eq(resource.disabled, false)));

  const previewCandidates = rows as WebsiteRoundPreviewCandidate[];
  if (previewCandidates.length === 0) return;

  const localVideoUri = toLocalMediaUri(finalFilePath);
  for (const row of previewCandidates) {
    if (row.previewImage) continue;

    const previewImage = await generateRoundPreviewImageDataUri({
      videoUri: localVideoUri,
      startTimeMs: row.startTime,
      endTimeMs: row.endTime,
    });
    if (!previewImage) continue;

    await db
      .update(round)
      .set({
        previewImage,
        updatedAt: new Date(),
      })
      .where(eq(round.id, row.roundId));
  }
}

async function runWebsiteVideoScan(mode: WebsiteVideoScanMode): Promise<void> {
  const { items, discoveryErrors } = await findUncachedWebsiteVideos();
  for (const discoveryError of discoveryErrors) {
    pushScanError(discoveryError, discoveryError.reason);
    scanStatus.skippedCount += 1;
  }
  scanStatus.totalCount = items.length + discoveryErrors.length;

  if (scanStatus.totalCount === 0) {
    scanStatus.state = "done";
    scanStatus.finishedAt = new Date().toISOString();
    debugLog.info("websiteVideoScan", "No uncached website videos found");
    return;
  }
  debugLog.info("websiteVideoScan", "Scan started", { totalCount: scanStatus.totalCount });

  let cursor = 0;

  const worker = async (): Promise<void> => {
    while (!abortRequested) {
      if (mode === "background" && shouldDeferBackgroundWork()) {
        abortRequested = true;
        debugLog.info("websiteVideoScan", "Background scan yielded to renderer activity");
        return;
      }
      const item = items[cursor];
      cursor += 1;
      if (!item) {
        return;
      }

      activeItemsByUrl.set(item.url, item);
      syncCurrentItemSummary();

      try {
        const metadata = await ensureWebsiteVideoCached(item.url);
        await generateMissingPreviewImagesForCachedWebsiteVideo(item, metadata.finalFilePath);
        void startPhashScanManual().catch((error) => {
          console.error("Failed to queue phash scan after website cache", error);
          debugLog.error(
            "websiteVideoScan",
            "Failed to queue phash scan after website cache",
            error
          );
        });
        scanStatus.completedCount += 1;
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Unknown website video cache error.";
        pushScanError(item, message);
        scanStatus.skippedCount += 1;
        debugLog.warn("websiteVideoScan", "Website video cache failed", {
          roundId: item.roundId,
          roundName: item.roundName,
          url: item.url,
          message,
        });
      } finally {
        activeItemsByUrl.delete(item.url);
        syncCurrentItemSummary();
      }

      await sleep(100);
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(WEBSITE_VIDEO_SCAN_CONCURRENCY, items.length) }, () => worker())
  );

  if (abortRequested) {
    scanStatus.state = "aborted";
    scanStatus.finishedAt = new Date().toISOString();
    scanStatus.currentRoundName = null;
    scanStatus.currentUrl = null;
    debugLog.warn("websiteVideoScan", "Scan aborted", scanStatus);
    return;
  }

  scanStatus.state = "done";
  scanStatus.finishedAt = new Date().toISOString();
  scanStatus.currentRoundName = null;
  scanStatus.currentUrl = null;
  debugLog.info("websiteVideoScan", "Scan finished", scanStatus);
}

function launchScanRun(mode: WebsiteVideoScanMode): void {
  activeScanPromise = runWebsiteVideoScan(mode)
    .catch((error) => {
      scanStatus.state = "error";
      scanStatus.finishedAt = new Date().toISOString();
      scanStatus.currentRoundName = null;
      scanStatus.currentUrl = null;

      const message = error instanceof Error ? error.message : "Unknown website video scan error.";
      scanStatus.errors.push({
        resourceId: "scan",
        roundId: "scan",
        roundName: "Website Video Scan",
        url: scanStatus.currentUrl ?? "",
        reason: message,
      });
      debugLog.error("websiteVideoScan", "Scan failed", error);
    })
    .finally(() => {
      activeScanPromise = null;
      activeItemsByUrl.clear();
      syncCurrentItemSummary();

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
          currentUrl: null,
          errors: [],
        };
        launchScanRun(mode);
        return;
      }

      abortRequested = false;
    });
}

export function getWebsiteVideoScanStatus(): WebsiteVideoScanStatus {
  return cloneStatus(scanStatus);
}

export function requestWebsiteVideoScanAbort(): WebsiteVideoScanStatus {
  if (!activeScanPromise || scanStatus.state !== "running") {
    return cloneStatus(scanStatus);
  }

  abortRequested = true;
  scanStatus = {
    ...scanStatus,
    currentRoundName: null,
    currentUrl: null,
  };

  return cloneStatus(scanStatus);
}

async function startScanInternal(manual: boolean): Promise<WebsiteVideoScanStatus> {
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
  activeItemsByUrl.clear();
  scanStatus = {
    state: "running",
    startedAt: new Date().toISOString(),
    finishedAt: null,
    totalCount: 0,
    completedCount: 0,
    skippedCount: 0,
    failedCount: 0,
    currentRoundName: null,
    currentUrl: null,
    errors: [],
  };

  rerunRequested = false;
  launchScanRun(manual ? "manual" : "background");

  await activeScanPromise;
  return cloneStatus(scanStatus);
}

export async function startWebsiteVideoScan(): Promise<WebsiteVideoScanStatus> {
  return startScanInternal(false);
}

export async function startWebsiteVideoScanManual(): Promise<WebsiteVideoScanStatus> {
  return startScanInternal(true);
}

export function startContinuousWebsiteVideoScan(): void {
  if (continuousScanTimer) {
    return;
  }

  if (!initialContinuousScanTimer) {
    initialContinuousScanTimer = setTimeout(() => {
      initialContinuousScanTimer = null;
      if (activeScanPromise || shouldDeferBackgroundWork()) return;

      void startWebsiteVideoScan().catch((error) => {
        console.error("Initial continuous website video scan error:", error);
        debugLog.error("websiteVideoScan", "Initial continuous website video scan error", error);
      });
    }, INITIAL_CONTINUOUS_SCAN_DELAY_MS);
  }

  continuousScanTimer = setInterval(async () => {
    if (activeScanPromise || shouldDeferBackgroundWork()) {
      return;
    }

    try {
      await startWebsiteVideoScan();
    } catch (error) {
      console.error("Continuous website video scan error:", error);
      debugLog.error("websiteVideoScan", "Continuous website video scan error", error);
    }
  }, CONTINUOUS_SCAN_INTERVAL_MS);
}

export function stopContinuousWebsiteVideoScan(): void {
  if (initialContinuousScanTimer) {
    clearTimeout(initialContinuousScanTimer);
    initialContinuousScanTimer = null;
  }
  if (continuousScanTimer) {
    clearInterval(continuousScanTimer);
    continuousScanTimer = null;
  }
}

export function isContinuousWebsiteVideoScanRunning(): boolean {
  return continuousScanTimer !== null;
}
