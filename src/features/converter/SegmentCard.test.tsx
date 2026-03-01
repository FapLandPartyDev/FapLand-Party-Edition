import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SegmentCard } from "./SegmentCard";
import type { SegmentCutMarkDraft, SegmentDraft } from "./types";

vi.mock("../../utils/audio", () => ({
  playSelectSound: vi.fn(),
}));

vi.mock("../../hooks/useSfwMode", () => ({
  useSfwMode: () => false,
}));

afterEach(() => {
  cleanup();
});

function makeSegment(overrides: Partial<SegmentDraft> = {}): SegmentDraft {
  return {
    id: "segment-1",
    startTimeMs: 59_195,
    endTimeMs: 60_534,
    cutRanges: [],
    type: "Normal",
    customName: "Hero - round 1",
    excludeFromNumbering: false,
    bpm: 90,
    difficulty: 3,
    bpmOverride: false,
    difficultyOverride: false,
    ...overrides,
  };
}

function renderSegmentCard({
  segment = makeSegment(),
  segmentCutMarks = { markInMs: null, markOutMs: null },
  currentTimeMs = 59_800,
}: {
  segment?: SegmentDraft;
  segmentCutMarks?: SegmentCutMarkDraft;
  currentTimeMs?: number;
} = {}) {
  const props = {
    segment,
    index: 0,
    ordinal: 1,
    isSelected: false,
    hasNext: true,
    heroName: "Hero",
    currentTimeMs,
    segmentCutMarks,
    onSelect: vi.fn(),
    onSeekToTimeline: vi.fn(),
    onJumpStart: vi.fn(),
    onJumpEnd: vi.fn(),
    onMergeWithNext: vi.fn(),
    onSetCutMarkIn: vi.fn(),
    onSetCutMarkOut: vi.fn(),
    onClearCutMarks: vi.fn(),
    onCutSegment: vi.fn(),
    onRemoveCut: vi.fn(),
    onJumpCutStart: vi.fn(),
    onJumpCutEnd: vi.fn(),
    onSetCustomName: vi.fn(),
    onSetExcludeFromNumbering: vi.fn(),
    onSetBpm: vi.fn(),
    onResetBpm: vi.fn(),
    onSetDifficulty: vi.fn(),
    onResetDifficulty: vi.fn(),
    onSetType: vi.fn(),
    onUpdateTiming: vi.fn(),
  };

  render(<SegmentCard {...props} />);
  return props;
}

