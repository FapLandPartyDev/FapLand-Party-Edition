import crypto from "node:crypto";
import { createWriteStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { and, asc, eq, inArray } from "drizzle-orm";
import { File as MegaFile } from "megajs";
import parseTorrent, { toMagnetURI } from "parse-torrent";
import { isVideoExtension } from "../../../src/constants/videoFormats";
import type { ExportedAcquisitionSource } from "../../../src/zod/installSidecar";
import { getDb } from "../db";
import {
  acquisitionFile,
  acquisitionJob,
  acquisitionSource,
  resource,
  round,
  roundAcquisitionCandidate,
} from "../db/schema";
import { fromLocalMediaUri, toLocalMediaUri } from "../localMedia";
import { generateVideoPhash } from "../phash";
import { generateRoundPreviewImageDataUri } from "../roundPreview";
import { resolveVideoDurationMsForLocalPath } from "../videoDuration";
import { getAcquisitionSettings, resolveAcquisitionDownloadRoot } from "./settings";
import type { CatalogFile, MegaLocator, TorrentLocator } from "./types";

type ParsedTorrent = {
  infoHash: string;
  name?: string;
  announce?: string[];
  private?: boolean;
  files?: Array<{ path: string; name: string; length: number }>;
};

type TorrentFileLike = {
  path: string;
  name: string;
  length: number;
  downloaded: number;
  progress: number;
  select(): void;
  deselect(): void;
};

type TorrentLike = {
  infoHash: string;
  name: string;
  magnetURI: string;
  files: TorrentFileLike[];
  downloaded: number;
  uploaded: number;
  downloadSpeed: number;
  uploadSpeed: number;
  ratio: number;
  numPeers: number;
  done: boolean;
  private?: boolean;
  announce?: string[];
  pause(): void;
  resume(): void;
  destroy(options?: { destroyStore?: boolean }, callback?: () => void): void;
  on(event: string, callback: (...args: unknown[]) => void): TorrentLike;
};

type TorrentClientLike = {
  add(id: string, options: { path: string }, callback: (torrent: TorrentLike) => void): TorrentLike;
  get?(id: string): TorrentLike | null | Promise<TorrentLike | null>;
  remove(
    id: string,
    options?: { destroyStore?: boolean },
    callback?: () => void
  ): void | Promise<void>;
  destroy(callback?: () => void): void;
  throttleDownload(rate: number): void;
  throttleUpload(rate: number): void;
};

type SourceRow = typeof acquisitionSource.$inferSelect;
type JobRow = typeof acquisitionJob.$inferSelect;

export type DefaultAcquisitionSource = {
  kind: "torrent" | "mega";
  name: string;
  locator: string;
  catalogUrl?: string;
};

const activeTorrents = new Map<string, TorrentLike>();
const activeTorrentCounters = new Map<string, { downloaded: number; uploaded: number }>();
const activeSeedingJobs = new Set<string>();
const activeMegaJobs = new Map<string, Promise<void>>();
const torrentCatalogPromises = new Map<string, Promise<CatalogFile[]>>();
const activeMegaStreams = new Map<
  string,
  NodeJS.ReadableStream & { destroy(error?: Error): void }
>();
let torrentClientPromise: Promise<TorrentClientLike> | null = null;
let schedulerPromise: Promise<void> | null = null;
let progressTimer: ReturnType<typeof setInterval> | null = null;

export function parseDefaultAcquisitionSources(input: string): DefaultAcquisitionSource[] {
  const sources: DefaultAcquisitionSource[] = [];
  for (const [index, rawLine] of input.split(/\r?\n/u).entries()) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const fields = line.split("|").map((field) => field.trim());
    const [kind, name, locator, catalogUrl, ...extra] = fields;
    if ((kind !== "torrent" && kind !== "mega") || !name || !locator || extra.length > 0) {
      throw new Error(`Invalid default acquisition source on line ${index + 1}.`);
    }
    if (name.length > 240 || locator.length > 16_384 || (catalogUrl?.length ?? 0) > 16_384) {
      throw new Error(`Default acquisition source on line ${index + 1} is too long.`);
    }
    if (kind === "mega" && catalogUrl) {
      throw new Error(`MEGA source on line ${index + 1} has an unexpected fourth field.`);
    }
    sources.push({ kind, name, locator, ...(catalogUrl ? { catalogUrl } : {}) });
  }
  return sources;
}

