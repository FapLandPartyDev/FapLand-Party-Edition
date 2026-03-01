import { Trans } from "@lingui/react/macro";
import React, { useRef, useState } from "react";

interface MenuButtonProps {
  label: string;
  onClick?: () => void;
  disabled?: boolean;
  onHover?: () => void;
  primary?: boolean;
  experimental?: boolean;
  badge?: string;
  subLabel?: string;
  statusTone?: "default" | "success" | "warning" | "danger";
  selected?: boolean;
  controllerFocusId?: string;
  controllerInitial?: boolean;
  controllerBack?: boolean;
}

const toneClasses: Record<NonNullable<MenuButtonProps["statusTone"]>, string> = {
  default: "border-zinc-400/40 bg-zinc-400/10 text-zinc-200",
  success: "border-emerald-400/50 bg-emerald-400/15 text-emerald-100",
  warning: "border-amber-400/50 bg-amber-400/15 text-amber-100",
  danger: "border-rose-400/50 bg-rose-400/15 text-rose-100",
};

export const MenuButton: React.FC<MenuButtonProps> = ({
  label,
  onClick,
  disabled = false,
  onHover,
  primary = false,
  experimental = false,
  badge,
  subLabel,
  statusTone = "default",
  selected = false,
  controllerFocusId,
  controllerInitial = false,
  controllerBack = false,
}) => {
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [isFocused, setIsFocused] = useState(false);
  const isActive = selected || isFocused;

  const handleClick = (event: React.MouseEvent<HTMLButtonElement>) => {
    const button = buttonRef.current;
    if (!button || disabled) return;

    const ripple = document.createElement("span");
    const rect = button.getBoundingClientRect();
    const size = Math.max(rect.width, rect.height) * 2;
    ripple.style.cssText = `
      position:absolute;
      width:${size}px;
      height:${size}px;
      border-radius:50%;
      background:rgba(255,255,255,0.15);
      transform:translate(-50%,-50%) scale(0);
      left:${event.clientX - rect.left}px;
      top:${event.clientY - rect.top}px;
      animation:ripple-expand 0.6s ease-out forwards;
      pointer-events:none;
    `;
    button.appendChild(ripple);
    setTimeout(() => ripple.remove(), 700);

    onClick?.();
  };

  return (
    <button
      ref={buttonRef}
      type="button"
      onClick={handleClick}
      onMouseEnter={onHover}
      disabled={disabled}
      onFocus={() => setIsFocused(true)}
      onBlur={() => setIsFocused(false)}
      data-controller-focus-id={controllerFocusId}
      data-controller-initial={controllerInitial ? "true" : undefined}
      data-controller-back={controllerBack ? "true" : undefined}
      style={
        {
          "--glow": primary
            ? "var(--main-menu-primary-glow, rgba(139,92,246,0.7))"
            : "var(--main-menu-secondary-glow, rgba(255,255,255,0.15))",
          boxShadow: isActive
            ? primary
              ? "0 0 40px var(--main-menu-primary-glow, rgba(139,92,246,0.65)), 0 0 80px var(--main-menu-primary-glow-soft, rgba(139,92,246,0.2))"
              : "0 0 20px var(--main-menu-secondary-glow, rgba(255,255,255,0.12))"
            : undefined,
        } as React.CSSProperties
      }
      className={[
        "relative w-full overflow-hidden",
        "rounded-xl px-10 py-4",
        "font-[family-name:var(--font-jetbrains-mono)] text-base font-bold uppercase tracking-[0.2em] sm:text-lg",
        "transition-all duration-200 ease-out",
        "focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--main-menu-focus-ring)]",
        disabled ? "cursor-not-allowed opacity-55" : "group cursor-pointer",
        isActive
          ? primary
            ? "scale-[1.03] -translate-y-0.5"
            : "scale-[1.02] -translate-y-0.5"
          : disabled
            ? ""
            : "hover:scale-[1.01]",
      ].join(" ")}
    >
      <div
        className={[
          "absolute inset-0 rounded-xl transition-all duration-200",
          primary || isActive ? "" : "bg-zinc-900/60",
        ].join(" ")}
        style={{
          background: primary
            ? isActive
              ? "var(--main-menu-primary-gradient-active)"
              : "var(--main-menu-primary-gradient)"
            : isActive
              ? "var(--main-menu-secondary-active-bg)"
              : "var(--main-menu-secondary-bg)",
        }}
      />

      <div
        className={[
          "absolute inset-0 rounded-xl border transition-all duration-300",
          primary || isActive ? "" : "border-zinc-700/30",
        ].join(" ")}
        style={{
          borderColor: primary
            ? isActive
              ? "var(--main-menu-primary-border-active)"
              : "var(--main-menu-primary-border)"
            : isActive
              ? "var(--main-menu-secondary-border-active)"
              : "var(--main-menu-secondary-border)",
        }}
      />

      <div
        className={[
          "absolute inset-x-0 top-0 h-[1px] transition-opacity duration-300",
          primary
            ? isActive
              ? "opacity-100"
              : "opacity-40"
            : isActive
              ? "bg-gradient-to-r from-transparent via-white/20 to-transparent opacity-100"
              : "opacity-0",
        ].join(" ")}
        style={{
          background: primary
            ? "linear-gradient(to right, transparent, var(--main-menu-primary-border-active), transparent)"
            : undefined,
        }}
      />

      {isActive && (
        <div
          className={[
            "absolute inset-0 -z-10 rounded-xl blur-xl opacity-60 transition-opacity duration-300",
            primary ? "" : "bg-zinc-700",
          ].join(" ")}
          style={{
            background: primary ? "var(--main-menu-primary-gradient-active)" : undefined,
            transform: "scaleY(1.4) scaleX(1.1)",
          }}
        />
      )}

      <div className="absolute inset-0 rounded-xl bg-white/[0.02]" />

      <span className="relative z-10 flex items-center justify-center gap-3">
        <span
          className={[
            "text-xs transition-all duration-200",
            isActive ? "w-3 opacity-100" : "w-0 opacity-0",
            primary ? "" : "text-zinc-400",
          ].join(" ")}
          style={{ color: primary ? "var(--main-menu-primary-arrow)" : undefined }}
        >
          ▶
        </span>

        <span
          className={[
            "flex items-center gap-3 transition-colors duration-200",
            primary
              ? isActive
                ? ""
                : ""
              : isActive
                ? "text-white"
                : "text-zinc-400",
          ].join(" ")}
          style={{
            color: primary
              ? isActive
                ? "var(--main-menu-primary-text-active)"
                : "var(--main-menu-primary-text)"
              : undefined,
          }}
        >
          <span className="flex flex-col items-start gap-1">
            <span className="flex items-center gap-3">
              <span>{label}</span>
              {badge && (
                <span
                  className={`rounded border px-2 py-0.5 text-[0.6rem] font-bold tracking-[0.14em] ${toneClasses[statusTone]}`}
                >
                  {badge}
                </span>
              )}
            </span>
            {subLabel && (
              <span className="text-[0.58rem] font-medium uppercase tracking-[0.18em] text-zinc-300/75">
                {subLabel}
              </span>
            )}
          </span>
          {experimental && (
            <span className="relative flex items-center justify-center rounded border border-amber-500/50 bg-amber-500/20 px-2 py-0.5 text-[0.6rem] font-bold uppercase tracking-[0.15em] text-amber-300 shadow-[0_0_10px_rgba(245,158,11,0.2)]">
              <span className="absolute inset-0 overflow-hidden rounded bg-[repeating-linear-gradient(45deg,transparent,transparent_4px,rgba(245,158,11,0.1)_4px,rgba(245,158,11,0.1)_8px)]" />
              <span className="relative z-10 animate-pulse">
                <Trans>Experimental</Trans>
              </span>
            </span>
          )}
        </span>

        {primary && (
          <span
            className={`text-sm transition-all duration-300 ${isActive ? "translate-x-0.5 opacity-100" : "translate-x-0 opacity-50"}`}
            style={{ color: "var(--main-menu-primary-arrow)" }}
          >
            →
          </span>
        )}
      </span>
    </button>
  );
};

MenuButton.displayName = "MenuButton";
