import { useEffect, useEffectEvent, useRef, useState, type KeyboardEvent } from "react";
import { playHoverSound, playSelectSound } from "../utils/audio";

interface VirtualScrollerProps {
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  label?: string;
  className?: string;
  formatValue?: (value: number) => string;
}

export function VirtualScroller({
  value,
  onChange,
  min = -Infinity,
  max = Infinity,
  step = 1,
  label,
  className = "",
  formatValue = (v) => v.toString(),
}: VirtualScrollerProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState("");
  const startDragRef = useRef<{ x: number; val: number } | null>(null);

  const commitValue = useEffectEvent((nextValue: number) => {
    let clamped = nextValue;
    if (clamped < min) clamped = min;
    if (clamped > max) clamped = max;

    if (Number.isInteger(step)) {
      clamped = Math.round(clamped / step) * step;
    }

    if (clamped !== value) {
      onChange(clamped);
    }
  });

  useEffect(() => {
    const handlePointerMove = (event: PointerEvent) => {
      if (!isDragging || !startDragRef.current) return;

      event.preventDefault();
      const deltaX = event.clientX - startDragRef.current.x;
      let multiplier = 1;
      if (event.shiftKey) multiplier = 10;
      if (event.altKey) multiplier = 0.1;

      const rawDelta = deltaX * step * multiplier * 0.5;
      commitValue(startDragRef.current.val + rawDelta);
    };

    const handlePointerUp = () => {
      if (!isDragging) return;
      setIsDragging(false);
      startDragRef.current = null;
      playSelectSound();
      document.body.style.cursor = "default";
    };

    if (isDragging) {
      window.addEventListener("pointermove", handlePointerMove);
      window.addEventListener("pointerup", handlePointerUp);
    }

    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    };
  }, [commitValue, isDragging, step]);

  const handlePointerDown = (event: React.PointerEvent) => {
    if (isEditing) return;

    event.preventDefault();
    setIsDragging(true);
    startDragRef.current = { x: event.clientX, val: value };
    playHoverSound();
    document.body.style.cursor = "ew-resize";
  };

  const handleDoubleClick = () => {
    setIsEditing(true);
    setEditValue(value.toString());
    playSelectSound();
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.preventDefault();
      const parsed = parseFloat(editValue);
      if (!Number.isNaN(parsed)) {
        commitValue(parsed);
      }
      setIsEditing(false);
      playSelectSound();
    } else if (event.key === "Escape") {
      setIsEditing(false);
    }
  };

  return (
    <div className={`flex flex-col gap-1 ${className}`}>
      {label && (
        <span className="text-xs font-medium uppercase tracking-wider text-zinc-400">{label}</span>
      )}

      <div
        className={`relative flex h-9 items-center justify-center overflow-hidden rounded-xl border transition-all duration-200
          ${isDragging ? "scale-[1.02] border-violet-400/80 bg-violet-500/20 shadow-[0_0_15px_rgba(139,92,246,0.3)]" : "border-zinc-700/80 bg-black/50 hover:border-violet-300/50 hover:bg-black/70"}
          ${isEditing ? "border-cyan-400/80 bg-black" : ""}
        `}
        onPointerDown={handlePointerDown}
        onDoubleClick={handleDoubleClick}
      >
        {isDragging && (
          <div className="absolute inset-0 animate-[slide_1s_linear_infinite] bg-[linear-gradient(45deg,transparent_25%,rgba(139,92,246,0.1)_50%,transparent_75%)] bg-[length:24px_24px]" />
        )}

        {isEditing ? (
          <input
            // eslint-disable-next-line jsx-a11y/no-autofocus -- intentional: user double-clicked to edit
            autoFocus
            type="text"
            value={editValue}
            onChange={(event) => setEditValue(event.target.value)}
            onBlur={() => {
              const parsed = parseFloat(editValue);
              if (!Number.isNaN(parsed)) commitValue(parsed);
              setIsEditing(false);
            }}
            onKeyDown={handleKeyDown}
            className="h-full w-full bg-transparent text-center font-[family-name:var(--font-jetbrains-mono)] text-sm text-cyan-100 outline-none"
          />
        ) : (
          <span
            className={`pointer-events-none select-none font-[family-name:var(--font-jetbrains-mono)] text-sm transition-colors ${isDragging ? "font-bold text-violet-100" : "text-zinc-200"}`}
          >
            {formatValue(value)}
          </span>
        )}
      </div>
    </div>
  );
}
