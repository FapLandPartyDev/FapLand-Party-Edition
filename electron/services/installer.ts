import crypto from "node:crypto";
import type { Dirent } from "node:fs";
import fs from "node:fs/promises";
import { availableParallelism } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ZodError } from "zod";
import { isVideoExtension } from "../../src/constants/videoFormats";
import { type PortableRoundRef } from "../../src/game/playlistSchema";
import { findBestSimilarPhashMatch, normalizePhashForSimilarity } from "../../src/utils/phashSimilarity";
import { ZHeroSidecar, ZRoundSidecar, type InstallResource, type InstallRound } from "../../src/zod/installSidecar";
import { approveDialogPath, assertApprovedDialogPath } from "./dialogPathApproval";
import { getDb } from "./db";
import { eq, asc, isNotNull } from "drizzle-orm";
import { hero, round, resource } from "./db/schema";
export type RoundType = "Normal" | "Interjection" | "Cum";
type TransactionClient = Parameters<Parameters<ReturnType<typeof getDb>['transaction']>[0]>[0];
import {
    generateVideoPhash,
    generateVideoPhashForNormalizedRange,
    getNormalizedVideoHashRange,
    toVideoHashRangeCacheKey,
    type NormalizedVideoHashRange,
} from "./phash";
import { getStore } from "./store";
import { syncExternalSources } from "./integrations";
import { generateRoundPreviewImageDataUri } from "./roundPreview";

const AUTO_SCAN_FOLDERS_KEY = "install.autoScanFolders";
const MAX_TRACKED_ERRORS = 50;
const SIDECAR_EXTENSIONS = new Set([".round", ".hero"]);

export function isSupportedVideoFileExtension(extension: string): boolean {
    return isVideoExtension(extension);
}

type PreparedResource = {
    videoUri: string;
    funscriptUri: string | null;
    phash: string | null;
};

type PreparedRoundResources = {
    resources: PreparedResource[];
    computedRoundPhash: string | null;
    previewImage: string | null;
};

type HeroMetadataInput = {
    name: string;
    author?: string | null;
    description?: string | null;
    phash?: string | null;
};

type SidecarRoundData = {
    name: string;
    author: string | null;
    description: string | null;
    bpm: number | null;
    difficulty: number | null;
    phash: string | null;
    startTime: number | null;
    endTime: number | null;
    type: RoundType;
    resources: InstallResource[];
};

type VideoRangeResolution = {
    normalizedPath: string;
    normalizedRange: NormalizedVideoHashRange | null;
    normalizedStartTimeMs?: number;
    normalizedEndTimeMs?: number;
    cacheKey: string;
};

type ExistingHeroCacheEntry = {
    id: string;
    author: string | null;
    description: string | null;
    phash: string | null;
};

type ExistingRoundCacheEntry = {
    id: string;
    previewImage: string | null;
};

type SimilarPhashCandidate = {
    videoUri: string;
    phash: string;
};

type PreparedRoundWrite = {
    installSourceKey: string;
    round: SidecarRoundData;
    resources: PreparedResource[];
    previewImage: string | null;
};

type PreparedInstallEntry = {
    heroInput: HeroMetadataInput | null;
    writes: PreparedRoundWrite[];
};

type InstallSessionContext = {
    db: ReturnType<typeof getDb>;
    heroByName: Map<string, ExistingHeroCacheEntry>;
    roundByInstallSourceKey: Map<string, ExistingRoundCacheEntry>;
    exactVideoUriByPhash: Map<string, string>;
    similarPhashCandidates: SimilarPhashCandidate[];
    hashCache: Map<string, Promise<string>>;
    previewCache: Map<string, Promise<string | null>>;
    normalizedRangeCache: Map<string, Promise<VideoRangeResolution>>;
    prepConcurrency: number;
};

type PreparedLegacyEntry =
    | {
        kind: "checkpoint";
        label: string;
    }
    | {
        kind: "round";
        sourcePath: string;
        write: PreparedRoundWrite;
    };

export type InstallScanState = "idle" | "running" | "done" | "aborted" | "error";
export type InstallScanTrigger = "startup" | "manual";

export type InstallScanStats = {
    scannedFolders: number;
    sidecarsSeen: number;
    installed: number;
    updated: number;
    skipped: number;
    failed: number;
};

export type InstallScanError = {
    source: string;
    reason: string;
};

export type InstallScanStatus = {
    state: InstallScanState;
    triggeredBy: InstallScanTrigger;
    startedAt: string | null;
    finishedAt: string | null;
    stats: InstallScanStats;
    lastMessage: string | null;
    lastErrors: InstallScanError[];
};

export type LegacyInstallImport = {
    roundIds: string[];
    playlistNameHint: string;
    orderedSlots: LegacyImportSlot[];
};

export type LegacyImportSlotPreview = {
    id: string;
    sourcePath: string;
    sourceLabel: string;
    originalOrder: number;
    defaultCheckpoint: boolean;
};

export type ReviewedLegacyImportSlot = {
    id: string;
    sourcePath: string;
    originalOrder: number;
    selectedAsCheckpoint: boolean;
    excludedFromImport: boolean;
};

export type InstallFolderInspectionResult =
    | {
        kind: "sidecar";
        folderPath: string;
        playlistNameHint: string;
        sidecarCount: number;
    }
    | {
        kind: "legacy";
        folderPath: string;
        playlistNameHint: string;
        legacySlots: LegacyImportSlotPreview[];
    }
    | {
        kind: "empty";
        folderPath: string;
        playlistNameHint: string;
    };

export type LegacyImportSlot =
    | {
        kind: "round";
        ref: PortableRoundRef;
    }
    | {
        kind: "checkpoint";
        label: string;
        restDurationMs?: number | null;
    };

export type InstallFolderScanResult = {
    status: InstallScanStatus;
    legacyImport?: LegacyInstallImport;
};

let activeScanPromise: Promise<InstallScanStatus> | null = null;
let activeManualFolderImport = false;
let abortRequested = false;
let scanStatus: InstallScanStatus = {
    state: "idle",
    triggeredBy: "manual",
    startedAt: null,
    finishedAt: null,
    stats: emptyStats(),
    lastMessage: null,
    lastErrors: [],
};

function emptyStats(): InstallScanStats {
    return {
        scannedFolders: 0,
        sidecarsSeen: 0,
        installed: 0,
        updated: 0,
        skipped: 0,
        failed: 0,
    };
}

function cloneStatus(status: InstallScanStatus): InstallScanStatus {
    return JSON.parse(JSON.stringify(status)) as InstallScanStatus;
}

function getPreparationConcurrency(): number {
    try {
        return Math.min(4, Math.max(2, availableParallelism() - 1));
    } catch {
        return 3;
    }
}

