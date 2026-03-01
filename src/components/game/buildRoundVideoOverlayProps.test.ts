import { describe, expect, it, vi } from "vitest";
import type { ActiveRound, PlayerState } from "../../game/types";
import type { InstalledRound } from "../../services/db";
import {
  buildGameplayRoundVideoOverlayProps,
  buildPreviewRoundVideoOverlayProps,
} from "./buildRoundVideoOverlayProps";

function createActiveRound(
  roundId = "round-1",
  phaseKind: ActiveRound["phaseKind"] = "normal"
): ActiveRound {
  return {
    fieldId: "field-1",
    nodeId: "node-1",
    roundId,
    roundName: "Round 1",
    selectionKind: "fixed",
    poolId: null,
    phaseKind,
    campaignIndex: 0,
  };
}

function createInstalledRound(roundId = "round-1"): InstalledRound {
  return {
    id: roundId,
    name: "Round 1",
    type: "Main",
    startTime: 1_000,
    endTime: 9_000,
    previewImage: null,
    resources: [{ videoUri: "/video.mp4", funscriptUri: "/video.funscript" }],
  } as unknown as InstalledRound;
}

function createPlayer(): PlayerState {
  return {
    id: "p1",
    name: "Player 1",
    currentNodeId: "node-1",
    position: 0,
    money: 0,
    score: 0,
    perks: [],
    antiPerks: [],
    inventory: [],
    activePerkEffects: [],
    pendingIntensityCap: null,
    stats: {
      diceMin: 1,
      diceMax: 6,
      roundPauseMs: 0,
      perkFrequency: 0,
      perkLuck: 0,
    },
  };
}

describe("buildRoundVideoOverlayProps", () => {
  it("keeps preview and gameplay playback inputs aligned", () => {
    const activeRound = createActiveRound();
    const installedRounds = [createInstalledRound()];
    const previewOnClose = vi.fn();
    const previewOnFinish = vi.fn();
    const gameplayOnFinish = vi.fn();

    const preview = buildPreviewRoundVideoOverlayProps({
      activeRound,
      installedRounds,
      intermediaryProbability: 0,
      booruSearchPrompt: "animated gif webm",
      intermediaryLoadingDurationSec: 5,
      intermediaryReturnPauseSec: 4,
      initialShowProgressBarAlways: true,
      initialShowAntiPerkBeatbar: true,
      onClose: previewOnClose,
      onFinishRound: previewOnFinish,
    });
    const gameplay = buildGameplayRoundVideoOverlayProps({
      activeRound,
      installedRounds,
      intermediaryProbability: 1,
      booruSearchPrompt: "animated gif webm",
      intermediaryLoadingDurationSec: 5,
      intermediaryReturnPauseSec: 4,
      initialShowProgressBarAlways: true,
      initialShowAntiPerkBeatbar: true,
      currentPlayer: createPlayer(),
      allowPausingDuringFinalCumRound: true,
      onFinishRound: gameplayOnFinish,
      roundControl: {
        pauseCharges: 1,
        skipCharges: 2,
        onUsePause: vi.fn(),
        onUseSkip: vi.fn(),
      },
    });

    expect(preview.activeRound).toBe(gameplay.activeRound);
    expect(preview.installedRounds).toBe(gameplay.installedRounds);
    expect(preview.intermediaryProbability).toBe(0);
    expect(preview.booruSearchPrompt).toBe(gameplay.booruSearchPrompt);
    expect(preview.intermediaryLoadingDurationSec).toBe(gameplay.intermediaryLoadingDurationSec);
    expect(preview.intermediaryReturnPauseSec).toBe(gameplay.intermediaryReturnPauseSec);
    expect(preview.allowAutomaticIntermediaries).toBe(false);
    expect(gameplay.allowAutomaticIntermediaries).toBe(true);
    expect(preview.initialShowProgressBarAlways).toBe(gameplay.initialShowProgressBarAlways);
    expect(preview.initialShowAntiPerkBeatbar).toBe(gameplay.initialShowAntiPerkBeatbar);
    expect(gameplay.allowPausingDuringFinalCumRound).toBe(true);
  });

  it("keeps preview shell controls separate from gameplay session controls", () => {
    const preview = buildPreviewRoundVideoOverlayProps({
      activeRound: createActiveRound(),
      installedRounds: [createInstalledRound()],
      intermediaryProbability: 0,
      booruSearchPrompt: "animated gif webm",
      intermediaryLoadingDurationSec: 5,
      intermediaryReturnPauseSec: 4,
      onClose: vi.fn(),
      onFinishRound: vi.fn(),
    });

    expect(preview.showCloseButton).toBe(true);
    expect(preview.allowTimelineSeeking).toBe(true);
    expect(preview.onClose).toBeTypeOf("function");
    expect(preview.currentPlayer).toBeUndefined();
    expect(preview.roundControl).toBeUndefined();
    expect(preview.onRequestCum).toBeUndefined();
    expect(preview.onOpenOptions).toBeUndefined();
  });

  it("keeps timeline seeking disabled during gameplay", () => {
    const gameplay = buildGameplayRoundVideoOverlayProps({
      activeRound: createActiveRound(),
      installedRounds: [createInstalledRound()],
      intermediaryProbability: 0,
      booruSearchPrompt: "animated gif webm",
      intermediaryLoadingDurationSec: 5,
      intermediaryReturnPauseSec: 4,
      currentPlayer: createPlayer(),
      onFinishRound: vi.fn(),
    });

    expect(gameplay.allowTimelineSeeking).toBe(false);
  });

  it("allows preview callers to opt back into automatic intermediaries explicitly", () => {
    const preview = buildPreviewRoundVideoOverlayProps({
      activeRound: createActiveRound(),
      installedRounds: [createInstalledRound()],
      intermediaryProbability: 0.5,
      booruSearchPrompt: "animated gif webm",
      intermediaryLoadingDurationSec: 5,
      intermediaryReturnPauseSec: 4,
      allowAutomaticIntermediaries: true,
      onClose: vi.fn(),
      onFinishRound: vi.fn(),
    });

    expect(preview.allowAutomaticIntermediaries).toBe(true);
  });

  it.each([
    { phaseKind: "normal" as const, disabled: true, expected: true },
    { phaseKind: "cum" as const, disabled: true, expected: false },
    { phaseKind: "cumPoint" as const, disabled: true, expected: false },
    { phaseKind: "cum" as const, disabled: false, expected: true },
    { phaseKind: "cumPoint" as const, disabled: false, expected: true },
  ])(
    "sets automatic intermediary playback to $expected for $phaseKind when suppression is $disabled",
    ({ phaseKind, disabled, expected }) => {
      const gameplay = buildGameplayRoundVideoOverlayProps({
        activeRound: createActiveRound("round-1", phaseKind),
        installedRounds: [createInstalledRound()],
        intermediaryProbability: 1,
        intermediarySelection: { minPerTriggeredRound: 2, maxPerTriggeredRound: 4 },
        disableInterjectionsDuringCumRounds: disabled,
        booruSearchPrompt: "animated gif webm",
        intermediaryLoadingDurationSec: 5,
        intermediaryReturnPauseSec: 4,
        currentPlayer: createPlayer(),
        onFinishRound: vi.fn(),
      });

      expect(gameplay.allowAutomaticIntermediaries).toBe(expected);
      expect(gameplay.intermediarySelection).toEqual({
        minPerTriggeredRound: 2,
        maxPerTriggeredRound: 4,
      });
    }
  );
});
