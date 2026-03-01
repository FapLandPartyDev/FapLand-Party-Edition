import { startTransition, useDeferredValue, useMemo, useState } from "react";
import type { InstalledRoundCatalogEntry } from "../../services/db";
import {
  buildPlaylistGroupingData,
  buildSourceHeroOptions,
  filterAndSortRounds,
  toIndexedRound,
  type GroupMode,
  type PlaylistGroupingData,
  type ScriptFilter,
  type SortMode,
  type TypeFilter,
} from "./workspaceSelectors";
import { buildRoundRenderRowsWithOptions, type RoundRenderRow } from "../../routes/roundRows";
import type { StoredPlaylist } from "../../services/playlists";

export type SelectedLibraryEntry =
  | { kind: "round"; roundId: string }
  | { kind: "hero-group"; groupKey: string }
  | { kind: "playlist-group"; groupKey: string };

export type InspectorMode = "details" | "preview" | "edit-actions";

export function useRoundsLibraryState(
  rounds: InstalledRoundCatalogEntry[],
  playlists: StoredPlaylist[]
) {
  const [queryInput, setQueryInput] = useState("");
  const [query, setQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("all");
  const [scriptFilter, setScriptFilter] = useState<ScriptFilter>("all");
  const [sortMode, setSortMode] = useState<SortMode>("newest");
  const [groupMode, setGroupMode] = useState<GroupMode>("hero");
  const [expandedGroupKeys, setExpandedGroupKeys] = useState<Set<string>>(new Set());
  const [selectedEntry, setSelectedEntry] = useState<SelectedLibraryEntry | null>(null);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedRoundIds, setSelectedRoundIds] = useState<Set<string>>(new Set());
  const [selectedHeroIds, setSelectedHeroIds] = useState<Set<string>>(new Set());
  const [inspectorMode, setInspectorMode] = useState<InspectorMode>("details");

  const deferredQuery = useDeferredValue(query);
  const indexedRounds = useMemo(() => rounds.map(toIndexedRound), [rounds]);
  const filteredRounds = useMemo(
    () =>
      filterAndSortRounds({
        indexedRounds,
        query: deferredQuery,
        typeFilter,
        scriptFilter,
        sortMode,
      }),
    [deferredQuery, indexedRounds, scriptFilter, sortMode, typeFilter]
  );
  const playlistGroupingData = useMemo(
    () =>
      groupMode === "playlist" && playlists.length > 0
        ? buildPlaylistGroupingData(playlists, rounds)
        : null,
    [groupMode, playlists, rounds]
  );
  const renderRows = useMemo<RoundRenderRow[]>(
    () =>
      buildRoundRenderRowsWithOptions(
        filteredRounds,
        groupMode === "playlist"
          ? {
              mode: "playlist",
              playlistsByRoundId:
                playlistGroupingData?.playlistsByRoundId ??
                (new Map() as PlaylistGroupingData["playlistsByRoundId"]),
            }
          : { mode: "hero" }
      ),
    [filteredRounds, groupMode, playlistGroupingData]
  );
  const visibleGroupKeys = useMemo(
    () =>
      renderRows
        .filter(
          (row): row is Extract<RoundRenderRow, { kind: "hero-group" | "playlist-group" }> =>
            row.kind !== "standalone"
        )
        .map((row) => row.groupKey),
    [renderRows]
  );
  const expandedGroupKeySet = useMemo(
    () => new Set(visibleGroupKeys.filter((groupKey) => expandedGroupKeys.has(groupKey))),
    [expandedGroupKeys, visibleGroupKeys]
  );
  const sourceHeroOptions = useMemo(() => buildSourceHeroOptions(rounds), [rounds]);

  const setSearchValue = (nextValue: string) => {
    setQueryInput(nextValue);
    startTransition(() => {
      setQuery(nextValue);
    });
  };

  const resetFilters = () => {
    setQueryInput("");
    startTransition(() => {
      setQuery("");
      setTypeFilter("all");
      setScriptFilter("all");
      setSortMode("newest");
    });
  };

  return {
    queryInput,
    setSearchValue,
    typeFilter,
    setTypeFilter,
    scriptFilter,
    setScriptFilter,
    sortMode,
    setSortMode,
    groupMode,
    setGroupMode,
    expandedGroupKeys,
    setExpandedGroupKeys,
    expandedGroupKeySet,
    selectedEntry,
    setSelectedEntry,
    inspectorMode,
    setInspectorMode,
    selectionMode,
    setSelectionMode,
    selectedRoundIds,
    setSelectedRoundIds,
    selectedHeroIds,
    setSelectedHeroIds,
    filteredRounds,
    renderRows,
    visibleGroupKeys,
    sourceHeroOptions,
    resetFilters,
    hasActiveFilters:
      queryInput.trim().length > 0 || typeFilter !== "all" || scriptFilter !== "all",
    activeFilterCount:
      Number(queryInput.trim().length > 0) +
      Number(typeFilter !== "all") +
      Number(scriptFilter !== "all"),
  };
}
