export const PLAYLIST_LAUNCH_MIN_DURATION_MS = 2500;

const HANDOFF_PROGRESS = 0.78;
const WAITING_PROGRESS_RANGE = 0.1;
const WAITING_PROGRESS_TIME_CONSTANT_MS = 4000;

export function getPlaylistLaunchProgress(elapsedMs: number): number {
  const safeElapsedMs = Math.max(0, elapsedMs);
  if (safeElapsedMs <= PLAYLIST_LAUNCH_MIN_DURATION_MS) {
    return (safeElapsedMs / PLAYLIST_LAUNCH_MIN_DURATION_MS) * HANDOFF_PROGRESS;
  }

  const waitingElapsedMs = safeElapsedMs - PLAYLIST_LAUNCH_MIN_DURATION_MS;
  return (
    HANDOFF_PROGRESS +
    WAITING_PROGRESS_RANGE * (1 - Math.exp(-waitingElapsedMs / WAITING_PROGRESS_TIME_CONSTANT_MS))
  );
}
