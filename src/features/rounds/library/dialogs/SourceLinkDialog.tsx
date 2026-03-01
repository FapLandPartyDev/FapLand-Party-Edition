import { Plural, Trans, useLingui } from "@lingui/react/macro";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useControllerSurface } from "@/controller";
import {
  acquisition,
  type AcquisitionVideoFileChoice,
  type LibraryLinkAnalysis,
  type LibraryLinkAnalysisStatus,
  type LibraryLinkTarget,
} from "@/services/acquisition";

type Filter = "all" | "ready" | "review" | "linked" | "unmatched";
type SourceKind = "torrent" | "mega" | "pixeldrain";
type SelectedChoice = AcquisitionVideoFileChoice & { score: number | null };

function targetKey(target: Pick<LibraryLinkTarget, "targetKind" | "targetId">): string {
  return `${target.targetKind}:${target.targetId}`;
}

function formatBytes(value: number | null): string {
  if (!value || value <= 0) return "—";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let size = value;
  let unit = 0;
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024;
    unit += 1;
  }
  return `${size.toFixed(size >= 10 || unit === 0 ? 0 : 1)} ${units[unit]}`;
}

// Source paths are long and only the trailing filename carries matching signal, so the folder
// prefix is rendered as muted context instead of competing with the name.
function splitSourcePath(path: string): { folder: string; file: string } {
  const index = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  if (index < 0) return { folder: "", file: path };
  return { folder: path.slice(0, index + 1), file: path.slice(index + 1) };
}

function statusFor(target: LibraryLinkTarget): Exclude<Filter, "all"> {
  if (target.existing.length > 0) return "linked";
  if (target.autoSelected) return "ready";
  if (target.suggestions.length > 0) return "review";
  return "unmatched";
}

