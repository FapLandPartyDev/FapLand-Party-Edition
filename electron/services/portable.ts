import { app } from "electron";
import { existsSync } from "node:fs";
import path from "node:path";

const INSTALLED_MARKER_FILENAME = ".fland-installed";

export type PortableContext = {
  env?: NodeJS.ProcessEnv;
  isPackaged?: boolean;
  platform?: NodeJS.Platform;
  execPath?: string;
  markerExists?: (markerPath: string) => boolean;
};

function getContextValue<T>(value: T | undefined, fallback: () => T): T {
  return value ?? fallback();
}

function getPortableExecutableDirFromEnv(env: NodeJS.ProcessEnv): string | null {
  const rawDir = env.PORTABLE_EXECUTABLE_DIR;
  if (typeof rawDir !== "string") return null;
  const trimmed = rawDir.trim();
  return trimmed.length > 0 ? path.resolve(trimmed) : null;
}

function getPathApi(platform: NodeJS.Platform): typeof path {
  return platform === "win32" ? path.win32 : path;
}

function getPathApiForResolvedDir(platform: NodeJS.Platform, dir: string): typeof path {
  return platform === "win32" && !dir.startsWith("/") ? path.win32 : path;
}

function trimPathSeparators(value: string): string {
  return value.replace(/[\\/]+$/u, "");
}

function splitPathSegments(value: string): string[] {
  return trimPathSeparators(value)
    .replaceAll("\\", "/")
    .split("/")
    .filter((segment) => segment.length > 0);
}

function pathEndsWithSegments(
  filePath: string,
  expectedSegments: string[],
  platform: NodeJS.Platform
): boolean {
  const actualSegments = splitPathSegments(filePath);
  if (actualSegments.length < expectedSegments.length) return false;

  const actualTail = actualSegments.slice(actualSegments.length - expectedSegments.length);
  return expectedSegments.every((segment, index) => {
    const actual = actualTail[index] ?? "";
    return platform === "win32"
      ? actual.toLowerCase() === segment.toLowerCase()
      : actual === segment;
  });
}

function isPathInsideRoot(filePath: string, rootPath: string, platform: NodeJS.Platform): boolean {
  const pathApi = getPathApiForResolvedDir(platform, rootPath);
  const normalizedRoot = pathApi.resolve(rootPath);
  const normalizedPath = pathApi.resolve(filePath);
  const relativePath = pathApi.relative(normalizedRoot, normalizedPath);
  return (
    relativePath.length === 0 ||
    (!relativePath.startsWith("..") && !pathApi.isAbsolute(relativePath))
  );
}

function getExecutableDir(context: PortableContext, platform: NodeJS.Platform): string {
  return getPathApi(platform).dirname(getContextValue(context.execPath, () => process.execPath));
}

export function normalizeUserDataSuffix(raw: string | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim().toLowerCase();
  if (trimmed.length === 0) return null;

  const sanitized = trimmed.replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "");
  return sanitized.length > 0 ? sanitized : null;
}

export function getInstalledMarkerPath(executableDir: string): string {
  const pathApi = executableDir.includes("\\") ? path.win32 : path;
  return pathApi.join(executableDir, INSTALLED_MARKER_FILENAME);
}

export function isPortableMode(context: PortableContext = {}): boolean {
  const platform = getContextValue(context.platform, () => process.platform);
  const isPackaged = getContextValue(context.isPackaged, () => app.isPackaged);
  const env = getContextValue(context.env, () => process.env);

  if (platform !== "win32" || !isPackaged) return false;

  if (getPortableExecutableDirFromEnv(env)) return true;

  const executableDir = getExecutableDir(context, platform);
  const markerExists = getContextValue(context.markerExists, () => existsSync);
  return !markerExists(getInstalledMarkerPath(executableDir));
}

export function getPortableExecutableDir(context: PortableContext = {}): string | null {
  const platform = getContextValue(context.platform, () => process.platform);
  const env = getContextValue(context.env, () => process.env);
  if (!isPortableMode(context)) return null;
  return getPortableExecutableDirFromEnv(env) ?? getExecutableDir(context, platform);
}

export function getPortableDataRoot(
  userDataSuffix?: string | null,
  context: PortableContext = {}
): string | null {
  const platform = getContextValue(context.platform, () => process.platform);
  const portableExecutableDir = getPortableExecutableDir(context);
  if (!portableExecutableDir) return null;

  const pathApi = getPathApiForResolvedDir(platform, portableExecutableDir);
  const baseDataDir = pathApi.join(portableExecutableDir, "data");
  const trimmedSuffix = userDataSuffix?.trim();
  return trimmedSuffix ? pathApi.join(baseDataDir, trimmedSuffix) : baseDataDir;
}

export function getPortableDatabasePath(
  userDataSuffix?: string | null,
  context: PortableContext = {}
): string | null {
  const platform = getContextValue(context.platform, () => process.platform);
  const portableExecutableDir = getPortableExecutableDir(context);
  if (!portableExecutableDir) return null;

  const pathApi = getPathApiForResolvedDir(platform, portableExecutableDir);
  const trimmedSuffix = userDataSuffix?.trim();
  const databaseFileName = trimmedSuffix ? `dev-${trimmedSuffix}.db` : "dev.db";
  return pathApi.join(portableExecutableDir, databaseFileName);
}

export function isPathInsidePortableDataRoot(
  filePath: string,
  userDataSuffix?: string | null,
  context: PortableContext = {}
): boolean {
  const platform = getContextValue(context.platform, () => process.platform);
  const portableDataRoot = getPortableDataRoot(userDataSuffix, context);
  if (!portableDataRoot) return false;
  return isPathInsideRoot(filePath, portableDataRoot, platform);
}

export function resolvePortableDataRelativePath(
  relativePath: string,
  userDataSuffix?: string | null,
  context: PortableContext = {}
): string | null {
  const platform = getContextValue(context.platform, () => process.platform);
  const portableDataRoot = getPortableDataRoot(userDataSuffix, context);
  if (!portableDataRoot) return null;

  const trimmedRelativePath = relativePath.trim();
  if (trimmedRelativePath.length === 0) return portableDataRoot;

  const pathApi = getPathApiForResolvedDir(platform, portableDataRoot);
  return pathApi.join(portableDataRoot, trimmedRelativePath);
}

export function resolvePortableAwareStoragePath(
  configuredPath: unknown,
  defaultRelativePath: string,
  userDataSuffix?: string | null,
  context: PortableContext = {}
): string | null {
  const platform = getContextValue(context.platform, () => process.platform);
  const portableDataRoot = getPortableDataRoot(userDataSuffix, context);
  if (!portableDataRoot) return null;

  const defaultPath = resolvePortableDataRelativePath(defaultRelativePath, userDataSuffix, context);
  if (!defaultPath) return null;

  if (typeof configuredPath !== "string" || configuredPath.trim().length === 0) {
    return defaultPath;
  }

  const trimmedConfiguredPath = configuredPath.trim();
  const pathApi = getPathApiForResolvedDir(platform, portableDataRoot);
  if (!pathApi.isAbsolute(trimmedConfiguredPath)) {
    return pathApi.join(portableDataRoot, trimmedConfiguredPath);
  }

  const trimmedSuffix = userDataSuffix?.trim();
  const expectedDefaultSegments = [
    "data",
    ...(trimmedSuffix ? [trimmedSuffix] : []),
    ...splitPathSegments(defaultRelativePath),
  ];
  if (pathEndsWithSegments(trimmedConfiguredPath, expectedDefaultSegments, platform)) {
    return defaultPath;
  }

  return pathApi.normalize(trimmedConfiguredPath);
}
