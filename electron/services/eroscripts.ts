import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { BrowserWindow, session, type Cookie } from "electron";
import { EROSCRIPTS_CACHE_ROOT_PATH_KEY } from "../../src/constants/eroscriptsSettings";
import { isLikelyVideoUrl } from "../../src/constants/videoFormats";
import ytDlpSupportedDomains from "../../src/constants/ytDlpSupportedDomains.generated.json";
import { runCommand } from "./phash/extract";
import { toLocalMediaUri } from "./localMedia";
import { getStore } from "./store";
import { classifyTrustedUrl } from "./security";
import { EROSCRIPTS_CACHE_RELATIVE_PATH, resolveConfiguredStoragePath } from "./storagePaths";
import { resolveYtDlpBinary } from "./webVideo/binaries";

const EROSCRIPTS_BASE_URL = "https://discuss.eroscripts.com";
const EROSCRIPTS_LOGIN_URL = `${EROSCRIPTS_BASE_URL}/login`;
const EROSCRIPTS_LOGIN_CHECK_TIMEOUT_MS = 5000;
const DEPRECATED_EROSCRIPTS_USERNAME_KEY = "eroscripts.username";
const DEPRECATED_EROSCRIPTS_API_KEY_KEY = "eroscripts.apiKey";
const EROSCRIPTS_FREE_SCRIPTS_CATEGORY_FILTER = "#scripts:free-scripts";
const FUNSCRIPT_CACHE_SUBDIR = "funscripts";
const VIDEO_CACHE_SUBDIR = "videos";
const METADATA_FILE = "meta.json";
const FUNSCRIPT_EXTENSION = ".funscript";
const ARCHIVE_EXTENSIONS = new Set([".zip", ".rar", ".7z"]);
const IGNORED_MEDIA_EXTENSIONS = new Set([
  ".jpg",
  ".jpeg",
  ".png",
  ".gif",
  ".webp",
  ".avif",
  ".svg",
  ".txt",
  ".pdf",
]);
const WINDOWS_RESERVED_FILENAME_CHARS = /[<>:"/\\|?*]/gu;

const ytDlpDomainSet = new Set(
  (ytDlpSupportedDomains as { domains?: string[] }).domains?.map((domain) =>
    domain.toLowerCase()
  ) ?? []
);

const inFlightFunscriptDownloads = new Map<string, Promise<EroScriptsFunscriptDownloadResult>>();
const inFlightVideoDownloads = new Map<string, Promise<EroScriptsVideoDownloadResult>>();
let eroscriptsLoginWindow: BrowserWindow | null = null;
let loginPollTimer: ReturnType<typeof setInterval> | null = null;
const eroscriptsLoginListeners = new Set<(status: EroScriptsLoginStatus) => void>();

export type EroScriptsLoginStatus = {
  loggedIn: boolean;
  username: string | null;
  cookieCount: number;
  checkedAt: string;
  error: string | null;
};

export type EroScriptsSearchResult = {
  topicId: number;
  postId: number | null;
  title: string;
  url: string;
  author: string | null;
  createdAt: string | null;
  excerpt: string;
};

export type EroScriptsSearchInput = {
  query?: string;
  tags?: string[];
  limit?: number;
};

export type EroScriptsFunscriptCandidate = {
  kind: "funscript";
  topicId: number;
  postId: number | null;
  filename: string;
  url: string;
  supported: boolean;
  unsupportedReason: string | null;
};

export type EroScriptsVideoCandidate = {
  kind: "video";
  topicId: number;
  postId: number | null;
  label: string;
  url: string;
  supported: boolean;
  unsupportedReason: string | null;
};

export type EroScriptsTopicMedia = {
  funscripts: EroScriptsFunscriptCandidate[];
  videos: EroScriptsVideoCandidate[];
};

export type EroScriptsFunscriptDownloadResult = {
  filePath: string;
  funscriptUri: string;
  filename: string;
  cached: boolean;
};

export type EroScriptsVideoDownloadResult = {
  filePath: string;
  videoUri: string;
  filename: string;
  title: string | null;
  cached: boolean;
};

type DiscourseSearchResponse = {
  topics?: Array<{
    id?: unknown;
    title?: unknown;
    slug?: unknown;
    created_at?: unknown;
    posts_count?: unknown;
  }>;
  posts?: Array<{
    id?: unknown;
    topic_id?: unknown;
    username?: unknown;
    cooked?: unknown;
    blurb?: unknown;
    created_at?: unknown;
  }>;
};

type DiscourseUpload = {
  url?: unknown;
  original_filename?: unknown;
  filename?: unknown;
  extension?: unknown;
};

type DiscourseLinkCount = {
  url?: unknown;
  title?: unknown;
};

type DiscourseTopicResponse = {
  post_stream?: {
    posts?: Array<{
      id?: unknown;
      topic_id?: unknown;
      cooked?: unknown;
      uploads?: unknown;
      link_counts?: unknown;
    }>;
  };
};

type DiscourseCurrentSessionResponse = {
  current_user?: {
    username?: unknown;
  };
};

function isCookieActive(cookie: Cookie): boolean {
  return !cookie.expirationDate || cookie.expirationDate * 1000 > Date.now();
}

async function getEroScriptsCookies(): Promise<Cookie[]> {
  const cookies = await session.defaultSession.cookies.get({ url: EROSCRIPTS_BASE_URL });
  return cookies.filter(isCookieActive);
}

function toCookieHeader(cookies: Cookie[]): string | null {
  const pairs = cookies
    .filter((cookie) => cookie.name && cookie.value)
    .map((cookie) => `${cookie.name}=${cookie.value}`);
  return pairs.length > 0 ? pairs.join("; ") : null;
}

async function authHeaders(): Promise<Record<string, string>> {
  const cookieHeader = toCookieHeader(await getEroScriptsCookies());
  return cookieHeader ? { Cookie: cookieHeader } : {};
}

function blankLoginStatus(cookieCount: number, error: string | null = null): EroScriptsLoginStatus {
  return {
    loggedIn: false,
    username: null,
    cookieCount,
    checkedAt: new Date().toISOString(),
    error,
  };
}

function cookieRemovalUrl(cookie: Cookie): string {
  const domain = (cookie.domain || new URL(EROSCRIPTS_BASE_URL).hostname).replace(/^\./u, "");
  const cookiePath = cookie.path?.startsWith("/") ? cookie.path : "/";
  return `${EROSCRIPTS_BASE_URL.startsWith("https:") ? "https" : "http"}://${domain}${cookiePath}`;
}

function clearDeprecatedEroScriptsApiCredentials(): void {
  const store = getStore();
  if (store.get(DEPRECATED_EROSCRIPTS_USERNAME_KEY) !== undefined) {
    store.set(DEPRECATED_EROSCRIPTS_USERNAME_KEY, null);
  }
  if (store.get(DEPRECATED_EROSCRIPTS_API_KEY_KEY) !== undefined) {
    store.set(DEPRECATED_EROSCRIPTS_API_KEY_KEY, null);
  }
}

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const headers = await authHeaders();
  const response = await fetch(url, {
    ...init,
    headers: {
      Accept: "application/json",
      "User-Agent": "F-Land EroScripts Search",
      ...headers,
      ...(init?.headers ?? {}),
    },
  });

  if (response.status === 401 || response.status === 403) {
    throw new Error("EroScripts rejected the request. Log in through EroScripts settings.");
  }
  if (response.status === 429) {
    throw new Error("EroScripts rate limited the request. Try again later.");
  }
  if (!response.ok) {
    throw new Error(`EroScripts request failed: ${response.status} ${response.statusText}`);
  }

  return (await response.json()) as T;
}

