export const UPDATE_CHANNEL_KEY = "app.updates.channel";
export const UPDATE_CHANNEL_CHANGED_EVENT = "fland:update-channel-changed";
export const DEFAULT_UPDATE_CHANNEL = "release";

export type UpdateChannel = "none" | "release" | "prerelease";

export function normalizeUpdateChannel(value: unknown): UpdateChannel {
  return value === "none" || value === "prerelease" ? value : DEFAULT_UPDATE_CHANNEL;
}
