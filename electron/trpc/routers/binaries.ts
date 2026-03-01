import { router, publicProcedure } from "../trpc";
import {
  getConfiguredVideoHashBinaryPreference,
  resetPhashBinariesCache,
  resolvePhashBinaries,
} from "../../services/phash/binaries";
import {
  getConfiguredYtDlpBinaryPreference,
  resetYtDlpBinaryCache,
  resolveYtDlpBinary,
} from "../../services/webVideo/binaries";
import type { VideoHashFfmpegSourcePreference } from "../../../src/constants/videohashSettings";
import type { YtDlpBinaryPreference } from "../../../src/constants/ytDlpSettings";
import type { PhashBinaries } from "../../services/phash/types";
import type { YtDlpBinary } from "../../services/webVideo/types";

type BinaryPreference = VideoHashFfmpegSourcePreference | YtDlpBinaryPreference;
type BinarySource = "bundled" | "system";

type BinaryDiagnostic = {
  tool: "ffmpeg" | "ffprobe" | "yt-dlp";
  preference: BinaryPreference;
  source: BinarySource | null;
  path: string | null;
  version: string | null;
  error: string | null;
};

type BinaryDiagnosticsResponse = {
  ffmpeg: BinaryDiagnostic;
  ffprobe: BinaryDiagnostic;
  ytDlp: BinaryDiagnostic;
  checkedAtIso: string;
};

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function createEmptyDiagnostic(
  tool: BinaryDiagnostic["tool"],
  preference: BinaryPreference,
  error: string | null
): BinaryDiagnostic {
  return {
    tool,
    preference,
    source: null,
    path: null,
    version: null,
    error,
  };
}

function createFfmpegDiagnostic(
  tool: "ffmpeg" | "ffprobe",
  preference: VideoHashFfmpegSourcePreference,
  binaries: PhashBinaries
): BinaryDiagnostic {
  return {
    tool,
    preference,
    source: binaries.source,
    path: tool === "ffmpeg" ? binaries.ffmpegPath : binaries.ffprobePath,
    version: tool === "ffmpeg" ? binaries.ffmpegVersion : binaries.ffprobeVersion,
    error: null,
  };
}

function createYtDlpDiagnostic(
  preference: YtDlpBinaryPreference,
  binary: YtDlpBinary
): BinaryDiagnostic {
  return {
    tool: "yt-dlp",
    preference,
    source: binary.source,
    path: binary.ytDlpPath,
    version: binary.version,
    error: null,
  };
}

export const binariesRouter = router({
  getResolvedVersions: publicProcedure.query(async (): Promise<BinaryDiagnosticsResponse> => {
    const ffmpegPreference = getConfiguredVideoHashBinaryPreference();
    const ytDlpPreference = getConfiguredYtDlpBinaryPreference();

    resetPhashBinariesCache();
    resetYtDlpBinaryCache();

    const [ffmpegResult, ytDlpResult] = await Promise.allSettled([
      resolvePhashBinaries(ffmpegPreference),
      resolveYtDlpBinary(ytDlpPreference),
    ]);

    const ffmpeg =
      ffmpegResult.status === "fulfilled"
        ? createFfmpegDiagnostic("ffmpeg", ffmpegPreference, ffmpegResult.value)
        : createEmptyDiagnostic("ffmpeg", ffmpegPreference, getErrorMessage(ffmpegResult.reason));

    const ffprobe =
      ffmpegResult.status === "fulfilled"
        ? createFfmpegDiagnostic("ffprobe", ffmpegPreference, ffmpegResult.value)
        : createEmptyDiagnostic("ffprobe", ffmpegPreference, getErrorMessage(ffmpegResult.reason));

    const ytDlp =
      ytDlpResult.status === "fulfilled"
        ? createYtDlpDiagnostic(ytDlpPreference, ytDlpResult.value)
        : createEmptyDiagnostic("yt-dlp", ytDlpPreference, getErrorMessage(ytDlpResult.reason));

    return {
      ffmpeg,
      ffprobe,
      ytDlp,
      checkedAtIso: new Date().toISOString(),
    };
  }),
});
