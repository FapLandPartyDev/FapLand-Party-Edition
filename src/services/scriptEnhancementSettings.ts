import { trpc } from "./trpc";
import { normalizeScriptEnhancement, type ScriptEnhancement } from "./haptics/scriptEnhancement";
import {
  normalizeEnhancementSpeedProfile,
  type EnhancementSpeedProfile,
} from "./haptics/enhancementProfile";
import type { HapticsProviderId } from "./haptics/types";
import {
  normalizeEnhancementPatterns,
  type EnhancementPatterns,
} from "./haptics/enhancementPatterns";

const reads = new Map<string, Promise<ScriptEnhancement>>();
const profiles = new Map<HapticsProviderId, Promise<EnhancementSpeedProfile>>();
const profileKey = (provider: HapticsProviderId) => `game.funscript.enhancementSpeed.${provider}`;
export function readEnhancementSpeedProfile(
  provider: HapticsProviderId
): Promise<EnhancementSpeedProfile> {
  const existing = profiles.get(provider);
  if (existing) return existing;
  const pending = trpc.store.get
    .query({ key: profileKey(provider) })
    .then(normalizeEnhancementSpeedProfile)
    .catch((error: unknown) => {
      profiles.delete(provider);
      throw error;
    });
  profiles.set(provider, pending);
  return pending;
}
export async function saveEnhancementSpeedProfile(
  provider: HapticsProviderId,
  value: EnhancementSpeedProfile
): Promise<EnhancementSpeedProfile> {
  const normalized = normalizeEnhancementSpeedProfile(value);
  await trpc.store.set.mutate({ key: profileKey(provider), value: normalized });
  profiles.set(provider, Promise.resolve(normalized));
  return normalized;
}
export const SCRIPT_ENHANCEMENT_ENABLED_KEY = "game.funscript.enhancementEnabled";
export const DEFAULT_SCRIPT_ENHANCEMENT_ENABLED = true;
export function normalizeScriptEnhancementEnabled(value: unknown): boolean {
  return typeof value === "boolean" ? value : DEFAULT_SCRIPT_ENHANCEMENT_ENABLED;
}
let globalRead: Promise<boolean> | undefined;

export function readGlobalScriptEnhancementEnabled(): Promise<boolean> {
  if (globalRead) return globalRead;
  globalRead = trpc.store.get
    .query({ key: SCRIPT_ENHANCEMENT_ENABLED_KEY })
    .then(normalizeScriptEnhancementEnabled)
    .catch((error: unknown) => {
      globalRead = undefined;
      throw error;
    });
  return globalRead;
}

export async function saveGlobalScriptEnhancementEnabled(enabled: boolean): Promise<void> {
  await trpc.store.set.mutate({ key: SCRIPT_ENHANCEMENT_ENABLED_KEY, value: enabled });
  globalRead = Promise.resolve(enabled);
}

export const SCRIPT_ENHANCEMENT_PATTERNS_KEY = "game.funscript.enhancementPatterns";
let patternsRead: Promise<EnhancementPatterns> | undefined;
let patternsWrite: Promise<unknown> = Promise.resolve();

export function readEnhancementPatterns(): Promise<EnhancementPatterns> {
  patternsRead ??= trpc.store.get
    .query({ key: SCRIPT_ENHANCEMENT_PATTERNS_KEY })
    .then(normalizeEnhancementPatterns)
    .catch((error: unknown) => {
      patternsRead = undefined;
      throw error;
    });
  return patternsRead;
}

export function saveEnhancementPattern(
  pattern: keyof EnhancementPatterns,
  enabled: boolean
): Promise<EnhancementPatterns> {
  const pending = patternsWrite.then(async () => {
    const next = { ...(await readEnhancementPatterns()), [pattern]: enabled };
    await trpc.store.set.mutate({ key: SCRIPT_ENHANCEMENT_PATTERNS_KEY, value: next });
    patternsRead = Promise.resolve(next);
    return next;
  });
  patternsWrite = pending.catch(() => undefined);
  return pending;
}
const keyFor = (uri: string) => `game.funscript.enhancement.${encodeURIComponent(uri)}`;

export function readScriptEnhancement(uri: string): Promise<ScriptEnhancement> {
  const existing = reads.get(uri);
  if (existing) return existing;
  const pending = trpc.store.get
    .query({ key: keyFor(uri) })
    .then(normalizeScriptEnhancement)
    .catch((error: unknown) => {
      reads.delete(uri);
      throw error;
    });
  reads.set(uri, pending);
  return pending;
}

export async function saveScriptEnhancement(
  uri: string,
  value: ScriptEnhancement
): Promise<ScriptEnhancement> {
  const normalized = normalizeScriptEnhancement(value);
  await trpc.store.set.mutate({ key: keyFor(uri), value: normalized });
  reads.set(uri, Promise.resolve(normalized));
  return normalized;
}