async function createInstallSessionContext(): Promise<InstallSessionContext> {
    const db = getDb();
    const [heroes, existingRounds, existingResources] = await Promise.all([
        db.query.hero.findMany({
            columns: {
                id: true,
                name: true,
                author: true,
                description: true,
                phash: true,
            },
        }),
        db.query.round.findMany({
            where: isNotNull(round.installSourceKey),
            columns: {
                id: true,
                installSourceKey: true,
                previewImage: true,
            },
        }),
        db.query.resource.findMany({
            where: isNotNull(resource.phash),
            orderBy: [asc(resource.createdAt)],
            columns: {
                videoUri: true,
                phash: true,
            },
        }),
    ]);

    const heroByName = new Map<string, ExistingHeroCacheEntry>();
    for (const entry of heroes) {
        heroByName.set(entry.name, {
            id: entry.id,
            author: entry.author,
            description: entry.description,
            phash: entry.phash,
        });
    }

    const roundByInstallSourceKey = new Map<string, ExistingRoundCacheEntry>();
    for (const entry of existingRounds) {
        const installSourceKey = normalizeText(entry.installSourceKey);
        if (!installSourceKey) continue;
        roundByInstallSourceKey.set(installSourceKey, {
            id: entry.id,
            previewImage: entry.previewImage,
        });
    }

    const exactVideoUriByPhash = new Map<string, string>();
    const similarPhashCandidates: SimilarPhashCandidate[] = [];
    for (const entry of existingResources) {
        const normalizedPhash = normalizeText(entry.phash);
        if (!normalizedPhash) continue;

        if (!exactVideoUriByPhash.has(normalizedPhash)) {
            exactVideoUriByPhash.set(normalizedPhash, entry.videoUri);
        }

        const normalizedForSimilarity = normalizePhashForSimilarity(normalizedPhash);
        if (normalizedForSimilarity) {
            similarPhashCandidates.push({
                videoUri: entry.videoUri,
                phash: normalizedForSimilarity,
            });
        }
    }

    return {
        db,
        heroByName,
        roundByInstallSourceKey,
        exactVideoUriByPhash,
        similarPhashCandidates,
        hashCache: new Map(),
        previewCache: new Map(),
        normalizedRangeCache: new Map(),
        prepConcurrency: getPreparationConcurrency(),
    };
}

function rememberPromise<K, V>(cache: Map<K, Promise<V>>, key: K, factory: () => Promise<V>): Promise<V> {
    const existing = cache.get(key);
    if (existing) return existing;

    const pending = Promise.resolve().then(factory);
    cache.set(key, pending);
    pending.catch(() => {
        if (cache.get(key) === pending) {
            cache.delete(key);
        }
    });
    return pending;
}

async function mapWithConcurrencyLimit<T, R>(
    items: readonly T[],
    limit: number,
    mapper: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
    if (items.length === 0) return [];

    const results = new Array<R>(items.length);
    let nextIndex = 0;
    let activeCount = 0;

    return await new Promise<R[]>((resolve, reject) => {
        let rejected = false;

        const launch = () => {
            if (rejected) return;
            if (nextIndex >= items.length) {
                if (activeCount === 0) {
                    resolve(results);
                }
                return;
            }

            while (activeCount < limit && nextIndex < items.length) {
                const currentIndex = nextIndex;
                nextIndex += 1;
                activeCount += 1;

                Promise.resolve(mapper(items[currentIndex] as T, currentIndex))
                    .then((result) => {
                        results[currentIndex] = result;
                        activeCount -= 1;
                        launch();
                    })
                    .catch((error) => {
                        rejected = true;
                        reject(error);
                    });
            }
        };

        launch();
    });
}

function normalizeText(value: string | null | undefined): string | null {
    if (typeof value !== "string") return null;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
}

function toAppMediaUri(filePath: string): string {
    return `app://media/${encodeURIComponent(path.resolve(filePath))}`;
}

function fromAppUriToPath(uri: string): string | null {
    try {
        const parsed = new URL(uri);
        if (parsed.protocol === "app:" && parsed.hostname === "media") {
            const decoded = decodeURIComponent(parsed.pathname.slice(1));
            if (!decoded) return null;
            if (process.platform === "win32" && /^\/[A-Za-z]:/.test(decoded)) {
                return path.normalize(decoded.slice(1));
            }
            return path.normalize(decoded);
        }

        if (parsed.protocol === "file:") {
            return fileURLToPath(parsed);
        }

        return null;
    } catch {
        return null;
    }
}

function normalizeScanFolder(input: string): string {
    const resolved = path.resolve(input.trim());
    return path.normalize(resolved);
}

const legacyFilenameCollator = new Intl.Collator(undefined, { sensitivity: "base", numeric: true });

function parseStoredFolderList(raw: unknown): string[] {
    if (!Array.isArray(raw)) return [];

    const deduped = new Set<string>();
    for (const entry of raw) {
        if (typeof entry !== "string") continue;
        const trimmed = entry.trim();
        if (!trimmed) continue;
        deduped.add(normalizeScanFolder(trimmed));
    }

    return Array.from(deduped);
}

async function isDirectory(folderPath: string): Promise<boolean> {
    try {
        const stat = await fs.stat(folderPath);
        return stat.isDirectory();
    } catch {
        return false;
    }
}

async function isFile(filePath: string): Promise<boolean> {
    try {
        const stat = await fs.stat(filePath);
        return stat.isFile();
    } catch {
        return false;
    }
}

async function fileExists(filePath: string): Promise<boolean> {
    try {
        await fs.access(filePath);
        return true;
    } catch {
        return false;
    }
}

function pushScanError(status: InstallScanStatus, source: string, reason: string): void {
    status.stats.failed += 1;
    if (status.lastErrors.length >= MAX_TRACKED_ERRORS) return;
    status.lastErrors.push({ source, reason });
}

function updateRunningScanMessage(message: string): void {
    if (scanStatus.state !== "running") return;
    scanStatus = {
        ...scanStatus,
        lastMessage: message,
    };
}

function formatZodError(error: ZodError): string {
    return error.issues
        .map((issue) => {
            const issuePath = issue.path.length > 0 ? issue.path.join(".") : "$";
            return `${issuePath}: ${issue.message}`;
        })
        .join("; ");
}

class InstallAbortError extends Error {
    constructor() {
        super("Install aborted.");
        this.name = "InstallAbortError";
    }
}

function throwIfAbortRequested(): void {
    if (abortRequested) {
        throw new InstallAbortError();
    }
}

async function collectSidecarFiles(folderPath: string): Promise<string[]> {
    const output: string[] = [];
    const queue = [folderPath];

    while (queue.length > 0) {
        throwIfAbortRequested();
        const current = queue.pop();
        if (!current) continue;

        let entries: Dirent[];
        try {
            entries = await fs.readdir(current, { withFileTypes: true });
        } catch {
            continue;
        }

        for (const entry of entries) {
            const fullPath = path.join(current, entry.name);
            if (entry.isDirectory()) {
                queue.push(fullPath);
                continue;
            }

            if (!entry.isFile()) continue;
            const ext = path.extname(entry.name).toLowerCase();
            if (SIDECAR_EXTENSIONS.has(ext)) {
                output.push(fullPath);
            }
        }
    }

    output.sort((a, b) => a.localeCompare(b));
    return output;
}

