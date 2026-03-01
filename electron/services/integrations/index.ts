import { getDb } from "../db";
import { eq, inArray, and } from "drizzle-orm";
import { resource, round } from "../db/schema";
import { generateRoundPreviewImageDataUri } from "../roundPreview";
import { findBestSimilarPhashMatch, normalizePhashForSimilarity } from "../../../src/utils/phashSimilarity";
import {
  createEmptyIntegrationSyncStatus,
  createStashSource,
  deleteExternalSource,
  getDisabledRoundIds,
  getExternalSourceById,
  getIntegrationSyncStatus,
  listExternalSources,
  normalizeBaseUrl,
  setDisabledRoundIds,
  setExternalSourceEnabled,
  setIntegrationSyncStatus,
  sourcePrefixForManagedRounds,
  toStashInstallSourceKey,
  updateStashSource,
  type CreateStashSourceInput,
  type UpdateStashSourceInput,
} from "./store";
import { fetchStashMediaWithAuth, searchStashTags, testStashConnection, toNormalizedPhash } from "./stashClient";
import { stashProvider } from "./providers/stashProvider";
import type {
  ExternalProvider,
  ExternalSource,
  ExternalSyncContext,
  IntegrationSyncError,
  IntegrationSyncStatus,
  MediaPurpose,
  NormalizedSceneImportItem,
  SceneIngestResult,
} from "./types";

const providers: ExternalProvider[] = [stashProvider];

let activeSyncPromise: Promise<IntegrationSyncStatus> | null = null;

type CachedRound = {
  id: string;
  name: string;
  author: string | null;
  description: string | null;
  phash: string | null;
  previewImage: string | null;
  installSourceKey: string | null;
  resourcesByVideoUri: Map<string, { id: string; disabled: boolean }>;
};

type SyncMutableContext = {
  db: ReturnType<typeof getDb>;
  heroIdByPhash: Map<string, string>;
  roundById: Map<string, CachedRound>;
  roundIdByPhash: Map<string, string>;
  roundPhashCandidates: Array<{ phash: string; roundId: string }>;
  roundIdByInstallSourceKey: Map<string, string>;
  previewByVideoUri: Map<string, string | null>;
  status: IntegrationSyncStatus;
};

function getProviderForKind(source: ExternalSource): ExternalProvider {
  const provider = providers.find((entry) => entry.kind === source.kind);
  if (!provider) {
    throw new Error(`No provider registered for source kind '${source.kind}'.`);
  }

  return provider;
}

