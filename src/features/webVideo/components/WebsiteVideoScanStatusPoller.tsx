import React, { memo, useEffect, useRef, useState } from "react";
import { db, type WebsiteVideoScanStatus } from "../../../services/db";

const WebsiteVideoScanStatusBadge = memo(function WebsiteVideoScanStatusBadge({
  status,
}: {
  status: WebsiteVideoScanStatus;
}) {
  const isRunning = status.state === "running";
  const isDone = status.state === "done";
  const isAborted = status.state === "aborted";
  const isError = status.state === "error";

  const progress = status.totalCount > 0 ? (status.completedCount / status.totalCount) * 100 : 0;
  const hasLongName = status.currentRoundName && status.currentRoundName.length > 28;

  if (!isRunning && !isDone && !isAborted && !isError) {
    return null;
  }

  return (
    <div
      className={`relative overflow-hidden rounded-lg border px-3 py-1.5 backdrop-blur-sm transition-all duration-300 ${
        isRunning
          ? "border-sky-400/30 bg-sky-950/8"
          : isDone
            ? "border-emerald-400/30 bg-emerald-950/8"
            : isAborted
              ? "border-amber-400/30 bg-amber-950/8"
              : "border-rose-400/30 bg-rose-950/8"
      }`}
    >
      {isRunning && <div className="pointer-events-none absolute inset-0 animate-phash-scanline" />}

      <div className="relative z-10">
        <div className="mb-1 flex items-center gap-1.5">
          <span
            className={`text-[8px] ${
              isRunning
                ? "text-sky-300/80 animate-pulse"
                : isDone
                  ? "text-emerald-300/80"
                  : isAborted
                    ? "text-amber-300/80"
                    : "text-rose-300/80"
            }`}
          >
            ◆
          </span>
          <p
            className={`font-[family-name:var(--font-jetbrains-mono)] text-[9px] font-medium uppercase tracking-[0.14em] ${
              isRunning
                ? "text-sky-200/70"
                : isDone
                  ? "text-emerald-200/70"
                  : isAborted
                    ? "text-amber-200/70"
                    : "text-rose-200/70"
            }`}
          >
            Web Rounds
          </p>
        </div>

        <div className="pl-3.5">
          <div
            className={`font-[family-name:var(--font-jetbrains-mono)] text-[10px] tracking-wide ${
              isRunning
                ? "text-sky-100/90"
                : isDone
                  ? "text-emerald-100/90"
                  : isAborted
                    ? "text-amber-100/90"
                    : "text-rose-100/90"
            }`}
          >
            {isRunning
              ? "Caching Installed Videos"
              : isDone
                ? "Cache Complete"
                : isAborted
                  ? "Cache Aborted"
                  : "Cache Error"}
          </div>

          {isRunning && (
            <>
              <div className="mt-1.5">
                <div className="h-1 overflow-hidden rounded-full bg-sky-950/60">
                  <div
                    className="animate-phash-progress-shimmer h-full rounded-full bg-gradient-to-r from-sky-500 via-cyan-400 to-blue-400"
                    style={{ width: `${progress}%`, backgroundSize: "200% 100%" }}
                  />
                </div>
              </div>

              {status.currentRoundName && (
                <div className="mt-1 overflow-hidden">
                  <div className="font-[family-name:var(--font-jetbrains-mono)] text-[8px] tracking-[0.08em] text-sky-400/70">
                    PROCESSING
                  </div>
                  <div
                    className={`mt-0.5 font-[family-name:var(--font-jetbrains-mono)] text-[9px] text-sky-100/90 ${hasLongName ? "animate-phash-text-scroll" : "truncate"}`}
                  >
                    <span className={hasLongName ? "inline-block whitespace-nowrap" : ""}>
                      ▸ {status.currentRoundName}
                      {hasLongName && (
                        <span className="ml-8 opacity-0">{status.currentRoundName}</span>
                      )}
                    </span>
                  </div>
                </div>
              )}

              <div className="mt-1 flex items-center justify-between font-[family-name:var(--font-jetbrains-mono)] text-[8px]">
                <span className="text-sky-400/60">
                  {status.completedCount} / {status.totalCount} videos
                </span>
                <span className="text-sky-300/80">{Math.round(progress)}%</span>
              </div>
            </>
          )}

          {(isDone || isAborted || isError) && (
            <div
              className={`mt-0.5 font-[family-name:var(--font-jetbrains-mono)] text-[9px] tracking-wide ${
                isDone
                  ? "text-emerald-200/60"
                  : isAborted
                    ? "text-amber-200/60"
                    : "text-rose-200/60"
              }`}
            >
              {status.completedCount} cached
              {status.skippedCount > 0 && <span>, {status.skippedCount} skipped</span>}
              {status.failedCount > 0 && <span>, {status.failedCount} failed</span>}
            </div>
          )}
        </div>
      </div>
    </div>
  );
});

interface WebsiteVideoScanStatusPollerProps {
  visible?: boolean;
}

export const WebsiteVideoScanStatusPoller: React.FC<WebsiteVideoScanStatusPollerProps> = memo(
  ({ visible = true }) => {
    const [scanStatus, setScanStatus] = useState<WebsiteVideoScanStatus | null>(null);
    const hideTimeoutRef = useRef<number | null>(null);

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
          const status = await db.webVideoCache.getScanStatus();
          if (!mounted) return;

          setScanStatus(status);

          if (hideTimeoutRef.current) {
            clearTimeout(hideTimeoutRef.current);
            hideTimeoutRef.current = null;
          }

          if (status.state === "done" || status.state === "aborted" || status.state === "error") {
            hideTimeoutRef.current = window.setTimeout(() => {
              if (mounted) {
                setScanStatus(null);
              }
            }, 4000);
          }
        } catch (error) {
          console.error("Failed to poll website video scan status", error);
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
        if (hideTimeoutRef.current) {
          clearTimeout(hideTimeoutRef.current);
        }
      };
    }, [scanStatus?.state]);

    if (!visible || !scanStatus) {
      return null;
    }

    return <WebsiteVideoScanStatusBadge status={scanStatus} />;
  }
);

WebsiteVideoScanStatusPoller.displayName = "WebsiteVideoScanStatusPoller";
