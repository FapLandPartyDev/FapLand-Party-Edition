import { useEffect, useRef, type ReactNode } from "react";
import { Trans } from "@lingui/react/macro";

export function Modal({
  title,
  children,
  onClose,
  onSubmit,
  submitLabel,
  disabled,
  destructiveActionLabel,
  onDestructiveAction,
  size = "md",
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  onSubmit?: () => void;
  submitLabel?: string;
  disabled?: boolean;
  destructiveActionLabel?: string;
  onDestructiveAction?: () => void;
  size?: "md" | "lg" | "xl";
}) {
  const panelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !disabled) {
        event.stopPropagation();
        onClose();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [disabled, onClose]);

  const widthClass =
    size === "xl" ? "max-w-4xl" : size === "lg" ? "max-w-3xl" : "max-w-2xl";

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center overflow-y-auto bg-black/75 px-4 py-8 backdrop-blur-sm"
      onMouseDown={(event) => {
        if (disabled) return;
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        className={`flex max-h-[88vh] w-full flex-col rounded-3xl border border-violet-300/30 bg-zinc-950/95 p-5 shadow-[0_0_40px_rgba(139,92,246,0.28)] app-theme-shell-border ${widthClass}`}
      >
        <div className="mb-4 flex flex-shrink-0 items-center justify-between gap-4">
          <h2 className="app-theme-heading text-xl font-extrabold tracking-tight">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            disabled={disabled}
            className="rounded-xl border border-zinc-700 bg-black/40 px-3 py-2 text-xs uppercase tracking-[0.18em] text-zinc-300 hover:border-zinc-600 hover:text-zinc-100 disabled:opacity-50"
          >
            <Trans>Close</Trans>
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto pr-1">{children}</div>
        {(onSubmit || onDestructiveAction) && (
          <div className="mt-4 flex flex-shrink-0 flex-wrap justify-end gap-3">
            {onDestructiveAction && destructiveActionLabel && (
              <button
                type="button"
                onClick={onDestructiveAction}
                disabled={disabled}
                className={`mr-auto rounded-xl border px-4 py-2 text-sm font-semibold ${
                  disabled
                    ? "cursor-not-allowed border-zinc-700 bg-zinc-800 text-zinc-500"
                    : "border-rose-300/60 bg-rose-500/20 text-rose-100 hover:bg-rose-500/35"
                }`}
              >
                {destructiveActionLabel}
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              disabled={disabled}
              className="rounded-xl border border-zinc-700 bg-black/40 px-4 py-2 text-sm text-zinc-300 hover:border-zinc-600 hover:text-zinc-100 disabled:opacity-50"
            >
              <Trans>Cancel</Trans>
            </button>
            {onSubmit && submitLabel && (
              <button
                type="button"
                onClick={onSubmit}
                disabled={disabled}
                className={`rounded-xl border px-4 py-2 text-sm font-semibold ${
                  disabled
                    ? "cursor-not-allowed border-zinc-700 bg-zinc-800 text-zinc-500"
                    : "border-emerald-300/60 bg-emerald-500/25 text-emerald-100 hover:bg-emerald-500/40"
                }`}
              >
                {submitLabel}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export function ModalField({
  label,
  children,
  className = "",
  hint,
}: {
  label: string;
  children: ReactNode;
  className?: string;
  hint?: ReactNode;
}) {
  return (
    <label className={`block ${className}`}>
      <span className="mb-1.5 block font-[family-name:var(--font-jetbrains-mono)] text-[10px] uppercase tracking-[0.2em] text-zinc-400">
        {label}
      </span>
      {children}
      {hint ? <span className="mt-1 block text-xs text-zinc-500">{hint}</span> : null}
    </label>
  );
}

export const modalInputClass =
  "w-full rounded-xl border border-violet-300/30 bg-black/45 px-3 py-2 text-sm text-zinc-100 outline-none transition-colors focus:border-violet-200/70 disabled:opacity-50";

export const modalSelectClass = modalInputClass;
