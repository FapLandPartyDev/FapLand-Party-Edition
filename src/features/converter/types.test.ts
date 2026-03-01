import { describe, expect, it } from "vitest";
import {
  assignSegmentLanes,
  assignSegmentOrdinals,
  validateSegments,
  type SegmentDraft,
} from "./types";

function makeSegment(id: string, startTimeMs: number, endTimeMs: number): SegmentDraft {
  return {
    id,
    startTimeMs,
    endTimeMs,
    cutRanges: [],
    type: "Normal",
    customName: null,
    excludeFromNumbering: false,
    bpm: null,
    difficulty: null,
    bpmOverride: false,
    difficultyOverride: false,
  };
}

describe("converter segment helpers", () => {
  it("rejects overlapping segments by default", () => {
    expect(
      validateSegments([makeSegment("one", 0, 3_000), makeSegment("two", 2_000, 4_000)], 5_000)
    ).toBe("Segments must not overlap.");
  });

  it("accepts overlapping segments when enabled", () => {
    expect(
      validateSegments([makeSegment("one", 0, 3_000), makeSegment("two", 2_000, 4_000)], 5_000, {
        allowOverlaps: true,
      })
    ).toBeNull();
  });

  it("puts adjacent segments on the primary lane", () => {
    expect(
      assignSegmentLanes([makeSegment("one", 0, 1_000), makeSegment("two", 1_000, 2_000)]).map(
        (entry) => [entry.segment.id, entry.lane]
      )
    ).toEqual([
      ["one", 0],
      ["two", 0],
    ]);
  });

  it("uses compact secondary and tertiary lanes for overlaps", () => {
    expect(
      assignSegmentLanes([
        makeSegment("one", 0, 5_000),
        makeSegment("two", 1_000, 4_000),
        makeSegment("three", 2_000, 3_000),
        makeSegment("four", 5_000, 6_000),
      ]).map((entry) => [entry.segment.id, entry.lane])
    ).toEqual([
      ["one", 0],
      ["two", 1],
      ["three", 2],
      ["four", 0],
    ]);
  });

  it("does not advance ordinals for excluded segments", () => {
    const first = makeSegment("one", 0, 1_000);
    const interjection = {
      ...makeSegment("interjection", 1_000, 2_000),
      excludeFromNumbering: true,
    };
    const second = makeSegment("two", 2_000, 3_000);

    expect(
      assignSegmentOrdinals([second, interjection, first]).map(({ segment, ordinal }) => [
        segment.id,
        ordinal,
      ])
    ).toEqual([
      ["one", 1],
      ["interjection", null],
      ["two", 2],
    ]);
  });
});
