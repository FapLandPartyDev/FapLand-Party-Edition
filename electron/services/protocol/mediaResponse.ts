import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { spawn } from "node:child_process";
import {
  getVideoContentTypeByExtension,
  isVideoExtension,
} from "../../../src/constants/videoFormats";
import { resolvePhashBinaries } from "../phash/binaries";
import { debugLog } from "../debugLogging";
import { getFfmpegGpuEnv, resolveGpuIndex } from "../ffmpegEnv";

function resolveMediaContentType(filePath: string): string {
  const extension = path.extname(filePath).toLowerCase();
  // Ensure we don't return an extension that starts with a dot if it's not expected by lookup
  const cleanExtension = extension.startsWith(".") ? extension.slice(1) : extension;

  if (cleanExtension === "funscript" || cleanExtension === "json") return "application/json";

  const mappedVideoType = getVideoContentTypeByExtension(cleanExtension);
  if (mappedVideoType) return mappedVideoType;
  if (isVideoExtension(cleanExtension)) {
    return "video/mp4";
  }

  return "application/octet-stream";
}

type ParsedByteRange = { start: number; end: number } | null | "invalid";

function parseRangeHeader(rangeHeader: string | null, totalSize: number): ParsedByteRange {
  if (!rangeHeader) return null;

  const normalized = rangeHeader.trim();
  if (!normalized.toLowerCase().startsWith("bytes=")) return "invalid";

  const value = normalized.slice(6).split(",")[0]?.trim() ?? "";
  const matched = value.match(/^(\d*)-(\d*)$/);
  if (!matched) return "invalid";

  const rawStart = matched[1] ?? "";
  const rawEnd = matched[2] ?? "";
  if (rawStart.length === 0 && rawEnd.length === 0) return "invalid";

  if (rawStart.length === 0) {
    const suffixLength = Number(rawEnd);
    if (!Number.isFinite(suffixLength) || suffixLength <= 0) return "invalid";
    const safeSuffixLength = Math.floor(suffixLength);
    const end = Math.max(0, totalSize - 1);
    const start = Math.max(0, totalSize - safeSuffixLength);
    return { start, end };
  }

  const start = Math.floor(Number(rawStart));
  if (!Number.isFinite(start) || start < 0) return "invalid";

  const parsedEnd = rawEnd.length > 0 ? Math.floor(Number(rawEnd)) : totalSize - 1;
  if (!Number.isFinite(parsedEnd) || parsedEnd < 0) return "invalid";

  if (start >= totalSize || start > parsedEnd) return "invalid";

  const end = Math.min(parsedEnd, totalSize - 1);
  return { start, end };
}

