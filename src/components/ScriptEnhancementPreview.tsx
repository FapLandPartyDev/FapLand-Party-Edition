import { useEffect, useRef, useState } from "react";
import { Trans, useLingui } from "@lingui/react/macro";
import type { FunscriptAction } from "../game/media/playback";
import { useLocale } from "../i18n";
import type { EnhancementPatterns } from "../services/haptics/enhancementPatterns";
import { enhanceScript } from "../services/haptics/scriptEnhancement";

const sample = Array.from({ length: 17 }, (_, index) => ({
  at: index * 500,
  pos: index % 2 === 0 ? 30 : 70,
}));
const noPatterns: EnhancementPatterns = {
  beatPunch: false,
  variation: false,
  delimited: false,
  overshoot: false,
  staircase: false,
  doubleRebound: false,
  softLanding: false,
};
type PreviewMode = keyof EnhancementPatterns | "combined";

function drawChart(canvas: HTMLCanvasElement, preview: FunscriptAction[], locale: string) {
  const { width, height } = canvas.getBoundingClientRect();
  if (width === 0 || height === 0) return;
  const context = canvas.getContext("2d");
  if (!context) return;
  const scale = window.devicePixelRatio || 1;
  canvas.width = Math.round(width * scale);
  canvas.height = Math.round(height * scale);
  context.setTransform(scale, 0, 0, scale, 0, 0);
  const left = 44;
  const right = width - 16;
  const top = 18;
  const bottom = height - 35;
  const duration = sample.at(-1)!.at;
  const percent = new Intl.NumberFormat(locale, { style: "percent" });
  const seconds = new Intl.NumberFormat(locale, {
    style: "unit",
    unit: "second",
    unitDisplay: "narrow",
  });
  const x = (at: number) => left + (at / duration) * (right - left);
  const y = (pos: number) => bottom - (pos / 100) * (bottom - top);
  const line = (fromX: number, fromY: number, toX: number, toY: number) => {
    context.beginPath();
    context.moveTo(fromX, fromY);
    context.lineTo(toX, toY);
    context.stroke();
  };

  context.font = "12px sans-serif";
  context.fillStyle = "#a1a1aa";
  context.strokeStyle = "#393449";
  context.lineWidth = 1;
  context.textAlign = "right";
  context.textBaseline = "middle";
  for (const pos of [0, 25, 50, 75, 100]) {
    line(left, y(pos), right, y(pos));
    context.fillText(percent.format(pos / 100), left - 9, y(pos));
  }
  context.textAlign = "center";
  for (let at = 0; at <= duration; at += 2000) {
    line(x(at), top, x(at), bottom);
    context.fillText(seconds.format(at / 1000), x(at), bottom + 19);
  }

  const trace = (points: FunscriptAction[]) => {
    context.beginPath();
    for (const [index, point] of points.entries()) {
      if (index === 0) context.moveTo(x(point.at), y(point.pos));
      else context.lineTo(x(point.at), y(point.pos));
    }
    context.stroke();
  };

  context.lineJoin = "round";
  context.strokeStyle = "#67e8f9";
  context.lineWidth = 3;
  trace(preview);

  context.strokeStyle = "#c4b5fd";
  context.lineWidth = 2;
  context.setLineDash([6, 5]);
  trace(sample);
  context.setLineDash([]);
}

export function ScriptEnhancementPreview({
  enabled,
  patterns,
}: {
  enabled: boolean;
  patterns: EnhancementPatterns;
}) {
  const { t } = useLingui();
  const { locale } = useLocale();
  const [mode, setMode] = useState<PreviewMode>("combined");
  const canvas = useRef<HTMLCanvasElement>(null);
  const modes: Array<{ id: PreviewMode; label: string }> = [
    { id: "combined", label: t`Enabled patterns` },
    { id: "beatPunch", label: t`Beat punch` },
    { id: "variation", label: t`Phrase variation` },
    { id: "delimited", label: t`Range expansion` },
    { id: "overshoot", label: t`Overshoot and rebound` },
    { id: "staircase", label: t`Stair-step rise` },
    { id: "doubleRebound", label: t`Double rebound` },
    { id: "softLanding", label: t`Soft landing` },
  ];

  useEffect(() => {
    const canvasElement = canvas.current;
    if (!canvasElement) return;
    const active = mode === "combined" ? patterns : { ...noPatterns, [mode]: true };
    const preview = enhanceScript(
      sample,
      { enabled: mode !== "combined" || enabled, wildness: 100, delimited: 100 },
      1,
      400,
      active
    );
    const redraw = () => drawChart(canvasElement, preview, locale);
    redraw();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(redraw);
    observer.observe(canvasElement);
    return () => observer.disconnect();
  }, [mode, enabled, patterns, locale]);

  return (
    <section className="mb-4 rounded-3xl border border-violet-400/25 bg-zinc-950/70 p-4 sm:p-5">
      <h2 className="text-lg font-extrabold text-violet-100">
        <Trans>Motion preview</Trans>
      </h2>
      <div className="mt-3 flex flex-wrap gap-2">
        {modes.map(({ id, label }) => (
          <button
            key={id}
            type="button"
            aria-pressed={mode === id}
            onClick={() => setMode(id)}
            className="rounded-lg border border-violet-400/30 px-3 py-1.5 text-sm text-violet-100 transition-colors hover:border-cyan-300/70 aria-pressed:border-cyan-300/70 aria-pressed:bg-cyan-400/15 aria-pressed:text-cyan-100"
          >
            {label}
          </button>
        ))}
      </div>
      <div className="mt-4 rounded-xl border border-violet-400/20 bg-zinc-950 px-1 sm:px-3">
        <canvas
          ref={canvas}
          className="block h-48 w-full sm:h-60"
          role="img"
          aria-label={t`Original and enhanced stroke positions over eight seconds`}
        />
      </div>
      <div className="mt-3 flex flex-wrap gap-x-5 gap-y-2 text-xs text-zinc-300">
        <span className="flex items-center gap-2">
          <span className="w-6 border-t-2 border-dashed border-violet-300" aria-hidden="true" />
          <Trans>Original motion</Trans>
        </span>
        <span className="flex items-center gap-2">
          <span className="w-6 border-t-2 border-cyan-300" aria-hidden="true" />
          <Trans>Enhanced motion</Trans>
        </span>
        <span className="text-zinc-400">
          <Trans>Example script at full pattern strength and a 400 units/s speed limit.</Trans>
        </span>
      </div>
    </section>
  );
}
