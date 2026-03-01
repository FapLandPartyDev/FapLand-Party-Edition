import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { spawn } from "node:child_process";
import { getVideoContentTypeByExtension, isVideoExtension } from "../../../src/constants/videoFormats";
import { resolvePhashBinaries } from "../phash/binaries";

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

    // Build FFmpeg arguments for live transcoding to WebM (VP9 + Opus)
    // as suggested for modern browsers like Chromium.
    const ffmpegArgs: string[] = [
      "-hide_banner",
      "-loglevel",
      "error",
      "-nostdin",
    ];

    // If seeking is requested (via ?t=... or ?startAtMs=...)
    const seekRequested = seekTimeSec || startAtMs;
    if (seekRequested) {
      const timeOffset = seekTimeSec ? parseFloat(seekTimeSec) : parseInt(startAtMs!) / 1000;
      if (!isNaN(timeOffset) && timeOffset > 0) {
        ffmpegArgs.push("-ss", timeOffset.toFixed(3));
      }
    }

    ffmpegArgs.push(
      "-i", filePath,
      "-c:v", "libvpx-vp9",
      "-deadline", "realtime",
      "-cpu-used", "4",
      "-c:a", "libopus",
      "-f", "webm",
      "pipe:1"
    );

    const ffmpeg = spawn(ffmpegPath, ffmpegArgs);

    // We don't read from stderr here to avoid buffering issues.
    // Guard the stream controller so request cancellation and FFmpeg teardown
    // cannot race each other into double close/error calls.
    let settled = false;
    let cancelled = false;
    let cleanup = () => {};

    const stream = new ReadableStream({
      start(controller) {
        cleanup = () => {
          ffmpeg.stdout.off("data", handleData);
          ffmpeg.stdout.off("end", handleEnd);
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
          controller.enqueue(new Uint8Array(chunk));
        };

        const handleEnd = () => {
          settleClose();
        };

        const handleError = (error: Error) => {
          settleError(error);
        };

        const handleClose = (code: number | null, signal: NodeJS.Signals | null) => {
          if (settled) return;
          if (cancelled) {
            settled = true;
            cleanup();
            return;
          }
          if (code === 0) {
            settleClose();
            return;
          }
          settleError(
            new Error(
              `FFmpeg live transcode exited unexpectedly (code=${code ?? "null"}, signal=${signal ?? "null"}).`
            )
          );
        };

        ffmpeg.stdout.on("data", handleData);
        ffmpeg.stdout.on("end", handleEnd);
        ffmpeg.on("error", handleError);
        ffmpeg.on("close", handleClose);
      },
      cancel() {
        if (settled) return;
        cancelled = true;
        settled = true;
        cleanup();
        ffmpeg.kill("SIGKILL");
      }
    });

    return new Response(stream, {
      status: 200,
      headers: {
        "Content-Type": "video/webm",
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
    return new Response("Not found", { status: 404 });
  }

  if (!fileStats.isFile()) {
    return new Response("Not found", { status: 404 });
  }

  const totalSize = fileStats.size;
  const range = parseRangeHeader(request.headers.get("range"), totalSize);
  const contentType = resolveMediaContentType(filePath);

  if (range === "invalid") {
    return new Response(null, {
      status: 416,
      headers: {
        "Accept-Ranges": "bytes",
        "Content-Range": `bytes */${totalSize}`,
      },
    });
  }

  if (!range) {
    const headers = new Headers({
      "Accept-Ranges": "bytes",
      "Content-Length": `${totalSize}`,
      "Content-Type": contentType,
    });

    if (request.method === "HEAD") {
      return new Response(null, { status: 200, headers });
    }

    const stream = createReadStream(filePath);
    return new Response(Readable.toWeb(stream) as ReadableStream, {
      status: 200,
      headers,
    });
  }

  const contentLength = Math.max(0, range.end - range.start + 1);
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
  });

  return new Response(Readable.toWeb(stream) as ReadableStream, {
    status: 206,
    headers,
  });
}
