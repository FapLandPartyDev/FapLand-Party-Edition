import type { FunscriptTimeline } from "../../game/media/playback";
import type { AnyHapticsSession } from "./runtime";

type SyncedTrajectory = {
  source: FunscriptTimeline["actions"];
  timeline: FunscriptTimeline;
  modified: boolean;
  deviceOffsetMs: number;
};

export const syncedHapticsTrajectories = new WeakMap<AnyHapticsSession, SyncedTrajectory>();
