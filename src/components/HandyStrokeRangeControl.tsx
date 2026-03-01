import {
  useEffect,
  useRef,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";

type DragThumb = "min" | "max";

type HandyStrokeRangeControlProps = {
  minValue: number;
  maxValue: number;
  disabled?: boolean;
  onPreview: (minValue: number, maxValue: number) => void;
  onCommit: (minValue: number, maxValue: number) => void;
  minAriaLabel: string;
  maxAriaLabel: string;
  trackClassName?: string;
  activeTrackClassName?: string;
  thumbClassName?: string;
};

function clampPercent(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

export function HandyStrokeRangeControl({
  minValue,
  maxValue,
  disabled = false,
  onPreview,
  onCommit,
  minAriaLabel,
  maxAriaLabel,
  trackClassName = "bg-white/10",
  activeTrackClassName = "bg-cyan-400/70",
  thumbClassName = "",
}: HandyStrokeRangeControlProps) {
  const trackRef = useRef<HTMLDivElement | null>(null);
  const dragThumbRef = useRef<DragThumb | null>(null);

  useEffect(() => {
    if (disabled) return;

    const updateFromClientX = (clientX: number, thumb: DragThumb, commit: boolean) => {
      const track = trackRef.current;
      if (!track) return;
      const rect = track.getBoundingClientRect();
      if (rect.width <= 0) return;
      const percent = clampPercent(((clientX - rect.left) / rect.width) * 100);
      const nextMin = thumb === "min" ? Math.min(percent, maxValue) : minValue;
      const nextMax = thumb === "max" ? Math.max(percent, minValue) : maxValue;
      onPreview(nextMin, nextMax);
      if (commit) {
        onCommit(nextMin, nextMax);
      }
    };

    const handlePointerMove = (event: PointerEvent) => {
      if (!dragThumbRef.current) return;
      updateFromClientX(event.clientX, dragThumbRef.current, false);
    };

    const handlePointerUp = (event: PointerEvent) => {
      if (!dragThumbRef.current) return;
      updateFromClientX(event.clientX, dragThumbRef.current, true);
      dragThumbRef.current = null;
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    };
  }, [disabled, maxValue, minValue, onCommit, onPreview]);

  const handleTrackPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (disabled) return;
    const track = trackRef.current;
    if (!track) return;
    const rect = track.getBoundingClientRect();
    const clickedPercent = clampPercent(((event.clientX - rect.left) / rect.width) * 100);
    const midpoint = (minValue + maxValue) / 2;
    const thumb: DragThumb = clickedPercent <= midpoint ? "min" : "max";
    const nextMin = thumb === "min" ? Math.min(clickedPercent, maxValue) : minValue;
    const nextMax = thumb === "max" ? Math.max(clickedPercent, minValue) : maxValue;
    onPreview(nextMin, nextMax);
    onCommit(nextMin, nextMax);
  };

  const handleThumbPointerDown =
    (thumb: DragThumb) => (event: ReactPointerEvent<HTMLButtonElement>) => {
      if (disabled) return;
      event.preventDefault();
      event.stopPropagation();
      dragThumbRef.current = thumb;
    };

  const handleThumbKeyDown = (thumb: DragThumb) => (event: KeyboardEvent<HTMLButtonElement>) => {
    if (disabled) return;
    const direction =
      event.key === "ArrowLeft" || event.key === "ArrowDown"
        ? -1
        : event.key === "ArrowRight" || event.key === "ArrowUp"
          ? 1
          : 0;
    if (direction === 0) return;
    event.preventDefault();
    const nextMin =
      thumb === "min" ? Math.max(0, Math.min(minValue + direction, maxValue)) : minValue;
    const nextMax =
      thumb === "max" ? Math.min(100, Math.max(maxValue + direction, minValue)) : maxValue;
    onPreview(nextMin, nextMax);
    onCommit(nextMin, nextMax);
  };

  return (
    <div className="relative h-10">
      <div
        ref={trackRef}
        className="absolute inset-x-0 top-1/2 h-2 -translate-y-1/2 cursor-pointer"
        onPointerDown={handleTrackPointerDown}
      >
        <div className={`absolute inset-0 rounded-full ${trackClassName}`} />
        <div
          className={`absolute top-0 h-full rounded-full ${activeTrackClassName}`}
          style={{
            left: `${minValue}%`,
            right: `${100 - maxValue}%`,
          }}
        />
      </div>

      <button
        type="button"
        aria-label={minAriaLabel}
        disabled={disabled}
        onPointerDown={handleThumbPointerDown("min")}
        onKeyDown={handleThumbKeyDown("min")}
        className={`absolute top-1/2 h-5 w-5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-cyan-50 bg-gradient-to-b from-emerald-300 to-cyan-400 shadow-[0_6px_18px_rgba(34,211,238,0.35)] transition-transform hover:scale-105 disabled:cursor-not-allowed disabled:opacity-50 ${thumbClassName}`}
        style={{ left: `${minValue}%` }}
      />
      <button
        type="button"
        aria-label={maxAriaLabel}
        disabled={disabled}
        onPointerDown={handleThumbPointerDown("max")}
        onKeyDown={handleThumbKeyDown("max")}
        className={`absolute top-1/2 h-5 w-5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-cyan-50 bg-gradient-to-b from-emerald-300 to-cyan-400 shadow-[0_6px_18px_rgba(34,211,238,0.35)] transition-transform hover:scale-105 disabled:cursor-not-allowed disabled:opacity-50 ${thumbClassName}`}
        style={{ left: `${maxValue}%` }}
      />
    </div>
  );
}
