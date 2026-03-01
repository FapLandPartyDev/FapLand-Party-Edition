// @vitest-environment node

import { describe, expect, it } from "vitest";
import { buildSpriteSampleTimesMs, SPRITE_FRAME_COUNT } from "./sample";

describe("buildSpriteSampleTimesMs", () => {
    it("produces exactly 25 sample timestamps", () => {
        const times = buildSpriteSampleTimesMs({
            durationMs: 20_000,
            startTimeMs: 0,
            endTimeMs: 20_000,
            isFullVideo: true,
        });

        expect(times).toHaveLength(SPRITE_FRAME_COUNT);
    });

    it("samples only inside the normalized range", () => {
        const start = 1000;
        const end = 11_000;
        const times = buildSpriteSampleTimesMs({
            durationMs: 20_000,
            startTimeMs: start,
            endTimeMs: end,
            isFullVideo: false,
        });

        for (const time of times) {
            expect(time).toBeGreaterThanOrEqual(start);
            expect(time).toBeLessThanOrEqual(end);
        }

        const expectedFirst = start + ((end - start) * 0.05);
        const expectedStep = ((end - start) * 0.9) / SPRITE_FRAME_COUNT;

        expect(times[0]).toBeCloseTo(expectedFirst, 6);
        expect((times[1] ?? 0) - (times[0] ?? 0)).toBeCloseTo(expectedStep, 6);
    });

    it("is deterministic", () => {
        const range = {
            durationMs: 10_000,
            startTimeMs: 500,
            endTimeMs: 8_200,
            isFullVideo: false,
        };
        expect(buildSpriteSampleTimesMs(range)).toEqual(buildSpriteSampleTimesMs(range));
    });
});
