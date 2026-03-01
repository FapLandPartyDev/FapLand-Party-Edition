// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";

const { runCommandMock } = vi.hoisted(() => ({
  runCommandMock: vi.fn(),
}));

vi.mock("./phash/extract", () => ({
  runCommand: runCommandMock,
}));

import {
  buildAv1EncodeArgs,
  detectAv1Encoder,
  estimateCompressionForProbes,
  getCompressionStrengthLabel,
  normalizeAudioBitrateKbps,
  normalizeCompressionStrength,
} from "./playlistExportCompression";

describe("playlistExportCompression", () => {
  beforeEach(() => {
    runCommandMock.mockReset();
  });

  it("normalizes compression strength into the supported slider range", () => {
    expect(normalizeCompressionStrength(undefined)).toBe(80);
    expect(normalizeCompressionStrength(-5)).toBe(0);
    expect(normalizeCompressionStrength(101)).toBe(100);
  });

  it("maps slider values to readable labels", () => {
    expect(getCompressionStrengthLabel(10)).toBe("Low compression");
    expect(getCompressionStrengthLabel(55)).toBe("Balanced");
    expect(getCompressionStrengthLabel(90)).toBe("High compression");
  });

  it("defaults audio to balanced and validates supported bitrates", () => {
    expect(normalizeAudioBitrateKbps(undefined)).toBe(192);
    expect(normalizeAudioBitrateKbps(128)).toBe(128);
    expect(normalizeAudioBitrateKbps(256)).toBe(256);
    expect(normalizeAudioBitrateKbps(160)).toBe(192);
  });

  it("builds different AV1 ffmpeg args for different slider strengths", () => {
    const low = buildAv1EncodeArgs({
      encoderName: "libsvtav1",
      strength: 10,
      sourcePath: "/tmp/source.mp4",
      outputPath: "/tmp/output.mp4",
    });
    const high = buildAv1EncodeArgs({
      encoderName: "libsvtav1",
      strength: 90,
      sourcePath: "/tmp/source.mp4",
      outputPath: "/tmp/output.mp4",
    });

    expect(low.slice(low.indexOf("-preset"), low.indexOf("-preset") + 4)).toEqual([
      "-preset",
      "5",
      "-crf",
      "25",
    ]);
    expect(high.slice(high.indexOf("-preset"), high.indexOf("-preset") + 4)).toEqual([
      "-preset",
      "7",
      "-crf",
      "37",
    ]);
    expect(low).toContain("-progress");
    expect(low).toContain("pipe:1");
    expect(low).toContain("-nostats");
    expect(low.slice(low.indexOf("-b:a"), low.indexOf("-b:a") + 2)).toEqual(["-b:a", "192k"]);
    expect(low).not.toEqual(high);
  });

  it("puts the selected AAC bitrate in ffmpeg arguments and size estimates", () => {
    const compactArgs = buildAv1EncodeArgs({
      encoderName: "libsvtav1",
      strength: 80,
      audioBitrateKbps: 128,
      sourcePath: "/tmp/source.mp4",
      outputPath: "/tmp/output.mp4",
    });
    const highArgs = buildAv1EncodeArgs({
      encoderName: "libsvtav1",
      strength: 80,
      audioBitrateKbps: 256,
      sourcePath: "/tmp/source.mp4",
      outputPath: "/tmp/output.mp4",
    });
    expect(compactArgs).toContain("128k");
    expect(highArgs).toContain("256k");

    const probes = [
      {
        codecName: "h264",
        width: 1920,
        height: 1080,
        durationMs: 120_000,
        fileSizeBytes: 200 * 1024 * 1024,
      },
    ];
    const compact = estimateCompressionForProbes({
      probes,
      strength: 80,
      audioBitrateKbps: 128,
      encoderKind: "software",
      parallelJobs: 1,
    });
    const high = estimateCompressionForProbes({
      probes,
      strength: 80,
      audioBitrateKbps: 256,
      encoderKind: "software",
      parallelJobs: 1,
    });
    expect(high.expectedVideoBytes).toBeGreaterThan(compact.expectedVideoBytes);
  });

  it("keeps sourceVideoBytes stable across slider values when file sizes are known", () => {
    const probes = [
      {
        codecName: "h264",
        width: 1920,
        height: 1080,
        durationMs: 120_000,
        fileSizeBytes: 200 * 1024 * 1024,
      },
    ];

    const low = estimateCompressionForProbes({
      probes,
      strength: 10,
      encoderKind: "hardware",
      parallelJobs: 1,
    });
    const high = estimateCompressionForProbes({
      probes,
      strength: 90,
      encoderKind: "hardware",
      parallelJobs: 1,
    });

    expect(low.sourceVideoBytes).toBe(200 * 1024 * 1024);
    expect(high.sourceVideoBytes).toBe(200 * 1024 * 1024);
    expect(low.expectedVideoBytes).not.toBe(high.expectedVideoBytes);
  });

  it("does not invent slider-dependent sourceVideoBytes when file sizes are unknown", () => {
    const probes = [
      {
        codecName: "h264",
        width: 1920,
        height: 1080,
        durationMs: 120_000,
        fileSizeBytes: null,
      },
    ];

    const low = estimateCompressionForProbes({
      probes,
      strength: 10,
      encoderKind: "hardware",
      parallelJobs: 1,
    });
    const high = estimateCompressionForProbes({
      probes,
      strength: 90,
      encoderKind: "hardware",
      parallelJobs: 1,
    });

    expect(low.sourceVideoBytes).toBe(0);
    expect(high.sourceVideoBytes).toBe(0);
    expect(low.approximate).toBe(true);
    expect(high.approximate).toBe(true);
    expect(low.expectedVideoBytes).not.toBe(high.expectedVideoBytes);
  });

  it("falls back to software AV1 when nvenc is listed but unusable at runtime", async () => {
    runCommandMock.mockImplementation(async (_command: string, args: string[]) => {
      if (args.includes("-encoders")) {
        return {
          stdout: Buffer.from(" V..... av1_nvenc\n V..... libsvtav1\n", "utf8"),
          stderr: Buffer.alloc(0),
        };
      }
      if (args.includes("av1_nvenc")) {
        throw new Error("Command failed with exit code 255: Cannot load libcuda.so.1");
      }
      if (args.includes("libsvtav1")) {
        return {
          stdout: Buffer.alloc(0),
          stderr: Buffer.alloc(0),
        };
      }
      throw new Error(`Unexpected ffmpeg args: ${args.join(" ")}`);
    });

    await expect(detectAv1Encoder("/mock/ffmpeg")).resolves.toEqual({
      name: "libsvtav1",
      kind: "software",
    });
  });

  it("returns null when every listed AV1 encoder fails validation", async () => {
    runCommandMock.mockImplementation(async (_command: string, args: string[]) => {
      if (args.includes("-encoders")) {
        return {
          stdout: Buffer.from(" V..... av1_nvenc\n", "utf8"),
          stderr: Buffer.alloc(0),
        };
      }
      throw new Error("Command failed with exit code 255: Cannot load libcuda.so.1");
    });

    await expect(detectAv1Encoder("/mock/ffmpeg")).resolves.toBeNull();
  });
});
