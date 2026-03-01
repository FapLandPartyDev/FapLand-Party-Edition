import { Trans } from "@lingui/react/macro";
import { motion } from "framer-motion";
import React from "react";
import { playHoverSound, playSelectSound } from "../../utils/audio";

type CachingProgress = {
  percent: number;
  speedBytesPerSec: number | null;
  etaSeconds: number | null;
  totalBytes: number | null;
  downloadedBytes: number | null;
};

type ConverterCachingOverlayProps = {
  url: string;
  progress: CachingProgress | null;
  error: string | null;
  onCancel: () => void;
  onRetry: () => void;
};

function formatBytes(bytes: number | null): string {
  if (bytes === null || !Number.isFinite(bytes)) return "—";
  if (bytes < 1024) return `${bytes.toFixed(0)} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
}

function formatSpeed(bytesPerSec: number | null): string {
  if (bytesPerSec === null || !Number.isFinite(bytesPerSec)) return "—";
  if (bytesPerSec < 1024) return `${bytesPerSec.toFixed(0)} B/s`;
  if (bytesPerSec < 1024 ** 2) return `${(bytesPerSec / 1024).toFixed(1)} KB/s`;
  return `${(bytesPerSec / 1024 ** 2).toFixed(1)} MB/s`;
}

function formatEta(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds) || seconds < 0) return "—";
  if (seconds < 60) return `${Math.ceil(seconds)}s`;
  const mins = Math.floor(seconds / 60);
  const secs = Math.ceil(seconds % 60);
  return `${mins}m ${secs}s`;
}

function truncateUrl(url: string, maxLength = 60): string {
  if (url.length <= maxLength) return url;
  return `${url.slice(0, maxLength - 3)}...`;
}

export const ConverterCachingOverlay: React.FC<ConverterCachingOverlayProps> = React.memo(
  ({ url, progress, error, onCancel, onRetry }) => {
    const percent = progress?.percent ?? 0;
    const clampedPercent = Math.max(0, Math.min(100, percent));

    return (
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.2 }}
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      >
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 10 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 10 }}
          transition={{ duration: 0.2 }}
          className="mx-4 w-full max-w-md rounded-2xl border border-violet-400/30 bg-zinc-950/90 p-6 shadow-2xl backdrop-blur-xl"
        >
          {!error ? (
            <>
              <div className="mb-1 flex items-center gap-2">
                <div className="h-2.5 w-2.5 animate-pulse rounded-full bg-violet-400" />
                <h2 className="text-lg font-bold text-violet-100">
                  <Trans>Caching Video</Trans>
                </h2>
              </div>
              <p className="mb-5 truncate text-xs text-zinc-500" title={url}>
                {truncateUrl(url)}
              </p>

              <div className="mb-3 h-2.5 overflow-hidden rounded-full bg-zinc-800">
                <motion.div
                  className="h-full rounded-full bg-gradient-to-r from-violet-500 to-purple-400"
                  initial={{ width: 0 }}
                  animate={{ width: `${clampedPercent}%` }}
                  transition={{ duration: 0.3, ease: "easeOut" }}
                />
              </div>

              <div className="mb-5 text-center text-sm font-medium tabular-nums text-violet-200">
                {clampedPercent.toFixed(1)}%
              </div>

              <div className="mb-5 grid grid-cols-3 gap-3 text-center">
                <div>
                  <div className="text-[0.65rem] font-semibold uppercase tracking-wider text-zinc-500">
                    <Trans>Speed</Trans>
                  </div>
                  <div className="mt-0.5 text-xs tabular-nums text-zinc-300">
                    {formatSpeed(progress?.speedBytesPerSec ?? null)}
                  </div>
                </div>
                <div>
                  <div className="text-[0.65rem] font-semibold uppercase tracking-wider text-zinc-500">
                    <Trans>Downloaded</Trans>
                  </div>
                  <div className="mt-0.5 text-xs tabular-nums text-zinc-300">
                    {formatBytes(progress?.downloadedBytes ?? null)}
                    {progress?.totalBytes != null && (
                      <span className="text-zinc-500"> / {formatBytes(progress.totalBytes)}</span>
                    )}
                  </div>
                </div>
                <div>
                  <div className="text-[0.65rem] font-semibold uppercase tracking-wider text-zinc-500">
                    ETA
                  </div>
                  <div className="mt-0.5 text-xs tabular-nums text-zinc-300">
                    {formatEta(progress?.etaSeconds ?? null)}
                  </div>
                </div>
              </div>

              <button
                type="button"
                onMouseEnter={playHoverSound}
                onClick={() => {
                  playSelectSound();
                  onCancel();
                }}
                className="w-full rounded-xl border border-zinc-600/60 bg-zinc-800/50 px-4 py-2.5 text-sm font-medium text-zinc-300 transition-all duration-200 hover:border-zinc-500/60 hover:bg-zinc-700/50 hover:text-zinc-100"
              >
                <Trans>Cancel</Trans>
              </button>
            </>
          ) : (
            <>
              <div className="mb-1 flex items-center gap-2">
                <div className="h-2.5 w-2.5 rounded-full bg-rose-400" />
                <h2 className="text-lg font-bold text-rose-100">
                  <Trans>Caching Failed</Trans>
                </h2>
              </div>
              <p className="mb-4 truncate text-xs text-zinc-500" title={url}>
                {truncateUrl(url)}
              </p>

              <div className="mb-5 rounded-xl border border-rose-300/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
                {error}
              </div>

              <div className="flex gap-3">
                <button
                  type="button"
                  onMouseEnter={playHoverSound}
                  onClick={() => {
                    playSelectSound();
                    onCancel();
                  }}
                  className="flex-1 rounded-xl border border-zinc-600/60 bg-zinc-800/50 px-4 py-2.5 text-sm font-medium text-zinc-300 transition-all duration-200 hover:border-zinc-500/60 hover:bg-zinc-700/50 hover:text-zinc-100"
                >
                  <Trans>Go Back</Trans>
                </button>
                <button
                  type="button"
                  onMouseEnter={playHoverSound}
                  onClick={() => {
                    playSelectSound();
                    onRetry();
                  }}
                  className="flex-1 rounded-xl border border-violet-300/60 bg-violet-500/30 px-4 py-2.5 text-sm font-semibold text-violet-100 transition-all duration-200 hover:border-violet-200/80 hover:bg-violet-500/45"
                >
                  <Trans>Retry</Trans>
                </button>
              </div>
            </>
          )}
        </motion.div>
      </motion.div>
    );
  }
);

ConverterCachingOverlay.displayName = "ConverterCachingOverlay";
