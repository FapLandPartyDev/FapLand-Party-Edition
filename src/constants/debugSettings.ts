export const DEBUG_LOG_LEVEL_KEY = "debug.logLevel";
export const DEFAULT_DEBUG_LOG_LEVEL = "off";

export const DEBUG_LOG_LEVELS = ["off", "error", "warn", "info", "debug"] as const;
export type DebugLogLevel = (typeof DEBUG_LOG_LEVELS)[number];

export function normalizeDebugLogLevel(value: unknown): DebugLogLevel {
  return typeof value === "string" && DEBUG_LOG_LEVELS.includes(value as DebugLogLevel)
    ? (value as DebugLogLevel)
    : DEFAULT_DEBUG_LOG_LEVEL;
}
