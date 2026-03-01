import { app, shell } from "electron";
import {
  DEFAULT_UPDATE_CHANNEL,
  UPDATE_CHANNEL_KEY,
  normalizeUpdateChannel,
  type UpdateChannel,
} from "../../src/constants/updateSettings";
import { getNodeEnv } from "../../src/zod/env";
import { isPortableMode } from "./portable";
import { getStore } from "./store";

export type AppUpdateStatus = "idle" | "checking" | "up_to_date" | "update_available" | "error";

export interface AppUpdateState {
  status: AppUpdateStatus;
  currentVersion: string;
  latestVersion: string | null;
  checkedAtIso: string | null;
  releasePageUrl: string;
  downloadUrl: string | null;
  releaseNotes: string | null;
  publishedAtIso: string | null;
  canAutoUpdate: boolean;
  errorMessage: string | null;
  multiplayerUpdateRequired?: boolean;
}

interface GitHubReleaseAsset {
  name?: unknown;
  browser_download_url?: unknown;
  state?: unknown;
}

export interface GitHubLatestReleaseResponse {
  tag_name?: unknown;
  html_url?: unknown;
  body?: unknown;
  published_at?: unknown;
  assets?: unknown;
  prerelease?: unknown;
}

type ReleaseAssetPreference = "windows-portable" | "windows-installer" | "macos" | "linux-appimage";

const CHECK_STALE_AFTER_MS = 15 * 60 * 1000;

const updateListeners = new Set<(state: AppUpdateState) => void>();

let currentState: AppUpdateState = {
  status: "idle",
  currentVersion: normalizeVersion(process.env.FLAND_APP_VERSION ?? app.getVersion()),
  latestVersion: null,
  checkedAtIso: null,
  releasePageUrl: "",
  downloadUrl: null,
  releaseNotes: null,
  publishedAtIso: null,
  canAutoUpdate: false,
  errorMessage: null,
  multiplayerUpdateRequired: false,
};

let currentCheckPromise: Promise<AppUpdateState> | null = null;

function emitState(): void {
  for (const listener of updateListeners) {
    listener(currentState);
  }
}

function setState(next: Partial<AppUpdateState>): AppUpdateState {
  const releaseConfig = getReleaseConfig();
  currentState = {
    ...currentState,
    ...next,
    currentVersion: normalizeVersion(process.env.FLAND_APP_VERSION ?? app.getVersion()),
    releasePageUrl: releaseConfig?.releasePageUrl ?? "",
    canAutoUpdate: false,
  };
  emitState();
  return currentState;
}

function normalizeVersion(input: string): string {
  return input.trim().replace(/^v/i, "");
}

function getComparableVersion(input: string): string {
  return normalizeVersion(input).split("+", 1)[0] ?? "";
}

function parseVersion(input: string): { core: number[]; prerelease: string[] | null } {
  const [corePart = "", prereleasePart] = getComparableVersion(input).split("-", 2);
  return {
    core: corePart.split(".").map((part) => Number.parseInt(part, 10) || 0),
    prerelease: prereleasePart ? prereleasePart.split(".") : null,
  };
}

function compareVersionCores(left: string, right: string): number {
  const leftCore = parseVersion(left).core;
  const rightCore = parseVersion(right).core;
  const length = Math.max(leftCore.length, rightCore.length);

  for (let index = 0; index < length; index += 1) {
    const leftPart = leftCore[index] ?? 0;
    const rightPart = rightCore[index] ?? 0;
    if (leftPart > rightPart) return 1;
    if (leftPart < rightPart) return -1;
  }

  return 0;
}

export function compareVersions(left: string, right: string): number {
  const leftVersion = parseVersion(left);
  const rightVersion = parseVersion(right);
  const length = Math.max(leftVersion.core.length, rightVersion.core.length);

  for (let index = 0; index < length; index += 1) {
    const leftPart = leftVersion.core[index] ?? 0;
    const rightPart = rightVersion.core[index] ?? 0;
    if (leftPart > rightPart) return 1;
    if (leftPart < rightPart) return -1;
  }

  if (!leftVersion.prerelease && rightVersion.prerelease) return 1;
  if (leftVersion.prerelease && !rightVersion.prerelease) return -1;
  if (!leftVersion.prerelease || !rightVersion.prerelease) return 0;

  const prereleaseLength = Math.max(leftVersion.prerelease.length, rightVersion.prerelease.length);
  for (let index = 0; index < prereleaseLength; index += 1) {
    const leftPart = leftVersion.prerelease[index];
    const rightPart = rightVersion.prerelease[index];
    if (leftPart === undefined) return -1;
    if (rightPart === undefined) return 1;
    if (leftPart === rightPart) continue;

    const leftNumeric = /^\d+$/.test(leftPart);
    const rightNumeric = /^\d+$/.test(rightPart);
    if (leftNumeric && rightNumeric) {
      return Number(leftPart) > Number(rightPart) ? 1 : -1;
    }
    if (leftNumeric !== rightNumeric) return leftNumeric ? -1 : 1;
    return leftPart > rightPart ? 1 : -1;
  }

  return 0;
}

