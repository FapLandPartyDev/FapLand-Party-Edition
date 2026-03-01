// @vitest-environment node

import { describe, expect, it } from "vitest";
import { isSupportedVideoFileExtension } from "./installer";

describe("installer video extension support", () => {
  it("keeps existing baseline support", () => {
    expect(isSupportedVideoFileExtension(".mp4")).toBe(true);
    expect(isSupportedVideoFileExtension(".webm")).toBe(true);
    expect(isSupportedVideoFileExtension(".mkv")).toBe(true);
  });

  it("includes broader container/codec-oriented extensions", () => {
    expect(isSupportedVideoFileExtension(".hevc")).toBe(true);
    expect(isSupportedVideoFileExtension(".m2ts")).toBe(true);
    expect(isSupportedVideoFileExtension(".wmv")).toBe(true);
  });

  it("rejects non-video extensions", () => {
    expect(isSupportedVideoFileExtension(".funscript")).toBe(false);
    expect(isSupportedVideoFileExtension(".txt")).toBe(false);
  });
});
