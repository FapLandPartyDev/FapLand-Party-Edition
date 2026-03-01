import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLingui } from "@lingui/react/macro";
import { useControllerSurface, useControllerSubscription } from "../../controller";
import type {
  ActiveRound,
  CompletedRoundSummary,
  CumRoundOutcome,
  PlayerState,
} from "../../game/types";
import type { InstalledRound } from "../../services/db";
import ControllerHints from "./ControllerHints";
import {
  getCachedBooruMedia,
  getCachedBooruMediaForDisplay,
  refreshBooruMediaCache,
  isVideoMedia,
  type BooruMediaItem,
} from "../../services/booru";
import { useForegroundVideoRegistration } from "../../hooks/useForegroundVideoRegistration";
import {
  usePlayableVideoFallback,
  isLocalVideoUriForFallback,
} from "../../hooks/usePlayableVideoFallback";
import { useGameplayMoaning } from "../../hooks/useGameplayMoaning";
import { useHandy } from "../../contexts/HandyContext";
import {
  buildIntermediaryQueue,
  computePlaybackRate,
  type FunscriptAction,
  getActivePlaybackModifiers,
  getFunscriptPositionAtMs,
  loadFunscriptTimeline,
  type IntermediaryTrigger,
  type PlaybackModifier,
  type PlaybackResource,
} from "../../game/media/playback";
import {
  issueHandySession,
  pauseHandyPlayback,
  preloadHspScript,
  resumeHandyPlayback,
  sendHspSync,
  stopHandyPlayback,
  type HandySession,
} from "../../services/thehandy/runtime";
import {
  playDiceResultSound,
  playHoverSound,
  playPerkActionSound,
  playRoundStartSound,
  playSelectSound,
} from "../../utils/audio";
import {
  DEFAULT_ANTI_PERK_BEATBAR_ENABLED,
  DEFAULT_ROUND_PROGRESS_BAR_ALWAYS_VISIBLE,
} from "../../constants/roundVideoOverlaySettings";
import { formatDurationLabel } from "../../utils/duration";
import { isGameDevelopmentMode } from "../../utils/devFeatures";
import { useSfwMode } from "../../hooks/useSfwMode";
import { abbreviateNsfwText } from "../../utils/sfwText";
import { SfwOneTimeOverridePrompt } from "../SfwGuard";
import { openGlobalHandyOverlay } from "../globalHandyOverlayControls";
import {
  extractBeatbarMotionEvents,
  getAntiPerkSequenceDefinition,
  type AntiPerkSequenceDefinition,
  type AntiPerkSequenceId,
  type BeatbarMotionEvent,
  type BeatHit,
} from "./antiPerkSequences";

export type RoundVideoOverlayProps = {
  activeRound: ActiveRound | null;
  installedRounds: InstalledRound[];
  currentPlayer: PlayerState | undefined;
  roundControl?: {
    pauseCharges: number;
    skipCharges: number;
    onUsePause: () => void;
    onUseSkip: () => void;
  };
  intermediaryProbability: number;
  boardSequence?: "milker" | "jackhammer" | null;
  idleBoardSequence?: "no-rest" | null;
  onCompleteBoardSequence?: (perkId: "milker" | "jackhammer") => void;
  continuousMoaningActive?: boolean;
  allowAutomaticIntermediaries?: boolean;
  showCloseButton?: boolean;
  onClose?: () => void;
  booruSearchPrompt: string;
  intermediaryLoadingDurationSec: number;
  intermediaryReturnPauseSec: number;
  onFinishRound: (summary?: CompletedRoundSummary) => void;
  onRequestCum?: () => void;
  cumRequestSignal?: number;
  showCumRoundOutcomeMenuOnCumRequest?: boolean;
  onOpenOptions?: () => void;
  allowDebugRoundControls?: boolean;
  extraModifiers?: PlaybackModifier[];
  onFunscriptFrame?: (payload: { timeMs: number; position: number | null }) => void;
  onUiVisibilityChange?: (visible: boolean) => void;
  onPreviewStateChange?: (state: { active: boolean; loading: boolean }) => void;
  initialShowProgressBarAlways?: boolean;
  initialShowAntiPerkBeatbar?: boolean;
  lastLogMessage?: string;
};

type LoadingMediaItem =
  | BooruMediaItem
  | {
    id: string;
    source: "fallback";
    url: string;
    previewUrl?: string | null;
  };

type SegmentState =
  | { kind: "main" }
  | {
    kind: "intermediary";
    trigger: IntermediaryTrigger;
    resumeAtSec: number;
  };

type TransitionPlan = {
  nextSegment: SegmentState;
  nextVideoUri: string;
  status: string;
  pendingSeekSec?: number | null;
};

type HandySyncState = "disconnected" | "missing-key" | "connecting" | "synced" | "error";

type ActiveAntiPerkSequenceUi = {
  id: AntiPerkSequenceId;
  definition: AntiPerkSequenceDefinition;
  durationMs: number;
  startedAtMs: number;
  actions: FunscriptAction[];
  beatHits: BeatHit[];
  beatbarEvents: BeatbarMotionEvent[];
};

const INITIAL_UI_SHOW_MS = 5000;
const UI_SHOW_AFTER_MOUSEMOVE_MS = 2200;
const LOADING_MEDIA_ROTATE_MS = 2400;
const LOADING_MEDIA_FADE_MS = 900;
const HANDY_PUSH_INTERVAL_MS = 60;
const HANDY_REAUTH_MARGIN_MS = 30_000;
const HANDY_SYNC_STALE_MS = 4_000;
const MAIN_WINDOW_SEEK_EPSILON_SEC = 0.05;
const MAIN_WINDOW_END_TOLERANCE_SEC = 0.04;
const INTERMEDIARY_WINDOW_SEEK_EPSILON_SEC = 0.05;
const MANUAL_PAUSE_DURATION_MS = 15_000;
const ANTI_PERK_BEATBAR_LEAD_MS = 1_800;
const ANTI_PERK_BEATBAR_TRAIL_MS = 300;
const BOARD_VIDEO_VOLUME = 1;
const MEDIA_NOT_FOUND_AUTO_CLOSE_MS = 10_000;

function teardownVideoElement(video: HTMLVideoElement | null) {
  if (!video) return;
  video.pause();
  video.removeAttribute("src");
  video.load();
}

function isIgnorableVideoPlayError(error: unknown): boolean {
  if (!(error instanceof DOMException) && !(error instanceof Error)) {
    return false;
  }

  const name = "name" in error && typeof error.name === "string" ? error.name : "";
  const message = typeof error.message === "string" ? error.message.toLowerCase() : "";
  return (
    name === "AbortError" ||
    message.includes("interrupted by a call to pause") ||
    message.includes("interrupted by a new load request")
  );
}

function isWebsiteVideoProxySrc(uri: string | null | undefined): boolean {
  return (
    typeof uri === "string" &&
    (uri.startsWith("app://external/web-url?") || uri.startsWith("app://external/stash?"))
  );
}

function toFiniteNonNegativeSec(valueMs: number | null | undefined): number {
  return typeof valueMs === "number" && Number.isFinite(valueMs) ? Math.max(0, valueMs / 1000) : 0;
}

function resolvePlaybackWindowForDuration(
  resource: Pick<PlaybackResource, "startTime" | "endTime"> | null | undefined,
  durationSec: number
) {
  const hasFiniteDuration = Number.isFinite(durationSec) && durationSec > 0;
  const startSec = toFiniteNonNegativeSec(resource?.startTime);
  const rawEndSec =
    typeof resource?.endTime === "number" && Number.isFinite(resource.endTime)
      ? Math.max(0, resource.endTime / 1000)
      : null;
  const boundedStartSec = hasFiniteDuration ? Math.min(startSec, durationSec) : startSec;
  let boundedEndSec = rawEndSec;
  if (boundedEndSec !== null && hasFiniteDuration) {
    boundedEndSec = Math.min(boundedEndSec, durationSec);
  }
  if (boundedEndSec !== null && boundedEndSec <= boundedStartSec + 0.001) {
    boundedEndSec = null;
  }
  return { startSec: boundedStartSec, endSec: boundedEndSec };
}

function clampToPlaybackWindow(
  valueSec: number,
  window: { startSec: number; endSec: number | null }
): number {
  return Math.max(window.startSec, Math.min(valueSec, window.endSec ?? valueSec));
}

function AntiPerkBeatbar({
  actions,
  beatbarEvents,
  beatHits,
  elapsedMs,
  showBeatbar,
  showBall,
  style,
}: {
  actions: FunscriptAction[];
  beatbarEvents: BeatbarMotionEvent[];
  beatHits: BeatHit[];
  elapsedMs: number;
  showBeatbar: boolean;
  showBall: boolean;
  style: "jackhammer" | "milker" | "neutral";
}) {
  const noteColor = style === "jackhammer" ? "rgba(251,113,133,0.98)" : "rgba(34,211,238,0.98)";
  const glowColor = style === "jackhammer" ? "rgba(251,113,133,0.52)" : "rgba(34,211,238,0.46)";
  const activeIndex = beatHits.findIndex((hit) => elapsedMs < hit.at);
  const hitPulse =
    activeIndex >= 0 && activeIndex < beatHits.length
      ? Math.max(0, 1 - Math.abs(beatHits[activeIndex]!.at - elapsedMs) / 110)
      : 0;
  const currentPosition =
    actions.length > 0 ? (getFunscriptPositionAtMs({ actions }, elapsedMs) ?? 50) : 50;
  const visibleEvents = beatbarEvents.filter(
    (event) =>
      event.at >= elapsedMs - ANTI_PERK_BEATBAR_TRAIL_MS &&
      event.at <= elapsedMs + ANTI_PERK_BEATBAR_LEAD_MS
  );
  const positionToPercent = (pos: number) => 88 - pos * 0.76;

  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute inset-x-0 bottom-[12%] z-[62] mx-auto w-[min(92vw,960px)] px-4"
      data-testid="anti-perk-beatbar"
    >
      <div className="relative h-24 overflow-hidden">
        <div
          className="absolute bottom-[12%] left-1/2 top-[12%] w-[4px] -translate-x-1/2 rounded-full"
          style={{
            background: noteColor,
            boxShadow: `0 0 ${24 + hitPulse * 20}px ${glowColor}`,
            opacity: 0.88 + hitPulse * 0.12,
          }}
        />
        {showBeatbar &&
          visibleEvents.map((event) => {
            if (event.kind === "vibration") return null;

            const relativeMs = event.at - elapsedMs;
            const normalized =
              (relativeMs + ANTI_PERK_BEATBAR_TRAIL_MS) /
              (ANTI_PERK_BEATBAR_LEAD_MS + ANTI_PERK_BEATBAR_TRAIL_MS);
            const left = normalized * 100;
            const proximity =
              1 -
              Math.min(
                1,
                Math.abs(relativeMs) / (ANTI_PERK_BEATBAR_LEAD_MS + ANTI_PERK_BEATBAR_TRAIL_MS)
              );

            return (
              <div
                key={`${event.at}-${event.toPos}-downstroke`}
                className="absolute -translate-x-1/2 rounded-full"
                data-testid="anti-perk-beat-note"
                style={{
                  left: `${left}%`,
                  top: "12%",
                  bottom: "12%",
                  width: `${style === "jackhammer" ? 9 : 11 + event.strength * 2}px`,
                  background: `linear-gradient(180deg, rgba(255,255,255,0.88), ${noteColor} 28%, rgba(255,255,255,0.28) 100%)`,
                  boxShadow: `0 0 ${12 + proximity * 16}px ${glowColor}`,
                  opacity: 0.4 + proximity * 0.52,
                }}
              />
            );
          })}
        {showBall && (
          <div
            className="absolute left-1/2 h-5 w-5 -translate-x-1/2 -translate-y-1/2 rounded-full border border-white/40"
            data-testid="anti-perk-position-ball"
            style={{
              top: `${positionToPercent(currentPosition)}%`,
              background: noteColor,
              boxShadow: `0 0 ${14 + hitPulse * 18}px ${glowColor}`,
              transform: `translate(-50%, -50%) scale(${1 + hitPulse * 0.24})`,
            }}
          />
        )}
      </div>
    </div>
  );
}

function applyTimelineIntensityCap(
  timeline: Awaited<ReturnType<typeof loadFunscriptTimeline>>,
  cap: number | null | undefined
): Awaited<ReturnType<typeof loadFunscriptTimeline>> {
  if (!timeline) return timeline;
  if (typeof cap !== "number" || !Number.isFinite(cap)) return timeline;
  const normalizedCap = Math.max(0.1, Math.min(1, cap));
  const maxPos = normalizedCap * 100;
  return {
    actions: timeline.actions.map((action) => ({
      ...action,
      pos: Math.max(0, Math.min(maxPos, action.pos)),
    })),
  };
}

