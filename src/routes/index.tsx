import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { startTransition, useEffect, useMemo, useRef, useState } from "react";
import { AnimatedBackground } from "../components/AnimatedBackground";
import { MenuButton } from "../components/MenuButton";
import { openGlobalCommandPalette } from "../components/CommandPalette";
import { openGlobalHandyOverlay } from "../components/globalHandyOverlayControls";
import { openGlobalMusicOverlay } from "../components/globalMusicOverlayControls";
import { useControllerSurface } from "../controller";
import {
  MULTIPLAYER_MINIMUM_ROUNDS,
  MULTIPLAYER_SKIP_ROUNDS_CHECK_KEY,
} from "../constants/experimentalFeatures";
import { useHandy } from "../contexts/HandyContext";
import { useAppUpdate } from "../hooks/useAppUpdate";
import { useSfwMode } from "../hooks/useSfwMode";
import { useMenuNavigation, type MenuOption } from "../hooks/useMenuNavigation";
import { getAssistedTooltip, getSaveModeEmoji } from "../game/saveMode";
import { db } from "../services/db";
import { parseStandingsJson } from "../services/multiplayer/results";
import { trpc } from "../services/trpc";
import { LibraryStatusPoller } from "../features/library/components/LibraryStatusPoller";
import { PhashScanStatusPoller } from "../features/phash/components/PhashScanStatusPoller";
import { WebsiteVideoScanStatusPoller } from "../features/webVideo/components/WebsiteVideoScanStatusPoller";
import { abbreviateNsfwText } from "../utils/sfwText";
import "../styles.css";

const FIRST_START_COMPLETED_KEY = "app.firstStart.completed";

type OverallHighscore = {
  score: number;
  localCheatMode: boolean;
  localAssisted: boolean;
  localAssistedSaveMode: "checkpoint" | "everywhere" | null;
};

type HomeData = {
  videos: string[];
  overallHighscore: OverallHighscore;
  cumLoadCount: number;
  installedRoundCount: number;
  skipRoundsCheck: boolean;
};

const DEFAULT_HOME_DATA: HomeData = {
  videos: [],
  overallHighscore: {
    score: 0,
    localCheatMode: false,
    localAssisted: false,
    localAssistedSaveMode: null,
  },
  cumLoadCount: 0,
  installedRoundCount: 0,
  skipRoundsCheck: false,
};

let pendingHomeDataLoad: Promise<HomeData> | null = null;

const getVideos = async (): Promise<string[]> => {
  try {
    return await db.resource.findBackgroundVideos(6);
  } catch (error) {
    console.error("Error fetching resources", error);
    return [];
  }
};

const getOverallHighscore = async (): Promise<OverallHighscore> => {
  try {
    const [localResult, cachedMatches] = await Promise.all([
      db.gameProfile.getLocalHighscore().catch(() => ({
        highscore: 0,
        highscoreCheatMode: false,
        highscoreAssisted: false,
        highscoreAssistedSaveMode: null,
      })),
      db.multiplayer.listMatchCache(100).catch(() => []),
    ]);

    const localScore = typeof localResult === "number" ? localResult : localResult.highscore;
    const localCheatMode = typeof localResult === "number" ? false : localResult.highscoreCheatMode;
    const localAssisted =
      typeof localResult === "number" ? false : (localResult.highscoreAssisted ?? false);
    const localAssistedSaveMode =
      typeof localResult === "number" ? null : (localResult.highscoreAssistedSaveMode ?? null);

    let maxRemote = 0;
    for (const match of cachedMatches) {
      const standings = parseStandingsJson(match.resultsJson);
      for (const row of standings) {
        if (row.finalScore > maxRemote) {
          maxRemote = row.finalScore;
        }
      }
    }

    const bestScore = Math.max(localScore, maxRemote);
    const isFromLocal = localScore >= maxRemote;
    return {
      score: bestScore,
      localCheatMode: isFromLocal ? localCheatMode : false,
      localAssisted: isFromLocal ? localAssisted : false,
      localAssistedSaveMode: isFromLocal ? localAssistedSaveMode : null,
    };
  } catch (error) {
    console.error("Error fetching overall highscore", error);
    return { score: 0, localCheatMode: false, localAssisted: false, localAssistedSaveMode: null };
  }
};

