import { useEffect, useRef, useState } from "react";
import { useLingui } from "@lingui/react/macro";

type ShelfHeaderProps = {
  eyebrow: string;
  name: string;
  roundCount: number;
  expanded: boolean;
  status?: string | null;
  accent: "cyan" | "emerald";
  onToggle: () => void;
  onHoverSfx: () => void;
  actions?: Array<{ label: string; onClick: () => void; danger?: boolean; disabled?: boolean }>;
  selectionMode?: boolean;
  selected?: boolean;
  onToggleSelection?: () => void;
};

function ShelfHeader({
  eyebrow,
  name,
  roundCount,
  expanded,
  status,
  accent,
  onToggle,
  onHoverSfx,
  actions = [],
  selectionMode = false,
  selected = false,
  onToggleSelection,
}: ShelfHeaderProps) {
  const { t } = useLingui();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const close = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setMenuOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [menuOpen]);

  return (
    <div className={`round-shelf-header is-${accent}`}>
      {selectionMode && (
        <button
          type="button"
          aria-label={selected ? t`Deselect ${name}` : t`Select ${name}`}
          onClick={onToggleSelection}
          className={`round-shelf-select ${selected ? "is-selected" : ""}`}
        >
          {selected ? "✓" : ""}
        </button>
      )}
      <button
        type="button"
        onMouseEnter={onHoverSfx}
        onClick={onToggle}
        aria-expanded={expanded}
        className="flex min-w-0 flex-1 items-center gap-3 text-left"
      >
        <span className={`text-xs transition-transform ${expanded ? "rotate-90" : ""}`}>›</span>
        <div className="min-w-0">
          <span className="font-[family-name:var(--font-jetbrains-mono)] text-[9px] uppercase tracking-[0.16em] text-zinc-600">
            {eyebrow}
          </span>
          <h2 className="truncate text-base font-bold tracking-tight text-zinc-100">{name}</h2>
        </div>
        <span className="round-library-count-badge">{roundCount}</span>
        {status && <span className="truncate text-[10px] text-amber-300/70">{status}</span>}
        <span className="ml-auto text-[10px] text-zinc-600">
          {expanded ? t`Collapse` : t`Expand`}
        </span>
      </button>
      {actions.length > 0 && (
        <div ref={menuRef} className="relative">
          <button
            type="button"
            aria-label={t`Collection actions`}
            onClick={() => setMenuOpen((current) => !current)}
            className="round-library-icon-button h-8 w-8"
          >
            •••
          </button>
          {menuOpen && (
            <div className="round-library-command-menu right-0 top-9">
              {actions.map((action) => (
                <button
                  key={action.label}
                  type="button"
                  disabled={action.disabled}
                  onClick={() => {
                    setMenuOpen(false);
                    action.onClick();
                  }}
                  className={`round-library-command-item ${action.danger ? "is-danger" : ""}`}
                >
                  {action.label}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function HeroGroupHeader({
  heroName,
  roundCount,
  pendingCacheCount,
  pendingPreviewCount,
  expanded,
  converting,
  convertingHardMode,
  hasTemplateRounds,
  onToggle,
  onConvertToRound,
  onConvertLegacyFunscript,
  onRevertHardModeFunscript,
  onEditHero,
  onDeleteHero,
  onRetryTemplateLinking,
  onRepairTemplate,
  onHoverSfx,
  selectionMode,
  selected,
  onToggleSelection,
}: {
  heroName: string;
  roundCount: number;
  pendingCacheCount: number;
  pendingPreviewCount: number;
  expanded: boolean;
  converting: boolean;
  convertingHardMode: boolean;
  hasTemplateRounds: boolean;
  onToggle: () => void;
  onConvertToRound: () => void;
  onConvertLegacyFunscript: () => void;
  onRevertHardModeFunscript: () => void;
  onEditHero: () => void;
  onDeleteHero: () => void;
  onRetryTemplateLinking: () => void;
  onRepairTemplate: () => void;
  onHoverSfx: () => void;
  selectionMode?: boolean;
  selected?: boolean;
  onToggleSelection?: () => void;
}) {
  const { t } = useLingui();
  const pending = pendingCacheCount + pendingPreviewCount;
  return (
    <ShelfHeader
      eyebrow={t`Hero collection`}
      name={heroName}
      roundCount={roundCount}
      expanded={expanded}
      status={pending > 0 ? t`${pending} media tasks pending` : null}
      accent="cyan"
      onToggle={onToggle}
      onHoverSfx={onHoverSfx}
      selectionMode={selectionMode}
      selected={selected}
      onToggleSelection={onToggleSelection}
      actions={[
        { label: t`Edit hero`, onClick: onEditHero },
        {
          label: convertingHardMode
            ? t`Converting legacy script…`
            : t`Convert legacy script to hard mode`,
          onClick: onConvertLegacyFunscript,
          disabled: convertingHardMode,
        },
        {
          label: t`Restore previous script`,
          onClick: onRevertHardModeFunscript,
          disabled: convertingHardMode,
        },
        { label: t`Delete hero`, onClick: onDeleteHero, danger: true },
        ...(hasTemplateRounds
          ? [
              { label: t`Repair templates`, onClick: onRepairTemplate },
              { label: t`Retry auto-link`, onClick: onRetryTemplateLinking },
            ]
          : []),
        {
          label: converting ? t`Converting…` : t`Convert to round`,
          onClick: onConvertToRound,
          disabled: converting,
        },
      ]}
    />
  );
}

export function PlaylistGroupHeader({
  playlistName,
  roundCount,
  cachePending,
  expanded,
  onToggle,
  onHoverSfx,
}: {
  playlistName: string;
  roundCount: number;
  cachePending: boolean;
  expanded: boolean;
  onToggle: () => void;
  onHoverSfx: () => void;
}) {
  const { t } = useLingui();
  return (
    <ShelfHeader
      eyebrow={t`Playlist collection`}
      name={playlistName}
      roundCount={roundCount}
      expanded={expanded}
      status={cachePending ? t`Media caching` : null}
      accent="emerald"
      onToggle={onToggle}
      onHoverSfx={onHoverSfx}
    />
  );
}
