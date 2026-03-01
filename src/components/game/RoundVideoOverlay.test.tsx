import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ActiveRound, PlayerState } from "../../game/types";
import type { InstalledRound } from "../../services/db";
import { extractBeatbarMotionEvents, getAntiPerkSequenceDefinition } from "./antiPerkSequences";
import * as handyRuntime from "../../services/thehandy/runtime";
import * as booru from "../../services/booru";

const mocks = vi.hoisted(() => ({
  openGlobalHandyOverlay: vi.fn(),
  handy: {
    connectionKey: "",
    appApiKey: "",
    offsetMs: 0,
    connected: false,
    manuallyStopped: false,
    setSyncStatus: vi.fn(),
    toggleManualStop: vi.fn(async () => "unavailable" as const),
  },
  playback: {
    getFunscriptPositionAtMs: vi.fn<
      (
        timeline: { actions: Array<{ at: number; pos: number }> } | null,
        timeMs: number
      ) => number | null
    >(() => null),
    loadFunscriptTimeline: vi.fn<
      (funscriptUri: string) => Promise<{ actions: Array<{ at: number; pos: number }> } | null>
    >(async () => null),
  },
  isGameDevelopmentMode: vi.fn(() => false),
  playAntiPerkBeatSound: vi.fn(),
  sfwMode: false,
}));

vi.mock("../../services/booru", () => ({
  getCachedBooruMedia: vi.fn(async () => []),
  getCachedBooruMediaForDisplay: vi.fn(async () => []),
  refreshBooruMediaCache: vi.fn(async () => []),
  isVideoMedia: vi.fn(() => false),
}));

vi.mock("../../hooks/useForegroundVideoRegistration", () => ({
  useForegroundVideoRegistration: () => ({
    markPlaying: vi.fn(),
    handlePause: vi.fn(),
    handleEnded: vi.fn(),
  }),
}));

vi.mock("../../hooks/usePlayableVideoFallback", () => ({
  isLocalVideoUriForFallback: () => true,
  usePlayableVideoFallback: () => ({
    getVideoSrc: (uri: string) => uri,
    ensurePlayableVideo: vi.fn(async (uri: string) => uri),
    handleVideoError: vi.fn(),
  }),
}));

vi.mock("../../contexts/HandyContext", () => ({
  useHandy: () => mocks.handy,
}));

vi.mock("../globalHandyOverlayControls", () => ({
  openGlobalHandyOverlay: mocks.openGlobalHandyOverlay,
}));

vi.mock("../../services/thehandy/runtime", () => ({
  issueHandySession: vi.fn(),
  pauseHandyPlayback: vi.fn(),
  preloadHspScript: vi.fn(),
  sendHspSync: vi.fn(),
  stopHandyPlayback: vi.fn(),
}));

vi.mock("../../game/media/playback", () => ({
  buildIntermediaryQueue: vi.fn(() => []),
  computePlaybackRate: vi.fn(() => 1),
  getActivePlaybackModifiers: vi.fn(() => []),
  getFunscriptPositionAtMs: mocks.playback.getFunscriptPositionAtMs,
  loadFunscriptTimeline: mocks.playback.loadFunscriptTimeline,
}));

vi.mock("../../utils/audio", async () => {
  const actual = await vi.importActual<typeof import("../../utils/audio")>("../../utils/audio");
  return {
    ...actual,
    playAntiPerkBeatSound: mocks.playAntiPerkBeatSound,
    playDiceResultSound: vi.fn(),
    playHoverSound: vi.fn(),
    playPerkActionSound: vi.fn(),
    playRoundStartSound: vi.fn(),
    playSelectSound: vi.fn(),
  };
});

vi.mock("../../utils/devFeatures", () => ({
  isGameDevelopmentMode: mocks.isGameDevelopmentMode,
}));

vi.mock("../../hooks/useSfwMode", () => ({
  useSfwMode: () => mocks.sfwMode,
}));

vi.mock("../../hooks/useGameplayMoaning", () => ({
  useGameplayMoaning: () => ({
    enabled: true,
    queue: [{ id: "m1", filePath: "/moan.mp3", name: "moan.mp3" }],
    volume: 0.3,
    isAvailableForGameplay: true,
    setEnabled: vi.fn(async () => {}),
    setVolume: vi.fn(async () => {}),
    addTracks: vi.fn(async () => {}),
    addTrackFromUrl: vi.fn(async () => {}),
    addPlaylistFromUrl: vi.fn(async () => ({ addedCount: 0, errorCount: 0 })),
    removeTrack: vi.fn(async () => {}),
    moveTrack: vi.fn(async () => {}),
    clearQueue: vi.fn(async () => {}),
    previewTrack: vi.fn(async () => {}),
    stopPreview: vi.fn(),
    playRandomOneShot: vi.fn(async () => {}),
    startContinuousLoop: vi.fn(async () => {}),
    stopContinuousLoop: vi.fn(),
  }),
}));

import { RoundVideoOverlay } from "./RoundVideoOverlay";

function createInstalledRound(
  roundId = "round-1",
  funscriptUri: string | null = null,
  overrides?: Partial<InstalledRound> & {
    videoUri?: string;
    durationMs?: number;
  }
): InstalledRound {
  const defaultResource = {
    videoUri: overrides?.videoUri ?? "/video.mp4",
    funscriptUri,
    durationMs: overrides?.durationMs,
  };
  return {
    id: roundId,
    name: overrides?.name ?? "Round 1",
    type: overrides?.type ?? "Main",
    startTime: overrides?.startTime ?? 0,
    endTime: overrides?.endTime ?? 30_000,
    previewImage: null,
    resources: overrides?.resources ?? [defaultResource],
  } as unknown as InstalledRound;
}

function createIntermediaryRound(
  roundId = "intermediary-1",
  funscriptUri: string | null = null,
  overrides?: Partial<InstalledRound> & {
    videoUri?: string;
    durationMs?: number;
  }
): InstalledRound {
  return createInstalledRound(roundId, funscriptUri, {
    type: "Interjection",
    videoUri: "/intermediary.mp4",
    startTime: 7_000,
    endTime: 12_000,
    ...overrides,
  });
}

function createActiveRound(roundId = "round-1"): ActiveRound {
  return {
    fieldId: "field-1",
    nodeId: "node-1",
    roundId,
    roundName: "Round 1",
    selectionKind: "fixed",
    poolId: null,
    phaseKind: "normal",
    campaignIndex: 0,
  };
}

function createHandySession(): handyRuntime.HandySession {
  return {
    mode: "appId",
    clientToken: null,
    expiresAtMs: Date.now() + 60_000,
    serverTimeOffsetMs: 0,
    serverTimeOffsetMeasuredAtMs: 0,
    loadedScriptId: null,
    activeScriptId: null,
    lastSyncAtMs: 0,
    lastPlaybackRate: 1,
    maxBufferPoints: 4000,
    streamedPoints: null,
    nextStreamPointIndex: 0,
    tailPointStreamIndex: 0,
    uploadedUntilMs: 0,
    hspModeActive: false,
  };
}

