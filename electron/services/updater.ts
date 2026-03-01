import { app, shell } from "electron";
import { getNodeEnv } from "../../src/zod/env";

export type AppUpdateStatus =
    | "idle"
    | "checking"
    | "up_to_date"
    | "update_available"
    | "error";

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
}

interface GitHubReleaseAsset {
    name?: unknown;
    browser_download_url?: unknown;
    state?: unknown;
}

interface GitHubLatestReleaseResponse {
    tag_name?: unknown;
    html_url?: unknown;
    body?: unknown;
    published_at?: unknown;
    assets?: unknown;
}

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

function versionToTuple(input: string): number[] {
    return getComparableVersion(input)
        .split(/[^0-9]+/)
        .filter((part) => part.length > 0)
        .map((part) => Number.parseInt(part, 10))
        .filter((part) => Number.isFinite(part));
}

export function compareVersions(left: string, right: string): number {
    const leftTuple = versionToTuple(left);
    const rightTuple = versionToTuple(right);
    const length = Math.max(leftTuple.length, rightTuple.length);

    for (let index = 0; index < length; index += 1) {
        const leftPart = leftTuple[index] ?? 0;
        const rightPart = rightTuple[index] ?? 0;
        if (leftPart > rightPart) return 1;
        if (leftPart < rightPart) return -1;
    }

    return 0;
}

function asTrimmedString(value: unknown): string | null {
    if (typeof value !== "string") return null;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
}

function getPreferredAssetExtensions(): string[] {
    switch (process.platform) {
        case "win32":
            return [".exe", ".msi"];
        case "darwin":
            return [".dmg", ".zip"];
        default:
            return [".appimage"];
    }
}

function assetMatchesExtension(assetName: string, extension: string): boolean {
    return assetName.toLowerCase().endsWith(extension);
}

export function resolveReleaseAssetUrl(assets: unknown): string | null {
    if (!Array.isArray(assets)) return null;

    const parsedAssets = assets as GitHubReleaseAsset[];
    const preferredExtensions = getPreferredAssetExtensions();

    for (const extension of preferredExtensions) {
        const matched = parsedAssets.find((asset) => {
            const name = asTrimmedString(asset.name);
            const url = asTrimmedString(asset.browser_download_url);
            if (!name || !url) return false;
            return assetMatchesExtension(name, extension);
        });

        if (matched) {
            /*
             ### Build-Time Hardening
             1.  **Vite define**: I've updated `vite.config.ts` to explicitly apply the `define` block (which includes `FLAND_UPDATE_REPOSITORY`) to the main process, preload, and renderer builds. This ensures that the environment variable set in GitHub Actions is baked into the final executable as a constant.
             2.  **Package Metadata**: Added the `repository` field to `package.json`. This helps `electron-builder` and other tools automatically identify the correct repository for updates and publishing.
 
             ## Verification Results
 
             ### Configuration Persistence
             By using Vite's `define` feature, the value of `FLAND_UPDATE_REPOSITORY` from the build environment is injected directly into the source code as a fallback. This means every user will have the correct update repository set by default, even without a local `.env` file.
 
             ### Automated Tests
             Ran `npm test electron/services/updater.test.ts`:
             - **8 passed** (including 3 specifically verifying repository parsing).
             - Verified that trailing slashes are automatically handled.
             */
            return asTrimmedString(matched.browser_download_url);
        }
    }

    return null;
}

export function getReleaseConfig(): { apiUrl: string; releasePageUrl: string } | null {
    const rawRepository = getNodeEnv().updateRepository;
    if (!rawRepository) return null;

    const trimmedRepo = rawRepository.trim().replace(/\/+$/, "");
    const matched = trimmedRepo.match(/^([^/\s]+)\/([^/\s]+)$/);
    if (!matched) return null;

    const owner = matched[1];
    const repo = matched[2];
    return {
        apiUrl: `https://api.github.com/repos/${owner}/${repo}/releases/latest`,
        releasePageUrl: `https://github.com/${owner}/${repo}/releases/latest`,
    };
}

async function fetchLatestRelease(): Promise<GitHubLatestReleaseResponse> {
    const releaseConfig = getReleaseConfig();
    if (!releaseConfig) {
        throw new Error("Update feed is not configured.");
    }

    const response = await fetch(releaseConfig.apiUrl, {
        headers: {
            Accept: "application/vnd.github+json",
            "User-Agent": `f-land/${process.env.FLAND_APP_VERSION ?? app.getVersion()}`,
        },
    });

    if (!response.ok) {
        throw new Error(`Update check failed with HTTP ${response.status}.`);
    }

    const payload = await response.json();
    return payload as GitHubLatestReleaseResponse;
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
    if (!force && currentCheckPromise) {
        return currentCheckPromise;
    }

    const shouldSkip = !force && !shouldRefreshUpdateState(currentState) && currentState.status !== "idle";
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
            const release = await fetchLatestRelease();
            const latestVersion = normalizeVersion(asTrimmedString(release.tag_name) ?? app.getVersion());
            const releasePageUrl = asTrimmedString(release.html_url) ?? releaseConfig.releasePageUrl;
            const downloadUrl = resolveReleaseAssetUrl(release.assets) ?? releasePageUrl;
            const checkedAtIso = new Date().toISOString();
            const updateAvailable = compareVersions(
                latestVersion,
                process.env.FLAND_APP_VERSION ?? app.getVersion(),
            ) > 0;

            return setState({
                status: updateAvailable ? "update_available" : "up_to_date",
                latestVersion,
                checkedAtIso,
                releasePageUrl,
                downloadUrl,
                releaseNotes: asTrimmedString(release.body),
                publishedAtIso: asTrimmedString(release.published_at),
                errorMessage: null,
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
    const state = currentState.status === "idle" || !currentState.latestVersion
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