async function findSiblingVideo(basePath: string): Promise<string | null> {
    throwIfAbortRequested();
    const directory = path.dirname(basePath);
    const baseName = path.basename(basePath);

    let entries: Dirent[];
    try {
        entries = await fs.readdir(directory, { withFileTypes: true });
    } catch {
        return null;
    }

    for (const entry of entries) {
        if (!entry.isFile()) continue;
        const parsed = path.parse(entry.name);
        if (parsed.name !== baseName) continue;
        if (!isSupportedVideoFileExtension(parsed.ext)) continue;
        return path.join(directory, entry.name);
    }

    return null;
}

async function computeSha256(filePath: string): Promise<string> {
    throwIfAbortRequested();
    const content = await fs.readFile(filePath);
    throwIfAbortRequested();
    return crypto.createHash("sha256").update(content).digest("hex");
}

function toOptionalMs(value: number | null | undefined): number | undefined {
    if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
    return Math.floor(value);
}

function toShaFallbackSuffix(
    normalizedRange: NormalizedVideoHashRange | null,
    startTimeMs?: number,
    endTimeMs?: number,
): string | null {
    if (normalizedRange && !normalizedRange.isFullVideo) {
        return `${normalizedRange.startTimeMs}-${normalizedRange.endTimeMs}`;
    }

    if (normalizedRange) {
        return null;
    }

    if (typeof startTimeMs === "number" || typeof endTimeMs === "number") {
        return `${startTimeMs ?? 0}-${endTimeMs ?? -1}`;
    }

    return null;
}

function getRawVideoRangeCacheKey(
    localVideoPath: string,
    startTimeMs?: number | null,
    endTimeMs?: number | null,
): string {
    const normalizedPath = path.normalize(localVideoPath);
    const normalizedStartTimeMs = toOptionalMs(startTimeMs);
    const normalizedEndTimeMs = toOptionalMs(endTimeMs);
    return `${normalizedPath}#raw:${normalizedStartTimeMs ?? ""}-${normalizedEndTimeMs ?? ""}`;
}

async function resolveVideoRange(
    context: InstallSessionContext,
    localVideoPath: string,
    startTimeMs?: number | null,
    endTimeMs?: number | null,
): Promise<VideoRangeResolution> {
    const rawKey = getRawVideoRangeCacheKey(localVideoPath, startTimeMs, endTimeMs);
    return rememberPromise(context.normalizedRangeCache, rawKey, async () => {
        throwIfAbortRequested();
        const normalizedPath = path.normalize(localVideoPath);
        const normalizedStartTimeMs = toOptionalMs(startTimeMs);
        const normalizedEndTimeMs = toOptionalMs(endTimeMs);

        let normalizedRange: NormalizedVideoHashRange | null = null;
        let cacheKey = rawKey;

        try {
            normalizedRange = await getNormalizedVideoHashRange(
                normalizedPath,
                normalizedStartTimeMs,
                normalizedEndTimeMs,
            );
            cacheKey = toVideoHashRangeCacheKey(normalizedPath, normalizedRange);
        } catch {
            normalizedRange = null;
        }

        return {
            normalizedPath,
            normalizedRange,
            normalizedStartTimeMs,
            normalizedEndTimeMs,
            cacheKey,
        };
    });
}

async function computeVideoHash(
    context: InstallSessionContext,
    localVideoPath: string,
    startTimeMs?: number | null,
    endTimeMs?: number | null,
): Promise<string> {
    const range = await resolveVideoRange(context, localVideoPath, startTimeMs, endTimeMs);
    return rememberPromise(context.hashCache, range.cacheKey, async () => {
        let resolvedHash: string | null = null;

        try {
            throwIfAbortRequested();
            const phash = range.normalizedRange
                ? await generateVideoPhashForNormalizedRange(range.normalizedPath, range.normalizedRange)
                : await generateVideoPhash(range.normalizedPath, range.normalizedStartTimeMs, range.normalizedEndTimeMs);
            const trimmed = typeof phash === "string" ? phash.trim() : "";
            if (trimmed.length > 0) {
                resolvedHash = trimmed;
            }
        } catch {
            resolvedHash = null;
        }

        if (!resolvedHash) {
            throwIfAbortRequested();
            const baseHash = `sha256:${await computeSha256(range.normalizedPath)}`;
            const suffix = toShaFallbackSuffix(
                range.normalizedRange,
                range.normalizedStartTimeMs,
                range.normalizedEndTimeMs,
            );
            resolvedHash = suffix ? `${baseHash}@${suffix}` : baseHash;
        }

        return resolvedHash;
    });
}

async function computePreviewImage(
    context: InstallSessionContext,
    videoUri: string,
    startTimeMs?: number | null,
    endTimeMs?: number | null,
): Promise<string | null> {
    const localVideoPath = fromAppUriToPath(videoUri);
    let cacheKey = `${videoUri}#raw:${toOptionalMs(startTimeMs) ?? ""}-${toOptionalMs(endTimeMs) ?? ""}`;

    if (localVideoPath) {
        const range = await resolveVideoRange(context, localVideoPath, startTimeMs, endTimeMs);
        cacheKey = `preview:${range.cacheKey}`;
    }

    return rememberPromise(context.previewCache, cacheKey, async () => {
        throwIfAbortRequested();
        return await generateRoundPreviewImageDataUri({
            videoUri,
            startTimeMs,
            endTimeMs,
        });
    });
}

function toRoundType(input: string | null | undefined): RoundType {
    if (input === "Interjection") return "Interjection";
    if (input === "Cum") return "Cum";
    return "Normal";
}

function normalizeRoundData(input: InstallRound): SidecarRoundData {
    return {
        name: input.name,
        author: normalizeText(input.author),
        description: normalizeText(input.description),
        bpm: typeof input.bpm === "number" ? input.bpm : null,
        difficulty: typeof input.difficulty === "number" ? input.difficulty : null,
        phash: normalizeText(input.phash),
        startTime: typeof input.startTime === "number" ? input.startTime : null,
        endTime: typeof input.endTime === "number" ? input.endTime : null,
        type: toRoundType(input.type),
        resources: input.resources,
    };
}

