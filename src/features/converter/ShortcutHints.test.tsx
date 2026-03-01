import { render, screen } from "@testing-library/react";
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
          isDetecting={false}
          detectedSegmentCount={3}
          onSetPauseGapDraft={() => {}}
          onSetMinRoundDraft={() => {}}
          onCommitPauseGapDraft={() => {}}
          onCommitMinRoundDraft={() => {}}
          onRunAutoDetect={() => {}}
          onApplyDetected={() => {}}
        />
      </div>
    );

    expect(screen.getByText("Ctrl/Cmd+S")).toBeDefined();
    expect(screen.getByText("A")).toBeDefined();
    expect(screen.getByText("Shift+A")).toBeDefined();
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
        allowOverlappingSegments={false}
        onSelectSegment={() => {}}
        onRemoveSegment={() => {}}
        onAllowOverlappingSegmentsChange={() => {}}
        onAddCutFromMarks={() => {}}
        onRemoveCut={() => {}}
        onSeekToMs={() => {}}
        onMergeSegmentWithNext={() => {}}
        onSetSegmentCustomName={() => {}}
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
