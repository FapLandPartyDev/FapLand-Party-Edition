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

