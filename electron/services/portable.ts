import { app } from "electron";
import path from "node:path";

export type PortableContext = {
  env?: NodeJS.ProcessEnv;
  isPackaged?: boolean;
  platform?: NodeJS.Platform;
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

export function isPortableMode(context: PortableContext = {}): boolean {
  const platform = getContextValue(context.platform, () => process.platform);
  const isPackaged = getContextValue(context.isPackaged, () => app.isPackaged);
  const env = getContextValue(context.env, () => process.env);

  if (platform !== "win32" || !isPackaged) return false;
  return getPortableExecutableDirFromEnv(env) !== null;
}

export function getPortableExecutableDir(context: PortableContext = {}): string | null {
  const env = getContextValue(context.env, () => process.env);
  if (!isPortableMode(context)) return null;
  return getPortableExecutableDirFromEnv(env);
}

export function getPortableDataRoot(
  userDataSuffix?: string | null,
  context: PortableContext = {}
): string | null {
  const portableExecutableDir = getPortableExecutableDir(context);
  if (!portableExecutableDir) return null;

  const baseDataDir = path.join(portableExecutableDir, "data");
  const trimmedSuffix = userDataSuffix?.trim();
  return trimmedSuffix ? path.join(baseDataDir, trimmedSuffix) : baseDataDir;
}
