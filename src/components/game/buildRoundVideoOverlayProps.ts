import type {
  ActiveRound,
  CompletedRoundSummary,
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
  | "booruSearchPrompt"
  | "intermediaryLoadingDurationSec"
  | "intermediaryReturnPauseSec"
  | "allowAutomaticIntermediaries"
  | "initialShowProgressBarAlways"
  | "initialShowAntiPerkBeatbar"
>;

type RoundVideoOverlaySessionConfig = Pick<
  RoundVideoOverlayProps,
  | "currentPlayer"
  | "roundControl"
  | "onRequestCum"
  | "cumRequestSignal"
  | "showCumRoundOutcomeMenuOnCumRequest"
  | "onOpenOptions"
  | "allowDebugRoundControls"
  | "extraModifiers"
  | "onFunscriptFrame"
  | "onUiVisibilityChange"
  | "onPreviewStateChange"
  | "lastLogMessage"
  | "boardSequence"
  | "idleBoardSequence"
  | "onCompleteBoardSequence"
>;

type RoundVideoOverlayShellConfig = Pick<
  RoundVideoOverlayProps,
  "showCloseButton" | "onClose" | "onFinishRound"
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
    booruSearchPrompt: playback.booruSearchPrompt,
    intermediaryLoadingDurationSec: playback.intermediaryLoadingDurationSec,
    intermediaryReturnPauseSec: playback.intermediaryReturnPauseSec,
    allowAutomaticIntermediaries: playback.allowAutomaticIntermediaries,
    initialShowProgressBarAlways: playback.initialShowProgressBarAlways,
    initialShowAntiPerkBeatbar: playback.initialShowAntiPerkBeatbar,
    showCloseButton: shell.showCloseButton,
    onClose: shell.onClose,
    onFinishRound: shell.onFinishRound,
    currentPlayer: session?.currentPlayer,
    roundControl: session?.roundControl,
    onRequestCum: session?.onRequestCum,
    cumRequestSignal: session?.cumRequestSignal,
    showCumRoundOutcomeMenuOnCumRequest: session?.showCumRoundOutcomeMenuOnCumRequest,
    onOpenOptions: session?.onOpenOptions,
    allowDebugRoundControls: session?.allowDebugRoundControls,
    extraModifiers: session?.extraModifiers,
    onFunscriptFrame: session?.onFunscriptFrame,
    onUiVisibilityChange: session?.onUiVisibilityChange,
    onPreviewStateChange: session?.onPreviewStateChange,
    lastLogMessage: session?.lastLogMessage,
    boardSequence: session?.boardSequence,
    idleBoardSequence: session?.idleBoardSequence,
    onCompleteBoardSequence: session?.onCompleteBoardSequence,
  };
}

export type PreviewRoundVideoOverlayLaunchConfig = {
  activeRound: ActiveRound | null;
  installedRounds: InstalledRound[];
  intermediaryProbability: number;
  booruSearchPrompt: string;
  intermediaryLoadingDurationSec: number;
  intermediaryReturnPauseSec: number;
  initialShowProgressBarAlways?: boolean;
  initialShowAntiPerkBeatbar?: boolean;
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
      booruSearchPrompt: config.booruSearchPrompt,
      intermediaryLoadingDurationSec: config.intermediaryLoadingDurationSec,
      intermediaryReturnPauseSec: config.intermediaryReturnPauseSec,
      allowAutomaticIntermediaries: true,
      initialShowProgressBarAlways: config.initialShowProgressBarAlways,
      initialShowAntiPerkBeatbar: config.initialShowAntiPerkBeatbar,
    },
    shell: {
      showCloseButton: true,
      onClose: config.onClose,
      onFinishRound: config.onFinishRound,
    },
  });
}

export type GameplayRoundVideoOverlayLaunchConfig = {
  activeRound: ActiveRound | null;
  installedRounds: InstalledRound[];
  intermediaryProbability: number;
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
  onUiVisibilityChange?: (visible: boolean) => void;
  onPreviewStateChange?: (state: { active: boolean; loading: boolean }) => void;
  initialShowProgressBarAlways?: boolean;
  initialShowAntiPerkBeatbar?: boolean;
  allowDebugRoundControls?: boolean;
  lastLogMessage?: string;
  boardSequence?: "milker" | "jackhammer" | null;
  idleBoardSequence?: "no-rest" | null;
  onCompleteBoardSequence?: (perkId: "milker" | "jackhammer") => void;
  extraModifiers?: PlaybackModifier[];
  onFunscriptFrame?: (payload: { timeMs: number; position: number | null }) => void;
};

export function buildGameplayRoundVideoOverlayProps(
  config: GameplayRoundVideoOverlayLaunchConfig
): RoundVideoOverlayProps {
  return buildRoundVideoOverlayProps({
    playback: {
      activeRound: config.activeRound,
      installedRounds: config.installedRounds,
      intermediaryProbability: config.intermediaryProbability,
      booruSearchPrompt: config.booruSearchPrompt,
      intermediaryLoadingDurationSec: config.intermediaryLoadingDurationSec,
      intermediaryReturnPauseSec: config.intermediaryReturnPauseSec,
      allowAutomaticIntermediaries: true,
      initialShowProgressBarAlways: config.initialShowProgressBarAlways,
      initialShowAntiPerkBeatbar: config.initialShowAntiPerkBeatbar,
    },
    shell: {
      showCloseButton: false,
      onClose: undefined,
      onFinishRound: config.onFinishRound,
    },
    session: {
      currentPlayer: config.currentPlayer,
      roundControl: config.roundControl,
      onRequestCum: config.onRequestCum,
      cumRequestSignal: config.cumRequestSignal,
      showCumRoundOutcomeMenuOnCumRequest: config.showCumRoundOutcomeMenuOnCumRequest,
      onOpenOptions: config.onOpenOptions,
      onUiVisibilityChange: config.onUiVisibilityChange,
      onPreviewStateChange: config.onPreviewStateChange,
      allowDebugRoundControls: config.allowDebugRoundControls,
      lastLogMessage: config.lastLogMessage,
      boardSequence: config.boardSequence,
      idleBoardSequence: config.idleBoardSequence,
      onCompleteBoardSequence: config.onCompleteBoardSequence,
      extraModifiers: config.extraModifiers,
      onFunscriptFrame: config.onFunscriptFrame,
    },
  });
}
