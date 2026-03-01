import path from "node:path";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { normalizeUserDataSuffix, resolvePortableLinkedPath } from "./portable";

const APP_MEDIA_PROTOCOL = "app:";
const APP_MEDIA_HOSTNAME = "media";

export function toLocalMediaUri(filePath: string): string {
  return `app://media/${encodeURIComponent(path.resolve(filePath))}`;
}

export function fromLocalMediaUri(uri: string): string | null {
  try {
    const parsed = new URL(uri);

    if (parsed.protocol === APP_MEDIA_PROTOCOL && parsed.hostname === APP_MEDIA_HOSTNAME) {
      const decoded = decodeURIComponent(parsed.pathname.slice(1));
      if (!decoded) return null;
      const normalized =
        process.platform === "win32" && /^\/[A-Za-z]:/.test(decoded)
          ? path.normalize(decoded.slice(1))
          : path.normalize(decoded);
      const portablePath = resolvePortableLinkedPath(
        normalized,
        normalizeUserDataSuffix(process.env.FLAND_USER_DATA_SUFFIX)
      );
      return portablePath ?? normalized;
    }

    if (parsed.protocol === "file:") {
      const normalized = path.normalize(fileURLToPath(parsed));
      const portablePath = resolvePortableLinkedPath(
        normalized,
        normalizeUserDataSuffix(process.env.FLAND_USER_DATA_SUFFIX)
      );
      return portablePath ?? normalized;
    }

    return null;
  } catch {
    return null;
  }
}

function tryDecodeURIComponent(value: string): string | null {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}

export function resolveExistingLocalMediaPath(filePath: string): string {
  if (!/%[0-9a-f]{2}/iu.test(filePath)) return filePath;
  if (existsSync(filePath)) return filePath;

  const decoded = tryDecodeURIComponent(filePath);
  if (!decoded || decoded === filePath) return filePath;

  const normalized =
    process.platform === "win32" && /^\/[A-Za-z]:/.test(decoded)
      ? path.normalize(decoded.slice(1))
      : path.normalize(decoded);
  return existsSync(normalized) ? normalized : filePath;
}

export function isLocalMediaUri(uri: string): boolean {
  return uri.startsWith("app://media/") || uri.startsWith("file://");
}

export function isPackageRelativeMediaPath(value: string): boolean {
  return value.startsWith("./") || value.startsWith("../");
}

export function resolveSidecarMediaPath(sidecarPath: string, relativePath: string): string {
  return path.normalize(path.resolve(path.dirname(sidecarPath), relativePath));
}

export function toPortableRelativePath(fromDirectory: string, toPath: string): string {
  const relativePath = path.relative(fromDirectory, toPath);
  const portable = relativePath.split(path.sep).join(path.posix.sep);
  if (portable.startsWith("./") || portable.startsWith("../")) {
    return portable;
  }
  return `./${portable}`;
}
