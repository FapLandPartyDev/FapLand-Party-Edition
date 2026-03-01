export const SFX_VOLUME_KEY = "audio.sfxVolume";
export const DEFAULT_SFX_VOLUME = 1.0;
export const SFX_VOLUME_CHANGED_EVENT = "fland:sfx-volume-changed";

export function clampSfxVolume(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) return DEFAULT_SFX_VOLUME;
  return Math.max(0, Math.min(1, parsed));
}
