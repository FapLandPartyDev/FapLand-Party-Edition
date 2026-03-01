import { spawn } from "node:child_process";
import os from "node:os";
import type { NormalizedVideoHashRange } from "./types";
import { SPRITE_COLUMNS, SPRITE_ROWS, SPRITE_SCREENSHOT_WIDTH, SPRITE_FRAME_COUNT } from "./sample";
import { debugLog } from "../debugLogging";
import { getFfmpegGpuEnv } from "../ffmpegEnv";

type CommandResult = {
  stdout: Buffer;
  stderr: Buffer;
};

export async function runCommand(
  command: string,
  args: string[],
  options?: {
    lowPriority?: boolean;
    timeoutMs?: number;
    onLine?: (line: string) => void;
    env?: Record<string, string>;
  }
): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    const cmdStr = `${command} ${args.join(" ")}`;
    debugLog.debug("ffmpeg-command", "Executing command", { command, args });

    const gpuEnv = getFfmpegGpuEnv();
    const baseEnv = gpuEnv ? { ...process.env, ...gpuEnv } : process.env;
    const child = spawn(command, args, {
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
      env: options?.env ? { ...baseEnv, ...options.env } : baseEnv,
    });

    let timeoutTimer: ReturnType<typeof setTimeout> | null = null;
    let timedOut = false;

    if (options?.timeoutMs) {
      timeoutTimer = setTimeout(() => {
        timedOut = true;
        const msg = `Command timed out after ${options.timeoutMs}ms: ${cmdStr}`;
        console.error(`[runCommand] ${msg}`);
        debugLog.error("ffmpeg-command", msg, { command, args });
        child.kill("SIGKILL");
        reject(new Error(msg));
      }, options.timeoutMs);
    }

    if (options?.lowPriority) {
      try {
        os.setPriority(child.pid!, os.constants.priority.PRIORITY_LOW);
      } catch {
        // Best effort only.
      }
    }

    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];

    let stdoutRemainder = "";
    child.stdout.on("data", (chunk: Buffer) => {
      stdoutChunks.push(chunk);
      if (options?.onLine) {
        const text = stdoutRemainder + chunk.toString("utf8");
        const lines = text.split(/\r?\n/);
        stdoutRemainder = lines.pop() ?? "";
        for (const line of lines) {
          options.onLine(line);
        }
      }
    });

    child.stderr.on("data", (chunk: Buffer) => stderrChunks.push(chunk));

    child.on("error", (error) => {
      console.error(`[runCommand] Child process error: ${error.message}`);
      debugLog.error("ffmpeg-command", `Child process error: ${error.message}`, { command, args, error });
      if (timeoutTimer) clearTimeout(timeoutTimer);
      if (timedOut) return;
      reject(error);
    });

    child.on("close", (code, signal) => {
      if (timeoutTimer) clearTimeout(timeoutTimer);
      if (timedOut) return;

      if (options?.onLine && stdoutRemainder) {
        options.onLine(stdoutRemainder);
      }

      const stdout = Buffer.concat(stdoutChunks);
      const stderr = Buffer.concat(stderrChunks);
      if (code === 0) {
        debugLog.debug("ffmpeg-command", "Command completed successfully", { command });
        resolve({ stdout, stderr });
        return;
      }

      const stderrText = stderr.toString("utf8").trim();
      const signalText = signal ? `, signal ${signal}` : "";
      const errorMsg = `Command failed with exit code ${code}${signalText}: ${stderrText}`;
      console.error(`[runCommand] ${errorMsg}`);
      debugLog.error("ffmpeg-command", `Command failed: ${errorMsg}`, { command, args });
      reject(new Error(errorMsg));
    });
  });
}

export async function extractSpriteBmp(
  ffmpegPath: string,
  videoPath: string,
  range: NormalizedVideoHashRange,
  options?: { lowPriority?: boolean; headers?: Record<string, string> }
): Promise<Buffer> {
  const tileLayout = `${SPRITE_COLUMNS}x${SPRITE_ROWS}`;
  const frameWidth = SPRITE_SCREENSHOT_WIDTH;
  const totalWidth = frameWidth * SPRITE_COLUMNS;
  const totalHeight = frameWidth * SPRITE_ROWS;

  const OFFSET_RATIO = 0.05;
  const SPAN_RATIO = 0.9;
  const durationMs = range.endTimeMs - range.startTimeMs;
  const offsetMs = range.startTimeMs + durationMs * OFFSET_RATIO;
  const spanMs = durationMs * SPAN_RATIO;

  const fps = SPRITE_FRAME_COUNT / (spanMs / 1000);
  const ssSeconds = (offsetMs / 1000).toFixed(3);
  const tSeconds = (spanMs / 1000).toFixed(3);

  const args = ["-hide_banner", "-loglevel", "error", "-nostdin"];

  if (options?.headers && Object.keys(options.headers).length > 0) {
    const headerString =
      Object.entries(options.headers)
        .map(([k, v]) => `${k}: ${v}`)
        .join("\r\n") + "\r\n";
    args.push("-headers", headerString);
  }

  args.push(
    "-ss",
    ssSeconds,
    "-i",
    videoPath,
    "-t",
    tSeconds,
    "-vf",
    `fps=${fps.toFixed(4)},trim=0:end_frame=${SPRITE_FRAME_COUNT},scale=${frameWidth}:-1,tile=${tileLayout}:padding=0:margin=0,scale=${totalWidth}:${totalHeight}:force_original_aspect_ratio=disable`,
    "-vsync",
    "vfr",
    "-frames:v",
    "1",
    "-c:v",
    "bmp",
    "-f",
    "image2pipe",
    "-"
  );

  const { stdout } = await runCommand(ffmpegPath, args, { ...options, timeoutMs: 120_000 });
  if (stdout.length === 0) {
    throw new Error("ffmpeg returned an empty frame output.");
  }

  return stdout;
}

export { extractSpriteBmp as extractMultipleFramesBmp };
