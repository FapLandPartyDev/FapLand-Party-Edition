import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fromLocalMediaUri, toLocalMediaUri } from "./localMedia";
import { HARDMODE_FUNSCRIPT_RELATIVE_PATH, resolveDefaultStoragePath } from "./storagePaths";
import { isStashProxyUri } from "./webVideo";
import { proxyExternalRequest } from "./integrations";
import { estimateFunscriptDifficulty } from "../../src/utils/funscriptDifficulty";

type FunscriptAction = {
  at: number;
  pos: number;
};

type FunscriptDocument = Record<string, unknown> & {
  actions?: unknown;
  version?: unknown;
  fLandHardMode?: unknown;
};

export type HardModeConversionResult = {
  document: FunscriptDocument & {
    actions: FunscriptAction[];
    inverted: false;
    range: 100;
    version: string;
    fLandHardMode: {
      converter: "f-land";
      version: number;
    };
  };
  sourceActions: number;
  outputActions: number;
};

export type ManagedHardModeFunscriptResult = {
  funscriptUri: string;
  sourceActions: number;
  outputActions: number;
};

type HardModeAttachmentRevertRecord = {
  resourceId: string;
  hardModeFunscriptUri: string;
  previousFunscriptUri: string | null;
  converterVersion: number;
};

export const HARDMODE_FUNSCRIPT_CONVERTER_VERSION = 1;
export const HARDMODE_FUNSCRIPT_MARKER_KEY = "fLandHardMode";

function normalizeActions(input: unknown): FunscriptAction[] {
  if (!Array.isArray(input)) return [];
  return input
    .map((entry) => {
      if (!entry || typeof entry !== "object") return null;
      const at = "at" in entry ? Number((entry as { at: unknown }).at) : Number.NaN;
      const pos = "pos" in entry ? Number((entry as { pos: unknown }).pos) : Number.NaN;
      if (!Number.isFinite(at) || !Number.isFinite(pos)) return null;
      return { at, pos };
    })
    .filter((entry): entry is FunscriptAction => entry !== null)
    .sort((a, b) => a.at - b.at);
}

function parseFunscriptDocument(content: string): FunscriptDocument {
  const normalizedContent = content.charCodeAt(0) === 0xfeff ? content.slice(1) : content;
  let parsed: unknown;
  try {
    parsed = JSON.parse(normalizedContent);
  } catch {
    throw new Error("The selected file is not valid funscript JSON.");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("The selected file is not a valid funscript object.");
  }
  return parsed as FunscriptDocument;
}

function normalizeHardModeTimestamps(input: unknown): number[] {
  if (!Array.isArray(input)) {
    throw new Error("The selected funscript does not contain an actions array.");
  }

  const timestamps = input
    .map((entry) => {
      if (!entry || typeof entry !== "object" || !("at" in entry)) return null;
      const at = Number((entry as { at: unknown }).at);
      if (!Number.isFinite(at)) return null;
      return Math.max(0, Math.round(at));
    })
    .filter((at): at is number => at !== null)
    .sort((left, right) => left - right);

  return [...new Set(timestamps)];
}

function isFlandHardModeDocument(document: FunscriptDocument): boolean {
  const marker = document[HARDMODE_FUNSCRIPT_MARKER_KEY];
  return Boolean(
    marker &&
    typeof marker === "object" &&
    "converter" in marker &&
    (marker as { converter?: unknown }).converter === "f-land"
  );
}

function findPauseBoundaries(timestamps: number[]): Set<number> {
  const boundaries = new Set<number>();
  if (timestamps.length < 2) return boundaries;

  const firstGap = timestamps[1]! - timestamps[0]!;
  if (firstGap > 5_000) {
    boundaries.add(1);
  }

  let previousInterval = Math.max(250, firstGap);
  for (let index = 2; index < timestamps.length; index += 1) {
    const interval = timestamps[index]! - timestamps[index - 1]!;
    if (interval > 5 * previousInterval) {
      boundaries.add(index);
    }
    previousInterval = Math.max(250, interval);
  }

  return boundaries;
}

export function convertLegacyFunscriptToHardMode(content: string): HardModeConversionResult {
  const source = parseFunscriptDocument(content);
  if (isFlandHardModeDocument(source)) {
    throw new Error("This funscript was already converted to hard mode by F-Land.");
  }

  const timestamps = normalizeHardModeTimestamps(source.actions);
  if (timestamps.length < 2) {
    throw new Error("A legacy funscript needs at least two distinct action timestamps.");
  }

  const pauseBoundaries = findPauseBoundaries(timestamps);
  const actions: FunscriptAction[] = [];

  for (let index = 0; index < timestamps.length; index += 1) {
    const at = timestamps[index]!;
    actions.push({ at, pos: 0 });

    const nextAt = timestamps[index + 1];
    if (nextAt === undefined || pauseBoundaries.has(index + 1)) continue;

    const midpoint = Math.round((at + nextAt) / 2);
    if (midpoint > at && midpoint < nextAt) {
      actions.push({ at: midpoint, pos: 100 });
    }
  }

  const version =
    typeof source.version === "string" && source.version.trim().length > 0 ? source.version : "1.0";
  const document = {
    ...source,
    actions,
    inverted: false as const,
    range: 100 as const,
    version,
    fLandHardMode: {
      converter: "f-land" as const,
      version: HARDMODE_FUNSCRIPT_CONVERTER_VERSION,
    },
  };

  return {
    document,
    sourceActions: timestamps.length,
    outputActions: actions.length,
  };
}

