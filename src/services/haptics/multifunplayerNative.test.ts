import { describe, expect, it, vi } from "vitest";
import {
  admissibleRange,
  describeNativeSync,
  nativeDeviceSummary,
  type MfpNativePeer,
} from "./multifunplayerNative";

vi.mock("../trpc", () => ({ trpc: {} }));

function peer(state: Partial<NonNullable<MfpNativePeer["state"]>> = {}, driftMs = 0) {
  return {
    application: "MultiFunPlayer",
    version: null,
    protocol: 1,
    updatedAt: 1000,
    driftMs,
    state: {
      outputs: [],
      axes: [{ axis: "L0", name: "Up/Down", script: "F-Land.funscript", syncing: false }],
      playback: { media: "round.mp4", playing: true, position: 1, duration: 2, speed: 1 },
      ...state,
    },
  } satisfies MfpNativePeer;
}

describe("MultiFunPlayer native state", () => {
  it("derives the sync state from the reported axes and drift", () => {
    expect(describeNativeSync(peer(), 1000).state).toBe("synced");
    expect(describeNativeSync(peer({}, 400), 1000).state).toBe("drifting");
    expect(describeNativeSync(peer(), 10_000).state).toBe("waiting");
    expect(
      describeNativeSync(
        peer({ axes: [{ axis: "L0", name: "Up/Down", script: null, syncing: false }] }),
        1000
      ).state
    ).toBe("loading");
    expect(
      describeNativeSync(
        peer({ axes: [{ axis: "L0", name: "Up/Down", script: "a", syncing: true }] }),
        1000
      ).state
    ).toBe("syncing");
  });

  it("keeps committed ranges at least one percent wide", () => {
    expect(admissibleRange(50, 50, 40)).toEqual({ min: 49, max: 50 });
    expect(admissibleRange(50, 50, 50)).toEqual({ min: 50, max: 51 });
    expect(admissibleRange(0, 0, 3)).toEqual({ min: 0, max: 1 });
    expect(admissibleRange(100, 100, 100)).toEqual({ min: 99, max: 100 });
    expect(admissibleRange(10.4, 90.6, 10)).toEqual({ min: 10, max: 91 });
  });

  it("names connected outputs only", () => {
    const outputs = [
      { id: "a", kind: "Serial", detail: "SR6", status: "connected" as const, axes: [] },
      { id: "b", kind: "Buttplug.io", detail: null, status: "connected" as const, axes: [] },
      { id: "c", kind: "UDP", detail: "x", status: "disconnected" as const, axes: [] },
    ];
    expect(nativeDeviceSummary(peer({ outputs }))).toBe("SR6, Buttplug.io");
    expect(nativeDeviceSummary(null)).toBeNull();
  });
});
