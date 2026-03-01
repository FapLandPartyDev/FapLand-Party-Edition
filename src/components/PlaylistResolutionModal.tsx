import { useEffect, useMemo, useState } from "react";
import type { InstalledRound } from "../services/db";
import type {
  PlaylistResolutionAnalysis,
  PlaylistResolutionIssue,
} from "../game/playlistResolution";

type PlaylistResolutionModalProps = {
  open: boolean;
  title: string;
  installedRounds: InstalledRound[];
  analysis: PlaylistResolutionAnalysis;
  initialOverrides?: Record<string, string | null | undefined>;
  primaryActionLabel: string;
  secondaryActionLabel?: string;
  onClose: () => void;
  onPrimaryAction: (manualMappingByRefKey: Record<string, string | null | undefined>) => void;
  onSecondaryAction?: (manualMappingByRefKey: Record<string, string | null | undefined>) => void;
};

function formatRoundMeta(round: Pick<InstalledRound, "author" | "difficulty" | "type">): string {
  const parts = [round.author ?? "Unknown Author", round.type ?? "Normal"];
  if (typeof round.difficulty === "number") {
    parts.push(`Difficulty ${round.difficulty}`);
  }
  return parts.join(" • ");
}

function formatRefMeta(issue: PlaylistResolutionIssue): string {
  const parts = [issue.ref.author ?? "Unknown Author", issue.ref.type ?? "Normal"];
  if (issue.kind === "suggested") {
    parts.push("Suggested match available");
  }
  return parts.join(" • ");
}

