import { useEffect, useMemo, useRef, useState } from "react";
import { Trans, useLingui } from "@lingui/react/macro";
import { useControllerSurface } from "../controller";
import { playlists, type PlaylistExportPackageAnalysis } from "../services/playlists";

type CompressionMode = "copy" | "av1";

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
  const hours = Math.floor(rounded / 3600);
  const minutes = Math.floor((rounded % 3600) / 60);
  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  return `${Math.max(1, minutes)} min`;
}

export function PlaylistPackExportDialog({
  playlistId,
  playlistName,
  onClose,
  onSubmit,
}: {
  playlistId: string;
  playlistName: string;
  onClose: () => void;
  onSubmit: (input: {
    compressionMode: CompressionMode;
    compressionStrength: number;
    includeMedia: boolean;
    asFpack: boolean;
  }) => Promise<boolean>;
}) {
  const { t } = useLingui();
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const [compressionMode, setCompressionMode] = useState<CompressionMode | null>(null);
  const [compressionStrength, setCompressionStrength] = useState(80);
  const [includeMedia, setIncludeMedia] = useState(true);
  const [asFpack, setAsFpack] = useState(false);
  const [analysis, setAnalysis] = useState<PlaylistExportPackageAnalysis | null>(null);
  const [analyzing, setAnalyzing] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const userTouchedModeRef = useRef(false);

  function getStrengthLabel(value: number): string {
    if (value <= 20) return t`Low compression`;
    if (value <= 60) return t`Balanced`;
    return t`High compression`;
  }

  useControllerSurface({
    id: "playlist-pack-export-dialog",
    scopeRef: dialogRef,
    priority: 120,
    enabled: true,
    initialFocusId: "playlist-pack-export-submit",
  });

  useEffect(() => {
    let cancelled = false;
    const timer = window.setTimeout(
      () => {
        setAnalyzing(true);
        playlists
          .analyzeExportPackage({
            playlistId,
            compressionMode: compressionMode ?? undefined,
            compressionStrength,
            includeMedia,
          })
          .then((result) => {
            if (cancelled) return;
            setAnalysis(result);
            setError(null);
            if (!userTouchedModeRef.current && compressionMode === null) {
              setCompressionMode(result.compression.defaultMode);
            }
          })
          .catch((analysisError) => {
            if (cancelled) return;
            setAnalysis(null);
            setError(
              analysisError instanceof Error
                ? analysisError.message
                : t`Failed to analyze export package.`
            );
          })
          .finally(() => {
            if (!cancelled) {
              setAnalyzing(false);
            }
          });
      },
      compressionMode === null ? 0 : 220
    );

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [playlistId, compressionMode, compressionStrength, includeMedia]);

  const canEnableCompression = analysis?.compression.supported ?? false;
  const effectiveMode: CompressionMode =
    compressionMode ?? analysis?.compression.defaultMode ?? "copy";
  const estimate = analysis?.estimate ?? null;
  const savingsBytes = estimate?.savingsBytes ?? 0;
  const savingsLabel = useMemo(() => formatByteSize(savingsBytes), [savingsBytes]);
  const sourceSizeLabel = useMemo(
    () => formatByteSize(estimate?.sourceVideoBytes ?? 0),
    [estimate?.sourceVideoBytes]
  );
  const finalSizeLabel = useMemo(
    () => formatByteSize(estimate?.expectedVideoBytes ?? 0),
    [estimate?.expectedVideoBytes]
  );
  const timeEstimateLabel = useMemo(
    () => formatDurationEstimate(estimate?.estimatedCompressionSeconds ?? 0),
    [estimate?.estimatedCompressionSeconds]
  );

  const handleSubmit = async () => {
    setSubmitting(true);
    try {
      const started = await onSubmit({
        compressionMode: effectiveMode,
        compressionStrength,
        includeMedia,
        asFpack,
      });
      if (started) {
        onClose();
      }
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : t`Failed to start export.`);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[85] overflow-y-auto bg-[radial-gradient(circle_at_top,rgba(34,211,238,0.16),transparent_35%),rgba(2,6,23,0.86)] px-4 py-6 backdrop-blur-md">
      <div
        ref={dialogRef}
        className="relative mx-auto w-full max-w-4xl overflow-hidden rounded-[2rem] border border-cyan-300/28 bg-slate-950/95 shadow-[0_28px_120px_rgba(8,145,178,0.28)]"
      >
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(34,211,238,0.14),transparent_28%),radial-gradient(circle_at_bottom_left,rgba(59,130,246,0.14),transparent_32%)]" />
        <div className="relative space-y-6 p-6 sm:p-8">
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-3">
              <p className="font-[family-name:var(--font-jetbrains-mono)] text-[10px] uppercase tracking-[0.34em] text-cyan-200/85">
                <Trans>Playlist Pack Export</Trans>
              </p>
              <div>
                <h2 className="text-3xl font-black tracking-tight text-white">
                  <Trans>Prepare {playlistName}</Trans>
                </h2>
                <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-300">
                  <Trans>
                    Review the estimated pack size and compression time before choosing the
                    destination folder.
                  </Trans>
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              disabled={submitting}
              className={`rounded-xl border px-4 py-2 font-[family-name:var(--font-jetbrains-mono)] text-xs uppercase tracking-[0.2em] ${
                submitting
                  ? "cursor-not-allowed border-slate-700 bg-slate-900 text-slate-500"
                  : "border-slate-600/80 bg-black/30 text-slate-300 transition-all duration-200 hover:border-cyan-200/60 hover:text-white"
              }`}
            >
              <Trans>Close</Trans>
            </button>
          </div>

          <div className="grid gap-4 lg:grid-cols-[1.05fr_0.95fr]">
            <div className="space-y-4">
              <div className="rounded-[1.5rem] border border-cyan-300/18 bg-cyan-500/8 p-5">
                <p className="font-[family-name:var(--font-jetbrains-mono)] text-[10px] uppercase tracking-[0.22em] text-cyan-100/85">
                  <Trans>Package Options</Trans>
                </p>
                <div className="mt-4 flex flex-col gap-4">
                  {/* eslint-disable-next-line jsx-a11y/label-has-associated-control -- label wraps input and has text content */}
                  <label
                    htmlFor="export-include-media"
                    className="flex items-center gap-3 cursor-pointer"
                  >
                    <input
                      type="checkbox"
                      id="export-include-media"
                      className="form-checkbox h-5 w-5 rounded border-slate-700 bg-black/50 text-cyan-400 focus:ring-cyan-400 focus:ring-offset-slate-950"
                      checked={includeMedia}
                      onChange={(e) => {
                        const next = e.target.checked;
                        setIncludeMedia(next);
                        if (!next && asFpack === false) setAsFpack(true);
                      }}
                    />
                    <div>
                      <span className="text-sm font-semibold text-white">
                        <Trans>Include Media Files</Trans>
                      </span>
                      <p className="text-xs text-slate-400">
                        <Trans>
                          If unchecked, only text files and configurations are exported.
                        </Trans>
                      </p>
                    </div>
                  </label>
                  {/* eslint-disable-next-line jsx-a11y/label-has-associated-control -- label wraps input and has text content */}
                  <label
                    htmlFor="export-as-fpack"
                    className="flex items-center gap-3 cursor-pointer"
                  >
                    <input
                      type="checkbox"
                      id="export-as-fpack"
                      className="form-checkbox h-5 w-5 rounded border-slate-700 bg-black/50 text-cyan-400 focus:ring-cyan-400 focus:ring-offset-slate-950"
                      checked={asFpack}
                      onChange={(e) => setAsFpack(e.target.checked)}
                    />
                    <div>
                      <span className="text-sm font-semibold text-white">
                        <Trans>Pack into .fpack File</Trans>
                      </span>
                      <p className="text-xs text-slate-400">
                        <Trans>Packs all exported files into a single ZIP archive (.fpack).</Trans>
                      </p>
                    </div>
                  </label>
                </div>
              </div>

              {includeMedia && (
                <div className="rounded-[1.5rem] border border-cyan-300/18 bg-cyan-500/8 p-5">
                  <p className="font-[family-name:var(--font-jetbrains-mono)] text-[10px] uppercase tracking-[0.22em] text-cyan-100/85">
                    <Trans>Compression</Trans>
                  </p>
                  <div className="mt-4 grid gap-3">
                    <button
                      type="button"
                      onClick={() => {
                        userTouchedModeRef.current = true;
                        setCompressionMode("copy");
                      }}
                      className={`rounded-[1.25rem] border p-4 text-left transition-all duration-200 ${
                        effectiveMode === "copy"
                          ? "border-emerald-300/65 bg-emerald-500/12"
                          : "border-slate-700/85 bg-slate-900/75 hover:border-emerald-300/30"
                      }`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="font-[family-name:var(--font-jetbrains-mono)] text-[10px] uppercase tracking-[0.2em] text-emerald-100/80">
                            <Trans>Fastest</Trans>
                          </p>
                          <h3 className="mt-2 text-lg font-bold text-white">
                            <Trans>Copy original videos</Trans>
                          </h3>
                          <p className="mt-2 text-sm leading-6 text-slate-300">
                            <Trans>
                              Export the pack without reencoding. File size stays close to the
                              original sources.
                            </Trans>
                          </p>
                        </div>
                        <div
                          className={`mt-1 rounded-full border px-3 py-1 text-[10px] uppercase tracking-[0.2em] ${effectiveMode === "copy" ? "border-emerald-200/70 bg-emerald-400/20 text-emerald-50" : "border-slate-600 text-slate-300"}`}
                        >
                          {effectiveMode === "copy" ? t`Selected` : t`Select`}
                        </div>
                      </div>
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        if (!canEnableCompression) return;
                        userTouchedModeRef.current = true;
                        setCompressionMode("av1");
                      }}
                      disabled={!canEnableCompression}
                      className={`rounded-[1.25rem] border p-4 text-left transition-all duration-200 ${
                        effectiveMode === "av1"
                          ? "border-cyan-200/70 bg-cyan-400/14 shadow-[0_0_30px_rgba(34,211,238,0.12)]"
                          : canEnableCompression
                            ? "border-slate-700/85 bg-slate-900/75 hover:border-cyan-300/35"
                            : "cursor-not-allowed border-slate-800 bg-slate-900/55 opacity-60"
                      }`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="font-[family-name:var(--font-jetbrains-mono)] text-[10px] uppercase tracking-[0.2em] text-cyan-100/85">
                              <Trans>Smallest Packs</Trans>
                            </p>
                            {analysis?.compression.encoderName && (
                              <span
                                className={`rounded-full border px-2.5 py-1 text-[10px] uppercase tracking-[0.18em] ${
                                  analysis.compression.encoderKind === "hardware"
                                    ? "border-emerald-300/55 bg-emerald-500/15 text-emerald-100"
                                    : "border-amber-300/55 bg-amber-500/15 text-amber-100"
                                }`}
                              >
                                {analysis.compression.encoderKind === "hardware"
                                  ? t`Hardware`
                                  : t`Software`}{" "}
                                {analysis.compression.encoderName}
                              </span>
                            )}
                          </div>
                          <h3 className="mt-2 text-lg font-bold text-white">
                            <Trans>Compress non-AV1 videos to AV1</Trans>
                          </h3>
                          <p className="mt-2 text-sm leading-6 text-slate-300">
                            <Trans>
                              Skip videos that are already AV1 and recompress the rest to reduce
                              sharing size.
                            </Trans>
                          </p>
                        </div>
                        <div
                          className={`mt-1 rounded-full border px-3 py-1 text-[10px] uppercase tracking-[0.2em] ${
                            effectiveMode === "av1"
                              ? "border-cyan-100/75 bg-cyan-300/20 text-cyan-50"
                              : "border-slate-600 text-slate-300"
                          }`}
                        >
                          {effectiveMode === "av1"
                            ? t`Selected`
                            : canEnableCompression
                              ? t`Select`
                              : t`Unavailable`}
                        </div>
                      </div>
                    </button>
                  </div>
                </div>
              )}

              {includeMedia && effectiveMode === "av1" && (
                <div className="rounded-[1.5rem] border border-slate-700/80 bg-black/25 p-5">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="font-[family-name:var(--font-jetbrains-mono)] text-[10px] uppercase tracking-[0.22em] text-slate-400">
                        <Trans>Compression Strength</Trans>
                      </p>
                      <p className="mt-2 text-sm text-slate-300">
                        {compressionStrength}% · {getStrengthLabel(compressionStrength)}
                      </p>
                    </div>
                    <p className="rounded-full border border-cyan-300/35 bg-cyan-400/12 px-3 py-1 font-[family-name:var(--font-jetbrains-mono)] text-[10px] uppercase tracking-[0.18em] text-cyan-100">
                      {compressionStrength}
                    </p>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={100}
                    step={1}
                    value={compressionStrength}
                    onChange={(event) => setCompressionStrength(Number(event.target.value))}
                    disabled={!canEnableCompression || analyzing || submitting}
                    className="mt-5 h-2 w-full cursor-pointer appearance-none rounded-full bg-slate-800 accent-cyan-300"
                    aria-label={t`Compression strength`}
                  />
                  <div className="mt-3 flex justify-between text-[11px] uppercase tracking-[0.16em] text-slate-500">
                    <span>
                      <Trans>Low compression</Trans>
                    </span>
                    <span>
                      <Trans>Balanced</Trans>
                    </span>
                    <span>
                      <Trans>High compression</Trans>
                    </span>
                  </div>
                </div>
              )}

              {(error || analysis?.compression.warning) && (
                <div
                  className={`rounded-2xl border px-4 py-3 text-sm leading-6 ${
                    error
                      ? "border-rose-300/35 bg-rose-500/15 text-rose-100"
                      : analysis?.compression.encoderKind === "software"
                        ? "border-amber-300/35 bg-amber-500/15 text-amber-100"
                        : "border-slate-700/70 bg-slate-900/60 text-slate-200"
                  }`}
                >
                  {error ?? analysis?.compression.warning}
                </div>
              )}
            </div>

            <div className="space-y-4">
              <div className="rounded-[1.5rem] border border-cyan-300/18 bg-cyan-500/8 p-5">
                <p className="font-[family-name:var(--font-jetbrains-mono)] text-[10px] uppercase tracking-[0.22em] text-cyan-100/85">
                  <Trans>Estimates</Trans>
                </p>
                <div className="mt-4 grid grid-cols-2 gap-3 text-sm text-slate-100">
                  <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
                    <p className="font-[family-name:var(--font-jetbrains-mono)] text-[10px] uppercase tracking-[0.2em] text-slate-400">
                      <Trans>Source Video Size</Trans>
                    </p>
                    <p className="mt-2 text-xl font-bold text-white">{sourceSizeLabel}</p>
                  </div>
                  <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
                    <p className="font-[family-name:var(--font-jetbrains-mono)] text-[10px] uppercase tracking-[0.2em] text-slate-400">
                      <Trans>Expected Final Size</Trans>
                    </p>
                    <p className="mt-2 text-xl font-bold text-white">{finalSizeLabel}</p>
                  </div>
                  <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
                    <p className="font-[family-name:var(--font-jetbrains-mono)] text-[10px] uppercase tracking-[0.2em] text-slate-400">
                      <Trans>Expected Savings</Trans>
                    </p>
                    <p className="mt-2 text-xl font-bold text-white">
                      {!includeMedia ? t`N/A` : savingsLabel}
                    </p>
                  </div>
                  <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
                    <p className="font-[family-name:var(--font-jetbrains-mono)] text-[10px] uppercase tracking-[0.2em] text-slate-400">
                      <Trans>Compression Time</Trans>
                    </p>
                    <p className="mt-2 text-xl font-bold text-white">
                      {!includeMedia ? "0 min" : timeEstimateLabel}
                    </p>
                  </div>
                </div>
                {analysis?.estimate.approximate && (
                  <p className="mt-4 text-sm leading-6 text-slate-300">
                    <Trans>
                      Some media metadata is incomplete, so these numbers are approximate.
                    </Trans>
                  </p>
                )}
              </div>

              <div className="grid gap-3 rounded-[1.5rem] border border-slate-700/80 bg-black/25 p-5 text-sm text-slate-200 sm:grid-cols-2">
                <div>
                  <p className="font-[family-name:var(--font-jetbrains-mono)] text-[10px] uppercase tracking-[0.2em] text-slate-400">
                    <Trans>Unique Videos</Trans>
                  </p>
                  <p className="mt-1 text-lg font-semibold text-white">
                    {analysis?.videoTotals.uniqueVideos ?? "..."}
                  </p>
                </div>
                <div>
                  <p className="font-[family-name:var(--font-jetbrains-mono)] text-[10px] uppercase tracking-[0.2em] text-slate-400">
                    <Trans>Already AV1</Trans>
                  </p>
                  <p className="mt-1 text-lg font-semibold text-white">
                    {analysis?.videoTotals.alreadyAv1Videos ?? "..."}
                  </p>
                </div>
                <div>
                  <p className="font-[family-name:var(--font-jetbrains-mono)] text-[10px] uppercase tracking-[0.2em] text-slate-400">
                    <Trans>Local Videos</Trans>
                  </p>
                  <p className="mt-1 text-lg font-semibold text-white">
                    {analysis?.videoTotals.localVideos ?? "..."}
                  </p>
                </div>
                <div>
                  <p className="font-[family-name:var(--font-jetbrains-mono)] text-[10px] uppercase tracking-[0.2em] text-slate-400">
                    <Trans>Remote Videos</Trans>
                  </p>
                  <p className="mt-1 text-lg font-semibold text-white">
                    {analysis?.videoTotals.remoteVideos ?? "..."}
                  </p>
                </div>
                <div className="sm:col-span-2">
                  <p className="font-[family-name:var(--font-jetbrains-mono)] text-[10px] uppercase tracking-[0.2em] text-slate-400">
                    <Trans>Parallel Jobs</Trans>
                  </p>
                  <p className="mt-1 text-lg font-semibold text-white">
                    {analysis?.settings.parallelJobs ?? "..."}
                  </p>
                </div>
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-white/10 pt-2">
            <p className="text-sm text-slate-400">
              {analyzing
                ? t`Refreshing export analysis...`
                : !includeMedia && asFpack
                  ? t`The export will skip media files and package into a single .fpack file.`
                  : !includeMedia
                    ? t`The export will skip media files and save to a folder.`
                    : effectiveMode === "av1"
                      ? t`The folder picker opens next. Export starts after you choose the destination.`
                      : t`The export will copy the current source videos as-is.`}
            </p>
            <div className="flex flex-wrap gap-3">
              <button
                type="button"
                onClick={onClose}
                disabled={submitting}
                className="rounded-xl border border-slate-700 bg-black/30 px-4 py-2 text-sm text-slate-300"
              >
                <Trans>Cancel</Trans>
              </button>
              <button
                type="button"
                onClick={() => {
                  void handleSubmit();
                }}
                disabled={
                  analyzing ||
                  submitting ||
                  !analysis ||
                  (includeMedia && effectiveMode === "av1" && !canEnableCompression)
                }
                className={`rounded-xl border px-5 py-2.5 font-[family-name:var(--font-jetbrains-mono)] text-xs uppercase tracking-[0.22em] transition-all duration-200 ${
                  analyzing ||
                  submitting ||
                  !analysis ||
                  (includeMedia && effectiveMode === "av1" && !canEnableCompression)
                    ? "cursor-not-allowed border-slate-700 bg-slate-900 text-slate-500"
                    : "border-cyan-300/60 bg-cyan-500/22 text-cyan-100 hover:border-cyan-200/85 hover:bg-cyan-500/36"
                }`}
                data-controller-focus-id="playlist-pack-export-submit"
                data-controller-initial="true"
              >
                {submitting ? t`Starting...` : t`Choose Folder and Export`}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