async function prepareRoundResources(
    context: InstallSessionContext,
    sidecarPath: string,
    round: SidecarRoundData,
    allowLocalFallback: boolean,
): Promise<PreparedRoundResources> {
    throwIfAbortRequested();
    const explicitRoundPhash = normalizeText(round.phash);
    const resources: Array<{
        videoUri: string;
        funscriptUri: string | null;
        localVideoPath: string | null;
    }> = [];

    if (round.resources.length > 0) {
        for (const resource of round.resources) {
            throwIfAbortRequested();
            resources.push({
                videoUri: resource.videoUri,
                funscriptUri: normalizeText(resource.funscriptUri),
                localVideoPath: fromAppUriToPath(resource.videoUri),
            });
        }
    } else if (allowLocalFallback) {
        throwIfAbortRequested();
        const basePath = sidecarPath.replace(/\.(round|hero)$/i, "");
        const localVideoPath = await findSiblingVideo(basePath);
        if (!localVideoPath) {
            throw new Error("No resource defined and no same-basename local video file found.");
        }

        const funscriptPath = `${basePath}.funscript`;
        const localFunscriptExists = await fileExists(funscriptPath);

        resources.push({
            videoUri: toAppMediaUri(localVideoPath),
            funscriptUri: localFunscriptExists ? toAppMediaUri(funscriptPath) : null,
            localVideoPath,
        });
    }

    if (resources.length === 0) {
        throw new Error("Round has no resources.");
    }

    const previewSourceResource = resources[0];
    const [prepared, previewImage] = await Promise.all([
        Promise.all(resources.map(async (resource) => {
            throwIfAbortRequested();
            let resolvedPhash: string | null = explicitRoundPhash;

            if (!resolvedPhash && resource.localVideoPath) {
                resolvedPhash = await computeVideoHash(
                    context,
                    resource.localVideoPath,
                    round.startTime,
                    round.endTime,
                );
            }

            return {
                videoUri: resource.videoUri,
                funscriptUri: resource.funscriptUri,
                phash: resolvedPhash,
            } satisfies PreparedResource;
        })),
        previewSourceResource
            ? computePreviewImage(
                context,
                previewSourceResource.videoUri,
                round.startTime,
                round.endTime,
            )
            : Promise.resolve(null),
    ]);

    const computedRoundPhash =
        explicitRoundPhash ??
        prepared.find((resource) => normalizeText(resource.phash))?.phash ??
        null;

    return {
        resources: prepared,
        computedRoundPhash,
        previewImage,
    };
}

async function ensureHeroWithMissingMetadata(
    tx: TransactionClient,
    context: InstallSessionContext,
    heroInput: HeroMetadataInput,
): Promise<string> {
    const normalizedAuthor = normalizeText(heroInput.author);
    const normalizedDescription = normalizeText(heroInput.description);
    const normalizedPhash = normalizeText(heroInput.phash);

    const existing = context.heroByName.get(heroInput.name);
    if (!existing) {
        const [created] = await tx.insert(hero).values({
            name: heroInput.name,
            author: normalizedAuthor,
            description: normalizedDescription,
            phash: normalizedPhash,
        }).returning({ id: hero.id });
        context.heroByName.set(heroInput.name, {
            id: created.id,
            author: normalizedAuthor,
            description: normalizedDescription,
            phash: normalizedPhash,
        });
        return created.id;
    }

    const updateData: Partial<typeof hero.$inferInsert> = {};
    if (!normalizeText(existing.author) && normalizedAuthor) {
        updateData.author = normalizedAuthor;
    }
    if (!normalizeText(existing.description) && normalizedDescription) {
        updateData.description = normalizedDescription;
    }
    if (!normalizeText(existing.phash) && normalizedPhash) {
        updateData.phash = normalizedPhash;
    }

    if (Object.keys(updateData).length > 0) {
        await tx.update(hero).set(updateData).where(eq(hero.id, existing.id));
        context.heroByName.set(heroInput.name, {
            id: existing.id,
            author: updateData.author ?? existing.author,
            description: updateData.description ?? existing.description,
            phash: updateData.phash ?? existing.phash,
        });
    }

    return existing.id;
}

function rememberCanonicalResource(
    context: InstallSessionContext,
    videoUri: string,
    phash: string | null,
): void {
    const normalizedPhash = normalizeText(phash);
    if (!normalizedPhash) return;

    if (!context.exactVideoUriByPhash.has(normalizedPhash)) {
        context.exactVideoUriByPhash.set(normalizedPhash, videoUri);
    }

    const normalizedForSimilarity = normalizePhashForSimilarity(normalizedPhash);
    if (normalizedForSimilarity) {
        context.similarPhashCandidates.push({
            videoUri,
            phash: normalizedForSimilarity,
        });
    }
}

async function upsertRoundWithResources(
    tx: TransactionClient,
    context: InstallSessionContext,
    params: {
        installSourceKey: string;
        round: SidecarRoundData;
        heroId: string | null;
        resources: PreparedResource[];
        previewImage?: string | null;
    },
): Promise<{ updated: boolean; roundId: string }> {
    throwIfAbortRequested();
    const existingRound = context.roundByInstallSourceKey.get(params.installSourceKey) ?? null;
    const previewImage =
        params.previewImage === null && existingRound?.previewImage
            ? existingRound.previewImage
            : params.previewImage ?? null;

    const roundPayload = {
        name: params.round.name,
        author: params.round.author,
        description: params.round.description,
        bpm: params.round.bpm,
        difficulty: params.round.difficulty,
        phash: params.round.phash,
        startTime: params.round.startTime,
        endTime: params.round.endTime,
        type: params.round.type,
        heroId: params.heroId,
        installSourceKey: params.installSourceKey,
        previewImage,
    };

    let roundId = "";
    if (existingRound) {
        const [updated] = await tx.update(round).set({ ...roundPayload, updatedAt: new Date() })
            .where(eq(round.id, existingRound.id)).returning({ id: round.id });
        roundId = updated.id;
    } else {
        const [inserted] = await tx.insert(round).values(roundPayload).returning({ id: round.id });
        roundId = inserted.id;
    }
    context.roundByInstallSourceKey.set(params.installSourceKey, {
        id: roundId,
        previewImage,
    });

    const dedupedResources: PreparedResource[] = [];
    for (const res of params.resources) {
        throwIfAbortRequested();
        let canonicalVideoUri = res.videoUri;
        if (res.phash) {
            const existing = context.exactVideoUriByPhash.get(res.phash);
            if (existing) {
                canonicalVideoUri = existing;
            } else {
                const normalizedPhash = normalizePhashForSimilarity(res.phash);
                if (normalizedPhash) {
                    const similarMatch = findBestSimilarPhashMatch(
                        normalizedPhash,
                        context.similarPhashCandidates,
                        (candidate) => candidate.phash,
                    );
                    if (similarMatch?.item.videoUri) {
                        canonicalVideoUri = similarMatch.item.videoUri;
                    }
                }
            }
        }

        dedupedResources.push({
            videoUri: canonicalVideoUri,
            funscriptUri: res.funscriptUri,
            phash: res.phash,
        });
    }

    await tx.delete(resource).where(eq(resource.roundId, roundId));

    if (dedupedResources.length > 0) {
        await tx.insert(resource).values(dedupedResources.map((r) => ({
            roundId,
            videoUri: r.videoUri,
            funscriptUri: r.funscriptUri,
            phash: r.phash,
        })));

        for (const entry of dedupedResources) {
            rememberCanonicalResource(context, entry.videoUri, entry.phash);
        }
    }

    return { updated: Boolean(existingRound), roundId };
}

