import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CONVERTER_MIN_ROUND_KEY,
  CONVERTER_PAUSE_GAP_KEY,
  CONVERTER_ZOOM_KEY,
  MIN_ZOOM_PX_PER_SEC,
} from "./types";

const mocks = vi.hoisted(() => ({
  db: {
    hero: {
      findMany: vi.fn(),
    },
    round: {
      findInstalled: vi.fn(),
    },
  },
  storeGet: vi.fn(),
  storeSet: vi.fn(),
  converterSaveSegments: vi.fn(),
  loadFunscriptTimeline: vi.fn().mockResolvedValue(null),
  buildDetectedSegments: vi.fn<(...args: unknown[]) => unknown[]>(() => []),
}));

vi.mock("../../services/db", () => ({
  db: mocks.db,
}));

vi.mock("../../services/trpc", () => ({
  trpc: {
    store: {
      get: {
        query: mocks.storeGet,
      },
      set: {
        mutate: mocks.storeSet,
      },
    },
  },
}));

vi.mock("../../utils/audio", () => ({
  playConverterAutoDetectSound: vi.fn(),
  playConverterMarkInSound: vi.fn(),
  playConverterMarkOutSound: vi.fn(),
  playConverterSaveSuccessSound: vi.fn(),
  playConverterSegmentAddSound: vi.fn(),
  playConverterSegmentDeleteSound: vi.fn(),
  playConverterValidationErrorSound: vi.fn(),
  playConverterZoomSound: vi.fn(),
  playSelectSound: vi.fn(),
}));

vi.mock("../../game/media/playback", () => ({
  loadFunscriptTimeline: mocks.loadFunscriptTimeline,
}));

vi.mock("../../services/converter", () => ({
  converter: {
    saveSegments: mocks.converterSaveSegments,
  },
}));

vi.mock("./detection", () => ({
  buildDetectedSegments: mocks.buildDetectedSegments,
}));

vi.mock("./metadata", () => ({
  applyAutoMetadataToSegments: vi.fn((segments: unknown) => segments),
}));

vi.mock("./shortcuts", () => ({
  CONVERTER_SHORTCUTS: [
    {
      matches: (event: KeyboardEvent) => event.key === "k" || event.key === "K",
      trigger: (context: { splitSegmentAtPlayhead: () => void }) => context.splitSegmentAtPlayhead(),
    },
    {
      matches: (event: KeyboardEvent) => event.key === "n" && !event.shiftKey,
      trigger: (context: { selectNextSegment: () => void }) => context.selectNextSegment(),
    },
    {
      matches: (event: KeyboardEvent) => event.key === "N" && event.shiftKey,
      trigger: (context: { selectPreviousSegment: () => void }) => context.selectPreviousSegment(),
    },
    {
      matches: (event: KeyboardEvent) => event.key === "p" || event.key === "P",
      trigger: (context: { selectSegmentAtPlayhead: () => void }) => context.selectSegmentAtPlayhead(),
    },
    {
      matches: (event: KeyboardEvent) => event.key === "End",
      trigger: (context: { seekToSelectedSegmentEnd: () => void }) => context.seekToSelectedSegmentEnd(),
    },
    {
      matches: (event: KeyboardEvent) => event.key === "Home",
      trigger: (context: { seekToSelectedSegmentStart: () => void }) => context.seekToSelectedSegmentStart(),
    },
    {
      matches: (event: KeyboardEvent) => event.key === "s" && !event.ctrlKey && !event.metaKey,
      trigger: (context: { moveSelectedSegmentStartToPlayhead: () => void }) =>
        context.moveSelectedSegmentStartToPlayhead(),
    },
    {
      matches: (event: KeyboardEvent) => event.key === "e" || event.key === "E",
      trigger: (context: { moveSelectedSegmentEndToPlayhead: () => void }) =>
        context.moveSelectedSegmentEndToPlayhead(),
    },
    {
      matches: (event: KeyboardEvent) => event.key === "m" || event.key === "M",
      trigger: (context: { mergeSelectedSegmentWithNext: () => void }) =>
        context.mergeSelectedSegmentWithNext(),
    },
    {
      matches: (event: KeyboardEvent) => event.key === "a" && !event.shiftKey,
      trigger: (context: { runAutoDetect: () => void }) => context.runAutoDetect(),
    },
    {
      matches: (event: KeyboardEvent) => event.key === "A" && event.shiftKey,
      trigger: (context: { applyDetectedSuggestions: () => void }) =>
        context.applyDetectedSuggestions(),
    },
    {
      matches: (event: KeyboardEvent) => event.key === "s" && (event.ctrlKey || event.metaKey),
      trigger: (context: { saveConvertedRounds: () => void }) => context.saveConvertedRounds(),
    },
    {
      matches: (event: KeyboardEvent) => event.key === "Escape",
      trigger: (context: { clearTransientEditorState: () => void }) =>
        context.clearTransientEditorState(),
    },
    {
      matches: (event: KeyboardEvent) => event.key === "?",
      trigger: (context: { toggleHotkeys: () => void }) => context.toggleHotkeys(),
    },
  ],
}));

