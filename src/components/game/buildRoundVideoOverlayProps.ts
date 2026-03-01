import type {
  ActiveRound,
  CompletedRoundSummary,
  RoadPalette,
  PlayerState,
} from "../../game/types";
import type { InstalledRound } from "../../services/db";
import type { PlaybackModifier } from "../../game/media/playback";
import type { RoundVideoOverlayProps } from "./RoundVideoOverlay";

type RoundVideoOverlayPlaybackConfig = Pick<
  RoundVideoOverlayProps,
  | "activeRound"
  | "installedRounds"
  | "intermediaryProbability"
  | "intermediarySelection"
  | "booruSearchPrompt"
  | "intermediaryLoadingDurationSec"
  | "intermediaryReturnPauseSec"
  | "allowAutomaticIntermediaries"
  | "initialShowProgressBarAlways"
  | "initialShowAntiPerkBeatbar"
  | "initialShowDisconnectedHapticsStatus"
>;

type RoundVideoOverlaySessionConfig = Pick<
  RoundVideoOverlayProps,
  | "currentPlayer"
  | "roundControl"
  | "allowPausingDuringFinalCumRound"
  | "onRequestCum"
  | "cumRequestSignal"
  | "showCumRoundOutcomeMenuOnCumRequest"
  | "onOpenOptions"
  | "onOptionsActionsChange"
  | "onDifficultyControlChange"
  | "allowDebugRoundControls"
  | "extraModifiers"
  | "onFunscriptFrame"
  | "onUiVisibilityChange"
  | "onPreviewStateChange"
  | "lastLogMessage"
  | "boardSequence"
  | "idleBoardSequence"
  | "onCompleteBoardSequence"
  | "continuousMoaningActive"
  | "roadPalette"
  | "onPlaybackTelemetry"
>;

type RoundVideoOverlayShellConfig = Pick<
  RoundVideoOverlayProps,
  "showCloseButton" | "onClose" | "onFinishRound" | "allowTimelineSeeking"
>;

export type RoundVideoOverlayLaunchConfig = {
  playback: RoundVideoOverlayPlaybackConfig;
  shell: RoundVideoOverlayShellConfig;
  session?: Partial<RoundVideoOverlaySessionConfig>;
};

export function buildRoundVideoOverlayProps({
  playback,
  shell,
  session,
}: RoundVideoOverlayLaunchConfig): RoundVideoOverlayProps {
  // Preview and gameplay must share the same playback config; session controls are optional add-ons.
  return {
    activeRound: playback.activeRound,
    installedRounds: playback.installedRounds,
    intermediaryProbability: playback.intermediaryProbability,
    intermediarySelection: playback.intermediarySelection,
    booruSearchPrompt: playback.booruSearchPrompt,
    intermediaryLoadingDurationSec: playback.intermediaryLoadingDurationSec,
    intermediaryReturnPauseSec: playback.intermediaryReturnPauseSec,
    allowAutomaticIntermediaries: playback.allowAutomaticIntermediaries,
    initialShowProgressBarAlways: playback.initialShowProgressBarAlways,
    initialShowAntiPerkBeatbar: playback.initialShowAntiPerkBeatbar,
    initialShowDisconnectedHapticsStatus: playback.initialShowDisconnectedHapticsStatus,
    showCloseButton: shell.showCloseButton,
    onClose: shell.onClose,
    onFinishRound: shell.onFinishRound,
    allowTimelineSeeking: shell.allowTimelineSeeking,
    currentPlayer: session?.currentPlayer,
    roundControl: session?.roundControl,
    allowPausingDuringFinalCumRound: session?.allowPausingDuringFinalCumRound,
    onRequestCum: session?.onRequestCum,
    cumRequestSignal: session?.cumRequestSignal,
    showCumRoundOutcomeMenuOnCumRequest: session?.showCumRoundOutcomeMenuOnCumRequest,
    onOpenOptions: session?.onOpenOptions,
    onOptionsActionsChange: session?.onOptionsActionsChange,
    onDifficultyControlChange: session?.onDifficultyControlChange,
    allowDebugRoundControls: session?.allowDebugRoundControls,
    extraModifiers: session?.extraModifiers,
    onFunscriptFrame: session?.onFunscriptFrame,
    onUiVisibilityChange: session?.onUiVisibilityChange,
    onPreviewStateChange: session?.onPreviewStateChange,
    lastLogMessage: session?.lastLogMessage,
    boardSequence: session?.boardSequence,
    idleBoardSequence: session?.idleBoardSequence,
    onCompleteBoardSequence: session?.onCompleteBoardSequence,
    continuousMoaningActive: session?.continuousMoaningActive,
    roadPalette: session?.roadPalette,
    onPlaybackTelemetry: session?.onPlaybackTelemetry,
  };
}

export type PreviewRoundVideoOverlayLaunchConfig = {
  activeRound: ActiveRound | null;
  installedRounds: InstalledRound[];
  intermediaryProbability: number;
  intermediarySelection?: RoundVideoOverlayProps["intermediarySelection"];
  booruSearchPrompt: string;
  intermediaryLoadingDurationSec: number;
  intermediaryReturnPauseSec: number;
  allowAutomaticIntermediaries?: boolean;
  initialShowProgressBarAlways?: boolean;
  initialShowAntiPerkBeatbar?: boolean;
  initialShowDisconnectedHapticsStatus?: boolean;
  onClose: () => void;
  onFinishRound: (summary?: CompletedRoundSummary) => void;
};

