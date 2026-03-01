import { useLingui } from "@lingui/react/macro";

type InventoryDockButtonProps = {
  count: number;
  isOpen: boolean;
  onClick: () => void;
  position?: "default" | "video-view";
  pulse?: boolean;
  controlsVisible?: boolean;
};

export function InventoryDockButton({
  count,
  isOpen,
  onClick,
  position = "default",
  pulse = false,
  controlsVisible = true,
}: InventoryDockButtonProps) {
  const { t } = useLingui();
  const positionClasses = position === "video-view" ? "bottom-24 right-4" : "bottom-4 left-4";

  return (
    <button
      type="button"
      aria-label={isOpen ? t`Close inventory controls` : t`Open inventory controls`}
      title={isOpen ? t`Close Inventory` : t`Open Inventory`}
      className={`fixed z-[115] flex h-12 w-12 items-center justify-center rounded-full border backdrop-blur transition-all duration-200 ${positionClasses} ${controlsVisible ? "opacity-100" : "pointer-events-none opacity-0"} ${pulse ? "inventory-dock-pulse" : ""} ${isOpen ? "border-cyan-400/70 bg-cyan-500/20 text-cyan-100" : "border-zinc-600 bg-zinc-950/95 text-zinc-100 hover:border-zinc-400"}`}
      onClick={onClick}
    >
      <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5" aria-hidden="true">
        <path
          d="M4 7h16M7 12h10M10 17h4"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
        />
      </svg>
      <span className="absolute -right-1 -top-1 min-w-6 rounded-full border border-cyan-200/65 bg-cyan-500/30 px-1.5 text-xs font-bold text-cyan-50">
        {count}
      </span>
    </button>
  );
}
