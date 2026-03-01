import { resolveConfiguredStoragePath, ACQUISITION_DOWNLOAD_RELATIVE_PATH } from "../storagePaths";
import { safeStoreGet, safeStoreSet } from "../store";
import {
  DEFAULT_ACQUISITION_SETTINGS,
  DOWNLOAD_LIMIT_KEY,
  DOWNLOAD_ROOT_KEY,
  MAX_ACTIVE_KEY,
  SEED_RATIO_KEY,
  SEED_TIME_KEY,
  TORRENT_ENABLED_KEY,
  UPLOAD_LIMIT_KEY,
  ZAcquisitionSettings,
  type AcquisitionSettings,
} from "./types";

export function getAcquisitionSettings(): AcquisitionSettings {
  const parsed = ZAcquisitionSettings.safeParse({
    torrentEnabled: safeStoreGet(TORRENT_ENABLED_KEY, false),
    downloadRootPath: safeStoreGet(DOWNLOAD_ROOT_KEY, null),
    downloadLimitBytesPerSec: safeStoreGet(DOWNLOAD_LIMIT_KEY, null),
    uploadLimitBytesPerSec: safeStoreGet(UPLOAD_LIMIT_KEY, null),
    maxActiveDownloads: safeStoreGet(MAX_ACTIVE_KEY, 2),
    seedRatio: safeStoreGet(SEED_RATIO_KEY, 1),
    seedTimeMs: safeStoreGet(SEED_TIME_KEY, 24 * 60 * 60 * 1000),
  });
  return parsed.success ? parsed.data : DEFAULT_ACQUISITION_SETTINGS;
}

export function updateAcquisitionSettings(
  patch: Partial<AcquisitionSettings>
): AcquisitionSettings {
  const next = ZAcquisitionSettings.parse({ ...getAcquisitionSettings(), ...patch });
  safeStoreSet(TORRENT_ENABLED_KEY, next.torrentEnabled);
  safeStoreSet(DOWNLOAD_ROOT_KEY, next.downloadRootPath);
  safeStoreSet(DOWNLOAD_LIMIT_KEY, next.downloadLimitBytesPerSec);
  safeStoreSet(UPLOAD_LIMIT_KEY, next.uploadLimitBytesPerSec);
  safeStoreSet(MAX_ACTIVE_KEY, next.maxActiveDownloads);
  safeStoreSet(SEED_RATIO_KEY, next.seedRatio);
  safeStoreSet(SEED_TIME_KEY, next.seedTimeMs);
  return next;
}

export function resolveAcquisitionDownloadRoot(): string {
  return resolveConfiguredStoragePath(
    getAcquisitionSettings().downloadRootPath,
    ACQUISITION_DOWNLOAD_RELATIVE_PATH
  );
}
