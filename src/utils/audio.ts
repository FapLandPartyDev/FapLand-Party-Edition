import {
  clampSfxVolume,
  DEFAULT_SFX_VOLUME,
  SFX_VOLUME_CHANGED_EVENT,
  SFX_VOLUME_KEY,
} from "../constants/audioSettings";
import { trpc } from "../services/trpc";

let audioCtx: AudioContext | null = null;
const activeSamplePlayers = new Set<HTMLAudioElement>();
const decodedSampleCache = new Map<string, Promise<AudioBuffer | null>>();
let activeWebAudioNodes = 0;
let audioSuspendTimer: number | null = null;
const AUDIO_IDLE_SUSPEND_DELAY_MS = 1500;

let globalSfxVolume = DEFAULT_SFX_VOLUME;

if (typeof window !== "undefined") {
  window.addEventListener(SFX_VOLUME_CHANGED_EVENT, (event: Event) => {
    const customEvent = event as CustomEvent<number>;
    globalSfxVolume = customEvent.detail;
  });
}

export const setGlobalSfxVolume = (volume: number) => {
  globalSfxVolume = volume;
};

export const initializeSfxVolume = async () => {
  try {
    const volume = await trpc.store.get.query({ key: SFX_VOLUME_KEY });
    globalSfxVolume = clampSfxVolume(volume);
  } catch (error) {
    console.warn("Failed to load initial SFX volume", error);
  }
};

const SOUND_ASSETS = {
  hover: "/sounds/ui-hover.wav",
  select: "/sounds/ui-select.wav",
  diceRoll: "/sounds/dice-roll.wav",
  diceResult: "/sounds/dice-result.wav",
  tokenStep: "/sounds/token-step.wav",
  tokenLand: "/sounds/token-land.wav",
  gatePass: "/sounds/gate-pass.wav",
  roundStart: "/sounds/round-start.wav",
  playlistLaunch: "/sounds/playlist-launch.wav",
  perkAction: "/sounds/perk-action.wav",
  roundReward: "/sounds/round-reward.wav",
  converterMarkIn: "/sounds/converter/mark-in.wav",
  converterMarkOut: "/sounds/converter/mark-out.wav",
  converterSegmentAdd: "/sounds/converter/segment-add.wav",
  converterSegmentDelete: "/sounds/ui-hover.wav",
  converterZoom: "/sounds/converter/zoom.wav",
  converterAutoDetect: "/sounds/converter/auto-detect.wav",
  converterValidationError: "/sounds/converter/validation-error.wav",
  converterSaveSuccess: "/sounds/converter/save-success.wav",
  mapEditorPlaceNode: "/sounds/map-editor/place-node.wav",
  mapEditorDeleteNode: "/sounds/map-editor/delete-node.wav",
  mapEditorConnectNodes: "/sounds/map-editor/connect-nodes.wav",
  mapEditorDisconnectNodes: "/sounds/map-editor/disconnect-nodes.wav",
  mapEditorInvalidAction: "/sounds/map-editor/invalid-action.wav",
  mapEditorSave: "/sounds/map-editor/save.wav",
  mapEditorUndoRedo: "/sounds/map-editor/undo-redo.wav",
} as const;

export const resolveAssetUrl = (assetPath: string) => {
  const normalizedPath = assetPath.replace(/^\/+/, "");
  if (typeof document === "undefined") return normalizedPath;

  try {
    return new URL(normalizedPath, document.baseURI).toString();
  } catch {
    return normalizedPath;
  }
};

const initAudio = () => {
  if (typeof window === "undefined") return;
  if (!audioCtx) {
    // @ts-expect-error - webkitAudioContext is for older Safari
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (AudioContextClass) {
      audioCtx = new AudioContextClass();
    }
  }
  if (audioCtx && audioCtx.state === "suspended") {
    audioCtx.resume().catch(() => {});
  }
};

const clearAudioSuspendTimer = () => {
  if (audioSuspendTimer !== null && typeof window !== "undefined") {
    window.clearTimeout(audioSuspendTimer);
    audioSuspendTimer = null;
  }
};