export async function getEroScriptsLoginStatus(): Promise<EroScriptsLoginStatus> {
  clearDeprecatedEroScriptsApiCredentials();
  const cookies = await getEroScriptsCookies();
  const cookieHeader = toCookieHeader(cookies);
  if (!cookieHeader) return blankLoginStatus(0);

  try {
    const response = await fetch(`${EROSCRIPTS_BASE_URL}/session/current.json`, {
      headers: {
        Accept: "application/json",
        "User-Agent": "F-Land EroScripts Search",
        Cookie: cookieHeader,
      },
      signal: AbortSignal.timeout(EROSCRIPTS_LOGIN_CHECK_TIMEOUT_MS),
    });
    if (response.status === 401 || response.status === 403) {
      return blankLoginStatus(cookies.length);
    }
    if (!response.ok) {
      return blankLoginStatus(
        cookies.length,
        `EroScripts login check failed: ${response.status} ${response.statusText}`
      );
    }
    const payload = (await response.json()) as DiscourseCurrentSessionResponse;
    const username = normalizeNullableText(payload.current_user?.username);
    return {
      loggedIn: Boolean(username),
      username,
      cookieCount: cookies.length,
      checkedAt: new Date().toISOString(),
      error: null,
    };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "EroScripts login check failed.";
    const isTimeout =
      error instanceof Error &&
      (error.name === "TimeoutError" || error.name === "AbortError");
    return blankLoginStatus(
      cookies.length,
      isTimeout ? "EroScripts login check timed out." : message
    );
  }
}

