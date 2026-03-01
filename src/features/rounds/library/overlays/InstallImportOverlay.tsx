import { Trans, useLingui } from "@lingui/react/macro";
import type { InstallScanStatus } from "@/services/db";
import { useInstallScanStatus } from "../hooks/useStatusPollers";
import { formatEta } from "../helpers";

export function InstallImportOverlay({
  isAborting,
  onAbort,
}: {
  isAborting: boolean;
  onAbort: () => void;
}) {
  // Poll faster while the overlay is up.
  const query = useInstallScanStatus({ enabled: true, refetchOnMount: true });
  // Force a short refetch interval by reading the latest status on each render.
  const status = query.data ?? null;
  return <InstallImportOverlayInner status={status} aborting={isAborting} onAbort={onAbort} />;
}

function InstallImportOverlayInner({
  status,
  aborting,
  onAbort,
}: {
  status: InstallScanStatus | null;
  aborting: boolean;
  onAbort: () => void;
}) {
  const { t } = useLingui();
  const stats = status?.stats;
  const processed = stats ? stats.installed + stats.updated + stats.skipped + stats.failed : 0;
  const total = status?.phaseProgress?.total ?? stats?.totalSidecars ?? 0;
  const phaseCurrent = status?.phaseProgress?.current ?? processed;
  const progress = total > 0 ? (processed / total) * 100 : 0;
  const eta =
    status?.state === "running"
      ? status.etaMs
        ? formatEta(status.etaMs, t)
        : t`Calculating ETA...`
      : "";

  const summary = status
    ? t`${status.stats.installed} rounds, ${status.stats.playlistsImported} playlists, ${status.stats.updated} updated, ${status.stats.failed} failed`
    : t`Preparing import...`;
  const progressLabel =
    status?.phase === "extracting-pack" && status.phaseProgress
      ? t`Extracting pack ${status.phaseProgress.current} / ${status.phaseProgress.total} files`
      : (status?.lastMessage ?? t`Scanning files and preparing imported rounds...`);
  const progressPercent = total > 0 ? (phaseCurrent / total) * 100 : progress;

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/80 px-4 backdrop-blur-md">
      <div className="w-full max-w-xl rounded-[2rem] border border-cyan-300/30 bg-zinc-950/95 p-6 shadow-[0_0_60px_rgba(34,211,238,0.18)]">
        <div className="flex items-start gap-4">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-cyan-300/30 bg-cyan-500/10 shadow-[0_0_15px_rgba(34,211,238,0.2)]">
            {status?.lastPreviewImage ? (
              <img
                src={status.lastPreviewImage}
                alt={t`Current round preview`}
                className="h-full w-full rounded-2xl object-cover"
              />
            ) : (
              <div className="h-4 w-4 rounded-full bg-cyan-300 shadow-[0_0_22px_rgba(34,211,238,0.9)] animate-pulse" />
            )}
          </div>

          <div className="flex-1 space-y-4">
            <div>
              <p className="font-[family-name:var(--font-jetbrains-mono)] text-[10px] uppercase tracking-[0.32em] text-cyan-200/85">
                <Trans>Long Import Running</Trans>
              </p>
              <h2 className="mt-2 text-2xl font-black tracking-tight text-zinc-50">
                <Trans>Installing rounds can take a very long time.</Trans>
              </h2>
              <p className="mt-3 text-sm leading-6 text-zinc-300">
                <Trans>
                  Hashes may need to be calculated, and video transcoding or preview generation may
                  also be required.
                </Trans>
              </p>
            </div>

            <div className="rounded-2xl border border-cyan-300/20 bg-cyan-500/10 p-4">
              <div className="flex items-center justify-between">
                <p className="font-[family-name:var(--font-jetbrains-mono)] text-[10px] uppercase tracking-[0.22em] text-cyan-100">
                  <Trans>Progress</Trans>
                </p>
                {eta && (
                  <p className="font-[family-name:var(--font-jetbrains-mono)] text-[10px] uppercase tracking-[0.1em] text-cyan-300 animate-pulse">
                    {eta}
                  </p>
                )}
              </div>

              {total > 0 && (
                <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-zinc-800/50">
                  <div
                    className="h-full bg-gradient-to-r from-cyan-500 to-blue-500 transition-all duration-500 ease-out"
                    style={{ width: `${Math.min(100, progressPercent)}%` }}
                  />
                </div>
              )}

              <p className="mt-3 text-sm text-zinc-100">{summary}</p>
              <p className="mt-2 text-xs font-medium text-zinc-400 truncate">{progressLabel}</p>
            </div>

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
              >
                {aborting ? t`Aborting...` : t`Abort Import`}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
