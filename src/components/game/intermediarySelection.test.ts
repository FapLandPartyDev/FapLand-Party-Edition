import { describe, expect, it } from "vitest";
import { chooseIntermediaryCount } from "./intermediarySelection";

describe("chooseIntermediaryCount", () => {
  it.each([
    [{ minPerTriggeredRound: 1, maxPerTriggeredRound: 1 }, [1]],
    [{ minPerTriggeredRound: 1, maxPerTriggeredRound: 3 }, [1, 2, 3]],
    [{ minPerTriggeredRound: 3, maxPerTriggeredRound: 3 }, [3]],
  ] as const)("only produces counts in %j", (range, expected) => {
    const samples = [0, 0.2, 0.49, 0.75, 0.999999].map((value) =>
      chooseIntermediaryCount(range, () => value)
    );
    expect(samples.every((value) => expected.includes(value as never))).toBe(true);
    expect(new Set(samples)).toEqual(new Set(expected));
  });
});
