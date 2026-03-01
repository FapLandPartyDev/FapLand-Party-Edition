import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getSinglePlayerAntiPerkPool, getSinglePlayerPerkPool } from "../game/data/perks";
import type { InstalledRound, InstalledRoundCatalogEntry } from "../services/db";
import type { StoredPlaylist } from "../services/playlists";

const mocks = vi.hoisted(() => ({
  loaderData: {
    rounds: [] as InstalledRound[],
    availablePlaylists: [] as StoredPlaylist[],
    intermediaryLoadingPrompt: "animated gif webm score:>300",
    intermediaryLoadingDurationSec: 5,
    intermediaryReturnPauseSec: 4,
    roundProgressBarAlwaysVisible: false,
    controllerSupportEnabled: false,
    installWebFunscriptUrlEnabled: false,
  },
  search: {} as { open?: "install-rounds" | "install-web" },
  navigate: vi.fn(),
  db: {
    hero: {
      update: vi.fn(),
      delete: vi.fn(),
    },
    round: {
      findInstalled: vi.fn(),
      findInstalledCatalog: vi.fn(),
      findInstalledCardAssets: vi.fn(),
      getMediaResources: vi.fn(),
      getDisabledIds: vi.fn(),
      update: vi.fn(),
      createWebsiteRound: vi.fn(),
      checkWebsiteVideoSupport: vi.fn(),
      delete: vi.fn(),
      repairTemplate: vi.fn(),
      retryTemplateLinking: vi.fn(),
      convertHeroGroupToRound: vi.fn(),
    },
    template: {
      repairHero: vi.fn(),
      retryLinking: vi.fn(),
    },
    install: {
      getScanStatus: vi.fn(),
      abortScan: vi.fn(),
      scanNow: vi.fn(),
      inspectFolder: vi.fn(),
      inspectSidecarFile: vi.fn(),
      importSidecarFile: vi.fn(),
      importLegacyWithPlan: vi.fn(),
      scanFolderOnce: vi.fn(),
      exportDatabase: vi.fn(),
      analyzeExportPackage: vi.fn(),
      exportPackage: vi.fn(),
      getExportPackageStatus: vi.fn(),
      abortExportPackage: vi.fn(),
      openExportFolder: vi.fn(),
    },
    webVideoCache: {
      getScanStatus: vi.fn(),
      getDownloadProgresses: vi.fn(),
    },
  },
  playlists: {
    list: vi.fn(),
    create: vi.fn(),
    importFromFile: vi.fn(),
    setActive: vi.fn(),
  },
  roundVideoOverlay: vi.fn(() => null),
}));

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => () => ({
    useLoaderData: () => mocks.loaderData,
    useSearch: () => mocks.search,
  }),
  useNavigate: () => mocks.navigate,
}));

vi.mock("../services/db", () => ({
  db: mocks.db,
}));

vi.mock("../services/playlists", () => ({
  playlists: mocks.playlists,
}));

vi.mock("../services/installedRoundsCache", () => ({
  getInstalledRoundCardAssetsCached: (roundIds: string[], includeDisabled = false) =>
    mocks.db.round.findInstalledCardAssets(roundIds, includeDisabled),
}));

vi.mock("../services/trpc", () => ({
  trpc: {
    store: {
      get: {
        query: vi.fn(async ({ key }: { key: string }) => {
          if (key === "experimental.controllerSupportEnabled") {
            return mocks.loaderData.controllerSupportEnabled;
          }
          if (key === "game.intermediary.loadingPrompt") {
            return mocks.loaderData.intermediaryLoadingPrompt;
          }
          if (key === "game.intermediary.loadingDurationSec") {
            return mocks.loaderData.intermediaryLoadingDurationSec;
          }
          if (key === "game.intermediary.returnPauseSec") {
            return mocks.loaderData.intermediaryReturnPauseSec;
          }
          if (key === "game.video.roundProgressBarAlwaysVisible") {
            return mocks.loaderData.roundProgressBarAlwaysVisible;
          }
          if (key === "experimental.installWebFunscriptUrlEnabled") {
            return mocks.loaderData.installWebFunscriptUrlEnabled;
          }
          return null;
        }),
      },
    },
  },
}));

vi.mock("../hooks/useSfwMode", () => ({
  useSfwMode: () => false,
  useSfwModeState: () => ({ enabled: false, resolved: true }),
}));

vi.mock("../utils/audio", () => ({
  playHoverSound: vi.fn(),
  playSelectSound: vi.fn(),
}));

vi.mock("../components/AnimatedBackground", () => ({
  AnimatedBackground: () => null,
}));

vi.mock("../components/game/RoundVideoOverlay", () => ({
  RoundVideoOverlay: (props: unknown) =>
    (mocks.roundVideoOverlay as unknown as (props: unknown) => null)(props),
}));

vi.mock("../components/MenuButton", () => ({
  MenuButton: ({ label, onClick }: { label: string; onClick?: () => void }) => (
    <button type="button" onClick={onClick}>
      {label}
    </button>
  ),
}));

vi.mock("../components/ui/ToastHost", () => ({
  useToast: () => ({ showToast: vi.fn() }),
}));

vi.mock("../components/InstallConfirmationModalHost", () => ({
  confirmInstallSidecar: vi.fn(async () => ({ action: "install" })),
}));

vi.mock("../components/InstallSidecarTrustModalHost", () => ({
  reviewInstallSidecarTrust: vi.fn(async () => ({ action: "import", trustedBaseDomains: [] })),
}));

import { InstalledRoundsPage } from "./rounds";
import { buildRoundRenderRows, buildRoundRenderRowsWithOptions } from "./roundRows";
import { filterAndSortRounds, toIndexedRound } from "./roundsSelectors";

async function renderInstalledRoundsPage() {
  const view = render(<InstalledRoundsPage />);
  await act(async () => {
    await Promise.resolve();
  });
  await waitFor(() => {
    expect(mocks.db.round.findInstalledCatalog).toHaveBeenCalled();
  });
  return view;
}

function toCatalogRound(round: InstalledRound): InstalledRoundCatalogEntry {
  return {
    ...round,
    resources: round.resources.map((resource) => ({
      id: resource.id,
      disabled: resource.disabled,
      phash: resource.phash,
      durationMs: resource.durationMs,
      hasFunscript: Boolean(resource.funscriptUri),
    })),
  } as InstalledRoundCatalogEntry;
}

function toCardAssets(round: InstalledRound) {
  const firstResource = round.resources[0];
  return {
    roundId: round.id,
    previewImage: round.previewImage ?? null,
    previewVideoUri: firstResource?.videoUri ?? null,
    websiteVideoCacheStatus: firstResource?.websiteVideoCacheStatus ?? "not_applicable",
    primaryResourceId: firstResource?.id ?? null,
  };
}

function makeRound({
  id,
  name,
  createdAt,
  hero,
  startTime,
  endTime,
  durationMs,
  template = false,
  funscriptUri = null,
  installSourceKey = null,
  previewImage = null,
  websiteVideoCacheStatus = "not_applicable",
  videoUri = null,
}: {
  id: string;
  name: string;
  createdAt: string;
  hero?: { id?: string | null; name?: string | null } | null;
  startTime?: number | null;
  endTime?: number | null;
  durationMs?: number | null;
  template?: boolean;
  funscriptUri?: string | null;
  installSourceKey?: string | null;
  previewImage?: string | null;
  websiteVideoCacheStatus?: "not_applicable" | "cached" | "pending";
  videoUri?: string | null;
}): InstalledRound {
  const heroId = hero?.id ?? (hero?.name ? `hero-${hero.name}` : null);
  return {
    id,
    name,
    description: null,
    author: null,
    type: "Normal",
    difficulty: 2,
    bpm: 120,
    startTime: startTime ?? null,
    endTime: endTime ?? null,
    createdAt,
    heroId,
    hero: hero
      ? {
          id: heroId ?? "hero-unknown",
          name: hero.name ?? "",
          createdAt,
          updatedAt: createdAt,
          sourceKey: null,
          sourceType: null,
        }
      : null,
    resources: template
      ? []
      : [
          {
            id: `res-${id}`,
            roundId: id,
            videoUri,
            funscriptUri,
            phash: null,
            disabled: false,
            durationMs: durationMs ?? null,
            createdAt,
            updatedAt: createdAt,
            websiteVideoCacheStatus,
          },
        ],
    installSourceKey,
    phash: null,
    previewImage,
    heroSourceType: null,
    sourceType: null,
    updatedAt: createdAt,
  } as unknown as InstalledRound;
}

function makePlaylist(id: string, name: string, roundIds: string[]): StoredPlaylist {
  return {
    id,
    name,
    description: null,
    formatVersion: 1,
    installSourceKey: null,
    createdAt: new Date("2026-03-03T00:00:00.000Z"),
    updatedAt: new Date("2026-03-03T00:00:00.000Z"),
    config: {
      playlistVersion: 1,
      boardConfig: {
        mode: "linear",
        totalIndices: roundIds.length,
        safePointIndices: [],
        safePointRestMsByIndex: {},
        normalRoundRefsByIndex: {},
        normalRoundOrder: roundIds.map((roundId) => ({
          idHint: roundId,
          name: roundId,
          type: "Normal" as const,
        })),
        cumRoundRefs: [],
      },
      perkSelection: {
        optionsPerPick: 3,
        triggerChancePerCompletedRound: 0.35,
      },
      perkPool: {
        enabledPerkIds: [],
        enabledAntiPerkIds: [],
      },
      probabilityScaling: {
        initialIntermediaryProbability: 0,
        initialAntiPerkProbability: 0,
        intermediaryIncreasePerRound: 0.02,
        antiPerkIncreasePerRound: 0.015,
        maxIntermediaryProbability: 1,
        maxAntiPerkProbability: 0.75,
      },
      economy: {
        startingMoney: 120,
        moneyPerCompletedRound: 50,
        startingScore: 0,
        scorePerCompletedRound: 100,
        scorePerIntermediary: 30,
        scorePerActiveAntiPerk: 25,
        scorePerCumRoundSuccess: 420,
      },
      roundStartDelayMs: 20000,
      dice: { min: 1, max: 6 },
    },
  };
}

