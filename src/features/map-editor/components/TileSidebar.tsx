import React from "react";
import { Trans, useLingui } from "@lingui/react/macro";
import { SfwGuard } from "../../../components/SfwGuard";
import { useInstalledRoundMedia } from "../../../hooks/useInstalledRoundMedia";
import { useSfwMode } from "../../../hooks/useSfwMode";
import { playHoverSound, playSelectSound } from "../../../utils/audio";
import { abbreviateNsfwText } from "../../../utils/sfwText";
import { RoundCardPreviewVideo } from "../../rounds/library/components/RoundCardPreviewVideo";
import type { EditorNode } from "../EditorState";
import type {
  HeroLibrarySort,
  MapEditorSidebarTab,
  RoundLibrarySort,
  RoundTypeFilter,
} from "../mapEditorDraft";
import type { TileCatalogCategory, TileCatalogTile } from "../tileCatalog";
import { MAP_EDITOR_DRAG_TYPE, serializeMapEditorDragItem } from "../mapEditorDrag";

export interface HeroGroupItem {
  heroId: string;
  heroName: string;
  heroAuthor: string | null;
  rounds: ReadonlyArray<{ name?: string }>;
}

export interface RoundListItem {
  roundId: string;
  name: string;
  author: string | null;
  type: string | null;
  difficulty: number | null;
  durationSec: number | null;
  previewImage: string | null;
  startTime: number | null;
  endTime: number | null;
}

interface TileSidebarProps {
  activeTab: MapEditorSidebarTab;
  categoryTabs: ReadonlyArray<{ id: TileCatalogCategory["id"] | "all"; label: string }>;
  activeCategory: TileCatalogCategory["id"] | "all";
  tileSearch: string;
  roundSearch: string;
  roundTypeFilter: RoundTypeFilter;
  roundSort: RoundLibrarySort;
  heroSearch: string;
  heroSort: HeroLibrarySort;
  filteredTiles: ReadonlyArray<TileCatalogTile & { kind: EditorNode["kind"] }>;
  activePlacementKind: EditorNode["kind"];
  heroGroups: ReadonlyArray<HeroGroupItem>;
  armedHeroId: string | null;
  rounds: ReadonlyArray<RoundListItem>;
  armedRoundId: string | null;
  isRoundPlacementActive: boolean;
  isHeroPlacementActive: boolean;
  onTabChange: (tab: MapEditorSidebarTab) => void;
  onCategoryChange: (category: TileCatalogCategory["id"] | "all") => void;
  onTileSearchChange: (search: string) => void;
  onRoundSearchChange: (search: string) => void;
  onRoundTypeFilterChange: (filter: RoundTypeFilter) => void;
  onRoundSortChange: (sort: RoundLibrarySort) => void;
  onHeroSearchChange: (search: string) => void;
  onHeroSortChange: (sort: HeroLibrarySort) => void;
  onArmTile: (tile: TileCatalogTile & { kind: EditorNode["kind"] }) => void;
  onArmHero: (heroGroup: HeroGroupItem) => void;
  onArmRound: (round: RoundListItem) => void;
}

const SIDEBAR_TABS: MapEditorSidebarTab[] = ["tiles", "rounds", "heroes"];
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

const formatDuration = (seconds: number | null): string => {
  if (seconds === null || !Number.isFinite(seconds)) return "—";
  const rounded = Math.max(0, Math.round(seconds));
  return `${Math.floor(rounded / 60)}:${String(rounded % 60).padStart(2, "0")}`;
};

