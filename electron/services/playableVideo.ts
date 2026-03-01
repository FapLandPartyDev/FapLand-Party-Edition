import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { app } from "electron";
import { resolvePhashBinaries } from "./phash/binaries";
import { runCommand } from "./phash/extract";

export type ResolvePlayableVideoUriResult = {
  videoUri: string;
  transcoded: boolean;
  cacheHit: boolean;
};

const CACHE_FOLDER_NAME = "video-playback-cache";
const SUPPORTED_CHROMIUM_VIDEO_CODECS = new Set([
  "av1",
  "avc1",
  "h264",
  "mpeg4",
  "theora",
  "vp8",
  "vp9",
]);
const resolvedBySourceFingerprint = new Map<string, ResolvePlayableVideoUriResult>();
const inFlightBySourceFingerprint = new Map<string, Promise<ResolvePlayableVideoUriResult>>();
const inFlightByCacheKey = new Map<string, Promise<ResolvePlayableVideoUriResult>>();

export function __resetPlayableVideoCachesForTests(): void {
  resolvedBySourceFingerprint.clear();
  inFlightBySourceFingerprint.clear();
  inFlightByCacheKey.clear();
}

function toAppMediaUri(filePath: string): string {
  return `app://media/${encodeURIComponent(path.resolve(filePath))}`;
}

export function isLocalPlayableVideoUri(videoUri: string): boolean {
  return videoUri.startsWith("app://media/") || videoUri.startsWith("file://");
}

export function toLocalVideoPath(videoUri: string): string | null {
  try {
    const parsed = new URL(videoUri);

    if (parsed.protocol === "app:" && parsed.hostname === "media") {
      const decoded = decodeURIComponent(parsed.pathname.slice(1));
      if (!decoded) return null;
      if (process.platform === "win32" && /^\/[A-Za-z]:/.test(decoded)) {
        return path.normalize(decoded.slice(1));
      }
      return path.normalize(decoded);
    }

    if (parsed.protocol === "file:") {
      return path.normalize(fileURLToPath(parsed));
    }

    return null;
  } catch {
    return null;
  }
}

function resolveCacheRootPath(): string {
  try {
    return path.join(app.getPath("userData"), CACHE_FOLDER_NAME);
  } catch {
    return path.join(os.tmpdir(), "f-land", CACHE_FOLDER_NAME);
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

function isLikelyChromiumSupportedCodec(codec: string | null): boolean {
  if (!codec) return false;
  const normalized = codec.trim().toLowerCase();
  if (!normalized) return false;
  if (SUPPORTED_CHROMIUM_VIDEO_CODECS.has(normalized)) return true;
  if (normalized.includes("h264") || normalized.includes("avc1")) return true;
  if (normalized.includes("av1")) return true;
  if (normalized.includes("vp8") || normalized.includes("vp9")) return true;
  return false;
}

async function probePrimaryVideoCodec(ffprobePath: string, sourcePath: string): Promise<string | null> {
  try {
    const { stdout } = await runCommand(ffprobePath, [
      "-v",
      "error",
      "-select_streams",
      "v:0",
      "-show_entries",
      "stream=codec_name",
      "-of",
      "json",
      sourcePath,
    ]);
    const payload = JSON.parse(stdout.toString("utf8")) as {
      streams?: Array<{ codec_name?: string | null }>;
    };
    const codecName = payload.streams?.[0]?.codec_name;
    return typeof codecName === "string" && codecName.trim().length > 0 ? codecName.trim().toLowerCase() : null;
  } catch {
    return null;
  }
}

async function transcodeToPlayableMp4(input: {
  ffmpegPath: string;
  sourcePath: string;
  outputPath: string;
}): Promise<void> {
  await fs.rm(input.outputPath, { force: true });

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
    input.outputPath,
  ]);
}

export async function resolvePlayableVideoUri(videoUri: string): Promise<ResolvePlayableVideoUriResult> {
  if (!isLocalPlayableVideoUri(videoUri)) {
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
    const codecName = await probePrimaryVideoCodec(binaries.ffprobePath, normalizedPath);
    if (isLikelyChromiumSupportedCodec(codecName)) {
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

    if (await fileExists(outputPath)) {
      const cachedResult = {
        videoUri: toAppMediaUri(outputPath),
        transcoded: true,
        cacheHit: true,
      } satisfies ResolvePlayableVideoUriResult;
      resolvedBySourceFingerprint.set(sourceFingerprint, cachedResult);
      return cachedResult;
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

      if (!(await fileExists(outputPath))) {
        throw new Error("Transcode did not produce an output file.");
      }

      return {
        videoUri: toAppMediaUri(outputPath),
        transcoded: true,
        cacheHit: false,
      } satisfies ResolvePlayableVideoUriResult;
    })();

    inFlightByCacheKey.set(cacheKey, transcodePromise);
    try {
      const result = await transcodePromise;
      resolvedBySourceFingerprint.set(sourceFingerprint, result);
      return result;
    } finally {
      inFlightByCacheKey.delete(cacheKey);
    }
  })();

  inFlightBySourceFingerprint.set(sourceFingerprint, pending);
  try {
    return await pending;
  } finally {
    inFlightBySourceFingerprint.delete(sourceFingerprint);
  }
}
