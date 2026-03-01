import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Timeline } from "./Timeline";

vi.mock("../../utils/audio", () => ({
  playHoverSound: vi.fn(),
}));

vi.mock("../../hooks/useSfwMode", () => ({
  useSfwMode: () => false,
}));

describe("Timeline", () => {
  it("allows entering a zoom value manually", () => {
    const onZoomChange = vi.fn();

    render(
      <Timeline
        timelineScrollRef={{ current: null }}
        dragStateRef={{ current: null }}
        durationMs={10_000}
        currentTimeMs={2_000}
        markInMs={null}
        markOutMs={null}
        zoomPxPerSec={80}
        timelineWidthPx={1200}
        sortedSegments={[]}
        selectedSegmentId={null}
        funscriptActions={[]}
        onTimelineWheel={vi.fn()}
        onTimelinePointerDown={vi.fn()}
        onSelectSegment={vi.fn()}
        onZoomChange={onZoomChange}
      />,
    );

    const input = screen.getByLabelText("Timeline zoom");
    fireEvent.change(input, { target: { value: "123" } });
    fireEvent.blur(input);

    expect(onZoomChange).toHaveBeenCalledWith(123);
  });

  it("renders cut overlays", () => {
    render(
      <Timeline
        timelineScrollRef={{ current: null }}
        dragStateRef={{ current: null }}
        durationMs={10_000}
        currentTimeMs={2_000}
        markInMs={null}
        markOutMs={null}
        zoomPxPerSec={80}
        timelineWidthPx={1200}
        sortedSegments={[
          {
            id: "segment-1",
            startTimeMs: 1_000,
            endTimeMs: 8_000,
            cutRanges: [{ id: "cut-1", startTimeMs: 3_000, endTimeMs: 4_000 }],
            type: "Normal",
            customName: null,
            bpm: null,
            difficulty: null,
            bpmOverride: false,
            difficultyOverride: false,
          },
        ]}
        selectedSegmentId={null}
        funscriptActions={[]}
        onTimelineWheel={vi.fn()}
        onTimelinePointerDown={vi.fn()}
        onSelectSegment={vi.fn()}
        onZoomChange={vi.fn()}
      />,
    );

    expect(screen.getByLabelText("Cut range")).toBeDefined();
  });

  it("renders overlapping segments on separate lanes", () => {
    render(
      <Timeline
        timelineScrollRef={{ current: null }}
        dragStateRef={{ current: null }}
        durationMs={10_000}
        currentTimeMs={2_000}
        markInMs={null}
        markOutMs={null}
        zoomPxPerSec={80}
        timelineWidthPx={1200}
        sortedSegments={[
          {
            id: "segment-1",
            startTimeMs: 1_000,
            endTimeMs: 5_000,
            cutRanges: [],
            type: "Normal",
            customName: null,
            bpm: null,
            difficulty: null,
            bpmOverride: false,
            difficultyOverride: false,
          },
          {
            id: "segment-2",
            startTimeMs: 2_000,
            endTimeMs: 4_000,
            cutRanges: [],
            type: "Interjection",
            customName: null,
            bpm: null,
            difficulty: null,
            bpmOverride: false,
            difficultyOverride: false,
          },
        ]}
        selectedSegmentId={null}
        funscriptActions={[]}
        onTimelineWheel={vi.fn()}
        onTimelinePointerDown={vi.fn()}
        onSelectSegment={vi.fn()}
        onZoomChange={vi.fn()}
      />,
    );

    expect(screen.getByTitle("Normal • 00:01.00-00:05.00").getAttribute("data-segment-lane")).toBe(
      "0",
    );
    expect(
      screen.getByTitle("Interjection • 00:02.00-00:04.00").getAttribute("data-segment-lane"),
    ).toBe("1");
  });

  it("renders adjacent segments on the same lane", () => {
    render(
      <Timeline
        timelineScrollRef={{ current: null }}
        dragStateRef={{ current: null }}
        durationMs={10_000}
        currentTimeMs={2_000}
        markInMs={null}
        markOutMs={null}
        zoomPxPerSec={80}
        timelineWidthPx={1200}
        sortedSegments={[
          {
            id: "segment-1",
            startTimeMs: 1_000,
            endTimeMs: 2_000,
            cutRanges: [],
            type: "Normal",
            customName: null,
            bpm: null,
            difficulty: null,
            bpmOverride: false,
            difficultyOverride: false,
          },
          {
            id: "segment-2",
            startTimeMs: 2_000,
            endTimeMs: 4_000,
            cutRanges: [],
            type: "Cum",
            customName: null,
            bpm: null,
            difficulty: null,
            bpmOverride: false,
            difficultyOverride: false,
          },
        ]}
        selectedSegmentId={null}
        funscriptActions={[]}
        onTimelineWheel={vi.fn()}
        onTimelinePointerDown={vi.fn()}
        onSelectSegment={vi.fn()}
        onZoomChange={vi.fn()}
      />,
    );

    expect(screen.getByTitle("Normal • 00:01.00-00:02.00").getAttribute("data-segment-lane")).toBe(
      "0",
    );
    expect(screen.getByTitle("Cum • 00:02.00-00:04.00").getAttribute("data-segment-lane")).toBe(
      "0",
    );
  });
});