export function PlaylistResolutionModal({
  open,
  title,
  installedRounds,
  analysis,
  initialOverrides,
  primaryActionLabel,
  secondaryActionLabel,
  onClose,
  onPrimaryAction,
  onSecondaryAction,
}: PlaylistResolutionModalProps) {
  const [overrides, setOverrides] = useState<Record<string, string | null | undefined>>(initialOverrides ?? {});
  const [expandedIssueKey, setExpandedIssueKey] = useState<string | null>(null);
  const [searchByKey, setSearchByKey] = useState<Record<string, string>>({});
  const [sameTypeOnlyByKey, setSameTypeOnlyByKey] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (!open) return;
    setOverrides(initialOverrides ?? {});
    setExpandedIssueKey(null);
    setSearchByKey({});
    setSameTypeOnlyByKey({});
  }, [initialOverrides, open]);

  const roundById = useMemo(
    () => new Map(installedRounds.map((round) => [round.id, round])),
    [installedRounds],
  );

  const remainingMissingCount = useMemo(
    () => analysis.issues.filter((issue) => {
      const selectedRoundId = overrides[issue.key] !== undefined
        ? overrides[issue.key]
        : issue.defaultRoundId;
      return !selectedRoundId;
    }).length,
    [analysis.issues, overrides],
  );

  const issueCandidatesByKey = useMemo(() => {
    return analysis.issues.reduce<Record<string, InstalledRound[]>>((acc, issue) => {
      const query = (searchByKey[issue.key] ?? "").trim().toLowerCase();
      const sameTypeOnly = sameTypeOnlyByKey[issue.key] ?? true;
      const suggestionIds = new Set(issue.suggestions.map((entry) => entry.roundId));
      const suggestionRank = new Map(issue.suggestions.map((entry, index) => [entry.roundId, index]));
      const suggestions = issue.suggestions
        .map((entry) => roundById.get(entry.roundId))
        .filter((round): round is InstalledRound => Boolean(round));
      const filteredInstalled = installedRounds.filter((round) => {
        if (sameTypeOnly && issue.ref.type && (round.type ?? "Normal") !== issue.ref.type) return false;
        if (!query) return true;
        const haystack = `${round.name} ${round.author ?? ""} ${round.type ?? "Normal"}`.toLowerCase();
        return haystack.includes(query);
      });
      const combined = [...suggestions, ...filteredInstalled.filter((round) => !suggestionIds.has(round.id))];
      combined.sort((left, right) => {
        const leftRank = suggestionRank.get(left.id);
        const rightRank = suggestionRank.get(right.id);
        if (typeof leftRank === "number" || typeof rightRank === "number") {
          if (typeof leftRank === "number" && typeof rightRank === "number") return leftRank - rightRank;
          return typeof leftRank === "number" ? -1 : 1;
        }
        return left.name.localeCompare(right.name, undefined, { sensitivity: "base", numeric: true });
      });
      acc[issue.key] = combined.slice(0, 16);
      return acc;
    }, {});
  }, [analysis.issues, installedRounds, roundById, sameTypeOnlyByKey, searchByKey]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[160] flex items-center justify-center bg-black/80 px-4 py-6">
      <div className="w-full max-w-5xl overflow-hidden rounded-3xl border border-cyan-300/30 bg-zinc-950/95 shadow-2xl backdrop-blur-xl">
        <div className="border-b border-white/10 px-5 py-4 sm:px-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-cyan-300">Playlist Resolution</p>
              <h2 className="mt-2 text-2xl font-black tracking-tight text-zinc-50">{title}</h2>
              <p className="mt-2 text-sm text-zinc-300">
                Exact: <span className="font-semibold text-emerald-300">{analysis.counts.exact}</span>
                {" • "}
                Auto-suggested: <span className="font-semibold text-cyan-300">{analysis.counts.suggested}</span>
                {" • "}
                Missing: <span className="font-semibold text-rose-300">{analysis.counts.missing}</span>
                {" • "}
                Remaining missing: <span className="font-semibold text-amber-300">{remainingMissingCount}</span>
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="rounded-xl border border-zinc-700 bg-zinc-900 px-4 py-2 text-sm font-semibold text-zinc-200 hover:bg-zinc-800"
            >
              Close
            </button>
          </div>
        </div>

        <div className="max-h-[70vh] overflow-y-auto px-5 py-5 sm:px-6">
          {analysis.issues.length === 0 ? (
            <div className="rounded-2xl border border-emerald-400/30 bg-emerald-500/10 px-4 py-4 text-sm text-emerald-100">
              No non-exact playlist refs need review.
            </div>
          ) : (
            <div className="grid gap-4">
              {analysis.issues.map((issue) => {
                const selectedRoundId = overrides[issue.key] !== undefined
                  ? overrides[issue.key]
                  : issue.defaultRoundId;
                const selectedRound = selectedRoundId ? roundById.get(selectedRoundId) ?? null : null;
                const sameTypeOnly = sameTypeOnlyByKey[issue.key] ?? true;
                const isExpanded = expandedIssueKey === issue.key;
                const candidates = issueCandidatesByKey[issue.key] ?? [];

                return (
                  <div key={issue.key} className="rounded-2xl border border-white/10 bg-black/30 p-4">
                    <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className={`rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] ${
                            issue.kind === "missing"
                              ? "border-rose-400/40 bg-rose-500/15 text-rose-200"
                              : "border-cyan-400/40 bg-cyan-500/15 text-cyan-200"
                          }`}>
                            {issue.kind === "missing" ? "Missing" : "Suggested"}
                          </span>
                          <span className="rounded-full border border-zinc-700 bg-zinc-900/80 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-zinc-300">
                            {issue.label}
                          </span>
                        </div>
                        <div className="mt-3 text-lg font-semibold text-zinc-100">{issue.ref.name}</div>
                        <div className="mt-1 text-sm text-zinc-400">{formatRefMeta(issue)}</div>
                        <div className="mt-4 rounded-xl border border-zinc-800 bg-zinc-900/70 px-3 py-3">
                          <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-zinc-500">Current Choice</div>
                          {selectedRound ? (
                            <div className="mt-2">
                              <div className="text-sm font-semibold text-emerald-100">{selectedRound.name}</div>
                              <div className="text-xs text-zinc-400">{formatRoundMeta(selectedRound)}</div>
                            </div>
                          ) : (
                            <div className="mt-2 text-sm font-semibold text-rose-200">Unresolved</div>
                          )}
                        </div>
                      </div>

                      <div className="flex shrink-0 flex-wrap gap-2 xl:max-w-[320px] xl:justify-end">
                        {issue.defaultRoundId && (
                          <button
                            type="button"
                            onClick={() => {
                              setOverrides((prev) => ({ ...prev, [issue.key]: issue.defaultRoundId }));
                            }}
                            className="rounded-xl border border-cyan-300/45 bg-cyan-500/15 px-3 py-2 text-sm font-semibold text-cyan-100 hover:bg-cyan-500/25"
                          >
                            Use Suggested
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => {
                            setExpandedIssueKey((prev) => (prev === issue.key ? null : issue.key));
                          }}
                          className="rounded-xl border border-violet-300/45 bg-violet-500/15 px-3 py-2 text-sm font-semibold text-violet-100 hover:bg-violet-500/25"
                        >
                          {isExpanded ? "Hide Picker" : "Choose Different"}
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setOverrides((prev) => ({ ...prev, [issue.key]: null }));
                          }}
                          className="rounded-xl border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm font-semibold text-zinc-200 hover:bg-zinc-800"
                        >
                          Clear
                        </button>
                      </div>
                    </div>

                    {isExpanded && (
                      <div className="mt-4 rounded-2xl border border-violet-300/20 bg-violet-500/5 p-4">
                        <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto]">
                          <label className="block">
                            <span className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.18em] text-zinc-400">
                              Search Installed Rounds
                            </span>
                            <input
                              type="text"
                              value={searchByKey[issue.key] ?? ""}
                              onChange={(event) => {
                                const nextValue = event.target.value;
                                setSearchByKey((prev) => ({ ...prev, [issue.key]: nextValue }));
                              }}
                              className="w-full rounded-xl border border-violet-300/30 bg-black/45 px-4 py-2.5 text-sm text-zinc-100 outline-none focus:border-violet-300/70 focus:ring-2 focus:ring-violet-400/30"
                              placeholder="Search by round, author, or type"
                            />
                          </label>
                          <div className="flex items-end">
                            <button
                              type="button"
                              onClick={() => {
                                setSameTypeOnlyByKey((prev) => ({ ...prev, [issue.key]: !sameTypeOnly }));
                              }}
                              className={`w-full rounded-xl border px-4 py-2.5 text-sm font-semibold ${
                                sameTypeOnly
                                  ? "border-emerald-300/45 bg-emerald-500/15 text-emerald-100"
                                  : "border-zinc-700 bg-zinc-900 text-zinc-200"
                              }`}
                            >
                              {sameTypeOnly ? "Same Type Only" : "All Types"}
                            </button>
                          </div>
                        </div>
                        <div className="mt-4 grid gap-2">
                          {candidates.map((round) => {
                            const selected = selectedRoundId === round.id;
                            return (
                              <button
                                key={round.id}
                                type="button"
                                onClick={() => {
                                  setOverrides((prev) => ({ ...prev, [issue.key]: round.id }));
                                }}
                                className={`rounded-xl border px-3 py-3 text-left ${
                                  selected
                                    ? "border-emerald-300/50 bg-emerald-500/15 text-emerald-100"
                                    : "border-white/10 bg-black/30 text-zinc-200 hover:border-violet-300/40 hover:bg-violet-500/10"
                                }`}
                              >
                                <div className="text-sm font-semibold">{round.name}</div>
                                <div className="mt-1 text-xs text-zinc-400">{formatRoundMeta(round)}</div>
                              </button>
                            );
                          })}
                          {candidates.length === 0 && (
                            <div className="rounded-xl border border-zinc-800 bg-black/25 px-3 py-3 text-sm text-zinc-400">
                              No installed rounds match the current filter.
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-white/10 px-5 py-4 sm:px-6">
          {secondaryActionLabel && onSecondaryAction && (
            <button
              type="button"
              onClick={() => onSecondaryAction(overrides)}
              className="rounded-xl border border-zinc-700 bg-zinc-900 px-4 py-2 text-sm font-semibold text-zinc-200 hover:bg-zinc-800"
            >
              {secondaryActionLabel}
            </button>
          )}
          <button
            type="button"
            onClick={() => onPrimaryAction(overrides)}
            className="rounded-xl border border-cyan-300/45 bg-cyan-500/15 px-4 py-2 text-sm font-semibold text-cyan-100 hover:bg-cyan-500/25"
          >
            {primaryActionLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
