export const DEBUG_LOG_LEVEL_KEY = "debug.logLevel";
export const DEFAULT_DEBUG_LOG_LEVEL = "off";

export const DEBUG_LOG_LEVELS = ["off", "error", "warn", "info", "debug"] as const;
export type DebugLogLevel = (typeof DEBUG_LOG_LEVELS)[number];

export const DEBUG_LOG_MAX_FILE_SIZE_MB_KEY = "debug.logMaxFileSizeMb";
export const DEFAULT_DEBUG_LOG_MAX_FILE_SIZE_MB = 200;
export const MIN_DEBUG_LOG_MAX_FILE_SIZE_MB = 1;
export const MAX_DEBUG_LOG_MAX_FILE_SIZE_MB = 10000;

export function normalizeDebugLogLevel(value: unknown): DebugLogLevel {
  return typeof value === "string" && DEBUG_LOG_LEVELS.includes(value as DebugLogLevel)
    ? (value as DebugLogLevel)
    : DEFAULT_DEBUG_LOG_LEVEL;
}

export function normalizeDebugLogMaxFileSizeMb(value: unknown): number {
  const parsed =
    typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  if (!Number.isFinite(parsed)) return DEFAULT_DEBUG_LOG_MAX_FILE_SIZE_MB;
  return Math.max(
    MIN_DEBUG_LOG_MAX_FILE_SIZE_MB,
    Math.min(MAX_DEBUG_LOG_MAX_FILE_SIZE_MB, Math.floor(parsed))
  );
}
