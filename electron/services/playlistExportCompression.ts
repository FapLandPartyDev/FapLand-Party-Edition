import { spawn, type ChildProcess } from "node:child_process";
import os from "node:os";
import fs from "node:fs/promises";
import path from "node:path";
import { runCommand } from "./phash/extract";
import { getFfmpegGpuEnv } from "./ffmpegEnv";

export type PlaylistExportCompressionMode = "copy" | "av1";
export type PlaylistExportCompressionEncoderKind = "hardware" | "software";
export type PlaylistExportCompressionPhase =
  | "idle"
  | "analyzing"
  | "copying"
  | "compressing"
  | "writing"
  | "done"
  | "aborted"
  | "error";

export type PlaylistExportCompressionStrengthLabel =
  | "Low compression"
  | "Balanced"
  | "High compression";

export type Av1EncoderDetails = {
  name: "av1_nvenc" | "av1_qsv" | "av1_amf" | "av1_vaapi" | "libsvtav1" | "libaom-av1";
  kind: PlaylistExportCompressionEncoderKind;
};

export type PlaylistExportVideoProbe = {
  codecName: string | null;
  width: number | null;
  height: number | null;
  durationMs: number | null;
  fileSizeBytes: number | null;
};

export type PlaylistExportEstimate = {
  sourceVideoBytes: number;
  expectedVideoBytes: number;
  savingsBytes: number;
  estimatedCompressionSeconds: number;
  approximate: boolean;
};

export type Av1TranscodeProgress = {
  encodedDurationMs: number;
};

const HARDWARE_ENCODERS: ReadonlyArray<Av1EncoderDetails["name"]> = [
  "av1_nvenc",
  "av1_qsv",
  "av1_amf",
  "av1_vaapi",
];

const SOFTWARE_ENCODERS: ReadonlyArray<Av1EncoderDetails["name"]> = ["libsvtav1", "libaom-av1"];

const AV1_ENCODER_PRIORITY: ReadonlyArray<Av1EncoderDetails["name"]> = [
  ...HARDWARE_ENCODERS,
  ...SOFTWARE_ENCODERS,
];

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function normalizeCompressionStrength(value: number | null | undefined): number {
  if (!Number.isFinite(value)) return 80;
  return Math.round(clamp(Number(value), 0, 100));
}

export function getCompressionStrengthLabel(
  strength: number
): PlaylistExportCompressionStrengthLabel {
  if (strength <= 20) return "Low compression";
  if (strength <= 60) return "Balanced";
  return "High compression";
}

export function isAv1Codec(codecName: string | null | undefined): boolean {
  if (!codecName) return false;
  return codecName.trim().toLowerCase().includes("av1");
}

function getEncoderKind(name: Av1EncoderDetails["name"]): PlaylistExportCompressionEncoderKind {
  return HARDWARE_ENCODERS.includes(name) ? "hardware" : "software";
}

function appendAv1EncoderArgs(
  args: string[],
  encoderName: Av1EncoderDetails["name"],
  strength: number
): void {
  switch (encoderName) {
    case "av1_nvenc": {
      const cq = `${Math.round(22 + strength * 0.18)}`;
      args.push("-c:v", "av1_nvenc", "-preset", "p5", "-cq", cq, "-b:v", "0");
      break;
    }
    case "av1_qsv": {
      const globalQuality = `${Math.round(20 + strength * 0.16)}`;
      args.push("-c:v", "av1_qsv", "-preset", "medium", "-global_quality", globalQuality);
      break;
    }
    case "av1_amf": {
      const qpi = Math.round(20 + strength * 0.14);
      args.push(
        "-c:v",
        "av1_amf",
        "-quality",
        "balanced",
        "-qp_i",
        `${qpi}`,
        "-qp_p",
        `${qpi + 2}`
      );
      break;
    }
    case "av1_vaapi": {
      const qp = `${Math.round(20 + strength * 0.14)}`;
      args.push("-c:v", "av1_vaapi", "-rc_mode", "CQP", "-qp", qp);
      break;
    }
    case "libsvtav1": {
      const preset = strength <= 33 ? "5" : strength <= 66 ? "6" : "7";
      const crf = `${Math.round(24 + strength * 0.14)}`;
      args.push("-c:v", "libsvtav1", "-preset", preset, "-crf", crf);
      break;
    }
    case "libaom-av1": {
      const cpuUsed = strength <= 33 ? "5" : strength <= 66 ? "6" : "7";
      const crf = `${Math.round(26 + strength * 0.14)}`;
      args.push("-c:v", "libaom-av1", "-cpu-used", cpuUsed, "-crf", crf, "-row-mt", "1");
      break;
    }
  }
}

