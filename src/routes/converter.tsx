import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { AnimatedBackground } from "../components/AnimatedBackground";
import { MenuButton } from "../components/MenuButton";
import { playHoverSound, playSelectSound } from "../utils/audio";
import { useConverterState } from "../features/converter/useConverterState";
import { ConverterHeader, pickConverterHeaderProps } from "../features/converter/ConverterHeader";
import { SourcePanel, pickSourcePanelProps } from "../features/converter/SourcePanel";
import { HeroPanel, pickHeroPanelProps } from "../features/converter/HeroPanel";
import { VideoPreview, pickVideoPreviewProps } from "../features/converter/VideoPreview";
import { Timeline, pickTimelineProps } from "../features/converter/Timeline";
import { AutoDetectionPanel, pickAutoDetectionPanelProps } from "../features/converter/AutoDetectionPanel";
import { SegmentList } from "../features/converter/SegmentList";
import { StatusBar } from "../features/converter/StatusBar";
import { HotkeyOverlay } from "../features/converter/HotkeyOverlay";

export const Route = createFileRoute("/converter")({
  validateSearch: (search: Record<string, unknown>) => ({
    sourceRoundId: typeof search.sourceRoundId === "string" ? search.sourceRoundId : "",
    heroName: typeof search.heroName === "string" ? search.heroName : "",
  }),
  component: ConverterPage,
});

function ConverterPage() {
  const navigate = useNavigate();
  const { sourceRoundId, heroName } = Route.useSearch();
  const state = useConverterState({ sourceRoundId, heroName });

  return (
    <div className="relative min-h-screen overflow-hidden">
      <AnimatedBackground />

      <div className="relative z-10 h-screen overflow-y-auto px-4 py-8 sm:px-8">
        <main className="parallax-ui-none mx-auto flex w-full max-w-7xl flex-col gap-6 pb-6">
          {/* Header */}
          <ConverterHeader {...pickConverterHeaderProps(state)} />

          {/* Source + Hero setup */}
          <section className="animate-entrance converter-panel-glass rounded-3xl p-4 sm:p-6">
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              <SourcePanel {...pickSourcePanelProps(state)} />
              <HeroPanel {...pickHeroPanelProps(state)} />
            </div>
          </section>

          {/* Preview + Timeline + Segments */}
          <section className="animate-entrance converter-panel-glass rounded-3xl p-4 sm:p-6">
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-5">
              <div className="lg:col-span-3">
                <VideoPreview {...pickVideoPreviewProps(state)} />
                <Timeline {...pickTimelineProps(state)} />
              </div>

              <div className="space-y-4 lg:col-span-2">
                <AutoDetectionPanel {...pickAutoDetectionPanelProps(state)} />
                <SegmentList
                  sortedSegments={state.sortedSegments}
                  selectedSegmentId={state.selectedSegmentId}
                  selectedSegment={state.selectedSegment}
                  heroName={state.heroName}
                  onSelectSegment={state.setSelectedSegmentId}
                  onRemoveSegment={state.removeSegment}
                  onSeekToMs={(ms) => {
                    state.seekToMs(ms);
                    playSelectSound();
                  }}
                  onMergeSegmentWithNext={state.mergeSegmentWithNext}
                  onSetSegmentCustomName={state.setSegmentCustomName}
                  onSetSegmentBpm={state.setSegmentBpm}
                  onResetSegmentBpm={state.resetSegmentBpm}
                  onSetSegmentDifficulty={state.setSegmentDifficulty}
                  onResetSegmentDifficulty={state.resetSegmentDifficulty}
                  onSetSegmentType={state.setSegmentType}
                  onUpdateSegmentTiming={state.updateSegmentTiming}
                  setMessage={() => { }}
                  setError={() => { }}
                />
              </div>
            </div>
          </section>

          {/* Status + Hotkeys */}
          <StatusBar message={state.message} error={state.error} />
          <HotkeyOverlay visible={state.showHotkeys} />

          {/* Back */}
          <div className="mx-auto grid w-full max-w-md grid-cols-1 gap-2 pb-6">
            <MenuButton
              label="Back to Main Menu"
              onHover={playHoverSound}
              onClick={() => {
                playSelectSound();
                navigate({ to: "/" });
              }}
            />
          </div>
        </main>
      </div>
    </div>
  );
}
