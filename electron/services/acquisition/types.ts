import * as z from "zod";

export const TORRENT_ENABLED_KEY = "acquisition.torrentEnabled";
export const DOWNLOAD_ROOT_KEY = "acquisition.downloadRootPath";
export const DOWNLOAD_LIMIT_KEY = "acquisition.downloadLimitBytesPerSec";
export const UPLOAD_LIMIT_KEY = "acquisition.uploadLimitBytesPerSec";
export const MAX_ACTIVE_KEY = "acquisition.maxActiveDownloads";
export const SEED_RATIO_KEY = "acquisition.seedRatio";
export const SEED_TIME_KEY = "acquisition.seedTimeMs";

export const DEFAULT_ACQUISITION_SETTINGS = {
  torrentEnabled: false,
  downloadRootPath: null as string | null,
  downloadLimitBytesPerSec: null as number | null,
  uploadLimitBytesPerSec: null as number | null,
  maxActiveDownloads: 2,
  seedRatio: 1 as number | null,
  seedTimeMs: (24 * 60 * 60 * 1000) as number | null,
};

export const ZAcquisitionSettings = z.object({
  torrentEnabled: z.boolean(),
  downloadRootPath: z.string().trim().min(1).nullable(),
  downloadLimitBytesPerSec: z.number().int().positive().nullable(),
  uploadLimitBytesPerSec: z.number().int().positive().nullable(),
  maxActiveDownloads: z.number().int().min(1).max(10),
  seedRatio: z.number().min(0).max(100).nullable(),
  seedTimeMs: z.number().int().positive().nullable(),
});

export type AcquisitionSettings = z.infer<typeof ZAcquisitionSettings>;

export type TorrentLocator = {
  magnetUri: string;
  infoHash: string;
  displayName: string;
  /** Local catalog hint only. Sidecar exports always contain the canonical magnet instead. */
  catalogUrl?: string;
};
export type MegaLocator = { publicUrl: string };
export type PixeldrainLocator = { publicUrl: string; directoryId: string };
export type AcquisitionLocator = TorrentLocator | MegaLocator | PixeldrainLocator;

export type CatalogFile = {
  path: string;
  name: string;
  sizeBytes: number | null;
  mediaKind: "video" | "other";
};