export function normalizeAcquisitionPath(input: string): string {
  const normalized = path.posix.normalize(input.replaceAll("\\", "/")).replace(/^\.\//u, "");
  if (
    !normalized ||
    normalized === "." ||
    normalized.includes("\0") ||
    normalized.startsWith("/") ||
    /^[a-z]:\//iu.test(normalized) ||
    normalized === ".." ||
    normalized.startsWith("../") ||
    normalized.includes("/../")
  ) {
    throw new Error("Acquisition file path is unsafe.");
  }
  return normalized;
}

function safeOutputPath(root: string, relativePath: string): string {
  const normalized = normalizeAcquisitionPath(relativePath);
  const output = path.resolve(root, ...normalized.split("/"));
  const resolvedRoot = path.resolve(root);
  if (output !== resolvedRoot && !output.startsWith(`${resolvedRoot}${path.sep}`)) {
    throw new Error("Acquisition output escaped its configured storage folder.");
  }
  return output;
}

function canonicalHash(kind: "torrent" | "mega", identity: string): string {
  return crypto.createHash("sha256").update(`${kind}:${identity}`).digest("hex");
}

function mediaKindForPath(filePath: string): "video" | "other" {
  return isVideoExtension(path.extname(filePath).replace(/^\./u, "")) ? "video" : "other";
}

export function assertPublicTracker(tracker: string): void {
  let parsed: URL;
  try {
    parsed = new URL(tracker);
  } catch {
    throw new Error("Torrent contains an invalid tracker URL.");
  }
  if (!["http:", "https:", "udp:", "ws:", "wss:"].includes(parsed.protocol)) {
    throw new Error("Torrent contains an unsupported tracker protocol.");
  }
  if (parsed.username || parsed.password)
    throw new Error("Authenticated trackers are unsupported.");
  const sensitive = ["passkey", "auth", "token", "apikey", "api_key", "key"];
  if (sensitive.some((key) => parsed.searchParams.has(key))) {
    throw new Error("Private tracker credentials are unsupported.");
  }
  if (parsed.pathname.split("/").some((segment) => /^[a-z0-9_-]{32,}$/iu.test(segment))) {
    throw new Error("Tracker URL appears to contain a private passkey.");
  }
}

async function parseTorrentInput(input: string | Uint8Array): Promise<ParsedTorrent> {
  const parsed = (await parseTorrent(input)) as ParsedTorrent;
  if (parsed.private) throw new Error("Private torrents are unsupported.");
  for (const tracker of parsed.announce ?? []) assertPublicTracker(tracker);
  return parsed;
}

const MAX_TORRENT_DESCRIPTOR_BYTES = 64 * 1024 * 1024;

export function resolveTorrentDescriptorUrl(input: string): URL {
  const descriptorUrl = new URL(input);
  if (!["http:", "https:"].includes(descriptorUrl.protocol)) {
    throw new Error("Torrent descriptor URL must use HTTP or HTTPS.");
  }
  if (descriptorUrl.username || descriptorUrl.password) {
    throw new Error("Authenticated torrent descriptor URLs are unsupported.");
  }

  const hostname = descriptorUrl.hostname.toLowerCase();
  const nyaaHosts = new Set(["nyaa.si", "www.nyaa.si", "sukebei.nyaa.si"]);
  const nyaaViewMatch = descriptorUrl.pathname.match(/^\/view\/(\d+)\/?$/u);
  if (nyaaHosts.has(hostname) && nyaaViewMatch) {
    descriptorUrl.pathname = `/download/${nyaaViewMatch[1]}.torrent`;
    descriptorUrl.search = "";
    descriptorUrl.hash = "";
  }

  return descriptorUrl;
}

async function parseTorrentRemote(input: string): Promise<ParsedTorrent> {
  if (input.startsWith("magnet:?")) return parseTorrentInput(input);
  const descriptorUrl = resolveTorrentDescriptorUrl(input);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);
  try {
    const response = await fetch(descriptorUrl, { redirect: "follow", signal: controller.signal });
    if (!response.ok) {
      throw new Error(`Torrent descriptor request failed with HTTP ${response.status}.`);
    }
    const responseUrl = resolveTorrentDescriptorUrl(response.url);
    if (!["http:", "https:"].includes(responseUrl.protocol)) {
      throw new Error("Torrent descriptor redirected to an unsupported URL.");
    }
    const declaredLength = Number(response.headers.get("content-length"));
    if (Number.isFinite(declaredLength) && declaredLength > MAX_TORRENT_DESCRIPTOR_BYTES) {
      throw new Error("Torrent descriptor exceeds the 64 MB size limit.");
    }
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > MAX_TORRENT_DESCRIPTOR_BYTES) {
      throw new Error("Torrent descriptor exceeds the 64 MB size limit.");
    }
    return await parseTorrentInput(bytes);
  } catch (error) {
    if (controller.signal.aborted) throw new Error("Timed out while fetching torrent descriptor.");
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function torrentLocator(parsed: ParsedTorrent): TorrentLocator {
  // Deliberately omit web seeds and exact-source parameters. Shareable
  // descriptors contain only the public info hash, display name, and vetted
  // trackers.
  const magnetUri = toMagnetURI({
    infoHash: parsed.infoHash,
    name: parsed.name,
    announce: parsed.announce,
  } as Parameters<typeof toMagnetURI>[0]);
  return {
    magnetUri,
    infoHash: parsed.infoHash.toLowerCase(),
    displayName: parsed.name?.trim() || parsed.infoHash,
  };
}

function toCatalogFiles(files: ParsedTorrent["files"]): CatalogFile[] {
  return (files ?? []).map((file) => {
    const sourcePath = normalizeAcquisitionPath(file.path);
    return {
      path: sourcePath,
      name: file.name || path.posix.basename(sourcePath),
      sizeBytes: Number.isFinite(file.length) ? file.length : null,
      mediaKind: mediaKindForPath(sourcePath),
    };
  });
}

async function persistCatalog(sourceId: string, files: CatalogFile[]): Promise<void> {
  const db = getDb();
  await db.transaction(async (tx) => {
    await tx.delete(acquisitionFile).where(eq(acquisitionFile.sourceId, sourceId));
    if (files.length > 0) {
      await tx.insert(acquisitionFile).values(
        files.map((file) => ({
          sourceId,
          sourcePath: file.path,
          displayName: file.name,
          sizeBytes: file.sizeBytes,
          mediaKind: file.mediaKind,
        }))
      );
    }
    await tx
      .update(acquisitionSource)
      .set({ lastCatalogedAt: new Date(), catalogError: null, updatedAt: new Date() })
      .where(eq(acquisitionSource.id, sourceId));
  });
}

async function upsertSource(input: {
  kind: "torrent" | "mega";
  name: string;
  locator: TorrentLocator | MegaLocator;
  identity: string;
  origin: "user" | "imported";
}): Promise<SourceRow> {
  const db = getDb();
  const hash = canonicalHash(input.kind, input.identity);
  const existing = await db.query.acquisitionSource.findFirst({
    where: eq(acquisitionSource.canonicalLocatorHash, hash),
  });
  if (existing) return existing;
  const [created] = await db
    .insert(acquisitionSource)
    .values({
      kind: input.kind,
      name: input.name.trim(),
      canonicalLocatorHash: hash,
      locatorJson: JSON.stringify(input.locator),
      origin: input.origin,
    })
    .returning();
  if (!created) throw new Error("Failed to create acquisition source.");
  return created;
}

export async function createTorrentSourceFromUri(
  input: string,
  name?: string,
  origin: "user" | "imported" = "user"
): Promise<SourceRow> {
  const trimmedInput = input.trim();
  const catalogUrl = trimmedInput.startsWith("magnet:?")
    ? undefined
    : resolveTorrentDescriptorUrl(trimmedInput).toString();
  const parsed = await parseTorrentRemote(trimmedInput);
  const locator = { ...torrentLocator(parsed), ...(catalogUrl ? { catalogUrl } : {}) };
  let source = await upsertSource({
    kind: "torrent",
    name: name?.trim() || locator.displayName,
    locator,
    identity: locator.infoHash,
    origin,
  });
  if (catalogUrl) {
    const [updated] = await getDb()
      .update(acquisitionSource)
      .set({ locatorJson: JSON.stringify(locator), updatedAt: new Date() })
      .where(eq(acquisitionSource.id, source.id))
      .returning();
    if (updated) source = updated;
  }
  const files = toCatalogFiles(parsed.files);
  if (files.length > 0) await persistCatalog(source.id, files);
  return source;
}

export async function createTorrentSourceFromFile(
  filePath: string,
  origin: "user" | "imported" = "user"
): Promise<SourceRow> {
  const parsed = await parseTorrentInput(new Uint8Array(await fs.readFile(filePath)));
  const locator = torrentLocator(parsed);
  const source = await upsertSource({
    kind: "torrent",
    name: locator.displayName,
    locator,
    identity: locator.infoHash,
    origin,
  });
  await persistCatalog(source.id, toCatalogFiles(parsed.files));
  return source;
}

function assertMegaUrl(input: string): string {
  const parsed = new URL(input.trim());
  if (!new Set(["mega.nz", "www.mega.nz", "mega.co.nz"]).has(parsed.hostname.toLowerCase())) {
    throw new Error("Only public MEGA links are supported.");
  }
  if (
    !parsed.hash ||
    !(parsed.pathname.startsWith("/file/") || parsed.pathname.startsWith("/folder/"))
  ) {
    throw new Error("MEGA link must include a public file or folder key.");
  }
  return parsed.toString();
}

function flattenMegaFiles(root: InstanceType<typeof MegaFile>): CatalogFile[] {
  const result: CatalogFile[] = [];
  const visit = (entry: InstanceType<typeof MegaFile>, parents: string[]) => {
    const name = entry.name?.trim() || entry.nodeId || "unnamed";
    // A folder link exposes its children relative to the shared root. A direct
    // file link still needs a stable, non-empty catalog path.
    const nextParents = entry === root && entry.directory ? [] : [...parents, name];
    if (entry.directory) {
      for (const child of entry.children ?? []) visit(child, nextParents);
      return;
    }
    const sourcePath = normalizeAcquisitionPath(nextParents.join("/"));
    result.push({
      path: sourcePath,
      name,
      sizeBytes: typeof entry.size === "number" ? entry.size : null,
      mediaKind: mediaKindForPath(sourcePath),
    });
  };
  visit(root, []);
  return result;
}

export async function createMegaSource(
  publicUrl: string,
  name?: string,
  origin: "user" | "imported" = "user"
): Promise<SourceRow> {
  const normalizedUrl = assertMegaUrl(publicUrl);
  const source = await upsertSource({
    kind: "mega",
    name: name?.trim() || "MEGA source",
    locator: { publicUrl: normalizedUrl },
    identity: normalizedUrl,
    origin,
  });
  try {
    const root = MegaFile.fromURL(normalizedUrl);
    await root.loadAttributes();
    if (!name?.trim() && root.name?.trim()) {
      await updateAcquisitionSource({ sourceId: source.id, name: root.name.trim() });
    }
    await persistCatalog(source.id, flattenMegaFiles(root));
  } catch (error) {
    await getDb()
      .update(acquisitionSource)
      .set({
        catalogError: error instanceof Error ? error.message : "MEGA catalog could not be loaded.",
        updatedAt: new Date(),
      })
      .where(eq(acquisitionSource.id, source.id));
  }
  return (await getDb().query.acquisitionSource.findFirst({
    where: eq(acquisitionSource.id, source.id),
  }))!;
}

export async function importExportedSources(
  sources: ExportedAcquisitionSource[]
): Promise<Map<string, string>> {
  const ids = new Map<string, string>();
  for (const source of sources) {
    const stored =
      source.kind === "torrent"
        ? await createTorrentSourceFromUri(source.magnetUri, source.name, "imported")
        : await createMegaSource(source.publicUrl, source.name, "imported");
    ids.set(source.id, stored.id);
  }
  return ids;
}

export async function importDefaultAcquisitionSources(
  manifestPath: string
): Promise<{ imported: number; total: number }> {
  const entries = parseDefaultAcquisitionSources(await fs.readFile(manifestPath, "utf8"));
  let imported = 0;
  for (const entry of entries) {
    if (entry.kind === "mega") {
      const publicUrl = assertMegaUrl(entry.locator);
      await upsertSource({
        kind: "mega",
        name: entry.name,
        locator: { publicUrl },
        identity: publicUrl,
        origin: "imported",
      });
      imported += 1;
      continue;
    }

    if (!entry.locator.startsWith("magnet:?")) {
      throw new Error(`Default torrent source "${entry.name}" must use a magnet locator.`);
    }
    const parsed = await parseTorrentInput(entry.locator);
    const locator: TorrentLocator = {
      ...torrentLocator(parsed),
      ...(entry.catalogUrl
        ? { catalogUrl: resolveTorrentDescriptorUrl(entry.catalogUrl).toString() }
        : {}),
    };
    const source = await upsertSource({
      kind: "torrent",
      name: entry.name,
      locator,
      identity: locator.infoHash,
      origin: "imported",
    });
    if (locator.catalogUrl) {
      await getDb()
        .update(acquisitionSource)
        .set({ locatorJson: JSON.stringify(locator), updatedAt: new Date() })
        .where(eq(acquisitionSource.id, source.id));
    }
    imported += 1;
  }
  return { imported, total: entries.length };
}

export async function listAcquisitionSources(): Promise<SourceRow[]> {
  return getDb().query.acquisitionSource.findMany({ orderBy: [asc(acquisitionSource.name)] });
}

export async function listAcquisitionFiles(sourceId: string) {
  return getDb().query.acquisitionFile.findMany({
    where: eq(acquisitionFile.sourceId, sourceId),
    orderBy: [asc(acquisitionFile.sourcePath)],
  });
}

export async function updateAcquisitionSource(input: {
  sourceId: string;
  name?: string;
  enabled?: boolean;
}) {
  const [updated] = await getDb()
    .update(acquisitionSource)
    .set({
      ...(input.name !== undefined ? { name: input.name.trim() } : {}),
      ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
      updatedAt: new Date(),
    })
    .where(eq(acquisitionSource.id, input.sourceId))
    .returning();
  if (!updated) throw new Error("Acquisition source not found.");
  return updated;
}

export async function deleteAcquisitionSource(sourceId: string, detach = false): Promise<void> {
  const db = getDb();
  const references = await db.query.roundAcquisitionCandidate.findMany({
    where: eq(roundAcquisitionCandidate.sourceId, sourceId),
    columns: { id: true },
  });
  if (references.length > 0 && !detach) {
    throw new Error(
      "Source is referenced by installed rounds. Disable it or explicitly detach it."
    );
  }
  await db.transaction(async (tx) => {
    if (detach) {
      await tx
        .delete(roundAcquisitionCandidate)
        .where(eq(roundAcquisitionCandidate.sourceId, sourceId));
    }
    const jobs = await tx.query.acquisitionJob.findMany({
      where: eq(acquisitionJob.sourceId, sourceId),
    });
    if (jobs.length > 0) throw new Error("Remove this source's download jobs first.");
    await tx.delete(acquisitionSource).where(eq(acquisitionSource.id, sourceId));
  });
}

async function getTorrentClient(): Promise<TorrentClientLike> {
  if (!getAcquisitionSettings().torrentEnabled) throw new Error("Torrent support is disabled.");
  if (!torrentClientPromise) {
    torrentClientPromise = import("webtorrent").then((module) => {
      const Client = module.default as unknown as new (
        options: Record<string, unknown>
      ) => TorrentClientLike;
      const client = new Client({ natUpnp: false, natPmp: false });
      applyThrottleSettings(client);
      return client;
    });
  }
  return torrentClientPromise;
}

function applyThrottleSettings(client: TorrentClientLike): void {
  const settings = getAcquisitionSettings();
  client.throttleDownload(settings.downloadLimitBytesPerSec ?? -1);
  client.throttleUpload(settings.uploadLimitBytesPerSec ?? -1);
}

export async function applyAcquisitionRuntimeSettings(): Promise<void> {
  if (!torrentClientPromise) return;
  applyThrottleSettings(await torrentClientPromise);
  void scheduleJobs();
}

function catalogTorrentFiles(torrent: TorrentLike): CatalogFile[] {
  return torrent.files.map((file) => ({
    path: normalizeAcquisitionPath(file.path),
    name: file.name,
    sizeBytes: file.length,
    mediaKind: mediaKindForPath(file.path),
  }));
}

function removeMetadataTorrent(client: TorrentClientLike, infoHash: string): Promise<void> {
  return new Promise((resolve) => {
    try {
      const removal = client.remove(infoHash, { destroyStore: false }, resolve);
      if (removal && typeof removal.then === "function") {
        void removal.then(resolve, resolve);
      }
    } catch {
      resolve();
    }
  });
}

async function catalogTorrentSourceOnce(source: SourceRow): Promise<CatalogFile[]> {
  const locator = JSON.parse(source.locatorJson) as TorrentLocator;
  if (locator.catalogUrl) {
    const parsed = await parseTorrentRemote(locator.catalogUrl);
    if (parsed.infoHash.toLowerCase() !== locator.infoHash) {
      throw new Error("Torrent descriptor no longer matches this source's info hash.");
    }
    return toCatalogFiles(parsed.files);
  }
  if (!getAcquisitionSettings().torrentEnabled) {
    throw new Error("Enable torrent support before fetching magnet metadata.");
  }
  const client = await getTorrentClient();
  const active = [...activeTorrents.values()].find(
    (torrent) => torrent.infoHash.toLowerCase() === locator.infoHash
  );
  if (active?.files.length) return catalogTorrentFiles(active);

  const existing = await client.get?.(locator.infoHash);
  if (existing?.files.length) {
    for (const file of existing.files) file.deselect();
    const files = catalogTorrentFiles(existing);
    await removeMetadataTorrent(client, locator.infoHash);
    return files;
  }

  const root = path.join(resolveAcquisitionDownloadRoot(), locator.infoHash);
  await fs.mkdir(root, { recursive: true });
  return await new Promise<CatalogFile[]>((resolve, reject) => {
    let torrent: TorrentLike | null = null;
    let settled = false;
    const rejectOnce = (error: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      void removeMetadataTorrent(client, locator.infoHash).finally(() => reject(error));
    };
    const timeout = setTimeout(() => {
      rejectOnce(new Error("Timed out while fetching torrent metadata."));
    }, 120_000);
    torrent = client.add(locator.magnetUri, { path: root }, (ready) => {
      if (settled) return;
      clearTimeout(timeout);
      if (ready.private) {
        rejectOnce(new Error("Private torrents are unsupported."));
        return;
      }
      try {
        for (const tracker of ready.announce ?? []) assertPublicTracker(tracker);
      } catch (error) {
        rejectOnce(error instanceof Error ? error : new Error(String(error)));
        return;
      }
      for (const file of ready.files) file.deselect();
      const files = catalogTorrentFiles(ready);
      settled = true;
      void removeMetadataTorrent(client, locator.infoHash).then(() => resolve(files));
    });
    torrent.on("error", (error) => {
      rejectOnce(error instanceof Error ? error : new Error(String(error)));
    });
  });
}

async function catalogTorrentSource(source: SourceRow): Promise<CatalogFile[]> {
  const locator = JSON.parse(source.locatorJson) as TorrentLocator;
  const existing = torrentCatalogPromises.get(locator.infoHash);
  if (existing) return existing;

  const pending = catalogTorrentSourceOnce(source);
  torrentCatalogPromises.set(locator.infoHash, pending);
  try {
    return await pending;
  } finally {
    if (torrentCatalogPromises.get(locator.infoHash) === pending) {
      torrentCatalogPromises.delete(locator.infoHash);
    }
  }
}

export async function refreshAcquisitionSource(sourceId: string): Promise<SourceRow> {
  const source = await getDb().query.acquisitionSource.findFirst({
    where: eq(acquisitionSource.id, sourceId),
  });
  if (!source) throw new Error("Acquisition source not found.");
  try {
    if (source.kind === "torrent") {
      await persistCatalog(source.id, await catalogTorrentSource(source));
    } else {
      const locator = JSON.parse(source.locatorJson) as MegaLocator;
      const root = MegaFile.fromURL(locator.publicUrl);
      await root.loadAttributes();
      await persistCatalog(source.id, flattenMegaFiles(root));
    }
  } catch (error) {
    await getDb()
      .update(acquisitionSource)
      .set({
        catalogError: error instanceof Error ? error.message : "Catalog refresh failed.",
        updatedAt: new Date(),
      })
      .where(eq(acquisitionSource.id, source.id));
    throw error;
  }
  return (await getDb().query.acquisitionSource.findFirst({
    where: eq(acquisitionSource.id, source.id),
  }))!;
}

export async function queueAcquisitionFiles(input: {
  sourceId: string;
  paths: string[];
  addCompletedToLibrary?: boolean;
}): Promise<JobRow> {
  const source = await getDb().query.acquisitionSource.findFirst({
    where: eq(acquisitionSource.id, input.sourceId),
  });
  if (!source || !source.enabled) throw new Error("Enabled acquisition source not found.");
  if (source.kind === "torrent" && !getAcquisitionSettings().torrentEnabled) {
    throw new Error("Torrent support is disabled.");
  }
  const selectedPaths = [...new Set(input.paths.map(normalizeAcquisitionPath))];
  if (selectedPaths.length === 0) throw new Error("Select at least one file.");
  const files = await getDb().query.acquisitionFile.findMany({
    where: and(
      eq(acquisitionFile.sourceId, source.id),
      inArray(acquisitionFile.sourcePath, selectedPaths)
    ),
  });
  if (files.length !== selectedPaths.length)
    throw new Error("One or more selected source files do not exist.");
  const [job] = await getDb()
    .insert(acquisitionJob)
    .values({
      sourceId: source.id,
      kind: source.kind,
      selectedPathsJson: JSON.stringify(selectedPaths),
      addCompletedToLibrary: input.addCompletedToLibrary ?? true,
      totalBytes: files.reduce((sum, file) => sum + (file.sizeBytes ?? 0), 0),
    })
    .returning();
  if (!job) throw new Error("Failed to queue acquisition job.");
  void scheduleJobs();
  return job;
}

const RELEASE_NOISE = new Set([
  "1080p",
  "720p",
  "2160p",
  "4k",
  "h264",
  "h265",
  "x264",
  "x265",
  "hevc",
  "av1",
  "web",
  "webrip",
  "webdl",
  "bluray",
  "remux",
  "aac",
  "uncensored",
]);

const GENERIC_TITLE_TOKENS = new Set([
  "fap",
  "hero",
  "heroes",
  "faphero",
  "fapheros",
  "fapheroes",
  "fh",
  "faph",
  "faphr",
  "fhero",
  "fhr",
  "fhv",
  "fhpmv",
  "fhmv",
  "fhvideo",
  "fapheropmv",
  "fapherovideo",
  "pmv",
  "hmv",
  "mv",
  "music",
  "musicvideo",
  "video",
  "videos",
  "vid",
  "collection",
  "compilation",
  "comp",
]);

function isGenericTitleToken(token: string): boolean {
  return GENERIC_TITLE_TOKENS.has(token) || /^f+h+$/u.test(token);
}

function titleTokens(value: string): string[] {
  let decoded = value;
  try {
    decoded = decodeURIComponent(value);
  } catch {
    // Catalog paths are not required to be URI encoded.
  }
  return decoded
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .replace(/([\p{Ll}\p{N}])([\p{Lu}])/gu, "$1 $2")
    .replace(/\.[a-z0-9]{2,5}$/iu, "")
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(
      (token) => token.length > 1 && !RELEASE_NOISE.has(token) && !isGenericTitleToken(token)
    );
}

function normalizedTitle(value: string): string {
  return titleTokens(value).join(" ").slice(0, 240);
}

export function damerauLevenshteinDistance(left: string, right: string): number {
  if (left === right) return 0;
  if (left.length === 0) return right.length;
  if (right.length === 0) return left.length;
  const matrix = Array.from({ length: left.length + 1 }, () =>
    Array<number>(right.length + 1).fill(0)
  );
  for (let row = 0; row <= left.length; row += 1) matrix[row]![0] = row;
  for (let column = 0; column <= right.length; column += 1) matrix[0]![column] = column;
  for (let row = 1; row <= left.length; row += 1) {
    for (let column = 1; column <= right.length; column += 1) {
      const substitutionCost = left[row - 1] === right[column - 1] ? 0 : 1;
      matrix[row]![column] = Math.min(
        matrix[row - 1]![column]! + 1,
        matrix[row]![column - 1]! + 1,
        matrix[row - 1]![column - 1]! + substitutionCost
      );
      if (
        row > 1 &&
        column > 1 &&
        left[row - 1] === right[column - 2] &&
        left[row - 2] === right[column - 1]
      ) {
        matrix[row]![column] = Math.min(
          matrix[row]![column]!,
          matrix[row - 2]![column - 2]! + substitutionCost
        );
      }
    }
  }
  return matrix[left.length]![right.length]!;
}

function normalizedDistanceSimilarity(left: string, right: string): number {
  if (!left || !right) return 0;
  if (left === right) return 1;
  const denominator = Math.max(left.length, right.length);
  return Math.max(0, 1 - damerauLevenshteinDistance(left, right) / denominator);
}

function bestWindowSimilarity(expected: string, actual: string): number {
  const expectedTokens = expected.split(" ").filter(Boolean);
  const actualTokens = actual.split(" ").filter(Boolean);
  if (expectedTokens.length === 0 || actualTokens.length === 0) return 0;
  if (` ${actual} `.includes(` ${expected} `)) return 1;
  const windowSize = Math.min(expectedTokens.length, actualTokens.length);
  let score = normalizedDistanceSimilarity(expected, actual);
  for (let start = 0; start + windowSize <= actualTokens.length; start += 1) {
    score = Math.max(
      score,
      normalizedDistanceSimilarity(
        expected,
        actualTokens.slice(start, start + windowSize).join(" ")
      )
    );
  }
  return score;
}

export function scoreAcquisitionFileName(query: string, filePath: string): number {
  const expected = normalizedTitle(query);
  const basename = normalizedTitle(path.posix.basename(filePath.replaceAll("\\", "/")));
  return bestWindowSimilarity(expected, basename);
}

export type ExportAcquisitionSelection = {
  roundIds?: string[];
  heroIds?: string[];
};

export type LibraryLinkAnalysisStatus = {
  state: "idle" | "running" | "done" | "error";
  phase: "idle" | "cataloging" | "indexing" | "matching" | "finalizing" | "done" | "error";
  completed: number;
  total: number;
  message: string | null;
  startedAt: string | null;
  finishedAt: string | null;
};

let libraryLinkAnalysisStatus: LibraryLinkAnalysisStatus = {
  state: "idle",
  phase: "idle",
  completed: 0,
  total: 0,
  message: null,
  startedAt: null,
  finishedAt: null,
};

export function getLibraryLinkAnalysisStatus(): LibraryLinkAnalysisStatus {
  return { ...libraryLinkAnalysisStatus };
}

function setLibraryLinkAnalysisStatus(updates: Partial<LibraryLinkAnalysisStatus>): void {
  libraryLinkAnalysisStatus = { ...libraryLinkAnalysisStatus, ...updates };
}

function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

async function loadExportAcquisitionRounds() {
  const rows = await getDb().query.round.findMany({
    with: { hero: true, acquisitionCandidates: { with: { source: true } } },
  });
  return rows;
}

export type SourceFileChoice = {
  sourceId: string;
  sourceName: string;
  sourceKind: "torrent" | "mega";
  sourcePath: string;
  sizeBytes: number | null;
};

export type SourceFileSuggestion = SourceFileChoice & {
  score: number;
  confidence: "high" | "review";
  collision: boolean;
};

export type LibraryLinkTarget = {
  targetKind: "hero" | "round";
  targetId: string;
  name: string;
  author: string | null;
  roundIds: string[];
  existing: SourceFileChoice[];
  mixedExistingLinks: boolean;
  suggestions: SourceFileSuggestion[];
  autoSelected: boolean;
};

function fileChoice(
  file: typeof acquisitionFile.$inferSelect & { source: SourceRow }
): SourceFileChoice {
  return {
    sourceId: file.sourceId,
    sourceName: file.source.name,
    sourceKind: file.source.kind,
    sourcePath: file.sourcePath,
    sizeBytes: file.sizeBytes,
  };
}

export function buildLibraryLinkTargets(
  rows: Awaited<ReturnType<typeof loadExportAcquisitionRounds>>,
  selection: ExportAcquisitionSelection,
  catalogByKey: Map<string, typeof acquisitionFile.$inferSelect>
) {
  const selectionProvided = selection.roundIds !== undefined || selection.heroIds !== undefined;
  const selectedHeroIds = new Set(selection.heroIds ?? []);
  const selectedRoundIds = new Set(selection.roundIds ?? []);
  // A round that belongs to a hero is never a standalone link target. Expand an
  // individually selected member to its complete hero so one source mapping is
  // shown and subsequently applied to every round in that hero.
  for (const entry of rows) {
    if (entry.heroId !== null && selectedRoundIds.has(entry.id)) {
      selectedHeroIds.add(entry.heroId);
    }
  }
  const groups = new Map<string, typeof rows>();
  for (const entry of rows) {
    const groupAsHero = entry.heroId !== null;
    const selectedAsHero = groupAsHero && selectedHeroIds.has(entry.heroId!);
    if (selectionProvided && !selectedAsHero && !selectedRoundIds.has(entry.id)) continue;
    const key = groupAsHero ? `hero:${entry.heroId}` : `round:${entry.id}`;
    const group = groups.get(key) ?? [];
    group.push(entry);
    groups.set(key, group);
  }
  return [...groups.entries()].map(([key, entries]) => {
    const first = entries[0]!;
    const targetKind = key.startsWith("hero:") ? "hero" : "round";
    const existingByKey = new Map<string, SourceFileChoice>();
    const perRoundKeys = entries.map((entry) => {
      const keys = new Set<string>();
      for (const candidate of entry.acquisitionCandidates) {
        const candidateKey = `${candidate.sourceId}\0${candidate.sourcePath}`;
        keys.add(candidateKey);
        const catalog = catalogByKey.get(candidateKey);
        existingByKey.set(candidateKey, {
          sourceId: candidate.sourceId,
          sourceName: candidate.source.name,
          sourceKind: candidate.source.kind,
          sourcePath: candidate.sourcePath,
          sizeBytes: catalog?.sizeBytes ?? null,
        });
      }
      return [...keys].sort().join("\0\0");
    });
    return {
      targetKind,
      targetId: targetKind === "hero" ? first.heroId! : first.id,
      name: targetKind === "hero" ? first.hero!.name : first.name,
      author: targetKind === "hero" ? first.hero!.author : first.author,
      roundIds: entries.map((entry) => entry.id),
      existing: [...existingByKey.values()],
      mixedExistingLinks: new Set(perRoundKeys).size > 1,
      suggestions: [] as SourceFileSuggestion[],
      autoSelected: false,
    } satisfies LibraryLinkTarget;
  });
}

export async function analyzeLibraryLinks(selection: ExportAcquisitionSelection): Promise<{
  scope: {
    heroes: number;
    standaloneRounds: number;
    linked: number;
    ready: number;
    needsReview: number;
    unmatched: number;
  };
  sources: {
    enabled: number;
    refreshed: number;
    refreshErrors: Array<{ sourceId: string; sourceName: string; message: string }>;
  };
  targets: LibraryLinkTarget[];
}> {
  const startedAt = new Date().toISOString();
  setLibraryLinkAnalysisStatus({
    state: "running",
    phase: "cataloging",
    completed: 0,
    total: 0,
    message: "Checking source catalogs...",
    startedAt,
    finishedAt: null,
  });
  try {
    const [sources, catalogSourceRows] = await Promise.all([
      getDb().query.acquisitionSource.findMany({
        where: eq(acquisitionSource.enabled, true),
      }),
      getDb().selectDistinct({ sourceId: acquisitionFile.sourceId }).from(acquisitionFile),
    ]);
    const catalogSourceIds = new Set(catalogSourceRows.map((entry) => entry.sourceId));
    const sourcesToRefresh = sources.filter((source) => !catalogSourceIds.has(source.id));
    setLibraryLinkAnalysisStatus({ total: sourcesToRefresh.length, completed: 0 });
    let refreshed = 0;
    const refreshErrors: Array<{ sourceId: string; sourceName: string; message: string }> = [];
    for (let sourceIndex = 0; sourceIndex < sourcesToRefresh.length; sourceIndex += 1) {
      const source = sourcesToRefresh[sourceIndex]!;
      setLibraryLinkAnalysisStatus({ message: `Refreshing ${source.name}...` });
      try {
        await refreshAcquisitionSource(source.id);
        refreshed += 1;
      } catch (error) {
        refreshErrors.push({
          sourceId: source.id,
          sourceName: source.name,
          message: error instanceof Error ? error.message : "Catalog refresh failed.",
        });
      }
      setLibraryLinkAnalysisStatus({ completed: sourceIndex + 1 });
      await yieldToEventLoop();
    }

    const [rows, allFiles] = await Promise.all([
      loadExportAcquisitionRounds(),
      getDb().query.acquisitionFile.findMany({
        where: eq(acquisitionFile.mediaKind, "video"),
        with: { source: true },
      }),
    ]);
    const files: typeof allFiles = [];
    const normalizedFileNames = new Map<string, string>();
    setLibraryLinkAnalysisStatus({
      phase: "indexing",
      completed: 0,
      total: allFiles.length,
      message: `Preparing ${allFiles.length} source filenames...`,
    });
    let lastYieldAt = Date.now();
    for (let fileIndex = 0; fileIndex < allFiles.length; fileIndex += 1) {
      const file = allFiles[fileIndex]!;
      if (file.source.enabled) {
        files.push(file);
        normalizedFileNames.set(
          file.id,
          normalizedTitle(path.posix.basename(file.sourcePath.replaceAll("\\", "/")))
        );
      }
      if (Date.now() - lastYieldAt >= 8) {
        setLibraryLinkAnalysisStatus({ completed: fileIndex + 1 });
        await yieldToEventLoop();
        lastYieldAt = Date.now();
      }
    }
    const catalogByKey = new Map(
      files.map((file) => [`${file.sourceId}\0${file.sourcePath}`, file])
    );
    const targets = buildLibraryLinkTargets(rows, selection, catalogByKey);
    const targetsToMatch = targets.filter((target) => target.existing.length === 0);
    const totalComparisons = targetsToMatch.length * files.length;
    let completedComparisons = 0;
    lastYieldAt = Date.now();
    setLibraryLinkAnalysisStatus({
      phase: "matching",
      completed: 0,
      total: totalComparisons,
      message: `Matching ${targetsToMatch.length} library items against ${files.length} files...`,
    });

    for (const target of targetsToMatch) {
      const queries = [target.name];
      if (target.author) {
        queries.push(`${target.name} ${target.author}`, `${target.author} ${target.name}`);
      }
      const expectedNames = queries.map(normalizedTitle).filter(Boolean);
      const ranked: Array<{ file: (typeof files)[number]; score: number }> = [];
      for (const file of files) {
        const actual = normalizedFileNames.get(file.id) ?? "";
        const score = expectedNames.reduce(
          (best, expected) => Math.max(best, bestWindowSimilarity(expected, actual)),
          0
        );
        if (score >= 0.6) {
          ranked.push({ file, score });
          ranked.sort(
            (left, right) =>
              right.score - left.score ||
              left.file.source.name.localeCompare(right.file.source.name) ||
              left.file.sourcePath.localeCompare(right.file.sourcePath)
          );
          if (ranked.length > 5) ranked.length = 5;
        }
        completedComparisons += 1;
        if (Date.now() - lastYieldAt >= 8) {
          setLibraryLinkAnalysisStatus({ completed: completedComparisons });
          await yieldToEventLoop();
          lastYieldAt = Date.now();
        }
      }
      const runnerUp = ranked[1]?.score ?? 0;
      target.suggestions = ranked.map(({ file, score }, index) => ({
        ...fileChoice(file),
        score,
        confidence: index === 0 && score >= 0.82 && score - runnerUp >= 0.08 ? "high" : "review",
        collision: false,
      }));
    }

    setLibraryLinkAnalysisStatus({
      phase: "finalizing",
      completed: totalComparisons,
      total: totalComparisons,
      message: "Checking ambiguous matches...",
    });
    await yieldToEventLoop();
    const bestFileTargets = new Map<string, LibraryLinkTarget[]>();
    for (const target of targets) {
      const best = target.suggestions[0];
      if (!best || best.confidence !== "high") continue;
      const key = `${best.sourceId}\0${best.sourcePath}`;
      const owners = bestFileTargets.get(key) ?? [];
      owners.push(target);
      bestFileTargets.set(key, owners);
    }
    for (const owners of bestFileTargets.values()) {
      const collision = owners.length > 1;
      for (const target of owners) {
        const best = target.suggestions[0];
        if (best) best.collision = collision;
        target.autoSelected = !collision;
      }
    }

    const result = {
      scope: {
        heroes: targets.filter((target) => target.targetKind === "hero").length,
        standaloneRounds: targets.filter((target) => target.targetKind === "round").length,
        linked: targets.filter((target) => target.existing.length > 0).length,
        ready: targets.filter((target) => target.autoSelected).length,
        needsReview: targets.filter(
          (target) =>
            target.existing.length === 0 && target.suggestions.length > 0 && !target.autoSelected
        ).length,
        unmatched: targets.filter(
          (target) => target.existing.length === 0 && target.suggestions.length === 0
        ).length,
      },
      sources: { enabled: sources.length, refreshed, refreshErrors },
      targets,
    };
    setLibraryLinkAnalysisStatus({
      state: "done",
      phase: "done",
      completed: totalComparisons,
      total: totalComparisons,
      message: "Source-link analysis complete.",
      finishedAt: new Date().toISOString(),
    });
    return result;
  } catch (error) {
    setLibraryLinkAnalysisStatus({
      state: "error",
      phase: "error",
      message: error instanceof Error ? error.message : "Source-link analysis failed.",
      finishedAt: new Date().toISOString(),
    });
    throw error;
  }
}

export async function searchAcquisitionVideoFiles(input: {
  query: string;
  sourceKinds?: Array<"torrent" | "mega">;
  cursor?: string;
  limit?: number;
}): Promise<{ items: SourceFileChoice[]; nextCursor: string | null }> {
  const limit = Math.max(1, Math.min(100, input.limit ?? 30));
  const offset = Math.max(0, Number.parseInt(input.cursor ?? "0", 10) || 0);
  const query = normalizedTitle(input.query);
  const kinds = new Set(input.sourceKinds ?? ["torrent", "mega"]);
  const files = await getDb().query.acquisitionFile.findMany({
    where: eq(acquisitionFile.mediaKind, "video"),
    with: { source: true },
  });
  const pageEnd = offset + limit;
  const ranked: typeof files = [];
  let matchCount = 0;
  let lastYieldAt = Date.now();
  const compareFiles = (left: (typeof files)[number], right: (typeof files)[number]) =>
    left.source.name.localeCompare(right.source.name) ||
    left.sourcePath.localeCompare(right.sourcePath);
  for (const file of files) {
    if (
      file.source.enabled &&
      kinds.has(file.source.kind) &&
      (!query ||
        normalizedTitle(path.posix.basename(file.sourcePath.replaceAll("\\", "/"))).includes(query))
    ) {
      matchCount += 1;
      const insertAt = ranked.findIndex((entry) => compareFiles(file, entry) < 0);
      ranked.splice(insertAt < 0 ? ranked.length : insertAt, 0, file);
      // Retain just enough sorted entries for the requested page and a next-page marker.
      if (ranked.length > pageEnd + 1) ranked.length = pageEnd + 1;
    }
    if (Date.now() - lastYieldAt >= 8) {
      await yieldToEventLoop();
      lastYieldAt = Date.now();
    }
  }
  const page = ranked.slice(offset, pageEnd);
  return {
    items: page.map(fileChoice),
    nextCursor: matchCount > offset + page.length ? String(offset + page.length) : null,
  };
}

export async function applyLibraryLinks(
  changes: Array<{
    targetKind: "hero" | "round";
    targetId: string;
    sourceId: string;
    sourcePath: string;
    analyzedScore: number | null;
    replaceExisting: boolean;
  }>
): Promise<{ changedTargets: number; linkedRounds: number }> {
  if (changes.length === 0) return { changedTargets: 0, linkedRounds: 0 };
  const db = getDb();
  const [allRounds, catalogFiles] = await Promise.all([
    db.query.round.findMany({ with: { acquisitionCandidates: true } }),
    db.query.acquisitionFile.findMany({
      where: eq(acquisitionFile.mediaKind, "video"),
      with: { source: true },
    }),
  ]);
  const availableFileKeys = new Set(
    catalogFiles
      .filter((file) => file.source.enabled)
      .map((file) => `${file.sourceId}\0${file.sourcePath}`)
  );
  const resolved: Array<(typeof changes)[number] & { roundIds: string[] }> = [];
  const seenTargets = new Set<string>();
  for (const change of changes) {
    const key = `${change.targetKind}:${change.targetId}`;
    if (seenTargets.has(key)) throw new Error("A source-link target was submitted more than once.");
    seenTargets.add(key);
    const targetRounds = allRounds.filter((entry) =>
      change.targetKind === "hero" ? entry.heroId === change.targetId : entry.id === change.targetId
    );
    if (targetRounds.length === 0) throw new Error("A selected hero or round no longer exists.");
    const sourcePath = normalizeAcquisitionPath(change.sourcePath);
    if (!availableFileKeys.has(`${change.sourceId}\0${sourcePath}`)) {
      throw new Error("A selected source video is unavailable.");
    }
    const exactForEveryRound = targetRounds.every((entry) =>
      entry.acquisitionCandidates.some(
        (candidate) => candidate.sourceId === change.sourceId && candidate.sourcePath === sourcePath
      )
    );
    if (exactForEveryRound) continue;
    const hasExisting = targetRounds.some((entry) => entry.acquisitionCandidates.length > 0);
    if (hasExisting && !change.replaceExisting) {
      throw new Error("An existing mapping changed. Review it again before replacing it.");
    }
    resolved.push({ ...change, sourcePath, roundIds: targetRounds.map((entry) => entry.id) });
  }
  await db.transaction(async (tx) => {
    for (const change of resolved) {
      if (change.replaceExisting) {
        await tx
          .delete(roundAcquisitionCandidate)
          .where(inArray(roundAcquisitionCandidate.roundId, change.roundIds));
      }
      await tx.insert(roundAcquisitionCandidate).values(
        change.roundIds.map((roundId) => ({
          roundId,
          sourceId: change.sourceId,
          sourcePath: change.sourcePath,
          matchKind: "filename" as const,
          matchScore: change.analyzedScore,
          sortOrder: 0,
        }))
      );
    }
  });
  return {
    changedTargets: resolved.length,
    linkedRounds: resolved.reduce((sum, entry) => sum + entry.roundIds.length, 0),
  };
}

export async function analyzeExportAcquisition(selection: ExportAcquisitionSelection): Promise<{
  totalRounds: number;
  mappedRounds: number;
  unmappedRounds: number;
  enabledSources: number;
}> {
  const analysis = await analyzeLibraryLinks(selection);
  const totalRounds = analysis.targets.reduce((sum, target) => sum + target.roundIds.length, 0);
  const mappedRounds = analysis.targets
    .filter((target) => target.existing.length > 0)
    .reduce((sum, target) => sum + target.roundIds.length, 0);
  return {
    totalRounds,
    mappedRounds,
    unmappedRounds: totalRounds - mappedRounds,
    enabledSources: analysis.sources.enabled,
  };
}

export async function autoLinkExportAcquisition(selection: ExportAcquisitionSelection): Promise<{
  linkedRounds: number;
  linkedFiles: number;
  unmatchedRounds: number;
  refreshedSources: number;
  refreshErrors: number;
}> {
  const analysis = await analyzeLibraryLinks(selection);
  const changes = analysis.targets.flatMap((target) => {
    const best = target.autoSelected ? target.suggestions[0] : undefined;
    if (!best || target.existing.length > 0) return [];
    return [
      {
        targetKind: target.targetKind,
        targetId: target.targetId,
        sourceId: best.sourceId,
        sourcePath: best.sourcePath,
        analyzedScore: best.score,
        replaceExisting: false,
      },
    ];
  });
  const result = await applyLibraryLinks(changes);
  const linkedFileKeys = new Set(changes.map((entry) => `${entry.sourceId}\0${entry.sourcePath}`));
  return {
    linkedRounds: result.linkedRounds,
    linkedFiles: linkedFileKeys.size,
    unmatchedRounds: analysis.targets
      .filter((target) => target.existing.length === 0 && !target.autoSelected)
      .reduce((sum, target) => sum + target.roundIds.length, 0),
    refreshedSources: analysis.sources.refreshed,
    refreshErrors: analysis.sources.refreshErrors.length,
  };
}

export type AcquisitionMatch = {
  sourceId: string;
  sourceName: string;
  sourceKind: "torrent" | "mega";
  path: string;
  sizeBytes: number | null;
  matchKind: "explicit" | "filename";
  score: number | null;
  weak: boolean;
  tied: boolean;
  roundIds: string[];
  roundNames: string[];
  installedRoundSuggestions: InstalledRoundSuggestion[];
};

export type InstalledRoundSuggestion = {
  roundId: string;
  roundName: string;
  heroName: string | null;
  score: number;
  resourceCount: number;
};

function normalizeInstalledMatchName(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

export async function analyzeUnresolvedImport(roundIds: string[]): Promise<{
  matches: AcquisitionMatch[];
  totalBytes: number;
  torrentSupportEnabled: boolean;
  requiresTorrentEnablement: boolean;
}> {
  if (roundIds.length === 0) {
    return {
      matches: [],
      totalBytes: 0,
      torrentSupportEnabled: getAcquisitionSettings().torrentEnabled,
      requiresTorrentEnablement: false,
    };
  }
  const [rows, installedRows] = await Promise.all([
    getDb().query.round.findMany({
      where: inArray(round.id, roundIds),
      with: { hero: true, resources: true, acquisitionCandidates: { with: { source: true } } },
    }),
    getDb().query.round.findMany({ with: { hero: true, resources: true } }),
  ]);
  const unresolved = rows.filter(
    (entry) => entry.resources.filter((item) => !item.disabled).length === 0
  );
  const allFiles = await getDb().query.acquisitionFile.findMany({
    where: eq(acquisitionFile.mediaKind, "video"),
    with: { source: true },
  });
  const enabledFiles = allFiles.filter((file) => file.source.enabled);
  const preliminary: AcquisitionMatch[] = [];
  const importedRoundIds = new Set(roundIds);
  const installedSuggestionsFor = (query: string): InstalledRoundSuggestion[] =>
    installedRows
      .filter(
        (entry) =>
          !importedRoundIds.has(entry.id) && entry.resources.some((resource) => !resource.disabled)
      )
      .map((entry) => {
        const candidateNames = [entry.name, entry.hero?.name].filter((value): value is string =>
          Boolean(value)
        );
        const exactNameMatch = candidateNames.some(
          (name) => normalizeInstalledMatchName(name) === normalizeInstalledMatchName(query)
        );
        const score = exactNameMatch
          ? 1
          : Math.max(
              scoreAcquisitionFileName(query, entry.name),
              entry.hero?.name ? scoreAcquisitionFileName(query, entry.hero.name) : 0
            );
        return {
          roundId: entry.id,
          roundName: entry.name,
          heroName: entry.hero?.name ?? null,
          score,
          resourceCount: entry.resources.filter((resource) => !resource.disabled).length,
        };
      })
      .filter((entry) => entry.score >= 0.6)
      .sort(
        (a, b) =>
          b.score - a.score ||
          (a.heroName ?? "").localeCompare(b.heroName ?? "") ||
          a.roundName.localeCompare(b.roundName) ||
          a.roundId.localeCompare(b.roundId)
      )
      .slice(0, 5);

  const heroGroups = new Map<string, typeof unresolved>();
  for (const entry of unresolved) {
    const key = entry.heroId ? `hero:${entry.heroId}` : `round:${entry.id}`;
    const group = heroGroups.get(key) ?? [];
    group.push(entry);
    heroGroups.set(key, group);
  }

  for (const group of heroGroups.values()) {
    const first = group[0];
    if (!first) continue;
    const query = first.hero?.name || first.name;
    const installedRoundSuggestions = installedSuggestionsFor(query);
    const explicit = group
      .flatMap((entry) => entry.acquisitionCandidates)
      .sort((a, b) => a.sortOrder - b.sortOrder)[0];
    if (explicit) {
      const catalog = allFiles.find(
        (file) => file.sourceId === explicit.sourceId && file.sourcePath === explicit.sourcePath
      );
      if (explicit.source.enabled) {
        preliminary.push({
          sourceId: explicit.sourceId,
          sourceName: explicit.source.name,
          sourceKind: explicit.source.kind,
          path: explicit.sourcePath,
          sizeBytes: catalog?.sizeBytes ?? null,
          matchKind: "explicit",
          score: null,
          weak: false,
          tied: false,
          roundIds: group.map((entry) => entry.id),
          roundNames: group.map((entry) => entry.name),
          installedRoundSuggestions,
        });
        continue;
      }
    }
    const ranked = enabledFiles
      .map((file) => ({ file, score: scoreAcquisitionFileName(query, file.sourcePath) }))
      .sort(
        (a, b) =>
          b.score - a.score ||
          a.file.source.name.localeCompare(b.file.source.name) ||
          a.file.sourcePath.localeCompare(b.file.sourcePath)
      );
    const best = ranked[0];
    if (!best) continue;
    preliminary.push({
      sourceId: best.file.sourceId,
      sourceName: best.file.source.name,
      sourceKind: best.file.source.kind,
      path: best.file.sourcePath,
      sizeBytes: best.file.sizeBytes,
      matchKind: "filename",
      score: best.score,
      weak: best.score < 0.6,
      tied: ranked[1]?.score === best.score,
      roundIds: group.map((entry) => entry.id),
      roundNames: group.map((entry) => entry.name),
      installedRoundSuggestions,
    });
  }

  const grouped = new Map<string, AcquisitionMatch>();
  for (const match of preliminary) {
    const key = `${match.sourceId}\0${match.path}`;
    const existing = grouped.get(key);
    if (existing) {
      existing.roundIds.push(...match.roundIds);
      existing.roundNames.push(...match.roundNames);
      existing.weak ||= match.weak;
      existing.tied ||= match.tied;
      for (const suggestion of match.installedRoundSuggestions) {
        if (
          !existing.installedRoundSuggestions.some((item) => item.roundId === suggestion.roundId)
        ) {
          existing.installedRoundSuggestions.push(suggestion);
        }
      }
      existing.installedRoundSuggestions.sort((a, b) => b.score - a.score);
      existing.installedRoundSuggestions.length = Math.min(
        existing.installedRoundSuggestions.length,
        5
      );
    } else grouped.set(key, { ...match });
  }
  const matches = [...grouped.values()];
  const torrentSupportEnabled = getAcquisitionSettings().torrentEnabled;
  return {
    matches,
    totalBytes: matches.reduce((sum, match) => sum + (match.sizeBytes ?? 0), 0),
    torrentSupportEnabled,
    requiresTorrentEnablement:
      !torrentSupportEnabled && matches.some((match) => match.sourceKind === "torrent"),
  };
}

export async function approveImportDownloads(
  selections: Array<{
    sourceId: string;
    path: string;
    roundIds: string[];
    matchKind: "explicit" | "filename";
    score: number | null;
  }>
): Promise<JobRow[]> {
  const grouped = new Map<string, Set<string>>();
  await getDb().transaction(async (tx) => {
    for (const selection of selections) {
      const sourcePath = normalizeAcquisitionPath(selection.path);
      for (const roundId of selection.roundIds) {
        await tx
          .insert(roundAcquisitionCandidate)
          .values({
            roundId,
            sourceId: selection.sourceId,
            sourcePath,
            matchKind: selection.matchKind,
            matchScore: selection.score,
          })
          .onConflictDoNothing();
      }
      const paths = grouped.get(selection.sourceId) ?? new Set<string>();
      paths.add(sourcePath);
      grouped.set(selection.sourceId, paths);
    }
  });
  const jobs: JobRow[] = [];
  for (const [sourceId, paths] of grouped) {
    const requestedPaths = [...paths];
    const catalog = await getDb().query.acquisitionFile.findMany({
      where: and(
        eq(acquisitionFile.sourceId, sourceId),
        inArray(acquisitionFile.sourcePath, requestedPaths)
      ),
    });
    if (catalog.length !== requestedPaths.length) {
      await refreshAcquisitionSource(sourceId);
    }
    jobs.push(await queueAcquisitionFiles({ sourceId, paths: [...paths] }));
  }
  return jobs;
}

async function attachCompletedPath(
  sourceId: string,
  sourcePath: string,
  localPath: string,
  addCompletedToLibrary = true
): Promise<void> {
  let candidates = await getDb().query.roundAcquisitionCandidate.findMany({
    where: and(
      eq(roundAcquisitionCandidate.sourceId, sourceId),
      eq(roundAcquisitionCandidate.sourcePath, sourcePath)
    ),
    with: { round: true },
  });
  if (candidates.length === 0) {
    if (!addCompletedToLibrary) return;
    const catalogFile = await getDb().query.acquisitionFile.findFirst({
      where: and(
        eq(acquisitionFile.sourceId, sourceId),
        eq(acquisitionFile.sourcePath, sourcePath)
      ),
    });
    if (catalogFile?.mediaKind !== "video") return;
    const videoUri = toLocalMediaUri(localPath);
    const alreadyImported = await getDb().query.resource.findFirst({
      where: eq(resource.videoUri, videoUri),
    });
    if (alreadyImported) return;
    const [createdRound] = await getDb()
      .insert(round)
      .values({
        name: path.posix.basename(sourcePath, path.posix.extname(sourcePath)),
        type: "Normal",
      })
      .returning();
    if (!createdRound) return;
    await getDb().insert(roundAcquisitionCandidate).values({
      roundId: createdRound.id,
      sourceId,
      sourcePath,
      matchKind: "explicit",
      matchScore: null,
      sortOrder: 0,
    });
    candidates = await getDb().query.roundAcquisitionCandidate.findMany({
      where: and(
        eq(roundAcquisitionCandidate.sourceId, sourceId),
        eq(roundAcquisitionCandidate.sourcePath, sourcePath)
      ),
      with: { round: true },
    });
  }
  const existing = await getDb().query.resource.findMany({
    where: inArray(
      resource.roundId,
      candidates.map((candidate) => candidate.roundId)
    ),
  });
  const existingRoundIds = new Set(existing.map((entry) => entry.roundId));
  const rows = candidates.filter((candidate) => !existingRoundIds.has(candidate.roundId));
  if (rows.length === 0) return;

  const videoUri = toLocalMediaUri(localPath);
  const durationMs = await resolveVideoDurationMsForLocalPath(localPath).catch(() => null);
  const inserted = await getDb()
    .insert(resource)
    .values(
      rows.map((candidate) => ({
        roundId: candidate.roundId,
        videoUri,
        durationMs,
      }))
    )
    .returning({ id: resource.id, roundId: resource.roundId });

  for (const candidate of rows) {
    const resourceRow = inserted.find((entry) => entry.roundId === candidate.roundId);
    const [phash, previewImage] = await Promise.all([
      generateVideoPhash(
        localPath,
        candidate.round.startTime ?? undefined,
        candidate.round.endTime ?? undefined,
        { lowPriority: true }
      ).catch(() => null),
      candidate.round.previewImage
        ? Promise.resolve(null)
        : generateRoundPreviewImageDataUri({
            videoUri,
            startTimeMs: candidate.round.startTime,
            endTimeMs: candidate.round.endTime,
          }).catch(() => null),
    ]);
    if (resourceRow && phash) {
      await getDb()
        .update(resource)
        .set({ phash, updatedAt: new Date() })
        .where(eq(resource.id, resourceRow.id));
    }
    if (phash || previewImage) {
      await getDb()
        .update(round)
        .set({
          ...(candidate.round.phash ? {} : { phash }),
          ...(candidate.round.previewImage ? {} : { previewImage }),
          updatedAt: new Date(),
        })
        .where(eq(round.id, candidate.roundId));
    }
  }
}

async function markJob(
  jobId: string,
  values: Partial<typeof acquisitionJob.$inferInsert>
): Promise<void> {
  await getDb()
    .update(acquisitionJob)
    .set({ ...values, updatedAt: new Date() })
    .where(eq(acquisitionJob.id, jobId));
}

async function runTorrentJob(job: JobRow, source: SourceRow): Promise<void> {
  const client = await getTorrentClient();
  const locator = JSON.parse(source.locatorJson) as TorrentLocator;
  const selected = new Set(JSON.parse(job.selectedPathsJson) as string[]);
  const root = path.join(resolveAcquisitionDownloadRoot(), locator.infoHash);
  await fs.mkdir(root, { recursive: true });
  await markJob(job.id, {
    state: "fetching_metadata",
    startedAt: job.startedAt ?? new Date(),
    errorMessage: null,
  });
  await new Promise<void>((resolve, reject) => {
    let torrent: TorrentLike | null = null;
    const metadataTimeout = setTimeout(() => {
      torrent?.destroy({ destroyStore: false });
      reject(new Error("Timed out while fetching torrent metadata."));
    }, 120_000);
    torrent = client.add(locator.magnetUri, { path: root }, (ready) => {
      clearTimeout(metadataTimeout);
      if (ready.private) {
        ready.destroy({ destroyStore: false });
        reject(new Error("Private torrents are unsupported."));
        return;
      }
      try {
        for (const tracker of ready.announce ?? []) assertPublicTracker(tracker);
      } catch (error) {
        ready.destroy({ destroyStore: false });
        reject(error);
        return;
      }
      for (const file of ready.files) {
        file.deselect();
        if (selected.has(normalizeAcquisitionPath(file.path))) file.select();
      }
      activeTorrents.set(job.id, ready);
      activeTorrentCounters.set(job.id, {
        downloaded: job.downloadedBytes,
        uploaded: job.uploadedBytes,
      });
      void markJob(job.id, { state: "downloading" });
      const finish = async () => {
        for (const file of ready.files) {
          const normalized = normalizeAcquisitionPath(file.path);
          if (selected.has(normalized))
            await attachCompletedPath(
              source.id,
              normalized,
              safeOutputPath(root, normalized),
              job.addCompletedToLibrary
            );
        }
        activeTorrents.delete(job.id);
        const counters = activeTorrentCounters.get(job.id) ?? {
          downloaded: job.downloadedBytes,
          uploaded: job.uploadedBytes,
        };
        const downloadedBytes = counters.downloaded + ready.downloaded;
        const uploadedBytes = counters.uploaded + ready.uploaded;
        const ratio = downloadedBytes > 0 ? uploadedBytes / downloadedBytes : job.ratio;
        const settings = getAcquisitionSettings();
        if (settings.seedRatio === null && settings.seedTimeMs === null) {
          ready.destroy({ destroyStore: false });
          activeTorrentCounters.delete(job.id);
          await markJob(job.id, {
            state: "completed",
            downloadedBytes,
            uploadedBytes,
            ratio,
            completedAt: new Date(),
          });
        } else {
          activeTorrents.set(job.id, ready);
          activeSeedingJobs.add(job.id);
          await markJob(job.id, {
            state: "seeding",
            downloadedBytes,
            uploadedBytes,
            ratio,
            completedAt: new Date(),
          });
        }
        resolve();
      };
      if (
        ready.done ||
        ready.files
          .filter((file) => selected.has(normalizeAcquisitionPath(file.path)))
          .every((file) => file.progress >= 1)
      ) {
        void finish().catch(reject);
      } else {
        ready.on("done", () => void finish().catch(reject));
      }
    });
    torrent.on("error", (error) => {
      clearTimeout(metadataTimeout);
      const wasActive = activeTorrents.has(job.id);
      torrent?.destroy({ destroyStore: false });
      activeTorrents.delete(job.id);
      activeTorrentCounters.delete(job.id);
      activeSeedingJobs.delete(job.id);
      if (wasActive) {
        void markJob(job.id, {
          state: "failed",
          errorMessage: error instanceof Error ? error.message : "Torrent transfer failed.",
        });
      }
      reject(error instanceof Error ? error : new Error(String(error)));
    });
  });
}

function findMegaEntry(
  root: InstanceType<typeof MegaFile>,
  requestedPath: string
): InstanceType<typeof MegaFile> | null {
  let found: InstanceType<typeof MegaFile> | null = null;
  const visit = (entry: InstanceType<typeof MegaFile>, parents: string[]) => {
    if (found) return;
    const name = entry.name?.trim() || entry.nodeId || "unnamed";
    const next = entry === root && entry.directory ? [] : [...parents, name];
    if (!entry.directory && normalizeAcquisitionPath(next.join("/")) === requestedPath) {
      found = entry;
      return;
    }
    for (const child of entry.children ?? []) visit(child, next);
  };
  visit(root, []);
  return found;
}

async function runMegaJob(job: JobRow, source: SourceRow): Promise<void> {
  const locator = JSON.parse(source.locatorJson) as MegaLocator;
  const selected = JSON.parse(job.selectedPathsJson) as string[];
  const rootFile = MegaFile.fromURL(locator.publicUrl);
  await markJob(job.id, {
    state: "fetching_metadata",
    startedAt: job.startedAt ?? new Date(),
    errorMessage: null,
  });
  await rootFile.loadAttributes();
  const outputRoot = path.join(resolveAcquisitionDownloadRoot(), source.canonicalLocatorHash);
  let downloaded = 0;
  await markJob(job.id, { state: "downloading" });
  for (const selectedPath of selected) {
    const entry = findMegaEntry(rootFile, selectedPath);
    if (!entry) throw new Error(`MEGA file no longer exists: ${selectedPath}`);
    const output = safeOutputPath(outputRoot, selectedPath);
    await fs.mkdir(path.dirname(output), { recursive: true });
    const stream = entry.download({}) as NodeJS.ReadableStream & { destroy(error?: Error): void };
    activeMegaStreams.set(job.id, stream);
    stream.on("data", (chunk: Buffer) => {
      downloaded += chunk.length;
      void markJob(job.id, { downloadedBytes: downloaded });
    });
    await pipeline(stream, createWriteStream(output));
    activeMegaStreams.delete(job.id);
    await attachCompletedPath(source.id, selectedPath, output, job.addCompletedToLibrary);
  }
  await markJob(job.id, {
    state: "completed",
    downloadedBytes: downloaded,
    completedAt: new Date(),
  });
}

async function scheduleJobs(): Promise<void> {
  if (schedulerPromise) return schedulerPromise;
  schedulerPromise = (async () => {
    const settings = getAcquisitionSettings();
    const activeCount = activeTorrents.size - activeSeedingJobs.size + activeMegaJobs.size;
    const slots = Math.max(0, settings.maxActiveDownloads - activeCount);
    if (slots === 0) return;
    const jobs = await getDb().query.acquisitionJob.findMany({
      where: eq(acquisitionJob.state, "queued"),
      orderBy: [asc(acquisitionJob.createdAt)],
      limit: slots,
      with: { source: true },
    });
    for (const job of jobs) {
      const pending = (
        job.kind === "torrent" ? runTorrentJob(job, job.source) : runMegaJob(job, job.source)
      )
        .catch(async (error) => {
          const current = await getDb().query.acquisitionJob.findFirst({
            where: eq(acquisitionJob.id, job.id),
          });
          if (current && !["paused", "cancelled"].includes(current.state)) {
            await markJob(job.id, {
              state: "failed",
              errorMessage: error instanceof Error ? error.message : "Download failed.",
            });
          }
        })
        .finally(() => {
          activeMegaJobs.delete(job.id);
          activeMegaStreams.delete(job.id);
          void scheduleJobs();
        });
      if (job.kind === "mega") activeMegaJobs.set(job.id, pending);
    }
    ensureProgressTimer();
  })().finally(() => {
    schedulerPromise = null;
  });
  return schedulerPromise;
}

function ensureProgressTimer(): void {
  if (progressTimer) return;
  let lastTick = Date.now();
  progressTimer = setInterval(() => {
    const now = Date.now();
    const elapsed = now - lastTick;
    lastTick = now;
    for (const [jobId, torrent] of activeTorrents) {
      void (async () => {
        const job = await getDb().query.acquisitionJob.findFirst({
          where: eq(acquisitionJob.id, jobId),
        });
        if (!job) return;
        const counters = activeTorrentCounters.get(jobId) ?? { downloaded: 0, uploaded: 0 };
        const downloadedBytes = counters.downloaded + torrent.downloaded;
        const uploadedBytes = counters.uploaded + torrent.uploaded;
        const ratio = downloadedBytes > 0 ? uploadedBytes / downloadedBytes : job.ratio;
        const activeSeedTimeMs =
          job.state === "seeding" ? job.activeSeedTimeMs + elapsed : job.activeSeedTimeMs;
        const settings = getAcquisitionSettings();
        const stop =
          job.state === "seeding" &&
          hasReachedSeedLimit({
            ratio,
            activeSeedTimeMs,
            seedRatio: settings.seedRatio,
            seedTimeMs: settings.seedTimeMs,
          });
        await markJob(jobId, {
          downloadedBytes,
          uploadedBytes,
          downloadSpeed: torrent.downloadSpeed,
          uploadSpeed: torrent.uploadSpeed,
          peerCount: torrent.numPeers,
          ratio: Number.isFinite(ratio) ? ratio : 0,
          activeSeedTimeMs,
          ...(stop ? { state: "completed" } : {}),
        });
        if (stop) {
          torrent.destroy({ destroyStore: false });
          activeTorrents.delete(jobId);
          activeTorrentCounters.delete(jobId);
          activeSeedingJobs.delete(jobId);
        }
      })();
    }
    if (activeTorrents.size === 0 && activeMegaJobs.size === 0 && progressTimer) {
      clearInterval(progressTimer);
      progressTimer = null;
    }
  }, 1000);
}

export function hasReachedSeedLimit(input: {
  ratio: number;
  activeSeedTimeMs: number;
  seedRatio: number | null;
  seedTimeMs: number | null;
}): boolean {
  return (
    (input.seedRatio !== null && input.ratio >= input.seedRatio) ||
    (input.seedTimeMs !== null && input.activeSeedTimeMs >= input.seedTimeMs)
  );
}

export async function listAcquisitionJobs() {
  return getDb().query.acquisitionJob.findMany({
    orderBy: [asc(acquisitionJob.createdAt)],
    with: { source: true },
  });
}

export async function getAcquisitionJob(jobId: string) {
  return getDb().query.acquisitionJob.findFirst({
    where: eq(acquisitionJob.id, jobId),
    with: { source: true },
  });
}

export async function pauseAcquisitionJob(jobId: string): Promise<void> {
  await markJob(jobId, { state: "paused" });
  activeTorrents.get(jobId)?.destroy({ destroyStore: false });
  activeTorrents.delete(jobId);
  activeTorrentCounters.delete(jobId);
  activeSeedingJobs.delete(jobId);
  activeMegaStreams.get(jobId)?.destroy(new Error("Download paused."));
  activeMegaStreams.delete(jobId);
}

export async function resumeAcquisitionJob(jobId: string): Promise<void> {
  const active = activeTorrents.get(jobId);
  if (active) {
    active.resume();
    await markJob(jobId, { state: "downloading", errorMessage: null });
  } else {
    await markJob(jobId, { state: "queued", errorMessage: null });
    void scheduleJobs();
  }
}

export async function cancelAcquisitionJob(jobId: string): Promise<void> {
  await markJob(jobId, { state: "cancelled" });
  const torrent = activeTorrents.get(jobId);
  torrent?.destroy({ destroyStore: false });
  activeTorrents.delete(jobId);
  activeTorrentCounters.delete(jobId);
  activeSeedingJobs.delete(jobId);
  activeMegaStreams.get(jobId)?.destroy(new Error("Download cancelled."));
  activeMegaStreams.delete(jobId);
}

export async function removeAcquisitionJob(jobId: string, removeData = false): Promise<void> {
  const job = await getDb().query.acquisitionJob.findFirst({
    where: eq(acquisitionJob.id, jobId),
    with: { source: true },
  });
  if (!job) return;
  await cancelAcquisitionJob(jobId);
  if (removeData) {
    const root =
      job.kind === "torrent"
        ? path.join(
            resolveAcquisitionDownloadRoot(),
            (JSON.parse(job.source.locatorJson) as TorrentLocator).infoHash
          )
        : path.join(resolveAcquisitionDownloadRoot(), job.source.canonicalLocatorHash);
    const resolvedRoot = path.resolve(resolveAcquisitionDownloadRoot());
    const target = path.resolve(root);
    if (!target.startsWith(`${resolvedRoot}${path.sep}`))
      throw new Error("Refusing to remove data outside acquisition storage.");
    const paths = JSON.parse(job.selectedPathsJson) as string[];
    for (const sourcePath of paths) {
      await fs.rm(safeOutputPath(target, sourcePath), { force: true });
    }
    const candidates = await getDb().query.roundAcquisitionCandidate.findMany({
      where: and(
        eq(roundAcquisitionCandidate.sourceId, job.sourceId),
        inArray(roundAcquisitionCandidate.sourcePath, paths)
      ),
    });
    if (candidates.length > 0) {
      const acquiredUris = paths.map((sourcePath) =>
        toLocalMediaUri(safeOutputPath(target, sourcePath))
      );
      // A round may have another local or remote resource. Removing acquisition
      // data must never discard those unrelated alternatives.
      await getDb()
        .delete(resource)
        .where(
          and(
            inArray(
              resource.roundId,
              candidates.map((entry) => entry.roundId)
            ),
            inArray(resource.videoUri, acquiredUris)
          )
        );
    }
  }
  await getDb().delete(acquisitionJob).where(eq(acquisitionJob.id, jobId));
}

export async function startAcquisitionService(): Promise<void> {
  const settings = getAcquisitionSettings();
  if (!settings.torrentEnabled) {
    await getDb()
      .update(acquisitionJob)
      .set({ state: "paused", updatedAt: new Date() })
      .where(
        and(
          eq(acquisitionJob.kind, "torrent"),
          inArray(acquisitionJob.state, ["queued", "fetching_metadata", "downloading", "seeding"])
        )
      );
  }
  await getDb()
    .update(acquisitionJob)
    .set({ state: "queued", updatedAt: new Date() })
    .where(
      inArray(
        acquisitionJob.state,
        settings.torrentEnabled
          ? ["fetching_metadata", "downloading", "seeding"]
          : ["fetching_metadata", "downloading"]
      )
    );
  void scheduleJobs();
}

export async function stopTorrentNetworking(): Promise<void> {
  for (const torrent of activeTorrents.values()) torrent.destroy({ destroyStore: false });
  activeTorrents.clear();
  activeTorrentCounters.clear();
  activeSeedingJobs.clear();
  if (torrentClientPromise) {
    const client = await torrentClientPromise;
    await new Promise<void>((resolve) => client.destroy(resolve));
    torrentClientPromise = null;
  }
}

export async function stopAcquisitionService(): Promise<void> {
  if (progressTimer) clearInterval(progressTimer);
  progressTimer = null;
  await stopTorrentNetworking();
  for (const stream of activeMegaStreams.values())
    stream.destroy(new Error("Application shutting down."));
  activeMegaStreams.clear();
}

export async function clearAcquisitionDownloadData(): Promise<void> {
  await stopAcquisitionService();
  const root = path.resolve(resolveAcquisitionDownloadRoot());
  const resources = await getDb().query.resource.findMany({
    columns: { id: true, videoUri: true },
  });
  const managedResourceIds = resources.flatMap((entry) => {
    const localPath = fromLocalMediaUri(entry.videoUri);
    if (!localPath) return [];
    const resolved = path.resolve(localPath);
    return resolved.startsWith(`${root}${path.sep}`) ? [entry.id] : [];
  });
  await fs.rm(root, { recursive: true, force: true });
  await fs.mkdir(root, { recursive: true });
  await getDb().transaction(async (tx) => {
    if (managedResourceIds.length > 0) {
      await tx.delete(resource).where(inArray(resource.id, managedResourceIds));
    }
    await tx.delete(acquisitionJob);
  });
  if (getAcquisitionSettings().torrentEnabled) await startAcquisitionService();
}

export function exportSource(source: SourceRow): ExportedAcquisitionSource {
  if (source.kind === "torrent") {
    const locator = JSON.parse(source.locatorJson) as TorrentLocator;
    return {
      id: source.id,
      kind: "torrent",
      name: source.name,
      magnetUri: locator.magnetUri,
      infoHash: locator.infoHash,
    };
  }
  const locator = JSON.parse(source.locatorJson) as MegaLocator;
  return { id: source.id, kind: "mega", name: source.name, publicUrl: locator.publicUrl };
}
