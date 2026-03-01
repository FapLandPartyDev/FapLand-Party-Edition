// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import type { AppRouter } from "../trpc/router";
import { ZPlaylistConfig } from "../../src/game/playlistSchema";
import { createLibraryTools } from "./libraryTools";

function fixture() {
  const config = ZPlaylistConfig.parse({
    boardConfig: {
      mode: "linear",
      normalRoundOrder: [
        { name: "A", idHint: "a" },
        { name: "B", idHint: "b" },
        { name: "C", idHint: "c" },
      ],
    },
    perkSelection: {},
    perkPool: {},
    probabilityScaling: {},
    economy: {},
    roundStartDelayMs: 12345,
  });
  const existing = {
    id: "round",
    name: "Original",
    author: "Author",
    description: "Description",
    tags: ["tag"],
    bpm: 120,
    difficulty: 3,
    startTime: 1200,
    endTime: 9900,
    type: "Normal",
    excludeFromRandom: true,
    libraryLabel: "Library",
  };
  const updateRound = vi.fn(async (input) => input);
  const updatePlaylist = vi.fn(async (input) => input);
  const createPlaylist = vi.fn(async (input) => input);
  const caller = {
    db: { getInstalledRoundPlaybackEntry: vi.fn(async () => existing), updateRound },
    playlist: {
      getById: vi.fn(async () => ({ id: "playlist", config })),
      update: updatePlaylist,
      create: createPlaylist,
    },
  };
  const changed = vi.fn();
  const tools = createLibraryTools(
    caller as unknown as ReturnType<AppRouter["createCaller"]>,
    changed
  );
  const run = (name: string, input: unknown) => {
    const tool = tools.find((tool) => tool.name === name)!;
    return tool.run(tool.schema.parse(input) as never);
  };
  return { existing, config, caller, updateRound, updatePlaylist, createPlaylist, changed, run };
}

describe("MCP library workflows", () => {
  it("renames and trims without clearing existing tags, metadata or trim boundaries", async () => {
    const { existing, updateRound, changed, run } = fixture();
    await run("fland_round_edit", { id: "round", name: "Renamed" });
    expect(updateRound).toHaveBeenLastCalledWith({ ...existing, name: "Renamed" });
    await run("fland_round_edit", { id: "round", startTime: 2000, endTime: 8000 });
    expect(updateRound).toHaveBeenLastCalledWith({ ...existing, startTime: 2000, endTime: 8000 });
    expect(changed).toHaveBeenCalledWith("db.updateRound");
  });
  it("keeps explicit nulls and reports missing rounds", async () => {
    const { caller, updateRound, run } = fixture();
    await run("fland_round_edit", { id: "round", author: null, endTime: null });
    expect(updateRound.mock.calls[0][0]).toMatchObject({ author: null, endTime: null });
    caller.db.getInstalledRoundPlaybackEntry.mockResolvedValueOnce(null as never);
    await expect(run("fland_round_edit", { id: "missing", name: "Name" })).rejects.toThrow(
      "not found"
    );
  });
  it("reorders a playlist and preserves unrelated game settings", async () => {
    const { config, updatePlaylist, run } = fixture();
    await run("fland_playlist_reorder", { playlistId: "playlist", order: [2, 0, 1] });
    const result = updatePlaylist.mock.calls[0][0].config;
    expect(result.boardConfig.normalRoundOrder.map((ref: { name: string }) => ref.name)).toEqual([
      "C",
      "A",
      "B",
    ]);
    expect(result.roundStartDelayMs).toBe(12345);
    expect(result.economy).toEqual(config.economy);
  });
  it("rejects duplicates, omissions and out-of-range reorder positions before writing", async () => {
    const { updatePlaylist, run } = fixture();
    for (const order of [
      [0, 0, 1],
      [0, 1],
      [0, 1, 3],
    ])
      await expect(
        run("fland_playlist_reorder", { playlistId: "playlist", order })
      ).rejects.toThrow("exactly once");
    expect(updatePlaylist).not.toHaveBeenCalled();
  });
  it("creates an advanced branching map and rejects dangling edges", async () => {
    const { createPlaylist, run } = fixture();
    const board = {
      mode: "graph",
      startNodeId: "start",
      nodes: [
        { id: "start", name: "Start", kind: "start" },
        { id: "left", name: "Left", kind: "path" },
        { id: "right", name: "Right", kind: "safePoint" },
        { id: "end", name: "End", kind: "end" },
      ],
      edges: [
        { id: "a", fromNodeId: "start", toNodeId: "left" },
        { id: "b", fromNodeId: "start", toNodeId: "right" },
        { id: "c", fromNodeId: "left", toNodeId: "end" },
        { id: "d", fromNodeId: "right", toNodeId: "end" },
      ],
    };
    await run("fland_map_create", { name: "Branching map", board });
    expect(createPlaylist).toHaveBeenCalledOnce();
    expect(createPlaylist.mock.calls[0][0].config.boardConfig.nodes).toHaveLength(4);
    expect(() =>
      run("fland_map_create", {
        name: "Invalid",
        board: { ...board, edges: [{ id: "bad", fromNodeId: "start", toNodeId: "missing" }] },
      })
    ).toThrow();
    expect(createPlaylist).toHaveBeenCalledOnce();
  });
});
