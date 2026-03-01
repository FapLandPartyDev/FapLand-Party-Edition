import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState, useMemo } from "react";
import { AnimatedBackground } from "../components/AnimatedBackground";
import { MenuButton } from "../components/MenuButton";
import { useHandy } from "../contexts/HandyContext";
import { useAppUpdate } from "../hooks/useAppUpdate";
import { useMenuNavigation, type MenuOption } from "../hooks/useMenuNavigation";
import { db, type InstallScanStatus } from "../services/db";
import { parseStandingsJson } from "../services/multiplayer/results";

const getVideos = async (): Promise<string[]> => {
  try {
    const resources = await db.resource.findMany();
    return resources.map((r) => r.videoUri);
  } catch (error) {
    console.error("Error fetching resources", error);
    return [];
  }
};

const getOverallHighscore = async (): Promise<number> => {
  try {
    const [localScore, cachedMatches] = await Promise.all([
      db.gameProfile.getLocalHighscore().catch(() => 0),
      db.multiplayer.listMatchCache(100).catch(() => []),
    ]);

    let maxRemote = 0;
    for (const match of cachedMatches) {
      const standings = parseStandingsJson(match.resultsJson);
      for (const row of standings) {
        if (row.finalScore > maxRemote) {
          maxRemote = row.finalScore;
        }
      }
    }

    return Math.max(localScore, maxRemote);
  } catch (error) {
    console.error("Error fetching overall highscore", error);
    return 0;
  }
};

export const Route = createFileRoute("/")(({
  loader: async () => {
    const [videos, overallHighscore] = await Promise.all([
      getVideos(),
      getOverallHighscore()
    ]);
    return { videos, overallHighscore };
  },
  component: Home,
}));

