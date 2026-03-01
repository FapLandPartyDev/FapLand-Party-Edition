export type SegmentType = "Normal" | "Interjection" | "Cum";

export type SegmentDraft = {
    id: string;
    startTimeMs: number;
    endTimeMs: number;
    type: SegmentType;
    customName?: string | null;
    bpm: number | null;
    difficulty: number | null;
    bpmOverride: boolean;
    difficultyOverride: boolean;
};

export type InstalledSourceOption = {
    id: string;
    heroId: string | null;
    label: string;
    roundName: string;
    startTimeMs: number | null;
    endTimeMs: number | null;
    type: SegmentType;
    bpm: number | null;
    difficulty: number | null;
    videoUri: string;
    funscriptUri: string | null;
    heroName: string | null;
    heroAuthor: string | null;
    heroDescription: string | null;
    createdAt: Date;
    updatedAt: Date;
};

export type HeroOption = {
    id: string;
    label: string;
    name: string;
    author: string | null;
    description: string | null;
};

export type DragState = {
    segmentId: string;
    edge: "start" | "end";
    pointerX: number;
    initialStartTimeMs: number;
    initialEndTimeMs: number;
};

/* ─── Constants ──────────────────────────────────────────────────── */

export const CONVERTER_ZOOM_KEY = "converter.timeline.zoomPxPerSec";
export const CONVERTER_PAUSE_GAP_KEY = "converter.autodetect.pauseGapMs";
export const CONVERTER_MIN_ROUND_KEY = "converter.autodetect.minRoundMs";

export const DEFAULT_ZOOM_PX_PER_SEC = 80;
export const MIN_ZOOM_PX_PER_SEC = 20;
export const MAX_ZOOM_PX_PER_SEC = 480;
export const DEFAULT_PAUSE_GAP_MS = 900;
export const DEFAULT_MIN_ROUND_MS = 15_000;
export const MIN_SEGMENT_MS = 100;

/* ─── Pure Utilities ─────────────────────────────────────────────── */

export function clamp(value: number, min: number, max: number): number {
    if (value < min) return min;
    if (value > max) return max;
    return value;
}

export function normalizeDetectionInput(value: string, min: number, fallback: number): number {
    const parsed = Number(value.trim());
    if (!Number.isFinite(parsed)) return fallback;
    return Math.max(min, Math.floor(parsed));
}

export function normalizeOptionalNumberInput(
    value: string,
    min: number,
    max: number,
    integer = false,
): number | null {
    const trimmed = value.trim();
    if (trimmed.length === 0) return null;
    const parsed = Number(trimmed);
    if (!Number.isFinite(parsed)) return null;
    const rounded = integer ? Math.round(parsed) : parsed;
    return clamp(rounded, min, max);
}

export function isLocalResourceUri(uri: string | null | undefined): boolean {
    if (!uri) return false;
    return uri.startsWith("app://media/") || uri.startsWith("file://");
}

export function formatMs(timeMs: number): string {
    const safe = Math.max(0, Math.floor(timeMs));
    const totalSeconds = Math.floor(safe / 1000);
    const ms = safe % 1000;
    const seconds = totalSeconds % 60;
    const minutes = Math.floor(totalSeconds / 60);
    return `${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}.${Math.floor(ms / 10)
        .toString()
        .padStart(2, "0")}`;
}

export function sortSegments(input: SegmentDraft[]): SegmentDraft[] {
    return [...input].sort((a, b) => {
        if (a.startTimeMs !== b.startTimeMs) return a.startTimeMs - b.startTimeMs;
        if (a.endTimeMs !== b.endTimeMs) return a.endTimeMs - b.endTimeMs;
        return a.id.localeCompare(b.id);
    });
}

export function validateSegments(segments: SegmentDraft[], durationMs: number): string | null {
    for (const segment of segments) {
        if (!Number.isFinite(segment.startTimeMs) || !Number.isFinite(segment.endTimeMs)) {
            return "Segment times must be finite numbers.";
        }
        if (segment.startTimeMs < 0 || segment.endTimeMs < 0) {
            return "Segment times cannot be negative.";
        }
        if (segment.endTimeMs > durationMs) {
            return "Segment end exceeds source video duration.";
        }
        if (segment.startTimeMs >= segment.endTimeMs) {
            return "Segment start must be before end.";
        }
    }

    const sorted = sortSegments(segments);
    for (let i = 1; i < sorted.length; i += 1) {
        const prev = sorted[i - 1];
        const current = sorted[i];
        if (!prev || !current) continue;
        if (current.startTimeMs < prev.endTimeMs) {
            return "Segments must not overlap.";
        }
    }

    return null;
}

export function createSegmentId(): string {
    try {
        return crypto.randomUUID();
    } catch {
        return `segment-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    }
}
