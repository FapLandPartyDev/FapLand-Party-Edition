import crypto from "node:crypto";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { app } from "electron";
import {
  getVideoContentTypeByExtension,
  isLikelyVideoUrl,
} from "../../../src/constants/videoFormats";
import { WEBSITE_VIDEO_CACHE_ROOT_PATH_KEY } from "../../../src/constants/websiteVideoCacheSettings";
import { runCommand } from "../phash/extract";
import { getStore } from "../store";
import type {
  VideoDownloadProgress,
  WebsiteVideoCacheMetadata,
  WebsiteVideoCacheState,
  WebsiteVideoStreamResolution,
} from "./types";
import { resolveYtDlpBinary } from "./binaries";

const WEBSITE_VIDEO_PROXY_PREFIX = "app://external/web-url?";
const WEBSITE_VIDEO_CACHE_FOLDER = "web-video-cache";
const DOWNLOADED_VIDEO_BASENAME = "video";
const DOWNLOAD_SENTINEL_FILE = "meta.json";
const DOWNLOAD_IN_PROGRESS_FILE = "download-in-progress.json";
const DIRECT_MEDIA_EXTENSIONS = new Set([
  ".mp4",
  ".m4v",
  ".mov",
  ".webm",
  ".ogv",
  ".ogg",
  ".avi",
  ".mkv",
]);
const PREFERRED_BROWSER_STREAM_EXTENSIONS = new Map([
  ["mp4", 0],
  ["m4v", 1],
  ["webm", 2],
  ["mov", 3],
  ["ogv", 4],
  ["ogg", 5],
]);
const inFlightCacheByUrl = new Map<string, Promise<WebsiteVideoCacheMetadata>>();
const cacheRemovalRequestsByUrl = new Set<string>();
const downloadProgressByUrl = new Map<string, VideoDownloadProgress>();

type YtDlpInfoJson = {
  url?: unknown;
  extractor?: unknown;
  extractor_key?: unknown;
  title?: unknown;
  duration?: unknown;
  http_headers?: unknown;
  requested_downloads?: unknown;
  requested_formats?: unknown;
  formats?: unknown;
};

type YtDlpFormatEntry = {
  url?: unknown;
  ext?: unknown;
  protocol?: unknown;
  acodec?: unknown;
  vcodec?: unknown;
  height?: unknown;
  tbr?: unknown;
  http_headers?: unknown;
};

type WebsiteVideoCachePaths = {
  normalizedUrl: string;
  cacheKey: string;
  cacheDir: string;
  metadataPath: string;
  inProgressPath: string;
};

type HtmlMediaCandidate = {
  url: string;
  contentType: string | null;
};

function normalizeHttpUrl(input: string): string {
  let parsed: URL;
  try {
    parsed = new URL(input.trim());
  } catch {
    throw new Error("Website video URL must be a valid http(s) URL.");
  }

  if (!(parsed.protocol === "http:" || parsed.protocol === "https:")) {
    throw new Error("Website video URL must use http or https.");
  }

  parsed.hash = "";
  return parsed.toString();
}

function normalizeNullableString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeConfiguredCacheRoot(value: unknown): string | null {
  const normalized = normalizeNullableString(value);
  return normalized ? path.resolve(normalized) : null;
}

function toDurationMs(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return null;
  return Math.floor(value * 1000);
}

const YT_DLP_PROGRESS_REGEX =
  /\[download\]\s+(\d+(?:\.\d+)?)%\s+of\s+(~?\d+(?:\.\d+)?[KkMmGgTt]?i?B)(?:\s+at\s+(\d+(?:\.\d+)?[KkMmGgTt]?i?B\/s))?(?:\s+ETA\s+(\d{2}:\d{2}(?::\d{2})?))?/;

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