async function prepareRoundWrite(
    context: InstallSessionContext,
    installSourceKey: string,
    sidecarPath: string,
    roundInput: InstallRound,
    allowLocalFallback: boolean,
): Promise<PreparedRoundWrite> {
    const normalizedRound = normalizeRoundData(roundInput);
    const prepared = await prepareRoundResources(context, sidecarPath, normalizedRound, allowLocalFallback);

    return {
        installSourceKey,
        round: normalizedRound.phash || !prepared.computedRoundPhash
            ? normalizedRound
            : { ...normalizedRound, phash: prepared.computedRoundPhash },
        resources: prepared.resources,
        previewImage: prepared.previewImage,
    };
}

async function prepareRoundSidecar(
    context: InstallSessionContext,
    sidecarPath: string,
): Promise<PreparedInstallEntry> {
    throwIfAbortRequested();
    const content = await fs.readFile(sidecarPath, "utf8");
    const parsedJson = JSON.parse(content) as unknown;
    const parsed = ZRoundSidecar.safeParse(parsedJson);

    if (!parsed.success) {
        throw parsed.error;
    }

    return {
        heroInput: parsed.data.hero ?? null,
        writes: [
            await prepareRoundWrite(
                context,
                path.resolve(sidecarPath),
                sidecarPath,
                parsed.data,
                true,
            ),
        ],
    };
}

async function prepareHeroSidecar(
    context: InstallSessionContext,
    sidecarPath: string,
): Promise<PreparedInstallEntry> {
    throwIfAbortRequested();
    const content = await fs.readFile(sidecarPath, "utf8");
    const parsedJson = JSON.parse(content) as unknown;
    const parsed = ZHeroSidecar.safeParse(parsedJson);

    if (!parsed.success) {
        throw parsed.error;
    }

    return {
        heroInput: parsed.data,
        writes: await Promise.all(
            parsed.data.rounds.map(async (entry, index) => {
                throwIfAbortRequested();
                return await prepareRoundWrite(
                    context,
                    `${path.resolve(sidecarPath)}#${index}`,
                    sidecarPath,
                    { ...entry, hero: undefined },
                    false,
                );
            }),
        ),
    };
}

async function prepareSidecar(
    context: InstallSessionContext,
    sidecarPath: string,
): Promise<PreparedInstallEntry> {
    throwIfAbortRequested();
    const ext = path.extname(sidecarPath).toLowerCase();
    if (ext === ".round") {
        return await prepareRoundSidecar(context, sidecarPath);
    }

    if (ext === ".hero") {
        return await prepareHeroSidecar(context, sidecarPath);
    }

    return {
        heroInput: null,
        writes: [],
    };
}

async function persistPreparedEntry(
    context: InstallSessionContext,
    entry: PreparedInstallEntry,
): Promise<{ installed: number; updated: number; roundIds: string[] }> {
    return await context.db.transaction(async (tx) => {
        let heroId: string | null = null;
        if (entry.heroInput) {
            heroId = await ensureHeroWithMissingMetadata(tx, context, entry.heroInput);
        }

        let installed = 0;
        let updated = 0;
        const roundIds: string[] = [];

        for (const payload of entry.writes) {
            throwIfAbortRequested();
            const upserted = await upsertRoundWithResources(tx, context, {
                installSourceKey: payload.installSourceKey,
                round: payload.round,
                heroId,
                resources: payload.resources,
                previewImage: payload.previewImage,
            });
            roundIds.push(upserted.roundId);

            if (upserted.updated) {
                updated += 1;
            } else {
                installed += 1;
            }
        }

        return { installed, updated, roundIds };
    });
}

async function prepareLegacyRoundEntry(
    context: InstallSessionContext,
    sourcePath: string,
): Promise<PreparedLegacyEntry> {
    const absoluteVideoPath = path.resolve(sourcePath);
    const parsed = path.parse(absoluteVideoPath);
    const funscriptPath = path.join(parsed.dir, `${parsed.name}.funscript`);
    const hasFunscript = await fileExists(funscriptPath);

    return {
        kind: "round",
        sourcePath: absoluteVideoPath,
        write: await prepareRoundWrite(
            context,
            `legacy:${absoluteVideoPath}`,
            absoluteVideoPath,
            {
                name: parsed.name,
                author: null,
                description: null,
                bpm: null,
                difficulty: null,
                phash: null,
                startTime: null,
                endTime: null,
                type: "Normal",
                resources: [{
                    videoUri: toAppMediaUri(absoluteVideoPath),
                    funscriptUri: hasFunscript ? toAppMediaUri(funscriptPath) : null,
                }],
            },
            false,
        ),
    };
}

function recordInstallError(status: InstallScanStatus, source: string, error: unknown): void {
    if (error instanceof ZodError) {
        pushScanError(status, source, `Validation failed: ${formatZodError(error)}`);
        return;
    }

    if (error instanceof SyntaxError) {
        pushScanError(status, source, `Invalid JSON: ${error.message}`);
        return;
    }

    const message = error instanceof Error ? error.message : "Unknown installation error.";
    pushScanError(status, source, message);
}

function toPortableRoundRef(input: {
    roundId: string;
    installSourceKey: string;
    phash: string | null;
    name: string;
    author: string | null;
    type: RoundType;
}): PortableRoundRef {
    return {
        idHint: input.roundId,
        installSourceKeyHint: input.installSourceKey,
        phash: normalizeText(input.phash) ?? undefined,
        name: input.name,
        author: normalizeText(input.author) ?? undefined,
        type: input.type,
    };
}

async function collectLegacyVideoFiles(folderPath: string): Promise<string[]> {
    throwIfAbortRequested();
    let entries: Dirent[];
    try {
        entries = await fs.readdir(folderPath, { withFileTypes: true });
    } catch {
        return [];
    }

    const files = entries
        .filter((entry) => entry.isFile())
        .filter((entry) => isSupportedVideoFileExtension(path.extname(entry.name).toLowerCase()))
        .map((entry) => path.join(folderPath, entry.name));

    files.sort((a, b) => {
        const byName = legacyFilenameCollator.compare(path.basename(a), path.basename(b));
        if (byName !== 0) return byName;
        return a.localeCompare(b);
    });
    return files;
}

function isLegacyCheckpointName(name: string): boolean {
    return name.toLowerCase().includes("checkpoint");
}

function buildLegacySlotPreview(videoPaths: string[]): LegacyImportSlotPreview[] {
    return videoPaths.map((videoPath, index) => {
        const parsed = path.parse(path.resolve(videoPath));
        return {
            id: `legacy-slot:${index}:${parsed.base.toLowerCase()}`,
            sourcePath: path.resolve(videoPath),
            sourceLabel: parsed.name,
            originalOrder: index,
            defaultCheckpoint: isLegacyCheckpointName(parsed.name),
        };
    });
}