export const TileSidebar: React.FC<TileSidebarProps> = React.memo((props) => {
  const { t } = useLingui();
  const sfwMode = useSfwMode();
  const tabRefs = React.useRef<Record<MapEditorSidebarTab, HTMLButtonElement | null>>({
    tiles: null,
    rounds: null,
    heroes: null,
  });

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

  const filteredRounds = React.useMemo(() => {
    const query = props.roundSearch.trim().toLocaleLowerCase();
    const result = props.rounds.filter((round) => {
      if (props.roundTypeFilter !== "all" && round.type !== props.roundTypeFilter) return false;
      if (!query) return true;
      return `${round.name} ${round.author ?? ""} ${round.type ?? ""}`
        .toLocaleLowerCase()
        .includes(query);
    });
    return [...result].sort((a, b) => {
      if (props.roundSort === "difficulty") {
        return (
          (a.difficulty ?? Number.MAX_SAFE_INTEGER) - (b.difficulty ?? Number.MAX_SAFE_INTEGER)
        );
      }
      if (props.roundSort === "duration") {
        return (
          (a.durationSec ?? Number.MAX_SAFE_INTEGER) - (b.durationSec ?? Number.MAX_SAFE_INTEGER)
        );
      }
      return a.name.localeCompare(b.name, undefined, { sensitivity: "base", numeric: true });
    });
  }, [props.roundSearch, props.roundSort, props.roundTypeFilter, props.rounds]);

  const filteredHeroes = React.useMemo(() => {
    const query = props.heroSearch.trim().toLocaleLowerCase();
    const result = props.heroGroups.filter((hero) => {
      if (!query) return true;
      return `${hero.heroName} ${hero.heroAuthor ?? ""} ${hero.rounds.map((round) => round.name ?? "").join(" ")}`
        .toLocaleLowerCase()
        .includes(query);
    });
    return [...result].sort((a, b) =>
      props.heroSort === "roundCount"
        ? b.rounds.length - a.rounds.length || a.heroName.localeCompare(b.heroName)
        : a.heroName.localeCompare(b.heroName, undefined, { sensitivity: "base", numeric: true })
    );
  }, [props.heroGroups, props.heroSearch, props.heroSort]);

  const selectTab = (tab: MapEditorSidebarTab) => {
    playSelectSound();
    props.onTabChange(tab);
    requestAnimationFrame(() => tabRefs.current[tab]?.focus());
  };

  return (
    <aside className="editor-panel flex h-full min-h-0 w-full flex-col overflow-hidden rounded-xl border border-white/8 bg-black/30 xl:w-72 xl:flex-shrink-0">
      <div
        className="grid flex-shrink-0 grid-cols-3 border-b border-white/8 p-1.5"
        role="tablist"
        aria-label={t`Map content library`}
      >
        {SIDEBAR_TABS.map((tab) => {
          const active = props.activeTab === tab;
          const label = tab === "tiles" ? t`Tiles` : tab === "rounds" ? t`Rounds` : t`Heroes`;
          const count =
            tab === "rounds"
              ? props.rounds.length
              : tab === "heroes"
                ? props.heroGroups.length
                : null;
          return (
            <button
              key={tab}
              ref={(element) => {
                tabRefs.current[tab] = element;
              }}
              id={`map-library-tab-${tab}`}
              type="button"
              role="tab"
              tabIndex={active ? 0 : -1}
              aria-selected={active}
              aria-controls={`map-library-panel-${tab}`}
              className={`rounded-lg px-2 py-2 text-xs font-semibold transition ${active ? "bg-cyan-500/18 text-cyan-100" : "text-zinc-500 hover:bg-white/5 hover:text-zinc-200"}`}
              onMouseEnter={playHoverSound}
              onClick={() => selectTab(tab)}
              onKeyDown={(event) => {
                const index = SIDEBAR_TABS.indexOf(tab);
                const nextIndex =
                  event.key === "ArrowRight"
                    ? (index + 1) % SIDEBAR_TABS.length
                    : event.key === "ArrowLeft"
                      ? (index - 1 + SIDEBAR_TABS.length) % SIDEBAR_TABS.length
                      : event.key === "Home"
                        ? 0
                        : event.key === "End"
                          ? SIDEBAR_TABS.length - 1
                          : null;
                if (nextIndex === null) return;
                event.preventDefault();
                selectTab(SIDEBAR_TABS[nextIndex]!);
              }}
            >
              {label}
              {count !== null && <span className="ml-1 text-[10px] text-zinc-500">{count}</span>}
            </button>
          );
        })}
      </div>

      {props.activeTab === "tiles" && (
        <section
          id="map-library-panel-tiles"
          role="tabpanel"
          aria-labelledby="map-library-tab-tiles"
          className="flex min-h-0 flex-1 flex-col"
        >
          <div className="flex flex-shrink-0 flex-wrap gap-1 border-b border-white/6 px-3 py-2">
            {props.categoryTabs.map((category) => (
              <button
                key={category.id}
                type="button"
                className={`rounded-md px-2 py-1 text-[11px] font-semibold ${props.activeCategory === category.id ? "bg-cyan-500/18 text-cyan-200" : "text-zinc-500 hover:bg-white/5"}`}
                onClick={() => props.onCategoryChange(category.id)}
              >
                {category.label}
              </button>
            ))}
          </div>
          <div className="p-3 pb-2">
            <input
              id="tile-search-input"
              type="search"
              placeholder={t`Search tiles`}
              value={props.tileSearch}
              onChange={(event) => props.onTileSearchChange(event.target.value)}
              className="w-full rounded-md border border-zinc-700/50 bg-zinc-950/60 px-2.5 py-1.5 text-xs text-zinc-200 outline-none focus:border-cyan-500/50"
            />
          </div>
          <div className="min-h-0 flex-1 space-y-1 overflow-y-auto px-2 pb-2">
            {props.filteredTiles.map((tile, index) => {
              const active =
                props.activePlacementKind === tile.kind &&
                !props.isHeroPlacementActive &&
                !props.isRoundPlacementActive;
              return (
                <button
                  key={tile.id}
                  type="button"
                  draggable
                  className={`group w-full cursor-grab rounded-lg border px-2.5 py-2 text-left ${active ? "border-cyan-400/50 bg-cyan-500/12" : "border-transparent hover:border-zinc-700/50 hover:bg-white/3"}`}
                  onClick={() => props.onArmTile(tile)}
                  onDragStart={(event) => startDrag(event, { type: "node", nodeKind: tile.kind })}
                >
                  <div className="flex items-center gap-2">
                    <span
                      className={`h-2 w-2 rounded-full ${KIND_COLOR_MAP[tile.kind] ?? "bg-zinc-500"}`}
                    />
                    <span className="flex-1 text-xs font-medium text-zinc-200">{tile.label}</span>
                    {index < 9 && (
                      <kbd className="rounded bg-white/6 px-1 text-[10px] text-zinc-600">
                        {index + 1}
                      </kbd>
                    )}
                  </div>
                  {tile.description && (
                    <p className="mt-1 pl-4 text-[11px] text-zinc-600">
                      {abbreviateNsfwText(tile.description, sfwMode)}
                    </p>
                  )}
                </button>
              );
            })}
            {props.filteredTiles.length === 0 && (
              <EmptyState>
                <Trans>No tiles match this filter.</Trans>
              </EmptyState>
            )}
          </div>
        </section>
      )}

      {props.activeTab === "rounds" && (
        <section
          id="map-library-panel-rounds"
          role="tabpanel"
          aria-labelledby="map-library-tab-rounds"
          className="flex min-h-0 flex-1 flex-col"
        >
          <div className="space-y-2 border-b border-white/6 p-3">
            <input
              type="search"
              placeholder={t`Search rounds`}
              value={props.roundSearch}
              onChange={(event) => props.onRoundSearchChange(event.target.value)}
              className="w-full rounded-md border border-zinc-700/50 bg-zinc-950/60 px-2.5 py-1.5 text-xs text-zinc-200 outline-none focus:border-sky-500/50"
            />
            <div className="flex flex-wrap gap-1">
              {(["all", "Normal", "Interjection", "Cum"] as const).map((filter) => (
                <button
                  key={filter}
                  type="button"
                  onClick={() => props.onRoundTypeFilterChange(filter)}
                  className={`rounded-md px-2 py-1 text-[10px] font-semibold ${props.roundTypeFilter === filter ? "bg-sky-500/18 text-sky-200" : "text-zinc-500 hover:bg-white/5"}`}
                >
                  {filter === "all" ? t`All` : filter}
                </button>
              ))}
            </div>
            <LibrarySort
              value={props.roundSort}
              onChange={(value) => props.onRoundSortChange(value as RoundLibrarySort)}
              options={[
                { value: "name", label: t`Name` },
                { value: "difficulty", label: t`Difficulty` },
                { value: "duration", label: t`Duration` },
              ]}
            />
          </div>
          <div className="min-h-0 flex-1 space-y-1 overflow-y-auto p-2">
            {filteredRounds.map((round) => {
              const active = props.isRoundPlacementActive && props.armedRoundId === round.roundId;
              return (
                <RoundLibraryItem
                  key={round.roundId}
                  round={round}
                  active={active}
                  sfwMode={sfwMode}
                  unknownAuthorLabel={t`Unknown author`}
                  difficultyLabel={t`Difficulty`}
                  loadingLabel={t`Loading...`}
                  previewLabel={t`Preview`}
                  onArm={() => props.onArmRound(round)}
                  onDragStart={(event) =>
                    startDrag(event, { type: "round", roundId: round.roundId })
                  }
                />
              );
            })}
            {props.rounds.length === 0 ? (
              <EmptyState>
                <Trans>No installed rounds are available yet.</Trans>
              </EmptyState>
            ) : (
              filteredRounds.length === 0 && (
                <EmptyState>
                  <Trans>No rounds match your filters.</Trans>
                </EmptyState>
              )
            )}
          </div>
        </section>
      )}

      {props.activeTab === "heroes" && (
        <section
          id="map-library-panel-heroes"
          role="tabpanel"
          aria-labelledby="map-library-tab-heroes"
          className="flex min-h-0 flex-1 flex-col"
        >
          <div className="space-y-2 border-b border-white/6 p-3">
            <input
              type="search"
              placeholder={t`Search heroes or their rounds`}
              value={props.heroSearch}
              onChange={(event) => props.onHeroSearchChange(event.target.value)}
              className="w-full rounded-md border border-zinc-700/50 bg-zinc-950/60 px-2.5 py-1.5 text-xs text-zinc-200 outline-none focus:border-amber-500/50"
            />
            <LibrarySort
              value={props.heroSort}
              onChange={(value) => props.onHeroSortChange(value as HeroLibrarySort)}
              options={[
                { value: "name", label: t`Name` },
                { value: "roundCount", label: t`Round count` },
              ]}
            />
            <p className="text-[10px] text-zinc-600">
              <Trans>Choose a hero to place all of their rounds as a connected chain.</Trans>
            </p>
          </div>
          <div className="min-h-0 flex-1 space-y-1 overflow-y-auto p-2">
            {filteredHeroes.map((hero) => {
              const active = props.isHeroPlacementActive && props.armedHeroId === hero.heroId;
              const preview = hero.rounds
                .slice(0, 3)
                .map((round) => round.name)
                .filter(Boolean)
                .join(" · ");
              return (
                <button
                  key={hero.heroId}
                  type="button"
                  draggable
                  className={`group w-full cursor-grab rounded-lg border px-2.5 py-2 text-left ${active ? "border-cyan-400/50 bg-cyan-500/12" : "border-transparent hover:border-amber-400/30 hover:bg-amber-500/8"}`}
                  onClick={() => props.onArmHero(hero)}
                  onDragStart={(event) => startDrag(event, { type: "hero", heroId: hero.heroId })}
                >
                  <div className="flex items-center gap-2">
                    <span className="min-w-0 flex-1 truncate text-xs font-semibold text-zinc-100">
                      {abbreviateNsfwText(hero.heroName, sfwMode)}
                    </span>
                    <span className="rounded-full bg-amber-400/12 px-1.5 py-0.5 text-[10px] text-amber-200">
                      {hero.rounds.length}
                    </span>
                  </div>
                  {hero.heroAuthor && (
                    <p className="mt-0.5 truncate text-[10px] text-zinc-500">
                      {abbreviateNsfwText(hero.heroAuthor, sfwMode)}
                    </p>
                  )}
                  {preview && (
                    <p className="mt-1 line-clamp-2 text-[10px] text-zinc-600">
                      {abbreviateNsfwText(preview, sfwMode)}
                    </p>
                  )}
                </button>
              );
            })}
            {props.heroGroups.length === 0 ? (
              <EmptyState>
                <Trans>No heroes with installed rounds are available yet.</Trans>
              </EmptyState>
            ) : (
              filteredHeroes.length === 0 && (
                <EmptyState>
                  <Trans>No heroes match your search.</Trans>
                </EmptyState>
              )
            )}
          </div>
        </section>
      )}
    </aside>
  );
});

