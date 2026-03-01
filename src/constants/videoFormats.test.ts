import { describe, expect, it } from "vitest";
import {
  SUPPORTED_VIDEO_EXTENSIONS,
  getVideoContentTypeByExtension,
  getVideoExtensionFromPath,
  isLikelyVideoUrl,
  isVideoExtension,
} from "./videoFormats";

describe("videoFormats", () => {
  it("includes current baseline extensions", () => {
    expect(SUPPORTED_VIDEO_EXTENSIONS).toEqual(
      expect.arrayContaining(["mp4", "webm", "mkv", "mov", "avi", "m4v"]),
    );
  });

  it("supports additional codec-oriented containers", () => {
    expect(isVideoExtension(".hevc")).toBe(true);
    expect(isVideoExtension(".h265")).toBe(true);
    expect(isVideoExtension("m2ts")).toBe(true);
    expect(isVideoExtension("wmv")).toBe(true);
    expect(isVideoExtension("nope")).toBe(false);
  });

  it("detects likely video urls with query and fragment", () => {
    expect(isLikelyVideoUrl("https://cdn.example.com/video.HEVC?download=1#play")).toBe(true);
    expect(isLikelyVideoUrl("app://media/%2Ftmp%2Fclip.mkv")).toBe(true);
    expect(isLikelyVideoUrl("https://cdn.example.com/image.jpg")).toBe(false);
  });

  it("extracts normalized extension from path-like values", () => {
    expect(getVideoExtensionFromPath("/tmp/folder/movie.MOV")).toBe("mov");
    expect(getVideoExtensionFromPath("https://example.com/path/file.ts?token=abc")).toBe("ts");
    expect(getVideoExtensionFromPath("/tmp/folder/file.txt")).toBeNull();
  });

  it("returns mapped content-types where available", () => {
    expect(getVideoContentTypeByExtension(".mp4")).toBe("video/mp4");
    expect(getVideoContentTypeByExtension("wmv")).toBe("video/x-ms-wmv");
    expect(getVideoContentTypeByExtension(".hevc")).toBeNull();
  });
});