async function canUseAv1Encoder(
  ffmpegPath: string,
  encoderName: Av1EncoderDetails["name"]
): Promise<boolean> {
  const args = [
    "-hide_banner",
    "-loglevel",
    "error",
    "-nostdin",
    "-f",
    "lavfi",
    "-i",
    "color=c=black:s=64x64:d=1:r=1",
    "-frames:v",
    "1",
  ];

  appendAv1EncoderArgs(args, encoderName, 55);
  args.push("-an", "-f", "null", "-");

  try {
    await runCommand(ffmpegPath, args);
    return true;
  } catch {
    return false;
  }
}

export async function detectAv1Encoder(ffmpegPath: string): Promise<Av1EncoderDetails | null> {
  const { stdout, stderr } = await runCommand(ffmpegPath, ["-hide_banner", "-encoders"]);
  const combined = `${stdout.toString("utf8")}\n${stderr.toString("utf8")}`.toLowerCase();

  const candidates = AV1_ENCODER_PRIORITY.filter((encoder) =>
    combined.includes(encoder.toLowerCase())
  );
  for (const encoder of candidates) {
    if (await canUseAv1Encoder(ffmpegPath, encoder)) {
      return {
        name: encoder,
        kind: getEncoderKind(encoder),
      };
    }
  }

  return null;
}

function toNullableFiniteNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

export async function probeLocalVideo(
  ffprobePath: string,
  sourcePath: string
): Promise<PlaylistExportVideoProbe> {
  let fileSizeBytes: number | null = null;
  try {
    const stats = await fs.stat(sourcePath);
    if (stats.isFile()) {
      fileSizeBytes = stats.size;
    }
  } catch {
    fileSizeBytes = null;
  }

  try {
    const { stdout } = await runCommand(ffprobePath, [
      "-v",
      "error",
      "-select_streams",
      "v:0",
      "-show_entries",
      "stream=codec_name,width,height:format=duration",
      "-of",
      "json",
      sourcePath,
    ]);
    const payload = JSON.parse(stdout.toString("utf8")) as {
      streams?: Array<{
        codec_name?: string | null;
        width?: number | string | null;
        height?: number | string | null;
      }>;
      format?: {
        duration?: string | number | null;
      };
    };
    const stream = payload.streams?.[0] ?? null;
    const durationSeconds = toNullableFiniteNumber(payload.format?.duration);
    return {
      codecName:
        typeof stream?.codec_name === "string" && stream.codec_name.trim().length > 0
          ? stream.codec_name.trim().toLowerCase()
          : null,
      width: toNullableFiniteNumber(stream?.width),
      height: toNullableFiniteNumber(stream?.height),
      durationMs:
        durationSeconds !== null && durationSeconds >= 0
          ? Math.max(0, Math.floor(durationSeconds * 1000))
          : null,
      fileSizeBytes,
    };
  } catch {
    return {
      codecName: null,
      width: null,
      height: null,
      durationMs: null,
      fileSizeBytes,
    };
  }
}

type ResolutionBucket = "sd" | "hd" | "fullhd" | "uhd" | "unknown";

function getResolutionBucket(width: number | null, height: number | null): ResolutionBucket {
  if (!width || !height) return "unknown";
  const pixels = width * height;
  if (pixels <= 854 * 480) return "sd";
  if (pixels <= 1280 * 720) return "hd";
  if (pixels <= 1920 * 1080) return "fullhd";
  return "uhd";
}

function estimateTargetVideoKbps(input: {
  width: number | null;
  height: number | null;
  strength: number;
  encoderKind: PlaylistExportCompressionEncoderKind;
}): number {
  const baseByBucket: Record<ResolutionBucket, number> = {
    sd: 650,
    hd: 1100,
    fullhd: 1900,
    uhd: 4200,
    unknown: 1400,
  };
  const bucket = getResolutionBucket(input.width, input.height);
  const base = baseByBucket[bucket];
  const qualityFactor = 1.18 - (input.strength / 100) * 0.58;
  const encoderFactor = input.encoderKind === "hardware" ? 1.05 : 0.92;
  return Math.max(180, Math.round(base * qualityFactor * encoderFactor));
}

