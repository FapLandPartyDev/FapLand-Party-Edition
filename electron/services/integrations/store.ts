import crypto from "node:crypto";
import * as z from "zod";
import { getStore } from "../store";
import {
  INTEGRATIONS_DISABLED_ROUND_IDS_KEY,
  INTEGRATIONS_SOURCES_KEY,
  INTEGRATIONS_SYNC_STATUS_KEY,
  type ExternalSource,
  type IntegrationSyncStatus,
  type StashAuthMode,
  type StashTagSelection,
} from "./types";

const ZRoundType = z.enum(["Normal", "Interjection", "Cum"]);

const ZTagSelection = z
  .object({
    id: z.string().trim().min(1),
    name: z.string().trim().min(1),
    roundTypeFallback: ZRoundType,
  })
  .strict();

const ZSource = z
  .object({
    id: z.string().trim().min(1),
    kind: z.literal("stash"),
    name: z.string().trim().min(1),
    enabled: z.boolean(),
    baseUrl: z.string().trim().min(1),
    authMode: z.enum(["apiKey", "login"]),
    apiKey: z.string().trim().min(1).nullable(),
    username: z.string().trim().min(1).nullable(),
    password: z.string().trim().min(1).nullable(),
    tagSelections: z.array(ZTagSelection),
    createdAt: z.string().trim().min(1),
    updatedAt: z.string().trim().min(1),
  })
  .strict();

const ZSourceList = z.array(ZSource);
const ZDisabledRoundIds = z.array(z.string().trim().min(1));

const ZSyncStatus: z.ZodType<IntegrationSyncStatus> = z
  .object({
    state: z.enum(["idle", "running", "done", "error"]),
    triggeredBy: z.enum(["startup", "manual"]),
    startedAt: z.string().nullable(),
    finishedAt: z.string().nullable(),
    stats: z
      .object({
        sourcesSeen: z.number().int().nonnegative(),
        sourcesSynced: z.number().int().nonnegative(),
        scenesSeen: z.number().int().nonnegative(),
        roundsCreated: z.number().int().nonnegative(),
        roundsUpdated: z.number().int().nonnegative(),
        roundsLinked: z.number().int().nonnegative(),
        resourcesAdded: z.number().int().nonnegative(),
        disabledRounds: z.number().int().nonnegative(),
        failed: z.number().int().nonnegative(),
      })
      .strict(),
    lastMessage: z.string().nullable(),
    lastErrors: z.array(z.object({ sourceId: z.string(), message: z.string() }).strict()),
  })
  .strict();

export type CreateStashSourceInput = {
  name: string;
  enabled?: boolean;
  baseUrl: string;
  authMode: StashAuthMode;
  apiKey?: string | null;
  username?: string | null;
  password?: string | null;
  tagSelections?: StashTagSelection[];
};

export type UpdateStashSourceInput = {
  sourceId: string;
  name?: string;
  enabled?: boolean;
  baseUrl?: string;
  authMode?: StashAuthMode;
  apiKey?: string | null;
  username?: string | null;
  password?: string | null;
  tagSelections?: StashTagSelection[];
};

export function normalizeBaseUrl(input: string): string {
  let parsed: URL;
  try {
    parsed = new URL(input.trim());
  } catch {
    throw new Error("Invalid base URL.");
  }

  if (!(parsed.protocol === "http:" || parsed.protocol === "https:")) {
    throw new Error("Stash base URL must use http or https.");
  }

  parsed.hash = "";
  parsed.search = "";
  parsed.pathname = parsed.pathname.replace(/\/+$/, "");

  return parsed.toString().replace(/\/$/, "");
}