function getReleaseIdentity(input: string): string {
  return normalizeVersion(input).split("+", 1)[0]?.toLowerCase() ?? "";
}

export function isPrereleaseVersion(input: string): boolean {
  return getReleaseIdentity(input).includes("-");
}

export function shouldUpdateToRelease(currentVersion: string, latestVersion: string): boolean {
  return compareVersionCores(latestVersion, currentVersion) > 0;
}

export function isMultiplayerUpdateRequired(
  currentVersion: string,
  latestVersion: string
): boolean {
  return (
    shouldUpdateToRelease(currentVersion, latestVersion) ||
    (isPrereleaseVersion(currentVersion) &&
      compareVersionCores(currentVersion, latestVersion) !== 0)
  );
}

function asTrimmedString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function getReleaseAssetPreference(): ReleaseAssetPreference {
  switch (process.platform) {
    case "win32":
      return isPortableMode() ? "windows-portable" : "windows-installer";
    case "darwin":
      return "macos";
    default:
      return "linux-appimage";
  }
}

function assetMatchesExtension(assetName: string, extension: string): boolean {
  return assetName.toLowerCase().endsWith(extension);
}

function isPortableAssetName(assetName: string): boolean {
  return assetName.includes("portable");
}

function isInstallerAssetName(assetName: string): boolean {
  return (
    assetName.endsWith(".msi") || assetName.includes("setup") || assetName.includes("installer")
  );
}

function toReleaseAssets(assets: unknown): Array<{ name: string; url: string }> | null {
  if (!Array.isArray(assets)) return null;
  return (assets as GitHubReleaseAsset[]).flatMap((asset) => {
    const name = asTrimmedString(asset.name);
    const url = asTrimmedString(asset.browser_download_url);
    return name && url ? [{ name, url }] : [];
  });
}

function findMatchingAsset(
  assets: Array<{ name: string; url: string }>,
  predicate: (assetName: string) => boolean,
  extensions: string[]
): string | null {
  for (const extension of extensions) {
    const matched = assets.find((asset) => {
      const normalizedName = asset.name.toLowerCase();
      return assetMatchesExtension(normalizedName, extension) && predicate(normalizedName);
    });
    if (matched) {
      return matched.url;
    }
  }
  return null;
}

export function resolveReleaseAssetUrl(
  assets: unknown,
  preference: ReleaseAssetPreference = getReleaseAssetPreference()
): string | null {
  const parsedAssets = toReleaseAssets(assets);
  if (!parsedAssets) return null;

  if (preference === "windows-portable") {
    return findMatchingAsset(parsedAssets, (assetName) => isPortableAssetName(assetName), [".zip"]);
  }

  if (preference === "windows-installer") {
    return (
      findMatchingAsset(
        parsedAssets,
        (assetName) => isInstallerAssetName(assetName) && !isPortableAssetName(assetName),
        [".exe", ".msi"]
      ) ??
      findMatchingAsset(parsedAssets, (assetName) => !isPortableAssetName(assetName), [
        ".exe",
        ".msi",
      ])
    );
  }

  if (preference === "macos") {
    return findMatchingAsset(parsedAssets, () => true, [".dmg", ".zip"]);
  }

  return findMatchingAsset(parsedAssets, () => true, [".appimage"]);
}

export function getReleaseConfig(): {
  apiUrl: string;
  releasesApiUrl: string;
  releasePageUrl: string;
} | null {
  const rawRepository = getNodeEnv().updateRepository;
  if (!rawRepository) return null;

  const trimmedRepo = rawRepository.trim().replace(/\/+$/, "");
  const matched = trimmedRepo.match(/^([^/\s]+)\/([^/\s]+)$/);
  if (!matched) return null;

  const owner = matched[1];
  const repo = matched[2];
  return {
    apiUrl: `https://api.github.com/repos/${owner}/${repo}/releases/latest`,
    releasesApiUrl: `https://api.github.com/repos/${owner}/${repo}/releases`,
    releasePageUrl: `https://github.com/${owner}/${repo}/releases/latest`,
  };
}

export function getUpdateChannel(): UpdateChannel {
  try {
    return normalizeUpdateChannel(getStore().get(UPDATE_CHANNEL_KEY));
  } catch {
    return DEFAULT_UPDATE_CHANNEL;
  }
}

async function fetchGitHubJson(url: string): Promise<unknown> {
  const response = await fetch(url, {
    headers: {
      Accept: "application/vnd.github+json",
      "User-Agent": `f-land/${process.env.FLAND_APP_VERSION ?? app.getVersion()}`,
    },
  });

  if (!response.ok) {
    throw new Error(`Update check failed with HTTP ${response.status}.`);
  }

  return response.json();
}

async function fetchLatestRelease(): Promise<GitHubLatestReleaseResponse> {
  const releaseConfig = getReleaseConfig();
  if (!releaseConfig) {
    throw new Error("Update feed is not configured.");
  }

  return (await fetchGitHubJson(releaseConfig.apiUrl)) as GitHubLatestReleaseResponse;
}

