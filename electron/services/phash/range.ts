import path from "node:path";
import type { NormalizedVideoHashRange } from "./types";

const MIN_RANGE_MS = 1;

function toFiniteMs(value: number | null | undefined): number | undefined {
    if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
    return Math.floor(value);
}

function clamp(value: number, min: number, max: number): number {
    if (value < min) return min;
    if (value > max) return max;
    return value;
}

export function normalizeVideoHashRange(
    durationMs: number,
    startTimeMs?: number,
    endTimeMs?: number,
): NormalizedVideoHashRange {
    const safeDurationMs = Math.max(0, Math.floor(durationMs));

    const startInput = toFiniteMs(startTimeMs);
    const endInput = toFiniteMs(endTimeMs);

    const defaultStart = 0;
    const defaultEnd = safeDurationMs;

    const clampedStart = clamp(startInput ?? defaultStart, 0, safeDurationMs);
    const clampedEnd = clamp(endInput ?? defaultEnd, 0, safeDurationMs);

    if (safeDurationMs <= 0) {
        return {
            durationMs: safeDurationMs,
            startTimeMs: 0,
            endTimeMs: 0,
            isFullVideo: true,
        };
    }

    if (clampedEnd - clampedStart < MIN_RANGE_MS) {
        return {
            durationMs: safeDurationMs,
            startTimeMs: 0,
            endTimeMs: safeDurationMs,
            isFullVideo: true,
        };
    }

    const isFullVideo = clampedStart === 0 && clampedEnd === safeDurationMs;

    return {
        durationMs: safeDurationMs,
        startTimeMs: clampedStart,
        endTimeMs: clampedEnd,
        isFullVideo,
    };
}

export function toVideoHashRangeCacheKey(videoPath: string, range: NormalizedVideoHashRange): string {
    const normalizedPath = path.normalize(videoPath);
    return `${normalizedPath}#${range.startTimeMs}-${range.endTimeMs}`;
}
