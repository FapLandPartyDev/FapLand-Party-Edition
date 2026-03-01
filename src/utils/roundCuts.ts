export type RoundCutRange = {
  startTimeMs: number;
  endTimeMs: number;
};

export const MIN_ROUND_CUT_MS = 100;

function toFiniteIntegerMs(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return Math.floor(value);
}

export function normalizeRoundCutRanges(
  input: unknown,
  startTimeMs: number,
  endTimeMs: number,
  options: { minCutMs?: number; mergeAdjacent?: boolean } = {}
): RoundCutRange[] {
  if (!Array.isArray(input)) return [];

  const minCutMs = options.minCutMs ?? MIN_ROUND_CUT_MS;
  const mergeAdjacent = options.mergeAdjacent ?? true;
  const start = Math.floor(startTimeMs);
  const end = Math.floor(endTimeMs);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return [];

  const sorted = input
    .map((entry) => {
      if (!entry || typeof entry !== "object") return null;
      const record = entry as Record<string, unknown>;
      const cutStart = toFiniteIntegerMs(record.startTimeMs);
      const cutEnd = toFiniteIntegerMs(record.endTimeMs);
      if (cutStart === null || cutEnd === null) return null;
      return { startTimeMs: cutStart, endTimeMs: cutEnd };
    })
    .filter((entry): entry is RoundCutRange => entry !== null)
    .sort((a, b) => {
      if (a.startTimeMs !== b.startTimeMs) return a.startTimeMs - b.startTimeMs;
      return a.endTimeMs - b.endTimeMs;
    });

  const normalized: RoundCutRange[] = [];
  for (const cut of sorted) {
    if (cut.startTimeMs < start || cut.endTimeMs > end) continue;
    if (cut.endTimeMs - cut.startTimeMs < minCutMs) continue;
    if (cut.startTimeMs <= start && cut.endTimeMs >= end) continue;

    const previous = normalized[normalized.length - 1];
    if (
      previous &&
      (mergeAdjacent
        ? cut.startTimeMs <= previous.endTimeMs
        : cut.startTimeMs < previous.endTimeMs)
    ) {
      previous.endTimeMs = Math.max(previous.endTimeMs, cut.endTimeMs);
      if (previous.startTimeMs <= start && previous.endTimeMs >= end) {
        normalized.pop();
      }
      continue;
    }

    normalized.push({ ...cut });
  }

  return normalized;
}

export function assertValidRoundCutRanges(
  input: unknown,
  startTimeMs: number,
  endTimeMs: number,
  label = "Cut range"
): RoundCutRange[] {
  if (!Array.isArray(input)) return [];

  const normalized = normalizeRoundCutRanges(input, startTimeMs, endTimeMs);
  const start = Math.floor(startTimeMs);
  const end = Math.floor(endTimeMs);

  for (const [index, raw] of input.entries()) {
    if (!raw || typeof raw !== "object") {
      throw new Error(`${label} ${index + 1} is invalid.`);
    }
    const record = raw as Record<string, unknown>;
    const cutStart = toFiniteIntegerMs(record.startTimeMs);
    const cutEnd = toFiniteIntegerMs(record.endTimeMs);
    if (cutStart === null || cutEnd === null) {
      throw new Error(`${label} ${index + 1} has invalid timestamps.`);
    }
    if (cutStart < start || cutEnd > end) {
      throw new Error(`${label} ${index + 1} must be inside the round time range.`);
    }
    if (cutEnd - cutStart < MIN_ROUND_CUT_MS) {
      throw new Error(`${label} ${index + 1} must be at least ${MIN_ROUND_CUT_MS} ms long.`);
    }
    if (cutStart <= start && cutEnd >= end) {
      throw new Error(`${label} ${index + 1} cannot remove the entire round.`);
    }
  }

  const originalCount = input.length;
  if (originalCount > 0 && normalized.length === 0) {
    throw new Error(`${label} metadata is invalid.`);
  }

  return normalized;
}

export function stringifyRoundCutRanges(cutRanges: RoundCutRange[]): string | null {
  return cutRanges.length > 0 ? JSON.stringify(cutRanges) : null;
}

export function parseRoundCutRangesJson(
  value: string | null | undefined,
  startTimeMs: number | null | undefined,
  endTimeMs: number | null | undefined
): RoundCutRange[] {
  if (!value || typeof startTimeMs !== "number" || typeof endTimeMs !== "number") return [];
  try {
    return normalizeRoundCutRanges(JSON.parse(value), startTimeMs, endTimeMs);
  } catch {
    return [];
  }
}

export function parseOptionalRoundCutRangesJson(
  value: string | null | undefined,
  startTimeMs: number | null | undefined,
  endTimeMs: number | null | undefined
): RoundCutRange[] | undefined {
  const parsed = parseRoundCutRangesJson(value, startTimeMs, endTimeMs);
  return parsed.length > 0 ? parsed : undefined;
}

export function getEffectiveDurationMs(
  startTimeMs: number,
  endTimeMs: number,
  cutRanges: RoundCutRange[] | null | undefined
): number {
  const start = Math.floor(startTimeMs);
  const end = Math.floor(endTimeMs);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return 0;
  const normalized = normalizeRoundCutRanges(cutRanges ?? [], start, end);
  const cutDuration = normalized.reduce((total, cut) => total + cut.endTimeMs - cut.startTimeMs, 0);
  return Math.max(0, end - start - cutDuration);
}

export function getEffectiveElapsedMs(
  sourceTimeMs: number,
  startTimeMs: number,
  cutRanges: RoundCutRange[] | null | undefined
): number {
  const source = Math.max(startTimeMs, Math.floor(sourceTimeMs));
  let elapsed = Math.max(0, source - startTimeMs);
  for (const cut of cutRanges ?? []) {
    if (source <= cut.startTimeMs) break;
    elapsed -= Math.min(source, cut.endTimeMs) - cut.startTimeMs;
  }
  return Math.max(0, elapsed);
}

export function skipCutIfNeeded(
  sourceTimeSec: number,
  cutRanges: RoundCutRange[] | null | undefined
): number | null {
  const sourceTimeMs = sourceTimeSec * 1000;
  const cut = (cutRanges ?? []).find(
    (entry) => sourceTimeMs >= entry.startTimeMs && sourceTimeMs < entry.endTimeMs
  );
  return cut ? cut.endTimeMs / 1000 : null;
}
