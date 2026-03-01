import { useCallback, useRef, useState } from "react";

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

export function isLocalVideoUriForFallback(videoUri: string): boolean {
  return videoUri.startsWith("app://media/") || videoUri.startsWith("file://");
}

export function usePlayableVideoFallback(resolver: PlayableResolver = defaultPlayableResolver): {
  getVideoSrc: (originalUri: string | null | undefined) => string | undefined;
  ensurePlayableVideo: (originalUri: string | null | undefined) => Promise<string | null>;
  handleVideoError: (originalUri: string | null | undefined) => Promise<string | null>;
} {
  const [fallbackByOriginalUri, setFallbackByOriginalUri] = useState<Record<string, string>>({});
  const attemptedOriginalUrisRef = useRef(new Set<string>());
  const inFlightByOriginalUriRef = useRef(new Map<string, Promise<string | null>>());

  const getVideoSrc = useCallback(
    (originalUri: string | null | undefined): string | undefined => {
      if (!originalUri) return undefined;
      return fallbackByOriginalUri[originalUri] ?? originalUri;
    },
    [fallbackByOriginalUri],
  );

  const ensurePlayableVideo = useCallback(
    async (originalUri: string | null | undefined): Promise<string | null> => {
      if (!originalUri) return null;
      if (!isLocalVideoUriForFallback(originalUri)) return null;

      const resolved = fallbackByOriginalUri[originalUri];
      if (resolved && resolved !== originalUri) {
        return resolved;
      }

      const existingInFlight = inFlightByOriginalUriRef.current.get(originalUri);
      if (existingInFlight) return existingInFlight;

      if (attemptedOriginalUrisRef.current.has(originalUri)) {
        return null;
      }
      attemptedOriginalUrisRef.current.add(originalUri);

      const pending = (async () => {
        try {
          const result = await resolver(originalUri);
          if (result.videoUri && result.videoUri !== originalUri) {
            setFallbackByOriginalUri((previous) => {
              if (previous[originalUri]) return previous;
              return {
                ...previous,
                [originalUri]: result.videoUri,
              };
            });
            return result.videoUri;
          }
          return null;
        } catch (error) {
          console.warn("Video fallback resolve failed", error);
          return null;
        } finally {
          inFlightByOriginalUriRef.current.delete(originalUri);
        }
      })();

      inFlightByOriginalUriRef.current.set(originalUri, pending);
      return pending;
    },
    [fallbackByOriginalUri, resolver],
  );

  const handleVideoError = useCallback(
    async (originalUri: string | null | undefined): Promise<string | null> => {
      return ensurePlayableVideo(originalUri);
    },
    [ensurePlayableVideo],
  );

  return {
    getVideoSrc,
    ensurePlayableVideo,
    handleVideoError,
  };
}