describe("SegmentCard", () => {
  it("starts expanded and shows difficulty stars", () => {
    renderSegmentCard();

    expect(screen.getByText("Timing:")).toBeDefined();
    expect(screen.getByText("Difficulty:")).toBeDefined();
    expect(screen.getByRole("button", { name: "Set difficulty to 5 stars" })).toBeDefined();
  });

  it("maps star clicks to the existing difficulty setter", () => {
    const props = renderSegmentCard({
      segment: makeSegment({ difficulty: null }),
    });

    fireEvent.click(screen.getByRole("button", { name: "Set difficulty to 4 stars" }));

    expect(props.onSetDifficulty).toHaveBeenCalledWith("4");
  });

  it("shows and removes cuts", () => {
    const props = renderSegmentCard({
      segment: makeSegment({
        cutRanges: [{ id: "cut-1", startTimeMs: 59_500, endTimeMs: 59_900 }],
      }),
    });

    expect(screen.getByText("Cuts")).toBeDefined();
    fireEvent.click(screen.getByText("Delete"));

    expect(props.onRemoveCut).toHaveBeenCalledWith("cut-1");
  });

  it("renders the mini timeline with cut overlays and local marks", () => {
    renderSegmentCard({
      segment: makeSegment({
        cutRanges: [{ id: "cut-1", startTimeMs: 59_500, endTimeMs: 59_900 }],
      }),
      segmentCutMarks: {
        markInMs: 59_600,
        markOutMs: 60_100,
      },
    });

    expect(screen.getByLabelText("Segment cut overlay")).toBeDefined();
    expect(screen.getByLabelText("Local cut in")).toBeDefined();
    expect(screen.getByLabelText("Local cut out")).toBeDefined();
    expect(screen.getByText("IN 00:59.60")).toBeDefined();
    expect(screen.getByText("OUT 01:00.10")).toBeDefined();
  });

  it("shows the local playhead only while the global playhead is inside the segment", () => {
    const { rerender } = render(
      <SegmentCard
        segment={makeSegment()}
        index={0}
        ordinal={1}
        isSelected={false}
        hasNext={true}
        heroName="Hero"
        currentTimeMs={59_800}
        segmentCutMarks={{ markInMs: null, markOutMs: null }}
        onSelect={vi.fn()}
        onSeekToTimeline={vi.fn()}
        onJumpStart={vi.fn()}
        onJumpEnd={vi.fn()}
        onMergeWithNext={vi.fn()}
        onSetCutMarkIn={vi.fn()}
        onSetCutMarkOut={vi.fn()}
        onClearCutMarks={vi.fn()}
        onCutSegment={vi.fn()}
        onRemoveCut={vi.fn()}
        onJumpCutStart={vi.fn()}
        onJumpCutEnd={vi.fn()}
        onSetCustomName={vi.fn()}
        onSetExcludeFromNumbering={vi.fn()}
        onSetBpm={vi.fn()}
        onResetBpm={vi.fn()}
        onSetDifficulty={vi.fn()}
        onResetDifficulty={vi.fn()}
        onSetType={vi.fn()}
        onUpdateTiming={vi.fn()}
      />
    );

    expect(screen.getByLabelText("Segment playhead")).toBeDefined();

    rerender(
      <SegmentCard
        segment={makeSegment()}
        index={0}
        ordinal={1}
        isSelected={false}
        hasNext={true}
        heroName="Hero"
        currentTimeMs={61_000}
        segmentCutMarks={{ markInMs: null, markOutMs: null }}
        onSelect={vi.fn()}
        onSeekToTimeline={vi.fn()}
        onJumpStart={vi.fn()}
        onJumpEnd={vi.fn()}
        onMergeWithNext={vi.fn()}
        onSetCutMarkIn={vi.fn()}
        onSetCutMarkOut={vi.fn()}
        onClearCutMarks={vi.fn()}
        onCutSegment={vi.fn()}
        onRemoveCut={vi.fn()}
        onJumpCutStart={vi.fn()}
        onJumpCutEnd={vi.fn()}
        onSetCustomName={vi.fn()}
        onSetExcludeFromNumbering={vi.fn()}
        onSetBpm={vi.fn()}
        onResetBpm={vi.fn()}
        onSetDifficulty={vi.fn()}
        onResetDifficulty={vi.fn()}
        onSetType={vi.fn()}
        onUpdateTiming={vi.fn()}
      />
    );

    expect(screen.queryByLabelText("Segment playhead")).toBeNull();
  });

  it("seeks from the mini timeline and exposes local cut actions", () => {
    const props = renderSegmentCard();

    fireEvent.click(screen.getByLabelText("Segment timeline for round 1"), {
      clientX: 90,
    });
    fireEvent.click(screen.getByText("Set Cut IN"));
    fireEvent.click(screen.getByText("Set Cut OUT"));
    fireEvent.click(screen.getByText("Cut Segment"));
    fireEvent.click(screen.getByText("Clear Cut Marks"));

    expect(props.onSeekToTimeline).toHaveBeenCalled();
    expect(props.onSetCutMarkIn).toHaveBeenCalled();
    expect(props.onSetCutMarkOut).toHaveBeenCalled();
    expect(props.onCutSegment).toHaveBeenCalled();
    expect(props.onClearCutMarks).toHaveBeenCalled();
  });
});
