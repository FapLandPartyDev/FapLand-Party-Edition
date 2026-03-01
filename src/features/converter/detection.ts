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
  autoTrimRounds?: boolean;
  trimAllowanceMs?: number;
  defaultType?: "Normal" | "Interjection" | "Cum";
};

export type TargetDetectionInput = {
  actions: DetectionAction[];
  durationMs: number;
  targetCount: number;
  currentPauseGapMs: number;
  currentMinRoundMs: number;
  autoTrimRounds?: boolean;
  trimAllowanceMs?: number;
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

export type AdaptiveDetectionResult = {
  pauseGapMs: number;
  minRoundMs: number;
  segments: DetectedSegment[];
  evaluations: number;
};

export type ActionTrimRangeInput = {
  actions: DetectionAction[];
  startTimeMs: number;
  endTimeMs: number;
  allowanceMs?: number;
};

type BestTargetDetection = {
  pauseGapMs: number;
  minRoundMs: number;
  segments: DetectedSegment[];
  minRoundDistance: number;
  balanceScore: number;
  idleScore: number;
  evaluation: number;
};

type ClosestTargetDetection = {
  pauseGapMs: number;
  minRoundMs: number;
  segmentCount: number;
  countDistance: number;
  minRoundDistance: number;
};

const CADENCE_PADDING_MIN_MS = 500;
const CADENCE_PADDING_MAX_MS = 3_000;
const CADENCE_PADDING_FALLBACK_MS = 1_500;
const CADENCE_INTERVAL_LIMIT_MS = 5_000;
const MIN_RAW_ROUND_MS = 1;

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

function getActionsInDuration(actions: DetectionAction[], durationMs: number): DetectionAction[] {
  return actions.filter((action) => action.at >= 0 && action.at <= durationMs);
}

function actionHasMovementNeighbor(actions: DetectionAction[], index: number): boolean {
  const action = actions[index];
  if (!action) return false;

  const previous = actions[index - 1];
  if (previous && previous.at !== action.at && previous.pos !== action.pos) return true;

  const next = actions[index + 1];
  if (next && next.at !== action.at && next.pos !== action.pos) return true;

  return false;
}

function getActionExtent(
  actions: DetectionAction[],
  durationMs: number
): { firstActionAt: number; lastActionAt: number; firstIndex: number; lastIndex: number } | null {
  const inDuration = getActionsInDuration(actions, durationMs);
  if (inDuration.length === 0) return null;

  const firstMovingIndex = inDuration.findIndex((_, index) =>
    actionHasMovementNeighbor(inDuration, index)
  );
  if (firstMovingIndex < 0) {
    const first = inDuration[0];
    const last = inDuration[inDuration.length - 1];
    if (!first || !last) return null;
    return {
      firstActionAt: first.at,
      lastActionAt: last.at,
      firstIndex: 0,
      lastIndex: inDuration.length - 1,
    };
  }

  let lastMovingIndex = firstMovingIndex;
  for (let index = inDuration.length - 1; index >= firstMovingIndex; index -= 1) {
    if (actionHasMovementNeighbor(inDuration, index)) {
      lastMovingIndex = index;
      break;
    }
  }

  const first = inDuration[firstMovingIndex];
  const last = inDuration[lastMovingIndex];
  if (!first || !last) return null;

  return {
    firstActionAt: first.at,
    lastActionAt: last.at,
    firstIndex: firstMovingIndex,
    lastIndex: lastMovingIndex,
  };
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[middle] ?? null;
  const left = sorted[middle - 1];
  const right = sorted[middle];
  if (left === undefined || right === undefined) return null;
  return (left + right) / 2;
}

function estimateCadencePaddingMs(
  actions: DetectionAction[],
  edge: "start" | "end",
  options: { minMs?: number; maxMs?: number; pauseGapMs?: number; actionIndex?: number } = {}
): number {
  const minMs = Math.max(1, Math.floor(options.minMs ?? CADENCE_PADDING_MIN_MS));
  const maxMs = Math.max(minMs, Math.floor(options.maxMs ?? CADENCE_PADDING_MAX_MS));
  const intervalLimit = Math.max(
    minMs,
    Math.floor(options.pauseGapMs ?? CADENCE_INTERVAL_LIMIT_MS)
  );
  const intervals: number[] = [];

  if (edge === "start") {
    const startIndex = Math.max(0, Math.floor(options.actionIndex ?? 0));
    for (let index = startIndex + 1; index < actions.length && intervals.length < 5; index += 1) {
      const previous = actions[index - 1];
      const current = actions[index];
      if (!previous || !current) continue;
      const interval = current.at - previous.at;
      if (interval > 0 && interval < intervalLimit) intervals.push(interval);
    }
  } else {
    const endIndex = Math.min(
      actions.length - 1,
      Math.floor(options.actionIndex ?? actions.length - 1)
    );
    for (let index = endIndex; index > 0 && intervals.length < 5; index -= 1) {
      const previous = actions[index - 1];
      const current = actions[index];
      if (!previous || !current) continue;
      const interval = current.at - previous.at;
      if (interval > 0 && interval < intervalLimit) intervals.push(interval);
    }
  }

  const cadence = median(intervals);
  if (cadence === null) return clamp(CADENCE_PADDING_FALLBACK_MS, minMs, maxMs);
  return clamp(Math.round(cadence * 2.5), minMs, maxMs);
}

function getDetectionBounds(
  actions: DetectionAction[],
  durationMs: number,
  pauseGapMs: number
): { startBoundary: number; endBoundary: number } {
  const extent = getActionExtent(actions, durationMs);
  if (!extent) return { startBoundary: 0, endBoundary: durationMs };

  const startPadding = estimateCadencePaddingMs(actions, "start", {
    pauseGapMs,
    actionIndex: extent.firstIndex,
  });
  const endPadding = estimateCadencePaddingMs(actions, "end", {
    pauseGapMs,
    actionIndex: extent.lastIndex,
  });

  const startBoundary = clamp(extent.firstActionAt - startPadding, 0, durationMs);
  const endBoundary = clamp(extent.lastActionAt + endPadding, startBoundary, durationMs);

  return { startBoundary, endBoundary };
}

export function getActionTrimRange(input: ActionTrimRangeInput): {
  startTimeMs: number;
  endTimeMs: number;
} | null {
  const startTimeMs = Math.max(0, Math.floor(input.startTimeMs));
  const endTimeMs = Math.max(startTimeMs, Math.floor(input.endTimeMs));
  if (endTimeMs <= startTimeMs) return null;

  const allowanceMs = Math.max(0, Math.floor(input.allowanceMs ?? 1_000));
  const actions = normalizeActions(input.actions).filter(
    (action) => action.at >= startTimeMs && action.at <= endTimeMs
  );
  const extent = getActionExtent(actions, endTimeMs);
  if (!extent) return null;

  const trimmedStartTimeMs = clamp(extent.firstActionAt - allowanceMs, startTimeMs, endTimeMs);
  const trimmedEndTimeMs = clamp(extent.lastActionAt + allowanceMs, trimmedStartTimeMs, endTimeMs);
  if (trimmedEndTimeMs <= trimmedStartTimeMs) return null;

  return {
    startTimeMs: trimmedStartTimeMs,
    endTimeMs: trimmedEndTimeMs,
  };
}

export function buildDetectedSegments(input: BuildDetectedSegmentsInput): DetectedSegment[] {
  const durationMs = Math.max(0, Math.floor(input.durationMs));
  if (durationMs <= 0) return [];

  const pauseGapMs = Math.max(1, Math.floor(input.pauseGapMs));
  const minRoundMs = Math.max(1, Math.floor(input.minRoundMs));
  const trimAllowanceMs = Math.max(0, Math.floor(input.trimAllowanceMs ?? 1_000));
  const defaultType = input.defaultType ?? "Normal";

  const actions = normalizeActions(input.actions);
  const { startBoundary, endBoundary } = getDetectionBounds(actions, durationMs, pauseGapMs);
  if (endBoundary <= startBoundary) return [];

  const boundaries = new Set<number>([startBoundary, endBoundary]);
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
    if (midpoint > startBoundary && midpoint < endBoundary) {
      boundaries.add(clamp(midpoint, 0, durationMs));
    }
  }

  const sorted = [...boundaries].sort((a, b) => a - b);
  const segments: DetectedSegment[] = [];
  for (let index = 1; index < sorted.length; index += 1) {
    const windowStart = sorted[index - 1];
    const windowEnd = sorted[index];
    if (windowStart === undefined || windowEnd === undefined) continue;

    let start = windowStart;
    let end = windowEnd;
    if (input.autoTrimRounds) {
      const trimmedRange = getActionTrimRange({
        actions,
        startTimeMs: windowStart,
        endTimeMs: windowEnd,
        allowanceMs: trimAllowanceMs,
      });
      if (!trimmedRange) continue;
      start = trimmedRange.startTimeMs;
      end = trimmedRange.endTimeMs;
    }

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

function windowedRange(
  center: number,
  min: number,
  max: number,
  radius: number,
  step: number
): number[] {
  return steppedRange(Math.max(min, center - radius), Math.min(max, center + radius), step);
}

function roundedVariants(value: number): number[] {
  const floor50 = Math.floor(value / 50) * 50;
  const ceil50 = Math.ceil(value / 50) * 50;
  const floor100 = Math.floor(value / 100) * 100;
  const ceil100 = Math.ceil(value / 100) * 100;
  return [floor50, ceil50, floor100, ceil100];
}

function getAdjacentGaps(actions: DetectionAction[]): number[] {
  const gaps: number[] = [];
  for (let index = 1; index < actions.length; index += 1) {
    const previous = actions[index - 1];
    const current = actions[index];
    if (!previous || !current) continue;
    const gap = current.at - previous.at;
    if (gap > 0) gaps.push(gap);
  }
  return gaps;
}

function getPauseGapCandidates(
  actions: DetectionAction[],
  currentPauseGapMs: number,
  min: number,
  max: number
): number[] {
  const actionCandidates = getAdjacentGaps(actions)
    .filter((gap) => gap >= min && gap <= max)
    .flatMap((gap) => [gap - 1, gap, gap + 1, ...roundedVariants(gap)]);
  const candidates = uniqueSortedNumbers([
    currentPauseGapMs,
    min,
    max,
    ...actionCandidates,
    ...(actionCandidates.length < 12 ? steppedRange(min, max, 500) : []),
  ])
    .map((value) => clamp(value, min, max))
    .filter((value) => value >= min && value <= max);

  return uniqueSortedNumbers(candidates).sort((a, b) => b - a);
}

function durationBalanceScore(segments: DetectedSegment[]): number {
  if (segments.length <= 1) return 0;
  const durations = segments.map((segment) => segment.endTimeMs - segment.startTimeMs);
  const average = durations.reduce((sum, duration) => sum + duration, 0) / durations.length;
  return durations.reduce((sum, duration) => sum + Math.abs(duration - average), 0);
}

function buildMinRoundCandidates(
  rawSegments: DetectedSegment[],
  currentMinRoundMs: number,
  min: number,
  max: number
): number[] {
  const durations = rawSegments.map((segment) => segment.endTimeMs - segment.startTimeMs);
  const candidates = uniqueSortedNumbers([
    MIN_RAW_ROUND_MS,
    min,
    max,
    currentMinRoundMs,
    ...windowedRange(currentMinRoundMs, min, max, 2_000, 250),
    ...durations.flatMap((duration) => [duration - 1, duration, ...roundedVariants(duration)]),
  ])
    .map((value) => clamp(value, min, max))
    .filter((value) => value >= min && value <= max);

  return uniqueSortedNumbers(candidates).sort((a, b) => {
    const distance = Math.abs(a - currentMinRoundMs) - Math.abs(b - currentMinRoundMs);
    if (distance !== 0) return distance;
    return b - a;
  });
}

function leadingTrailingIdleScore(
  segments: DetectedSegment[],
  actions: DetectionAction[],
  durationMs: number
): number {
  const extent = getActionExtent(actions, durationMs);
  const firstSegment = segments[0];
  const lastSegment = segments[segments.length - 1];
  if (!extent || !firstSegment || !lastSegment) return 0;

  return (
    Math.abs(extent.firstActionAt - firstSegment.startTimeMs) +
    Math.abs(lastSegment.endTimeMs - extent.lastActionAt)
  );
}

export function findAdaptiveDetectionSettings(
  input: Omit<TargetDetectionInput, "targetCount"> & { preferredRoundMs?: number }
): AdaptiveDetectionResult {
  const durationMs = Math.max(0, Math.floor(input.durationMs));
  const preferredRoundMs = Math.max(60_000, Math.floor(input.preferredRoundMs ?? 180_000));
  const normalizedActions = normalizeActions(input.actions);
  if (durationMs <= 0 || normalizedActions.length < 3) {
    return {
      pauseGapMs: input.currentPauseGapMs,
      minRoundMs: input.currentMinRoundMs,
      segments: [],
      evaluations: 0,
    };
  }

  const inferredCount = Math.max(2, Math.round(durationMs / preferredRoundMs));
  const targetCounts = uniqueSortedNumbers([
    inferredCount,
    Math.max(2, inferredCount - 1),
    inferredCount + 1,
    Math.max(2, Math.floor(durationMs / preferredRoundMs)),
    Math.max(2, Math.ceil(durationMs / preferredRoundMs)),
  ]);

  let evaluations = 0;
  let best:
    | (AdaptiveDetectionResult & {
        score: number;
        balance: number;
      })
    | null = null;

  for (const targetCount of targetCounts) {
    const result = findDetectionSettingsForTargetCount({
      ...input,
      actions: normalizedActions,
      durationMs,
      targetCount,
      minRoundRangeMs: input.minRoundRangeMs ?? {
        min: 60_000,
        max: Math.max(60_000, Math.min(preferredRoundMs, Math.floor(durationMs / 2))),
      },
    });
    evaluations += result.evaluations;
    if (result.status !== "success" || result.segments.length < 2) continue;

    const durations = result.segments.map((segment) => segment.endTimeMs - segment.startTimeMs);
    const typicalDuration =
      median(durations) ??
      durations.reduce((sum, duration) => sum + duration, 0) / durations.length;
    const preferredDistance = Math.abs(typicalDuration - preferredRoundMs);
    const balance = durationBalanceScore(result.segments);
    const idle = leadingTrailingIdleScore(result.segments, normalizedActions, durationMs);
    // A larger qualifying pause is stronger evidence, while duration stability dominates.
    const score =
      preferredDistance * 4 +
      balance +
      idle -
      Math.min(result.pauseGapMs, 10_000) * 20 +
      result.segments.length;

    if (
      !best ||
      score < best.score ||
      (score === best.score && balance < best.balance) ||
      (score === best.score &&
        balance === best.balance &&
        result.segments.length < best.segments.length)
    ) {
      best = { ...result, evaluations, score, balance };
    }
  }

  return best
    ? {
        pauseGapMs: best.pauseGapMs,
        minRoundMs: best.minRoundMs,
        segments: best.segments,
        evaluations,
      }
    : {
        pauseGapMs: input.currentPauseGapMs,
        minRoundMs: input.currentMinRoundMs,
        segments: [],
        evaluations,
      };
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

  const pauseCandidates = getPauseGapCandidates(
    normalizedActions,
    currentPauseGapMs,
    pauseMin,
    pauseMax
  );

  let evaluations = 0;
  let bestSuccess: BestTargetDetection | null = null;
  let closest: ClosestTargetDetection | null = null;

  const evaluate = (pauseGapMs: number, minRoundMs: number) => {
    if (evaluations >= maxEvaluations) return;
    evaluations += 1;

    const segments = buildDetectedSegments({
      actions: normalizedActions,
      durationMs,
      pauseGapMs,
      minRoundMs,
      autoTrimRounds: input.autoTrimRounds,
      trimAllowanceMs: input.trimAllowanceMs,
      defaultType,
    });
    const minRoundDistance = Math.abs(minRoundMs - currentMinRoundMs);
    const countDistance = Math.abs(segments.length - targetCount);

    if (
      !closest ||
      countDistance < closest.countDistance ||
      (countDistance === closest.countDistance && pauseGapMs > closest.pauseGapMs) ||
      (countDistance === closest.countDistance &&
        pauseGapMs === closest.pauseGapMs &&
        minRoundDistance < closest.minRoundDistance)
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
    const idleScore = leadingTrailingIdleScore(segments, normalizedActions, durationMs);
    if (
      !bestSuccess ||
      pauseGapMs > bestSuccess.pauseGapMs ||
      (pauseGapMs === bestSuccess.pauseGapMs && idleScore < bestSuccess.idleScore) ||
      (pauseGapMs === bestSuccess.pauseGapMs &&
        idleScore === bestSuccess.idleScore &&
        balanceScore < bestSuccess.balanceScore) ||
      (pauseGapMs === bestSuccess.pauseGapMs &&
        idleScore === bestSuccess.idleScore &&
        balanceScore === bestSuccess.balanceScore &&
        minRoundDistance < bestSuccess.minRoundDistance) ||
      (pauseGapMs === bestSuccess.pauseGapMs &&
        idleScore === bestSuccess.idleScore &&
        balanceScore === bestSuccess.balanceScore &&
        minRoundDistance === bestSuccess.minRoundDistance &&
        evaluations < bestSuccess.evaluation)
    ) {
      bestSuccess = {
        pauseGapMs,
        minRoundMs,
        segments,
        minRoundDistance,
        balanceScore,
        idleScore,
        evaluation: evaluations,
      };
    }
  };

  for (const pauseGapMs of pauseCandidates) {
    if (evaluations >= maxEvaluations) break;

    const rawSegments = buildDetectedSegments({
      actions: normalizedActions,
      durationMs,
      pauseGapMs,
      minRoundMs: MIN_RAW_ROUND_MS,
      autoTrimRounds: input.autoTrimRounds,
      trimAllowanceMs: input.trimAllowanceMs,
      defaultType,
    });
    const minRoundCandidates = buildMinRoundCandidates(
      rawSegments,
      currentMinRoundMs,
      minRoundMin,
      minRoundMax
    );

    for (const minRoundMs of minRoundCandidates) {
      evaluate(pauseGapMs, minRoundMs);
      if (evaluations >= maxEvaluations) break;
    }
  }

  const resolvedBest = bestSuccess as BestTargetDetection | null;
  if (resolvedBest) {
    return {
      status: "success",
      pauseGapMs: resolvedBest.pauseGapMs,
      minRoundMs: resolvedBest.minRoundMs,
      segments: resolvedBest.segments,
      evaluations,
    };
  }

  const resolvedClosest = closest as ClosestTargetDetection | null;
  return {
    status: "failure",
    evaluations,
    closest: resolvedClosest
      ? {
          pauseGapMs: resolvedClosest.pauseGapMs,
          minRoundMs: resolvedClosest.minRoundMs,
          segmentCount: resolvedClosest.segmentCount,
        }
      : null,
  };
}
