import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useLingui } from "@lingui/react/macro";

export type ToastVariant = "error" | "success" | "info";

type ToastEntry = {
  id: number;
  message: string;
  variant: ToastVariant;
};

type ToastContextValue = {
  showToast: (message: string, variant?: ToastVariant) => void;
};

const ToastContext = createContext<ToastContextValue | null>(null);

const TOAST_DURATION_MS = 4000;

let nextToastId = 0;
let globalToastDispatcher: ((message: string, variant?: ToastVariant) => void) | null = null;
const pendingGlobalToasts: Array<{ message: string; variant: ToastVariant }> = [];

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    throw new Error("useToast must be used within a ToastProvider");
  }
  return ctx;
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastEntry[]>([]);
  const timersRef = useRef<Map<number, number>>(new Map());

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
    const timer = timersRef.current.get(id);
    if (timer !== undefined) {
      window.clearTimeout(timer);
      timersRef.current.delete(id);
    }
  }, []);

  const showToast = useCallback(
    (message: string, variant: ToastVariant = "error") => {
      const id = nextToastId++;
      setToasts((prev) => [...prev, { id, message, variant }]);
      const timer = window.setTimeout(() => dismiss(id), TOAST_DURATION_MS);
      timersRef.current.set(id, timer);
    },
    [dismiss]
  );

  useEffect(() => {
    const timers = timersRef.current;
    return () => {
      timers.forEach((timer) => window.clearTimeout(timer));
      timers.clear();
    };
  }, []);

  const value = useMemo(() => ({ showToast }), [showToast]);

  useEffect(() => {
    globalToastDispatcher = showToast;
    if (pendingGlobalToasts.length > 0) {
      for (const toast of pendingGlobalToasts.splice(0)) {
        showToast(toast.message, toast.variant);
      }
    }
    return () => {
      if (globalToastDispatcher === showToast) {
        globalToastDispatcher = null;
      }
    };
  }, [showToast]);

  return (
    <ToastContext value={value}>
      {children}
      <ToastRenderer toasts={toasts} onDismiss={dismiss} />
    </ToastContext>
  );
}

export function showGlobalToast(message: string, variant: ToastVariant = "error"): void {
  if (globalToastDispatcher) {
    globalToastDispatcher(message, variant);
    return;
  }
  pendingGlobalToasts.push({ message, variant });
}

function ToastRenderer({
  toasts,
  onDismiss,
}: {
  toasts: ToastEntry[];
  onDismiss: (id: number) => void;
}) {
  if (toasts.length === 0) return null;

  return (
    <div className="fixed bottom-6 left-1/2 z-[200] flex -translate-x-1/2 flex-col items-center gap-2">
      {toasts.map((toast) => (
        <ToastItem key={toast.id} toast={toast} onDismiss={onDismiss} />
      ))}
    </div>
  );
}

const variantStyles: Record<ToastVariant, string> = {
  error: "border-rose-300/40 bg-rose-950/85 text-rose-100 shadow-rose-500/20",
  success: "border-emerald-300/40 bg-emerald-950/85 text-emerald-100 shadow-emerald-500/20",
  info: "border-zinc-300/40 bg-zinc-950/85 text-zinc-100 shadow-zinc-500/20",
};

function ToastItem({ toast, onDismiss }: { toast: ToastEntry; onDismiss: (id: number) => void }) {
  const { t } = useLingui();
  const role = toast.variant === "error" ? "alert" : "status";
  const live = toast.variant === "error" ? "assertive" : "polite";

  return (
    <div className="animate-entrance">
      <button
        type="button"
        role={role}
        aria-live={live}
        aria-label={t`Dismiss notification: ${toast.message}`}
        className={`cursor-pointer rounded-xl border px-5 py-3 text-sm font-semibold shadow-2xl backdrop-blur-xl ${variantStyles[toast.variant]}`}
        onClick={() => onDismiss(toast.id)}
      >
        {toast.message}
      </button>
    </div>
  );
}