export function RoundVideoOverlay({
  activeRound,
  installedRounds,
  currentPlayer,
  roundControl,
  intermediaryProbability,
  boardSequence = null,
  idleBoardSequence = null,
  onCompleteBoardSequence,
  continuousMoaningActive = false,
  allowAutomaticIntermediaries = true,
  showCloseButton = false,
  onClose,
  booruSearchPrompt,
  intermediaryLoadingDurationSec,
  intermediaryReturnPauseSec,
  onFinishRound,
  onRequestCum,
  cumRequestSignal,
  showCumRoundOutcomeMenuOnCumRequest = false,
  onOpenOptions,
  allowDebugRoundControls = false,
  extraModifiers = [],
  onFunscriptFrame,
  onUiVisibilityChange,
  onPreviewStateChange,
  initialShowProgressBarAlways = DEFAULT_ROUND_PROGRESS_BAR_ALWAYS_VISIBLE,
  initialShowAntiPerkBeatbar = DEFAULT_ANTI_PERK_BEATBAR_ENABLED,
  lastLogMessage,
}: RoundVideoOverlayProps) {
  const { t } = useLingui();
  const { playRandomOneShot, startContinuousLoop, stopContinuousLoop } = useGameplayMoaning();
  const {
    connectionKey,
    appApiKey,
    offsetMs,
    connected: handyConnected,
    manuallyStopped: handyManuallyStopped,
    setSyncStatus,
    toggleManualStop,
  } = useHandy();
  const isDevelopmentMode = isGameDevelopmentMode();
  const sfwMode = useSfwMode();
  const canUseDebugRoundControls = isDevelopmentMode || allowDebugRoundControls;

  const mainVideoRef = useRef<HTMLVideoElement>(null);
  const intermediaryVideoRef = useRef<HTMLVideoElement>(null);
  const foregroundMainVideo = useForegroundVideoRegistration(
    `game-main:${activeRound?.roundId ?? "none"}:${activeRound?.fieldId ?? "none"}`
  );
  const foregroundIntermediaryVideo = useForegroundVideoRegistration(
    `game-intermediary:${activeRound?.roundId ?? "none"}:${activeRound?.fieldId ?? "none"}`
  );
  const initializedRoundKeyRef = useRef<string | null>(null);
  const forceHandySyncMsRef = useRef<number | null>(null);
  const pendingVideoSeekSecRef = useRef<number | null>(null);
  const mainResumePositionSecRef = useRef<number | null>(null);
  const allowPauseRef = useRef(false);
  const firedTriggersRef = useRef(new Set<string>());
  const sessionStartedAtRef = useRef(0);
  const antiPerkCountAtRoundStartRef = useRef(0);
  const timelineCacheRef = useRef(
    new Map<string, Awaited<ReturnType<typeof loadFunscriptTimeline>>>()
  );

  const countdownTimerRef = useRef<number | null>(null);
  const loadingRotateTimerRef = useRef<number | null>(null);
  const loadingFetchTokenRef = useRef(0);
  const loadingMediaCacheRef = useRef(new Map<string, LoadingMediaItem[]>());
  const uiHideTimerRef = useRef<number | null>(null);
  const manualPauseTimerRef = useRef<number | null>(null);
  const generatedSequenceTimerRef = useRef<number | null>(null);
  const generatedSequenceSyncTokenRef = useRef(0);
  const activeGeneratedSequenceRef = useRef<AntiPerkSequenceId | null>(null);
  const onCompleteBoardSequenceRef = useRef(onCompleteBoardSequence);
  const onUiVisibilityChangeRef = useRef(onUiVisibilityChange);
  onUiVisibilityChangeRef.current = onUiVisibilityChange;
  const onPreviewStateChangeRef = useRef(onPreviewStateChange);
  onPreviewStateChangeRef.current = onPreviewStateChange;
  const lastPreviewStateRef = useRef<{ active: boolean; loading: boolean } | null>(null);
  const antiPerkBeatAnimationFrameRef = useRef<number | null>(null);
  const lastMouseMoveAtRef = useRef(0);

  const lastPlaybackRateLabelRef = useRef("1.00");
  const lastFramePositionRef = useRef<number | null>(null);
  const lastFrameTimeMsRef = useRef<number | null>(null);
  const finishRequestedRef = useRef(false);
  const needsMainWindowSeekRef = useRef(false);
  const missingMediaCloseHandledRef = useRef(false);

  const handySessionRef = useRef<HandySession | null>(null);
  const handyInitPromiseRef = useRef<Promise<HandySession | null> | null>(null);
  const handyPushInFlightRef = useRef(false);
  const handyLastPushAtRef = useRef(0);
  const handyLastPushPosRef = useRef<number | null>(null);
  const handyLastSuccessAtRef = useRef(0);
  const handySyncStateRef = useRef<HandySyncState>("disconnected");
  const handyBootstrapKeyRef = useRef<string | null>(null);
  const handyBootstrapInFlightRef = useRef<string | null>(null);
  const pendingVideoActivationTokenRef = useRef(0);

  const [segment, setSegment] = useState<SegmentState>({ kind: "main" });
  const [activeVideoUri, setActiveVideoUri] = useState<string | null>(null);
  const [status, setStatus] = useState(t`Preparing playback...`);
  const [playbackRateLabel, setPlaybackRateLabel] = useState("1.00");
  const [playbackTimeLabel, setPlaybackTimeLabel] = useState("0:00 / 0:00");
  const [playbackProgress, setPlaybackProgress] = useState(0);
  const [funscriptCount, setFunscriptCount] = useState(0);
  const [funscriptPosition, setFunscriptPosition] = useState<number | null>(null);
  const [randomIntermediaryQueue, setRandomIntermediaryQueue] = useState<IntermediaryTrigger[]>([]);
  const [loadingCountdown, setLoadingCountdown] = useState<number | null>(null);
  const [loadingLabel, setLoadingLabel] = useState<string>("");
  const [loadingMedia, setLoadingMedia] = useState<LoadingMediaItem[]>([]);
  const [loadingMediaIndex, setLoadingMediaIndex] = useState(0);
  const [isUiVisible, setIsUiVisible] = useState(true);
  const [showProgressBarAlways, setShowProgressBarAlways] = useState(initialShowProgressBarAlways);
  const [showAntiPerkBeatbar, setShowAntiPerkBeatbar] = useState(initialShowAntiPerkBeatbar);
  const [isRemoteVideoLoading, setIsRemoteVideoLoading] = useState(false);
  const [allowUnsafeMediaOnce, setAllowUnsafeMediaOnce] = useState(false);
  const [pendingCumRoundSummary, setPendingCumRoundSummary] =
    useState<CompletedRoundSummary | null>(null);
  const [activeAntiPerkSequence, setActiveAntiPerkSequence] =
    useState<ActiveAntiPerkSequenceUi | null>(null);
  const [antiPerkBeatElapsedMs, setAntiPerkBeatElapsedMs] = useState(0);
  const [antiPerkAlert, setAntiPerkAlert] = useState<{ text: string; startTime: number } | null>(
    null
  );
  const overlayRef = useRef<HTMLDivElement | null>(null);
  const cumOutcomeRef = useRef<HTMLDivElement | null>(null);
  const lastShownAntiPerkAlertRef = useRef<string | null>(null);

  const [timeline, setTimeline] = useState<Awaited<ReturnType<typeof loadFunscriptTimeline>>>(null);
  const [timelineUri, setTimelineUri] = useState<string | null>(null);

  const [handySyncState, setHandySyncState] = useState<HandySyncState>("disconnected");
  const [handySyncError, setHandySyncError] = useState<string | null>(null);
  const [failedVideoUri, setFailedVideoUri] = useState<string | null>(null);
  const [missingMediaAutoCloseRemainingSec, setMissingMediaAutoCloseRemainingSec] =
    useState<number | null>(null);
  const { getVideoSrc, ensurePlayableVideo, handleVideoError } = usePlayableVideoFallback();

  const applyHandyOffsetMs = useCallback(
    (baseTimeMs: number) => Math.max(0, Math.floor(baseTimeMs + offsetMs)),
    [offsetMs]
  );

  const formatHandyOffsetLabel = useCallback(
    (valueMs: number) => `${valueMs >= 0 ? "+" : ""}${valueMs}ms`,
    []
  );

  const activateVideoUri = useCallback(
    (nextVideoUri: string | null) => {
      const activationToken = pendingVideoActivationTokenRef.current + 1;
      pendingVideoActivationTokenRef.current = activationToken;

      if (!nextVideoUri) {
        setActiveVideoUri(null);
        return;
      }

      setActiveVideoUri(null);
      void ensurePlayableVideo(nextVideoUri)
        .catch(() => null)
        .finally(() => {
          if (pendingVideoActivationTokenRef.current !== activationToken) return;
          setActiveVideoUri(nextVideoUri);
        });
    },
    [ensurePlayableVideo]
  );

  useEffect(() => {
    onCompleteBoardSequenceRef.current = onCompleteBoardSequence;
  }, [onCompleteBoardSequence]);

  useEffect(() => {
    if (!continuousMoaningActive) {
      stopContinuousLoop();
      return;
    }
    void startContinuousLoop();
    return () => {
      stopContinuousLoop();
    };
  }, [continuousMoaningActive, startContinuousLoop, stopContinuousLoop]);

  useEffect(() => {
    handySyncStateRef.current = handySyncState;
  }, [handySyncState]);

  useEffect(() => {
    setAllowUnsafeMediaOnce(false);
  }, [activeRound?.fieldId, activeRound?.roundId]);

  const resolvedRound = useMemo(() => {
    if (!activeRound) return null;
    return installedRounds.find((round) => round.id === activeRound.roundId) ?? null;
  }, [activeRound, installedRounds]);
  const resolvedMainResource = useMemo<PlaybackResource | null>(() => {
    const resource = resolvedRound?.resources[0];
    if (!resource) return null;
    return {
      videoUri: resource.videoUri,
      funscriptUri: resource.funscriptUri,
      startTime: resolvedRound?.startTime,
      endTime: resolvedRound?.endTime,
    };
  }, [resolvedRound]);

  const intermediaryVideoUri =
    segment.kind === "intermediary" ? segment.trigger.resource.videoUri : null;

  useEffect(() => {
    setFailedVideoUri(null);
  }, [resolvedMainResource?.videoUri, intermediaryVideoUri]);

  const mainResourceDurationSec = useMemo(() => {
    const durationMs = resolvedRound?.resources[0]?.durationMs;
    if (typeof durationMs !== "number" || !Number.isFinite(durationMs) || durationMs <= 0) {
      return null;
    }
    return durationMs / 1000;
  }, [resolvedRound]);

  const resolveMainWindowForDuration = useCallback(
    (durationSec: number) => resolvePlaybackWindowForDuration(resolvedMainResource, durationSec),
    [resolvedMainResource]
  );

  const intermediaryResourcePool = useMemo<PlaybackResource[]>(() => {
    const pool = installedRounds
      .filter((round) => round.type === "Interjection")
      .map((round) => {
        const resource = round.resources[0];
        if (!resource) return null;
        return {
          videoUri: resource.videoUri,
          funscriptUri: resource.funscriptUri,
          startTime: round.startTime,
          endTime: round.endTime,
        } satisfies PlaybackResource;
      })
      .filter((resource): resource is PlaybackResource => Boolean(resource));

    if (!resolvedMainResource) return pool;
    return pool.filter((resource) => resource.videoUri !== resolvedMainResource.videoUri);
  }, [installedRounds, resolvedMainResource]);

  const deterministicTestIntermediary = useMemo<PlaybackResource | null>(() => {
    if (!canUseDebugRoundControls) return null;
    return (
      intermediaryResourcePool.find((resource) =>
        resource.videoUri.includes("Fugtrup%20Zelda%20x%20Bokoblin.mp4")
      ) ?? null
    );
  }, [canUseDebugRoundControls, intermediaryResourcePool]);

  const sessionModifiers = useMemo(() => {
    if (!allowAutomaticIntermediaries) return [];
    if (!resolvedMainResource || !currentPlayer) return [];
    return getActivePlaybackModifiers(
      {
        playerPerks: currentPlayer.perks,
        playerAntiPerks: currentPlayer.antiPerks,
        mainResource: resolvedMainResource,
        intermediaryResources: intermediaryResourcePool,
      },
      extraModifiers
    );
  }, [
    allowAutomaticIntermediaries,
    currentPlayer,
    extraModifiers,
    intermediaryResourcePool,
    resolvedMainResource,
  ]);

  const intermediaryQueue = useMemo(() => {
    if (!allowAutomaticIntermediaries) return [];
    if (!resolvedMainResource || !currentPlayer) return [];
    return buildIntermediaryQueue(sessionModifiers, {
      playerPerks: currentPlayer.perks,
      playerAntiPerks: currentPlayer.antiPerks,
      mainResource: resolvedMainResource,
      intermediaryResources: intermediaryResourcePool,
    });
  }, [
    allowAutomaticIntermediaries,
    currentPlayer,
    intermediaryResourcePool,
    resolvedMainResource,
    sessionModifiers,
  ]);

  const fullIntermediaryQueue = useMemo(
    () =>
      [...intermediaryQueue, ...randomIntermediaryQueue].sort(
        (a, b) => a.atProgress - b.atProgress
      ),
    [intermediaryQueue, randomIntermediaryQueue]
  );

  const activeSegmentResource = useMemo<PlaybackResource | null>(() => {
    if (segment.kind === "intermediary") return segment.trigger.resource;
    return resolvedMainResource;
  }, [resolvedMainResource, segment]);

  const isIntermediaryScreenActive = loadingCountdown !== null;
  const resolvedMainVideoSrc = resolvedMainResource
    ? getVideoSrc(resolvedMainResource.videoUri)
    : undefined;
  const resolvedIntermediaryVideoSrc =
    segment.kind === "intermediary" ? getVideoSrc(segment.trigger.resource.videoUri) : undefined;
  const activeResolvedVideoSrc = activeSegmentResource
    ? (getVideoSrc(activeSegmentResource.videoUri) ?? null)
    : null;
  const isRemoteVideoUri = useMemo(
    () =>
      Boolean(
        activeVideoUri &&
        (/^https?:\/\//i.test(activeVideoUri) || activeVideoUri.startsWith("app://external/"))
      ),
    [activeVideoUri]
  );

  const hasUsableActiveTimeline =
    Boolean(activeSegmentResource?.funscriptUri) &&
    timelineUri === activeSegmentResource?.funscriptUri &&
    (timeline?.actions.length ?? 0) > 0;

  const shouldUseHandySync =
    hasUsableActiveTimeline &&
    handyConnected &&
    !handyManuallyStopped &&
    connectionKey.trim().length > 0 &&
    appApiKey.trim().length > 0;
  const isWaitingForHandyStart = shouldUseHandySync && handySyncState !== "synced";
  const shouldGatePlaybackForHandyStart =
    shouldUseHandySync &&
    handySyncState !== "synced" &&
    (forceHandySyncMsRef.current !== null || handyBootstrapKeyRef.current === null);
  const handyWaitHint =
    handySyncState === "error"
      ? t`The device reported a sync error. Retrying handshake...`
      : handySyncState === "connecting"
        ? t`Aligning timeline with TheHandy before playback starts.`
        : t`Preparing TheHandy synchronization.`;
  const isOnlyNoRest = useMemo(
    () => idleBoardSequence === "no-rest" && !activeRound && !boardSequence,
    [idleBoardSequence, activeRound, boardSequence]
  );

  const fallbackLoadingMedia = useMemo<LoadingMediaItem[]>(
    () =>
      intermediaryResourcePool.slice(0, 24).map((resource, index) => ({
        id: `fallback-${index}-${resource.videoUri}`,
        source: "fallback",
        url: resource.videoUri,
        previewUrl: null,
      })),
    [intermediaryResourcePool]
  );

  useEffect(() => {
    const originalUri = activeSegmentResource?.videoUri;
    if (!originalUri) return;
    if (isLocalVideoUriForFallback(originalUri)) {
      let cancelled = false;
      void ensurePlayableVideo(originalUri).then(() => {
        if (cancelled) return;
      });
      return () => {
        cancelled = true;
      };
    }
    if (!isWebsiteVideoProxySrc(activeResolvedVideoSrc)) return;

    let cancelled = false;
    let timeoutId: number | null = null;

    const pollForCachedPlayback = async () => {
      const resolved = await ensurePlayableVideo(originalUri);
      if (cancelled || resolved) return;
      timeoutId = window.setTimeout(() => {
        void pollForCachedPlayback();
      }, 2500);
    };

    void pollForCachedPlayback();

    return () => {
      cancelled = true;
      if (timeoutId !== null) {
        window.clearTimeout(timeoutId);
      }
    };
  }, [activeResolvedVideoSrc, activeSegmentResource?.videoUri, ensurePlayableVideo]);

  const clearCountdownTimer = useCallback(() => {
    if (countdownTimerRef.current !== null) {
      window.clearInterval(countdownTimerRef.current);
      countdownTimerRef.current = null;
    }
  }, []);

  const clearLoadingMediaTimers = useCallback(() => {
    if (loadingRotateTimerRef.current !== null) {
      window.clearInterval(loadingRotateTimerRef.current);
      loadingRotateTimerRef.current = null;
    }
    loadingFetchTokenRef.current += 1;
  }, []);

  const clearUiHideTimer = useCallback(() => {
    if (uiHideTimerRef.current !== null) {
      window.clearTimeout(uiHideTimerRef.current);
      uiHideTimerRef.current = null;
    }
  }, []);

  const clearManualPauseTimer = useCallback(() => {
    if (manualPauseTimerRef.current !== null) {
      window.clearTimeout(manualPauseTimerRef.current);
      manualPauseTimerRef.current = null;
    }
  }, []);

  const clearGeneratedSequenceTimer = useCallback(() => {
    generatedSequenceSyncTokenRef.current += 1;
    if (generatedSequenceTimerRef.current !== null) {
      window.clearInterval(generatedSequenceTimerRef.current);
      generatedSequenceTimerRef.current = null;
    }
  }, []);

  const clearAntiPerkBeatUi = useCallback(() => {
    if (antiPerkBeatAnimationFrameRef.current !== null) {
      window.cancelAnimationFrame(antiPerkBeatAnimationFrameRef.current);
      antiPerkBeatAnimationFrameRef.current = null;
    }
    setActiveAntiPerkSequence(null);
    setAntiPerkBeatElapsedMs(0);
  }, []);

  useEffect(() => {
    const existing = loadingMediaCacheRef.current.get(booruSearchPrompt);
    if (existing && existing.length > 0) return;

    let cancelled = false;
    void getCachedBooruMedia(booruSearchPrompt).then((cachedMedia) => {
      if (cancelled || cachedMedia.length === 0) return;
      loadingMediaCacheRef.current.set(booruSearchPrompt, cachedMedia);
    });

    return () => {
      cancelled = true;
    };
  }, [booruSearchPrompt]);

  const showUiTemporarily = useCallback(
    (durationMs: number) => {
      clearUiHideTimer();
      setIsUiVisible(true);
      uiHideTimerRef.current = window.setTimeout(() => {
        setIsUiVisible(false);
      }, durationMs);
    },
    [clearUiHideTimer]
  );

  const resetHandySync = useCallback(
    (nextState: HandySyncState, message: string | null = null) => {
      handySessionRef.current = null;
      handyInitPromiseRef.current = null;
      handyPushInFlightRef.current = false;
      handyLastPushAtRef.current = 0;
      handyLastPushPosRef.current = null;
      handyLastSuccessAtRef.current = 0;
      setHandySyncState(nextState);
      setHandySyncError(message);
      setSyncStatus({ synced: false, error: message });
    },
    [setSyncStatus]
  );

  const stopHandyIfNeeded = useCallback(async () => {
    if (!handyConnected) return;
    if (!connectionKey.trim() || !appApiKey.trim()) return;
    const session = handySessionRef.current;
    if (!session) return;
    try {
      await stopHandyPlayback(
        {
          connectionKey: connectionKey.trim(),
          appApiKey: appApiKey.trim(),
        },
        session
      );
    } catch {
      // ignore teardown failures
    }
  }, [appApiKey, connectionKey, handyConnected]);

  const pauseHandyIfNeeded = useCallback(async () => {
    if (!handyConnected) return;
    if (!connectionKey.trim() || !appApiKey.trim()) return;
    const session = handySessionRef.current;
    if (!session) return;
    try {
      await pauseHandyPlayback(
        {
          connectionKey: connectionKey.trim(),
          appApiKey: appApiKey.trim(),
        },
        session
      );
    } catch {
      // ignore teardown failures
    }
  }, [appApiKey, connectionKey, handyConnected]);

  const resumeHandyIfNeeded = useCallback(async () => {
    if (!handyConnected) return;
    if (!connectionKey.trim() || !appApiKey.trim()) return;
    if (handyManuallyStopped) return;
    const session = handySessionRef.current;
    if (!session) return;
    const video = segment.kind === "main" ? mainVideoRef.current : intermediaryVideoRef.current;
    if (!video) return;

    try {
      const timeMs = Math.max(0, video.currentTime * 1000);
      const effectiveTimeMs = applyHandyOffsetMs(timeMs);
      const playbackRate = video.playbackRate ?? 1;

      await resumeHandyPlayback(
        {
          connectionKey: connectionKey.trim(),
          appApiKey: appApiKey.trim(),
        },
        session,
        effectiveTimeMs,
        playbackRate
      );
    } catch {
      // ignore resume failures
    }
  }, [
    appApiKey,
    applyHandyOffsetMs,
    connectionKey,
    handyConnected,
    handyManuallyStopped,
    segment.kind,
  ]);

  const ensureHandySession = useCallback(async (): Promise<HandySession | null> => {
    if (!handyConnected) return null;
    if (!connectionKey.trim() || !appApiKey.trim()) return null;

    const now = Date.now();
    const existing = handySessionRef.current;
    if (existing && existing.expiresAtMs - now > HANDY_REAUTH_MARGIN_MS) {
      return existing;
    }
    if (handyInitPromiseRef.current) {
      return handyInitPromiseRef.current;
    }

    setHandySyncState("connecting");
    setHandySyncError(null);

    const initPromise = issueHandySession({
      connectionKey: connectionKey.trim(),
      appApiKey: appApiKey.trim(),
    })
      .then((session) => {
        handySessionRef.current = session;
        return session;
      })
      .catch((error) => {
        const message =
          error instanceof Error ? error.message : t`Failed to initialize TheHandy session.`;
        resetHandySync("error", message);
        return null;
      })
      .finally(() => {
        handyInitPromiseRef.current = null;
      });

    handyInitPromiseRef.current = initPromise;
    return initPromise;
  }, [appApiKey, connectionKey, handyConnected, resetHandySync]);

  const createActiveAntiPerkSequenceUi = useCallback(
    (sequenceId: AntiPerkSequenceId): ActiveAntiPerkSequenceUi => {
      const definition = getAntiPerkSequenceDefinition(sequenceId);
      const durationMs = definition.durationSec * 1000;
      const actions = definition.createActions(durationMs);
      const beatHits = definition.extractBeatHits(actions);
      const startedAtMs = performance.now();
      return {
        id: sequenceId,
        definition,
        durationMs,
        startedAtMs,
        actions,
        beatHits,
        beatbarEvents: extractBeatbarMotionEvents(actions),
      };
    },
    []
  );

  const startGeneratedSequenceSync = useCallback(
    (input: {
      sequenceId: AntiPerkSequenceId;
      durationMs: number;
      actions: FunscriptAction[];
      startedAtMs: number;
      loop?: boolean;
    }) => {
      clearGeneratedSequenceTimer();
      if (!handyConnected) return;
      const appKey = appApiKey.trim();
      const connKey = connectionKey.trim();
      if (!appKey || !connKey) return null;

      const syncToken = generatedSequenceSyncTokenRef.current;
      const sourceId = `anti-${input.sequenceId}-${Date.now()}`;
      let preloadStarted = false;
      let syncInFlight = false;
      let queuedElapsedMs: number | null = null;

      const getCurrentElapsedMs = () => {
        const rawElapsedMs = Math.max(0, Math.floor(performance.now() - input.startedAtMs));
        return input.loop
          ? input.durationMs > 0
            ? rawElapsedMs % input.durationMs
            : 0
          : Math.max(0, Math.min(input.durationMs, rawElapsedMs));
      };

      const runSync = (elapsedMs: number) => {
        if (generatedSequenceSyncTokenRef.current !== syncToken) return;
        if (syncInFlight) {
          queuedElapsedMs = elapsedMs;
          return;
        }

        syncInFlight = true;
        void (async () => {
          try {
            const session = await ensureHandySession();
            if (!session || generatedSequenceSyncTokenRef.current !== syncToken) return;
            if (!preloadStarted) {
              preloadStarted = true;
              if (
                session.loadedScriptId !== null ||
                session.activeScriptId !== null ||
                session.streamedPoints !== null
              ) {
                await stopHandyPlayback({ connectionKey: connKey, appApiKey: appKey }, session);
                if (generatedSequenceSyncTokenRef.current !== syncToken) return;
              }
              await preloadHspScript(
                { connectionKey: connKey, appApiKey: appKey },
                session,
                sourceId,
                input.actions,
                0
              );
              if (generatedSequenceSyncTokenRef.current !== syncToken) return;
            }
            const effectiveElapsedMs = getCurrentElapsedMs();
            await sendHspSync(
              { connectionKey: connKey, appApiKey: appKey },
              session,
              effectiveElapsedMs,
              1,
              sourceId,
              input.actions
            );
            if (generatedSequenceSyncTokenRef.current !== syncToken) return;
            const syncedAt = Date.now();
            handyLastPushAtRef.current = syncedAt;
            handyLastSuccessAtRef.current = syncedAt;
            handyLastPushPosRef.current = getFunscriptPositionAtMs(
              { actions: input.actions },
              effectiveElapsedMs
            );
            setHandySyncState("synced");
            setHandySyncError(null);
            setSyncStatus({ synced: true, error: null });
          } catch (error) {
            if (generatedSequenceSyncTokenRef.current !== syncToken) return;
            const message =
              error instanceof Error ? error.message : t`Generated sequence sync failed.`;
            setHandySyncState("error");
            setHandySyncError(message);
            setSyncStatus({ synced: false, error: message });
          } finally {
            syncInFlight = false;
            if (generatedSequenceSyncTokenRef.current === syncToken && queuedElapsedMs !== null) {
              const nextElapsedMs = queuedElapsedMs;
              queuedElapsedMs = null;
              runSync(nextElapsedMs);
            }
          }
        })();
      };

      const tick = () => {
        const elapsedMs = getCurrentElapsedMs();
        runSync(elapsedMs);
      };

      tick();
      generatedSequenceTimerRef.current = window.setInterval(tick, HANDY_PUSH_INTERVAL_MS);
    },
    [
      appApiKey,
      clearGeneratedSequenceTimer,
      connectionKey,
      ensureHandySession,
      handyConnected,
      setSyncStatus,
    ]
  );

  const applySegmentSwitch = useCallback(
    (plan: TransitionPlan) => {
      const seekSec = plan.pendingSeekSec;
      const hasSeekTarget = seekSec != null && seekSec !== undefined;
      forceHandySyncMsRef.current = hasSeekTarget ? Math.max(0, seekSec * 1000) : null;
      pendingVideoSeekSecRef.current = hasSeekTarget ? Math.max(0, seekSec) : null;

      setSegment(plan.nextSegment);
      activateVideoUri(plan.nextVideoUri);
      setStatus(plan.status);
      setLoadingMedia([]);
      setLoadingMediaIndex(0);
    },
    [activateVideoUri]
  );

  const runSegmentTransition = useCallback(
    (params: {
      label: string;
      countdownSec: number;
      plan: TransitionPlan;
      statusWhileCountdown: string;
      sound: "intermediary" | "return" | "default";
      onComplete?: () => void;
    }) => {
      clearCountdownTimer();
      clearLoadingMediaTimers();

      if (params.sound === "intermediary") {
        playPerkActionSound();
      } else if (params.sound === "return") {
        playRoundStartSound();
      } else {
        playSelectSound();
      }

      const clamped = Math.max(0, Math.min(60, Math.floor(params.countdownSec)));
      if (clamped <= 0) {
        setLoadingLabel("");
        setLoadingCountdown(null);
        setLoadingMedia([]);
        setLoadingMediaIndex(0);
        applySegmentSwitch(params.plan);
        params.onComplete?.();
        return;
      }

      setLoadingLabel(params.label);
      setLoadingCountdown(clamped);
      setStatus(params.statusWhileCountdown);
      setActiveVideoUri(null);
      setFunscriptPosition(null);
      setLoadingMediaIndex(0);

      const token = loadingFetchTokenRef.current + 1;
      loadingFetchTokenRef.current = token;
      const cachedLoadingMedia = loadingMediaCacheRef.current.get(booruSearchPrompt);
      if (cachedLoadingMedia && cachedLoadingMedia.length > 0) {
        setLoadingMedia(cachedLoadingMedia);
      } else {
        setLoadingMedia(fallbackLoadingMedia);
        void getCachedBooruMediaForDisplay(booruSearchPrompt, 18).then((cachedMedia) => {
          if (loadingFetchTokenRef.current !== token) return;
          if (cachedMedia.length === 0) return;
          loadingMediaCacheRef.current.set(booruSearchPrompt, cachedMedia);
          setLoadingMedia(cachedMedia);
        });
      }

      void refreshBooruMediaCache(booruSearchPrompt, 18).then((media) => {
        if (loadingFetchTokenRef.current !== token) return;
        const nextMedia =
          media.length > 0
            ? media
            : cachedLoadingMedia && cachedLoadingMedia.length > 0
              ? cachedLoadingMedia
              : fallbackLoadingMedia;
        loadingMediaCacheRef.current.set(booruSearchPrompt, nextMedia);
        setLoadingMedia(nextMedia);
      });

      countdownTimerRef.current = window.setInterval(() => {
        setLoadingCountdown((prev) => {
          if (prev === null) return null;
          if (prev <= 1) {
            clearCountdownTimer();
            clearLoadingMediaTimers();
            setLoadingCountdown(null);
            setLoadingLabel("");
            setLoadingMedia([]);
            setLoadingMediaIndex(0);
            playDiceResultSound();
            applySegmentSwitch(params.plan);
            params.onComplete?.();
            return null;
          }
          return prev - 1;
        });
      }, 1000);

      loadingRotateTimerRef.current = window.setInterval(() => {
        setLoadingMediaIndex((prev) => prev + 1);
      }, LOADING_MEDIA_ROTATE_MS);
    },
    [
      applySegmentSwitch,
      booruSearchPrompt,
      clearCountdownTimer,
      clearLoadingMediaTimers,
      fallbackLoadingMedia,
    ]
  );

  const tryPlayVideo = useCallback(() => {
    const video = segment.kind === "main" ? mainVideoRef.current : intermediaryVideoRef.current;
    if (!video) return;
    const originalUri =
      segment.kind === "main" ? resolvedMainResource?.videoUri : activeSegmentResource?.videoUri;
    if (
      video.networkState === HTMLMediaElement.NETWORK_NO_SOURCE &&
      !video.currentSrc &&
      originalUri
    ) {
      void handleVideoError(originalUri);
      return;
    }
    if (isIntermediaryScreenActive) {
      setStatus(t`Playback paused for transition...`);
      return;
    }

    if (shouldGatePlaybackForHandyStart) {
      setStatus(t`Waiting for TheHandy sync before playback...`);
      return;
    }
    if (!video.paused) return;
    void video
      .play()
      .then(() => {
        if (shouldUseHandySync && !handyManuallyStopped && handySyncState === "synced") {
          void resumeHandyIfNeeded();
        }
      })
      .catch((error) => {
        if (isIgnorableVideoPlayError(error)) {
          return;
        }
        console.warn("Video autoplay failed", error);
      });
  }, [
    activeSegmentResource?.videoUri,
    activeVideoUri,
    handleVideoError,
    isIntermediaryScreenActive,
    shouldGatePlaybackForHandyStart,
    resolvedMainResource?.videoUri,
    segment.kind,
    shouldUseHandySync,
    handyManuallyStopped,
    handySyncState,
    resumeHandyIfNeeded,
  ]);

  const finishWithSummary = useCallback(() => {
    if (finishRequestedRef.current) return;
    finishRequestedRef.current = true;
    playDiceResultSound();
    const summary: CompletedRoundSummary = {
      intermediaryCount: firedTriggersRef.current.size,
      activeAntiPerkCount: antiPerkCountAtRoundStartRef.current,
    };
    if (activeRound?.phaseKind === "cum") {
      setPendingCumRoundSummary(summary);
      void stopHandyIfNeeded();
      return;
    }
    void stopHandyIfNeeded().finally(() => {
      onFinishRound(summary);
    });
  }, [activeRound?.phaseKind, onFinishRound, stopHandyIfNeeded]);

  const resolveCumRoundOutcome = useCallback(
    (cumOutcome: CumRoundOutcome) => {
      const summary = pendingCumRoundSummary ?? {
        intermediaryCount: firedTriggersRef.current.size,
        activeAntiPerkCount: antiPerkCountAtRoundStartRef.current,
      };
      setPendingCumRoundSummary(null);
      void stopHandyIfNeeded().finally(() => {
        onFinishRound({
          ...summary,
          cumOutcome,
        });
      });
    },
    [onFinishRound, pendingCumRoundSummary, stopHandyIfNeeded]
  );

  const handleCloseCumDialog = useCallback(() => {
    setPendingCumRoundSummary(null);
    if (!onClose) return;
    void stopHandyIfNeeded().finally(() => {
      onClose();
    });
  }, [onClose, stopHandyIfNeeded]);

  const handleCumRequest = useCallback(() => {
    if (showCumRoundOutcomeMenuOnCumRequest && activeRound?.phaseKind === "cum") {
      if (pendingCumRoundSummary) return;
      setPendingCumRoundSummary({
        intermediaryCount: firedTriggersRef.current.size,
        activeAntiPerkCount: antiPerkCountAtRoundStartRef.current,
      });
      void stopHandyIfNeeded();
      return;
    }
    onRequestCum?.();
  }, [
    activeRound?.phaseKind,
    onRequestCum,
    pendingCumRoundSummary,
    showCumRoundOutcomeMenuOnCumRequest,
    stopHandyIfNeeded,
  ]);

  const lastHandledCumRequestSignalRef = useRef(cumRequestSignal);
  useEffect(() => {
    if (cumRequestSignal === undefined) return;
    if (cumRequestSignal === lastHandledCumRequestSignalRef.current) return;
    lastHandledCumRequestSignalRef.current = cumRequestSignal;
    handleCumRequest();
  }, [cumRequestSignal, handleCumRequest]);

  const startIntermediary = useCallback(
    (trigger: IntermediaryTrigger, resumeAtSec: number, statusText: string) => {
      firedTriggersRef.current.add(trigger.id);
      mainResumePositionSecRef.current = Math.max(0, resumeAtSec);
      runSegmentTransition({
        label: t`LOADING INTERMEDIARY`,
        countdownSec: intermediaryLoadingDurationSec,
        statusWhileCountdown: t`Loading intermediary assets...`,
        sound: "intermediary",
        plan: {
          nextSegment: { kind: "intermediary", trigger, resumeAtSec },
          nextVideoUri: trigger.resource.videoUri,
          status: statusText,
        },
      });
    },
    [intermediaryLoadingDurationSec, runSegmentTransition]
  );

  const endIntermediaryAndResume = useCallback(
    (statusText = t`Returning to main round video.`) => {
      if (!resolvedMainResource) return;
      if (segment.kind !== "intermediary") return;
      const knownDurationSec =
        Number.isFinite(mainVideoRef.current?.duration) && (mainVideoRef.current?.duration ?? 0) > 0
          ? (mainVideoRef.current?.duration ?? 0)
          : (mainResourceDurationSec ?? Number.NaN);
      const mainWindow = resolveMainWindowForDuration(knownDurationSec);
      const resumeAtSec = clampToPlaybackWindow(
        mainResumePositionSecRef.current ?? segment.resumeAtSec,
        mainWindow
      );
      mainResumePositionSecRef.current = resumeAtSec;

      runSegmentTransition({
        label: t`RETURNING TO MAIN`,
        countdownSec: intermediaryReturnPauseSec,
        statusWhileCountdown: t`Preparing main round resume...`,
        sound: "return",
        plan: {
          nextSegment: { kind: "main" },
          nextVideoUri: resolvedMainResource.videoUri,
          status: statusText,
          pendingSeekSec: resumeAtSec,
        },
      });
    },
    [
      intermediaryReturnPauseSec,
      mainResourceDurationSec,
      resolveMainWindowForDuration,
      resolvedMainResource,
      runSegmentTransition,
      segment,
    ]
  );

  const handleMissingMediaClose = useCallback(
    ({ playSound }: { playSound: boolean }) => {
      if (missingMediaCloseHandledRef.current) return;
      missingMediaCloseHandledRef.current = true;
      setFailedVideoUri(null);
      setMissingMediaAutoCloseRemainingSec(null);

      if (playSound) {
        playSelectSound();
      }

      if (showCloseButton && onClose) {
        void stopHandyIfNeeded().finally(() => {
          onClose();
        });
        return;
      }

      if (segment.kind === "intermediary" && resolvedMainResource) {
        void stopHandyIfNeeded().finally(() => {
          endIntermediaryAndResume(t`Intermediary media was not found. Returning to main video.`);
        });
        return;
      }

      finishWithSummary();
    },
    [
      endIntermediaryAndResume,
      finishWithSummary,
      onClose,
      resolvedMainResource,
      segment.kind,
      showCloseButton,
      stopHandyIfNeeded,
      t,
    ]
  );
  const handleMissingMediaCloseRef = useRef(handleMissingMediaClose);

  useEffect(() => {
    handleMissingMediaCloseRef.current = handleMissingMediaClose;
  }, [handleMissingMediaClose]);

  const isMissingMediaUiVisible =
    Boolean(activeRound) && (Boolean(failedVideoUri) || !resolvedMainResource);

  useEffect(() => {
    if (!isMissingMediaUiVisible) {
      missingMediaCloseHandledRef.current = false;
      setMissingMediaAutoCloseRemainingSec(null);
      return;
    }

    missingMediaCloseHandledRef.current = false;
    setMissingMediaAutoCloseRemainingSec(Math.ceil(MEDIA_NOT_FOUND_AUTO_CLOSE_MS / 1000));

    const startedAtMs = Date.now();
    const intervalId = window.setInterval(() => {
      const elapsedMs = Date.now() - startedAtMs;
      const remainingMs = Math.max(0, MEDIA_NOT_FOUND_AUTO_CLOSE_MS - elapsedMs);
      setMissingMediaAutoCloseRemainingSec(Math.max(1, Math.ceil(remainingMs / 1000)));
    }, 250);
    const timeoutId = window.setTimeout(() => {
      handleMissingMediaCloseRef.current({ playSound: false });
    }, MEDIA_NOT_FOUND_AUTO_CLOSE_MS);

    return () => {
      window.clearInterval(intervalId);
      window.clearTimeout(timeoutId);
    };
  }, [
    activeRound?.fieldId,
    activeRound?.roundId,
    failedVideoUri,
    isMissingMediaUiVisible,
    segment.kind,
  ]);

  const triggerTestIntermediary = useCallback(() => {
    if (!activeRound || !resolvedMainResource) return;
    if (segment.kind !== "main") {
      setStatus(t`Already inside an intermediary segment.`);
      return;
    }
    if (intermediaryResourcePool.length === 0) {
      setStatus(t`No intermediary resources available for this round.`);
      return;
    }

    const video = segment.kind === "main" ? mainVideoRef.current : intermediaryVideoRef.current;
    if (!video) return;

    const resource =
      deterministicTestIntermediary ??
      intermediaryResourcePool[Math.floor(Math.random() * intermediaryResourcePool.length)];
    if (!resource) return;

    const trigger: IntermediaryTrigger = {
      id: `dev-test-${Date.now()}`,
      atProgress: 0.5,
      resource,
    };

    const { startSec, endSec } = resolveMainWindowForDuration(video.duration);
    const resumeAtSec = Math.max(
      startSec,
      Math.min(video.currentTime, endSec ?? video.currentTime)
    );

    allowPauseRef.current = true;
    video.pause();
    startIntermediary(trigger, resumeAtSec, t`Development: forced intermediary clip.`);
  }, [
    activeRound,
    deterministicTestIntermediary,
    intermediaryResourcePool,
    resolveMainWindowForDuration,
    resolvedMainResource,
    segment.kind,
    startIntermediary,
  ]);

  const resyncHandyTiming = useCallback(async () => {
    if (!activeRound || !activeVideoUri) {
      setStatus(t`No active video to resync.`);
      return;
    }
    if (!shouldUseHandySync) {
      setStatus(t`No active TheHandy timeline to resync.`);
      return;
    }
    const video = segment.kind === "main" ? mainVideoRef.current : intermediaryVideoRef.current;
    const actions = timeline?.actions ?? [];
    if (!video || actions.length === 0) return;

    setStatus(t`Resyncing TheHandy timing...`);
    setHandySyncState("connecting");
    setHandySyncError(null);
    setSyncStatus({ synced: false, error: null });

    try {
      const timeMs = Math.max(0, video.currentTime * 1000);
      const effectiveTimeMs = applyHandyOffsetMs(timeMs);
      const playbackRate = video.playbackRate ?? 1;

      if (!connectionKey.trim() || !appApiKey.trim()) {
        setHandySyncState("missing-key");
        setSyncStatus({ synced: false, error: t`Missing Application ID/API key for TheHandy v3.` });
        setStatus(t`Cannot resync: missing Application ID/API key.`);
        return;
      }

      const session = await ensureHandySession();
      if (!session) {
        setStatus(t`Failed to initialize TheHandy session for resync.`);
        return;
      }

      session.lastSyncAtMs = 0;
      await preloadHspScript(
        {
          connectionKey: connectionKey.trim(),
          appApiKey: appApiKey.trim(),
        },
        session,
        `${activeVideoUri}:${segment.kind}`,
        actions
      );
      await sendHspSync(
        {
          connectionKey: connectionKey.trim(),
          appApiKey: appApiKey.trim(),
        },
        session,
        effectiveTimeMs,
        playbackRate,
        `${activeVideoUri}:${segment.kind}`,
        actions
      );

      const syncedAt = Date.now();
      handyLastPushAtRef.current = syncedAt;
      handyLastSuccessAtRef.current = syncedAt;
      handyLastPushPosRef.current = getFunscriptPositionAtMs(timeline, effectiveTimeMs);
      setHandySyncState("synced");
      setHandySyncError(null);
      setSyncStatus({ synced: true, error: null });
      setStatus(t`TheHandy timing resynced.`);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : t`Failed to resync timing with TheHandy.`;
      setHandySyncState("error");
      setHandySyncError(message);
      setSyncStatus({ synced: false, error: message });
      setStatus(t`Resync failed: ${message}`);
    }
  }, [
    activeRound,
    activeVideoUri,
    applyHandyOffsetMs,
    appApiKey,
    connectionKey,
    ensureHandySession,
    segment.kind,
    setSyncStatus,
    shouldUseHandySync,
    timeline,
  ]);

  const bootstrapHandySyncIfReady = useCallback(async (): Promise<boolean> => {
    if (!shouldUseHandySync) return false;
    if (!activeRound || !activeVideoUri) return false;
    if (isIntermediaryScreenActive) return false;

    const video = segment.kind === "main" ? mainVideoRef.current : intermediaryVideoRef.current;
    const actions = timeline?.actions ?? [];
    if (!video || actions.length === 0) return false;
    if (video.readyState < HTMLMediaElement.HAVE_METADATA) return false;

    const bootstrapKey = [
      activeRound.roundId,
      activeRound.fieldId,
      segment.kind,
      activeVideoUri,
      timelineUri ?? activeSegmentResource?.funscriptUri ?? "",
    ].join(":");
    if (
      handyBootstrapKeyRef.current === bootstrapKey &&
      handySyncStateRef.current === "synced" &&
      forceHandySyncMsRef.current === null
    ) {
      return true;
    }
    if (handyBootstrapInFlightRef.current === bootstrapKey) return false;

    handyBootstrapInFlightRef.current = bootstrapKey;
    setHandySyncState("connecting");
    setHandySyncError(null);
    setSyncStatus({ synced: false, error: null });

    try {
      const timeMs =
        forceHandySyncMsRef.current ??
        Math.max(
          0,
          Math.floor(
            (segment.kind === "main"
              ? Math.max(video.currentTime, resolveMainWindowForDuration(video.duration).startSec)
              : video.currentTime) * 1000
          )
        );
      const effectiveTimeMs = applyHandyOffsetMs(timeMs);
      const playbackRate = video.playbackRate ?? 1;

      if (!connectionKey.trim() || !appApiKey.trim()) {
        setHandySyncState("missing-key");
        setSyncStatus({ synced: false, error: t`Missing Application ID/API key for TheHandy v3.` });
        return false;
      }

      const session = await ensureHandySession();
      if (!session) return false;

      await preloadHspScript(
        {
          connectionKey: connectionKey.trim(),
          appApiKey: appApiKey.trim(),
        },
        session,
        `${activeVideoUri}:${segment.kind}`,
        actions,
        effectiveTimeMs
      );
      await sendHspSync(
        {
          connectionKey: connectionKey.trim(),
          appApiKey: appApiKey.trim(),
        },
        session,
        effectiveTimeMs,
        playbackRate,
        `${activeVideoUri}:${segment.kind}`,
        actions
      );

      const syncedAt = Date.now();
      handyLastPushAtRef.current = syncedAt;
      handyLastSuccessAtRef.current = syncedAt;
      handyLastPushPosRef.current = getFunscriptPositionAtMs(timeline, effectiveTimeMs);
      forceHandySyncMsRef.current = null;
      handyBootstrapKeyRef.current = bootstrapKey;
      setHandySyncState("synced");
      setHandySyncError(null);
      setSyncStatus({ synced: true, error: null });
      return true;
    } catch (error) {
      const message =
        error instanceof Error ? error.message : t`Failed to initialize TheHandy sync.`;
      setHandySyncState("error");
      setHandySyncError(message);
      setSyncStatus({ synced: false, error: message });
      return false;
    } finally {
      if (handyBootstrapInFlightRef.current === bootstrapKey) {
        handyBootstrapInFlightRef.current = null;
      }
    }
  }, [
    activeRound,
    activeSegmentResource?.funscriptUri,
    activeVideoUri,
    applyHandyOffsetMs,
    appApiKey,
    connectionKey,
    ensureHandySession,
    isIntermediaryScreenActive,
    resolveMainWindowForDuration,
    segment.kind,
    setSyncStatus,
    shouldUseHandySync,
    timeline,
    timelineUri,
  ]);

  useEffect(() => {
    return () => {
      clearCountdownTimer();
      clearLoadingMediaTimers();
      clearUiHideTimer();
      clearManualPauseTimer();
      clearGeneratedSequenceTimer();
      clearAntiPerkBeatUi();
    };
  }, [
    clearAntiPerkBeatUi,
    clearCountdownTimer,
    clearGeneratedSequenceTimer,
    clearLoadingMediaTimers,
    clearManualPauseTimer,
    clearUiHideTimer,
  ]);

  useEffect(() => {
    if (!activeRound) {
      clearUiHideTimer();
      queueMicrotask(() => {
        setIsUiVisible(false);
      });
      return;
    }

    queueMicrotask(() => {
      showUiTemporarily(INITIAL_UI_SHOW_MS);
    });
  }, [activeRound, clearUiHideTimer, showUiTemporarily]);

  useEffect(() => {
    onUiVisibilityChangeRef.current?.(isUiVisible);
  }, [isUiVisible]);

  useEffect(() => {
    setShowProgressBarAlways(initialShowProgressBarAlways);
  }, [initialShowProgressBarAlways]);

  useEffect(() => {
    setShowAntiPerkBeatbar(initialShowAntiPerkBeatbar);
  }, [initialShowAntiPerkBeatbar]);

  useEffect(() => {
    if (!activeAntiPerkSequence) {
      setAntiPerkBeatElapsedMs(0);
      return;
    }

    let cancelled = false;
    const tick = () => {
      if (cancelled) return;
      const elapsedMs = Math.max(
        0,
        Math.min(
          activeAntiPerkSequence.durationMs,
          Math.floor(performance.now() - activeAntiPerkSequence.startedAtMs)
        )
      );
      setAntiPerkBeatElapsedMs(elapsedMs);
      if (elapsedMs >= activeAntiPerkSequence.durationMs) {
        antiPerkBeatAnimationFrameRef.current = null;
        return;
      }
      antiPerkBeatAnimationFrameRef.current = window.requestAnimationFrame(tick);
    };

    antiPerkBeatAnimationFrameRef.current = window.requestAnimationFrame(tick);
    return () => {
      cancelled = true;
      if (antiPerkBeatAnimationFrameRef.current !== null) {
        window.cancelAnimationFrame(antiPerkBeatAnimationFrameRef.current);
        antiPerkBeatAnimationFrameRef.current = null;
      }
    };
  }, [activeAntiPerkSequence]);
  useEffect(() => {
    if (!activeAntiPerkSequence) return;
    if (loadingCountdown === null) return;
    if (generatedSequenceTimerRef.current !== null) return;

    startGeneratedSequenceSync({
      sequenceId: activeAntiPerkSequence.id,
      durationMs: activeAntiPerkSequence.durationMs,
      actions: activeAntiPerkSequence.actions,
      startedAtMs: activeAntiPerkSequence.startedAtMs,
    });
  }, [
    activeAntiPerkSequence,
    appApiKey,
    connectionKey,
    handyConnected,
    loadingCountdown,
    startGeneratedSequenceSync,
  ]);

  useEffect(() => {
    if (!boardSequence) return;
    if (activeRound) return;
    if (activeGeneratedSequenceRef.current === boardSequence) return;
    void playRandomOneShot();

    clearCountdownTimer();
    clearLoadingMediaTimers();
    clearGeneratedSequenceTimer();
    clearAntiPerkBeatUi();
    activeGeneratedSequenceRef.current = boardSequence;
    const sequence = createActiveAntiPerkSequenceUi(boardSequence);
    const durationSec = sequence.definition.durationSec;

    setActiveAntiPerkSequence(sequence);
    setLoadingLabel(sequence.definition.label);
    setLoadingCountdown(durationSec);
    setStatus(t`Running anti-perk sequence...`);
    setActiveVideoUri(null);
    setLoadingMediaIndex(0);
    setSegment({ kind: "main" });
    setFunscriptPosition(null);

    const token = loadingFetchTokenRef.current + 1;
    loadingFetchTokenRef.current = token;
    const cachedLoadingMedia = loadingMediaCacheRef.current.get(booruSearchPrompt);
    if (cachedLoadingMedia && cachedLoadingMedia.length > 0) {
      setLoadingMedia(cachedLoadingMedia);
    } else {
      setLoadingMedia(fallbackLoadingMedia);
      void getCachedBooruMediaForDisplay(booruSearchPrompt, 18).then((cachedMedia) => {
        if (loadingFetchTokenRef.current !== token) return;
        if (cachedMedia.length === 0) return;
        loadingMediaCacheRef.current.set(booruSearchPrompt, cachedMedia);
        setLoadingMedia(cachedMedia);
      });
    }

    void refreshBooruMediaCache(booruSearchPrompt, 18).then((media) => {
      if (loadingFetchTokenRef.current !== token) return;
      const nextMedia =
        media.length > 0
          ? media
          : cachedLoadingMedia && cachedLoadingMedia.length > 0
            ? cachedLoadingMedia
            : fallbackLoadingMedia;
      loadingMediaCacheRef.current.set(booruSearchPrompt, nextMedia);
      setLoadingMedia(nextMedia);
    });

    startGeneratedSequenceSync({
      sequenceId: boardSequence,
      durationMs: sequence.durationMs,
      actions: sequence.actions,
      startedAtMs: sequence.startedAtMs,
    });

    countdownTimerRef.current = window.setInterval(() => {
      setLoadingCountdown((prev) => {
        if (prev === null) return null;
        if (prev <= 1) {
          clearCountdownTimer();
          clearLoadingMediaTimers();
          clearGeneratedSequenceTimer();
          activeGeneratedSequenceRef.current = null;
          clearAntiPerkBeatUi();
          setLoadingCountdown(null);
          setLoadingLabel("");
          setLoadingMedia([]);
          setLoadingMediaIndex(0);
          setStatus(t`Board sequence completed.`);
          void pauseHandyIfNeeded();
          onCompleteBoardSequenceRef.current?.(boardSequence);
          return null;
        }
        return prev - 1;
      });
    }, 1000);

    loadingRotateTimerRef.current = window.setInterval(() => {
      setLoadingMediaIndex((prev) => prev + 1);
    }, LOADING_MEDIA_ROTATE_MS);

    return () => {
      clearCountdownTimer();
      clearLoadingMediaTimers();
      clearGeneratedSequenceTimer();
      clearAntiPerkBeatUi();
      void pauseHandyIfNeeded();
    };
  }, [
    activeRound,
    boardSequence,
    booruSearchPrompt,
    clearAntiPerkBeatUi,
    clearCountdownTimer,
    clearGeneratedSequenceTimer,
    clearLoadingMediaTimers,
    createActiveAntiPerkSequenceUi,
    fallbackLoadingMedia,
    pauseHandyIfNeeded,
    playRandomOneShot,
    startGeneratedSequenceSync,
  ]);

  useEffect(() => {
    if (!idleBoardSequence) return;
    if (activeRound) return;
    if (boardSequence) return;
    if (activeGeneratedSequenceRef.current === idleBoardSequence) return;

    clearCountdownTimer();
    clearLoadingMediaTimers();
    clearGeneratedSequenceTimer();
    clearAntiPerkBeatUi();
    activeGeneratedSequenceRef.current = idleBoardSequence;
    const sequence = createActiveAntiPerkSequenceUi(idleBoardSequence);

    setActiveVideoUri(null);
    setLoadingCountdown(null);
    setLoadingLabel("");
    setLoadingMedia([]);
    setLoadingMediaIndex(0);
    setSegment({ kind: "main" });
    setFunscriptPosition(null);

    startGeneratedSequenceSync({
      sequenceId: idleBoardSequence,
      durationMs: sequence.durationMs,
      actions: sequence.actions,
      startedAtMs: sequence.startedAtMs,
      loop: true,
    });

    return () => {
      clearCountdownTimer();
      clearLoadingMediaTimers();
      clearGeneratedSequenceTimer();
      if (activeGeneratedSequenceRef.current === idleBoardSequence) {
        activeGeneratedSequenceRef.current = null;
      }
      clearAntiPerkBeatUi();
      void pauseHandyIfNeeded();
    };
  }, [
    activeRound,
    boardSequence,
    clearAntiPerkBeatUi,
    clearCountdownTimer,
    clearGeneratedSequenceTimer,
    clearLoadingMediaTimers,
    createActiveAntiPerkSequenceUi,
    idleBoardSequence,
    pauseHandyIfNeeded,
    startGeneratedSequenceSync,
  ]);

  useEffect(() => {
    if (!lastLogMessage) return;
    if (!lastLogMessage.includes("applied anti-perk:")) return;
    if (lastShownAntiPerkAlertRef.current === lastLogMessage) return;

    lastShownAntiPerkAlertRef.current = lastLogMessage;
    const alertText = lastLogMessage.replace(/.*applied anti-perk:/, "ANTI-PERK APPLIED:");
    setAntiPerkAlert({ text: alertText, startTime: Date.now() });
  }, [lastLogMessage]);

  useEffect(() => {
    if (!antiPerkAlert) return;
    const timer = setTimeout(() => {
      setAntiPerkAlert(null);
    }, 4500);

    return () => clearTimeout(timer);
  }, [antiPerkAlert]);

  useEffect(() => {
    if (!activeRound) return;

    const uris = new Set<string>();
    if (resolvedMainResource?.funscriptUri) uris.add(resolvedMainResource.funscriptUri);
    for (const trigger of fullIntermediaryQueue) {
      if (trigger.resource.funscriptUri) uris.add(trigger.resource.funscriptUri);
    }

    let cancelled = false;
    for (const uri of uris) {
      if (!/^https?:\/\//i.test(uri)) continue;
      if (timelineCacheRef.current.has(uri)) continue;
      void loadFunscriptTimeline(uri).then((loaded) => {
        if (cancelled) return;
        timelineCacheRef.current.set(uri, loaded);
      });
    }

    return () => {
      cancelled = true;
    };
  }, [activeRound, fullIntermediaryQueue, resolvedMainResource?.funscriptUri]);

  useEffect(() => {
    if ((!activeRound || !resolvedMainResource) && !boardSequence && !idleBoardSequence) {
      initializedRoundKeyRef.current = null;
      firedTriggersRef.current = new Set<string>();
      finishRequestedRef.current = false;
      needsMainWindowSeekRef.current = false;
      forceHandySyncMsRef.current = null;
      pendingVideoSeekSecRef.current = null;
      mainResumePositionSecRef.current = null;
      handyBootstrapKeyRef.current = null;
      handyBootstrapInFlightRef.current = null;
      pendingVideoActivationTokenRef.current += 1;
      clearCountdownTimer();
      clearLoadingMediaTimers();
      clearAntiPerkBeatUi();
      setRandomIntermediaryQueue([]);
      setSegment({ kind: "main" });
      setActiveVideoUri(null);
      setStatus(t`No active round.`);
      setLoadingCountdown(null);
      setLoadingLabel("");
      setLoadingMedia([]);
      setLoadingMediaIndex(0);
      activeGeneratedSequenceRef.current = null;
      foregroundMainVideo.markPlaying(false);
      foregroundIntermediaryVideo.markPlaying(false);
      void stopHandyIfNeeded();
      setPendingCumRoundSummary(null);
      return;
    }

    if (!activeRound || !resolvedMainResource) {
      return;
    }

    const roundKey = `${activeRound.roundId}:${activeRound.fieldId}:${resolvedMainResource.videoUri}`;
    if (initializedRoundKeyRef.current === roundKey) return;
    initializedRoundKeyRef.current = roundKey;

    sessionStartedAtRef.current = performance.now();
    firedTriggersRef.current = new Set<string>();
    finishRequestedRef.current = false;
    needsMainWindowSeekRef.current = true;

    forceHandySyncMsRef.current = null;
    pendingVideoSeekSecRef.current = null;
    mainResumePositionSecRef.current = null;
    handyBootstrapKeyRef.current = null;
    handyBootstrapInFlightRef.current = null;
    allowPauseRef.current = false;
    antiPerkCountAtRoundStartRef.current = currentPlayer?.antiPerks.length ?? 0;

    setSegment({ kind: "main" });
    setStatus(t`Preparing round video...`);
    activateVideoUri(resolvedMainResource.videoUri);
    setLoadingCountdown(null);
    setLoadingLabel("");
    setLoadingMedia([]);
    setLoadingMediaIndex(0);
    setFunscriptPosition(null);
    setFunscriptCount(0);
    setPlaybackRateLabel("1.00");
    lastPlaybackRateLabelRef.current = "1.00";
    lastFramePositionRef.current = null;
    lastFrameTimeMsRef.current = null;

    playRoundStartSound();

    if (
      !allowAutomaticIntermediaries ||
      intermediaryResourcePool.length === 0 ||
      intermediaryProbability <= 0 ||
      Math.random() > intermediaryProbability
    ) {
      setRandomIntermediaryQueue([]);
      return;
    }

    const countRoll = Math.random();
    const count = countRoll < 0.6 ? 1 : countRoll < 0.9 ? 2 : 3;

    const queue: IntermediaryTrigger[] = [];
    const usedProgress = new Set<number>();

    for (let i = 0; i < count; i++) {
      const resource =
        deterministicTestIntermediary ??
        intermediaryResourcePool[Math.floor(Math.random() * intermediaryResourcePool.length)];

      if (!resource) continue;

      let atProgress: number;
      let attempts = 0;
      do {
        atProgress = 0.2 + Math.random() * 0.6;
        attempts++;
      } while (usedProgress.has(Math.round(atProgress * 100)) && attempts < 10);

      usedProgress.add(Math.round(atProgress * 100));
      queue.push({
        id: `random-${activeRound.fieldId}-${i}`,
        atProgress,
        resource,
      });
    }

    setRandomIntermediaryQueue(queue);
  }, [
    activeRound,
    allowAutomaticIntermediaries,
    currentPlayer,
    deterministicTestIntermediary,
    intermediaryProbability,
    intermediaryResourcePool,
    resolvedMainResource,
    boardSequence,
    idleBoardSequence,
    activateVideoUri,
    clearAntiPerkBeatUi,
    clearCountdownTimer,
    clearLoadingMediaTimers,
    foregroundIntermediaryVideo,
    foregroundMainVideo,
    stopHandyIfNeeded,
  ]);

  useEffect(() => {
    if (!activeRound || !currentPlayer || activeRound.phaseKind !== "normal") return;
    if (segment.kind !== "main" || isIntermediaryScreenActive) return;
    if (!resolvedMainResource) return;

    const sequenceType = currentPlayer.antiPerks.includes("milker")
      ? "milker"
      : currentPlayer.antiPerks.includes("jackhammer")
        ? "jackhammer"
        : null;
    if (!sequenceType) return;

    const triggerId = `anti-seq-${sequenceType}-${activeRound.fieldId}`;
    if (firedTriggersRef.current.has(triggerId)) return;
    if (activeGeneratedSequenceRef.current === sequenceType) return;
    firedTriggersRef.current.add(triggerId);
    activeGeneratedSequenceRef.current = sequenceType;
    void playRandomOneShot();
    clearAntiPerkBeatUi();
    const sequence = createActiveAntiPerkSequenceUi(sequenceType);
    const video = mainVideoRef.current;
    const knownDurationSec =
      Number.isFinite(video?.duration) && (video?.duration ?? 0) > 0
        ? (video?.duration ?? 0)
        : (mainResourceDurationSec ?? Number.NaN);
    const mainWindow = resolveMainWindowForDuration(knownDurationSec);
    const resumeAtSec = clampToPlaybackWindow(Math.max(0, video?.currentTime ?? 0), mainWindow);
    mainResumePositionSecRef.current = resumeAtSec;

    if (video && !video.paused) {
      allowPauseRef.current = true;
      video.pause();
    }

    setActiveAntiPerkSequence(sequence);
    startGeneratedSequenceSync({
      sequenceId: sequenceType,
      durationMs: sequence.durationMs,
      actions: sequence.actions,
      startedAtMs: sequence.startedAtMs,
    });
    runSegmentTransition({
      label: sequence.definition.label,
      countdownSec: sequence.definition.durationSec,
      statusWhileCountdown: sequence.definition.statusWhileCountdown,
      sound: "intermediary",
      plan: {
        nextSegment: { kind: "main" },
        nextVideoUri: resolvedMainResource.videoUri,
        status: t`Returning to main round video.`,
        pendingSeekSec: resumeAtSec,
      },
      onComplete: () => {
        clearGeneratedSequenceTimer();
        activeGeneratedSequenceRef.current = null;
        clearAntiPerkBeatUi();
        void pauseHandyIfNeeded();
        onCompleteBoardSequenceRef.current?.(sequenceType);
      },
    });
  }, [
    activeRound,
    clearAntiPerkBeatUi,
    clearGeneratedSequenceTimer,
    currentPlayer,
    createActiveAntiPerkSequenceUi,
    isIntermediaryScreenActive,
    mainResourceDurationSec,
    pauseHandyIfNeeded,
    playRandomOneShot,
    resolveMainWindowForDuration,
    resolvedMainResource,
    runSegmentTransition,
    segment.kind,
    startGeneratedSequenceSync,
  ]);

  useEffect(() => {
    if (!activeRound || segment.kind !== "main" || isIntermediaryScreenActive) return;
    if (!needsMainWindowSeekRef.current) return;

    const video = mainVideoRef.current;
    if (!video || video.readyState < HTMLMediaElement.HAVE_METADATA) return;

    const mainWindow = resolveMainWindowForDuration(video.duration);
    const pendingSeek = pendingVideoSeekSecRef.current;
    const targetSec =
      pendingSeek != null ? clampToPlaybackWindow(pendingSeek, mainWindow) : mainWindow.startSec;
    if (Math.abs(video.currentTime - targetSec) > MAIN_WINDOW_SEEK_EPSILON_SEC) {
      video.currentTime = targetSec;
    }
    needsMainWindowSeekRef.current = false;
    if (pendingSeek != null) {
      pendingVideoSeekSecRef.current = null;
    }
  }, [activeRound, isIntermediaryScreenActive, resolveMainWindowForDuration, segment.kind]);

  useEffect(() => {
    if (boardSequence && !activeRound) return;
    const funscriptUri = activeSegmentResource?.funscriptUri;
    const intensityCap = currentPlayer?.pendingIntensityCap ?? null;
    if (!funscriptUri) {
      setTimeline(null);
      setTimelineUri(null);
      setFunscriptCount(0);
      setFunscriptPosition(null);
      setStatus((prev) => (loadingCountdown !== null ? prev : t`Playing video (no funscript).`));
      return;
    }

    const cached = timelineCacheRef.current.get(funscriptUri) ?? null;
    if (cached) {
      const resolvedTimeline = applyTimelineIntensityCap(cached, intensityCap);
      setTimeline(resolvedTimeline);
      setTimelineUri(funscriptUri);
      const count = resolvedTimeline?.actions.length ?? 0;
      setFunscriptCount(count);
      setStatus(count > 0 ? t`Playing video + funscript.` : t`Playing video (empty funscript).`);
      return;
    }

    let cancelled = false;
    setTimeline(null);
    setTimelineUri(funscriptUri);
    setFunscriptPosition(null);

    void loadFunscriptTimeline(funscriptUri).then((loaded) => {
      if (cancelled) return;
      timelineCacheRef.current.set(funscriptUri, loaded);
      const resolvedTimeline = applyTimelineIntensityCap(loaded, intensityCap);
      setTimeline(resolvedTimeline);
      setTimelineUri(funscriptUri);
      const count = resolvedTimeline?.actions.length ?? 0;
      setFunscriptCount(count);
      setStatus(count > 0 ? t`Playing video + funscript.` : t`Playing video (empty funscript).`);
    });

    return () => {
      cancelled = true;
    };
  }, [
    activeRound,
    activeSegmentResource?.funscriptUri,
    boardSequence,
    currentPlayer?.pendingIntensityCap,
  ]);

  useEffect(() => {
    if (!activeRound || !activeVideoUri || isIntermediaryScreenActive) return;

    let cancelled = false;
    let rafId = 0;

    const tick = () => {
      if (cancelled) return;

      const video = segment.kind === "main" ? mainVideoRef.current : intermediaryVideoRef.current;
      if (!video) {
        rafId = requestAnimationFrame(tick);
        return;
      }

      const timeMs = video.currentTime * 1000;
      const effectiveTimeMs = applyHandyOffsetMs(timeMs);
      lastFrameTimeMsRef.current = timeMs;

      const position = getFunscriptPositionAtMs(timeline, effectiveTimeMs);
      if (position !== lastFramePositionRef.current) {
        lastFramePositionRef.current = position;
        setFunscriptPosition(position);
        onFunscriptFrame?.({ timeMs: effectiveTimeMs, position });
      }

      if (segment.kind === "main") {
        const knownDurationSec =
          Number.isFinite(video.duration) && video.duration > 0
            ? video.duration
            : (mainResourceDurationSec ?? 0);
        const { startSec, endSec } = resolveMainWindowForDuration(knownDurationSec);
        if (video.currentTime < startSec - MAIN_WINDOW_SEEK_EPSILON_SEC) {
          video.currentTime = startSec;
        }

        const mainCurrentTimeSec = Math.max(video.currentTime, startSec);
        if (endSec !== null && mainCurrentTimeSec >= endSec - MAIN_WINDOW_END_TOLERANCE_SEC) {
          allowPauseRef.current = true;
          video.pause();
          finishWithSummary();
          return;
        }

        const boundedDurationSec =
          endSec !== null
            ? Math.max(0, endSec - startSec)
            : knownDurationSec > startSec
              ? Math.max(0, knownDurationSec - startSec)
              : 0;
        const elapsedInWindowSec = Math.max(0, mainCurrentTimeSec - startSec);
        const nextTimeLabel = `${formatDurationLabel(elapsedInWindowSec)} / ${formatDurationLabel(boundedDurationSec)}`;
        setPlaybackTimeLabel((current) => (current === nextTimeLabel ? current : nextTimeLabel));
        const nextProgress =
          boundedDurationSec > 0
            ? Math.max(0, Math.min(1, elapsedInWindowSec / boundedDurationSec))
            : 0;
        setPlaybackProgress((current) =>
          Math.abs(current - nextProgress) < 0.002 ? current : nextProgress
        );

        const rate = computePlaybackRate(sessionModifiers, {
          elapsedSessionSec: (performance.now() - sessionStartedAtRef.current) / 1000,
          currentTimeSec: elapsedInWindowSec,
          durationSec: boundedDurationSec,
        });

        if (Math.abs(video.playbackRate - rate) > 0.01) {
          video.playbackRate = rate;
        }

        const nextLabel = video.playbackRate.toFixed(2);
        if (nextLabel !== lastPlaybackRateLabelRef.current) {
          lastPlaybackRateLabelRef.current = nextLabel;
          setPlaybackRateLabel(nextLabel);
        }

        const nextTrigger = fullIntermediaryQueue.find(
          (trigger) =>
            !firedTriggersRef.current.has(trigger.id) && nextProgress >= trigger.atProgress
        );

        if (nextTrigger) {
          const resumeAtSec = clampToPlaybackWindow(mainCurrentTimeSec, { startSec, endSec });
          allowPauseRef.current = true;
          video.pause();
          startIntermediary(nextTrigger, resumeAtSec, t`Intermediary clip spawned.`);
        }
      } else {
        const knownDurationSec =
          Number.isFinite(video.duration) && video.duration > 0 ? video.duration : 0;
        const { startSec, endSec } = resolvePlaybackWindowForDuration(
          activeSegmentResource,
          knownDurationSec
        );
        if (video.currentTime < startSec - INTERMEDIARY_WINDOW_SEEK_EPSILON_SEC) {
          video.currentTime = startSec;
        }

        const intermediaryCurrentTimeSec = Math.max(video.currentTime, startSec);
        if (
          endSec !== null &&
          intermediaryCurrentTimeSec >= endSec - MAIN_WINDOW_END_TOLERANCE_SEC
        ) {
          allowPauseRef.current = true;
          video.pause();
          endIntermediaryAndResume();
          return;
        }

        const boundedDurationSec =
          endSec !== null
            ? Math.max(0, endSec - startSec)
            : knownDurationSec > startSec
              ? Math.max(0, knownDurationSec - startSec)
              : 0;
        const elapsedInWindowSec = Math.max(0, intermediaryCurrentTimeSec - startSec);
        const nextTimeLabel = `${formatDurationLabel(elapsedInWindowSec)} / ${formatDurationLabel(boundedDurationSec)}`;
        setPlaybackTimeLabel((current) => (current === nextTimeLabel ? current : nextTimeLabel));
        const nextProgress =
          boundedDurationSec > 0
            ? Math.max(0, Math.min(1, elapsedInWindowSec / boundedDurationSec))
            : 0;
        setPlaybackProgress((current) =>
          Math.abs(current - nextProgress) < 0.002 ? current : nextProgress
        );
        if (Math.abs(video.playbackRate - 1) > 0.01) {
          video.playbackRate = 1;
        }
        if (lastPlaybackRateLabelRef.current !== "1.00") {
          lastPlaybackRateLabelRef.current = "1.00";
          setPlaybackRateLabel("1.00");
        }
      }

      rafId = requestAnimationFrame(tick);
    };

    rafId = requestAnimationFrame(tick);

    return () => {
      cancelled = true;
      cancelAnimationFrame(rafId);
    };
  }, [
    activeRound,
    activeVideoUri,
    applyHandyOffsetMs,
    activeSegmentResource,
    endIntermediaryAndResume,
    fullIntermediaryQueue,
    isIntermediaryScreenActive,
    onFunscriptFrame,
    segment.kind,
    sessionModifiers,
    finishWithSummary,
    resolveMainWindowForDuration,
    startIntermediary,
    timeline,
  ]);

  useEffect(() => {
    setPlaybackTimeLabel("0:00 / 0:00");
    setPlaybackProgress(0);
  }, [activeRound?.roundId, activeRound?.phaseKind, segment.kind]);

  useEffect(() => {
    if (!handyConnected) {
      handyBootstrapKeyRef.current = null;
      handyBootstrapInFlightRef.current = null;
      resetHandySync("disconnected", null);
      return;
    }
    if (!appApiKey.trim()) {
      handyBootstrapKeyRef.current = null;
      handyBootstrapInFlightRef.current = null;
      resetHandySync("missing-key", t`Missing Application ID/API key for TheHandy v3.`);
      return;
    }
    setHandySyncState("connecting");
    setHandySyncError(null);
    setSyncStatus({ synced: false, error: null });
  }, [appApiKey, handyConnected, resetHandySync, setSyncStatus]);

  useEffect(() => {
    if (!handyManuallyStopped) return;
    handyBootstrapKeyRef.current = null;
    handyBootstrapInFlightRef.current = null;
    setHandySyncState("disconnected");
    setHandySyncError(null);
    setSyncStatus({ synced: false, error: null });
    setStatus(t`TheHandy stopped manually.`);
    void stopHandyIfNeeded();
  }, [handyManuallyStopped, setSyncStatus, stopHandyIfNeeded]);

  useEffect(() => {
    if (!activeRound) return;
    if (!isIntermediaryScreenActive) return;
    if (activeAntiPerkSequence) return;

    const video = segment.kind === "main" ? mainVideoRef.current : intermediaryVideoRef.current;
    if (video && !video.paused) {
      allowPauseRef.current = true;
      video.pause();
    }

    if (!handyConnected) return;
    setHandySyncState("connecting");
    setHandySyncError(null);
    setSyncStatus({ synced: false, error: null });
    // Use pause instead of stop to keep the HSP buffer alive so the
    // Handy can resume instantly when returning to the main segment.
    void pauseHandyIfNeeded();
  }, [
    activeAntiPerkSequence,
    activeRound,
    handyConnected,
    isIntermediaryScreenActive,
    pauseHandyIfNeeded,
    segment.kind,
    setSyncStatus,
  ]);

  // Preload the main funscript into TheHandy during the "RETURNING TO MAIN"
  // countdown so the device is immediately ready when playback resumes.
  useEffect(() => {
    if (!isIntermediaryScreenActive) return;
    if (!shouldUseHandySync) return;
    if (!resolvedMainResource?.funscriptUri) return;
    if (loadingLabel !== t`RETURNING TO MAIN`) return;

    // IMPORTANT: Read the MAIN timeline from cache, NOT from `timeline` state.
    // During the intermediary, `timeline` state holds the intermediary's funscript.
    const mainTimeline = timelineCacheRef.current.get(resolvedMainResource.funscriptUri);
    const mainActions = mainTimeline?.actions ?? [];
    if (mainActions.length === 0) return;

    const knownDurationSec =
      Number.isFinite(mainVideoRef.current?.duration) && (mainVideoRef.current?.duration ?? 0) > 0
        ? (mainVideoRef.current?.duration ?? 0)
        : (mainResourceDurationSec ?? Number.NaN);
    const resumeMs =
      segment.kind === "intermediary"
        ? clampToPlaybackWindow(
          mainResumePositionSecRef.current ?? segment.resumeAtSec,
          resolveMainWindowForDuration(knownDurationSec)
        ) * 1000
        : 0;

    let cancelled = false;
    void (async () => {
      try {
        if (!connectionKey.trim() || !appApiKey.trim()) return;
        const session = await ensureHandySession();
        if (!session || cancelled) return;

        // The intermediary's sendHspSync will have overwritten loadedScriptId
        // with the intermediary's script. Force a fresh upload of the main
        // script by clearing the stale ID before preloading.
        session.loadedScriptId = null;

        await preloadHspScript(
          {
            connectionKey: connectionKey.trim(),
            appApiKey: appApiKey.trim(),
          },
          session,
          `${resolvedMainResource.videoUri}:main`,
          mainActions,
          resumeMs
        );
      } catch {
        // Best-effort preload — errors are not fatal; normal sync will retry.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    appApiKey,
    connectionKey,
    ensureHandySession,
    isIntermediaryScreenActive,
    loadingLabel,
    mainResourceDurationSec,
    resolvedMainResource,
    resolveMainWindowForDuration,
    segment,
    shouldUseHandySync,
  ]);

  useEffect(() => {
    if (!shouldUseHandySync) return;
    setHandySyncState("connecting");
    setHandySyncError(null);
    setSyncStatus({ synced: false, error: null });
    handyLastPushAtRef.current = 0;
    handyLastPushPosRef.current = null;
    handyLastSuccessAtRef.current = 0;
  }, [activeVideoUri, segment.kind, setSyncStatus, shouldUseHandySync]);

  useEffect(() => {
    const activeBootstrapKey =
      activeRound && activeVideoUri
        ? [
          activeRound.roundId,
          activeRound.fieldId,
          segment.kind,
          activeVideoUri,
          timelineUri ?? activeSegmentResource?.funscriptUri ?? "",
        ].join(":")
        : null;

    if (!activeBootstrapKey) {
      handyBootstrapKeyRef.current = null;
      handyBootstrapInFlightRef.current = null;
      return;
    }

    if (
      handyBootstrapKeyRef.current !== null &&
      handyBootstrapKeyRef.current !== activeBootstrapKey
    ) {
      handyBootstrapKeyRef.current = null;
    }
    if (
      handyBootstrapInFlightRef.current !== null &&
      handyBootstrapInFlightRef.current !== activeBootstrapKey
    ) {
      handyBootstrapInFlightRef.current = null;
    }
  }, [activeRound, activeSegmentResource?.funscriptUri, activeVideoUri, segment.kind, timelineUri]);

  useEffect(() => {
    if (!shouldUseHandySync) return;
    const video = segment.kind === "main" ? mainVideoRef.current : intermediaryVideoRef.current;
    if (!video || video.readyState < HTMLMediaElement.HAVE_METADATA) return;
    void bootstrapHandySyncIfReady();
  }, [
    activeRound,
    activeVideoUri,
    bootstrapHandySyncIfReady,
    segment.kind,
    shouldUseHandySync,
    timeline,
    timelineUri,
  ]);

  useEffect(() => {
    if (!shouldUseHandySync) return;
    if (!activeRound || !activeVideoUri) return;
    if (isIntermediaryScreenActive) return;

    let cancelled = false;
    const timer = window.setInterval(() => {
      if (cancelled) return;
      if (handyPushInFlightRef.current) return;

      const video = segment.kind === "main" ? mainVideoRef.current : intermediaryVideoRef.current;
      const actions = timeline?.actions ?? [];
      if (!video || actions.length === 0) return;

      const timeMs = forceHandySyncMsRef.current ?? Math.max(0, video.currentTime * 1000);
      const effectiveTimeMs = applyHandyOffsetMs(timeMs);
      const position = getFunscriptPositionAtMs(timeline, effectiveTimeMs);
      if (position === null) return;

      const now = Date.now();
      if (now - handyLastPushAtRef.current < HANDY_PUSH_INTERVAL_MS) return;

      const playbackRate = video.playbackRate ?? 1;
      handyPushInFlightRef.current = true;

      void (async () => {
        try {
          if (!connectionKey.trim() || !appApiKey.trim()) return;

          const session = await ensureHandySession();
          if (!session) return;

          const syncPayload = {
            connectionKey: connectionKey.trim(),
            appApiKey: appApiKey.trim(),
          };

          await sendHspSync(
            syncPayload,
            session,
            effectiveTimeMs,
            playbackRate,
            `${activeVideoUri}:${segment.kind}`,
            actions
          );

          const sentAt = Date.now();
          handyLastPushAtRef.current = sentAt;
          handyLastPushPosRef.current = position;
          handyLastSuccessAtRef.current = sentAt;
          forceHandySyncMsRef.current = null;
          setHandySyncState("synced");
          setHandySyncError(null);
          setSyncStatus({ synced: true, error: null });
        } catch (error) {
          const message =
            error instanceof Error ? error.message : t`Failed to stream sync position to TheHandy.`;
          setHandySyncState("error");
          setHandySyncError(message);
          setSyncStatus({ synced: false, error: message });
        } finally {
          handyPushInFlightRef.current = false;
        }
      })();
    }, HANDY_PUSH_INTERVAL_MS);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [
    activeRound,
    activeVideoUri,
    applyHandyOffsetMs,
    appApiKey,
    connectionKey,
    ensureHandySession,
    isIntermediaryScreenActive,
    segment.kind,
    setSyncStatus,
    shouldUseHandySync,
    timeline,
  ]);

  useEffect(() => {
    if (!handyConnected) return;
    const timer = window.setInterval(() => {
      if (handySyncState !== "synced") return;
      if (Date.now() - handyLastSuccessAtRef.current <= HANDY_SYNC_STALE_MS) return;
      setHandySyncState("connecting");
      setSyncStatus({ synced: false, error: null });
    }, 400);

    return () => {
      window.clearInterval(timer);
    };
  }, [handyConnected, handySyncState, setSyncStatus]);

  useEffect(() => {
    if (!activeRound || !activeVideoUri) return;
    if (isIntermediaryScreenActive) return;

    if (shouldGatePlaybackForHandyStart) {
      let timer: number | null = null;
      if (handySyncState === "error") {
        setStatus(t`The device reported a sync error. Retrying momentarily...`);
        timer = window.setTimeout(() => {
          void bootstrapHandySyncIfReady();
        }, 1500);
      } else {
        setStatus(t`Waiting for TheHandy sync before playback...`);
        void bootstrapHandySyncIfReady();
      }

      const video = segment.kind === "main" ? mainVideoRef.current : intermediaryVideoRef.current;
      if (video && !video.paused) {
        allowPauseRef.current = true;
        video.pause();
      }
      return () => {
        if (timer !== null) window.clearTimeout(timer);
      };
    }

    tryPlayVideo();
  }, [
    activeRound,
    activeVideoUri,
    bootstrapHandySyncIfReady,
    handySyncState,
    isIntermediaryScreenActive,
    segment.kind,
    shouldGatePlaybackForHandyStart,
    tryPlayVideo,
  ]);

  useEffect(() => {
    if (!activeRound || !activeVideoUri) return;
    if (isIntermediaryScreenActive) return;
    const video = segment.kind === "main" ? mainVideoRef.current : intermediaryVideoRef.current;
    if (!video) return;

    const pendingSeek = pendingVideoSeekSecRef.current;
    if (pendingSeek != null && segment.kind === "main") {
      if (video.readyState >= HTMLMediaElement.HAVE_METADATA) {
        video.currentTime = pendingSeek;
        pendingVideoSeekSecRef.current = null;
        return;
      }
    }

    video.load();
  }, [
    activeRound?.fieldId,
    activeRound?.roundId,
    activeVideoUri,
    isIntermediaryScreenActive,
    segment.kind,
    resolvedMainVideoSrc,
    resolvedIntermediaryVideoSrc,
  ]);

  useEffect(() => {
    return () => {
      void stopHandyIfNeeded();
      setSyncStatus({ synced: false, error: null });
    };
  }, [setSyncStatus, stopHandyIfNeeded]);

  useEffect(() => {
    if (!activeRound) return;
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (
        target &&
        (target.isContentEditable || target.tagName === "INPUT" || target.tagName === "TEXTAREA")
      )
        return;
      if (event.repeat) return;

      const key = event.key.toLowerCase();
      if (key === "r") {
        event.preventDefault();
        void resyncHandyTiming();
        return;
      }

      if (!canUseDebugRoundControls) return;

      if (key === "i") {
        event.preventDefault();
        triggerTestIntermediary();
        return;
      }
      if (key === "j") {
        event.preventDefault();
        endIntermediaryAndResume(t`Development: intermediary ended early.`);
        return;
      }
      if (key === "k") {
        event.preventDefault();
        finishWithSummary();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [
    activeRound,
    endIntermediaryAndResume,
    finishWithSummary,
    canUseDebugRoundControls,
    resyncHandyTiming,
    triggerTestIntermediary,
  ]);

  const handleOverlayMouseMove = useCallback(() => {
    const now = Date.now();
    if (now - lastMouseMoveAtRef.current < 120) return;
    lastMouseMoveAtRef.current = now;
    showUiTemporarily(UI_SHOW_AFTER_MOUSEMOVE_MS);
  }, [showUiTemporarily]);

  const canUseRoundControls = Boolean(
    activeRound && activeRound.phaseKind === "normal" && roundControl
  );
  const showRemoteLoadingIndicator =
    isRemoteVideoUri &&
    isRemoteVideoLoading &&
    !isIntermediaryScreenActive &&
    !isWaitingForHandyStart;

  useEffect(() => {
    const nextPreviewState = {
      active: Boolean(activeRound),
      loading: Boolean(
        activeRound &&
        (loadingCountdown !== null || showRemoteLoadingIndicator || isWaitingForHandyStart)
      ),
    };
    const previousPreviewState = lastPreviewStateRef.current;
    if (
      previousPreviewState?.active === nextPreviewState.active &&
      previousPreviewState.loading === nextPreviewState.loading
    ) {
      return;
    }
    lastPreviewStateRef.current = nextPreviewState;
    onPreviewStateChangeRef.current?.(nextPreviewState);
  }, [activeRound, isWaitingForHandyStart, loadingCountdown, showRemoteLoadingIndicator]);

  const handleUsePauseControl = useCallback(() => {
    if (!canUseRoundControls || !roundControl) return;
    if (roundControl.pauseCharges <= 0) return;
    if (isIntermediaryScreenActive) return;

    const video = segment.kind === "main" ? mainVideoRef.current : intermediaryVideoRef.current;
    if (!video) return;

    roundControl.onUsePause();
    clearManualPauseTimer();
    allowPauseRef.current = true;
    video.pause();
    void pauseHandyIfNeeded();
    setStatus(t`Manual pause active (15s).`);

    manualPauseTimerRef.current = window.setTimeout(() => {
      manualPauseTimerRef.current = null;
      setStatus(t`Manual pause ended.`);
      tryPlayVideo();
    }, MANUAL_PAUSE_DURATION_MS);
  }, [
    canUseRoundControls,
    clearManualPauseTimer,
    isIntermediaryScreenActive,
    pauseHandyIfNeeded,
    roundControl,
    segment.kind,
    tryPlayVideo,
  ]);

  const handleUseSkipControl = useCallback(() => {
    if (!canUseRoundControls || !roundControl) return;
    if (roundControl.skipCharges <= 0) return;
    roundControl.onUseSkip();
    finishWithSummary();
  }, [canUseRoundControls, finishWithSummary, roundControl]);

  useControllerSurface({
    id: "round-video-overlay",
    scopeRef: pendingCumRoundSummary ? cumOutcomeRef : overlayRef,
    priority: pendingCumRoundSummary ? 120 : 90,
    enabled: Boolean(activeRound),
    initialFocusId: pendingCumRoundSummary
      ? "round-cum-outcome-came"
      : handyConnected
        ? "round-overlay-handy-toggle"
        : "round-overlay-progress-bar",
    onBack: pendingCumRoundSummary
      ? undefined
      : onClose
        ? () => {
          void stopHandyIfNeeded();
          onClose();
          return true;
        }
        : onOpenOptions
          ? () => {
            onOpenOptions();
            return true;
          }
          : undefined,
    onUnhandledAction: (action) => {
      showUiTemporarily(UI_SHOW_AFTER_MOUSEMOVE_MS);

      if (pendingCumRoundSummary) {
        if (action === "ACTION_X") {
          resolveCumRoundOutcome("came_as_told");
          return true;
        }
        if (action === "ACTION_Y" || action === "SECONDARY") {
          resolveCumRoundOutcome("did_not_cum");
          return true;
        }
        return false;
      }

      if (!pendingCumRoundSummary) {
        if (action === "ACTION_X" && onRequestCum) {
          handleCumRequest();
          return true;
        }
        if (
          action === "ACTION_Y" &&
          roundControl &&
          roundControl.pauseCharges > 0 &&
          !isIntermediaryScreenActive
        ) {
          handleUsePauseControl();
          return true;
        }
        if (action === "START" && onOpenOptions) {
          onOpenOptions();
          return true;
        }
      }

      return false;
    },
  });

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  useControllerSubscription((_action) => {
    showUiTemporarily(UI_SHOW_AFTER_MOUSEMOVE_MS);
  });

  useEffect(() => {
    const mainVideo = mainVideoRef.current;
    const intermediaryVideo = intermediaryVideoRef.current;
    return () => {
      teardownVideoElement(mainVideo);
      teardownVideoElement(intermediaryVideo);
    };
  }, []);

  useEffect(() => {
    if (activeRound || boardSequence || idleBoardSequence) return;
    teardownVideoElement(mainVideoRef.current);
    teardownVideoElement(intermediaryVideoRef.current);
  }, [activeRound, boardSequence, idleBoardSequence]);

  useEffect(() => {
    for (const video of [mainVideoRef.current, intermediaryVideoRef.current]) {
      if (!video) continue;
      video.muted = false;
      video.defaultMuted = false;
      video.volume = BOARD_VIDEO_VOLUME;
    }
  }, [activeVideoUri, segment.kind]);

  const missingMediaCloseLabel =
    missingMediaAutoCloseRemainingSec !== null
      ? t`Close (${missingMediaAutoCloseRemainingSec}s)`
      : t`Close`;

  if (!activeRound && !boardSequence) return null;

  if (!activeRound && boardSequence) {
    const isBoardSequenceActive =
      loadingCountdown !== null ||
      activeAntiPerkSequence?.id === boardSequence ||
      activeGeneratedSequenceRef.current === boardSequence;
    if (!isBoardSequenceActive) return null;

    const hasLoadingMedia = loadingMedia.length > 0;
    const activeLoadingMediaIndex = hasLoadingMedia ? loadingMediaIndex % loadingMedia.length : -1;
    const activeLoadingMedia = hasLoadingMedia ? loadingMedia[activeLoadingMediaIndex] : null;
    const shouldShowManualBeatbar =
      showAntiPerkBeatbar &&
      !handyConnected &&
      Boolean(activeAntiPerkSequence?.definition.supportsBeatbar) &&
      loadingCountdown !== null;
    const shouldShowHandyPositionBall =
      handyConnected &&
      Boolean(activeAntiPerkSequence?.definition.supportsBeatbar) &&
      loadingCountdown !== null;
    const shouldRenderStandaloneBeatbar = shouldShowManualBeatbar || shouldShowHandyPositionBall;
    return (
      <div className="fixed inset-0 z-50 pointer-events-none bg-[#07040f]">
        <div className="absolute inset-0">
          {activeLoadingMedia &&
            (isVideoMedia(activeLoadingMedia.url) ? (
              <video
                key={activeLoadingMedia.id}
                className="h-full w-full object-cover opacity-40"
                src={activeLoadingMedia.url}
                autoPlay
                muted
                loop
                playsInline
                onError={() => setLoadingMediaIndex((prev) => prev + 1)}
              />
            ) : (
              <img
                key={activeLoadingMedia.id}
                className="h-full w-full object-cover opacity-40"
                src={activeLoadingMedia.url}
                alt="loading media"
                onError={() => setLoadingMediaIndex((prev) => prev + 1)}
              />
            ))}
        </div>
        <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(6,4,16,0.9),rgba(6,4,16,0.98))]" />
        {shouldRenderStandaloneBeatbar && activeAntiPerkSequence && (
          <AntiPerkBeatbar
            actions={activeAntiPerkSequence.actions}
            beatbarEvents={activeAntiPerkSequence.beatbarEvents}
            beatHits={activeAntiPerkSequence.beatHits}
            elapsedMs={antiPerkBeatElapsedMs}
            showBeatbar={shouldShowManualBeatbar}
            showBall={shouldShowHandyPositionBall}
            style={activeAntiPerkSequence.definition.beatbarStyle}
          />
        )}
        <div className="absolute bottom-5 left-5 z-10 flex w-[min(20rem,calc(100%-2.5rem))] flex-col items-start gap-4 text-left sm:bottom-6 sm:left-6">
          <div
            className="relative rounded-xl border border-fuchsia-300/30 bg-gradient-to-br from-[#0c0814]/80 via-[#140818]/75 to-[#0a0612]/80 px-4 py-2.5 text-[10px] font-semibold uppercase tracking-[0.26em] text-fuchsia-100/85 backdrop-blur-md"
            data-testid="anti-perk-sequence-card"
            style={{ animation: "labelPulse 2.4s ease-in-out infinite" }}
          >
            <div className="absolute inset-0 rounded-xl bg-gradient-to-r from-pink-500/10 via-fuchsia-500/15 to-violet-500/10" />
            <span className="relative">{loadingLabel || t`Anti-perk sequence`}</span>
          </div>
          <div
            className="bg-gradient-to-r from-pink-200 via-fuchsia-200 to-violet-200 bg-clip-text pl-1 text-6xl font-black leading-none text-transparent drop-shadow-[0_0_30px_rgba(236,72,153,0.5)] sm:text-7xl"
            style={{ animation: "counterGlow 2s ease-in-out infinite" }}
          >
            {loadingCountdown ?? 0}
          </div>
          <div className="max-w-[18rem] rounded-xl border border-fuchsia-200/15 bg-gradient-to-br from-black/30 via-black/25 to-black/30 px-3.5 py-2.5 text-sm text-zinc-100/80 backdrop-blur-sm">
            {status}
          </div>
        </div>
      </div>
    );
  }

  if (!resolvedMainResource) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/25 p-4 backdrop-blur-[2px]">
        <div className="max-w-lg rounded-xl border border-red-400/50 bg-[rgba(18,9,21,0.88)] p-6 text-white shadow-[0_20px_80px_rgba(0,0,0,0.45)]">
          <p className="text-sm">
            {t`No video resource found for this round. The board is still running underneath.`}
          </p>
          <button
            className="mt-4 rounded-md bg-red-700 px-4 py-2 text-sm font-semibold"
            onClick={() => {
              handleMissingMediaClose({ playSound: true });
            }}
            onMouseEnter={() => playHoverSound()}
            type="button"
          >
            {missingMediaCloseLabel}
          </button>
        </div>
      </div>
    );
  }

  const handyStatusLabel = !handyConnected
    ? t`Disconnected`
    : handyManuallyStopped
      ? t`Stopped`
      : handySyncState === "missing-key"
        ? t`Missing API Key`
        : handySyncState === "synced"
          ? t`Synced`
          : handySyncState === "error"
            ? t`Sync Error`
            : t`Syncing`;

  const handyStatusTone = !handyConnected
    ? "border-zinc-300/25 bg-zinc-700/30 text-zinc-100"
    : handyManuallyStopped
      ? "border-rose-300/45 bg-rose-500/20 text-rose-100"
      : handySyncState === "synced"
        ? "border-emerald-300/45 bg-emerald-500/20 text-emerald-100"
        : handySyncState === "error" || handySyncState === "missing-key"
          ? "border-amber-300/45 bg-amber-500/20 text-amber-100"
          : "border-cyan-300/45 bg-cyan-500/20 text-cyan-100";

  const canResyncHandy = shouldUseHandySync && !isIntermediaryScreenActive;
  const hasLoadingMedia = loadingMedia.length > 0;
  const activeLoadingMediaIndex = hasLoadingMedia ? loadingMediaIndex % loadingMedia.length : -1;
  const activeLoadingMedia = hasLoadingMedia ? loadingMedia[activeLoadingMediaIndex] : null;
  const unsafeMediaUnlocked = !sfwMode || allowUnsafeMediaOnce;
  const shouldShowManualBeatbar =
    showAntiPerkBeatbar &&
    !handyConnected &&
    Boolean(activeAntiPerkSequence?.definition.supportsBeatbar) &&
    loadingCountdown !== null;
  const shouldShowHandyPositionBall =
    handyConnected &&
    Boolean(activeAntiPerkSequence?.definition.supportsBeatbar) &&
    loadingCountdown !== null;
  const shouldRenderAntiPerkBeatbar = shouldShowManualBeatbar || shouldShowHandyPositionBall;
  const shouldShowPlaybackTimer = isUiVisible && loadingCountdown === null;
  const roundControllerHintsBottomClassName = handySyncError ? "bottom-24" : "bottom-14";
  const showHandySyncCard = handyConnected;
  const hasTimelinePreview = timeline !== null && typeof funscriptPosition === "number";
  const handyPreviewPosition = Math.max(0, Math.min(100, funscriptPosition ?? 50));
  const handleLoadingMediaError = () => {
    if (!activeLoadingMedia || activeLoadingMediaIndex < 0) return;
    const previewUrl = activeLoadingMedia.previewUrl ?? null;
    if (previewUrl && previewUrl !== activeLoadingMedia.url) {
      setLoadingMedia((prev) =>
        prev.map((item, index) =>
          index === activeLoadingMediaIndex ? { ...item, url: previewUrl } : item
        )
      );
      return;
    }
    setLoadingMediaIndex((prev) => prev + 1);
  };

  return (
    <div
      ref={overlayRef}
      className={`fixed inset-0 z-50 ${isOnlyNoRest ? "bg-black/0 pointer-events-none" : "bg-black"} ${isUiVisible ? "" : "cursor-none"}`}
      onMouseMove={handleOverlayMouseMove}
    >
      <style>
        {`
          @keyframes loadingMediaFadeIn {
            0% { opacity: 0; transform: scale(1.035); filter: saturate(1.05); }
            100% { opacity: 0.95; transform: scale(1.0); filter: saturate(1.12); }
          }
          @keyframes handySyncRing {
            0% { transform: scale(0.94); opacity: 0.32; }
            55% { transform: scale(1.05); opacity: 0.88; }
            100% { transform: scale(1.16); opacity: 0.08; }
          }
          @keyframes handySyncSweep {
            0% { transform: translateX(-55%) rotate(0deg); opacity: 0; }
            12% { opacity: 0.5; }
            50% { opacity: 0.92; }
            88% { opacity: 0.5; }
            100% { transform: translateX(55%) rotate(0deg); opacity: 0; }
          }
          @keyframes handySyncGlow {
            0% { filter: saturate(1) brightness(0.94); }
            50% { filter: saturate(1.25) brightness(1.12); }
            100% { filter: saturate(1) brightness(0.94); }
          }
          @keyframes handyPreviewRail {
            0%, 100% { box-shadow: inset 0 0 28px rgba(56,189,248,0.16), 0 0 20px rgba(14,165,233,0.14); }
            50% { box-shadow: inset 0 0 42px rgba(99,102,241,0.2), 0 0 28px rgba(34,211,238,0.18); }
          }
          @keyframes handyPreviewOrb {
            0%, 100% { transform: translate(-50%, -50%) scale(1); }
            50% { transform: translate(-50%, -50%) scale(1.08); }
          }
          @keyframes handyPreviewGhost {
            0%, 100% { opacity: 0.32; }
            50% { opacity: 0.62; }
          }
          @keyframes intermediaryMeshPulse {
            0% { background: radial-gradient(ellipse at 30% 40%, rgba(168,85,247,0.12), transparent 60%); }
            33% { background: radial-gradient(ellipse at 70% 30%, rgba(236,72,153,0.14), transparent 60%); }
            66% { background: radial-gradient(ellipse at 45% 70%, rgba(56,189,248,0.12), transparent 60%); }
            100% { background: radial-gradient(ellipse at 30% 40%, rgba(168,85,247,0.12), transparent 60%); }
          }
          @keyframes intermediaryOrb1 {
            0%, 100% { transform: translate(0, 0) scale(1); }
            33% { transform: translate(15%, 10%) scale(1.15); }
            66% { transform: translate(-8%, -5%) scale(0.9); }
          }
          @keyframes intermediaryOrb2 {
            0%, 100% { transform: translate(0, 0) scale(1); }
            40% { transform: translate(-12%, -8%) scale(1.1); }
            75% { transform: translate(8%, 12%) scale(0.95); }
          }
          @keyframes intermediaryOrb3 {
            0%, 100% { transform: translate(0, 0) scale(1); }
            50% { transform: translate(10%, -15%) scale(1.2); }
          }
          @keyframes antiPerkAlertSlide {
            0% { transform: translateY(-20px) scale(0.95); opacity: 0; filter: blur(8px); }
            15% { transform: translateY(0) scale(1.05); opacity: 1; filter: blur(0); }
            25% { transform: translateY(0) scale(1.0); }
            85% { transform: translateY(0) scale(1.0); opacity: 1; filter: blur(0); }
            100% { transform: translateY(-15px) scale(0.98); opacity: 0; filter: blur(12px); }
          }
          @keyframes antiPerkAlertPulse {
            0%, 100% { box-shadow: 0 0 25px rgba(244,63,94,0.35); border-color: rgba(251,113,133,0.5); }
            50% { box-shadow: 0 0 45px rgba(244,63,94,0.65); border-color: rgba(251,113,133,0.95); }
          }
          @keyframes counterGlow {
            0%, 100% {
              text-shadow: 0 0 20px rgba(236,72,153,0.6), 0 0 40px rgba(168,85,247,0.4), 0 0 60px rgba(56,189,248,0.2);
              filter: brightness(1);
            }
            50% {
              text-shadow: 0 0 30px rgba(236,72,153,0.85), 0 0 60px rgba(168,85,247,0.6), 0 0 90px rgba(56,189,248,0.35);
              filter: brightness(1.1);
            }
          }
          @keyframes labelPulse {
            0%, 100% { box-shadow: 0 0 12px rgba(236,72,153,0.25), inset 0 0 20px rgba(168,85,247,0.08); }
            50% { box-shadow: 0 0 22px rgba(236,72,153,0.45), inset 0 0 30px rgba(168,85,247,0.12); }
          }
          @keyframes promptSlide {
            0% { opacity: 0; transform: translateY(4px); }
            100% { opacity: 1; transform: translateY(0); }
          }
        `}
      </style>
      <div
        className={`relative h-full w-full overflow-hidden ${isOnlyNoRest ? "bg-transparent" : "bg-black"}`}
      >
        <div className="pointer-events-none absolute inset-x-0 top-0 z-20 h-24 bg-gradient-to-b from-black/70 via-black/25 to-transparent" />
        <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 h-36 bg-gradient-to-t from-black/75 via-black/30 to-transparent" />

        <div
          className={`pointer-events-auto absolute inset-x-0 top-0 z-30 flex items-center justify-between gap-3 px-4 py-3 text-xs tracking-wide text-fuchsia-100 transition-opacity duration-250 ${isUiVisible ? "opacity-100" : "opacity-0"}`}
        >
          <span>{resolvedRound?.name ?? activeRound?.roundName ?? t`Round`}</span>
          <div className="flex flex-wrap items-center justify-end gap-2">
            <span>{status}</span>

            <button
              className={`pointer-events-auto rounded-md border px-2 py-1 text-[10px] font-semibold uppercase tracking-wide transition-colors ${canResyncHandy
                  ? "border-cyan-300/60 bg-cyan-500/20 text-cyan-100 hover:bg-cyan-500/35"
                  : "border-zinc-500/40 bg-zinc-700/20 text-zinc-300"
                }`}
              disabled={!canResyncHandy}
              onClick={() => {
                playSelectSound();
                void resyncHandyTiming();
              }}
              onMouseEnter={() => playHoverSound()}
              type="button"
              data-controller-focus-id="round-overlay-resync"
            >
              {t`Resync (R)`}
            </button>
            <button
              className="pointer-events-auto rounded-md border border-cyan-300/45 bg-cyan-500/15 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-cyan-100 transition-colors hover:bg-cyan-500/30"
              onClick={() => {
                playSelectSound();
                openGlobalHandyOverlay();
              }}
              onMouseEnter={() => playHoverSound()}
              type="button"
              data-controller-focus-id="round-overlay-handy-menu"
            >
              {t`Handy Menu`}
            </button>
            {canUseRoundControls && (
              <>
                <button
                  className={`pointer-events-auto rounded-md border px-2 py-1 text-[10px] font-semibold uppercase tracking-wide transition-colors ${(roundControl?.pauseCharges ?? 0) > 0
                      ? "border-violet-300/60 bg-violet-500/20 text-violet-100 hover:bg-violet-500/35"
                      : "border-zinc-500/40 bg-zinc-700/20 text-zinc-300"
                    }`}
                  disabled={(roundControl?.pauseCharges ?? 0) <= 0 || isIntermediaryScreenActive}
                  onClick={() => {
                    playSelectSound();
                    handleUsePauseControl();
                  }}
                  onMouseEnter={() => playHoverSound()}
                  type="button"
                  data-controller-focus-id="round-overlay-pause"
                >
                  {t`Pause ${roundControl?.pauseCharges ?? 0}`}
                </button>
                <button
                  className={`pointer-events-auto rounded-md border px-2 py-1 text-[10px] font-semibold uppercase tracking-wide transition-colors ${(roundControl?.skipCharges ?? 0) > 0
                      ? "border-amber-300/60 bg-amber-500/20 text-amber-100 hover:bg-amber-500/35"
                      : "border-zinc-500/40 bg-zinc-700/20 text-zinc-300"
                    }`}
                  disabled={(roundControl?.skipCharges ?? 0) <= 0}
                  onClick={() => {
                    playSelectSound();
                    handleUseSkipControl();
                  }}
                  onMouseEnter={() => playHoverSound()}
                  type="button"
                  data-controller-focus-id="round-overlay-skip"
                >
                  {t`Skip ${roundControl?.skipCharges ?? 0}`}
                </button>
              </>
            )}
            {onOpenOptions && (
              <button
                className="pointer-events-auto rounded-md border border-indigo-300/60 bg-indigo-500/25 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-indigo-100 transition-colors hover:bg-indigo-500/40"
                onClick={() => {
                  playSelectSound();
                  onOpenOptions();
                }}
                onMouseEnter={() => playHoverSound()}
                type="button"
                data-controller-focus-id="round-overlay-options"
              >
                {t`Options`}
              </button>
            )}
            <button
              className={`pointer-events-auto rounded-md border px-2 py-1 text-[10px] font-semibold uppercase tracking-wide transition-colors ${showProgressBarAlways
                  ? "border-emerald-300/60 bg-emerald-500/20 text-emerald-100 hover:bg-emerald-500/35"
                  : "border-zinc-500/40 bg-zinc-700/20 text-zinc-300 hover:bg-zinc-700/35"
                }`}
              onClick={() => {
                playSelectSound();
                setShowProgressBarAlways((current) => !current);
              }}
              onMouseEnter={() => playHoverSound()}
              type="button"
              data-controller-focus-id="round-overlay-progress-bar"
            >
              {t`Bar ${showProgressBarAlways ? "Pinned" : "Auto"}`}
            </button>
            <button
              className={`pointer-events-auto rounded-md border px-2 py-1 text-[10px] font-semibold uppercase tracking-wide transition-colors ${handyConnected
                  ? "border-rose-300/60 bg-rose-500/20 text-rose-100 hover:bg-rose-500/35"
                  : "border-zinc-500/40 bg-zinc-700/20 text-zinc-300"
                }`}
              disabled={!handyConnected}
              onClick={() => {
                playSelectSound();
                if (handyManuallyStopped) {
                  void toggleManualStop().then(() => {
                    setStatus(t`TheHandy resumed.`);
                  });
                  return;
                }
                void stopHandyIfNeeded()
                  .catch(() => undefined)
                  .finally(() => {
                    void toggleManualStop().then(() => {
                      setStatus(t`TheHandy stopped manually.`);
                    });
                  });
              }}
              onMouseEnter={() => playHoverSound()}
              type="button"
              data-controller-focus-id="round-overlay-handy-toggle"
              data-controller-initial="true"
            >
              {handyManuallyStopped ? t`Resume Handy` : t`Force Stop`}
            </button>
            {onRequestCum && (
              <button
                className="pointer-events-auto rounded-md border border-rose-300/70 bg-rose-500/25 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-rose-50 transition-colors hover:bg-rose-500/40"
                onClick={() => {
                  playSelectSound();
                  handleCumRequest();
                }}
                onMouseEnter={() => playHoverSound()}
                type="button"
                data-controller-focus-id="round-overlay-cum"
              >
                {abbreviateNsfwText(t`Cum (C)`, sfwMode)}
              </button>
            )}
            {showCloseButton && onClose && (
              <button
                className="pointer-events-auto rounded-md border border-rose-300/70 bg-rose-500/25 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-rose-50 transition-colors hover:bg-rose-500/40"
                onClick={() => {
                  playSelectSound();
                  void stopHandyIfNeeded();
                  onClose();
                }}
                onMouseEnter={() => playHoverSound()}
                type="button"
                data-controller-focus-id="round-overlay-close"
                data-controller-back="true"
              >
                {t`Close`}
              </button>
            )}
            {canUseDebugRoundControls && (
              <>
                <button
                  className="pointer-events-auto rounded-md border border-sky-300/60 bg-sky-500/20 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-sky-100 transition-colors hover:bg-sky-500/35"
                  onClick={() => {
                    playSelectSound();
                    triggerTestIntermediary();
                  }}
                  onMouseEnter={() => playHoverSound()}
                  type="button"
                >
                  {t`Test Intermediary (I)`}
                </button>
                <button
                  className={`pointer-events-auto rounded-md border px-2 py-1 text-[10px] font-semibold uppercase tracking-wide transition-colors ${segment.kind === "intermediary"
                      ? "border-emerald-300/60 bg-emerald-500/20 text-emerald-100 hover:bg-emerald-500/35"
                      : "border-zinc-500/50 bg-zinc-700/20 text-zinc-300"
                    }`}
                  disabled={segment.kind !== "intermediary"}
                  onClick={() => {
                    playSelectSound();
                    endIntermediaryAndResume(t`Development: intermediary ended early.`);
                  }}
                  onMouseEnter={() => playHoverSound()}
                  type="button"
                >
                  {t`End Intermediary (J)`}
                </button>
                <button
                  className="pointer-events-auto rounded-md border border-amber-300/60 bg-amber-500/20 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-amber-100 transition-colors hover:bg-amber-500/35"
                  onClick={() => {
                    playSelectSound();
                    finishWithSummary();
                  }}
                  onMouseEnter={() => playHoverSound()}
                  type="button"
                >
                  {t`Dev Skip (K)`}
                </button>
              </>
            )}
          </div>
        </div>

        <div
          className={`relative h-full w-full ${isOnlyNoRest ? "bg-transparent" : "bg-[#060410]"}`}
        >
          {resolvedMainResource && unsafeMediaUnlocked && (
            <video
              ref={mainVideoRef}
              className={`absolute inset-0 h-full w-full object-contain ${segment.kind === "main" && !isIntermediaryScreenActive ? "opacity-100" : "pointer-events-none"}`}
              style={{
                visibility:
                  segment.kind === "main" && !isIntermediaryScreenActive ? "visible" : "hidden",
              }}
              controls={false}
              disablePictureInPicture
              playsInline
              preload="auto"
              tabIndex={-1}
              src={resolvedMainVideoSrc}
              onContextMenu={(event) => event.preventDefault()}
              onError={() => {
                setFailedVideoUri(
                  mainVideoRef.current?.currentSrc || resolvedMainResource.videoUri
                );
                void handleVideoError(resolvedMainResource.videoUri);
              }}
              onEmptied={() => {
                foregroundMainVideo.handlePause();
              }}
              onLoadStart={() => {
                if (segment.kind !== "main") return;
                if (isRemoteVideoUri) setIsRemoteVideoLoading(true);
              }}
              onWaiting={() => {
                if (segment.kind !== "main") return;
                if (isRemoteVideoUri) setIsRemoteVideoLoading(true);
              }}
              onStalled={() => {
                if (segment.kind !== "main") return;
                if (isRemoteVideoUri) setIsRemoteVideoLoading(true);
              }}
              onCanPlay={() => {
                if (segment.kind !== "main") return;
                setFailedVideoUri(null);
                if (isRemoteVideoUri) setIsRemoteVideoLoading(false);
                const video = mainVideoRef.current;
                if (video) {
                  const mainWindow = resolveMainWindowForDuration(video.duration);
                  const pendingSeek = pendingVideoSeekSecRef.current;
                  const targetSec =
                    pendingSeek != null
                      ? clampToPlaybackWindow(pendingSeek, mainWindow)
                      : mainWindow.startSec;
                  if (
                    needsMainWindowSeekRef.current ||
                    pendingSeek != null ||
                    video.currentTime < mainWindow.startSec - MAIN_WINDOW_SEEK_EPSILON_SEC
                  ) {
                    if (Math.abs(video.currentTime - targetSec) > MAIN_WINDOW_SEEK_EPSILON_SEC) {
                      video.currentTime = targetSec;
                    }
                    needsMainWindowSeekRef.current = false;
                    pendingVideoSeekSecRef.current = null;
                  }
                }
                void bootstrapHandySyncIfReady();
                tryPlayVideo();
              }}
              onLoadedMetadata={() => {
                if (segment.kind !== "main") return;
                void ensurePlayableVideo(resolvedMainResource.videoUri);
                const video = mainVideoRef.current;
                if (video) {
                  const mainWindow = resolveMainWindowForDuration(video.duration);
                  const pendingSeek = pendingVideoSeekSecRef.current;
                  const targetSec =
                    pendingSeek != null
                      ? clampToPlaybackWindow(pendingSeek, mainWindow)
                      : mainWindow.startSec;
                  if (
                    needsMainWindowSeekRef.current ||
                    pendingSeek != null ||
                    video.currentTime < mainWindow.startSec - MAIN_WINDOW_SEEK_EPSILON_SEC
                  ) {
                    if (Math.abs(video.currentTime - targetSec) > MAIN_WINDOW_SEEK_EPSILON_SEC) {
                      video.currentTime = targetSec;
                    }
                    needsMainWindowSeekRef.current = false;
                    pendingVideoSeekSecRef.current = null;
                  }
                }
                void bootstrapHandySyncIfReady();
                tryPlayVideo();
              }}
              onSeeked={() => {
                if (segment.kind !== "main") return;
                tryPlayVideo();
              }}
              onPlaying={() => {
                if (segment.kind !== "main") return;
                foregroundMainVideo.handlePlay();
                if (isRemoteVideoUri) setIsRemoteVideoLoading(false);
              }}
              onLoadedData={() => {
                if (segment.kind !== "main") return;
                setFailedVideoUri(null);
                if (isRemoteVideoUri) setIsRemoteVideoLoading(false);
              }}
              onPause={() => {
                if (segment.kind !== "main") return;
                foregroundMainVideo.handlePause();
                if (allowPauseRef.current) {
                  allowPauseRef.current = false;
                  return;
                }
                if (isIntermediaryScreenActive) {
                  setStatus(t`Playback paused for transition...`);
                  return;
                }
                tryPlayVideo();
              }}
              onEnded={() => {
                if (segment.kind !== "main") return;
                foregroundMainVideo.handleEnded();
                finishWithSummary();
              }}
            >
              <track kind="captions" label={t`Gameplay captions`} />
            </video>
          )}

          {segment.kind === "intermediary" && unsafeMediaUnlocked && (
            <video
              ref={intermediaryVideoRef}
              className={`absolute inset-0 h-full w-full object-contain ${!isIntermediaryScreenActive ? "opacity-100" : "opacity-0 pointer-events-none"}`}
              controls={false}
              disablePictureInPicture
              playsInline
              preload="auto"
              tabIndex={-1}
              src={resolvedIntermediaryVideoSrc}
              onContextMenu={(event) => event.preventDefault()}
              onError={() => {
                setFailedVideoUri(
                  intermediaryVideoRef.current?.currentSrc || segment.trigger.resource.videoUri
                );
                void handleVideoError(segment.trigger.resource.videoUri);
              }}
              onEmptied={() => {
                foregroundIntermediaryVideo.handlePause();
              }}
              onLoadStart={() => {
                if (isRemoteVideoUri) setIsRemoteVideoLoading(true);
              }}
              onWaiting={() => {
                if (isRemoteVideoUri) setIsRemoteVideoLoading(true);
              }}
              onStalled={() => {
                if (isRemoteVideoUri) setIsRemoteVideoLoading(true);
              }}
              onCanPlay={() => {
                setFailedVideoUri(null);
                if (isRemoteVideoUri) setIsRemoteVideoLoading(false);
                const video = intermediaryVideoRef.current;
                if (video) {
                  const windowBounds = resolvePlaybackWindowForDuration(
                    segment.trigger.resource,
                    video.duration
                  );
                  if (
                    video.currentTime <
                    windowBounds.startSec - INTERMEDIARY_WINDOW_SEEK_EPSILON_SEC
                  ) {
                    video.currentTime = windowBounds.startSec;
                  }
                }
                void bootstrapHandySyncIfReady();
                tryPlayVideo();
              }}
              onLoadedMetadata={() => {
                void ensurePlayableVideo(segment.trigger.resource.videoUri);
                const video = intermediaryVideoRef.current;
                if (video) {
                  const windowBounds = resolvePlaybackWindowForDuration(
                    segment.trigger.resource,
                    video.duration
                  );
                  if (
                    video.currentTime <
                    windowBounds.startSec - INTERMEDIARY_WINDOW_SEEK_EPSILON_SEC
                  ) {
                    video.currentTime = windowBounds.startSec;
                  }
                }
                void bootstrapHandySyncIfReady();
                tryPlayVideo();
              }}
              onSeeked={() => {
                tryPlayVideo();
              }}
              onPlaying={() => {
                foregroundIntermediaryVideo.handlePlay();
                if (isRemoteVideoUri) setIsRemoteVideoLoading(false);
              }}
              onLoadedData={() => {
                setFailedVideoUri(null);
                if (isRemoteVideoUri) setIsRemoteVideoLoading(false);
              }}
              onPause={() => {
                foregroundIntermediaryVideo.handlePause();
                if (allowPauseRef.current) {
                  allowPauseRef.current = false;
                  return;
                }
                if (isIntermediaryScreenActive) {
                  setStatus(t`Playback paused for transition...`);
                  return;
                }
                tryPlayVideo();
              }}
              onEnded={() => {
                foregroundIntermediaryVideo.handleEnded();
                endIntermediaryAndResume();
              }}
            >
              <track kind="captions" label={t`Gameplay captions`} />
            </video>
          )}

          {!unsafeMediaUnlocked && (resolvedMainResource || segment.kind === "intermediary") && (
            <SfwOneTimeOverridePrompt
              confirmLabel={t`Show Video Once`}
              mediaLabel={t`video`}
              onConfirm={() => setAllowUnsafeMediaOnce(true)}
            />
          )}

          {showRemoteLoadingIndicator && (
            <div className="pointer-events-none absolute inset-0 z-[45] flex items-center justify-center">
              <div className="rounded-full border border-white/25 bg-black/55 p-3 backdrop-blur-sm">
                <div className="h-10 w-10 animate-spin rounded-full border-4 border-white/20 border-t-cyan-200" />
              </div>
            </div>
          )}

          {failedVideoUri && (
            <div className="pointer-events-none absolute inset-0 z-[45] flex items-center justify-center">
              <div className="pointer-events-auto rounded-xl border border-red-400/50 bg-black/70 px-6 py-4 text-center backdrop-blur-sm">
                <p className="text-center text-sm text-red-200">
                  {isWebsiteVideoProxySrc(failedVideoUri)
                    ? t`Website stream playback failed`
                    : isLocalVideoUriForFallback(failedVideoUri)
                      ? t`Local media file not found`
                      : t`Remote media file not found`}
                </p>
                <button
                  className="mt-4 rounded-md border border-red-300/60 bg-red-700/80 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-red-600"
                  onClick={() => {
                    handleMissingMediaClose({ playSound: true });
                  }}
                  onMouseEnter={() => playHoverSound()}
                  type="button"
                  data-controller-focus-id="round-overlay-missing-media-close"
                >
                  {missingMediaCloseLabel}
                </button>
              </div>
            </div>
          )}

          <div
            className={`pointer-events-none absolute inset-x-0 bottom-0 z-[35] h-1 overflow-hidden bg-white/8 transition-opacity duration-250 ${showProgressBarAlways || isUiVisible ? "opacity-100" : "opacity-0"}`}
          >
            <div
              className="h-full bg-violet-400/90 shadow-[0_0_8px_rgba(167,139,250,0.75),0_0_16px_rgba(139,92,246,0.4)] transition-[width] duration-150 ease-out"
              style={{ width: `${playbackProgress * 100}%` }}
            />
          </div>

          {isWaitingForHandyStart && (
            <div className="pointer-events-none absolute inset-0 z-50 overflow-hidden">
              <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_42%,rgba(56,189,248,0.2),transparent_56%),linear-gradient(120deg,rgba(4,10,26,0.86),rgba(24,8,46,0.88))]" />
              <div
                className="absolute inset-0 bg-[linear-gradient(90deg,transparent_0%,rgba(125,211,252,0.18)_50%,transparent_100%)]"
                style={{ animation: "handySyncSweep 1.9s linear infinite" }}
              />
              <div className="absolute left-1/2 top-[44%] h-44 w-44 -translate-x-1/2 -translate-y-1/2">
                <div
                  className="absolute inset-0 rounded-full border border-cyan-300/80"
                  style={{ animation: "handySyncRing 1.75s ease-out infinite" }}
                />
                <div
                  className="absolute inset-2 rounded-full border border-sky-300/60"
                  style={{ animation: "handySyncRing 1.75s ease-out 0.34s infinite" }}
                />
                <div
                  className="absolute inset-5 rounded-full border border-indigo-300/50"
                  style={{ animation: "handySyncRing 1.75s ease-out 0.68s infinite" }}
                />
                <div
                  className="absolute inset-[30%] rounded-full bg-cyan-300/70 shadow-[0_0_36px_rgba(56,189,248,0.85)]"
                  style={{ animation: "handySyncRing 1.2s ease-in-out infinite" }}
                />
              </div>
              <div className="absolute inset-x-0 top-[55%] mx-auto max-w-xl px-6 text-center">
                <p
                  className="font-[family-name:var(--font-jetbrains-mono)] text-[11px] uppercase tracking-[0.32em] text-cyan-200/95"
                  style={{ animation: "handySyncGlow 1.6s ease-in-out infinite" }}
                >
                  {t`TheHandy Linkup`}
                </p>
                <h3 className="mt-2 text-3xl font-black tracking-tight text-transparent bg-clip-text bg-gradient-to-r from-cyan-100 via-sky-100 to-indigo-100 sm:text-4xl">
                  {t`Waiting For Device Sync`}
                </h3>
                <p className="mx-auto mt-2 max-w-lg text-sm text-cyan-100/90">{handyWaitHint}</p>
              </div>
            </div>
          )}

          {loadingCountdown !== null && (
            <div
              className={`pointer-events-none absolute inset-0 z-[60] overflow-hidden ${boardSequence ? "" : "bg-[#07040f]"}`}
            >
              {!boardSequence && (
                <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(6,4,16,0.9),rgba(6,4,16,0.98))]" />
              )}
              {!boardSequence && (
                <div
                  className="absolute inset-0"
                  style={{ animation: "intermediaryMeshPulse 6s ease-in-out infinite" }}
                />
              )}
              {!boardSequence && (
                <div
                  className="absolute -left-[30%] -top-[20%] h-[70%] w-[70%] rounded-full opacity-30 blur-[120px]"
                  style={{
                    background: "radial-gradient(circle, rgba(236,72,153,0.55), transparent 70%)",
                    animation: "intermediaryOrb1 8s ease-in-out infinite",
                  }}
                />
              )}
              {!boardSequence && (
                <div
                  className="absolute -bottom-[15%] -right-[25%] h-[60%] w-[60%] rounded-full opacity-25 blur-[100px]"
                  style={{
                    background: "radial-gradient(circle, rgba(56,189,248,0.5), transparent 70%)",
                    animation: "intermediaryOrb2 10s ease-in-out infinite",
                  }}
                />
              )}
              {!boardSequence && (
                <div
                  className="absolute left-[40%] top-[60%] h-[40%] w-[40%] rounded-full opacity-20 blur-[90px]"
                  style={{
                    background: "radial-gradient(circle, rgba(168,85,247,0.5), transparent 70%)",
                    animation: "intermediaryOrb3 7s ease-in-out infinite",
                  }}
                />
              )}
              {!boardSequence && (
                <div className="absolute inset-0 bg-[radial-gradient(circle_at_22%_18%,rgba(236,72,153,0.18),transparent_48%),radial-gradient(circle_at_80%_24%,rgba(56,189,248,0.16),transparent_44%),linear-gradient(120deg,rgba(8,4,20,0.82),rgba(20,8,34,0.9))]" />
              )}
              {activeLoadingMedia && (
                <>
                  {isVideoMedia(activeLoadingMedia.url) ? (
                    <video
                      autoPlay
                      className="absolute inset-0 h-full w-full object-contain"
                      loop
                      muted
                      onError={handleLoadingMediaError}
                      poster={activeLoadingMedia.previewUrl ?? undefined}
                      playsInline
                      src={activeLoadingMedia.url}
                      style={{
                        animation: `loadingMediaFadeIn ${LOADING_MEDIA_FADE_MS}ms ease forwards`,
                      }}
                    >
                      <track kind="captions" label={t`Loading captions`} />
                    </video>
                  ) : (
                    <img
                      alt="loading media"
                      className="absolute inset-0 h-full w-full object-contain"
                      onError={handleLoadingMediaError}
                      src={activeLoadingMedia.url}
                      style={{
                        animation: `loadingMediaFadeIn ${LOADING_MEDIA_FADE_MS}ms ease forwards`,
                      }}
                    />
                  )}
                </>
              )}
              {activeLoadingMedia && !unsafeMediaUnlocked && (
                <SfwOneTimeOverridePrompt
                  confirmLabel={t`Show Video Once`}
                  mediaLabel={t`video`}
                  onConfirm={() => setAllowUnsafeMediaOnce(true)}
                />
              )}
              {!boardSequence && (
                <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(190,24,93,0.12),rgba(8,5,18,0.82))]" />
              )}
              {shouldRenderAntiPerkBeatbar && activeAntiPerkSequence && (
                <AntiPerkBeatbar
                  actions={activeAntiPerkSequence.actions}
                  beatbarEvents={activeAntiPerkSequence.beatbarEvents}
                  beatHits={activeAntiPerkSequence.beatHits}
                  elapsedMs={antiPerkBeatElapsedMs}
                  showBeatbar={shouldShowManualBeatbar}
                  showBall={shouldShowHandyPositionBall}
                  style={activeAntiPerkSequence.definition.beatbarStyle}
                />
              )}
              <div className="absolute bottom-5 left-5 z-10 flex w-[min(22rem,calc(100%-2.5rem))] flex-col items-start gap-4 text-left sm:bottom-6 sm:left-6">
                <div
                  className="relative rounded-xl border border-fuchsia-300/30 bg-gradient-to-br from-[#0c0814]/80 via-[#140818]/75 to-[#0a0612]/80 px-4 py-2.5 text-[10px] font-semibold uppercase tracking-[0.26em] text-fuchsia-100/85 backdrop-blur-md"
                  data-testid="anti-perk-sequence-card"
                  style={{ animation: "labelPulse 2.4s ease-in-out infinite" }}
                >
                  <div className="absolute inset-0 rounded-xl bg-gradient-to-r from-pink-500/10 via-fuchsia-500/15 to-violet-500/10" />
                  <span className="relative">{loadingLabel}</span>
                </div>
                <div
                  className="bg-gradient-to-r from-pink-200 via-fuchsia-200 to-violet-200 bg-clip-text pl-1 text-6xl font-black leading-none text-transparent drop-shadow-[0_0_30px_rgba(236,72,153,0.5)] sm:text-7xl"
                  style={{ animation: "counterGlow 2s ease-in-out infinite" }}
                >
                  {loadingCountdown}
                </div>
                <div
                  className="max-w-[20rem] rounded-xl border border-fuchsia-200/15 bg-gradient-to-br from-black/30 via-black/25 to-black/30 px-3.5 py-2.5 text-xs tracking-wide text-zinc-100/80 backdrop-blur-sm"
                  style={{ animation: "promptSlide 0.4s ease-out forwards" }}
                >
                  <span className="text-fuchsia-200/60">{t`Prompt:`}</span>{" "}
                  <span className="text-zinc-100/90">{booruSearchPrompt}</span>
                </div>
                {activeLoadingMedia && unsafeMediaUnlocked && (
                  <div className="flex items-center gap-2 pl-1">
                    <div className="h-1.5 w-1.5 rounded-full bg-fuchsia-400/60 shadow-[0_0_8px_rgba(217,70,239,0.5)]" />
                    <span className="text-[10px] font-medium uppercase tracking-[0.22em] text-fuchsia-200/55">
                      {activeLoadingMedia.source}
                    </span>
                  </div>
                )}
              </div>
            </div>
          )}

          {pendingCumRoundSummary && (
            <div className="absolute inset-0 z-[90] flex items-center justify-center bg-black/80 px-4">
              <div
                ref={cumOutcomeRef}
                className="w-full max-w-xl rounded-2xl border border-cyan-300/45 bg-[linear-gradient(145deg,rgba(6,15,38,0.96),rgba(17,8,36,0.96))] p-6 text-zinc-100 shadow-[0_0_55px_rgba(56,189,248,0.25)] backdrop-blur-xl"
              >
                <p className="font-[family-name:var(--font-jetbrains-mono)] text-[11px] uppercase tracking-[0.28em] text-cyan-200/85">
                  {abbreviateNsfwText(t`Cum Round Check`, sfwMode)}
                </p>
                <h3 className="mt-2 text-2xl font-black tracking-tight text-transparent bg-clip-text bg-gradient-to-r from-cyan-100 via-sky-100 to-fuchsia-100">
                  {abbreviateNsfwText(t`Did you cum as instructed?`, sfwMode)}
                </h3>
                <p className="mt-2 text-sm text-zinc-200/90">
                  {abbreviateNsfwText(t`Confirm what happened in this cum round.`, sfwMode)}
                </p>
                <div className="mt-5 grid gap-2">
                  <button
                    type="button"
                    className="rounded-lg border border-emerald-300/60 bg-emerald-500/20 px-4 py-3 text-left text-sm font-semibold text-emerald-100 hover:bg-emerald-500/35"
                    onClick={() => resolveCumRoundOutcome("came_as_told")}
                    data-controller-focus-id="round-cum-outcome-came"
                    data-controller-initial="true"
                  >
                    {abbreviateNsfwText(t`Came as told`, sfwMode)}
                  </button>
                  <button
                    type="button"
                    className="rounded-lg border border-cyan-300/60 bg-cyan-500/20 px-4 py-3 text-left text-sm font-semibold text-cyan-100 hover:bg-cyan-500/35"
                    onClick={() => resolveCumRoundOutcome("did_not_cum")}
                    data-controller-focus-id="round-cum-outcome-no-cum"
                  >
                    {abbreviateNsfwText(t`Did not cum`, sfwMode)}
                  </button>
                  <button
                    type="button"
                    className="rounded-lg border border-rose-300/65 bg-rose-500/20 px-4 py-3 text-left text-sm font-semibold text-rose-100 hover:bg-rose-500/35"
                    onClick={() => resolveCumRoundOutcome("failed_instruction")}
                    data-controller-focus-id="round-cum-outcome-failed"
                  >
                    {t`Failed instruction`}
                  </button>
                </div>
                <div className="mt-4 flex flex-wrap justify-end gap-2">
                  <button
                    type="button"
                    className="rounded-lg border border-zinc-300/35 bg-zinc-500/10 px-4 py-2.5 text-sm font-semibold text-zinc-100 hover:bg-zinc-500/20"
                    onClick={handleCloseCumDialog}
                    data-controller-focus-id="round-cum-outcome-close"
                  >
                    {t`Close`}
                  </button>
                </div>
              </div>
            </div>
          )}

          {showHandySyncCard ? (
            <>
              <div
                className={`pointer-events-none absolute bottom-3 right-4 z-40 flex flex-col items-end gap-2 transition-opacity duration-250 ${isUiVisible ? "opacity-100" : "opacity-0"}`}
                data-testid="thehandy-sync-card"
              >
                {hasTimelinePreview && (
                  <div className="relative h-24 w-0.5 rounded-full bg-cyan-200/20">
                    <div
                      className="absolute left-1/2 h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-cyan-300/90 shadow-[0_0_10px_rgba(34,211,238,0.5)]"
                      data-testid="thehandy-preview-orb"
                      style={{ top: `${100 - handyPreviewPosition}%` }}
                    />
                  </div>
                )}
                <div className="flex items-center gap-1.5">
                  <div
                    className={`h-1.5 w-1.5 rounded-full ${handyManuallyStopped
                        ? "bg-rose-400"
                        : handySyncState === "error" || handySyncState === "missing-key"
                          ? "bg-amber-400"
                          : "bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.4)]"
                      }`}
                  />
                  <span className="font-[family-name:var(--font-jetbrains-mono)] text-[10px] tabular-nums tracking-wider text-white/55">
                    {formatHandyOffsetLabel(offsetMs)}
                  </span>
                </div>
              </div>
              {handySyncError && (
                <div
                  className={`pointer-events-none absolute bottom-16 right-3 z-40 max-w-xs rounded-lg border border-amber-300/40 bg-black/65 px-3 py-2 text-[11px] text-amber-100 backdrop-blur transition-opacity duration-250 ${isUiVisible ? "opacity-100" : "opacity-0"}`}
                >
                  {handySyncError}
                </div>
              )}
            </>
          ) : (
            <>
              <div
                className={`pointer-events-none absolute bottom-3 right-3 z-40 rounded-full border px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] backdrop-blur transition-opacity duration-250 ${handyStatusTone} ${isUiVisible ? "opacity-100" : "opacity-0"}`}
              >
                {t`TheHandy ${handyStatusLabel}`}
              </div>
              {handySyncError && (
                <div
                  className={`pointer-events-none absolute bottom-12 right-3 z-40 max-w-xs rounded-lg border border-amber-300/40 bg-black/65 px-3 py-2 text-[11px] text-amber-100 backdrop-blur transition-opacity duration-250 ${isUiVisible ? "opacity-100" : "opacity-0"}`}
                >
                  {handySyncError}
                </div>
              )}
            </>
          )}

          <div
            className={`pointer-events-none absolute bottom-3 left-3 z-30 rounded-full border border-fuchsia-200/25 bg-black/45 px-3 py-1.5 text-xs font-semibold text-fuchsia-100 backdrop-blur transition-opacity duration-250 ${shouldShowPlaybackTimer ? "opacity-100" : "opacity-0"}`}
            data-testid="round-playback-timer"
          >
            {playbackTimeLabel}
          </div>

          {canUseDebugRoundControls && (
            <div
              className={`pointer-events-none absolute bottom-14 left-3 z-30 rounded-md border border-fuchsia-200/25 bg-black/45 px-3 py-2 text-xs text-fuchsia-100 backdrop-blur transition-opacity duration-250 ${isUiVisible ? "opacity-100" : "opacity-0"}`}
            >
              <div>
                {t`Segment`}: {segment.kind === "main" ? t`Main` : t`Intermediary`}
              </div>
              <div>
                {t`Duration`}: {playbackTimeLabel}
              </div>
              <div>
                {t`Playback`}: {playbackRateLabel}x
              </div>
              <div>
                {t`Funscript actions`}: {funscriptCount}
              </div>
              <div>
                {t`Current script position`}:{" "}
                {typeof funscriptPosition === "number" ? Math.trunc(funscriptPosition) : "-"}
              </div>
              {isDevelopmentMode && (
                <div>
                  {t`Intermediary queue`}: {fullIntermediaryQueue.length}
                </div>
              )}
            </div>
          )}

          {antiPerkAlert && (
            <div className="pointer-events-none absolute inset-x-0 top-16 z-[100] flex justify-center px-4">
              <div
                className="flex w-full max-w-sm flex-col items-center gap-1.5 rounded-2xl border-2 border-rose-400/60 bg-black/85 px-6 py-4 backdrop-blur-2xl sm:max-w-max sm:px-8 sm:py-5"
                style={{
                  animation:
                    "antiPerkAlertSlide 4.5s cubic-bezier(0.19, 1, 0.22, 1) forwards, antiPerkAlertPulse 1.8s ease-in-out infinite",
                }}
              >
                <div className="flex items-center gap-3">
                  <div className="h-2 w-2 animate-pulse rounded-full bg-rose-500 shadow-[0_0_12px_rgba(244,63,94,0.8)]" />
                  <span className="text-[10px] font-black uppercase tracking-[0.4em] text-rose-200/90 [text-shadow:0_0_15px_rgba(251,113,133,0.4)]">
                    {t`System Warning`}
                  </span>
                  <div className="h-2 w-2 animate-pulse rounded-full bg-rose-500 shadow-[0_0_12px_rgba(244,63,94,0.8)]" />
                </div>
                <div className="bg-gradient-to-b from-white via-rose-50 to-rose-200 bg-clip-text text-center text-lg font-black tracking-tight text-transparent sm:text-2xl">
                  {antiPerkAlert.text}
                </div>
              </div>
            </div>
          )}

          {isUiVisible && !isIntermediaryScreenActive && !pendingCumRoundSummary && (
            <ControllerHints
              contextId="round-active"
              bottomClassName={roundControllerHintsBottomClassName}
              hints={[
                ...(roundControl && roundControl.pauseCharges > 0
                  ? [{ label: t`Pause Round`, action: "ACTION_Y" as const }]
                  : []),
                { label: t`Options`, action: "START" as const },
              ]}
            />
          )}

          {isUiVisible && pendingCumRoundSummary && (
            <ControllerHints
              contextId="cum-outcome"
              hints={[
                {
                  label: abbreviateNsfwText(t`Came as Told`, sfwMode),
                  action: "ACTION_X" as const,
                },
                { label: abbreviateNsfwText(t`Did Not Cum`, sfwMode), action: "ACTION_Y" as const },
              ]}
            />
          )}
        </div>
      </div>
    </div>
  );
}
