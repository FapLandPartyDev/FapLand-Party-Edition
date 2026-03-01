import type { CSSProperties } from "react";
import type { RoadPalette } from "../../game/types";
import { normalizeRoadPalette } from "../../features/map-editor/EditorState";

export type CinematicTransitionFrameProps = {
  title: string;
  overline: string;
  accentLabel?: string | null;
  hintText?: string | null;
  countdownLabel?: string | null;
  progress: number;
  variant: "playlist-launch" | "round-start";
  metadata?: string[];
  roadPalette?: RoadPalette;
};

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const match = /^#?([0-9a-f]{6})$/iu.exec(hex.trim());
  if (!match) return null;
  const value = Number.parseInt(match[1]!, 16);
  return {
    r: (value >> 16) & 255,
    g: (value >> 8) & 255,
    b: value & 255,
  };
}

function colorWithAlpha(hex: string, alpha: number): string {
  const rgb = hexToRgb(hex);
  if (!rgb) return `rgba(255, 255, 255, ${alpha})`;
  return `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${alpha})`;
}

// Easing functions
const easeOutExpo = (x: number) => (x === 1 ? 1 : 1 - Math.pow(2, -10 * x));
const easeInExpo = (x: number) => (x === 0 ? 0 : Math.pow(2, 10 * x - 10));

