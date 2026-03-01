import { useEffect, useId, useRef, type ReactNode } from "react";
import { useLingui } from "@lingui/react/macro";
import { playHoverSound } from "../../utils/audio";

export type ConfirmDialogVariant = "danger" | "warning" | "default";

export type ConfirmDialogProps = {
  isOpen: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: ConfirmDialogVariant;
  isPending?: boolean;
  children?: ReactNode;
  onConfirm: () => void;
  onCancel: () => void;
};

const variantStyles: Record<
  ConfirmDialogVariant,
  {
    border: string;
    shadow: string;
    labelColor: string;
    titleColor: string;
    confirmBorder: string;
    confirmBg: string;
    confirmText: string;
    confirmHoverBorder: string;
    confirmHoverBg: string;
  }
> = {
  danger: {
    border: "border-rose-300/35",
    shadow: "shadow-[0_0_60px_rgba(244,63,94,0.28)]",
    labelColor: "text-rose-200/80",
    titleColor: "text-rose-50",
    confirmBorder: "border-rose-300/70",
    confirmBg: "bg-rose-500/25",
    confirmText: "text-rose-100",
    confirmHoverBorder: "hover:border-rose-200/90",
    confirmHoverBg: "hover:bg-rose-500/40",
  },
  warning: {
    border: "border-amber-300/35",
    shadow: "shadow-[0_0_60px_rgba(251,191,36,0.28)]",
    labelColor: "text-amber-200/80",
    titleColor: "text-amber-50",
    confirmBorder: "border-amber-300/70",
    confirmBg: "bg-amber-500/25",
    confirmText: "text-amber-100",
    confirmHoverBorder: "hover:border-amber-200/90",
    confirmHoverBg: "hover:bg-amber-500/40",
  },
  default: {
    border: "border-zinc-300/35",
    shadow: "shadow-[0_0_60px_rgba(161,161,170,0.18)]",
    labelColor: "text-zinc-300/80",
    titleColor: "text-zinc-50",
    confirmBorder: "border-zinc-400/70",
    confirmBg: "bg-zinc-500/25",
    confirmText: "text-zinc-100",
    confirmHoverBorder: "hover:border-zinc-300/90",
    confirmHoverBg: "hover:bg-zinc-500/40",
  },
};

export function ConfirmDialog({
  isOpen,
  title,
  message,
  confirmLabel,
  cancelLabel,
  variant = "danger",
  isPending = false,
  children,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const { t } = useLingui();
  const titleId = useId();
  const descriptionId = useId();
  const cancelButtonRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!isOpen) return;

    const focusTimer = window.setTimeout(() => {
      cancelButtonRef.current?.focus();
    }, 0);

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !isPending) {
        event.preventDefault();
        onCancel();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.clearTimeout(focusTimer);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [isOpen, isPending, onCancel]);

  if (!isOpen) return null;

  const s = variantStyles[variant];
  const resolvedConfirmLabel = confirmLabel ?? t`Confirm`;
  const resolvedCancelLabel = cancelLabel ?? t`Cancel`;
  const variantLabel = t`Confirm Action`;

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/70 px-4 backdrop-blur-sm">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        className={`w-full max-w-lg rounded-3xl border ${s.border} bg-zinc-950/95 p-6 ${s.shadow}`}
      >
        <p
          className={`font-[family-name:var(--font-jetbrains-mono)] text-xs uppercase tracking-[0.35em] ${s.labelColor}`}
        >
          {variantLabel}
        </p>
        <h2 id={titleId} className={`mt-3 text-2xl font-black tracking-tight ${s.titleColor}`}>
          {title}
        </h2>
        <p id={descriptionId} className="mt-2 text-sm text-zinc-400 whitespace-pre-line">
          {message}
        </p>
        {children}

        <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button
            ref={cancelButtonRef}
            type="button"
            disabled={isPending}
            onMouseEnter={playHoverSound}
            onClick={onCancel}
            className={`rounded-xl border px-4 py-2 text-sm font-semibold transition-all duration-200 ${
              isPending
                ? "cursor-not-allowed border-zinc-700 bg-zinc-900 text-zinc-500"
                : "border-zinc-600 bg-zinc-900/80 text-zinc-200 hover:border-zinc-400 hover:text-zinc-100"
            }`}
          >
            {resolvedCancelLabel}
          </button>
          <button
            type="button"
            disabled={isPending}
            onMouseEnter={playHoverSound}
            onClick={onConfirm}
            className={`rounded-xl border px-4 py-2 text-sm font-semibold transition-all duration-200 ${
              isPending
                ? "cursor-not-allowed border-zinc-600 bg-zinc-800 text-zinc-500"
                : `${s.confirmBorder} ${s.confirmBg} ${s.confirmText} ${s.confirmHoverBorder} ${s.confirmHoverBg}`
            }`}
          >
            {isPending ? t`Processing...` : resolvedConfirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
