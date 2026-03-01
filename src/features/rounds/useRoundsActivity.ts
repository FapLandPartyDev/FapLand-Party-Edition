import { useCallback, useEffect, useMemo, useState } from "react";
import {
  db,
  type InstallScanStatus,
  type VideoDownloadProgress,
  type WebsiteVideoScanStatus,
} from "../../services/db";
import { buildAggregateDownloadProgress, buildDownloadProgressByUri } from "./workspaceSelectors";

type RoundsActivityState = {
  scanStatus: InstallScanStatus | null;
  websiteVideoScanStatus: WebsiteVideoScanStatus | null;
  downloadProgresses: VideoDownloadProgress[];
};

export function useRoundsActivity({
  onDataChanged,
}: {
  onDataChanged?: () => void | Promise<void>;
}) {
  const [state, setState] = useState<RoundsActivityState>({
    scanStatus: null,
    websiteVideoScanStatus: null,
    downloadProgresses: [],
  });

  const poll = useCallback(async () => {
    const [scanStatus, websiteVideoScanStatus, downloadProgresses] = await Promise.all([
      db.install.getScanStatus(),
      db.webVideoCache.getScanStatus(),
      db.webVideoCache.getDownloadProgresses(),
    ]);
    setState({ scanStatus, websiteVideoScanStatus, downloadProgresses });
    const scanRunning = scanStatus.state === "running";
    const cacheRunning =
      websiteVideoScanStatus.state === "running" || downloadProgresses.length > 0;
    if ((scanRunning || cacheRunning) && onDataChanged) {
      void onDataChanged();
    }
  }, [onDataChanged]);

  useEffect(() => {
    let mounted = true;
    let timeout: number | null = null;

    const loop = async () => {
      if (!mounted) return;
      try {
        await poll();
      } catch (error) {
        console.error("Failed to poll rounds activity", error);
      } finally {
        const hidden = typeof document !== "undefined" && document.hidden;
        const scanRunning = state.scanStatus?.state === "running";
        const cacheRunning =
          state.websiteVideoScanStatus?.state === "running" || state.downloadProgresses.length > 0;
        const delay =
          hidden && !scanRunning && !cacheRunning
            ? 10_000
            : cacheRunning || scanRunning
              ? 2_000
              : 6_000;
        timeout = window.setTimeout(loop, delay);
      }
    };

    void loop();
    return () => {
      mounted = false;
      if (timeout) {
        clearTimeout(timeout);
      }
    };
  }, [
    poll,
    state.downloadProgresses.length,
    state.scanStatus?.state,
    state.websiteVideoScanStatus?.state,
  ]);

  const downloadProgressByUri = useMemo(
    () => buildDownloadProgressByUri(state.downloadProgresses),
    [state.downloadProgresses]
  );

  return {
    ...state,
    downloadProgressByUri,
    aggregateDownloadProgress: buildAggregateDownloadProgress(state.downloadProgresses),
    refreshActivity: poll,
  };
}
