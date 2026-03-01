import React, { useEffect, useState, useRef, memo } from "react";
import { db, type InstallScanStatus } from "../../../services/db";

interface LibraryStatusPollerProps {
  onDataChanged?: () => void | Promise<void>;
  /**
   * If true, renders the full badge. If false, only polls in the background.
   */
  visible?: boolean;
}

export const InstallScanStatusBadge = memo(function InstallScanStatusBadge({
  status,
}: {
  status: InstallScanStatus;
}) {
  const isRunning = status.state === "running";
  const isAborted = status.state === "aborted";
  const isError = status.state === "error";

  const stats = status.stats;
  const processed =
    stats.installed + stats.updated + stats.skipped + stats.failed + stats.sidecarsSeen;
  const total = stats.totalSidecars;
  const progressText = total > 0 && isRunning ? ` (${Math.round((processed / total) * 100)}%)` : "";

  const summary = `${stats.installed} rounds / ${stats.playlistsImported} playlists / ${stats.updated} updated / ${stats.failed} failed${progressText}`;
  const label =
    status.state === "running"
      ? "Scan Running"
      : status.state === "aborted"
        ? "Scan Aborted"
        : status.state === "error"
          ? "Scan Error"
          : "Last Scan Complete";

  return (
    <div
      className={`rounded-lg border px-3 py-1.5 backdrop-blur-sm transition-all duration-300 ${
        isRunning
          ? "border-cyan-400/30 bg-cyan-950/8"
          : isAborted
            ? "border-amber-400/30 bg-amber-950/8"
            : isError
              ? "border-rose-400/30 bg-rose-950/8"
              : "border-emerald-400/30 bg-emerald-950/8"
      }`}
    >
      <div className="flex items-center gap-1.5 mb-1">
        <span
          className={`text-[8px] ${
            isRunning
              ? "text-cyan-300/80 animate-pulse"
              : isAborted
                ? "text-amber-300/80"
                : isError
                  ? "text-rose-300/80"
                  : "text-emerald-300/80"
          }`}
        >
          ◆
        </span>
        <p
          className={`font-[family-name:var(--font-jetbrains-mono)] text-[9px] uppercase tracking-[0.14em] font-medium ${
            isRunning
              ? "text-cyan-200/70"
              : isAborted
                ? "text-amber-200/70"
                : isError
                  ? "text-rose-200/70"
                  : "text-emerald-200/70"
          }`}
        >
          Library Scan
        </p>
      </div>
      <div className="pl-3.5">
        <div
          className={`font-[family-name:var(--font-jetbrains-mono)] text-[10px] tracking-wide ${
            isRunning
              ? "text-cyan-100/90"
              : isAborted
                ? "text-amber-100/90"
                : isError
                  ? "text-rose-100/90"
                  : "text-emerald-100/90"
          }`}
        >
          {label}
        </div>
        <div
          className={`mt-0.5 font-[family-name:var(--font-jetbrains-mono)] text-[9px] tracking-wide ${
            isRunning
              ? "text-cyan-200/60"
              : isAborted
                ? "text-amber-200/60"
                : isError
                  ? "text-rose-200/60"
                  : "text-emerald-200/60"
          }`}
        >
          {summary}
        </div>
      </div>
    </div>
  );
});

export const LibraryStatusPoller: React.FC<LibraryStatusPollerProps> = memo(
  ({ onDataChanged, visible = true }) => {
    const [scanStatus, setScanStatus] = useState<InstallScanStatus | null>(null);
    const previousCountRef = useRef<number>(0);
    const previousStateRef = useRef<InstallScanStatus["state"] | null>(null);

    useEffect(() => {
      let mounted = true;
      let timeout: number | null = null;

      const scheduleNext = (delayMs: number) => {
        if (!mounted) return;
        timeout = window.setTimeout(() => {
          void pollScanStatus();
        }, delayMs);
      };

      const pollScanStatus = async () => {
        if (document.hidden) {
          scheduleNext(10_000);
          return;
        }

        try {
          const status = await db.install.getScanStatus();
          if (!mounted) return;

          setScanStatus(status);

          const currentCount = status.stats.installed + status.stats.updated;
          const countIncreased = currentCount > previousCountRef.current;
          const finishedNow = previousStateRef.current === "running" && status.state !== "running";

          if (countIncreased || finishedNow) {
            if (onDataChanged) {
              void onDataChanged();
            }
          }

          previousStateRef.current = status.state;
          previousCountRef.current = currentCount;
        } catch (error) {
          console.error("Failed to poll library scan status", error);
        } finally {
          scheduleNext(scanStatus?.state === "running" ? 2_000 : 10_000);
        }
      };

      void pollScanStatus();

      return () => {
        mounted = false;
        if (timeout) {
          window.clearTimeout(timeout);
        }
      };
    }, [onDataChanged, scanStatus?.state]);

    if (!visible || !scanStatus) {
      return null;
    }

    return <InstallScanStatusBadge status={scanStatus} />;
  }
);

LibraryStatusPoller.displayName = "LibraryStatusPoller";
