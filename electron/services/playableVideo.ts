import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { resolvePhashBinaries } from "./phash/binaries";
import { runCommand } from "./phash/extract";
import { fromLocalMediaUri, isLocalMediaUri, toLocalMediaUri } from "./localMedia";
import { PLAYABLE_VIDEO_CACHE_RELATIVE_PATH, resolveDefaultStoragePath } from "./storagePaths";
import {
  buildWebsiteVideoProxyUri,
  getCachedWebsiteVideoLocalPath,
  isStashProxyUri,
  parseStashProxyUri,
  isWebsiteVideoResolvableUri,
  warmWebsiteVideoCache,
} from "./webVideo";
import { resolveMediaUri } from "./integrations";

export type ResolvePlayableVideoUriResult = {
  videoUri: string;
  transcoded: boolean;
  cacheHit: boolean;
};

const SUPPORTED_CHROMIUM_VIDEO_CODECS = new Set([
  "av1",
  "avc1",
  "h264",
  "mpeg4",
  "theora",
  "vp8",
  "vp9",
]);
// H.264 streams using non-YUV420P 8-bit pixel formats (e.g. 10-bit, 4:2:2, 4:4:4)
// cannot be decoded by Chromium's built-in decoder and must be transcoded.
// yuv420p is the only broadly supported format.
const H264_PIXEL_FORMATS_REQUIRING_TRANSCODE = new Set([
  "yuv420p10le",
  "yuv420p10be",
  "yuv422p",
  "yuv422p10le",
  "yuv422p10be",
  "yuv444p",
  "yuv444p10le",
  "yuv444p10be",
  "yuvj422p",
  "yuvj444p",
]);
const resolvedBySourceFingerprint = new Map<string, ResolvePlayableVideoUriResult>();
const inFlightBySourceFingerprint = new Map<string, Promise<ResolvePlayableVideoUriResult>>();
const inFlightByCacheKey = new Map<string, Promise<ResolvePlayableVideoUriResult>>();

export function __resetPlayableVideoCachesForTests(): void {
  resolvedBySourceFingerprint.clear();
  inFlightBySourceFingerprint.clear();
  inFlightByCacheKey.clear();
}

export async function clearPlayableVideoCache(): Promise<void> {
  __resetPlayableVideoCachesForTests();
  await fs.rm(resolveCacheRootPath(), { recursive: true, force: true });
}

export function isLocalPlayableVideoUri(videoUri: string): boolean {
  return isLocalMediaUri(videoUri);
}

export function toLocalVideoPath(videoUri: string): string | null {
  return fromLocalMediaUri(videoUri);
}

function resolveCacheRootPath(): string {
  try {
    return resolveDefaultStoragePath(PLAYABLE_VIDEO_CACHE_RELATIVE_PATH);
  } catch {
    return path.join(os.tmpdir(), "f-land", PLAYABLE_VIDEO_CACHE_RELATIVE_PATH);
  }
}