function parseYtDlpProgressLine(line: string, url: string): Partial<VideoDownloadProgress> | null {
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

function buildCachePaths(url: string): WebsiteVideoCachePaths {
  const normalizedUrl = normalizeHttpUrl(url);
  const cacheKey = crypto.createHash("sha256").update(normalizedUrl).digest("hex");
  const cacheDir = path.join(resolveWebsiteVideoCacheRoot(), cacheKey);
  return {
    normalizedUrl,
    cacheKey,
    cacheDir,
    metadataPath: path.join(cacheDir, DOWNLOAD_SENTINEL_FILE),
    inProgressPath: path.join(cacheDir, DOWNLOAD_IN_PROGRESS_FILE),
  };
}

function resolveWebsiteVideoCacheRoot(): string {
  const configuredRoot = normalizeConfiguredCacheRoot(
    getStore().get(WEBSITE_VIDEO_CACHE_ROOT_PATH_KEY)
  );
  if (configuredRoot) {
    return configuredRoot;
  }

  try {
    return path.join(app.getPath("userData"), WEBSITE_VIDEO_CACHE_FOLDER);
  } catch {
    return path.join(os.tmpdir(), "f-land", WEBSITE_VIDEO_CACHE_FOLDER);
  }
}

async function ensureDirectory(dirPath: string): Promise<void> {
  await fs.mkdir(dirPath, { recursive: true });
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
    const stat = await fs.stat(filePath);
    return stat.isFile() && stat.size > 0;
  } catch {
    return false;
  }
}

function getDirectMediaExtension(uri: string): string | null {
  try {
    const parsed = new URL(uri);
    const pathname = parsed.pathname.toLowerCase();
    const extension = path.posix.extname(pathname);
    return extension || null;
  } catch {
    return null;
  }
}

