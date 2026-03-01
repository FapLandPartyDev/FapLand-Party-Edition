import { fetchScenesForTag, sanitizeStashMediaUri, toNormalizedPhash, toStashDisplayAuthor } from "../stashClient";
import { normalizeBaseUrl } from "../store";
import type { ExternalProvider, ExternalSource, ExternalSyncContext, MediaPurpose, NormalizedSceneImportItem } from "../types";

function normalizeNullableText(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function toReadableTitleCandidate(value: string | null | undefined): string | null {
  const normalized = normalizeNullableText(value);
  if (!normalized) return null;

  let decoded = normalized;
  try {
    decoded = decodeURIComponent(normalized);
  } catch {
    // Keep the original value if percent-decoding fails.
  }

  const base = decoded.replace(/\.[A-Za-z0-9]{1,8}$/u, "").trim();
  const pretty = base.replace(/[._-]+/g, " ").replace(/\s+/g, " ").trim();
  if (!pretty) return null;

  const normalizedLower = pretty.toLowerCase();
  if (normalizedLower === "stream" || normalizedLower === "scene") return null;
  if (/^\d+$/.test(pretty)) return null;

  return pretty;
}

function toSecondaryTitleFromFiles(files: Array<{ basename: string | null }>): string | null {
  for (const file of files) {
    const candidate = toReadableTitleCandidate(file.basename);
    if (candidate) return candidate;
  }

  return null;
}

function toSceneDisplayName(sceneTitle: string | null, files: Array<{ basename: string | null }>): string {
  return normalizeNullableText(sceneTitle) ?? toSecondaryTitleFromFiles(files) ?? "Untitled Scene";
}

function toExternalProxyUrl(source: ExternalSource, uri: string, purpose: MediaPurpose): string {
  const params = new URLSearchParams({
    sourceId: source.id,
    purpose,
    target: uri,
  });

  return `app://external/stash?${params.toString()}`;
}

function isUriUnderSourceBase(uri: string, source: ExternalSource): boolean {
  let target: URL;
  let base: URL;

  try {
    target = new URL(uri);
    base = new URL(normalizeBaseUrl(source.baseUrl));
  } catch {
    return false;
  }

  if (target.origin !== base.origin) return false;

  const basePath = base.pathname.endsWith("/") ? base.pathname : `${base.pathname}/`;
  return target.pathname === base.pathname || target.pathname.startsWith(basePath);
}

export const stashProvider: ExternalProvider = {
  kind: "stash",

  canHandleUri(uri: string, source: ExternalSource): boolean {
    return isUriUnderSourceBase(uri, source);
  },

  resolvePlayableUri(uri: string, source: ExternalSource, purpose: MediaPurpose): string {
    return toExternalProxyUrl(source, uri, purpose);
  },

  async syncSource(source: ExternalSource, context: ExternalSyncContext): Promise<void> {
    const seenSceneIds = new Set<string>();

    for (const selection of source.tagSelections) {
      const scenes = await fetchScenesForTag(source, selection);

      for (const scene of scenes) {
        if (seenSceneIds.has(scene.id)) continue;
        seenSceneIds.add(scene.id);

        context.onSceneSeen();

        const videoUri = sanitizeStashMediaUri(scene.paths.stream, source.baseUrl);
        if (!videoUri) continue;

        const normalized: NormalizedSceneImportItem = {
          sceneId: scene.id,
          installSourceKey: `stash:${normalizeBaseUrl(source.baseUrl)}:scene:${scene.id}`,
          roundTypeFallback: selection.roundTypeFallback,
          name: toSceneDisplayName(scene.title, scene.files),
          author: toStashDisplayAuthor(scene),
          description: normalizeNullableText(scene.details),
          phash: toNormalizedPhash(scene.files[0]?.fingerprint ?? null),
          videoUri,
          funscriptUri: sanitizeStashMediaUri(scene.paths.funscript, source.baseUrl),
        };

        await context.ingestScene(normalized);
      }
    }
  },
};
