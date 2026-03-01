import { ZPlaylistSaveMode, type PlaylistSaveMode } from "./playlistSchema";

export { ZPlaylistSaveMode };
export type { PlaylistSaveMode };

export function isAssistedSaveMode(saveMode: PlaylistSaveMode): boolean {
  return saveMode !== "none";
}

export function getSaveModeEmoji(saveMode: PlaylistSaveMode | null | undefined): string {
  if (saveMode === "checkpoint") return "🚩";
  if (saveMode === "everywhere") return "💾";
  return "";
}

export function getSaveModeLabel(saveMode: PlaylistSaveMode): string {
  if (saveMode === "checkpoint") return "Only Checkpoint";
  if (saveMode === "everywhere") return "Everywhere";
  return "No Saves";
}

export function getAssistedTooltip(
  saveMode: PlaylistSaveMode | null | undefined
): string | undefined {
  if (saveMode === "checkpoint") {
    return "Assisted run: checkpoint saves enabled";
  }
  if (saveMode === "everywhere") {
    return "Assisted run: save anywhere enabled";
  }
  return undefined;
}
