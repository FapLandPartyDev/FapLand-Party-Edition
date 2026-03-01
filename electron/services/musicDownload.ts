import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { app } from "electron";
import { runCommand } from "./phash/extract";
import { getStore } from "./store";
import { resolveYtDlpBinary } from "./webVideo/binaries";
import { resolvePhashBinaries } from "./phash/binaries";

const MUSIC_CACHE_ROOT_PATH_KEY = "music.cacheRootPath";
const MUSIC_CACHE_FOLDER = "music-cache";

type MusicDownloadResult = {
  filePath: string;
  title: string;
};

type MusicDownloadProgress = {
  url: string;
  percent: number;
  speedBytesPerSec: number | null;
  etaSeconds: number | null;
  totalBytes: number | null;
  downloadedBytes: number | null;
  startedAt: string;
};

const YT_DLP_PROGRESS_REGEX =
  /\[download\]\s+(\d+(?:\.\d+)?)%\s+of\s+(~?\d+(?:\.\d+)?[KkMmGgTt]?i?B)(?:\s+at\s+(\d+(?:\.\d+)?[KkMmGgTt]?i?B\/s))?(?:\s+ETA\s+(\d{2}:\d{2}(?::\d{2})?))?/;

const downloadProgressByUrl = new Map<string, MusicDownloadProgress>();

async function getBinaryEnv(): Promise<Record<string, string>> {
  const binaries = await resolvePhashBinaries();
  const paths = new Set<string>();

  if (binaries.ffmpegPath && binaries.ffmpegPath !== "ffmpeg") {
    paths.add(path.dirname(binaries.ffmpegPath));
  }
  if (binaries.ffprobePath && binaries.ffprobePath !== "ffprobe") {
    paths.add(path.dirname(binaries.ffprobePath));
  }

  if (paths.size === 0) {
    return {};
  }

  const existingPath = process.env.PATH ?? "";
  const separator = os.platform() === "win32" ? ";" : ":";
  const newPath = [...paths, existingPath].filter(Boolean).join(separator);

  return { PATH: newPath };
}

function parseFileSizeToBytes(raw: string): number | null {
  const match = /^~?(\d+(?:\.\d+)?)\s*([KkMmGgTt])?i?B$/i.exec(raw.trim());
  if (!match) return null;
  const value = parseFloat(match[1]!);
  const unit = (match[2] ?? "").toUpperCase();
  const multipliers: Record<string, number> = {
    "": 1,
    K: 1024,
    M: 1024 ** 2,
    G: 1024 ** 3,
    T: 1024 ** 4,
  };
  const multiplier = multipliers[unit] ?? 1;
  return value * multiplier;
}

function parseEtaToSeconds(raw: string): number | null {
  const parts = raw.split(":").map(Number);
  if (parts.some(isNaN)) return null;
  if (parts.length === 2) return parts[0]! * 60 + parts[1]!;
  if (parts.length === 3) return parts[0]! * 3600 + parts[1]! * 60 + parts[2]!;
  return null;
}

function parseYtDlpProgressLine(line: string, url: string): Partial<MusicDownloadProgress> | null {
  const match = YT_DLP_PROGRESS_REGEX.exec(line);
  if (!match) return null;
  const percent = parseFloat(match[1]!);
  const totalBytes = match[2] ? parseFileSizeToBytes(match[2]) : null;
  const speedBytesPerSec = match[3] ? parseFileSizeToBytes(match[3]) : null;
  const etaSeconds = match[4] ? parseEtaToSeconds(match[4]) : null;
  const downloadedBytes =
    totalBytes !== null && !isNaN(percent) ? (percent / 100) * totalBytes : null;
  return { url, percent, speedBytesPerSec, etaSeconds, totalBytes, downloadedBytes };
}