const retainAudioNode = () => {
  activeWebAudioNodes += 1;
  clearAudioSuspendTimer();
};

const releaseAudioNode = () => {
  activeWebAudioNodes = Math.max(0, activeWebAudioNodes - 1);
  if (activeWebAudioNodes !== 0 || !audioCtx || typeof window === "undefined") return;
  clearAudioSuspendTimer();
  audioSuspendTimer = window.setTimeout(() => {
    audioSuspendTimer = null;
    if (!audioCtx || activeWebAudioNodes !== 0) return;
    if (audioCtx.state === "running") {
      audioCtx.suspend().catch(() => {});
    }
  }, AUDIO_IDLE_SUSPEND_DELAY_MS);
};

const loadDecodedSample = async (src: string): Promise<AudioBuffer | null> => {
  initAudio();
  if (!audioCtx || typeof fetch === "undefined") return null;

  const cacheKey = resolveAssetUrl(src);
  const cached = decodedSampleCache.get(cacheKey);
  if (cached) return cached;

  const pending = fetch(cacheKey)
    .then(async (response) => {
      if (!response.ok) return null;
      const data = await response.arrayBuffer();
      const context = audioCtx;
      if (!context) return null;
      return await context.decodeAudioData(data.slice(0));
    })
    .catch(() => null);

  decodedSampleCache.set(cacheKey, pending);
  return pending;
};

type OscType = OscillatorType;

const playTone = (
  type: OscType,
  startFreq: number,
  endFreq: number,
  durationSec: number,
  volume: number
) => {
  initAudio();
  if (!audioCtx) return;

  const osc = audioCtx.createOscillator();
  const gainNode = audioCtx.createGain();
  retainAudioNode();

  osc.type = type;
  osc.frequency.setValueAtTime(startFreq, audioCtx.currentTime);
  osc.frequency.exponentialRampToValueAtTime(
    Math.max(1, endFreq),
    audioCtx.currentTime + durationSec
  );

  osc.connect(gainNode);
  gainNode.connect(audioCtx.destination);
  osc.onended = () => {
    osc.disconnect();
    gainNode.disconnect();
    releaseAudioNode();
  };

  const finalVolume = volume * globalSfxVolume;
  gainNode.gain.setValueAtTime(finalVolume, audioCtx.currentTime);
  gainNode.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + durationSec);

  osc.start();
  osc.stop(audioCtx.currentTime + durationSec);
};

const playSample = (src: string, volume: number, playbackRate = 1, onFail?: () => void) => {
  void loadDecodedSample(src).then((buffer) => {
    if (!audioCtx || !buffer) {
      if (typeof Audio === "undefined") {
        onFail?.();
        return;
      }

      try {
        const audio = new Audio(resolveAssetUrl(src));
        const cleanup = () => {
          activeSamplePlayers.delete(audio);
          audio.pause();
          audio.removeAttribute("src");
          audio.load();
        };

        activeSamplePlayers.add(audio);
        audio.preload = "auto";
        audio.volume = volume * globalSfxVolume;
        audio.playbackRate = playbackRate;
        audio.currentTime = 0;
        audio.addEventListener("ended", cleanup, { once: true });
        audio.addEventListener("error", cleanup, { once: true });
        void audio.play().catch(() => {
          cleanup();
          onFail?.();
        });
        return;
      } catch {
        onFail?.();
        return;
      }
    }

    const source = audioCtx.createBufferSource();
    const gainNode = audioCtx.createGain();
    retainAudioNode();

    source.buffer = buffer;
    source.playbackRate.setValueAtTime(playbackRate, audioCtx.currentTime);
    gainNode.gain.setValueAtTime(volume * globalSfxVolume, audioCtx.currentTime);

    source.connect(gainNode);
    gainNode.connect(audioCtx.destination);
    source.onended = () => {
      source.disconnect();
      gainNode.disconnect();
      releaseAudioNode();
    };

    try {
      source.start();
    } catch {
      source.disconnect();
      gainNode.disconnect();
      releaseAudioNode();
      onFail?.();
    }
  });
};

