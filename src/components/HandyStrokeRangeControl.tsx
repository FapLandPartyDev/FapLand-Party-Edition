import {
  useEffect,
  useRef,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";

type DragThumb = "min" | "max";

type StrokeDrag = {
  pointerId: number;
  target: DragThumb | "range";
  startX: number;
  startMin: number;
  startMax: number;
};

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
  const dragRef = useRef<StrokeDrag | null>(null);

  useEffect(() => {
    if (disabled) {
      dragRef.current = null;
      return;
    }

    const updateFromClientX = (clientX: number, drag: StrokeDrag, commit: boolean) => {
      const track = trackRef.current;
      if (!track) return;
      const rect = track.getBoundingClientRect();
      if (rect.width <= 0) return;

      if (drag.target === "range") {
        const offset = Math.round(((clientX - drag.startX) / rect.width) * 100);
        const shift = Math.max(-drag.startMin, Math.min(100 - drag.startMax, offset));
        const nextMin = drag.startMin + shift;
        const nextMax = drag.startMax + shift;
        onPreview(nextMin, nextMax);
        if (commit && shift !== 0) onCommit(nextMin, nextMax);
        return;
      }

      const percent = clampPercent(((clientX - rect.left) / rect.width) * 100);
      const nextMin = drag.target === "min" ? Math.min(percent, maxValue) : minValue;
      const nextMax = drag.target === "max" ? Math.max(percent, minValue) : maxValue;
      onPreview(nextMin, nextMax);
      if (commit) {
        onCommit(nextMin, nextMax);
      }
    };

    const handlePointerMove = (event: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag || drag.pointerId !== event.pointerId) return;
      updateFromClientX(event.clientX, drag, false);
    };

    const handlePointerUp = (event: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag || drag.pointerId !== event.pointerId) return;
      dragRef.current = null;
      updateFromClientX(event.clientX, drag, true);
    };

    const handlePointerCancel = (event: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag || drag.pointerId !== event.pointerId) return;
      dragRef.current = null;
      onPreview(drag.startMin, drag.startMax);
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
    window.addEventListener("pointercancel", handlePointerCancel);
    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      window.removeEventListener("pointercancel", handlePointerCancel);
    };
  }, [disabled, maxValue, minValue, onCommit, onPreview]);

  const startDrag = (event: ReactPointerEvent, target: StrokeDrag["target"]) => {
    event.preventDefault();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    dragRef.current = {
      pointerId: event.pointerId,
      target,
      startX: event.clientX,
      startMin: minValue,
      startMax: maxValue,
    };
  };

  const handleTrackPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (disabled || event.button !== 0 || dragRef.current) return;
    const track = trackRef.current;
    if (!track) return;
    const rect = track.getBoundingClientRect();
    if (rect.width <= 0) return;
    const pointerPercent = ((event.clientX - rect.left) / rect.width) * 100;
    if (pointerPercent > minValue && pointerPercent < maxValue) {
      startDrag(event, "range");
      return;
    }

    const clickedPercent = clampPercent(pointerPercent);
    const midpoint = (minValue + maxValue) / 2;
    const thumb: DragThumb = clickedPercent <= midpoint ? "min" : "max";
    const nextMin = thumb === "min" ? Math.min(clickedPercent, maxValue) : minValue;
    const nextMax = thumb === "max" ? Math.max(clickedPercent, minValue) : maxValue;
    onPreview(nextMin, nextMax);
    onCommit(nextMin, nextMax);
  };

  const handleThumbPointerDown = (
    event: ReactPointerEvent<HTMLButtonElement>,
    thumb: DragThumb
  ) => {
    if (disabled || event.button !== 0 || dragRef.current) return;
    startDrag(event, thumb);
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
        className={`absolute inset-x-0 top-1/2 h-2 -translate-y-1/2 touch-none ${disabled ? "cursor-not-allowed" : "cursor-pointer"}`}
        onPointerDown={handleTrackPointerDown}
      >
        <div className={`absolute inset-0 rounded-full ${trackClassName}`} />
        <div
          className={`absolute top-0 h-full rounded-full ${disabled ? "" : "cursor-grab active:cursor-grabbing"} ${activeTrackClassName}`}
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
        onPointerDown={(event) => handleThumbPointerDown(event, "min")}
        onKeyDown={handleThumbKeyDown("min")}
        className={`absolute top-1/2 h-5 w-5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-cyan-50 bg-gradient-to-b from-emerald-300 to-cyan-400 shadow-[0_6px_18px_rgba(34,211,238,0.35)] transition-transform hover:scale-105 disabled:cursor-not-allowed disabled:opacity-50 ${thumbClassName}`}
        style={{ left: `${minValue}%` }}
      />
      <button
        type="button"
        aria-label={maxAriaLabel}
        disabled={disabled}
        onPointerDown={(event) => handleThumbPointerDown(event, "max")}
        onKeyDown={handleThumbKeyDown("max")}
        className={`absolute top-1/2 h-5 w-5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-cyan-50 bg-gradient-to-b from-emerald-300 to-cyan-400 shadow-[0_6px_18px_rgba(34,211,238,0.35)] transition-transform hover:scale-105 disabled:cursor-not-allowed disabled:opacity-50 ${thumbClassName}`}
        style={{ left: `${maxValue}%` }}
      />
    </div>
  );
}
