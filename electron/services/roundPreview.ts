import path from "node:path";
import { fromLocalMediaUri, resolveExistingLocalMediaPath } from "./localMedia";
import { resolvePhashBinaries } from "./phash/binaries";
import { runCommand } from "./phash/extract";
import {
  PREVIEW_FFMPEG_SINGLE_THREAD_ENABLED_KEY,
  normalizePreviewFfmpegSingleThreadEnabled,
} from "../../src/constants/phashSettings";
import { getStore } from "./store";
import { getCachedWebsiteVideoLocalPath, getWebsiteVideoTargetUrl } from "./webVideo";

const PREVIEW_IMAGE_WIDTH = 480;
const PREVIEW_JPEG_QUALITY = 6;

type GenerateRoundPreviewImageInput = {
  videoUri: string;
  startTimeMs?: number | null;
  endTimeMs?: number | null;
  background?: boolean;
};

function normalizeTimestampMs(value: number | null | undefined): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  const rounded = Math.floor(value);
  return rounded >= 0 ? rounded : null;
}

function resolvePreviewTimestampMs(startTimeMs?: number | null, endTimeMs?: number | null): number {
  const normalizedStart = normalizeTimestampMs(startTimeMs);
  const normalizedEnd = normalizeTimestampMs(endTimeMs);

  if (normalizedStart !== null && normalizedEnd !== null && normalizedEnd > normalizedStart) {
    return Math.floor((normalizedStart + normalizedEnd) / 2);
  }

  if (normalizedStart !== null) {
    return normalizedStart;
  }

  if (normalizedEnd !== null) {
    return Math.max(0, normalizedEnd - 1000);
  }

  return 1000;
}

async function toFfmpegInput(videoUri: string): Promise<string | null> {
  const localPath = fromLocalMediaUri(videoUri);
  if (localPath) return resolveExistingLocalMediaPath(localPath);

  try {
    const parsed = new URL(videoUri);

    if (parsed.protocol === "http:" || parsed.protocol === "https:") {
      return parsed.toString();
    }
  } catch {
    // fall through to website cache / proxy resolution below
  }

  const cachedLocalPath = await getCachedWebsiteVideoLocalPath(videoUri);
  if (cachedLocalPath) {
    return path.normalize(cachedLocalPath);
  }

  return getWebsiteVideoTargetUrl(videoUri);
}

export async function generateRoundPreviewImageDataUri(
  input: GenerateRoundPreviewImageInput
): Promise<string | null> {
  const ffmpegInput = await toFfmpegInput(input.videoUri);
  if (!ffmpegInput) return null;

  const timestampMs = resolvePreviewTimestampMs(input.startTimeMs, input.endTimeMs);
  const timestampSeconds = (timestampMs / 1000).toFixed(6);

  try {
    const binaries = await resolvePhashBinaries();
    const limitThreads =
      input.background ||
      normalizePreviewFfmpegSingleThreadEnabled(
        getStore().get(PREVIEW_FFMPEG_SINGLE_THREAD_ENABLED_KEY)
      );
    const args = [
      "-hide_banner",
      "-loglevel",
      "error",
      "-nostdin",
      ...(limitThreads ? ["-threads", "1"] : []),
      ...(input.background ? ["-filter_threads", "1"] : []),
      "-ss",
      timestampSeconds,
      "-i",
      ffmpegInput,
      "-frames:v",
      "1",
      "-vf",
      `scale=${PREVIEW_IMAGE_WIDTH}:-2`,
      "-q:v",
      `${PREVIEW_JPEG_QUALITY}`,
      "-f",
      "image2pipe",
      "-vcodec",
      "mjpeg",
      "-",
    ];
    const { stdout } = await runCommand(binaries.ffmpegPath, args, {
      lowPriority: true,
      timeoutMs: 15_000,
    });

    if (stdout.length === 0) return null;
    return `data:image/jpeg;base64,${stdout.toString("base64")}`;
  } catch {
    return null;
  }
}

// Browsing the library must never launch a decoder for every visible card at once.
// Share in-flight requests and briefly remember failures to avoid repeated disk work.
let previewQueue: Promise<unknown> = Promise.resolve();
const pendingPreviews = new Map<string, Promise<string | null>>();
const failedPreviews = new Map<string, number>();

export function generateQueuedRoundPreviewImageDataUri(
  input: GenerateRoundPreviewImageInput
): Promise<string | null> {
  const key = JSON.stringify(input);
  const pending = pendingPreviews.get(key);
  if (pending) return pending;
  const failedAt = failedPreviews.get(key);
  if (failedAt && Date.now() - failedAt < 60_000) return Promise.resolve(null);

  const request = previewQueue
    .then(() => generateRoundPreviewImageDataUri({ ...input, background: true }))
    .catch(() => null)
    .then((image) => {
      pendingPreviews.delete(key);
      if (!image) {
        failedPreviews.delete(key);
        failedPreviews.set(key, Date.now());
        if (failedPreviews.size > 128) {
          failedPreviews.delete(failedPreviews.keys().next().value!);
        }
      } else {
        failedPreviews.delete(key);
      }
      return image;
    });
  pendingPreviews.set(key, request);
  previewQueue = request;
  return request;
}
