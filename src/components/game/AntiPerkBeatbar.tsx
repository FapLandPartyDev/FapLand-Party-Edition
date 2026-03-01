import { useEffect, useState } from "react";
import type { FunscriptAction } from "../../game/media/playback";
import { getFunscriptPositionAtMs } from "../../game/media/playback";
import type { BeatbarBeat, BeatbarVisualStyle } from "./antiPerkSequences";

const ANTI_PERK_BEATBAR_LEAD_MS = 1_800;
const ANTI_PERK_BEATBAR_TRAIL_MS = 300;

function lowerBoundBeatIndex(beats: BeatbarBeat[], at: number): number {
  let low = 0;
  let high = beats.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if ((beats[middle]?.at ?? Number.POSITIVE_INFINITY) < at) low = middle + 1;
    else high = middle;
  }
  return low;
}

export function LiveAntiPerkBeatbar({
  actions,
  beatbarBeats,
  startedAtMs,
  durationMs,
  showBeatbar,
  showBall,
  style,
  className,
}: Omit<Parameters<typeof AntiPerkBeatbar>[0], "elapsedMs"> & {
  startedAtMs: number;
  durationMs: number;
}) {
  const [elapsedMs, setElapsedMs] = useState(() =>
    Math.max(0, Math.min(durationMs, performance.now() - startedAtMs))
  );

  useEffect(() => {
    if (!showBeatbar && !showBall) return;
    let frameId: number | null = null;
    let cancelled = false;
    const tick = () => {
      if (cancelled) return;
      const elapsed = Math.max(0, Math.min(durationMs, performance.now() - startedAtMs));
      setElapsedMs(elapsed);
      if (elapsed < durationMs) frameId = window.requestAnimationFrame(tick);
    };
    frameId = window.requestAnimationFrame(tick);
    return () => {
      cancelled = true;
      if (frameId !== null) window.cancelAnimationFrame(frameId);
    };
  }, [durationMs, showBall, showBeatbar, startedAtMs]);

  return (
    <AntiPerkBeatbar
      actions={actions}
      beatbarBeats={beatbarBeats}
      elapsedMs={elapsedMs}
      showBeatbar={showBeatbar}
      showBall={showBall}
      style={style}
      className={className}
    />
  );
}

export function AntiPerkBeatbar({
  actions,
  beatbarBeats,
  elapsedMs,
  showBeatbar,
  showBall,
  style,
  className = "pointer-events-none absolute inset-x-0 bottom-[12%] z-[62] mx-auto w-[min(92vw,960px)] px-4",
}: {
  actions: FunscriptAction[];
  beatbarBeats: BeatbarBeat[];
  elapsedMs: number;
  showBeatbar: boolean;
  showBall: boolean;
  style: BeatbarVisualStyle;
  className?: string;
}) {
  const noteColor = style === "jackhammer" ? "rgba(251,113,133,0.98)" : "rgba(34,211,238,0.98)";
  const glowColor = style === "jackhammer" ? "rgba(251,113,133,0.52)" : "rgba(34,211,238,0.46)";
  const activeIndex = lowerBoundBeatIndex(beatbarBeats, elapsedMs);
  const hitPulse =
    activeIndex >= 0 && activeIndex < beatbarBeats.length
      ? Math.max(0, 1 - Math.abs(beatbarBeats[activeIndex]!.at - elapsedMs) / 110)
      : 0;
  const currentPosition =
    actions.length > 0 ? (getFunscriptPositionAtMs({ actions }, elapsedMs) ?? 50) : 50;
  const visibleStart = lowerBoundBeatIndex(beatbarBeats, elapsedMs - ANTI_PERK_BEATBAR_TRAIL_MS);
  const visibleEnd = lowerBoundBeatIndex(beatbarBeats, elapsedMs + ANTI_PERK_BEATBAR_LEAD_MS + 1);
  const visibleBeats = beatbarBeats.slice(visibleStart, visibleEnd);
  const positionToPercent = (pos: number) => 88 - pos * 0.76;

  return (
    <div aria-hidden="true" className={className} data-testid="anti-perk-beatbar">
      <div className="relative h-24 overflow-hidden [contain:layout_paint] [container-type:inline-size]">
        <div
          className="absolute bottom-[12%] left-1/2 top-[12%] w-[4px] -translate-x-1/2 rounded-full"
          style={{
            background: noteColor,
            boxShadow: `0 0 ${24 + hitPulse * 20}px ${glowColor}`,
            opacity: 0.88 + hitPulse * 0.12,
          }}
        />
        {showBeatbar &&
          visibleBeats.map((beat) => {
            const relativeMs = beat.at - elapsedMs;
            const horizontalPercent =
              relativeMs >= 0
                ? 50 + (relativeMs / ANTI_PERK_BEATBAR_LEAD_MS) * 50
                : 50 + (relativeMs / ANTI_PERK_BEATBAR_TRAIL_MS) * 50;
            const proximity =
              1 -
              Math.min(
                1,
                Math.abs(relativeMs) / (ANTI_PERK_BEATBAR_LEAD_MS + ANTI_PERK_BEATBAR_TRAIL_MS)
              );

            return (
              <div
                key={`${beat.at}-${beat.lowPos}-low-point`}
                className="absolute -translate-x-1/2 rounded-full"
                data-testid="anti-perk-beat-note"
                style={{
                  left: "50%",
                  top: "12%",
                  bottom: "12%",
                  width: `${style === "jackhammer" ? 9 : 11 + beat.strength * 2}px`,
                  background: `linear-gradient(180deg, rgba(255,255,255,0.88), ${noteColor} 28%, rgba(255,255,255,0.28) 100%)`,
                  boxShadow: `0 0 ${12 + proximity * 16}px ${glowColor}`,
                  opacity: 0.4 + proximity * 0.52,
                  translate: `calc(${horizontalPercent - 50}cqw - 50%) 0`,
                  willChange: "translate, opacity",
                }}
              />
            );
          })}
        {showBall && (
          <div
            className="absolute left-1/2 h-5 w-5 -translate-x-1/2 -translate-y-1/2 rounded-full border border-white/40"
            data-testid="anti-perk-position-ball"
            style={{
              top: `${positionToPercent(currentPosition)}%`,
              background: noteColor,
              boxShadow: `0 0 ${14 + hitPulse * 18}px ${glowColor}`,
              transform: `translate(-50%, -50%) scale(${1 + hitPulse * 0.24})`,
            }}
          />
        )}
      </div>
    </div>
  );
}
