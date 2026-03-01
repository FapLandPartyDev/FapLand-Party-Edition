import React, { useMemo, useState, useEffect, useRef } from 'react';
import { usePlayableVideoFallback } from "../hooks/usePlayableVideoFallback";
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
    'rgba(139,92,246,0.7)',
    'rgba(99,102,241,0.6)',
    'rgba(167,139,250,0.5)',
    'rgba(236,72,153,0.4)',
    'rgba(255,255,255,0.3)',
];

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
}

export const AnimatedBackground: React.FC<AnimatedBackgroundProps> = React.memo(({ videoUris = [] }) => {
    const [currentVideoIndex, setCurrentVideoIndex] = useState(0);
    const [nextVideoIndex, setNextVideoIndex] = useState<number | null>(null);
    const [backgroundVideoEnabled, setBackgroundVideoEnabled] = useState(DEFAULT_BACKGROUND_VIDEO_ENABLED);
    const particles = useRef(generateParticles(18)).current;
    const { getVideoSrc, ensurePlayableVideo, handleVideoError } = usePlayableVideoFallback();

    useEffect(() => {
        let mounted = true;

        const loadSetting = async () => {
            try {
                const value = await trpc.store.get.query({ key: BACKGROUND_VIDEO_ENABLED_KEY });
                if (!mounted) return;
                setBackgroundVideoEnabled(typeof value === "boolean" ? value : DEFAULT_BACKGROUND_VIDEO_ENABLED);
            } catch (error) {
                console.warn("Failed to read background video setting", error);
                if (mounted) {
                    setBackgroundVideoEnabled(DEFAULT_BACKGROUND_VIDEO_ENABLED);
                }
            }
        };

        const handleSettingChange = (event: Event) => {
            const nextValue = (event as CustomEvent<boolean>).detail;
            setBackgroundVideoEnabled(typeof nextValue === "boolean" ? nextValue : DEFAULT_BACKGROUND_VIDEO_ENABLED);
        };

        void loadSetting();
        window.addEventListener(BACKGROUND_VIDEO_ENABLED_EVENT, handleSettingChange);

        return () => {
            mounted = false;
            window.removeEventListener(BACKGROUND_VIDEO_ENABLED_EVENT, handleSettingChange);
        };
    }, []);

    // Crossfade trigger
    useEffect(() => {
        if (!backgroundVideoEnabled || videoUris.length <= 1) return;
        const interval = setInterval(() => {
            setNextVideoIndex((prev) => prev !== null ? prev : (currentVideoIndex + 1) % videoUris.length);
        }, 15000);
        return () => clearInterval(interval);
    }, [backgroundVideoEnabled, videoUris.length, currentVideoIndex]);

    useEffect(() => {
        if (backgroundVideoEnabled) return;
        setCurrentVideoIndex(0);
        setNextVideoIndex(null);
    }, [backgroundVideoEnabled]);

    // Finalize crossfade
    useEffect(() => {
        if (nextVideoIndex === null) return;
        const timeout = setTimeout(() => {
            setCurrentVideoIndex(nextVideoIndex);
            setNextVideoIndex(null);
        }, 2500);
        return () => clearTimeout(timeout);
    }, [nextVideoIndex]);

    const renderVideo = (uri: string, isNext: boolean, isCurrent: boolean) => {
        const originalSrc =
            uri.startsWith("http://") ||
            uri.startsWith("https://") ||
            uri.startsWith("app://") ||
            uri.startsWith("file://")
                ? uri
                : convertFileSrc(uri);
        const src = getVideoSrc(originalSrc) ?? originalSrc;
        const isVisible = isNext || (isCurrent && nextVideoIndex === null);
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
                    position: 'absolute', inset: 0,
                    width: '100%', height: '100%',
                    objectFit: 'cover',
                    opacity: isVisible ? 0.22 : 0,
                    zIndex: isNext ? 10 : 0,
                    transition: 'opacity 2.5s ease-in-out',
                    willChange: 'opacity',
                    filter: 'saturate(1.4) brightness(0.85)',
                }}
            />
        );
    };

    const background = useMemo(() => (
        <div className="fixed inset-0 overflow-hidden pointer-events-none -z-10 parallax-bg" style={{ background: '#050508' }}>

            {/* ── Video layer ── */}
            {backgroundVideoEnabled && videoUris.length > 0 && (
                <div className="absolute inset-0">
                    {videoUris.map((uri, idx) => {
                        const isCurrent = idx === currentVideoIndex;
                        const isNext = idx === nextVideoIndex;
                        if (!isCurrent && !isNext) return null;
                        return renderVideo(uri, isNext, isCurrent);
                    })}
                </div>
            )}

            {/* ── Animated ambient orbs (always shown) ── */}
            <div className="absolute inset-0" aria-hidden>
                {/* Orb 1 — purple, top-left */}
                <div
                    className="absolute animate-orb-drift animate-pulse-glow"
                    style={{
                        top: '-15%', left: '-10%',
                        width: '65vw', height: '65vw',
                        borderRadius: '50%',
                        background: 'radial-gradient(circle, rgba(139,92,246,0.35) 0%, rgba(139,92,246,0.08) 60%, transparent 80%)',
                        filter: 'blur(60px)',
                    }}
                />
                {/* Orb 2 — indigo, top-right */}
                <div
                    className="absolute animate-orb-drift-2 animate-pulse-glow"
                    style={{
                        top: '5%', right: '-15%',
                        width: '55vw', height: '55vw',
                        borderRadius: '50%',
                        background: 'radial-gradient(circle, rgba(99,102,241,0.28) 0%, rgba(99,102,241,0.06) 60%, transparent 80%)',
                        filter: 'blur(70px)',
                        animationDelay: '-6s, -3s',
                    }}
                />
                {/* Orb 3 — pink, bottom-center */}
                <div
                    className="absolute animate-orb-drift animate-pulse-glow"
                    style={{
                        bottom: '-25%', left: '20%',
                        width: '70vw', height: '70vw',
                        borderRadius: '50%',
                        background: 'radial-gradient(circle, rgba(236,72,153,0.18) 0%, rgba(236,72,153,0.04) 60%, transparent 80%)',
                        filter: 'blur(80px)',
                        animationDelay: '-10s, -5s',
                    }}
                />
                {/* Orb 4 — fuchsia accent, mid-right */}
                <div
                    className="absolute animate-orb-drift-2"
                    style={{
                        top: '40%', right: '5%',
                        width: '35vw', height: '35vw',
                        borderRadius: '50%',
                        background: 'radial-gradient(circle, rgba(167,139,250,0.2) 0%, transparent 70%)',
                        filter: 'blur(50px)',
                        animationDelay: '-14s',
                    }}
                />
            </div>

            {/* ── Floating particles ── */}
            <div className="absolute inset-0 overflow-hidden" aria-hidden>
                {particles.map((p) => (
                    <div
                        key={p.id}
                        className="particle"
                        style={{
                            left: `${p.x}%`,
                            bottom: '-6px',
                            width: `${p.size}px`,
                            height: `${p.size}px`,
                            background: p.color,
                            boxShadow: `0 0 ${p.size * 2}px ${p.color}`,
                            animationDuration: `${p.duration}s`,
                            animationDelay: `${p.delay}s`,
                            ['--tx' as string]: `${p.tx}px`,
                        }}
                    />
                ))}
            </div>

            {/* ── Fine grid texture ── */}
            <div
                className="absolute inset-0 z-10"
                style={{
                    backgroundImage: `
                        linear-gradient(rgba(255,255,255,0.025) 1px, transparent 1px),
                        linear-gradient(90deg, rgba(255,255,255,0.025) 1px, transparent 1px)
                    `,
                    backgroundSize: '60px 60px',
                }}
                aria-hidden
            />

            {/* ── Scanlines ── */}
            <div className="absolute inset-0 z-10 scanlines opacity-40" aria-hidden />

            {/* ── Chromatic vignette ── */}
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
    ), [backgroundVideoEnabled, videoUris, currentVideoIndex, nextVideoIndex, particles, getVideoSrc, ensurePlayableVideo, handleVideoError]);

    return background;
});

AnimatedBackground.displayName = 'AnimatedBackground';
