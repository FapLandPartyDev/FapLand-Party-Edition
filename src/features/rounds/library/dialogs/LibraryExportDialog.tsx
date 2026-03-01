import { useEffect, useRef, useState } from "react";
import { Trans, useLingui } from "@lingui/react/macro";
import { useControllerSurface } from "@/controller";
import { db, type LibraryExportPackageAnalysis } from "@/services/db";
import type { LibraryExportDialogState } from "../types";

function ExportStat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-2xl border border-white/8 bg-white/[0.03] px-3 py-2">
      <p className="text-[9px] uppercase tracking-[0.18em] text-slate-400">{label}</p>
      <p className="mt-1 text-sm font-semibold text-white">{value}</p>
    </div>
  );
}

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
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${Math.max(1, minutes)} min`;
}

export function LibraryExportDialog({
  state,
  exporting,
  onClose,
  onChange,
  onSubmit,
  selectionCount,
  selectionIds,
}: {
  state: LibraryExportDialogState;
  exporting: boolean;
  onClose: () => void;
  onChange: (
    next:
      | LibraryExportDialogState
      | ((current: LibraryExportDialogState) => LibraryExportDialogState)
  ) => void;
  onSubmit: () => void;
  selectionCount: { rounds: number; heroes: number };
  selectionIds: { roundIds: string[]; heroIds: string[] };
}) {
  const { t } = useLingui();
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const hasResult = Boolean(state.result);
  const disableClose = exporting;
  const hasSelection = selectionCount.rounds > 0 || selectionCount.heroes > 0;
  const [analysis, setAnalysis] = useState<LibraryExportPackageAnalysis | null>(null);
  const [analyzing, setAnalyzing] = useState(!hasResult);
  const userTouchedModeRef = useRef(false);
  const selectedRoundKey = selectionIds.roundIds.join("|");
  const selectedHeroKey = selectionIds.heroIds.join("|");

  useControllerSurface({
    id: "installed-library-export-dialog",
    scopeRef: dialogRef,
    priority: 120,
    enabled: true,
    initialFocusId: "installed-library-export-submit",
  });

  useEffect(() => {
    if (hasResult) {
      setAnalyzing(false);
      return;
    }

    let cancelled = false;
    const timer = window.setTimeout(
      () => {
        setAnalyzing(true);
        db.install
          .analyzeExportPackage({
            roundIds: state.exportMode === "selected" ? selectionIds.roundIds : undefined,
            heroIds: state.exportMode === "selected" ? selectionIds.heroIds : undefined,
            includeMedia: state.includeMedia,
            compressionMode: state.includeMedia ? (state.compressionMode ?? undefined) : "copy",
            compressionStrength: state.compressionStrength,
          })
          .then((result) => {
            if (cancelled) return;
            setAnalysis(result);
            onChange((current) => ({ ...current, error: null }));
            if (!userTouchedModeRef.current && state.compressionMode === null) {
              onChange((current) => ({
                ...current,
                compressionMode: result.compression.defaultMode,
              }));
            }
          })
          .catch((error) => {
            if (cancelled) return;
            setAnalysis(null);
            onChange((current) => ({
              ...current,
              error: error instanceof Error ? error.message : t`Failed to analyze library package.`,
            }));
          })
          .finally(() => {
            if (!cancelled) setAnalyzing(false);
          });
      },
      state.compressionMode === null ? 0 : 220
    );

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    hasResult,
    selectedHeroKey,
    selectedRoundKey,
    state.compressionMode,
    state.compressionStrength,
    state.exportMode,
    state.includeMedia,
  ]);

  const effectiveMode: "copy" | "av1" = !state.includeMedia
    ? "copy"
    : (state.compressionMode ?? analysis?.compression.defaultMode ?? "copy");
  const estimate = analysis?.estimate ?? null;
  const savingsBytes = estimate?.savingsBytes ?? 0;
  const canEnableCompression = state.includeMedia && (analysis?.compression.supported ?? false);
  const getStrengthLabel = (value: number) => {
    if (value <= 20) return t`Low compression`;
    if (value <= 60) return t`Balanced`;
    return t`High compression`;
  };

  return (
    <div
      className="fixed inset-0 z-[75] overflow-y-auto bg-[radial-gradient(circle_at_top,rgba(34,211,238,0.18),transparent_35%),rgba(2,6,23,0.84)] px-4 py-6 backdrop-blur-md sm:flex sm:items-center sm:justify-center"
      role="dialog"
      aria-modal="true"
      aria-labelledby="installed-database-export-title"
    >
      <div
        ref={dialogRef}
        className="relative mx-auto w-full max-w-4xl overflow-hidden rounded-[2rem] border border-cyan-300/30 bg-slate-950/95 shadow-[0_30px_120px_rgba(8,145,178,0.3)] sm:max-h-[calc(100vh-3rem)]"
      >
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(34,211,238,0.16),transparent_30%),radial-gradient(circle_at_bottom_left,rgba(59,130,246,0.18),transparent_35%)]" />
        <div className="relative space-y-6 p-6 sm:max-h-[calc(100vh-3rem)] sm:overflow-y-auto sm:p-8">
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-3">
              <p className="font-[family-name:var(--font-jetbrains-mono)] text-[10px] uppercase tracking-[0.34em] text-cyan-200/85">
                <Trans>Library Export</Trans>
              </p>
              <div>
                <h2
                  id="installed-database-export-title"
                  className="text-3xl font-black tracking-tight text-white sm:text-4xl"
                >
                  {hasResult ? t`Export complete.` : t`Package your library.`}
                </h2>
                <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-300">
                  {hasResult
                    ? t`Your export is ready. You can close this dialog or use the path below.`
                    : t`Review scope, media handling, and AV1 compression before choosing the destination folder.`}
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              disabled={disableClose}
              className={`rounded-xl border px-4 py-2 font-[family-name:var(--font-jetbrains-mono)] text-xs uppercase tracking-[0.2em] ${
                disableClose
                  ? "cursor-not-allowed border-slate-700 bg-slate-900 text-slate-500"
                  : "border-slate-600/80 bg-black/30 text-slate-300 transition-all duration-200 hover:border-cyan-200/60 hover:text-white"
              }`}
            >
              <Trans>Close</Trans>
            </button>
          </div>

          {hasResult ? (
            <div className="grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
              <div className="rounded-[1.5rem] border border-emerald-300/25 bg-emerald-500/10 p-5">
                <div className="flex items-center gap-3">
                  <div className="flex h-11 w-11 items-center justify-center rounded-2xl border border-emerald-300/35 bg-emerald-400/15 text-2xl text-emerald-100">
                    ✓
                  </div>
                  <div>
                    <p className="font-[family-name:var(--font-jetbrains-mono)] text-[10px] uppercase tracking-[0.24em] text-emerald-100/80">
                      <Trans>Export Ready</Trans>
                    </p>
                    <p className="text-sm text-emerald-50">
                      <Trans>Media included:</Trans> {state.result?.includeMedia ? t`yes` : t`no`}
                    </p>
                  </div>
                </div>
                <div className="mt-5 rounded-2xl border border-white/10 bg-black/20 p-4">
                  <p className="font-[family-name:var(--font-jetbrains-mono)] text-[10px] uppercase tracking-[0.22em] text-slate-400">
                    <Trans>Final Artifact</Trans>
                  </p>
                  <p className="mt-2 break-all text-sm text-white">
                    {state.result?.fpackPath ?? state.result?.exportDir}
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3 rounded-[1.5rem] border border-cyan-300/18 bg-cyan-500/8 p-5 text-sm text-slate-100">
                <ExportStat label={t`Heroes`} value={state.result?.heroFiles ?? 0} />
                <ExportStat label={t`Standalone`} value={state.result?.roundFiles ?? 0} />
                <ExportStat label={t`Total Rounds`} value={state.result?.exportedRounds ?? 0} />
                <ExportStat label={t`Videos`} value={state.result?.videoFiles ?? 0} />
                {state.result?.includeMedia && (
                  <>
                    <ExportStat label={t`Funscripts`} value={state.result?.funscriptFiles ?? 0} />
                    <ExportStat label={t`Mode`} value={t`With Media`} />
                  </>
                )}
                {!state.result?.includeMedia && (
                  <ExportStat label={t`Mode`} value={t`Sidecars Only`} />
                )}
                {state.result?.fpackPath && <ExportStat label={t`Pack`} value=".fpack" />}
                {state.result?.includeMedia && (
                  <ExportStat
                    label={t`Compression`}
                    value={state.result?.compression.enabled ? "AV1" : t`Copy`}
                  />
                )}
                {state.result?.compression.enabled && (
                  <ExportStat
                    label={t`Reencoded`}
                    value={state.result?.compression.reencodedVideos ?? 0}
                  />
                )}
                {state.result?.compression.enabled && (
                  <ExportStat
                    label={t`Already AV1`}
                    value={state.result?.compression.alreadyAv1Copied ?? 0}
                  />
                )}
              </div>
            </div>
          ) : (
            <div className="grid gap-4 lg:grid-cols-[1.05fr_0.95fr]">
              <div className="space-y-4">
                <div className="rounded-[1.5rem] border border-cyan-300/18 bg-cyan-500/8 p-5">
                  <p className="font-[family-name:var(--font-jetbrains-mono)] text-[10px] uppercase tracking-[0.22em] text-cyan-100/85">
                    <Trans>Export Scope</Trans>
                  </p>
                  <div className="mt-4 flex gap-3">
                    <button
                      type="button"
                      onClick={() =>
                        onChange((current) => ({ ...current, exportMode: "all", error: null }))
                      }
                      disabled={exporting}
                      className={`flex-1 rounded-[1.25rem] border p-4 text-left transition-all duration-200 ${
                        state.exportMode === "all"
                          ? "border-cyan-300/60 bg-cyan-500/15"
                          : "border-slate-600 bg-slate-900/50 hover:border-slate-500"
                      }`}
                    >
                      <p className="font-semibold text-white">
                        <Trans>All</Trans>
                      </p>
                      <p className="mt-1 text-xs text-slate-400">
                        <Trans>Export the entire installed library.</Trans>
                      </p>
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        onChange((current) => ({
                          ...current,
                          exportMode: "selected",
                          error: null,
                        }))
                      }
                      disabled={exporting || !hasSelection}
                      className={`flex-1 rounded-[1.25rem] border p-4 text-left transition-all duration-200 ${
                        !hasSelection
                          ? "cursor-not-allowed border-slate-700 bg-slate-900/30 opacity-50"
                          : state.exportMode === "selected"
                            ? "border-violet-300/60 bg-violet-500/15"
                            : "border-slate-600 bg-slate-900/50 hover:border-slate-500"
                      }`}
                    >
                      <p className="font-semibold text-white">
                        <Trans>Selected</Trans>
                      </p>
                      <p className="mt-1 text-xs text-slate-400">
                        {hasSelection
                          ? t`${selectionCount.rounds} rounds, ${selectionCount.heroes} heroes`
                          : t`No selection`}
                      </p>
                    </button>
                  </div>
                </div>

                <div className="rounded-[1.5rem] border border-cyan-300/18 bg-cyan-500/8 p-5">
                  <p className="font-[family-name:var(--font-jetbrains-mono)] text-[10px] uppercase tracking-[0.22em] text-cyan-100/85">
                    <Trans>Package Options</Trans>
                  </p>
                  <div className="mt-4 flex flex-col gap-4">
                    <label className="flex cursor-pointer items-center gap-3">
                      <input
                        type="checkbox"
                        className="form-checkbox h-5 w-5 rounded border-slate-700 bg-black/50 text-cyan-400 focus:ring-cyan-400 focus:ring-offset-slate-950"
                        checked={state.includeMedia}
                        onChange={(event) => {
                          const next = event.target.checked;
                          onChange((current) => ({
                            ...current,
                            includeMedia: next,
                            asFpack: !next && !current.asFpack ? true : current.asFpack,
                            compressionMode: next ? current.compressionMode : "copy",
                            error: null,
                          }));
                        }}
                        disabled={exporting}
                      />
                      <div>
                        <span className="text-sm font-semibold text-white">
                          <Trans>Include Media Files</Trans>
                        </span>
                        <p className="text-xs text-slate-400">
                          <Trans>If unchecked, only sidecars and scripts are exported.</Trans>
                        </p>
                      </div>
                    </label>

                    <label className="flex cursor-pointer items-center gap-3">
                      <input
                        type="checkbox"
                        className="form-checkbox h-5 w-5 rounded border-slate-700 bg-black/50 text-cyan-400 focus:ring-cyan-400 focus:ring-offset-slate-950"
                        checked={state.asFpack}
                        onChange={(event) => {
                          onChange((current) => ({
                            ...current,
                            asFpack: event.target.checked,
                            error: null,
                          }));
                        }}
                        disabled={exporting}
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

                  {state.includeMedia && (
                    <div className="mt-4 rounded-[1.5rem] border border-cyan-300/18 bg-cyan-500/8 p-5">
                      <p className="font-[family-name:var(--font-jetbrains-mono)] text-[10px] uppercase tracking-[0.22em] text-cyan-100/85">
                        <Trans>Compression</Trans>
                      </p>
                      <div className="mt-4 grid gap-3">
                        <button
                          type="button"
                          onClick={() => {
                            userTouchedModeRef.current = true;
                            onChange((current) => ({
                              ...current,
                              compressionMode: "copy",
                              error: null,
                            }));
                          }}
                          disabled={exporting}
                          className={`rounded-[1.25rem] border p-4 text-left transition-all duration-200 ${
                            effectiveMode === "copy"
                              ? "border-emerald-300/65 bg-emerald-500/12"
                              : "border-slate-700/80 bg-black/25 hover:border-slate-500"
                          }`}
                        >
                          <p className="font-semibold text-white">
                            <Trans>Copy original media</Trans>
                          </p>
                          <p className="mt-1 text-xs text-slate-400">
                            <Trans>Fastest export. Keeps current codec and file size.</Trans>
                          </p>
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            if (!canEnableCompression) return;
                            userTouchedModeRef.current = true;
                            onChange((current) => ({
                              ...current,
                              compressionMode: "av1",
                              error: null,
                            }));
                          }}
                          disabled={exporting || !canEnableCompression}
                          className={`rounded-[1.25rem] border p-4 text-left transition-all duration-200 ${
                            !canEnableCompression
                              ? "cursor-not-allowed border-slate-700 bg-slate-900/30 opacity-55"
                              : effectiveMode === "av1"
                                ? "border-amber-300/65 bg-amber-500/12"
                                : "border-slate-700/80 bg-black/25 hover:border-slate-500"
                          }`}
                        >
                          <p className="font-semibold text-white">
                            <Trans>Convert to AV1</Trans>
                          </p>
                          <p className="mt-1 text-xs text-slate-400">
                            <Trans>
                              Smaller packages. Takes longer because videos may be reencoded.
                            </Trans>
                          </p>
                        </button>
                      </div>

                      {effectiveMode === "av1" && (
                        <div className="mt-4 rounded-[1.25rem] border border-amber-300/18 bg-black/20 p-4">
                          <div className="flex items-center justify-between gap-3">
                            <div>
                              <p className="font-[family-name:var(--font-jetbrains-mono)] text-[10px] uppercase tracking-[0.2em] text-amber-100/90">
                                <Trans>Compression Strength</Trans>
                              </p>
                              <p className="mt-1 text-sm text-white">
                                {state.compressionStrength}% · {getStrengthLabel(state.compressionStrength)}
                              </p>
                            </div>
                            <p className="text-xs text-slate-400">
                              {analysis?.compression.encoderName ?? t`Encoder pending`}
                            </p>
                          </div>
                          <input
                            type="range"
                            min={0}
                            max={100}
                            step={1}
                            value={state.compressionStrength}
                            disabled={exporting}
                            onChange={(event) => {
                              userTouchedModeRef.current = true;
                              onChange((current) => ({
                                ...current,
                                compressionStrength: Number(event.target.value),
                                error: null,
                              }));
                            }}
                            className="mt-4 h-2 w-full cursor-pointer appearance-none rounded-full bg-slate-800 accent-amber-300"
                          />
                          <div className="mt-4 grid grid-cols-2 gap-3 text-sm text-slate-100 sm:grid-cols-4">
                            <ExportStat
                              label={t`Source Size`}
                              value={formatByteSize(estimate?.sourceVideoBytes ?? 0)}
                            />
                            <ExportStat
                              label={t`Expected Size`}
                              value={formatByteSize(estimate?.expectedVideoBytes ?? 0)}
                            />
                            <ExportStat label={t`Savings`} value={formatByteSize(savingsBytes)} />
                            <ExportStat
                              label={t`Est. Time`}
                              value={formatDurationEstimate(
                                estimate?.estimatedCompressionSeconds ?? 0
                              )}
                            />
                          </div>
                        </div>
                      )}

                      {analysis?.compression.warning && (
                        <p className="mt-4 rounded-2xl border border-amber-300/25 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">
                          {analysis.compression.warning}
                        </p>
                      )}
                    </div>
                  )}
                </div>
              </div>
              <div className="rounded-[1.5rem] border border-slate-700/80 bg-black/25 p-5">
                <p className="font-[family-name:var(--font-jetbrains-mono)] text-[10px] uppercase tracking-[0.22em] text-slate-400">
                  <Trans>What happens</Trans>
                </p>
                <div className="mt-4 space-y-3 text-sm text-slate-200">
                  <div className="rounded-2xl border border-white/8 bg-white/[0.03] p-4">
                    <p className="font-semibold text-white">
                      <Trans>1. Scope</Trans>
                    </p>
                    <p className="mt-1 leading-6 text-slate-300">
                      {state.exportMode === "all"
                        ? t`The full installed library will be packaged.`
                        : hasSelection
                          ? t`${selectionCount.rounds} rounds and ${selectionCount.heroes} heroes will be packaged.`
                          : t`Select items in the library to enable partial export.`}
                    </p>
                  </div>
                  <div className="rounded-2xl border border-white/8 bg-white/[0.03] p-4">
                    <p className="font-semibold text-white">
                      <Trans>2. Media</Trans>
                    </p>
                    <p className="mt-1 leading-6 text-slate-300">
                      {state.includeMedia
                        ? effectiveMode === "av1"
                          ? t`Videos will be packaged and reencoded to AV1 when needed. Funscripts remain attached.`
                          : t`Videos and funscripts will be copied into the export package without reencoding.`
                        : t`Only sidecars and script files will be written. Video URIs stay as references.`}
                    </p>
                  </div>
                  <div className="rounded-2xl border border-white/8 bg-white/[0.03] p-4">
                    <p className="font-semibold text-white">
                      <Trans>3. Estimate</Trans>
                    </p>
                    <p className="mt-1 leading-6 text-slate-300">
                      {analyzing
                        ? t`Analyzing package size and compression time...`
                        : state.includeMedia
                          ? t`Expected media size: ${formatByteSize(estimate?.expectedVideoBytes ?? 0)}${effectiveMode === "av1" ? `, estimated encode time: ${formatDurationEstimate(estimate?.estimatedCompressionSeconds ?? 0)}.` : "."}`
                          : t`No video packaging step is required.`}
                    </p>
                  </div>
                  <div className="rounded-2xl border border-white/8 bg-white/[0.03] p-4">
                    <p className="font-semibold text-white">
                      <Trans>4. Export</Trans>
                    </p>
                    <p className="mt-1 leading-6 text-slate-300">
                      <Trans>
                        You will choose a destination folder, then a timestamped export package will
                        be generated inside it.
                      </Trans>
                    </p>
                  </div>
                </div>
              </div>
            </div>
          )}

          {state.error && (
            <p className="rounded-2xl border border-rose-300/35 bg-rose-500/15 px-4 py-3 text-sm text-rose-100">
              {state.error}
            </p>
          )}

          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-white/10 pt-2">
            <p className="text-sm text-slate-400">
              {hasResult
                ? t`You can close this dialog now.`
                : analyzing
                  ? t`Analyzing export package...`
                  : state.exportMode === "selected" && !hasSelection
                    ? t`Select items in the library first.`
                    : t`Click export to choose a destination and generate the package.`}
            </p>
            <div className="flex flex-wrap gap-3">
              {!hasResult && (
                <button
                  type="button"
                  onClick={onSubmit}
                  disabled={
                    exporting || analyzing || (state.exportMode === "selected" && !hasSelection)
                  }
                  className={`rounded-xl border px-5 py-2.5 font-[family-name:var(--font-jetbrains-mono)] text-xs uppercase tracking-[0.22em] transition-all duration-200 ${
                    exporting || analyzing || (state.exportMode === "selected" && !hasSelection)
                      ? "cursor-not-allowed border-slate-700 bg-slate-900 text-slate-500"
                      : "border-cyan-300/60 bg-cyan-500/22 text-cyan-100 hover:border-cyan-200/85 hover:bg-cyan-500/36"
                  }`}
                  data-controller-focus-id="installed-library-export-submit"
                  data-controller-initial="true"
                >
                  {exporting
                    ? t`Exporting...`
                    : analyzing
                      ? t`Analyzing...`
                      : t`Start Export`}
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
