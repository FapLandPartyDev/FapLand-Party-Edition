// @vitest-environment node

import { describe, expect, it } from "vitest";
import type { PhashBinaries } from "./types";
import {
    compareVersionTuple,
    getBundledFfmpegCandidatePaths,
    parseToolVersionLine,
    parseVersionTuple,
    selectPhashBinaries,
} from "./binaries";

const bundled: PhashBinaries = {
    ffmpegPath: "/bundled/ffmpeg",
    ffprobePath: "/bundled/ffprobe",
    source: "bundled",
    ffmpegVersion: "7.0.0",
    ffprobeVersion: "7.0.0",
};

const system: PhashBinaries = {
    ffmpegPath: "ffmpeg",
    ffprobePath: "ffprobe",
    source: "system",
    ffmpegVersion: "7.1.0",
    ffprobeVersion: "7.1.0",
};

describe("phash binary version parsing", () => {
    it("parses ffmpeg version strings", () => {
        const line = "ffmpeg version 7.1.1-static Copyright";
        const version = parseToolVersionLine(line);
        expect(version).toBe("7.1.1-static");
        expect(parseVersionTuple(version)).toEqual([7, 1, 1]);
    });

    it("parses prefixed versions", () => {
        const line = "ffmpeg version n6.1.2";
        const version = parseToolVersionLine(line);
        expect(parseVersionTuple(version)).toEqual([6, 1, 2]);
    });

    it("compares semantic tuples", () => {
        expect(compareVersionTuple([7, 0, 0], [6, 1, 9])).toBeGreaterThan(0);
        expect(compareVersionTuple([6, 1, 2], [6, 1, 2])).toBe(0);
        expect(compareVersionTuple([5, 9, 9], [6, 0, 0])).toBeLessThan(0);
    });

    it("supports forcing bundled or system binaries", () => {
        expect(selectPhashBinaries("bundled", bundled, system).source).toBe("bundled");
        expect(selectPhashBinaries("system", bundled, system).source).toBe("system");
    });

    it("builds bundled FFmpeg candidate paths from resources and local vendor directories", () => {
        expect(
            getBundledFfmpegCandidatePaths("ffmpeg/win32-x64/ffmpeg.exe", {
                cwd: "/repo",
                resourcesPath: "/package/resources",
            }),
        ).toEqual([
            "/package/resources/ffmpeg/win32-x64/ffmpeg.exe",
            "/repo/build/vendor/ffmpeg/win32-x64/ffmpeg.exe",
        ]);
    });

    it("keeps auto behavior preferring newer system when parseable", () => {
        expect(selectPhashBinaries("auto", bundled, system).source).toBe("system");
    });

    it("throws when forced source is unavailable", () => {
        expect(() => selectPhashBinaries("bundled", null, system)).toThrow(/forced to bundled/i);
        expect(() => selectPhashBinaries("system", bundled, null)).toThrow(/forced to system/i);
    });
});
