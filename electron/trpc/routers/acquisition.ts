import { TRPCError } from "@trpc/server";
import fs from "node:fs/promises";
import { shell } from "electron";
import * as z from "zod";
import {
  cancelAcquisitionJob,
  analyzeExportAcquisition,
  analyzeUnresolvedImport,
  applyAcquisitionRuntimeSettings,
  autoLinkExportAcquisition,
  approveImportDownloads,
  createMegaSource,
  createTorrentSourceFromFile,
  createTorrentSourceFromUri,
  deleteAcquisitionSource,
  getAcquisitionJob,
  listAcquisitionFiles,
  listAcquisitionJobs,
  listAcquisitionSources,
  pauseAcquisitionJob,
  queueAcquisitionFiles,
  refreshAcquisitionSource,
  removeAcquisitionJob,
  resumeAcquisitionJob,
  startAcquisitionService,
  stopTorrentNetworking,
  updateAcquisitionSource,
} from "../../services/acquisition";
import {
  getAcquisitionSettings,
  resolveAcquisitionDownloadRoot,
  updateAcquisitionSettings,
} from "../../services/acquisition/settings";
import { assertApprovedDialogPath } from "../../services/dialogPathApproval";
import { publicProcedure, router } from "../trpc";

const ZSourceId = z.string().trim().min(1).max(128);
const ZJobId = z.string().trim().min(1).max(128);
const ZSourcePath = z.string().trim().min(1).max(1024);
const ZExportSelection = z
  .object({
    roundIds: z.array(z.string().trim().min(1).max(128)).max(10_000).optional(),
    heroIds: z.array(z.string().trim().min(1).max(128)).max(10_000).optional(),
  })
  .strict();

function badRequest(error: unknown, fallback: string): never {
  throw new TRPCError({
    code: "BAD_REQUEST",
    message: error instanceof Error ? error.message : fallback,
  });
}

