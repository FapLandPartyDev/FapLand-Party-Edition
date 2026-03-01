import React from "react";
import { Trans, useLingui } from "@lingui/react/macro";
import { useSfwMode } from "../../../hooks/useSfwMode";
import { playHoverSound, playSelectSound } from "../../../utils/audio";
import { abbreviateNsfwText } from "../../../utils/sfwText";
import type { EditorNode } from "../EditorState";
import type { TileCatalogCategory, TileCatalogTile } from "../tileCatalog";

interface TileSidebarProps {
    categoryTabs: ReadonlyArray<{ id: TileCatalogCategory["id"] | "all"; label: string }>;
    activeCategory: TileCatalogCategory["id"] | "all";
    tileSearch: string;
    filteredTiles: ReadonlyArray<TileCatalogTile & { kind: EditorNode["kind"] }>;
    activePlacementKind: EditorNode["kind"];
    onCategoryChange: (category: TileCatalogCategory["id"] | "all") => void;
    onSearchChange: (search: string) => void;
    onArmTile: (tile: TileCatalogTile & { kind: EditorNode["kind"] }) => void;
}

const KIND_COLOR_MAP: Record<string, string> = {
    start: "bg-emerald-500",
    end: "bg-rose-500",
    path: "bg-zinc-500",
    safePoint: "bg-amber-500",
    campfire: "bg-orange-500",
    round: "bg-cyan-500",
    randomRound: "bg-purple-500",
    perk: "bg-violet-500",
};

export const TileSidebar: React.FC<TileSidebarProps> = React.memo(({
    categoryTabs,
    activeCategory,
    tileSearch,
    filteredTiles,
    activePlacementKind,
    onCategoryChange,
    onSearchChange,
    onArmTile,
}) => {
    const { t } = useLingui();
    const sfwMode = useSfwMode();

    return (
    <aside className="editor-panel flex min-h-0 w-full flex-col rounded-xl border border-white/8 bg-black/30 xl:w-64 xl:flex-shrink-0">
        {/* ── Header ─────────────────── */}
        <div className="flex-shrink-0 border-b border-white/6 px-3 py-2.5">
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-zinc-500">
                <Trans>Tiles</Trans>
            </p>
        </div>

        {/* ── Category pills ─────────────────── */}
        <div className="flex flex-shrink-0 flex-wrap gap-1 border-b border-white/6 px-3 py-2">
            {categoryTabs.map((category) => {
                const isActive = activeCategory === category.id;
                return (
                    <button
                        key={category.id}
                        type="button"
                        className={`editor-tool-button rounded-md px-2 py-1 text-[11px] font-semibold transition-all ${isActive
                            ? "bg-cyan-500/18 text-cyan-200"
                            : "text-zinc-500 hover:bg-white/5 hover:text-zinc-300"
                            }`}
                        onMouseEnter={playHoverSound}
                        onClick={() => {
                            playSelectSound();
                            onCategoryChange(category.id);
                        }}
                    >
                        {category.label}
                    </button>
                );
            })}
        </div>

        {/* ── Search ─────────────────── */}
        <div className="flex-shrink-0 px-3 py-2">
            <input
                id="tile-search-input"
                type="text"
                placeholder={t`Search tiles`}
                value={tileSearch}
                onChange={(event) => onSearchChange(event.target.value)}
                className="w-full rounded-md border border-zinc-700/50 bg-zinc-950/60 px-2.5 py-1.5 text-xs text-zinc-200 outline-none placeholder:text-zinc-600 transition-colors focus:border-cyan-500/50"
            />
        </div>

        {/* ── Tile list ─────────────────── */}
        <div className="min-h-0 flex-1 space-y-1 overflow-y-auto px-2 pb-2">
            {filteredTiles.map((tile, index) => {
                const isActive = activePlacementKind === tile.kind;
                const dotColor = KIND_COLOR_MAP[tile.kind] ?? "bg-zinc-500";
                return (
                    <button
                        key={tile.id}
                        type="button"
                        className={`editor-tile-card group w-full rounded-lg border px-2.5 py-2 text-left transition-all ${isActive
                            ? "is-active border-cyan-400/50 bg-cyan-500/12"
                            : "border-transparent hover:border-zinc-700/50 hover:bg-white/3"
                            }`}
                        onMouseEnter={playHoverSound}
                        onClick={() => onArmTile(tile)}
                    >
                        <div className="flex items-center gap-2">
                            <span className={`h-2 w-2 flex-shrink-0 rounded-full ${dotColor}`} />
                            <span className={`flex-1 text-xs font-medium ${isActive ? "text-cyan-100" : "text-zinc-300 group-hover:text-zinc-100"}`}>
                                {tile.label}
                            </span>
                            {index < 9 && (
                                <kbd className="rounded bg-white/6 px-1 py-0.5 font-mono text-[10px] text-zinc-600">
                                    {index + 1}
                                </kbd>
                            )}
                        </div>
                        {tile.description && (
                            <p className="mt-0.5 pl-4 text-[11px] text-zinc-600">
                                {abbreviateNsfwText(tile.description, sfwMode)}
                            </p>
                        )}
                    </button>
                );
            })}
            {filteredTiles.length === 0 && (
                <div className="rounded-lg px-3 py-4 text-center text-xs text-zinc-600">
                    <Trans>No tiles match this filter.</Trans>
                </div>
            )}
        </div>
    </aside>
    );
});

TileSidebar.displayName = "TileSidebar";
