import type { GameState, RoadPalette } from "../../game/types";
import { useSfwMode } from "../../hooks/useSfwMode";
import { abbreviateNsfwText } from "../../utils/sfwText";
import { CinematicTransitionFrame } from "./CinematicTransitionFrame";
import { useLingui } from "@lingui/react/macro";

export type RoundStartTransitionProps = {
  queuedRound: GameState["queuedRound"];
  remaining: number;
  duration: number;
  roadPalette?: RoadPalette;
};

export function RoundStartTransition({
  queuedRound,
  remaining,
  duration,
  roadPalette,
}: RoundStartTransitionProps) {
  const { t } = useLingui();
  if (!queuedRound) return null;

  const sfwMode = useSfwMode();
  const progress = duration > 0 ? 1 - remaining / duration : 1;
  const countdownLabel = `${Math.max(1, Math.ceil(remaining))}`;
  const hintText =
    queuedRound.phaseKind === "cum"
      ? abbreviateNsfwText(
          t`In this round, you may cum when the video instructs you to do so.`,
          sfwMode
        )
      : null;
  const title = abbreviateNsfwText(queuedRound.roundName, sfwMode);
  const overline = abbreviateNsfwText(
    queuedRound.phaseKind === "cum" ? t`CUM ROUND` : t`NORMAL ROUND`,
    sfwMode
  );

  return (
    <div
      className="pointer-events-none absolute inset-0 z-[82]"
      data-testid="round-start-transition"
    >
      <CinematicTransitionFrame
        title={title}
        overline={overline}
        accentLabel={
          queuedRound.selectionKind === "random" ? t`Random round acquired` : t`Target locked`
        }
        hintText={hintText}
        countdownLabel={countdownLabel}
        progress={progress}
        roadPalette={roadPalette}
        variant="round-start"
      />
    </div>
  );
}
