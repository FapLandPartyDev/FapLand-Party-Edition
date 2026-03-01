import { beforeEach, expect, it, vi } from "vitest";
import { multifunplayerAdapter as adapter } from "./multifunplayerAdapter";
import type { HapticsConnectionConfig } from "./types";

const api = vi.hoisted(() => ({
  status: { query: vi.fn() },
  setMedia: { mutate: vi.fn() },
  update: { mutate: vi.fn() },
  clear: { mutate: vi.fn() },
}));
vi.mock("../trpc", () => ({ trpc: { multifunplayer: api } }));

const config: HapticsConnectionConfig = {
  provider: "multifunplayer",
  stroke: { min: 0.2, max: 0.8, minAbsolute: null, maxAbsolute: null },
  videoUri: "scene.mp4",
  scriptUri: "scene.funscript",
};
const actions = [
  { at: 0, pos: 0 },
  { at: 2000, pos: 100 },
];

beforeEach(() => {
  vi.resetAllMocks();
  api.status.query.mockResolvedValue({ running: true, clients: 1, runId: 1, error: null });
  api.setMedia.mutate.mockResolvedValue(undefined);
  api.update.mutate.mockResolvedValue(undefined);
  api.clear.mutate.mockResolvedValue(undefined);
});

it("requires a connected OFS player, not just a listening bridge", async () => {
  api.status.query.mockResolvedValue({ running: true, clients: 0, error: null });
  await expect(adapter.verifyConnection(config)).resolves.toMatchObject({ success: false });
  await expect(adapter.createSession(config)).rejects.toThrow("OFS player");
});

it("applies range, timing and speed, and reloads the primary script when range changes", async () => {
  const session = await adapter.createSession(config);
  await adapter.sendSync(config, session, 500, 1.5, "scene", actions);
  expect(api.setMedia.mutate).toHaveBeenCalledWith({
    key: session.key,
    videoUri: "scene.mp4",
    scriptUri: "scene.funscript",
    actions: [
      { at: 0, pos: 20 },
      { at: 2000, pos: 80 },
    ],
  });
  expect(api.update.mutate).toHaveBeenLastCalledWith({
    key: session.key,
    time: 0.5,
    duration: 2,
    speed: 1.5,
    playing: true,
  });
  await adapter.sendSync(config, session, 600, 1.5, "scene", actions);
  expect(api.setMedia.mutate).toHaveBeenCalledTimes(1);
  await adapter.sendSync(
    { ...config, stroke: { ...config.stroke, min: 0.4, max: 0.6 } },
    session,
    700,
    1,
    "scene",
    actions
  );
  expect(api.setMedia.mutate).toHaveBeenLastCalledWith(
    expect.objectContaining({
      actions: [
        { at: 0, pos: 40 },
        { at: 2000, pos: 60 },
      ],
    })
  );
});

it("pauses, stops, resumes and clears on disconnect through the hardware interface", async () => {
  const session = await adapter.createSession(config);
  await adapter.sendSync(config, session, 500, 1, "scene", actions);
  await adapter.pausePlayback(config, session);
  expect(api.update.mutate).toHaveBeenLastCalledWith(expect.objectContaining({ playing: false }));
  await adapter.resumePlayback(config, session, 700, 2);
  expect(api.update.mutate).toHaveBeenLastCalledWith(
    expect.objectContaining({ playing: true, time: 0.7, speed: 2 })
  );
  await adapter.stopPlayback(config, session);
  expect(api.update.mutate).toHaveBeenLastCalledWith(expect.objectContaining({ playing: false }));
  await adapter.disconnect!(config, session);
  expect(api.clear.mutate).toHaveBeenCalledWith({ key: session.key });
});

it("does not restart output when a script finishes loading after Stop", async () => {
  const session = await adapter.createSession(config);
  let finish!: () => void;
  api.setMedia.mutate.mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      })
  );
  const sync = adapter.sendSync(config, session, 500, 1, "scene", actions);
  await Promise.resolve();
  await adapter.stopPlayback(config, session);
  finish();
  await sync;
  expect(api.update.mutate).toHaveBeenLastCalledWith(expect.objectContaining({ playing: false }));
});

it("keeps the player paused while media is paused or buffering", async () => {
  const session = await adapter.createSession(config);
  await adapter.sendSync(config, session, 500, 1, "scene", actions, { playing: false });
  expect(api.update.mutate).toHaveBeenLastCalledWith(expect.objectContaining({ playing: false }));
  await adapter.sendSync(config, session, 600, 1, "scene", actions, { playing: true });
  expect(api.update.mutate).toHaveBeenLastCalledWith(expect.objectContaining({ playing: true }));
});

it("reloads the current scripts after the bridge restarts", async () => {
  const session = await adapter.createSession(config);
  await adapter.sendSync(config, session, 500, 1, "scene", actions);
  api.status.query.mockResolvedValue({ running: true, clients: 1, runId: 2, error: null });
  session.checkedAt = 0;
  await adapter.sendSync(config, session, 600, 1, "scene", actions);
  expect(api.setMedia.mutate).toHaveBeenCalledTimes(2);
});
