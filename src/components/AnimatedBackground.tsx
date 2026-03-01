import React, { useEffect, useMemo, useState } from "react";
import { usePlayableVideoFallback } from "../hooks/usePlayableVideoFallback";
import { useSfwMode } from "../hooks/useSfwMode";
import { trpc } from "../services/trpc";
import {
  BACKGROUND_VIDEO_ENABLED_EVENT,
  BACKGROUND_VIDEO_ENABLED_KEY,
  DEFAULT_BACKGROUND_VIDEO_ENABLED,
} from "../constants/backgroundSettings";

function convertFileSrc(filePath: string): string {
  if (window.electronAPI?.file?.convertFileSrc) {
    return window.electronAPI.file.convertFileSrc(filePath);
  }
  return filePath;
}

interface Particle {
  id: number;
  x: number;
  size: number;
  duration: number;
  delay: number;
  tx: number;
  color: string;
}

const PARTICLE_COLORS = [
  "rgba(139,92,246,0.7)",
  "rgba(99,102,241,0.6)",
  "rgba(167,139,250,0.5)",
  "rgba(236,72,153,0.4)",
  "rgba(255,255,255,0.3)",
];

const LIGHT_BACKGROUND_VIDEO_LIMIT = 6;
const LIGHT_PARTICLE_COUNT = 6;
const FULL_PARTICLE_COUNT = 18;

function generateParticles(count: number): Particle[] {
  return Array.from({ length: count }, (_, i) => ({
    id: i,
    x: Math.random() * 100,
    size: 2 + Math.random() * 4,
    duration: 8 + Math.random() * 14,
    delay: Math.random() * 12,
    tx: (Math.random() - 0.5) * 120,
    color: PARTICLE_COLORS[Math.floor(Math.random() * PARTICLE_COLORS.length)],
  }));
}

interface AnimatedBackgroundProps {
  videoUris?: string[];
  quality?: "light" | "full";
}

function getRandomVideoIndex(videoCount: number): number {
  if (videoCount <= 1) return 0;
  return Math.floor(Math.random() * videoCount);
}

function toOriginalVideoSrc(uri: string): string {
  if (
    uri.startsWith("http://") ||
    uri.startsWith("https://") ||
    uri.startsWith("app://") ||
    uri.startsWith("file://")
  ) {
    return uri;
  }
  return convertFileSrc(uri);
}

