import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { MultiFunPlayerDevicePanel } from "./MultiFunPlayerDevicePanel";
import type { MfpNativePeer } from "../services/haptics/multifunplayerNative";

const api = vi.hoisted(() => ({ setRange: { mutate: vi.fn() } }));
vi.mock("../services/trpc", () => ({ trpc: { multifunplayer: api } }));
vi.mock("../utils/audio", () => ({ playHoverSound: vi.fn(), playSelectSound: vi.fn() }));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function peer(overrides: Partial<MfpNativePeer> = {}): MfpNativePeer {
  return {
    application: "MultiFunPlayer",
    version: "0.1.0",
    protocol: 1,
    updatedAt: Date.now(),
    driftMs: 12,
    state: {
      outputs: [
        {
          id: "serial:0",
          kind: "Serial",
          detail: "/dev/ttyUSB0",
          status: "connected",
          error: null,
          rate: 60,
          axes: [
            { axis: "R0", enabled: true, minimum: 0.1, maximum: 0.9 },
            { axis: "L0", enabled: true, minimum: 0.2, maximum: 0.8 },
            { axis: "R1", enabled: false, minimum: 0, maximum: 1 },
          ],
        },
      ],
      axes: [
        { axis: "L0", name: "Up/Down", script: "F-Land.funscript", syncing: false },
        { axis: "R0", name: "Twist", script: null, syncing: false },
      ],
      playback: { media: "round.mp4", playing: true, position: 3, duration: 30, speed: 1 },
    },
    ...overrides,
  };
}

it("keeps the stroke axis in view and folds the extra axes away", () => {
  render(<MultiFunPlayerDevicePanel peer={peer()} />);
  expect(screen.getByText("/dev/ttyUSB0")).toBeTruthy();
  expect(screen.getByRole("status").textContent).toContain("In sync");
  expect(screen.getByRole("status").textContent).toContain("+12 ms");
  expect(screen.getByLabelText("/dev/ttyUSB0 Up/Down minimum")).toBeTruthy();
  expect(screen.queryByLabelText("/dev/ttyUSB0 Twist minimum")).toBeNull();

  fireEvent.click(screen.getByRole("button", { name: /Extra axes \(2\)/ }));
  expect(screen.getByLabelText("/dev/ttyUSB0 Twist minimum")).toBeTruthy();
  expect((screen.getByLabelText("/dev/ttyUSB0 R1 maximum") as HTMLButtonElement).disabled).toBe(
    true
  );
});

it("sends committed range edits to MultiFunPlayer", async () => {
  api.setRange.mutate.mockResolvedValue(true);
  render(<MultiFunPlayerDevicePanel peer={peer()} />);
  fireEvent.keyDown(screen.getByLabelText("/dev/ttyUSB0 Up/Down maximum"), {
    key: "ArrowRight",
  });
  await waitFor(() =>
    expect(api.setRange.mutate).toHaveBeenCalledWith({
      output: "serial:0",
      axis: "L0",
      minimum: 0.2,
      maximum: 0.81,
    })
  );
  expect(screen.getByText("20–81%")).toBeTruthy();
});

it("reports a player that has not loaded the round yet", () => {
  const waiting = peer();
  waiting.state!.playback.media = null;
  render(<MultiFunPlayerDevicePanel peer={waiting} />);
  expect(screen.getByRole("status").textContent).toContain("Waiting for round");
});
