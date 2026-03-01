const ABSOLUTE_PATH_RE = /^(?:[A-Za-z]:[/\\]|\/|\\\\)/;

export function isPortableRelativePath(value: string): boolean {
  const trimmed = value.trim();
  if (trimmed.length === 0) return false;
  return !ABSOLUTE_PATH_RE.test(trimmed);
}

export function formatStoragePathDisplay(
  configuredPath: string | null,
  fallbackLabel: string
): string {
  if (configuredPath === null || configuredPath === undefined) return fallbackLabel;
  const trimmed = configuredPath.trim();
  if (trimmed.length === 0) return fallbackLabel;
  if (isPortableRelativePath(trimmed)) return `./data/${trimmed}`;
  return trimmed;
}

export function isStoragePathResettable(
  configuredPath: string | null,
  portableDefault: string | null
): boolean {
  if (configuredPath === null) return false;
  if (portableDefault !== null && configuredPath.trim() === portableDefault) return false;
  return true;
}