function estimateCompressedBytesForProbe(input: {
  probe: PlaylistExportVideoProbe;
  strength: number;
  encoderKind: PlaylistExportCompressionEncoderKind;
}): { bytes: number; approximate: boolean } {
  if (isAv1Codec(input.probe.codecName) && input.probe.fileSizeBytes !== null) {
    return {
      bytes: input.probe.fileSizeBytes,
      approximate: false,
    };
  }

  if (input.probe.durationMs !== null) {
    const durationSeconds = Math.max(1, input.probe.durationMs / 1000);
    const videoKbps = estimateTargetVideoKbps({
      width: input.probe.width,
      height: input.probe.height,
      strength: input.strength,
      encoderKind: input.encoderKind,
    });
    const audioBytes = (128_000 / 8) * durationSeconds;
    const videoBytes = (videoKbps * 1000 * durationSeconds) / 8;
    return {
      bytes: Math.max(1, Math.round(videoBytes + audioBytes)),
      approximate: input.probe.width === null || input.probe.height === null,
    };
  }

  if (input.probe.fileSizeBytes !== null) {
    const factor = 0.82 - (input.strength / 100) * 0.5;
    return {
      bytes: Math.max(1, Math.round(input.probe.fileSizeBytes * factor)),
      approximate: true,
    };
  }

  return {
    bytes: 25 * 1024 * 1024,
    approximate: true,
  };
}

function estimateCompressionSecondsForProbe(input: {
  probe: PlaylistExportVideoProbe;
  strength: number;
  encoderKind: PlaylistExportCompressionEncoderKind;
}): { seconds: number; approximate: boolean } {
  if (input.probe.durationMs === null) {
    return {
      seconds: input.encoderKind === "hardware" ? 45 : 60 * 45,
      approximate: true,
    };
  }

  const durationSeconds = Math.max(1, input.probe.durationMs / 1000);
  const bucket = getResolutionBucket(input.probe.width, input.probe.height);
  const resolutionFactorByBucket: Record<ResolutionBucket, number> = {
    sd: 1.6,
    hd: 1.1,
    fullhd: 0.7,
    uhd: 0.28,
    unknown: 0.75,
  };
  const resolutionFactor = resolutionFactorByBucket[bucket];
  const baseSpeed = input.encoderKind === "hardware" ? 3.6 : 0.3;
  const strengthPenalty =
    input.encoderKind === "hardware"
      ? 1 - (input.strength / 100) * 0.35
      : 1 - (input.strength / 100) * 0.45;
  const speed = Math.max(0.08, baseSpeed * strengthPenalty * resolutionFactor);
  return {
    seconds: Math.ceil(durationSeconds / speed),
    approximate: bucket === "unknown",
  };
}

export function getParallelJobsForEncoder(
  encoderKind: PlaylistExportCompressionEncoderKind | null
): number {
  const logicalCores =
    typeof os.availableParallelism === "function"
      ? os.availableParallelism()
      : Math.max(1, os.cpus().length);
  if (encoderKind === "hardware") {
    return Math.min(3, Math.max(1, Math.floor(logicalCores / 4)));
  }
  if (encoderKind === "software") {
    return logicalCores >= 16 ? 2 : 1;
  }
  return 1;
}

export function estimateCompressionForProbes(input: {
  probes: PlaylistExportVideoProbe[];
  strength: number;
  encoderKind: PlaylistExportCompressionEncoderKind;
  parallelJobs: number;
}): PlaylistExportEstimate {
  let approximate = false;
  let sourceVideoBytes = 0;
  let expectedVideoBytes = 0;
  let estimatedCompressionSeconds = 0;

  for (const probe of input.probes) {
    const sizeEstimate = estimateCompressedBytesForProbe({
      probe,
      strength: input.strength,
      encoderKind: input.encoderKind,
    });
    const timeEstimate = estimateCompressionSecondsForProbe({
      probe,
      strength: input.strength,
      encoderKind: input.encoderKind,
    });
    expectedVideoBytes += sizeEstimate.bytes;
    estimatedCompressionSeconds += timeEstimate.seconds;
    approximate =
      approximate ||
      sizeEstimate.approximate ||
      timeEstimate.approximate ||
      probe.fileSizeBytes === null;

    if (probe.fileSizeBytes !== null) {
      sourceVideoBytes += probe.fileSizeBytes;
    }
  }

  const parallelizedSeconds = Math.max(
    0,
    Math.ceil(estimatedCompressionSeconds / Math.max(1, input.parallelJobs))
  );
  return {
    sourceVideoBytes,
    expectedVideoBytes,
    savingsBytes: Math.max(0, sourceVideoBytes - expectedVideoBytes),
    estimatedCompressionSeconds: parallelizedSeconds,
    approximate,
  };
}

