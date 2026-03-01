import crypto from "node:crypto";
import { createWriteStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import archiver from "archiver";
import { app } from "electron";
import { once } from "node:events";
import { Readable } from "node:stream";
import yauzl from "yauzl";
import { ZHeroSidecar, ZRoundSidecar } from "../../src/zod/installSidecar";
import { getStore } from "./store";
import { FPACK_EXTRACTION_PATH_KEY } from "../../src/constants/fpackSettings";
import { FPACK_EXTRACTION_RELATIVE_PATH, resolveConfiguredStoragePath } from "./storagePaths";

const FPACK_MANIFEST_NAME = ".fpack-manifest.json";

export type FpackSidecarEntry = {
  archiveEntryPath: string;
  extractedPath: string | null;
  ext: ".round" | ".hero" | ".fplay";
  contentName: string;
  resources: Array<{ videoUri: string; funscriptUri: string | null }>;
};

export type FpackInspection = {
  archivePath: string;
  entryCount: number;
  sidecarCount: number;
  sidecars: FpackSidecarEntry[];
};

export type FpackExtractionManifest = {
  sourcePath: string;
  sourceSize: number;
  sourceMtimeMs: number;
  archiveDisplayName: string;
  archiveEntryCount: number;
  sidecarEntryCount: number;
  completedAt: string | null;
  sidecarEntries: Array<{
    archiveEntryPath: string;
    extractedPath: string;
    ext: ".round" | ".hero" | ".fplay";
  }>;
};

type ZipIterationEntry = {
  entry: yauzl.Entry;
  normalizedPath: string;
  isDirectory: boolean;
};

type EnsureFpackExtractedOptions = {
  onProgress?: (progress: { current: number; total: number; unit: "files" }) => void;
};

export function isFpackFile(filePath: string): boolean {
  return filePath.trim().toLowerCase().endsWith(".fpack");
}

function normalizeArchiveEntryPath(fileName: string): string | null {
  const normalized = path.posix.normalize(fileName.replaceAll("\\", "/"));
  if (!normalized || normalized === "." || normalized === "/") return null;
  const trimmed = normalized.replace(/^\/+/u, "").replace(/\/+$/u, "");
  if (!trimmed || trimmed === "." || trimmed.startsWith("../") || trimmed.includes("/../")) {
    return null;
  }
  return trimmed;
}

function getSidecarExtension(entryPath: string): ".round" | ".hero" | ".fplay" | null {
  const ext = path.posix.extname(entryPath).toLowerCase();
  if (ext === ".round" || ext === ".hero" || ext === ".fplay") {
    return ext;
  }
  return null;
}

function resolveArchiveResourceUri(resourceUri: string, archiveEntryPath: string): string {
  const trimmed = resourceUri.trim();
  if (!trimmed.startsWith("./") && !trimmed.startsWith("../")) {
    return trimmed;
  }
  const resolved = path.posix.normalize(
    path.posix.join(path.posix.dirname(archiveEntryPath), trimmed)
  );
  if (!resolved || resolved === "." || resolved.startsWith("../") || resolved.includes("/../")) {
    return trimmed;
  }
  return resolved;
}

function parseSidecarInspectionContent(
  archiveEntryPath: string,
  ext: ".round" | ".hero" | ".fplay",
  content: string
): Omit<FpackSidecarEntry, "archiveEntryPath" | "extractedPath" | "ext"> {
  if (ext === ".fplay") {
    return {
      contentName: path.posix.basename(archiveEntryPath, ".fplay"),
      resources: [],
    };
  }

  const parsedJson = JSON.parse(content) as unknown;
  if (ext === ".round") {
    const parsed = ZRoundSidecar.parse(parsedJson);
    return {
      contentName: parsed.name,
      resources: parsed.resources.map((resource) => ({
        videoUri: resolveArchiveResourceUri(resource.videoUri, archiveEntryPath),
        funscriptUri: resource.funscriptUri
          ? resolveArchiveResourceUri(resource.funscriptUri, archiveEntryPath)
          : null,
      })),
    };
  }

  const parsed = ZHeroSidecar.parse(parsedJson);
  return {
    contentName: parsed.name,
    resources: parsed.rounds.flatMap((round) =>
      round.resources.map((resource) => ({
        videoUri: resolveArchiveResourceUri(resource.videoUri, archiveEntryPath),
        funscriptUri: resource.funscriptUri
          ? resolveArchiveResourceUri(resource.funscriptUri, archiveEntryPath)
          : null,
      }))
    ),
  };
}

async function readStreamToBuffer(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

async function withOpenZip<T>(
  fpackPath: string,
  handler: (zipfile: yauzl.ZipFile) => Promise<T>
): Promise<T> {
  const zipfile = await new Promise<yauzl.ZipFile>((resolve, reject) => {
    yauzl.open(fpackPath, { lazyEntries: true }, (err, opened) => {
      if (err) {
        reject(new Error(`Failed to open .fpack file: ${err.message}`));
        return;
      }
      if (!opened) {
        reject(new Error("Failed to open .fpack file: no zipfile handle."));
        return;
      }
      resolve(opened);
    });
  });

  try {
    return await handler(zipfile);
  } finally {
    zipfile.close();
  }
}

async function iterateZipEntries(
  zipfile: yauzl.ZipFile,
  onEntry: (entry: ZipIterationEntry, zipfile: yauzl.ZipFile) => Promise<void>
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    let processing = false;

    const readNext = () => {
      if (processing) return;
      processing = true;
      zipfile.readEntry();
    };

    zipfile.on("error", (zipErr) => {
      reject(new Error(`Failed to read .fpack file: ${zipErr.message}`));
    });

    zipfile.on("end", () => {
      resolve();
    });

    zipfile.on("entry", (entry) => {
      const normalizedPath = normalizeArchiveEntryPath(entry.fileName);
      processing = false;
      if (!normalizedPath) {
        readNext();
        return;
      }

      void onEntry(
        {
          entry,
          normalizedPath,
          isDirectory: /\/$/u.test(entry.fileName),
        },
        zipfile
      )
        .then(() => {
          readNext();
        })
        .catch(reject);
    });

    readNext();
  });
}

