import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { getVideoContentTypeByExtension, isVideoExtension } from "../../../src/constants/videoFormats";

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

export async function createMediaResponse(filePath: string, request: Request): Promise<Response> {
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