function SourceKindChip({ kind }: { kind: SourceKind }) {
  const presentation =
    kind === "torrent"
      ? {
          className: "bg-violet-500/15 text-violet-100 ring-1 ring-violet-300/25",
          icon: "⇅",
          label: "Torrent",
        }
      : kind === "mega"
        ? {
            className: "bg-orange-500/15 text-orange-100 ring-1 ring-orange-300/25",
            icon: "☁",
            label: "MEGA",
          }
        : {
            className: "bg-cyan-500/15 text-cyan-100 ring-1 ring-cyan-300/25",
            icon: "▦",
            label: "PixelDrain",
          };
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 font-[family-name:var(--font-jetbrains-mono)] text-[9px] font-bold uppercase tracking-wider ${presentation.className}`}
    >
      <span aria-hidden="true">{presentation.icon}</span>
      {presentation.label}
    </span>
  );
}

function ConfidenceMeter({ score, collision }: { score: number; collision: boolean }) {
  const percent = Math.round(score * 100);
  const tone = collision
    ? "from-amber-400 to-amber-300"
    : percent >= 90
      ? "from-emerald-500 to-emerald-300"
      : percent >= 70
        ? "from-cyan-500 to-cyan-300"
        : "from-amber-500 to-amber-300";
  return (
    <span className="flex items-center gap-2">
      <span className="h-1 w-14 overflow-hidden rounded-full bg-white/10">
        <span
          className={`block h-full rounded-full bg-gradient-to-r ${tone}`}
          style={{ width: `${Math.max(4, percent)}%` }}
        />
      </span>
      <span className="font-[family-name:var(--font-jetbrains-mono)] text-[11px] tabular-nums text-slate-300">
        {percent}%
      </span>
    </span>
  );
}

function SourcePath({ path, muted = false }: { path: string; muted?: boolean }) {
  const { folder, file } = splitSourcePath(path);
  return (
    <p
      className="break-all font-[family-name:var(--font-jetbrains-mono)] text-xs leading-relaxed"
      title={path}
    >
      {folder && <span className="text-slate-600">{folder}</span>}
      <span className={muted ? "text-slate-400" : "text-slate-200"}>{file}</span>
    </p>
  );
}

export function SourceLinkDialog({
  selection,
  onClose,
  onApplied,
  onOpenSettings,
}: {
  selection: { roundIds?: string[]; heroIds?: string[] };
  onClose: () => void;
  onApplied: (result: { changedTargets: number; linkedRounds: number }) => void;
  onOpenSettings: () => void;
}) {
  const { t } = useLingui();
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const selectionRef = useRef(selection);
  const pickerInputRef = useRef<HTMLInputElement | null>(null);
  const [analysis, setAnalysis] = useState<LibraryLinkAnalysis | null>(null);
  const [analysisStatus, setAnalysisStatus] = useState<LibraryLinkAnalysisStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [choices, setChoices] = useState<Record<string, SelectedChoice>>({});
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [pickerTarget, setPickerTarget] = useState<LibraryLinkTarget | null>(null);
  const [pickerQuery, setPickerQuery] = useState("");
  const [pickerKinds, setPickerKinds] = useState<SourceKind[]>([]);
  const [pickerResults, setPickerResults] = useState<AcquisitionVideoFileChoice[]>([]);
  const [pickerNextCursor, setPickerNextCursor] = useState<string | null>(null);
  const [pickerLoading, setPickerLoading] = useState(false);

  useControllerSurface({
    id: "installed-library-source-link-dialog",
    scopeRef: dialogRef,
    priority: 125,
    enabled: true,
    initialFocusId: "source-link-dialog-close",
  });

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await acquisition.analyzeLibraryLinks(selectionRef.current);
      setAnalysis(result);
      const autoChoices: Record<string, SelectedChoice> = {};
      for (const target of result.targets) {
        const suggestion = target.autoSelected ? target.suggestions[0] : undefined;
        if (suggestion) autoChoices[targetKey(target)] = { ...suggestion, score: suggestion.score };
      }
      setChoices(autoChoices);
      // Confident and already-linked targets stay collapsed so the scroll list only opens up where
      // a decision is actually needed.
      setExpanded(
        new Set(
          result.targets
            .filter((target) => statusFor(target) === "review")
            .map((target) => targetKey(target))
        )
      );
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : t`Failed to analyze source links.`);
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  useEffect(() => {
    if (!loading) return;
    let cancelled = false;
    let timer: number | undefined;
    const poll = async () => {
      try {
        const status = await acquisition.getLibraryLinkAnalysisStatus();
        if (!cancelled) setAnalysisStatus(status);
      } catch {
        // The analysis request reports actionable failures. Progress polling is best-effort.
      } finally {
        if (!cancelled) timer = window.setTimeout(() => void poll(), 200);
      }
    };
    timer = window.setTimeout(() => void poll(), 100);
    return () => {
      cancelled = true;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [loading]);

  // Escape unwinds one layer at a time: the file picker first, then the dialog itself.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (pickerTarget) {
        event.stopPropagation();
        setPickerTarget(null);
        return;
      }
      if (applying) return;
      event.stopPropagation();
      onClose();
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [applying, onClose, pickerTarget]);

  useEffect(() => {
    if (!pickerTarget) return;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      setPickerLoading(true);
      acquisition
        .searchVideoFiles({
          query: pickerQuery,
          limit: 40,
          ...(pickerKinds.length > 0 ? { sourceKinds: pickerKinds } : {}),
        })
        .then((result) => {
          if (!cancelled) {
            setPickerResults(result.items);
            setPickerNextCursor(result.nextCursor);
          }
        })
        .catch((searchError) => {
          if (!cancelled) {
            setError(searchError instanceof Error ? searchError.message : t`Source search failed.`);
          }
        })
        .finally(() => {
          if (!cancelled) setPickerLoading(false);
        });
    }, 180);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [pickerKinds, pickerQuery, pickerTarget, t]);

  const openPicker = (target: LibraryLinkTarget) => {
    setPickerTarget(target);
    // Seeding the query with the target name means the picker usually opens on the right file
    // instead of the alphabetical head of the whole catalog.
    setPickerQuery(target.name);
    setPickerKinds([]);
    setPickerResults([]);
    setPickerNextCursor(null);
    window.setTimeout(() => {
      pickerInputRef.current?.focus();
      pickerInputRef.current?.select();
    }, 0);
  };

  const visibleTargets = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase();
    return (analysis?.targets ?? []).filter((target) => {
      if (filter !== "all" && statusFor(target) !== filter) return false;
      if (!normalizedQuery) return true;
      return [
        target.name,
        target.author,
        ...target.existing.flatMap((entry) => [entry.sourceName, entry.sourcePath]),
        ...target.suggestions.flatMap((entry) => [entry.sourceName, entry.sourcePath]),
      ]
        .filter(Boolean)
        .some((value) => value!.toLocaleLowerCase().includes(normalizedQuery));
    });
  }, [analysis, filter, query]);

  const changes = useMemo(() => {
    if (!analysis) return [];
    return analysis.targets.flatMap((target) => {
      const choice = choices[targetKey(target)];
      if (!choice) return [];
      const alreadyLinked = target.existing.some(
        (entry) => entry.sourceId === choice.sourceId && entry.sourcePath === choice.sourcePath
      );
      if (alreadyLinked) return [];
      return [
        {
          targetKind: target.targetKind,
          targetId: target.targetId,
          sourceId: choice.sourceId,
          sourcePath: choice.sourcePath,
          analyzedScore: choice.score,
          replaceExisting: target.existing.length > 0,
        },
      ];
    });
  }, [analysis, choices]);

  const changeCount = changes.length;
  const replacementCount = changes.filter((change) => change.replaceExisting).length;
  const newLinkCount = changeCount - replacementCount;

  const apply = async () => {
    if (!analysis || applying || changes.length === 0) return;
    setApplying(true);
    setError(null);
    try {
      const result = await acquisition.applyLibraryLinks(changes);
      onApplied(result);
    } catch (applyError) {
      setError(applyError instanceof Error ? applyError.message : t`Failed to apply source links.`);
      setApplying(false);
    }
  };

  const acceptBestMatchesInView = () => {
    const acceptable = visibleTargets.filter((target) => target.suggestions.length > 0);
    if (acceptable.length === 0) return;
    setChoices((current) => {
      const next = { ...current };
      for (const target of acceptable) {
        const suggestion = target.suggestions[0]!;
        next[targetKey(target)] = { ...suggestion, score: suggestion.score };
      }
      return next;
    });
  };

  const resetToConfidentMatches = () => {
    if (!analysis) return;
    const next: Record<string, SelectedChoice> = {};
    for (const target of analysis.targets) {
      const suggestion = target.autoSelected ? target.suggestions[0] : undefined;
      if (suggestion) next[targetKey(target)] = { ...suggestion, score: suggestion.score };
    }
    setChoices(next);
  };

  const acceptableInView = visibleTargets.filter((target) => target.suggestions.length > 0).length;

  const filters: Array<{ id: Filter; label: string; count: number; hint: string }> = [
    {
      id: "all",
      label: t`All`,
      count: analysis?.targets.length ?? 0,
      hint: t`Every hero and standalone round in scope`,
    },
    {
      id: "ready",
      label: t`Ready`,
      count: analysis?.scope.ready ?? 0,
      hint: t`One confident match, preselected for you`,
    },
    {
      id: "review",
      label: t`Needs review`,
      count: analysis?.scope.needsReview ?? 0,
      hint: t`Several candidates — pick the right one`,
    },
    {
      id: "linked",
      label: t`Linked`,
      count: analysis?.scope.linked ?? 0,
      hint: t`Already mapped to a source file`,
    },
    {
      id: "unmatched",
      label: t`Unmatched`,
      count: analysis?.scope.unmatched ?? 0,
      hint: t`No candidate found — choose a file manually`,
    },
  ];

  const progressPercent =
    analysisStatus && analysisStatus.total > 0
      ? Math.min(100, Math.round((analysisStatus.completed / analysisStatus.total) * 100))
      : null;
  const progressLabel =
    analysisStatus?.phase === "cataloging"
      ? t`Refreshing source catalogs`
      : analysisStatus?.phase === "indexing"
        ? t`Preparing source filenames`
        : analysisStatus?.phase === "matching"
          ? t`Comparing filenames`
          : analysisStatus?.phase === "finalizing"
            ? t`Resolving ambiguous matches`
            : t`Preparing source analysis`;

  return (
    <div
      className="fixed inset-0 z-[80] overflow-y-auto bg-slate-950/85 p-4 backdrop-blur-md sm:p-6"
      role="dialog"
      aria-modal="true"
      aria-labelledby="source-link-dialog-title"
    >
      <div
        ref={dialogRef}
        className="mx-auto flex h-[calc(100vh-3rem)] w-full max-w-6xl flex-col overflow-hidden rounded-[2rem] border border-cyan-300/25 bg-slate-950 shadow-[0_30px_120px_rgba(8,145,178,0.28)]"
      >
        <header className="flex flex-wrap items-start gap-4 border-b border-white/10 p-5 sm:p-7">
          <div className="min-w-0 flex-1">
            <p className="font-[family-name:var(--font-jetbrains-mono)] text-[10px] uppercase tracking-[0.3em] text-cyan-200">
              <Trans>Download Sources</Trans>
            </p>
            <h2
              id="source-link-dialog-title"
              className="mt-2 text-2xl font-black text-white sm:text-3xl"
            >
              <Trans>Link heroes and rounds</Trans>
            </h2>
            <p className="mt-2 max-w-3xl text-sm text-slate-400">
              <Trans>
                Review filename matches inside your torrent and MEGA catalogs. Matching uses only
                the name after the final slash and ignores generic labels such as FapHero and FH.
                This only saves links; it does not download anything.
              </Trans>
            </p>
          </div>
          <button
            id="source-link-dialog-close"
            type="button"
            disabled={applying}
            onClick={onClose}
            className="round-library-toolbar-button"
          >
            <Trans>Close</Trans>
            <span className="ml-1 rounded border border-white/15 px-1 text-[9px] text-slate-500">
              Esc
            </span>
          </button>
        </header>

        {loading ? (
          <div className="flex flex-1 items-center justify-center p-6 sm:p-12">
            <div className="w-full max-w-2xl rounded-3xl border border-cyan-300/20 bg-cyan-500/[0.06] p-6 shadow-[0_20px_80px_rgba(8,145,178,0.12)] sm:p-8">
              <div className="flex items-center gap-4">
                <div className="h-9 w-9 shrink-0 animate-spin rounded-full border-2 border-cyan-300/25 border-t-cyan-300" />
                <div className="min-w-0">
                  <p className="font-semibold text-cyan-50">{progressLabel}</p>
                  <p className="mt-1 text-sm text-slate-400">
                    <Trans>The app remains usable while source files are analyzed.</Trans>
                  </p>
                </div>
                {progressPercent !== null && (
                  <span className="ml-auto font-[family-name:var(--font-jetbrains-mono)] text-sm font-bold text-cyan-200">
                    {progressPercent}%
                  </span>
                )}
              </div>
              <div
                role="progressbar"
                aria-label={progressLabel}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={progressPercent ?? undefined}
                className="mt-6 h-3 overflow-hidden rounded-full border border-white/10 bg-slate-900"
              >
                <div
                  className={`h-full rounded-full bg-gradient-to-r from-cyan-500 via-cyan-300 to-fuchsia-400 shadow-[0_0_18px_rgba(34,211,238,0.55)] transition-[width] duration-200 ${progressPercent === null ? "animate-pulse" : ""}`}
                  style={{ width: progressPercent === null ? "38%" : `${progressPercent}%` }}
                />
              </div>
              <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
                <span>{analysisStatus?.message ?? t`Starting analysis…`}</span>
                {analysisStatus && analysisStatus.total > 0 && (
                  <span className="font-[family-name:var(--font-jetbrains-mono)] tabular-nums text-slate-400">
                    {analysisStatus.completed.toLocaleString()} /{" "}
                    {analysisStatus.total.toLocaleString()}
                  </span>
                )}
              </div>
            </div>
          </div>
        ) : (
          <>
            <div className="space-y-4 border-b border-white/10 p-5 sm:p-7">
              {error && (
                <div className="rounded-xl border border-rose-300/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <span>{error}</span>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => setError(null)}
                        className="round-library-toolbar-button"
                      >
                        <Trans>Dismiss</Trans>
                      </button>
                      {!analysis && (
                        <button
                          type="button"
                          onClick={() => void load()}
                          className="round-library-toolbar-button"
                        >
                          <Trans>Retry analysis</Trans>
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              )}
              {analysis && (
                <>
                  <p className="text-xs text-slate-500">
                    <Trans>
                      Analyzed {analysis.scope.heroes} heroes and {analysis.scope.standaloneRounds}{" "}
                      standalone rounds across {analysis.sources.enabled} enabled sources.
                    </Trans>
                  </p>
                  {/* The status counters double as the filter control so there is one place to read
                      the breakdown and one place to act on it. */}
                  <div
                    role="group"
                    aria-label={t`Filter by link status`}
                    className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5"
                  >
                    {filters.map((entry) => {
                      const isActive = filter === entry.id;
                      const isEmpty = entry.count === 0 && entry.id !== "all";
                      return (
                        <button
                          key={entry.id}
                          type="button"
                          aria-pressed={isActive}
                          disabled={isEmpty}
                          title={entry.hint}
                          onClick={() => setFilter(isActive ? "all" : entry.id)}
                          className={`rounded-xl border p-3 text-left transition ${
                            isActive
                              ? "border-cyan-300/50 bg-cyan-500/10"
                              : isEmpty
                                ? "cursor-not-allowed border-white/8 bg-white/[0.02] opacity-40"
                                : "border-white/8 bg-white/[0.03] hover:border-cyan-300/30 hover:bg-white/[0.05]"
                          }`}
                        >
                          <p
                            className={`text-[10px] uppercase tracking-wider ${isActive ? "text-cyan-200" : "text-slate-500"}`}
                          >
                            {entry.label}
                          </p>
                          <p className="mt-1 text-xl font-bold tabular-nums text-white">
                            {entry.count}
                          </p>
                        </button>
                      );
                    })}
                  </div>
                </>
              )}
              {analysis?.sources.enabled === 0 && (
                <div className="rounded-2xl border border-amber-300/25 bg-amber-500/10 p-4 text-sm text-amber-50">
                  <p>
                    <Trans>No enabled torrent or MEGA sources are configured.</Trans>
                  </p>
                  <button
                    type="button"
                    onClick={onOpenSettings}
                    className="mt-3 round-library-toolbar-button"
                  >
                    <Trans>Open Sources &amp; Library Settings</Trans>
                  </button>
                </div>
              )}
              {(analysis?.sources.refreshErrors.length ?? 0) > 0 && (
                <div className="rounded-2xl border border-amber-300/20 bg-amber-500/8 p-4 text-xs text-amber-100">
                  <p className="font-semibold">
                    <Trans>Some catalogs could not be refreshed.</Trans>
                  </p>
                  {analysis!.sources.refreshErrors.map((entry) => (
                    <p key={entry.sourceId} className="mt-1">
                      {entry.sourceName}: {entry.message}
                    </p>
                  ))}
                  <button
                    type="button"
                    onClick={() => void load()}
                    className="mt-3 round-library-toolbar-button"
                  >
                    <Trans>Retry analysis</Trans>
                  </button>
                </div>
              )}
              <div className="flex flex-wrap items-center gap-2">
                <div className="relative min-w-[16rem] flex-1">
                  <input
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    aria-label={t`Search heroes, rounds, or source paths`}
                    placeholder={t`Search heroes, rounds, or source paths…`}
                    className="w-full rounded-xl border border-white/10 bg-white/[0.04] py-2 pl-4 pr-9 text-sm text-white outline-none focus:border-cyan-300/50"
                  />
                  {query && (
                    <button
                      type="button"
                      aria-label={t`Clear search`}
                      onClick={() => setQuery("")}
                      className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md px-2 py-0.5 text-slate-500 hover:text-white"
                    >
                      ×
                    </button>
                  )}
                </div>
                <button
                  type="button"
                  disabled={acceptableInView === 0}
                  onClick={acceptBestMatchesInView}
                  className="round-library-toolbar-button"
                >
                  <Trans>Accept best matches</Trans>{" "}
                  <span className="opacity-60">{acceptableInView}</span>
                </button>
                <button
                  type="button"
                  onClick={resetToConfidentMatches}
                  className="round-library-toolbar-button"
                >
                  <Trans>Reset to confident matches</Trans>
                </button>
                <button
                  type="button"
                  disabled={changeCount === 0}
                  onClick={() => setChoices({})}
                  className="round-library-toolbar-button"
                >
                  <Trans>Clear selections</Trans>
                </button>
              </div>
            </div>

            <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-5 sm:p-7">
              {visibleTargets.length === 0 && (
                <div className="rounded-2xl border border-dashed border-white/15 p-10 text-center text-sm text-slate-400">
                  <p>
                    <Trans>No source-link targets match this view.</Trans>
                  </p>
                  {(query || filter !== "all") && (
                    <button
                      type="button"
                      onClick={() => {
                        setQuery("");
                        setFilter("all");
                      }}
                      className="mt-4 round-library-toolbar-button"
                    >
                      <Trans>Show everything</Trans>
                    </button>
                  )}
                </div>
              )}
              {visibleTargets.map((target) => {
                const key = targetKey(target);
                const selected = choices[key];
                const isExpanded = expanded.has(key);
                const currentStatus = statusFor(target);
                const currentStatusLabel =
                  currentStatus === "ready"
                    ? t`Ready`
                    : currentStatus === "linked"
                      ? t`Linked`
                      : currentStatus === "review"
                        ? t`Needs review`
                        : t`Unmatched`;
                const isChanged = changes.some(
                  (change) =>
                    change.targetKind === target.targetKind && change.targetId === target.targetId
                );
                return (
                  <article
                    key={key}
                    className={`rounded-2xl border p-4 transition ${
                      isChanged
                        ? "border-cyan-300/35 bg-cyan-500/[0.05]"
                        : "border-white/10 bg-white/[0.025]"
                    }`}
                  >
                    <div className="flex flex-wrap items-start gap-4">
                      <div className="min-w-[13rem] flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="rounded-md bg-cyan-500/15 px-2 py-1 text-[9px] font-bold uppercase tracking-wider text-cyan-100">
                            {target.targetKind === "hero" ? t`Hero` : t`Round`}
                          </span>
                          <span
                            className={`rounded-md px-2 py-1 text-[9px] font-bold uppercase tracking-wider ${currentStatus === "ready" ? "bg-emerald-500/15 text-emerald-100" : currentStatus === "linked" ? "bg-blue-500/15 text-blue-100" : currentStatus === "review" ? "bg-amber-500/15 text-amber-100" : "bg-slate-500/15 text-slate-300"}`}
                          >
                            {currentStatusLabel}
                          </span>
                          {isChanged && (
                            <span className="rounded-md bg-cyan-400/20 px-2 py-1 text-[9px] font-bold uppercase tracking-wider text-cyan-100">
                              {target.existing.length > 0 ? t`Will replace` : t`Will link`}
                            </span>
                          )}
                        </div>
                        <h3 className="mt-2 font-bold text-white">{target.name}</h3>
                        <p className="text-xs text-slate-500">
                          {target.author ?? t`Unknown author`} · {target.roundIds.length}{" "}
                          {target.roundIds.length === 1 ? t`round` : t`rounds`}
                        </p>
                        {target.mixedExistingLinks && (
                          <p className="mt-1 text-xs text-amber-200">
                            <Trans>
                              Multiple existing links are preserved until you choose a replacement.
                            </Trans>
                          </p>
                        )}
                      </div>
                      <div className="min-w-0 flex-[2]">
                        {selected ? (
                          <div className="rounded-xl border border-cyan-300/25 bg-cyan-500/8 p-3">
                            <div className="flex flex-wrap items-center gap-2">
                              <SourceKindChip kind={selected.sourceKind} />
                              <span className="min-w-0 truncate text-sm font-semibold text-cyan-50">
                                {selected.sourceName}
                              </span>
                              <span className="ml-auto">
                                {selected.score === null ? (
                                  <span className="text-xs text-cyan-100/70">{t`Chosen manually`}</span>
                                ) : (
                                  <ConfidenceMeter score={selected.score} collision={false} />
                                )}
                              </span>
                            </div>
                            <div className="mt-2">
                              <SourcePath path={selected.sourcePath} />
                            </div>
                            <p className="mt-1 text-xs text-slate-500">
                              {formatBytes(selected.sizeBytes)}
                            </p>
                          </div>
                        ) : target.existing.length > 0 ? (
                          <div className="rounded-xl border border-blue-300/20 bg-blue-500/8 p-3">
                            <p className="text-xs font-semibold text-blue-100">
                              <Trans>Keeping existing mapping</Trans>
                            </p>
                            <div className="mt-2 space-y-1">
                              {target.existing.map((entry) => (
                                <div
                                  key={`${entry.sourceId}:${entry.sourcePath}`}
                                  className="flex flex-wrap items-baseline gap-2"
                                >
                                  <SourceKindChip kind={entry.sourceKind} />
                                  <span className="text-xs text-slate-400">{entry.sourceName}</span>
                                  <span className="w-full">
                                    <SourcePath path={entry.sourcePath} muted />
                                  </span>
                                </div>
                              ))}
                            </div>
                          </div>
                        ) : (
                          <div className="rounded-xl border border-dashed border-white/10 p-3 text-xs text-slate-500">
                            {target.suggestions.length > 0
                              ? t`No source selected — review the candidates below.`
                              : t`No candidate found in your catalogs. Choose a file manually.`}
                          </div>
                        )}
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {target.suggestions.length > 0 && (
                          <button
                            type="button"
                            aria-expanded={isExpanded}
                            onClick={() =>
                              setExpanded((current) => {
                                const next = new Set(current);
                                if (next.has(key)) next.delete(key);
                                else next.add(key);
                                return next;
                              })
                            }
                            className="round-library-toolbar-button"
                          >
                            {isExpanded ? (
                              <Trans>Hide matches</Trans>
                            ) : (
                              <>
                                <Trans>Review matches</Trans>{" "}
                                <span className="opacity-60">{target.suggestions.length}</span>
                              </>
                            )}
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => openPicker(target)}
                          className="round-library-toolbar-button"
                        >
                          <Trans>Choose file</Trans>
                        </button>
                        {selected && (
                          <button
                            type="button"
                            onClick={() =>
                              setChoices((current) => {
                                const next = { ...current };
                                delete next[key];
                                return next;
                              })
                            }
                            className="round-library-toolbar-button"
                          >
                            {target.existing.length > 0 ? t`Keep current` : t`Skip`}
                          </button>
                        )}
                      </div>
                    </div>
                    {isExpanded && (
                      <div className="mt-3 grid gap-2 border-t border-white/8 pt-3 lg:grid-cols-2">
                        {target.suggestions.map((suggestion, suggestionIndex) => {
                          const isSelected =
                            selected?.sourceId === suggestion.sourceId &&
                            selected.sourcePath === suggestion.sourcePath;
                          return (
                            <button
                              key={`${suggestion.sourceId}:${suggestion.sourcePath}`}
                              type="button"
                              aria-pressed={isSelected}
                              onClick={() =>
                                setChoices((current) => ({
                                  ...current,
                                  [key]: { ...suggestion, score: suggestion.score },
                                }))
                              }
                              className={`rounded-xl border p-3 text-left transition ${isSelected ? "border-cyan-300/60 bg-cyan-500/12 shadow-[0_0_0_1px_rgba(103,232,249,0.12)]" : "border-white/10 bg-black/20 hover:border-cyan-300/35"}`}
                            >
                              <div className="flex flex-wrap items-center gap-2">
                                {isSelected && (
                                  <span
                                    aria-hidden="true"
                                    className="text-xs font-bold text-cyan-300"
                                  >
                                    ✓
                                  </span>
                                )}
                                <SourceKindChip kind={suggestion.sourceKind} />
                                <span className="min-w-0 truncate text-xs font-semibold text-white">
                                  {suggestionIndex === 0 ? `${t`Best match`} · ` : ""}
                                  {suggestion.sourceName}
                                </span>
                                <span className="ml-auto shrink-0">
                                  <ConfidenceMeter
                                    score={suggestion.score}
                                    collision={suggestion.collision}
                                  />
                                </span>
                              </div>
                              <div className="mt-2">
                                <SourcePath path={suggestion.sourcePath} muted />
                              </div>
                              <p className="mt-1 flex flex-wrap gap-2 text-[11px] text-slate-500">
                                <span>{formatBytes(suggestion.sizeBytes)}</span>
                                {suggestion.collision && (
                                  <span className="text-amber-300">
                                    <Trans>Same name in several sources</Trans>
                                  </span>
                                )}
                                {isSelected && <span className="text-cyan-300">{t`Selected`}</span>}
                              </p>
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </article>
                );
              })}
            </div>

            <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-white/10 p-5 sm:px-7">
              <div className="text-sm text-slate-400">
                {changeCount === 0 ? (
                  <p>{t`No link changes selected.`}</p>
                ) : (
                  <p>
                    <span className="font-semibold text-white">
                      {t`${changeCount} link changes selected.`}
                    </span>{" "}
                    <span className="text-xs text-slate-500">
                      <Plural value={newLinkCount} one="# new link" other="# new links" /> ·{" "}
                      <Plural
                        value={replacementCount}
                        one="# replacing an existing link"
                        other="# replacing existing links"
                      />
                    </span>
                  </p>
                )}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  disabled={applying}
                  onClick={onClose}
                  className="round-library-toolbar-button"
                >
                  <Trans>Cancel</Trans>
                </button>
                <button
                  type="button"
                  disabled={applying || changeCount === 0}
                  onClick={() => void apply()}
                  className="round-library-primary-action disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {applying ? t`Applying…` : t`Apply ${changeCount} links`}
                </button>
              </div>
            </footer>
          </>
        )}
      </div>

      {pickerTarget && (
        <div
          className="fixed inset-0 z-[90] flex items-center justify-center bg-black/65 p-4"
          role="dialog"
          aria-modal="true"
          aria-label={t`Choose a source file`}
        >
          <div className="flex max-h-[85vh] w-full max-w-2xl flex-col rounded-2xl border border-cyan-300/25 bg-slate-950 p-5 shadow-2xl">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h3 className="text-xl font-bold text-white">
                  <Trans>Choose a source file</Trans>
                </h3>
                <p className="mt-1 truncate text-xs text-slate-500">
                  {t`Linking ${pickerTarget.name}`}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setPickerTarget(null)}
                className="round-library-toolbar-button"
              >
                <Trans>Close</Trans>
              </button>
            </div>
            <div className="relative mt-4">
              <input
                ref={pickerInputRef}
                value={pickerQuery}
                onChange={(event) => setPickerQuery(event.target.value)}
                aria-label={t`Search torrent and MEGA video files`}
                placeholder={t`Search torrent and MEGA video files…`}
                className="w-full rounded-xl border border-white/10 bg-white/[0.04] py-2 pl-4 pr-9 text-sm text-white outline-none focus:border-cyan-300/50"
              />
              {pickerQuery && (
                <button
                  type="button"
                  aria-label={t`Clear search`}
                  onClick={() => setPickerQuery("")}
                  className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md px-2 py-0.5 text-slate-500 hover:text-white"
                >
                  ×
                </button>
              )}
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              {(["torrent", "mega", "pixeldrain"] as const).map((kind) => {
                const isActive = pickerKinds.includes(kind);
                return (
                  <button
                    key={kind}
                    type="button"
                    aria-pressed={isActive}
                    onClick={() =>
                      setPickerKinds((current) =>
                        current.includes(kind)
                          ? current.filter((entry) => entry !== kind)
                          : [...current, kind]
                      )
                    }
                    className={`round-library-toolbar-button ${isActive ? "is-active" : ""}`}
                  >
                    {kind === "torrent"
                      ? t`Torrent only`
                      : kind === "mega"
                        ? t`MEGA only`
                        : "PixelDrain only"}
                  </button>
                );
              })}
              <span className="ml-auto text-xs text-slate-500">
                {pickerLoading ? (
                  <Trans>Searching…</Trans>
                ) : (
                  <>
                    {pickerNextCursor && <Trans>first</Trans>}{" "}
                    <Plural value={pickerResults.length} one="# file" other="# files" />
                  </>
                )}
              </span>
            </div>
            <div className="mt-3 min-h-0 flex-1 space-y-2 overflow-y-auto">
              {pickerLoading && pickerResults.length === 0 && (
                <p className="p-4 text-center text-sm text-cyan-100">
                  <Trans>Searching…</Trans>
                </p>
              )}
              {!pickerLoading && pickerResults.length === 0 && (
                <div className="p-6 text-center text-sm text-slate-500">
                  <p>
                    <Trans>No catalog files found.</Trans>
                  </p>
                  {(pickerQuery || pickerKinds.length > 0) && (
                    <button
                      type="button"
                      onClick={() => {
                        setPickerQuery("");
                        setPickerKinds([]);
                      }}
                      className="mt-3 round-library-toolbar-button"
                    >
                      <Trans>Broaden the search</Trans>
                    </button>
                  )}
                </div>
              )}
              {pickerResults.map((entry) => (
                <button
                  key={`${entry.sourceId}:${entry.sourcePath}`}
                  type="button"
                  onClick={() => {
                    setChoices((current) => ({
                      ...current,
                      [targetKey(pickerTarget)]: { ...entry, score: null },
                    }));
                    setPickerTarget(null);
                  }}
                  className="w-full rounded-xl border border-white/10 bg-white/[0.025] p-3 text-left hover:border-cyan-300/40"
                >
                  <div className="flex items-center gap-2 text-xs">
                    <SourceKindChip kind={entry.sourceKind} />
                    <span className="min-w-0 truncate font-semibold text-white">
                      {entry.sourceName}
                    </span>
                    <span className="ml-auto shrink-0 text-slate-500">
                      {formatBytes(entry.sizeBytes)}
                    </span>
                  </div>
                  <div className="mt-2">
                    <SourcePath path={entry.sourcePath} muted />
                  </div>
                </button>
              ))}
              {pickerNextCursor && !pickerLoading && (
                <button
                  type="button"
                  onClick={() => {
                    setPickerLoading(true);
                    acquisition
                      .searchVideoFiles({
                        query: pickerQuery,
                        cursor: pickerNextCursor,
                        limit: 40,
                        ...(pickerKinds.length > 0 ? { sourceKinds: pickerKinds } : {}),
                      })
                      .then((result) => {
                        setPickerResults((current) => [...current, ...result.items]);
                        setPickerNextCursor(result.nextCursor);
                      })
                      .catch((searchError) =>
                        setError(
                          searchError instanceof Error
                            ? searchError.message
                            : t`Source search failed.`
                        )
                      )
                      .finally(() => setPickerLoading(false));
                  }}
                  className="round-library-toolbar-button w-full justify-center"
                >
                  <Trans>Load more files</Trans>
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