export function CinematicTransitionFrame({
  title,
  overline,
  accentLabel,
  hintText,
  countdownLabel,
  progress,
  variant,
  metadata = [],
  roadPalette,
}: CinematicTransitionFrameProps) {
  const safeProgress = clamp01(progress);
  const isPlaylistLaunch = variant === "playlist-launch";
  const palette = normalizeRoadPalette(roadPalette);

  // Timeline Math
  // Entry: 0 to 15%
  const entryPhase = Math.min(1, safeProgress / 0.15);
  const entryEase = easeOutExpo(entryPhase);

  // Charge: 15% to 75%
  const chargePhase = Math.max(0, Math.min(1, (safeProgress - 0.15) / 0.6));

  // Warp: 75% to 100%
  const warpPhase = Math.max(0, (safeProgress - 0.75) / 0.25);
  const warpEase = easeInExpo(warpPhase);

  // Derived visuals
  const containerScale = 0.85 + 0.15 * entryEase + 0.05 * chargePhase + 1.2 * warpEase;
  const containerOpacity = entryPhase < 1 ? entryEase : 1 - warpEase * 0.3;

  const titleLetterSpacing = `${0.3 - 0.28 * entryEase}em`;
  const titleBlur = entryPhase < 1 ? `${20 - 20 * entryEase}px` : "0px";

  const rootStyle = {
    "--transition-progress": safeProgress.toFixed(3),
    "--transition-body": palette.body,
    "--transition-rail-a": palette.railA,
    "--transition-rail-b": palette.railB,
    "--transition-glow": palette.glow,
    "--transition-center": palette.center,
    "--transition-gate": palette.gate,
    "--transition-marker": palette.marker,
    "--transition-body-90": colorWithAlpha(palette.body, 0.9),
    "--transition-body-85": colorWithAlpha(palette.body, 0.85),
    "--transition-body-40": colorWithAlpha(palette.body, 0.4),
    "--transition-rail-a-40": colorWithAlpha(palette.railA, 0.4),
    "--transition-rail-a-30": colorWithAlpha(palette.railA, 0.3),
    "--transition-rail-a-25": colorWithAlpha(palette.railA, 0.25),
    "--transition-rail-a-08": colorWithAlpha(palette.railA, 0.08),
    "--transition-rail-b-30": colorWithAlpha(palette.railB, 0.3),
    "--transition-rail-b-25": colorWithAlpha(palette.railB, 0.25),
    "--transition-rail-b-20": colorWithAlpha(palette.railB, 0.2),
    "--transition-glow-40": colorWithAlpha(palette.glow, 0.4),
    "--transition-glow-30": colorWithAlpha(palette.glow, 0.3),
    "--transition-center-80": colorWithAlpha(palette.center, 0.8),
    "--transition-marker-90": colorWithAlpha(palette.marker, 0.9),
  } as CSSProperties;

  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 overflow-hidden"
      data-testid="cinematic-transition-root"
      data-variant={variant}
      style={rootStyle}
    >
      {/* Background Deep Space */}
      <div
        className="absolute inset-0 bg-[#02050d]"
        style={{ backgroundColor: "var(--transition-body)" }}
      />
      <div
        className="absolute inset-0 opacity-80"
        style={{
          background:
            "radial-gradient(circle at 50% 10%, var(--transition-rail-a-25), transparent 45%), radial-gradient(circle at 50% 90%, var(--transition-rail-b-20), transparent 45%)",
          transform: `scale(${1 + chargePhase * 0.2 + warpEase * 1.5})`,
          opacity: 1 - warpEase,
        }}
      />

      {/* Grid / Velocity lines */}
      <div
        className="absolute inset-0 opacity-40 mix-blend-screen"
        style={{
          background:
            "repeating-linear-gradient(180deg, var(--transition-rail-a-08) 0px, var(--transition-rail-a-08) 2px, transparent 2px, transparent 16px)",
          transform: `translateY(${safeProgress * 150}px) scale(1.1)`,
        }}
      />

      {/* Radial hyper-rings expanding outward */}
      <div className="absolute left-1/2 top-1/2 h-0 w-0 -translate-x-1/2 -translate-y-1/2">
        <div
          className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full border border-cyan-400/30"
          style={{
            borderColor: "var(--transition-rail-a-30)",
            width: `${safeProgress * 180 + 20}vw`,
            height: `${safeProgress * 180 + 20}vw`,
            opacity: 1 - safeProgress,
          }}
        />
        <div
          className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full border border-fuchsia-400/20 shadow-[0_0_40px_rgba(255,74,196,0.3)]"
          style={{
            borderColor: "var(--transition-rail-b-20)",
            boxShadow: "0 0 40px var(--transition-rail-b-30)",
            width: `${safeProgress * 280}vw`,
            height: `${safeProgress * 280}vw`,
            opacity: 1 - safeProgress,
          }}
        />
        <div
          className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full border-4 border-white shadow-[0_0_80px_rgba(255,255,255,0.8)]"
          style={{
            width: `${warpEase * 200 + 10}vw`,
            height: `${warpEase * 200 + 10}vw`,
            opacity: Math.min(1, warpEase * 1.5),
          }}
        />
      </div>

      {/* Scanning Light Line */}
      <div className="absolute inset-0">
        <div
          className="absolute h-[15vh] w-full mix-blend-plus-lighter"
          style={{
            background:
              "linear-gradient(180deg, transparent, var(--transition-rail-a-40) 50%, transparent)",
            top: `${-15 + safeProgress * 130}%`,
          }}
        />
        <div
          className="absolute h-px w-full bg-cyan-200/80 shadow-[0_0_15px_rgba(130,222,255,1)]"
          style={{
            backgroundColor: "var(--transition-center)",
            boxShadow: "0 0 15px var(--transition-center-80)",
            top: `${safeProgress * 100}%`,
          }}
        />
      </div>

      <div
        className="absolute inset-0 bg-[radial-gradient(circle_at_center,transparent_40%,rgba(2,5,13,0.9)_100%)]"
        style={{
          background:
            "radial-gradient(circle at center, transparent 40%, var(--transition-body-90) 100%)",
        }}
      />

      {/* Top Overline */}
      <div className="absolute inset-x-0 top-[12%] flex justify-center px-6">
        <div
          className="rounded-full border border-cyan-200/40 bg-cyan-950/40 px-5 py-1.5 font-[family-name:var(--font-jetbrains-mono)] text-[11px] font-bold uppercase tracking-[0.5em] text-cyan-100 backdrop-blur-xl shadow-[0_0_20px_rgba(56,189,248,0.3)]"
          style={{
            backgroundColor: "var(--transition-body-40)",
            borderColor: "var(--transition-rail-a-40)",
            boxShadow: "0 0 20px var(--transition-rail-a-30)",
            color: "var(--transition-marker)",
            opacity: entryEase,
            transform: `translateY(${20 - 20 * entryEase}px)`,
          }}
        >
          {overline}
        </div>
      </div>

      {/* Main Card */}
      <div className="absolute inset-x-0 top-1/2 flex -translate-y-1/2 justify-center px-4">
        <div
          className={[
            "relative overflow-hidden rounded-[2rem] border backdrop-blur-3xl",
            isPlaylistLaunch
              ? "w-[min(92vw,58rem)] px-6 py-6 sm:px-10 sm:py-9"
              : "w-[min(88vw,44rem)] px-6 py-6 sm:px-9 sm:py-8",
          ].join(" ")}
          style={{
            borderColor: colorWithAlpha(palette.center, 0.15 + 0.3 * chargePhase),
            background: `linear-gradient(180deg, ${colorWithAlpha(palette.body, 0.85 - warpEase * 0.4)}, ${colorWithAlpha(palette.body, 0.9 - warpEase * 0.4)})`,
            boxShadow: `0 0 80px ${colorWithAlpha(palette.railA, 0.1 + chargePhase * 0.15)}, inset 0 0 40px ${colorWithAlpha(palette.railB, 0.05 + warpEase * 0.2)}`,
            opacity: containerOpacity,
            transform: `scale(${containerScale}) translateY(${warpEase * -20}px)`,
          }}
        >
          <div
            className="absolute inset-0 border bg-[linear-gradient(120deg,rgba(88,211,255,0.4),rgba(255,92,188,0.2),rgba(125,129,255,0.4))] transition-opacity"
            style={{
              background:
                "linear-gradient(120deg, var(--transition-rail-a-40), var(--transition-rail-b-20), var(--transition-glow-40))",
              opacity: warpEase * 0.8,
            }}
          />

          {accentLabel ? (
            <div className="relative z-10 mb-4 flex items-center gap-3">
              <span
                className="h-2 w-2 rounded-full bg-cyan-300 shadow-[0_0_12px_rgba(103,232,249,1)]"
                style={{
                  backgroundColor: "var(--transition-center)",
                  boxShadow: "0 0 12px var(--transition-center-80)",
                }}
              />
              <span
                className="font-[family-name:var(--font-jetbrains-mono)] text-[12px] uppercase tracking-[0.35em] text-cyan-100"
                style={{ color: "var(--transition-marker)" }}
              >
                {accentLabel}
              </span>
            </div>
          ) : null}

          <div className="relative z-10">
            <h2
              className="text-balance bg-gradient-to-r from-white via-cyan-100 to-fuchsia-200 bg-clip-text text-4xl font-black text-transparent sm:text-6xl"
              data-testid="cinematic-transition-title"
              style={{
                backgroundImage:
                  "linear-gradient(90deg, var(--transition-marker), var(--transition-center), var(--transition-rail-b))",
                letterSpacing: titleLetterSpacing,
                filter: `blur(${titleBlur})`,
                textShadow: `0 0 ${20 + chargePhase * 40}px ${colorWithAlpha(palette.railA, 0.3 + warpEase * 0.5)}`,
              }}
            >
              {title}
            </h2>
            {metadata.length > 0 ? (
              <div
                className="mt-6 flex flex-wrap gap-2.5"
                data-testid="cinematic-transition-metadata"
                style={{ opacity: entryPhase < 1 ? entryEase : 1 }}
              >
                {metadata.map((entry) => (
                  <span
                    key={entry}
                    className="rounded-full border border-cyan-200/20 bg-cyan-950/30 px-3.5 py-1.5 font-[family-name:var(--font-jetbrains-mono)] text-[10px] uppercase tracking-[0.2em] text-cyan-50"
                    style={{
                      backgroundColor: "var(--transition-body-40)",
                      borderColor: "var(--transition-rail-a-25)",
                      color: "var(--transition-marker)",
                    }}
                  >
                    {entry}
                  </span>
                ))}
              </div>
            ) : null}
          </div>

          {hintText ? (
            <div
              className="relative z-10 mt-6 rounded-[1.5rem] border border-fuchsia-200/20 bg-[linear-gradient(135deg,rgba(14,29,56,0.85),rgba(34,11,49,0.78))] px-4 py-4 shadow-[inset_0_0_24px_rgba(103,232,249,0.08),0_0_24px_rgba(217,70,239,0.08)] sm:px-5"
              data-testid="cinematic-transition-hint"
              style={{
                background:
                  "linear-gradient(135deg, var(--transition-body-85), var(--transition-glow-30))",
                borderColor: "var(--transition-rail-b-25)",
                boxShadow:
                  "inset 0 0 24px var(--transition-rail-a-08), 0 0 24px var(--transition-rail-b-20)",
                opacity: entryPhase < 1 ? entryEase : 1 - warpEase * 0.15,
              }}
            >
              <p
                className="font-[family-name:var(--font-inter)] text-sm font-semibold leading-6 text-cyan-50 sm:text-base"
                style={{ color: "var(--transition-marker)" }}
              >
                {hintText}
              </p>
            </div>
          ) : null}

          {/* Progress Bar */}
          <div className="relative z-10 mt-8 h-1.5 overflow-hidden rounded-full bg-slate-900/60 shadow-inner">
            <div
              className="h-full rounded-full bg-gradient-to-r from-cyan-400 via-white to-fuchsia-400 shadow-[0_0_20px_rgba(103,232,249,0.8)]"
              style={{
                backgroundImage:
                  "linear-gradient(90deg, var(--transition-rail-a), var(--transition-marker), var(--transition-rail-b))",
                boxShadow: "0 0 20px var(--transition-center-80)",
                width: `${safeProgress * 100}%`,
              }}
            />
          </div>
        </div>
      </div>

      {/* Countdown (Used in RoundStartTransition) */}
      {countdownLabel ? (
        <div className="absolute bottom-[10%] right-[6%] sm:right-[10%]">
          <div
            className="font-[family-name:var(--font-jetbrains-mono)] text-[clamp(5rem,12vw,10rem)] font-black leading-none tracking-[-0.05em] text-white"
            data-testid="cinematic-transition-countdown"
            style={{
              color: "var(--transition-marker)",
              textShadow:
                "0 0 40px var(--transition-rail-a-50), 0 0 80px var(--transition-rail-b-30)",
              opacity: 0.6 + entryEase * 0.4 - warpEase * 0.5,
              transform: `scale(${1 + chargePhase * 0.1 - warpEase * 0.2})`,
            }}
          >
            {countdownLabel}
          </div>
        </div>
      ) : null}

      {/* Final White Warp Flash */}
      <div className="absolute inset-0 bg-white mix-blend-overlay" style={{ opacity: warpEase }} />
    </div>
  );
}
