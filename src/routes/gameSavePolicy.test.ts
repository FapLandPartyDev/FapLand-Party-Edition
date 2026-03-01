import { describe, expect, it } from "vitest";
import {
  resolveSessionStartedAtMs,
  shouldClearSinglePlayerSaveOnCompletion,
} from "./gameSavePolicy";

describe("resolveSessionStartedAtMs", () => {
  it("starts a new session at the current time", () => {
    expect(resolveSessionStartedAtMs(null, 50_000)).toBe(50_000);
  });

  it("keeps elapsed playtime while excluding time spent away after saving", () => {
    expect(
      resolveSessionStartedAtMs(
        {
          sessionStartedAtMs: 10_000,
          savedAtMs: 25_000,
        },
        100_000
      )
    ).toBe(85_000);
  });

  it("does not produce negative elapsed playtime for an invalid saved clock", () => {
    expect(
      resolveSessionStartedAtMs(
        {
          sessionStartedAtMs: 30_000,
          savedAtMs: 25_000,
        },
        100_000
      )
    ).toBe(100_000);
  });
});

describe("shouldClearSinglePlayerSaveOnCompletion", () => {
  it("clears the save only for successful finishes", () => {
    expect(shouldClearSinglePlayerSaveOnCompletion("finished")).toBe(true);
    expect(shouldClearSinglePlayerSaveOnCompletion("self_reported_cum")).toBe(false);
    expect(shouldClearSinglePlayerSaveOnCompletion("cum_instruction_failed")).toBe(false);
    expect(shouldClearSinglePlayerSaveOnCompletion(null)).toBe(false);
  });
});
