// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../services/playableVideo", () => ({
  resolvePlayableVideoUri: vi.fn(),
}));

import { resolvePlayableVideoUri } from "../../services/playableVideo";
import { mediaRouter } from "./media";

describe("mediaRouter.resolvePlayableVideoUri", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns playable uri payload", async () => {
    vi.mocked(resolvePlayableVideoUri).mockResolvedValue({
      videoUri: "app://media/%2Ftmp%2Fcached.mp4",
      transcoded: true,
      cacheHit: false,
    });

    const caller = mediaRouter.createCaller({} as any);
    const result = await caller.resolvePlayableVideoUri({
      videoUri: "app://media/%2Ftmp%2Fsource.hevc",
    });

    expect(result).toEqual({
      videoUri: "app://media/%2Ftmp%2Fcached.mp4",
      transcoded: true,
      cacheHit: false,
    });
  });

  it("maps service failures to BAD_REQUEST", async () => {
    vi.mocked(resolvePlayableVideoUri).mockRejectedValue(new Error("Transcode failed"));

    const caller = mediaRouter.createCaller({} as any);
    await expect(
      caller.resolvePlayableVideoUri({ videoUri: "app://media/%2Ftmp%2Fsource.hevc" }),
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: "Transcode failed",
    });
  });
});
