import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import {
    DEFAULT_VIDEOHASH_FFMPEG_SOURCE_PREFERENCE,
    normalizeVideoHashFfmpegSourcePreference,
    VIDEOHASH_FFMPEG_SOURCE_PREFERENCE_KEY,
    type VideoHashFfmpegSourcePreference,
} from "../../../src/constants/videohashSettings";
import { getStore } from "../store";
import type { PhashBinaries } from "./types";
import { runCommand } from "./extract";

const require = createRequire(import.meta.url);

type ParsedVersion = [number, number, number];

type BinaryVersion = {
    versionString: string | null;
    parsed: ParsedVersion | null;
};

const binariesPromiseByPreference = new Map<VideoHashFfmpegSourcePreference, Promise<PhashBinaries>>();

function patchAsarPath(inputPath: string): string {
    const normalized = path.normalize(inputPath);
    const asarSegment = `${path.sep}app.asar${path.sep}`;
    if (!normalized.includes(asarSegment)) return normalized;

    const unpacked = normalized.replace(asarSegment, `${path.sep}app.asar.unpacked${path.sep}`);
    if (fs.existsSync(unpacked)) return unpacked;
    return normalized;
}

function isExecutablePath(filePath: string | null | undefined): filePath is string {
    if (!filePath || typeof filePath !== "string") return false;
    if (!filePath.trim()) return false;
    try {
        fs.accessSync(filePath, fs.constants.X_OK);
        return true;
    } catch {
        return false;
    }
}

function loadBundledBinaryPaths(): { ffmpegPath: string | null; ffprobePath: string | null } {
    let ffmpegPath: string | null = null;
    let ffprobePath: string | null = null;

    try {
        const resolved = require("ffmpeg-static") as string | null;
        ffmpegPath = typeof resolved === "string" ? patchAsarPath(resolved) : null;
    } catch {
        ffmpegPath = null;
    }

    try {
        const resolved = require("ffprobe-static") as { path?: string } | string;
        if (typeof resolved === "string") {
            ffprobePath = patchAsarPath(resolved);
        } else {
            ffprobePath = typeof resolved.path === "string" ? patchAsarPath(resolved.path) : null;
        }
    } catch {
        ffprobePath = null;
    }

    return {
        ffmpegPath: isExecutablePath(ffmpegPath) ? ffmpegPath : null,
        ffprobePath: isExecutablePath(ffprobePath) ? ffprobePath : null,
    };
}

export function parseToolVersionLine(output: string): string | null {
    const line = output
        .split(/\r?\n/)
        .map((entry) => entry.trim())
        .find((entry) => /ffmpeg version|ffprobe version/i.test(entry));

    if (!line) return null;

    const matched = line.match(/version\s+([A-Za-z0-9_.-]+)/i);
    if (!matched) return null;
    return matched[1] ?? null;
}

export function parseVersionTuple(version: string | null): ParsedVersion | null {
    if (!version) return null;

    const cleaned = version.replace(/^[^0-9]*/, "");
    const matched = cleaned.match(/^(\d+)(?:\.(\d+))?(?:\.(\d+))?/);
    if (!matched) return null;

    const major = Number(matched[1] ?? "0");
    const minor = Number(matched[2] ?? "0");
    const patch = Number(matched[3] ?? "0");

    if (![major, minor, patch].every((value) => Number.isFinite(value))) {
        return null;
    }

    return [major, minor, patch];
}

export function compareVersionTuple(a: ParsedVersion, b: ParsedVersion): number {
    for (let i = 0; i < 3; i += 1) {
        if (a[i] > b[i]) return 1;
        if (a[i] < b[i]) return -1;
    }
    return 0;
}

