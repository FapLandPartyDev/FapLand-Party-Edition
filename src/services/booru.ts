import { trpc } from "./trpc";
import { isLikelyVideoUrl } from "../constants/videoFormats";

export type BooruMediaItem = Awaited<ReturnType<typeof trpc.booru.searchMedia.query>>[number];
type BooruMediaSource = BooruMediaItem["source"];

const INTERMEDIARY_LOADING_PROMPT_KEY = "game.intermediary.loadingPrompt";
const DEFAULT_INTERMEDIARY_LOADING_PROMPT = "animated gif webm";
const BOORU_MEDIA_CACHE_KEY = "game.intermediary.booruMediaCache.v1";
const BOORU_CACHE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const BOORU_CACHE_WARM_LIMIT = 8;

type BooruMediaCacheEntry = {
  updatedAtMs: number;
  media: BooruMediaItem[];
};

type BooruMediaCacheStore = {
  version: 1;
  entries: Record<string, BooruMediaCacheEntry>;
};

function createEmptyBooruMediaCacheStore(): BooruMediaCacheStore {
  return {
    version: 1,
    entries: {},
  };
}

const inFlightRefreshByPrompt = new Map<string, Promise<BooruMediaItem[]>>();
const warmedMediaUrls = new Set<string>();
let startupCacheRefreshPromise: Promise<void> | null = null;

function normalizePrompt(prompt: string): string {
  return prompt.trim().replace(/\s+/g, " ");
}

