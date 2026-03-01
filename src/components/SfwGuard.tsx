import { useState, type ReactNode, type SyntheticEvent } from "react";
import { useSfwModeState } from "../hooks/useSfwMode";

type SfwGuardProps = {
  children: ReactNode;
};

type SfwOneTimeOverridePromptProps = {
  confirmLabel?: string;
  mediaLabel?: string;
  onConfirm: () => void;
};

export function SfwOneTimeOverridePrompt({
  confirmLabel = "Show Media Once",
  mediaLabel = "media",
  onConfirm,
}: SfwOneTimeOverridePromptProps) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const stopEventPropagation = (event: SyntheticEvent) => {
    event.stopPropagation();
  };

  return (
    <div
      className="absolute inset-0 z-[60] flex items-center justify-center p-4"
      onClick={stopEventPropagation}
    >
      <div
        className="flex max-w-sm flex-col items-center gap-3 rounded-xl border border-zinc-700/50 bg-zinc-800/90 px-6 py-5 text-center shadow-lg backdrop-blur-sm"
        onClick={stopEventPropagation}
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          className="h-6 w-6 text-zinc-400"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={1.5}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z"
          />
        </svg>
        <span className="text-sm font-medium text-zinc-300">Safe Mode Enabled</span>
        <p className="text-xs text-zinc-400">
          This {mediaLabel} is hidden while safe mode is active.
        </p>
        <button
          className="rounded-lg border border-amber-300/45 bg-amber-500/15 px-3 py-2 text-xs font-semibold uppercase tracking-[0.18em] text-amber-100 transition-colors hover:bg-amber-500/28"
          onClick={() => setConfirmOpen(true)}
          type="button"
        >
          {confirmLabel}
        </button>
      </div>

      {confirmOpen && (
        <div
          className="absolute inset-0 z-[70] flex items-center justify-center bg-black/72 p-4"
          onClick={stopEventPropagation}
        >
          <div
            aria-modal="true"
            className="w-full max-w-md rounded-2xl border border-zinc-700/60 bg-[linear-gradient(145deg,rgba(18,18,24,0.98),rgba(30,18,36,0.96))] p-5 text-zinc-100 shadow-[0_0_40px_rgba(0,0,0,0.45)]"
            onClick={stopEventPropagation}
            role="dialog"
          >
            <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-amber-200/80">
              Confirm Reveal
            </p>
            <h3 className="mt-2 text-xl font-black tracking-tight text-white">
              Show this {mediaLabel} anyway?
            </h3>
            <p className="mt-2 text-sm text-zinc-300">
              This only reveals the current {mediaLabel} for this view. Safe mode stays enabled
              globally.
            </p>
            <div className="mt-5 flex items-center justify-end gap-3">
              <button
                className="rounded-lg border border-zinc-600/70 bg-zinc-800/80 px-3 py-2 text-xs font-semibold uppercase tracking-[0.18em] text-zinc-200 transition-colors hover:bg-zinc-700/80"
                onClick={() => setConfirmOpen(false)}
                type="button"
              >
                Cancel
              </button>
              <button
                className="rounded-lg border border-amber-300/45 bg-amber-500/18 px-3 py-2 text-xs font-semibold uppercase tracking-[0.18em] text-amber-100 transition-colors hover:bg-amber-500/30"
                onClick={() => {
                  setConfirmOpen(false);
                  onConfirm();
                }}
                type="button"
              >
                Show Once
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export function SfwGuard({ children }: SfwGuardProps) {
  const { enabled: sfwEnabled } = useSfwModeState();
  const [revealedOnce, setRevealedOnce] = useState(false);

  if (!sfwEnabled || revealedOnce) return <>{children}</>;

  return (
    <div className="relative flex h-full w-full items-center justify-center bg-zinc-900/80">
      <SfwOneTimeOverridePrompt mediaLabel="media" onConfirm={() => setRevealedOnce(true)} />
    </div>
  );
}
