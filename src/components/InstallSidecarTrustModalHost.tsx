import { useEffect, useState } from "react";
import type { InstallSidecarSecurityAnalysis } from "../services/db";

type ReviewResult = { action: "cancel" } | { action: "import"; trustedBaseDomains: string[] };

type PendingReview = {
  analysis: InstallSidecarSecurityAnalysis;
  resolve: (result: ReviewResult) => void;
};

const listeners = new Set<(review: PendingReview | null) => void>();
let pendingReview: PendingReview | null = null;

function publish(review: PendingReview | null): void {
  pendingReview = review;
  for (const listener of listeners) {
    listener(review);
  }
}

export async function reviewInstallSidecarTrust(
  analysis: InstallSidecarSecurityAnalysis
): Promise<ReviewResult> {
  if (analysis.unknownEntries.length === 0) {
    return { action: "import", trustedBaseDomains: [] };
  }

  return await new Promise<ReviewResult>((resolve) => {
    publish({ analysis, resolve });
  });
}

export function InstallSidecarTrustModalHost() {
  const [review, setReview] = useState<PendingReview | null>(pendingReview);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  useEffect(() => {
    const listener = (next: PendingReview | null) => {
      setReview(next);
      setSelected(new Set());
    };
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, []);

  if (!review) return null;

  const close = (result: ReviewResult) => {
    const resolver = review.resolve;
    publish(null);
    resolver(result);
  };

  return (
    <div
      className="fixed inset-0 z-[120] flex items-center justify-center bg-black/70 px-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="sidecar-trust-modal-title"
    >
      <div className="w-full max-w-3xl rounded-[1.5rem] border border-white/10 bg-zinc-950 p-6 text-white shadow-2xl">
        <h2 id="sidecar-trust-modal-title" className="text-xl font-semibold">
          Review Remote Sites Before Import
        </h2>
        <p className="mt-2 text-sm text-zinc-300">
          These remote sites are not in the default safe list. Untrusted remote URLs will be
          stripped, but the rest of the import will continue.
        </p>
        <div className="mt-4 max-h-[50vh] space-y-3 overflow-y-auto pr-1">
          {review.analysis.unknownEntries.map((entry) => {
            const checked = selected.has(entry.baseDomain);
            return (
              // eslint-disable-next-line jsx-a11y/label-has-associated-control -- label wraps checkbox and has text
              <label
                key={entry.baseDomain}
                htmlFor={`sidecar-trust-${entry.baseDomain}`}
                className="block rounded-2xl border border-white/10 bg-white/5 p-4"
              >
                <div className="flex items-start gap-3">
                  <input
                    type="checkbox"
                    id={`sidecar-trust-${entry.baseDomain}`}
                    className="mt-1 h-4 w-4"
                    checked={checked}
                    onChange={(event) => {
                      const next = new Set(selected);
                      if (event.target.checked) next.add(entry.baseDomain);
                      else next.delete(entry.baseDomain);
                      setSelected(next);
                    }}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">{entry.baseDomain}</span>
                      <span className="text-xs uppercase tracking-[0.24em] text-zinc-500">
                        {entry.host}
                      </span>
                    </div>
                    <p className="mt-1 text-sm text-zinc-300">
                      {entry.videoUrlCount} video URL{entry.videoUrlCount === 1 ? "" : "s"},{" "}
                      {entry.funscriptUrlCount} funscript URL
                      {entry.funscriptUrlCount === 1 ? "" : "s"}
                    </p>
                    <div className="mt-2 space-y-1 text-xs text-zinc-400">
                      {entry.sampleUrls.map((url) => (
                        <div key={url} className="break-all">
                          {url}
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </label>
            );
          })}
        </div>
        <div className="mt-6 flex flex-wrap justify-end gap-3">
          <button
            className="rounded-full border border-white/15 px-4 py-2 text-sm text-zinc-300"
            onClick={() => close({ action: "cancel" })}
          >
            Cancel
          </button>
          <button
            className="rounded-full border border-amber-500/40 bg-amber-500/10 px-4 py-2 text-sm text-amber-100"
            onClick={() => close({ action: "import", trustedBaseDomains: [] })}
          >
            Import Without Remote URLs
          </button>
          <button
            className="rounded-full bg-white px-4 py-2 text-sm font-medium text-black"
            onClick={() =>
              close({
                action: "import",
                trustedBaseDomains: Array.from(selected).sort((a, b) => a.localeCompare(b)),
              })
            }
          >
            Trust Selected and Import
          </button>
        </div>
      </div>
    </div>
  );
}
