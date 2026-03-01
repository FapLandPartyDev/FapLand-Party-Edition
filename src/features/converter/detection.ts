export type DetectionAction = {
  at: number;
  pos: number;
};

export type DetectedSegment = {
  startTimeMs: number;
  endTimeMs: number;
  type: "Normal" | "Interjection" | "Cum";
};

export type BuildDetectedSegmentsInput = {
  actions: DetectionAction[];
  durationMs: number;
  pauseGapMs: number;
  minRoundMs: number;
  defaultType?: "Normal" | "Interjection" | "Cum";
};

export type TargetDetectionInput = {
  actions: DetectionAction[];
  durationMs: number;
  targetCount: number;
  currentPauseGapMs: number;
  currentMinRoundMs: number;
  defaultType?: "Normal" | "Interjection" | "Cum";
  pauseGapRangeMs?: { min: number; max: number };
  minRoundRangeMs?: { min: number; max: number };
  maxEvaluations?: number;
};

export type TargetDetectionSuccess = {
  status: "success";
  pauseGapMs: number;
  minRoundMs: number;
  segments: DetectedSegment[];
  evaluations: number;
};

export type TargetDetectionFailure = {
  status: "failure";
  evaluations: number;
  closest: {
    pauseGapMs: number;
    minRoundMs: number;
    segmentCount: number;
  } | null;
};

export type TargetDetectionResult = TargetDetectionSuccess | TargetDetectionFailure;

