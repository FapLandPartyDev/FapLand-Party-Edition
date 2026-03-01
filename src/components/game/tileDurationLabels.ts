import type { InstalledRound } from "../../services/db";
import type { BoardField } from "../../game/types";
import { formatDurationLabel, getRoundDurationSec } from "../../utils/duration";

export function buildTileDurationLabelByFieldId(
  board: ReadonlyArray<BoardField>,
  installedRounds: ReadonlyArray<InstalledRound>
): Map<string, string> {
  const durationLabelByRoundId = new Map<string, string>();

  for (const round of installedRounds) {
    const durationSec = getRoundDurationSec(round);
    if (durationSec <= 0) continue;
    durationLabelByRoundId.set(round.id, formatDurationLabel(durationSec));
  }

  const labels = new Map<string, string>();
  for (const field of board) {
    if (!field.fixedRoundId) continue;
    const durationLabel = durationLabelByRoundId.get(field.fixedRoundId);
    if (!durationLabel) continue;
    labels.set(field.id, durationLabel);
  }

  return labels;
}
