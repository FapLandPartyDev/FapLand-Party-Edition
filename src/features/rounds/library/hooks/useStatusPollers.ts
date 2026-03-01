import { useQuery } from "@tanstack/react-query";
import { db } from "@/services/db";
import {
  EXPORT_PACKAGE_STATUS_QUERY_KEY,
  EXPORT_STATUS_POLL_INTERVAL_MS,
  INSTALL_SCAN_POLL_INTERVAL_MS,
  INSTALL_SCAN_QUERY_KEY,
  WEB_VIDEO_CACHE_POLL_INTERVAL_MS,
  WEB_VIDEO_CACHE_QUERY_KEY,
} from "../constants";

/** Polls the install-folder scan status while a scan is running. */
export function useInstallScanStatus(options?: { enabled?: boolean; refetchOnMount?: boolean }) {
  return useQuery({
    queryKey: INSTALL_SCAN_QUERY_KEY,
    queryFn: () => db.install.getScanStatus(),
    refetchInterval: (query) => {
      const status = query.state.data;
      return status?.state === "running" ? INSTALL_SCAN_POLL_INTERVAL_MS : false;
    },
    enabled: options?.enabled,
    refetchOnMount: options?.refetchOnMount ?? true,
    staleTime: 0,
  });
}

/** Polls the library export package status while an export is running. */
export function useExportPackageStatus(running: boolean) {
  return useQuery({
    queryKey: EXPORT_PACKAGE_STATUS_QUERY_KEY,
    queryFn: () => db.install.getExportPackageStatus(),
    refetchInterval: running ? EXPORT_STATUS_POLL_INTERVAL_MS : false,
    enabled: running,
  });
}

export type WebVideoCacheSnapshot = {
  scanStatus: Awaited<ReturnType<typeof db.webVideoCache.getScanStatus>>;
  downloadProgresses: Awaited<ReturnType<typeof db.webVideoCache.getDownloadProgresses>>;
};

/** Polls the website video cache while content is pending. */
export function useWebVideoCacheStatus(enabled: boolean) {
  return useQuery<WebVideoCacheSnapshot>({
    queryKey: WEB_VIDEO_CACHE_QUERY_KEY,
    queryFn: async () => {
      const [scanStatus, downloadProgresses] = await Promise.all([
        db.webVideoCache.getScanStatus(),
        db.webVideoCache.getDownloadProgresses(),
      ]);
      return { scanStatus, downloadProgresses };
    },
    refetchInterval: enabled ? WEB_VIDEO_CACHE_POLL_INTERVAL_MS : false,
    enabled,
  });
}
