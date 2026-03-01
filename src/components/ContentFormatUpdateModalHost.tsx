import { Trans } from "@lingui/react/macro";
import { useEffect, useState } from "react";
import {
  getPendingContentFormatUpdatePrompt,
  resolveContentFormatUpdatePrompt,
  subscribeToContentFormatUpdatePrompt,
  type PendingContentFormatUpdatePrompt,
} from "../services/contentFormatUpdatePrompt";

export function ContentFormatUpdateModalHost() {
  const [prompt, setPrompt] = useState<PendingContentFormatUpdatePrompt | null>(
    getPendingContentFormatUpdatePrompt
  );

  useEffect(() => {
    return subscribeToContentFormatUpdatePrompt(setPrompt);
  }, []);

  if (!prompt) return null;

  return (
    <div
      className="fixed inset-0 z-[150] flex items-center justify-center bg-black/70 px-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="content-format-update-title"
    >
      <div className="w-full max-w-lg rounded-[1.5rem] border border-amber-300/20 bg-zinc-950 p-6 text-white shadow-2xl">
        <div className="flex flex-col items-center text-center">
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-amber-500/10 text-3xl">
            ⬆️
          </div>
          <h2 id="content-format-update-title" className="mt-4 text-xl font-bold tracking-tight">
            <Trans>A newer app version may be required</Trans>
          </h2>
          <p className="mt-3 text-sm leading-6 text-zinc-300">
            <Trans>
              {prompt.fileName} could not be read in a compatible content format. An app update is
              available and may add support for this playlist, hero, or round.
            </Trans>
          </p>
          <div className="mt-4 flex gap-3 rounded-xl border border-white/5 bg-white/5 px-4 py-2 text-xs text-zinc-400">
            <span>
              <Trans>Installed</Trans> v{prompt.currentVersion}
            </span>
            {prompt.latestVersion ? (
              <span>
                <Trans>Available</Trans> v{prompt.latestVersion}
              </span>
            ) : null}
          </div>
        </div>

        <div className="mt-8 flex flex-col gap-2">
          <button
            type="button"
            className="w-full rounded-full bg-amber-200 py-3 text-sm font-bold text-zinc-950 transition-transform active:scale-95"
            onClick={() => resolveContentFormatUpdatePrompt({ action: "update" })}
          >
            <Trans>Download Latest Version</Trans>
          </button>
          <button
            type="button"
            className="w-full rounded-full border border-white/10 py-3 text-sm font-medium text-zinc-400 transition-colors hover:bg-white/5"
            onClick={() => resolveContentFormatUpdatePrompt({ action: "dismiss" })}
          >
            <Trans>Not Now</Trans>
          </button>
        </div>
      </div>
    </div>
  );
}
