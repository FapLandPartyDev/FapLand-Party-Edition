import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { AnimatePresence } from "framer-motion";
import { useState } from "react";
import { AnimatedBackground } from "../components/AnimatedBackground";
import { MenuButton } from "../components/MenuButton";
import { useControllerSurface } from "../controller";
import { playHoverSound, playSelectSound } from "../utils/audio";
import { useConverterState } from "../features/converter/useConverterState";
import { ConverterCachingOverlay } from "../features/converter/ConverterCachingOverlay";
import { ConverterHeader, pickConverterHeaderProps } from "../features/converter/ConverterHeader";
import { HeroPanel, pickHeroPanelProps } from "../features/converter/HeroPanel";
import { VideoPreview, pickVideoPreviewProps } from "../features/converter/VideoPreview";
import { Timeline, pickTimelineProps } from "../features/converter/Timeline";
import {
  AutoDetectionPanel,
  pickAutoDetectionPanelProps,
} from "../features/converter/AutoDetectionPanel";
import { SegmentList } from "../features/converter/SegmentList";
import { StatusBar } from "../features/converter/StatusBar";
import { HotkeyOverlay } from "../features/converter/HotkeyOverlay";
import { ConverterSourcePicker } from "../features/converter/ConverterSourcePicker";
import { Trans, useLingui } from "@lingui/react/macro";
import { EroScriptsFunscriptSearchDialog } from "../components/EroScriptsFunscriptSearchDialog";