function primeVideoElement(
  video: HTMLVideoElement,
  options?: {
    duration?: number;
    currentTime?: number;
    currentTimeRef?: { value: number };
    onSetCurrentTime?: (value: number) => void;
  }
) {
  const currentTimeRef = options?.currentTimeRef ?? { value: options?.currentTime ?? 0 };
  Object.defineProperty(video, "readyState", {
    configurable: true,
    get: () => HTMLMediaElement.HAVE_METADATA,
  });
  Object.defineProperty(video, "duration", {
    configurable: true,
    get: () => options?.duration ?? 30,
  });
  Object.defineProperty(video, "currentTime", {
    configurable: true,
    get: () => currentTimeRef.value,
    set: (value: number) => {
      currentTimeRef.value = value;
      options?.onSetCurrentTime?.(value);
    },
  });
  return currentTimeRef;
}

function disableAnimationFrameLoop() {
  vi.stubGlobal("requestAnimationFrame", vi.fn(() => 0));
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
}

function renderOverlay({
  activeRound = createActiveRound(),
  installedRounds = [createInstalledRound(activeRound?.roundId ?? "round-1")],
  currentPlayer,
  boardSequence = null,
  idleBoardSequence = null,
  allowDebugRoundControls = false,
  initialShowAntiPerkBeatbar = true,
  onCompleteBoardSequence,
  intermediaryLoadingDurationSec = 10,
  intermediaryReturnPauseSec = 4,
  onFinishRound = vi.fn(),
}: {
  activeRound?: ActiveRound | null;
  installedRounds?: InstalledRound[];
  currentPlayer?: PlayerState | undefined;
  boardSequence?: "milker" | "jackhammer" | null;
  idleBoardSequence?: "no-rest" | null;
  allowDebugRoundControls?: boolean;
  initialShowAntiPerkBeatbar?: boolean;
  onCompleteBoardSequence?: ((perkId: "milker" | "jackhammer") => void) | undefined;
  intermediaryLoadingDurationSec?: number;
  intermediaryReturnPauseSec?: number;
  onFinishRound?: ReturnType<typeof vi.fn>;
} = {}) {
  return render(
    <RoundVideoOverlay
      activeRound={activeRound}
      installedRounds={installedRounds}
      currentPlayer={currentPlayer}
      intermediaryProbability={0}
      booruSearchPrompt="animated gif webm"
      intermediaryLoadingDurationSec={intermediaryLoadingDurationSec}
      intermediaryReturnPauseSec={intermediaryReturnPauseSec}
      onFinishRound={onFinishRound}
      boardSequence={boardSequence}
      idleBoardSequence={idleBoardSequence}
      onCompleteBoardSequence={onCompleteBoardSequence}
      allowDebugRoundControls={allowDebugRoundControls}
      initialShowAntiPerkBeatbar={initialShowAntiPerkBeatbar}
    />
  );
}

