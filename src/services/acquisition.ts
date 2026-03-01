import { trpc } from "./trpc";

export type AcquisitionSettings = Awaited<ReturnType<typeof trpc.acquisition.getSettings.query>>;
export type AcquisitionSource = Awaited<
  ReturnType<typeof trpc.acquisition.listSources.query>
>[number];
export type AcquisitionFile = Awaited<
  ReturnType<typeof trpc.acquisition.listSourceFiles.query>
>[number];
export type AcquisitionJob = Awaited<ReturnType<typeof trpc.acquisition.listJobs.query>>[number];

export const acquisition = {
  getSettings: () => trpc.acquisition.getSettings.query(),
  updateSettings: (input: Parameters<typeof trpc.acquisition.updateSettings.mutate>[0]) =>
    trpc.acquisition.updateSettings.mutate(input),
  openDownloadRoot: () => trpc.acquisition.openDownloadRoot.mutate(),
  listSources: () => trpc.acquisition.listSources.query(),
  listSourceFiles: (sourceId: string) => trpc.acquisition.listSourceFiles.query({ sourceId }),
  listJobs: () => trpc.acquisition.listJobs.query(),
  createTorrentSource: (uri: string, name?: string) =>
    trpc.acquisition.createTorrentSource.mutate({ uri, name }),
  inspectTorrentFile: (filePath: string) =>
    trpc.acquisition.inspectTorrentFile.mutate({ filePath }),
  createMegaSource: (publicUrl: string, name?: string) =>
    trpc.acquisition.createMegaSource.mutate({ publicUrl, name }),
  updateSource: (input: Parameters<typeof trpc.acquisition.updateSource.mutate>[0]) =>
    trpc.acquisition.updateSource.mutate(input),
  refreshSource: (sourceId: string) => trpc.acquisition.refreshSourceCatalog.mutate({ sourceId }),
  deleteSource: (sourceId: string, detach = false) =>
    trpc.acquisition.deleteSource.mutate({ sourceId, detach }),
  queueFiles: (sourceId: string, paths: string[], addCompletedToLibrary = true) =>
    trpc.acquisition.queueFiles.mutate({ sourceId, paths, addCompletedToLibrary }),
  pauseJob: (jobId: string) => trpc.acquisition.pauseJob.mutate({ jobId }),
  resumeJob: (jobId: string) => trpc.acquisition.resumeJob.mutate({ jobId }),
  retryJob: (jobId: string) => trpc.acquisition.retryJob.mutate({ jobId }),
  cancelJob: (jobId: string) => trpc.acquisition.cancelJob.mutate({ jobId }),
  removeJob: (jobId: string) => trpc.acquisition.removeJob.mutate({ jobId }),
  removeJobData: (jobId: string) => trpc.acquisition.removeJobData.mutate({ jobId }),
  analyzeExportAcquisition: (
    input: Parameters<typeof trpc.acquisition.analyzeExportAcquisition.query>[0]
  ) => trpc.acquisition.analyzeExportAcquisition.query(input),
  autoLinkExportAcquisition: (
    input: Parameters<typeof trpc.acquisition.autoLinkExportAcquisition.mutate>[0]
  ) => trpc.acquisition.autoLinkExportAcquisition.mutate(input),
  analyzeUnresolvedImport: (roundIds: string[]) =>
    trpc.acquisition.analyzeUnresolvedImport.query({ roundIds }),
  approveImportDownloads: (
    selections: Parameters<typeof trpc.acquisition.approveImportDownloads.mutate>[0]["selections"]
  ) => trpc.acquisition.approveImportDownloads.mutate({ selections }),
};