beforeEach(() => {
  vi.useRealTimers();
  window.electronAPI = {
    file: {
      convertFileSrc: vi.fn(),
    },
    dialog: {
      selectFolders: vi.fn(),
      selectInstallImportFile: vi.fn(),
      selectPlaylistImportFile: vi.fn(),
      selectPlaylistExportPath: vi.fn(),
      selectPlaylistExportDirectory: vi.fn(),
      selectWebsiteVideoCacheDirectory: vi.fn(),
      selectEroScriptsCacheDirectory: vi.fn(),
      selectMusicCacheDirectory: vi.fn(),
      selectMoaningCacheDirectory: vi.fn(),
      selectConverterVideoFile: vi.fn(),
        selectMapBackgroundFile: vi.fn(),
      selectMusicFiles: vi.fn(),
      selectMoaningFiles: vi.fn(),
      addMusicFromUrl: vi.fn(),
      addMusicPlaylistFromUrl: vi.fn(),
      addMoaningFromUrl: vi.fn(),
      addMoaningPlaylistFromUrl: vi.fn(),
      selectConverterFunscriptFile: vi.fn(),
      selectFpackExtractionDirectory: vi.fn(),
    },
    window: {
      isFullscreen: vi.fn(),
      setFullscreen: vi.fn(),
      toggleFullscreen: vi.fn(),
      close: vi.fn(),
    },
    updates: {
      subscribe: vi.fn(() => () => {}),
    },
    appOpen: {
      consumePendingFiles: vi.fn(async () => []),
      subscribe: vi.fn(() => () => {}),
    },
    eroscripts: {
      subscribeToLoginStatus: vi.fn(() => () => {}),
    },
  };
  mocks.loaderData.rounds = [];
  mocks.loaderData.availablePlaylists = [];
  mocks.loaderData.roundProgressBarAlwaysVisible = false;
  mocks.loaderData.controllerSupportEnabled = false;
  mocks.search = {};
  mocks.db.webVideoCache.getScanStatus.mockResolvedValue({
    state: "idle",
    startedAt: null,
    finishedAt: null,
    totalCount: 0,
    completedCount: 0,
    skippedCount: 0,
    failedCount: 0,
    currentRoundName: null,
    currentUrl: null,
    errors: [],
  });
  mocks.db.webVideoCache.getDownloadProgresses.mockResolvedValue([]);
  mocks.loaderData.installWebFunscriptUrlEnabled = false;
  mocks.db.round.findInstalled.mockImplementation(async () => mocks.loaderData.rounds);
  mocks.db.round.findInstalledCatalog.mockImplementation(async () =>
    mocks.loaderData.rounds.map(toCatalogRound)
  );
  mocks.db.round.findInstalledCardAssets.mockImplementation(async (roundIds: string[]) =>
    mocks.loaderData.rounds
      .filter((round) => roundIds.includes(round.id))
      .map(toCardAssets)
  );
  mocks.db.round.getMediaResources.mockImplementation(async (roundId: string) => {
    const round = mocks.loaderData.rounds.find((candidate) => candidate.id === roundId);
    return round ? { roundId, resources: round.resources } : null;
  });
  mocks.db.round.getDisabledIds.mockResolvedValue([]);
  mocks.db.round.update.mockResolvedValue({});
  mocks.db.round.createWebsiteRound.mockResolvedValue({
    roundId: "website-round-1",
    resourceId: "website-resource-1",
  });
  mocks.db.round.checkWebsiteVideoSupport.mockResolvedValue({
    supported: true,
    normalizedVideoUri: "https://www.pornhub.com/view_video.php?viewkey=abc123",
    extractor: "PornHub",
    title: "Demo title",
  });
  mocks.db.round.delete.mockResolvedValue({ deleted: true });
  mocks.db.round.convertHeroGroupToRound.mockResolvedValue({
    keptRoundId: "kept",
    removedRoundCount: 0,
    deletedHero: false,
  });
  mocks.db.hero.update.mockResolvedValue({});
  mocks.db.hero.delete.mockResolvedValue({ deleted: true });
  mocks.db.install.getScanStatus.mockResolvedValue({
    state: "idle",
    triggeredBy: "manual",
    startedAt: null,
    finishedAt: null,
    stats: {
      scannedFolders: 0,
      sidecarsSeen: 0,
      installed: 0,
      playlistsImported: 0,
      updated: 0,
      skipped: 0,
      failed: 0,
    },
    lastMessage: null,
    lastErrors: [],
  });
  mocks.db.install.abortScan.mockResolvedValue({
    state: "running",
    triggeredBy: "manual",
    startedAt: "2026-03-06T00:00:00.000Z",
    finishedAt: null,
    stats: {
      scannedFolders: 1,
      sidecarsSeen: 0,
      installed: 0,
      playlistsImported: 0,
      updated: 0,
      skipped: 0,
      failed: 0,
    },
    lastMessage: "Abort requested. Waiting for the current import step to finish...",
    lastErrors: [],
  });
  mocks.db.install.scanFolderOnce.mockResolvedValue({
    status: {
      state: "done",
      triggeredBy: "manual",
      startedAt: "2026-03-06T00:00:00.000Z",
      finishedAt: "2026-03-06T00:00:02.000Z",
      stats: {
        scannedFolders: 1,
        sidecarsSeen: 0,
        installed: 0,
        playlistsImported: 0,
        updated: 0,
        skipped: 0,
        failed: 0,
      },
      lastMessage: "Done",
      lastErrors: [],
    },
  });
  mocks.db.install.inspectFolder.mockResolvedValue({
    kind: "sidecar",
    folderPath: "/tmp/round-pack",
    playlistNameHint: "round-pack",
    sidecarCount: 1,
  });
  mocks.db.install.inspectSidecarFile.mockResolvedValue({
    filePath: "/tmp/imported.round",
    contentName: "Imported Round",
    entries: [],
    unknownEntries: [],
  });
  mocks.db.install.importLegacyWithPlan.mockResolvedValue({
    status: {
      state: "done",
      triggeredBy: "manual",
      startedAt: "2026-03-06T00:00:00.000Z",
      finishedAt: "2026-03-06T00:00:02.000Z",
      stats: {
        scannedFolders: 1,
        sidecarsSeen: 0,
        installed: 2,
        playlistsImported: 0,
        updated: 0,
        skipped: 0,
        failed: 0,
      },
      lastMessage: "Legacy import finished.",
      lastErrors: [],
    },
    legacyImport: {
      roundIds: ["r1", "r2"],
      playlistNameHint: "Legacy Pack",
      orderedSlots: [
        { kind: "round", ref: { name: "1", type: "Normal" } },
        { kind: "checkpoint", label: "2 checkpoint", restDurationMs: null },
        { kind: "round", ref: { name: "10", type: "Normal" } },
      ],
    },
  });
  mocks.db.install.importSidecarFile.mockResolvedValue({
    status: {
      state: "done",
      triggeredBy: "manual",
      startedAt: "2026-03-06T00:00:00.000Z",
      finishedAt: "2026-03-06T00:00:02.000Z",
      stats: {
        scannedFolders: 0,
        sidecarsSeen: 1,
        installed: 1,
        playlistsImported: 0,
        updated: 0,
        skipped: 0,
        failed: 0,
      },
      lastMessage: "Import finished.",
      lastErrors: [],
    },
  });
  mocks.playlists.create.mockResolvedValue({ id: "playlist-1" });
  mocks.playlists.list.mockImplementation(async () => mocks.loaderData.availablePlaylists);
  mocks.playlists.importFromFile.mockResolvedValue({
    playlist: { id: "playlist-2", name: "Imported Playlist" },
    report: {
      exactMapping: {},
      suggestedMapping: {},
      issues: [],
      counts: {
        exact: 0,
        suggested: 0,
        missing: 0,
      },
      appliedMapping: {},
    },
  });
  mocks.playlists.setActive.mockResolvedValue({ id: "playlist-1" });
  mocks.db.install.analyzeExportPackage.mockResolvedValue({
    videoTotals: {
      uniqueVideos: 3,
      localVideos: 3,
      remoteVideos: 0,
      alreadyAv1Videos: 1,
      estimatedReencodeVideos: 2,
    },
    compression: {
      supported: true,
      defaultMode: "av1",
      encoderName: "av1_nvenc",
      encoderKind: "hardware",
      warning: null,
      strength: 80,
      estimate: {
        sourceVideoBytes: 120 * 1024 * 1024,
        expectedVideoBytes: 70 * 1024 * 1024,
        savingsBytes: 50 * 1024 * 1024,
        estimatedCompressionSeconds: 180,
        approximate: false,
      },
    },
    settings: {
      outputContainer: "mp4",
      audioCodec: "aac",
      audioBitrateKbps: 128,
      lowPriority: true,
      parallelJobs: 1,
    },
    estimate: {
      sourceVideoBytes: 120 * 1024 * 1024,
      expectedVideoBytes: 70 * 1024 * 1024,
      savingsBytes: 50 * 1024 * 1024,
      estimatedCompressionSeconds: 180,
      approximate: false,
    },
  });
  mocks.db.install.exportPackage.mockResolvedValue({
    exportDir: "/tmp/export-root/2026-03-20T12-00-00.000Z",
    heroFiles: 1,
    roundFiles: 2,
    videoFiles: 3,
    funscriptFiles: 2,
    exportedRounds: 3,
    includeMedia: true,
    compression: {
      enabled: true,
      encoderName: "av1_nvenc",
      encoderKind: "hardware",
      strength: 80,
      reencodedVideos: 2,
      alreadyAv1Copied: 1,
      actualVideoBytes: 70 * 1024 * 1024,
    },
  });
  mocks.db.install.getExportPackageStatus.mockResolvedValue({
    state: "idle",
    phase: "idle",
    startedAt: null,
    finishedAt: null,
    lastMessage: null,
    progress: { completed: 0, total: 0 },
    stats: { heroFiles: 0, roundFiles: 0, videoFiles: 0, funscriptFiles: 0 },
    compression: null,
  });
  mocks.db.install.abortExportPackage.mockResolvedValue({
    state: "running",
    phase: "copying",
    startedAt: "2026-03-20T12:00:00.000Z",
    finishedAt: null,
    lastMessage: "Abort requested. Waiting for the current export step to finish...",
    progress: { completed: 1, total: 4 },
    stats: { heroFiles: 0, roundFiles: 0, videoFiles: 1, funscriptFiles: 0 },
    compression: null,
  });
  mocks.db.install.openExportFolder.mockResolvedValue({ path: "/tmp/app-export" });
  mocks.roundVideoOverlay.mockClear();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

describe("buildRoundRenderRows", () => {
  it("groups hero rounds and preserves first-seen order", async () => {
    const rows = buildRoundRenderRows([
      makeRound({
        id: "a",
        name: "Hero A 1",
        createdAt: "2026-03-03T10:00:00.000Z",
        hero: { id: "h-a", name: "Hero A" },
      }),
      makeRound({ id: "solo", name: "Solo", createdAt: "2026-03-03T09:00:00.000Z" }),
      makeRound({
        id: "b",
        name: "Hero A 2",
        createdAt: "2026-03-03T08:00:00.000Z",
        hero: { id: "h-a", name: "Hero A" },
      }),
    ]);

    expect(rows).toHaveLength(2);
    expect(rows[0]?.kind).toBe("hero-group");
    expect(rows[1]?.kind).toBe("standalone");
    if (rows[0]?.kind === "hero-group") {
      expect(rows[0].rounds.map((round) => round.id)).toEqual(["a", "b"]);
    }
  });

  it("groups hero rounds under their hero name", async () => {
    const rows = buildRoundRenderRows([
      makeRound({
        id: "a",
        name: "Alpha",
        createdAt: "2026-03-01T10:00:00.000Z",
        hero: { name: "Hero A" },
      }),
      makeRound({ id: "b", name: "Beta", createdAt: "2026-03-01T11:00:00.000Z" }),
      makeRound({
        id: "c",
        name: "Gamma",
        createdAt: "2026-03-01T12:00:00.000Z",
        hero: { name: "Hero A" },
      }),
    ]);

    expect(rows).toEqual([
      {
        kind: "hero-group",
        groupKey: expect.stringContaining("Hero A"),
        heroName: "Hero A",
        rounds: [expect.objectContaining({ id: "a" }), expect.objectContaining({ id: "c" })],
      },
      {
        kind: "standalone",
        round: expect.objectContaining({ id: "b" }),
      },
    ]);
  });

  it("groups rounds under playlists and allows the same round in multiple playlist groups", async () => {
    const alpha = makeRound({ id: "alpha", name: "Alpha", createdAt: "2026-03-01T10:00:00.000Z" });
    const beta = makeRound({ id: "beta", name: "Beta", createdAt: "2026-03-01T11:00:00.000Z" });
    const rows = buildRoundRenderRowsWithOptions([alpha, beta], {
      mode: "playlist",
      playlistsByRoundId: new Map([
        [
          "alpha",
          [
            { playlistId: "p-1", playlistName: "Playlist One" },
            { playlistId: "p-2", playlistName: "Playlist Two" },
          ],
        ],
        ["beta", [{ playlistId: "p-2", playlistName: "Playlist Two" }]],
      ]),
    });

    expect(rows).toEqual([
      {
        kind: "playlist-group",
        groupKey: "playlist:p-1",
        playlistId: "p-1",
        playlistName: "Playlist One",
        rounds: [expect.objectContaining({ id: "alpha" })],
      },
      {
        kind: "playlist-group",
        groupKey: "playlist:p-2",
        playlistId: "p-2",
        playlistName: "Playlist Two",
        rounds: [expect.objectContaining({ id: "alpha" }), expect.objectContaining({ id: "beta" })],
      },
    ]);
  });
});

describe("roundsSelectors", () => {
  it("treats catalog hasFunscript resources as scripted rounds", () => {
    const scripted = toCatalogRound(
      makeRound({
        id: "scripted",
        name: "Scripted",
        createdAt: "2026-03-03T10:00:00.000Z",
        funscriptUri: "app://media/%2Ftmp%2Fscripted.funscript",
      })
    );
    const missing = toCatalogRound(
      makeRound({
        id: "missing",
        name: "Missing",
        createdAt: "2026-03-03T09:00:00.000Z",
      })
    );

    const result = filterAndSortRounds({
      indexedRounds: [scripted, missing].map(toIndexedRound),
      query: "",
      typeFilter: "all",
      scriptFilter: "installed",
      sortMode: "newest",
    });

    expect(result.map((round) => round.id)).toEqual(["scripted"]);
  });
});

describe("InstalledRoundsPage hero grouping", () => {
  it("shows a go back button in the header and falls back to home navigation", async () => {
    await renderInstalledRoundsPage();

    fireEvent.click(screen.getByRole("button", { name: "← Back" }));

    expect(mocks.navigate).toHaveBeenCalledWith({ to: "/" });
  });

  it("renders hero groups collapsed by default and toggles expansion", async () => {
    mocks.loaderData.rounds = [
      makeRound({
        id: "r1",
        name: "Hero Round 1",
        createdAt: "2026-03-03T12:00:00.000Z",
        hero: { id: "h1", name: "Hero One" },
      }),
      makeRound({ id: "solo", name: "Solo Round", createdAt: "2026-03-03T11:00:00.000Z" }),
      makeRound({
        id: "r2",
        name: "Hero Round 2",
        createdAt: "2026-03-03T10:00:00.000Z",
        hero: { id: "h1", name: "Hero One" },
      }),
    ];

    await renderInstalledRoundsPage();

    expect(screen.getByRole("heading", { name: "Solo Round" })).toBeDefined();
    expect(screen.queryByRole("heading", { name: "Hero Round 1" })).toBeNull();
    expect(screen.queryByRole("heading", { name: "Hero Round 2" })).toBeNull();

    const header = screen.getByRole("button", { name: "Hero One (2 rounds)" });
    fireEvent.click(header);

    expect(await screen.findByRole("heading", { name: "Hero Round 1" })).toBeDefined();
    expect(await screen.findByRole("heading", { name: "Hero Round 2" })).toBeDefined();

    fireEvent.click(header);
    expect(screen.queryByRole("heading", { name: "Hero Round 1" })).toBeNull();
  });

  it("keeps first-seen order across hero groups and standalone rounds", async () => {
    mocks.loaderData.rounds = [
      makeRound({
        id: "beta",
        name: "Beta Round",
        createdAt: "2026-03-03T12:00:00.000Z",
        hero: { id: "hb", name: "Hero Beta" },
      }),
      makeRound({ id: "solo", name: "Solo Round", createdAt: "2026-03-03T11:00:00.000Z" }),
      makeRound({
        id: "alpha",
        name: "Alpha Round",
        createdAt: "2026-03-03T10:00:00.000Z",
        hero: { id: "ha", name: "Hero Alpha" },
      }),
    ];

    await renderInstalledRoundsPage();

    const betaHeader = screen.getByRole("button", { name: "Hero Beta (1 rounds)" });
    const soloHeading = screen.getByRole("heading", { name: "Solo Round" });
    const alphaHeader = screen.getByRole("button", { name: "Hero Alpha (1 rounds)" });

    expect(
      Boolean(betaHeader.compareDocumentPosition(soloHeading) & Node.DOCUMENT_POSITION_FOLLOWING)
    ).toBe(true);
    expect(
      Boolean(soloHeading.compareDocumentPosition(alphaHeader) & Node.DOCUMENT_POSITION_FOLLOWING)
    ).toBe(true);
  });

  it("updates grouped rows via filtering and preserves empty state", async () => {
    mocks.loaderData.rounds = [
      makeRound({
        id: "hero",
        name: "Hero Filter Round",
        createdAt: "2026-03-03T12:00:00.000Z",
        hero: { id: "h1", name: "Hero One" },
      }),
      makeRound({ id: "solo", name: "Solo Target", createdAt: "2026-03-03T11:00:00.000Z" }),
    ];

    await renderInstalledRoundsPage();

    fireEvent.change(screen.getByPlaceholderText("Search title, hero, author"), {
      target: { value: "solo" },
    });

    expect(screen.getByRole("heading", { name: "Solo Target" })).toBeDefined();
    expect(screen.queryByRole("button", { name: "Hero One (1 rounds)" })).toBeNull();

    fireEvent.change(screen.getByPlaceholderText("Search title, hero, author"), {
      target: { value: "does-not-exist" },
    });

    expect(screen.getByText("No rounds match this filter")).toBeDefined();
  });

  it("switches to playlist grouping from the side menu and shows duplicate memberships", async () => {
    mocks.loaderData.rounds = [
      makeRound({ id: "r1", name: "Round One", createdAt: "2026-03-03T12:00:00.000Z" }),
      makeRound({ id: "r2", name: "Round Two", createdAt: "2026-03-03T11:00:00.000Z" }),
    ];
    mocks.loaderData.availablePlaylists = [
      makePlaylist("playlist-1", "Playlist One", ["r1"]),
      makePlaylist("playlist-2", "Playlist Two", ["r1", "r2"]),
    ];

    await renderInstalledRoundsPage();

    fireEvent.click(screen.getByRole("button", { name: "Playlists" }));

    const playlistOneHeader = await screen.findByRole("button", {
      name: "Playlist One (1 rounds)",
    });
    const playlistTwoHeader = await screen.findByRole("button", {
      name: "Playlist Two (2 rounds)",
    });

    fireEvent.click(playlistOneHeader);
    fireEvent.click(playlistTwoHeader);

    const roundOneHeadings = await screen.findAllByRole("heading", { name: "Round One" });
    expect(roundOneHeadings).toHaveLength(2);
    expect(await screen.findByRole("heading", { name: "Round Two" })).toBeDefined();
  });

  it("shows convert button for rounds without hero and navigates to converter with prefill", async () => {
    mocks.loaderData.rounds = [
      makeRound({ id: "solo", name: "Solo Target", createdAt: "2026-03-03T11:00:00.000Z" }),
    ];

    await renderInstalledRoundsPage();

    const convertButton = screen.getByRole("button", { name: "Convert to Hero" });
    fireEvent.click(convertButton);

    expect(mocks.navigate).toHaveBeenCalledWith({
      to: "/converter",
      search: {
        sourceRoundId: "solo",
        heroName: "Solo Target",
      },
    });
  });

  it("labels website-backed rounds as web in the installed rounds view", async () => {
    mocks.loaderData.rounds = [
      makeRound({
        id: "web-round",
        name: "Website Round",
        createdAt: "2026-03-03T11:00:00.000Z",
        installSourceKey: "website:https://example.com/video.mp4",
      }),
    ];

    await renderInstalledRoundsPage();

    expect(screen.getAllByText("Web").length).toBeGreaterThan(0);
    expect(screen.getByText((_content, node) => node?.textContent === "Source: Web")).toBeDefined();
  });

  it("labels stash and local rounds in the installed rounds view", async () => {
    mocks.loaderData.rounds = [
      makeRound({
        id: "stash-round",
        name: "Stash Round",
        createdAt: "2026-03-03T11:00:00.000Z",
        installSourceKey: "stash:https://stash.example.com:scene:123",
      }),
      makeRound({
        id: "local-round",
        name: "Local Round",
        createdAt: "2026-03-03T10:00:00.000Z",
      }),
    ];

    await renderInstalledRoundsPage();

    expect(screen.getAllByText("Stash").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Local").length).toBeGreaterThan(0);
    expect(
      screen.getByText((_content, node) => node?.textContent === "Source: Stash")
    ).toBeDefined();
    expect(
      screen.getByText((_content, node) => node?.textContent === "Source: Local")
    ).toBeDefined();
  });

  it("falls back to a normal round type label when persisted type data is blank", async () => {
    mocks.loaderData.rounds = [
      {
        ...makeRound({
          id: "blank-type-round",
          name: "Blank Type Round",
          createdAt: "2026-03-03T11:00:00.000Z",
        }),
        type: "",
      } as unknown as InstalledRound,
    ];

    await renderInstalledRoundsPage();

    expect(screen.getAllByText("Normal").length).toBeGreaterThan(0);
  });

  it("shows preview generation text for website rounds while web caching is running", async () => {
    mocks.db.webVideoCache.getScanStatus.mockResolvedValue({
      state: "running",
      startedAt: "2026-03-30T00:00:00.000Z",
      finishedAt: null,
      totalCount: 1,
      completedCount: 0,
      skippedCount: 0,
      failedCount: 0,
      currentRoundName: "Website Round",
      currentUrl: "https://example.com/watch?v=1",
      errors: [],
    });
    mocks.loaderData.rounds = [
      makeRound({
        id: "web-round",
        name: "Website Round",
        createdAt: "2026-03-03T11:00:00.000Z",
        installSourceKey: "website:https://example.com/watch?v=1",
      }),
    ];

    await renderInstalledRoundsPage();

    expect(await screen.findByText("Preview Is Being Generated")).toBeDefined();
  });

  it("shows preview generation text on collapsed hero groups while grouped website rounds are processing", async () => {
    mocks.db.webVideoCache.getScanStatus.mockResolvedValue({
      state: "running",
      startedAt: "2026-03-30T00:00:00.000Z",
      finishedAt: null,
      totalCount: 1,
      completedCount: 0,
      skippedCount: 0,
      failedCount: 0,
      currentRoundName: "Hero Website Round",
      currentUrl: "https://example.com/watch?v=hero",
      errors: [],
    });
    mocks.loaderData.rounds = [
      makeRound({
        id: "hero-web-round",
        name: "Hero Website Round",
        createdAt: "2026-03-03T11:00:00.000Z",
        hero: { id: "hero-1", name: "Hero One" },
        installSourceKey: "website:https://example.com/watch?v=hero",
      }),
    ];

    await renderInstalledRoundsPage();

    expect(await screen.findByText("Preview Is Being Generated")).toBeDefined();
    expect(screen.queryByRole("heading", { name: "Hero Website Round" })).toBeNull();
  });

  it("launches the installed rounds overlay with the canonical installed round list", async () => {
    mocks.loaderData.rounds = [
      makeRound({
        id: "main-round",
        name: "Main Round",
        createdAt: "2026-03-01T10:00:00.000Z",
        videoUri: "app://media/%2Ftmp%2Fmain-round.mp4",
      }),
      makeRound({
        id: "zelda-interjection",
        name: "Zelda Interjection",
        createdAt: "2026-03-01T09:00:00.000Z",
        videoUri: "app://media/%2Ftmp%2FFugtrup%2520Zelda%2520x%2520Bokoblin.mp4",
      }),
      makeRound({
        id: "other-interjection",
        name: "Other Interjection",
        createdAt: "2026-03-01T08:00:00.000Z",
        videoUri: "app://media/%2Ftmp%2Fother-interjection.mp4",
      }),
    ].map((round, index) =>
      index === 0 ? round : ({ ...round, type: "Interjection" } as InstalledRound)
    );

    await renderInstalledRoundsPage();

    expect(mocks.db.round.findInstalled).not.toHaveBeenCalled();
    fireEvent.click(await screen.findByLabelText("Play Main Round"));

    await waitFor(() => expect(mocks.roundVideoOverlay).toHaveBeenCalled());
    expect(mocks.db.round.findInstalled).toHaveBeenCalledTimes(1);
    const lastCall = mocks.roundVideoOverlay.mock.calls.at(-1)?.[0] as unknown as {
      installedRounds: InstalledRound[];
    };
    expect(lastCall.installedRounds.map((round) => round.id)).toEqual([
      "main-round",
      "zelda-interjection",
      "other-interjection",
    ]);
  });

  it("launches preview rounds through the normal overlay phase with the selected round id", async () => {
    mocks.loaderData.rounds = [
      makeRound({
        id: "preview-round",
        name: "Preview Round",
        createdAt: "2026-03-01T10:00:00.000Z",
        videoUri: "app://media/%2Ftmp%2Fpreview-round.mp4",
        funscriptUri: "app://media/%2Ftmp%2Fpreview-round.funscript",
      }),
    ];

    await renderInstalledRoundsPage();

    fireEvent.click(await screen.findByLabelText("Play Preview Round"));

    await waitFor(() => expect(mocks.roundVideoOverlay).toHaveBeenCalled());
    const lastCall = mocks.roundVideoOverlay.mock.calls.at(-1)?.[0] as unknown as {
      activeRound: { roundId: string; phaseKind: string };
      currentPlayer: unknown;
      showCloseButton: boolean;
      onClose: () => void;
      onFinishRound: () => void;
    };
    expect(lastCall.activeRound.roundId).toBe("preview-round");
    expect(lastCall.activeRound.phaseKind).toBe("normal");
    expect(lastCall.currentPlayer).toBeUndefined();
    expect(lastCall.showCloseButton).toBe(true);
    expect(lastCall.onClose).toBeTypeOf("function");
    expect(lastCall.onFinishRound).toBeTypeOf("function");
  });

  it("clears the installed preview overlay on close and finish callbacks", async () => {
    mocks.loaderData.rounds = [
      makeRound({
        id: "preview-round",
        name: "Preview Round",
        createdAt: "2026-03-01T10:00:00.000Z",
        videoUri: "app://media/%2Ftmp%2Fpreview-round.mp4",
      }),
    ];

    await renderInstalledRoundsPage();

    fireEvent.click(await screen.findByLabelText("Play Preview Round"));

    await waitFor(() => expect(mocks.roundVideoOverlay).toHaveBeenCalledTimes(1));
    const onClose = (
      mocks.roundVideoOverlay.mock.calls.at(-1)?.[0] as unknown as {
        onClose: () => void;
      }
    ).onClose;
    await act(async () => {
      onClose();
    });

    await waitFor(() => expect(mocks.roundVideoOverlay).toHaveBeenCalledTimes(1));

    fireEvent.click(await screen.findByLabelText("Play Preview Round"));

    await waitFor(() => expect(mocks.roundVideoOverlay).toHaveBeenCalledTimes(2));
    const onFinishRound = (
      mocks.roundVideoOverlay.mock.calls.at(-1)?.[0] as unknown as {
        onFinishRound: () => void;
      }
    ).onFinishRound;
    await act(async () => {
      onFinishRound();
    });

    await waitFor(() => expect(mocks.roundVideoOverlay).toHaveBeenCalledTimes(2));
  });

  it("tears down the card preview video before launching the overlay", async () => {
    mocks.loaderData.rounds = [
      makeRound({
        id: "main-round",
        name: "Main Round",
        createdAt: "2026-03-01T10:00:00.000Z",
        videoUri: "app://media/%2Ftmp%2Fmain-round.mp4",
      }),
    ];

    const { container } = await renderInstalledRoundsPage();

    const heading = await screen.findByRole("heading", { name: "Main Round" });
    const card = heading.closest("article");
    expect(card).not.toBeNull();
    fireEvent.mouseEnter(card!);

    await waitFor(() => expect(container.querySelector("video")).not.toBeNull());

    fireEvent.click(screen.getByLabelText("Play Main Round"));

    await waitFor(() => expect(container.querySelector("video")).toBeNull());
    await waitFor(() => expect(mocks.roundVideoOverlay).toHaveBeenCalled());
  });

  it("explicitly reloads the card preview video when hover preview activates", async () => {
    mocks.loaderData.rounds = [
      makeRound({
        id: "main-round",
        name: "Main Round",
        createdAt: "2026-03-01T10:00:00.000Z",
        videoUri: "app://media/%2Ftmp%2Fmain-round.mp4",
      }),
    ];

    const loadSpy = vi
      .spyOn(HTMLMediaElement.prototype, "load")
      .mockImplementation(() => undefined);

    await renderInstalledRoundsPage();

    const heading = await screen.findByRole("heading", { name: "Main Round" });
    const card = heading.closest("article");
    expect(card).not.toBeNull();

    fireEvent.mouseEnter(card!);

    await waitFor(() => expect(loadSpy).toHaveBeenCalled());
  });

  it("shows caching ongoing for website rounds that are still waiting for the cache", async () => {
    mocks.loaderData.rounds = [
      makeRound({
        id: "web-round",
        name: "Website Round",
        createdAt: "2026-03-03T11:00:00.000Z",
        installSourceKey: "website:https://example.com/watch?v=1",
        websiteVideoCacheStatus: "pending",
      }),
    ];

    await renderInstalledRoundsPage();

    expect(screen.getAllByText("Caching Ongoing").length).toBeGreaterThan(0);
    expect(screen.queryByRole("button", { name: "Play Website Round" })).toBeNull();
  });

  it("shows caching state on collapsed hero groups when grouped website rounds are pending", async () => {
    mocks.loaderData.rounds = [
      makeRound({
        id: "hero-web-round",
        name: "Hero Website Round",
        createdAt: "2026-03-03T11:00:00.000Z",
        hero: { id: "hero-1", name: "Hero One" },
        installSourceKey: "website:https://example.com/watch?v=hero",
        websiteVideoCacheStatus: "pending",
      }),
    ];

    await renderInstalledRoundsPage();

    expect(screen.getAllByText("Caching Ongoing").length).toBeGreaterThan(0);
    expect(screen.queryByRole("heading", { name: "Hero Website Round" })).toBeNull();
  });

  it("converts a hero group back to a standalone round after explicit confirmation", async () => {
    mocks.loaderData.rounds = [
      makeRound({
        id: "r1",
        name: "Hero Round 1",
        createdAt: "2026-03-03T12:00:00.000Z",
        hero: { id: "h1", name: "Hero One" },
      }),
      makeRound({
        id: "r2",
        name: "Hero Round 2",
        createdAt: "2026-03-03T13:00:00.000Z",
        hero: { id: "h1", name: "Hero One" },
      }),
    ];

    await renderInstalledRoundsPage();

    fireEvent.click(screen.getByRole("button", { name: "Actions" }));
    fireEvent.click(screen.getByRole("button", { name: "Convert to Round" }));
    fireEvent.change(screen.getByLabelText('Type "Hero One" to confirm'), {
      target: { value: "hero one" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Confirm Conversion" }));

    await waitFor(() => {
      expect(mocks.db.round.convertHeroGroupToRound).toHaveBeenCalledWith({
        keepRoundId: "r1",
        roundIds: ["r2", "r1"],
        heroId: "h1",
        roundName: "Hero One",
      });
    });
  });

  it("refreshes installed rounds after converting a hero group so the kept round becomes standalone", async () => {
    mocks.loaderData.rounds = [
      makeRound({
        id: "r1",
        name: "Hero Round 1",
        createdAt: "2026-03-03T12:00:00.000Z",
        hero: { id: "h1", name: "Hero One" },
        startTime: 1000,
        endTime: 5000,
      }),
      makeRound({
        id: "r2",
        name: "Hero Round 2",
        createdAt: "2026-03-03T13:00:00.000Z",
        hero: { id: "h1", name: "Hero One" },
        startTime: 6000,
        endTime: 9000,
      }),
    ];

    mocks.db.round.convertHeroGroupToRound.mockImplementation(async () => {
      mocks.loaderData.rounds = [
        makeRound({
          id: "r1",
          name: "Hero One",
          createdAt: "2026-03-03T12:00:00.000Z",
          hero: null,
          startTime: null,
          endTime: null,
        }),
      ];

      return {
        keptRoundId: "r1",
        removedRoundCount: 1,
        deletedHero: true,
      };
    });

    await renderInstalledRoundsPage();

    expect(screen.getByRole("button", { name: "Hero One (2 rounds)" })).toBeDefined();

    fireEvent.click(screen.getByRole("button", { name: "Actions" }));
    fireEvent.click(screen.getByRole("button", { name: "Convert to Round" }));
    fireEvent.change(screen.getByLabelText('Type "Hero One" to confirm'), {
      target: { value: "Hero One" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Confirm Conversion" }));

    await waitFor(() => {
      expect(mocks.db.round.findInstalledCatalog).toHaveBeenCalledTimes(2);
    });

    await waitFor(() => {
      expect(screen.queryByRole("button", { name: "Hero One (2 rounds)" })).toBeNull();
      expect(screen.getByText("Hero One")).toBeDefined();
      expect(screen.getByRole("button", { name: "Edit Round" })).toBeDefined();
    });
  });

  it("converts a hero group back to the first attached round instead of the earliest start time", async () => {
    mocks.loaderData.rounds = [
      makeRound({
        id: "r1",
        name: "Hero Round 1",
        createdAt: "2026-03-03T10:00:00.000Z",
        startTime: 4000,
        hero: { id: "h1", name: "Hero One" },
      }),
      makeRound({
        id: "r2",
        name: "Hero Round 2",
        createdAt: "2026-03-03T11:00:00.000Z",
        startTime: 1000,
        hero: { id: "h1", name: "Hero One" },
      }),
    ];

    await renderInstalledRoundsPage();

    fireEvent.click(screen.getByRole("button", { name: "Actions" }));
    fireEvent.click(screen.getByRole("button", { name: "Convert to Round" }));
    fireEvent.change(screen.getByLabelText('Type "Hero One" to confirm'), {
      target: { value: "Hero One" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Confirm Conversion" }));

    await waitFor(() => {
      expect(mocks.db.round.convertHeroGroupToRound).toHaveBeenCalledWith({
        keepRoundId: "r1",
        roundIds: ["r2", "r1"],
        heroId: "h1",
        roundName: "Hero One",
      });
    });
  });

  it("edits a standalone round inside a popup", async () => {
    mocks.loaderData.rounds = [
      makeRound({ id: "solo", name: "Solo Round", createdAt: "2026-03-03T11:00:00.000Z" }),
    ];

    await renderInstalledRoundsPage();

    fireEvent.click(screen.getByRole("button", { name: "Edit Round" }));
    await waitFor(() => {
      expect(mocks.db.round.getMediaResources).toHaveBeenCalledWith("solo", false);
    });
    await screen.findByDisplayValue("Solo Round");
    fireEvent.change(screen.getByDisplayValue("Solo Round"), {
      target: { value: "Solo Round Updated" },
    });

    fireEvent.click(screen.getByRole("button", { name: "Save Round" }));

    await waitFor(() => {
      expect(mocks.db.round.update).toHaveBeenCalledWith(
        expect.objectContaining({
          id: "solo",
          name: "Solo Round Updated",
        })
      );
    });
  });

  it("attaches a funscript from the round edit dialog", async () => {
    mocks.loaderData.rounds = [
      makeRound({ id: "solo", name: "Solo Round", createdAt: "2026-03-03T11:00:00.000Z" }),
    ];
    vi.mocked(window.electronAPI.dialog.selectConverterFunscriptFile).mockResolvedValue(
      "/tmp/solo.funscript"
    );

    await renderInstalledRoundsPage();

    fireEvent.click(screen.getByRole("button", { name: "Edit Round" }));
    await screen.findByDisplayValue("Solo Round");
    fireEvent.click(screen.getByRole("button", { name: "Attach Funscript" }));
    await waitFor(() => {
      expect(screen.getByText("app://media/%2Ftmp%2Fsolo.funscript")).toBeDefined();
    });
    fireEvent.click(screen.getByRole("button", { name: "Save Round" }));

    await waitFor(() => {
      expect(mocks.db.round.update).toHaveBeenCalledWith(
        expect.objectContaining({
          id: "solo",
          funscriptUri: "app://media/%2Ftmp%2Fsolo.funscript",
        })
      );
    });
  });

  it("detaches a funscript from the round edit dialog", async () => {
    mocks.loaderData.rounds = [
      makeRound({
        id: "solo",
        name: "Solo Round",
        createdAt: "2026-03-03T11:00:00.000Z",
        funscriptUri: "app://media/%2Ftmp%2Fsolo.funscript",
      }),
    ];

    await renderInstalledRoundsPage();

    fireEvent.click(screen.getByRole("button", { name: "Edit Round" }));
    await screen.findByDisplayValue("Solo Round");
    fireEvent.click(screen.getByRole("button", { name: "Detach Funscript" }));
    fireEvent.click(screen.getByRole("button", { name: "Save Round" }));

    await waitFor(() => {
      expect(mocks.db.round.update).toHaveBeenCalledWith(
        expect.objectContaining({
          id: "solo",
          funscriptUri: null,
        })
      );
    });
  });

  it("edits a hero group inside a popup", async () => {
    mocks.loaderData.rounds = [
      makeRound({
        id: "r1",
        name: "Hero Round 1",
        createdAt: "2026-03-03T12:00:00.000Z",
        hero: { id: "h1", name: "Hero One" },
      }),
    ];

    await renderInstalledRoundsPage();

    fireEvent.click(screen.getByRole("button", { name: "Actions" }));
    fireEvent.click(screen.getByRole("button", { name: "Edit Hero" }));
    fireEvent.change(screen.getByDisplayValue("Hero One"), {
      target: { value: "Hero Prime" },
    });

    fireEvent.click(screen.getByRole("button", { name: "Save Hero" }));

    await waitFor(() => {
      expect(mocks.db.hero.update).toHaveBeenCalledWith(
        expect.objectContaining({
          id: "h1",
          name: "Hero Prime",
        })
      );
    });
  });

  it("deletes a standalone round from the edit dialog without touching files", async () => {
    mocks.loaderData.rounds = [
      makeRound({ id: "solo", name: "Solo Round", createdAt: "2026-03-03T11:00:00.000Z" }),
    ];

    await renderInstalledRoundsPage();

    fireEvent.click(screen.getByRole("button", { name: "Edit Round" }));
    await screen.findByDisplayValue("Solo Round");
    fireEvent.change(screen.getByDisplayValue("Solo Round"), {
      target: { value: "" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Delete Round" }));

    expect(screen.getByText(/Delete round entry “Solo Round” from the database\?/)).toBeDefined();
    fireEvent.click(screen.getAllByRole("button", { name: "Delete Round" }).at(-1)!);

    await waitFor(() => {
      expect(mocks.db.round.delete).toHaveBeenCalledWith("solo");
    });
  });

  it("deletes a hero from the edit dialog together with attached rounds", async () => {
    mocks.loaderData.rounds = [
      makeRound({
        id: "r1",
        name: "Hero Round 1",
        createdAt: "2026-03-03T12:00:00.000Z",
        hero: { id: "h1", name: "Hero One" },
      }),
    ];
    await renderInstalledRoundsPage();

    fireEvent.click(screen.getByRole("button", { name: "Actions" }));
    fireEvent.click(screen.getByRole("button", { name: "Edit Hero" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete Hero" }));
    expect(screen.getByText(/Delete hero entry “Hero One” from the database\?/)).toBeDefined();
    fireEvent.click(screen.getAllByRole("button", { name: "Delete Hero" }).at(-1)!);

    await waitFor(() => {
      expect(mocks.db.hero.delete).toHaveBeenCalledWith("h1");
    });
  });

  it("deletes a hero directly from the installed rounds hero-group actions", async () => {
    mocks.loaderData.rounds = [
      makeRound({
        id: "r1",
        name: "Hero Round 1",
        createdAt: "2026-03-03T12:00:00.000Z",
        hero: { id: "h1", name: "Hero One" },
      }),
    ];

    await renderInstalledRoundsPage();

    fireEvent.click(screen.getByRole("button", { name: "Actions" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete Hero" }));
    expect(screen.getByText(/Delete hero entry “Hero One” from the database\?/)).toBeDefined();
    fireEvent.click(screen.getAllByRole("button", { name: "Delete Hero" }).at(-1)!);

    await waitFor(() => {
      expect(mocks.db.hero.delete).toHaveBeenCalledWith("h1");
    });
  });

  it("prompts for an export destination before packaging the library", async () => {
    mocks.loaderData.rounds = [
      makeRound({ id: "solo", name: "Solo Target", createdAt: "2026-03-03T11:00:00.000Z" }),
    ];
    vi.mocked(window.electronAPI.dialog.selectPlaylistExportDirectory).mockResolvedValue(
      "/tmp/export-root"
    );

    await renderInstalledRoundsPage();
    fireEvent.click(screen.getByRole("button", { name: "Export" }));
    expect(screen.getByRole("dialog", { name: "Package your library." })).toBeTruthy();

    await waitFor(() => {
      expect(mocks.db.install.analyzeExportPackage).toHaveBeenCalled();
    });
    fireEvent.click(screen.getByRole("button", { name: "Start Export" }));

    await waitFor(() => {
      expect(window.electronAPI.dialog.selectPlaylistExportDirectory).toHaveBeenCalledWith(
        "Installed Library"
      );
    });
    await waitFor(() => {
      expect(mocks.db.install.exportPackage).toHaveBeenCalledWith({
        roundIds: undefined,
        heroIds: undefined,
        includeMedia: true,
        asFpack: false,
        directoryPath: "/tmp/export-root",
        compressionMode: "av1",
        compressionStrength: 80,
      });
    });
    expect(screen.getByText("/tmp/export-root/2026-03-20T12-00-00.000Z")).toBeTruthy();
    expect(screen.getByText("Export complete.")).toBeTruthy();
  });

  it("does not start the package export when directory selection is cancelled", async () => {
    vi.mocked(window.electronAPI.dialog.selectPlaylistExportDirectory).mockResolvedValue(null);
    await renderInstalledRoundsPage();
    fireEvent.click(screen.getByRole("button", { name: "Export" }));
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Start Export" })).toBeTruthy();
    });
    fireEvent.click(screen.getByRole("button", { name: "Start Export" }));

    await waitFor(() => {
      expect(window.electronAPI.dialog.selectPlaylistExportDirectory).toHaveBeenCalledWith(
        "Installed Library"
      );
    });
    expect(mocks.db.install.exportPackage).not.toHaveBeenCalled();
  });

  it("selects library items without loading full installed rounds and exports selected ids", async () => {
    mocks.loaderData.rounds = [
      makeRound({ id: "solo", name: "Solo Target", createdAt: "2026-03-03T11:00:00.000Z" }),
      makeRound({
        id: "hero-round",
        name: "Hero Target",
        createdAt: "2026-03-03T10:00:00.000Z",
        hero: { id: "hero-1", name: "Hero One" },
      }),
    ];

    await renderInstalledRoundsPage();

    fireEvent.click(screen.getByRole("button", { name: "Select Items" }));
    fireEvent.click(screen.getByRole("button", { name: "Select Solo Target" }));
    fireEvent.click(screen.getByRole("button", { name: "Select Hero One" }));

    expect(mocks.db.round.findInstalled).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Export Selected" }));

    await waitFor(() => {
      expect(mocks.db.install.analyzeExportPackage).toHaveBeenCalledWith(
        expect.objectContaining({
          roundIds: ["solo", "hero-round"],
          heroIds: ["hero-1"],
        })
      );
    });
  });

  it("shows AV1 analysis controls for library export and hides them when media is disabled", async () => {
    await renderInstalledRoundsPage();

    fireEvent.click(screen.getByRole("button", { name: "Export" }));

    await waitFor(() => {
      expect(mocks.db.install.analyzeExportPackage).toHaveBeenCalled();
    });
    expect(screen.getByRole("button", { name: "Convert to AV1" })).toBeTruthy();
    expect(screen.getByText("Compression Strength")).toBeTruthy();

    fireEvent.click(screen.getByRole("checkbox", { name: "Include Media Files" }));

    await waitFor(() => {
      expect(screen.queryByRole("button", { name: "Convert to AV1" })).toBeNull();
    });
  });

  it("shows export progress overlay and aborts the library export", async () => {
    mocks.db.install.exportPackage.mockImplementation(() => new Promise(() => {}));
    mocks.db.install.getExportPackageStatus.mockResolvedValue({
      state: "running",
      phase: "copying",
      startedAt: "2026-03-20T12:00:00.000Z",
      finishedAt: null,
      lastMessage: "Exporting video demo.mp4...",
      progress: { completed: 1, total: 4 },
      stats: { heroFiles: 0, roundFiles: 0, videoFiles: 1, funscriptFiles: 0 },
      compression: null,
    });
    vi.mocked(window.electronAPI.dialog.selectPlaylistExportDirectory).mockResolvedValue(
      "/tmp/export-root"
    );

    await renderInstalledRoundsPage();
    fireEvent.click(screen.getByRole("button", { name: "Export" }));
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Start Export" })).toBeTruthy();
    });
    fireEvent.click(screen.getByRole("button", { name: "Start Export" }));

    await waitFor(() => {
      expect(screen.getByText("Library Export Running")).toBeTruthy();
    });

    fireEvent.click(screen.getByRole("button", { name: "Abort Export" }));

    await waitFor(() => {
      expect(mocks.db.install.abortExportPackage).toHaveBeenCalledTimes(1);
    });
  });

  it("removes the dedicated open export folder action", async () => {
    await renderInstalledRoundsPage();
    expect(screen.queryByRole("button", { name: "Open Export Folder" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Export" }));
    expect(screen.queryByRole("button", { name: "Browse Export Library" })).toBeNull();
  });

  it("shows a long-running import overlay and allows aborting the import", async () => {
    let resolveImport: ((value: unknown) => void) | null = null;
    mocks.db.install.scanFolderOnce.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveImport = resolve;
        })
    );
    vi.mocked(window.electronAPI.dialog.selectFolders).mockResolvedValue(["/tmp/legacy-pack"]);

    await renderInstalledRoundsPage();
    fireEvent.click(screen.getByRole("button", { name: "Install Rounds" }));

    expect(await screen.findByText("Installing rounds can take a very long time.")).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "Abort Import" }));

    await waitFor(() => {
      expect(mocks.db.install.abortScan).toHaveBeenCalledTimes(1);
    });

    const settleImport = resolveImport as ((value: unknown) => void) | null;
    if (settleImport) {
      settleImport({
        status: {
          state: "aborted",
          triggeredBy: "manual",
          startedAt: "2026-03-06T00:00:00.000Z",
          finishedAt: "2026-03-06T00:00:04.000Z",
          stats: {
            scannedFolders: 1,
            sidecarsSeen: 0,
            installed: 0,
            updated: 0,
            skipped: 0,
            failed: 0,
          },
          lastMessage: "Import aborted by user.",
          lastErrors: [],
        },
      });
    }

    await waitFor(() => {
      expect(screen.queryByText("Installing rounds can take a very long time.")).toBeNull();
    });
  });

  it("reviews legacy import before importing and keeps natural slot order for playlist creation", async () => {
    vi.mocked(window.electronAPI.dialog.selectFolders).mockResolvedValue(["/tmp/legacy-pack"]);
    mocks.db.install.inspectFolder.mockResolvedValue({
      kind: "legacy",
      folderPath: "/tmp/legacy-pack",
      playlistNameHint: "Legacy Pack",
      legacySlots: [
        {
          id: "slot-0",
          sourcePath: "/tmp/legacy-pack/1.mp4",
          sourceLabel: "1",
          originalOrder: 0,
          defaultCheckpoint: false,
        },
        {
          id: "slot-1",
          sourcePath: "/tmp/legacy-pack/2 checkpoint.mp4",
          sourceLabel: "2 checkpoint",
          originalOrder: 1,
          defaultCheckpoint: true,
        },
        {
          id: "slot-2",
          sourcePath: "/tmp/legacy-pack/10.mp4",
          sourceLabel: "10",
          originalOrder: 2,
          defaultCheckpoint: false,
        },
      ],
    });

    await renderInstalledRoundsPage();
    fireEvent.click(screen.getByRole("button", { name: "Install Rounds" }));

    expect(await screen.findByRole("heading", { name: "Review Legacy Import" })).toBeDefined();
    expect(screen.getByText(/Ordered by filename \(natural sort\)/)).toBeDefined();
    expect(screen.getAllByText("Checkpoint: No")).toHaveLength(2);
    fireEvent.change(screen.getByPlaceholderText("Legacy Playlist"), {
      target: { value: "Imported Legacy Run" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Import and Create Playlist" }));

    await waitFor(() => {
      expect(mocks.playlists.create).toHaveBeenCalledWith(
        expect.objectContaining({
          name: "Imported Legacy Run",
          config: expect.objectContaining({
            boardConfig: expect.objectContaining({
              safePointIndices: [2],
              normalRoundRefsByIndex: {
                "1": { name: "1", type: "Normal" },
                "3": { name: "10", type: "Normal" },
              },
            }),
            perkSelection: expect.objectContaining({
              triggerChancePerCompletedRound: 0.51,
            }),
            perkPool: {
              enabledPerkIds: getSinglePlayerPerkPool().map((perk) => perk.id),
              enabledAntiPerkIds: getSinglePlayerAntiPerkPool().map((perk) => perk.id),
            },
          }),
        })
      );
    });
    expect(mocks.db.install.importLegacyWithPlan).toHaveBeenCalledWith(
      "/tmp/legacy-pack",
      [
        {
          id: "slot-0",
          sourcePath: "/tmp/legacy-pack/1.mp4",
          originalOrder: 0,
          selectedAsCheckpoint: false,
          excludedFromImport: false,
        },
        {
          id: "slot-1",
          sourcePath: "/tmp/legacy-pack/2 checkpoint.mp4",
          originalOrder: 1,
          selectedAsCheckpoint: true,
          excludedFromImport: false,
        },
        {
          id: "slot-2",
          sourcePath: "/tmp/legacy-pack/10.mp4",
          originalOrder: 2,
          selectedAsCheckpoint: false,
          excludedFromImport: false,
        },
      ],
      true
    );
    expect(mocks.playlists.setActive).toHaveBeenCalledWith("playlist-1");
  });

  it("can import a reviewed legacy folder without creating a playlist", async () => {
    vi.mocked(window.electronAPI.dialog.selectFolders).mockResolvedValue(["/tmp/legacy-pack"]);
    mocks.db.install.inspectFolder.mockResolvedValue({
      kind: "legacy",
      folderPath: "/tmp/legacy-pack",
      playlistNameHint: "Legacy Pack",
      legacySlots: [
        {
          id: "slot-0",
          sourcePath: "/tmp/legacy-pack/1.mp4",
          sourceLabel: "1",
          originalOrder: 0,
          defaultCheckpoint: false,
        },
        {
          id: "slot-1",
          sourcePath: "/tmp/legacy-pack/2.mp4",
          sourceLabel: "2",
          originalOrder: 1,
          defaultCheckpoint: false,
        },
      ],
    });

    await renderInstalledRoundsPage();
    fireEvent.click(screen.getByRole("button", { name: "Install Rounds" }));

    expect(await screen.findByRole("heading", { name: "Review Legacy Import" })).toBeDefined();
    fireEvent.click(screen.getAllByRole("checkbox", { name: "Import" })[1]!);
    fireEvent.click(screen.getByRole("checkbox", { name: /create a playlist after import/i }));
    fireEvent.click(screen.getByRole("button", { name: "Import Without Playlist" }));

    await waitFor(() => {
      expect(mocks.db.install.importLegacyWithPlan).toHaveBeenCalledWith(
        "/tmp/legacy-pack",
        [
          {
            id: "slot-0",
            sourcePath: "/tmp/legacy-pack/1.mp4",
            originalOrder: 0,
            selectedAsCheckpoint: false,
            excludedFromImport: false,
          },
          {
            id: "slot-1",
            sourcePath: "/tmp/legacy-pack/2.mp4",
            originalOrder: 1,
            selectedAsCheckpoint: false,
            excludedFromImport: true,
          },
        ],
        true
      );
    });
    expect(mocks.playlists.create).not.toHaveBeenCalled();
    expect(mocks.playlists.setActive).not.toHaveBeenCalled();
  });

  it("imports a selected .round or .hero file from the rounds page", async () => {
    vi.mocked(window.electronAPI.dialog.selectInstallImportFile).mockResolvedValue(
      "/tmp/imported.round"
    );

    await renderInstalledRoundsPage();
    fireEvent.click(screen.getByRole("button", { name: "Import File" }));

    await waitFor(() => {
      expect(mocks.db.install.importSidecarFile).toHaveBeenCalledWith("/tmp/imported.round");
    });
    expect(mocks.navigate).not.toHaveBeenCalledWith({ to: "/playlist-workshop" });
  });

  it("imports a selected .fplay file from the rounds page and navigates to playlist workshop", async () => {
    vi.mocked(window.electronAPI.dialog.selectInstallImportFile).mockResolvedValue(
      "/tmp/imported.fplay"
    );

    await renderInstalledRoundsPage();
    fireEvent.click(screen.getByRole("button", { name: "Import File" }));

    await waitFor(() => {
      expect(mocks.playlists.importFromFile).toHaveBeenCalledWith({
        filePath: "/tmp/imported.fplay",
      });
    });
    expect(mocks.playlists.setActive).toHaveBeenCalledWith("playlist-2");
    expect(mocks.navigate).toHaveBeenCalledWith({ to: "/playlist-workshop" });
  });

  it("hides the web funscript URL input by default in install from web", async () => {
    await renderInstalledRoundsPage();

    expect(screen.queryByRole("button", { name: "Overview" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Install From Web" }));

    expect(screen.getByRole("dialog", { name: "Install from web" })).toBeTruthy();
    expect(screen.queryByLabelText("Funscript URL")).toBeNull();
    expect(screen.getByRole("button", { name: /Select Local Funscript/i })).toBeDefined();
  });

  it("opens install from web when requested by rounds search params", async () => {
    mocks.search = { open: "install-web" };

    await renderInstalledRoundsPage();

    expect(await screen.findByRole("dialog", { name: "Install from web" })).toBeTruthy();
    expect(mocks.navigate).toHaveBeenCalledWith({
      to: "/rounds",
      search: {},
      replace: true,
    });
  });

  it("closes install from web on escape", async () => {
    await renderInstalledRoundsPage();
    fireEvent.click(screen.getByRole("button", { name: "Install From Web" }));

    expect(screen.getByRole("dialog", { name: "Install from web" })).toBeTruthy();

    fireEvent.keyDown(window, { key: "Escape" });

    expect(screen.queryByRole("dialog", { name: "Install from web" })).toBeNull();
  });

  it("opens the install folder picker when requested by rounds search params", async () => {
    mocks.search = { open: "install-rounds" };
    vi.mocked(window.electronAPI.dialog.selectFolders).mockResolvedValue(["/tmp/round-pack"]);

    await renderInstalledRoundsPage();

    await waitFor(() => {
      expect(window.electronAPI.dialog.selectFolders).toHaveBeenCalledTimes(1);
    });
    expect(mocks.db.install.inspectFolder).toHaveBeenCalledWith("/tmp/round-pack");
    expect(mocks.navigate).toHaveBeenCalledWith({
      to: "/rounds",
      search: {},
      replace: true,
    });
  });

  it("renders immediately, loads rounds after mount, and does not fetch playlists on first paint", async () => {
    mocks.loaderData.rounds = [
      makeRound({ id: "r1", name: "Round One", createdAt: "2026-03-03T12:00:00.000Z" }),
    ];

    render(<InstalledRoundsPage />);

    expect(screen.queryByRole("heading", { name: "Round One" })).toBeNull();
    expect(mocks.playlists.list).not.toHaveBeenCalled();

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Round One" })).toBeDefined();
    });
    expect(mocks.db.round.findInstalledCatalog).toHaveBeenCalledTimes(1);
    expect(mocks.db.round.findInstalled).not.toHaveBeenCalled();
  });

  it("shows a section-scoped retry state when the first rounds fetch fails", async () => {
    mocks.loaderData.rounds = [
      makeRound({ id: "r1", name: "Round One", createdAt: "2026-03-03T12:00:00.000Z" }),
    ];
    mocks.db.round.findInstalledCatalog
      .mockRejectedValueOnce(new Error("Library load failed."))
      .mockImplementation(async () => mocks.loaderData.rounds.map(toCatalogRound));

    render(<InstalledRoundsPage />);

    expect(await screen.findByText("Failed to load installed rounds")).toBeDefined();
    expect(screen.getByText("Library load failed.")).toBeDefined();

    fireEvent.click(screen.getByRole("button", { name: "Retry" }));

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Round One" })).toBeDefined();
    });
  });

  it("loads playlists only after switching the grouping mode to playlists", async () => {
    mocks.loaderData.rounds = [
      makeRound({ id: "r1", name: "Round One", createdAt: "2026-03-03T12:00:00.000Z" }),
    ];
    mocks.loaderData.availablePlaylists = [makePlaylist("playlist-1", "Playlist One", ["r1"])];

    await renderInstalledRoundsPage();

    expect(mocks.playlists.list).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Playlists" }));

    await waitFor(() => {
      expect(mocks.playlists.list).toHaveBeenCalledTimes(1);
    });
    expect(await screen.findByRole("button", { name: "Playlist One (1 rounds)" })).toBeDefined();
  });

  it("autofills the round name from the extracted website title while the field is untouched", async () => {
    await renderInstalledRoundsPage();
    fireEvent.click(screen.getByRole("button", { name: "Install From Web" }));

    fireEvent.change(screen.getByLabelText("Video URL"), {
      target: { value: "https://www.pornhub.com/view_video.php?viewkey=abc123" },
    });

    await screen.findByText("Supported via PornHub: Demo title");
    expect((screen.getByLabelText("Round Name") as HTMLInputElement).value).toBe("Demo title");
  });

  it("does not overwrite a manually entered round name with the extracted website title", async () => {
    await renderInstalledRoundsPage();
    fireEvent.click(screen.getByRole("button", { name: "Install From Web" }));

    fireEvent.change(screen.getByLabelText("Round Name"), {
      target: { value: "Manual Name" },
    });
    fireEvent.change(screen.getByLabelText("Video URL"), {
      target: { value: "https://www.pornhub.com/view_video.php?viewkey=abc123" },
    });

    await screen.findByText("Supported via PornHub: Demo title");
    expect((screen.getByLabelText("Round Name") as HTMLInputElement).value).toBe("Manual Name");
  });

  it("installs a website-backed round from the import view with an optional local funscript", async () => {
    vi.mocked(window.electronAPI.dialog.selectConverterFunscriptFile).mockResolvedValue(
      "/tmp/demo.funscript"
    );
    vi.mocked(window.electronAPI.file.convertFileSrc).mockReturnValue(
      "app://media/tmp/demo.funscript"
    );
    mocks.loaderData.installWebFunscriptUrlEnabled = true;
    mocks.db.round.createWebsiteRound.mockImplementation(async () => {
      mocks.loaderData.rounds = [
        makeRound({
          id: "website-round-1",
          name: "Website Demo",
          createdAt: "2026-03-07T00:00:00.000Z",
        }),
      ];
      return {
        roundId: "website-round-1",
        resourceId: "website-resource-1",
      };
    });

    await renderInstalledRoundsPage();
    fireEvent.click(screen.getByRole("button", { name: "Install From Web" }));

    expect(screen.getByRole("dialog", { name: "Install from web" })).toBeTruthy();

    fireEvent.change(screen.getByLabelText("Round Name"), {
      target: { value: "Website Demo" },
    });
    fireEvent.change(screen.getByLabelText("Video URL"), {
      target: { value: "https://www.pornhub.com/view_video.php?viewkey=abc123" },
    });

    fireEvent.click(screen.getByRole("button", { name: /Select Local Funscript/i }));

    expect(await screen.findByText("Local funscript attached: demo.funscript")).toBeDefined();
    expect(await screen.findByText("Supported via PornHub: Demo title")).toBeDefined();

    fireEvent.click(screen.getByRole("button", { name: /Install Website Round/i }));

    await waitFor(() => {
      expect(mocks.db.round.createWebsiteRound).toHaveBeenCalledWith({
        name: "Website Demo",
        videoUri: "https://www.pornhub.com/view_video.php?viewkey=abc123",
        funscriptUri: "app://media/tmp/demo.funscript",
      });
    });
    expect(await screen.findByText('Installed "Website Demo".')).toBeDefined();
  });

  it("loads the remote funscript setting when the web install dialog opens", async () => {
    mocks.loaderData.installWebFunscriptUrlEnabled = true;

    await renderInstalledRoundsPage();
    fireEvent.click(screen.getByRole("button", { name: "Install From Web" }));

    expect(screen.queryByLabelText("Funscript URL")).toBeNull();
    expect(await screen.findByLabelText("Funscript URL")).toBeDefined();
  });

  it("shows unsupported website video feedback live and blocks install", async () => {
    mocks.db.round.checkWebsiteVideoSupport.mockRejectedValue(
      new Error("This website video URL is not supported.")
    );

    await renderInstalledRoundsPage();
    fireEvent.click(screen.getByRole("button", { name: "Install From Web" }));

    fireEvent.change(screen.getByLabelText("Video URL"), {
      target: { value: "https://unsupported.example/video/123" },
    });

    expect(await screen.findByText("This website video URL is not supported.")).toBeDefined();
    expect(
      screen.getByRole("button", { name: /Install Website Round/i }).hasAttribute("disabled")
    ).toBe(true);
    expect(mocks.db.round.createWebsiteRound).not.toHaveBeenCalled();
  });

  it("renders a large library through the virtualized wrapper without load-more pagination", async () => {
    mocks.loaderData.rounds = Array.from({ length: 75 }, (_, index) =>
      makeRound({
        id: `round-${index}`,
        name: `Round ${index}`,
        createdAt: `2026-03-${String((index % 28) + 1).padStart(2, "0")}T00:00:00.000Z`,
      })
    );

    await renderInstalledRoundsPage();

    expect(screen.getByText("75 / 75 Visible")).toBeDefined();
    expect(screen.getByRole("heading", { name: "Round 0" })).toBeDefined();
    expect(screen.getByRole("heading", { name: "Round 74" })).toBeDefined();
    expect(screen.queryByText("Loading more rounds...")).toBeNull();
  });

  it("sorts installed rounds by oldest entry first", async () => {
    mocks.loaderData.rounds = [
      makeRound({ id: "newest", name: "Newest Round", createdAt: "2026-03-03T12:00:00.000Z" }),
      makeRound({ id: "middle", name: "Middle Round", createdAt: "2026-03-02T12:00:00.000Z" }),
      makeRound({ id: "oldest", name: "Oldest Round", createdAt: "2026-03-01T12:00:00.000Z" }),
    ];

    await renderInstalledRoundsPage();

    fireEvent.click(screen.getByRole("button", { name: /Newest/i }));
    fireEvent.click(screen.getByRole("button", { name: "Oldest" }));

    await waitFor(() => {
      expect(screen.getByText("Sort: Oldest")).toBeDefined();
    });

    const oldestHeading = screen.getByRole("heading", { name: "Oldest Round" });
    const middleHeading = screen.getByRole("heading", { name: "Middle Round" });
    const newestHeading = screen.getByRole("heading", { name: "Newest Round" });
    expect(oldestHeading.compareDocumentPosition(middleHeading)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING
    );
    expect(middleHeading.compareDocumentPosition(newestHeading)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING
    );
  });

  it("sorts installed rounds by length", async () => {
    mocks.loaderData.rounds = [
      makeRound({
        id: "medium",
        name: "Medium Round",
        createdAt: "2026-03-03T12:00:00.000Z",
        endTime: 180_000,
      }),
      makeRound({
        id: "long",
        name: "Long Round",
        createdAt: "2026-03-02T12:00:00.000Z",
        endTime: 300_000,
      }),
      makeRound({
        id: "short",
        name: "Short Round",
        createdAt: "2026-03-01T12:00:00.000Z",
        endTime: 60_000,
      }),
    ];

    await renderInstalledRoundsPage();

    fireEvent.click(screen.getByRole("button", { name: /Newest/i }));
    fireEvent.click(screen.getByRole("button", { name: "Length" }));

    await waitFor(() => {
      expect(screen.getByText("Sort: Length")).toBeDefined();
    });

    const longHeading = screen.getByRole("heading", { name: "Long Round" });
    const mediumHeading = screen.getByRole("heading", { name: "Medium Round" });
    const shortHeading = screen.getByRole("heading", { name: "Short Round" });
    expect(longHeading.compareDocumentPosition(mediumHeading)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING
    );
    expect(mediumHeading.compareDocumentPosition(shortHeading)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING
    );
  });

  it("shows template actions and repairs a template round from installed content", async () => {
    mocks.loaderData.rounds = [
      makeRound({
        id: "template-1",
        name: "Template Round",
        createdAt: "2026-03-03T00:00:00.000Z",
        template: true,
      }),
      makeRound({
        id: "installed-1",
        name: "Installed Source",
        createdAt: "2026-03-02T00:00:00.000Z",
      }),
    ];

    await renderInstalledRoundsPage();

    expect(screen.getAllByText("Template").length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: "Repair Template" }));
    fireEvent.change(screen.getAllByRole("combobox").at(-1)!, {
      target: { value: "installed-1" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Attach Source Media" }));

    await waitFor(() => {
      expect(mocks.db.round.repairTemplate).toHaveBeenCalledWith({
        roundId: "template-1",
        installedRoundId: "installed-1",
      });
    });
  });
});
