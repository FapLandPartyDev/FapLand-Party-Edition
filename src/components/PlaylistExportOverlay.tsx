import { Trans, useLingui } from "@lingui/react/macro";
import { useRef } from "react";
import { useControllerSurface } from "../controller";
import type { PlaylistExportPackageStatus } from "../services/playlists";

function formatByteSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  const digits = value >= 100 || unitIndex === 0 ? 0 : value >= 10 ? 1 : 2;
  return `${value.toFixed(digits)} ${units[unitIndex]}`;
}

function formatDurationEstimate(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return "0 min";
  const rounded = Math.max(1, Math.round(seconds));
  if (rounded < 60) return `${rounded}s`;
  const hours = Math.floor(rounded / 3600);
  const minutes = Math.floor((rounded % 3600) / 60);
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${Math.max(1, minutes)} min`;
}

function formatMediaDuration(milliseconds: number): string {
  if (!Number.isFinite(milliseconds) || milliseconds <= 0) return "0:00";
  const totalSeconds = Math.max(0, Math.floor(milliseconds / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) {
    return `${hours}:${`${minutes}`.padStart(2, "0")}:${`${seconds}`.padStart(2, "0")}`;
  }
  return `${minutes}:${`${seconds}`.padStart(2, "0")}`;
}

export function PlaylistExportOverlay({
  status,
  aborting,
  onAbort,
}: {
  status: PlaylistExportPackageStatus | null;
  aborting: boolean;
  onAbort: () => void;
}) {
  const overlayRef = useRef<HTMLDivElement | null>(null);
  const { t } = useLingui();
  const completed = status?.progress.completed ?? 0;
  const total = status?.progress.total ?? 0;
  const percent = total > 0 ? Math.max(0, Math.min(100, Math.round((completed / total) * 100))) : 0;
  const compression = status?.compression ?? null;
  const transcodePercent = Math.round((compression?.liveProgress.percent ?? 0) * 100);
  const transcodeEtaSeconds = compression?.liveProgress.etaSecondsRemaining ?? null;
  const transcodeCompletedLabel = formatMediaDuration(
    compression?.liveProgress.completedDurationMs ?? 0
  );
  const transcodeTotalLabel = formatMediaDuration(compression?.liveProgress.totalDurationMs ?? 0);

  useControllerSurface({
    id: "playlist-export-overlay",
    scopeRef: overlayRef,
    priority: 80,
    enabled: true,
    initialFocusId: "playlist-export-abort",
  });

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/82 px-4 backdrop-blur-md">
      <div
        ref={overlayRef}
        className="w-full max-w-xl rounded-[2rem] border border-cyan-300/30 bg-zinc-950/95 p-6 shadow-[0_0_60px_rgba(34,211,238,0.18)]"
      >
        <div className="flex items-start gap-4">
          <div className="mt-1 flex shrink-0 items-center justify-center">
            <div className="h-10 w-10 rounded-full border-2 border-cyan-300/25 border-t-cyan-300 animate-spin" />
          </div>
          <div className="flex-1 space-y-4">
            <div>
              <p className="font-[family-name:var(--font-jetbrains-mono)] text-[10px] uppercase tracking-[0.32em] text-cyan-200/85">
                <Trans>Playlist Export Running</Trans>
              </p>
              <h2 className="mt-2 text-2xl font-black tracking-tight text-zinc-50">
                <Trans>Building the export package.</Trans>
              </h2>
              <p className="mt-3 text-sm leading-6 text-zinc-300">
                <Trans>
                  This export is blocking. Videos and attached funscripts are being copied,
                  downloaded, or compressed into the package.
                </Trans>
              </p>
              <p className="mt-2 text-sm leading-6 text-cyan-100/80">
                <Trans>
                  This may take a while for large playlists or remote media. Keep this window open
                  until the export finishes or is aborted.
                </Trans>
              </p>
            </div>

            <div className="rounded-2xl border border-cyan-300/20 bg-cyan-500/10 p-4">
              <div className="flex items-center justify-between gap-3 font-[family-name:var(--font-jetbrains-mono)] text-[10px] uppercase tracking-[0.22em] text-cyan-100">
                <span>
                  <Trans>Progress</Trans>
                </span>
                <span>{percent}%</span>
              </div>
              <div className="mt-3 h-2 overflow-hidden rounded-full bg-black/40">
                <div
                  className="h-full rounded-full bg-cyan-300 transition-[width] duration-200"
                  style={{ width: `${percent}%` }}
                />
              </div>
              <p className="mt-3 text-sm text-zinc-100">
                {t`${completed} / ${total || "?"} steps completed`}
              </p>
              <p className="mt-2 text-sm text-zinc-300">
                {status?.lastMessage ?? t`Preparing export package...`}
              </p>
              <p className="mt-2 text-[11px] uppercase tracking-[0.18em] text-cyan-100/70">
                {t`Phase: ${status?.phase ?? "idle"}`}
              </p>
            </div>

            <div className="grid grid-cols-2 gap-3 rounded-2xl border border-zinc-700/70 bg-black/25 p-4 text-sm text-zinc-200 sm:grid-cols-4">
              <div>
                <p className="font-[family-name:var(--font-jetbrains-mono)] text-[10px] uppercase tracking-[0.2em] text-zinc-400">
                  <Trans>Playlist</Trans>
                </p>
                <p className="mt-1 text-zinc-50">{status?.stats.playlistFiles ?? 0}</p>
              </div>
              <div>
                <p className="font-[family-name:var(--font-jetbrains-mono)] text-[10px] uppercase tracking-[0.2em] text-zinc-400">
                  <Trans>Sidecars</Trans>
                </p>
                <p className="mt-1 text-zinc-50">{status?.stats.sidecarFiles ?? 0}</p>
              </div>
              <div>
                <p className="font-[family-name:var(--font-jetbrains-mono)] text-[10px] uppercase tracking-[0.2em] text-zinc-400">
                  <Trans>Videos</Trans>
                </p>
                <p className="mt-1 text-zinc-50">{status?.stats.videoFiles ?? 0}</p>
              </div>
              <div>
                <p className="font-[family-name:var(--font-jetbrains-mono)] text-[10px] uppercase tracking-[0.2em] text-zinc-400">
                  <Trans>Scripts</Trans>
                </p>
                <p className="mt-1 text-zinc-50">{status?.stats.funscriptFiles ?? 0}</p>
              </div>
            </div>

            {compression && (
              <div className="rounded-2xl border border-amber-300/20 bg-amber-500/10 p-4 text-sm text-zinc-200">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <p className="font-[family-name:var(--font-jetbrains-mono)] text-[10px] uppercase tracking-[0.22em] text-amber-100">
                    <Trans>AV1 Compression</Trans>
                  </p>
                  <p className="rounded-full border border-amber-200/35 bg-amber-400/10 px-3 py-1 font-[family-name:var(--font-jetbrains-mono)] text-[10px] uppercase tracking-[0.18em] text-amber-100">
                    {compression.encoderKind ?? "unknown"} {compression.encoderName ?? "encoder"} ·{" "}
                    {compression.strength}%
                  </p>
                </div>
                <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
                  <div className="sm:col-span-3 rounded-2xl border border-amber-200/15 bg-black/20 p-3">
                    <div className="flex items-center justify-between gap-3 font-[family-name:var(--font-jetbrains-mono)] text-[10px] uppercase tracking-[0.2em] text-amber-100/90">
                      <span>
                        <Trans>Transcoding Progress</Trans>
                      </span>
                      <span>{transcodePercent}%</span>
                    </div>
                    <div className="mt-3 h-2 overflow-hidden rounded-full bg-black/40">
                      <div
                        className="h-full rounded-full bg-amber-300 transition-[width] duration-200"
                        style={{ width: `${transcodePercent}%` }}
                      />
                    </div>
                    <div className="mt-3 flex flex-wrap items-center justify-between gap-3 text-xs text-zinc-200">
                      <span>{t`${transcodeCompletedLabel} / ${transcodeTotalLabel} encoded`}</span>
                      <span>
                        {transcodeEtaSeconds === null
                          ? t`ETA calibrating...`
                          : t`${formatDurationEstimate(transcodeEtaSeconds)} remaining`}
                      </span>
                    </div>
                  </div>
                  <div>
                    <p className="font-[family-name:var(--font-jetbrains-mono)] text-[10px] uppercase tracking-[0.2em] text-zinc-400">
                      <Trans>Reencoded</Trans>
                    </p>
                    <p className="mt-1 text-zinc-50">
                      {compression.reencodedCompleted} / {compression.reencodedTotal}
                    </p>
                  </div>
                  <div>
                    <p className="font-[family-name:var(--font-jetbrains-mono)] text-[10px] uppercase tracking-[0.2em] text-zinc-400">
                      <Trans>Already AV1</Trans>
                    </p>
                    <p className="mt-1 text-zinc-50">{compression.alreadyAv1Copied}</p>
                  </div>
                  <div>
                    <p className="font-[family-name:var(--font-jetbrains-mono)] text-[10px] uppercase tracking-[0.2em] text-zinc-400">
                      <Trans>Active Jobs</Trans>
                    </p>
                    <p className="mt-1 text-zinc-50">{compression.activeJobs}</p>
                  </div>
                  <div>
                    <p className="font-[family-name:var(--font-jetbrains-mono)] text-[10px] uppercase tracking-[0.2em] text-zinc-400">
                      <Trans>Expected Size</Trans>
                    </p>
                    <p className="mt-1 text-zinc-50">
                      {formatByteSize(compression.expectedVideoBytes)}
                    </p>
                  </div>
                  <div>
                    <p className="font-[family-name:var(--font-jetbrains-mono)] text-[10px] uppercase tracking-[0.2em] text-zinc-400">
                      <Trans>Est. Encode Time</Trans>
                    </p>
                    <p className="mt-1 text-zinc-50">
                      {formatDurationEstimate(compression.estimatedCompressionSeconds)}
                    </p>
                  </div>
                  <div>
                    <p className="font-[family-name:var(--font-jetbrains-mono)] text-[10px] uppercase tracking-[0.2em] text-zinc-400">
                      <Trans>Estimate</Trans>
                    </p>
                    <p className="mt-1 text-zinc-50">
                      {compression.approximate ? t`Approximate` : t`Measured`}
                    </p>
                  </div>
                </div>
              </div>
            )}

            <div className="flex justify-end">
              <button
                type="button"
                onClick={onAbort}
                disabled={aborting}
                className={`rounded-xl border px-4 py-2 font-[family-name:var(--font-jetbrains-mono)] text-xs uppercase tracking-[0.22em] transition-all duration-200 ${
                  aborting
                    ? "cursor-wait border-zinc-700 bg-zinc-800 text-zinc-500"
                    : "border-rose-300/55 bg-rose-500/20 text-rose-100 hover:border-rose-200/80 hover:bg-rose-500/35"
                }`}
                data-controller-focus-id="playlist-export-abort"
                data-controller-initial="true"
              >
                {aborting ? t`Aborting...` : t`Abort Export`}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
