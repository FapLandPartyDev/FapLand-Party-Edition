import React from "react";
import { Trans, useLingui } from "@lingui/react/macro";
import { useSfwMode } from "../../../hooks/useSfwMode";
import { playHoverSound, playSelectSound } from "../../../utils/audio";
import { abbreviateNsfwText } from "../../../utils/sfwText";
import type { EditorNode } from "../EditorState";
import type { TileCatalogCategory, TileCatalogTile } from "../tileCatalog";
import { MAP_EDITOR_DRAG_TYPE, serializeMapEditorDragItem } from "../mapEditorDrag";

export interface HeroGroupItem {
  heroId: string;
  heroName: string;
  heroAuthor: string | null;
  rounds: ReadonlyArray<unknown>;
}

export interface RoundListItem {
  roundId: string;
  name: string;
  author: string | null;
  type: string | null;
}

interface TileSidebarProps {
  categoryTabs: ReadonlyArray<{ id: TileCatalogCategory["id"] | "all"; label: string }>;
  activeCategory: TileCatalogCategory["id"] | "all";
  tileSearch: string;
  filteredTiles: ReadonlyArray<TileCatalogTile & { kind: EditorNode["kind"] }>;
  activePlacementKind: EditorNode["kind"];
  heroGroups: ReadonlyArray<HeroGroupItem>;
  isHeroPlacementActive: boolean;
  rounds: ReadonlyArray<RoundListItem>;
  armedRoundId: string | null;
  isRoundPlacementActive: boolean;
  onCategoryChange: (category: TileCatalogCategory["id"] | "all") => void;
  onSearchChange: (search: string) => void;
  onArmTile: (tile: TileCatalogTile & { kind: EditorNode["kind"] }) => void;
  onArmHero: (heroGroup: HeroGroupItem) => void;
  onArmRound: (round: RoundListItem) => void;
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

const ROUND_TYPE_DOT_COLOR: Record<string, string> = {
  Normal: "bg-sky-500",
  Interjection: "bg-amber-500",
  Cum: "bg-rose-500",
};

function getRoundTypeDotColor(type: string | null): string {
  if (type && ROUND_TYPE_DOT_COLOR[type]) return ROUND_TYPE_DOT_COLOR[type];
  return ROUND_TYPE_DOT_COLOR.Normal;
}

export const TileSidebar: React.FC<TileSidebarProps> = React.memo(
  ({
    categoryTabs,
    activeCategory,
    tileSearch,
    filteredTiles,
    activePlacementKind,
    heroGroups,
    isHeroPlacementActive,
    rounds,
    armedRoundId,
    isRoundPlacementActive,
    onCategoryChange,
    onSearchChange,
    onArmTile,
    onArmHero,
    onArmRound,
  }) => {
    const { t } = useLingui();
    const sfwMode = useSfwMode();
    const [heroesExpanded, setHeroesExpanded] = React.useState(false);
    const [roundsExpanded, setRoundsExpanded] = React.useState(false);
    const [roundSearch, setRoundSearch] = React.useState("");

    const roundSearchQuery = roundSearch.trim().toLowerCase();
    const filteredRounds = React.useMemo(() => {
      if (!roundSearchQuery) return rounds;
      return rounds.filter((round) => {
        const text = [round.name, round.author ?? "", round.type ?? ""].join(" ").toLowerCase();
        return text.includes(roundSearchQuery);
      });
    }, [rounds, roundSearchQuery]);

    const startDrag = React.useCallback(
      (
        event: React.DragEvent<HTMLElement>,
        item: Parameters<typeof serializeMapEditorDragItem>[0]
      ) => {
        event.dataTransfer.effectAllowed = "copy";
        event.dataTransfer.setData(MAP_EDITOR_DRAG_TYPE, serializeMapEditorDragItem(item));
        event.dataTransfer.setData(
          "text/plain",
          item.type === "node" ? item.nodeKind : item.type === "round" ? item.roundId : item.heroId
        );
      },
      []
    );

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
                className={`editor-tool-button rounded-md px-2 py-1 text-[11px] font-semibold transition-all ${
                  isActive
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
            const isActive =
              activePlacementKind === tile.kind &&
              !isHeroPlacementActive &&
              !isRoundPlacementActive;
            const dotColor = KIND_COLOR_MAP[tile.kind] ?? "bg-zinc-500";
            return (
              <button
                key={tile.id}
                type="button"
                draggable
                className={`editor-tile-card group w-full cursor-grab rounded-lg border px-2.5 py-2 text-left transition-all active:cursor-grabbing ${
                  isActive
                    ? "is-active border-cyan-400/50 bg-cyan-500/12"
                    : "border-transparent hover:border-zinc-700/50 hover:bg-white/3"
                }`}
                onMouseEnter={playHoverSound}
                onClick={() => onArmTile(tile)}
                onDragStart={(event) => startDrag(event, { type: "node", nodeKind: tile.kind })}
              >
                <div className="flex items-center gap-2">
                  <span className={`h-2 w-2 flex-shrink-0 rounded-full ${dotColor}`} />
                  <span
                    className={`flex-1 text-xs font-medium ${isActive ? "text-cyan-100" : "text-zinc-300 group-hover:text-zinc-100"}`}
                  >
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

        {/* ── Rounds section ─────────────────── */}
        {rounds.length > 0 && (
          <div className="flex-shrink-0 border-t border-white/6">
            <button
              type="button"
              onClick={() => {
                playSelectSound();
                setRoundsExpanded((v) => !v);
              }}
              onMouseEnter={playHoverSound}
              className="flex w-full items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-white/3"
            >
              <span
                className={`text-[10px] text-sky-300/70 transition-transform ${roundsExpanded ? "rotate-90" : ""}`}
              >
                ▶
              </span>
              <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-sky-200/80">
                <Trans>Rounds</Trans>
              </span>
              <span className="ml-auto rounded-full bg-sky-400/15 px-1.5 py-0.5 text-[10px] font-medium text-sky-300/70">
                {rounds.length}
              </span>
            </button>
            {roundsExpanded && (
              <div className="px-2 pb-2">
                <input
                  id="round-search-input"
                  type="search"
                  placeholder={t`Search rounds`}
                  value={roundSearch}
                  onChange={(event) => setRoundSearch(event.target.value)}
                  className="mb-1.5 w-full rounded-md border border-zinc-700/50 bg-zinc-950/60 px-2.5 py-1.5 text-xs text-zinc-200 outline-none placeholder:text-zinc-600 transition-colors focus:border-sky-500/50"
                />
                <div className="max-h-48 space-y-0.5 overflow-y-auto">
                  {filteredRounds.map((round) => {
                    const isArmed = isRoundPlacementActive && armedRoundId === round.roundId;
                    const dotColor = getRoundTypeDotColor(round.type);
                    return (
                      <button
                        key={round.roundId}
                        type="button"
                        draggable
                        className={`group w-full cursor-grab rounded-lg border px-2.5 py-1.5 text-left text-xs transition-all active:cursor-grabbing ${
                          isArmed
                            ? "border-cyan-400/50 bg-cyan-500/12 text-cyan-100"
                            : "border-transparent hover:border-sky-400/30 hover:bg-sky-500/8"
                        }`}
                        onMouseEnter={playHoverSound}
                        onClick={() => onArmRound(round)}
                        onDragStart={(event) =>
                          startDrag(event, { type: "round", roundId: round.roundId })
                        }
                      >
                        <div className="flex items-center gap-2">
                          <span className={`h-2 w-2 flex-shrink-0 rounded-full ${dotColor}`} />
                          <span className="truncate font-medium text-zinc-200 group-hover:text-white">
                            {abbreviateNsfwText(round.name, sfwMode)}
                          </span>
                        </div>
                        {round.author && (
                          <div className="mt-0.5 truncate pl-4 text-[11px] text-zinc-600">
                            {abbreviateNsfwText(round.author, sfwMode)}
                          </div>
                        )}
                      </button>
                    );
                  })}
                  {filteredRounds.length === 0 && (
                    <div className="rounded-lg px-3 py-2 text-center text-[11px] text-zinc-600">
                      <Trans>No rounds match your search.</Trans>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── Heroes section ─────────────────── */}
        {heroGroups.length > 0 && (
          <div className="flex-shrink-0 border-t border-white/6">
            <button
              type="button"
              onClick={() => {
                playSelectSound();
                setHeroesExpanded((v) => !v);
              }}
              onMouseEnter={playHoverSound}
              className="flex w-full items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-white/3"
            >
              <span
                className={`text-[10px] text-amber-300/70 transition-transform ${heroesExpanded ? "rotate-90" : ""}`}
              >
                ▶
              </span>
              <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-amber-200/80">
                <Trans>Heroes</Trans>
              </span>
              <span className="ml-auto rounded-full bg-amber-400/15 px-1.5 py-0.5 text-[10px] font-medium text-amber-300/70">
                {heroGroups.length}
              </span>
            </button>
            {heroesExpanded && (
              <div className="max-h-48 space-y-0.5 overflow-y-auto px-2 pb-2">
                {heroGroups.map((group) => (
                  <button
                    key={group.heroId}
                    type="button"
                    draggable
                    className={`group w-full cursor-grab rounded-lg border px-2.5 py-1.5 text-left text-xs transition-all active:cursor-grabbing ${
                      isHeroPlacementActive
                        ? "border-cyan-400/50 bg-cyan-500/12 text-cyan-100"
                        : "border-transparent hover:border-amber-400/30 hover:bg-amber-500/8"
                    }`}
                    onMouseEnter={playHoverSound}
                    onClick={() => onArmHero(group)}
                    onDragStart={(event) =>
                      startDrag(event, { type: "hero", heroId: group.heroId })
                    }
                  >
                    <div className="flex items-center justify-between gap-1.5">
                      <span className="truncate font-medium text-zinc-200 group-hover:text-white">
                        {group.heroName}
                      </span>
                      <span className="shrink-0 rounded-full bg-white/6 px-1.5 py-0.5 text-[10px] text-zinc-500">
                        {group.rounds.length} <Trans>rounds</Trans>
                      </span>
                    </div>
                    {group.heroAuthor && (
                      <div className="mt-0.5 truncate text-[11px] text-zinc-600">
                        {group.heroAuthor}
                      </div>
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </aside>
    );
  }
);

TileSidebar.displayName = "TileSidebar";
