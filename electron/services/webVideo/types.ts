export type YtDlpBinarySource = "bundled" | "system";

export type YtDlpBinary = {
  ytDlpPath: string;
  source: YtDlpBinarySource;
  version: string | null;
};

export type WebsiteVideoCacheMetadata = {
  originalUrl: string;
  extractor: string | null;
  title: string | null;
  durationMs: number | null;
  finalFilePath: string;
  fileExtension: string | null;
  ytDlpVersion: string | null;
  createdAt: string;
  lastAccessedAt: string;
};

export type WebsiteVideoCacheState = "not_applicable" | "cached" | "pending";

export type VideoDownloadProgress = {
  url: string;
  percent: number;
  speedBytesPerSec: number | null;
  etaSeconds: number | null;
  totalBytes: number | null;
  downloadedBytes: number | null;
  startedAt: string;
};

export type WebsiteVideoStreamResolution = {
  streamUrl: string;
  headers: Record<string, string>;
  extractor: string | null;
  title: string | null;
  durationMs: number | null;
  contentType: string | null;
  playbackStrategy: "remote" | "ytdlp";
};
