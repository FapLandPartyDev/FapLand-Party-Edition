import { describe, expect, it } from "vitest";
import { getPlaylistLaunchProgress, PLAYLIST_LAUNCH_MIN_DURATION_MS } from "./playlistLaunch";

describe("getPlaylistLaunchProgress", () => {
  it("reaches the handoff point at the minimum launch duration", () => {
    expect(getPlaylistLaunchProgress(0)).toBe(0);
    expect(getPlaylistLaunchProgress(PLAYLIST_LAUNCH_MIN_DURATION_MS)).toBeCloseTo(0.78);
  });

  it("keeps moving slowly while route preparation takes longer", () => {
    const atMinimum = getPlaylistLaunchProgress(PLAYLIST_LAUNCH_MIN_DURATION_MS);
    const whileWaiting = getPlaylistLaunchProgress(PLAYLIST_LAUNCH_MIN_DURATION_MS + 4000);

    expect(whileWaiting).toBeGreaterThan(atMinimum);
    expect(whileWaiting).toBeLessThan(0.88);
  });
});
