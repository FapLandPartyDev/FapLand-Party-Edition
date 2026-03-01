/* eslint-disable react-refresh/only-export-components -- imperative modal host API */
import { Trans } from "@lingui/react/macro";
import { useEffect, useMemo, useState } from "react";
import type { acquisition as acquisitionService } from "../services/acquisition";

type Analysis = Awaited<ReturnType<typeof acquisitionService.analyzeUnresolvedImport>>;
type ReviewResult =
  | { action: "skip" }
  | {
      action: "apply";
      downloadIndexes: number[];
      installedSelections: Array<{
        installedRoundId: string;
        roundIds: string[];
      }>;
      enableTorrents: boolean;
    };

type PendingReview = { analysis: Analysis; resolve: (result: ReviewResult) => void };
const listeners = new Set<(review: PendingReview | null) => void>();
let pending: PendingReview | null = null;

function publish(value: PendingReview | null) {
  pending = value;
  for (const listener of listeners) listener(value);
}

export async function reviewAcquisitionDownloads(analysis: Analysis): Promise<ReviewResult> {
  if (analysis.matches.length === 0) return { action: "skip" };
  return await new Promise<ReviewResult>((resolve) => publish({ analysis, resolve }));
}

function formatBytes(value: number): string {
  if (value <= 0) return "Unknown size";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const index = Math.min(units.length - 1, Math.floor(Math.log(value) / Math.log(1024)));
  return `${(value / 1024 ** index).toFixed(1)} ${units[index]}`;
}

export function AcquisitionReviewModalHost() {
  const [review, setReview] = useState<PendingReview | null>(pending);
  const [choices, setChoices] = useState<Map<number, string>>(new Map());
  useEffect(() => {
    const listener = (next: PendingReview | null) => {
      setReview(next);
      setChoices(
        new Map(next?.analysis.matches.map((_, index) => [index, "download"] as const) ?? [])
      );
    };
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, []);
  const total = useMemo(
    () =>
      review?.analysis.matches.reduce(
        (sum, match, index) =>
          sum + (choices.get(index) === "download" ? (match.sizeBytes ?? 0) : 0),
        0
      ) ?? 0,
    [review, choices]
  );
  if (!review) return null;

  const close = (result: ReviewResult) => {
    const resolve = review.resolve;
    publish(null);
    resolve(result);
  };

  return (
    <div
      className="fixed inset-0 z-[145] flex items-center justify-center bg-black/75 px-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="acquisition-review-title"
    >
      <div className="w-full max-w-3xl rounded-3xl border border-cyan-300/25 bg-zinc-950 p-6 text-white shadow-2xl">
        <h2 id="acquisition-review-title" className="text-xl font-bold">
          <Trans>Download missing videos?</Trans>
        </h2>
        <p className="mt-2 text-sm text-zinc-300">
          <Trans>
            Review the matched source files. Nothing downloads until you approve this batch.
          </Trans>
        </p>
        {review.analysis.requiresTorrentEnablement ? (
          <div className="mt-4 rounded-xl border border-amber-300/35 bg-amber-500/10 p-3 text-sm text-amber-100">
            <Trans>
              Torrent peers and trackers can observe your IP address. Use a trusted VPN if this
              exposure is a concern. Torrent support is currently disabled.
            </Trans>
          </div>
        ) : null}
        <div className="mt-4 max-h-[50vh] space-y-2 overflow-y-auto">
          {review.analysis.matches.map((match, index) => (
            <div
              key={`${match.sourceId}:${match.path}`}
              className="rounded-xl border border-zinc-700 bg-white/5 p-3"
            >
              <div className="min-w-0">
                <div className="font-semibold text-zinc-100">
                  {match.sourceName} · {match.sourceKind}
                </div>
                <div className="break-all text-xs text-zinc-300">{match.path}</div>
                <div className="mt-1 text-xs text-zinc-500">
                  {match.matchKind === "explicit"
                    ? "Exact exported mapping"
                    : `Best filename match${match.score === null ? "" : ` (${Math.round(match.score * 100)}%)`}`}{" "}
                  · {formatBytes(match.sizeBytes ?? 0)} · {match.roundNames.join(", ")}
                </div>
                {match.weak || match.tied ? (
                  <div className="mt-1 text-xs text-amber-300">
                    <Trans>
                      This filename match is weak or tied. Verify it before downloading.
                    </Trans>
                  </div>
                ) : null}
                <label className="mt-3 block text-xs font-semibold text-zinc-300">
                  Use media from
                  <select
                    className="mt-1 block w-full rounded-lg border border-zinc-600 bg-zinc-900 px-3 py-2 text-sm text-white"
                    value={choices.get(index) ?? "skip"}
                    onChange={(event) => {
                      const next = new Map(choices);
                      next.set(index, event.target.value);
                      setChoices(next);
                    }}
                  >
                    <option value="download">
                      Download: {match.sourceName} ({formatBytes(match.sizeBytes ?? 0)})
                    </option>
                    {match.installedRoundSuggestions.map((suggestion) => (
                      <option key={suggestion.roundId} value={`installed:${suggestion.roundId}`}>
                        Installed: {suggestion.heroName ? `${suggestion.heroName} · ` : ""}
                        {suggestion.roundName} ({Math.round(suggestion.score * 100)}% match)
                      </option>
                    ))}
                    <option value="skip">Do nothing for now</option>
                  </select>
                </label>
              </div>
            </div>
          ))}
        </div>
        <div className="mt-4 text-sm text-zinc-300">
          <Trans>Selected download size:</Trans> {formatBytes(total)}
        </div>
        <div className="mt-6 flex flex-wrap justify-end gap-2">
          <button
            type="button"
            onClick={() => close({ action: "skip" })}
            className="rounded-full border border-zinc-600 px-4 py-2 text-sm text-zinc-300"
          >
            {review.analysis.requiresTorrentEnablement ? (
              <Trans>Import Without Torrent Downloads</Trans>
            ) : (
              <Trans>Not Now</Trans>
            )}
          </button>
          <button
            type="button"
            disabled={[...choices.values()].every((choice) => choice === "skip")}
            onClick={() => {
              const downloadIndexes = review.analysis.matches.flatMap((_, index) =>
                choices.get(index) === "download" ? [index] : []
              );
              const installedSelections = review.analysis.matches.flatMap((match, index) => {
                const choice = choices.get(index) ?? "";
                return choice.startsWith("installed:")
                  ? [
                      {
                        installedRoundId: choice.slice("installed:".length),
                        roundIds: match.roundIds,
                      },
                    ]
                  : [];
              });
              close({
                action: "apply",
                downloadIndexes,
                installedSelections,
                enableTorrents:
                  review.analysis.requiresTorrentEnablement &&
                  downloadIndexes.some(
                    (index) => review.analysis.matches[index]?.sourceKind === "torrent"
                  ),
              });
            }}
            className="rounded-full bg-white px-4 py-2 text-sm font-semibold text-black disabled:opacity-40"
          >
            Apply Selections
          </button>
        </div>
      </div>
    </div>
  );
}
