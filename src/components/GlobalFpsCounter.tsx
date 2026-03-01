import { useEffect, useState } from "react";
import { useFpsCounterState } from "../hooks/useFpsCounter";

const FPS_SAMPLE_WINDOW_MS = 500;

export function GlobalFpsCounter() {
  const { enabled, resolved } = useFpsCounterState();
  const [fps, setFps] = useState<number | null>(null);

  useEffect(() => {
    if (!resolved || !enabled) {
      return;
    }

    let frameCount = 0;
    let lastFrameTs: number | null = null;
    let windowStartTs: number | null = null;
    let rafId = 0;

    const tick = (timestamp: number) => {
      if (windowStartTs === null) {
        windowStartTs = timestamp;
      }

      if (lastFrameTs !== null && timestamp - lastFrameTs < 1) {
        rafId = window.requestAnimationFrame(tick);
        return;
      }

      frameCount += 1;
      lastFrameTs = timestamp;
      const elapsed = timestamp - windowStartTs;

      if (elapsed >= FPS_SAMPLE_WINDOW_MS) {
        setFps(Math.round((frameCount * 1000) / elapsed));
        frameCount = 0;
        windowStartTs = timestamp;
      }

      rafId = window.requestAnimationFrame(tick);
    };

    rafId = window.requestAnimationFrame(tick);
    return () => {
      window.cancelAnimationFrame(rafId);
    };
  }, [enabled, resolved]);

  if (!resolved || !enabled) {
    return null;
  }

  return (
    <div className="pointer-events-none fixed right-3 top-3 z-[170] rounded-lg border border-emerald-300/20 bg-black/55 px-2 py-1 font-[family-name:var(--font-jetbrains-mono)] text-[11px] font-semibold tracking-[0.18em] text-emerald-200 shadow-[0_0_20px_rgba(16,185,129,0.14)] backdrop-blur-sm">
      FPS {fps ?? "--"}
    </div>
  );
}
