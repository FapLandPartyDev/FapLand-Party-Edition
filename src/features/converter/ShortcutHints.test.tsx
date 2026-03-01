import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AutoDetectionPanel } from "./AutoDetectionPanel";
import { HeroPanel } from "./HeroPanel";
import { SegmentList } from "./SegmentList";
import { VideoPreview } from "./VideoPreview";

vi.mock("../../utils/audio", () => ({
  playHoverSound: vi.fn(),
  playSelectSound: vi.fn(),
}));

vi.mock("../../hooks/useForegroundVideoRegistration", () => ({
  useForegroundVideoRegistration: () => ({
    handlePlay: () => {},
    handlePause: () => {},
    handleEnded: () => {},
  }),
}));

describe("converter shortcut hints", () => {
  it("renders save and auto-detect shortcut hints", () => {
    render(
      <div>
        <HeroPanel
          heroName="Hero"
          heroAuthor=""
          heroDescription=""
          sourceMode="local"
          deleteSourceRound={false}
          canSave
          isSaving={false}
          onSetHeroName={() => {}}
          onSetHeroAuthor={() => {}}
          onSetHeroDescription={() => {}}
          onSetDeleteSourceRound={() => {}}
          onSave={() => {}}
        />
        <AutoDetectionPanel
          funscriptUri="file:///tmp/test.funscript"
          durationMs={10_000}
          pauseGapDraft="900"
          minRoundDraft="15000"
          autoTrimRounds={false}
          trimAllowanceDraft="1000"
          targetSegmentCountDraft="3"
          targetDetectionResultSummary={null}
          targetSegmentCountInputRef={{ current: null }}
          isDetecting={false}
          detectedSegmentCount={3}
          existingSegmentCount={2}
          onSetPauseGapDraft={() => {}}
          onSetMinRoundDraft={() => {}}
          onSetAutoTrimRounds={() => {}}
          onSetTrimAllowanceDraft={() => {}}
          onSetTargetSegmentCountDraft={() => {}}
          onCommitPauseGapDraft={() => {}}
          onCommitMinRoundDraft={() => {}}
          onCommitTrimAllowanceDraft={() => {}}
          onRunAutoDetect={() => {}}
          onRunAdaptiveAutoDetect={() => {}}
          onRunTargetCountAutoDetect={() => {}}
          onApplyDetected={() => {}}
          onTrimExisting={() => {}}
        />
      </div>
    );

    expect(screen.getByText("Ctrl/Cmd+S")).toBeDefined();
    expect(screen.getByText("A")).toBeDefined();
    expect(screen.getByText("T")).toBeDefined();
    expect(screen.getByText("Alt+T")).toBeDefined();
    expect(screen.getByText("Shift+A")).toBeDefined();
  });

  it("runs the target count detect action from target count enter", () => {
    const onRunTargetCountAutoDetect = vi.fn();
    render(
      <AutoDetectionPanel
        funscriptUri="file:///tmp/test.funscript"
        durationMs={10_000}
        pauseGapDraft="900"
        minRoundDraft="15000"
        autoTrimRounds={false}
        trimAllowanceDraft="1000"
        targetSegmentCountDraft="3"
        targetDetectionResultSummary={null}
        targetSegmentCountInputRef={{ current: null }}
        isDetecting={false}
        detectedSegmentCount={3}
        existingSegmentCount={2}
        onSetPauseGapDraft={() => {}}
        onSetMinRoundDraft={() => {}}
        onSetAutoTrimRounds={() => {}}
        onSetTrimAllowanceDraft={() => {}}
        onSetTargetSegmentCountDraft={() => {}}
        onCommitPauseGapDraft={() => {}}
        onCommitMinRoundDraft={() => {}}
        onCommitTrimAllowanceDraft={() => {}}
        onRunAutoDetect={() => {}}
        onRunAdaptiveAutoDetect={() => {}}
        onRunTargetCountAutoDetect={onRunTargetCountAutoDetect}
        onApplyDetected={() => {}}
        onTrimExisting={() => {}}
      />
    );

    const targetInputs = screen.getAllByLabelText("Target Count");
    fireEvent.keyDown(targetInputs[targetInputs.length - 1]!, { key: "Enter" });

    expect(onRunTargetCountAutoDetect).toHaveBeenCalledTimes(1);
  });

  it("enables trimming when existing sections are available", () => {
    const onSetAutoTrimRounds = vi.fn();
    const onTrimExisting = vi.fn();
    const { container, rerender } = render(
      <AutoDetectionPanel
        funscriptUri="file:///tmp/test.funscript"
        durationMs={10_000}
        pauseGapDraft="900"
        minRoundDraft="15000"
        autoTrimRounds={false}
        trimAllowanceDraft="1000"
        targetSegmentCountDraft="3"
        targetDetectionResultSummary={null}
        targetSegmentCountInputRef={{ current: null }}
        isDetecting={false}
        detectedSegmentCount={0}
        existingSegmentCount={0}
        onSetPauseGapDraft={() => {}}
        onSetMinRoundDraft={() => {}}
        onSetAutoTrimRounds={onSetAutoTrimRounds}
        onSetTrimAllowanceDraft={() => {}}
        onSetTargetSegmentCountDraft={() => {}}
        onCommitPauseGapDraft={() => {}}
        onCommitMinRoundDraft={() => {}}
        onCommitTrimAllowanceDraft={() => {}}
        onRunAutoDetect={() => {}}
        onRunAdaptiveAutoDetect={() => {}}
        onRunTargetCountAutoDetect={() => {}}
        onApplyDetected={() => {}}
        onTrimExisting={onTrimExisting}
      />
    );

    const checkbox = container.querySelector('input[type="checkbox"]') as HTMLInputElement;
    const allowance = container.querySelector(
      'input[aria-label="Trim Allowance (ms)"]'
    ) as HTMLInputElement;
    const trimButton = screen.getAllByRole("button", { name: "Trim Existing" }).at(-1);
    expect(allowance.disabled).toBe(false);
    expect((trimButton as HTMLButtonElement).disabled).toBe(true);

    fireEvent.click(checkbox);
    expect(onSetAutoTrimRounds).toHaveBeenCalledWith(true);

    rerender(
      <AutoDetectionPanel
        funscriptUri="file:///tmp/test.funscript"
        durationMs={10_000}
        pauseGapDraft="900"
        minRoundDraft="15000"
        autoTrimRounds
        trimAllowanceDraft="1000"
        targetSegmentCountDraft="3"
        targetDetectionResultSummary={null}
        targetSegmentCountInputRef={{ current: null }}
        isDetecting={false}
        detectedSegmentCount={0}
        existingSegmentCount={2}
        onSetPauseGapDraft={() => {}}
        onSetMinRoundDraft={() => {}}
        onSetAutoTrimRounds={onSetAutoTrimRounds}
        onSetTrimAllowanceDraft={() => {}}
        onSetTargetSegmentCountDraft={() => {}}
        onCommitPauseGapDraft={() => {}}
        onCommitMinRoundDraft={() => {}}
        onCommitTrimAllowanceDraft={() => {}}
        onRunAutoDetect={() => {}}
        onRunAdaptiveAutoDetect={() => {}}
        onRunTargetCountAutoDetect={() => {}}
        onApplyDetected={() => {}}
        onTrimExisting={onTrimExisting}
      />
    );

    expect(
      (container.querySelector('input[aria-label="Trim Allowance (ms)"]') as HTMLInputElement)
        .disabled
    ).toBe(false);
    const enabledTrimButton = screen.getAllByRole("button", { name: "Trim Existing" }).at(-1);
    expect((enabledTrimButton as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(enabledTrimButton!);
    expect(onTrimExisting).toHaveBeenCalledTimes(1);
  });

  it("renders move selected segment boundary buttons with shortcut hints", () => {
    render(
      <VideoPreview
        videoRef={{ current: null }}
        videoUri=""
        durationMs={10_000}
        currentTimeMs={2_000}
        markInMs={1_000}
        markOutMs={3_000}
        hasSelectedSegment
        previewSkipsCuts={false}
        getVideoSrc={() => undefined}
        onLoadedMetadata={() => {}}
        onTimeUpdate={() => {}}
        onVideoError={() => {}}
        onTogglePlayback={() => {}}
        onSetMarkIn={() => {}}
        onSetMarkOut={() => {}}
        onAddSegment={() => {}}
        onMoveSelectedStartToPlayhead={() => {}}
        onMoveSelectedEndToPlayhead={() => {}}
        onRandomJump={() => {}}
        onPreviewSkipsCutsChange={() => {}}
      />
    );

    expect(screen.getByText("Move Start Here")).toBeDefined();
    expect(screen.getByText("Move End Here")).toBeDefined();
    expect(screen.getByText("S")).toBeDefined();
    expect(screen.getByText("E")).toBeDefined();
  });

  it("renders compact segment panel shortcut hints", () => {
    render(
      <SegmentList
        sortedSegments={[]}
        selectedSegmentId={null}
        selectedSegment={null}
        heroName="Hero"
        currentTimeMs={0}
        allowOverlappingSegments={false}
        segmentCutMarks={{}}
        onSelectSegment={() => {}}
        onRemoveSegment={() => {}}
        onAllowOverlappingSegmentsChange={() => {}}
        onAddCutFromMarks={() => {}}
        onSetSegmentCutMarkIn={() => {}}
        onSetSegmentCutMarkOut={() => {}}
        onClearSegmentCutMarks={() => {}}
        onAddCutToSegmentFromLocalMarks={() => {}}
        onRemoveCut={() => {}}
        onSeekToMs={() => {}}
        onMergeSegmentWithNext={() => {}}
        onSetSegmentCustomName={() => {}}
        onSetSegmentExcludeFromNumbering={() => {}}
        onSetSegmentBpm={() => {}}
        onResetSegmentBpm={() => {}}
        onSetSegmentDifficulty={() => {}}
        onResetSegmentDifficulty={() => {}}
        onSetSegmentType={() => {}}
        onUpdateSegmentTiming={() => {}}
        setMessage={() => {}}
        setError={() => {}}
      />
    );

    expect(screen.getByText("N")).toBeDefined();
    expect(screen.getByText("Shift+N")).toBeDefined();
    expect(screen.getByText("M")).toBeDefined();
    expect(screen.getByText("?")).toBeDefined();
  });
});
