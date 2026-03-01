import crypto from "node:crypto";
import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import vm from "node:vm";
import { File as MegaFile } from "megajs";
import {
  getVideoContentTypeByExtension,
  isLikelyVideoUrl,
} from "../../../src/constants/videoFormats";
import { WEBSITE_VIDEO_CACHE_ROOT_PATH_KEY } from "../../../src/constants/websiteVideoCacheSettings";
import { runCommand } from "../phash/extract";
import { getStore } from "../store";
import { resolveConfiguredStoragePath, WEBSITE_VIDEO_CACHE_RELATIVE_PATH } from "../storagePaths";
import type {
  VideoDownloadProgress,
  WebsiteVideoCacheMetadata,
  WebsiteVideoCacheState,
  WebsiteVideoStreamResolution,
} from "./types";
import { resolveYtDlpBinary } from "./binaries";

const WEBSITE_VIDEO_PROXY_PREFIX = "app://external/web-url?";
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
const MULTI_FILE_WEBSITE_VIDEO_ERROR =
  "This hoster URL resolves to multiple files. Install rounds only support single-file downloads.";
const MEGA_EXTRACTOR_KEY = "mega";
const GOFILE_EXTRACTOR_KEY = "gofile";
const PIXELDRAIN_EXTRACTOR_KEY = "pixeldrain";

