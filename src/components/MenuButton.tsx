import React, { useRef, useCallback } from 'react';

interface MenuButtonProps {
    label: string;
    onClick?: () => void;
    onHover?: () => void;
    primary?: boolean;
    experimental?: boolean;
    badge?: string;
    subLabel?: string;
    statusTone?: "default" | "success" | "warning" | "danger";
    selected?: boolean;
}

const toneClasses: Record<NonNullable<MenuButtonProps["statusTone"]>, string> = {
    default: "border-zinc-400/40 bg-zinc-400/10 text-zinc-200",
    success: "border-emerald-400/50 bg-emerald-400/15 text-emerald-100",
    warning: "border-amber-400/50 bg-amber-400/15 text-amber-100",
    danger: "border-rose-400/50 bg-rose-400/15 text-rose-100",
};

export const MenuButton: React.FC<MenuButtonProps> = React.memo(({ label, onClick, onHover, primary = false, experimental = false, badge, subLabel, statusTone = "default", selected = false }) => {
    const buttonRef = useRef<HTMLButtonElement>(null);

    // Ripple effect on click
    const handleClick = useCallback((e: React.MouseEvent<HTMLButtonElement>) => {
        const btn = buttonRef.current;
        if (!btn) return;

        const ripple = document.createElement('span');
        const rect = btn.getBoundingClientRect();
        const size = Math.max(rect.width, rect.height) * 2;
        ripple.style.cssText = `
            position:absolute;
            width:${size}px;
            height:${size}px;
            border-radius:50%;
            background:rgba(255,255,255,0.15);
            transform:translate(-50%,-50%) scale(0);
            left:${e.clientX - rect.left}px;
            top:${e.clientY - rect.top}px;
            animation:ripple-expand 0.6s ease-out forwards;
            pointer-events:none;
        `;
        btn.appendChild(ripple);
        setTimeout(() => ripple.remove(), 700);

        onClick?.();
    }, [onClick]);

    return (
        <button
            ref={buttonRef}
            type="button"
            onClick={handleClick}
            onMouseEnter={onHover}
            style={{ '--glow': primary ? 'rgba(139,92,246,0.7)' : 'rgba(255,255,255,0.15)' } as React.CSSProperties}
            className={[
                'relative overflow-hidden w-full',
                'font-[family-name:var(--font-jetbrains-mono)] font-bold tracking-[0.2em] uppercase text-base sm:text-lg',
                'rounded-xl px-10 py-4',
                'transition-all duration-200 ease-out',
                'focus:outline-none focus-visible:ring-2 focus-visible:ring-purple-400/60',
                'cursor-pointer group',
                selected
                    ? primary
                        ? 'scale-[1.03] -translate-y-0.5 shadow-[0_0_40px_rgba(139,92,246,0.65),0_0_80px_rgba(139,92,246,0.2)]'
                        : 'scale-[1.02] -translate-y-0.5 shadow-[0_0_20px_rgba(255,255,255,0.12)]'
                    : 'hover:scale-[1.01]',
            ].join(' ')}
        >
            {/* Background layer */}
            <div
                className={[
                    'absolute inset-0 rounded-xl transition-all duration-200',
                    primary
                        ? selected
                            ? 'bg-gradient-to-r from-violet-500 via-purple-500 to-indigo-500'
                            : 'bg-gradient-to-r from-violet-600/80 via-purple-600/80 to-indigo-600/80'
                        : selected
                            ? 'bg-zinc-800/80'
                            : 'bg-zinc-900/60',
                ].join(' ')}
            />

            {/* Glass border — animated gradient on select */}
            <div
                className={[
                    'absolute inset-0 rounded-xl border transition-all duration-300',
                    primary
                        ? selected
                            ? 'border-violet-400/60'
                            : 'border-purple-600/40'
                        : selected
                            ? 'border-zinc-500/50'
                            : 'border-zinc-700/30',
                ].join(' ')}
            />

            {/* Top gloss highlight */}
            <div className={[
                'absolute inset-x-0 top-0 h-[1px] transition-opacity duration-300',
                primary
                    ? selected ? 'bg-gradient-to-r from-transparent via-violet-300/60 to-transparent opacity-100' : 'opacity-40 bg-gradient-to-r from-transparent via-purple-400/40 to-transparent'
                    : selected ? 'bg-gradient-to-r from-transparent via-white/20 to-transparent opacity-100' : 'opacity-0',
            ].join(' ')} />

            {/* Glow bloom behind */}
            {selected && (
                <div className={[
                    'absolute inset-0 -z-10 rounded-xl blur-xl opacity-60 transition-opacity duration-300',
                    primary ? 'bg-gradient-to-r from-violet-600 via-purple-600 to-indigo-600' : 'bg-zinc-700',
                ].join(' ')} style={{ transform: 'scaleY(1.4) scaleX(1.1)' }} />
            )}

            {/* Backdrop blur inner */}
            <div className="absolute inset-0 rounded-xl" style={{ backdropFilter: 'blur(8px)' }} />

            {/* Content */}
            <span className="relative z-10 flex items-center justify-center gap-3">
                {/* Left accent mark for selected */}
                <span className={[
                    'text-xs transition-all duration-200',
                    selected ? 'opacity-100 w-3' : 'opacity-0 w-0',
                    primary ? 'text-violet-200' : 'text-zinc-400',
                ].join(' ')}>▶</span>

                <span className={[
                    'transition-colors duration-200 flex items-center gap-3',
                    primary
                        ? selected ? 'text-white' : 'text-violet-100'
                        : selected ? 'text-white' : 'text-zinc-400',
                ].join(' ')}>
                    <span className="flex flex-col items-start gap-1">
                        <span className="flex items-center gap-3">
                            <span>{label}</span>
                            {badge && (
                                <span className={`rounded border px-2 py-0.5 text-[0.6rem] font-bold tracking-[0.14em] ${toneClasses[statusTone]}`}>
                                    {badge}
                                </span>
                            )}
                        </span>
                        {subLabel && (
                            <span className="text-[0.58rem] font-medium tracking-[0.18em] uppercase text-zinc-300/75">
                                {subLabel}
                            </span>
                        )}
                    </span>
                    {experimental && (
                        <span className="relative flex items-center justify-center rounded border border-amber-500/50 bg-amber-500/20 px-2 py-0.5 text-[0.6rem] font-bold uppercase tracking-[0.15em] text-amber-300 shadow-[0_0_10px_rgba(245,158,11,0.2)]">
                            <span className="absolute inset-0 overflow-hidden rounded bg-[repeating-linear-gradient(45deg,transparent,transparent_4px,rgba(245,158,11,0.1)_4px,rgba(245,158,11,0.1)_8px)]"></span>
                            <span className="relative z-10 animate-pulse">Experimental</span>
                        </span>
                    )}
                </span>

                {primary && (
                    <span className={`text-sm transition-all duration-300 ${selected ? 'opacity-100 translate-x-0.5' : 'opacity-50 translate-x-0'} ${primary ? 'text-violet-200' : 'text-zinc-500'}`}>
                        →
                    </span>
                )}
            </span>
        </button>
    );
});

MenuButton.displayName = 'MenuButton';