export const AnimatedBackground: React.FC<AnimatedBackgroundProps> = React.memo(
  ({ videoUris = [], quality = "light" }) => {
    const effectiveVideoUris = useMemo(
      () =>
        quality === "light" ? videoUris.slice(0, LIGHT_BACKGROUND_VIDEO_LIMIT) : videoUris,
      [quality, videoUris]
    );
    const [currentVideoIndex, setCurrentVideoIndex] = useState(() =>
      getRandomVideoIndex(effectiveVideoUris.length)
    );
    const [nextVideoIndex, setNextVideoIndex] = useState<number | null>(null);
    const [backgroundVideoEnabled, setBackgroundVideoEnabled] = useState(
      DEFAULT_BACKGROUND_VIDEO_ENABLED
    );
    const particles = useMemo(
      () => generateParticles(quality === "light" ? LIGHT_PARTICLE_COUNT : FULL_PARTICLE_COUNT),
      [quality]
    );
    const sfwMode = useSfwMode();
    const { getVideoSrc, ensurePlayableVideo, handleVideoError } = usePlayableVideoFallback();

    useEffect(() => {
      let mounted = true;

      const loadSetting = async () => {
        try {
          const value = await trpc.store.get.query({ key: BACKGROUND_VIDEO_ENABLED_KEY });
          if (!mounted) return;
          setBackgroundVideoEnabled(
            typeof value === "boolean" ? value : DEFAULT_BACKGROUND_VIDEO_ENABLED
          );
        } catch (error) {
          console.warn("Failed to read background video setting", error);
          if (mounted) {
            setBackgroundVideoEnabled(DEFAULT_BACKGROUND_VIDEO_ENABLED);
          }
        }
      };

      const handleSettingChange = (event: Event) => {
        const nextValue = (event as CustomEvent<boolean>).detail;
        setBackgroundVideoEnabled(
          typeof nextValue === "boolean" ? nextValue : DEFAULT_BACKGROUND_VIDEO_ENABLED
        );
      };

      void loadSetting();
      window.addEventListener(BACKGROUND_VIDEO_ENABLED_EVENT, handleSettingChange);

      return () => {
        mounted = false;
        window.removeEventListener(BACKGROUND_VIDEO_ENABLED_EVENT, handleSettingChange);
      };
    }, []);

    useEffect(() => {
      if (!backgroundVideoEnabled || effectiveVideoUris.length <= 1) return;

      const interval = window.setInterval(() => {
        if (quality === "light") {
          setCurrentVideoIndex((prev) => (prev + 1) % effectiveVideoUris.length);
          return;
        }

        setNextVideoIndex((prev) =>
          prev !== null ? prev : (currentVideoIndex + 1) % effectiveVideoUris.length
        );
      }, 15000);

      return () => window.clearInterval(interval);
    }, [backgroundVideoEnabled, currentVideoIndex, effectiveVideoUris.length, quality]);

    useEffect(() => {
      if (backgroundVideoEnabled) return;
      setCurrentVideoIndex(0);
      setNextVideoIndex(null);
    }, [backgroundVideoEnabled]);

    useEffect(() => {
      if (effectiveVideoUris.length === 0) {
        setCurrentVideoIndex(0);
        setNextVideoIndex(null);
        return;
      }

      setCurrentVideoIndex((prev) =>
        prev < effectiveVideoUris.length ? prev : getRandomVideoIndex(effectiveVideoUris.length)
      );
      setNextVideoIndex((prev) =>
        quality === "full" && prev !== null && prev < effectiveVideoUris.length ? prev : null
      );
    }, [effectiveVideoUris.length, quality]);

    useEffect(() => {
      if (quality === "light") {
        setNextVideoIndex(null);
      }
    }, [quality]);

    useEffect(() => {
      if (quality !== "full" || nextVideoIndex === null) return;
      const timeout = window.setTimeout(() => {
        setCurrentVideoIndex(nextVideoIndex);
        setNextVideoIndex(null);
      }, 2500);
      return () => window.clearTimeout(timeout);
    }, [nextVideoIndex, quality]);

    const renderVideo = (uri: string, options?: { isNext?: boolean; isCurrent?: boolean }) => {
      const originalSrc = toOriginalVideoSrc(uri);
      const src = getVideoSrc(originalSrc);
      if (!src) return null;

      if (quality === "light") {
        return (
          <video
            key={uri}
            src={src}
            autoPlay
            muted
            loop
            playsInline
            onLoadedMetadata={() => {
              void ensurePlayableVideo(originalSrc);
            }}
            onError={() => {
              void handleVideoError(originalSrc);
            }}
            style={{
              position: "absolute",
              inset: 0,
              width: "100%",
              height: "100%",
              objectFit: "cover",
              opacity: 0.18,
              filter: "saturate(1.25) brightness(0.82)",
            }}
          />
        );
      }

      const isVisible = options?.isNext || (options?.isCurrent && nextVideoIndex === null);
      return (
        <video
          key={uri}
          src={src}
          autoPlay
          muted
          loop
          playsInline
          onLoadedMetadata={() => {
            void ensurePlayableVideo(originalSrc);
          }}
          onError={() => {
            void handleVideoError(originalSrc);
          }}
          style={{
            position: "absolute",
            inset: 0,
            width: "100%",
            height: "100%",
            objectFit: "cover",
            opacity: isVisible ? 0.22 : 0,
            zIndex: options?.isNext ? 10 : 0,
            transition: "opacity 2.5s ease-in-out",
            willChange: "opacity",
            filter: "saturate(1.4) brightness(0.85)",
          }}
        />
      );
    };

    const currentVideoUri = effectiveVideoUris[currentVideoIndex] ?? null;

    return (
      <div
        className={`fixed inset-0 overflow-hidden pointer-events-none -z-10 ${quality === "full" ? "parallax-bg" : ""}`}
        style={{ background: "#050508" }}
      >
        {backgroundVideoEnabled && !sfwMode && effectiveVideoUris.length > 0 && (
          <div className="absolute inset-0" data-testid="animated-background-video-layer">
            {quality === "light"
              ? currentVideoUri
                ? renderVideo(currentVideoUri)
                : null
              : effectiveVideoUris.map((uri, idx) => {
                  const isCurrent = idx === currentVideoIndex;
                  const isNext = idx === nextVideoIndex;
                  if (!isCurrent && !isNext) return null;
                  return renderVideo(uri, { isCurrent, isNext });
                })}
          </div>
        )}

        <div className="absolute inset-0" aria-hidden>
          <div
            className="absolute"
            style={{
              top: "-15%",
              left: "-10%",
              width: "65vw",
              height: "65vw",
              borderRadius: "50%",
              background:
                "radial-gradient(circle, rgba(139,92,246,0.35) 0%, rgba(139,92,246,0.08) 60%, transparent 80%)",
              filter: "blur(60px)",
              animation:
                quality === "light"
                  ? "orb-drift 20s ease-in-out infinite, orb-fade 6s ease-in-out infinite"
                  : "orb-drift 20s ease-in-out infinite, pulse-glow 4s ease-in-out infinite",
            }}
          />
          <div
            className="absolute"
            style={{
              top: "5%",
              right: "-15%",
              width: "55vw",
              height: "55vw",
              borderRadius: "50%",
              background:
                "radial-gradient(circle, rgba(99,102,241,0.28) 0%, rgba(99,102,241,0.06) 60%, transparent 80%)",
              filter: "blur(70px)",
              animation:
                quality === "light"
                  ? "orb-drift-2 27s ease-in-out -6s infinite, orb-fade 6s ease-in-out -2s infinite"
                  : "orb-drift-2 27s ease-in-out -6s infinite, pulse-glow 4s ease-in-out -3s infinite",
            }}
          />
          {quality === "full" && (
            <>
              <div
                className="absolute"
                style={{
                  bottom: "-25%",
                  left: "20%",
                  width: "70vw",
                  height: "70vw",
                  borderRadius: "50%",
                  background:
                    "radial-gradient(circle, rgba(236,72,153,0.18) 0%, rgba(236,72,153,0.04) 60%, transparent 80%)",
                  filter: "blur(80px)",
                  animation:
                    "orb-drift 20s ease-in-out -10s infinite, pulse-glow 4s ease-in-out -5s infinite",
                }}
              />
              <div
                className="absolute animate-orb-drift-2"
                style={{
                  top: "40%",
                  right: "5%",
                  width: "35vw",
                  height: "35vw",
                  borderRadius: "50%",
                  background: "radial-gradient(circle, rgba(167,139,250,0.2) 0%, transparent 70%)",
                  filter: "blur(50px)",
                  animationDelay: "-14s",
                }}
              />
            </>
          )}
        </div>

        <div className="absolute inset-0 overflow-hidden" aria-hidden>
          {particles.map((particle) => (
            <div
              key={particle.id}
              className="particle"
              style={{
                left: `${particle.x}%`,
                bottom: "-6px",
                width: `${particle.size}px`,
                height: `${particle.size}px`,
                background: particle.color,
                boxShadow: `0 0 ${particle.size * 2}px ${particle.color}`,
                animationDuration: `${particle.duration}s`,
                animationDelay: `${particle.delay}s`,
                ["--tx" as string]: `${particle.tx}px`,
              }}
            />
          ))}
        </div>

        {quality === "full" && (
          <>
            <div
              className="absolute inset-0 z-10"
              data-testid="animated-background-grid"
              style={{
                backgroundImage: `
                        linear-gradient(rgba(255,255,255,0.025) 1px, transparent 1px),
                        linear-gradient(90deg, rgba(255,255,255,0.025) 1px, transparent 1px)
                    `,
                backgroundSize: "60px 60px",
              }}
              aria-hidden
            />
            <div
              className="absolute inset-0 z-10 scanlines opacity-40"
              data-testid="animated-background-scanlines"
              aria-hidden
            />
          </>
        )}

        <div
          className="absolute inset-0 z-20"
          style={{
            background: `
                        radial-gradient(ellipse at 50% 50%, transparent 40%, rgba(5,5,8,0.7) 100%),
                        linear-gradient(to bottom, rgba(5,5,8,0.6) 0%, transparent 20%, transparent 80%, rgba(5,5,8,0.9) 100%)
                    `,
          }}
          aria-hidden
        />
      </div>
    );
  }
);

AnimatedBackground.displayName = "AnimatedBackground";
