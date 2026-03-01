import { trpc } from "./trpc";
import { normalizeScriptEnhancement, type ScriptEnhancement } from "./haptics/scriptEnhancement";

const reads = new Map<string, Promise<ScriptEnhancement>>();
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