function toPlaylistNameHint(folderPath: string): string {
    const basename = path.basename(folderPath).trim();
    return basename.length > 0 ? basename : "Legacy Playlist";
}

async function importLegacyFolderAsRounds(
    folderPath: string,
    options?: { omitCheckpointRounds?: boolean },
): Promise<{
    installed: number;
    updated: number;
    roundIds: string[];
    orderedSlots: LegacyImportSlot[];
    playlistNameHint: string;
}> {
    throwIfAbortRequested();
    const videoPaths = await collectLegacyVideoFiles(folderPath);
    if (videoPaths.length === 0) {
        throw new Error("No supported video files found in selected folder.");
    }

    const omitCheckpointRounds = options?.omitCheckpointRounds ?? true;
    const context = await createInstallSessionContext();
    const roundIds: string[] = [];
    const orderedSlots: LegacyImportSlot[] = [];
    let installed = 0;
    let updated = 0;
    const preparedEntries = await mapWithConcurrencyLimit(
        videoPaths,
        context.prepConcurrency,
        async (videoPath, index) => {
            throwIfAbortRequested();
            const absoluteVideoPath = path.resolve(videoPath);
            const parsed = path.parse(absoluteVideoPath);
            updateRunningScanMessage(`Importing ${parsed.base}...`);
            if (omitCheckpointRounds && isLegacyCheckpointName(parsed.name) && index > 0) {
                return {
                    kind: "checkpoint",
                    label: parsed.name,
                } satisfies PreparedLegacyEntry;
            }
            if (omitCheckpointRounds && isLegacyCheckpointName(parsed.name)) {
                return null;
            }

            return await prepareLegacyRoundEntry(context, absoluteVideoPath);
        },
    );

    for (const preparedEntry of preparedEntries) {
        throwIfAbortRequested();
        if (!preparedEntry) continue;

        if (preparedEntry.kind === "checkpoint") {
            orderedSlots.push({
                kind: "checkpoint",
                label: preparedEntry.label,
                restDurationMs: null,
            });
            continue;
        }

        const persisted = await persistPreparedEntry(context, {
            heroInput: null,
            writes: [preparedEntry.write],
        });
        const roundId = persisted.roundIds[0];
        if (!roundId) continue;

        installed += persisted.installed;
        updated += persisted.updated;
        roundIds.push(roundId);
        orderedSlots.push({
            kind: "round",
            ref: toPortableRoundRef({
                roundId,
                installSourceKey: preparedEntry.write.installSourceKey,
                phash: preparedEntry.write.round.phash,
                name: preparedEntry.write.round.name,
                author: preparedEntry.write.round.author,
                type: preparedEntry.write.round.type,
            }),
        });
    }

    const playlistNameHint = toPlaylistNameHint(folderPath);

    return {
        installed,
        updated,
        roundIds,
        orderedSlots,
        playlistNameHint,
    };
}

async function importLegacyFolderFromReviewedSlots(
    folderPath: string,
    reviewedSlots: ReviewedLegacyImportSlot[],
): Promise<LegacyInstallImport & { installed: number; updated: number }> {
    throwIfAbortRequested();
    const normalizedFolder = path.resolve(folderPath);
    const discoveredVideoPaths = await collectLegacyVideoFiles(normalizedFolder);
    if (discoveredVideoPaths.length === 0) {
        throw new Error("No supported video files found in selected folder.");
    }

    const discoveredSlots = buildLegacySlotPreview(discoveredVideoPaths);
    if (reviewedSlots.length !== discoveredSlots.length) {
        throw new Error("Legacy import plan no longer matches the selected folder contents.");
    }

    const reviewedByOrder = [...reviewedSlots].sort((a, b) => a.originalOrder - b.originalOrder);
    for (let index = 0; index < discoveredSlots.length; index += 1) {
        const discovered = discoveredSlots[index];
        const reviewed = reviewedByOrder[index];
        if (
            !reviewed
            || reviewed.id !== discovered.id
            || path.resolve(reviewed.sourcePath) !== discovered.sourcePath
            || reviewed.originalOrder !== discovered.originalOrder
        ) {
            throw new Error("Legacy import plan no longer matches the selected folder contents.");
        }
    }

    const context = await createInstallSessionContext();
    const roundIds: string[] = [];
    const orderedSlots: LegacyImportSlot[] = [];
    let installed = 0;
    let updated = 0;
    const preparedEntries = await mapWithConcurrencyLimit(
        reviewedByOrder,
        context.prepConcurrency,
        async (reviewed) => {
            throwIfAbortRequested();
            if (reviewed.excludedFromImport) {
                return null;
            }

            const parsed = path.parse(reviewed.sourcePath);
            updateRunningScanMessage(`Importing ${parsed.base}...`);
            if (reviewed.selectedAsCheckpoint) {
                return {
                    kind: "checkpoint",
                    label: parsed.name,
                } satisfies PreparedLegacyEntry;
            }

            return await prepareLegacyRoundEntry(context, reviewed.sourcePath);
        },
    );

    for (const preparedEntry of preparedEntries) {
        throwIfAbortRequested();
        if (!preparedEntry) continue;

        if (preparedEntry.kind === "checkpoint") {
            orderedSlots.push({
                kind: "checkpoint",
                label: preparedEntry.label,
                restDurationMs: null,
            });
            continue;
        }

        const persisted = await persistPreparedEntry(context, {
            heroInput: null,
            writes: [preparedEntry.write],
        });
        const roundId = persisted.roundIds[0];
        if (!roundId) continue;

        installed += persisted.installed;
        updated += persisted.updated;
        roundIds.push(roundId);
        orderedSlots.push({
            kind: "round",
            ref: toPortableRoundRef({
                roundId,
                installSourceKey: preparedEntry.write.installSourceKey,
                phash: preparedEntry.write.round.phash,
                name: preparedEntry.write.round.name,
                author: preparedEntry.write.round.author,
                type: preparedEntry.write.round.type,
            }),
        });
    }

    return {
        installed,
        updated,
        roundIds,
        orderedSlots,
        playlistNameHint: toPlaylistNameHint(normalizedFolder),
    };
}

export async function inspectInstallFolder(folderPath: string): Promise<InstallFolderInspectionResult> {
    const normalizedFolder = assertApprovedDialogPath("installFolder", folderPath);
    approveDialogPath("installFolder", normalizedFolder);
    if (!(await isDirectory(normalizedFolder))) {
        throw new Error("Folder does not exist or is not a directory.");
    }

    const sidecars = await collectSidecarFiles(normalizedFolder);
    if (sidecars.length > 0) {
        return {
            kind: "sidecar",
            folderPath: normalizedFolder,
            playlistNameHint: toPlaylistNameHint(normalizedFolder),
            sidecarCount: sidecars.length,
        };
    }

    const videoPaths = await collectLegacyVideoFiles(normalizedFolder);
    if (videoPaths.length === 0) {
        return {
            kind: "empty",
            folderPath: normalizedFolder,
            playlistNameHint: toPlaylistNameHint(normalizedFolder),
        };
    }

    return {
        kind: "legacy",
        folderPath: normalizedFolder,
        playlistNameHint: toPlaylistNameHint(normalizedFolder),
        legacySlots: buildLegacySlotPreview(videoPaths),
    };
}