function toPromptCacheKey(prompt: string): string {
  return normalizePrompt(prompt).toLowerCase();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isBooruSource(value: unknown): value is BooruMediaSource {
  return value === "rule34" || value === "gelbooru" || value === "danbooru";
}

function isBooruMediaItem(value: unknown): value is BooruMediaItem {
  if (!isRecord(value)) return false;
  if (typeof value.id !== "string" || value.id.length === 0) return false;
  if (!isBooruSource(value.source)) return false;
  if (typeof value.url !== "string" || value.url.length === 0) return false;
  if (
    value.previewUrl !== undefined &&
    value.previewUrl !== null &&
    (typeof value.previewUrl !== "string" || value.previewUrl.length === 0)
  ) {
    return false;
  }
  return true;
}

function parseBooruMediaCacheStore(value: unknown): BooruMediaCacheStore {
  if (!isRecord(value)) return createEmptyBooruMediaCacheStore();
  if (value.version !== 1) return createEmptyBooruMediaCacheStore();
  if (!isRecord(value.entries)) return createEmptyBooruMediaCacheStore();

  const entries: Record<string, BooruMediaCacheEntry> = {};
  for (const [promptKey, rawEntry] of Object.entries(value.entries)) {
    if (!isRecord(rawEntry)) continue;
    const updatedAtMs = Number(rawEntry.updatedAtMs);
    if (!Number.isFinite(updatedAtMs) || updatedAtMs <= 0) continue;
    if (!Array.isArray(rawEntry.media)) continue;
    const media = rawEntry.media.filter(isBooruMediaItem);
    if (media.length === 0) continue;
    entries[promptKey] = { updatedAtMs, media };
  }

  return { version: 1, entries };
}

function warmBooruMediaAssets(media: BooruMediaItem[]): void {
  if (typeof window === "undefined" || typeof document === "undefined") return;

  for (const item of media.slice(0, BOORU_CACHE_WARM_LIMIT)) {
    const target = item.previewUrl ?? item.url;
    if (!target || warmedMediaUrls.has(target)) continue;
    warmedMediaUrls.add(target);

    if (isVideoMedia(target)) {
      const video = document.createElement("video");
      video.preload = "metadata";
      video.playsInline = true;
      video.muted = true;
      const cleanup = () => {
        video.removeAttribute("src");
        video.load();
      };
      video.addEventListener("loadeddata", cleanup, { once: true });
      video.addEventListener("error", cleanup, { once: true });
      video.src = target;
      video.load();
      continue;
    }

    const image = new Image();
    image.decoding = "async";
    image.src = target;
  }
}

async function readBooruMediaCacheStore(): Promise<BooruMediaCacheStore> {
  try {
    const stored = await trpc.store.get.query({ key: BOORU_MEDIA_CACHE_KEY });
    return parseBooruMediaCacheStore(stored);
  } catch (error) {
    console.warn("Failed to read booru media cache store", error);
    return createEmptyBooruMediaCacheStore();
  }
}

async function writeBooruMediaCacheStore(store: BooruMediaCacheStore): Promise<void> {
  try {
    await trpc.store.set.mutate({ key: BOORU_MEDIA_CACHE_KEY, value: store });
  } catch (error) {
    console.warn("Failed to write booru media cache store", error);
  }
}

async function persistBooruMediaForPrompt(prompt: string, media: BooruMediaItem[]): Promise<void> {
  const promptKey = toPromptCacheKey(prompt);
  if (!promptKey || media.length === 0) return;

  const store = await readBooruMediaCacheStore();
  store.entries[promptKey] = {
    updatedAtMs: Date.now(),
    media,
  };
  await writeBooruMediaCacheStore(store);
}

async function getIntermediaryLoadingPromptFromStore(): Promise<string> {
  try {
    const stored = await trpc.store.get.query({ key: INTERMEDIARY_LOADING_PROMPT_KEY });
    if (typeof stored !== "string") return DEFAULT_INTERMEDIARY_LOADING_PROMPT;
    const normalized = normalizePrompt(stored);
    return normalized.length > 0 ? normalized : DEFAULT_INTERMEDIARY_LOADING_PROMPT;
  } catch (error) {
    console.warn("Failed to read intermediary loading prompt for booru cache refresh", error);
    return DEFAULT_INTERMEDIARY_LOADING_PROMPT;
  }
}

export async function getCachedBooruMedia(prompt: string): Promise<BooruMediaItem[]> {
  const promptKey = toPromptCacheKey(prompt);
  if (!promptKey) return [];

  const store = await readBooruMediaCacheStore();
  const entry = store.entries[promptKey];
  if (!entry) return [];
  warmBooruMediaAssets(entry.media);
  return entry.media;
}

export async function searchBooruMedia(prompt: string, limitPerSource = 20): Promise<BooruMediaItem[]> {
  const normalizedPrompt = normalizePrompt(prompt);
  if (!normalizedPrompt) return [];
  try {
    const media = await trpc.booru.searchMedia.query({ prompt: normalizedPrompt, limitPerSource });
    warmBooruMediaAssets(media);
    return media;
  } catch (error) {
    console.warn("Booru search failed", error);
    return [];
  }
}

export async function ensureBooruMediaCache(prompt: string, limitPerSource = 20): Promise<BooruMediaItem[]> {
  const normalizedPrompt = normalizePrompt(prompt);
  const promptKey = toPromptCacheKey(normalizedPrompt);
  if (!promptKey) return [];

  const store = await readBooruMediaCacheStore();
  const cachedEntry = store.entries[promptKey];
  if (cachedEntry && Date.now() - cachedEntry.updatedAtMs < BOORU_CACHE_MAX_AGE_MS) {
    warmBooruMediaAssets(cachedEntry.media);
    return cachedEntry.media;
  }

  const inFlightRefresh = inFlightRefreshByPrompt.get(promptKey);
  if (inFlightRefresh) return inFlightRefresh;

  const refreshPromise = (async () => {
    const media = await searchBooruMedia(normalizedPrompt, limitPerSource);
    if (media.length > 0) {
      await persistBooruMediaForPrompt(normalizedPrompt, media);
      return media;
    }
    if (cachedEntry?.media?.length) {
      warmBooruMediaAssets(cachedEntry.media);
      return cachedEntry.media;
    }
    return [];
  })();

  inFlightRefreshByPrompt.set(promptKey, refreshPromise);
  try {
    return await refreshPromise;
  } finally {
    inFlightRefreshByPrompt.delete(promptKey);
  }
}

export async function refreshStartupBooruMediaCache(): Promise<void> {
  if (startupCacheRefreshPromise) return startupCacheRefreshPromise;

  startupCacheRefreshPromise = (async () => {
    const prompt = await getIntermediaryLoadingPromptFromStore();
    await ensureBooruMediaCache(prompt, 18);
  })().catch((error) => {
    console.warn("Startup booru cache refresh failed", error);
  });

  return startupCacheRefreshPromise;
}

export function isVideoMedia(url: string): boolean {
  return isLikelyVideoUrl(url);
}
