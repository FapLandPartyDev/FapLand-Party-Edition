import { Trans } from "@lingui/react/macro";
import type { CSSProperties } from "react";

const PARTICLES = Array.from({ length: 28 }, (_, index) => ({
  angle: `${(360 / 28) * index}deg`,
  distance: `${26 + (index % 5) * 5}vmin`,
  delay: `${(index % 7) * 34}ms`,
  color: index % 3 === 0 ? "#fbbf24" : index % 2 === 0 ? "#22d3ee" : "#e879f9",
}));

export function CompletionCelebration({
  level,
  levelsGained = 0,
}: {
  level?: number;
  levelsGained?: number;
}) {
  const isLevelUp = levelsGained > 0;

  return (
    <div
      key={isLevelUp ? `level-${level}` : "round-complete"}
      className={`completion-celebration ${isLevelUp ? "completion-celebration--level-up" : ""}`}
      aria-hidden="true"
    >
      <div className="completion-celebration__flash" />
      <div className="completion-celebration__vignette" />
      <div className="completion-celebration__ring completion-celebration__ring--one" />
      <div className="completion-celebration__ring completion-celebration__ring--two" />
      <div className="completion-celebration__particles">
        {PARTICLES.map((particle, index) => (
          <i
            key={index}
            className="completion-celebration__particle"
            style={
              {
                "--particle-angle": particle.angle,
                "--particle-distance": particle.distance,
                "--particle-delay": particle.delay,
                "--particle-color": particle.color,
              } as CSSProperties
            }
          />
        ))}
      </div>
      <div className="completion-celebration__banner">
        <span className="completion-celebration__eyebrow">
          {isLevelUp ? <Trans>Progression unlocked</Trans> : <Trans>Round complete</Trans>}
        </span>
        <strong>{isLevelUp ? <Trans>LEVEL UP</Trans> : <Trans>VICTORY</Trans>}</strong>
        {isLevelUp && <span className="completion-celebration__level">LV. {level ?? 1}</span>}
      </div>
    </div>
  );
}
