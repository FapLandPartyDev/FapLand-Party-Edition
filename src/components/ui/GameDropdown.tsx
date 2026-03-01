import { useEffect, useId, useRef, useState } from "react";

export type GameOption<T extends string> = {
  value: T;
  label: string;
  disabled?: boolean;
  heading?: boolean;
};

export function GameDropdown<T extends string>({
  label,
  value,
  options,
  onChange,
  disabled,
  onHoverSfx,
  onSelectSfx,
  className,
  menuPlacement = "bottom",
}: {
  label?: string;
  value: T;
  options: GameOption<T>[];
  onChange: (next: T) => void;
  disabled?: boolean;
  onHoverSfx?: () => void;
  onSelectSfx?: () => void;
  className?: string;
  menuPlacement?: "top" | "bottom";
}) {
  const [open, setOpen] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState<number>(-1);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const listboxId = useId();

  const selectedIndex = options.findIndex((opt) => opt.value === value);

  const enabledIndices = options.reduce<number[]>((indices, option, index) => {
    if (!option.disabled && !option.heading) {
      indices.push(index);
    }
    return indices;
  }, []);
  const defaultHighlightedIndex =
    selectedIndex >= 0 && !options[selectedIndex]?.disabled
      ? selectedIndex
      : (enabledIndices[0] ?? -1);

  const focusOption = (index: number) => {
    if (index < 0) return;
    requestAnimationFrame(() => {
      optionRefs.current[index]?.focus();
    });
  };

  const openMenu = (preferredIndex = defaultHighlightedIndex) => {
    setHighlightedIndex(preferredIndex);
    setOpen(true);
    focusOption(preferredIndex);
  };

  const moveHighlight = (direction: 1 | -1) => {
    if (enabledIndices.length === 0) return;

    const currentPosition = enabledIndices.indexOf(highlightedIndex);
    const fallbackPosition = direction > 0 ? -1 : enabledIndices.length;
    const basePosition = currentPosition >= 0 ? currentPosition : fallbackPosition;
    const nextPosition = (basePosition + direction + enabledIndices.length) % enabledIndices.length;
    const nextIndex = enabledIndices[nextPosition] ?? -1;
    setHighlightedIndex(nextIndex);
    focusOption(nextIndex);
  };

  const selectOption = (index: number) => {
    const option = options[index];
    if (!option || option.disabled || option.heading) return;
    onChange(option.value);
    setOpen(false);
    setHighlightedIndex(index);
    triggerRef.current?.focus();
  };

  useEffect(() => {
    const onPointerDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
      }
    };

    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    if (highlightedIndex < 0) return;
    optionRefs.current[highlightedIndex]?.focus();
  }, [highlightedIndex, open]);

  useEffect(() => {
    if (!open) return;
    const nextIndex = defaultHighlightedIndex;
    if (nextIndex !== highlightedIndex) {
      setHighlightedIndex(nextIndex);
    }
  }, [defaultHighlightedIndex, highlightedIndex, open]);

  const selected = options.find((opt) => opt.value === value && !opt.heading) ?? options[0];

  const noop = () => {};
  const hover = onHoverSfx ?? noop;
  const select = onSelectSfx ?? noop;
  const menuPositionClass = menuPlacement === "top" ? "bottom-full mb-2" : "top-full mt-2";

  return (
    <div
      ref={rootRef}
      data-controller-skip={open ? "true" : undefined}
      className={`relative ${open ? "z-[1000]" : ""} ${className ?? ""}`}
    >
      {label && (
        <span className="mb-2 block font-[family-name:var(--font-jetbrains-mono)] text-[10px] uppercase tracking-[0.25em] text-zinc-300">
          {label}
        </span>
      )}
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        onMouseEnter={hover}
        onFocus={hover}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listboxId : undefined}
        onClick={() => {
          select();
          setOpen((prev) => {
            const nextOpen = !prev;
            if (nextOpen) {
              const nextIndex = defaultHighlightedIndex;
              setHighlightedIndex(nextIndex);
              focusOption(nextIndex);
            }
            return nextOpen;
          });
        }}
        onKeyDown={(event) => {
          if (disabled) return;

          if (event.key === "ArrowDown") {
            event.preventDefault();
            if (!open) {
              openMenu();
              return;
            }
            moveHighlight(1);
            return;
          }

          if (event.key === "ArrowUp") {
            event.preventDefault();
            if (!open) {
              openMenu();
              return;
            }
            moveHighlight(-1);
            return;
          }

          if (event.key === "Home") {
            if (!open || enabledIndices.length === 0) return;
            event.preventDefault();
            setHighlightedIndex(enabledIndices[0] ?? -1);
            return;
          }

          if (event.key === "End") {
            if (!open || enabledIndices.length === 0) return;
            event.preventDefault();
            setHighlightedIndex(enabledIndices[enabledIndices.length - 1] ?? -1);
            return;
          }

          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            if (!open) {
              openMenu();
            }
          }
        }}
        className={`flex w-full items-center justify-between rounded-xl border bg-black/45 px-4 py-3 text-sm text-zinc-100 outline-none transition-all duration-200 hover:border-violet-200/60 focus:border-violet-200/70 focus:ring-2 focus:ring-violet-400/30 ${disabled ? "cursor-not-allowed border-zinc-600 opacity-50" : "border-violet-300/30"}`}
      >
        <span>{selected?.label ?? ""}</span>
        <span
          className={`text-xs text-violet-200 transition-transform duration-200 ${open ? "rotate-180" : ""}`}
        >
          ▾
        </span>
      </button>

      {open && (
        <div
          id={listboxId}
          role="listbox"
          aria-activedescendant={
            highlightedIndex >= 0 ? `${listboxId}-option-${highlightedIndex}` : undefined
          }
          tabIndex={-1}
          className={`absolute z-50 w-full overflow-hidden rounded-xl border border-violet-300/35 bg-zinc-950/95 shadow-[0_0_24px_rgba(139,92,246,0.38)] backdrop-blur-xl ${menuPositionClass}`}
        >
          {options.map((option, index) => {
            if (option.heading) {
              return (
                <div
                  key={`heading-${index}`}
                  className="border-t border-white/10 px-3 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-[0.15em] text-zinc-500"
                >
                  {option.label}
                </div>
              );
            }

            const active = option.value === value;
            const highlighted = index === highlightedIndex;
            return (
              <button
                key={option.value}
                id={`${listboxId}-option-${index}`}
                ref={(element) => {
                  optionRefs.current[index] = element;
                }}
                type="button"
                role="option"
                aria-selected={active}
                tabIndex={highlighted ? 0 : -1}
                disabled={option.disabled}
                onMouseEnter={hover}
                onMouseMove={() => {
                  if (!option.disabled) {
                    setHighlightedIndex(index);
                  }
                }}
                onClick={() => {
                  select();
                  selectOption(index);
                }}
                onKeyDown={(event) => {
                  if (event.key === "ArrowDown") {
                    event.preventDefault();
                    moveHighlight(1);
                    return;
                  }

                  if (event.key === "ArrowUp") {
                    event.preventDefault();
                    moveHighlight(-1);
                    return;
                  }

                  if (event.key === "Home") {
                    if (enabledIndices.length === 0) return;
                    event.preventDefault();
                    setHighlightedIndex(enabledIndices[0] ?? -1);
                    return;
                  }

                  if (event.key === "End") {
                    if (enabledIndices.length === 0) return;
                    event.preventDefault();
                    setHighlightedIndex(enabledIndices[enabledIndices.length - 1] ?? -1);
                    return;
                  }

                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    select();
                    selectOption(index);
                    return;
                  }

                  if (event.key === "Escape") {
                    event.preventDefault();
                    setOpen(false);
                    triggerRef.current?.focus();
                    return;
                  }

                  if (event.key === "Tab") {
                    setOpen(false);
                  }
                }}
                className={`flex w-full items-center justify-between px-3 py-2.5 text-left text-sm outline-none transition-colors duration-150 ${
                  option.disabled
                    ? "cursor-not-allowed text-zinc-500"
                    : highlighted
                      ? "bg-violet-500/25 text-violet-100"
                      : active
                        ? "bg-violet-500/15 text-violet-100"
                        : "text-zinc-200 hover:bg-violet-500/15"
                }`}
              >
                <span>{option.label}</span>
                {active && !option.disabled && (
                  <span aria-hidden="true" className="text-xs text-violet-200">
                    ●
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
