import type { NormalizedVideoHashRange } from "./types";

export const SPRITE_COLUMNS = 5;
export const SPRITE_ROWS = 5;
export const SPRITE_FRAME_COUNT = SPRITE_COLUMNS * SPRITE_ROWS;
export const SPRITE_SCREENSHOT_WIDTH = 160;

const OFFSET_RATIO = 0.05;
const SPAN_RATIO = 0.9;

function clamp(value: number, min: number, max: number): number {
    if (value < min) return min;
    if (value > max) return max;
    return value;
}

export function buildSpriteSampleTimesMs(range: NormalizedVideoHashRange): number[] {
    const durationMs = range.endTimeMs - range.startTimeMs;
    if (durationMs <= 0) {
        return Array.from({ length: SPRITE_FRAME_COUNT }, () => range.startTimeMs);
    }

    const offset = range.startTimeMs + (durationMs * OFFSET_RATIO);
    const step = (durationMs * SPAN_RATIO) / SPRITE_FRAME_COUNT;

    const output: number[] = [];
    for (let i = 0; i < SPRITE_FRAME_COUNT; i += 1) {
        const t = offset + (i * step);
        output.push(clamp(t, range.startTimeMs, range.endTimeMs));
    }

    return output;
}