type YtDlpInfoJson = {
  url?: unknown;
  _type?: unknown;
  extractor?: unknown;
  extractor_key?: unknown;
  title?: unknown;
  duration?: unknown;
  entries?: unknown;
  playlist_count?: unknown;
  n_entries?: unknown;
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

type MegaSharedFile = {
  file: InstanceType<typeof MegaFile>;
  title: string | null;
  contentType: string | null;
  sizeBytes: number | null;
};

type DirectDownloadTarget = {
  downloadUrl: string;
  title: string | null;
  contentType: string | null;
  sizeBytes: number | null;
  extractor: string;
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

  if (!isMegaHost(parsed.hostname.toLowerCase())) {
    parsed.hash = "";
  }
  return parsed.toString();
}

function normalizeNullableString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
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

function isMegaHost(hostname: string): boolean {
  return hostname === "mega.nz" || hostname === "www.mega.nz" || hostname === "mega.co.nz";
}

function isGofileHost(hostname: string): boolean {
  return hostname === "gofile.io" || hostname === "www.gofile.io";
}

function isPixeldrainHost(hostname: string): boolean {
  return hostname === "pixeldrain.com" || hostname === "www.pixeldrain.com";
}

function isMegaSharedFileUrl(url: string): boolean {
  try {
    const parsed = new URL(normalizeHttpUrl(url));
    return isMegaHost(parsed.hostname.toLowerCase()) && parsed.pathname.startsWith("/file/");
  } catch {
    return false;
  }
}

function assertMegaSingleFileUrl(url: string): void {
  const parsed = new URL(normalizeHttpUrl(url));
  if (!isMegaHost(parsed.hostname.toLowerCase())) {
    throw new Error("MEGA URL is invalid or not supported.");
  }
  if (parsed.pathname.startsWith("/folder/")) {
    throw new Error(MULTI_FILE_WEBSITE_VIDEO_ERROR);
  }
  if (!parsed.pathname.startsWith("/file/")) {
    throw new Error("MEGA URLs must point to a shared file.");
  }
}

function getPixeldrainFileId(url: string): string | null {
  const parsed = new URL(normalizeHttpUrl(url));
  if (!isPixeldrainHost(parsed.hostname.toLowerCase())) return null;
  const match = /^\/u\/([^/]+)$/u.exec(parsed.pathname);
  return match?.[1] ?? null;
}

function assertPixeldrainSingleFileUrl(url: string): string {
  const parsed = new URL(normalizeHttpUrl(url));
  if (!isPixeldrainHost(parsed.hostname.toLowerCase())) {
    throw new Error("PixelDrain URL is invalid or not supported.");
  }
  if (parsed.pathname.startsWith("/l/")) {
    throw new Error(MULTI_FILE_WEBSITE_VIDEO_ERROR);
  }
  const fileId = getPixeldrainFileId(url);
  if (!fileId) {
    throw new Error("PixelDrain URLs must point to a shared file.");
  }
  return fileId;
}

function getGofileContentId(url: string): string | null {
  const parsed = new URL(normalizeHttpUrl(url));
  if (!isGofileHost(parsed.hostname.toLowerCase())) return null;
  const match = /^\/d\/([^/]+)$/u.exec(parsed.pathname);
  return match?.[1] ?? null;
}

function assertGofileSingleFileUrl(url: string): string {
  const parsed = new URL(normalizeHttpUrl(url));
  if (!isGofileHost(parsed.hostname.toLowerCase())) {
    throw new Error("Gofile URL is invalid or not supported.");
  }
  const contentId = getGofileContentId(url);
  if (!contentId) {
    throw new Error("Gofile URLs must point to a shared download page.");
  }
  return contentId;
}

export function resolveWebsiteVideoCacheRoot(): string {
  try {
    return resolveConfiguredStoragePath(
      getStore().get(WEBSITE_VIDEO_CACHE_ROOT_PATH_KEY),
      WEBSITE_VIDEO_CACHE_RELATIVE_PATH
    );
  } catch {
    return path.join(os.tmpdir(), "f-land", WEBSITE_VIDEO_CACHE_RELATIVE_PATH);
  }
}

async function ensureDirectory(dirPath: string): Promise<void> {
  await fs.mkdir(dirPath, { recursive: true });
}

function setInitialDownloadProgress(url: string): void {
  downloadProgressByUrl.set(url, {
    url,
    percent: 0,
    speedBytesPerSec: null,
    etaSeconds: null,
    totalBytes: null,
    downloadedBytes: null,
    startedAt: new Date().toISOString(),
  });
}

function updateDownloadedBytes(
  url: string,
  downloadedBytes: number,
  totalBytes: number | null
): void {
  const existing = downloadProgressByUrl.get(url);
  if (!existing) return;
  downloadProgressByUrl.set(url, {
    ...existing,
    downloadedBytes,
    totalBytes,
    percent: totalBytes && totalBytes > 0 ? (downloadedBytes / totalBytes) * 100 : existing.percent,
  });
}

async function downloadResponseBodyToFile(response: Response, filePath: string): Promise<void> {
  if (!response.body) {
    throw new Error("Remote hoster response did not include a body.");
  }
  await pipeline(
    Readable.fromWeb(response.body as globalThis.ReadableStream<Uint8Array>),
    createWriteStream(filePath)
  );
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

async function resolveWebsiteVideoFromHtml(
  url: string
): Promise<WebsiteVideoStreamResolution | null> {
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

async function inspectMegaSharedFile(url: string): Promise<MegaSharedFile> {
  const normalizedUrl = normalizeHttpUrl(url);
  assertMegaSingleFileUrl(normalizedUrl);
  const file = MegaFile.fromURL(normalizedUrl);
  await file.loadAttributes();
  if (file.directory) {
    throw new Error(MULTI_FILE_WEBSITE_VIDEO_ERROR);
  }
  const title = normalizeNullableString(file.name);
  const extension = title ? path.extname(title).toLowerCase() : "";
  return {
    file,
    title,
    contentType: extension ? (getVideoContentTypeByExtension(extension) ?? null) : null,
    sizeBytes: typeof file.size === "number" && Number.isFinite(file.size) ? file.size : null,
  };
}

let gofileGenerateWebsiteTokenPromise: Promise<(token: string) => string> | null = null;

async function getGofileWebsiteTokenGenerator(): Promise<(token: string) => string> {
  if (!gofileGenerateWebsiteTokenPromise) {
    gofileGenerateWebsiteTokenPromise = (async () => {
      const response = await fetch("https://gofile.io/dist/js/wt.obf.js");
      if (!response.ok) {
        throw new Error("Failed to load the Gofile website token generator.");
      }
      const script = await response.text();
      const context = {
        window: null as unknown,
        document: {},
        navigator: { language: "en-US" },
        console,
      };
      context.window = context;
      vm.createContext(context);
      vm.runInContext(script, context);
      if (typeof (context as { generateWT?: unknown }).generateWT !== "function") {
        throw new Error("Failed to initialize the Gofile website token generator.");
      }
      return (context as { generateWT: (token: string) => string }).generateWT;
    })().catch((error) => {
      gofileGenerateWebsiteTokenPromise = null;
      throw error;
    });
  }
  return gofileGenerateWebsiteTokenPromise;
}

async function createGofileGuestToken(): Promise<string> {
  const response = await fetch("https://api.gofile.io/accounts", { method: "POST" });
  if (!response.ok) {
    throw new Error(
      `Failed to create a Gofile guest token: ${response.status} ${response.statusText}`
    );
  }
  const payload = (await response.json()) as { status?: string; data?: { token?: unknown } };
  const token = typeof payload.data?.token === "string" ? payload.data.token.trim() : "";
  if (payload.status !== "ok" || !token) {
    throw new Error("Failed to create a usable Gofile guest token.");
  }
  return token;
}

async function inspectGofileSharedFile(url: string): Promise<DirectDownloadTarget> {
  const normalizedUrl = normalizeHttpUrl(url);
  const contentId = assertGofileSingleFileUrl(normalizedUrl);
  const [token, generateWebsiteToken] = await Promise.all([
    createGofileGuestToken(),
    getGofileWebsiteTokenGenerator(),
  ]);

  const contentUrl = new URL(`https://api.gofile.io/contents/${contentId}`);
  contentUrl.search = new URLSearchParams({
    page: "1",
    pageSize: "1000",
    sortField: "createTime",
    sortDirection: "-1",
  }).toString();

  const response = await fetch(contentUrl, {
    headers: {
      Authorization: `Bearer ${token}`,
      "X-Website-Token": generateWebsiteToken(token),
      "X-BL": "en-US",
    },
  });
  if (!response.ok) {
    throw new Error(`Gofile metadata request failed: ${response.status} ${response.statusText}`);
  }

  const payload = (await response.json()) as {
    status?: string;
    data?: {
      childrenCount?: unknown;
      children?: Record<string, unknown>;
    };
  };
  if (payload.status !== "ok" || !payload.data) {
    throw new Error("Gofile metadata request did not return a valid payload.");
  }

  const childCount =
    typeof payload.data.childrenCount === "number" && Number.isFinite(payload.data.childrenCount)
      ? payload.data.childrenCount
      : Object.keys(payload.data.children ?? {}).length;
  if (childCount !== 1) {
    throw new Error(MULTI_FILE_WEBSITE_VIDEO_ERROR);
  }

  const child = Object.values(payload.data.children ?? {})[0] as
    | {
        type?: unknown;
        link?: unknown;
        name?: unknown;
        mimetype?: unknown;
        size?: unknown;
      }
    | undefined;
  if (!child || child.type !== "file" || typeof child.link !== "string") {
    throw new Error("Gofile share did not resolve to a downloadable file.");
  }

  return {
    downloadUrl: child.link,
    title: normalizeNullableString(child.name),
    contentType: normalizeNullableString(child.mimetype),
    sizeBytes: typeof child.size === "number" && Number.isFinite(child.size) ? child.size : null,
    extractor: GOFILE_EXTRACTOR_KEY,
  };
}

async function inspectPixeldrainSharedFile(url: string): Promise<DirectDownloadTarget> {
  const normalizedUrl = normalizeHttpUrl(url);
  const fileId = assertPixeldrainSingleFileUrl(normalizedUrl);
  const response = await fetch(`https://pixeldrain.com/api/file/${fileId}/info`);
  if (!response.ok) {
    throw new Error(
      `Pixeldrain metadata request failed: ${response.status} ${response.statusText}`
    );
  }

  const payload = (await response.json()) as {
    id?: unknown;
    name?: unknown;
    size?: unknown;
    mime_type?: unknown;
  };

  return {
    downloadUrl: `https://pixeldrain.com/api/file/${fileId}?download`,
    title: normalizeNullableString(payload.name),
    contentType: normalizeNullableString(payload.mime_type),
    sizeBytes:
      typeof payload.size === "number" && Number.isFinite(payload.size) ? payload.size : null,
    extractor: PIXELDRAIN_EXTRACTOR_KEY,
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

function assertSingleFileWebsiteVideo(info: YtDlpInfoJson): void {
  const infoType = normalizeNullableString(info._type)?.toLowerCase() ?? null;
  const playlistCount = toFiniteNumber(info.playlist_count);
  const entryCount = toFiniteNumber(info.n_entries);

  if (Array.isArray(info.entries) && info.entries.length > 0) {
    throw new Error(MULTI_FILE_WEBSITE_VIDEO_ERROR);
  }
  if (infoType && /(playlist|multi[_-]?video|url_transparent)/u.test(infoType)) {
    throw new Error(MULTI_FILE_WEBSITE_VIDEO_ERROR);
  }
  if ((playlistCount !== null && playlistCount > 1) || (entryCount !== null && entryCount > 1)) {
    throw new Error(MULTI_FILE_WEBSITE_VIDEO_ERROR);
  }
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
  const { stdout } = await runCommand(
    binary.ytDlpPath,
    ["--dump-single-json", "--no-playlist", "--no-warnings", normalizedUrl],
    { timeoutMs: 600_000 }
  );
  const info = parseYtDlpInfo(stdout.toString("utf8"));
  assertSingleFileWebsiteVideo(info);
  return info;
}

async function resolveWebsiteVideoDirectUrl(url: string): Promise<string | null> {
  const normalizedUrl = normalizeHttpUrl(url);
  const binary = await resolveYtDlpBinary();
  const { stdout } = await runCommand(
    binary.ytDlpPath,
    ["--get-url", "--no-playlist", "--no-warnings", normalizedUrl],
    { timeoutMs: 600_000 }
  );
  return parseYtDlpResolvedUrl(stdout.toString("utf8"));
}

async function inspectWebsiteVideo(url: string): Promise<WebsiteVideoStreamResolution> {
  try {
    const parsed = new URL(normalizeHttpUrl(url));
    if (isMegaHost(parsed.hostname.toLowerCase())) {
      const inspected = await inspectMegaSharedFile(url);
      return {
        streamUrl: normalizeHttpUrl(url),
        headers: {},
        extractor: MEGA_EXTRACTOR_KEY,
        title: inspected.title,
        durationMs: null,
        contentType: inspected.contentType,
        playbackStrategy: "ytdlp",
      };
    }
    if (isPixeldrainHost(parsed.hostname.toLowerCase())) {
      const inspected = await inspectPixeldrainSharedFile(url);
      return {
        streamUrl: inspected.downloadUrl,
        headers: {},
        extractor: inspected.extractor,
        title: inspected.title,
        durationMs: null,
        contentType: inspected.contentType,
        playbackStrategy: "remote",
      };
    }
    if (isGofileHost(parsed.hostname.toLowerCase())) {
      const inspected = await inspectGofileSharedFile(url);
      return {
        streamUrl: inspected.downloadUrl,
        headers: {},
        extractor: inspected.extractor,
        title: inspected.title,
        durationMs: null,
        contentType: inspected.contentType,
        playbackStrategy: "remote",
      };
    }
  } catch (error) {
    if (error instanceof Error && error.message === MULTI_FILE_WEBSITE_VIDEO_ERROR) {
      throw error;
    }
  }

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
  } catch (error) {
    if (error instanceof Error && error.message === MULTI_FILE_WEBSITE_VIDEO_ERROR) {
      throw error;
    }
    // Fall through to HTML-based resolution
  }

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

  setInitialDownloadProgress(paths.normalizedUrl);

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

async function downloadMegaWebsiteVideo(
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
  setInitialDownloadProgress(paths.normalizedUrl);

  console.info(`[webVideo] Cache started: ${paths.normalizedUrl}`);

  try {
    const inspected = await inspectMegaSharedFile(paths.normalizedUrl);
    const extension = inspected.title ? path.extname(inspected.title).toLowerCase() : "";
    const normalizedExtension = extension || ".bin";
    const finalFilePath = path.join(
      paths.cacheDir,
      `${DOWNLOADED_VIDEO_BASENAME}${normalizedExtension}`
    );

    let downloadedBytes = 0;
    const source = inspected.file.download({});
    source.on("data", (chunk: Buffer) => {
      downloadedBytes += chunk.length;
      updateDownloadedBytes(paths.normalizedUrl, downloadedBytes, inspected.sizeBytes);
    });

    await pipeline(source, createWriteStream(finalFilePath));
    await throwIfCacheRemovalRequested(paths);
    if (!(await isNonEmptyFile(finalFilePath))) {
      await resetIncompleteCache(paths);
      throw new Error("MEGA download finished without producing a cached media file.");
    }

    const now = new Date().toISOString();
    const metadata: WebsiteVideoCacheMetadata = {
      originalUrl: paths.normalizedUrl,
      extractor: MEGA_EXTRACTOR_KEY,
      title: inspected.title,
      durationMs: null,
      finalFilePath,
      fileExtension: normalizedExtension.replace(/^\./u, "") || null,
      ytDlpVersion: null,
      createdAt: existingMetadata?.createdAt ?? now,
      lastAccessedAt: now,
    };

    await writeMetadata(paths, metadata);
    await removeInProgressMarker(paths);

    console.info(`[webVideo] Cache finished: ${paths.normalizedUrl}`);
    return metadata;
  } catch (error) {
    await resetIncompleteCache(paths);
    const message = error instanceof Error ? error.message : "MEGA download failed.";
    throw new Error(message);
  } finally {
    downloadProgressByUrl.delete(paths.normalizedUrl);
  }
}

async function downloadDirectHosterVideo(
  paths: WebsiteVideoCachePaths,
  inspect: (url: string) => Promise<DirectDownloadTarget>
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
  setInitialDownloadProgress(paths.normalizedUrl);

  console.info(`[webVideo] Cache started: ${paths.normalizedUrl}`);

  try {
    const inspected = await inspect(paths.normalizedUrl);
    const extension = inspected.title ? path.extname(inspected.title).toLowerCase() : "";
    const normalizedExtension = extension || ".bin";
    const finalFilePath = path.join(
      paths.cacheDir,
      `${DOWNLOADED_VIDEO_BASENAME}${normalizedExtension}`
    );

    const response = await fetch(inspected.downloadUrl);
    if (!response.ok) {
      throw new Error(`Hoster download request failed: ${response.status} ${response.statusText}`);
    }
    if (!response.body) {
      throw new Error("Hoster download response did not include a body.");
    }

    const [progressStream, fileStream] = response.body.tee();
    const progressTask = (async () => {
      let downloadedBytes = 0;
      const reader = progressStream.getReader();
      let readDone = false;
      while (!readDone) {
        const chunk = await reader.read();
        readDone = chunk.done;
        if (chunk.value) {
          downloadedBytes += chunk.value.length;
          updateDownloadedBytes(paths.normalizedUrl, downloadedBytes, inspected.sizeBytes);
        }
      }
    })();

    await Promise.all([
      progressTask,
      downloadResponseBodyToFile(new Response(fileStream), finalFilePath),
    ]);

    await throwIfCacheRemovalRequested(paths);
    if (!(await isNonEmptyFile(finalFilePath))) {
      await resetIncompleteCache(paths);
      throw new Error("Hoster download finished without producing a cached media file.");
    }

    const now = new Date().toISOString();
    const metadata: WebsiteVideoCacheMetadata = {
      originalUrl: paths.normalizedUrl,
      extractor: inspected.extractor,
      title: inspected.title,
      durationMs: null,
      finalFilePath,
      fileExtension: normalizedExtension.replace(/^\./u, "") || null,
      ytDlpVersion: null,
      createdAt: existingMetadata?.createdAt ?? now,
      lastAccessedAt: now,
    };

    await writeMetadata(paths, metadata);
    await removeInProgressMarker(paths);

    console.info(`[webVideo] Cache finished: ${paths.normalizedUrl}`);
    return metadata;
  } catch (error) {
    await resetIncompleteCache(paths);
    const message = error instanceof Error ? error.message : "Hoster download failed.";
    throw new Error(message);
  } finally {
    downloadProgressByUrl.delete(paths.normalizedUrl);
  }
}

export function __resetWebsiteVideoCachesForTests(): void {
  inFlightCacheByUrl.clear();
  cacheRemovalRequestsByUrl.clear();
  downloadProgressByUrl.clear();
}

export async function clearWebsiteVideoCache(
  rootPath = resolveWebsiteVideoCacheRoot()
): Promise<void> {
  __resetWebsiteVideoCachesForTests();
  await fs.rm(rootPath, { recursive: true, force: true });
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
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
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

  const pending = (
    isMegaSharedFileUrl(normalizedUrl)
      ? downloadMegaWebsiteVideo(buildCachePaths(normalizedUrl))
      : getPixeldrainFileId(normalizedUrl)
        ? downloadDirectHosterVideo(buildCachePaths(normalizedUrl), inspectPixeldrainSharedFile)
        : getGofileContentId(normalizedUrl)
          ? downloadDirectHosterVideo(buildCachePaths(normalizedUrl), inspectGofileSharedFile)
          : downloadWebsiteVideo(buildCachePaths(normalizedUrl))
  ).finally(() => {
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
