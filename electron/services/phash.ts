import { resolvePhashBinaries } from "./phash/binaries";
import { decodeBmpFrame } from "./phash/bmp";
import { extractSpriteFrameBmp } from "./phash/extract";
import { generateSpritePhashHex } from "./phash/phash";
import { probeVideoDurationMs } from "./phash/probe";
import { normalizeVideoHashRange, toVideoHashRangeCacheKey } from "./phash/range";
import {
    buildSpriteSampleTimesMs,
    SPRITE_COLUMNS,
    SPRITE_ROWS,
    SPRITE_SCREENSHOT_WIDTH,
} from "./phash/sample";
import { combineFramesToSprite } from "./phash/sprite";
import type { NormalizedVideoHashRange } from "./phash/types";

export type { NormalizedVideoHashRange };
export { resolvePhashBinaries, toVideoHashRangeCacheKey };

export async function getNormalizedVideoHashRange(
    videoPath: string,
    startTimeMs?: number,
    endTimeMs?: number,
): Promise<NormalizedVideoHashRange> {
    const binaries = await resolvePhashBinaries();
    const durationMs = await probeVideoDurationMs(binaries.ffprobePath, videoPath);
    return normalizeVideoHashRange(durationMs, startTimeMs, endTimeMs);
}

export async function generateVideoPhashForNormalizedRange(
    videoPath: string,
    range: NormalizedVideoHashRange,
): Promise<string> {
    const binaries = await resolvePhashBinaries();
    const timestamps = buildSpriteSampleTimesMs(range);

    const frames = [];
    for (const timestampMs of timestamps) {
        const bmp = await extractSpriteFrameBmp(
            binaries.ffmpegPath,
            videoPath,
            timestampMs,
            SPRITE_SCREENSHOT_WIDTH,
        );
        frames.push(decodeBmpFrame(bmp));
    }

    const sprite = combineFramesToSprite(frames, SPRITE_COLUMNS, SPRITE_ROWS);
    return generateSpritePhashHex(sprite);
}

export async function generateVideoPhash(
    path: string,
    startTime?: number,
    endTime?: number,
): Promise<string> {
    const normalizedRange = await getNormalizedVideoHashRange(path, startTime, endTime);
    return generateVideoPhashForNormalizedRange(path, normalizedRange);
}
