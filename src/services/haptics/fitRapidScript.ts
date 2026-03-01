import type { FunscriptAction } from "../../game/media/playback";

/** Fit rapid passages as a moving center and alternating excursions to retain their reversals. */
export function fitRapidScript(
  source: FunscriptAction[],
  rate: number,
  limit: number
): FunscriptAction[] {
  const turns = source;
  let min = 100;
  let max = 0;
  for (const action of turns) {
    min = Math.min(min, action.pos);
    max = Math.max(max, action.pos);
  }
  if (max === min) return source;
  const output = turns.map((action) => ({ ...action }));
  const travel = (left: FunscriptAction, right: FunscriptAction) =>
    ((right.at - left.at) * limit) / (1000 * rate);
  // Detect cadence from actual direction changes, not from easing sample density.
  const motionIndices = turns.flatMap((point, index) =>
    index === 0 ||
    index === turns.length - 1 ||
    (point.pos - turns[index - 1]!.pos) * (turns[index + 1]!.pos - point.pos) <= 0
      ? [index]
      : []
  );
  const motion = motionIndices.map((index) => turns[index]!);
  const budgets = motion.slice(1).map((point, index) => {
    const before = motion[index]!;
    let budget = travel(before, point);
    const distance = Math.abs(point.pos - before.pos);
    for (let sample = motionIndices[index]! + 1; sample <= motionIndices[index + 1]!; sample += 1) {
      const delta = Math.abs(turns[sample]!.pos - turns[sample - 1]!.pos);
      if (delta > 0)
        budget = Math.min(budget, (travel(turns[sample - 1]!, turns[sample]!) * distance) / delta);
    }
    return budget;
  });
  const fastEdges = motion.slice(1).map((action, index) => {
    const before = motion[index]!;
    return (
      action.pos !== before.pos &&
      ((action.at - before.at) / rate <= 160 || Math.abs(action.pos - before.pos) > budgets[index]!)
    );
  });
  // Reserve most of the speed budget for the vibration itself. Independent
  // peak contraction followed by causal clipping can erase reversals.
  for (let start = 0; start < motion.length; start += 1) {
    if (!fastEdges[start]) continue;
    let end = start;
    while (end + 1 < motion.length && fastEdges[end]) end += 1;
    const centers: number[] = [];
    const amplitudes: number[] = [];
    for (let index = start; index <= end; index += 1) {
      const current = motion[index]!;
      const before = motion[Math.max(start, index - 1)]!;
      const after = motion[Math.min(end, index + 1)]!;
      const neighbor = index === start ? after : before;
      const room = Math.min(
        index > start ? budgets[index - 1]! : Infinity,
        index < end ? budgets[index]! : Infinity
      );
      const excursion = Math.min(
        index > start ? Math.abs(current.pos - before.pos) : Infinity,
        index < end ? Math.abs(after.pos - current.pos) : Infinity
      );
      amplitudes.push(Math.min(excursion / 2, room * 0.42));
      centers.push((current.pos + neighbor.pos) / 2);
    }
    const margin = amplitudes.reduce((largest, amplitude) => Math.max(largest, amplitude), 0);
    const centerBudget = (offset: number) =>
      Math.min(
        budgets[start + offset - 1]! * 0.12,
        (amplitudes[offset - 1]! + amplitudes[offset]!) * 0.12
      );
    const startsAtHold = motion[start - 1]?.pos === motion[start]!.pos;
    const endsAtHold = motion[end + 1]?.pos === motion[end]!.pos;
    const startCenter =
      motion[start]!.pos - Math.sign(motion[start]!.pos - motion[start + 1]!.pos) * amplitudes[0]!;
    const endCenter =
      motion[end]!.pos - Math.sign(motion[end]!.pos - motion[end - 1]!.pos) * amplitudes.at(-1)!;
    for (let offset = 0; offset < centers.length; offset += 1) {
      centers[offset] = Math.max(min + margin, Math.min(max - margin, centers[offset]!));
      if (offset === 0 && startsAtHold) centers[offset] = startCenter;
      if (offset === 0) continue;
      const budget = centerBudget(offset);
      centers[offset] = Math.max(
        centers[offset - 1]! - budget,
        Math.min(centers[offset - 1]! + budget, centers[offset]!)
      );
    }
    if (endsAtHold) {
      centers[centers.length - 1] = endCenter;
      for (let offset = centers.length - 2; offset >= 0; offset -= 1) {
        const budget = centerBudget(offset + 1);
        centers[offset] = Math.max(
          centers[offset + 1]! - budget,
          Math.min(centers[offset + 1]! + budget, centers[offset]!)
        );
      }
    }
    for (let index = start; index <= end; index += 1) {
      const current = motion[index]!;
      // Hold boundaries remain authored anchors.
      if (motion[index - 1]?.pos === current.pos || motion[index + 1]?.pos === current.pos)
        continue;
      const offset = index - start;
      const direction =
        index === start
          ? Math.sign(current.pos - motion[index + 1]!.pos)
          : Math.sign(current.pos - motion[index - 1]!.pos);
      const target = centers[offset]! + direction * amplitudes[offset]!;
      output[motionIndices[index]!]!.pos = target;
    }
    for (let index = start; index < end; index += 1) {
      const first = motionIndices[index]!;
      const last = motionIndices[index + 1]!;
      for (let sample = first + 1; sample < last; sample += 1) {
        const fraction =
          (turns[sample]!.pos - turns[first]!.pos) / (turns[last]!.pos - turns[first]!.pos);
        output[sample]!.pos =
          output[first]!.pos + fraction * (output[last]!.pos - output[first]!.pos);
      }
    }
    start = end;
  }

  return output;
}
