export const DEFAULT_ENHANCEMENT_PATTERNS = {
  beatPunch: true,
  variation: true,
  delimited: true,
  overshoot: false,
  staircase: false,
  doubleRebound: false,
  softLanding: false,
};

export type EnhancementPatterns = typeof DEFAULT_ENHANCEMENT_PATTERNS;

export function normalizeEnhancementPatterns(value: unknown): EnhancementPatterns {
  const stored = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  return {
    beatPunch: stored.beatPunch !== false,
    variation: stored.variation !== false,
    delimited: stored.delimited !== false,
    overshoot: stored.overshoot === true,
    staircase: stored.staircase === true,
    doubleRebound: stored.doubleRebound === true,
    softLanding: stored.softLanding === true,
  };
}

export function hasStrokeShapes(patterns: EnhancementPatterns): boolean {
  return patterns.overshoot || patterns.staircase || patterns.doubleRebound || patterns.softLanding;
}
