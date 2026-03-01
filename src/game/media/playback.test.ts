import { afterEach, describe, expect, it, vi } from "vitest";
import { loadFunscriptTimeline } from "./playback";

describe("loadFunscriptTimeline", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("adds a t=0 anchor when first action starts later", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ actions: [{ at: 11538, pos: 0 }, { at: 12000, pos: 95 }] }), { status: 200 }),
    );

    const timeline = await loadFunscriptTimeline("app://media/test.funscript");
    expect(timeline).not.toBeNull();
    expect(timeline?.actions[0]).toEqual({ at: 0, pos: 0 });
    expect(timeline?.actions[1]).toEqual({ at: 11538, pos: 0 });
  });

  it("keeps scripts starting at t=0 unchanged", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ actions: [{ at: 0, pos: 50 }, { at: 100, pos: 90 }] }), { status: 200 }),
    );

    const timeline = await loadFunscriptTimeline("app://media/test2.funscript");
    expect(timeline).not.toBeNull();
    expect(timeline?.actions).toEqual([
      { at: 0, pos: 50 },
      { at: 100, pos: 90 },
    ]);
  });

  it("deduplicates concurrent fetches for the same uri", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ actions: [{ at: 100, pos: 20 }] }), { status: 200 }),
    );

    const [first, second] = await Promise.all([
      loadFunscriptTimeline("https://cdn.example.com/shared.funscript"),
      loadFunscriptTimeline("https://cdn.example.com/shared.funscript"),
    ]);

    expect(first).toEqual(second);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("reuses cached timeline for later calls", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ actions: [{ at: 120, pos: 80 }] }), { status: 200 }),
    );

    const first = await loadFunscriptTimeline("https://cdn.example.com/cached.funscript");
    const second = await loadFunscriptTimeline("https://cdn.example.com/cached.funscript");

    expect(first).toEqual(second);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("normalizes range and respects inverted scripts", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          range: 200,
          inverted: true,
          actions: [{ at: 0, pos: 200 }, { at: 100, pos: 100 }],
        }),
        { status: 200 },
      ),
    );

    const timeline = await loadFunscriptTimeline("https://cdn.example.com/range-inverted.funscript");
    expect(timeline).not.toBeNull();
    expect(timeline?.actions).toEqual([
      { at: 0, pos: 0 },
      { at: 100, pos: 50 },
    ]);
  });
});
