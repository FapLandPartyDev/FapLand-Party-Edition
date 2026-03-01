import { beforeEach, describe, expect, it, vi } from "vitest";
import { generateRoundPreviewImageDataUri } from "./roundPreview";

const { resolvePhashBinariesMock, runCommandMock } = vi.hoisted(() => ({
  resolvePhashBinariesMock: vi.fn(),
  runCommandMock: vi.fn(),
}));

vi.mock("./phash/binaries", () => ({
  resolvePhashBinaries: resolvePhashBinariesMock,
}));

vi.mock("./phash/extract", () => ({
  runCommand: runCommandMock,
}));

describe("generateRoundPreviewImageDataUri", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resolvePhashBinariesMock.mockResolvedValue({
      ffmpegPath: "/tmp/ffmpeg",
      ffprobePath: "/tmp/ffprobe",
    });
  });

  it("extracts a higher resolution jpeg preview", async () => {
    runCommandMock.mockResolvedValue({
      stdout: Buffer.from("preview-bytes"),
      stderr: Buffer.alloc(0),
    });

    const result = await generateRoundPreviewImageDataUri({
      videoUri: "file:///tmp/video.mp4",
      startTimeMs: 5_000,
      endTimeMs: 9_000,
    });

    expect(result).toBe(`data:image/jpeg;base64,${Buffer.from("preview-bytes").toString("base64")}`);
    expect(runCommandMock).toHaveBeenCalledWith("/tmp/ffmpeg", [
      "-hide_banner",
      "-loglevel",
      "error",
      "-nostdin",
      "-ss",
      "7.000000",
      "-i",
      "/tmp/video.mp4",
      "-frames:v",
      "1",
      "-vf",
      "scale=640:-2",
      "-q:v",
      "4",
      "-f",
      "image2pipe",
      "-vcodec",
      "mjpeg",
      "-",
    ]);
  });

  it("returns null for unsupported uris", async () => {
    const result = await generateRoundPreviewImageDataUri({
      videoUri: "ftp://example.com/video.mp4",
    });

    expect(result).toBeNull();
    expect(runCommandMock).not.toHaveBeenCalled();
  });
});
