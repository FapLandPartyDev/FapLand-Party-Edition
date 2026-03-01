export type IntermediarySelectionRange = {
  minPerTriggeredRound: number;
  maxPerTriggeredRound: number;
};

export function chooseIntermediaryCount(
  selection: IntermediarySelectionRange,
  randomValue = Math.random
): number {
  const minCount = Math.max(1, Math.min(5, Math.floor(selection.minPerTriggeredRound)));
  const maxCount = Math.max(minCount, Math.min(5, Math.floor(selection.maxPerTriggeredRound)));
  return minCount + Math.floor(randomValue() * (maxCount - minCount + 1));
}
