// @vitest-environment node

import { describe, expect, it } from "vitest";
import { normalizeVideoHashRange, toVideoHashRangeCacheKey } from "./range";

describe("normalizeVideoHashRange", () => {
    it("returns full-video range when no start/end are provided", () => {
        const range = normalizeVideoHashRange(10_000);
        expect(range).toEqual({
            durationMs: 10_000,
            startTimeMs: 0,
            endTimeMs: 10_000,
            isFullVideo: true,
        });
    });

    it("clamps out-of-bounds values", () => {
        const range = normalizeVideoHashRange(10_000, -100, 20_000);
        expect(range).toEqual({
            durationMs: 10_000,
            startTimeMs: 0,
            endTimeMs: 10_000,
            isFullVideo: true,
        });
    });

    it("falls back to full range when start is after end", () => {
        const range = normalizeVideoHashRange(10_000, 6_000, 5_000);
        expect(range).toEqual({
            durationMs: 10_000,
            startTimeMs: 0,
            endTimeMs: 10_000,
            isFullVideo: true,
        });
    });

    it("keeps valid subranges", () => {
        const range = normalizeVideoHashRange(10_000, 1_250, 8_750);
        expect(range).toEqual({
            durationMs: 10_000,
            startTimeMs: 1_250,
            endTimeMs: 8_750,
            isFullVideo: false,
        });
    });

    it("builds deterministic cache keys", () => {
        const key = toVideoHashRangeCacheKey("/tmp/example.mp4", {
            durationMs: 10_000,
            startTimeMs: 1000,
            endTimeMs: 5000,
            isFullVideo: false,
        });
        expect(key).toContain("#1000-5000");
    });
});
