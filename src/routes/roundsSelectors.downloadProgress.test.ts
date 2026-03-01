import { describe, expect, it } from "vitest";
import type { VideoDownloadProgress } from "../services/db";
import {
  buildDownloadProgressByUri,
  getDownloadProgressForPlaybackUri,
  getWebsiteVideoTargetFromPlaybackUri,
} from "./roundsSelectors";

const progress = {
  url: "https://example.com/watch?v=one&quality=best",
  percent: 42,
} as VideoDownloadProgress;

describe("website video download progress selectors", () => {
  const progressByUri = buildDownloadProgressByUri([progress]);

  it("matches direct website URLs", () => {
    expect(getDownloadProgressForPlaybackUri(progressByUri, progress.url)).toBe(progress);
  });

  it("matches encoded website proxy URLs", () => {
    const proxyUri = `app://external/web-url?target=${encodeURIComponent(progress.url)}`;
    expect(getDownloadProgressForPlaybackUri(progressByUri, proxyUri)).toBe(progress);
  });

  it("rejects malformed, local, and stash playback URLs", () => {
    expect(
      getWebsiteVideoTargetFromPlaybackUri("app://external/web-url?target=not-a-url")
    ).toBeNull();
    expect(getDownloadProgressForPlaybackUri(progressByUri, "app://media/video.mp4")).toBeNull();
    expect(
      getDownloadProgressForPlaybackUri(
        progressByUri,
        "app://external/stash?target=https%3A%2F%2Fexample.com%2Fwatch"
      )
    ).toBeNull();
  });

  it("does not return another website's progress", () => {
    expect(
      getDownloadProgressForPlaybackUri(progressByUri, "https://example.com/watch?v=two")
    ).toBeNull();
  });
});
