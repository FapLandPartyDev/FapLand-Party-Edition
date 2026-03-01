import { randomUUID } from "node:crypto";
import { z } from "zod";
import { downloadEroScriptsFunscript, downloadEroScriptsVideo } from "./eroscripts";

export const ZEroScriptsDownload = z
  .object({
    kind: z.enum(["funscript", "video"]),
    topicId: z.number().int().positive(),
    postId: z.number().int().positive().nullable().optional(),
    url: z.string().trim().url(),
    filename: z.string().trim().min(1).optional(),
  })
  .strict()
  .refine(
    (value) => value.kind !== "funscript" || !!value.filename,
    "Funscript downloads require the candidate filename from listTopicMedia."
  );
type DownloadInput = z.infer<typeof ZEroScriptsDownload>;
type DownloadResult =
  | Awaited<ReturnType<typeof downloadEroScriptsFunscript>>
  | Awaited<ReturnType<typeof downloadEroScriptsVideo>>;
type DownloadJob = {
  id: string;
  kind: DownloadInput["kind"];
  topicId: number;
  url: string;
  status: "running" | "completed" | "failed";
  createdAt: string;
  finishedAt: string | null;
  result: DownloadResult | null;
  error: string | null;
};

// Jobs belong to this app process. No account cookies are placed in job records or MCP results.
export function createEroScriptsDownloads(
  downloaders = {
    funscript: downloadEroScriptsFunscript,
    video: downloadEroScriptsVideo,
  }
) {
  const jobs = new Map<string, DownloadJob>();
  const get = (id: string) => {
    const job = jobs.get(id);
    if (!job) throw new Error("Download job not found. Jobs do not survive an app restart.");
    return structuredClone(job);
  };
  return {
    get,
    list: () => [...jobs.values()].map((job) => structuredClone(job)),
    start: (raw: DownloadInput) => {
      const input = ZEroScriptsDownload.parse(raw);
      const duplicate = [...jobs.values()].find(
        (job) => job.status === "running" && job.kind === input.kind && job.url === input.url
      );
      if (duplicate) return get(duplicate.id);
      if ([...jobs.values()].filter((job) => job.status === "running").length >= 4)
        throw new Error("Four downloads are already running. Poll a job before starting another.");
      for (const job of jobs.values()) {
        if (jobs.size < 100) break;
        if (job.status !== "running") jobs.delete(job.id);
      }
      const job: DownloadJob = {
        id: randomUUID(),
        kind: input.kind,
        topicId: input.topicId,
        url: input.url,
        status: "running",
        createdAt: new Date().toISOString(),
        finishedAt: null,
        result: null,
        error: null,
      };
      jobs.set(job.id, job);
      void Promise.resolve()
        .then<DownloadResult>(() =>
          input.kind === "funscript"
            ? downloaders.funscript({ ...input, filename: input.filename! })
            : downloaders.video(input)
        )
        .then(
          (result) => {
            job.result = result;
            job.status = "completed";
          },
          (error: unknown) => {
            job.error = error instanceof Error ? error.message : String(error);
            job.status = "failed";
          }
        )
        .finally(() => {
          job.finishedAt = new Date().toISOString();
        });
      return get(job.id);
    },
  };
}

export const eroscriptsDownloads = createEroScriptsDownloads();