async function openEntryReadStream(zipfile: yauzl.ZipFile, entry: yauzl.Entry): Promise<Readable> {
  return await new Promise<Readable>((resolve, reject) => {
    zipfile.openReadStream(entry, (streamErr, readStream) => {
      if (streamErr) {
        reject(new Error(`Failed to read entry ${entry.fileName}: ${streamErr.message}`));
        return;
      }
      if (!readStream) {
        reject(new Error(`Failed to read entry ${entry.fileName}: no stream.`));
        return;
      }
      resolve(readStream);
    });
  });
}

async function countFpackFileEntries(fpackPath: string): Promise<number> {
  let count = 0;
  await withOpenZip(fpackPath, async (zipfile) => {
    await iterateZipEntries(zipfile, async ({ isDirectory }) => {
      if (!isDirectory) {
        count += 1;
      }
    });
  });
  return count;
}

export async function extractFpackToTemp(
  fpackPath: string
): Promise<{ dir: string; cleanup: () => Promise<void> }> {
  const tempBase = app.getPath("temp");
  const tempDir = path.join(
    tempBase,
    `fpack-extract-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
  );

  const { dir } = await ensureFpackExtracted(fpackPath, {
    onProgress: undefined,
  });
  await fs.cp(dir, tempDir, { recursive: true });

  const cleanup = async () => {
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
  };

  return { dir: tempDir, cleanup };
}

export async function getFpackExtractionRoot(): Promise<string> {
  const store = getStore();
  return resolveConfiguredStoragePath(
    store.get(FPACK_EXTRACTION_PATH_KEY),
    FPACK_EXTRACTION_RELATIVE_PATH
  );
}

export async function clearFpackExtractionCache(rootPath?: string): Promise<void> {
  const resolvedRoot = rootPath ?? (await getFpackExtractionRoot());
  await fs.rm(resolvedRoot, { recursive: true, force: true });
}

async function readFpackFileFingerprint(
  fpackPath: string
): Promise<{ sourcePath: string; sourceSize: number; sourceMtimeMs: number; fingerprint: string }> {
  const sourcePath = path.resolve(fpackPath);
  const stats = await fs.stat(sourcePath);
  const payload = JSON.stringify({
    sourcePath,
    sourceSize: stats.size,
    sourceMtimeMs: stats.mtimeMs,
  });
  const fingerprint = crypto.createHash("sha256").update(payload).digest("hex").slice(0, 24);
  return {
    sourcePath,
    sourceSize: stats.size,
    sourceMtimeMs: stats.mtimeMs,
    fingerprint,
  };
}

async function readExtractionManifest(
  manifestPath: string
): Promise<FpackExtractionManifest | null> {
  try {
    const raw = await fs.readFile(manifestPath, "utf8");
    return JSON.parse(raw) as FpackExtractionManifest;
  } catch {
    return null;
  }
}

function isExtractionManifestReusable(
  manifest: FpackExtractionManifest | null,
  fingerprint: { sourcePath: string; sourceSize: number; sourceMtimeMs: number }
): manifest is FpackExtractionManifest {
  if (!manifest || !manifest.completedAt) return false;
  return (
    manifest.sourcePath === fingerprint.sourcePath &&
    manifest.sourceSize === fingerprint.sourceSize &&
    manifest.sourceMtimeMs === fingerprint.sourceMtimeMs
  );
}

export async function readFpackSidecarEntries(fpackPath: string): Promise<FpackSidecarEntry[]> {
  const sidecars: FpackSidecarEntry[] = [];

  await withOpenZip(fpackPath, async (zipfile) => {
    await iterateZipEntries(zipfile, async ({ entry, normalizedPath, isDirectory }) => {
      if (isDirectory) return;
      const ext = getSidecarExtension(normalizedPath);
      if (!ext) return;
      const stream = await openEntryReadStream(zipfile, entry);
      const content = (await readStreamToBuffer(stream)).toString("utf8");
      const parsed = parseSidecarInspectionContent(normalizedPath, ext, content);
      sidecars.push({
        archiveEntryPath: normalizedPath,
        extractedPath: null,
        ext,
        contentName: parsed.contentName,
        resources: parsed.resources,
      });
    });
  });

  sidecars.sort((a, b) => a.archiveEntryPath.localeCompare(b.archiveEntryPath));
  return sidecars;
}

export async function inspectFpack(fpackPath: string): Promise<FpackInspection> {
  const entryCount = await countFpackFileEntries(fpackPath);

  const sidecars = await readFpackSidecarEntries(fpackPath);
  return {
    archivePath: path.resolve(fpackPath),
    entryCount,
    sidecarCount: sidecars.length,
    sidecars,
  };
}

export async function ensureFpackExtracted(
  fpackPath: string,
  options: EnsureFpackExtractedOptions = {}
): Promise<{ dir: string; reused: boolean; manifest: FpackExtractionManifest }> {
  const root = await getFpackExtractionRoot();
  await fs.mkdir(root, { recursive: true });
  const fingerprint = await readFpackFileFingerprint(fpackPath);
  const destDir = path.join(root, fingerprint.fingerprint);
  const manifestPath = path.join(destDir, FPACK_MANIFEST_NAME);
  const existingManifest = await readExtractionManifest(manifestPath);

  if (isExtractionManifestReusable(existingManifest, fingerprint)) {
    options.onProgress?.({
      current: existingManifest.archiveEntryCount,
      total: existingManifest.archiveEntryCount,
      unit: "files",
    });
    return { dir: destDir, reused: true, manifest: existingManifest };
  }

  await fs.rm(destDir, { recursive: true, force: true }).catch(() => {});
  await fs.mkdir(destDir, { recursive: true });

  const sidecarEntries: FpackExtractionManifest["sidecarEntries"] = [];
  const archiveEntryCount = await countFpackFileEntries(fpackPath);
  let extractedCount = 0;

  await withOpenZip(fpackPath, async (zipfile) => {
    await iterateZipEntries(zipfile, async ({ entry, normalizedPath, isDirectory }) => {
      const entryPath = path.resolve(destDir, normalizedPath);
      const resolvedDest = path.resolve(destDir);
      if (!entryPath.startsWith(resolvedDest + path.sep) && entryPath !== resolvedDest) {
        return;
      }

      if (isDirectory) {
        await fs.mkdir(entryPath, { recursive: true });
        return;
      }

      await fs.mkdir(path.dirname(entryPath), { recursive: true });
      const readStream = await openEntryReadStream(zipfile, entry);
      const writeStream = createWriteStream(entryPath);
      await new Promise<void>((resolve, reject) => {
        readStream.on("error", (readErr) => {
          reject(new Error(`Failed to extract ${entry.fileName}: ${readErr.message}`));
        });
        writeStream.on("error", (writeErr) => {
          reject(new Error(`Failed to write ${entry.fileName}: ${writeErr.message}`));
        });
        writeStream.on("close", () => resolve());
        readStream.pipe(writeStream);
      });

      const ext = getSidecarExtension(normalizedPath);
      if (ext) {
        sidecarEntries.push({
          archiveEntryPath: normalizedPath,
          extractedPath: entryPath,
          ext,
        });
      }
      extractedCount += 1;
      options.onProgress?.({
        current: extractedCount,
        total: archiveEntryCount,
        unit: "files",
      });
    });
  });

  const manifest: FpackExtractionManifest = {
    sourcePath: fingerprint.sourcePath,
    sourceSize: fingerprint.sourceSize,
    sourceMtimeMs: fingerprint.sourceMtimeMs,
    archiveDisplayName: path.basename(fingerprint.sourcePath),
    archiveEntryCount,
    sidecarEntryCount: sidecarEntries.length,
    completedAt: new Date().toISOString(),
    sidecarEntries: sidecarEntries.sort((a, b) =>
      a.archiveEntryPath.localeCompare(b.archiveEntryPath)
    ),
  };
  await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2), "utf8");

  return { dir: destDir, reused: false, manifest };
}

export async function createFpackFromDirectory(dirPath: string, outputPath: string): Promise<void> {
  const output = createWriteStream(outputPath);
  const archive = archiver("zip", { zlib: { level: 6 } });

  const done = once(output, "close");

  archive.pipe(output);
  archive.directory(dirPath, false);
  await archive.finalize();

  await done;
}
