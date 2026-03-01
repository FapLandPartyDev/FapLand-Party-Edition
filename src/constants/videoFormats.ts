const VIDEO_EXTENSIONS = [
  "3g2",
  "3gp",
  "asf",
  "avi",
  "divx",
  "f4v",
  "flv",
  "hevc",
  "h265",
  "m2ts",
  "m2v",
  "m4v",
  "mkv",
  "mov",
  "mp4",
  "mpeg",
  "mpg",
  "mts",
  "mxf",
  "ogm",
  "ogv",
  "rm",
  "rmvb",
  "ts",
  "vob",
  "webm",
  "wmv",
  "xvid",
] as const;

export const SUPPORTED_VIDEO_EXTENSIONS = [...VIDEO_EXTENSIONS];

const VIDEO_EXTENSION_SET = new Set<string>(SUPPORTED_VIDEO_EXTENSIONS);

export const VIDEO_CONTENT_TYPE_BY_EXTENSION: Record<string, string> = {
  "3g2": "video/3gpp2",
  "3gp": "video/3gpp",
  asf: "video/x-ms-asf",
  avi: "video/x-msvideo",
  f4v: "video/x-f4v",
  flv: "video/x-flv",
  m2ts: "video/mp2t",
  m2v: "video/mpeg",
  m4v: "video/x-m4v",
  mkv: "video/x-matroska",
  mov: "video/quicktime",
  mp4: "video/mp4",
  mpeg: "video/mpeg",
  mpg: "video/mpeg",
  mts: "video/mp2t",
  mxf: "video/mp4",
  ogm: "video/ogg",
  ogv: "video/ogg",
  ts: "video/mp2t",
  vob: "video/dvd",
  webm: "video/webm",
  wmv: "video/x-ms-wmv",
};

function normalizeExtension(extension: string): string {
  return extension.trim().toLowerCase().replace(/^\./, "");
}

function extractExtensionFromPath(pathname: string): string | null {
  const normalized = pathname.trim();
  if (!normalized) return null;

  const withoutQueryOrFragment = normalized.split(/[?#]/, 1)[0] ?? "";
  const fileName = withoutQueryOrFragment.split("/").pop() ?? "";
  if (!fileName) return null;

  const decodedFileName = (() => {
    try {
      return decodeURIComponent(fileName);
    } catch {
      return fileName;
    }
  })();

  const dotIndex = decodedFileName.lastIndexOf(".");
  if (dotIndex < 0 || dotIndex === decodedFileName.length - 1) return null;

  return normalizeExtension(decodedFileName.slice(dotIndex + 1));
}

export function getVideoExtensionFromPath(pathname: string): string | null {
  const extension = extractExtensionFromPath(pathname);
  if (!extension) return null;
  return isVideoExtension(extension) ? extension : null;
}

export function isVideoExtension(extension: string): boolean {
  const normalized = normalizeExtension(extension);
  return VIDEO_EXTENSION_SET.has(normalized);
}

export function isLikelyVideoUrl(url: string): boolean {
  const trimmed = url.trim();
  if (!trimmed) return false;

  try {
    return getVideoExtensionFromPath(new URL(trimmed).pathname) !== null;
  } catch {
    return getVideoExtensionFromPath(trimmed) !== null;
  }
}

export function getVideoContentTypeByExtension(extension: string): string | null {
  const normalized = normalizeExtension(extension);
  return VIDEO_CONTENT_TYPE_BY_EXTENSION[normalized] ?? null;
}