export function getInstallScanStatus(): InstallScanStatus {
    return cloneStatus(scanStatus);
}

export function requestInstallScanAbort(): InstallScanStatus {
    if ((!activeScanPromise && !activeManualFolderImport) || scanStatus.state !== "running") {
        return cloneStatus(scanStatus);
    }

    abortRequested = true;
    scanStatus = {
        ...scanStatus,
        lastMessage: "Abort requested. Waiting for the current import step to finish...",
    };
    return cloneStatus(scanStatus);
}

export async function importInstallSidecarFile(filePath: string): Promise<InstallFolderScanResult> {
    activeManualFolderImport = true;

    try {
        const normalizedFile = assertApprovedDialogPath("installSidecarFile", filePath);
        if (!(await isFile(normalizedFile))) {
            throw new Error("Selected file does not exist or is not a file.");
        }

        const ext = path.extname(normalizedFile).toLowerCase();
        if (!SIDECAR_EXTENSIONS.has(ext)) {
            throw new Error("Selected file must be a .round or .hero sidecar.");
        }

        const nextStatus: InstallScanStatus = {
            state: "running",
            triggeredBy: "manual",
            startedAt: new Date().toISOString(),
            finishedAt: null,
            stats: {
                ...emptyStats(),
                sidecarsSeen: 1,
            },
            lastMessage: `Importing ${path.basename(normalizedFile)}...`,
            lastErrors: [],
        };
        scanStatus = nextStatus;

        const context = await createInstallSessionContext();
        try {
            const prepared = await prepareSidecar(context, normalizedFile);
            const result = await persistPreparedEntry(context, prepared);
            nextStatus.stats.installed += result.installed;
            nextStatus.stats.updated += result.updated;
        } catch (error) {
            recordInstallError(nextStatus, normalizedFile, error);
        }

        try {
            throwIfAbortRequested();
            await syncExternalSources("manual");
        } catch (error) {
            const message = error instanceof Error ? error.message : "External source sync failed.";
            pushScanError(nextStatus, "external", message);
        }

        nextStatus.state = "done";
        nextStatus.finishedAt = new Date().toISOString();
        nextStatus.lastMessage =
            `Import finished. Installed: ${nextStatus.stats.installed}, ` +
            `Updated: ${nextStatus.stats.updated}, Failed: ${nextStatus.stats.failed}.`;

        scanStatus = nextStatus;
        return {
            status: cloneStatus(nextStatus),
        };
    } catch (error) {
        if (error instanceof InstallAbortError) {
            const abortedStatus: InstallScanStatus = {
                ...scanStatus,
                state: "aborted",
                finishedAt: new Date().toISOString(),
                lastMessage: "Import aborted by user.",
            };
            scanStatus = abortedStatus;
            return { status: cloneStatus(abortedStatus) };
        }

        throw error;
    } finally {
        activeManualFolderImport = false;
        abortRequested = false;
    }
}

export function getAutoScanFolders(): string[] {
    const store = getStore();
    const parsed = parseStoredFolderList(store.get(AUTO_SCAN_FOLDERS_KEY));
    store.set(AUTO_SCAN_FOLDERS_KEY, parsed);
    return parsed;
}

export async function addAutoScanFolder(folderPath: string): Promise<string[]> {
    const normalized = assertApprovedDialogPath("installFolder", folderPath);
    if (!(await isDirectory(normalized))) {
        throw new Error("Folder does not exist or is not a directory.");
    }

    const next = new Set(getAutoScanFolders());
    next.add(normalized);
    const list = Array.from(next).sort((a, b) => a.localeCompare(b));
    getStore().set(AUTO_SCAN_FOLDERS_KEY, list);
    return list;
}

export function removeAutoScanFolder(folderPath: string): string[] {
    const normalized = normalizeScanFolder(folderPath);
    const next = getAutoScanFolders().filter((entry) => entry !== normalized);
    getStore().set(AUTO_SCAN_FOLDERS_KEY, next);
    return next;
}

function resolveScanFolders(folderPaths?: string[]): string[] {
    if (!folderPaths) {
        return getAutoScanFolders();
    }

    const unique = new Set<string>();
    for (const folderPath of folderPaths) {
        if (typeof folderPath !== "string") continue;
        const trimmed = folderPath.trim();
        if (!trimmed) continue;
        unique.add(normalizeScanFolder(trimmed));
    }

    return Array.from(unique).sort((a, b) => a.localeCompare(b));
}

async function runScanWithFolders(triggeredBy: InstallScanTrigger, folders: string[]): Promise<InstallScanStatus> {
    const nextStatus: InstallScanStatus = {
        state: "running",
        triggeredBy,
        startedAt: new Date().toISOString(),
        finishedAt: null,
        stats: emptyStats(),
        lastMessage: "Scanning install folders...",
        lastErrors: [],
    };

    scanStatus = nextStatus;
    const allSidecars: string[] = [];

    for (const folder of folders) {
        nextStatus.stats.scannedFolders += 1;

        if (!(await isDirectory(folder))) {
            nextStatus.stats.skipped += 1;
            pushScanError(nextStatus, folder, "Folder does not exist or is not a directory.");
            continue;
        }

        const discovered = await collectSidecarFiles(folder);
        allSidecars.push(...discovered);
    }

    nextStatus.stats.sidecarsSeen = allSidecars.length;

    const byBasename = new Map<string, Set<string>>();
    for (const sidecarPath of allSidecars) {
        const ext = path.extname(sidecarPath).toLowerCase();
        const basePath = sidecarPath.slice(0, -ext.length);
        if (!byBasename.has(basePath)) {
            byBasename.set(basePath, new Set());
        }
        byBasename.get(basePath)?.add(ext);
    }

    const blockedSidecars = new Set<string>();
    for (const [basePath, extensions] of byBasename.entries()) {
        if (extensions.has(".round") && extensions.has(".hero")) {
            blockedSidecars.add(`${basePath}.round`);
            blockedSidecars.add(`${basePath}.hero`);
            nextStatus.stats.skipped += 2;
            pushScanError(nextStatus, basePath, "Found both .round and .hero sidecars for the same basename.");
        }
    }

    const context = await createInstallSessionContext();
    const preparedSidecars = await mapWithConcurrencyLimit(
        allSidecars,
        context.prepConcurrency,
        async (sidecarPath) => {
            throwIfAbortRequested();
            if (blockedSidecars.has(sidecarPath)) {
                return {
                    sidecarPath,
                    entry: null,
                    error: null,
                };
            }

            try {
                return {
                    sidecarPath,
                    entry: await prepareSidecar(context, sidecarPath),
                    error: null,
                };
            } catch (error) {
                if (error instanceof InstallAbortError) {
                    throw error;
                }

                return {
                    sidecarPath,
                    entry: null,
                    error,
                };
            }
        },
    );

    for (const prepared of preparedSidecars) {
        throwIfAbortRequested();
        if (!prepared.entry) {
            if (prepared.error) {
                recordInstallError(nextStatus, prepared.sidecarPath, prepared.error);
            }
            continue;
        }

        try {
            const result = await persistPreparedEntry(context, prepared.entry);
            nextStatus.stats.installed += result.installed;
            nextStatus.stats.updated += result.updated;
        } catch (error) {
            recordInstallError(nextStatus, prepared.sidecarPath, error);
        }
    }

    try {
        throwIfAbortRequested();
        await syncExternalSources(triggeredBy);
    } catch (error) {
        const message = error instanceof Error ? error.message : "External source sync failed.";
        pushScanError(nextStatus, "external", message);
    }

    nextStatus.state = "done";
    nextStatus.finishedAt = new Date().toISOString();
    nextStatus.lastMessage = `Scan finished. Installed: ${nextStatus.stats.installed}, Updated: ${nextStatus.stats.updated}, Failed: ${nextStatus.stats.failed}.`;

    scanStatus = nextStatus;
    return cloneStatus(nextStatus);
}