describe("RoundVideoOverlay", () => {
  beforeEach(() => {
    mocks.isGameDevelopmentMode.mockReturnValue(false);
    mocks.openGlobalHandyOverlay.mockClear();
    mocks.playAntiPerkBeatSound.mockClear();
    mocks.handy.connectionKey = "";
    mocks.handy.appApiKey = "";
    mocks.handy.offsetMs = 0;
    mocks.handy.connected = false;
    mocks.handy.manuallyStopped = false;
    mocks.handy.setSyncStatus.mockClear();
    mocks.playback.getFunscriptPositionAtMs.mockReset();
    mocks.playback.getFunscriptPositionAtMs.mockReturnValue(null);
    mocks.playback.loadFunscriptTimeline.mockReset();
    mocks.playback.loadFunscriptTimeline.mockResolvedValue(null);
    mocks.sfwMode = false;
    vi.mocked(booru.getCachedBooruMedia).mockClear();
    vi.mocked(booru.getCachedBooruMediaForDisplay).mockClear();
    vi.mocked(booru.refreshBooruMediaCache).mockClear();
    vi.mocked(handyRuntime.issueHandySession).mockClear();
    vi.mocked(handyRuntime.pauseHandyPlayback).mockClear();
    vi.mocked(handyRuntime.preloadHspScript).mockClear();
    vi.mocked(handyRuntime.sendHspSync).mockClear();
    vi.mocked(handyRuntime.stopHandyPlayback).mockClear();
    vi.spyOn(HTMLMediaElement.prototype, "play").mockImplementation(async () => undefined);
    vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => undefined);
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) =>
      window.setTimeout(() => callback(performance.now()), 16)
    );
    vi.stubGlobal("cancelAnimationFrame", (id: number) => window.clearTimeout(id));
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("shows a compact lower-left playback timer during normal playback", async () => {
    renderOverlay();

    expect((await screen.findByTestId("round-playback-timer")).textContent).toContain(
      "0:00 / 0:00"
    );
    expect(screen.queryByText("Segment: Main")).toBeNull();
  });

  it("does not warn when play is aborted during a source transition", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.spyOn(HTMLMediaElement.prototype, "play").mockRejectedValueOnce(
      new DOMException("The play() request was interrupted by a new load request.", "AbortError")
    );

    renderOverlay();

    await waitFor(() => {
      expect(warnSpy).not.toHaveBeenCalledWith("Video autoplay failed", expect.anything());
    });
  });

  it("prefers persisted booru cache for display reads", async () => {
    vi.mocked(booru.getCachedBooruMediaForDisplay).mockResolvedValueOnce([
      {
        id: "cached-1",
        source: "rule34",
        url: "https://cdn.example.com/cached-1.gif",
        previewUrl: "https://cdn.example.com/cached-1.jpg",
      },
    ]);

    renderOverlay({ activeRound: null, boardSequence: "milker" });

    await waitFor(() => {
      expect(vi.mocked(booru.getCachedBooruMediaForDisplay)).toHaveBeenCalledWith(
        "animated gif webm",
        18
      );
    });
    await waitFor(() => {
      expect(vi.mocked(booru.refreshBooruMediaCache)).toHaveBeenCalledWith("animated gif webm", 18);
    });
  });

  it("does not re-read persisted booru cache on rerender with the same prompt", async () => {
    vi.mocked(booru.getCachedBooruMediaForDisplay).mockResolvedValue([
      {
        id: "cached-1",
        source: "rule34",
        url: "https://cdn.example.com/cached-1.gif",
        previewUrl: "https://cdn.example.com/cached-1.jpg",
      },
    ]);

    const view = renderOverlay({ activeRound: null, boardSequence: "milker" });
    await waitFor(() => {
      expect(vi.mocked(booru.getCachedBooruMediaForDisplay)).toHaveBeenCalledTimes(1);
    });

    view.rerender(
      <RoundVideoOverlay
        activeRound={null}
        installedRounds={[createInstalledRound()]}
        currentPlayer={undefined}
        intermediaryProbability={0}
        boardSequence="milker"
        booruSearchPrompt="animated gif webm"
        intermediaryLoadingDurationSec={10}
        intermediaryReturnPauseSec={4}
        onFinishRound={vi.fn()}
      />
    );

    expect(vi.mocked(booru.getCachedBooruMediaForDisplay)).toHaveBeenCalledTimes(1);
  });

  it("can transition from no active round to an active round without changing hook order", async () => {
    const view = renderOverlay({ activeRound: null });

    expect(screen.queryByTestId("round-playback-timer")).toBeNull();

    view.rerender(
      <RoundVideoOverlay
        activeRound={createActiveRound()}
        installedRounds={[createInstalledRound()]}
        currentPlayer={undefined}
        intermediaryProbability={0}
        booruSearchPrompt="animated gif webm"
        intermediaryLoadingDurationSec={10}
        intermediaryReturnPauseSec={4}
        onFinishRound={vi.fn()}
      />
    );

    expect((await screen.findByTestId("round-playback-timer")).textContent).toContain(
      "0:00 / 0:00"
    );
  });

  it("reveals blocked round video only after confirmation and resets for the next round", async () => {
    mocks.sfwMode = true;

    const view = renderOverlay({
      activeRound: createActiveRound("round-1"),
      installedRounds: [createInstalledRound("round-1")],
    });

    expect(screen.getByText("Safe Mode Enabled")).not.toBeNull();
    expect(screen.getByRole("button", { name: "Show Video Once" })).not.toBeNull();
    expect(view.container.querySelector('video[src="/video.mp4"]')).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Show Video Once" }));
    expect(screen.getByRole("dialog")).not.toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Show Once" }));

    await waitFor(() => {
      expect(view.container.querySelector('video[src="/video.mp4"]')).not.toBeNull();
    });

    view.rerender(
      <RoundVideoOverlay
        activeRound={createActiveRound("round-2")}
        installedRounds={[createInstalledRound("round-2")]}
        currentPlayer={undefined}
        intermediaryProbability={0}
        booruSearchPrompt="animated gif webm"
        intermediaryLoadingDurationSec={10}
        intermediaryReturnPauseSec={4}
        onFinishRound={vi.fn()}
      />
    );

    expect(screen.getByText("Safe Mode Enabled")).not.toBeNull();
    expect(view.container.querySelector('video[src="/video.mp4"]')).toBeNull();
  });

  it("shows proceed and close actions in the cum round dialog", async () => {
    const onFinishRound = vi.fn();
    const onClose = vi.fn();
    const view = render(
      <RoundVideoOverlay
        activeRound={{ ...createActiveRound(), phaseKind: "cum" }}
        installedRounds={[createInstalledRound()]}
        currentPlayer={undefined}
        intermediaryProbability={0}
        booruSearchPrompt="animated gif webm"
        intermediaryLoadingDurationSec={10}
        intermediaryReturnPauseSec={4}
        onFinishRound={onFinishRound}
        onClose={onClose}
        cumRequestSignal={0}
        showCumRoundOutcomeMenuOnCumRequest
      />
    );

    view.rerender(
      <RoundVideoOverlay
        activeRound={{ ...createActiveRound(), phaseKind: "cum" }}
        installedRounds={[createInstalledRound()]}
        currentPlayer={undefined}
        intermediaryProbability={0}
        booruSearchPrompt="animated gif webm"
        intermediaryLoadingDurationSec={10}
        intermediaryReturnPauseSec={4}
        onFinishRound={onFinishRound}
        onClose={onClose}
        cumRequestSignal={1}
        showCumRoundOutcomeMenuOnCumRequest
      />
    );

    const proceedButton = await screen.findByRole("button", { name: "Proceed round" });
    const closeButton = screen.getByRole("button", { name: "Close" });

    expect(proceedButton).not.toBeNull();
    expect(closeButton).not.toBeNull();

    proceedButton.click();

    await waitFor(() => {
      expect(onFinishRound).toHaveBeenCalledWith({
        intermediaryCount: 0,
        activeAntiPerkCount: 0,
      });
    });

    cleanup();

    const secondView = render(
      <RoundVideoOverlay
        activeRound={{ ...createActiveRound(), phaseKind: "cum" }}
        installedRounds={[createInstalledRound()]}
        currentPlayer={undefined}
        intermediaryProbability={0}
        booruSearchPrompt="animated gif webm"
        intermediaryLoadingDurationSec={10}
        intermediaryReturnPauseSec={4}
        onFinishRound={vi.fn()}
        onClose={onClose}
        cumRequestSignal={0}
        showCumRoundOutcomeMenuOnCumRequest
      />
    );

    secondView.rerender(
      <RoundVideoOverlay
        activeRound={{ ...createActiveRound(), phaseKind: "cum" }}
        installedRounds={[createInstalledRound()]}
        currentPlayer={undefined}
        intermediaryProbability={0}
        booruSearchPrompt="animated gif webm"
        intermediaryLoadingDurationSec={10}
        intermediaryReturnPauseSec={4}
        onFinishRound={vi.fn()}
        onClose={onClose}
        cumRequestSignal={1}
        showCumRoundOutcomeMenuOnCumRequest
      />
    );

    (await screen.findByRole("button", { name: "Close" })).click();

    await waitFor(() => {
      expect(onClose).toHaveBeenCalled();
    });
  });

  it("allows gameplay video audio to play through the round player", async () => {
    const { container } = renderOverlay();

    const mainVideo = container.querySelector("video");
    expect(mainVideo).not.toBeNull();
    expect(mainVideo?.muted).toBe(false);
    expect(mainVideo?.defaultMuted).toBe(false);
    expect(mainVideo?.volume).toBe(1);
  });

  it("hides gameplay-only controls during preview playback while keeping the close action", async () => {
    render(
      <RoundVideoOverlay
        activeRound={createActiveRound()}
        installedRounds={[createInstalledRound()]}
        currentPlayer={undefined}
        intermediaryProbability={0}
        booruSearchPrompt="animated gif webm"
        intermediaryLoadingDurationSec={10}
        intermediaryReturnPauseSec={4}
        onFinishRound={vi.fn()}
        showCloseButton
        onClose={vi.fn()}
      />
    );

    expect(screen.getByRole("button", { name: "Close" })).not.toBeNull();
    expect(screen.queryByRole("button", { name: /Pause/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /Skip/i })).toBeNull();
    expect(screen.queryByRole("button", { name: "Options" })).toBeNull();
    expect(screen.queryByRole("button", { name: /Cum/i })).toBeNull();
  });

  it("shows a close button when local main media fails to load", async () => {
    const { container } = renderOverlay();
    const video = container.querySelector("video");
    expect(video).not.toBeNull();

    fireEvent.error(video as HTMLVideoElement);

    expect(await screen.findByText("Local media file not found")).not.toBeNull();
    expect(screen.getByRole("button", { name: /Close/ })).not.toBeNull();
  });

  it("auto-finishes gameplay when main media is missing for 10 seconds", async () => {
    vi.useFakeTimers();
    disableAnimationFrameLoop();
    const onFinishRound = vi.fn();
    const { container } = renderOverlay({ onFinishRound });
    const video = container.querySelector("video");
    expect(video).not.toBeNull();

    fireEvent.error(video as HTMLVideoElement);
    expect(screen.getByRole("button", { name: /Close/ })).not.toBeNull();
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    act(() => {
      vi.advanceTimersByTime(9_999);
    });
    expect(onFinishRound).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(1);
    });
    await Promise.resolve();

    expect(onFinishRound).toHaveBeenCalledTimes(1);
  });

  it("manual close cancels main media auto-finish", async () => {
    vi.useFakeTimers();
    disableAnimationFrameLoop();
    const onFinishRound = vi.fn();
    const { container } = renderOverlay({ onFinishRound });
    const video = container.querySelector("video");
    expect(video).not.toBeNull();

    fireEvent.error(video as HTMLVideoElement);
    fireEvent.click(screen.getByRole("button", { name: /Close/ }));

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(onFinishRound).toHaveBeenCalledTimes(1);

    act(() => {
      vi.advanceTimersByTime(10_500);
    });
    expect(onFinishRound).toHaveBeenCalledTimes(1);
  });

  it("auto-closes preview missing media through onClose", async () => {
    vi.useFakeTimers();
    disableAnimationFrameLoop();
    const onClose = vi.fn();
    const onFinishRound = vi.fn();
    const { container } = render(
      <RoundVideoOverlay
        activeRound={createActiveRound()}
        installedRounds={[createInstalledRound()]}
        currentPlayer={undefined}
        intermediaryProbability={0}
        booruSearchPrompt="animated gif webm"
        intermediaryLoadingDurationSec={10}
        intermediaryReturnPauseSec={4}
        onFinishRound={onFinishRound}
        showCloseButton
        onClose={onClose}
      />
    );
    const video = container.querySelector("video");
    expect(video).not.toBeNull();

    fireEvent.error(video as HTMLVideoElement);
    act(() => {
      vi.advanceTimersByTime(10_000);
    });
    await Promise.resolve();
    await Promise.resolve();

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onFinishRound).not.toHaveBeenCalled();
  });

  it("manual close on missing interjection returns to the main video once", async () => {
    vi.useFakeTimers();
    disableAnimationFrameLoop();
    const onFinishRound = vi.fn();
    const { container } = renderOverlay({
      installedRounds: [createInstalledRound(), createIntermediaryRound()],
      allowDebugRoundControls: true,
      intermediaryLoadingDurationSec: 0,
      intermediaryReturnPauseSec: 0,
      onFinishRound,
    });
    const mainVideo = container.querySelector('video[src="/video.mp4"]');
    expect(mainVideo).not.toBeNull();
    primeVideoElement(mainVideo as HTMLVideoElement, { duration: 30, currentTime: 5 });

    fireEvent.click(screen.getByRole("button", { name: "Test Intermediary (I)" }));

    await act(async () => {
      await Promise.resolve();
    });
    const intermediaryVideo = container.querySelector('video[src="/intermediary.mp4"]');
    expect(intermediaryVideo).not.toBeNull();

    fireEvent.error(intermediaryVideo as HTMLVideoElement);
    fireEvent.click(screen.getByRole("button", { name: /Close/ }));

    await act(async () => {
      await Promise.resolve();
    });
    expect(container.querySelector('video[src="/intermediary.mp4"]')).toBeNull();
    act(() => {
      vi.advanceTimersByTime(10_500);
    });
    expect(container.querySelector('video[src="/video.mp4"]')).not.toBeNull();
    expect(onFinishRound).not.toHaveBeenCalled();
  });

  it("opens the global TheHandy menu from the round overlay controls", async () => {
    mocks.handy.connected = true;

    renderOverlay();

    fireEvent.click(await screen.findByRole("button", { name: "Handy Menu" }));

    expect(mocks.openGlobalHandyOverlay).toHaveBeenCalledTimes(1);
  });

  it("bootstraps TheHandy sync immediately once video metadata and timeline are ready", async () => {
    mocks.handy.connectionKey = "conn-key";
    mocks.handy.appApiKey = "app-key";
    mocks.handy.connected = true;
    mocks.playback.loadFunscriptTimeline.mockResolvedValue({
      actions: [{ at: 0, pos: 10 }],
    });
    mocks.playback.getFunscriptPositionAtMs.mockReturnValue(10);
    vi.mocked(handyRuntime.issueHandySession).mockResolvedValue(createHandySession());

    const playSpy = vi.spyOn(HTMLMediaElement.prototype, "play");
    const { container } = renderOverlay({
      installedRounds: [createInstalledRound("round-1", "/script.funscript")],
    });

    const video = await waitFor(() => {
      const candidate = container.querySelector("video");
      expect(candidate).not.toBeNull();
      return candidate as HTMLVideoElement;
    });
    primeVideoElement(video, { duration: 30, currentTime: 0 });

    fireEvent.loadedMetadata(video);

    await waitFor(() => {
      expect(vi.mocked(handyRuntime.preloadHspScript)).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        "/video.mp4:main",
        [{ at: 0, pos: 10 }],
        0
      );
      expect(vi.mocked(handyRuntime.sendHspSync)).toHaveBeenCalled();
      expect(mocks.handy.setSyncStatus).toHaveBeenCalledWith({ synced: true, error: null });
      expect(playSpy).toHaveBeenCalled();
    });
  });

  it("applies the persisted TheHandy offset during bootstrap sync", async () => {
    mocks.handy.connectionKey = "conn-key";
    mocks.handy.appApiKey = "app-key";
    mocks.handy.connected = true;
    mocks.handy.offsetMs = 125;
    mocks.playback.loadFunscriptTimeline.mockResolvedValue({
      actions: [{ at: 0, pos: 10 }],
    });
    mocks.playback.getFunscriptPositionAtMs.mockReturnValue(10);
    vi.mocked(handyRuntime.issueHandySession).mockResolvedValue(createHandySession());

    const { container } = renderOverlay({
      installedRounds: [createInstalledRound("round-1", "/script.funscript")],
    });

    const video = await waitFor(() => {
      const candidate = container.querySelector("video");
      expect(candidate).not.toBeNull();
      return candidate as HTMLVideoElement;
    });
    primeVideoElement(video, { duration: 30, currentTime: 0.5 });

    fireEvent.loadedMetadata(video);

    await waitFor(() => {
      expect(vi.mocked(handyRuntime.preloadHspScript)).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        "/video.mp4:main",
        [{ at: 0, pos: 10 }],
        625
      );
      expect(vi.mocked(handyRuntime.sendHspSync)).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        625,
        expect.any(Number),
        "/video.mp4:main",
        [{ at: 0, pos: 10 }]
      );
    });
  });

  it("runs the initial TheHandy bootstrap only once per active segment", async () => {
    mocks.handy.connectionKey = "conn-key";
    mocks.handy.appApiKey = "app-key";
    mocks.handy.connected = true;
    mocks.playback.loadFunscriptTimeline.mockResolvedValue({
      actions: [{ at: 0, pos: 10 }],
    });
    vi.mocked(handyRuntime.issueHandySession).mockResolvedValue(createHandySession());

    const { container } = renderOverlay({
      installedRounds: [createInstalledRound("round-1", "/script.funscript")],
    });

    const video = await waitFor(() => {
      const candidate = container.querySelector("video");
      expect(candidate).not.toBeNull();
      return candidate as HTMLVideoElement;
    });
    primeVideoElement(video, { duration: 30, currentTime: 0 });

    fireEvent.loadedMetadata(video);
    fireEvent.canPlay(video);
    fireEvent.loadedMetadata(video);

    await waitFor(() => {
      expect(vi.mocked(handyRuntime.preloadHspScript)).toHaveBeenCalledTimes(1);
    });
  });

  it("does not reload the video element just because the active round object identity changed", async () => {
    const loadSpy = vi
      .spyOn(HTMLMediaElement.prototype, "load")
      .mockImplementation(() => undefined);

    const initialRound = createActiveRound("round-1");
    const view = renderOverlay({
      activeRound: initialRound,
      installedRounds: [createInstalledRound("round-1")],
    });

    await waitFor(() => {
      const candidate = view.container.querySelector("video");
      expect(candidate).not.toBeNull();
    });

    expect(loadSpy).toHaveBeenCalledTimes(1);

    view.rerender(
      <RoundVideoOverlay
        activeRound={{ ...initialRound }}
        installedRounds={[createInstalledRound("round-1")]}
        currentPlayer={undefined}
        intermediaryProbability={0}
        booruSearchPrompt="animated gif webm"
        intermediaryLoadingDurationSec={10}
        intermediaryReturnPauseSec={4}
        onFinishRound={vi.fn()}
      />
    );

    expect(loadSpy).toHaveBeenCalledTimes(1);
  });

  it("resets the initial TheHandy bootstrap for a new preview round", async () => {
    mocks.handy.connectionKey = "conn-key";
    mocks.handy.appApiKey = "app-key";
    mocks.handy.connected = true;
    mocks.playback.loadFunscriptTimeline.mockResolvedValue({
      actions: [{ at: 0, pos: 10 }],
    });
    vi.mocked(handyRuntime.issueHandySession).mockResolvedValue(createHandySession());

    const view = renderOverlay({
      activeRound: createActiveRound("round-1"),
      installedRounds: [createInstalledRound("round-1", "/script-1.funscript")],
    });

    const firstVideo = await waitFor(() => {
      const candidate = view.container.querySelector("video");
      expect(candidate).not.toBeNull();
      return candidate as HTMLVideoElement;
    });
    primeVideoElement(firstVideo, { duration: 30, currentTime: 0 });
    fireEvent.loadedMetadata(firstVideo);

    await waitFor(() => {
      expect(vi.mocked(handyRuntime.preloadHspScript)).toHaveBeenCalledTimes(1);
    });

    view.rerender(
      <RoundVideoOverlay
        activeRound={createActiveRound("round-2")}
        installedRounds={[createInstalledRound("round-2", "/script-2.funscript")]}
        currentPlayer={undefined}
        intermediaryProbability={0}
        booruSearchPrompt="animated gif webm"
        intermediaryLoadingDurationSec={10}
        intermediaryReturnPauseSec={4}
        onFinishRound={vi.fn()}
      />
    );

    const secondVideo = await waitFor(() => {
      const candidate = view.container.querySelector("video");
      expect(candidate).not.toBeNull();
      return candidate as HTMLVideoElement;
    });
    primeVideoElement(secondVideo, { duration: 30, currentTime: 0 });
    fireEvent.loadedMetadata(secondVideo);

    await waitFor(() => {
      expect(vi.mocked(handyRuntime.preloadHspScript)).toHaveBeenCalledTimes(2);
    });
  });

  it("retries the initial TheHandy bootstrap after a failed first sync", async () => {
    mocks.handy.connectionKey = "conn-key";
    mocks.handy.appApiKey = "app-key";
    mocks.handy.connected = true;
    mocks.playback.loadFunscriptTimeline.mockResolvedValue({
      actions: [{ at: 0, pos: 10 }],
    });
    vi.mocked(handyRuntime.issueHandySession).mockResolvedValue(createHandySession());
    vi.mocked(handyRuntime.sendHspSync)
      .mockRejectedValueOnce(new Error("sync failed"))
      .mockResolvedValue(undefined);

    const { container } = renderOverlay({
      installedRounds: [createInstalledRound("round-1", "/script.funscript")],
    });

    const video = await waitFor(() => {
      const candidate = container.querySelector("video");
      expect(candidate).not.toBeNull();
      return candidate as HTMLVideoElement;
    });
    primeVideoElement(video, { duration: 30, currentTime: 0 });

    fireEvent.loadedMetadata(video);
    await waitFor(() => {
      expect(mocks.handy.setSyncStatus).toHaveBeenCalledWith({
        synced: false,
        error: "sync failed",
      });
      expect(screen.getByTestId("thehandy-sync-card")).not.toBeNull();
      expect(screen.getByText("sync failed")).not.toBeNull();
    });

    fireEvent.canPlay(video);

    await waitFor(() => {
      expect(vi.mocked(handyRuntime.preloadHspScript)).toHaveBeenCalledTimes(2);
      expect(vi.mocked(handyRuntime.sendHspSync)).toHaveBeenCalledTimes(2);
      expect(mocks.handy.setSyncStatus).toHaveBeenCalledWith({ synced: true, error: null });
    });
  });

  it("shows an in-game TheHandy sync card with an idle no-script preview", async () => {
    mocks.handy.connectionKey = "conn-key";
    mocks.handy.appApiKey = "app-key";
    mocks.handy.connected = true;
    mocks.handy.offsetMs = 75;
    mocks.playback.loadFunscriptTimeline.mockResolvedValue(null);

    renderOverlay();

    expect(await screen.findByTestId("thehandy-sync-card")).not.toBeNull();
    expect(screen.getByText("+75ms")).not.toBeNull();
    expect(screen.getByText("No Script")).not.toBeNull();
  });

  it("shows the live preview orb using the offset-adjusted script position", async () => {
    mocks.handy.connectionKey = "conn-key";
    mocks.handy.appApiKey = "app-key";
    mocks.handy.connected = true;
    mocks.handy.offsetMs = 50;
    mocks.playback.loadFunscriptTimeline.mockResolvedValue({
      actions: [{ at: 0, pos: 10 }],
    });
    mocks.playback.getFunscriptPositionAtMs.mockReturnValue(42);
    vi.mocked(handyRuntime.issueHandySession).mockResolvedValue(createHandySession());

    const { container } = renderOverlay({
      installedRounds: [createInstalledRound("round-1", "/script.funscript")],
    });

    const video = await waitFor(() => {
      const candidate = container.querySelector("video");
      expect(candidate).not.toBeNull();
      return candidate as HTMLVideoElement;
    });
    primeVideoElement(video, { duration: 30, currentTime: 0.25 });

    fireEvent.loadedMetadata(video);

    await waitFor(() => {
      expect(mocks.playback.getFunscriptPositionAtMs).toHaveBeenCalledWith(
        { actions: [{ at: 0, pos: 10 }] },
        300
      );
      const orb = screen.getByTestId("thehandy-preview-orb");
      expect(orb.getAttribute("style")).toContain("top: 58%");
    });
  });

  it("does not apply an opaque black backdrop during active round playback", () => {
    const { container } = renderOverlay();
    const root = container.firstChild as HTMLElement | null;

    expect(root).not.toBeNull();
    expect(root?.className).toContain("bg-transparent");
    expect(root?.className).not.toContain("bg-black");
  });

  it("seeks main rounds to their trim start and finishes when trim end is reached", async () => {
    const onFinishRound = vi.fn();
    const mainRound = createInstalledRound("round-1", null, {
      startTime: 5_000,
      endTime: 25_000,
      durationMs: 30_000,
    });
    const mainTime = { value: 0 };
    const { container } = renderOverlay({
      installedRounds: [mainRound],
      onFinishRound,
    });

    const video = await waitFor(() => {
      const candidate = container.querySelector('video[src="/video.mp4"]');
      expect(candidate).not.toBeNull();
      return candidate as HTMLVideoElement;
    });
    primeVideoElement(video, { duration: 30, currentTimeRef: mainTime });

    fireEvent.loadedMetadata(video);

    await waitFor(() => {
      expect(mainTime.value).toBe(5);
    });

    mainTime.value = 25;

    await waitFor(() => {
      expect(onFinishRound).toHaveBeenCalledWith({
        intermediaryCount: 0,
        activeAntiPerkCount: 0,
      });
    });
  });

  it("starts intermediary rounds at their trim start and shows trim-relative timing", async () => {
    const mainRound = createInstalledRound("round-1", null, {
      startTime: 5_000,
      endTime: 25_000,
    });
    const intermediaryRound = createIntermediaryRound("intermediary-1", null, {
      videoUri: "/intermediary.mp4",
      startTime: 7_000,
      endTime: 12_000,
    });
    const mainTime = { value: 5 };
    const intermediaryTime = { value: 0 };
    const { container } = renderOverlay({
      installedRounds: [mainRound, intermediaryRound],
      allowDebugRoundControls: true,
      intermediaryLoadingDurationSec: 0,
      intermediaryReturnPauseSec: 0,
    });

    const mainVideo = await waitFor(() => {
      const candidate = container.querySelector('video[src="/video.mp4"]');
      expect(candidate).not.toBeNull();
      return candidate as HTMLVideoElement;
    });
    primeVideoElement(mainVideo, { duration: 30, currentTimeRef: mainTime });
    fireEvent.loadedMetadata(mainVideo);

    mainTime.value = 12;
    fireEvent.click(await screen.findByRole("button", { name: "Test Intermediary (I)" }));

    const intermediaryVideo = await waitFor(() => {
      const candidate = container.querySelector('video[src="/intermediary.mp4"]');
      expect(candidate).not.toBeNull();
      return candidate as HTMLVideoElement;
    });
    primeVideoElement(intermediaryVideo, { duration: 30, currentTimeRef: intermediaryTime });

    fireEvent.loadedMetadata(intermediaryVideo);

    await waitFor(() => {
      expect(intermediaryTime.value).toBe(7);
      expect(screen.getByText("Segment: Intermediary")).not.toBeNull();
    });

    intermediaryTime.value = 9;

    await waitFor(() => {
      expect(screen.getByTestId("round-playback-timer").textContent).toContain("0:02 / 0:05");
    });
  });

  it("returns from an intermediary trim end and resumes the main round where it paused", async () => {
    const mainRound = createInstalledRound("round-1", null, {
      startTime: 5_000,
      endTime: 25_000,
    });
    const intermediaryRound = createIntermediaryRound("intermediary-1", null, {
      videoUri: "/intermediary.mp4",
      startTime: 7_000,
      endTime: 12_000,
    });
    const mainTime = { value: 0 };
    const intermediaryTime = { value: 0 };
    const { container } = renderOverlay({
      installedRounds: [mainRound, intermediaryRound],
      allowDebugRoundControls: true,
      intermediaryLoadingDurationSec: 0,
      intermediaryReturnPauseSec: 0,
    });

    const mainVideo = await waitFor(() => {
      const candidate = container.querySelector('video[src="/video.mp4"]');
      expect(candidate).not.toBeNull();
      return candidate as HTMLVideoElement;
    });
    primeVideoElement(mainVideo, { duration: 30, currentTimeRef: mainTime });
    fireEvent.loadedMetadata(mainVideo);

    await waitFor(() => {
      expect(mainTime.value).toBe(5);
    });

    mainTime.value = 12;
    fireEvent.click(await screen.findByRole("button", { name: "Test Intermediary (I)" }));

    const intermediaryVideo = await waitFor(() => {
      const candidate = container.querySelector('video[src="/intermediary.mp4"]');
      expect(candidate).not.toBeNull();
      return candidate as HTMLVideoElement;
    });
    primeVideoElement(intermediaryVideo, { duration: 30, currentTimeRef: intermediaryTime });
    fireEvent.loadedMetadata(intermediaryVideo);

    await waitFor(() => {
      expect(screen.getByText("Segment: Intermediary")).not.toBeNull();
      expect(intermediaryTime.value).toBe(7);
    });

    intermediaryTime.value = 12.05;

    await waitFor(() => {
      expect(screen.getByText("Segment: Main")).not.toBeNull();
      expect(mainTime.value).toBe(12);
    });
  });

  it("keeps the board visible during board-only anti-perk sequences", () => {
    const { container } = renderOverlay({ activeRound: null, boardSequence: "milker" });
    const root = container.firstChild as HTMLElement | null;

    expect(root).not.toBeNull();
    expect(root?.className).toContain("bg-transparent");
    expect(root?.className).not.toContain("bg-black");
  });

  it("shows the debug panel only when debug controls are enabled", async () => {
    renderOverlay({ allowDebugRoundControls: true });
    expect(await screen.findByText("Segment: Main")).not.toBeNull();
    expect(screen.queryByText("Intermediary queue: 0")).toBeNull();
  });

  it("shows the intermediary queue only in development mode", async () => {
    mocks.isGameDevelopmentMode.mockReturnValue(true);

    renderOverlay();

    expect(await screen.findByText("Intermediary queue: 0")).not.toBeNull();
  });

  it("renders a beatbar for milker sequences when enabled", async () => {
    renderOverlay({ activeRound: null, boardSequence: "milker" });
    expect(await screen.findByTestId("anti-perk-beatbar")).not.toBeNull();
  });

  it("renders a beatbar for jackhammer sequences when enabled", async () => {
    renderOverlay({ activeRound: null, boardSequence: "jackhammer" });
    expect(await screen.findByTestId("anti-perk-beatbar")).not.toBeNull();
  });

  it("anchors the anti-perk sequence card in the lower-left corner", async () => {
    renderOverlay({ activeRound: null, boardSequence: "milker" });

    const sequenceCard = await screen.findByTestId("anti-perk-sequence-card");
    expect(sequenceCard.className).toContain("rounded-xl");
    expect(sequenceCard.parentElement?.className).toContain("bottom-5");
    expect(sequenceCard.parentElement?.className).toContain("left-5");
    expect(sequenceCard.parentElement?.className).not.toContain("left-1/2");
  });

  it("renders multiple preview markers from the generated anti-perk motion", async () => {
    renderOverlay({ activeRound: null, boardSequence: "jackhammer" });
    expect((await screen.findAllByTestId("anti-perk-beat-note")).length).toBeGreaterThan(1);
    expect(screen.queryByTestId("anti-perk-position-ball")).toBeNull();
  });

  it("does not render a beatbar for no-rest sequences", async () => {
    renderOverlay({ activeRound: null, idleBoardSequence: "no-rest" });
    await waitFor(() => {
      expect(screen.queryByTestId("anti-perk-beatbar")).toBeNull();
    });
  });

  it("runs no-rest as a hidden board filler without booru loading media", async () => {
    renderOverlay({ activeRound: null, idleBoardSequence: "no-rest" });

    expect(screen.queryByTestId("anti-perk-sequence-card")).toBeNull();
    expect(screen.queryByAltText("loading media")).toBeNull();
    expect(vi.mocked(booru.refreshBooruMediaCache)).not.toHaveBeenCalled();
  });

  it("starts handy sync for no-rest idle filler without rendering a countdown overlay", async () => {
    mocks.handy.connectionKey = "conn-key";
    mocks.handy.appApiKey = "app-key";
    mocks.handy.connected = true;
    vi.mocked(handyRuntime.issueHandySession).mockResolvedValue({
      mode: "appId",
      clientToken: null,
      expiresAtMs: Date.now() + 60_000,
      serverTimeOffsetMs: 0,
      serverTimeOffsetMeasuredAtMs: 0,
      loadedScriptId: null,
      activeScriptId: null,
      lastSyncAtMs: 0,
      lastPlaybackRate: 1,
      maxBufferPoints: 4000,
      streamedPoints: null,
      nextStreamPointIndex: 0,
      tailPointStreamIndex: 0,
      uploadedUntilMs: 0,
      hspModeActive: false,
    });

    renderOverlay({ activeRound: null, idleBoardSequence: "no-rest" });

    expect(screen.queryByTestId("anti-perk-sequence-card")).toBeNull();
    await waitFor(() => {
      expect(vi.mocked(handyRuntime.sendHspSync)).toHaveBeenCalled();
    });
  });

  it("hides the beatbar when the setting is disabled", async () => {
    renderOverlay({
      activeRound: null,
      boardSequence: "milker",
      initialShowAntiPerkBeatbar: false,
    });
    await waitFor(() => {
      expect(screen.queryByTestId("anti-perk-beatbar")).toBeNull();
    });
  });

  it("renders the beatbar even when TheHandy is disconnected", async () => {
    mocks.handy.connected = false;
    renderOverlay({ activeRound: null, boardSequence: "jackhammer" });
    expect(await screen.findByTestId("anti-perk-beatbar")).not.toBeNull();
  });

  it("shows only the moving Handy position ball when TheHandy is connected", async () => {
    mocks.handy.connected = true;
    renderOverlay({ activeRound: null, boardSequence: "jackhammer" });
    expect(await screen.findByTestId("anti-perk-beatbar")).not.toBeNull();
    expect(screen.getByTestId("anti-perk-position-ball")).not.toBeNull();
    expect(screen.queryByTestId("anti-perk-beat-note")).toBeNull();
  });

  it("starts generated sequence sync if TheHandy connects after the anti-perk overlay already started", async () => {
    mocks.handy.connectionKey = "conn-key";
    mocks.handy.appApiKey = "app-key";
    mocks.handy.connected = false;
    vi.mocked(handyRuntime.issueHandySession).mockResolvedValue({
      mode: "appId",
      clientToken: null,
      expiresAtMs: Date.now() + 60_000,
      serverTimeOffsetMs: 0,
      serverTimeOffsetMeasuredAtMs: 0,
      loadedScriptId: null,
      activeScriptId: null,
      lastSyncAtMs: 0,
      lastPlaybackRate: 1,
      maxBufferPoints: 4000,
      streamedPoints: null,
      nextStreamPointIndex: 0,
      tailPointStreamIndex: 0,
      uploadedUntilMs: 0,
      hspModeActive: false,
    });

    const view = renderOverlay({ activeRound: null, boardSequence: "jackhammer" });
    expect(vi.mocked(handyRuntime.sendHspSync)).not.toHaveBeenCalled();

    mocks.handy.connected = true;
    view.rerender(
      <RoundVideoOverlay
        activeRound={null}
        installedRounds={[createInstalledRound()]}
        currentPlayer={undefined}
        intermediaryProbability={0}
        booruSearchPrompt="animated gif webm"
        intermediaryLoadingDurationSec={10}
        intermediaryReturnPauseSec={4}
        onFinishRound={vi.fn()}
        boardSequence="jackhammer"
        initialShowAntiPerkBeatbar
      />
    );

    await waitFor(() => {
      expect(vi.mocked(handyRuntime.preloadHspScript)).toHaveBeenCalled();
      expect(vi.mocked(handyRuntime.sendHspSync)).toHaveBeenCalled();
    });
  });

  it("resets an existing Handy script before starting a generated anti-perk sequence", async () => {
    mocks.handy.connectionKey = "conn-key";
    mocks.handy.appApiKey = "app-key";
    mocks.handy.connected = true;
    vi.mocked(handyRuntime.issueHandySession).mockResolvedValue({
      ...createHandySession(),
      loadedScriptId: "/video.mp4:main:120:0:30000",
      activeScriptId: "/video.mp4:main:120:0:30000",
      streamedPoints: [{ t: 0, x: 20 }],
      hspModeActive: true,
    });

    renderOverlay({ activeRound: null, boardSequence: "milker" });

    await waitFor(() => {
      expect(vi.mocked(handyRuntime.stopHandyPlayback)).toHaveBeenCalledWith(
        { connectionKey: "conn-key", appApiKey: "app-key" },
        expect.objectContaining({
          loadedScriptId: "/video.mp4:main:120:0:30000",
          activeScriptId: "/video.mp4:main:120:0:30000",
        })
      );
      expect(vi.mocked(handyRuntime.preloadHspScript)).toHaveBeenCalled();
      expect(vi.mocked(handyRuntime.sendHspSync)).toHaveBeenCalled();
    });
  });

  it("does not apply the persisted Handy offset to generated anti-perk sync", async () => {
    vi.spyOn(performance, "now").mockImplementation(() => 1_000);

    mocks.handy.connectionKey = "conn-key";
    mocks.handy.appApiKey = "app-key";
    mocks.handy.offsetMs = 125;
    mocks.handy.connected = true;
    vi.mocked(handyRuntime.issueHandySession).mockResolvedValue(createHandySession());

    renderOverlay({ activeRound: null, boardSequence: "jackhammer" });

    await waitFor(() => {
      expect(vi.mocked(handyRuntime.sendHspSync)).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        0,
        1,
        expect.stringMatching(/^anti-jackhammer-/),
        expect.any(Array)
      );
    });
  });

  it("recomputes generated anti-perk elapsed time after preload completes", async () => {
    let nowMs = 1_000;
    vi.spyOn(performance, "now").mockImplementation(() => nowMs);

    mocks.handy.connectionKey = "conn-key";
    mocks.handy.appApiKey = "app-key";
    mocks.handy.connected = true;
    vi.mocked(handyRuntime.issueHandySession).mockResolvedValue(createHandySession());
    vi.mocked(handyRuntime.preloadHspScript).mockImplementation(async () => {
      nowMs = 1_280;
    });

    renderOverlay({ activeRound: null, boardSequence: "milker" });

    await waitFor(() => {
      expect(vi.mocked(handyRuntime.sendHspSync)).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        280,
        1,
        expect.stringMatching(/^anti-milker-/),
        expect.any(Array)
      );
    });
  });

  it("does not pause TheHandy during an active jackhammer anti-perk countdown", async () => {
    mocks.handy.connectionKey = "conn-key";
    mocks.handy.appApiKey = "app-key";
    mocks.handy.connected = true;
    vi.mocked(handyRuntime.issueHandySession).mockResolvedValue({
      mode: "appId",
      clientToken: null,
      expiresAtMs: Date.now() + 60_000,
      serverTimeOffsetMs: 0,
      serverTimeOffsetMeasuredAtMs: 0,
      loadedScriptId: null,
      activeScriptId: null,
      lastSyncAtMs: 0,
      lastPlaybackRate: 1,
      maxBufferPoints: 4000,
      streamedPoints: null,
      nextStreamPointIndex: 0,
      tailPointStreamIndex: 0,
      uploadedUntilMs: 0,
      hspModeActive: false,
    });

    renderOverlay({
      currentPlayer: {
        id: "p1",
        name: "Player 1",
        colorHex: "#fff",
        position: 0,
        score: 0,
        coins: 0,
        perks: [],
        antiPerks: ["jackhammer"],
        shieldRounds: 0,
        inventory: [],
        pendingRoundControl: null,
        pendingIntensityCap: null,
        hasCame: false,
        stats: {
          diceMin: 1,
          diceMax: 6,
          roundPauseMs: 0,
          perkFrequency: 0,
          perkLuck: 0,
        },
      },
    });

    await waitFor(() => {
      expect(vi.mocked(handyRuntime.sendHspSync)).toHaveBeenCalled();
    });
    expect(vi.mocked(handyRuntime.pauseHandyPlayback)).not.toHaveBeenCalled();
  });

  it("keeps generated Handy sync marked fresh during a jackhammer sequence", async () => {
    vi.useFakeTimers();
    vi.spyOn(performance, "now").mockImplementation(() => Date.now());
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) =>
      window.setTimeout(() => callback(performance.now()), 16)
    );
    vi.stubGlobal("cancelAnimationFrame", (id: number) => window.clearTimeout(id));

    mocks.handy.connectionKey = "conn-key";
    mocks.handy.appApiKey = "app-key";
    mocks.handy.connected = true;
    mocks.handy.setSyncStatus.mockClear();

    vi.mocked(handyRuntime.issueHandySession).mockResolvedValue({
      mode: "appId",
      clientToken: null,
      expiresAtMs: Date.now() + 60_000,
      serverTimeOffsetMs: 0,
      serverTimeOffsetMeasuredAtMs: 0,
      loadedScriptId: null,
      activeScriptId: null,
      lastSyncAtMs: 0,
      lastPlaybackRate: 1,
      maxBufferPoints: 4000,
      streamedPoints: null,
      nextStreamPointIndex: 0,
      tailPointStreamIndex: 0,
      uploadedUntilMs: 0,
      hspModeActive: false,
    });

    renderOverlay({ activeRound: null, boardSequence: "jackhammer" });

    await waitFor(() => {
      expect(mocks.handy.setSyncStatus).toHaveBeenCalledWith({ synced: true, error: null });
    });

    const staleResetCountAtSync = mocks.handy.setSyncStatus.mock.calls.filter(
      ([value]) => value?.synced === false && value?.error === null
    ).length;

    await vi.advanceTimersByTimeAsync(2_500);

    const staleResetCountAfter = mocks.handy.setSyncStatus.mock.calls.filter(
      ([value]) => value?.synced === false && value?.error === null
    ).length;

    expect(staleResetCountAfter).toBe(staleResetCountAtSync);
  }, 10_000);

  it("does not play beatbar impact sounds during manual anti-perk overlays", async () => {
    vi.useFakeTimers();
    vi.spyOn(performance, "now").mockImplementation(() => Date.now());
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) =>
      window.setTimeout(() => callback(performance.now()), 16)
    );
    vi.stubGlobal("cancelAnimationFrame", (id: number) => window.clearTimeout(id));
    renderOverlay({ activeRound: null, boardSequence: "jackhammer" });
    const definition = getAntiPerkSequenceDefinition("jackhammer");

    await vi.advanceTimersByTimeAsync(definition.durationSec * 1000 + 250);

    expect(mocks.playAntiPerkBeatSound).not.toHaveBeenCalled();
  }, 10_000);

  it("keeps the manual beatbar silent before and after the first downstroke impact", async () => {
    vi.useFakeTimers();
    vi.spyOn(performance, "now").mockImplementation(() => Date.now());
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) =>
      window.setTimeout(() => callback(performance.now()), 16)
    );
    vi.stubGlobal("cancelAnimationFrame", (id: number) => window.clearTimeout(id));

    renderOverlay({ activeRound: null, boardSequence: "jackhammer" });

    const definition = getAntiPerkSequenceDefinition("jackhammer");
    const actions = definition.createActions(definition.durationSec * 1000, () => 0.37);
    const firstImpactAt = extractBeatbarMotionEvents(actions).find(
      (event) => event.kind === "downstroke"
    )?.at;

    expect(firstImpactAt).toBeTypeOf("number");

    await vi.advanceTimersByTimeAsync(Math.max(0, (firstImpactAt ?? 0) - 1));
    expect(mocks.playAntiPerkBeatSound).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(2);
    expect(mocks.playAntiPerkBeatSound).not.toHaveBeenCalled();
  }, 10_000);

  it("does not play anti-perk beat sounds when only the Handy position ball is shown", async () => {
    vi.useFakeTimers();
    vi.spyOn(performance, "now").mockImplementation(() => Date.now());
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) =>
      window.setTimeout(() => callback(performance.now()), 16)
    );
    vi.stubGlobal("cancelAnimationFrame", (id: number) => window.clearTimeout(id));
    mocks.handy.connected = true;
    renderOverlay({ activeRound: null, boardSequence: "jackhammer" });

    await vi.advanceTimersByTimeAsync(2_000);

    expect(mocks.playAntiPerkBeatSound).not.toHaveBeenCalled();
    expect(screen.getByTestId("anti-perk-position-ball")).not.toBeNull();
  }, 10_000);

  it("stops beatbar activity once the sequence finishes", async () => {
    vi.useFakeTimers();
    vi.spyOn(performance, "now").mockImplementation(() => Date.now());
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) =>
      window.setTimeout(() => callback(performance.now()), 16)
    );
    vi.stubGlobal("cancelAnimationFrame", (id: number) => window.clearTimeout(id));
    renderOverlay({ activeRound: null, boardSequence: "jackhammer" });
    const callsBefore = mocks.playAntiPerkBeatSound.mock.calls.length;

    await vi.advanceTimersByTimeAsync(16_000);
    expect(screen.queryByTestId("anti-perk-beatbar")).toBeNull();

    const settledCalls = mocks.playAntiPerkBeatSound.mock.calls.length;
    expect(settledCalls).toBeGreaterThanOrEqual(callsBefore);

    await vi.advanceTimersByTimeAsync(1_000);
    expect(mocks.playAntiPerkBeatSound.mock.calls.length).toBe(settledCalls);
  }, 10_000);

  it("does not restart the board-sequence countdown when the completion callback identity changes", async () => {
    vi.useFakeTimers();
    vi.spyOn(performance, "now").mockImplementation(() => Date.now());
    const firstComplete = vi.fn();
    const secondComplete = vi.fn();

    const view = renderOverlay({
      activeRound: null,
      boardSequence: "jackhammer",
      onCompleteBoardSequence: firstComplete,
    });

    expect(screen.getByText("15")).not.toBeNull();

    await vi.advanceTimersByTimeAsync(1_000);
    expect(screen.getByText("14")).not.toBeNull();

    view.rerender(
      <RoundVideoOverlay
        activeRound={null}
        installedRounds={[createInstalledRound()]}
        currentPlayer={undefined}
        intermediaryProbability={0}
        booruSearchPrompt="animated gif webm"
        intermediaryLoadingDurationSec={10}
        intermediaryReturnPauseSec={4}
        onFinishRound={vi.fn()}
        boardSequence="jackhammer"
        onCompleteBoardSequence={secondComplete}
        initialShowAntiPerkBeatbar
      />
    );

    expect(screen.getByText("14")).not.toBeNull();

    expect(screen.queryByText("15")).toBeNull();
    expect(screen.getByText("14")).not.toBeNull();
    expect(firstComplete).not.toHaveBeenCalled();
    expect(secondComplete).not.toHaveBeenCalled();
  }, 10_000);
});