type SourceSection = "round" | "hero" | "file" | "url";

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
  const { t } = useLingui();
  const sourceSections: { id: SourceSection; icon: string; title: string; description: string }[] =
    [
      {
        id: "round",
        icon: "🎬",
        title: t`From Round`,
        description: t`Convert a standalone round into a hero with segments.`,
      },
      {
        id: "hero",
        icon: "🦸",
        title: t`From Hero`,
        description: t`Edit an existing hero and add or modify segments.`,
      },
      {
        id: "file",
        icon: "📂",
        title: t`From File`,
        description: t`Load a local video file and convert manually.`,
      },
      {
        id: "url",
        icon: "🌐",
        title: t`From URL`,
        description: t`Use a website video URL like Pornhub, XVideos, or rule34video as the source.`,
      },
    ];
  const state = useConverterState({ sourceRoundId, heroName });
  const [activeSectionId, setActiveSectionId] = useState<SourceSection>("round");
  const [eroscriptsOpen, setEroScriptsOpen] = useState(false);

  const goBack = () => {
    if (window.history.length > 1) {
      window.history.back();
      return;
    }
    void navigate({ to: "/" });
  };

  const handleControllerBack = () => {
    playSelectSound();
    goBack();
    return true;
  };

  useControllerSurface({
    id: "converter-page",
    priority: 10,
    enabled:
      typeof window !== "undefined" &&
      localStorage.getItem("experimental.controllerSupportEnabled") === "true",
    onBack: handleControllerBack,
  });

  const activeSection = sourceSections.find((s) => s.id === activeSectionId) ?? sourceSections[0];

  if (state.step === "select" || state.step === "caching") {
    return (
      <div className="relative min-h-screen overflow-hidden">
        <AnimatedBackground />

        <div className="relative z-10 flex h-screen flex-col overflow-hidden lg:flex-row">
          <nav className="animate-entrance flex shrink-0 flex-row gap-1 overflow-x-auto border-b border-purple-400/20 bg-zinc-950/70 px-3 py-2 backdrop-blur-xl lg:w-60 lg:flex-col lg:gap-0.5 lg:overflow-x-visible lg:overflow-y-auto lg:border-b-0 lg:border-r lg:px-3 lg:py-6">
            <div className="hidden lg:mb-5 lg:block lg:px-3">
              <p className="font-[family-name:var(--font-jetbrains-mono)] text-[0.6rem] uppercase tracking-[0.45em] text-purple-200/70">
                <Trans>Conversion Lab</Trans>
              </p>
              <h1 className="mt-1.5 text-xl font-black tracking-tight text-transparent bg-clip-text bg-gradient-to-r from-violet-200 via-purple-100 to-indigo-200 drop-shadow-[0_0_20px_rgba(139,92,246,0.45)]">
                <Trans>Round Converter</Trans>
              </h1>
            </div>

            {sourceSections.map((section, index) => {
              const active = section.id === activeSectionId;
              return (
                <button
                  key={section.id}
                  type="button"
                  data-controller-focus-id={`converter-sidebar-${section.id}`}
                  data-controller-down={
                    index < sourceSections.length - 1
                      ? `converter-sidebar-${sourceSections[index + 1].id}`
                      : undefined
                  }
                  data-controller-up={
                    index > 0 ? `converter-sidebar-${sourceSections[index - 1].id}` : undefined
                  }
                  onMouseEnter={playHoverSound}
                  onFocus={playHoverSound}
                  onClick={() => {
                    playSelectSound();
                    setActiveSectionId(section.id);
                  }}
                  className={`settings-sidebar-item whitespace-nowrap ${active ? "is-active" : ""}`}
                >
                  <span className="settings-sidebar-icon">{section.icon}</span>
                  <span>{section.title}</span>
                </button>
              );
            })}

            <div className="hidden lg:mt-auto lg:block lg:px-1 lg:pt-4">
              <MenuButton
                label={t`← Back`}
                controllerFocusId="converter-back"
                onHover={playHoverSound}
                onClick={() => {
                  playSelectSound();
                  goBack();
                }}
              />
            </div>
          </nav>

          <div className="flex-1 overflow-y-auto px-4 py-6 sm:px-8 lg:px-10 lg:py-8">
            <main className="parallax-ui-none mx-auto flex w-full max-w-4xl flex-col gap-5">
              <header className="settings-panel-enter mb-1" key={`header-${activeSection.id}`}>
                <h2 className="text-2xl font-black tracking-tight text-transparent bg-clip-text bg-gradient-to-r from-violet-200 via-purple-100 to-indigo-200 drop-shadow-[0_0_20px_rgba(139,92,246,0.4)] sm:text-3xl">
                  {activeSection.title}
                </h2>
                <p className="mt-1.5 text-sm text-zinc-400">{activeSection.description}</p>
              </header>

              <div className="settings-panel-enter" key={`content-${activeSection.id}`}>
                <ConverterSourcePicker
                  section={activeSectionId}
                  localFunscriptUri={state.funscriptUri}
                  onSelectRound={(roundId) => void state.selectRoundAndEdit(roundId)}
                  onSelectHero={(heroId) => void state.selectHeroAndEdit(heroId)}
                  onSelectLocalVideo={() => void state.selectLocalAndEdit()}
                  onSelectLocalFunscript={() => void state.attachLocalFunscript()}
                  onSelectWebsiteSource={(videoUri, funscriptUri) =>
                    void state.selectWebsiteAndEdit(videoUri, funscriptUri)
                  }
                  onSearchEroScripts={() => setEroScriptsOpen(true)}
                />
              </div>

              <div className="mx-auto grid w-full max-w-md grid-cols-1 gap-2 pb-6 lg:hidden">
                <MenuButton
                  label={t`Back to Main Menu`}
                  onHover={playHoverSound}
                  onClick={() => {
                    playSelectSound();
                    goBack();
                  }}
                />
              </div>
            </main>
          </div>
        </div>
        <AnimatePresence>
          {state.step === "caching" && state.cachingUrl && (
            <ConverterCachingOverlay
              url={state.cachingUrl}
              progress={state.cachingProgress}
              error={state.cachingError}
              onCancel={state.cancelCaching}
              onRetry={state.retryCaching}
            />
          )}
        </AnimatePresence>
        <EroScriptsFunscriptSearchDialog
          open={eroscriptsOpen}
          initialQuery={heroName || ""}
          onClose={() => setEroScriptsOpen(false)}
          onInstallRound={async (input) => {
            await state.selectWebsiteAndEdit(input.videoUri, input.funscriptUri);
            setEroScriptsOpen(false);
          }}
        />
      </div>
    );
  }

  return (
    <div className="relative min-h-screen overflow-hidden">
      <AnimatedBackground />

      <div className="relative z-10 h-screen overflow-y-auto px-4 py-8 sm:px-8">
        <main className="parallax-ui-none mx-auto flex w-full max-w-7xl flex-col gap-6 pb-6">
          <ConverterHeader
            {...pickConverterHeaderProps(state)}
            onGoToSelect={() => state.goToSelectStep()}
            onAttachFunscript={() => void state.attachLocalFunscript()}
            onShowHotkeys={state.showHotkeysOverlay}
            onHideHotkeys={state.hideHotkeysOverlay}
          />

          <section className="animate-entrance">
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-5">
              <div className="lg:col-span-3 space-y-4">
                <VideoPreview {...pickVideoPreviewProps(state)} />
                <Timeline {...pickTimelineProps(state)} />
              </div>

              <div className="lg:col-span-2">
                <div className="rounded-2xl border border-purple-400/25 bg-zinc-950/55 backdrop-blur-xl overflow-hidden">
                  <div className="flex border-b border-zinc-700/50">
                    <button
                      type="button"
                      onClick={() => {}}
                      className="flex-1 px-4 py-2.5 text-sm font-medium border-b-2 border-violet-400 text-violet-100"
                    >
                      <Trans>Segments</Trans>{" "}
                      {state.sortedSegments.length > 0 && (
                        <span className="ml-1 text-xs text-violet-300">
                          ({state.sortedSegments.length})
                        </span>
                      )}
                    </button>
                  </div>
                  <div className="p-4 space-y-4">
                    <SegmentList
                      sortedSegments={state.sortedSegments}
                      selectedSegmentId={state.selectedSegmentId}
                      selectedSegment={state.selectedSegment}
                      heroName={state.heroName}
                      allowOverlappingSegments={state.allowOverlappingSegments}
                      onSelectSegment={state.setSelectedSegmentId}
                      onRemoveSegment={state.removeSegment}
                      onAllowOverlappingSegmentsChange={state.setAllowOverlappingSegments}
                      onAddCutFromMarks={state.addCutFromMarks}
                      onRemoveCut={state.removeCut}
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
                      setMessage={() => {}}
                      setError={() => {}}
                    />
                    <div className="border-t border-zinc-700/50 pt-4">
                      <HeroPanel {...pickHeroPanelProps(state)} />
                    </div>
                    <div className="border-t border-zinc-700/50 pt-4">
                      <AutoDetectionPanel {...pickAutoDetectionPanelProps(state)} />
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </section>

          <StatusBar message={state.message} error={state.error} />
          <HotkeyOverlay visible={state.showHotkeys} />

          <div className="mx-auto grid w-full max-w-md grid-cols-1 gap-2 pb-6">
            <MenuButton
              label={t`Back to Main Menu`}
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
