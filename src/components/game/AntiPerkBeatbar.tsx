import type { FunscriptAction } from "../../game/media/playback";
import { getFunscriptPositionAtMs } from "../../game/media/playback";
import type { BeatbarBeat, BeatbarVisualStyle } from "./antiPerkSequences";

const ANTI_PERK_BEATBAR_LEAD_MS = 1_800;
const ANTI_PERK_BEATBAR_TRAIL_MS = 300;

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
  const activeIndex = beatbarBeats.findIndex((beat) => elapsedMs < beat.at);
  const hitPulse =
    activeIndex >= 0 && activeIndex < beatbarBeats.length
      ? Math.max(0, 1 - Math.abs(beatbarBeats[activeIndex]!.at - elapsedMs) / 110)
      : 0;
  const currentPosition =
    actions.length > 0 ? (getFunscriptPositionAtMs({ actions }, elapsedMs) ?? 50) : 50;
  const visibleBeats = beatbarBeats.filter(
    (beat) =>
      beat.at >= elapsedMs - ANTI_PERK_BEATBAR_TRAIL_MS &&
      beat.at <= elapsedMs + ANTI_PERK_BEATBAR_LEAD_MS
  );
  const positionToPercent = (pos: number) => 88 - pos * 0.76;

  return (
    <div aria-hidden="true" className={className} data-testid="anti-perk-beatbar">
      <div className="relative h-24 overflow-hidden">
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
            const normalized =
              (relativeMs + ANTI_PERK_BEATBAR_TRAIL_MS) /
              (ANTI_PERK_BEATBAR_LEAD_MS + ANTI_PERK_BEATBAR_TRAIL_MS);
            const left = normalized * 100;
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
                  left: `${left}%`,
                  top: "12%",
                  bottom: "12%",
                  width: `${style === "jackhammer" ? 9 : 11 + beat.strength * 2}px`,
                  background: `linear-gradient(180deg, rgba(255,255,255,0.88), ${noteColor} 28%, rgba(255,255,255,0.28) 100%)`,
                  boxShadow: `0 0 ${12 + proximity * 16}px ${glowColor}`,
                  opacity: 0.4 + proximity * 0.52,
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