function normalizeNullableText(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function sanitizeTagSelections(input: StashTagSelection[] | undefined): StashTagSelection[] {
  if (!input || input.length === 0) return [];

  const deduped = new Map<string, StashTagSelection>();
  for (const selection of input) {
    const parsed = ZTagSelection.parse(selection);
    deduped.set(parsed.id, parsed);
  }

  return Array.from(deduped.values());
}

function parseStoredSources(): ExternalSource[] {
  const parsed = ZSourceList.safeParse(getStore().get(INTEGRATIONS_SOURCES_KEY));
  if (parsed.success) return parsed.data;
  getStore().set(INTEGRATIONS_SOURCES_KEY, []);
  return [];
}

function writeSources(next: ExternalSource[]): ExternalSource[] {
  const validated = ZSourceList.parse(next);
  getStore().set(INTEGRATIONS_SOURCES_KEY, validated);
  return validated;
}

export function listExternalSources(): ExternalSource[] {
  return parseStoredSources().sort((a, b) => a.name.localeCompare(b.name));
}

export function getExternalSourceById(sourceId: string): ExternalSource | null {
  const normalized = sourceId.trim();
  if (normalized.length === 0) return null;
  return parseStoredSources().find((source) => source.id === normalized) ?? null;
}

export function createStashSource(input: CreateStashSourceInput): ExternalSource {
  const name = input.name.trim();
  if (name.length === 0) {
    throw new Error("Source name is required.");
  }

  const now = new Date().toISOString();
  const created: ExternalSource = {
    id: crypto.randomUUID(),
    kind: "stash",
    name,
    enabled: input.enabled ?? true,
    baseUrl: normalizeBaseUrl(input.baseUrl),
    authMode: input.authMode,
    apiKey: normalizeNullableText(input.apiKey),
    username: normalizeNullableText(input.username),
    password: normalizeNullableText(input.password),
    tagSelections: sanitizeTagSelections(input.tagSelections),
    createdAt: now,
    updatedAt: now,
  };

  if (created.authMode === "apiKey" && !created.apiKey) {
    throw new Error("API key is required for API key auth mode.");
  }
  if (created.authMode === "login" && (!created.username || !created.password)) {
    throw new Error("Username and password are required for login auth mode.");
  }

  const current = parseStoredSources();
  if (current.some((source) => source.baseUrl === created.baseUrl && source.id !== created.id)) {
    throw new Error("A source with this base URL already exists.");
  }

  writeSources([...current, created]);
  return created;
}

export function updateStashSource(input: UpdateStashSourceInput): ExternalSource {
  const sourceId = input.sourceId.trim();
  if (!sourceId) throw new Error("sourceId is required.");

  const current = parseStoredSources();
  const existing = current.find((source) => source.id === sourceId);
  if (!existing) {
    throw new Error("Source not found.");
  }

  const updated: ExternalSource = {
    ...existing,
    name: input.name !== undefined ? input.name.trim() : existing.name,
    enabled: input.enabled ?? existing.enabled,
    baseUrl: input.baseUrl !== undefined ? normalizeBaseUrl(input.baseUrl) : existing.baseUrl,
    authMode: input.authMode ?? existing.authMode,
    apiKey: input.apiKey !== undefined ? normalizeNullableText(input.apiKey) : existing.apiKey,
    username: input.username !== undefined ? normalizeNullableText(input.username) : existing.username,
    password: input.password !== undefined ? normalizeNullableText(input.password) : existing.password,
    tagSelections: input.tagSelections !== undefined ? sanitizeTagSelections(input.tagSelections) : existing.tagSelections,
    updatedAt: new Date().toISOString(),
  };

  if (!updated.name) {
    throw new Error("Source name is required.");
  }
  if (updated.authMode === "apiKey" && !updated.apiKey) {
    throw new Error("API key is required for API key auth mode.");
  }
  if (updated.authMode === "login" && (!updated.username || !updated.password)) {
    throw new Error("Username and password are required for login auth mode.");
  }
  if (current.some((source) => source.baseUrl === updated.baseUrl && source.id !== updated.id)) {
    throw new Error("A source with this base URL already exists.");
  }

  writeSources(current.map((source) => (source.id === updated.id ? updated : source)));
  return updated;
}

export function deleteExternalSource(sourceId: string): void {
  const normalized = sourceId.trim();
  if (!normalized) return;

  const current = parseStoredSources();
  writeSources(current.filter((source) => source.id !== normalized));
}

export function setExternalSourceEnabled(sourceId: string, enabled: boolean): ExternalSource {
  return updateStashSource({ sourceId, enabled });
}

export function toStashInstallSourceKey(baseUrl: string, sceneId: string): string {
  return `stash:${normalizeBaseUrl(baseUrl)}:scene:${sceneId.trim()}`;
}

export function sourcePrefixForManagedRounds(source: ExternalSource): string {
  return `stash:${normalizeBaseUrl(source.baseUrl)}:scene:`;
}

export function getDisabledRoundIds(): string[] {
  const parsed = ZDisabledRoundIds.safeParse(getStore().get(INTEGRATIONS_DISABLED_ROUND_IDS_KEY));
  if (parsed.success) {
    return [...new Set(parsed.data)].sort((a, b) => a.localeCompare(b));
  }

  getStore().set(INTEGRATIONS_DISABLED_ROUND_IDS_KEY, []);
  return [];
}

export function setDisabledRoundIds(roundIds: Iterable<string>): string[] {
  const deduped = [...new Set(Array.from(roundIds).map((id) => id.trim()).filter((id) => id.length > 0))].sort(
    (a, b) => a.localeCompare(b),
  );

  getStore().set(INTEGRATIONS_DISABLED_ROUND_IDS_KEY, deduped);
  return deduped;
}

export function createEmptyIntegrationSyncStatus(): IntegrationSyncStatus {
  return {
    state: "idle",
    triggeredBy: "manual",
    startedAt: null,
    finishedAt: null,
    stats: {
      sourcesSeen: 0,
      sourcesSynced: 0,
      scenesSeen: 0,
      roundsCreated: 0,
      roundsUpdated: 0,
      roundsLinked: 0,
      resourcesAdded: 0,
      disabledRounds: 0,
      failed: 0,
    },
    lastMessage: null,
    lastErrors: [],
  };
}

export function getIntegrationSyncStatus(): IntegrationSyncStatus {
  const parsed = ZSyncStatus.safeParse(getStore().get(INTEGRATIONS_SYNC_STATUS_KEY));
  if (parsed.success) {
    return parsed.data;
  }

  const empty = createEmptyIntegrationSyncStatus();
  setIntegrationSyncStatus(empty);
  return empty;
}

export function setIntegrationSyncStatus(status: IntegrationSyncStatus): IntegrationSyncStatus {
  const validated = ZSyncStatus.parse(status);
  getStore().set(INTEGRATIONS_SYNC_STATUS_KEY, validated);
  return validated;
}