export function buildPreviewRoundVideoOverlayProps(
  config: PreviewRoundVideoOverlayLaunchConfig
): RoundVideoOverlayProps {
  return buildRoundVideoOverlayProps({
    playback: {
      activeRound: config.activeRound,
      installedRounds: config.installedRounds,
      intermediaryProbability: config.intermediaryProbability,
      intermediarySelection: config.intermediarySelection,
      booruSearchPrompt: config.booruSearchPrompt,
      intermediaryLoadingDurationSec: config.intermediaryLoadingDurationSec,
      intermediaryReturnPauseSec: config.intermediaryReturnPauseSec,
      allowAutomaticIntermediaries: config.allowAutomaticIntermediaries ?? false,
      initialShowProgressBarAlways: config.initialShowProgressBarAlways,
      initialShowAntiPerkBeatbar: config.initialShowAntiPerkBeatbar,
      initialShowDisconnectedHapticsStatus: config.initialShowDisconnectedHapticsStatus,
    },
    shell: {
      showCloseButton: true,
      allowTimelineSeeking: true,
      onClose: config.onClose,
      onFinishRound: config.onFinishRound,
    },
  });
}

export type GameplayRoundVideoOverlayLaunchConfig = {
  activeRound: ActiveRound | null;
  installedRounds: InstalledRound[];
  intermediaryProbability: number;
  intermediarySelection?: RoundVideoOverlayProps["intermediarySelection"];
  disableInterjectionsDuringCumRounds?: boolean;
  allowPausingDuringFinalCumRound?: boolean;
  booruSearchPrompt: string;
  intermediaryLoadingDurationSec: number;
  intermediaryReturnPauseSec: number;
  onFinishRound: (summary?: CompletedRoundSummary) => void;
  currentPlayer: PlayerState | undefined;
  roundControl?: RoundVideoOverlayProps["roundControl"];
  onRequestCum?: () => void;
  cumRequestSignal?: number;
  showCumRoundOutcomeMenuOnCumRequest?: boolean;
  onOpenOptions?: () => void;
  onOptionsActionsChange?: RoundVideoOverlayProps["onOptionsActionsChange"];
  onDifficultyControlChange?: RoundVideoOverlayProps["onDifficultyControlChange"];
  onUiVisibilityChange?: (visible: boolean) => void;
  onPreviewStateChange?: (state: { active: boolean; loading: boolean }) => void;
  initialShowProgressBarAlways?: boolean;
  initialShowAntiPerkBeatbar?: boolean;
  initialShowDisconnectedHapticsStatus?: boolean;
  allowDebugRoundControls?: boolean;
  lastLogMessage?: string;
  boardSequence?: "milker" | "jackhammer" | null;
  idleBoardSequence?: "no-rest" | null;
  onCompleteBoardSequence?: (perkId: "milker" | "jackhammer") => void;
  continuousMoaningActive?: boolean;
  extraModifiers?: PlaybackModifier[];
  onFunscriptFrame?: (payload: { timeMs: number; position: number | null }) => void;
  roadPalette?: RoadPalette;
  onPlaybackTelemetry?: RoundVideoOverlayProps["onPlaybackTelemetry"];
};

export function buildGameplayRoundVideoOverlayProps(
  config: GameplayRoundVideoOverlayLaunchConfig
): RoundVideoOverlayProps {
  const isCumPhase =
    config.activeRound?.phaseKind === "cum" || config.activeRound?.phaseKind === "cumPoint";

  return buildRoundVideoOverlayProps({
    playback: {
      activeRound: config.activeRound,
      installedRounds: config.installedRounds,
      intermediaryProbability: config.intermediaryProbability,
      intermediarySelection: config.intermediarySelection,
      booruSearchPrompt: config.booruSearchPrompt,
      intermediaryLoadingDurationSec: config.intermediaryLoadingDurationSec,
      intermediaryReturnPauseSec: config.intermediaryReturnPauseSec,
      allowAutomaticIntermediaries: !(
        (config.disableInterjectionsDuringCumRounds ?? true) &&
        isCumPhase
      ),
      initialShowProgressBarAlways: config.initialShowProgressBarAlways,
      initialShowAntiPerkBeatbar: config.initialShowAntiPerkBeatbar,
      initialShowDisconnectedHapticsStatus: config.initialShowDisconnectedHapticsStatus,
    },
    shell: {
      showCloseButton: false,
      allowTimelineSeeking: false,
      onClose: undefined,
      onFinishRound: config.onFinishRound,
    },
    session: {
      currentPlayer: config.currentPlayer,
      roundControl: config.roundControl,
      allowPausingDuringFinalCumRound: config.allowPausingDuringFinalCumRound,
      onRequestCum: config.onRequestCum,
      cumRequestSignal: config.cumRequestSignal,
      showCumRoundOutcomeMenuOnCumRequest: config.showCumRoundOutcomeMenuOnCumRequest,
      onOpenOptions: config.onOpenOptions,
      onOptionsActionsChange: config.onOptionsActionsChange,
      onDifficultyControlChange: config.onDifficultyControlChange,
      onUiVisibilityChange: config.onUiVisibilityChange,
      onPreviewStateChange: config.onPreviewStateChange,
      allowDebugRoundControls: config.allowDebugRoundControls,
      lastLogMessage: config.lastLogMessage,
      boardSequence: config.boardSequence,
      idleBoardSequence: config.idleBoardSequence,
      onCompleteBoardSequence: config.onCompleteBoardSequence,
      continuousMoaningActive: config.continuousMoaningActive,
      extraModifiers: config.extraModifiers,
      onFunscriptFrame: config.onFunscriptFrame,
      roadPalette: config.roadPalette,
      onPlaybackTelemetry: config.onPlaybackTelemetry,
    },
  });
}
