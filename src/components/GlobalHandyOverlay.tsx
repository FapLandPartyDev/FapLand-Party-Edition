import { AnimatePresence, motion } from "framer-motion";
import { useCallback, useEffect, useRef, useState } from "react";
import { useControllerSubscription, useControllerSurface } from "../controller";
import {
  THEHANDY_OFFSET_MAX_MS,
  THEHANDY_OFFSET_MIN_MS,
  THEHANDY_OFFSET_FINE_STEP_MS,
  THEHANDY_OFFSET_STEP_MS,
} from "../constants/theHandy";
import { useHandy } from "../contexts/HandyContext";
import { subscribeToGlobalHandyOverlayOpen } from "./globalHandyOverlayControls";
import { playHoverSound, playSelectSound } from "../utils/audio";

export { openGlobalHandyOverlay } from "./globalHandyOverlayControls";

function isEditableElement(target: Element | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tagName = target.tagName.toLowerCase();
  return (
    target.isContentEditable ||
    tagName === "input" ||
    tagName === "textarea" ||
    tagName === "select"
  );
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (isEditableElement(target instanceof Element ? target : null)) return true;
  return isEditableElement(document.activeElement);
}

export function GlobalHandyOverlay() {
  const {
    connected,
    isConnecting,
    connectionKey,
    error,
    synced,
    syncError,
    manuallyStopped,
    offsetMs,
    adjustOffset,
    resetOffset,
    toggleManualStop,
    connect,
    disconnect,
  } = useHandy();
  const [open, setOpen] = useState(false);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const overlayRef = useRef<HTMLElement | null>(null);
  const setOpenRef = useRef(setOpen);
  setOpenRef.current = setOpen;

  useEffect(() => {
    return subscribeToGlobalHandyOverlayOpen(() => {
      setOpenRef.current(true);
    });
  }, []);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (
        (event.ctrlKey || event.metaKey) &&
        event.key.toLowerCase() === "h" &&
        !event.shiftKey &&
        !event.altKey
      ) {
        event.preventDefault();
        if (!open && isEditableTarget(event.target)) return;
        setOpen((current) => !current);
        return;
      }
      if (event.key === "Escape") {
        setOpen(false);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  const handleAdjust = useCallback(
    (deltaMs: number) => {
      playSelectSound();
      void adjustOffset(deltaMs);
    },
    [adjustOffset]
  );

  const handleReset = useCallback(() => {
    playSelectSound();
    void resetOffset();
  }, [resetOffset]);

  const handleManualToggle = useCallback(() => {
    playSelectSound();
    void toggleManualStop().then((result) => {
      if (result === "stopped") {
        setActionMessage("TheHandy stopped.");
        return;
      }
      if (result === "resumed") {
        setActionMessage("TheHandy resumed.");
        return;
      }
      setActionMessage("No connected TheHandy to toggle.");
    });
  }, [toggleManualStop]);

  const handleConnect = useCallback(() => {
    playSelectSound();
    void connect(connectionKey);
  }, [connect, connectionKey]);

  const handleDisconnect = useCallback(() => {
    playSelectSound();
    void disconnect();
  }, [disconnect]);

  const statusLabel = !connected
    ? "Disconnected"
    : manuallyStopped
      ? "Stopped"
      : synced
        ? "Synced"
        : "Syncing";

  useControllerSubscription(
    useCallback((action) => {
      if (action === "START") {
        setOpen((current) => !current);
      }
    }, [])
  );

  useControllerSurface({
    id: "global-handy-overlay",
    scopeRef: overlayRef,
    priority: 241,
    enabled: open,
    initialFocusId: "handy-offset-slider",
    onBack: () => {
      setOpen(false);
      return true;
    },
  });

  const statusDotColor = !connected
    ? "bg-zinc-400"
    : manuallyStopped
      ? "bg-amber-400"
      : synced
        ? "bg-emerald-400"
        : "bg-cyan-400 animate-pulse";

  const statusBadgeClasses = !connected
    ? "border-zinc-500/40 bg-zinc-500/10 text-zinc-300"
    : manuallyStopped
      ? "border-amber-300/40 bg-amber-400/12 text-amber-100"
      : synced
        ? "border-emerald-300/40 bg-emerald-400/12 text-emerald-100 shadow-[0_0_20px_rgba(52,211,153,0.12)]"
        : "border-cyan-300/40 bg-cyan-400/12 text-cyan-100";

  return (
    <AnimatePresence>
      {open ? (
        <motion.div
          key="handy-overlay"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[241] flex items-center justify-center overflow-hidden bg-black/5 px-3 py-3 sm:px-4 sm:py-4 backdrop-blur-[2px]"
          onClick={() => setOpen(false)}
        >
          <motion.section
            ref={overlayRef}
            role="dialog"
            aria-modal="true"
            aria-label="Global TheHandy controls"
            initial={{ opacity: 0, y: 24, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 16, scale: 0.97 }}
            transition={{ type: "spring", stiffness: 280, damping: 26 }}
            onClick={(event) => event.stopPropagation()}
            className="relative flex max-h-[calc(100vh-1.5rem)] w-full max-w-lg flex-col overflow-hidden rounded-[1.75rem] border border-white/15 bg-white/[0.06] text-zinc-100 shadow-[0_28px_100px_rgba(0,0,0,0.3)] backdrop-blur-2xl sm:max-h-[calc(100vh-2rem)]"
          >
            <div className="pointer-events-none absolute inset-0 overflow-hidden rounded-[inherit]">
              <div className="absolute -left-20 -top-20 h-48 w-48 rounded-full bg-cyan-400/5 blur-[80px]" />
              <div className="absolute -bottom-16 -right-16 h-40 w-40 rounded-full bg-indigo-400/4 blur-[70px]" />
            </div>

            <header className="relative flex items-center justify-between gap-4 border-b border-white/10 px-5 py-4 sm:px-6">
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-[0.28em] text-cyan-300/90">
                  TheHandy Controls
                </p>
                <p className="mt-0.5 text-xs text-zinc-300">
                  Press{" "}
                  <span className="rounded border border-white/15 bg-white/5 px-1.5 py-0.5 text-[10px] font-semibold text-white">
                    Ctrl+H
                  </span>{" "}
                  to toggle
                </p>
              </div>
              <div className="flex items-center gap-2">
                <div
                  className={`flex items-center gap-2 rounded-full border px-3.5 py-1.5 text-xs font-semibold transition-all ${statusBadgeClasses}`}
                >
                  <span className={`inline-block h-1.5 w-1.5 rounded-full ${statusDotColor}`} />
                  {statusLabel}
                </div>
                <button
                  type="button"
                  onMouseEnter={playHoverSound}
                  onClick={() => {
                    playSelectSound();
                    setOpen(false);
                  }}
                  className="rounded-full border border-white/15 bg-white/[0.08] px-3.5 py-1.5 text-xs font-semibold text-zinc-200 transition hover:bg-white/15"
                  aria-label="Close TheHandy overlay"
                  data-controller-focus-id="handy-close"
                  data-controller-back="true"
                >
                  Close
                </button>
              </div>
            </header>

            <div className="relative min-h-0 flex-1 overflow-y-auto">
              <div className="p-5 sm:p-6 space-y-5">
                {actionMessage ? (
                  <div className="flex items-center gap-2 rounded-xl border border-cyan-300/25 bg-cyan-400/12 backdrop-blur-sm px-3 py-2 text-xs text-cyan-100">
                    {actionMessage}
                  </div>
                ) : null}

                {syncError ? (
                  <div className="flex items-center gap-2 rounded-xl border border-amber-300/25 bg-amber-400/12 backdrop-blur-sm px-3 py-2 text-xs text-amber-100">
                    <span>⚠</span>
                    <span>{syncError}</span>
                  </div>
                ) : null}

                {error ? (
                  <div className="flex items-center gap-2 rounded-xl border border-rose-300/25 bg-rose-400/12 backdrop-blur-sm px-3 py-2 text-xs text-rose-100">
                    <span>⚠</span>
                    <span>{error}</span>
                  </div>
                ) : null}

                <div className="rounded-xl border border-white/10 bg-white/[0.04] p-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-xs font-semibold text-white">Sync Offset</p>
                      <p className="mt-0.5 text-[10px] text-zinc-400">
                        Fine tune delay if motion leads or lags video
                      </p>
                    </div>
                    <div className="text-right">
                      <span className="bg-gradient-to-r from-cyan-100 via-sky-100 to-indigo-100 bg-clip-text text-3xl font-black tracking-tight text-transparent">
                        {offsetMs >= 0 ? "+" : ""}
                        {offsetMs}
                      </span>
                      <span className="text-sm font-semibold text-zinc-400">ms</span>
                    </div>
                  </div>

                  <div className="mt-4">
                    <input
                      id="global-handy-offset-slider"
                      data-controller-focus-id="handy-offset-slider"
                      aria-label="TheHandy global offset slider"
                      type="range"
                      min={THEHANDY_OFFSET_MIN_MS}
                      max={THEHANDY_OFFSET_MAX_MS}
                      step={1}
                      value={offsetMs}
                      onChange={(event) => {
                        const nextOffsetMs = Number(event.target.value);
                        if (!Number.isFinite(nextOffsetMs)) return;
                        const deltaMs = nextOffsetMs - offsetMs;
                        if (deltaMs === 0) return;
                        void adjustOffset(deltaMs);
                      }}
                      className="h-2 w-full cursor-pointer appearance-none rounded-full bg-white/10 accent-cyan-400"
                    />
                    <div className="mt-1.5 flex items-center justify-between text-[10px] font-medium text-zinc-400">
                      <span>{THEHANDY_OFFSET_MIN_MS}ms</span>
                      <span>0ms</span>
                      <span>+{THEHANDY_OFFSET_MAX_MS}ms</span>
                    </div>
                  </div>

                  <div className="mt-3 flex items-center gap-1.5">
                    <button
                      type="button"
                      className="flex-1 rounded-lg border border-cyan-300/30 bg-cyan-400/12 py-2 text-xs font-semibold text-cyan-100 transition hover:bg-cyan-400/20"
                      onClick={() => handleAdjust(-THEHANDY_OFFSET_STEP_MS)}
                      onMouseEnter={() => playHoverSound()}
                    >
                      -25ms
                    </button>
                    <button
                      type="button"
                      className="flex-1 rounded-lg border border-white/15 bg-white/[0.08] py-2 text-xs font-semibold text-zinc-200 transition hover:bg-white/15"
                      onClick={() => handleAdjust(-THEHANDY_OFFSET_FINE_STEP_MS)}
                      onMouseEnter={() => playHoverSound()}
                    >
                      -1ms
                    </button>
                    <button
                      type="button"
                      className="flex-1 rounded-lg border border-violet-300/30 bg-violet-400/12 py-2 text-xs font-semibold text-violet-100 transition hover:bg-violet-400/20"
                      onClick={handleReset}
                      onMouseEnter={() => playHoverSound()}
                    >
                      Reset
                    </button>
                    <button
                      type="button"
                      className="flex-1 rounded-lg border border-white/15 bg-white/[0.08] py-2 text-xs font-semibold text-zinc-200 transition hover:bg-white/15"
                      onClick={() => handleAdjust(THEHANDY_OFFSET_FINE_STEP_MS)}
                      onMouseEnter={() => playHoverSound()}
                    >
                      +1ms
                    </button>
                    <button
                      type="button"
                      className="flex-1 rounded-lg border border-cyan-300/30 bg-cyan-400/12 py-2 text-xs font-semibold text-cyan-100 transition hover:bg-cyan-400/20"
                      onClick={() => handleAdjust(THEHANDY_OFFSET_STEP_MS)}
                      onMouseEnter={() => playHoverSound()}
                    >
                      +25ms
                    </button>
                  </div>
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="rounded-xl border border-white/10 bg-white/[0.04] p-4">
                    <p className="text-xs font-semibold text-white">Connection</p>
                    <p className="mt-0.5 text-[10px] text-zinc-400">
                      {connected ? "Device connected" : "No device connected"}
                    </p>
                    <button
                      type="button"
                      disabled={isConnecting}
                      className={`mt-3 w-full rounded-lg border px-4 py-2 text-xs font-semibold backdrop-blur-sm transition-all ${
                        isConnecting
                          ? "cursor-not-allowed border-zinc-500/40 bg-zinc-500/15 text-zinc-400"
                          : connected
                            ? "border-orange-300/30 bg-orange-400/12 text-orange-100 hover:bg-orange-400/20"
                            : "border-cyan-300/40 bg-cyan-400/15 text-cyan-50 shadow-[0_0_24px_rgba(34,211,238,0.2)] hover:bg-cyan-400/25"
                      }`}
                      onClick={connected ? handleDisconnect : handleConnect}
                      onMouseEnter={() => playHoverSound()}
                      data-controller-focus-id="handy-connect"
                    >
                      {isConnecting ? "Connecting..." : connected ? "Disconnect" : "Connect"}
                    </button>
                  </div>

                  <div className="rounded-xl border border-white/10 bg-white/[0.04] p-4">
                    <p className="text-xs font-semibold text-white">Playback</p>
                    <p className="mt-0.5 text-[10px] text-zinc-400">
                      {manuallyStopped ? "Device stopped" : "Device active"}
                    </p>
                    <button
                      type="button"
                      className={`mt-3 w-full rounded-lg border px-4 py-2 text-xs font-semibold backdrop-blur-sm transition-all ${
                        manuallyStopped
                          ? "border-emerald-300/40 bg-emerald-400/15 text-emerald-50 shadow-[0_0_20px_rgba(52,211,153,0.15)] hover:bg-emerald-400/25"
                          : "border-rose-300/30 bg-rose-400/12 text-rose-100 hover:bg-rose-400/20"
                      }`}
                      onClick={handleManualToggle}
                      onMouseEnter={() => playHoverSound()}
                      data-controller-focus-id="handy-toggle"
                    >
                      {manuallyStopped ? "Start TheHandy" : "Stop TheHandy"}
                    </button>
                  </div>
                </div>

                <div className="rounded-xl border border-white/10 bg-white/[0.04] px-4 py-3">
                  <div className="flex flex-wrap gap-x-5 gap-y-1 text-[10px] text-zinc-400">
                    <span>
                      <code className="rounded border border-white/15 bg-white/[0.08] px-1 py-0.5 text-[9px] font-semibold text-zinc-200">
                        Ctrl+W
                      </code>{" "}
                      start / stop
                    </span>
                    <span>
                      <code className="rounded border border-white/15 bg-white/[0.08] px-1 py-0.5 text-[9px] font-semibold text-zinc-200">
                        [
                      </code>{" "}
                      /{" "}
                      <code className="rounded border border-white/15 bg-white/[0.08] px-1 py-0.5 text-[9px] font-semibold text-zinc-200">
                        ]
                      </code>{" "}
                      adjust in-game
                    </span>
                    <span>
                      <code className="rounded border border-white/15 bg-white/[0.08] px-1 py-0.5 text-[9px] font-semibold text-zinc-200">
                        Shift
                      </code>{" "}
                      fine 1ms tuning
                    </span>
                    <span>
                      <code className="rounded border border-white/15 bg-white/[0.08] px-1 py-0.5 text-[9px] font-semibold text-zinc-200">
                        \
                      </code>{" "}
                      reset in-game
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </motion.section>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
