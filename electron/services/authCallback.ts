export const MULTIPLAYER_AUTH_CALLBACK_PROTOCOL = "fland:";
export const MULTIPLAYER_AUTH_CALLBACK_HOST = "auth";
export const MULTIPLAYER_AUTH_CALLBACK_PATHNAME = "/callback";

export function normalizeMultiplayerAuthCallback(raw: string): string | null {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return null;
  }

  if (parsed.protocol !== MULTIPLAYER_AUTH_CALLBACK_PROTOCOL) return null;
  if (parsed.hostname !== MULTIPLAYER_AUTH_CALLBACK_HOST) return null;
  if (parsed.pathname !== MULTIPLAYER_AUTH_CALLBACK_PATHNAME) return null;
  return parsed.toString();
}