export function subscribeToEroScriptsLoginStatus(
  listener: (status: EroScriptsLoginStatus) => void
): () => void {
  eroscriptsLoginListeners.add(listener);
  return () => {
    eroscriptsLoginListeners.delete(listener);
  };
}

function stopLoginPoll(): void {
  if (loginPollTimer !== null) {
    clearInterval(loginPollTimer);
    loginPollTimer = null;
  }
}

async function pollEroScriptsLogin(): Promise<void> {
  const status = await getEroScriptsLoginStatus();
  for (const listener of eroscriptsLoginListeners) {
    listener(status);
  }
  if (status.loggedIn) {
    stopLoginPoll();
    closeEroScriptsLoginWindow();
  }
}

function startLoginPoll(): void {
  stopLoginPoll();
  void pollEroScriptsLogin();
  loginPollTimer = setInterval(() => void pollEroScriptsLogin(), 3000);
}

export async function openEroScriptsLoginWindow(): Promise<{ opened: true }> {
  clearDeprecatedEroScriptsApiCredentials();
  if (eroscriptsLoginWindow && !eroscriptsLoginWindow.isDestroyed()) {
    eroscriptsLoginWindow.focus();
    return { opened: true };
  }

  const loginWindow = new BrowserWindow({
    width: 1120,
    height: 820,
    minWidth: 720,
    minHeight: 560,
    title: "EroScripts Login",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  eroscriptsLoginWindow = loginWindow;
  loginWindow.on("closed", () => {
    stopLoginPoll();
    if (eroscriptsLoginWindow === loginWindow) {
      eroscriptsLoginWindow = null;
    }
  });
  loginWindow.setMenuBarVisibility(false);
  void loginWindow.loadURL(EROSCRIPTS_LOGIN_URL).catch((error: unknown) => {
    console.error("Failed to open EroScripts login window", error);
  });
  startLoginPoll();
  return { opened: true };
}

function closeEroScriptsLoginWindow(): void {
  if (eroscriptsLoginWindow && !eroscriptsLoginWindow.isDestroyed()) {
    eroscriptsLoginWindow.close();
  }
}

export async function clearEroScriptsLoginCookies(): Promise<EroScriptsLoginStatus> {
  const cookies = await getEroScriptsCookies();
  await Promise.all(
    cookies.map((cookie) =>
      session.defaultSession.cookies.remove(cookieRemovalUrl(cookie), cookie.name)
    )
  );
  return blankLoginStatus(0);
}

function normalizeHttpUrl(input: string): string {
  let parsed: URL;
  try {
    parsed = new URL(input.trim(), EROSCRIPTS_BASE_URL);
  } catch {
    throw new Error("URL must be a valid http(s) URL.");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("URL must use http or https.");
  }
  parsed.hash = "";
  return parsed.toString();
}

function normalizeNullableText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function stripHtml(input: string): string {
  return input
    .replace(/<[^>]+>/gu, " ")
    .replace(/&amp;/gu, "&")
    .replace(/&quot;/gu, '"')
    .replace(/&#39;/gu, "'")
    .replace(/\s+/gu, " ")
    .trim();
}

function topicUrl(topicId: number, slug: string | null): string {
  return slug
    ? `${EROSCRIPTS_BASE_URL}/t/${encodeURIComponent(slug)}/${topicId}`
    : `${EROSCRIPTS_BASE_URL}/t/${topicId}`;
}

function normalizeSearchTag(input: string): string | null {
  const normalized = input
    .trim()
    .replace(/^#/u, "")
    .replace(/\s+/gu, "-")
    .replace(/[^a-zA-Z0-9_-]/gu, "")
    .toLowerCase();
  return normalized.length > 0 ? normalized : null;
}

function buildEroScriptsSearchQuery(input: EroScriptsSearchInput): string {
  const query = normalizeNullableText(input.query);
  const tags = (input.tags ?? [])
    .map(normalizeSearchTag)
    .filter((tag): tag is string => Boolean(tag));
  const terms = [
    query,
    EROSCRIPTS_FREE_SCRIPTS_CATEGORY_FILTER,
    ...tags.map((tag) => `tags:${tag}`),
    !query ? "order:latest" : null,
  ].filter((term): term is string => Boolean(term));

  return terms.join(" ");
}

export async function searchEroScripts(
  input: EroScriptsSearchInput
): Promise<EroScriptsSearchResult[]> {
  const searchQuery = buildEroScriptsSearchQuery(input);

  const limit = Math.max(1, Math.min(50, Math.floor(input.limit ?? 20)));
  const search = new URL(`${EROSCRIPTS_BASE_URL}/search.json`);
  search.searchParams.set("q", searchQuery);

  const payload = await requestJson<DiscourseSearchResponse>(search.toString());
  const postByTopicId = new Map<number, NonNullable<DiscourseSearchResponse["posts"]>[number]>();
  for (const post of payload.posts ?? []) {
    const topicId = typeof post.topic_id === "number" ? post.topic_id : null;
    if (topicId !== null && !postByTopicId.has(topicId)) {
      postByTopicId.set(topicId, post);
    }
  }

  return (payload.topics ?? [])
    .map((topic) => {
      const topicId = typeof topic.id === "number" ? topic.id : null;
      if (topicId === null) return null;
      const post = postByTopicId.get(topicId);
      const title = normalizeNullableText(topic.title) ?? `Topic ${topicId}`;
      return {
        topicId,
        postId: typeof post?.id === "number" ? post.id : null,
        title,
        url: topicUrl(topicId, normalizeNullableText(topic.slug)),
        author: normalizeNullableText(post?.username),
        createdAt:
          normalizeNullableText(post?.created_at) ?? normalizeNullableText(topic.created_at),
        excerpt: stripHtml(
          normalizeNullableText(post?.blurb) ?? normalizeNullableText(post?.cooked) ?? ""
        ),
      } satisfies EroScriptsSearchResult;
    })
    .filter((entry): entry is EroScriptsSearchResult => entry !== null)
    .slice(0, limit);
}

function extensionFromUrlOrFilename(url: string, filename: string | null): string {
  const source =
    filename ??
    (() => {
      try {
        return new URL(url).pathname;
      } catch {
        return url;
      }
    })();
  return path.extname(source).toLowerCase();
}

function filenameFromUrl(url: string, fallback = "download"): string {
  try {
    const parsed = new URL(url);
    const name = decodeURIComponent(parsed.pathname.split("/").pop() ?? "").trim();
    return name || fallback;
  } catch {
    return fallback;
  }
}

function sanitizeFileName(raw: string, fallback: string): string {
  const base = raw
    .trim()
    .replace(WINDOWS_RESERVED_FILENAME_CHARS, "_")
    .split("")
    .map((char) => (char.charCodeAt(0) < 32 ? "_" : char))
    .join("")
    .replace(/\s+/gu, " ")
    .slice(0, 180);
  return base || fallback;
}

function extractHrefsFromHtml(html: string): Array<{ url: string; label: string | null }> {
  const matches = html.matchAll(/href\s*=\s*["']([^"']+)["'][^>]*>(.*?)<\/a>/gi);
  return [...matches].map((match) => ({
    url: match[1] ?? "",
    label: match[2] ? stripHtml(match[2]) : null,
  }));
}

function toUploads(value: unknown): DiscourseUpload[] {
  return Array.isArray(value)
    ? (value.filter((entry) => entry && typeof entry === "object") as DiscourseUpload[])
    : [];
}

function toLinkCounts(value: unknown): DiscourseLinkCount[] {
  return Array.isArray(value)
    ? (value.filter((entry) => entry && typeof entry === "object") as DiscourseLinkCount[])
    : [];
}

function isYtDlpDomain(hostname: string): boolean {
  const normalized = hostname.toLowerCase();
  if (ytDlpDomainSet.has(normalized)) return true;
  const parts = normalized.split(".");
  for (let i = 1; i < parts.length - 1; i += 1) {
    const parent = parts.slice(i).join(".");
    if (ytDlpDomainSet.has(parent)) return true;
  }
  return false;
}

function isLikelyDownloaderVideoUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.hostname.toLowerCase().endsWith("eroscripts.com")) return false;
    const extension = path.extname(parsed.pathname).toLowerCase();
    if (IGNORED_MEDIA_EXTENSIONS.has(extension) || ARCHIVE_EXTENSIONS.has(extension)) return false;
    if (isLikelyVideoUrl(url)) return true;
    return isYtDlpDomain(parsed.hostname);
  } catch {
    return false;
  }
}

function isTrustedDownloaderVideoUrl(url: string): boolean {
  if (!isLikelyDownloaderVideoUrl(url)) return false;
  return classifyTrustedUrl(url)?.decision === "trusted";
}

function collectTopicLinks(topic: DiscourseTopicResponse): Array<{
  topicId: number;
  postId: number | null;
  url: string;
  label: string | null;
  filename: string | null;
}> {
  const output: Array<{
    topicId: number;
    postId: number | null;
    url: string;
    label: string | null;
    filename: string | null;
  }> = [];

  for (const post of topic.post_stream?.posts ?? []) {
    const topicId = typeof post.topic_id === "number" ? post.topic_id : 0;
    const postId = typeof post.id === "number" ? post.id : null;

    for (const upload of toUploads(post.uploads)) {
      const url = normalizeNullableText(upload.url);
      if (!url) continue;
      const filename =
        normalizeNullableText(upload.original_filename) ??
        normalizeNullableText(upload.filename) ??
        null;
      output.push({ topicId, postId, url, label: filename, filename });
    }

    for (const link of toLinkCounts(post.link_counts)) {
      const url = normalizeNullableText(link.url);
      if (!url) continue;
      const label = normalizeNullableText(link.title);
      output.push({ topicId, postId, url, label, filename: label });
    }

    const cooked = normalizeNullableText(post.cooked);
    if (cooked) {
      for (const href of extractHrefsFromHtml(cooked)) {
        output.push({ topicId, postId, url: href.url, label: href.label, filename: href.label });
      }
    }
  }

  return output;
}

export async function listEroScriptsTopicMedia(topicId: number): Promise<EroScriptsTopicMedia> {
  const payload = await requestJson<DiscourseTopicResponse>(
    `${EROSCRIPTS_BASE_URL}/t/${topicId}.json`
  );
  const funscripts = new Map<string, EroScriptsFunscriptCandidate>();
  const videos = new Map<string, EroScriptsVideoCandidate>();

  for (const link of collectTopicLinks(payload)) {
    let normalizedUrl: string;
    try {
      normalizedUrl = normalizeHttpUrl(link.url);
    } catch {
      continue;
    }
    const filename = link.filename ?? filenameFromUrl(normalizedUrl);
    const extension = extensionFromUrlOrFilename(normalizedUrl, filename);

    if (extension === FUNSCRIPT_EXTENSION) {
      if (!funscripts.has(normalizedUrl)) {
        funscripts.set(normalizedUrl, {
          kind: "funscript",
          topicId,
          postId: link.postId,
          filename: sanitizeFileName(filename, `topic-${topicId}.funscript`),
          url: normalizedUrl,
          supported: true,
          unsupportedReason: null,
        });
      }
      continue;
    }

    if (isTrustedDownloaderVideoUrl(normalizedUrl) && !videos.has(normalizedUrl)) {
      videos.set(normalizedUrl, {
        kind: "video",
        topicId,
        postId: link.postId,
        label: link.label ?? filenameFromUrl(normalizedUrl, new URL(normalizedUrl).hostname),
        url: normalizedUrl,
        supported: true,
        unsupportedReason: null,
      });
    }
  }

  return {
    funscripts: [...funscripts.values()],
    videos: [...videos.values()],
  };
}

export function resolveEroScriptsCacheRoot(): string {
  try {
    return resolveConfiguredStoragePath(
      getStore().get(EROSCRIPTS_CACHE_ROOT_PATH_KEY),
      EROSCRIPTS_CACHE_RELATIVE_PATH
    );
  } catch {
    return path.join(os.tmpdir(), "f-land", EROSCRIPTS_CACHE_RELATIVE_PATH);
  }
}

function hashUrl(url: string): string {
  return crypto.createHash("sha256").update(normalizeHttpUrl(url)).digest("hex");
}

async function isNonEmptyFile(filePath: string): Promise<boolean> {
  try {
    const stat = await fs.stat(filePath);
    return stat.isFile() && stat.size > 0;
  } catch {
    return false;
  }
}

async function writeMetadata(filePath: string, metadata: unknown): Promise<void> {
  await fs.writeFile(filePath, `${JSON.stringify(metadata, null, 2)}\n`, "utf8");
}

async function validateFunscript(filePath: string): Promise<void> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch {
    throw new Error("Downloaded file is not valid funscript JSON.");
  }
  if (
    !parsed ||
    typeof parsed !== "object" ||
    !Array.isArray((parsed as { actions?: unknown }).actions)
  ) {
    throw new Error("Downloaded file does not contain a funscript actions array.");
  }
}