const loadHomeData = async (): Promise<HomeData> => {
  if (!pendingHomeDataLoad) {
    pendingHomeDataLoad = Promise.all([
      getVideos(),
      getOverallHighscore(),
      db.singlePlayerHistory.getCumLoadCount().catch(() => 0),
      db.round.countInstalled().catch(() => 0),
      trpc.store.get.query({ key: MULTIPLAYER_SKIP_ROUNDS_CHECK_KEY }),
    ])
      .then(([videos, overallHighscore, cumLoadCount, installedRoundCount, rawSkipRoundsCheck]) => {
        const skipRoundsCheck =
          rawSkipRoundsCheck === true || rawSkipRoundsCheck === "true"
            ? true
            : rawSkipRoundsCheck === false || rawSkipRoundsCheck === "false"
              ? false
              : false;

        return { videos, overallHighscore, cumLoadCount, installedRoundCount, skipRoundsCheck };
      })
      .finally(() => {
        pendingHomeDataLoad = null;
      });
  }

  return pendingHomeDataLoad;
};

const Home = () => {
  const [homeData, setHomeData] = useState<HomeData>(DEFAULT_HOME_DATA);
  const navigate = useNavigate();
  const { connected, isConnecting, error, connectionKey } = useHandy();
  const appUpdate = useAppUpdate();
  const sfwModeEnabled = useSfwMode();
  const scopeRef = useRef<HTMLDivElement | null>(null);
  const { videos, overallHighscore, cumLoadCount, installedRoundCount, skipRoundsCheck } = homeData;

  useEffect(() => {
    let cancelled = false;

    void loadHomeData()
      .then((data) => {
        if (cancelled) return;

        startTransition(() => {
          setHomeData(data);
        });
      })
      .catch((error) => {
        console.error("Failed to load home screen data", error);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const options: MenuOption[] = useMemo(() => {
    const nextOptions: MenuOption[] = [
      {
        id: "play",
        label: "Play",
        primary: true,
        submenu: [
          {
            id: "singleplayer",
            label: "Single Player",
            primary: true,
            action: () => navigate({ to: "/single-player-setup" }),
          },
          {
            id: "multiplayer",
            label: "Multiplayer",
            experimental: true,
            disabled:
              sfwModeEnabled ||
              appUpdate.state.status === "update_available" ||
              (!skipRoundsCheck && installedRoundCount < MULTIPLAYER_MINIMUM_ROUNDS),
            subLabel: sfwModeEnabled
              ? "Blocked By SFW Mode"
              : appUpdate.state.status === "update_available"
                ? "Update Required"
                : !skipRoundsCheck && installedRoundCount < MULTIPLAYER_MINIMUM_ROUNDS
                  ? `${MULTIPLAYER_MINIMUM_ROUNDS} Rounds Required`
                  : undefined,
            action: () => navigate({ to: "/multiplayer" }),
          },
        ],
      },
      {
        id: "creation",
        label: "Creation & Workshop",
        submenu: [
          {
            id: "installedrounds",
            label: "Installed Rounds",
            action: () => navigate({ to: "/rounds" }),
          },
          {
            id: "converter",
            label: "Round Converter",
            action: () => navigate({ to: "/converter" }),
          },
          {
            id: "playlist-workshop",
            label: "Playlist Workshop",
            action: () => navigate({ to: "/playlist-workshop" }),
          },
          {
            id: "map-editor",
            label: "Map Editor",
            experimental: true,
            action: () => navigate({ to: "/map-editor" }),
          },
        ],
      },
      {
        id: "highscores",
        label: "Highscores",
        action: () => navigate({ to: "/highscores" }),
      },
      {
        id: "settings",
        label: "Settings",
        action: () => navigate({ to: "/settings" }),
      },
    ];

    if (appUpdate.state.status === "update_available") {
      nextOptions.push({
        id: "update",
        label: appUpdate.actionLabel,
        primary: true,
        badge: appUpdate.menuBadge,
        subLabel: appUpdate.state.latestVersion
          ? `Installed v${appUpdate.state.currentVersion} -> Latest v${appUpdate.state.latestVersion}`
          : `Installed v${appUpdate.state.currentVersion}`,
        statusTone: appUpdate.menuTone,
        action: () => {
          void appUpdate.triggerPrimaryAction();
        },
      });
    }

    nextOptions.push({
      id: "close",
      label: "Close",
      action: () => {
        void window.electronAPI.window.close();
      },
    });

    return nextOptions;
  }, [appUpdate, navigate, installedRoundCount, sfwModeEnabled, skipRoundsCheck]);

  const { selectedIndex, handleMouseEnter, handleClick, currentOptions, depth, goBack } =
    useMenuNavigation(options);

  const handleFullscreenToggle = async () => {
    try {
      await window.electronAPI.window.toggleFullscreen();
    } catch (error) {
      console.error("Failed to toggle fullscreen", error);
    }
  };

  const handyLabel = !connectionKey.trim()
    ? "No Connection Key"
    : isConnecting
      ? "Connecting"
      : connected
        ? "Connected"
        : error
          ? "Connection Error"
          : "Disconnected";
  const handyWarning = !connected && error ? error : null;

  const updateStateLabel =
    appUpdate.state.status === "checking"
      ? "Checking"
      : appUpdate.state.status === "update_available"
        ? "Out of Date"
        : appUpdate.state.status === "up_to_date"
          ? "Current"
          : appUpdate.state.status === "error"
            ? "Retry Needed"
            : "Idle";

  useEffect(() => {
    let cancelled = false;
    void trpc.store.get
      .query({ key: FIRST_START_COMPLETED_KEY })
      .then((value) => {
        if (cancelled || value === true) return;
        void navigate({ to: "/first-start", search: { returnTo: "menu" } });
      })
      .catch((loadError) => {
        console.error("Failed to read first-start workflow state", loadError);
      });

    return () => {
      cancelled = true;
    };
  }, [navigate]);

  // Construct options for rendering by appending "Back" if not at root
  const renderOptions = useMemo(() => {
    const list = [...currentOptions];
    if (depth > 0) {
      list.push({
        id: "back",
        label: "Back",
        action: goBack,
      });
    }
    return list;
  }, [currentOptions, depth, goBack]);

  useControllerSurface({
    id: "home-route",
    scopeRef,
    priority: 10,
    initialFocusId: renderOptions[0] ? `home-option-${renderOptions[0].id}` : undefined,
    onBack:
      depth > 0
        ? () => {
            goBack();
            return true;
          }
        : undefined,
  });

  return (
    <div
      ref={scopeRef}
      className="relative min-h-screen flex flex-col items-center justify-center select-none overflow-hidden"
    >
      <AnimatedBackground videoUris={videos} />

      <HighscoreDisplay
        score={overallHighscore.score}
        cheatMode={overallHighscore.localCheatMode}
        assisted={overallHighscore.localAssisted}
        assistedSaveMode={overallHighscore.localAssistedSaveMode}
        cumLoadCount={cumLoadCount}
        hideCumLoadCount={sfwModeEnabled}
      />

      <main className="parallax-ui z-10 flex flex-col items-center w-full max-w-lg px-6 text-center">
        {/* ── Game Title ── */}
        <div
          className="relative h-32 mb-10 w-full flex justify-center animate-entrance-fade"
          style={{ animationDuration: "1.2s" }}
        >
          <div
            className="absolute top-0 flex flex-col items-center transition-all duration-500 ease-[cubic-bezier(0.16,1,0.3,1)]"
            style={{
              transform: depth > 0 ? "scale(0.85) translateY(-10px)" : "scale(1) translateY(0)",
              opacity: depth > 0 ? 0.6 : 1,
            }}
          >
            {/* Eyebrow */}
            <p
              className="text-[0.65rem] sm:text-xs font-[family-name:var(--font-jetbrains-mono)] tracking-[0.6em] uppercase text-purple-400/70 mb-3 animate-entrance"
              style={{ animationDelay: "0.1s" }}
            >
              {sfwModeEnabled
                ? "✦ \u00a0 Safe Experience \u00a0 ✦"
                : "✦ \u00a0 Party Edition \u00a0 ✦"}
            </p>

            {/* Main title with animated shimmer gradient */}
            <h1
              className="text-7xl sm:text-8xl md:text-[5.25rem] font-black tracking-tighter leading-none cursor-default animate-title"
              style={{
                backgroundImage:
                  "linear-gradient(135deg, #e8d5ff 0%, #a78bfa 20%, #f5f3ff 40%, #818cf8 60%, #c4b5fd 80%, #f0f9ff 100%)",
                backgroundClip: "text",
                WebkitBackgroundClip: "text",
                WebkitTextFillColor: "transparent",
                filter:
                  "drop-shadow(0 0 40px rgba(139,92,246,0.5)) drop-shadow(0 0 80px rgba(139,92,246,0.2))",
                backgroundSize: "200% auto",
              }}
            >
              {sfwModeEnabled ? "SAFE MODE" : abbreviateNsfwText("FAP LAND", sfwModeEnabled)}
            </h1>

            {/* Decorative divider */}
            <div
              className="mt-4 mx-auto animate-entrance"
              style={{
                width: "120px",
                height: "2px",
                background:
                  "linear-gradient(to right, transparent, rgba(139,92,246,0.8), rgba(99,102,241,0.6), transparent)",
                animationDelay: "0.3s",
              }}
            />
          </div>
        </div>

        {/* ── Menu Options ── */}
        <div className="relative w-full">
          <div
            key={`menu-depth-${depth}`}
            className="flex flex-col gap-2 w-full animate-entrance"
            style={{ animationDuration: "0.4s" }}
          >
            {renderOptions.map((opt, index) => (
              <div
                key={opt.id}
                className="animate-entrance"
                style={{ animationDelay: `${0.1 + index * 0.05}s`, animationDuration: "0.3s" }}
              >
                <MenuButton
                  label={opt.label}
                  primary={opt.primary}
                  experimental={opt.experimental}
                  badge={opt.badge}
                  subLabel={opt.subLabel}
                  statusTone={opt.statusTone}
                  disabled={opt.disabled}
                  selected={selectedIndex === index}
                  onHover={() => handleMouseEnter(index)}
                  onClick={() => handleClick(index)}
                  controllerFocusId={`home-option-${opt.id}`}
                  controllerInitial={index === 0}
                  controllerBack={opt.id === "back"}
                />
              </div>
            ))}
          </div>
        </div>
      </main>

      <aside
        className="absolute right-6 top-1/2 z-10 hidden w-80 -translate-y-1/2 animate-entrance-fade lg:block"
        style={{ animationDelay: "0.8s", animationDuration: "1.2s" }}
      >
        <div className="rounded-2xl border border-white/10 bg-gradient-to-br from-zinc-900/30 via-zinc-900/25 to-zinc-800/20 p-3 backdrop-blur-xl shadow-2xl">
          <div className="mb-2 flex items-center gap-2">
            <div className="h-px flex-1 bg-gradient-to-r from-transparent via-violet-400/40 to-transparent" />
            <p className="font-[family-name:var(--font-jetbrains-mono)] text-[9px] uppercase tracking-[0.18em] text-violet-200/80 font-semibold">
              System
            </p>
            <div className="h-px flex-1 bg-gradient-to-r from-transparent via-violet-400/40 to-transparent" />
          </div>

          <div className="space-y-1.5">
            <div className="rounded-lg border border-indigo-300/20 bg-indigo-950/8 px-3 py-1.5 backdrop-blur-sm">
              <div className="flex items-center gap-1.5 mb-1">
                <span className="text-indigo-300/80 text-[8px]">◆</span>
                <p className="font-[family-name:var(--font-jetbrains-mono)] text-[9px] uppercase tracking-[0.14em] text-indigo-200/70 font-medium">
                  Program Version
                </p>
              </div>
              <div className="pl-3.5 space-y-0">
                <div className="font-[family-name:var(--font-jetbrains-mono)] text-[10px] tracking-wide text-indigo-100/90">
                  v{import.meta.env.VITE_APP_VERSION}
                </div>
                <div className="font-[family-name:var(--font-jetbrains-mono)] text-[9px] tracking-wide text-indigo-200/60">
                  Early Access
                </div>
              </div>
            </div>

            <div
              className={`rounded-lg border px-3 py-1.5 backdrop-blur-sm transition-all duration-300 ${
                connected
                  ? "border-emerald-400/30 bg-emerald-950/8"
                  : isConnecting
                    ? "border-cyan-400/30 bg-cyan-950/8"
                    : "border-amber-400/30 bg-amber-950/8"
              }`}
            >
              <div className="flex items-center gap-1.5 mb-1">
                <span
                  className={`text-[8px] ${
                    connected
                      ? "text-emerald-300/80"
                      : isConnecting
                        ? "text-cyan-300/80 animate-pulse"
                        : "text-amber-300/80"
                  }`}
                >
                  ◆
                </span>
                <p
                  className={`font-[family-name:var(--font-jetbrains-mono)] text-[9px] uppercase tracking-[0.14em] font-medium ${
                    connected
                      ? "text-emerald-200/70"
                      : isConnecting
                        ? "text-cyan-200/70"
                        : "text-amber-200/70"
                  }`}
                >
                  TheHandy
                </p>
              </div>
              <div className="pl-3.5">
                <div
                  className={`font-[family-name:var(--font-jetbrains-mono)] text-[10px] tracking-wide ${
                    connected
                      ? "text-emerald-100/90"
                      : isConnecting
                        ? "text-cyan-100/90"
                        : "text-amber-100/90"
                  }`}
                >
                  {handyLabel}
                </div>
                {handyWarning && (
                  <div
                    className={`mt-0.5 font-[family-name:var(--font-jetbrains-mono)] text-[9px] tracking-wide normal-case ${
                      connected
                        ? "text-emerald-200/60"
                        : isConnecting
                          ? "text-cyan-200/60"
                          : "text-amber-200/60"
                    }`}
                  >
                    {handyWarning}
                  </div>
                )}
              </div>
            </div>

            <LibraryStatusPoller />

            <PhashScanStatusPoller />

            <WebsiteVideoScanStatusPoller />

            <div
              className={`rounded-lg border px-3 py-1.5 backdrop-blur-sm transition-all duration-300 ${
                appUpdate.state.status === "update_available"
                  ? "border-amber-400/30 bg-amber-950/8"
                  : appUpdate.state.status === "up_to_date"
                    ? "border-emerald-400/30 bg-emerald-950/8"
                    : appUpdate.state.status === "error"
                      ? "border-rose-400/30 bg-rose-950/8"
                      : "border-zinc-400/20 bg-zinc-950/8"
              }`}
            >
              <div className="flex items-center gap-1.5 mb-1">
                <span
                  className={`text-[8px] ${
                    appUpdate.state.status === "update_available"
                      ? "text-amber-300/80"
                      : appUpdate.state.status === "up_to_date"
                        ? "text-emerald-300/80"
                        : appUpdate.state.status === "error"
                          ? "text-rose-300/80"
                          : "text-zinc-300/80"
                  }`}
                >
                  ◆
                </span>
                <p
                  className={`font-[family-name:var(--font-jetbrains-mono)] text-[9px] uppercase tracking-[0.14em] font-medium ${
                    appUpdate.state.status === "update_available"
                      ? "text-amber-200/70"
                      : appUpdate.state.status === "up_to_date"
                        ? "text-emerald-200/70"
                        : appUpdate.state.status === "error"
                          ? "text-rose-200/70"
                          : "text-zinc-200/70"
                  }`}
                >
                  Update Status
                </p>
              </div>
              <div className="pl-3.5 space-y-0">
                <div
                  className={`font-[family-name:var(--font-jetbrains-mono)] text-[10px] tracking-wide ${
                    appUpdate.state.status === "update_available"
                      ? "text-amber-100/90"
                      : appUpdate.state.status === "up_to_date"
                        ? "text-emerald-100/90"
                        : appUpdate.state.status === "error"
                          ? "text-rose-100/90"
                          : "text-zinc-100/90"
                  }`}
                >
                  {updateStateLabel}
                </div>
                <div
                  className={`font-[family-name:var(--font-jetbrains-mono)] text-[9px] tracking-wide ${
                    appUpdate.state.status === "update_available"
                      ? "text-amber-200/60"
                      : appUpdate.state.status === "up_to_date"
                        ? "text-emerald-200/60"
                        : appUpdate.state.status === "error"
                          ? "text-rose-200/60"
                          : "text-zinc-200/60"
                  }`}
                >
                  Installed v{appUpdate.state.currentVersion}
                </div>
                {appUpdate.state.latestVersion && (
                  <div
                    className={`font-[family-name:var(--font-jetbrains-mono)] text-[9px] tracking-wide ${
                      appUpdate.state.status === "update_available"
                        ? "text-amber-200/60"
                        : appUpdate.state.status === "up_to_date"
                          ? "text-emerald-200/60"
                          : appUpdate.state.status === "error"
                            ? "text-rose-200/60"
                            : "text-zinc-200/60"
                    }`}
                  >
                    Latest v{appUpdate.state.latestVersion}
                  </div>
                )}
                {appUpdate.systemMessage && (
                  <div
                    className={`mt-0.5 font-[family-name:var(--font-jetbrains-mono)] text-[9px] tracking-wide normal-case ${
                      appUpdate.state.status === "update_available"
                        ? "text-amber-200/60"
                        : appUpdate.state.status === "up_to_date"
                          ? "text-emerald-200/60"
                          : appUpdate.state.status === "error"
                            ? "text-rose-200/60"
                            : "text-zinc-200/60"
                    }`}
                  >
                    {appUpdate.systemMessage}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </aside>

      <div className="absolute left-6 bottom-6 z-10 flex items-center gap-2 font-[family-name:var(--font-jetbrains-mono)] text-[10px] uppercase tracking-[0.15em] text-zinc-500 transition-colors">
        <button
          type="button"
          onClick={() => {
            openGlobalCommandPalette();
          }}
          className="transition-colors hover:text-zinc-300"
          data-controller-focus-id="home-command-palette"
        >
          ⌘K
        </button>
        <span className="text-zinc-700">·</span>
        <button
          type="button"
          onClick={() => {
            openGlobalHandyOverlay();
          }}
          className="transition-colors hover:text-zinc-300"
          data-controller-focus-id="home-handy"
        >
          Handy
        </button>
        <span className="text-zinc-700">·</span>
        <button
          type="button"
          onClick={() => {
            openGlobalMusicOverlay();
          }}
          className="transition-colors hover:text-zinc-300"
          data-controller-focus-id="home-music"
        >
          Music
        </button>
        <span className="text-zinc-700">·</span>
        <button
          type="button"
          onClick={() => {
            void handleFullscreenToggle();
          }}
          className="transition-colors hover:text-zinc-300"
          data-controller-focus-id="home-fullscreen"
        >
          F11
        </button>
      </div>
    </div>
  );
};

export const Route = createFileRoute("/")({
  component: Home,
});

function HighscoreDisplay({
  score,
  cheatMode,
  assisted,
  assistedSaveMode,
  cumLoadCount,
  hideCumLoadCount,
}: {
  score: number;
  cheatMode?: boolean;
  assisted?: boolean;
  assistedSaveMode?: "checkpoint" | "everywhere" | null;
  cumLoadCount: number;
  hideCumLoadCount?: boolean;
}) {
  const [displayScore, setDisplayScore] = useState(0);

  useEffect(() => {
    if (score === 0) return;

    let startTimestamp: number | null = null;
    const duration = 1500;

    const step = (timestamp: number) => {
      if (!startTimestamp) startTimestamp = timestamp;
      const progress = Math.min((timestamp - startTimestamp) / duration, 1);

      const easing = progress === 1 ? 1 : 1 - Math.pow(2, -10 * progress);

      setDisplayScore(Math.floor(easing * score));

      if (progress < 1) {
        window.requestAnimationFrame(step);
      }
    };

    window.requestAnimationFrame(step);
  }, [score]);

  if (score === 0) return null;

  return (
    <div
      className="absolute top-6 left-6 z-20 animate-entrance-fade"
      style={{ animationDelay: "0.5s", animationDuration: "1s" }}
    >
      <div
        className="flex flex-col items-start gap-0.5"
        title={
          cheatMode
            ? "This highscore was achieved with cheat mode active"
            : assisted
              ? getAssistedTooltip(assistedSaveMode)
              : undefined
        }
      >
        <p className="font-[family-name:var(--font-jetbrains-mono)] text-[9px] uppercase tracking-[0.18em] text-zinc-500">
          Best
        </p>
        <div className="flex items-baseline gap-1">
          <span className="font-[family-name:var(--font-jetbrains-mono)] text-sm font-semibold tabular-nums text-zinc-300">
            {displayScore.toLocaleString()}
          </span>
          {cheatMode && (
            <span
              className="text-xs cursor-help"
              title="This highscore was achieved with cheat mode active"
            >
              🎭
            </span>
          )}
          {assisted && assistedSaveMode && (
            <span className="text-xs cursor-help" title={getAssistedTooltip(assistedSaveMode)}>
              {getSaveModeEmoji(assistedSaveMode)}
            </span>
          )}
        </div>
        {!hideCumLoadCount && (
          <p className="font-[family-name:var(--font-jetbrains-mono)] text-[9px] tracking-wide text-zinc-600">
            {abbreviateNsfwText(
              `${cumLoadCount.toLocaleString()} total`,
              Boolean(hideCumLoadCount)
            )}
          </p>
        )}
      </div>
    </div>
  );
}