function normalizeNullableText(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function isMissingText(value: string | null | undefined): boolean {
  return !normalizeNullableText(value);
}

function rememberRoundPhashCandidate(
  context: SyncMutableContext,
  roundId: string,
  phash: string | null | undefined,
): void {
  const normalizedForSimilarity = normalizePhashForSimilarity(phash);
  if (!normalizedForSimilarity) return;
  context.roundPhashCandidates.push({
    phash: normalizedForSimilarity,
    roundId,
  });
}

function findSimilarLinkedRoundId(context: SyncMutableContext, phash: string): string | null {
  const similar = findBestSimilarPhashMatch(
    phash,
    context.roundPhashCandidates,
    (candidate) => candidate.phash,
  );
  return similar?.item.roundId ?? null;
}

function mergeRoundUpdateData(cachedRound: CachedRound, item: NormalizedSceneImportItem): Partial<typeof round.$inferInsert> {
  const data: Partial<typeof round.$inferInsert> = {};

  if (isMissingText(cachedRound.name) && !isMissingText(item.name)) {
    data.name = item.name;
    cachedRound.name = item.name;
  }

  if (isMissingText(cachedRound.author) && !isMissingText(item.author)) {
    data.author = item.author;
    cachedRound.author = item.author;
  }

  if (isMissingText(cachedRound.description) && !isMissingText(item.description)) {
    data.description = item.description;
    cachedRound.description = item.description;
  }

  if (isMissingText(cachedRound.phash) && !isMissingText(item.phash)) {
    data.phash = item.phash;
    cachedRound.phash = item.phash;
  }

  return data;
}

async function resolvePreviewImageForVideo(context: SyncMutableContext, videoUri: string): Promise<string | null> {
  const cached = context.previewByVideoUri.get(videoUri);
  if (cached !== undefined) {
    return cached;
  }

  const generated = await generateRoundPreviewImageDataUri({ videoUri });
  context.previewByVideoUri.set(videoUri, generated);
  return generated;
}

async function appendResourceIfMissing(
  context: SyncMutableContext,
  cachedRound: CachedRound,
  item: NormalizedSceneImportItem,
): Promise<number> {
  const existing = cachedRound.resourcesByVideoUri.get(item.videoUri);
  if (existing) {
    if (existing.disabled) {
      await context.db.update(resource).set({ disabled: false }).where(eq(resource.id, existing.id));
      existing.disabled = false;
    }
    return 0;
  }

  const [created] = await context.db.insert(resource).values({
    roundId: cachedRound.id,
    videoUri: item.videoUri,
    funscriptUri: item.funscriptUri,
    phash: item.phash,
    disabled: false,
  }).returning();

  cachedRound.resourcesByVideoUri.set(item.videoUri, { id: created.id, disabled: false });

  const phash = toNormalizedPhash(item.phash);
  if (phash && !context.roundIdByPhash.has(phash)) {
    context.roundIdByPhash.set(phash, cachedRound.id);
  }
  if (phash) {
    rememberRoundPhashCandidate(context, cachedRound.id, phash);
  }

  return 1;
}

function rememberRound(context: SyncMutableContext, cachedRound: CachedRound): void {
  context.roundById.set(cachedRound.id, cachedRound);

  const normalizedRoundPhash = toNormalizedPhash(cachedRound.phash);
  if (normalizedRoundPhash && !context.roundIdByPhash.has(normalizedRoundPhash)) {
    context.roundIdByPhash.set(normalizedRoundPhash, cachedRound.id);
  }
  if (normalizedRoundPhash) {
    rememberRoundPhashCandidate(context, cachedRound.id, normalizedRoundPhash);
  }

  if (cachedRound.installSourceKey) {
    context.roundIdByInstallSourceKey.set(cachedRound.installSourceKey, cachedRound.id);
  }
}

async function createManagedRound(
  context: SyncMutableContext,
  item: NormalizedSceneImportItem,
  heroId: string | null,
): Promise<{ round: CachedRound; resourcesAdded: number }> {
  const previewImage = await resolvePreviewImageForVideo(context, item.videoUri);

  const [createdRound] = await context.db.insert(round).values({
    name: item.name,
    author: item.author,
    description: item.description,
    phash: item.phash,
    previewImage,
    type: item.roundTypeFallback,
    heroId,
    installSourceKey: item.installSourceKey,
  }).returning();

  const [createdResource] = await context.db.insert(resource).values({
    roundId: createdRound.id,
    videoUri: item.videoUri,
    funscriptUri: item.funscriptUri,
    phash: item.phash,
    disabled: false,
  }).returning();

  const cached: CachedRound = {
    id: createdRound.id,
    name: createdRound.name,
    author: createdRound.author,
    description: createdRound.description,
    phash: createdRound.phash,
    previewImage: createdRound.previewImage,
    installSourceKey: createdRound.installSourceKey,
    resourcesByVideoUri: new Map([
      [createdResource.videoUri, { id: createdResource.id, disabled: createdResource.disabled }],
    ]),
  };

  rememberRound(context, cached);

  return {
    round: cached,
    resourcesAdded: 1,
  };
}

async function ingestScene(context: SyncMutableContext, item: NormalizedSceneImportItem): Promise<SceneIngestResult> {
  const existingManagedRoundId = context.roundIdByInstallSourceKey.get(item.installSourceKey);
  if (existingManagedRoundId) {
    const existingRound = context.roundById.get(existingManagedRoundId);
    if (!existingRound) {
      throw new Error(`Round cache inconsistency for '${item.installSourceKey}'.`);
    }

    const updateData = mergeRoundUpdateData(existingRound, item);
    if (!existingRound.previewImage) {
      const generatedPreview = await resolvePreviewImageForVideo(context, item.videoUri);
      if (generatedPreview) {
        updateData.previewImage = generatedPreview;
        existingRound.previewImage = generatedPreview;
      }
    }
    if (Object.keys(updateData).length > 0) {
      await context.db.update(round).set(updateData).where(eq(round.id, existingRound.id));
    }

    const resourcesAdded = await appendResourceIfMissing(context, existingRound, item);

    return {
      created: 0,
      updated: Object.keys(updateData).length > 0 ? 1 : 0,
      linked: 0,
      resourcesAdded,
      managedRoundId: existingRound.id,
    };
  }

  const phash = toNormalizedPhash(item.phash);

  if (phash) {
    const heroId = context.heroIdByPhash.get(phash) ?? null;
    if (heroId) {
      const created = await createManagedRound(context, item, heroId);
      return {
        created: 1,
        updated: 0,
        linked: 0,
        resourcesAdded: created.resourcesAdded,
        managedRoundId: created.round.id,
      };
    }
  }

  if (phash) {
    const matchedRoundId = context.roundIdByPhash.get(phash) ?? findSimilarLinkedRoundId(context, phash);
    if (matchedRoundId) {
      const matchedRound = context.roundById.get(matchedRoundId);
      if (matchedRound) {
        const updateData = mergeRoundUpdateData(matchedRound, item);
        if (!matchedRound.previewImage) {
          const generatedPreview = await resolvePreviewImageForVideo(context, item.videoUri);
          if (generatedPreview) {
            updateData.previewImage = generatedPreview;
            matchedRound.previewImage = generatedPreview;
          }
        }
        if (Object.keys(updateData).length > 0) {
          await context.db.update(round).set(updateData).where(eq(round.id, matchedRound.id));
        }

        const resourcesAdded = await appendResourceIfMissing(context, matchedRound, item);

        return {
          created: 0,
          updated: Object.keys(updateData).length > 0 ? 1 : 0,
          linked: 1,
          resourcesAdded,
          managedRoundId: null,
        };
      }
    }
  }

  const created = await createManagedRound(context, item, null);
  return {
    created: 1,
    updated: 0,
    linked: 0,
    resourcesAdded: created.resourcesAdded,
    managedRoundId: created.round.id,
  };
}

function pushSyncError(status: IntegrationSyncStatus, sourceId: string, message: string): void {
  status.stats.failed += 1;
  status.lastErrors.push({ sourceId, message });
}

async function buildSyncContext(status: IntegrationSyncStatus): Promise<SyncMutableContext> {
  const db = getDb();

  const [heroes, rounds] = await Promise.all([
    db.query.hero.findMany({ columns: { id: true, phash: true } }),
    db.query.round.findMany({
      columns: {
        id: true,
        name: true,
        author: true,
        description: true,
        phash: true,
        previewImage: true,
        installSourceKey: true,
      },
      with: {
        resources: {
          columns: {
            id: true,
            videoUri: true,
            phash: true,
            disabled: true,
          },
        },
      },
    }),
  ]);

  const heroIdByPhash = new Map<string, string>();
  for (const h of heroes) {
    const phash = toNormalizedPhash(h.phash);
    if (!phash || heroIdByPhash.has(phash)) continue;
    heroIdByPhash.set(phash, h.id);
  }

  const roundById = new Map<string, CachedRound>();
  const roundIdByPhash = new Map<string, string>();
  const roundPhashCandidates: Array<{ phash: string; roundId: string }> = [];
  const roundIdByInstallSourceKey = new Map<string, string>();

  for (const row of rounds) {
    const cached: CachedRound = {
      id: row.id,
      name: row.name,
      author: row.author,
      description: row.description,
      phash: row.phash,
      previewImage: row.previewImage,
      installSourceKey: row.installSourceKey,
      resourcesByVideoUri: new Map(
        row.resources.map((res) => [res.videoUri, { id: res.id, disabled: res.disabled }]),
      ),
    };

    roundById.set(cached.id, cached);

    if (cached.installSourceKey) {
      roundIdByInstallSourceKey.set(cached.installSourceKey, cached.id);
    }

    const roundPhash = toNormalizedPhash(cached.phash);
    if (roundPhash && !roundIdByPhash.has(roundPhash)) {
      roundIdByPhash.set(roundPhash, cached.id);
    }
    if (roundPhash) {
      const normalizedForSimilarity = normalizePhashForSimilarity(roundPhash);
      if (normalizedForSimilarity) {
        roundPhashCandidates.push({
          phash: normalizedForSimilarity,
          roundId: cached.id,
        });
      }
    }

    for (const res of row.resources) {
      const resourcePhash = toNormalizedPhash(res.phash);
      if (resourcePhash && !roundIdByPhash.has(resourcePhash)) {
        roundIdByPhash.set(resourcePhash, cached.id);
      }
      if (resourcePhash) {
        const normalizedForSimilarity = normalizePhashForSimilarity(resourcePhash);
        if (normalizedForSimilarity) {
          roundPhashCandidates.push({
            phash: normalizedForSimilarity,
            roundId: cached.id,
          });
        }
      }
    }
  }

  return {
    db,
    heroIdByPhash,
    roundById,
    roundIdByPhash,
    roundPhashCandidates,
    roundIdByInstallSourceKey,
    previewByVideoUri: new Map<string, string | null>(),
    status,
  };
}

async function runSync(triggeredBy: "startup" | "manual"): Promise<IntegrationSyncStatus> {
  const enabledSources = listExternalSources().filter((source) => source.enabled);

  const status: IntegrationSyncStatus = {
    ...createEmptyIntegrationSyncStatus(),
    state: "running",
    triggeredBy,
    startedAt: new Date().toISOString(),
    finishedAt: null,
    lastMessage: "Syncing external sources...",
  };

  setIntegrationSyncStatus(status);

  const context = await buildSyncContext(status);
  const disabledRoundIds = new Set(getDisabledRoundIds());

  status.stats.sourcesSeen = enabledSources.length;

  for (const source of enabledSources) {
    const provider = getProviderForKind(source);
    const managedPrefix = sourcePrefixForManagedRounds(source);

    const managedCandidates = await context.db.query.round.findMany({
      where: (r, { like }) => like(r.installSourceKey, `${managedPrefix}%`),
      columns: {
        id: true,
      },
    });

    const managedCandidateIds = managedCandidates.map((r) => r.id);
    const seenManagedRoundIds = new Set<string>();

    try {
      const syncContext: ExternalSyncContext = {
        ingestScene: async (item: NormalizedSceneImportItem) => {
          const result = await ingestScene(context, {
            ...item,
            installSourceKey: toStashInstallSourceKey(source.baseUrl, item.sceneId),
          });

          status.stats.roundsCreated += result.created;
          status.stats.roundsUpdated += result.updated;
          status.stats.roundsLinked += result.linked;
          status.stats.resourcesAdded += result.resourcesAdded;

          if (result.managedRoundId) {
            seenManagedRoundIds.add(result.managedRoundId);
            disabledRoundIds.delete(result.managedRoundId);
          }

          return result;
        },
        onSceneSeen: () => {
          status.stats.scenesSeen += 1;
        },
      };

      await provider.syncSource(source, syncContext);

      const seenIds = [...seenManagedRoundIds];
      if (seenIds.length > 0) {
        await context.db.update(resource).set({ disabled: false }).where(
          and(inArray(resource.roundId, seenIds), eq(resource.disabled, true))
        );
      }

      const staleManagedRoundIds = managedCandidateIds.filter((candidateId) => !seenManagedRoundIds.has(candidateId));
      if (staleManagedRoundIds.length > 0) {
        await context.db.update(resource).set({ disabled: true }).where(
          and(inArray(resource.roundId, staleManagedRoundIds), eq(resource.disabled, false))
        );
      }

      for (const candidateId of managedCandidateIds) {
        if (seenManagedRoundIds.has(candidateId)) continue;
        disabledRoundIds.add(candidateId);
      }

      status.stats.sourcesSynced += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown source sync error.";
      pushSyncError(status, source.id, message);
    }
  }

  status.stats.disabledRounds = disabledRoundIds.size;
  setDisabledRoundIds(disabledRoundIds);

  status.state = status.stats.failed > 0 ? "error" : "done";
  status.finishedAt = new Date().toISOString();
  status.lastMessage =
    status.state === "done"
      ? `Synced ${status.stats.sourcesSynced}/${status.stats.sourcesSeen} source(s).`
      : `Synced with ${status.stats.failed} error(s).`;

  setIntegrationSyncStatus(status);
  return status;
}

export function listSources(): ExternalSource[] {
  return listExternalSources();
}

export function createSource(input: CreateStashSourceInput): ExternalSource {
  return createStashSource(input);
}

export function updateSource(input: UpdateStashSourceInput): ExternalSource {
  return updateStashSource(input);
}

export function deleteSource(sourceId: string): void {
  deleteExternalSource(sourceId);
}

export function setSourceEnabled(input: { sourceId: string; enabled: boolean }): ExternalSource {
  return setExternalSourceEnabled(input.sourceId, input.enabled);
}

export async function testSourceConnection(sourceId: string): Promise<{ ok: true }> {
  const source = getExternalSourceById(sourceId);
  if (!source) {
    throw new Error("Source not found.");
  }

  return testStashConnection(source);
}

export async function searchSourceTags(input: {
  sourceId: string;
  query: string;
  page: number;
  perPage: number;
}): Promise<{ count: number; tags: Array<{ id: string; name: string }> }> {
  const source = getExternalSourceById(input.sourceId);
  if (!source) {
    throw new Error("Source not found.");
  }

  return searchStashTags(source, {
    query: input.query,
    page: input.page,
    perPage: input.perPage,
  });
}

export async function syncExternalSources(triggeredBy: "startup" | "manual"): Promise<IntegrationSyncStatus> {
  if (activeSyncPromise) {
    return activeSyncPromise;
  }

  activeSyncPromise = runSync(triggeredBy)
    .catch((error) => {
      const failed = getIntegrationSyncStatus();
      const next: IntegrationSyncStatus = {
        ...failed,
        state: "error",
        finishedAt: new Date().toISOString(),
        lastMessage: error instanceof Error ? error.message : "External sync failed.",
        lastErrors: [
          ...failed.lastErrors,
          {
            sourceId: "sync",
            message: error instanceof Error ? error.message : "External sync failed.",
          } satisfies IntegrationSyncError,
        ],
      };

      setIntegrationSyncStatus(next);
      return next;
    })
    .finally(() => {
      activeSyncPromise = null;
    });

  return activeSyncPromise;
}

export function getExternalSyncStatus(): IntegrationSyncStatus {
  return getIntegrationSyncStatus();
}

export function getDisabledRoundIdSet(): Set<string> {
  return new Set(getDisabledRoundIds());
}

export function resolveMediaUri(uri: string, purpose: MediaPurpose): string {
  const normalizedUri = normalizeNullableText(uri);
  if (!normalizedUri) return uri;

  const sources = listExternalSources().filter((source) => source.enabled);

  for (const source of sources) {
    const provider = getProviderForKind(source);
    if (!provider.canHandleUri(normalizedUri, source)) continue;
    return provider.resolvePlayableUri(normalizedUri, source, purpose);
  }

  return normalizedUri;
}

export function resolveResourceUris(resource: {
  videoUri: string;
  funscriptUri: string | null;
}): {
  videoUri: string;
  funscriptUri: string | null;
} {
  return {
    videoUri: resolveMediaUri(resource.videoUri, "video"),
    funscriptUri: resource.funscriptUri ? resolveMediaUri(resource.funscriptUri, "funscript") : null,
  };
}

function isTargetUrlAllowedForSource(targetUrl: string, source: ExternalSource): boolean {
  try {
    const target = new URL(targetUrl);
    const base = new URL(normalizeBaseUrl(source.baseUrl));

    if (target.origin !== base.origin) return false;

    const basePath = base.pathname.endsWith("/") ? base.pathname : `${base.pathname}/`;
    return target.pathname === base.pathname || target.pathname.startsWith(basePath);
  } catch {
    return false;
  }
}

export async function proxyExternalRequest(request: Request): Promise<Response> {
  const parsedRequest = new URL(request.url);
  const providerSlug = parsedRequest.pathname.replace(/^\/+/, "").toLowerCase();

  if (providerSlug !== "stash") {
    return new Response("Unsupported external provider.", { status: 404 });
  }

  if (request.method !== "GET" && request.method !== "HEAD") {
    return new Response("Unsupported proxy method.", {
      status: 405,
      headers: {
        Allow: "GET, HEAD",
      },
    });
  }

  const sourceId = normalizeNullableText(parsedRequest.searchParams.get("sourceId"));
  const target = normalizeNullableText(parsedRequest.searchParams.get("target"));

  if (!sourceId || !target) {
    return new Response("Missing sourceId or target.", { status: 400 });
  }

  const source = getExternalSourceById(sourceId);
  if (!source || !source.enabled) {
    return new Response("Source not found or disabled.", { status: 404 });
  }

  if (!isTargetUrlAllowedForSource(target, source)) {
    return new Response("Target URL is outside the source base URL.", { status: 403 });
  }

  try {
    const upstream = await fetchStashMediaWithAuth(source, target, request);
    return upstream;
  } catch (error) {
    const message = error instanceof Error ? error.message : "External proxy error.";
    return new Response(message, { status: 502 });
  }
}

export function inferRoundSourceLabel(input: { installSourceKey: string | null }): "stash" | "local" {
  if (input.installSourceKey?.startsWith("stash:")) {
    return "stash";
  }

  return "local";
}

type RoundType = "Normal" | "Interjection" | "Cum";

export function coerceRoundType(value: string | null | undefined): RoundType {
  if (value === "Interjection") return "Interjection";
  if (value === "Cum") return "Cum";
  return "Normal";
}