export function resolveMusicCacheRoot(): string {
  const configuredRoot = getStore().get(MUSIC_CACHE_ROOT_PATH_KEY) as string | undefined;
  if (configuredRoot) {
    return path.resolve(configuredRoot);
  }
  try {
    return path.join(app.getPath("userData"), MUSIC_CACHE_FOLDER);
  } catch {
    return path.join(os.tmpdir(), "f-land", MUSIC_CACHE_FOLDER);
  }
}

function buildCacheFilePath(url: string): { cacheKey: string; cacheDir: string; filePath: string } {
  const cacheKey = crypto.createHash("sha256").update(url).digest("hex");
  const cacheDir = path.join(resolveMusicCacheRoot(), cacheKey);
  return { cacheKey, cacheDir, filePath: path.join(cacheDir, "audio.mp3") };
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
async function _fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function isNonEmptyFile(filePath: string): Promise<boolean> {
  try {
    const stat = await fs.stat(filePath);
    return stat.isFile() && stat.size > 0;
  } catch {
    return false;
  }
}

type YtDlpMusicInfo = {
  title?: unknown;
  duration?: unknown;
};

type YtDlpPlaylistEntry = {
  url?: unknown;
  title?: unknown;
  id?: unknown;
};

type YtDlpPlaylistInfo = {
  title?: unknown;
  entries?: unknown;
  _type?: unknown;
};

async function inspectAudioInfo(url: string): Promise<YtDlpMusicInfo> {
  const binary = await resolveYtDlpBinary();
  const env = await getBinaryEnv();
  const { stdout } = await runCommand(
    binary.ytDlpPath,
    ["--dump-single-json", "--no-playlist", "--no-warnings", url],
    { env }
  );
  return JSON.parse(stdout.toString("utf8")) as YtDlpMusicInfo;
}

export function isPlaylistUrl(url: string): boolean {
  try {
    const parsed = new URL(url.trim());
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

async function extractPlaylistEntries(
  url: string
): Promise<{ playlistTitle: string; entries: { url: string; title: string }[] }> {
  const binary = await resolveYtDlpBinary();
  const env = await getBinaryEnv();
  const { stdout } = await runCommand(
    binary.ytDlpPath,
    ["--flat-playlist", "--dump-single-json", "--no-warnings", url],
    { env }
  );

  const info = JSON.parse(stdout.toString("utf8")) as YtDlpPlaylistInfo;
  const playlistTitle =
    typeof info.title === "string" && info.title.trim() ? info.title : "Unknown Playlist";

  const rawEntries = Array.isArray(info.entries) ? info.entries : [];
  const entries = rawEntries
    .map((entry) => {
      const typed = entry as YtDlpPlaylistEntry;
      const rawUrl = typeof typed.url === "string" ? typed.url.trim() : "";
      const title = typeof typed.title === "string" ? typed.title.trim() : "";
      if (!rawUrl) return null;
      const fullUrl = rawUrl.startsWith("http")
        ? rawUrl
        : `https://www.youtube.com/watch?v=${rawUrl}`;
      return { url: fullUrl, title: title || `Track ${rawEntries.indexOf(entry) + 1}` };
    })
    .filter((e): e is { url: string; title: string } => e !== null);

  return { playlistTitle, entries };
}

export function isYouTubeUrl(url: string): boolean {
  try {
    const parsed = new URL(url.trim());
    const hostname = parsed.hostname.toLowerCase();
    return (
      hostname === "youtube.com" ||
      hostname === "www.youtube.com" ||
      hostname === "m.youtube.com" ||
      hostname === "music.youtube.com" ||
      hostname === "youtu.be" ||
      hostname.endsWith(".youtube.com")
    );
  } catch {
    return false;
  }
}

export function isSupportedMusicUrl(url: string): boolean {
  try {
    const parsed = new URL(url.trim());
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

export function getMusicDownloadProgress(url: string): MusicDownloadProgress | null {
  return downloadProgressByUrl.get(url) ?? null;
}

export function getAllMusicDownloadProgresses(): MusicDownloadProgress[] {
  return [...downloadProgressByUrl.values()];
}

export async function downloadMusicFromUrl(url: string): Promise<MusicDownloadResult> {
  const trimmedUrl = url.trim();
  if (!trimmedUrl) {
    throw new Error("URL is required.");
  }

  try {
    new URL(trimmedUrl);
  } catch {
    throw new Error("Invalid URL format.");
  }

  const paths = buildCacheFilePath(trimmedUrl);

  if (await isNonEmptyFile(paths.filePath)) {
    const info = await inspectAudioInfo(trimmedUrl);
    return {
      filePath: paths.filePath,
      title: (typeof info.title === "string" && info.title.trim()) || "Unknown Track",
    };
  }

  await fs.mkdir(paths.cacheDir, { recursive: true });

  downloadProgressByUrl.set(trimmedUrl, {
    url: trimmedUrl,
    percent: 0,
    speedBytesPerSec: null,
    etaSeconds: null,
    totalBytes: null,
    downloadedBytes: null,
    startedAt: new Date().toISOString(),
  });

  console.info(`[music] Download started: ${trimmedUrl}`);

  const binary = await resolveYtDlpBinary();
  const env = await getBinaryEnv();
  const outputTemplate = path.join(paths.cacheDir, "audio.%(ext)s");

  try {
    await runCommand(
      binary.ytDlpPath,
      [
        "-x",
        "--audio-format",
        "mp3",
        "--audio-quality",
        "5",
        "--no-playlist",
        "--no-warnings",
        "--newline",
        "--output",
        outputTemplate,
        trimmedUrl,
      ],
      {
        env,
        onLine: (line) => {
          const parsed = parseYtDlpProgressLine(line, trimmedUrl);
          if (!parsed) return;
          const existing = downloadProgressByUrl.get(trimmedUrl);
          if (existing) {
            downloadProgressByUrl.set(trimmedUrl, {
              ...existing,
              ...parsed,
            } as MusicDownloadProgress);
          }
        },
      }
    );
  } catch (error) {
    try {
      const fallbackFile = await fallbackDownloadAudioViaMedia(trimmedUrl, paths.cacheDir);
      downloadProgressByUrl.delete(trimmedUrl);
      const info = await inspectAudioInfo(trimmedUrl);
      return {
        filePath: fallbackFile,
        title: (typeof info.title === "string" && info.title.trim()) || "Unknown Track",
      };
    } catch (fallbackError) {
      downloadProgressByUrl.delete(trimmedUrl);
      const message =
        fallbackError instanceof Error
          ? fallbackError.message
          : error instanceof Error
            ? error.message
            : "yt-dlp download failed.";
      throw new Error(`Failed to download audio: ${message}`);
    }
  }

  downloadProgressByUrl.delete(trimmedUrl);

  const downloadedFile = await findDownloadedAudio(paths.cacheDir);
  if (!downloadedFile || !(await isNonEmptyFile(downloadedFile))) {
    throw new Error("Download completed but no audio file was found.");
  }

  const info = await inspectAudioInfo(trimmedUrl);
  const title = (typeof info.title === "string" && info.title.trim()) || "Unknown Track";

  console.info(`[music] Download finished: ${trimmedUrl} -> ${downloadedFile}`);

  return { filePath: downloadedFile, title };
}

async function findDownloadedAudio(cacheDir: string): Promise<string | null> {
  try {
    const entries = await fs.readdir(cacheDir);
    const audioFiles = entries.filter((entry) => {
      const ext = path.extname(entry).toLowerCase();
      return (
        ext === ".mp3" || ext === ".m4a" || ext === ".ogg" || ext === ".wav" || ext === ".flac"
      );
    });
    if (audioFiles.length === 0) return null;
    return path.join(cacheDir, audioFiles[0]!);
  } catch {
    return null;
  }
}

async function findDownloadedMedia(cacheDir: string): Promise<string | null> {
  try {
    const entries = await fs.readdir(cacheDir);
    const mediaFiles = entries.filter((entry) => {
      const ext = path.extname(entry).toLowerCase();
      return ext.length > 0 && ![".part", ".tmp", ".temp", ".ytdl"].includes(ext);
    });
    if (mediaFiles.length === 0) return null;
    return path.join(cacheDir, mediaFiles[0]!);
  } catch {
    return null;
  }
}

async function extractAudioFromDownloadedMedia(inputPath: string, outputPath: string): Promise<void> {
  const binaries = await resolvePhashBinaries();
  await runCommand(
    binaries.ffmpegPath,
    [
      "-hide_banner",
      "-loglevel",
      "error",
      "-nostdin",
      "-y",
      "-i",
      inputPath,
      "-vn",
      "-acodec",
      "libmp3lame",
      "-q:a",
      "5",
      outputPath,
    ],
    { timeoutMs: 600_000 }
  );
}

async function fallbackDownloadAudioViaMedia(url: string, cacheDir: string): Promise<string> {
  const binary = await resolveYtDlpBinary();
  const env = await getBinaryEnv();
  const outputTemplate = path.join(cacheDir, "source.%(ext)s");

  await runCommand(
    binary.ytDlpPath,
    [
      "-f",
      "bestaudio/best",
      "--no-playlist",
      "--no-warnings",
      "--newline",
      "--output",
      outputTemplate,
      url,
    ],
    { env, timeoutMs: 600_000 }
  );

  const downloadedMedia = await findDownloadedMedia(cacheDir);
  if (!downloadedMedia || !(await isNonEmptyFile(downloadedMedia))) {
    throw new Error("Fallback media download completed but no media file was found.");
  }

  const outputPath = path.join(cacheDir, "audio.mp3");
  await extractAudioFromDownloadedMedia(downloadedMedia, outputPath);
  if (!(await isNonEmptyFile(outputPath))) {
    throw new Error("Fallback ffmpeg extraction produced an empty audio file.");
  }
  return outputPath;
}

export function __resetMusicDownloadProgressForTests(): void {
  downloadProgressByUrl.clear();
}

export async function clearMusicCache(): Promise<void> {
  __resetMusicDownloadProgressForTests();
  await fs.rm(resolveMusicCacheRoot(), { recursive: true, force: true });
}

export type PlaylistDownloadResult = {
  playlistTitle: string;
  totalTracks: number;
  tracks: MusicDownloadResult[];
  errors: { url: string; error: string }[];
};

export async function downloadPlaylistFromUrl(url: string): Promise<PlaylistDownloadResult> {
  const trimmedUrl = url.trim();
  if (!trimmedUrl) {
    throw new Error("URL is required.");
  }

  try {
    new URL(trimmedUrl);
  } catch {
    throw new Error("Invalid URL format.");
  }

  if (!isPlaylistUrl(trimmedUrl)) {
    throw new Error(
      "URL does not appear to be a playlist. Use a YouTube playlist or SoundCloud set URL."
    );
  }

  console.info(`[music] Extracting playlist: ${trimmedUrl}`);
  const { playlistTitle, entries } = await extractPlaylistEntries(trimmedUrl);

  if (entries.length === 0) {
    throw new Error("Playlist is empty or could not be parsed.");
  }

  console.info(`[music] Found ${entries.length} tracks in playlist "${playlistTitle}"`);

  const tracks: MusicDownloadResult[] = [];
  const errors: { url: string; error: string }[] = [];

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i]!;
    try {
      console.info(`[music] Downloading track ${i + 1}/${entries.length}: ${entry.title}`);
      const result = await downloadMusicFromUrl(entry.url);
      tracks.push(result);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      errors.push({ url: entry.url, error: message });
      console.warn(`[music] Failed to download track ${i + 1}: ${entry.title} - ${message}`);
    }
  }

  console.info(
    `[music] Playlist download complete: ${tracks.length}/${entries.length} tracks succeeded`
  );

  return { playlistTitle, totalTracks: entries.length, tracks, errors };
}