async function ensureCacheRootPath(): Promise<string> {
  const cacheRoot = resolveCacheRootPath();
  await fs.mkdir(cacheRoot, { recursive: true });
  return cacheRoot;
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function isNonEmptyFile(filePath: string): Promise<boolean> {
  try {
    const stats = await fs.stat(filePath);
    return stats.isFile() && stats.size > 0;
  } catch {
    return false;
  }
}

export function buildTranscodeCacheKey(input: {
  normalizedPath: string;
  fileSizeBytes: number;
  modifiedMs: number;
  ffmpegVersion: string | null;
}): string {
  const payload = [
    "playable-video:v1",
    input.normalizedPath,
    `${input.fileSizeBytes}`,
    `${input.modifiedMs}`,
    input.ffmpegVersion ?? "unknown",
  ].join("|");
  return crypto.createHash("sha256").update(payload).digest("hex");
}

function buildSourceFingerprint(input: {
  normalizedPath: string;
  fileSizeBytes: number;
  modifiedMs: number;
}): string {
  return [input.normalizedPath, `${input.fileSizeBytes}`, `${input.modifiedMs}`].join("|");
}

type VideoStreamInfo = {
  codecName: string | null;
  pixFmt: string | null;
};

function isLikelyChromiumSupportedStream(info: VideoStreamInfo): boolean {
  const { codecName, pixFmt } = info;
  if (!codecName) return false;
  const normalized = codecName.trim().toLowerCase();
  if (!normalized) return false;

  const isH264 =
    normalized === "h264" ||
    normalized === "avc1" ||
    normalized.includes("h264") ||
    normalized.includes("avc1");

  if (isH264) {
    // Only 8-bit YUV 4:2:0 is supported by Chromium's built-in H.264 decoder.
    // Any other pixel format (10-bit, 4:2:2, 4:4:4) requires a transcode.
    if (pixFmt && H264_PIXEL_FORMATS_REQUIRING_TRANSCODE.has(pixFmt.trim().toLowerCase())) {
      return false;
    }
    return true;
  }

  if (SUPPORTED_CHROMIUM_VIDEO_CODECS.has(normalized)) return true;
  if (normalized.includes("av1")) return true;
  if (normalized.includes("vp8") || normalized.includes("vp9")) return true;
  return false;
}

async function probePrimaryVideoStream(
  ffprobePath: string,
  sourcePath: string
): Promise<VideoStreamInfo> {
  try {
    const { stdout } = await runCommand(ffprobePath, [
      "-v",
      "error",
      "-select_streams",
      "v:0",
      "-show_entries",
      "stream=codec_name,pix_fmt",
      "-of",
      "json",
      sourcePath,
    ]);
    const payload = JSON.parse(stdout.toString("utf8")) as {
      streams?: Array<{ codec_name?: string | null; pix_fmt?: string | null }>;
    };
    const stream = payload.streams?.[0];
    const codecName =
      typeof stream?.codec_name === "string" && stream.codec_name.trim().length > 0
        ? stream.codec_name.trim().toLowerCase()
        : null;
    const pixFmt =
      typeof stream?.pix_fmt === "string" && stream.pix_fmt.trim().length > 0
        ? stream.pix_fmt.trim().toLowerCase()
        : null;
    return { codecName, pixFmt };
  } catch {
    return { codecName: null, pixFmt: null };
  }
}

async function transcodeToPlayableMp4(input: {
  ffmpegPath: string;
  sourcePath: string;
  outputPath: string;
}): Promise<void> {
  const tempPath = `${input.outputPath}.tmp`;
  await fs.rm(tempPath, { force: true });

  await runCommand(input.ffmpegPath, [
    "-hide_banner",
    "-loglevel",
    "error",
    "-nostdin",
    "-y",
    "-i",
    input.sourcePath,
    "-map",
    "0:v:0",
    "-map",
    "0:a?",
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    "-preset",
    "veryfast",
    "-movflags",
    "+faststart",
    "-c:a",
    "aac",
    "-b:a",
    "192k",
    tempPath,
  ]);

  if (!(await isNonEmptyFile(tempPath))) {
    throw new Error("Transcode did not produce an output file.");
  }

  await fs.rename(tempPath, input.outputPath);
}

export async function resolvePlayableVideoUri(
  videoUri: string
): Promise<ResolvePlayableVideoUriResult> {
  if (isStashProxyUri(videoUri)) {
    const hasSourceId = videoUri.includes("sourceId=");
    if (hasSourceId) {
      return {
        videoUri,
        transcoded: false,
        cacheHit: true,
      };
    }

    const parsed = parseStashProxyUri(videoUri);
    if (parsed?.targetUrl) {
      const resolved = resolveMediaUri(parsed.targetUrl, "video");
      if (resolved !== videoUri) {
        return {
          videoUri: resolved,
          transcoded: false,
          cacheHit: true,
        };
      }
    }

    return {
      videoUri,
      transcoded: false,
      cacheHit: true,
    };
  }

  if (isWebsiteVideoResolvableUri(videoUri)) {
    const cachedLocalPath = await getCachedWebsiteVideoLocalPath(videoUri);
    if (cachedLocalPath) {
      const resolved = await resolvePlayableVideoUri(toLocalMediaUri(cachedLocalPath));
      return {
        ...resolved,
        cacheHit: true,
      };
    }

    const pending = warmWebsiteVideoCache(videoUri);
    if (pending) {
      void pending.catch((error) => {
        console.warn("Website video cache warm failed", error);
      });
    }
    return {
      videoUri:
        videoUri.startsWith("http://") || videoUri.startsWith("https://")
          ? buildWebsiteVideoProxyUri(videoUri)
          : videoUri,
      transcoded: false,
      cacheHit: false,
    };
  }

  if (!isLocalPlayableVideoUri(videoUri)) {
    const resolvedExternal = resolveMediaUri(videoUri, "video");
    if (resolvedExternal !== videoUri) {
      return {
        videoUri: resolvedExternal,
        transcoded: false,
        cacheHit: true,
      };
    }

    return {
      videoUri,
      transcoded: false,
      cacheHit: false,
    };
  }

  const localPath = toLocalVideoPath(videoUri);
  if (!localPath) {
    throw new Error("Invalid local video URI.");
  }

  const sourceStat = await fs.stat(localPath);
  if (!sourceStat.isFile()) {
    throw new Error("Video source path does not point to a file.");
  }

  const normalizedPath = path.normalize(localPath);
  const sourceFingerprint = buildSourceFingerprint({
    normalizedPath,
    fileSizeBytes: sourceStat.size,
    modifiedMs: Math.floor(sourceStat.mtimeMs),
  });

  const cachedResolution = resolvedBySourceFingerprint.get(sourceFingerprint);
  if (cachedResolution) return cachedResolution;

  const sourceInFlight = inFlightBySourceFingerprint.get(sourceFingerprint);
  if (sourceInFlight) return sourceInFlight;

  const pending = (async () => {
    const binaries = await resolvePhashBinaries();
    const streamInfo = await probePrimaryVideoStream(binaries.ffprobePath, normalizedPath);
    if (isLikelyChromiumSupportedStream(streamInfo)) {
      const passthroughResult = {
        videoUri,
        transcoded: false,
        cacheHit: false,
      } satisfies ResolvePlayableVideoUriResult;
      resolvedBySourceFingerprint.set(sourceFingerprint, passthroughResult);
      return passthroughResult;
    }

    const cacheRootPath = await ensureCacheRootPath();
    const cacheKey = buildTranscodeCacheKey({
      normalizedPath,
      fileSizeBytes: sourceStat.size,
      modifiedMs: Math.floor(sourceStat.mtimeMs),
      ffmpegVersion: binaries.ffmpegVersion,
    });
    const outputPath = path.join(cacheRootPath, `${cacheKey}.mp4`);

    if (await isNonEmptyFile(outputPath)) {
      const cachedResult = {
        videoUri: toLocalMediaUri(outputPath),
        transcoded: true,
        cacheHit: true,
      } satisfies ResolvePlayableVideoUriResult;
      resolvedBySourceFingerprint.set(sourceFingerprint, cachedResult);
      return cachedResult;
    }

    if (await fileExists(outputPath)) {
      await fs.rm(outputPath, { force: true });
    }

    const existingInFlight = inFlightByCacheKey.get(cacheKey);
    if (existingInFlight) {
      const existingResult = await existingInFlight;
      resolvedBySourceFingerprint.set(sourceFingerprint, existingResult);
      return existingResult;
    }

    const transcodePromise = (async () => {
      await transcodeToPlayableMp4({
        ffmpegPath: binaries.ffmpegPath,
        sourcePath: normalizedPath,
        outputPath,
      });

      return {
        videoUri: toLocalMediaUri(outputPath),
        transcoded: true,
        cacheHit: false,
      } satisfies ResolvePlayableVideoUriResult;
    })();

    // Start the background transcode process so it can eventually use a cached file
    void transcodePromise.catch((error) => {
      console.warn("Background transcode failed", error);
    });

    // Return the live transcode URI immediately for instant playback
    const liveTranscodeUri = `${videoUri}${videoUri.includes("?") ? "&" : "?"}transcode=1`;
    const result = {
      videoUri: liveTranscodeUri,
      transcoded: true,
      cacheHit: false,
    } satisfies ResolvePlayableVideoUriResult;

    resolvedBySourceFingerprint.set(sourceFingerprint, result);
    return result;
  })();

  inFlightBySourceFingerprint.set(sourceFingerprint, pending);
  try {
    return await pending;
  } finally {
    inFlightBySourceFingerprint.delete(sourceFingerprint);
  }
}