export function buildAv1EncodeArgs(input: {
  encoderName: Av1EncoderDetails["name"];
  strength: number;
  sourcePath: string;
  outputPath: string;
}): string[] {
  const strength = normalizeCompressionStrength(input.strength);
  const args = [
    "-hide_banner",
    "-loglevel",
    "error",
    "-nostdin",
    "-nostats",
    "-progress",
    "pipe:1",
    "-y",
    "-i",
    input.sourcePath,
    "-map",
    "0:v:0",
    "-map",
    "0:a?",
  ];
  appendAv1EncoderArgs(args, input.encoderName, strength);

  args.push("-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart", input.outputPath);
  return args;
}

function setLowPriority(child: ChildProcess): void {
  try {
    os.setPriority(child.pid!, os.constants.priority.PRIORITY_LOW);
  } catch {
    // Best effort only.
  }
}

export async function transcodeVideoToAv1(input: {
  ffmpegPath: string;
  sourcePath: string;
  outputPath: string;
  encoder: Av1EncoderDetails;
  strength: number;
  onSpawn?: (child: ChildProcess) => void;
  onProgress?: (progress: Av1TranscodeProgress) => void;
}): Promise<void> {
  await fs.rm(input.outputPath, { force: true }).catch(() => {});
  const args = buildAv1EncodeArgs({
    encoderName: input.encoder.name,
    strength: input.strength,
    sourcePath: input.sourcePath,
    outputPath: input.outputPath,
  });

  const gpuEnv = getFfmpegGpuEnv();
  const ffmpegEnv = gpuEnv ? { ...process.env, ...gpuEnv } : undefined;

  await new Promise<void>((resolve, reject) => {
    const child = spawn(input.ffmpegPath, args, {
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
      env: ffmpegEnv,
    });

    setLowPriority(child);
    input.onSpawn?.(child);

    let stdoutBuffer = "";
    let progressFields: Record<string, string> = {};
    const stderrChunks: Buffer[] = [];
    const parseProgressDurationMs = (fields: Record<string, string>): number | null => {
      const outTime = fields.out_time;
      if (typeof outTime === "string" && outTime.length > 0) {
        const match = outTime.match(/^(\d+):(\d+):(\d+)(?:\.(\d+))?$/);
        if (match) {
          const hours = Number(match[1]);
          const minutes = Number(match[2]);
          const seconds = Number(match[3]);
          const fraction = (match[4] ?? "").padEnd(3, "0").slice(0, 3);
          return ((hours * 60 + minutes) * 60 + seconds) * 1000 + Number(fraction || "0");
        }
      }

      const microsecondsValue = fields.out_time_us ?? fields.out_time_ms;
      if (typeof microsecondsValue !== "string") return null;
      const parsed = Number(microsecondsValue);
      if (!Number.isFinite(parsed) || parsed < 0) return null;
      return Math.floor(parsed / 1000);
    };
    const flushProgress = () => {
      const encodedDurationMs = parseProgressDurationMs(progressFields);
      if (encodedDurationMs !== null) {
        input.onProgress?.({ encodedDurationMs });
      }
      progressFields = {};
    };

    child.stdout.on("data", (chunk: Buffer) => {
      stdoutBuffer += chunk.toString("utf8");
      let newlineIndex = stdoutBuffer.indexOf("\n");
      while (newlineIndex >= 0) {
        const rawLine = stdoutBuffer.slice(0, newlineIndex);
        stdoutBuffer = stdoutBuffer.slice(newlineIndex + 1);
        const line = rawLine.trim();
        if (line.length > 0) {
          const separatorIndex = line.indexOf("=");
          if (separatorIndex >= 0) {
            const key = line.slice(0, separatorIndex);
            const value = line.slice(separatorIndex + 1);
            progressFields[key] = value;
            if (key === "progress") {
              flushProgress();
            }
          }
        }
        newlineIndex = stdoutBuffer.indexOf("\n");
      }
    });
    child.stderr.on("data", (chunk: Buffer) => stderrChunks.push(chunk));
    child.on("error", (error) => {
      reject(error);
    });
    child.on("close", (code, signal) => {
      if (progressFields.progress) {
        flushProgress();
      }
      if (code === 0) {
        resolve();
        return;
      }
      const stderrText = Buffer.concat(stderrChunks).toString("utf8").trim();
      reject(
        new Error(
          `ffmpeg AV1 encode failed with exit code ${code}${signal ? `, signal ${signal}` : ""}: ${stderrText}`.trim()
        )
      );
    });
  });

  const stats = await fs.stat(input.outputPath);
  if (!stats.isFile() || stats.size <= 0) {
    throw new Error(
      `AV1 encode did not produce a valid output file: ${path.basename(input.outputPath)}`
    );
  }
}