function HighscoreDisplay({ score }: { score: number }) {
  const [displayScore, setDisplayScore] = useState(0);

  useEffect(() => {
    if (score === 0) return;

    let startTimestamp: number | null = null;
    const duration = 1500; // 1.5 seconds

    const step = (timestamp: number) => {
      if (!startTimestamp) startTimestamp = timestamp;
      const progress = Math.min((timestamp - startTimestamp) / duration, 1);

      // easeOutExpo
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
    <div className="absolute top-6 left-6 z-20 animate-entrance-fade" style={{ animationDelay: "0.5s", animationDuration: "1s" }}>
      <div className="relative group overflow-hidden rounded-2xl border border-fuchsia-400/30 bg-black/40 p-4 backdrop-blur-md shadow-[0_0_20px_rgba(217,70,239,0.15)] transition-all duration-500 hover:border-fuchsia-400/60 hover:shadow-[0_0_30px_rgba(217,70,239,0.3)] hover:scale-105">
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-tr from-fuchsia-500/10 via-transparent to-transparent opacity-0 transition duration-500 group-hover:opacity-100" />
        <div className="flex flex-col items-start gap-1">
          <p className="font-[family-name:var(--font-jetbrains-mono)] text-[10px] uppercase tracking-[0.2em] text-fuchsia-200/80 drop-shadow-[0_0_5px_rgba(217,70,239,0.5)]">
            Global Best
          </p>
          <div className="flex items-baseline gap-1">
            <span className="text-3xl font-black text-transparent bg-clip-text bg-gradient-to-br from-white via-fuchsia-100 to-fuchsia-300 drop-shadow-[0_0_10px_rgba(217,70,239,0.8)] tabular-nums">
              {displayScore.toLocaleString()}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

function Home() {
  const { videos, overallHighscore } = Route.useLoaderData();
  const navigate = useNavigate();
  const [scanStatus, setScanStatus] = useState<InstallScanStatus | null>(null);
  const { connected, isConnecting, error, connectionKey, appApiKey } = useHandy();
  const appUpdate = useAppUpdate();

  const options: MenuOption[] = useMemo(
    () => [
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
      {
        id: "hardware",
        label: "Hardware / Connection",
        submenu: [
          {
            id: "connecthandy",
            label: "Connect TheHandy",
            action: () => navigate({ to: "/connect" }),
          },
        ],
      },
      {
        id: "update",
        label: appUpdate.actionLabel,
        primary: appUpdate.state.status === "update_available",
        badge: appUpdate.menuBadge,
        subLabel: appUpdate.state.latestVersion
          ? `Installed v${appUpdate.state.currentVersion} -> Latest v${appUpdate.state.latestVersion}`
          : `Installed v${appUpdate.state.currentVersion}`,
        statusTone: appUpdate.menuTone,
        action: () => {
          void appUpdate.triggerPrimaryAction();
        },
      },
    ],
    [appUpdate, navigate]
  );

  const { selectedIndex, handleMouseEnter, handleClick, currentOptions, depth, goBack } = useMenuNavigation(options);

  const handleFullscreenToggle = async () => {
    try {
      await window.electronAPI.window.toggleFullscreen();
    } catch (error) {
      console.error("Failed to toggle fullscreen", error);
    }
  };

  const handyLabel = !connectionKey.trim()
    ? "No Connection Key"
    : !appApiKey.trim()
      ? "No API Key"
      : isConnecting
        ? "Connecting"
        : connected
          ? "Connected"
          : error
            ? "Connection Error"
            : "Disconnected";

  const handyTone = connected
    ? "border-emerald-300/55 bg-emerald-500/20 text-emerald-100"
    : isConnecting
      ? "border-cyan-300/55 bg-cyan-500/20 text-cyan-100"
      : "border-amber-300/55 bg-amber-500/20 text-amber-100";
  const scanTone = scanStatus
    ? scanStatus.state === "running"
      ? "border-cyan-300/60 bg-cyan-500/20 text-cyan-100"
      : scanStatus.state === "error"
        ? "border-rose-300/60 bg-rose-500/20 text-rose-100"
        : "border-emerald-300/60 bg-emerald-500/20 text-emerald-100"
    : "border-zinc-500/60 bg-zinc-700/30 text-zinc-100";
  const scanStateLabel = scanStatus
    ? scanStatus.state === "running"
      ? "Running"
      : scanStatus.state === "error"
        ? "Error"
        : "Complete"
    : "Idle";
  const updateTone = appUpdate.state.status === "update_available"
    ? "border-amber-300/60 bg-amber-500/20 text-amber-100"
    : appUpdate.state.status === "up_to_date"
      ? "border-emerald-300/60 bg-emerald-500/20 text-emerald-100"
      : appUpdate.state.status === "error"
        ? "border-rose-300/60 bg-rose-500/20 text-rose-100"
        : "border-zinc-500/60 bg-zinc-700/30 text-zinc-100";
  const updateStateLabel = appUpdate.state.status === "checking"
    ? "Checking"
    : appUpdate.state.status === "update_available"
      ? "Out of Date"
      : appUpdate.state.status === "up_to_date"
        ? "Current"
        : appUpdate.state.status === "error"
          ? "Retry Needed"
          : "Idle";

  useEffect(() => {
    let mounted = true;

    const pollScanStatus = async () => {
      try {
        const status = await db.install.getScanStatus();
        if (mounted) {
          setScanStatus(status);
        }
      } catch (error) {
        console.error("Failed to poll install scan status", error);
      }
    };

    void pollScanStatus();
    const interval = window.setInterval(() => {
      void pollScanStatus();
    }, 2000);

    return () => {
      mounted = false;
      window.clearInterval(interval);
    };
  }, []);

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

  return (
    <div className="relative min-h-screen flex flex-col items-center justify-center select-none overflow-hidden">
      <AnimatedBackground videoUris={videos} />

      <HighscoreDisplay score={overallHighscore} />

      <main className="parallax-ui z-10 flex flex-col items-center w-full max-w-lg px-6 text-center">
        {/* ── Game Title ── */}
        <div className="relative h-32 mb-10 w-full flex justify-center animate-entrance-fade" style={{ animationDuration: "1.2s" }}>
          <div
            className="absolute top-0 flex flex-col items-center transition-all duration-500 ease-[cubic-bezier(0.16,1,0.3,1)]"
            style={{
              transform: depth > 0 ? 'scale(0.85) translateY(-10px)' : 'scale(1) translateY(0)',
              opacity: depth > 0 ? 0.6 : 1
            }}
          >
            {/* Eyebrow */}
            <p
              className="text-[0.65rem] sm:text-xs font-[family-name:var(--font-jetbrains-mono)] tracking-[0.6em] uppercase text-purple-400/70 mb-3 animate-entrance"
              style={{ animationDelay: "0.1s" }}
            >
              ✦ &nbsp; Party Edition &nbsp; ✦
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
              FAP LAND
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
                  selected={selectedIndex === index}
                  onHover={() => handleMouseEnter(index)}
                  onClick={() => handleClick(index)}
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
        <div className="rounded-xl border border-zinc-300/30 bg-zinc-900/35 p-4 backdrop-blur-md">
          <p className="mb-3 font-[family-name:var(--font-jetbrains-mono)] text-[10px] uppercase tracking-[0.18em] text-zinc-200/75">
            System
          </p>
          <div
            className={`mb-3 rounded-lg border px-3 py-2 font-[family-name:var(--font-jetbrains-mono)] text-[11px] uppercase tracking-[0.14em] ${handyTone}`}
          >
            TheHandy {handyLabel}
          </div>
          <div
            className={`rounded-lg border px-3 py-2 font-[family-name:var(--font-jetbrains-mono)] text-[11px] uppercase tracking-[0.14em] ${scanTone}`}
          >
            Library Scan {scanStateLabel}
            {scanStatus && (
              <>
                <div className="mt-2 text-[10px] tracking-[0.1em] text-current/90">
                  {scanStatus.stats.sidecarsSeen} scanned
                </div>
                <div className="mt-1 text-[10px] tracking-[0.1em] text-current/90">
                  {scanStatus.stats.installed + scanStatus.stats.updated} rounds processed
                </div>
              </>
            )}
          </div>
          <div
            className={`mt-3 rounded-lg border px-3 py-2 font-[family-name:var(--font-jetbrains-mono)] text-[11px] uppercase tracking-[0.14em] ${updateTone}`}
          >
            Update {updateStateLabel}
            <div className="mt-2 text-[10px] tracking-[0.1em] text-current/90">
              Installed v{appUpdate.state.currentVersion}
            </div>
            {appUpdate.state.latestVersion && (
              <div className="mt-1 text-[10px] tracking-[0.1em] text-current/90">
                Latest v{appUpdate.state.latestVersion}
              </div>
            )}
            <div className="mt-1 text-[10px] tracking-[0.1em] text-current/90 normal-case">
              {appUpdate.systemMessage}
            </div>
          </div>
        </div>
      </aside>

      {/* ── Footer ── */}
      <footer
        className="absolute bottom-6 font-[family-name:var(--font-jetbrains-mono)] text-xs text-zinc-600 z-10 tracking-widest animate-entrance-fade"
        style={{ animationDelay: "1.2s", animationDuration: "1.5s" }}
      >
        v{import.meta.env.VITE_APP_VERSION}-alpha &nbsp;•&nbsp; Early Access
      </footer>

      <button
        type="button"
        onClick={() => {
          void handleFullscreenToggle();
        }}
        className="absolute left-6 bottom-6 z-10 rounded-lg border border-zinc-600/70 bg-zinc-950/70 px-4 py-2 font-[family-name:var(--font-jetbrains-mono)] text-xs uppercase tracking-[0.2em] text-zinc-200 transition-colors hover:border-violet-300/60 hover:text-violet-100"
      >
        Fullscreen F11
      </button>

    </div>
  );
}