const varyRate = (base: number, spread: number) => base + (Math.random() * 2 - 1) * spread;

export const playHoverSound = () => {
  playSample(SOUND_ASSETS.hover, 0.28, varyRate(1.08, 0.05), () => {
    playTone("sine", 400, 800, 0.05, 0.05);
  });
};

export const playSelectSound = () => {
  playSample(SOUND_ASSETS.select, 0.35, varyRate(1.0, 0.03), () => {
    playTone("triangle", 600, 200, 0.1, 0.1);
  });
};

export const playDiceRollStartSound = () => {
  playSample(SOUND_ASSETS.diceRoll, 0.55, varyRate(1.0, 0.04), () => {
    playTone("triangle", 180, 520, 0.12, 0.08);
  });
};

export const playDiceResultSound = () => {
  playSample(SOUND_ASSETS.diceResult, 0.48, varyRate(1.0, 0.04), () => {
    playTone("square", 760, 320, 0.14, 0.07);
  });
};

export const playTokenStepSound = () => {
  playSample(SOUND_ASSETS.tokenStep, 0.34, varyRate(1.08, 0.06), () => {
    playTone("sine", 220, 170, 0.055, 0.045);
  });
};

export const playTokenLandingSound = () => {
  playSample(SOUND_ASSETS.tokenLand, 0.5, varyRate(1.0, 0.04), () => {
    playTone("triangle", 240, 120, 0.11, 0.08);
  });
};

export const playGatePassSound = () => {
  playSample(SOUND_ASSETS.gatePass, 0.33, varyRate(1.0, 0.025), () => {
    playTone("triangle", 720, 980, 0.08, 0.045);
  });
};

export const playRoundStartSound = () => {
  playSample(SOUND_ASSETS.roundStart, 0.46, varyRate(1.0, 0.03), () => {
    playTone("sawtooth", 320, 640, 0.16, 0.06);
  });
};

export const playPlaylistLaunchSound = () => {
  playSample(SOUND_ASSETS.playlistLaunch, 0.7, varyRate(1.0, 0.03), playRoundStartSound);
};

export const playPerkActionSound = () => {
  playSample(SOUND_ASSETS.perkAction, 0.4, varyRate(1.0, 0.05), () => {
    playTone("triangle", 540, 780, 0.12, 0.07);
  });
};

export const playRoundRewardSound = () => {
  playSample(SOUND_ASSETS.roundReward, 0.82, varyRate(1.0, 0.02), () => {
    playTone("triangle", 520, 820, 0.16, 0.08);
    setTimeout(() => playTone("triangle", 760, 1040, 0.2, 0.07), 90);
    setTimeout(() => playTone("sine", 900, 1260, 0.24, 0.06), 170);
  });
};

export const playRoundRewardTickSound = () => {
  playSample(SOUND_ASSETS.select, 0.2, varyRate(1.22, 0.04), () => {
    playTone("square", 840, 980, 0.06, 0.035);
  });
};

