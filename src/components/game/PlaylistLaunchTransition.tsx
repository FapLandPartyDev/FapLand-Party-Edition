import { useLingui } from "@lingui/react/macro";
import type { RoadPalette } from "../../game/types";
import { CinematicTransitionFrame } from "./CinematicTransitionFrame";

export type PlaylistLaunchTransitionProps = {
  visible: boolean;
  playlistName: string;
  boardModeLabel: string;
  roundCount: number;
  estimatedDurationLabel: string;
  progress: number;
  roadPalette?: RoadPalette;
};

export function PlaylistLaunchTransition({
  visible,
  playlistName,
  boardModeLabel,
  roundCount,
  estimatedDurationLabel,
  progress,
  roadPalette,
}: PlaylistLaunchTransitionProps) {
  const { t } = useLingui();
  if (!visible) return null;

  return (
    <div className="absolute inset-0 z-[120]" data-testid="playlist-launch-transition">
      <CinematicTransitionFrame
        title={playlistName}
        overline={t`RUN INITIALIZATION`}
        accentLabel={t`Playlist locked`}
        metadata={[
          `${boardModeLabel} ${t`board`}`,
          `${Math.max(0, roundCount)} ${t`rounds`}`,
          estimatedDurationLabel,
        ]}
        progress={progress}
        roadPalette={roadPalette}
        variant="playlist-launch"
      />
    </div>
  );
}