function clamp(value: number, min: number, max: number): number {
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

function normalizeActions(actions: DetectionAction[]): DetectionAction[] {
  return actions
    .filter((action) => Number.isFinite(action.at))
    .map((action) => ({
      at: Math.max(0, Math.floor(action.at)),
      pos: Number.isFinite(action.pos) ? action.pos : 0,
    }))
    .sort((a, b) => a.at - b.at);
}

export function buildDetectedSegments(input: BuildDetectedSegmentsInput): DetectedSegment[] {
  const durationMs = Math.max(0, Math.floor(input.durationMs));
  if (durationMs <= 0) return [];

  const pauseGapMs = Math.max(1, Math.floor(input.pauseGapMs));
  const minRoundMs = Math.max(1, Math.floor(input.minRoundMs));
  const defaultType = input.defaultType ?? "Normal";

  const actions = normalizeActions(input.actions);

  const boundaries = new Set<number>([0, durationMs]);
  for (let index = 1; index < actions.length; index += 1) {
    const prev = actions[index - 1];
    const current = actions[index];
    if (!prev || !current) continue;

    const gap = current.at - prev.at;
    if (gap < pauseGapMs) continue;

    const isLeadingIdleGap = prev.at === 0 && prev.pos === current.pos;
    const isTrailingIdleGap = index === actions.length - 1 && prev.pos === current.pos;
    if (isLeadingIdleGap || isTrailingIdleGap) continue;

    const midpoint = prev.at + Math.floor(gap / 2);
    boundaries.add(clamp(midpoint, 0, durationMs));
  }

  const sorted = [...boundaries].sort((a, b) => a - b);
  const segments: DetectedSegment[] = [];
  for (let index = 1; index < sorted.length; index += 1) {
    const start = sorted[index - 1];
    const end = sorted[index];
    if (start === undefined || end === undefined) continue;
    if (end - start < minRoundMs) continue;
    segments.push({
      startTimeMs: start,
      endTimeMs: end,
      type: defaultType,
    });
  }

  return segments;
}

function uniqueSortedNumbers(values: number[]): number[] {
  return [...new Set(values.filter(Number.isFinite).map((value) => Math.floor(value)))].sort(
    (a, b) => a - b
  );
}

function steppedRange(min: number, max: number, step: number): number[] {
  if (max < min) return [];
  const values: number[] = [];
  for (let value = min; value <= max; value += step) {
    values.push(value);
  }
  values.push(max);
  return uniqueSortedNumbers(values);
}

function windowedRange(center: number, min: number, max: number, radius: number, step: number): number[] {
  return steppedRange(Math.max(min, center - radius), Math.min(max, center + radius), step);
}

function durationBalanceScore(segments: DetectedSegment[]): number {
  if (segments.length <= 1) return 0;
  const durations = segments.map((segment) => segment.endTimeMs - segment.startTimeMs);
  const average = durations.reduce((sum, duration) => sum + duration, 0) / durations.length;
  return durations.reduce((sum, duration) => sum + Math.abs(duration - average), 0);
}

export function findDetectionSettingsForTargetCount(
  input: TargetDetectionInput
): TargetDetectionResult {
  const durationMs = Math.max(0, Math.floor(input.durationMs));
  const targetCount = Math.floor(input.targetCount);
  const maxEvaluations = Math.max(1, Math.floor(input.maxEvaluations ?? 2_500));
  const defaultType = input.defaultType ?? "Normal";

  if (durationMs <= 0 || targetCount < 1) {
    return { status: "failure", evaluations: 0, closest: null };
  }

  const pauseMin = Math.max(1, Math.floor(input.pauseGapRangeMs?.min ?? 100));
  const pauseMax = Math.max(pauseMin, Math.floor(input.pauseGapRangeMs?.max ?? 10_000));
  const minRoundMin = Math.max(1, Math.floor(input.minRoundRangeMs?.min ?? 500));
  const defaultMinRoundMax = Math.max(minRoundMin, Math.floor(durationMs / targetCount));
  const minRoundMax = Math.max(
    minRoundMin,
    Math.floor(input.minRoundRangeMs?.max ?? defaultMinRoundMax)
  );

  const normalizedActions = normalizeActions(input.actions);
  const currentPauseGapMs = clamp(Math.floor(input.currentPauseGapMs), pauseMin, pauseMax);
  const currentMinRoundMs = clamp(Math.floor(input.currentMinRoundMs), minRoundMin, minRoundMax);

  const pauseCandidates = uniqueSortedNumbers([
    currentPauseGapMs,
    ...steppedRange(pauseMin, pauseMax, 500),
    ...windowedRange(currentPauseGapMs, pauseMin, pauseMax, 1_000, 100),
  ]);
  const minRoundCandidates = uniqueSortedNumbers([
    currentMinRoundMs,
    ...steppedRange(minRoundMin, minRoundMax, 1_000),
    ...windowedRange(currentMinRoundMs, minRoundMin, minRoundMax, 2_000, 250),
  ]);

  let evaluations = 0;
  let bestSuccess:
    | {
        pauseGapMs: number;
        minRoundMs: number;
        segments: DetectedSegment[];
        minRoundDistance: number;
        balanceScore: number;
        evaluation: number;
      }
    | null = null;
  let closest:
    | {
        pauseGapMs: number;
        minRoundMs: number;
        segmentCount: number;
        countDistance: number;
        minRoundDistance: number;
      }
    | null = null;

  const evaluate = (pauseGapMs: number, minRoundMs: number) => {
    if (evaluations >= maxEvaluations) return;
    evaluations += 1;

    const segments = buildDetectedSegments({
      actions: normalizedActions,
      durationMs,
      pauseGapMs,
      minRoundMs,
      defaultType,
    });
    const minRoundDistance = Math.abs(minRoundMs - currentMinRoundMs);
    const countDistance = Math.abs(segments.length - targetCount);

    if (
      !closest ||
      countDistance < closest.countDistance ||
      (countDistance === closest.countDistance && pauseGapMs > closest.pauseGapMs) ||
      (countDistance === closest.countDistance && pauseGapMs === closest.pauseGapMs && minRoundDistance < closest.minRoundDistance)
    ) {
      closest = {
        pauseGapMs,
        minRoundMs,
        segmentCount: segments.length,
        countDistance,
        minRoundDistance,
      };
    }

    if (segments.length !== targetCount) return;

    const balanceScore = durationBalanceScore(segments);
    if (
      !bestSuccess ||
      pauseGapMs > bestSuccess.pauseGapMs ||
      (pauseGapMs === bestSuccess.pauseGapMs && minRoundDistance < bestSuccess.minRoundDistance) ||
      (pauseGapMs === bestSuccess.pauseGapMs &&
        minRoundDistance === bestSuccess.minRoundDistance &&
        balanceScore < bestSuccess.balanceScore) ||
      (pauseGapMs === bestSuccess.pauseGapMs &&
        minRoundDistance === bestSuccess.minRoundDistance &&
        balanceScore === bestSuccess.balanceScore &&
        evaluations < bestSuccess.evaluation)
    ) {
      bestSuccess = {
        pauseGapMs,
        minRoundMs,
        segments,
        minRoundDistance,
        balanceScore,
        evaluation: evaluations,
      };
    }
  };

  const orderedPairs = pauseCandidates
    .flatMap((pauseGapMs) =>
      minRoundCandidates.map((minRoundMs) => ({
        pauseGapMs,
        minRoundMs,
        minRoundDistance: Math.abs(minRoundMs - currentMinRoundMs),
      }))
    )
    .sort((a, b) => {
      if (b.pauseGapMs !== a.pauseGapMs) {
        return b.pauseGapMs - a.pauseGapMs;
      }
      return a.minRoundDistance - b.minRoundDistance;
    });

  for (const candidate of orderedPairs) {
    evaluate(candidate.pauseGapMs, candidate.minRoundMs);
    if (evaluations >= maxEvaluations) break;
  }

  if (bestSuccess) {
    return {
      status: "success",
      pauseGapMs: bestSuccess.pauseGapMs,
      minRoundMs: bestSuccess.minRoundMs,
      segments: bestSuccess.segments,
      evaluations,
    };
  }

  return {
    status: "failure",
    evaluations,
    closest: closest
      ? {
          pauseGapMs: closest.pauseGapMs,
          minRoundMs: closest.minRoundMs,
          segmentCount: closest.segmentCount,
        }
      : null,
  };
}
