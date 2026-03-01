import { afterEach, describe, expect, it, vi } from "vitest";
import { playHoverSound, resolveAssetUrl } from "./audio";

vi.mock("../services/trpc", () => ({
  trpc: {
    store: {
      get: {
        query: vi.fn(async () => 1.0),
      },
    },
  },
}));

class FakeAudio {
  currentTime = 0;
  playbackRate = 1;
  preload = "";
  src: string | undefined;
  volume = 1;

  readonly addEventListener = vi.fn(
    (type: string, listener: EventListenerOrEventListenerObject) => {
      this.listeners.set(type, listener);
    }
  );
  readonly load = vi.fn();
  readonly pause = vi.fn();
  readonly play = vi.fn(() => Promise.resolve());
  readonly removeAttribute = vi.fn((name: string) => {
    if (name === "src") {
      this.src = undefined;
    }
  });

  private readonly listeners = new Map<string, EventListenerOrEventListenerObject>();

  constructor(src?: string) {
    this.src = src;
  }

  dispatch(type: string) {
    const listener = this.listeners.get(type);
    if (!listener) return;

    const event = new Event(type);
    if (typeof listener === "function") {
      listener(event);
      return;
    }

    listener.handleEvent(event);
  }
}

describe("resolveAssetUrl", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("resolves sound assets relative to a file-based renderer build", () => {
    vi.stubGlobal("document", {
      baseURI: "file:///opt/Fap%20Land/resources/app/dist/index.html",
    });

    expect(resolveAssetUrl("/sounds/ui-hover.wav")).toBe(
      "file:///opt/Fap%20Land/resources/app/dist/sounds/ui-hover.wav"
    );
  });

  it("resolves sound assets relative to the dev server", () => {
    vi.stubGlobal("document", {
      baseURI: "http://localhost:3000/",
    });

    expect(resolveAssetUrl("/sounds/ui-hover.wav")).toBe(
      "http://localhost:3000/sounds/ui-hover.wav"
    );
  });

  it("releases transient audio elements after playback ends", async () => {
    const instances: FakeAudio[] = [];

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("decode unavailable");
      })
    );
    vi.stubGlobal("Audio", function (src?: string) {
      const audio = new FakeAudio(src);
      instances.push(audio);
      return audio;
    });
    vi.stubGlobal("document", {
      baseURI: "http://localhost:3000/",
    });

    playHoverSound();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(instances).toHaveLength(1);
    instances[0]!.dispatch("ended");

    expect(instances[0]!.pause).toHaveBeenCalledTimes(1);
    expect(instances[0]!.removeAttribute).toHaveBeenCalledWith("src");
    expect(instances[0]!.load).toHaveBeenCalledTimes(1);
  });

  it("respects the global SFX volume multiplier", async () => {
    const instances: FakeAudio[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("decode unavailable");
      })
    );
    vi.stubGlobal("Audio", function (src?: string) {
      const audio = new FakeAudio(src);
      instances.push(audio);
      return audio;
    });

    // Set global volume to 50%
    const { setGlobalSfxVolume, playHoverSound } = await import("./audio");
    setGlobalSfxVolume(0.5);

    playHoverSound(); // Base volume is 0.28
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(instances).toHaveLength(1);
    // 0.28 * 0.5 = 0.14
    expect(instances[0]!.volume).toBeCloseTo(0.14);
  });
});