function decodeEscapedHtmlMediaUrl(raw: string): string | null {
  const normalized = raw
    .trim()
    .replace(/\\u002[Ff]/gu, "/")
    .replace(/\\\//gu, "/")
    .replace(/&amp;/gu, "&")
    .replace(/&#x2F;/giu, "/")
    .replace(/&#47;/gu, "/");

  try {
    return new URL(normalized).toString();
  } catch {
    return null;
  }
}

function extractHtmlMediaCandidates(html: string): HtmlMediaCandidate[] {
  const matches = html.match(/https?:\/\/[^"'\\<>\s]+/giu) ?? [];
  const deduped = new Map<string, HtmlMediaCandidate>();

  for (const match of matches) {
    const decoded = decodeEscapedHtmlMediaUrl(match);
    if (!decoded) continue;
    const extension = getDirectMediaExtension(decoded);
    const contentType = extension ? getVideoContentTypeByExtension(extension) : null;
    const isDirectMedia =
      extension !== null && DIRECT_MEDIA_EXTENSIONS.has(extension.toLowerCase());
    const isManifest =
      extension === ".m3u8" ||
      extension === ".mpd" ||
      decoded.includes(".m3u8") ||
      decoded.includes(".mpd");

    if (!isDirectMedia && !isManifest) continue;
    if (!deduped.has(decoded)) {
      deduped.set(decoded, { url: decoded, contentType });
    }
  }

  return [...deduped.values()].sort((a, b) => {
    const aDirect = isDirectRemoteMediaUri(a.url);
    const bDirect = isDirectRemoteMediaUri(b.url);
    if (aDirect !== bDirect) return aDirect ? -1 : 1;
    return a.url.length - b.url.length;
  });
}

async function resolveWebsiteVideoFromHtml(url: string): Promise<WebsiteVideoStreamResolution | null> {
  const normalizedUrl = normalizeHttpUrl(url);
  const response = await fetch(normalizedUrl, {
    headers: {
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "User-Agent":
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36",
    },
  });
  if (!response.ok) {
    throw new Error(`Website HTML fetch failed: ${response.status} ${response.statusText}`);
  }

  const html = await response.text();
  const candidate = extractHtmlMediaCandidates(html)[0];
  if (!candidate) {
    return null;
  }

  return {
    streamUrl: candidate.url,
    headers: { Referer: normalizedUrl },
    extractor: "html_fallback",
    title: null,
    durationMs: null,
    contentType: candidate.contentType,
    playbackStrategy: isDirectRemoteMediaUri(candidate.url) ? "remote" : "ytdlp",
  };
}

export function isWebsiteVideoProxyUri(uri: string): boolean {
  return uri.startsWith(WEBSITE_VIDEO_PROXY_PREFIX);
}

export function isStashProxyUri(uri: string): boolean {
  return uri.startsWith("app://external/stash?");
}

export function buildWebsiteVideoProxyUri(targetUrl: string): string {
  const normalizedUrl = normalizeHttpUrl(targetUrl);
  const params = new URLSearchParams({ target: normalizedUrl });
  return `app://external/web-url?${params.toString()}`;
}

export function parseWebsiteVideoProxyUri(uri: string): { targetUrl: string } | null {
  try {
    const parsed = new URL(uri);
    if (parsed.protocol !== "app:" || parsed.hostname !== "external") return null;
    if (parsed.pathname.replace(/^\/+/, "") !== "web-url") return null;
    const targetUrl = normalizeNullableString(parsed.searchParams.get("target"));
    if (!targetUrl) return null;
    return { targetUrl: normalizeHttpUrl(targetUrl) };
  } catch {
    return null;
  }
}

export function parseStashProxyUri(uri: string): { targetUrl: string } | null {
  try {
    const parsed = new URL(uri);
    if (parsed.protocol !== "app:" || parsed.hostname !== "external") return null;
    if (parsed.pathname.replace(/^\/+/, "") !== "stash") return null;
    const targetUrl = normalizeNullableString(parsed.searchParams.get("target"));
    if (!targetUrl) return null;
    return { targetUrl: normalizeHttpUrl(targetUrl) };
  } catch {
    return null;
  }
}

export function isDirectRemoteMediaUri(uri: string): boolean {
  if (!isLikelyVideoUrl(uri)) return false;
  const extension = getDirectMediaExtension(uri);
  return extension !== null && DIRECT_MEDIA_EXTENSIONS.has(extension);
}

export function isWebsiteVideoCandidateUri(uri: string): boolean {
  try {
    const normalized = normalizeHttpUrl(uri);
    return !isDirectRemoteMediaUri(normalized);
  } catch {
    return false;
  }
}

export function isWebsiteVideoResolvableUri(uri: string): boolean {
  return isWebsiteVideoProxyUri(uri) || isStashProxyUri(uri) || isWebsiteVideoCandidateUri(uri);
}

export function getWebsiteVideoTargetUrl(uri: string): string | null {
  if (isWebsiteVideoProxyUri(uri)) {
    return parseWebsiteVideoProxyUri(uri)?.targetUrl ?? null;
  }
  if (isStashProxyUri(uri)) {
    return parseStashProxyUri(uri)?.targetUrl ?? null;
  }
  if (isWebsiteVideoCandidateUri(uri)) {
    return normalizeHttpUrl(uri);
  }
  return null;
}

async function readMetadataByPath(metadataPath: string): Promise<WebsiteVideoCacheMetadata | null> {
  try {
    const raw = await fs.readFile(metadataPath, "utf8");
    const parsed = JSON.parse(raw) as WebsiteVideoCacheMetadata;
    if (!parsed || typeof parsed !== "object") return null;
    if (typeof parsed.finalFilePath !== "string" || parsed.finalFilePath.trim().length === 0)
      return null;
    return parsed;
  } catch {
    return null;
  }
}

async function writeMetadata(
  paths: WebsiteVideoCachePaths,
  metadata: WebsiteVideoCacheMetadata
): Promise<void> {
  await ensureDirectory(paths.cacheDir);
  await fs.writeFile(paths.metadataPath, `${JSON.stringify(metadata, null, 2)}\n`, "utf8");
}

async function writeInProgressMarker(paths: WebsiteVideoCachePaths): Promise<void> {
  await ensureDirectory(paths.cacheDir);
  await fs.writeFile(
    paths.inProgressPath,
    `${JSON.stringify({ startedAt: new Date().toISOString(), url: paths.normalizedUrl }, null, 2)}\n`,
    "utf8"
  );
}

async function removeInProgressMarker(paths: WebsiteVideoCachePaths): Promise<void> {
  await fs.rm(paths.inProgressPath, { force: true });
}

async function touchMetadata(
  paths: WebsiteVideoCachePaths,
  metadata: WebsiteVideoCacheMetadata
): Promise<WebsiteVideoCacheMetadata> {
  const next: WebsiteVideoCacheMetadata = {
    ...metadata,
    lastAccessedAt: new Date().toISOString(),
  };
  await writeMetadata(paths, next);
  return next;
}

async function findDownloadedVideoPath(cacheDir: string): Promise<string | null> {
  let entries: string[];
  try {
    entries = await fs.readdir(cacheDir);
  } catch {
    return null;
  }

  const candidates = entries
    .filter((entry) => entry.startsWith(`${DOWNLOADED_VIDEO_BASENAME}.`))
    .filter(
      (entry) => !entry.endsWith(".part") && !entry.endsWith(".tmp") && !entry.endsWith(".ytdl")
    )
    .map((entry) => path.join(cacheDir, entry));

  for (const candidate of candidates.sort((a, b) => a.localeCompare(b))) {
    if (await fileExists(candidate)) {
      return candidate;
    }
  }

  return null;
}

async function removeDownloadedVideoArtifacts(cacheDir: string): Promise<void> {
  let entries: string[];
  try {
    entries = await fs.readdir(cacheDir);
  } catch {
    return;
  }

  await Promise.all(
    entries
      .filter((entry) => entry.startsWith(`${DOWNLOADED_VIDEO_BASENAME}.`))
      .map((entry) => fs.rm(path.join(cacheDir, entry), { force: true }))
  );
}

async function resetIncompleteCache(paths: WebsiteVideoCachePaths): Promise<void> {
  await Promise.all([
    fs.rm(paths.metadataPath, { force: true }),
    removeInProgressMarker(paths),
    removeDownloadedVideoArtifacts(paths.cacheDir),
  ]);
}

async function throwIfCacheRemovalRequested(paths: WebsiteVideoCachePaths): Promise<void> {
  if (!cacheRemovalRequestsByUrl.has(paths.normalizedUrl)) {
    return;
  }

  await resetIncompleteCache(paths);
  throw new Error("Website video cache was removed before caching completed.");
}

function extractStreamUrl(value: unknown): string | null {
  if (typeof value === "string" && value.trim().length > 0) {
    return value.trim();
  }

  if (Array.isArray(value)) {
    for (const entry of value) {
      if (!entry || typeof entry !== "object") continue;
      const nested = extractStreamUrl((entry as Record<string, unknown>).url);
      if (nested) return nested;
    }
  }

  return null;
}

function toYtDlpFormatEntries(value: unknown): YtDlpFormatEntry[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry) => entry && typeof entry === "object") as YtDlpFormatEntry[];
}

function normalizeNullableLowerString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim().toLowerCase();
  return trimmed.length > 0 ? trimmed : null;
}

function toFiniteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function isDirectBrowserPlayableProtocol(protocol: string | null): boolean {
  if (!protocol) return true;
  return !protocol.includes("m3u8") && !protocol.includes("dash");
}

function getBrowserPlayableStreamCandidate(info: YtDlpInfoJson): {
  url: string;
  headers: Record<string, string>;
  contentType: string | null;
} | null {
  const candidates = [
    ...toYtDlpFormatEntries(info.requested_downloads),
    ...toYtDlpFormatEntries(info.requested_formats),
    ...toYtDlpFormatEntries(info.formats),
  ];

  const ranked = candidates
    .map((entry) => {
      const url = extractStreamUrl(entry.url);
      const ext = normalizeNullableLowerString(entry.ext);
      const protocol = normalizeNullableLowerString(entry.protocol);
      const acodec = normalizeNullableLowerString(entry.acodec);
      const vcodec = normalizeNullableLowerString(entry.vcodec);
      if (!url || !ext) return null;
      if (!PREFERRED_BROWSER_STREAM_EXTENSIONS.has(ext)) return null;
      if (!isDirectBrowserPlayableProtocol(protocol)) return null;
      if (vcodec === "none") return null;
      return {
        url,
        headers: normalizeHeaders(entry.http_headers),
        contentType: getVideoContentTypeByExtension(`.${ext}`) ?? null,
        extensionRank: PREFERRED_BROWSER_STREAM_EXTENSIONS.get(ext) ?? 99,
        hasAudio: acodec !== "none",
        height: toFiniteNumber(entry.height) ?? 0,
        bitrate: toFiniteNumber(entry.tbr) ?? 0,
      };
    })
    .filter((entry): entry is NonNullable<typeof entry> => entry !== null)
    .sort((a, b) => {
      if (a.extensionRank !== b.extensionRank) return a.extensionRank - b.extensionRank;
      if (a.hasAudio !== b.hasAudio) return a.hasAudio ? -1 : 1;
      if (a.height !== b.height) return b.height - a.height;
      return b.bitrate - a.bitrate;
    });

  if (ranked.length === 0) return null;
  return {
    url: ranked[0]!.url,
    headers: ranked[0]!.headers,
    contentType: ranked[0]!.contentType,
  };
}

function normalizeHeaders(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object") return {};
  const output: Record<string, string> = {};
  for (const [key, rawValue] of Object.entries(value as Record<string, unknown>)) {
    if (typeof rawValue !== "string") continue;
    const normalizedKey = key.trim();
    const normalizedValue = rawValue.trim();
    if (!normalizedKey || !normalizedValue) continue;
    output[normalizedKey] = normalizedValue;
  }
  return output;
}

function parseYtDlpInfo(output: string): YtDlpInfoJson {
  return JSON.parse(output) as YtDlpInfoJson;
}

function extractFallbackStreamUrl(info: YtDlpInfoJson): string | null {
  return (
    extractStreamUrl(info.url) ??
    extractStreamUrl(info.requested_downloads) ??
    extractStreamUrl(info.requested_formats) ??
    extractStreamUrl(info.formats)
  );
}

function extractStreamMetadata(
  info: YtDlpInfoJson
): Omit<WebsiteVideoStreamResolution, "streamUrl"> {
  return {
    headers: normalizeHeaders(info.http_headers),
    extractor:
      normalizeNullableString(info.extractor_key) ?? normalizeNullableString(info.extractor),
    title: normalizeNullableString(info.title),
    durationMs: toDurationMs(info.duration),
    contentType: null,
    playbackStrategy: "ytdlp",
  };
}

function parseYtDlpResolvedUrl(output: string): string | null {
  const lines = output
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  return lines[0] ?? null;
}

async function inspectWebsiteVideoInfo(url: string): Promise<YtDlpInfoJson> {
  const normalizedUrl = normalizeHttpUrl(url);
  const binary = await resolveYtDlpBinary();
  const { stdout } = await runCommand(binary.ytDlpPath, [
    "--dump-single-json",
    "--no-playlist",
    "--no-warnings",
    normalizedUrl,
  ]);
  return parseYtDlpInfo(stdout.toString("utf8"));
}

async function resolveWebsiteVideoDirectUrl(url: string): Promise<string | null> {
  const normalizedUrl = normalizeHttpUrl(url);
  const binary = await resolveYtDlpBinary();
  const { stdout } = await runCommand(binary.ytDlpPath, [
    "--get-url",
    "--no-playlist",
    "--no-warnings",
    normalizedUrl,
  ]);
  return parseYtDlpResolvedUrl(stdout.toString("utf8"));
}

async function inspectWebsiteVideo(url: string): Promise<WebsiteVideoStreamResolution> {
  try {
    const [info, resolvedUrl] = await Promise.all([
      inspectWebsiteVideoInfo(url),
      resolveWebsiteVideoDirectUrl(url).catch(() => null),
    ]);
    const browserPlayableCandidate = getBrowserPlayableStreamCandidate(info);
    const directUrl =
      browserPlayableCandidate?.url ?? resolvedUrl ?? extractFallbackStreamUrl(info);
    if (!directUrl) {
      throw new Error("yt-dlp did not return a playable stream URL.");
    }
    const baseMetadata = extractStreamMetadata(info);
    const directUrlExtension = getDirectMediaExtension(directUrl);
    const directUrlContentType = directUrlExtension
      ? getVideoContentTypeByExtension(directUrlExtension)
      : null;
    const playbackStrategy =
      browserPlayableCandidate || isDirectRemoteMediaUri(directUrl) ? "remote" : "ytdlp";
    return {
      streamUrl: directUrl,
      ...baseMetadata,
      headers:
        browserPlayableCandidate?.url === directUrl &&
          Object.keys(browserPlayableCandidate.headers).length > 0
          ? browserPlayableCandidate.headers
          : baseMetadata.headers,
      contentType: browserPlayableCandidate?.contentType ?? directUrlContentType,
      playbackStrategy,
    };
  } catch { }

  const htmlFallback = await resolveWebsiteVideoFromHtml(url).catch(() => null);
  if (htmlFallback) {
    return htmlFallback;
  }

  throw new Error(
    "yt-dlp could not resolve a playable stream URL from this website. Public website URLs are supported in v1; cookies and login are not."
  );
}

async function downloadWebsiteVideo(
  paths: WebsiteVideoCachePaths
): Promise<WebsiteVideoCacheMetadata> {
  await throwIfCacheRemovalRequested(paths);
  await ensureDirectory(paths.cacheDir);
  const existingMetadata = await readMetadataByPath(paths.metadataPath);
  if (existingMetadata && (await isNonEmptyFile(existingMetadata.finalFilePath))) {
    await removeInProgressMarker(paths);
    return touchMetadata(paths, existingMetadata);
  }

  await resetIncompleteCache(paths);
  await writeInProgressMarker(paths);


  downloadProgressByUrl.set(paths.normalizedUrl, {
    url: paths.normalizedUrl,
    percent: 0,
    speedBytesPerSec: null,
    etaSeconds: null,
    totalBytes: null,
    downloadedBytes: null,
    startedAt: new Date().toISOString(),
  });

  console.info(`[webVideo] Cache started: ${paths.normalizedUrl}`);

  const binary = await resolveYtDlpBinary();
  const inspected = await inspectWebsiteVideo(paths.normalizedUrl);
  const outputTemplate = path.join(paths.cacheDir, `${DOWNLOADED_VIDEO_BASENAME}.%(ext)s`);

  try {
    await runCommand(
      binary.ytDlpPath,
      [
        "-f",
        "(bestvideo[vcodec~='^(av01|vp9)'][dynamic_range=?SDR]+bestaudio[acodec~='^(opus|vorbis)'])/(bestvideo[vcodec~='^avc'][dynamic_range=?SDR]+bestaudio[acodec~='^mp4a'])/best",
        "--recode-video",
        "webm>webm/mp4>mp4/mp4",
        "--postprocessor-args",
        "video:-pix_fmt yuv420p",
        "--no-playlist",
        "--no-warnings",
        "--newline",
        "--output",
        outputTemplate,
        paths.normalizedUrl,
      ],
      {
        onLine: (line) => {
          const parsed = parseYtDlpProgressLine(line, paths.normalizedUrl);
          if (!parsed) return;
          const existing = downloadProgressByUrl.get(paths.normalizedUrl);
          if (existing) {
            downloadProgressByUrl.set(paths.normalizedUrl, {
              ...existing,
              ...parsed,
            } as VideoDownloadProgress);
          }
        },
      }
    );
  } catch (error) {
    downloadProgressByUrl.delete(paths.normalizedUrl);
    await resetIncompleteCache(paths);
    const message = error instanceof Error ? error.message : "yt-dlp download failed.";
    throw new Error(
      `${message} Public website URLs are supported in v1; cookies and login are not.`
    );
  }

  downloadProgressByUrl.delete(paths.normalizedUrl);

  await throwIfCacheRemovalRequested(paths);
  const finalFilePath = await findDownloadedVideoPath(paths.cacheDir);
  if (!finalFilePath || !(await isNonEmptyFile(finalFilePath))) {
    await resetIncompleteCache(paths);
    throw new Error("yt-dlp finished without producing a cached media file.");
  }

  const now = new Date().toISOString();
  const metadata: WebsiteVideoCacheMetadata = {
    originalUrl: paths.normalizedUrl,
    extractor: inspected.extractor,
    title: inspected.title,
    durationMs: inspected.durationMs,
    finalFilePath,
    fileExtension: path.extname(finalFilePath).replace(/^\./, "") || null,
    ytDlpVersion: binary.version,
    createdAt: existingMetadata?.createdAt ?? now,
    lastAccessedAt: now,
  };

  await writeMetadata(paths, metadata);
  await removeInProgressMarker(paths);

  console.info(`[webVideo] Cache finished: ${paths.normalizedUrl}`);

  return metadata;
}

export function __resetWebsiteVideoCachesForTests(): void {
  inFlightCacheByUrl.clear();
  cacheRemovalRequestsByUrl.clear();
  downloadProgressByUrl.clear();
}

export async function clearWebsiteVideoCache(): Promise<void> {
  __resetWebsiteVideoCachesForTests();
  await fs.rm(resolveWebsiteVideoCacheRoot(), { recursive: true, force: true });
}

export function buildWebsiteVideoCacheKey(url: string): string {
  return buildCachePaths(url).cacheKey;
}

export function getWebsiteVideoDownloadProgress(urlOrUri: string): VideoDownloadProgress | null {
  const targetUrl = getWebsiteVideoTargetUrl(urlOrUri);
  if (!targetUrl) return null;
  return downloadProgressByUrl.get(targetUrl) ?? null;
}

export function getAllWebsiteVideoDownloadProgresses(): VideoDownloadProgress[] {
  return [...downloadProgressByUrl.values()];
}

export async function getCachedWebsiteVideoMetadata(
  urlOrUri: string
): Promise<WebsiteVideoCacheMetadata | null> {
  const targetUrl = getWebsiteVideoTargetUrl(urlOrUri);
  if (!targetUrl) return null;

  const paths = buildCachePaths(targetUrl);
  const metadata = await readMetadataByPath(paths.metadataPath);
  const hasInProgressMarker = await fileExists(paths.inProgressPath);
  if (!metadata) {
    if (hasInProgressMarker) {
      await resetIncompleteCache(paths);
    }
    return null;
  }
  if (!(await isNonEmptyFile(metadata.finalFilePath))) {
    await resetIncompleteCache(paths);
    return null;
  }
  if (hasInProgressMarker) {
    await removeInProgressMarker(paths);
  }
  return touchMetadata(paths, metadata);
}

export async function getCachedWebsiteVideoLocalPath(urlOrUri: string): Promise<string | null> {
  return (await getCachedWebsiteVideoMetadata(urlOrUri))?.finalFilePath ?? null;
}

export async function getWebsiteVideoCacheState(urlOrUri: string): Promise<WebsiteVideoCacheState> {
  if (isStashProxyUri(urlOrUri) || (urlOrUri.includes("/scene/") && urlOrUri.includes("/stream"))) {
    return "cached";
  }

  const targetUrl = getWebsiteVideoTargetUrl(urlOrUri);
  if (!targetUrl) {
    return "not_applicable";
  }
  return (await getCachedWebsiteVideoMetadata(targetUrl)) ? "cached" : "pending";
}

export async function ensureWebsiteVideoCached(
  urlOrUri: string
): Promise<WebsiteVideoCacheMetadata> {
  if (isStashProxyUri(urlOrUri) || (urlOrUri.includes("/scene/") && urlOrUri.includes("/stream"))) {
    return {
      url: urlOrUri,
      normalizedUrl: urlOrUri,
      title: "Stash Stream",
      description: null,
      duration: null,
      thumbnail: null,
      cachedAt: new Date().toISOString(),
      format: "stash-stream",
    } as any;
  }

  const targetUrl = getWebsiteVideoTargetUrl(urlOrUri);
  if (!targetUrl) {
    throw new Error("Website video URL is invalid or not eligible for yt-dlp resolution.");
  }

  const existingMetadata = await getCachedWebsiteVideoMetadata(targetUrl);
  if (existingMetadata) {
    return existingMetadata;
  }

  const normalizedUrl = normalizeHttpUrl(targetUrl);
  cacheRemovalRequestsByUrl.delete(normalizedUrl);
  const existingInFlight = inFlightCacheByUrl.get(normalizedUrl);
  if (existingInFlight) {
    return existingInFlight;
  }

  const pending = downloadWebsiteVideo(buildCachePaths(normalizedUrl)).finally(() => {
    inFlightCacheByUrl.delete(normalizedUrl);
  });
  inFlightCacheByUrl.set(normalizedUrl, pending);
  return pending;
}

export function warmWebsiteVideoCache(urlOrUri: string): Promise<WebsiteVideoCacheMetadata> | null {
  const targetUrl = getWebsiteVideoTargetUrl(urlOrUri);
  if (!targetUrl) return null;
  return ensureWebsiteVideoCached(targetUrl);
}

export async function removeCachedWebsiteVideo(urlOrUri: string): Promise<void> {
  const targetUrl = getWebsiteVideoTargetUrl(urlOrUri);
  if (!targetUrl) {
    return;
  }

  const paths = buildCachePaths(targetUrl);
  cacheRemovalRequestsByUrl.add(paths.normalizedUrl);
  if (inFlightCacheByUrl.has(paths.normalizedUrl)) {
    await Promise.all([fs.rm(paths.metadataPath, { force: true }), removeInProgressMarker(paths)]);
    return;
  }
  await fs.rm(paths.cacheDir, { recursive: true, force: true });
}

export async function resolveWebsiteVideoStream(
  urlOrUri: string
): Promise<WebsiteVideoStreamResolution> {
  const targetUrl = getWebsiteVideoTargetUrl(urlOrUri);
  if (!targetUrl) {
    throw new Error("Website video URL is invalid or not eligible for yt-dlp resolution.");
  }
  return inspectWebsiteVideo(targetUrl);
}

const YT_DLP_PROGRESSIVE_STREAM_FORMAT =
  "best[protocol!*=m3u8][protocol!*=dash][ext=mp4]/best[protocol!*=m3u8][protocol!*=dash][ext=webm]/best[protocol!*=m3u8][protocol!*=dash]";

export async function createWebsiteVideoStreamResponse(
  urlOrUri: string,
  request: Request
): Promise<Response> {
  const targetUrl = getWebsiteVideoTargetUrl(urlOrUri);
  if (!targetUrl) {
    throw new Error("Website video URL is invalid or not eligible for yt-dlp resolution.");
  }

  const binary = await resolveYtDlpBinary();
  const inspected = await inspectWebsiteVideo(targetUrl);
  const contentType =
    inspected.contentType ??
    getVideoContentTypeByExtension(getDirectMediaExtension(inspected.streamUrl) ?? ".mp4") ??
    "video/mp4";

  if (request.method === "HEAD") {
    return new Response(null, {
      status: 200,
      headers: {
        "Content-Type": contentType,
      },
    });
  }

  return await new Promise<Response>((resolve, reject) => {
    const child = spawn(
      binary.ytDlpPath,
      [
        "--no-playlist",
        "--no-warnings",
        "--format",
        YT_DLP_PROGRESSIVE_STREAM_FORMAT,
        "--output",
        "-",
        targetUrl,
      ],
      {
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
      }
    );

    let stderr = "";
    let settled = false;

    const cleanup = () => {
      request.signal?.removeEventListener("abort", handleAbort);
    };

    const handleAbort = () => {
      child.kill("SIGTERM");
    };

    request.signal?.addEventListener("abort", handleAbort, { once: true });

    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });

    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    });

    child.stdout.once("readable", () => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(
        new Response(Readable.toWeb(child.stdout as unknown as Readable) as ReadableStream, {
          status: 200,
          headers: {
            "Content-Type": contentType,
          },
        })
      );
    });

    child.on("close", (code, signal) => {
      if (settled) return;
      settled = true;
      cleanup();
      const signalText = signal ? `, signal ${signal}` : "";
      reject(
        new Error(
          `yt-dlp stream failed with exit code ${code ?? "unknown"}${signalText}: ${stderr.trim()}`
        )
      );
    });
  });
}
