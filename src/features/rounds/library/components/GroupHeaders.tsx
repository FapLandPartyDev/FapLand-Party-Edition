import { useEffect, useRef, useState } from "react";
import { Trans, useLingui } from "@lingui/react/macro";

export function HeroGroupHeader({
  heroName,
  roundCount,
  pendingCacheCount,
  pendingPreviewCount,
  expanded,
  converting,
  hasTemplateRounds,
  onToggle,
  onConvertToRound,
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
  hasTemplateRounds: boolean;
  onToggle: () => void;
  onConvertToRound: () => void;
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
  const [showActions, setShowActions] = useState(false);
  const actionsRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!showActions) return;
    const onClick = (e: MouseEvent) => {
      if (actionsRef.current && !actionsRef.current.contains(e.target as Node)) {
        setShowActions(false);
      }
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [showActions]);

  return (
    <div className="flex w-full items-stretch gap-2">
      {selectionMode && (
        <button
          type="button"
          aria-label={selected ? t`Deselect ${heroName}` : t`Select ${heroName}`}
          onClick={(e) => {
            e.stopPropagation();
            onToggleSelection?.();
          }}
          className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border transition-all"
          style={{
            borderColor: selected ? "rgba(34,211,238,0.6)" : "rgba(255,255,255,0.3)",
            backgroundColor: selected ? "rgba(34,211,238,0.25)" : "rgba(0,0,0,0.4)",
          }}
        >
          {selected && <span className="text-cyan-200 text-sm">✓</span>}
        </button>
      )}
      <button
        type="button"
        onMouseEnter={onHoverSfx}
        onFocus={onHoverSfx}
        onClick={onToggle}
        className="flex min-w-0 flex-1 items-center justify-between rounded-2xl border border-violet-300/35 bg-black/45 px-4 py-3 text-left shadow-[0_0_25px_rgba(139,92,246,0.12)] transition-all duration-200 hover:border-violet-200/70 hover:bg-violet-500/12"
        aria-expanded={expanded}
        aria-label={t`${heroName} (${roundCount} rounds)`}
      >
        <div className="min-w-0">
          <p className="font-[family-name:var(--font-jetbrains-mono)] text-[10px] uppercase tracking-[0.25em] text-violet-200/85">
            <Trans>Hero Group</Trans>
          </p>
          <h2 className="mt-1 truncate text-lg font-extrabold tracking-tight text-zinc-100">
            {heroName}
          </h2>
        </div>
        <div className="flex items-center gap-3 pl-3">
          {pendingCacheCount > 0 && (
            <span className="rounded-md border border-amber-300/40 bg-amber-500/15 px-2 py-1 font-[family-name:var(--font-jetbrains-mono)] text-[10px] uppercase tracking-[0.2em] text-amber-100">
              {pendingCacheCount > 1 ? t`${pendingCacheCount} Caching` : t`Caching Ongoing`}
            </span>
          )}
          {pendingPreviewCount > 0 && (
            <span className="rounded-md border border-cyan-300/40 bg-cyan-500/15 px-2 py-1 font-[family-name:var(--font-jetbrains-mono)] text-[10px] uppercase tracking-[0.2em] text-cyan-100">
              {pendingPreviewCount > 1
                ? t`${pendingPreviewCount} Previews Generating`
                : t`Preview Is Being Generated`}
            </span>
          )}
          <span className="rounded-md border border-violet-300/40 bg-violet-500/15 px-2 py-1 font-[family-name:var(--font-jetbrains-mono)] text-[10px] uppercase tracking-[0.2em] text-violet-100">
            {t`${roundCount} Rounds`}
          </span>
          <span
            className={`text-violet-200 transition-transform duration-200 ${expanded ? "rotate-180" : ""}`}
          >
            ▾
          </span>
        </div>
      </button>
      <div ref={actionsRef} className="relative">
        <button
          type="button"
          onMouseEnter={onHoverSfx}
          onClick={() => setShowActions((v) => !v)}
          className="h-full rounded-2xl border border-violet-300/35 bg-violet-500/12 px-3 font-[family-name:var(--font-jetbrains-mono)] text-[10px] uppercase tracking-[0.2em] text-violet-100 transition-all duration-200 hover:border-violet-200/75 hover:bg-violet-500/24"
        >
          <Trans>Actions</Trans>
        </button>
        {showActions && (
          <div className="absolute right-0 top-full z-50 mt-2 min-w-[160px] overflow-hidden rounded-xl border border-violet-300/35 bg-zinc-950/95 shadow-[0_0_24px_rgba(139,92,246,0.38)] backdrop-blur-xl">
            <button
              type="button"
              onMouseEnter={onHoverSfx}
              onClick={() => {
                setShowActions(false);
                onEditHero();
              }}
              className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-sm text-cyan-100 transition-colors hover:bg-cyan-500/15"
            >
              <Trans>Edit Hero</Trans>
            </button>
            <button
              type="button"
              onMouseEnter={onHoverSfx}
              onClick={() => {
                setShowActions(false);
                onDeleteHero();
              }}
              className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-sm text-rose-100 transition-colors hover:bg-rose-500/15"
            >
              <Trans>Delete Hero</Trans>
            </button>
            {hasTemplateRounds && (
              <>
                <button
                  type="button"
                  onMouseEnter={onHoverSfx}
                  onClick={() => {
                    setShowActions(false);
                    onRepairTemplate();
                  }}
                  className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-sm text-amber-100 transition-colors hover:bg-amber-500/15"
                >
                  <Trans>Repair Templates</Trans>
                </button>
                <button
                  type="button"
                  onMouseEnter={onHoverSfx}
                  onClick={() => {
                    setShowActions(false);
                    onRetryTemplateLinking();
                  }}
                  className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-sm text-fuchsia-100 transition-colors hover:bg-fuchsia-500/15"
                >
                  <Trans>Retry Auto-Link</Trans>
                </button>
              </>
            )}
            <div className="my-1 h-px bg-zinc-700/50" />
            <button
              type="button"
              onMouseEnter={onHoverSfx}
              onClick={() => {
                setShowActions(false);
                onConvertToRound();
              }}
              disabled={converting}
              className={`flex w-full items-center gap-2 px-4 py-2.5 text-left text-sm transition-colors ${
                converting ? "cursor-wait text-zinc-400" : "text-rose-100 hover:bg-rose-500/15"
              }`}
            >
              {converting ? <Trans>Converting...</Trans> : <Trans>Convert to Round</Trans>}
            </button>
          </div>
        )}
      </div>
    </div>
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
    <button
      type="button"
      onMouseEnter={onHoverSfx}
      onFocus={onHoverSfx}
      onClick={onToggle}
      className="flex w-full min-w-0 items-center justify-between rounded-2xl border border-emerald-300/35 bg-black/45 px-4 py-3 text-left shadow-[0_0_25px_rgba(16,185,129,0.12)] transition-all duration-200 hover:border-emerald-200/70 hover:bg-emerald-500/12"
      aria-expanded={expanded}
      aria-label={t`${playlistName} (${roundCount} rounds)`}
    >
      <div className="min-w-0">
        <p className="font-[family-name:var(--font-jetbrains-mono)] text-[10px] uppercase tracking-[0.25em] text-emerald-200/85">
          <Trans>Playlist Group</Trans>
        </p>
        <h2 className="mt-1 truncate text-lg font-extrabold tracking-tight text-zinc-100">
          {playlistName}
        </h2>
        {cachePending && (
          <p className="mt-1 font-[family-name:var(--font-jetbrains-mono)] text-[10px] uppercase tracking-[0.18em] text-amber-200/90">
            <Trans>Caching ongoing</Trans>
          </p>
        )}
      </div>
      <div className="flex items-center gap-3 pl-3">
        {cachePending && (
          <span className="rounded-md border border-amber-300/45 bg-amber-500/15 px-2 py-1 font-[family-name:var(--font-jetbrains-mono)] text-[10px] uppercase tracking-[0.2em] text-amber-100">
            <Trans>Caching Ongoing</Trans>
          </span>
        )}
        <span className="rounded-md border border-emerald-300/40 bg-emerald-500/15 px-2 py-1 font-[family-name:var(--font-jetbrains-mono)] text-[10px] uppercase tracking-[0.2em] text-emerald-100">
          {t`${roundCount} Rounds`}
        </span>
        <span
          className={`text-emerald-200 transition-transform duration-200 ${expanded ? "rotate-180" : ""}`}
        >
          ▾
        </span>
      </div>
    </button>
  );
}