export const acquisitionRouter = router({
  getSettings: publicProcedure.query(() => ({
    ...getAcquisitionSettings(),
    resolvedDownloadRoot: resolveAcquisitionDownloadRoot(),
  })),

  openDownloadRoot: publicProcedure.mutation(async () => {
    const downloadRoot = resolveAcquisitionDownloadRoot();
    await fs.mkdir(downloadRoot, { recursive: true });
    const error = await shell.openPath(downloadRoot);
    if (error) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: error });
    return { path: downloadRoot };
  }),

  updateSettings: publicProcedure
    .input(
      z
        .object({
          torrentEnabled: z.boolean().optional(),
          downloadRootPath: z.string().trim().min(1).nullable().optional(),
          downloadLimitBytesPerSec: z.number().int().positive().nullable().optional(),
          uploadLimitBytesPerSec: z.number().int().positive().nullable().optional(),
          maxActiveDownloads: z.number().int().min(1).max(10).optional(),
          seedRatio: z.number().min(0).max(100).nullable().optional(),
          seedTimeMs: z.number().int().positive().nullable().optional(),
        })
        .strict()
    )
    .mutation(async ({ input }) => {
      const previous = getAcquisitionSettings();
      const updated = updateAcquisitionSettings(input);
      if (previous.torrentEnabled && !updated.torrentEnabled) {
        // The privacy toggle is a hard networking boundary, not just a UI
        // preference. Close peers and trackers before reporting success.
        await stopTorrentNetworking();
        await startAcquisitionService();
      } else if (!previous.torrentEnabled && updated.torrentEnabled) {
        await startAcquisitionService();
      } else {
        await applyAcquisitionRuntimeSettings();
      }
      return updated;
    }),

  listSources: publicProcedure.query(() => listAcquisitionSources()),
  listSourceFiles: publicProcedure
    .input(z.object({ sourceId: ZSourceId }).strict())
    .query(({ input }) => listAcquisitionFiles(input.sourceId)),
  listJobs: publicProcedure.query(() => listAcquisitionJobs()),
  getJob: publicProcedure
    .input(z.object({ jobId: ZJobId }).strict())
    .query(({ input }) => getAcquisitionJob(input.jobId)),

  createTorrentSource: publicProcedure
    .input(
      z
        .object({
          uri: z.string().trim().min(1).max(16_384),
          name: z.string().trim().min(1).max(240).optional(),
        })
        .strict()
    )
    .mutation(async ({ input }) => {
      try {
        return await createTorrentSourceFromUri(input.uri, input.name);
      } catch (error) {
        return badRequest(error, "Failed to create torrent source.");
      }
    }),

  inspectTorrentUri: publicProcedure
    .input(z.object({ uri: z.string().trim().min(1).max(16_384) }).strict())
    .mutation(async ({ input }) => {
      try {
        const source = await createTorrentSourceFromUri(input.uri);
        return { source, files: await listAcquisitionFiles(source.id) };
      } catch (error) {
        return badRequest(error, "Failed to inspect torrent.");
      }
    }),

  inspectTorrentFile: publicProcedure
    .input(z.object({ filePath: z.string().trim().min(1) }).strict())
    .mutation(async ({ input }) => {
      try {
        const approved = assertApprovedDialogPath("installSidecarFile", input.filePath);
        const source = await createTorrentSourceFromFile(approved);
        return { source, files: await listAcquisitionFiles(source.id) };
      } catch (error) {
        return badRequest(error, "Failed to inspect torrent file.");
      }
    }),

  createMegaSource: publicProcedure
    .input(
      z
        .object({
          publicUrl: z.string().url().max(16_384),
          name: z.string().trim().min(1).max(240).optional(),
        })
        .strict()
    )
    .mutation(async ({ input }) => {
      try {
        return await createMegaSource(input.publicUrl, input.name);
      } catch (error) {
        return badRequest(error, "Failed to create MEGA source.");
      }
    }),

  updateSource: publicProcedure
    .input(
      z
        .object({
          sourceId: ZSourceId,
          name: z.string().trim().min(1).max(240).optional(),
          enabled: z.boolean().optional(),
        })
        .strict()
    )
    .mutation(async ({ input }) => {
      try {
        return await updateAcquisitionSource(input);
      } catch (error) {
        return badRequest(error, "Failed to update source.");
      }
    }),
  setSourceEnabled: publicProcedure
    .input(z.object({ sourceId: ZSourceId, enabled: z.boolean() }).strict())
    .mutation(({ input }) => updateAcquisitionSource(input)),
  refreshSourceCatalog: publicProcedure
    .input(z.object({ sourceId: ZSourceId }).strict())
    .mutation(async ({ input }) => {
      try {
        return await refreshAcquisitionSource(input.sourceId);
      } catch (error) {
        return badRequest(error, "Failed to refresh source catalog.");
      }
    }),
  deleteSource: publicProcedure
    .input(z.object({ sourceId: ZSourceId, detach: z.boolean().default(false) }).strict())
    .mutation(async ({ input }) => {
      try {
        await deleteAcquisitionSource(input.sourceId, input.detach);
      } catch (error) {
        return badRequest(error, "Failed to delete source.");
      }
    }),

  queueFiles: publicProcedure
    .input(
      z
        .object({
          sourceId: ZSourceId,
          paths: z.array(ZSourcePath).min(1).max(500),
          addCompletedToLibrary: z.boolean().optional(),
        })
        .strict()
    )
    .mutation(async ({ input }) => {
      try {
        return await queueAcquisitionFiles(input);
      } catch (error) {
        return badRequest(error, "Failed to queue files.");
      }
    }),
  pauseJob: publicProcedure
    .input(z.object({ jobId: ZJobId }).strict())
    .mutation(({ input }) => pauseAcquisitionJob(input.jobId)),
  resumeJob: publicProcedure
    .input(z.object({ jobId: ZJobId }).strict())
    .mutation(({ input }) => resumeAcquisitionJob(input.jobId)),
  retryJob: publicProcedure
    .input(z.object({ jobId: ZJobId }).strict())
    .mutation(({ input }) => resumeAcquisitionJob(input.jobId)),
  cancelJob: publicProcedure
    .input(z.object({ jobId: ZJobId }).strict())
    .mutation(({ input }) => cancelAcquisitionJob(input.jobId)),
  removeJob: publicProcedure
    .input(z.object({ jobId: ZJobId }).strict())
    .mutation(({ input }) => removeAcquisitionJob(input.jobId, false)),
  removeJobData: publicProcedure
    .input(z.object({ jobId: ZJobId }).strict())
    .mutation(({ input }) => removeAcquisitionJob(input.jobId, true)),

  analyzeExportAcquisition: publicProcedure
    .input(ZExportSelection)
    .query(({ input }) => analyzeExportAcquisition(input)),
  autoLinkExportAcquisition: publicProcedure.input(ZExportSelection).mutation(async ({ input }) => {
    try {
      return await autoLinkExportAcquisition(input);
    } catch (error) {
      return badRequest(error, "Failed to link acquisition sources to the export.");
    }
  }),

  analyzeUnresolvedImport: publicProcedure
    .input(z.object({ roundIds: z.array(z.string().trim().min(1)).max(1000) }).strict())
    .query(({ input }) => analyzeUnresolvedImport(input.roundIds)),
  approveImportDownloads: publicProcedure
    .input(
      z
        .object({
          selections: z
            .array(
              z
                .object({
                  sourceId: ZSourceId,
                  path: ZSourcePath,
                  roundIds: z.array(z.string().trim().min(1)).min(1).max(1000),
                  matchKind: z.enum(["explicit", "filename"]),
                  score: z.number().min(0).max(1).nullable(),
                })
                .strict()
            )
            .max(100),
        })
        .strict()
    )
    .mutation(({ input }) => approveImportDownloads(input.selections)),
});