async function fetchLatestPrerelease(): Promise<GitHubLatestReleaseResponse | null> {
  const releaseConfig = getReleaseConfig();
  if (!releaseConfig) {
    throw new Error("Update feed is not configured.");
  }

  const payload = await fetchGitHubJson(`${releaseConfig.releasesApiUrl}?per_page=100`);
  if (!Array.isArray(payload)) return null;
  return (
    (payload as GitHubLatestReleaseResponse[]).find((release) => release.prerelease === true) ??
    null
  );
}

export function selectHighestRelease(
  latestRelease: GitHubLatestReleaseResponse,
  latestPrerelease: GitHubLatestReleaseResponse | null
): GitHubLatestReleaseResponse {
  if (!latestPrerelease) return latestRelease;
  const releaseVersion = asTrimmedString(latestRelease.tag_name);
  const prereleaseVersion = asTrimmedString(latestPrerelease.tag_name);
  if (!releaseVersion) return latestPrerelease;
  if (!prereleaseVersion) return latestRelease;
  return compareVersions(prereleaseVersion, releaseVersion) > 0 ? latestPrerelease : latestRelease;
}

async function fetchUpdateRelease(channel: UpdateChannel): Promise<GitHubLatestReleaseResponse> {
  const latestRelease = await fetchLatestRelease();
  if (channel !== "prerelease") {
    return latestRelease;
  }

  const latestPrerelease = await fetchLatestPrerelease();
  return selectHighestRelease(latestRelease, latestPrerelease);
}

export function shouldRefreshUpdateState(state: AppUpdateState): boolean {
  if (!state.checkedAtIso) return true;
  const checkedAtMs = Date.parse(state.checkedAtIso);
  if (!Number.isFinite(checkedAtMs)) return true;
  return Date.now() - checkedAtMs >= CHECK_STALE_AFTER_MS;
}

export function getUpdateState(): AppUpdateState {
  return currentState;
}

export function subscribeToUpdateState(listener: (state: AppUpdateState) => void): () => void {
  updateListeners.add(listener);
  listener(currentState);
  return () => {
    updateListeners.delete(listener);
  };
}

export async function checkForAppUpdates(force = false): Promise<AppUpdateState> {
  if (getUpdateChannel() === "none") {
    return setState({
      status: "idle",
      latestVersion: null,
      checkedAtIso: null,
      downloadUrl: null,
      releaseNotes: null,
      publishedAtIso: null,
      errorMessage: null,
      multiplayerUpdateRequired: false,
    });
  }

  if (!force && currentCheckPromise) {
    return currentCheckPromise;
  }

  const shouldSkip =
    !force && !shouldRefreshUpdateState(currentState) && currentState.status !== "idle";
  if (shouldSkip) {
    return currentState;
  }

  currentCheckPromise = (async () => {
    setState({
      status: "checking",
      errorMessage: null,
    });

    try {
      const releaseConfig = getReleaseConfig();
      if (!releaseConfig) {
        throw new Error("Update feed is not configured.");
      }
      const release = await fetchUpdateRelease(getUpdateChannel());
      const latestVersion = normalizeVersion(asTrimmedString(release.tag_name) ?? app.getVersion());
      const releasePageUrl = asTrimmedString(release.html_url) ?? releaseConfig.releasePageUrl;
      const downloadUrl = resolveReleaseAssetUrl(release.assets) ?? releasePageUrl;
      const checkedAtIso = new Date().toISOString();
      const updateAvailable = shouldUpdateToRelease(
        process.env.FLAND_APP_VERSION ?? app.getVersion(),
        latestVersion
      );
      const multiplayerUpdateRequired = isMultiplayerUpdateRequired(
        process.env.FLAND_APP_VERSION ?? app.getVersion(),
        latestVersion
      );

      return setState({
        status: updateAvailable ? "update_available" : "up_to_date",
        latestVersion,
        checkedAtIso,
        releasePageUrl,
        downloadUrl,
        releaseNotes: asTrimmedString(release.body),
        publishedAtIso: asTrimmedString(release.published_at),
        errorMessage: null,
        multiplayerUpdateRequired,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown update error.";
      return setState({
        status: "error",
        checkedAtIso: new Date().toISOString(),
        errorMessage: message,
      });
    } finally {
      currentCheckPromise = null;
    }
  })();

  return currentCheckPromise;
}

export async function openLatestDownload(): Promise<AppUpdateState> {
  const state =
    currentState.status === "idle" || !currentState.latestVersion
      ? await checkForAppUpdates(true)
      : currentState;

  const targetUrl = state.downloadUrl ?? state.releasePageUrl;
  if (!targetUrl) {
    throw new Error("Update feed is not configured.");
  }
  await shell.openExternal(targetUrl);
  return getUpdateState();
}

export async function initializeAppUpdater(): Promise<AppUpdateState> {
  return checkForAppUpdates(false);
}
