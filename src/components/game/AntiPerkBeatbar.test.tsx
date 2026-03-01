import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LiveAntiPerkBeatbar } from "./AntiPerkBeatbar";

describe("LiveAntiPerkBeatbar", () => {
  let callbacks: Map<number, FrameRequestCallback>;
  let nextFrameId: number;

  beforeEach(() => {
    callbacks = new Map();
    nextFrameId = 1;
    vi.spyOn(performance, "now").mockReturnValue(0);
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      const id = nextFrameId++;
      callbacks.set(id, callback);
      return id;
    });
    vi.stubGlobal("cancelAnimationFrame", (id: number) => callbacks.delete(id));
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("updates only its live wrapper and releases the animation frame on unmount", () => {
    let parentRenderCount = 0;
    function Parent() {
      parentRenderCount += 1;
      return (
        <LiveAntiPerkBeatbar
          actions={[]}
          beatbarBeats={[{ at: 500, lowPos: 10, fromPos: 90, strength: 1 }]}
          startedAtMs={0}
          durationMs={1_000}
          showBeatbar
          showBall={false}
          style="jackhammer"
        />
      );
    }

    const view = render(<Parent />);
    expect(parentRenderCount).toBe(1);
    const firstFrame = callbacks.get(1);
    expect(firstFrame).toBeDefined();
    vi.mocked(performance.now).mockReturnValue(100);
    callbacks.delete(1);
    act(() => firstFrame?.(100));
    expect(parentRenderCount).toBe(1);
    expect(callbacks.size).toBeGreaterThan(0);

    view.unmount();
    expect(callbacks.size).toBe(0);
  });

  it("does not schedule animation frames while hidden", () => {
    render(
      <LiveAntiPerkBeatbar
        actions={[]}
        beatbarBeats={[]}
        startedAtMs={0}
        durationMs={1_000}
        showBeatbar={false}
        showBall={false}
        style="milker"
      />
    );
    expect(callbacks.size).toBe(0);
  });
});
