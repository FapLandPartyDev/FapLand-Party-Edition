import fs from "node:fs";
import path from "node:path";
import { app } from "electron";
import {
  DEFAULT_YT_DLP_BINARY_PREFERENCE,
  normalizeYtDlpBinaryPreference,
  YT_DLP_BINARY_PREFERENCE_KEY,
  type YtDlpBinaryPreference,
} from "../../../src/constants/ytDlpSettings";
import { getStore } from "../store";
import { runCommand } from "../phash/extract";
import type { YtDlpBinary } from "./types";

const binariesPromiseByPreference = new Map<YtDlpBinaryPreference, Promise<YtDlpBinary>>();

type YtDlpProbeResult = {
  binary: YtDlpBinary | null;
  attempts: string[];
};

function getBundledBinaryRelativePath(): string | null {
  if (process.platform === "win32") {
    return path.join("yt-dlp", "win32-x64", "yt-dlp.exe");
  }
  if (process.platform === "linux") {
    return path.join("yt-dlp", "linux-x64", "yt-dlp");
  }
  return null;
}

function isExecutablePath(filePath: string | null | undefined): filePath is string {
  if (!filePath || typeof filePath !== "string") return false;
  if (!filePath.trim()) return false;
  try {
    fs.accessSync(filePath, process.platform === "win32" ? fs.constants.F_OK : fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function isUsableYtDlpBinary(binary: YtDlpBinary | null | undefined): binary is YtDlpBinary {
  return Boolean(binary?.ytDlpPath && binary.version);
}

export function getSystemYtDlpCandidatePaths(env: NodeJS.ProcessEnv = process.env): string[] {
  const candidates = ["yt-dlp"];
  const home = env.HOME?.trim();
  const userProfile = env.USERPROFILE?.trim();
  const explicitOverride = env.FLAND_YT_DLP_PATH?.trim();

  if (explicitOverride) {
    candidates.unshift(explicitOverride);
  }

  if (home) {
    candidates.push(path.join(home, ".nix-profile", "bin", "yt-dlp"));
    candidates.push(path.join(home, ".local", "state", "nix", "profile", "bin", "yt-dlp"));
  }

  if (userProfile && process.platform === "win32") {
    candidates.push(path.join(userProfile, ".nix-profile", "bin", "yt-dlp.exe"));
  }

  candidates.push("/etc/profiles/per-user/root/bin/yt-dlp");
  candidates.push("/run/current-system/sw/bin/yt-dlp");
  candidates.push("/nix/var/nix/profiles/default/bin/yt-dlp");

  return [...new Set(candidates.map((candidate) => path.normalize(candidate)))];
}

export function getBundledYtDlpCandidatePaths(
  relativePath: string,
  options?: {
    appPath?: string;
    resourcesPath?: string;
    isPackaged?: boolean;
  }
): string[] {
  const appPath = path.normalize(options?.appPath ?? app.getAppPath());
  const resourcesPath = path.normalize(options?.resourcesPath ?? process.resourcesPath);
  const isPackaged = options?.isPackaged ?? app.isPackaged;
  const candidates = [path.join(resourcesPath, relativePath), path.join(appPath, relativePath)];

  if (!isPackaged) {
    candidates.push(path.join(appPath, "build", "vendor", relativePath));
    candidates.push(path.join(path.dirname(appPath), "build", "vendor", relativePath));
  }

  return [...new Set(candidates.map((candidate) => path.normalize(candidate)))];
}

function resolveBundledYtDlpPath(): string | null {
  const relativePath = getBundledBinaryRelativePath();
  if (!relativePath) return null;

  const candidates = getBundledYtDlpCandidatePaths(relativePath);

  for (const candidate of candidates) {
    if (isExecutablePath(candidate)) {
      return candidate;
    }
  }

  return null;
}

async function readVersion(command: string): Promise<string | null> {
  const { stdout, stderr } = await runCommand(command, ["--version"]);
  const output = `${stdout.toString("utf8")}\n${stderr.toString("utf8")}`.trim();
  const versionLine = output
    .split(/\r?\n/)
    .map((entry) => entry.trim())
    .find(Boolean);
  return versionLine && versionLine.length > 0 ? versionLine : null;
}

async function probeYtDlpBinary(
  candidate: string,
  source: "bundled" | "system"
): Promise<YtDlpBinary | null> {
  const version = await readVersion(candidate);
  if (!version) return null;

  return {
    ytDlpPath: candidate,
    source,
    version,
  };
}

async function probeCandidates(
  candidates: string[],
  source: "bundled" | "system"
): Promise<YtDlpProbeResult> {
  const attempts: string[] = [];

  for (const candidate of candidates) {
    try {
      const binary = await probeYtDlpBinary(candidate, source);
      if (binary) return { binary, attempts };
      attempts.push(`${candidate}: executable launched but did not return a version`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      attempts.push(`${candidate}: ${message}`);
    }
  }

  return {
    binary: null,
    attempts,
  };
}

async function resolveBundledBinary(): Promise<YtDlpProbeResult> {
  const ytDlpPath = resolveBundledYtDlpPath();
  if (!ytDlpPath) {
    return {
      binary: null,
      attempts: ["bundled: no local bundled yt-dlp file was found"],
    };
  }

  return probeCandidates([ytDlpPath], "bundled");
}

async function resolveSystemBinary(): Promise<YtDlpProbeResult> {
  return probeCandidates(getSystemYtDlpCandidatePaths(), "system");
}

export function resetYtDlpBinaryCache(): void {
  binariesPromiseByPreference.clear();
}

export function selectYtDlpBinary(
  preference: YtDlpBinaryPreference,
  bundled: YtDlpBinary | null,
  system: YtDlpBinary | null
): YtDlpBinary {
  const usableBundled = isUsableYtDlpBinary(bundled) ? bundled : null;
  const usableSystem = isUsableYtDlpBinary(system) ? system : null;

  if (!usableBundled && !usableSystem) {
    throw new Error(
      "Unable to locate yt-dlp. Packaged builds use a bundled binary; development can fall back to a system install on PATH, common Nix profile paths, or `FLAND_YT_DLP_PATH`."
    );
  }

  if (preference === "bundled") {
    if (usableBundled) return usableBundled;
    throw new Error(
      "yt-dlp source is forced to bundled/local, but the local binary is unavailable."
    );
  }

  if (preference === "system") {
    if (usableSystem) return usableSystem;
    throw new Error(
      "yt-dlp source is forced to system, but no runnable system binary was found on PATH, common Nix profile paths, or `FLAND_YT_DLP_PATH`."
    );
  }

  if (usableBundled) return usableBundled;
  return usableSystem!;
}

export function getConfiguredYtDlpBinaryPreference(): YtDlpBinaryPreference {
  try {
    const value = getStore().get(YT_DLP_BINARY_PREFERENCE_KEY);
    return normalizeYtDlpBinaryPreference(value);
  } catch {
    return DEFAULT_YT_DLP_BINARY_PREFERENCE;
  }
}

async function resolveYtDlpBinaryInternal(preference: YtDlpBinaryPreference): Promise<YtDlpBinary> {
  const [bundledResult, systemResult] = await Promise.all([
    resolveBundledBinary(),
    resolveSystemBinary(),
  ]);

  try {
    return selectYtDlpBinary(preference, bundledResult.binary, systemResult.binary);
  } catch (error) {
    const baseMessage = error instanceof Error ? error.message : String(error);
    const details = [...bundledResult.attempts, ...systemResult.attempts];
    if (details.length === 0) {
      throw error;
    }
    throw new Error(`${baseMessage} Attempts: ${details.join(" | ")}`);
  }
}

export async function resolveYtDlpBinary(preference?: YtDlpBinaryPreference): Promise<YtDlpBinary> {
  const effectivePreference = preference ?? getConfiguredYtDlpBinaryPreference();
  const cached = binariesPromiseByPreference.get(effectivePreference);
  if (cached) return cached;

  const pending = resolveYtDlpBinaryInternal(effectivePreference).catch((error) => {
    binariesPromiseByPreference.delete(effectivePreference);
    throw error;
  });
  binariesPromiseByPreference.set(effectivePreference, pending);
  return pending;
}

export function __resetYtDlpBinaryCacheForTests(): void {
  resetYtDlpBinaryCache();
}