export async function downloadEroScriptsFunscript(input: {
  topicId: number;
  postId?: number | null;
  url: string;
  filename: string;
}): Promise<EroScriptsFunscriptDownloadResult> {
  const normalizedUrl = normalizeHttpUrl(input.url);
  if (extensionFromUrlOrFilename(normalizedUrl, input.filename) !== FUNSCRIPT_EXTENSION) {
    throw new Error("Only direct .funscript downloads are supported.");
  }

  const existing = inFlightFunscriptDownloads.get(normalizedUrl);
  if (existing) return existing;

  const pending = (async () => {
    const cacheKey = hashUrl(normalizedUrl);
    const cacheDir = path.join(resolveEroScriptsCacheRoot(), FUNSCRIPT_CACHE_SUBDIR, cacheKey);
    const filename = sanitizeFileName(input.filename, `${cacheKey}.funscript`);
    const finalFilename = filename.toLowerCase().endsWith(FUNSCRIPT_EXTENSION)
      ? filename
      : `${filename}${FUNSCRIPT_EXTENSION}`;
    const filePath = path.join(cacheDir, finalFilename);
    const metadataPath = path.join(cacheDir, METADATA_FILE);

    if (await isNonEmptyFile(filePath)) {
      await validateFunscript(filePath);
      return {
        filePath,
        funscriptUri: toLocalMediaUri(filePath),
        filename: finalFilename,
        cached: true,
      };
    }

    await fs.rm(cacheDir, { recursive: true, force: true });
    await fs.mkdir(cacheDir, { recursive: true });

    const headers = await authHeaders();
    const response = await fetch(normalizedUrl, {
      headers: {
        Accept: "application/json,text/plain,*/*",
        "User-Agent": "F-Land EroScripts Search",
        ...headers,
      },
    });
    if (!response.ok) {
      throw new Error(`Funscript download failed: ${response.status} ${response.statusText}`);
    }
    const text = await response.text();
    await fs.writeFile(filePath, text, "utf8");
    await validateFunscript(filePath);
    await writeMetadata(metadataPath, {
      kind: "funscript",
      sourceUrl: normalizedUrl,
      topicId: input.topicId,
      postId: input.postId ?? null,
      filename: finalFilename,
      createdAt: new Date().toISOString(),
    });

    return {
      filePath,
      funscriptUri: toLocalMediaUri(filePath),
      filename: finalFilename,
      cached: false,
    };
  })().finally(() => {
    inFlightFunscriptDownloads.delete(normalizedUrl);
  });

  inFlightFunscriptDownloads.set(normalizedUrl, pending);
  return pending;
}

