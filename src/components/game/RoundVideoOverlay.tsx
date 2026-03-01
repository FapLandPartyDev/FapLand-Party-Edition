import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ActiveRound, CompletedRoundSummary, CumRoundOutcome, PlayerState } from "../../game/types";
import type { InstalledRound } from "../../services/db";
import {
  ensureBooruMediaCache,
  getCachedBooruMedia,
  isVideoMedia,
  type BooruMediaItem,
} from "../../services/booru";
import { usePlayableVideoFallback } from "../../hooks/usePlayableVideoFallback";
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

type RoundVideoOverlayProps = {
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
  boardSequence?: "milker" | "jackhammer" | "no-rest" | null;
  onCompleteBoardSequence?: (perkId: "milker" | "jackhammer" | "no-rest") => void;
  allowAutomaticIntermediaries?: boolean;
  showCloseButton?: boolean;
  onClose?: () => void;
  booruSearchPrompt: string;
  intermediaryLoadingDurationSec: number;
  intermediaryReturnPauseSec: number;
  onFinishRound: (summary?: CompletedRoundSummary) => void;
  onRequestCum?: () => void;
  showCumRoundOutcomeMenuOnCumRequest?: boolean;
  onOpenOptions?: () => void;
  allowDebugRoundControls?: boolean;
  extraModifiers?: PlaybackModifier[];
  onFunscriptFrame?: (payload: {
    timeMs: number;
    position: number | null;
  }) => void;
  onUiVisibilityChange?: (visible: boolean) => void;
};