vi.mock("../../hooks/usePlayableVideoFallback", () => ({
  usePlayableVideoFallback: () => ({
    getVideoSrc: (uri: string) => uri,
    ensurePlayableVideo: vi.fn(),
    handleVideoError: vi.fn(),
  }),
}));

import { useConverterState } from "./useConverterState";

function makeInstalledRound(
  id: string,
  overrides: Partial<Record<string, unknown>> = {}
): Record<string, unknown> {
  const now = new Date("2026-01-01T00:00:00.000Z");
  return {
    id,
    name: `Round ${id}`,
    author: null,
    description: null,
    type: "Normal",
    bpm: null,
    difficulty: null,
    startTime: 0,
    endTime: 1_000,
    heroId: null,
    hero: null,
    resources: [
      {
        id: `resource-${id}`,
        videoUri: "file:///tmp/source.mp4",
        funscriptUri: null,
        disabled: false,
      },
    ],
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe("useConverterState", () => {
  beforeEach(() => {
    mocks.db.hero.findMany.mockResolvedValue([]);
    mocks.db.round.findInstalled.mockResolvedValue([]);
    mocks.storeSet.mockResolvedValue(null);
    mocks.converterSaveSegments.mockResolvedValue({
      stats: { created: 1, updated: 0 },
      removedSourceRound: false,
    });
    mocks.loadFunscriptTimeline.mockResolvedValue(null);
    mocks.buildDetectedSegments.mockReturnValue([]);
    mocks.storeGet.mockImplementation(async ({ key }: { key: string }) => {
      if (key === CONVERTER_ZOOM_KEY) return "1";
      if (key === CONVERTER_PAUSE_GAP_KEY) return null;
      if (key === CONVERTER_MIN_ROUND_KEY) return null;
      return null;
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("clamps persisted zoom to the lower converter zoom floor", async () => {
    const { result } = renderHook(() => useConverterState({ sourceRoundId: "", heroName: "" }));

    await waitFor(() => {
      expect(result.current.zoomPxPerSec).toBe(MIN_ZOOM_PX_PER_SEC);
    });
  });

  it("keeps a funscript attached before selecting a local video file", async () => {
    window.electronAPI = {
      file: {
        convertFileSrc: vi.fn((path: string) => `app://media/${encodeURIComponent(path)}`),
      },
      dialog: {
        selectConverterVideoFile: vi.fn().mockResolvedValue("/tmp/source.mp4"),
        selectConverterFunscriptFile: vi.fn().mockResolvedValue("/tmp/source.funscript"),
      },
    } as unknown as typeof window.electronAPI;

    const { result } = renderHook(() => useConverterState({ sourceRoundId: "", heroName: "" }));

    await waitFor(() => {
      expect(result.current.zoomPxPerSec).toBe(MIN_ZOOM_PX_PER_SEC);
    });

    await act(async () => {
      await result.current.attachLocalFunscript();
    });

    expect(result.current.funscriptUri).toBe("app://media/%2Ftmp%2Fsource.funscript");

    await act(async () => {
      await result.current.selectLocalAndEdit();
    });

    expect(result.current.step).toBe("edit");
    expect(result.current.videoUri).toBe("app://media/%2Ftmp%2Fsource.mp4");
    expect(result.current.funscriptUri).toBe("app://media/%2Ftmp%2Fsource.funscript");
    expect(result.current.message).toBe("Local video loaded. Add funscript for auto-detection.");
  });

  it("splits the segment under the playhead when pressing k", async () => {
    const { result } = renderHook(() => useConverterState({ sourceRoundId: "", heroName: "" }));

    await waitFor(() => {
      expect(result.current.zoomPxPerSec).toBe(MIN_ZOOM_PX_PER_SEC);
    });

    act(() => {
      result.current.setDurationMs(10_000);
      result.current.setMarkInMs(1_000);
      result.current.setMarkOutMs(5_000);
    });

    act(() => {
      result.current.addSegmentFromMarks();
    });

    act(() => {
      result.current.setCurrentTimeMs(3_000);
    });

    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "k" }));
    });

    expect(result.current.sortedSegments).toHaveLength(2);
    expect(
      result.current.sortedSegments.map((segment) => [segment.startTimeMs, segment.endTimeMs])
    ).toEqual([
      [1_000, 3_000],
      [3_000, 5_000],
    ]);
    expect(result.current.selectedSegmentId).toBe(result.current.sortedSegments[1]?.id ?? null);
    expect(result.current.message).toBe("Split segment at 00:03.00.");
    expect(result.current.error).toBeNull();
  });

  it("adds a cut from marks to the selected segment", async () => {
    const { result } = renderHook(() => useConverterState({ sourceRoundId: "", heroName: "" }));

    await waitFor(() => {
      expect(result.current.zoomPxPerSec).toBe(MIN_ZOOM_PX_PER_SEC);
    });

    act(() => {
      result.current.setDurationMs(10_000);
      result.current.setMarkInMs(1_000);
      result.current.setMarkOutMs(8_000);
    });

    act(() => {
      result.current.addSegmentFromMarks();
    });

    act(() => {
      result.current.setMarkInMs(3_000);
      result.current.setMarkOutMs(4_000);
    });

    act(() => {
      result.current.addCutFromMarks();
    });

    expect(result.current.sortedSegments[0]?.cutRanges).toMatchObject([
      { startTimeMs: 3_000, endTimeMs: 4_000 },
    ]);
    expect(result.current.message).toBe("Cut added (00:03.00 - 00:04.00).");
    expect(result.current.error).toBeNull();
  });

  it("rejects overlapping segments while overlap mode is off", async () => {
    const { result } = renderHook(() => useConverterState({ sourceRoundId: "", heroName: "" }));

    await waitFor(() => {
      expect(result.current.zoomPxPerSec).toBe(MIN_ZOOM_PX_PER_SEC);
    });

    act(() => {
      result.current.setDurationMs(10_000);
      result.current.setMarkInMs(1_000);
      result.current.setMarkOutMs(5_000);
    });

    act(() => {
      result.current.addSegmentFromMarks();
    });

    act(() => {
      result.current.setMarkInMs(3_000);
      result.current.setMarkOutMs(7_000);
    });

    act(() => {
      result.current.addSegmentFromMarks();
    });

    expect(result.current.sortedSegments).toHaveLength(1);
    expect(result.current.error).toBe("Segments must not overlap.");
  });

  it("adds overlapping segments while overlap mode is on", async () => {
    const { result } = renderHook(() => useConverterState({ sourceRoundId: "", heroName: "" }));

    await waitFor(() => {
      expect(result.current.zoomPxPerSec).toBe(MIN_ZOOM_PX_PER_SEC);
    });

    act(() => {
      result.current.setAllowOverlappingSegments(true);
      result.current.setDurationMs(10_000);
      result.current.setMarkInMs(1_000);
      result.current.setMarkOutMs(5_000);
    });

    act(() => {
      result.current.addSegmentFromMarks();
    });

    act(() => {
      result.current.setMarkInMs(3_000);
      result.current.setMarkOutMs(7_000);
    });

    act(() => {
      result.current.addSegmentFromMarks();
    });

    expect(result.current.sortedSegments.map((segment) => [segment.startTimeMs, segment.endTimeMs]))
      .toEqual([
        [1_000, 5_000],
        [3_000, 7_000],
      ]);
    expect(result.current.error).toBeNull();
  });

  it("skips cuts while preview playback is running", async () => {
    const { result } = renderHook(() => useConverterState({ sourceRoundId: "", heroName: "" }));

    await waitFor(() => {
      expect(result.current.zoomPxPerSec).toBe(MIN_ZOOM_PX_PER_SEC);
    });

    const video = {
      currentTime: 0,
      paused: false,
    } as HTMLVideoElement;

    act(() => {
      result.current.videoRef.current = video;
      result.current.setDurationMs(10_000);
      result.current.setMarkInMs(1_000);
      result.current.setMarkOutMs(8_000);
    });

    act(() => {
      result.current.addSegmentFromMarks();
    });

    act(() => {
      result.current.setMarkInMs(3_000);
      result.current.setMarkOutMs(4_000);
    });

    act(() => {
      result.current.addCutFromMarks();
    });

    act(() => {
      result.current.syncPreviewTimeMs(3_250);
    });

    expect(video.currentTime).toBe(4);
    expect(result.current.currentTimeMs).toBe(4_000);
  });

  it("trims the selected segment when a cut reaches its start", async () => {
    const { result } = renderHook(() => useConverterState({ sourceRoundId: "", heroName: "" }));

    await waitFor(() => {
      expect(result.current.zoomPxPerSec).toBe(MIN_ZOOM_PX_PER_SEC);
    });

    act(() => {
      result.current.setDurationMs(10_000);
      result.current.setMarkInMs(2_000);
      result.current.setMarkOutMs(8_000);
    });

    act(() => {
      result.current.addSegmentFromMarks();
    });

    act(() => {
      result.current.setMarkInMs(1_000);
      result.current.setMarkOutMs(3_000);
    });

    act(() => {
      result.current.addCutFromMarks();
    });

    expect(result.current.sortedSegments[0]?.startTimeMs).toBe(3_000);
    expect(result.current.sortedSegments[0]?.endTimeMs).toBe(8_000);
    expect(result.current.sortedSegments[0]?.cutRanges).toEqual([]);
    expect(result.current.error).toBeNull();
  });

  it("removes the selected segment when a cut covers it completely", async () => {
    const { result } = renderHook(() => useConverterState({ sourceRoundId: "", heroName: "" }));

    await waitFor(() => {
      expect(result.current.zoomPxPerSec).toBe(MIN_ZOOM_PX_PER_SEC);
    });

    act(() => {
      result.current.setDurationMs(10_000);
      result.current.setMarkInMs(2_000);
      result.current.setMarkOutMs(8_000);
    });

    act(() => {
      result.current.addSegmentFromMarks();
    });

    act(() => {
      result.current.addCutFromMarks();
    });

    expect(result.current.sortedSegments).toEqual([]);
    expect(result.current.message).toBe("Segment cut out (00:02.00 - 00:08.00).");
    expect(result.current.error).toBeNull();
  });

  it("selects the next and previous segment with wrapping", async () => {
    const { result } = renderHook(() => useConverterState({ sourceRoundId: "", heroName: "" }));

    await waitFor(() => {
      expect(result.current.zoomPxPerSec).toBe(MIN_ZOOM_PX_PER_SEC);
    });

    act(() => {
      result.current.setDurationMs(10_000);
      result.current.setMarkInMs(1_000);
      result.current.setMarkOutMs(2_000);
    });

    act(() => {
      result.current.addSegmentFromMarks();
    });

    act(() => {
      result.current.setMarkInMs(4_000);
      result.current.setMarkOutMs(5_000);
    });

    act(() => {
      result.current.addSegmentFromMarks();
    });

    const firstId = result.current.sortedSegments[0]?.id ?? null;
    const secondId = result.current.sortedSegments[1]?.id ?? null;
    expect(result.current.selectedSegmentId).toBe(secondId);

    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "n" }));
    });
    expect(result.current.selectedSegmentId).toBe(firstId);

    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "N", shiftKey: true }));
    });
    expect(result.current.selectedSegmentId).toBe(secondId);
  });

  it("selects the segment under the playhead with p", async () => {
    const { result } = renderHook(() => useConverterState({ sourceRoundId: "", heroName: "" }));

    await waitFor(() => {
      expect(result.current.zoomPxPerSec).toBe(MIN_ZOOM_PX_PER_SEC);
    });

    act(() => {
      result.current.setDurationMs(10_000);
      result.current.setMarkInMs(1_000);
      result.current.setMarkOutMs(3_000);
    });

    act(() => {
      result.current.addSegmentFromMarks();
    });

    act(() => {
      result.current.setSelectedSegmentId(null);
      result.current.setCurrentTimeMs(2_500);
    });

    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "p" }));
    });

    expect(result.current.selectedSegmentId).toBe(result.current.sortedSegments[0]?.id ?? null);
    expect(result.current.error).toBeNull();
  });

  it("jumps to the selected segment boundaries with home and end", async () => {
    const { result } = renderHook(() => useConverterState({ sourceRoundId: "", heroName: "" }));

    await waitFor(() => {
      expect(result.current.zoomPxPerSec).toBe(MIN_ZOOM_PX_PER_SEC);
    });

    act(() => {
      result.current.setDurationMs(10_000);
      result.current.setMarkInMs(1_000);
      result.current.setMarkOutMs(4_000);
    });

    act(() => {
      result.current.addSegmentFromMarks();
    });

    act(() => {
      result.current.setCurrentTimeMs(2_500);
    });

    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "End" }));
    });
    expect(result.current.currentTimeMs).toBe(4_000);

    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Home" }));
    });
    expect(result.current.currentTimeMs).toBe(1_000);
  });

  it("moves selected segment boundaries to the playhead with s and e", async () => {
    const { result } = renderHook(() => useConverterState({ sourceRoundId: "", heroName: "" }));

    await waitFor(() => {
      expect(result.current.zoomPxPerSec).toBe(MIN_ZOOM_PX_PER_SEC);
    });

    act(() => {
      result.current.setDurationMs(10_000);
      result.current.setMarkInMs(1_000);
      result.current.setMarkOutMs(4_000);
    });

    act(() => {
      result.current.addSegmentFromMarks();
    });

    act(() => {
      result.current.setCurrentTimeMs(2_000);
    });

    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "s" }));
    });

    expect(result.current.sortedSegments[0]).toMatchObject({
      startTimeMs: 2_000,
      endTimeMs: 4_000,
    });

    act(() => {
      result.current.setCurrentTimeMs(3_500);
    });

    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "e" }));
    });

    expect(result.current.sortedSegments[0]).toMatchObject({
      startTimeMs: 2_000,
      endTimeMs: 3_500,
    });
  });

  it("allows boundary shortcuts to cross neighboring segments only when overlap mode is on", async () => {
    const { result } = renderHook(() => useConverterState({ sourceRoundId: "", heroName: "" }));

    await waitFor(() => {
      expect(result.current.zoomPxPerSec).toBe(MIN_ZOOM_PX_PER_SEC);
    });

    act(() => {
      result.current.setDurationMs(10_000);
      result.current.setMarkInMs(1_000);
      result.current.setMarkOutMs(3_000);
    });

    act(() => {
      result.current.addSegmentFromMarks();
    });

    act(() => {
      result.current.setMarkInMs(5_000);
      result.current.setMarkOutMs(7_000);
    });

    act(() => {
      result.current.addSegmentFromMarks();
    });

    act(() => {
      result.current.setSelectedSegmentId(result.current.sortedSegments[1]?.id ?? null);
      result.current.setCurrentTimeMs(2_000);
    });

    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "s" }));
    });

    expect(result.current.sortedSegments[1]).toMatchObject({
      startTimeMs: 3_000,
      endTimeMs: 7_000,
    });

    act(() => {
      result.current.setAllowOverlappingSegments(true);
      result.current.setCurrentTimeMs(2_000);
    });

    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "s" }));
    });

    expect(result.current.sortedSegments[1]).toMatchObject({
      startTimeMs: 2_000,
      endTimeMs: 7_000,
    });
  });

  it("merges the selected segment with the next one when pressing m", async () => {
    const { result } = renderHook(() => useConverterState({ sourceRoundId: "", heroName: "" }));

    await waitFor(() => {
      expect(result.current.zoomPxPerSec).toBe(MIN_ZOOM_PX_PER_SEC);
    });

    act(() => {
      result.current.setDurationMs(10_000);
      result.current.setMarkInMs(1_000);
      result.current.setMarkOutMs(2_000);
    });

    act(() => {
      result.current.addSegmentFromMarks();
    });

    act(() => {
      result.current.setMarkInMs(2_000);
      result.current.setMarkOutMs(4_000);
    });

    act(() => {
      result.current.addSegmentFromMarks();
    });

    act(() => {
      result.current.setSelectedSegmentId(result.current.sortedSegments[0]?.id ?? null);
    });

    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "m" }));
    });

    expect(result.current.sortedSegments).toHaveLength(1);
    expect(result.current.sortedSegments[0]).toMatchObject({
      startTimeMs: 1_000,
      endTimeMs: 4_000,
    });
  });

  it("runs and applies auto-detection shortcuts", async () => {
    mocks.loadFunscriptTimeline.mockResolvedValue({ actions: [{ at: 1000, pos: 50 }] });
    mocks.buildDetectedSegments.mockReturnValue([
      {
        id: "detected-1",
        startTimeMs: 1_000,
        endTimeMs: 3_000,
        type: "Normal",
        bpm: null,
        difficulty: null,
        bpmOverride: false,
        difficultyOverride: false,
      },
    ]);

    const { result } = renderHook(() => useConverterState({ sourceRoundId: "", heroName: "" }));

    await waitFor(() => {
      expect(result.current.zoomPxPerSec).toBe(MIN_ZOOM_PX_PER_SEC);
    });

    act(() => {
      result.current.setDurationMs(10_000);
      result.current.setFunscriptUri("file:///tmp/test.funscript");
    });

    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "a" }));
    });

    await waitFor(() => {
      expect(mocks.buildDetectedSegments).toHaveBeenCalled();
    });

    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "A", shiftKey: true }));
    });

    expect(result.current.sortedSegments).toHaveLength(1);
  });

  it("saves converted rounds with ctrl/cmd+s", async () => {
    const { result } = renderHook(() => useConverterState({ sourceRoundId: "", heroName: "" }));

    await waitFor(() => {
      expect(result.current.zoomPxPerSec).toBe(MIN_ZOOM_PX_PER_SEC);
    });

    act(() => {
      result.current.setDurationMs(10_000);
      result.current.setHeroName("Hero");
      result.current.setCurrentTimeMs(0);
      result.current.setMarkInMs(1_000);
      result.current.setMarkOutMs(3_000);
    });

    act(() => {
      result.current.addSegmentFromMarks();
    });

    act(() => {
      result.current.setVideoUri("file:///tmp/test.mp4");
    });

    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "s", ctrlKey: true }));
    });

    await waitFor(() => {
      expect(mocks.converterSaveSegments).toHaveBeenCalled();
    });
  });

  it("sends overlap mode when saving", async () => {
    const { result } = renderHook(() => useConverterState({ sourceRoundId: "", heroName: "" }));

    await waitFor(() => {
      expect(result.current.zoomPxPerSec).toBe(MIN_ZOOM_PX_PER_SEC);
    });

    act(() => {
      result.current.setAllowOverlappingSegments(true);
      result.current.setDurationMs(10_000);
      result.current.setHeroName("Hero");
      result.current.setVideoUri("file:///tmp/test.mp4");
      result.current.setMarkInMs(1_000);
      result.current.setMarkOutMs(3_000);
    });

    act(() => {
      result.current.addSegmentFromMarks();
    });

    await act(async () => {
      await result.current.saveConvertedRounds();
    });

    const input = mocks.converterSaveSegments.mock.calls.at(-1)?.[0];
    expect(input.allowOverlaps).toBe(true);
  });

  it("sends every loaded hero source round when saving a merged hero edit", async () => {
    mocks.db.hero.findMany.mockResolvedValue([
      { id: "hero-1", name: "Millionaire", author: "Host", description: "Quiz" },
    ]);
    mocks.db.round.findInstalled.mockResolvedValue([
      makeInstalledRound("round-1", {
        heroId: "hero-1",
        hero: { id: "hero-1", name: "Millionaire", author: "Host", description: "Quiz" },
        name: "Round 1",
        startTime: 0,
        endTime: 1_000,
      }),
      makeInstalledRound("round-2", {
        heroId: "hero-1",
        hero: { id: "hero-1", name: "Millionaire", author: "Host", description: "Quiz" },
        name: "Round 2",
        startTime: 1_000,
        endTime: 2_000,
      }),
      makeInstalledRound("round-3", {
        heroId: "hero-1",
        hero: { id: "hero-1", name: "Millionaire", author: "Host", description: "Quiz" },
        name: "Round 3",
        startTime: 2_000,
        endTime: 3_000,
      }),
      makeInstalledRound("round-4", {
        heroId: "hero-1",
        hero: { id: "hero-1", name: "Millionaire", author: "Host", description: "Quiz" },
        name: "Round 4",
        startTime: 3_000,
        endTime: 4_000,
      }),
    ]);

    const { result } = renderHook(() => useConverterState({ sourceRoundId: "", heroName: "" }));

    await waitFor(() => {
      expect(result.current.zoomPxPerSec).toBe(MIN_ZOOM_PX_PER_SEC);
    });

    await act(async () => {
      await result.current.selectHeroAndEdit("hero-1");
    });

    act(() => {
      result.current.setDurationMs(4_000);
    });

    act(() => {
      result.current.mergeSegmentWithNext(result.current.sortedSegments[0]?.id ?? "");
    });

    await act(async () => {
      await result.current.saveConvertedRounds();
    });

    await waitFor(() => {
      expect(mocks.converterSaveSegments).toHaveBeenCalled();
    });
    const input = mocks.converterSaveSegments.mock.calls.at(-1)?.[0];
    expect(input.source.sourceRoundIds).toEqual(["round-1", "round-2", "round-3", "round-4"]);
    expect(input.source.removeSourceRound).toBe(true);
    expect(input.segments).toHaveLength(3);
  });

  it("sends the selected source round when saving a single installed round edit", async () => {
    mocks.db.round.findInstalled.mockResolvedValue([
      makeInstalledRound("round-1", {
        name: "Standalone Round",
        startTime: 1_000,
        endTime: 3_000,
      }),
    ]);

    const { result } = renderHook(() => useConverterState({ sourceRoundId: "", heroName: "" }));

    await waitFor(() => {
      expect(result.current.zoomPxPerSec).toBe(MIN_ZOOM_PX_PER_SEC);
    });

    await act(async () => {
      await result.current.selectRoundAndEdit("round-1");
    });

    await waitFor(() => {
      expect(result.current.selectedInstalledOption?.id).toBe("round-1");
    });

    act(() => {
      result.current.setDurationMs(3_000);
    });

    await waitFor(() => {
      expect(result.current.canSave).toBe(true);
    });

    await act(async () => {
      await result.current.saveConvertedRounds();
    });

    const input = mocks.converterSaveSegments.mock.calls.at(-1)?.[0];
    expect(input.source.sourceRoundIds).toEqual(["round-1"]);
    expect(input.source.removeSourceRound).toBe(true);
    expect(input.segments[0].cutRanges).toEqual([]);
  });

  it("loads and saves installed round cuts", async () => {
    mocks.db.round.findInstalled.mockResolvedValue([
      makeInstalledRound("round-1", {
        name: "Cut Round",
        startTime: 1_000,
        endTime: 9_000,
        cutRangesJson: JSON.stringify([{ startTimeMs: 3_000, endTimeMs: 4_000 }]),
      }),
    ]);

    const { result } = renderHook(() => useConverterState({ sourceRoundId: "", heroName: "" }));

    await waitFor(() => {
      expect(result.current.zoomPxPerSec).toBe(MIN_ZOOM_PX_PER_SEC);
    });

    await act(async () => {
      await result.current.selectRoundAndEdit("round-1");
    });

    await waitFor(() => {
      expect(result.current.selectedInstalledOption?.id).toBe("round-1");
    });

    expect(result.current.sortedSegments[0]?.cutRanges).toMatchObject([
      { startTimeMs: 3_000, endTimeMs: 4_000 },
    ]);

    act(() => {
      result.current.setDurationMs(10_000);
    });

    await waitFor(() => {
      expect(result.current.canSave).toBe(true);
    });

    await act(async () => {
      await result.current.saveConvertedRounds();
    });

    const input = mocks.converterSaveSegments.mock.calls.at(-1)?.[0];
    expect(input.segments[0].cutRanges).toEqual([{ startTimeMs: 3_000, endTimeMs: 4_000 }]);
  });

  it("does not send replacement source rounds for local saves", async () => {
    const { result } = renderHook(() => useConverterState({ sourceRoundId: "", heroName: "" }));

    await waitFor(() => {
      expect(result.current.zoomPxPerSec).toBe(MIN_ZOOM_PX_PER_SEC);
    });

    act(() => {
      result.current.setSourceMode("local");
      result.current.setDurationMs(10_000);
      result.current.setHeroName("Local Hero");
      result.current.setVideoUri("file:///tmp/local.mp4");
      result.current.setMarkInMs(1_000);
      result.current.setMarkOutMs(3_000);
    });

    act(() => {
      result.current.addSegmentFromMarks();
    });

    await act(async () => {
      await result.current.saveConvertedRounds();
    });

    const input = mocks.converterSaveSegments.mock.calls.at(-1)?.[0];
    expect(input.source.sourceRoundIds).toEqual([]);
    expect(input.source.removeSourceRound).toBe(false);
  });

  it("clears overlay, marks, then selection with escape", async () => {
    const { result } = renderHook(() => useConverterState({ sourceRoundId: "", heroName: "" }));

    await waitFor(() => {
      expect(result.current.zoomPxPerSec).toBe(MIN_ZOOM_PX_PER_SEC);
    });

    act(() => {
      result.current.setDurationMs(10_000);
      result.current.setMarkInMs(1_000);
      result.current.setMarkOutMs(2_000);
    });

    act(() => {
      result.current.addSegmentFromMarks();
    });

    expect(result.current.showHotkeys).toBe(true);

    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
    expect(result.current.showHotkeys).toBe(false);

    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
    expect(result.current.markInMs).toBeNull();
    expect(result.current.markOutMs).toBeNull();

    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
    expect(result.current.selectedSegmentId).toBeNull();
  });

  it("shows and hides the shortcut overlay explicitly and via the toggle shortcut", async () => {
    const { result } = renderHook(() => useConverterState({ sourceRoundId: "", heroName: "" }));

    await waitFor(() => {
      expect(result.current.zoomPxPerSec).toBe(MIN_ZOOM_PX_PER_SEC);
    });

    expect(result.current.showHotkeys).toBe(true);

    act(() => {
      result.current.hideHotkeysOverlay();
    });
    expect(result.current.showHotkeys).toBe(false);

    act(() => {
      result.current.showHotkeysOverlay();
    });
    expect(result.current.showHotkeys).toBe(true);

    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "?" }));
    });
    expect(result.current.showHotkeys).toBe(false);

    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "?" }));
    });
    expect(result.current.showHotkeys).toBe(true);
  });

  it("ignores shortcuts while an input is focused", async () => {
    const { result } = renderHook(() => useConverterState({ sourceRoundId: "", heroName: "" }));

    await waitFor(() => {
      expect(result.current.zoomPxPerSec).toBe(MIN_ZOOM_PX_PER_SEC);
    });

    act(() => {
      result.current.setDurationMs(10_000);
      result.current.setMarkInMs(1_000);
      result.current.setMarkOutMs(5_000);
    });

    const input = document.createElement("input");
    document.body.appendChild(input);

    act(() => {
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    });

    expect(result.current.sortedSegments).toHaveLength(0);
    input.remove();
  });
});