type YtDlpInfo = {
  title?: unknown;
  ext?: unknown;
  webpage_url?: unknown;
};

async function inspectVideo(url: string): Promise<YtDlpInfo | null> {
  const binary = await resolveYtDlpBinary();
  try {
    const { stdout } = await runCommand(
      binary.ytDlpPath,
      ["--dump-single-json", "--no-playlist", "--no-warnings", url],
      { timeoutMs: 600_000 }
    );
    return JSON.parse(stdout.toString("utf8")) as YtDlpInfo;
  } catch {
    return null;
  }
}

async function findDownloadedVideo(cacheDir: string): Promise<string | null> {
  let entries: string[];
  try {
    entries = await fs.readdir(cacheDir);
  } catch {
    return null;
  }
  const candidates = entries
    .filter((entry) => entry.startsWith("video."))
    .filter(
      (entry) => !entry.endsWith(".part") && !entry.endsWith(".tmp") && !entry.endsWith(".ytdl")
    )
    .map((entry) => path.join(cacheDir, entry));

  for (const candidate of candidates.sort((a, b) => a.localeCompare(b))) {
    if (await isNonEmptyFile(candidate)) return candidate;
  }
  return null;
}

export async function downloadEroScriptsVideo(input: {
  topicId: number;
  postId?: number | null;
  url: string;
}): Promise<EroScriptsVideoDownloadResult> {
  const normalizedUrl = normalizeHttpUrl(input.url);
  if (!isTrustedDownloaderVideoUrl(normalizedUrl)) {
    throw new Error("This link is not on the trusted supported video URL list.");
  }

  const existing = inFlightVideoDownloads.get(normalizedUrl);
  if (existing) return existing;

  const pending = (async () => {
    const cacheKey = hashUrl(normalizedUrl);
    const cacheDir = path.join(resolveEroScriptsCacheRoot(), VIDEO_CACHE_SUBDIR, cacheKey);
    const metadataPath = path.join(cacheDir, METADATA_FILE);
    const cachedFile = await findDownloadedVideo(cacheDir);
    if (cachedFile) {
      return {
        filePath: cachedFile,
        videoUri: toLocalMediaUri(cachedFile),
        filename: path.basename(cachedFile),
        title: null,
        cached: true,
      };
    }

    await fs.rm(cacheDir, { recursive: true, force: true });
    await fs.mkdir(cacheDir, { recursive: true });

    const [binary, info] = await Promise.all([resolveYtDlpBinary(), inspectVideo(normalizedUrl)]);
    const outputTemplate = path.join(cacheDir, "video.%(ext)s");
    await runCommand(
      binary.ytDlpPath,
      [
        "-f",
        "(bestvideo+bestaudio/best)",
        "--no-playlist",
        "--no-warnings",
        "--newline",
        "--output",
        outputTemplate,
        normalizedUrl,
      ],
      { timeoutMs: 1_800_000 }
    );

    const filePath = await findDownloadedVideo(cacheDir);
    if (!filePath) {
      throw new Error("Video download finished without producing a media file.");
    }

    const title = normalizeNullableText(info?.title);
    await writeMetadata(metadataPath, {
      kind: "video",
      sourceUrl: normalizedUrl,
      topicId: input.topicId,
      postId: input.postId ?? null,
      filename: path.basename(filePath),
      title,
      ytDlpVersion: binary.version,
      createdAt: new Date().toISOString(),
    });

    return {
      filePath,
      videoUri: toLocalMediaUri(filePath),
      filename: path.basename(filePath),
      title,
      cached: false,
    };
  })().finally(() => {
    inFlightVideoDownloads.delete(normalizedUrl);
  });

  inFlightVideoDownloads.set(normalizedUrl, pending);
  return pending;
}

export async function clearEroScriptsCache(): Promise<void> {
  inFlightFunscriptDownloads.clear();
  inFlightVideoDownloads.clear();
  await fs.rm(resolveEroScriptsCacheRoot(), { recursive: true, force: true });
}

export function __resetEroScriptsForTests(): void {
  inFlightFunscriptDownloads.clear();
  inFlightVideoDownloads.clear();
  stopLoginPoll();
  eroscriptsLoginWindow = null;
  eroscriptsLoginListeners.clear();
}