function sanitizeFunscriptBasename(filePath: string): string {
  const basename = path.basename(filePath, path.extname(filePath));
  const sanitized = basename
    .normalize("NFKD")
    .replace(/[^\p{L}\p{N}._-]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .slice(0, 80);
  return sanitized || "legacy-script";
}

function sourceBasenameFromUri(uri: string, localPath: string | null): string {
  if (localPath) return localPath;
  try {
    const parsed = new URL(uri);
    if (isStashProxyUri(uri)) {
      const target = parsed.searchParams.get("target");
      if (target) return decodeURIComponent(new URL(target).pathname);
    }
    return decodeURIComponent(parsed.pathname);
  } catch {
    return uri;
  }
}

async function readSourceFunscript(uri: string): Promise<{ content: string; basename: string }> {
  const normalizedUri = uri.trim();
  const localPath = fromLocalMediaUri(normalizedUri);
  if (localPath) {
    const content = await fs.readFile(localPath, "utf8").catch((error: unknown) => {
      const message = error instanceof Error ? error.message : "Unknown file error";
      throw new Error(`Could not read the attached funscript: ${message}`);
    });
    return { content, basename: sourceBasenameFromUri(normalizedUri, localPath) };
  }

  let response: Response;
  try {
    if (isStashProxyUri(normalizedUri)) {
      response = await proxyExternalRequest(
        new Request(normalizedUri, {
          method: "GET",
          headers: { Accept: "application/json, text/plain;q=0.9, */*;q=0.8" },
        })
      );
    } else {
      const parsed = new URL(normalizedUri);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        throw new Error("Only local, HTTP, HTTPS, and configured Stash funscripts are supported.");
      }
      response = await fetch(parsed, {
        headers: { Accept: "application/json, text/plain;q=0.9, */*;q=0.8" },
        signal: AbortSignal.timeout(30_000),
      });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown network error";
    throw new Error(`Could not download the attached funscript: ${message}`);
  }

  if (!response.ok) {
    throw new Error(
      `Could not download the attached funscript: ${response.status} ${response.statusText}`.trim()
    );
  }
  return {
    content: await response.text(),
    basename: sourceBasenameFromUri(normalizedUri, null),
  };
}

export async function convertFunscriptUriToManagedHardMode(
  sourceFunscriptUri: string
): Promise<ManagedHardModeFunscriptResult> {
  if (!sourceFunscriptUri.trim()) {
    throw new Error("This round has no funscript attached.");
  }
  const { content: sourceContent, basename } = await readSourceFunscript(sourceFunscriptUri);
  const converted = convertLegacyFunscriptToHardMode(sourceContent);
  const serialized = `${JSON.stringify(converted.document, null, 2)}\n`;
  const contentHash = crypto
    .createHash("sha256")
    .update(`hardmode-v${HARDMODE_FUNSCRIPT_CONVERTER_VERSION}\0`)
    .update(sourceContent)
    .digest("hex")
    .slice(0, 12);
  const outputRoot = resolveDefaultStoragePath(HARDMODE_FUNSCRIPT_RELATIVE_PATH);
  const outputPath = path.join(
    outputRoot,
    `${sanitizeFunscriptBasename(basename)}-hard-mode-${contentHash}.funscript`
  );

  await fs.mkdir(outputRoot, { recursive: true });
  try {
    const existing = await fs.readFile(outputPath, "utf8");
    if (existing !== serialized) {
      throw new Error("A different managed hard-mode funscript already uses this output name.");
    }
  } catch (error) {
    const code =
      error && typeof error === "object" && "code" in error
        ? (error as { code?: unknown }).code
        : null;
    if (code !== "ENOENT") throw error;

    const temporaryPath = `${outputPath}.${crypto.randomUUID()}.tmp`;
    try {
      await fs.writeFile(temporaryPath, serialized, { encoding: "utf8", flag: "wx" });
      await fs.rename(temporaryPath, outputPath);
    } finally {
      await fs.unlink(temporaryPath).catch(() => undefined);
    }
  }

  return {
    funscriptUri: toLocalMediaUri(outputPath),
    sourceActions: converted.sourceActions,
    outputActions: converted.outputActions,
  };
}

export async function convertLocalFunscriptToManagedHardMode(
  sourceFunscriptUri: string
): Promise<ManagedHardModeFunscriptResult> {
  const sourcePath = fromLocalMediaUri(sourceFunscriptUri);
  if (!sourcePath || path.extname(sourcePath).toLowerCase() !== ".funscript") {
    throw new Error("Select a local .funscript file to convert.");
  }
  return convertFunscriptUriToManagedHardMode(sourceFunscriptUri);
}

function attachmentRevertRecordPath(resourceId: string, hardModeFunscriptUri: string): string {
  const key = crypto
    .createHash("sha256")
    .update(resourceId)
    .update("\0")
    .update(hardModeFunscriptUri)
    .digest("hex");
  return path.join(
    resolveDefaultStoragePath(HARDMODE_FUNSCRIPT_RELATIVE_PATH),
    "revert-records",
    `${key}.json`
  );
}

export async function recordHardModeAttachmentReverts(
  entries: Array<{
    resourceId: string;
    hardModeFunscriptUri: string;
    previousFunscriptUri: string | null;
  }>
): Promise<void> {
  const records = entries.map<HardModeAttachmentRevertRecord>((entry) => ({
    ...entry,
    converterVersion: HARDMODE_FUNSCRIPT_CONVERTER_VERSION,
  }));

  for (const record of records) {
    const recordPath = attachmentRevertRecordPath(record.resourceId, record.hardModeFunscriptUri);
    await fs.mkdir(path.dirname(recordPath), { recursive: true });
    const temporaryPath = `${recordPath}.${crypto.randomUUID()}.tmp`;
    try {
      await fs.writeFile(temporaryPath, `${JSON.stringify(record, null, 2)}\n`, {
        encoding: "utf8",
        flag: "wx",
      });
      await fs.rename(temporaryPath, recordPath);
    } finally {
      await fs.unlink(temporaryPath).catch(() => undefined);
    }
  }
}

export async function getHardModeAttachmentRevert(
  resourceId: string,
  hardModeFunscriptUri: string
): Promise<HardModeAttachmentRevertRecord | null> {
  const recordPath = attachmentRevertRecordPath(resourceId, hardModeFunscriptUri);
  try {
    const parsed = JSON.parse(
      await fs.readFile(recordPath, "utf8")
    ) as Partial<HardModeAttachmentRevertRecord>;
    if (
      parsed.resourceId !== resourceId ||
      parsed.hardModeFunscriptUri !== hardModeFunscriptUri ||
      parsed.converterVersion !== HARDMODE_FUNSCRIPT_CONVERTER_VERSION ||
      !(parsed.previousFunscriptUri === null || typeof parsed.previousFunscriptUri === "string")
    ) {
      return null;
    }
    return parsed as HardModeAttachmentRevertRecord;
  } catch {
    return null;
  }
}

function calculateDifficulty(actions: FunscriptAction[]): number | null {
  if (actions.length < 2) return null;

  const durationMs = actions[actions.length - 1].at - actions[0].at;
  if (!(durationMs > 0)) return null;

  const durationSec = durationMs / 1000;
  const pointRate = actions.length / durationSec;

  let velocitySamples = 0;
  let velocitySum = 0;
  for (let index = 1; index < actions.length; index += 1) {
    const previous = actions[index - 1];
    const current = actions[index];
    if (!previous || !current) continue;
    const deltaTimeSec = (current.at - previous.at) / 1000;
    if (deltaTimeSec <= 0) continue;
    const deltaPos = Math.abs(current.pos - previous.pos);
    velocitySum += deltaPos / deltaTimeSec;
    velocitySamples += 1;
  }

  if (velocitySamples === 0) return null;

  const avgVelocity = velocitySum / velocitySamples;
  return estimateFunscriptDifficulty({
    averageVelocity: avgVelocity,
    pointsPerSecond: pointRate,
    durationSec,
  });
}

async function readFunscriptContent(uri: string): Promise<string | null> {
  const localPath = fromLocalMediaUri(uri);
  if (localPath) {
    return await fs.readFile(localPath, "utf8");
  }

  if (uri.startsWith("http://") || uri.startsWith("https://")) {
    const response = await fetch(uri);
    if (!response.ok) return null;
    return await response.text();
  }

  return null;
}

export async function calculateFunscriptDifficultyFromUri(
  uri: string | null | undefined
): Promise<number | null> {
  const trimmedUri = typeof uri === "string" ? uri.trim() : "";
  if (!trimmedUri) return null;

  try {
    const content = await readFunscriptContent(trimmedUri);
    if (!content) return null;
    const parsed = JSON.parse(content) as { actions?: unknown };
    return calculateDifficulty(normalizeActions(parsed.actions));
  } catch {
    return null;
  }
}
