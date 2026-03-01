import { describe, expect, it } from "vitest";
import {
  DEFAULT_BACKGROUND_PHASH_ROUNDS_PER_PASS,
  normalizeBackgroundPhashRoundsPerPass,
  normalizePreviewFfmpegSingleThreadEnabled,
} from "./phashSettings";

describe("phash settings", () => {
  it("normalizes background phash rounds per pass", () => {
    expect(normalizeBackgroundPhashRoundsPerPass(undefined)).toBe(
      DEFAULT_BACKGROUND_PHASH_ROUNDS_PER_PASS
    );
    expect(normalizeBackgroundPhashRoundsPerPass(0)).toBe(1);
    expect(normalizeBackgroundPhashRoundsPerPass(21)).toBe(20);
    expect(normalizeBackgroundPhashRoundsPerPass(4.9)).toBe(4);
    expect(normalizeBackgroundPhashRoundsPerPass("8")).toBe(8);
    expect(normalizeBackgroundPhashRoundsPerPass("bad")).toBe(
      DEFAULT_BACKGROUND_PHASH_ROUNDS_PER_PASS
    );
  });

  it("normalizes preview ffmpeg single-thread setting", () => {
    expect(normalizePreviewFfmpegSingleThreadEnabled(undefined)).toBe(false);
    expect(normalizePreviewFfmpegSingleThreadEnabled(false)).toBe(false);
    expect(normalizePreviewFfmpegSingleThreadEnabled(true)).toBe(true);
    expect(normalizePreviewFfmpegSingleThreadEnabled("true")).toBe(false);
  });
});