export async function createMediaResponse(
  filePath: string,
  request: Request,
  searchParams?: URLSearchParams
): Promise<Response> {
  const shouldTranscode = searchParams?.has("transcode");
  const seekTimeSec = searchParams?.get("t");
  const startAtMs = searchParams?.get("startAtMs");

  if (shouldTranscode) {
    const binaries = await resolvePhashBinaries();
    const ffmpegPath = binaries.ffmpegPath;

    debugLog.info("media-transcode", "Initiating live transcode request", {
      filePath,
      seekTimeSec,
      startAtMs,
      ffmpegPath,
    });

    type TranscodeStrategy = "cuda" | "qsv" | "software";
    const strategies: TranscodeStrategy[] = ["cuda", "qsv", "software"];
    let currentStrategyIndex = 0;

    const buildArgs = (strategy: TranscodeStrategy): string[] => {
      const args: string[] = ["-hide_banner", "-loglevel", "warning", "-nostdin"];

      if (seekTimeSec || startAtMs) {
        const timeOffset = seekTimeSec ? parseFloat(seekTimeSec) : parseInt(startAtMs!) / 1000;
        if (!isNaN(timeOffset) && timeOffset > 0) {
          args.push("-ss", timeOffset.toFixed(3));
        }
      }

      const gpuIndex = resolveGpuIndex();

      if (strategy === "cuda") {
        args.push("-hwaccel", "cuda", "-hwaccel_output_format", "cuda", "-c:v", "hevc_cuvid");
      } else if (strategy === "qsv") {
        if (gpuIndex !== null && process.platform === "win32") {
          args.push("-qsv_device", String(gpuIndex));
        }
        args.push("-hwaccel", "qsv", "-hwaccel_output_format", "qsv");
      }

      args.push("-i", filePath);

      if (strategy === "cuda") {
        args.push(
          "-c:v", "h264_nvenc",
          "-preset", "p1",          // fastest NVENC preset
          "-tune", "ull",           // ultra low latency
          "-zerolatency", "1",
          "-pix_fmt", "yuv420p"     // Chromium requires 8-bit 4:2:0
        );
      } else if (strategy === "qsv") {
        args.push(
          "-c:v", "h264_qsv",
          "-preset", "veryfast",
          "-pix_fmt", "nv12"        // Standard pixel format for QSV output, Chromium supports it via GPU process.
        );
      } else {
        args.push(
          "-c:v", "libx264",
          "-preset", "ultrafast",
          "-pix_fmt", "yuv420p"
        );
      }

      args.push(
        "-c:a", "aac",
        "-f", "mp4",
        "-movflags", "frag_keyframe+empty_moov+faststart",
        "pipe:1"
      );
      return args;
    };

    const initialArgs = buildArgs(strategies[currentStrategyIndex]!);
    debugLog.debug("media-transcode", `Spawning initial FFmpeg process (${strategies[currentStrategyIndex]} attempt)`, {
      args: initialArgs,
    });

    const gpuEnv = getFfmpegGpuEnv();
    const ffmpegEnv = gpuEnv ? { ...process.env, ...gpuEnv } : undefined;

    let ffmpeg = spawn(ffmpegPath, initialArgs, { env: ffmpegEnv });
    const spawnTime = Date.now();
    let totalBytesSent = 0;

    let settled = false;
    let cancelled = false;
    let receivedAnyData = false;
    let cleanup = () => {};

    const stream = new ReadableStream({
      start(controller) {
        cleanup = () => {
          ffmpeg.stdout.off("data", handleData);
          ffmpeg.stdout.off("end", handleEnd);
          ffmpeg.stderr.off("data", handleStderr);
          ffmpeg.off("error", handleError);
          ffmpeg.off("close", handleClose);
        };

        const settleClose = () => {
          if (settled) return;
          settled = true;
          cleanup();
          controller.close();
        };

        const settleError = (error: unknown) => {
          if (settled) return;
          settled = true;
          cleanup();
          controller.error(error);
        };

        const handleData = (chunk: Buffer) => {
          if (settled) return;
          if (!receivedAnyData) {
            receivedAnyData = true;
            const elapsed = Date.now() - spawnTime;
            debugLog.info("media-transcode", "FFmpeg first stdout chunk received", {
              elapsedMs: elapsed,
              chunkLength: chunk.length,
              strategy: strategies[currentStrategyIndex],
            });
          }
          totalBytesSent += chunk.length;
          controller.enqueue(new Uint8Array(chunk));
        };

        const handleStderr = (chunk: Buffer) => {
          const text = chunk.toString("utf8").trim();
          if (text) {
            debugLog.warn("media-transcode-ffmpeg", `FFmpeg stderr: ${text}`, {
              strategy: strategies[currentStrategyIndex],
              filePath,
            });
          }
        };

        const handleEnd = () => {
          debugLog.debug("media-transcode", "FFmpeg stdout stream end reached", {
            totalBytesSent,
            elapsedMs: Date.now() - spawnTime,
            strategy: strategies[currentStrategyIndex],
          });
          settleClose();
        };

        const handleError = (error: Error) => {
          debugLog.error("media-transcode", "FFmpeg process encountered error", {
            error: error.message,
            stack: error.stack,
            totalBytesSent,
            elapsedMs: Date.now() - spawnTime,
            strategy: strategies[currentStrategyIndex],
          });
          settleError(error);
        };

        const handleClose = (code: number | null, signal: NodeJS.Signals | null) => {
          if (settled) return;
          if (cancelled) {
            debugLog.info("media-transcode", "FFmpeg process closed after cancellation", {
              code,
              signal,
              totalBytesSent,
              elapsedMs: Date.now() - spawnTime,
              strategy: strategies[currentStrategyIndex],
            });
            settled = true;
            cleanup();
            return;
          }
          if (code === 0) {
            debugLog.info("media-transcode", "FFmpeg process exited successfully", {
              code,
              signal,
              totalBytesSent,
              elapsedMs: Date.now() - spawnTime,
              strategy: strategies[currentStrategyIndex],
            });
            settleClose();
            return;
          }

          if (currentStrategyIndex < strategies.length - 1 && !receivedAnyData) {
            const failedStrategy = strategies[currentStrategyIndex];
            currentStrategyIndex++;
            const nextStrategy = strategies[currentStrategyIndex]!;
            
            debugLog.warn("media-transcode", `${failedStrategy} attempt failed before any data was produced. Retrying with ${nextStrategy}`, {
              code,
              signal,
              elapsedMs: Date.now() - spawnTime,
            });
            cleanup();
            
            const fallbackArgs = buildArgs(nextStrategy);
            debugLog.info("media-transcode", `Spawning fallback FFmpeg process (${nextStrategy} decode)`, {
              args: fallbackArgs,
            });
            ffmpeg = spawn(ffmpegPath, fallbackArgs, { env: ffmpegEnv });
            ffmpeg.stdout.on("data", handleData);
            ffmpeg.stdout.on("end", handleEnd);
            ffmpeg.stderr.on("data", handleStderr);
            ffmpeg.on("error", handleError);
            ffmpeg.on("close", handleClose);
            cleanup = () => {
              ffmpeg.stdout.off("data", handleData);
              ffmpeg.stdout.off("end", handleEnd);
              ffmpeg.stderr.off("data", handleStderr);
              ffmpeg.off("error", handleError);
              ffmpeg.off("close", handleClose);
            };
            return;
          }
          
          const exitErrorMsg = `FFmpeg live transcode exited unexpectedly (code=${code ?? "null"}, signal=${signal ?? "null"}).`;
          debugLog.error("media-transcode", exitErrorMsg, {
            strategy: strategies[currentStrategyIndex],
            totalBytesSent,
            elapsedMs: Date.now() - spawnTime,
          });
          settleError(new Error(exitErrorMsg));
        };

        ffmpeg.stdout.on("data", handleData);
        ffmpeg.stdout.on("end", handleEnd);
        ffmpeg.stderr.on("data", handleStderr);
        ffmpeg.on("error", handleError);
        ffmpeg.on("close", handleClose);
      },
      cancel() {
        if (settled) return;
        cancelled = true;
        settled = true;
        debugLog.info("media-transcode", "ReadableStream cancelled by client. Killing FFmpeg process", {
          totalBytesSent,
          elapsedMs: Date.now() - spawnTime,
          strategy: strategies[currentStrategyIndex],
        });
        cleanup();
        ffmpeg.kill("SIGKILL");
      },
    });

    return new Response(stream, {
      status: 200,
      headers: {
        "Content-Type": "video/mp4",
        "Cache-Control": "no-cache",
        "Access-Control-Allow-Origin": "*",
        "Transfer-Encoding": "chunked",
      },
    });
  }

  let fileStats;
  try {
    fileStats = await stat(filePath);
  } catch {
    debugLog.warn("media-response", "Direct file serve target not found", { filePath });
    return new Response("Not found", { status: 404 });
  }

  if (!fileStats.isFile()) {
    debugLog.warn("media-response", "Direct file serve target is not a file", { filePath });
    return new Response("Not found", { status: 404 });
  }

  const totalSize = fileStats.size;
  const range = parseRangeHeader(request.headers.get("range"), totalSize);
  const contentType = resolveMediaContentType(filePath);

  if (range === "invalid") {
    debugLog.warn("media-response", "Invalid range header received", {
      filePath,
      rangeHeader: request.headers.get("range"),
    });
    return new Response(null, {
      status: 416,
      headers: {
        "Accept-Ranges": "bytes",
        "Content-Range": `bytes */${totalSize}`,
      },
    });
  }

  if (!range) {
    debugLog.debug("media-response", "Serving full file (non-range request)", {
      filePath,
      totalSize,
      contentType,
    });

    const headers = new Headers({
      "Accept-Ranges": "bytes",
      "Content-Length": `${totalSize}`,
      "Content-Type": contentType,
    });

    if (request.method === "HEAD") {
      return new Response(null, { status: 200, headers });
    }

    const stream = createReadStream(filePath, { highWaterMark: 4 * 1024 * 1024 });
    return new Response(Readable.toWeb(stream) as ReadableStream, {
      status: 200,
      headers,
    });
  }

  const contentLength = Math.max(0, range.end - range.start + 1);
  debugLog.debug("media-response", "Serving file range", {
    filePath,
    totalSize,
    rangeStart: range.start,
    rangeEnd: range.end,
    contentLength,
    contentType,
  });

  const headers = new Headers({
    "Accept-Ranges": "bytes",
    "Content-Length": `${contentLength}`,
    "Content-Range": `bytes ${range.start}-${range.end}/${totalSize}`,
    "Content-Type": contentType,
  });

  if (request.method === "HEAD") {
    return new Response(null, { status: 206, headers });
  }

  const stream = createReadStream(filePath, {
    start: range.start,
    end: range.end,
    highWaterMark: 4 * 1024 * 1024,
  });

  return new Response(Readable.toWeb(stream) as ReadableStream, {
    status: 206,
    headers,
  });
}
