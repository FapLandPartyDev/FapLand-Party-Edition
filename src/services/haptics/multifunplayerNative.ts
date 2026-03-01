import { useEffect, useState } from "react";
import { trpc } from "../trpc";
import type {
  MfpNativeAxis,
  MfpNativeOutput,
  MfpNativePeer,
} from "../../../electron/services/multifunplayer";

export type { MfpNativeAxis, MfpNativeOutput, MfpNativePeer };

export const MFP_PRIMARY_AXIS = "L0";

/** MultiFunPlayer rejects output ranges narrower than one percent. */
export const MFP_MINIMUM_RANGE_PERCENT = 1;

export type MfpNativeSyncState = "waiting" | "loading" | "syncing" | "synced" | "drifting";

export type MfpNativeSync = {
  state: MfpNativeSyncState;
  driftMs: number | null;
  connectedOutputs: number;
};

/** Reports older than this mean the player stopped sending native state. */
const STALE_AFTER_MS = 3000;
/** Larger differences are visible against fast strokes. */
const DRIFT_WARNING_MS = 150;

export function isNativePeerFresh(peer: MfpNativePeer | null, now = Date.now()) {
  return peer?.updatedAt != null && now - peer.updatedAt <= STALE_AFTER_MS;
}

export function describeNativeSync(peer: MfpNativePeer, now = Date.now()): MfpNativeSync {
  const state = peer.state;
  const connectedOutputs =
    state?.outputs.filter((output) => output.status === "connected").length ?? 0;
  if (!state || !isNativePeerFresh(peer, now) || !state.playback.media) {
    return { state: "waiting", driftMs: null, connectedOutputs };
  }
  const primary = state.axes.find((axis) => axis.axis === MFP_PRIMARY_AXIS);
  if (primary && !primary.script) return { state: "loading", driftMs: null, connectedOutputs };
  if (state.axes.some((axis) => axis.syncing)) {
    return { state: "syncing", driftMs: peer.driftMs, connectedOutputs };
  }
  const drifting = peer.driftMs != null && Math.abs(peer.driftMs) > DRIFT_WARNING_MS;
  return { state: drifting ? "drifting" : "synced", driftMs: peer.driftMs, connectedOutputs };
}

export function nativeOutputName(output: MfpNativeOutput) {
  return output.detail?.trim() || output.kind;
}

export function nativeDeviceSummary(peer: MfpNativePeer | null) {
  const names =
    peer?.state?.outputs.filter((output) => output.status === "connected").map(nativeOutputName) ??
    [];
  return names.length ? names.join(", ") : null;
}

/** The primary stroke first, then the player's own axis order. */
export function orderNativeAxes(output: MfpNativeOutput) {
  const primary = output.axes.find((axis) => axis.axis === MFP_PRIMARY_AXIS) ?? output.axes[0];
  return {
    primary: primary ?? null,
    secondary: output.axes.filter((axis) => axis !== primary),
  };
}

export function toRangePercent(value: number) {
  return Math.round(value * 100);
}

/** Keeps a committed slider pair inside MultiFunPlayer's admissible span. */
export function admissibleRange(minPercent: number, maxPercent: number, previousMin: number) {
  let min = Math.max(0, Math.min(100, Math.round(minPercent)));
  let max = Math.max(0, Math.min(100, Math.round(maxPercent)));
  if (max - min < MFP_MINIMUM_RANGE_PERCENT) {
    // Stop the dragged bound one percent short of the other.
    if (min !== previousMin) min = max - MFP_MINIMUM_RANGE_PERCENT;
    else max = min + MFP_MINIMUM_RANGE_PERCENT;
    if (min < 0) [min, max] = [0, MFP_MINIMUM_RANGE_PERCENT];
    if (max > 100) [min, max] = [100 - MFP_MINIMUM_RANGE_PERCENT, 100];
  }
  return { min, max };
}

export function useMultiFunPlayerNative(intervalMs: number, enabled = true) {
  const [peer, setPeer] = useState<MfpNativePeer | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    const refresh = () => {
      void trpc.multifunplayer.status
        .query()
        .then((status) => {
          if (alive) setPeer(status.native ?? null);
        })
        .catch(() => {});
    };
    refresh();
    const timer = setInterval(refresh, intervalMs);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [enabled, intervalMs]);
  return enabled ? peer : null;
}

export async function setNativeRange(
  output: string,
  axis: string,
  minPercent: number,
  maxPercent: number
) {
  return trpc.multifunplayer.setRange.mutate({
    output,
    axis,
    minimum: minPercent / 100,
    maximum: maxPercent / 100,
  });
}
