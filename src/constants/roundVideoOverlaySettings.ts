export const ROUND_PROGRESS_BAR_ALWAYS_VISIBLE_KEY = "game.video.roundProgressBarAlwaysVisible";
export const DEFAULT_ROUND_PROGRESS_BAR_ALWAYS_VISIBLE = false;
export const ANTI_PERK_BEATBAR_ENABLED_KEY = "game.video.antiPerkBeatbarEnabled";
export const DEFAULT_ANTI_PERK_BEATBAR_ENABLED = true;
export const HAPTICS_DISCONNECTED_STATUS_VISIBLE_KEY =
  "game.video.hapticsDisconnectedStatusVisible";
export const DEFAULT_HAPTICS_DISCONNECTED_STATUS_VISIBLE = true;
export const GAMEPLAY_HAPTICS_PERKS_WITHOUT_DEVICE_KEY =
  "game.singleplayer.allowHapticsPerksWithoutDevice";
export const DEFAULT_GAMEPLAY_HAPTICS_PERKS_WITHOUT_DEVICE = false;

function normalizeBooleanSetting(value: unknown, fallback: boolean): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "true") return true;
    if (normalized === "false") return false;
  }
  return fallback;
}

export function normalizeRoundProgressBarAlwaysVisible(value: unknown): boolean {
  return normalizeBooleanSetting(value, DEFAULT_ROUND_PROGRESS_BAR_ALWAYS_VISIBLE);
}

export function normalizeAntiPerkBeatbarEnabled(value: unknown): boolean {
  return normalizeBooleanSetting(value, DEFAULT_ANTI_PERK_BEATBAR_ENABLED);
}

export function normalizeHapticsDisconnectedStatusVisible(value: unknown): boolean {
  return normalizeBooleanSetting(value, DEFAULT_HAPTICS_DISCONNECTED_STATUS_VISIBLE);
}

export function normalizeGameplayHapticsPerksWithoutDevice(value: unknown): boolean {
  return normalizeBooleanSetting(value, DEFAULT_GAMEPLAY_HAPTICS_PERKS_WITHOUT_DEVICE);
}
