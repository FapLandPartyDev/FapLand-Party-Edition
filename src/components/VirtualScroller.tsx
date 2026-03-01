import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from "react";
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

    const commitValue = useCallback(
        (nextVal: number) => {
            let clamped = nextVal;
            if (clamped < min) clamped = min;
            if (clamped > max) clamped = max;

            // Snap to step if step is an integer (for typical millisecond usage)
            if (Number.isInteger(step)) {
                clamped = Math.round(clamped / step) * step;
            }

            if (clamped !== value) {
                onChange(clamped);
            }
        },
        [max, min, onChange, step, value],
    );

    useEffect(() => {
        const handlePointerMove = (e: PointerEvent) => {
            if (!isDragging || !startDragRef.current) return;

            e.preventDefault();
            const deltaX = e.clientX - startDragRef.current.x;

            // Adjust sensitivity based on shift/alt modifiers
            let multiplier = 1;
            if (e.shiftKey) multiplier = 10;
            if (e.altKey) multiplier = 0.1;

            // Calculate step-based change
            const rawDelta = deltaX * step * multiplier * 0.5; // 0.5 is base sensitivity

            commitValue(startDragRef.current.val + rawDelta);
        };

        const handlePointerUp = () => {
            if (isDragging) {
                setIsDragging(false);
                startDragRef.current = null;
                playSelectSound();
                document.body.style.cursor = "default";
            }
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

    const handlePointerDown = (e: React.PointerEvent) => {
        if (isEditing) return;

        e.preventDefault();
        setIsDragging(true);
        startDragRef.current = { x: e.clientX, val: value };
        playHoverSound();

        // Attempt to set grabbing cursor
        document.body.style.cursor = "ew-resize";
    };

    const handleDoubleClick = () => {
        setIsEditing(true);
        setEditValue(value.toString());
        playSelectSound();
    }

    const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
        if (e.key === "Enter") {
            e.preventDefault();
            const parsed = parseFloat(editValue);
            if (!isNaN(parsed)) {
                commitValue(parsed);
            }
            setIsEditing(false);
            playSelectSound();
        } else if (e.key === "Escape") {
            setIsEditing(false);
        }
    };

    return (
        <div className={`flex flex-col gap-1 ${className}`}>
            {label && <span className="text-xs font-medium text-zinc-400 uppercase tracking-wider">{label}</span>}

            <div
                className={`relative flex h-9 items-center justify-center overflow-hidden rounded-xl border transition-all duration-200
          ${isDragging ? "border-violet-400/80 bg-violet-500/20 shadow-[0_0_15px_rgba(139,92,246,0.3)] scale-[1.02]" : "border-zinc-700/80 bg-black/50 hover:border-violet-300/50 hover:bg-black/70"}
          ${isEditing ? "border-cyan-400/80 bg-black" : ""}
        `}
                onPointerDown={handlePointerDown}
                onDoubleClick={handleDoubleClick}
            >
                {isDragging && (
                    <div className="absolute inset-0 bg-[linear-gradient(45deg,transparent_25%,rgba(139,92,246,0.1)_50%,transparent_75%)] bg-[length:24px_24px] animate-[slide_1s_linear_infinite]" />
                )}

                {isEditing ? (
                    <input
                        autoFocus
                        type="text"
                        value={editValue}
                        onChange={e => setEditValue(e.target.value)}
                        onBlur={() => {
                            const parsed = parseFloat(editValue);
                            if (!isNaN(parsed)) commitValue(parsed);
                            setIsEditing(false);
                        }}
                        onKeyDown={handleKeyDown}
                        className="w-full h-full bg-transparent text-center font-[family-name:var(--font-jetbrains-mono)] text-sm text-cyan-100 outline-none"
                    />
                ) : (
                    <span className={`font-[family-name:var(--font-jetbrains-mono)] text-sm select-none pointer-events-none transition-colors ${isDragging ? "text-violet-100 font-bold" : "text-zinc-200"}`}>
                        {formatValue(value)}
                    </span>
                )}
            </div>
        </div>
    );
}
