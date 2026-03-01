export const UPDATE_CHANNEL_KEY = "app.updates.channel";
export const DEFAULT_UPDATE_CHANNEL = "release";

export type UpdateChannel = "release" | "prerelease";

export function normalizeUpdateChannel(value: unknown): UpdateChannel {
  return value === "prerelease" ? "prerelease" : DEFAULT_UPDATE_CHANNEL;
}