TileSidebar.displayName = "TileSidebar";

const RoundLibraryItem: React.FC<{
  round: RoundListItem;
  active: boolean;
  sfwMode: boolean;
  unknownAuthorLabel: string;
  difficultyLabel: string;
  loadingLabel: string;
  previewLabel: string;
  onArm: () => void;
  onDragStart: (event: React.DragEvent<HTMLButtonElement>) => void;
}> = ({
  round,
  active,
  sfwMode,
  unknownAuthorLabel,
  difficultyLabel,
  loadingLabel,
  previewLabel,
  onArm,
  onDragStart,
}) => {
  const { mediaResources, isLoading, loadMediaResources } = useInstalledRoundMedia(round.roundId);
  const [isPreviewActive, setIsPreviewActive] = React.useState(false);
  const videoRef = React.useRef<HTMLVideoElement | null>(null);
  const previewUri = mediaResources?.resources[0]?.videoUri ?? null;

  const startPreview = () => {
    playHoverSound();
    setIsPreviewActive(true);
    void loadMediaResources();
  };

  const stopPreview = () => {
    setIsPreviewActive(false);
  };

  return (
    <button
      type="button"
      draggable
      className={`group flex w-full cursor-grab gap-2 rounded-lg border p-2 text-left ${active ? "border-cyan-400/50 bg-cyan-500/12" : "border-transparent hover:border-sky-400/30 hover:bg-sky-500/8"}`}
      onClick={onArm}
      onDragStart={onDragStart}
      onMouseEnter={startPreview}
      onMouseLeave={stopPreview}
      onFocus={startPreview}
      onBlur={stopPreview}
    >
      <span className="group/video relative block aspect-video w-20 flex-none overflow-hidden rounded-md border border-white/8 bg-zinc-950">
        {round.previewImage && (
          <SfwGuard>
            <img
              src={round.previewImage}
              alt={`${round.name} ${previewLabel.toLocaleLowerCase()}`}
              className="absolute inset-0 h-full w-full object-cover"
              loading="lazy"
              decoding="async"
            />
          </SfwGuard>
        )}
        {previewUri && (
          <RoundCardPreviewVideo
            videoRef={videoRef}
            previewUri={previewUri}
            previewImage={round.previewImage}
            startTime={round.startTime}
            endTime={round.endTime}
            active={isPreviewActive}
          />
        )}
        {!round.previewImage && !previewUri && (
          <span className="absolute inset-0 grid place-items-center text-[9px] uppercase tracking-[0.12em] text-zinc-600">
            {isLoading ? loadingLabel : previewLabel}
          </span>
        )}
        <span className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/45 to-transparent" />
      </span>
      <span className="min-w-0 flex-1 py-0.5">
        <span className="flex items-center gap-2">
          <span
            className={`h-2 w-2 flex-none rounded-full ${ROUND_TYPE_DOT_COLOR[round.type ?? "Normal"] ?? "bg-sky-500"}`}
          />
          <span className="min-w-0 flex-1 truncate text-xs font-medium text-zinc-100">
            {abbreviateNsfwText(round.name, sfwMode)}
          </span>
        </span>
        <span className="mt-1 block truncate text-[10px] text-zinc-500">
          {round.author ? abbreviateNsfwText(round.author, sfwMode) : unknownAuthorLabel}
        </span>
        <span className="mt-1 flex gap-2 text-[10px] text-zinc-500">
          <span>
            {difficultyLabel} {round.difficulty ?? "—"}
          </span>
          <span>{formatDuration(round.durationSec)}</span>
        </span>
      </span>
    </button>
  );
};

const EmptyState: React.FC<React.PropsWithChildren> = ({ children }) => (
  <div className="rounded-lg px-3 py-6 text-center text-xs text-zinc-600">{children}</div>
);

const LibrarySort: React.FC<{
  value: string;
  onChange: (value: string) => void;
  options: Array<{ value: string; label: string }>;
}> = ({ value, onChange, options }) => (
  <label className="flex items-center gap-2 text-[10px] text-zinc-500">
    <Trans>Sort</Trans>
    <select
      value={value}
      onChange={(event) => onChange(event.target.value)}
      className="min-w-0 flex-1 rounded-md border border-zinc-700/50 bg-zinc-950/60 px-2 py-1 text-[11px] text-zinc-300 outline-none"
    >
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  </label>
);