type LoadingMediaItem = BooruMediaItem | {
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

const INITIAL_UI_SHOW_MS = 5000;
const UI_SHOW_AFTER_MOUSEMOVE_MS = 2200;
const LOADING_MEDIA_ROTATE_MS = 2400;
const LOADING_MEDIA_FADE_MS = 900;
const HANDY_PUSH_INTERVAL_MS = 60;
const HANDY_KEEPALIVE_MS = 150;
const HANDY_REAUTH_MARGIN_MS = 30_000;
const HANDY_SYNC_STALE_MS = 2_000;
const MAIN_WINDOW_SEEK_EPSILON_SEC = 0.05;
const MAIN_WINDOW_END_TOLERANCE_SEC = 0.04;
const MANUAL_PAUSE_DURATION_MS = 15_000;

function applyTimelineIntensityCap(
  timeline: Awaited<ReturnType<typeof loadFunscriptTimeline>>,
  cap: number | null | undefined,
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

function randomRange(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

function createGeneratedSequenceActions(
  durationMs: number,
  mode: "milker" | "jackhammer" | "no-rest",
): FunscriptAction[] {
  const clampedDurationMs = Math.max(2000, durationMs);
  const aggressive = mode === "jackhammer";
  const gentle = mode === "no-rest";
  const minStepMs = gentle ? 180 : aggressive ? 85 : 110;
  const maxStepMs = gentle ? 280 : aggressive ? 145 : 220;
  const minPos = gentle ? 35 : aggressive ? 22 : 28;
  const maxPos = gentle ? 65 : aggressive ? 78 : 72;
  const baseAmp = gentle ? 8 : aggressive ? 22 : 16;
  const extraAmp = gentle ? 8 : aggressive ? 26 : 20;

  const actions: FunscriptAction[] = [{ at: 0, pos: 50 }];
  let timeMs = 0;

  while (timeMs < clampedDurationMs) {
    timeMs = Math.min(clampedDurationMs, Math.floor(timeMs + randomRange(minStepMs, maxStepMs)));
    const intensity = Math.max(0, Math.min(1, timeMs / clampedDurationMs));
    const center = 50 + randomRange(-10, 10) * intensity;
    const amplitude = baseAmp + extraAmp * intensity;
    const rawPos = center + randomRange(-amplitude, amplitude);
    const pos = Math.max(minPos, Math.min(maxPos, rawPos));
    actions.push({ at: timeMs, pos });
  }

  return actions;
}

export function RoundVideoOverlay({
  activeRound,
  installedRounds,
  currentPlayer,
  roundControl,
  intermediaryProbability,
  boardSequence = null,
  onCompleteBoardSequence,
  allowAutomaticIntermediaries = true,
  showCloseButton = false,
  onClose,
  booruSearchPrompt,
  intermediaryLoadingDurationSec,
  intermediaryReturnPauseSec,
  onFinishRound,
  onRequestCum,
  showCumRoundOutcomeMenuOnCumRequest = false,
  onOpenOptions,
  allowDebugRoundControls = false,
  extraModifiers = [],
  onFunscriptFrame,
  onUiVisibilityChange,
}: RoundVideoOverlayProps) {
  const { connectionKey, appApiKey, connected: handyConnected, setSyncStatus } = useHandy();
  const isDevelopmentMode =
    import.meta.env.DEV ||
    import.meta.env.MODE === "development" ||
    import.meta.env.VITE_GAME_ENV === "development";
  const canUseDebugRoundControls = isDevelopmentMode || allowDebugRoundControls;

  const mainVideoRef = useRef<HTMLVideoElement>(null);
  const intermediaryVideoRef = useRef<HTMLVideoElement>(null);
  const initializedRoundKeyRef = useRef<string | null>(null);
  const forceHandySyncMsRef = useRef<number | null>(null);
  const allowPauseRef = useRef(false);
  const firedTriggersRef = useRef(new Set<string>());
  const sessionStartedAtRef = useRef(0);
  const antiPerkCountAtRoundStartRef = useRef(0);
  const timelineCacheRef = useRef(new Map<string, Awaited<ReturnType<typeof loadFunscriptTimeline>>>());

  const countdownTimerRef = useRef<number | null>(null);
  const loadingRotateTimerRef = useRef<number | null>(null);
  const loadingFetchTokenRef = useRef(0);
  const loadingMediaCacheRef = useRef(new Map<string, LoadingMediaItem[]>());
  const uiHideTimerRef = useRef<number | null>(null);
  const manualPauseTimerRef = useRef<number | null>(null);
  const generatedSequenceTimerRef = useRef<number | null>(null);
  const lastMouseMoveAtRef = useRef(0);

  const lastPlaybackRateLabelRef = useRef("1.00");
  const lastFramePositionRef = useRef<number | null>(null);
  const lastFrameTimeMsRef = useRef<number | null>(null);
  const finishRequestedRef = useRef(false);
  const needsMainWindowSeekRef = useRef(false);

  const handySessionRef = useRef<HandySession | null>(null);
  const handyInitPromiseRef = useRef<Promise<HandySession | null> | null>(null);
  const handyPushInFlightRef = useRef(false);
  const handyLastPushAtRef = useRef(0);
  const handyLastPushPosRef = useRef<number | null>(null);
  const handyLastSuccessAtRef = useRef(0);

  const [segment, setSegment] = useState<SegmentState>({ kind: "main" });
  const [activeVideoUri, setActiveVideoUri] = useState<string | null>(null);
  const [status, setStatus] = useState("Preparing playback...");
  const [playbackRateLabel, setPlaybackRateLabel] = useState("1.00");
  const [funscriptCount, setFunscriptCount] = useState(0);
  const [funscriptPosition, setFunscriptPosition] = useState<number | null>(null);
  const [randomIntermediaryQueue, setRandomIntermediaryQueue] = useState<IntermediaryTrigger[]>([]);
  const [loadingCountdown, setLoadingCountdown] = useState<number | null>(null);
  const [loadingLabel, setLoadingLabel] = useState<string>("");
  const [loadingMedia, setLoadingMedia] = useState<LoadingMediaItem[]>([]);
  const [loadingMediaIndex, setLoadingMediaIndex] = useState(0);
  const [isUiVisible, setIsUiVisible] = useState(true);
  const [isRemoteVideoLoading, setIsRemoteVideoLoading] = useState(false);
  const [pendingCumRoundSummary, setPendingCumRoundSummary] = useState<CompletedRoundSummary | null>(null);

  const [timeline, setTimeline] = useState<Awaited<ReturnType<typeof loadFunscriptTimeline>>>(null);
  const [timelineUri, setTimelineUri] = useState<string | null>(null);

  const [handySyncState, setHandySyncState] = useState<HandySyncState>("disconnected");
  const [handySyncError, setHandySyncError] = useState<string | null>(null);
  const { getVideoSrc, ensurePlayableVideo, handleVideoError } = usePlayableVideoFallback();

  const resolvedRound = useMemo(() => {
    if (!activeRound) return null;
    return installedRounds.find((round) => round.id === activeRound.roundId) ?? null;
  }, [activeRound, installedRounds]);

  const resolvedMainResource = useMemo<PlaybackResource | null>(() => {
    const resource = resolvedRound?.resources[0];
    if (!resource) return null;
    return { videoUri: resource.videoUri, funscriptUri: resource.funscriptUri };
  }, [resolvedRound]);

  const mainPlaybackWindowSec = useMemo(() => {
    const startMs =
      typeof resolvedRound?.startTime === "number" && Number.isFinite(resolvedRound.startTime)
        ? Math.max(0, resolvedRound.startTime)
        : 0;
    const rawEndMs =
      typeof resolvedRound?.endTime === "number" && Number.isFinite(resolvedRound.endTime)
        ? Math.max(0, resolvedRound.endTime)
        : null;
    const endMs = rawEndMs !== null && rawEndMs > startMs ? rawEndMs : null;
    return {
      startSec: startMs / 1000,
      endSec: endMs === null ? null : endMs / 1000,
    };
  }, [resolvedRound?.endTime, resolvedRound?.startTime]);

  const resolveMainWindowForDuration = useCallback((durationSec: number) => {
    const hasFiniteDuration = Number.isFinite(durationSec) && durationSec > 0;
    const boundedStartSec = hasFiniteDuration
      ? Math.min(mainPlaybackWindowSec.startSec, durationSec)
      : mainPlaybackWindowSec.startSec;
    let boundedEndSec = mainPlaybackWindowSec.endSec;
    if (boundedEndSec !== null && hasFiniteDuration) {
      boundedEndSec = Math.min(boundedEndSec, durationSec);
    }
    if (boundedEndSec !== null && boundedEndSec <= boundedStartSec + 0.001) {
      boundedEndSec = null;
    }
    return { startSec: boundedStartSec, endSec: boundedEndSec };
  }, [mainPlaybackWindowSec.endSec, mainPlaybackWindowSec.startSec]);

  const intermediaryResourcePool = useMemo<PlaybackResource[]>(() => {
    const pool = installedRounds
      .filter((round) => round.type === "Interjection")
      .map((round) => round.resources[0])
      .filter((resource): resource is NonNullable<typeof resource> => Boolean(resource))
      .map((resource) => ({
        videoUri: resource.videoUri,
        funscriptUri: resource.funscriptUri,
      }));

    if (!resolvedMainResource) return pool;
    return pool.filter((resource) => resource.videoUri !== resolvedMainResource.videoUri);
  }, [installedRounds, resolvedMainResource]);

  const deterministicTestIntermediary = useMemo<PlaybackResource | null>(() => {
    if (!canUseDebugRoundControls) return null;
    return (
      intermediaryResourcePool.find((resource) =>
        resource.videoUri.includes("Fugtrup%20Zelda%20x%20Bokoblin.mp4"),
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
      extraModifiers,
    );
  }, [allowAutomaticIntermediaries, currentPlayer, extraModifiers, intermediaryResourcePool, resolvedMainResource]);

  const intermediaryQueue = useMemo(() => {
    if (!allowAutomaticIntermediaries) return [];
    if (!resolvedMainResource || !currentPlayer) return [];
    return buildIntermediaryQueue(sessionModifiers, {
      playerPerks: currentPlayer.perks,
      playerAntiPerks: currentPlayer.antiPerks,
      mainResource: resolvedMainResource,
      intermediaryResources: intermediaryResourcePool,
    });
  }, [allowAutomaticIntermediaries, currentPlayer, intermediaryResourcePool, resolvedMainResource, sessionModifiers]);

  const fullIntermediaryQueue = useMemo(
    () => [...intermediaryQueue, ...randomIntermediaryQueue].sort((a, b) => a.atProgress - b.atProgress),
    [intermediaryQueue, randomIntermediaryQueue],
  );

  const activeSegmentResource = useMemo<PlaybackResource | null>(() => {
    if (segment.kind === "intermediary") return segment.trigger.resource;
    return resolvedMainResource;
  }, [resolvedMainResource, segment]);

  const isIntermediaryScreenActive = loadingCountdown !== null;
  const resolvedMainVideoSrc = resolvedMainResource ? getVideoSrc(resolvedMainResource.videoUri) : undefined;
  const resolvedIntermediaryVideoSrc =
    segment.kind === "intermediary" ? getVideoSrc(segment.trigger.resource.videoUri) : undefined;
  const isRemoteVideoUri = useMemo(
    () => Boolean(activeVideoUri && /^https?:\/\//i.test(activeVideoUri)),
    [activeVideoUri],
  );

  const hasUsableActiveTimeline =
    Boolean(activeSegmentResource?.funscriptUri) &&
    timelineUri === activeSegmentResource?.funscriptUri &&
    (timeline?.actions.length ?? 0) > 0;

  const shouldUseHandySync =
    hasUsableActiveTimeline &&
    handyConnected &&
    (connectionKey.trim().length > 0 && appApiKey.trim().length > 0);
  const isWaitingForHandyStart =
    shouldUseHandySync &&
    handySyncState !== "synced";
  const handyWaitHint =
    handySyncState === "error"
      ? "The device reported a sync error. Retrying handshake..."
      : handySyncState === "connecting"
        ? "Aligning timeline with TheHandy before playback starts."
        : "Preparing TheHandy synchronization.";
  const fallbackLoadingMedia = useMemo<LoadingMediaItem[]>(
    () =>
      intermediaryResourcePool.slice(0, 24).map((resource, index) => ({
        id: `fallback-${index}-${resource.videoUri}`,
        source: "fallback",
        url: resource.videoUri,
        previewUrl: null,
      })),
    [intermediaryResourcePool],
  );

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
    if (generatedSequenceTimerRef.current !== null) {
      window.clearInterval(generatedSequenceTimerRef.current);
      generatedSequenceTimerRef.current = null;
    }
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

  const showUiTemporarily = useCallback((durationMs: number) => {
    clearUiHideTimer();
    setIsUiVisible(true);
    uiHideTimerRef.current = window.setTimeout(() => {
      setIsUiVisible(false);
    }, durationMs);
  }, [clearUiHideTimer]);

  const resetHandySync = useCallback((nextState: HandySyncState, message: string | null = null) => {
    handySessionRef.current = null;
    handyInitPromiseRef.current = null;
    handyPushInFlightRef.current = false;
    handyLastPushAtRef.current = 0;
    handyLastPushPosRef.current = null;
    handyLastSuccessAtRef.current = 0;
    setHandySyncState(nextState);
    setHandySyncError(message);
    setSyncStatus({ synced: false, error: message });
  }, [setSyncStatus]);

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
        session,
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
        session,
      );
    } catch {
      // ignore teardown failures
    }
  }, [appApiKey, connectionKey, handyConnected]);

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
        const message = error instanceof Error ? error.message : "Failed to initialize TheHandy session.";
        resetHandySync("error", message);
        return null;
      })
      .finally(() => {
        handyInitPromiseRef.current = null;
      });

    handyInitPromiseRef.current = initPromise;
    return initPromise;
  }, [appApiKey, connectionKey, handyConnected, resetHandySync]);

  const startGeneratedSequenceSync = useCallback((input: {
    mode: "milker" | "jackhammer" | "no-rest";
    durationMs: number;
  }) => {
    clearGeneratedSequenceTimer();
    if (!handyConnected) return;
    const appKey = appApiKey.trim();
    const connKey = connectionKey.trim();
    if (!appKey || !connKey) return null;

    const actions = createGeneratedSequenceActions(input.durationMs, input.mode);
    const sourceId = `anti-${input.mode}-${Date.now()}`;
    const startedAt = performance.now();

    const tick = () => {
      const elapsedMs = Math.max(0, Math.min(input.durationMs, Math.floor(performance.now() - startedAt)));

      void (async () => {
        try {
          const session = await ensureHandySession();
          if (!session) return;
          await preloadHspScript(
            { connectionKey: connKey, appApiKey: appKey },
            session,
            sourceId,
            actions,
            0,
          );
          await sendHspSync(
            { connectionKey: connKey, appApiKey: appKey },
            session,
            elapsedMs,
            1,
            sourceId,
            actions,
          );
          setHandySyncState("synced");
          setHandySyncError(null);
        } catch (error) {
          const message = error instanceof Error ? error.message : "Generated sequence sync failed.";
          setHandySyncState("error");
          setHandySyncError(message);
        }
      })();
    };

    tick();
    generatedSequenceTimerRef.current = window.setInterval(tick, 120);
  }, [
    appApiKey,
    clearGeneratedSequenceTimer,
    connectionKey,
    ensureHandySession,
    handyConnected,
  ]);

  const applySegmentSwitch = useCallback((plan: TransitionPlan) => {
    forceHandySyncMsRef.current =
      plan.pendingSeekSec === null || plan.pendingSeekSec === undefined
        ? null
        : Math.max(0, plan.pendingSeekSec * 1000);

    setSegment(plan.nextSegment);
    setActiveVideoUri(plan.nextVideoUri);
    setStatus(plan.status);
    setLoadingMedia([]);
    setLoadingMediaIndex(0);
  }, []);

  const runSegmentTransition = useCallback((params: {
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
      void getCachedBooruMedia(booruSearchPrompt).then((cachedMedia) => {
        if (loadingFetchTokenRef.current !== token) return;
        if (cachedMedia.length === 0) return;
        loadingMediaCacheRef.current.set(booruSearchPrompt, cachedMedia);
        setLoadingMedia(cachedMedia);
      });
    }

    void ensureBooruMediaCache(booruSearchPrompt, 18).then((media) => {
      if (loadingFetchTokenRef.current !== token) return;
      const nextMedia = media.length > 0 ? media : fallbackLoadingMedia;
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
  }, [applySegmentSwitch, booruSearchPrompt, clearCountdownTimer, clearLoadingMediaTimers, fallbackLoadingMedia]);



  const tryPlayVideo = useCallback(() => {
    const video = segment.kind === "main" ? mainVideoRef.current : intermediaryVideoRef.current;
    if (!video) return;
    if (isIntermediaryScreenActive) {
      setStatus("Playback paused for transition...");
      return;
    }

    if (isWaitingForHandyStart) {
      setStatus("Waiting for TheHandy sync before playback...");
      return;
    }
    if (!video.paused) return;
    void video.play().catch((error) => {
      console.warn("Video autoplay failed", error);
    });
  }, [isIntermediaryScreenActive, isWaitingForHandyStart, segment.kind]);

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

  const resolveCumRoundOutcome = useCallback((cumOutcome: CumRoundOutcome) => {
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
  }, [onFinishRound, pendingCumRoundSummary, stopHandyIfNeeded]);

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
  }, [activeRound?.phaseKind, onRequestCum, pendingCumRoundSummary, showCumRoundOutcomeMenuOnCumRequest, stopHandyIfNeeded]);

  const startIntermediary = useCallback((trigger: IntermediaryTrigger, resumeAtSec: number, statusText: string) => {
    firedTriggersRef.current.add(trigger.id);
    runSegmentTransition({
      label: "LOADING INTERMEDIARY",
      countdownSec: intermediaryLoadingDurationSec,
      statusWhileCountdown: "Loading intermediary assets...",
      sound: "intermediary",
      plan: {
        nextSegment: { kind: "intermediary", trigger, resumeAtSec },
        nextVideoUri: trigger.resource.videoUri,
        status: statusText,
      },
    });
  }, [intermediaryLoadingDurationSec, runSegmentTransition]);

  const endIntermediaryAndResume = useCallback((statusText = "Returning to main round video.") => {
    if (!resolvedMainResource) return;
    if (segment.kind !== "intermediary") return;

    runSegmentTransition({
      label: "RETURNING TO MAIN",
      countdownSec: intermediaryReturnPauseSec,
      statusWhileCountdown: "Preparing main round resume...",
      sound: "return",
      plan: {
        nextSegment: { kind: "main" },
        nextVideoUri: resolvedMainResource.videoUri,
        status: statusText,
        pendingSeekSec: segment.resumeAtSec,
      },
    });
  }, [intermediaryReturnPauseSec, resolvedMainResource, runSegmentTransition, segment]);

  const triggerTestIntermediary = useCallback(() => {
    if (!activeRound || !resolvedMainResource) return;
    if (segment.kind !== "main") {
      setStatus("Already inside an intermediary segment.");
      return;
    }
    if (intermediaryResourcePool.length === 0) {
      setStatus("No intermediary resources available for this round.");
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
    const resumeAtSec = Math.max(startSec, Math.min(video.currentTime, endSec ?? video.currentTime));

    allowPauseRef.current = true;
    video.pause();
    startIntermediary(trigger, resumeAtSec, "Development: forced intermediary clip.");
  }, [activeRound, deterministicTestIntermediary, intermediaryResourcePool, resolveMainWindowForDuration, resolvedMainResource, segment.kind, startIntermediary]);

  const resyncHandyTiming = useCallback(async () => {
    if (!activeRound || !activeVideoUri) {
      setStatus("No active video to resync.");
      return;
    }
    if (!shouldUseHandySync) {
      setStatus("No active TheHandy timeline to resync.");
      return;
    }
    const video = segment.kind === "main" ? mainVideoRef.current : intermediaryVideoRef.current;
    const actions = timeline?.actions ?? [];
    if (!video || actions.length === 0) return;

    setStatus("Resyncing TheHandy timing...");
    setHandySyncState("connecting");
    setHandySyncError(null);
    setSyncStatus({ synced: false, error: null });

    try {
      const timeMs = Math.max(0, video.currentTime * 1000);
      const playbackRate = video.playbackRate ?? 1;



      if (!connectionKey.trim() || !appApiKey.trim()) {
        setHandySyncState("missing-key");
        setSyncStatus({ synced: false, error: "Missing Application ID/API key for TheHandy v3." });
        setStatus("Cannot resync: missing Application ID/API key.");
        return;
      }

      const session = await ensureHandySession();
      if (!session) {
        setStatus("Failed to initialize TheHandy session for resync.");
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
        actions,
      );
      await sendHspSync(
        {
          connectionKey: connectionKey.trim(),
          appApiKey: appApiKey.trim(),
        },
        session,
        timeMs,
        playbackRate,
        `${activeVideoUri}:${segment.kind}`,
        actions,
      );

      const syncedAt = Date.now();
      handyLastPushAtRef.current = syncedAt;
      handyLastSuccessAtRef.current = syncedAt;
      handyLastPushPosRef.current = getFunscriptPositionAtMs(timeline, timeMs);
      setHandySyncState("synced");
      setHandySyncError(null);
      setSyncStatus({ synced: true, error: null });
      setStatus("TheHandy timing resynced.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to resync timing with TheHandy.";
      setHandySyncState("error");
      setHandySyncError(message);
      setSyncStatus({ synced: false, error: message });
      setStatus(`Resync failed: ${message}`);
    }
  }, [
    activeRound,
    activeVideoUri,
    appApiKey,
    connectionKey,
    ensureHandySession,
    segment.kind,
    setSyncStatus,
    shouldUseHandySync,
    timeline,
  ]);

  useEffect(() => {
    return () => {
      clearCountdownTimer();
      clearLoadingMediaTimers();
      clearUiHideTimer();
      clearManualPauseTimer();
      clearGeneratedSequenceTimer();
    };
  }, [clearCountdownTimer, clearGeneratedSequenceTimer, clearLoadingMediaTimers, clearManualPauseTimer, clearUiHideTimer]);

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
    onUiVisibilityChange?.(isUiVisible);
  }, [isUiVisible, onUiVisibilityChange]);

  useEffect(() => {
    if (!boardSequence) return;
    if (activeRound) return;

    clearCountdownTimer();
    clearLoadingMediaTimers();
    clearGeneratedSequenceTimer();

    const durationSec = boardSequence === "milker" ? 30 : boardSequence === "jackhammer" ? 15 : 10;
    const durationMs = durationSec * 1000;
    const label =
      boardSequence === "milker"
        ? "MILKER SEQUENCE"
        : boardSequence === "jackhammer"
          ? "JACKHAMMER SEQUENCE"
          : "NO REST FILLER";

    setLoadingLabel(label);
    setLoadingCountdown(durationSec);
    setStatus("Running anti-perk sequence...");
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
      void getCachedBooruMedia(booruSearchPrompt).then((cachedMedia) => {
        if (loadingFetchTokenRef.current !== token) return;
        if (cachedMedia.length === 0) return;
        loadingMediaCacheRef.current.set(booruSearchPrompt, cachedMedia);
        setLoadingMedia(cachedMedia);
      });
    }

    void ensureBooruMediaCache(booruSearchPrompt, 18).then((media) => {
      if (loadingFetchTokenRef.current !== token) return;
      const nextMedia = media.length > 0 ? media : fallbackLoadingMedia;
      loadingMediaCacheRef.current.set(booruSearchPrompt, nextMedia);
      setLoadingMedia(nextMedia);
    });

    startGeneratedSequenceSync({ mode: boardSequence, durationMs });

    countdownTimerRef.current = window.setInterval(() => {
      setLoadingCountdown((prev) => {
        if (prev === null) return null;
        if (prev <= 1) {
          clearCountdownTimer();
          clearLoadingMediaTimers();
          clearGeneratedSequenceTimer();
          setLoadingCountdown(null);
          setLoadingLabel("");
          setLoadingMedia([]);
          setLoadingMediaIndex(0);
          setStatus("Board sequence completed.");
          void pauseHandyIfNeeded();
          onCompleteBoardSequence?.(boardSequence);
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
      void pauseHandyIfNeeded();
    };
  }, [
    activeRound,
    boardSequence,
    booruSearchPrompt,
    clearCountdownTimer,
    clearGeneratedSequenceTimer,
    clearLoadingMediaTimers,
    fallbackLoadingMedia,
    onCompleteBoardSequence,
    pauseHandyIfNeeded,
    startGeneratedSequenceSync,
  ]);

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
    if ((!activeRound || !resolvedMainResource) && !boardSequence) {
      initializedRoundKeyRef.current = null;
      firedTriggersRef.current = new Set<string>();
      finishRequestedRef.current = false;
      needsMainWindowSeekRef.current = false;
      forceHandySyncMsRef.current = null;
      clearCountdownTimer();
      clearLoadingMediaTimers();
      setRandomIntermediaryQueue([]);
      setSegment({ kind: "main" });
      setActiveVideoUri(null);
      setStatus("No active round.");
      setLoadingCountdown(null);
      setLoadingLabel("");
      setLoadingMedia([]);
      setLoadingMediaIndex(0);
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
    allowPauseRef.current = false;
    antiPerkCountAtRoundStartRef.current = currentPlayer?.antiPerks.length ?? 0;

    setSegment({ kind: "main" });
    setActiveVideoUri(resolvedMainResource.videoUri);
    setStatus("Loading round video...");
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

    const randomResource =
      deterministicTestIntermediary ??
      intermediaryResourcePool[Math.floor(Math.random() * intermediaryResourcePool.length)];

    if (!randomResource) {
      setRandomIntermediaryQueue([]);
      return;
    }

    const atProgress = 0.2 + Math.random() * 0.6;
    setRandomIntermediaryQueue([{ id: `random-${activeRound.fieldId}`, atProgress, resource: randomResource }]);
  }, [
    activeRound,
    allowAutomaticIntermediaries,
    currentPlayer,
    deterministicTestIntermediary,
    intermediaryProbability,
    intermediaryResourcePool,
    resolvedMainResource,
    boardSequence,
    clearCountdownTimer,
    clearLoadingMediaTimers,
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
    firedTriggersRef.current.add(triggerId);

    const durationSec = sequenceType === "milker" ? 30 : 15;
    const durationMs = durationSec * 1000;
    const label = sequenceType === "milker" ? "MILKER SEQUENCE" : "JACKHAMMER SEQUENCE";
    const statusWhileCountdown = sequenceType === "milker"
      ? "Milker anti-perk active..."
      : "Jackhammer anti-perk active...";
    const resumeAtSec = Math.max(0, mainVideoRef.current?.currentTime ?? 0);

    const video = mainVideoRef.current;
    if (video && !video.paused) {
      allowPauseRef.current = true;
      video.pause();
    }

    startGeneratedSequenceSync({ mode: sequenceType, durationMs });
    runSegmentTransition({
      label,
      countdownSec: durationSec,
      statusWhileCountdown,
      sound: "intermediary",
      plan: {
        nextSegment: { kind: "main" },
        nextVideoUri: resolvedMainResource.videoUri,
        status: "Returning to main round video.",
        pendingSeekSec: resumeAtSec,
      },
      onComplete: () => {
        clearGeneratedSequenceTimer();
        void pauseHandyIfNeeded();
        onCompleteBoardSequence?.(sequenceType);
      },
    });
  }, [
    activeRound,
    clearGeneratedSequenceTimer,
    currentPlayer,
    isIntermediaryScreenActive,
    onCompleteBoardSequence,
    pauseHandyIfNeeded,
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

    const { startSec } = resolveMainWindowForDuration(video.duration);
    if (Math.abs(video.currentTime - startSec) > MAIN_WINDOW_SEEK_EPSILON_SEC) {
      video.currentTime = startSec;
    }
    needsMainWindowSeekRef.current = false;
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
      setStatus((prev) => (prev.startsWith("Loading") ? prev : "Playing video (no funscript)."));
      return;
    }

    const cached = timelineCacheRef.current.get(funscriptUri) ?? null;
    if (cached) {
      const resolvedTimeline = applyTimelineIntensityCap(cached, intensityCap);
      setTimeline(resolvedTimeline);
      setTimelineUri(funscriptUri);
      const count = resolvedTimeline?.actions.length ?? 0;
      setFunscriptCount(count);
      setStatus(count > 0 ? "Playing video + funscript." : "Playing video (empty funscript).");
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
      setStatus(count > 0 ? "Playing video + funscript." : "Playing video (empty funscript).");
    });

    return () => {
      cancelled = true;
    };
  }, [activeRound, activeSegmentResource?.funscriptUri, boardSequence, currentPlayer?.pendingIntensityCap]);

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
      lastFrameTimeMsRef.current = timeMs;

      const position = getFunscriptPositionAtMs(timeline, timeMs);
      if (position !== lastFramePositionRef.current) {
        lastFramePositionRef.current = position;
        setFunscriptPosition(position);
        onFunscriptFrame?.({ timeMs, position });
      }

      if (segment.kind === "main") {
        const { startSec, endSec } = resolveMainWindowForDuration(video.duration);
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
            : Number.isFinite(video.duration) && video.duration > startSec
              ? Math.max(0, video.duration - startSec)
              : 0;
        const elapsedInWindowSec = Math.max(0, mainCurrentTimeSec - startSec);

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

        const progress =
          boundedDurationSec > 0
            ? Math.max(0, Math.min(1, elapsedInWindowSec / boundedDurationSec))
            : 0;

        const nextTrigger = fullIntermediaryQueue.find(
          (trigger) => !firedTriggersRef.current.has(trigger.id) && progress >= trigger.atProgress,
        );

        if (nextTrigger) {
          const resumeAtSec = Math.max(startSec, Math.min(mainCurrentTimeSec, endSec ?? mainCurrentTimeSec));
          allowPauseRef.current = true;
          video.pause();
          startIntermediary(nextTrigger, resumeAtSec, "Intermediary clip spawned.");
        }
      } else {
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
    if (!handyConnected) {
      resetHandySync("disconnected", null);
      return;
    }
    if (!appApiKey.trim()) {
      resetHandySync("missing-key", "Missing Application ID/API key for TheHandy v3.");
      return;
    }
    setHandySyncState("connecting");
    setHandySyncError(null);
    setSyncStatus({ synced: false, error: null });
  }, [appApiKey, handyConnected, resetHandySync, setSyncStatus]);

  useEffect(() => {
    if (!activeRound) return;
    if (!isIntermediaryScreenActive) return;

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
  }, [activeRound, handyConnected, isIntermediaryScreenActive, pauseHandyIfNeeded, segment.kind, setSyncStatus]);

  // Preload the main funscript into TheHandy during the "RETURNING TO MAIN"
  // countdown so the device is immediately ready when playback resumes.
  useEffect(() => {
    if (!isIntermediaryScreenActive) return;
    if (!shouldUseHandySync) return;
    if (!resolvedMainResource?.funscriptUri) return;
    if (loadingLabel !== "RETURNING TO MAIN") return;

    // IMPORTANT: Read the MAIN timeline from cache, NOT from `timeline` state.
    // During the intermediary, `timeline` state holds the intermediary's funscript.
    const mainTimeline = timelineCacheRef.current.get(resolvedMainResource.funscriptUri);
    const mainActions = mainTimeline?.actions ?? [];
    if (mainActions.length === 0) return;

    const resumeMs =
      segment.kind === "intermediary" ? segment.resumeAtSec * 1000 : 0;

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
          resumeMs,
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
    resolvedMainResource,
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
      const position = getFunscriptPositionAtMs(timeline, timeMs);
      if (position === null) return;

      const now = Date.now();
      if (now - handyLastPushAtRef.current < HANDY_PUSH_INTERVAL_MS) return;
      if (
        Math.abs((handyLastPushPosRef.current ?? position) - position) < 0.25 &&
        now - handyLastPushAtRef.current < HANDY_KEEPALIVE_MS
      ) {
        return;
      }

      const playbackRate = video.playbackRate ?? 1;
      handyPushInFlightRef.current = true;

      void (async () => {
        try {


          if (!connectionKey.trim() || !appApiKey.trim()) return;

          const session = await ensureHandySession();
          if (!session) return;

          await sendHspSync(
            {
              connectionKey: connectionKey.trim(),
              appApiKey: appApiKey.trim(),
            },
            session,
            timeMs,
            playbackRate,
            `${activeVideoUri}:${segment.kind}`,
            actions,
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
          const message = error instanceof Error ? error.message : "Failed to stream sync position to TheHandy.";
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

    if (shouldUseHandySync && handySyncState !== "synced" && forceHandySyncMsRef.current === null) {
      setStatus("Waiting for TheHandy sync before playback...");
      const video = segment.kind === "main" ? mainVideoRef.current : intermediaryVideoRef.current;
      if (video && !video.paused) {
        allowPauseRef.current = true;
        video.pause();
      }
      return;
    }

    tryPlayVideo();
  }, [activeRound, activeVideoUri, handySyncState, isIntermediaryScreenActive, segment.kind, shouldUseHandySync, tryPlayVideo]);

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
      if (target && (target.isContentEditable || target.tagName === "INPUT" || target.tagName === "TEXTAREA")) return;
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
        endIntermediaryAndResume("Development: intermediary ended early.");
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

  const canUseRoundControls = Boolean(activeRound && activeRound.phaseKind === "normal" && roundControl);

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
    setStatus("Manual pause active (15s).");

    manualPauseTimerRef.current = window.setTimeout(() => {
      manualPauseTimerRef.current = null;
      setStatus("Manual pause ended.");
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

  if (!activeRound && !boardSequence) return null;

  if (!activeRound && boardSequence) {
    const hasLoadingMedia = loadingMedia.length > 0;
    const activeLoadingMediaIndex = hasLoadingMedia ? loadingMediaIndex % loadingMedia.length : -1;
    const activeLoadingMedia = hasLoadingMedia ? loadingMedia[activeLoadingMediaIndex] : null;
    return (
      <div className="fixed inset-0 z-50 bg-black">
        <div className="absolute inset-0">
          {activeLoadingMedia && (
            isVideoMedia(activeLoadingMedia.url) ? (
              <video
                key={activeLoadingMedia.id}
                className="h-full w-full object-cover opacity-70"
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
                className="h-full w-full object-cover opacity-70"
                src={activeLoadingMedia.url}
                alt="loading media"
                onError={() => setLoadingMediaIndex((prev) => prev + 1)}
              />
            )
          )}
        </div>
        <div className="absolute inset-0 bg-black/45" />
        <div className="relative z-10 flex h-full items-center justify-center p-6">
          <div className="rounded-2xl border border-fuchsia-300/45 bg-zinc-950/85 p-6 text-center text-fuchsia-100 shadow-2xl backdrop-blur">
            <div className="text-[11px] uppercase tracking-[0.28em] text-fuchsia-200/80">{loadingLabel || "Anti-perk sequence"}</div>
            <div className="mt-3 text-4xl font-black">{loadingCountdown ?? 0}</div>
            <div className="mt-3 text-sm text-zinc-100">{status}</div>
          </div>
        </div>
      </div>
    );
  }

  if (!resolvedMainResource) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4">
        <div className="max-w-lg rounded-xl border border-red-400/50 bg-[#120915] p-6 text-white">
          <p className="text-sm">No video resource found for this round.</p>
          <button
            className="mt-4 rounded-md bg-red-700 px-4 py-2 text-sm font-semibold"
            onClick={() => {
              playSelectSound();
              finishWithSummary();
            }}
            onMouseEnter={() => playHoverSound()}
            type="button"
          >
            Continue
          </button>
        </div>
      </div>
    );
  }

  const handyStatusLabel =
    !handyConnected
      ? "Disconnected"
      : handySyncState === "missing-key"
        ? "Missing API Key"
        : handySyncState === "synced"
          ? "Synced"
          : handySyncState === "error"
            ? "Sync Error"
            : "Syncing";

  const handyStatusTone =
    !handyConnected
      ? "border-zinc-300/25 bg-zinc-700/30 text-zinc-100"
      : handySyncState === "synced"
        ? "border-emerald-300/45 bg-emerald-500/20 text-emerald-100"
        : handySyncState === "error" || handySyncState === "missing-key"
          ? "border-amber-300/45 bg-amber-500/20 text-amber-100"
          : "border-cyan-300/45 bg-cyan-500/20 text-cyan-100";

  const canResyncHandy = shouldUseHandySync && !isIntermediaryScreenActive;
  const showRemoteLoadingIndicator =
    isRemoteVideoUri && isRemoteVideoLoading && !isIntermediaryScreenActive && !isWaitingForHandyStart;
  const hasLoadingMedia = loadingMedia.length > 0;
  const activeLoadingMediaIndex = hasLoadingMedia ? loadingMediaIndex % loadingMedia.length : -1;
  const activeLoadingMedia = hasLoadingMedia ? loadingMedia[activeLoadingMediaIndex] : null;
  const handleLoadingMediaError = () => {
    if (!activeLoadingMedia || activeLoadingMediaIndex < 0) return;
    const previewUrl = activeLoadingMedia.previewUrl ?? null;
    if (previewUrl && previewUrl !== activeLoadingMedia.url) {
      setLoadingMedia((prev) =>
        prev.map((item, index) => (index === activeLoadingMediaIndex ? { ...item, url: previewUrl } : item)),
      );
      return;
    }
    setLoadingMediaIndex((prev) => prev + 1);
  };

  return (
    <div
      className={`fixed inset-0 z-50 bg-black ${isUiVisible ? "" : "cursor-none"}`}
      onMouseMove={handleOverlayMouseMove}
    >
      <style>
        {`
          @keyframes loadingMediaFadeIn {
            0% { opacity: 0; transform: scale(1.035); filter: saturate(1.05); }
            100% { opacity: 0.78; transform: scale(1.0); filter: saturate(1.12); }
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
        `}
      </style>
      <div className="relative h-full w-full overflow-hidden bg-black">
        <div className="pointer-events-none absolute inset-x-0 top-0 z-20 h-24 bg-gradient-to-b from-black/70 via-black/25 to-transparent" />
        <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 h-36 bg-gradient-to-t from-black/75 via-black/30 to-transparent" />

        <div className={`pointer-events-auto absolute inset-x-0 top-0 z-30 flex items-center justify-between gap-3 px-4 py-3 text-xs tracking-wide text-fuchsia-100 transition-opacity duration-250 ${isUiVisible ? "opacity-100" : "opacity-0"}`}>
          <span>{resolvedRound?.name ?? activeRound?.roundName ?? "Round"}</span>
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
            >
              Resync (R)
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
                >
                  Pause {roundControl?.pauseCharges ?? 0}
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
                >
                  Skip {roundControl?.skipCharges ?? 0}
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
              >
                Options
              </button>
            )}
            {onRequestCum && (
              <button
                className="pointer-events-auto rounded-md border border-rose-300/70 bg-rose-500/25 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-rose-50 transition-colors hover:bg-rose-500/40"
                onClick={() => {
                  playSelectSound();
                  handleCumRequest();
                }}
                onMouseEnter={() => playHoverSound()}
                type="button"
              >
                Cum (C)
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
              >
                Close
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
                  Test Intermediary (I)
                </button>
                <button
                  className={`pointer-events-auto rounded-md border px-2 py-1 text-[10px] font-semibold uppercase tracking-wide transition-colors ${segment.kind === "intermediary"
                    ? "border-emerald-300/60 bg-emerald-500/20 text-emerald-100 hover:bg-emerald-500/35"
                    : "border-zinc-500/50 bg-zinc-700/20 text-zinc-300"
                    }`}
                  disabled={segment.kind !== "intermediary"}
                  onClick={() => {
                    playSelectSound();
                    endIntermediaryAndResume("Development: intermediary ended early.");
                  }}
                  onMouseEnter={() => playHoverSound()}
                  type="button"
                >
                  End Intermediary (J)
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
                  Dev Skip (K)
                </button>
              </>
            )}
          </div>
        </div>

        <div className="relative h-full w-full bg-[#060410]">
          {resolvedMainResource && (
            <video
              ref={mainVideoRef}
              className={`absolute inset-0 h-full w-full object-contain ${segment.kind === "main" && !isIntermediaryScreenActive ? "opacity-100" : "pointer-events-none"}`}
              style={{ visibility: segment.kind === "main" && !isIntermediaryScreenActive ? "visible" : "hidden" }}
              controls={false}
              disablePictureInPicture
              playsInline
              preload="auto"
              tabIndex={-1}
              src={resolvedMainVideoSrc}
              onContextMenu={(event) => event.preventDefault()}
              onError={() => {
                void handleVideoError(resolvedMainResource.videoUri);
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
                if (isRemoteVideoUri) setIsRemoteVideoLoading(false);
                const video = mainVideoRef.current;
                if (video) {
                  const { startSec } = resolveMainWindowForDuration(video.duration);
                  if (needsMainWindowSeekRef.current || video.currentTime < startSec - MAIN_WINDOW_SEEK_EPSILON_SEC) {
                    if (Math.abs(video.currentTime - startSec) > MAIN_WINDOW_SEEK_EPSILON_SEC) {
                      video.currentTime = startSec;
                    }
                    needsMainWindowSeekRef.current = false;
                  }
                }
                tryPlayVideo();
              }}
              onLoadedMetadata={() => {
                if (segment.kind !== "main") return;
                void ensurePlayableVideo(resolvedMainResource.videoUri);
                const video = mainVideoRef.current;
                if (video) {
                  const { startSec } = resolveMainWindowForDuration(video.duration);
                  if (needsMainWindowSeekRef.current || video.currentTime < startSec - MAIN_WINDOW_SEEK_EPSILON_SEC) {
                    if (Math.abs(video.currentTime - startSec) > MAIN_WINDOW_SEEK_EPSILON_SEC) {
                      video.currentTime = startSec;
                    }
                    needsMainWindowSeekRef.current = false;
                  }
                }
                tryPlayVideo();
              }}
              onSeeked={() => {
                if (segment.kind !== "main") return;
                tryPlayVideo();
              }}
              onPlaying={() => {
                if (segment.kind !== "main") return;
                if (isRemoteVideoUri) setIsRemoteVideoLoading(false);
              }}
              onLoadedData={() => {
                if (segment.kind !== "main") return;
                if (isRemoteVideoUri) setIsRemoteVideoLoading(false);
              }}
              onPause={() => {
                if (segment.kind !== "main") return;
                if (allowPauseRef.current) {
                  allowPauseRef.current = false;
                  return;
                }
                if (isIntermediaryScreenActive) {
                  setStatus("Playback paused for transition...");
                  return;
                }
                tryPlayVideo();
              }}
              onEnded={() => {
                if (segment.kind !== "main") return;
                finishWithSummary();
              }}
            >
              <track kind="captions" label="Gameplay captions" />
            </video>
          )}

          {segment.kind === "intermediary" && (
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
                void handleVideoError(segment.trigger.resource.videoUri);
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
                if (isRemoteVideoUri) setIsRemoteVideoLoading(false);
                tryPlayVideo();
              }}
              onLoadedMetadata={() => {
                void ensurePlayableVideo(segment.trigger.resource.videoUri);
                tryPlayVideo();
              }}
              onSeeked={() => {
                tryPlayVideo();
              }}
              onPlaying={() => {
                if (isRemoteVideoUri) setIsRemoteVideoLoading(false);
              }}
              onLoadedData={() => {
                if (isRemoteVideoUri) setIsRemoteVideoLoading(false);
              }}
              onPause={() => {
                if (allowPauseRef.current) {
                  allowPauseRef.current = false;
                  return;
                }
                if (isIntermediaryScreenActive) {
                  setStatus("Playback paused for transition...");
                  return;
                }
                tryPlayVideo();
              }}
              onEnded={() => {
                endIntermediaryAndResume();
              }}
            >
              <track kind="captions" label="Gameplay captions" />
            </video>
          )}

          {showRemoteLoadingIndicator && (
            <div className="pointer-events-none absolute inset-0 z-[45] flex items-center justify-center">
              <div className="rounded-full border border-white/25 bg-black/55 p-3 backdrop-blur-sm">
                <div className="h-10 w-10 animate-spin rounded-full border-4 border-white/20 border-t-cyan-200" />
              </div>
            </div>
          )}

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
                  TheHandy Linkup
                </p>
                <h3 className="mt-2 text-3xl font-black tracking-tight text-transparent bg-clip-text bg-gradient-to-r from-cyan-100 via-sky-100 to-indigo-100 sm:text-4xl">
                  Waiting For Device Sync
                </h3>
                <p className="mx-auto mt-2 max-w-lg text-sm text-cyan-100/90">
                  {handyWaitHint}
                </p>
              </div>
            </div>
          )}

          {loadingCountdown !== null && (
            <div className="pointer-events-none absolute inset-0 z-[60] overflow-hidden">
              {/* Opaque base so the main video is never visible behind this overlay */}
              <div className="absolute inset-0 bg-[#060410]" />
              <div
                className="absolute inset-0"
                style={{ animation: "intermediaryMeshPulse 6s ease-in-out infinite" }}
              />
              <div
                className="absolute -left-[30%] -top-[20%] h-[70%] w-[70%] rounded-full opacity-30 blur-[120px]"
                style={{
                  background: "radial-gradient(circle, rgba(236,72,153,0.55), transparent 70%)",
                  animation: "intermediaryOrb1 8s ease-in-out infinite",
                }}
              />
              <div
                className="absolute -bottom-[15%] -right-[25%] h-[60%] w-[60%] rounded-full opacity-25 blur-[100px]"
                style={{
                  background: "radial-gradient(circle, rgba(56,189,248,0.5), transparent 70%)",
                  animation: "intermediaryOrb2 10s ease-in-out infinite",
                }}
              />
              <div
                className="absolute left-[40%] top-[60%] h-[40%] w-[40%] rounded-full opacity-20 blur-[90px]"
                style={{
                  background: "radial-gradient(circle, rgba(168,85,247,0.5), transparent 70%)",
                  animation: "intermediaryOrb3 7s ease-in-out infinite",
                }}
              />
              <div className="absolute inset-0 bg-[radial-gradient(circle_at_22%_18%,rgba(236,72,153,0.28),transparent_48%),radial-gradient(circle_at_80%_24%,rgba(56,189,248,0.25),transparent_44%),linear-gradient(120deg,rgba(8,4,20,0.94),rgba(20,8,34,0.88))]" />
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
                      style={{ animation: `loadingMediaFadeIn ${LOADING_MEDIA_FADE_MS}ms ease forwards` }}
                    >
                      <track kind="captions" label="Loading captions" />
                    </video>
                  ) : (
                    <img
                      alt="loading media"
                      className="absolute inset-0 h-full w-full object-contain"
                      onError={handleLoadingMediaError}
                      src={activeLoadingMedia.url}
                      style={{ animation: `loadingMediaFadeIn ${LOADING_MEDIA_FADE_MS}ms ease forwards` }}
                    />
                  )}
                </>
              )}
              <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(190,24,93,0.18),rgba(8,5,18,0.72))]" />
              <div className="absolute left-1/2 top-1/2 flex w-full max-w-xl -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-4 px-5 text-center">
                <div className="rounded-2xl border border-fuchsia-200/65 bg-[#12071f]/88 px-6 py-3 text-xs font-semibold uppercase tracking-[0.24em] text-fuchsia-100 shadow-[0_0_34px_rgba(217,70,239,0.65)]">
                  {loadingLabel}
                </div>
                <div className="text-7xl font-black text-white drop-shadow-[0_0_24px_rgba(255,255,255,0.7)]">
                  {loadingCountdown}
                </div>
                <div className="rounded-xl border border-fuchsia-200/45 bg-[#0d0618]/85 px-4 py-2 text-xs tracking-wide text-fuchsia-100">
                  Prompt: {booruSearchPrompt}
                </div>
                {activeLoadingMedia && (
                  <div className="text-[11px] uppercase tracking-[0.22em] text-fuchsia-200/80">
                    Source: {activeLoadingMedia.source}
                  </div>
                )}
              </div>
            </div>
          )}

          {pendingCumRoundSummary && (
            <div className="absolute inset-0 z-[90] flex items-center justify-center bg-black/80 px-4">
              <div className="w-full max-w-xl rounded-2xl border border-cyan-300/45 bg-[linear-gradient(145deg,rgba(6,15,38,0.96),rgba(17,8,36,0.96))] p-6 text-zinc-100 shadow-[0_0_55px_rgba(56,189,248,0.25)] backdrop-blur-xl">
                <p className="font-[family-name:var(--font-jetbrains-mono)] text-[11px] uppercase tracking-[0.28em] text-cyan-200/85">
                  Cum Round Check
                </p>
                <h3 className="mt-2 text-2xl font-black tracking-tight text-transparent bg-clip-text bg-gradient-to-r from-cyan-100 via-sky-100 to-fuchsia-100">
                  Confirm Your Outcome
                </h3>
                <p className="mt-2 text-sm text-zinc-200/90">
                  Select what happened in this cum round.
                </p>
                <div className="mt-5 grid gap-2">
                  <button
                    type="button"
                    className="rounded-lg border border-emerald-300/60 bg-emerald-500/20 px-4 py-3 text-left text-sm font-semibold text-emerald-100 hover:bg-emerald-500/35"
                    onClick={() => resolveCumRoundOutcome("came_as_told")}
                  >
                    Came as told
                  </button>
                  <button
                    type="button"
                    className="rounded-lg border border-cyan-300/60 bg-cyan-500/20 px-4 py-3 text-left text-sm font-semibold text-cyan-100 hover:bg-cyan-500/35"
                    onClick={() => resolveCumRoundOutcome("did_not_cum")}
                  >
                    Did not cum
                  </button>
                  <button
                    type="button"
                    className="rounded-lg border border-rose-300/65 bg-rose-500/20 px-4 py-3 text-left text-sm font-semibold text-rose-100 hover:bg-rose-500/35"
                    onClick={() => resolveCumRoundOutcome("failed_instruction")}
                  >
                    Failed instruction
                  </button>
                </div>
              </div>
            </div>
          )}

          <div className={`pointer-events-none absolute bottom-3 right-3 z-40 rounded-full border px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] backdrop-blur transition-opacity duration-250 ${handyStatusTone} ${isUiVisible ? "opacity-100" : "opacity-0"}`}>
            TheHandy {handyStatusLabel}
          </div>
          {handySyncError && (
            <div className={`pointer-events-none absolute bottom-12 right-3 z-40 max-w-xs rounded-lg border border-amber-300/40 bg-black/65 px-3 py-2 text-[11px] text-amber-100 backdrop-blur transition-opacity duration-250 ${isUiVisible ? "opacity-100" : "opacity-0"}`}>
              {handySyncError}
            </div>
          )}

          <div className={`pointer-events-none absolute bottom-3 left-3 z-30 rounded-md border border-fuchsia-200/25 bg-black/45 px-3 py-2 text-xs text-fuchsia-100 backdrop-blur transition-opacity duration-250 ${isUiVisible ? "opacity-100" : "opacity-0"}`}>
            <div>Segment: {segment.kind === "main" ? "Main" : "Intermediary"}</div>
            <div>Playback: {playbackRateLabel}x</div>
            <div>Funscript actions: {funscriptCount}</div>
            <div>Current script position: {funscriptPosition ?? "-"}</div>
            <div>Intermediary queue: {fullIntermediaryQueue.length}</div>
          </div>
        </div>
      </div>
    </div>
  );
}
