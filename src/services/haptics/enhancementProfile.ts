import { normalizeFunscriptMaxRate } from "./funscriptRateLimiter";
import type { HapticsProviderId } from "./types";

export type EnhancementSpeedProfile = {
  preset: "automatic" | "balanced" | "responsive" | "powerful" | "custom";
  customRate: number;
};
export const DEFAULT_ENHANCEMENT_SPEED_PROFILE: EnhancementSpeedProfile = {
  preset: "automatic",
  customRate: 1600,
};
export function normalizeEnhancementSpeedProfile(value: unknown): EnhancementSpeedProfile {
  const candidate = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const preset = candidate.preset;
  return {
    preset:
      preset === "balanced" ||
      preset === "responsive" ||
      preset === "powerful" ||
      preset === "custom"
        ? preset
        : "automatic",
    customRate:
      candidate.customRate == null ? 1600 : normalizeFunscriptMaxRate(candidate.customRate),
  };
}
export function enhancementProfileMaxRate(
  profile: EnhancementSpeedProfile,
  provider: HapticsProviderId
): number {
  if (profile.preset === "custom") return profile.customRate;
  if (profile.preset === "balanced") return 400;
  if (profile.preset === "responsive") return 800;
  if (profile.preset === "powerful") return 1600;
  return provider === "multifunplayer" || provider === "tcode" ? 1600 : 400;
}
