import type { FunscriptAction } from "../../game/media/playback";
import {
  readGlobalScriptEnhancementEnabled,
  readScriptEnhancement,
} from "../scriptEnhancementSettings";
import { enhanceScript, getScriptActionsUri } from "./scriptEnhancement";
import type { HapticsConnectionConfig } from "./types";
import { getFunscriptActionsFingerprint } from "./funscriptRateLimiter";

const cache = new WeakMap<FunscriptAction[], Map<string, FunscriptAction[]>>();
const fingerprints = new WeakMap<FunscriptAction[], string>();

export function enhancedSourceId(
  sourceId: string,
  original: FunscriptAction[],
  enhanced: FunscriptAction[]
): string {
  if (original === enhanced) return sourceId;
  let fingerprint = fingerprints.get(enhanced);
  if (!fingerprint) {
    fingerprint = getFunscriptActionsFingerprint(enhanced);
    fingerprints.set(enhanced, fingerprint);
  }
  return `${sourceId}:enhanced=${fingerprint}`;
}

export async function getEnhancedTrajectory(
  config: HapticsConnectionConfig,
  actions: FunscriptAction[],
  playbackRate = 1
): Promise<FunscriptAction[]> {
  const uri = getScriptActionsUri(actions);
  if (!uri) return actions;
  let settings;
  try {
    if (!(await readGlobalScriptEnhancementEnabled())) return actions;
    settings = await readScriptEnhancement(uri);
  } catch (error) {
    console.warn("Failed to read script enhancement; using original trajectory", error);
    return actions;
  }
  if (!settings.enabled || settings.wildness === 0) return actions;
  const maxRate = config.provider === "tcode" ? undefined : config.funscriptMaxRate;
  const key = `${settings.wildness}:${playbackRate}:${maxRate}`;
  const variants = cache.get(actions) ?? new Map<string, FunscriptAction[]>();
  const cached = variants.get(key);
  if (cached) return cached;
  const enhanced = enhanceScript(actions, settings, playbackRate, maxRate);
  if (variants.size >= 8) variants.clear();
  variants.set(key, enhanced);
  cache.set(actions, variants);
  return enhanced;
}
