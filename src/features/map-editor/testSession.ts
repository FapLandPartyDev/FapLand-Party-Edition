const MAP_EDITOR_TEST_PLAYLIST_ID_KEY = "mapEditor.testPlaylistId";

const canUseStorage = (): boolean => {
  return typeof window !== "undefined" && typeof window.sessionStorage !== "undefined";
};

export const setMapEditorTestSession = (playlistId: string): void => {
  if (!canUseStorage()) return;
  if (playlistId.trim().length === 0) return;
  window.sessionStorage.setItem(MAP_EDITOR_TEST_PLAYLIST_ID_KEY, playlistId);
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
};
