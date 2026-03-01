import { z } from "zod";
import { ZPlaylistConfig, type PlaylistConfig } from "../../game/playlistSchema";
import type { MapEditorTestRepair } from "./buildMapEditorTestConfig";

const MAP_EDITOR_TEST_PLAYLIST_ID_KEY = "mapEditor.testPlaylistId";
const MAP_EDITOR_TEST_OVERRIDE_KEY = "mapEditor.testOverride";

export interface MapEditorTestSession {
  version: 1;
  playlistId: string;
  launchNonce: number;
  startNodeId?: string;
  config: PlaylistConfig;
  repair: MapEditorTestRepair;
}

const ZMapEditorTestSession = z.object({
  version: z.literal(1),
  playlistId: z.string().min(1),
  launchNonce: z.number().int().nonnegative(),
  startNodeId: z.string().min(1).optional(),
  config: ZPlaylistConfig,
  repair: z.object({
    omittedNodeCount: z.number().int().nonnegative(),
    omittedEdgeCount: z.number().int().nonnegative(),
    removedInvalidEdgeCount: z.number().int().nonnegative(),
    temporaryExitCount: z.number().int().nonnegative(),
    omittedAutomationCount: z.number().int().nonnegative(),
  }),
});

const canUseStorage = (): boolean => {
  return typeof window !== "undefined" && typeof window.sessionStorage !== "undefined";
};

export const setMapEditorTestSession = (playlistId: string): void => {
  if (!canUseStorage()) return;
  if (playlistId.trim().length === 0) return;
  window.sessionStorage.setItem(MAP_EDITOR_TEST_PLAYLIST_ID_KEY, playlistId);
};

export const setMapEditorTestOverride = (session: MapEditorTestSession): void => {
  if (!canUseStorage()) return;
  const normalized = ZMapEditorTestSession.parse(session);
  window.sessionStorage.setItem(MAP_EDITOR_TEST_PLAYLIST_ID_KEY, normalized.playlistId);
  window.sessionStorage.setItem(MAP_EDITOR_TEST_OVERRIDE_KEY, JSON.stringify(normalized));
};

export const getMapEditorTestOverride = (
  playlistId: string,
  launchNonce: number | null
): MapEditorTestSession | null => {
  if (!canUseStorage() || launchNonce === null) return null;
  try {
    const raw = window.sessionStorage.getItem(MAP_EDITOR_TEST_OVERRIDE_KEY);
    if (!raw) return null;
    const parsed = ZMapEditorTestSession.parse(JSON.parse(raw) as unknown);
    if (parsed.playlistId !== playlistId || parsed.launchNonce !== launchNonce) return null;
    return parsed;
  } catch {
    return null;
  }
};

export const getMapEditorTestPlaylistId = (): string | null => {
  if (!canUseStorage()) return null;
  const value = window.sessionStorage.getItem(MAP_EDITOR_TEST_PLAYLIST_ID_KEY);
  if (!value) return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

export const clearMapEditorTestSession = (): void => {
  if (!canUseStorage()) return;
  window.sessionStorage.removeItem(MAP_EDITOR_TEST_PLAYLIST_ID_KEY);
  window.sessionStorage.removeItem(MAP_EDITOR_TEST_OVERRIDE_KEY);
};