export async function scanInstallFolderOnceWithLegacySupport(
    folderPath: string,
    options?: { omitCheckpointRounds?: boolean },
): Promise<InstallFolderScanResult> {
    activeManualFolderImport = true;

    try {
        const normalizedFolder = assertApprovedDialogPath("installFolder", folderPath);
        if (!(await isDirectory(normalizedFolder))) {
            throw new Error("Folder does not exist or is not a directory.");
        }

        const status = await scanInstallSources("manual", [normalizedFolder]);
        if (status.state !== "done") {
            return { status };
        }

        if (status.stats.installed > 0 || status.stats.updated > 0) {
            return { status };
        }

        scanStatus = {
            ...cloneStatus(status),
            state: "running",
            finishedAt: null,
            lastMessage: "No sidecars found. Preparing legacy video import...",
        };

        throwIfAbortRequested();
        const legacy = await importLegacyFolderAsRounds(normalizedFolder, options);
        const nextStatus: InstallScanStatus = cloneStatus(scanStatus);
        nextStatus.state = "done";
        nextStatus.finishedAt = new Date().toISOString();
        nextStatus.stats.installed += legacy.installed;
        nextStatus.stats.updated += legacy.updated;
        nextStatus.lastMessage = `Legacy import finished. Installed: ${legacy.installed}, Updated: ${legacy.updated}, Failed: ${nextStatus.stats.failed}.`;

        scanStatus = nextStatus;
        return {
            status: nextStatus,
            legacyImport: {
                roundIds: legacy.roundIds,
                orderedSlots: legacy.orderedSlots,
                playlistNameHint: legacy.playlistNameHint,
            },
        };
    } catch (error) {
        if (error instanceof InstallAbortError) {
            const abortedStatus: InstallScanStatus = {
                ...scanStatus,
                state: "aborted",
                finishedAt: new Date().toISOString(),
                lastMessage: "Import aborted by user.",
            };
            scanStatus = abortedStatus;
            return { status: cloneStatus(abortedStatus) };
        }

        throw error;
    } finally {
        activeManualFolderImport = false;
        abortRequested = false;
    }
}

export async function importLegacyFolderWithPlan(
    folderPath: string,
    reviewedSlots: ReviewedLegacyImportSlot[],
): Promise<InstallFolderScanResult> {
    activeManualFolderImport = true;

    try {
        const normalizedFolder = assertApprovedDialogPath("installFolder", folderPath);
        if (!(await isDirectory(normalizedFolder))) {
            throw new Error("Folder does not exist or is not a directory.");
        }

        const nextStatus: InstallScanStatus = {
            state: "running",
            triggeredBy: "manual",
            startedAt: new Date().toISOString(),
            finishedAt: null,
            stats: emptyStats(),
            lastMessage: "Preparing reviewed legacy video import...",
            lastErrors: [],
        };
        scanStatus = nextStatus;

        throwIfAbortRequested();
        const legacy = await importLegacyFolderFromReviewedSlots(normalizedFolder, reviewedSlots);
        nextStatus.state = "done";
        nextStatus.finishedAt = new Date().toISOString();
        nextStatus.stats.scannedFolders = 1;
        nextStatus.stats.installed = legacy.installed;
        nextStatus.stats.updated = legacy.updated;
        nextStatus.lastMessage = `Legacy import finished. Installed: ${legacy.installed}, Updated: ${legacy.updated}, Failed: ${nextStatus.stats.failed}.`;
        scanStatus = nextStatus;

        return {
            status: cloneStatus(nextStatus),
            legacyImport: {
                roundIds: legacy.roundIds,
                orderedSlots: legacy.orderedSlots,
                playlistNameHint: legacy.playlistNameHint,
            },
        };
    } catch (error) {
        if (error instanceof InstallAbortError) {
            const abortedStatus: InstallScanStatus = {
                ...scanStatus,
                state: "aborted",
                finishedAt: new Date().toISOString(),
                lastMessage: "Import aborted by user.",
            };
            scanStatus = abortedStatus;
            return { status: cloneStatus(abortedStatus) };
        }

        throw error;
    } finally {
        activeManualFolderImport = false;
        abortRequested = false;
    }
}

export async function scanInstallSources(triggeredBy: InstallScanTrigger, folderPaths?: string[]): Promise<InstallScanStatus> {
    if (activeScanPromise) {
        return activeScanPromise;
    }

    const folders = resolveScanFolders(folderPaths);
    abortRequested = false;

    activeScanPromise = runScanWithFolders(triggeredBy, folders)
        .catch((error) => {
            if (error instanceof InstallAbortError) {
                const abortedStatus: InstallScanStatus = {
                    ...scanStatus,
                    state: "aborted",
                    finishedAt: new Date().toISOString(),
                    lastMessage: "Import aborted by user.",
                };
                scanStatus = abortedStatus;
                return cloneStatus(abortedStatus);
            }

            const failedStatus: InstallScanStatus = {
                ...scanStatus,
                state: "error",
                finishedAt: new Date().toISOString(),
                lastMessage: error instanceof Error ? error.message : "Scan failed.",
            };

            if (error instanceof Error) {
                pushScanError(failedStatus, "scan", error.message);
            } else {
                pushScanError(failedStatus, "scan", "Unknown scan error.");
            }

            scanStatus = failedStatus;
            return cloneStatus(failedStatus);
        })
        .finally(() => {
            activeScanPromise = null;
            if (!activeManualFolderImport) {
                abortRequested = false;
            }
        });

    return activeScanPromise;
}
