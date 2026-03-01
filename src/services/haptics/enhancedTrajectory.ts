import type { FunscriptAction } from "../../game/media/playback";
import {
  readGlobalScriptEnhancementEnabled,
  readScriptEnhancement,
  readEnhancementPatterns,
  readEnhancementSpeedProfile,
} from "../scriptEnhancementSettings";
import { enhanceScript, getScriptActionsUri } from "./scriptEnhancement";
import type { HapticsConnectionConfig } from "./types";
import { getFunscriptActionsFingerprint } from "./funscriptRateLimiter";
import { normalizeFunscriptMaxRate } from "./funscriptRateLimiter";
import { enhancementProfileMaxRate } from "./enhancementProfile";
import { hasStrokeShapes } from "./enhancementPatterns";

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
  let patterns;
  try {
    if (!(await readGlobalScriptEnhancementEnabled())) return actions;
    settings = await readScriptEnhancement(uri);
    if (!settings.enabled) return actions;
    patterns = await readEnhancementPatterns();
  } catch (error) {
    console.warn("Failed to read script enhancement; using original trajectory", error);
    return actions;
  }
  const hasPunch = patterns.beatPunch && (settings.beatPunch ?? settings.wildness) > 0;
  const hasVariation = patterns.variation && (settings.variation ?? settings.wildness) > 0;
  const hasExpansion =
    patterns.delimited && settings.delimitedEnabled !== false && (settings.delimited ?? 0) > 0;
  if (!hasPunch && !hasVariation && !hasExpansion && !hasStrokeShapes(patterns)) return actions;

  const bridge = config.provider === "tcode" || config.provider === "multifunplayer";
  let maxRate;
  try {
    const profile = await readEnhancementSpeedProfile(config.provider);
    const budget = enhancementProfileMaxRate(profile, config.provider);
    maxRate = bridge
      ? budget
      : Math.min(normalizeFunscriptMaxRate(config.funscriptMaxRate), budget);
  } catch (error) {
    console.warn("Failed to read enhancement speed profile; using original trajectory", error);
    return actions;
  }
  const key = JSON.stringify([settings, patterns, playbackRate, maxRate]);
  const variants = cache.get(actions) ?? new Map<string, FunscriptAction[]>();
  const cached = variants.get(key);
  if (cached) return cached;
  const enhanced = enhanceScript(actions, settings, playbackRate, maxRate, patterns);
  if (variants.size >= 8) variants.clear();
  variants.set(key, enhanced);
  cache.set(actions, variants);
  return enhanced;
}
