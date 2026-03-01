import { useCallback, useRef, useState } from "react";
import { isLikelyVideoUrl } from "../constants/videoFormats";

type PlayableResolverResult = {
  videoUri: string;
  transcoded: boolean;
  cacheHit: boolean;
};

type PlayableResolver = (videoUri: string) => Promise<PlayableResolverResult>;

const defaultPlayableResolver: PlayableResolver = async (videoUri) => {
  const { resolvePlayableVideoUri } = await import("../services/mediaPlayback");
  return resolvePlayableVideoUri(videoUri);
};

function isRawWebsiteVideoPageUri(videoUri: string): boolean {
  if (videoUri.startsWith("http://") || videoUri.startsWith("https://")) {
    if (isLikelyVideoUrl(videoUri)) {
      if (videoUri.includes("/scene/") && videoUri.includes("/stream")) {
        return true;
      }
      return false;
    }
    return true;
  }
  return false;
}

function isWebsiteVideoUri(videoUri: string): boolean {
  return (
    isRawWebsiteVideoPageUri(videoUri) ||
    videoUri.startsWith("app://external/web-url?") ||
    videoUri.startsWith("app://external/stash?")
  );
}

function toWebsiteVideoProxyUri(videoUri: string): string {
  if (videoUri.includes("/scene/") && videoUri.includes("/stream")) {
    return `app://external/stash?target=${encodeURIComponent(videoUri)}`;
  }
  return `app://external/web-url?target=${encodeURIComponent(videoUri)}`;
}

function getDefaultVideoSrc(originalUri: string): string | undefined {
  if (isRawWebsiteVideoPageUri(originalUri)) {
    if (originalUri.includes("/scene/") && originalUri.includes("/stream")) {
      return originalUri;
    }
    return toWebsiteVideoProxyUri(originalUri);
  }
  return originalUri;
}

function buildForcedLocalTranscodeUri(originalUri: string): string | null {
  if (!originalUri.startsWith("app://media/")) return null;
  return `${originalUri}${originalUri.includes("?") ? "&" : "?"}transcode=1`;
}

export function isLocalVideoUriForFallback(videoUri: string): boolean {
  if (isRawWebsiteVideoPageUri(videoUri)) return true;

  return (
    videoUri.startsWith("app://media/")
    || videoUri.startsWith("file://")
    || videoUri.startsWith("app://external/")
  );
}

export function usePlayableVideoFallback(resolver: PlayableResolver = defaultPlayableResolver): {
  getVideoSrc: (originalUri: string | null | undefined) => string | undefined;
  ensurePlayableVideo: (originalUri: string | null | undefined) => Promise<string | null>;
  handleVideoError: (originalUri: string | null | undefined) => Promise<string | null>;
} {
  const fallbackByOriginalUriRef = useRef<Record<string, string>>({});
  const [, forceUpdate] = useState(0);
  const attemptedOriginalUrisRef = useRef(new Set<string>());
  const inFlightByOriginalUriRef = useRef(new Map<string, Promise<string | null>>());
  const resolverRef = useRef(resolver);
  resolverRef.current = resolver;

  const getVideoSrc = useCallback((originalUri: string | null | undefined): string | undefined => {
    if (!originalUri) return undefined;
    return fallbackByOriginalUriRef.current[originalUri] ?? getDefaultVideoSrc(originalUri);
  }, []);

  const resolveFallback = useCallback(
    async (originalUri: string | null | undefined): Promise<string | null> => {
      if (!originalUri) return null;
      if (!isLocalVideoUriForFallback(originalUri)) return null;

      const defaultVideoSrc = getDefaultVideoSrc(originalUri);
      const resolved = fallbackByOriginalUriRef.current[originalUri];
      if (resolved && resolved !== defaultVideoSrc) {
        return resolved;
      }

      const existingInFlight = inFlightByOriginalUriRef.current.get(originalUri);
      if (existingInFlight) return existingInFlight;

      const retryableWebsiteUri = isWebsiteVideoUri(originalUri);
      if (!retryableWebsiteUri && attemptedOriginalUrisRef.current.has(originalUri)) {
        return null;
      }

      const pending = (async () => {
        try {
          const result = await resolverRef.current(originalUri);
          const nextVideoUri = typeof result.videoUri === "string" ? result.videoUri : "";
          const hasReplacement = retryableWebsiteUri
            ? nextVideoUri.length > 0 && Boolean(result.cacheHit)
            : nextVideoUri.length > 0 && nextVideoUri !== defaultVideoSrc;

          if (hasReplacement) {
            if (fallbackByOriginalUriRef.current[originalUri] !== nextVideoUri) {
              fallbackByOriginalUriRef.current[originalUri] = nextVideoUri;
              forceUpdate((n) => n + 1);
            }
            attemptedOriginalUrisRef.current.add(originalUri);
            return nextVideoUri;
          }

          if (!retryableWebsiteUri || result.cacheHit) {
            attemptedOriginalUrisRef.current.add(originalUri);
          } else {
            attemptedOriginalUrisRef.current.delete(originalUri);
          }

          return null;
        } catch (error) {
          attemptedOriginalUrisRef.current.delete(originalUri);
          console.warn("Video fallback resolve failed", error);
          return null;
        } finally {
          inFlightByOriginalUriRef.current.delete(originalUri);
        }
      })();

      inFlightByOriginalUriRef.current.set(originalUri, pending);
      return pending;
    },
    []
  );

  const ensurePlayableVideo = useCallback(
    async (originalUri: string | null | undefined): Promise<string | null> => resolveFallback(originalUri),
    [resolveFallback]
  );

  const handleVideoError = useCallback(
    async (originalUri: string | null | undefined): Promise<string | null> => {
      const resolved = await resolveFallback(originalUri);
      if (resolved || !originalUri) return resolved;

      const forcedTranscodeUri = buildForcedLocalTranscodeUri(originalUri);
      if (!forcedTranscodeUri) return null;

      if (fallbackByOriginalUriRef.current[originalUri] !== forcedTranscodeUri) {
        fallbackByOriginalUriRef.current[originalUri] = forcedTranscodeUri;
        forceUpdate((n) => n + 1);
      }
      attemptedOriginalUrisRef.current.add(originalUri);
      return forcedTranscodeUri;
    },
    [resolveFallback]
  );

  return {
    getVideoSrc,
    ensurePlayableVideo,
    handleVideoError,
  };
}
