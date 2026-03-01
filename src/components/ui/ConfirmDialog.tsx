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
  onConfirm: () => void;
  onCancel: () => void;
};

const variantStyles: Record<
  ConfirmDialogVariant,
  {
    label: string;
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
    label: "Confirm Action",
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
    label: "Confirm Action",
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
    label: "Confirm Action",
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
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  variant = "danger",
  isPending = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  if (!isOpen) return null;

  const s = variantStyles[variant];

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/70 px-4 backdrop-blur-sm">
      <div
        className={`w-full max-w-lg rounded-3xl border ${s.border} bg-zinc-950/95 p-6 ${s.shadow}`}
      >
        <p
          className={`font-[family-name:var(--font-jetbrains-mono)] text-xs uppercase tracking-[0.35em] ${s.labelColor}`}
        >
          {s.label}
        </p>
        <h2 className={`mt-3 text-2xl font-black tracking-tight ${s.titleColor}`}>{title}</h2>
        <p className="mt-2 text-sm text-zinc-400 whitespace-pre-line">{message}</p>

        <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button
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
            {cancelLabel}
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
            {isPending ? "Processing..." : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