export const playAntiPerkBeatSound = () => {
  initAudio();
  if (!audioCtx) return;

  const now = audioCtx.currentTime;
  const bodyOsc = audioCtx.createOscillator();
  const transientOsc = audioCtx.createOscillator();
  const bodyGain = audioCtx.createGain();
  const transientGain = audioCtx.createGain();
  retainAudioNode();
  retainAudioNode();

  bodyOsc.type = "sine";
  bodyOsc.frequency.setValueAtTime(120, now);
  bodyOsc.frequency.exponentialRampToValueAtTime(46, now + 0.09);

  const finalBodyVolume = 0.18 * globalSfxVolume;
  bodyGain.gain.setValueAtTime(0.0001, now);
  bodyGain.gain.exponentialRampToValueAtTime(finalBodyVolume, now + 0.008);
  bodyGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.11);

  transientOsc.type = "triangle";
  transientOsc.frequency.setValueAtTime(950, now);
  transientOsc.frequency.exponentialRampToValueAtTime(220, now + 0.028);

  const finalTransientVolume = 0.045 * globalSfxVolume;
  transientGain.gain.setValueAtTime(0.0001, now);
  transientGain.gain.exponentialRampToValueAtTime(finalTransientVolume, now + 0.002);
  transientGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.025);

  bodyOsc.connect(bodyGain);
  transientOsc.connect(transientGain);
  bodyGain.connect(audioCtx.destination);
  transientGain.connect(audioCtx.destination);
  bodyOsc.onended = () => {
    bodyOsc.disconnect();
    bodyGain.disconnect();
    releaseAudioNode();
  };
  transientOsc.onended = () => {
    transientOsc.disconnect();
    transientGain.disconnect();
    releaseAudioNode();
  };

  bodyOsc.start(now);
  transientOsc.start(now);
  bodyOsc.stop(now + 0.12);
  transientOsc.stop(now + 0.03);
};

export const playConverterMarkInSound = () => {
  playSample(SOUND_ASSETS.converterMarkIn, 0.35, varyRate(1.02, 0.04), playSelectSound);
};

export const playConverterMarkOutSound = () => {
  playSample(SOUND_ASSETS.converterMarkOut, 0.35, varyRate(1.02, 0.04), playSelectSound);
};

export const playConverterSegmentAddSound = () => {
  playSample(SOUND_ASSETS.converterSegmentAdd, 0.42, varyRate(1.0, 0.03), playRoundStartSound);
};

export const playConverterSegmentDeleteSound = () => {
  playSample(SOUND_ASSETS.converterSegmentDelete, 0.4, varyRate(0.98, 0.03), playPerkActionSound);
};

export const playConverterZoomSound = () => {
  playSample(SOUND_ASSETS.converterZoom, 0.25, varyRate(1.0, 0.04), playHoverSound);
};

export const playConverterAutoDetectSound = () => {
  playSample(SOUND_ASSETS.converterAutoDetect, 0.35, varyRate(1.0, 0.03), playRoundStartSound);
};

export const playConverterValidationErrorSound = () => {
  playSample(SOUND_ASSETS.converterValidationError, 0.38, varyRate(1.0, 0.02), () => {
    playTone("square", 400, 220, 0.12, 0.08);
  });
};

export const playConverterSaveSuccessSound = () => {
  playSample(SOUND_ASSETS.converterSaveSuccess, 0.45, varyRate(1.0, 0.02), playRoundRewardSound);
};

export const playMapPlaceNodeSound = () => {
  playSample(SOUND_ASSETS.mapEditorPlaceNode, 0.42, varyRate(1.0, 0.03), playSelectSound);
};

export const playMapDeleteNodeSound = () => {
  playSample(
    SOUND_ASSETS.mapEditorDeleteNode,
    0.4,
    varyRate(0.96, 0.03),
    playConverterValidationErrorSound
  );
};

export const playMapConnectNodesSound = () => {
  playSample(SOUND_ASSETS.mapEditorConnectNodes, 0.38, varyRate(1.01, 0.02), playSelectSound);
};

export const playMapDisconnectNodesSound = () => {
  playSample(SOUND_ASSETS.mapEditorDisconnectNodes, 0.38, varyRate(1.01, 0.03), playSelectSound);
};

export const playMapInvalidActionSound = () => {
  playSample(
    SOUND_ASSETS.mapEditorInvalidAction,
    0.4,
    varyRate(1.0, 0.02),
    playConverterValidationErrorSound
  );
};

export const playMapSaveSound = () => {
  playSample(SOUND_ASSETS.mapEditorSave, 0.44, varyRate(1.0, 0.02), playRoundRewardSound);
};

export const playMapUndoRedoSound = () => {
  playSample(SOUND_ASSETS.mapEditorUndoRedo, 0.34, varyRate(1.0, 0.02), playHoverSound);
};
