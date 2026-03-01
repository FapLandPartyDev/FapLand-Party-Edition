import { Trans, useLingui } from "@lingui/react/macro";
import { useEffect, useState } from "react";
import type { InstallSidecarSecurityAnalysis } from "../services/db";

type ConfirmationResult = { action: "cancel" } | { action: "install" };

type PendingConfirmation = {
  analysis: InstallSidecarSecurityAnalysis;
  resolve: (result: ConfirmationResult) => void;
};

const listeners = new Set<(confirmation: PendingConfirmation | null) => void>();
let pendingConfirmation: PendingConfirmation | null = null;

function publish(confirmation: PendingConfirmation | null): void {
  pendingConfirmation = confirmation;
  for (const listener of listeners) {
    listener(confirmation);
  }
}

export async function confirmInstallSidecar(
  analysis: InstallSidecarSecurityAnalysis
): Promise<ConfirmationResult> {
  return await new Promise<ConfirmationResult>((resolve) => {
    publish({ analysis, resolve });
  });
}

export function InstallConfirmationModalHost() {
  const [confirmation, setConfirmation] = useState<PendingConfirmation | null>(pendingConfirmation);
  const { t } = useLingui();

  useEffect(() => {
    const listener = (next: PendingConfirmation | null) => {
      setConfirmation(next);
    };
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, []);

  if (!confirmation) return null;

  const close = (result: ConfirmationResult) => {
    const resolver = confirmation.resolve;
    publish(null);
    resolver(result);
  };

  const fileName = confirmation.analysis.filePath.split(/[/\\]/).pop() ?? t`Unknown File`;
  const contentName = confirmation.analysis.contentName;

  return (
    <div
      className="fixed inset-0 z-[130] flex items-center justify-center bg-black/70 px-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="install-confirm-modal-title"
    >
      <div className="w-full max-w-lg rounded-[1.5rem] border border-white/10 bg-zinc-950 p-6 text-white shadow-2xl">
        <div className="flex flex-col items-center text-center">
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-white/5 text-3xl">
            📦
          </div>
          <h2 id="install-confirm-modal-title" className="mt-4 text-xl font-bold tracking-tight">
            <Trans>Install this content?</Trans>
          </h2>
          <div className="mt-4 w-full rounded-2xl border border-white/5 bg-white/5 p-4 text-left">
            <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-zinc-500">
              <Trans>File Name</Trans>
            </div>
            <div className="mt-1 font-medium text-zinc-100 break-all">{fileName}</div>

            <div className="mt-4 text-[11px] font-semibold uppercase tracking-[0.2em] text-zinc-500">
              <Trans>Internal Name</Trans>
            </div>
            <div className="mt-1 font-medium text-zinc-100">{contentName}</div>
          </div>
        </div>

        <div className="mt-8 flex flex-col gap-2">
          <button
            className="w-full rounded-full bg-white py-3 text-sm font-bold text-black transition-transform active:scale-95"
            onClick={() => close({ action: "install" })}
          >
            <Trans>Confirm & Install</Trans>
          </button>
          <button
            className="w-full rounded-full border border-white/10 py-3 text-sm font-medium text-zinc-400 hover:bg-white/5 transition-colors"
            onClick={() => close({ action: "cancel" })}
          >
            <Trans>Cancel</Trans>
          </button>
        </div>
      </div>
    </div>
  );
}
