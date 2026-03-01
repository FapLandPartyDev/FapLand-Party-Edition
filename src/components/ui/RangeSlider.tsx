import {
  useEffect,
  useRef,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";

type RangeThumb = "min" | "max";

type RangeSliderProps = {
  min: number;
  max: number;
  step?: number;
  minValue: number;
  maxValue: number;
  minAriaLabel: string;
  maxAriaLabel: string;
  onChange: (minValue: number, maxValue: number) => void;
  trackClassName?: string;
  activeTrackClassName?: string;
  thumbClassName?: string;
};

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function RangeSlider({
  min,
  max,
  step = 1,
  minValue,
  maxValue,
  minAriaLabel,
  maxAriaLabel,
  onChange,
  trackClassName = "bg-white/10",
  activeTrackClassName = "bg-violet-400/75",
  thumbClassName = "",
}: RangeSliderProps) {
  const trackRef = useRef<HTMLDivElement | null>(null);
  const dragThumbRef = useRef<RangeThumb | null>(null);
  const span = Math.max(step, max - min);

  const normalizeValue = (value: number) => {
    const stepped = min + Math.round((value - min) / step) * step;
    return Number(clamp(stepped, min, max).toFixed(10));
  };

  const valueFromClientX = (clientX: number) => {
    const track = trackRef.current;
    if (!track) return null;
    const rect = track.getBoundingClientRect();
    if (rect.width <= 0) return null;
    return normalizeValue(min + clamp((clientX - rect.left) / rect.width, 0, 1) * span);
  };

  const updateThumb = (thumb: RangeThumb, value: number) => {
    if (thumb === "min") onChange(Math.min(value, maxValue), maxValue);
    else onChange(minValue, Math.max(value, minValue));
  };

  useEffect(() => {
    const handlePointerMove = (event: PointerEvent) => {
      const thumb = dragThumbRef.current;
      if (!thumb) return;
      const value = valueFromClientX(event.clientX);
      if (value !== null) updateThumb(thumb, value);
    };
    const handlePointerUp = (event: PointerEvent) => {
      const thumb = dragThumbRef.current;
      if (!thumb) return;
      const value = valueFromClientX(event.clientX);
      if (value !== null) updateThumb(thumb, value);
      dragThumbRef.current = null;
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    };
  });

  const handleTrackPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    const value = valueFromClientX(event.clientX);
    if (value === null) return;
    const minDistance = Math.abs(value - minValue);
    const maxDistance = Math.abs(value - maxValue);
    const thumb =
      minDistance === maxDistance
        ? value <= minValue
          ? "min"
          : "max"
        : minDistance < maxDistance
          ? "min"
          : "max";
    updateThumb(thumb, value);
    dragThumbRef.current = thumb;
  };

  const handleThumbPointerDown =
    (thumb: RangeThumb) => (event: ReactPointerEvent<HTMLButtonElement>) => {
      event.preventDefault();
      event.stopPropagation();
      dragThumbRef.current = thumb;
    };

  const handleThumbKeyDown = (thumb: RangeThumb) => (event: KeyboardEvent<HTMLButtonElement>) => {
    let value: number | null = null;
    const currentValue = thumb === "min" ? minValue : maxValue;
    if (event.key === "ArrowLeft" || event.key === "ArrowDown") value = currentValue - step;
    if (event.key === "ArrowRight" || event.key === "ArrowUp") value = currentValue + step;
    if (event.key === "Home") value = min;
    if (event.key === "End") value = max;
    if (value === null) return;
    event.preventDefault();
    updateThumb(thumb, normalizeValue(value));
  };

  const percent = (value: number) => ((clamp(value, min, max) - min) / span) * 100;
  const minPercent = percent(minValue);
  const maxPercent = percent(maxValue);

  const thumb = (kind: RangeThumb, value: number, ariaLabel: string, left: number) => (
    <button
      type="button"
      role="slider"
      aria-label={ariaLabel}
      aria-valuemin={kind === "min" ? min : minValue}
      aria-valuemax={kind === "max" ? max : maxValue}
      aria-valuenow={value}
      onPointerDown={handleThumbPointerDown(kind)}
      onKeyDown={handleThumbKeyDown(kind)}
      className={`absolute top-1/2 h-5 w-5 -translate-x-1/2 -translate-y-1/2 touch-none rounded-full border-2 border-violet-50 bg-gradient-to-b from-fuchsia-300 to-violet-500 shadow-[0_5px_16px_rgba(139,92,246,0.45)] outline-none transition-transform hover:scale-110 focus-visible:ring-2 focus-visible:ring-violet-200 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950 ${thumbClassName}`}
      style={{ left: `${left}%` }}
    />
  );

  return (
    <div className="relative h-9">
      <div
        ref={trackRef}
        className="absolute inset-x-0 top-1/2 h-2 -translate-y-1/2 cursor-pointer touch-none"
        onPointerDown={handleTrackPointerDown}
      >
        <div className={`absolute inset-0 rounded-full ${trackClassName}`} />
        <div
          className={`absolute top-0 h-full rounded-full ${activeTrackClassName}`}
          style={{ left: `${minPercent}%`, right: `${100 - maxPercent}%` }}
        />
      </div>
      {thumb("min", minValue, minAriaLabel, minPercent)}
      {thumb("max", maxValue, maxAriaLabel, maxPercent)}
    </div>
  );
}
