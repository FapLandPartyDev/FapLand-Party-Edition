import type { GameState, PlayerState, RoadPalette } from "../../game/types";
import { HIGHSPEED_PLAYBACK_RATE } from "../../game/media/playback";
import { useSfwMode } from "../../hooks/useSfwMode";
import { abbreviateNsfwText } from "../../utils/sfwText";
import { CinematicTransitionFrame, type CinematicTransitionHint } from "./CinematicTransitionFrame";
import { useLingui } from "@lingui/react/macro";

export type RoundStartTransitionProps = {
  queuedRound: GameState["queuedRound"];
  player?: PlayerState;
  remaining: number;
  duration: number;
  roadPalette?: RoadPalette;
};

export function RoundStartTransition({
  queuedRound,
  player,
  remaining,
  duration,
  roadPalette,
}: RoundStartTransitionProps) {
  const { i18n, t } = useLingui();
  const sfwMode = useSfwMode();
  if (!queuedRound) return null;

  const progress = duration > 0 ? 1 - remaining / duration : 1;
  const countdownLabel = `${Math.max(1, Math.ceil(remaining))}`;
  const hints: CinematicTransitionHint[] = [];
  const roundRuleHint =
    queuedRound.phaseKind === "cum" || queuedRound.phaseKind === "cumPoint"
      ? abbreviateNsfwText(
          t`In this round, you may cum when the video instructs you to do so.`,
          sfwMode
        )
      : null;
  if (roundRuleHint) {
    hints.push({
      id: "cum-round-rule",
      label: t`Round rule`,
      text: roundRuleHint,
      tone: "instruction",
    });
  }

  const numberFormatter = new Intl.NumberFormat(i18n.locale || "en", {
    maximumFractionDigits: 2,
  });
  if (player?.antiPerks.includes("highspeed")) {
    hints.push({
      id: "highspeed",
      label: t`Anti-perk`,
      text: t`Video playback speed: ${numberFormatter.format(HIGHSPEED_PLAYBACK_RATE)}×`,
      tone: "antiPerk",
    });
  }
  if (player?.antiPerks.includes("antigravity")) {
    hints.push({
      id: "antigravity",
      label: t`Anti-perk`,
      text: t`Device motion: inverted`,
      tone: "antiPerk",
    });
  }
  const intensityCap = player?.pendingIntensityCap;
  if (
    typeof intensityCap === "number" &&
    Number.isFinite(intensityCap) &&
    intensityCap > 0 &&
    intensityCap < 1
  ) {
    const intensityPercent = numberFormatter.format(Math.round(intensityCap * 100));
    hints.push({
      id: "intensity-cap",
      label: t`Perk`,
      text: t`Device intensity capped at ${intensityPercent}%`,
      tone: "perk",
    });
  }
  const title = abbreviateNsfwText(queuedRound.roundName, sfwMode);
  const defaultOverline =
    queuedRound.phaseKind === "cum" || queuedRound.phaseKind === "cumPoint"
      ? t`CUM ROUND`
      : t`NORMAL ROUND`;
  const overline = abbreviateNsfwText(
    queuedRound.roundOverlineLabel?.trim() ? queuedRound.roundOverlineLabel : defaultOverline,
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
        hints={hints}
        countdownLabel={countdownLabel}
        progress={progress}
        roadPalette={roadPalette}
        variant="round-start"
      />
    </div>
  );
}
