import { expect, it, vi } from "vitest";
vi.mock("../services/eroscripts", () => ({
  downloadEroScriptsFunscript: vi.fn(),
  downloadEroScriptsVideo: vi.fn(),
}));
import { createEroScriptsDownloads } from "../services/eroscriptsDownloads";

it("returns immediately for long video downloads, deduplicates and exposes completed media", async () => {
  let finish!: (value: {
    filePath: string;
    videoUri: string;
    filename: string;
    title: null;
    cached: boolean;
  }) => void;
  const video = vi.fn(
    () =>
      new Promise<Parameters<typeof finish>[0]>((resolve) => {
        finish = resolve;
      })
  );
  const downloads = createEroScriptsDownloads({ video, funscript: vi.fn() });
  const input = { kind: "video" as const, topicId: 1, url: "https://example.com/video.mp4" };
  const job = downloads.start(input);
  expect(job.status).toBe("running");
  expect(downloads.start(input).id).toBe(job.id);
  await vi.waitFor(() => expect(video).toHaveBeenCalledOnce());
  finish({
    filePath: "video.mp4",
    videoUri: "app://media/video.mp4",
    filename: "video.mp4",
    title: null,
    cached: false,
  });
  await vi.waitFor(() => expect(downloads.get(job.id).status).toBe("completed"));
  expect(downloads.get(job.id).result).toMatchObject({ videoUri: "app://media/video.mp4" });
  expect(downloads.get(job.id).finishedAt).toBeTruthy();
  const detached = downloads.list();
  detached[0].status = "failed";
  expect(downloads.get(job.id).status).toBe("completed");
});

it("records failures and validates script filenames without unhandled rejections", async () => {
  const downloads = createEroScriptsDownloads({
    video: vi.fn(),
    funscript: vi.fn(async () => {
      throw new Error("Session expired");
    }),
  });
  const input = {
    kind: "funscript" as const,
    topicId: 1,
    url: "https://example.com/script.funscript",
  };
  expect(() => downloads.start(input)).toThrow("filename");
  const job = downloads.start({ ...input, filename: "script.funscript" });
  await vi.waitFor(() => expect(downloads.get(job.id).status).toBe("failed"));
  expect(downloads.get(job.id)).toMatchObject({ error: "Session expired", result: null });
  expect(() => downloads.get("missing")).toThrow("not found");
});

it("bounds concurrent jobs without interrupting existing downloads", () => {
  const downloads = createEroScriptsDownloads({
    video: vi.fn(() => new Promise<never>(() => {})),
    funscript: vi.fn(),
  });
  for (let i = 0; i < 4; i++)
    downloads.start({ kind: "video", topicId: 1, url: `https://example.com/${i}.mp4` });
  expect(() =>
    downloads.start({ kind: "video", topicId: 1, url: "https://example.com/5.mp4" })
  ).toThrow("Four downloads");
  expect(downloads.list()).toHaveLength(4);
});
