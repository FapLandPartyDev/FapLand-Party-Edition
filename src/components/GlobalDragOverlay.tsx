import { AnimatePresence, motion } from "framer-motion";
import { Trans } from "@lingui/react/macro";
import { useEffect, useState } from "react";

type DragState =
  | { type: "idle" }
  | { type: "dragging" }
  | { type: "confirming"; fileNames: string[]; resolve: (confirmed: boolean) => void };

const listeners = new Set<(state: DragState) => void>();
let currentState: DragState = { type: "idle" };

function publish(state: DragState): void {
  currentState = state;
  for (const listener of listeners) {
    listener(state);
  }
}

export function setDragActive(active: boolean): void {
  if (active && currentState.type === "idle") {
    publish({ type: "dragging" });
  } else if (!active && currentState.type === "dragging") {
    publish({ type: "idle" });
  }
}

export function requestDropConfirmation(fileNames: string[]): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    publish({ type: "confirming", fileNames, resolve });
  });
}

export function GlobalDragOverlay() {
  const [state, setState] = useState<DragState>(currentState);

  useEffect(() => {
    const listener = (next: DragState) => {
      setState(next);
    };
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, []);

  const confirmDrop = (confirmed: boolean) => {
    if (state.type !== "confirming") return;
    const resolver = state.resolve;
    publish({ type: "idle" });
    resolver(confirmed);
  };

  return (
    <AnimatePresence>
      {state.type === "dragging" && (
        <motion.div
          key="drag-overlay"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
          className="pointer-events-none fixed inset-0 z-[200] flex items-center justify-center"
        >
          <div className="absolute inset-3 rounded-3xl border-2 border-dashed border-sky-400/40 bg-sky-500/5 shadow-[inset_0_0_80px_rgba(56,189,248,0.06),0_0_80px_rgba(56,189,248,0.08)]" />
          <div className="relative z-10 flex flex-col items-center gap-3">
            <div className="flex h-20 w-20 items-center justify-center rounded-2xl border border-sky-400/20 bg-sky-500/10 text-4xl shadow-[0_0_30px_rgba(56,189,248,0.15)]">
              <svg
                width="36"
                height="36"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="text-sky-300"
              >
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="7 10 12 15 17 10" />
                <line x1="12" y1="15" x2="12" y2="3" />
              </svg>
            </div>
            <p className="text-lg font-bold tracking-tight text-sky-200/90 drop-shadow-lg">
              <Trans>Drop files to install</Trans>
            </p>
          </div>
        </motion.div>
      )}
      {state.type === "confirming" && (
        <motion.div
          key="drop-confirm"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
          className="fixed inset-0 z-[210] flex items-center justify-center bg-black/70 px-4 backdrop-blur-sm"
        >
          <motion.div
            initial={{ scale: 0.95, y: 8 }}
            animate={{ scale: 1, y: 0 }}
            exit={{ scale: 0.95, y: 8 }}
            transition={{ duration: 0.15 }}
            className="w-full max-w-lg rounded-[1.5rem] border border-white/10 bg-zinc-950 p-6 text-white shadow-2xl"
          >
            <div className="flex flex-col items-center text-center">
              <div className="flex h-16 w-16 items-center justify-center rounded-full bg-white/5 text-3xl">
                📦
              </div>
              <h2 className="mt-4 text-xl font-bold tracking-tight">
                <Trans>Install dropped files?</Trans>
              </h2>
              <p className="mt-1 text-sm text-zinc-400">
                {state.fileNames.length === 1 ? (
                  <Trans>1 file will be installed:</Trans>
                ) : (
                  <Trans>{state.fileNames.length} files will be installed:</Trans>
                )}
              </p>
              <div className="mt-4 w-full max-h-[40vh] overflow-y-auto rounded-2xl border border-white/5 bg-white/5 p-4 text-left">
                {state.fileNames.map((name, i) => (
                  <div
                    key={`${name}-${i}`}
                    className="flex items-center gap-3 border-b border-white/5 py-2 last:border-b-0"
                  >
                    <span className="text-xs text-zinc-500">{i + 1}.</span>
                    <span className="text-sm font-medium text-zinc-200 break-all">{name}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="mt-8 flex flex-col gap-2">
              <button
                className="w-full rounded-full bg-white py-3 text-sm font-bold text-black transition-transform active:scale-95"
                onClick={() => confirmDrop(true)}
              >
                <Trans>Confirm & Install</Trans>
              </button>
              <button
                className="w-full rounded-full border border-white/10 py-3 text-sm font-medium text-zinc-400 transition-colors hover:bg-white/5"
                onClick={() => confirmDrop(false)}
              >
                <Trans>Cancel</Trans>
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