async function readToolVersion(toolPath: string): Promise<BinaryVersion> {
    try {
        const { stdout, stderr } = await runCommand(toolPath, ["-version"]);
        const combined = `${stdout.toString("utf8")}\n${stderr.toString("utf8")}`;
        const versionString = parseToolVersionLine(combined);
        return {
            versionString,
            parsed: parseVersionTuple(versionString),
        };
    } catch {
        return {
            versionString: null,
            parsed: null,
        };
    }
}

async function resolveSystemBinaries(): Promise<PhashBinaries | null> {
    const ffmpegVersion = await readToolVersion("ffmpeg");
    const ffprobeVersion = await readToolVersion("ffprobe");

    if (!ffmpegVersion.versionString || !ffprobeVersion.versionString) {
        return null;
    }

    return {
        ffmpegPath: "ffmpeg",
        ffprobePath: "ffprobe",
        source: "system",
        ffmpegVersion: ffmpegVersion.versionString,
        ffprobeVersion: ffprobeVersion.versionString,
    };
}

async function resolveBundledBinaries(): Promise<PhashBinaries | null> {
    const bundled = loadBundledBinaryPaths();
    if (!bundled.ffmpegPath || !bundled.ffprobePath) {
        return null;
    }

    const ffmpegVersion = await readToolVersion(bundled.ffmpegPath);
    const ffprobeVersion = await readToolVersion(bundled.ffprobePath);

    return {
        ffmpegPath: bundled.ffmpegPath,
        ffprobePath: bundled.ffprobePath,
        source: "bundled",
        ffmpegVersion: ffmpegVersion.versionString,
        ffprobeVersion: ffprobeVersion.versionString,
    };
}

export function selectPhashBinaries(
    preference: VideoHashFfmpegSourcePreference,
    bundled: PhashBinaries | null,
    system: PhashBinaries | null,
): PhashBinaries {
    if (!bundled && !system) {
        throw new Error("Unable to locate ffmpeg and ffprobe binaries (bundled or system).");
    }

    if (preference === "bundled") {
        if (bundled) return bundled;
        throw new Error("VideoHash ffmpeg source is forced to bundled, but bundled binaries are unavailable.");
    }

    if (preference === "system") {
        if (system) return system;
        throw new Error("VideoHash ffmpeg source is forced to system, but system ffmpeg/ffprobe are unavailable.");
    }

    if (!bundled && system) {
        return system;
    }

    if (bundled && !system) {
        return bundled;
    }

    const bundledParsed = parseVersionTuple(bundled?.ffmpegVersion ?? null);
    const systemParsed = parseVersionTuple(system?.ffmpegVersion ?? null);

    if (bundled && system && bundledParsed && systemParsed && compareVersionTuple(systemParsed, bundledParsed) > 0) {
        return system;
    }

    return bundled ?? system!;
}

export function getConfiguredVideoHashBinaryPreference(): VideoHashFfmpegSourcePreference {
    try {
        const value = getStore().get(VIDEOHASH_FFMPEG_SOURCE_PREFERENCE_KEY);
        return normalizeVideoHashFfmpegSourcePreference(value);
    } catch {
        return DEFAULT_VIDEOHASH_FFMPEG_SOURCE_PREFERENCE;
    }
}

async function resolveBinariesInternal(preference: VideoHashFfmpegSourcePreference): Promise<PhashBinaries> {
    const [bundled, system] = await Promise.all([resolveBundledBinaries(), resolveSystemBinaries()]);
    return selectPhashBinaries(preference, bundled, system);
}

export async function resolvePhashBinaries(preference?: VideoHashFfmpegSourcePreference): Promise<PhashBinaries> {
    const effectivePreference = preference ?? getConfiguredVideoHashBinaryPreference();
    const cached = binariesPromiseByPreference.get(effectivePreference);
    if (cached) return cached;

    const pending = resolveBinariesInternal(effectivePreference).catch((error) => {
        binariesPromiseByPreference.delete(effectivePreference);
        throw error;
    });
    binariesPromiseByPreference.set(effectivePreference, pending);
    return pending;
}
