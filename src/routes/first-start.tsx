import { Trans, useLingui } from "@lingui/react/macro";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { AnimatedBackground } from "../components/AnimatedBackground";
import { BACKGROUND_VIDEO_ENABLED_KEY } from "../constants/backgroundSettings";
import { DEFAULT_INTERMEDIARY_LOADING_PROMPT } from "../constants/booruSettings";
import { EROSCRIPTS_CACHE_ROOT_PATH_KEY } from "../constants/eroscriptsSettings";
import type { EroScriptsLoginStatus } from "../services/eroscripts";
import {
  DEFAULT_INTIFACE_WEBSOCKET_URL,
  DEFAULT_TCODE_BAUD_RATE,
  DEFAULT_TCODE_UDP_HOST,
  DEFAULT_TCODE_UDP_PORT,
  DEFAULT_TCODE_WEBSOCKET_HOST,
  DEFAULT_TCODE_WEBSOCKET_URL,
} from "../constants/haptics";
import {
  normalizeTCodeUdpInput,
  normalizeTCodeWebSocketInput,
} from "../services/haptics/tcodeConfig";
import type { TCodePrecision, TCodeTransportKind } from "../services/haptics/types";
import { FPACK_EXTRACTION_PATH_KEY } from "../constants/fpackSettings";
import {
  DEFAULT_MENU_THEME_ID,
  MAIN_MENU_THEMES,
  MENU_THEME_CHANGED_EVENT,
  MENU_THEME_KEY,
  normalizeMainMenuThemeId,
  type MainMenuThemeId,
} from "../constants/menuThemeSettings";
import { MUSIC_CACHE_ROOT_PATH_KEY } from "../constants/musicSettings";
import {
  BACKGROUND_PHASH_ROUNDS_PER_PASS_KEY,
  BACKGROUND_PHASH_SCANNING_ENABLED_KEY,
  DEFAULT_BACKGROUND_PHASH_ROUNDS_PER_PASS,
  DEFAULT_BACKGROUND_PHASH_SCANNING_ENABLED,
  DEFAULT_PREVIEW_FFMPEG_SINGLE_THREAD_ENABLED,
  MAX_BACKGROUND_PHASH_ROUNDS_PER_PASS,
  MIN_BACKGROUND_PHASH_ROUNDS_PER_PASS,
  normalizeBackgroundPhashScanningEnabled,
  normalizeBackgroundPhashRoundsPerPass,
  normalizePreviewFfmpegSingleThreadEnabled,
  PREVIEW_FFMPEG_SINGLE_THREAD_ENABLED_KEY,
} from "../constants/phashSettings";
import { WEBSITE_VIDEO_CACHE_ROOT_PATH_KEY } from "../constants/websiteVideoCacheSettings";
import { useHandy } from "../contexts/HandyContext";
import { useGameplayMoaning } from "../hooks/useGameplayMoaning";
import { useGlobalMusic } from "../hooks/useGlobalMusic";
import { useSfwMode } from "../hooks/useSfwMode";
import { db } from "../services/db";
import { acquisition } from "../services/acquisition";
import { importOpenedFile } from "../services/openedFiles";
import { trpc } from "../services/trpc";
import { playHoverSound, playSelectSound } from "../utils/audio";
import { abbreviateNsfwText } from "../utils/sfwText";
import { formatStoragePathDisplay, isStoragePathResettable } from "../utils/storagePath";
import { i18n } from "../i18n";
import { useLocale } from "../i18n/useLocale";
import "./first-start.css";

const PORTABLE_DEFAULTS: ReadonlyMap<string, string> = new Map([
  [WEBSITE_VIDEO_CACHE_ROOT_PATH_KEY, "web-video-cache"],
  [MUSIC_CACHE_ROOT_PATH_KEY, "music-cache"],
  [EROSCRIPTS_CACHE_ROOT_PATH_KEY, "eroscripts-cache"],
  [FPACK_EXTRACTION_PATH_KEY, "fpacks"],
  ["acquisition.downloadRootPath", "acquisition-downloads"],
]);

const FIRST_START_COMPLETED_KEY = "app.firstStart.completed";
const INTERMEDIARY_LOADING_PROMPT_KEY = "game.intermediary.loadingPrompt";

type ReturnTarget = "menu" | "settings";

function normalizeReturnTarget(value: unknown): ReturnTarget {
  return value === "settings" ? "settings" : "menu";
}

type StepDefinition = {
  id: string;
  icon: string;
  interactive?:
    | "language"
    | "music"
    | "moaning"
    | "round-packs"
    | "storage"
    | "booru"
    | "handy"
    | "phash"
    | "eroscripts";
};

function getSteps(): StepDefinition[] {
  return [
    {
      id: "welcome",
      icon: "🎮",
      interactive: "language",
    },
    {
      id: "heroes",
      icon: "📦",
    },
    {
      id: "music",
      icon: "🎵",
      interactive: "music",
    },
    {
      id: "moaning",
      icon: "🔊",
      interactive: "moaning",
    },
    {
      id: "round-packs",
      icon: "💿",
      interactive: "round-packs",
    },
    {
      id: "eroscripts",
      icon: "🔗",
      interactive: "eroscripts",
    },
    {
      id: "maps",
      icon: "🗺️",
    },
    {
      id: "storage",
      icon: "🗄️",
      interactive: "storage",
    },
    {
      id: "phash",
      icon: "🐢",
      interactive: "phash",
    },
    {
      id: "handy",
      icon: "🔌",
      interactive: "handy",
    },
    {
      id: "booru",
      icon: "🔍",
      interactive: "booru",
    },
  ];
}

function getStepShortLabel(id: string): string {
  switch (id) {
    case "welcome":
      return i18n._({ id: "first-start.step.welcome.shortLabel", message: "Welcome" });
    case "heroes":
      return i18n._({ id: "first-start.step.heroes.shortLabel", message: "Content" });
    case "music":
      return i18n._({ id: "first-start.step.music.shortLabel", message: "Music" });
    case "moaning":
      return i18n._({ id: "first-start.step.moaning.shortLabel", message: "Moaning" });
    case "round-packs":
      return i18n._({ id: "first-start.step.round-packs.shortLabel", message: "Rounds" });
    case "eroscripts":
      return i18n._({ id: "first-start.step.eroscripts.shortLabel", message: "EroScripts" });
    case "maps":
      return i18n._({ id: "first-start.step.maps.shortLabel", message: "Maps" });
    case "storage":
      return i18n._({ id: "first-start.step.storage.shortLabel", message: "Storage" });
    case "phash":
      return i18n._({ id: "first-start.step.phash.shortLabel", message: "Performance" });
    case "handy":
      return i18n._({ id: "first-start.step.handy.shortLabel", message: "Hardware" });
    case "booru":
      return i18n._({ id: "first-start.step.booru.shortLabel", message: "Media" });
    default:
      return id;
  }
}

function getStepEyebrow(id: string): string {
  switch (id) {
    case "welcome":
      return i18n._({ id: "first-start.step.welcome.eyebrow", message: "Start Here" });
    case "heroes":
      return i18n._({ id: "first-start.step.heroes.eyebrow", message: "Content" });
    case "maps":
      return i18n._({ id: "first-start.step.maps.eyebrow", message: "Creation" });
    case "phash":
      return i18n._({ id: "first-start.step.phash.eyebrow", message: "Performance" });
    case "handy":
      return i18n._({ id: "first-start.step.handy.eyebrow", message: "Hardware" });
    case "booru":
      return i18n._({
        id: "first-start.step.booru.eyebrow",
        message: "Intermediary Media",
      });
    case "music":
    case "moaning":
    case "round-packs":
    case "storage":
    case "eroscripts":
      return i18n._({
        id: "first-start.step.optional-setup.eyebrow",
        message: "Optional Setup",
      });
    default:
      return "";
  }
}

function getStepTitle(id: string): string {
  switch (id) {
    case "welcome":
      return i18n._({
        id: "first-start.step.welcome.title",
        message: "What Fap Land Party Edition is and how the two play modes work",
      });
    case "heroes":
      return i18n._({
        id: "first-start.step.heroes.title",
        message: "How to add fap or cock heroes and round content",
      });
    case "music":
      return i18n._({
        id: "first-start.step.music.title",
        message: "Install some music for the menus and downtime",
      });
    case "moaning":
      return i18n._({
        id: "first-start.step.moaning.title",
        message: "Set up gameplay moaning so moaning perks actually have content",
      });
    case "round-packs":
      return i18n._({
        id: "first-start.step.round-packs.title",
        message: "Install some round packs now",
      });
    case "eroscripts":
      return i18n._({
        id: "first-start.step.eroscripts.title",
        message: "Connect your EroScripts account",
      });
    case "maps":
      return i18n._({
        id: "first-start.step.maps.title",
        message: "Linear maps, graph maps, and their two editors",
      });
    case "storage":
      return i18n._({
        id: "first-start.step.storage.title",
        message: "Choose where cached and extracted files should live",
      });
    case "phash":
      return i18n._({
        id: "first-start.step.phash.title",
        message: "Tune background media work for your hardware",
      });
    case "handy":
      return i18n._({
        id: "first-start.step.handy.title",
        message: "Connecting a haptics device",
      });
    case "booru":
      return i18n._({
        id: "first-start.step.booru.title",
        message: "Choose a booru search prompt",
      });
    default:
      return id;
  }
}

function getStepDescription(id: string): string {
  switch (id) {
    case "welcome":
      return i18n._({
        id: "first-start.step.welcome.description",
        message:
          "Fap Land Party Edition is a board-game style app. You move across a map, trigger rounds, and try to finish with a strong score and a good run.",
      });
    case "heroes":
      return i18n._({
        id: "first-start.step.heroes.description",
        message:
          "Heroes and rounds are the content packs the game uses during play. If you do not add any, the game has very little to work with.",
      });
    case "music":
      return i18n._({
        id: "first-start.step.music.description",
        message:
          "Music is optional, but it makes the app feel much more alive. Fap Land Party Edition can keep a global music queue running while you move through menus.",
      });
    case "moaning":
      return i18n._({
        id: "first-start.step.moaning.description",
        message:
          "Gameplay moaning is optional, but some perks and anti-perks use it. If you want those effects to do something, add a few moaning files now.",
      });
    case "round-packs":
      return i18n._({
        id: "first-start.step.round-packs.description",
        message:
          "Round packs are the gameplay library. This is the content the board pulls from when a round starts.",
      });
    case "eroscripts":
      return i18n._({
        id: "first-start.step.eroscripts.description",
        message:
          "EroScripts is the community hub for funscripts and interactive content. Sign in to search and download funscripts and videos directly.",
      });
    case "maps":
      return i18n._({
        id: "first-start.step.maps.description",
        message:
          "Fap Land Party Edition supports two board styles, because not every run should feel the same.",
      });
    case "storage":
      return i18n._({
        id: "first-start.step.storage.description",
        message:
          "You can keep the default app-managed folders, or point storage-heavy features at custom locations now.",
      });
    case "phash":
      return i18n._({
        id: "first-start.step.phash.description",
        message:
          "The app can compute visual fingerprints in the background to improve round matching. On weaker hardware, lower the pass size or disable it.",
      });
    case "handy":
      return i18n._({
        id: "first-start.step.handy.description",
        message:
          "Connect a haptics device for synchronized motion support. TheHandy, Intiface, and TCode are available. This is optional but enhances the experience.",
      });
    case "booru":
      return i18n._({
        id: "first-start.step.booru.description",
        message:
          "Fap Land Party Edition can use a booru search prompt for intermediary loading media. If you do nothing, the default prompt stays in place.",
      });
    default:
      return "";
  }
}

function getLocaleCardDescription(locale: string): string {
  switch (locale) {
    case "de":
      return i18n._({ id: "first-start.language-option.de", message: "German interface" });
    case "es":
      return i18n._({ id: "first-start.language-option.es", message: "Spanish interface" });
    case "fr":
      return i18n._({ id: "first-start.language-option.fr", message: "French interface" });
    case "zh":
      return i18n._({ id: "first-start.language-option.zh", message: "Chinese interface" });
    default:
      return i18n._({ id: "first-start.language-option.en", message: "English interface" });
  }
}

function getStepDetails(id: string): string[] {
  switch (id) {
    case "welcome":
      return [
        i18n._({
          id: "first-start.step.welcome.detail.1",
          message:
            "Fap and cockheroes are like guitarhero for your dick. You masturbate up AND down per beat. When a beat hits, you are down at the shaft. Normally there is a beatbar. You can also automate this using thehandy",
        }),
        i18n._({
          id: "first-start.step.welcome.detail.2",
          message:
            "Singleplayer is the solo mode. You build or choose a playlist, play alone, and try to survive the board, clear rounds, and push your personal highscore as far as you can.",
        }),
        i18n._({
          id: "first-start.step.welcome.detail.3",
          message:
            "Multiplayer is the shared mode. Several players run the same board setup and compare how well they do. The goal is to outscore the other players and finish the match in a better state than they do.",
        }),
        i18n._({
          id: "first-start.step.welcome.detail.4",
          message:
            "Both modes use rounds as the core content. The board decides what happens next, and your choices change how risky or rewarding the run becomes.",
        }),
      ];
    case "heroes":
      return [
        i18n._({
          id: "first-start.step.heroes.detail.1",
          message:
            "You can import a single `.hero` or `.round` file. That is the direct way to add one hero or one round pack at a time.",
        }),
        i18n._({
          id: "first-start.step.heroes.detail.2",
          message:
            "You can also add a whole folder as a source. Fap Land Party Edition scans that folder right away, imports what it understands, and checks it again on later app starts.",
        }),
        i18n._({
          id: "first-start.step.heroes.detail.3",
          message:
            "Imported content shows up in Installed Rounds. From there you can review what was added, edit metadata, and use the rounds in playlists and maps.",
        }),
        i18n._({
          id: "first-start.step.heroes.detail.4",
          message:
            "Making your own packs is also pretty easy. You can use the Round Converter to turn source material into playable rounds, then organize them with the Playlist Workshop or Map Editor.",
        }),
        i18n._({
          id: "first-start.step.heroes.detail.5",
          message:
            "Exporting your own work is meant to be simple too. Once your rounds or playlists are ready, the app gives you direct export paths so sharing packs is not a complicated process.",
        }),
      ];
    case "music":
      return [
        i18n._({
          id: "first-start.step.music.detail.1",
          message:
            "Music does not replace your round videos. It is background audio for the app when no foreground video is actively playing.",
        }),
        i18n._({
          id: "first-start.step.music.detail.2",
          message:
            "You can add normal audio files from your computer. The game stores them in a queue, and you can reorder or remove them later in Settings.",
        }),
        i18n._({
          id: "first-start.step.music.detail.3",
          message: "If you want, you can skip this now and come back later.",
        }),
      ];
    case "moaning":
      return [
        i18n._({
          id: "first-start.step.moaning.detail.1",
          message:
            "The moaning library is separate from menu music. It is used by gameplay events that trigger one-shot or looping moaning audio.",
        }),
        i18n._({
          id: "first-start.step.moaning.detail.2",
          message:
            "You can add local audio files from your computer or download supported URLs through yt-dlp.",
        }),
        i18n._({
          id: "first-start.step.moaning.detail.3",
          message:
            "If you skip this, moaning-related gameplay effects stay unavailable until you add files later in Settings.",
        }),
      ];
    case "round-packs":
      return [
        i18n._({
          id: "first-start.step.round-packs.detail.1",
          message:
            "Adding a folder is best when you already keep your packs together in one place. The app scans the folder and imports supported content.",
        }),
        i18n._({
          id: "first-start.step.round-packs.detail.2",
          message:
            "Importing a single file is better when someone sent you one `.hero` or `.round` file and you just want that item.",
        }),
        i18n._({
          id: "first-start.step.round-packs.detail.3",
          message:
            "You can install content now, or skip this and manage it later from Installed Rounds or Settings.",
        }),
      ];
    case "eroscripts":
      return [
        i18n._({
          id: "first-start.step.eroscripts.detail.1",
          message:
            "EroScripts is where the funscript community shares interactive scripts and videos. Signing in lets you search and download funscripts and videos without leaving the app.",
        }),
        i18n._({
          id: "first-start.step.eroscripts.detail.2",
          message:
            "If you do not have an account yet, you can create one for free on the EroScripts website. It only takes a moment.",
        }),
        i18n._({
          id: "first-start.step.eroscripts.detail.3",
          message:
            "You can skip this for now and set up the EroScripts connection later in Settings under Sources.",
        }),
      ];
    case "maps":
      return [
        i18n._({
          id: "first-start.step.maps.detail.1",
          message:
            "A linear map is a straight path. It is easier to understand, quicker to build, and good when you want a classic start-to-finish run.",
        }),
        i18n._({
          id: "first-start.step.maps.detail.2",
          message:
            "A graph map is a branching board with nodes and connections. It gives you more control, more choice, and more advanced route design.",
        }),
        i18n._({
          id: "first-start.step.maps.detail.3",
          message:
            "Because those two map styles work differently, the app has two editors: Playlist Workshop for linear boards, and Map Editor for graph boards.",
        }),
        i18n._({
          id: "first-start.step.maps.detail.4",
          message:
            "If you want to build your own pack, the usual flow is simple: create rounds in the Round Converter, place them into a linear or graph board, then export the finished result.",
        }),
        i18n._({
          id: "first-start.step.maps.detail.5",
          message:
            "That means you do not need a hard workflow to start making content. The converter, the editors, and the export tools are built so custom pack creation stays approachable.",
        }),
      ];
    case "storage":
      return [
        i18n._({
          id: "first-start.step.storage.detail.1",
          message: "Music cache stores downloaded menu music and YouTube imports.",
        }),
        i18n._({
          id: "first-start.step.storage.detail.2",
          message:
            "Website video cache stores downloaded website videos and related playback files.",
        }),
        i18n._({
          id: "first-start.step.storage.detail.3",
          message:
            ".fpack extraction location stores extracted pack contents in a persistent folder so those rounds stay playable later.",
        }),
        i18n._({
          id: "first-start.step.storage.detail.4",
          message:
            "EroScripts extraction location stores videos and funscripts extracted from .fpack files for the EroScripts service.",
        }),
        i18n._({
          id: "first-start.step.storage.detail.5",
          message:
            "You can skip this and change any of these later in Settings under Data & Storage.",
        }),
      ];
    case "phash":
      return [
        i18n._({
          id: "first-start.step.phash.detail.1",
          message:
            "Background pHash scanning helps the app recognize visually similar rounds and imported content more accurately.",
        }),
        i18n._({
          id: "first-start.step.phash.detail.2",
          message:
            "If your computer is older or already struggles during startup, reduce rounds per pass, enable single-thread previews, or turn off background hashing.",
        }),
        i18n._({
          id: "first-start.step.phash.detail.3",
          message: "You can change this later in Settings under Data & Storage.",
        }),
      ];
    case "handy":
      return [
        i18n._({
          id: "first-start.step.handy.detail.1",
          message:
            "You can connect a Handy device using its connection key, or use Intiface to connect any Buttplug-compatible linear/position or vibration device.",
        }),
        i18n._({
          id: "first-start.step.handy.detail.2",
          message:
            "If you do not own a compatible device, skip this step. You can still use the app and play the game without hardware.",
        }),
        i18n._({
          id: "first-start.step.handy.detail.3",
          message: "You can always connect or change settings later in Settings > Hardware & Sync.",
        }),
      ];
    case "booru":
      return [
        i18n._({
          id: "first-start.step.booru.detail.1",
          message:
            "This prompt tells the app what kind of media it should look for during loading and intermediary moments.",
        }),
        i18n._({
          id: "first-start.step.booru.detail.2",
          message:
            "A simple, specific prompt usually works better than a long one. You can keep the default if you are unsure.",
        }),
        i18n._({
          id: "first-start.step.booru.detail.3",
          message: "You can change this later in Settings under Gameplay.",
        }),
      ];
    default:
      return [];
  }
}

export const Route = createFileRoute("/first-start")({
  validateSearch: (search: Record<string, unknown>) => ({
    returnTo: normalizeReturnTarget(search.returnTo),
  }),
  component: FirstStartPage,
});

function FirstStartPage() {
  const { t } = useLingui();
  const { locale, locales, setLocale } = useLocale();
  const STEPS = getSteps();
  const sfwMode = useSfwMode();
  const navigate = useNavigate();
  const search = Route.useSearch();
  const { queue, addTracks, addTrackFromUrl, addPlaylistFromUrl } = useGlobalMusic();
  const {
    enabled: moaningEnabled,
    queue: moaningQueue,
    setEnabled: setMoaningEnabled,
    addTracks: addMoaningTracks,
    addTrackFromUrl: addMoaningTrackFromUrl,
    addPlaylistFromUrl: addMoaningPlaylistFromUrl,
    previewTrack: previewMoaningTrack,
    stopPreview: stopMoaningPreview,
  } = useGameplayMoaning();
  const {
    connectionKey,
    connected: handyConnected,
    isConnecting: handyIsConnecting,
    error: handyError,
    provider: handyProvider,
    setProvider: setHandyProvider,
    intifaceWebsocketUrl,
    intifaceDeviceName,
    tcodeWebsocketHost,
    tcodeWebsocketUrl,
    tcodeUdpHost,
    tcodeTransport,
    tcodeSerialPath,
    tcodeBaudRate,
    tcodePrecision,
    tcodeSerialPorts,
    tcodeSerialPortsLoading,
    connect: handyConnect,
    connectIntiface: handyConnectIntiface,
    connectTCode: handyConnectTCode,
    disconnect: handyDisconnect,
    refreshTCodeSerialPorts,
  } = useHandy();
  const [stepIndex, setStepIndex] = useState(0);
  const [isBusy, setIsBusy] = useState(false);
  const [musicMessage, setMusicMessage] = useState<string | null>(null);
  const [showUrlInput, setShowUrlInput] = useState(false);
  const [urlInput, setUrlInput] = useState("");
  const [urlError, setUrlError] = useState<string | null>(null);
  const [roundMessage, setRoundMessage] = useState<string | null>(null);
  const [moaningMessage, setMoaningMessage] = useState<string | null>(null);
  const [showMoaningUrlInput, setShowMoaningUrlInput] = useState(false);
  const [moaningUrlInput, setMoaningUrlInput] = useState("");
  const [moaningUrlError, setMoaningUrlError] = useState<string | null>(null);
  const [moaningUrlMode, setMoaningUrlMode] = useState<"track" | "playlist">("track");
  const [mainMenuThemeId, setMainMenuThemeId] = useState<MainMenuThemeId>(DEFAULT_MENU_THEME_ID);
  const [booruPrompt, setBooruPrompt] = useState(DEFAULT_INTERMEDIARY_LOADING_PROMPT);
  const [isLoadingPrompt, setIsLoadingPrompt] = useState(true);
  const [backgroundPhashScanningEnabled, setBackgroundPhashScanningEnabled] = useState(
    DEFAULT_BACKGROUND_PHASH_SCANNING_ENABLED
  );
  const [backgroundPhashRoundsPerPass, setBackgroundPhashRoundsPerPass] = useState(
    DEFAULT_BACKGROUND_PHASH_ROUNDS_PER_PASS
  );
  const [previewFfmpegSingleThreadEnabled, setPreviewFfmpegSingleThreadEnabled] = useState(
    DEFAULT_PREVIEW_FFMPEG_SINGLE_THREAD_ENABLED
  );
  const [websiteVideoCacheRootPath, setWebsiteVideoCacheRootPath] = useState<string | null>(null);
  const [musicCacheRootPath, setMusicCacheRootPath] = useState<string | null>(null);
  const [fpackExtractionPath, setFpackExtractionPath] = useState<string | null>(null);
  const [eroscriptsCacheRootPath, setEroscriptsCacheRootPath] = useState<string | null>(null);
  const [acquisitionDownloadRootPath, setAcquisitionDownloadRootPath] = useState<string | null>(
    null
  );
  const [acquisitionResolvedDownloadRoot, setAcquisitionResolvedDownloadRoot] = useState<
    string | null
  >(null);
  const [isLoadingBackgroundPhashScanningEnabled, setIsLoadingBackgroundPhashScanningEnabled] =
    useState(true);
  const [isLoadingPhashPerformanceSettings, setIsLoadingPhashPerformanceSettings] = useState(true);
  const [isApplyingWeakHardwareSettings, setIsApplyingWeakHardwareSettings] = useState(false);
  const [isLoadingStorageSettings, setIsLoadingStorageSettings] = useState(true);
  const [updatingStorageTarget, setUpdatingStorageTarget] = useState<
    | "music-cache"
    | "website-video-cache"
    | "fpack-extraction"
    | "eroscripts-cache"
    | "acquisition-downloads"
    | null
  >(null);
  const [isSkipping, setIsSkipping] = useState(false);
  const [contentKey, setContentKey] = useState(0);
  const [handyInputKey, setHandyInputKey] = useState("");
  const [inputIntifaceUrl, setInputIntifaceUrl] = useState(intifaceWebsocketUrl);
  const [inputTCodeHost, setInputTCodeHost] = useState(tcodeWebsocketHost);
  const [inputTCodeUdpHost, setInputTCodeUdpHost] = useState(tcodeUdpHost);
  const [inputTCodeTransport, setInputTCodeTransport] =
    useState<TCodeTransportKind>(tcodeTransport);
  const [inputTCodeSerialPath, setInputTCodeSerialPath] = useState(tcodeSerialPath);
  const [inputTCodeBaudRate, setInputTCodeBaudRate] = useState(String(tcodeBaudRate));
  const [inputTCodePrecision, setInputTCodePrecision] = useState<TCodePrecision>(tcodePrecision);
  const [eroscriptsLoginStatus, setEroScriptsLoginStatus] = useState<EroScriptsLoginStatus | null>(
    null
  );
  const [eroscriptsAuthMessage, setEroScriptsAuthMessage] = useState<string | null>(null);
  const [isEroScriptsAuthLoading, setIsEroScriptsAuthLoading] = useState(true);
  const [isEroScriptsAuthPending, setIsEroScriptsAuthPending] = useState(false);
  const stepNavRef = useRef<HTMLDivElement | null>(null);
  const contentScrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setInputIntifaceUrl(intifaceWebsocketUrl);
    setInputTCodeHost(tcodeWebsocketHost);
    setInputTCodeUdpHost(tcodeUdpHost);
    setInputTCodeTransport(tcodeTransport);
    setInputTCodeSerialPath(tcodeSerialPath);
    setInputTCodeBaudRate(String(tcodeBaudRate));
    setInputTCodePrecision(tcodePrecision);
  }, [
    intifaceWebsocketUrl,
    tcodeWebsocketHost,
    tcodeUdpHost,
    tcodeTransport,
    tcodeSerialPath,
    tcodeBaudRate,
    tcodePrecision,
  ]);
  const currentStep = STEPS[stepIndex] ?? STEPS[0]!;
  const displayStepTitle = abbreviateNsfwText(getStepTitle(currentStep.id), sfwMode);
  const displayStepDescription = abbreviateNsfwText(getStepDescription(currentStep.id), sfwMode);
  const displayStepDetails = getStepDetails(currentStep.id).map((detail) =>
    abbreviateNsfwText(detail, sfwMode)
  );
  const musicMessageWasAdded = musicMessage?.startsWith(t`Added`) ?? false;
  const moaningMessageWasAdded = moaningMessage?.startsWith(t`Added`) ?? false;
  const roundMessageWasImported = roundMessage?.startsWith(t`Imported`) ?? false;
  const isLastStep = stepIndex >= STEPS.length - 1;
  const isContinueDisabled =
    isBusy ||
    (currentStep.id === "booru" && isLoadingPrompt) ||
    (currentStep.id === "phash" &&
      (isLoadingBackgroundPhashScanningEnabled || isLoadingPhashPerformanceSettings)) ||
    (currentStep.id === "storage" && isLoadingStorageSettings) ||
    (currentStep.id === "eroscripts" && isEroScriptsAuthLoading);
  const progressPercent = ((stepIndex + 1) / STEPS.length) * 100;

  useEffect(() => {
    let cancelled = false;
    void trpc.store.get
      .query({ key: MENU_THEME_KEY })
      .then((value) => {
        if (!cancelled) {
          setMainMenuThemeId(normalizeMainMenuThemeId(value));
        }
      })
      .catch((error) => {
        console.error("Failed to load onboarding app theme", error);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    void trpc.store.get
      .query({ key: INTERMEDIARY_LOADING_PROMPT_KEY })
      .then((value) => {
        if (cancelled) return;
        const nextPrompt =
          typeof value === "string" && value.trim().length > 0
            ? value.trim()
            : DEFAULT_INTERMEDIARY_LOADING_PROMPT;
        setBooruPrompt(nextPrompt);
      })
      .catch((error) => {
        console.error("Failed to load onboarding booru prompt", error);
      })
      .finally(() => {
        if (!cancelled) {
          setIsLoadingPrompt(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    void Promise.all([
      trpc.store.get.query({ key: WEBSITE_VIDEO_CACHE_ROOT_PATH_KEY }),
      trpc.store.get.query({ key: MUSIC_CACHE_ROOT_PATH_KEY }),
      trpc.store.get.query({ key: FPACK_EXTRACTION_PATH_KEY }),
      trpc.store.get.query({ key: EROSCRIPTS_CACHE_ROOT_PATH_KEY }),
      acquisition.getSettings(),
    ])
      .then(
        ([
          rawWebsiteVideoCacheRootPath,
          rawMusicCacheRootPath,
          rawFpackExtractionPath,
          rawEroscriptsCacheRootPath,
          acquisitionSettings,
        ]) => {
          if (cancelled) return;
          setWebsiteVideoCacheRootPath(
            typeof rawWebsiteVideoCacheRootPath === "string" &&
              rawWebsiteVideoCacheRootPath.trim().length > 0
              ? rawWebsiteVideoCacheRootPath.trim()
              : null
          );
          setMusicCacheRootPath(
            typeof rawMusicCacheRootPath === "string" && rawMusicCacheRootPath.trim().length > 0
              ? rawMusicCacheRootPath.trim()
              : null
          );
          setFpackExtractionPath(
            typeof rawFpackExtractionPath === "string" && rawFpackExtractionPath.trim().length > 0
              ? rawFpackExtractionPath.trim()
              : null
          );
          setEroscriptsCacheRootPath(
            typeof rawEroscriptsCacheRootPath === "string" &&
              rawEroscriptsCacheRootPath.trim().length > 0
              ? rawEroscriptsCacheRootPath.trim()
              : null
          );
          setAcquisitionDownloadRootPath(acquisitionSettings.downloadRootPath);
          setAcquisitionResolvedDownloadRoot(acquisitionSettings.resolvedDownloadRoot);
        }
      )
      .catch((error) => {
        console.error("Failed to load onboarding storage settings", error);
      })
      .finally(() => {
        if (!cancelled) {
          setIsLoadingStorageSettings(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    void Promise.all([
      trpc.store.get.query({ key: BACKGROUND_PHASH_SCANNING_ENABLED_KEY }),
      trpc.store.get.query({ key: BACKGROUND_PHASH_ROUNDS_PER_PASS_KEY }),
      trpc.store.get.query({ key: PREVIEW_FFMPEG_SINGLE_THREAD_ENABLED_KEY }),
    ])
      .then(([rawBackgroundPhashScanning, rawRoundsPerPass, rawPreviewSingleThread]) => {
        if (cancelled) return;
        setBackgroundPhashScanningEnabled(
          normalizeBackgroundPhashScanningEnabled(rawBackgroundPhashScanning)
        );
        setBackgroundPhashRoundsPerPass(normalizeBackgroundPhashRoundsPerPass(rawRoundsPerPass));
        setPreviewFfmpegSingleThreadEnabled(
          normalizePreviewFfmpegSingleThreadEnabled(rawPreviewSingleThread)
        );
      })
      .catch((error) => {
        console.error("Failed to load onboarding performance settings", error);
      })
      .finally(() => {
        if (!cancelled) {
          setIsLoadingBackgroundPhashScanningEnabled(false);
          setIsLoadingPhashPerformanceSettings(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (connectionKey) {
      setHandyInputKey(connectionKey);
    }
  }, [connectionKey]);

  useEffect(() => {
    let cancelled = false;
    void trpc.eroscripts.getLoginStatus
      .query()
      .then((status) => {
        if (cancelled) return;
        setEroScriptsLoginStatus(status);
      })
      .catch((error) => {
        console.error("Failed to load onboarding EroScripts login status", error);
      })
      .finally(() => {
        if (!cancelled) {
          setIsEroScriptsAuthLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const unsubscribe = window.electronAPI.eroscripts.subscribeToLoginStatus((status) => {
      setEroScriptsLoginStatus(status);
      setIsEroScriptsAuthLoading(false);
      if (status.loggedIn) {
        setEroScriptsAuthMessage(t`EroScripts login active.`);
      }
    });
    return unsubscribe;
  }, []);

  useEffect(() => {
    const stepNav = stepNavRef.current;
    if (stepNav) {
      const activeStep = stepNav.querySelector<HTMLElement>(`[data-step-index="${stepIndex}"]`);
      activeStep?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }

    contentScrollRef.current?.scrollTo({ top: 0, behavior: "smooth" });
    setContentKey((k) => k + 1);
  }, [stepIndex]);

  const finish = async () => {
    await trpc.store.set.mutate({ key: FIRST_START_COMPLETED_KEY, value: true });
    await navigate({ to: search.returnTo === "settings" ? "/settings" : "/" });
  };

  const skip = async () => {
    setIsSkipping(true);
    await finish();
  };

  const goNext = async () => {
    if (currentStep.id === "booru") {
      const value =
        booruPrompt.trim().length > 0 ? booruPrompt.trim() : DEFAULT_INTERMEDIARY_LOADING_PROMPT;
      await trpc.store.set.mutate({ key: INTERMEDIARY_LOADING_PROMPT_KEY, value });
      setBooruPrompt(value);
    }

    if (isLastStep) {
      await finish();
      return;
    }

    setStepIndex((current) => Math.min(STEPS.length - 1, current + 1));
  };

  const applyWeakHardwarePerformanceSettings = async () => {
    if (isApplyingWeakHardwareSettings) return;
    playSelectSound();
    setIsApplyingWeakHardwareSettings(true);

    const nextBackgroundPhashScanningEnabled = false;
    const nextRoundsPerPass = MIN_BACKGROUND_PHASH_ROUNDS_PER_PASS;
    const nextPreviewFfmpegSingleThreadEnabled = true;
    const nextBackgroundVideoEnabled = false;

    setBackgroundPhashScanningEnabled(nextBackgroundPhashScanningEnabled);
    setBackgroundPhashRoundsPerPass(nextRoundsPerPass);
    setPreviewFfmpegSingleThreadEnabled(nextPreviewFfmpegSingleThreadEnabled);

    try {
      await Promise.all([
        trpc.store.set.mutate({
          key: BACKGROUND_PHASH_SCANNING_ENABLED_KEY,
          value: nextBackgroundPhashScanningEnabled,
        }),
        trpc.store.set.mutate({
          key: BACKGROUND_PHASH_ROUNDS_PER_PASS_KEY,
          value: nextRoundsPerPass,
        }),
        trpc.store.set.mutate({
          key: PREVIEW_FFMPEG_SINGLE_THREAD_ENABLED_KEY,
          value: nextPreviewFfmpegSingleThreadEnabled,
        }),
        trpc.store.set.mutate({
          key: BACKGROUND_VIDEO_ENABLED_KEY,
          value: nextBackgroundVideoEnabled,
        }),
      ]);
    } catch (error) {
      console.error("Failed to apply weak hardware onboarding settings", error);
    } finally {
      setIsApplyingWeakHardwareSettings(false);
    }
  };

  const addMusicTracks = async () => {
    if (isBusy) return;
    setIsBusy(true);
    setMusicMessage(null);
    try {
      const filePaths = await window.electronAPI.dialog.selectMusicFiles();
      if (filePaths.length === 0) {
        setMusicMessage(
          t`No music files were selected. You can continue and add them later in Settings.`
        );
        return;
      }
      await addTracks(filePaths);
      setMusicMessage(
        t`Added ${filePaths.length} track${filePaths.length === 1 ? "" : "s"} to the global music queue.`
      );
    } catch (error) {
      console.error("Failed to add onboarding music tracks", error);
      setMusicMessage(error instanceof Error ? error.message : t`Failed to add music files.`);
    } finally {
      setIsBusy(false);
    }
  };

  const addMusicFromUrl = async () => {
    if (isBusy) return;
    const trimmed = urlInput.trim();
    if (!trimmed) {
      setUrlError(t`Please enter a URL`);
      return;
    }
    try {
      new URL(trimmed);
    } catch {
      setUrlError(t`Invalid URL format`);
      return;
    }
    setUrlError(null);
    setIsBusy(true);
    try {
      const isPlaylist = trimmed.includes("list=") || trimmed.includes("/sets/");
      if (isPlaylist) {
        const result = await addPlaylistFromUrl(trimmed);
        if (result.addedCount > 0) {
          setMusicMessage(
            t`Added playlist: ${result.addedCount} track${result.addedCount === 1 ? "" : "s"} added${result.errorCount > 0 ? ` (${result.errorCount} failed)` : ""}.`
          );
          setUrlInput("");
          setShowUrlInput(false);
        } else {
          setMusicMessage(t`All tracks from this playlist are already in your queue.`);
        }
      } else {
        await addTrackFromUrl(trimmed);
        setMusicMessage(t`Track added to the global music queue.`);
        setUrlInput("");
        setShowUrlInput(false);
      }
    } catch (error) {
      setMusicMessage(error instanceof Error ? error.message : t`Failed to add from URL.`);
    } finally {
      setIsBusy(false);
    }
  };

  const addRoundFolder = async () => {
    if (isBusy) return;
    setIsBusy(true);
    setRoundMessage(null);
    try {
      const selectedFolders = await window.electronAPI.dialog.selectFolders();
      if (selectedFolders.length === 0) {
        setRoundMessage(t`No folder was selected. You can continue and import content later.`);
        return;
      }

      const folderPath = selectedFolders[0]!;
      const added = await db.install.addAutoScanFolderAndScan(folderPath);
      const stats = added.result.status.stats;
      setRoundMessage(
        t`Imported folder. Installed ${stats.installed} rounds, imported ${stats.playlistsImported} playlists, updated ${stats.updated}, and failed ${stats.failed}.`
      );
    } catch (error) {
      console.error("Failed to add onboarding round folder", error);
      setRoundMessage(
        error instanceof Error ? error.message : t`Failed to import the selected folder.`
      );
    } finally {
      setIsBusy(false);
    }
  };

  const importHeroOrRound = async () => {
    if (isBusy) return;
    setIsBusy(true);
    setRoundMessage(null);
    try {
      const filePath = await window.electronAPI.dialog.selectInstallImportFile();
      if (!filePath) {
        setRoundMessage(
          t`No file was selected. You can continue and import files later from Installed Rounds.`
        );
        return;
      }

      const result = await importOpenedFile(filePath);
      if (result.kind === "sidecar") {
        setRoundMessage(result.feedback.message);
        return;
      }

      if (result.kind === "playlist") {
        setRoundMessage(result.feedback.message);
        return;
      }

      setRoundMessage(t`That file type is not supported here.`);
    } catch (error) {
      console.error("Failed to import onboarding hero or round", error);
      setRoundMessage(
        error instanceof Error ? error.message : t`Failed to import the selected file.`
      );
    } finally {
      setIsBusy(false);
    }
  };

  const addMoaningFiles = async () => {
    if (isBusy) return;
    setIsBusy(true);
    setMoaningMessage(null);
    try {
      const filePaths = await window.electronAPI.dialog.selectMoaningFiles();
      if (filePaths.length === 0) {
        setMoaningMessage(
          t`No moaning files were selected. You can continue and add them later in Settings.`
        );
        return;
      }
      await addMoaningTracks(filePaths);
      setMoaningMessage(
        t`Added ${filePaths.length} moaning file${filePaths.length === 1 ? "" : "s"} to the gameplay library.`
      );
    } catch (error) {
      console.error("Failed to add onboarding moaning tracks", error);
      setMoaningMessage(error instanceof Error ? error.message : t`Failed to add moaning files.`);
    } finally {
      setIsBusy(false);
    }
  };

  const addMoaningFromUrl = async () => {
    if (isBusy) return;
    const trimmed = moaningUrlInput.trim();
    if (!trimmed) {
      setMoaningUrlError(t`Please enter a URL`);
      return;
    }
    try {
      new URL(trimmed);
    } catch {
      setMoaningUrlError(t`Invalid URL format`);
      return;
    }
    setMoaningUrlError(null);
    setIsBusy(true);
    setMoaningMessage(null);
    try {
      if (moaningUrlMode === "playlist") {
        const result = await addMoaningPlaylistFromUrl(trimmed);
        if (result.addedCount > 0) {
          setMoaningMessage(
            t`Added playlist: ${result.addedCount} moaning file${result.addedCount === 1 ? "" : "s"} added${result.errorCount > 0 ? ` (${result.errorCount} failed)` : ""}.`
          );
          setMoaningUrlInput("");
          setShowMoaningUrlInput(false);
        } else {
          setMoaningMessage(t`All files from this playlist are already in your moaning library.`);
        }
      } else {
        await addMoaningTrackFromUrl(trimmed);
        setMoaningMessage(t`Moaning file added to the gameplay library.`);
        setMoaningUrlInput("");
        setShowMoaningUrlInput(false);
      }
    } catch (error) {
      setMoaningMessage(error instanceof Error ? error.message : t`Failed to add from URL.`);
    } finally {
      setIsBusy(false);
    }
  };

  const handleHandyConnect = async () => {
    if (handyConnected) {
      await handyDisconnect();
      return;
    }
    if (handyProvider === "intiface") {
      await handyConnectIntiface(inputIntifaceUrl.trim() || DEFAULT_INTIFACE_WEBSOCKET_URL);
      return;
    }
    if (handyProvider === "tcode") {
      await handyConnectTCode({
        transport: inputTCodeTransport,
        serialPath: inputTCodeSerialPath,
        baudRate: Number(inputTCodeBaudRate) || DEFAULT_TCODE_BAUD_RATE,
        websocketInput: inputTCodeHost.trim() || DEFAULT_TCODE_WEBSOCKET_HOST,
        udpInput: inputTCodeUdpHost.trim() || DEFAULT_TCODE_UDP_HOST,
        precision: inputTCodePrecision,
      });
      return;
    }
    await handyConnect(handyInputKey.trim());
  };

  const tcodeDerivedUrl = (() => {
    try {
      return normalizeTCodeWebSocketInput(inputTCodeHost).url;
    } catch {
      return DEFAULT_TCODE_WEBSOCKET_URL;
    }
  })();

  const tcodeDerivedUdpEndpoint = (() => {
    try {
      return `udp://${normalizeTCodeUdpInput(inputTCodeUdpHost).endpoint}`;
    } catch {
      return `udp://${DEFAULT_TCODE_UDP_HOST}:${DEFAULT_TCODE_UDP_PORT}`;
    }
  })();

  const openEroScriptsLogin = async () => {
    if (isEroScriptsAuthPending) return;
    setIsEroScriptsAuthPending(true);
    setEroScriptsAuthMessage(null);
    try {
      await trpc.eroscripts.openLoginWindow.mutate();
      setEroScriptsAuthMessage(
        t`EroScripts login window opened. Sign in there — login will be detected automatically.`
      );
    } catch (error) {
      setEroScriptsAuthMessage(
        error instanceof Error ? error.message : t`Failed to open EroScripts login.`
      );
    } finally {
      setIsEroScriptsAuthPending(false);
    }
  };

  const refreshEroScriptsLoginStatus = async () => {
    if (isEroScriptsAuthPending) return;
    setIsEroScriptsAuthPending(true);
    setEroScriptsAuthMessage(null);
    try {
      const status = await trpc.eroscripts.getLoginStatus.query();
      setEroScriptsLoginStatus(status);
      if (status.loggedIn) {
        setEroScriptsAuthMessage(t`EroScripts login active.`);
      } else if (status.error) {
        setEroScriptsAuthMessage(status.error);
      } else {
        setEroScriptsAuthMessage(t`EroScripts is not logged in.`);
      }
    } catch (error) {
      setEroScriptsAuthMessage(
        error instanceof Error ? error.message : t`Failed to refresh EroScripts login.`
      );
    } finally {
      setIsEroScriptsAuthPending(false);
    }
  };

  const updateMainMenuTheme = async (next: unknown) => {
    const value = normalizeMainMenuThemeId(next);
    playSelectSound();
    setMainMenuThemeId(value);
    try {
      await trpc.store.set.mutate({ key: MENU_THEME_KEY, value });
      window.dispatchEvent(
        new CustomEvent<MainMenuThemeId>(MENU_THEME_CHANGED_EVENT, { detail: value })
      );
    } catch (error) {
      console.error("Failed to update onboarding app theme", error);
    }
  };

  const updateStoragePath = async (
    target:
      | "music-cache"
      | "website-video-cache"
      | "fpack-extraction"
      | "eroscripts-cache"
      | "acquisition-downloads"
  ) => {
    if (isBusy || updatingStorageTarget) return;
    setUpdatingStorageTarget(target);
    try {
      if (target === "music-cache") {
        const selected = await window.electronAPI.dialog.selectMusicCacheDirectory();
        if (!selected) return;
        const value = selected.trim();
        await trpc.store.set.mutate({ key: MUSIC_CACHE_ROOT_PATH_KEY, value });
        setMusicCacheRootPath(value);
        return;
      }

      if (target === "website-video-cache") {
        const selected = await window.electronAPI.dialog.selectWebsiteVideoCacheDirectory();
        if (!selected) return;
        const value = selected.trim();
        await trpc.store.set.mutate({ key: WEBSITE_VIDEO_CACHE_ROOT_PATH_KEY, value });
        setWebsiteVideoCacheRootPath(value);
        return;
      }

      if (target === "fpack-extraction") {
        const selected = await window.electronAPI.dialog.selectFpackExtractionDirectory();
        if (!selected) return;
        const value = selected.trim();
        await trpc.store.set.mutate({ key: FPACK_EXTRACTION_PATH_KEY, value });
        setFpackExtractionPath(value);
        return;
      }

      if (target === "acquisition-downloads") {
        const selected = await window.electronAPI.dialog.selectAcquisitionDownloadDirectory?.();
        if (!selected) return;
        await acquisition.updateSettings({ downloadRootPath: selected.trim() });
        const nextSettings = await acquisition.getSettings();
        setAcquisitionDownloadRootPath(nextSettings.downloadRootPath);
        setAcquisitionResolvedDownloadRoot(nextSettings.resolvedDownloadRoot);
        return;
      }

      const selected = await window.electronAPI.dialog.selectEroScriptsCacheDirectory();
      if (!selected) return;
      const value = selected.trim();
      await trpc.store.set.mutate({ key: EROSCRIPTS_CACHE_ROOT_PATH_KEY, value });
      setEroscriptsCacheRootPath(value);
    } catch (error) {
      console.error("Failed to update onboarding storage path", error);
    } finally {
      setUpdatingStorageTarget(null);
    }
  };

  const resetStoragePath = async (
    target:
      | "music-cache"
      | "website-video-cache"
      | "fpack-extraction"
      | "eroscripts-cache"
      | "acquisition-downloads"
  ) => {
    if (isBusy || updatingStorageTarget) return;
    setUpdatingStorageTarget(target);
    try {
      if (target === "music-cache") {
        await trpc.store.set.mutate({ key: MUSIC_CACHE_ROOT_PATH_KEY, value: null });
        setMusicCacheRootPath(null);
        return;
      }
      if (target === "website-video-cache") {
        await trpc.store.set.mutate({ key: WEBSITE_VIDEO_CACHE_ROOT_PATH_KEY, value: null });
        setWebsiteVideoCacheRootPath(null);
        return;
      }
      if (target === "fpack-extraction") {
        await trpc.store.set.mutate({ key: FPACK_EXTRACTION_PATH_KEY, value: null });
        setFpackExtractionPath(null);
        return;
      }
      if (target === "acquisition-downloads") {
        await acquisition.updateSettings({ downloadRootPath: null });
        const nextSettings = await acquisition.getSettings();
        setAcquisitionDownloadRootPath(nextSettings.downloadRootPath);
        setAcquisitionResolvedDownloadRoot(nextSettings.resolvedDownloadRoot);
        return;
      }
      await trpc.store.set.mutate({ key: EROSCRIPTS_CACHE_ROOT_PATH_KEY, value: null });
      setEroscriptsCacheRootPath(null);
    } catch (error) {
      console.error("Failed to reset onboarding storage path", error);
    } finally {
      setUpdatingStorageTarget(null);
    }
  };

  return (
    <div className="relative min-h-screen overflow-hidden">
      <AnimatedBackground />

      <div className="relative z-10 flex h-screen items-center justify-center px-3 py-4 sm:px-6 sm:py-6">
        <div className="parallax-ui-none fs-outer-glass flex h-full w-full max-w-[1600px] flex-col rounded-[2rem] p-4 sm:p-5">
          {/* ── Header ── */}
          <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
            <div className="flex flex-col gap-2">
              <div className="flex items-center gap-3">
                <span
                  className="animate-entrance text-base drop-shadow-[0_0_8px_rgba(139,92,246,0.5)]"
                  style={{ animationDelay: "0.05s" }}
                >
                  ✦
                </span>
                <p
                  className="font-[family-name:var(--font-jetbrains-mono)] text-[10px] uppercase tracking-[0.35em] text-violet-300/70 animate-entrance"
                  style={{ animationDelay: "0.1s" }}
                >
                  <Trans>Getting Started</Trans>
                </p>
                <div className="h-px flex-1 bg-gradient-to-r from-violet-400/30 via-violet-400/10 to-transparent" />
              </div>
              <h1
                className="text-2xl font-black tracking-tight sm:text-3xl xl:text-4xl animate-entrance"
                style={{ animationDelay: "0.2s" }}
              >
                <span className="fs-hero-title">
                  {abbreviateNsfwText(t`Welcome to Fap Land`, sfwMode)}
                </span>
              </h1>
              <p
                className="max-w-xl text-sm text-zinc-400/90 animate-entrance"
                style={{ animationDelay: "0.3s" }}
              >
                <Trans>
                  Let&apos;s get you set up. This quick walkthrough covers the essentials and lets
                  you import content right away.
                </Trans>
              </p>
            </div>

            <button
              type="button"
              disabled={isSkipping}
              onMouseEnter={playHoverSound}
              onClick={() => {
                playSelectSound();
                void skip();
              }}
              className={`group relative flex items-center gap-2 self-start rounded-xl border px-4 py-2.5 text-sm font-semibold transition-all animate-entrance ${
                isSkipping
                  ? "cursor-not-allowed border-zinc-600/50 bg-zinc-800/50 text-zinc-500"
                  : "border-zinc-500/40 bg-zinc-900/60 text-zinc-300 hover:border-violet-400/50 hover:bg-zinc-800/80 hover:text-violet-100"
              }`}
              style={{ animationDelay: "0.4s" }}
            >
              <span className="absolute inset-0 rounded-xl opacity-0 transition-opacity group-hover:opacity-100 bg-gradient-to-r from-violet-500/5 to-indigo-500/5" />
              {isSkipping ? (
                <>
                  <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-zinc-500 border-t-zinc-300" />
                  <span>
                    <Trans>Skipping...</Trans>
                  </span>
                </>
              ) : (
                <>
                  <span>⏭</span>
                  <span>
                    <Trans>Skip Setup</Trans>
                  </span>
                </>
              )}
            </button>
          </header>

          {/* ── Progress Dots ── */}
          <div className="mt-4 animate-entrance" style={{ animationDelay: "0.5s" }}>
            <div className="flex items-center gap-1">
              <span className="mr-2 font-[family-name:var(--font-jetbrains-mono)] text-[10px] uppercase tracking-[0.2em] text-zinc-500">
                {stepIndex + 1}/{STEPS.length}
              </span>
              {STEPS.map((step, idx) => {
                const dotClass =
                  idx < stepIndex
                    ? "fs-progress-dot fs-progress-dot--complete"
                    : idx === stepIndex
                      ? "fs-progress-dot fs-progress-dot--active"
                      : "fs-progress-dot fs-progress-dot--pending";
                return (
                  <div key={step.id} className="flex flex-1 items-center gap-1">
                    <button
                      type="button"
                      aria-label={getStepShortLabel(step.id)}
                      onClick={() => {
                        playSelectSound();
                        setStepIndex(idx);
                      }}
                      className={dotClass}
                    />
                    {idx < STEPS.length - 1 && (
                      <div
                        className={`fs-progress-line ${
                          idx < stepIndex ? "fs-progress-line--filled" : "fs-progress-line--empty"
                        }`}
                      />
                    )}
                  </div>
                );
              })}
              <span className="ml-2 font-[family-name:var(--font-jetbrains-mono)] text-[10px] uppercase tracking-[0.2em] text-violet-400/80">
                {Math.round(progressPercent)}%
              </span>
            </div>
          </div>

          {/* ── Main Content ── */}
          <div className="mt-4 grid min-h-0 flex-1 gap-4 lg:grid-cols-[200px_minmax(0,1fr)] xl:grid-cols-[220px_minmax(0,1fr)]">
            {/* ── Step Navigation ── */}
            <aside
              className="min-h-0 overflow-y-auto rounded-2xl fs-sidebar-glass p-2 animate-entrance"
              style={{ animationDelay: "0.6s" }}
            >
              <div ref={stepNavRef} className="relative">
                {/* Thin connecting line */}
                <div className="absolute left-[13px] top-3 bottom-3 w-px bg-zinc-800/60" />
                <div
                  className="absolute left-[13px] top-3 w-px bg-gradient-to-b from-violet-500/70 to-purple-400/40 transition-all duration-500"
                  style={{ height: `${(stepIndex / (STEPS.length - 1)) * 100}%` }}
                />

                <div className="space-y-0.5">
                  {STEPS.map((step, index) => {
                    const active = index === stepIndex;
                    const complete = index < stepIndex;
                    return (
                      <button
                        key={step.id}
                        type="button"
                        data-step-index={index}
                        onMouseEnter={playHoverSound}
                        onClick={() => {
                          playSelectSound();
                          setStepIndex(index);
                        }}
                        className={`fs-sidebar-step relative flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left transition-all ${
                          active
                            ? "fs-sidebar-step--active bg-violet-500/12 text-white"
                            : complete
                              ? "text-zinc-400 hover:bg-white/[0.04] hover:text-zinc-200"
                              : "text-zinc-500 hover:bg-white/[0.03] hover:text-zinc-400"
                        }`}
                      >
                        {/* Active left accent */}
                        {active && (
                          <span className="absolute left-0 top-1/2 -translate-y-1/2 h-4 w-[2px] rounded-full bg-violet-400 shadow-[0_0_8px_rgba(167,139,250,0.6)]" />
                        )}

                        {/* Step Indicator */}
                        <span
                          className={`relative z-10 flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full transition-all ${
                            active
                              ? "fs-step-indicator-active bg-violet-500/25 ring-[1.5px] ring-violet-400/50"
                              : complete
                                ? "fs-step-indicator-complete bg-emerald-500/15 ring-1 ring-emerald-400/25"
                                : "bg-zinc-800/80 ring-1 ring-zinc-700/70"
                          }`}
                        >
                          {complete ? (
                            <span className="fs-checkmark text-[10px] text-emerald-400">✓</span>
                          ) : active ? (
                            <span className="text-[11px]">{step.icon}</span>
                          ) : (
                            <span className="font-[family-name:var(--font-jetbrains-mono)] text-[9px] font-bold text-zinc-500">
                              {index + 1}
                            </span>
                          )}
                        </span>

                        {/* Step Label */}
                        <span
                          className={`text-[11px] font-medium leading-tight transition-all ${
                            active
                              ? "text-violet-100"
                              : complete
                                ? "text-zinc-400"
                                : "text-zinc-500"
                          }`}
                        >
                          {getStepShortLabel(step.id)}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            </aside>

            {/* ── Content Section ── */}
            <section className="flex min-h-0 flex-col rounded-2xl fs-content-glass p-4 sm:p-5">
              <div key={contentKey} className="fs-content-enter flex min-h-0 flex-1 flex-col">
                {/* Eyebrow */}
                <div className="flex items-center gap-2">
                  <span className="text-lg">{currentStep.icon}</span>
                  <p className="font-[family-name:var(--font-jetbrains-mono)] text-[10px] uppercase tracking-[0.25em] text-cyan-300/70">
                    {getStepEyebrow(currentStep.id)}
                  </p>
                </div>

                {/* Title */}
                <h2 className="mt-2 max-w-[28ch] text-xl font-bold leading-tight tracking-tight text-white sm:text-2xl xl:text-3xl">
                  {displayStepTitle}
                </h2>

                {/* Description */}
                <p className="mt-2 text-sm leading-relaxed text-zinc-300 sm:text-base">
                  {displayStepDescription}
                </p>

                {/* Details */}
                <div
                  ref={contentScrollRef}
                  className="mt-4 min-h-0 flex-1 space-y-2.5 overflow-y-auto pr-1"
                >
                  {displayStepDetails.map((detail, idx) => (
                    <div
                      key={`${currentStep.id}-${idx}`}
                      className="fs-detail-card flex items-start gap-3 rounded-xl border border-zinc-800/60 bg-zinc-900/40 px-3.5 py-3 text-sm leading-relaxed text-zinc-400 animate-entrance"
                      style={{ animationDelay: `${0.1 + idx * 0.05}s` }}
                    >
                      <span
                        className="fs-detail-number"
                        style={{ animationDelay: `${0.15 + idx * 0.06}s` }}
                      >
                        {idx + 1}
                      </span>
                      <span>{detail}</span>
                    </div>
                  ))}

                  {currentStep.interactive === "language" && (
                    <div
                      className="fs-interactive-panel mt-3 space-y-4 rounded-2xl border border-emerald-400/30 bg-gradient-to-br from-emerald-500/10 via-teal-500/5 to-cyan-500/10 p-4 animate-entrance"
                      style={{ animationDelay: "0.3s" }}
                    >
                      <div>
                        <div className="mb-2 flex items-center gap-2">
                          <span className="text-emerald-300">🌐</span>
                          <p className="text-sm font-semibold text-emerald-100">
                            <Trans>Language</Trans> / Language
                          </p>
                        </div>
                        <p className="text-sm text-zinc-400">
                          <Trans>
                            Choose the language used on this page and across the app. Changes apply
                            immediately.
                          </Trans>
                        </p>
                        <div className="mt-3 grid gap-2 sm:grid-cols-3">
                          {locales.map((entry) => {
                            const selected = entry.code === locale;
                            return (
                              <button
                                key={entry.code}
                                type="button"
                                onMouseEnter={playHoverSound}
                                onClick={() => {
                                  playSelectSound();
                                  void setLocale(entry.code);
                                }}
                                className={`rounded-xl border px-4 py-3 text-left transition-all ${
                                  selected
                                    ? "border-emerald-300/70 bg-emerald-500/20 text-emerald-50 shadow-[0_0_20px_rgba(52,211,153,0.18)]"
                                    : "border-white/10 bg-black/20 text-zinc-200 hover:border-emerald-400/40 hover:bg-emerald-500/10"
                                }`}
                              >
                                <div className="flex items-center gap-2">
                                  <span className="text-sm font-semibold">{entry.label}</span>
                                  {selected && (
                                    <span className="rounded-full bg-emerald-400/20 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-200">
                                      <Trans>Selected</Trans>
                                    </span>
                                  )}
                                </div>
                                <p className="mt-1 text-xs text-zinc-400">
                                  {getLocaleCardDescription(entry.code)}
                                </p>
                              </button>
                            );
                          })}
                        </div>
                      </div>

                      <div className="border-t border-white/10 pt-4">
                        <div className="mb-2 flex items-center gap-2">
                          <span className="text-cyan-300">🎨</span>
                          <p className="text-sm font-semibold text-cyan-100">
                            <Trans>Theme</Trans>
                          </p>
                        </div>
                        <p className="text-sm text-zinc-400">
                          <Trans>Choose the app color theme used by menus and setup screens.</Trans>
                        </p>
                        <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                          {MAIN_MENU_THEMES.map((theme) => {
                            const selected = theme.id === mainMenuThemeId;
                            const previewGradient = `linear-gradient(135deg, ${theme.preview.from}, ${theme.preview.via}, ${theme.preview.to})`;
                            return (
                              <button
                                key={theme.id}
                                type="button"
                                onMouseEnter={playHoverSound}
                                onClick={() => void updateMainMenuTheme(theme.id)}
                                className={`overflow-hidden rounded-xl border text-left transition-all ${
                                  selected
                                    ? "border-cyan-300/70 bg-cyan-500/20 text-cyan-50 shadow-[0_0_20px_rgba(34,211,238,0.18)]"
                                    : "border-white/10 bg-black/20 text-zinc-200 hover:border-cyan-400/40 hover:bg-cyan-500/10"
                                }`}
                              >
                                <div
                                  className="h-2 w-full"
                                  style={{ background: previewGradient }}
                                />
                                <div className="px-4 py-3">
                                  <div className="flex items-center gap-2">
                                    <span className="text-sm font-semibold">{theme.label}</span>
                                    {selected && (
                                      <span className="rounded-full bg-cyan-400/20 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-cyan-200">
                                        <Trans>Selected</Trans>
                                      </span>
                                    )}
                                  </div>
                                  <p className="mt-1 text-xs text-zinc-400">{theme.description}</p>
                                </div>
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Music Section */}
                  {currentStep.interactive === "music" && (
                    <div
                      className="fs-interactive-panel mt-3 rounded-2xl border border-violet-400/30 bg-gradient-to-br from-violet-500/10 via-purple-500/5 to-indigo-500/10 p-4 animate-entrance"
                      style={{ animationDelay: "0.3s" }}
                    >
                      <div className="flex items-center gap-2 mb-2">
                        <span className="text-violet-400">🎵</span>
                        <p className="text-sm font-semibold text-violet-200">
                          <Trans>Music Queue</Trans>
                        </p>
                        {queue.length > 0 && (
                          <span className="ml-auto rounded-full bg-emerald-500/20 px-2 py-0.5 text-[10px] font-medium text-emerald-300">
                            {t`${queue.length} track${queue.length === 1 ? "" : "s"}`}
                          </span>
                        )}
                      </div>
                      <p className="text-sm text-zinc-400">
                        <Trans>
                          Pick music files from your computer, or add YouTube videos and playlists
                          to download as MP3.
                        </Trans>
                      </p>
                      <div className="mt-3 flex flex-wrap gap-2">
                        <button
                          type="button"
                          disabled={isBusy}
                          onMouseEnter={playHoverSound}
                          onClick={() => {
                            playSelectSound();
                            void addMusicTracks();
                          }}
                          className={`flex items-center gap-2 rounded-xl border px-4 py-2.5 text-sm font-semibold transition-all ${
                            isBusy
                              ? "cursor-not-allowed border-zinc-600/50 bg-zinc-800/50 text-zinc-500"
                              : "border-violet-400/50 bg-violet-500/20 text-violet-100 hover:border-violet-300/70 hover:bg-violet-500/30 hover:shadow-[0_0_20px_rgba(139,92,246,0.3)]"
                          }`}
                        >
                          {isBusy ? (
                            <>
                              <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-violet-400/30 border-t-violet-300" />
                              <span>
                                <Trans>Adding...</Trans>
                              </span>
                            </>
                          ) : (
                            <>
                              <span>📁</span>
                              <span>
                                <Trans>Add Music Files</Trans>
                              </span>
                            </>
                          )}
                        </button>
                        <button
                          type="button"
                          disabled={isBusy}
                          onMouseEnter={playHoverSound}
                          onClick={() => {
                            playSelectSound();
                            setShowUrlInput((current) => !current);
                            setUrlError(null);
                          }}
                          className={`flex items-center gap-2 rounded-xl border px-4 py-2.5 text-sm font-semibold transition-all ${
                            showUrlInput
                              ? "border-cyan-400/50 bg-cyan-500/20 text-cyan-100"
                              : "border-purple-400/50 bg-purple-500/20 text-purple-100 hover:border-purple-300/70 hover:bg-purple-500/30 hover:shadow-[0_0_20px_rgba(168,85,247,0.3)]"
                          }`}
                        >
                          <span>⊕</span>
                          <span>
                            <Trans>Add from YouTube</Trans>
                          </span>
                        </button>
                      </div>

                      {showUrlInput && (
                        <div className="mt-3 space-y-2 rounded-xl border border-white/10 bg-black/20 p-3">
                          <p className="text-xs text-zinc-400">
                            <Trans>
                              Paste a YouTube video or playlist URL. Audio is downloaded as MP3 via
                              yt-dlp.
                            </Trans>
                          </p>
                          <div className="flex gap-2">
                            <input
                              type="url"
                              placeholder={t`https://example.com/video-or-playlist`}
                              value={urlInput}
                              onChange={(e) => {
                                setUrlInput(e.target.value);
                                setUrlError(null);
                              }}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") {
                                  void addMusicFromUrl();
                                }
                              }}
                              disabled={isBusy}
                              className={`flex-1 rounded-lg border bg-white/5 px-3 py-2 text-xs text-white placeholder-zinc-500 outline-none transition ${
                                urlError
                                  ? "border-rose-400/40 focus:border-rose-400/60"
                                  : "border-white/10 focus:border-violet-400/60"
                              }`}
                            />
                            <button
                              type="button"
                              onMouseEnter={playHoverSound}
                              onClick={() => void addMusicFromUrl()}
                              disabled={isBusy}
                              className={`rounded-lg px-4 py-2 text-xs font-semibold transition-all ${
                                isBusy
                                  ? "cursor-not-allowed border-zinc-600/50 bg-zinc-800/50 text-zinc-500"
                                  : "border-cyan-400/50 bg-cyan-500/20 text-cyan-50 hover:bg-cyan-500/30"
                              }`}
                            >
                              {isBusy ? <Trans>Downloading...</Trans> : <Trans>Add</Trans>}
                            </button>
                          </div>
                          {urlError && <p className="text-xs text-rose-300">{urlError}</p>}
                        </div>
                      )}

                      {musicMessage && (
                        <div
                          className={`mt-3 flex items-start gap-2 rounded-xl border px-3 py-2.5 text-sm ${
                            musicMessageWasAdded
                              ? "border-emerald-400/30 bg-emerald-500/10 text-emerald-200"
                              : "border-cyan-400/30 bg-cyan-500/10 text-cyan-200"
                          }`}
                        >
                          <span>{musicMessageWasAdded ? "✓" : "ℹ"}</span>
                          <span>{musicMessage}</span>
                        </div>
                      )}
                    </div>
                  )}

                  {currentStep.interactive === "moaning" && (
                    <div
                      className="fs-interactive-panel mt-3 rounded-2xl border border-rose-400/30 bg-gradient-to-br from-rose-500/10 via-pink-500/5 to-orange-500/10 p-4 animate-entrance"
                      style={{ animationDelay: "0.3s" }}
                    >
                      <div className="mb-2 flex items-center gap-2">
                        <span className="text-rose-300">🔊</span>
                        <p className="text-sm font-semibold text-rose-100">
                          <Trans>Gameplay Moaning</Trans>
                        </p>
                        {moaningQueue.length > 0 && (
                          <span className="ml-auto rounded-full bg-emerald-500/20 px-2 py-0.5 text-[10px] font-medium text-emerald-300">
                            {t`${moaningQueue.length} file${moaningQueue.length === 1 ? "" : "s"}`}
                          </span>
                        )}
                      </div>
                      <p className="text-sm text-zinc-400">
                        <Trans>
                          Add moaning audio so moaning-based perks and anti-perks have something to
                          play during the run.
                        </Trans>
                      </p>
                      <div className="mt-3 flex flex-wrap items-center gap-3">
                        <button
                          type="button"
                          aria-label={t`Toggle Enable Moaning`}
                          role="switch"
                          aria-checked={moaningEnabled}
                          onMouseEnter={playHoverSound}
                          onClick={() => {
                            playSelectSound();
                            void setMoaningEnabled(!moaningEnabled);
                          }}
                          className={`relative h-7 w-14 shrink-0 overflow-hidden rounded-full border transition-all duration-200 ${moaningEnabled ? "border-rose-300/80 bg-rose-500/50 shadow-[0_0_20px_rgba(251,113,133,0.35)]" : "border-zinc-600 bg-zinc-800"}`}
                        >
                          <span
                            className={`absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow-md transition-transform duration-200 ${moaningEnabled ? "translate-x-7" : "translate-x-0"}`}
                          />
                        </button>
                        <span
                          className={`text-sm font-medium ${moaningEnabled ? "text-zinc-100" : "text-zinc-400"}`}
                        >
                          <Trans>Moaning</Trans>{" "}
                          {moaningEnabled ? <Trans>Enabled</Trans> : <Trans>Disabled</Trans>}
                        </span>
                      </div>
                      <div className="mt-3 flex flex-wrap gap-2">
                        <button
                          type="button"
                          disabled={isBusy}
                          onMouseEnter={playHoverSound}
                          onClick={() => {
                            playSelectSound();
                            void addMoaningFiles();
                          }}
                          className={`flex items-center gap-2 rounded-xl border px-4 py-2.5 text-sm font-semibold transition-all ${
                            isBusy
                              ? "cursor-not-allowed border-zinc-600/50 bg-zinc-800/50 text-zinc-500"
                              : "border-rose-400/50 bg-rose-500/20 text-rose-100 hover:border-rose-300/70 hover:bg-rose-500/30 hover:shadow-[0_0_20px_rgba(251,113,133,0.3)]"
                          }`}
                        >
                          {isBusy ? (
                            <>
                              <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-rose-400/30 border-t-rose-300" />
                              <span>
                                <Trans>Adding...</Trans>
                              </span>
                            </>
                          ) : (
                            <>
                              <span>📁</span>
                              <span>
                                <Trans>Add Moaning Files</Trans>
                              </span>
                            </>
                          )}
                        </button>
                        <button
                          type="button"
                          disabled={isBusy || moaningQueue.length === 0}
                          onMouseEnter={playHoverSound}
                          onClick={() => {
                            playSelectSound();
                            void previewMoaningTrack(moaningQueue[0]!.id);
                          }}
                          className={`flex items-center gap-2 rounded-xl border px-4 py-2.5 text-sm font-semibold transition-all ${
                            isBusy || moaningQueue.length === 0
                              ? "cursor-not-allowed border-zinc-600/50 bg-zinc-800/50 text-zinc-500"
                              : "border-cyan-400/50 bg-cyan-500/20 text-cyan-100 hover:border-cyan-300/70 hover:bg-cyan-500/30"
                          }`}
                        >
                          <span>▶</span>
                          <span>
                            <Trans>Preview First File</Trans>
                          </span>
                        </button>
                        <button
                          type="button"
                          onMouseEnter={playHoverSound}
                          onClick={() => {
                            playSelectSound();
                            stopMoaningPreview();
                          }}
                          className="flex items-center gap-2 rounded-xl border border-zinc-500/50 bg-zinc-800/60 px-4 py-2.5 text-sm font-semibold text-zinc-200 transition-all hover:border-zinc-300/60 hover:bg-zinc-700/70"
                        >
                          <span>⏹</span>
                          <span>
                            <Trans>Stop Preview</Trans>
                          </span>
                        </button>
                        <button
                          type="button"
                          disabled={isBusy}
                          onMouseEnter={playHoverSound}
                          onClick={() => {
                            playSelectSound();
                            setShowMoaningUrlInput((current) => !current);
                            setMoaningUrlError(null);
                          }}
                          className={`flex items-center gap-2 rounded-xl border px-4 py-2.5 text-sm font-semibold transition-all ${
                            showMoaningUrlInput
                              ? "border-cyan-400/50 bg-cyan-500/20 text-cyan-100"
                              : "border-orange-400/50 bg-orange-500/20 text-orange-100 hover:border-orange-300/70 hover:bg-orange-500/30"
                          }`}
                        >
                          <span>⊕</span>
                          <span>
                            <Trans>Add from URL</Trans>
                          </span>
                        </button>
                      </div>

                      {showMoaningUrlInput && (
                        <div className="mt-3 space-y-2 rounded-xl border border-white/10 bg-black/20 p-3">
                          <p className="text-xs text-zinc-400">
                            <Trans>
                              Add from any yt-dlp-supported URL. Single tracks and playlists are
                              both supported.
                            </Trans>
                          </p>
                          <div className="flex gap-1.5">
                            <button
                              type="button"
                              onMouseEnter={playHoverSound}
                              onClick={() => {
                                playSelectSound();
                                setMoaningUrlMode("track");
                              }}
                              className={`rounded-lg border px-2 py-1 text-[10px] font-bold uppercase tracking-wide transition ${
                                moaningUrlMode === "track"
                                  ? "border-cyan-300/60 bg-cyan-500/30 text-cyan-100"
                                  : "border-zinc-600 bg-zinc-800 text-zinc-400 hover:bg-zinc-700"
                              }`}
                            >
                              <Trans>Single Track</Trans>
                            </button>
                            <button
                              type="button"
                              onMouseEnter={playHoverSound}
                              onClick={() => {
                                playSelectSound();
                                setMoaningUrlMode("playlist");
                              }}
                              className={`rounded-lg border px-2 py-1 text-[10px] font-bold uppercase tracking-wide transition ${
                                moaningUrlMode === "playlist"
                                  ? "border-cyan-300/60 bg-cyan-500/30 text-cyan-100"
                                  : "border-zinc-600 bg-zinc-800 text-zinc-400 hover:bg-zinc-700"
                              }`}
                            >
                              <Trans>Playlist</Trans>
                            </button>
                          </div>
                          <div className="flex gap-2">
                            <input
                              type="url"
                              placeholder={
                                moaningUrlMode === "playlist"
                                  ? t`https://example.com/playlist-or-collection`
                                  : t`https://example.com/video-or-audio`
                              }
                              value={moaningUrlInput}
                              onChange={(e) => {
                                setMoaningUrlInput(e.target.value);
                                setMoaningUrlError(null);
                              }}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") {
                                  void addMoaningFromUrl();
                                }
                              }}
                              disabled={isBusy}
                              className={`flex-1 rounded-lg border bg-white/5 px-3 py-2 text-xs text-white placeholder-zinc-500 outline-none transition ${
                                moaningUrlError
                                  ? "border-rose-400/40 focus:border-rose-400/60"
                                  : "border-white/10 focus:border-rose-400/60"
                              }`}
                            />
                            <button
                              type="button"
                              onMouseEnter={playHoverSound}
                              onClick={() => void addMoaningFromUrl()}
                              disabled={isBusy}
                              className={`rounded-lg px-4 py-2 text-xs font-semibold transition-all ${
                                isBusy
                                  ? "cursor-not-allowed border-zinc-600/50 bg-zinc-800/50 text-zinc-500"
                                  : "border-cyan-400/50 bg-cyan-500/20 text-cyan-50 hover:bg-cyan-500/30"
                              }`}
                            >
                              {isBusy ? <Trans>Downloading...</Trans> : <Trans>Add</Trans>}
                            </button>
                          </div>
                          {moaningUrlError && (
                            <p className="text-xs text-rose-300">{moaningUrlError}</p>
                          )}
                        </div>
                      )}

                      {moaningMessage && (
                        <div
                          className={`mt-3 flex items-start gap-2 rounded-xl border px-3 py-2.5 text-sm ${
                            moaningMessageWasAdded
                              ? "border-emerald-400/30 bg-emerald-500/10 text-emerald-200"
                              : "border-cyan-400/30 bg-cyan-500/10 text-cyan-200"
                          }`}
                        >
                          <span>{moaningMessageWasAdded ? "✓" : "ℹ"}</span>
                          <span>{moaningMessage}</span>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Round Packs Section */}
                  {currentStep.interactive === "round-packs" && (
                    <div
                      className="fs-interactive-panel mt-3 rounded-2xl border border-cyan-400/30 bg-gradient-to-br from-cyan-500/10 via-blue-500/5 to-indigo-500/10 p-4 animate-entrance"
                      style={{ animationDelay: "0.3s" }}
                    >
                      <div className="flex items-center gap-2 mb-2">
                        <span className="text-cyan-400">💿</span>
                        <p className="text-sm font-semibold text-cyan-200">
                          <Trans>Import Content</Trans>
                        </p>
                      </div>
                      <p className="text-sm text-zinc-400">
                        <Trans>Add a content folder or import a single hero/round file.</Trans>
                      </p>
                      <div className="mt-3 flex flex-wrap gap-2">
                        <button
                          type="button"
                          disabled={isBusy}
                          onMouseEnter={playHoverSound}
                          onClick={() => {
                            playSelectSound();
                            void addRoundFolder();
                          }}
                          className={`flex items-center gap-2 rounded-xl border px-4 py-2.5 text-sm font-semibold transition-all ${
                            isBusy
                              ? "cursor-not-allowed border-zinc-600/50 bg-zinc-800/50 text-zinc-500"
                              : "border-violet-400/50 bg-violet-500/20 text-violet-100 hover:border-violet-300/70 hover:bg-violet-500/30 hover:shadow-[0_0_20px_rgba(139,92,246,0.3)]"
                          }`}
                        >
                          {isBusy ? (
                            <>
                              <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-violet-400/30 border-t-violet-300" />
                              <span>
                                <Trans>Working...</Trans>
                              </span>
                            </>
                          ) : (
                            <>
                              <span>📁</span>
                              <span>
                                <Trans>Add Folder</Trans>
                              </span>
                            </>
                          )}
                        </button>
                        <button
                          type="button"
                          disabled={isBusy}
                          onMouseEnter={playHoverSound}
                          onClick={() => {
                            playSelectSound();
                            void importHeroOrRound();
                          }}
                          className={`flex items-center gap-2 rounded-xl border px-4 py-2.5 text-sm font-semibold transition-all ${
                            isBusy
                              ? "cursor-not-allowed border-zinc-600/50 bg-zinc-800/50 text-zinc-500"
                              : "border-cyan-400/50 bg-cyan-500/20 text-cyan-100 hover:border-cyan-300/70 hover:bg-cyan-500/30 hover:shadow-[0_0_20px_rgba(34,211,238,0.3)]"
                          }`}
                        >
                          {isBusy ? (
                            <>
                              <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-cyan-400/30 border-t-cyan-300" />
                              <span>
                                <Trans>Working...</Trans>
                              </span>
                            </>
                          ) : (
                            <>
                              <span>📄</span>
                              <span>
                                <Trans>Import File</Trans>
                              </span>
                            </>
                          )}
                        </button>
                      </div>
                      {roundMessage && (
                        <div
                          className={`mt-3 flex items-start gap-2 rounded-xl border px-3 py-2.5 text-sm ${
                            roundMessageWasImported
                              ? "border-emerald-400/30 bg-emerald-500/10 text-emerald-200"
                              : "border-cyan-400/30 bg-cyan-500/10 text-cyan-200"
                          }`}
                        >
                          <span>{roundMessageWasImported ? "✓" : "ℹ"}</span>
                          <span>{roundMessage}</span>
                        </div>
                      )}
                    </div>
                  )}

                  {/* EroScripts Login Section */}
                  {currentStep.interactive === "eroscripts" && (
                    <div
                      className="fs-interactive-panel mt-3 rounded-2xl border border-cyan-400/30 bg-gradient-to-br from-cyan-500/10 via-blue-500/5 to-indigo-500/10 p-4 animate-entrance"
                      style={{ animationDelay: "0.3s" }}
                    >
                      <div className="mb-2 flex items-center gap-2">
                        <span className="text-cyan-300">🔗</span>
                        <p className="text-sm font-semibold text-cyan-100">
                          <Trans>EroScripts Account</Trans>
                        </p>
                        {eroscriptsLoginStatus?.loggedIn && (
                          <span className="ml-auto rounded-full bg-emerald-500/20 px-2 py-0.5 text-[10px] font-medium text-emerald-300">
                            <Trans>Connected</Trans>
                          </span>
                        )}
                      </div>
                      <p className="text-sm text-zinc-400">
                        <Trans>
                          Sign in to your EroScripts account to search and download funscripts and
                          videos directly from the app. If you do not have one yet, creating an
                          account is free.
                        </Trans>
                      </p>
                      <div className="mt-3 rounded-xl border border-white/10 bg-black/20 p-3">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div>
                            <div className="text-xs font-semibold uppercase tracking-[0.18em] text-zinc-500">
                              <Trans>Login Status</Trans>
                            </div>
                            <div className="mt-1 text-sm font-semibold text-zinc-100">
                              {isEroScriptsAuthLoading
                                ? t`Checking login...`
                                : eroscriptsLoginStatus?.loggedIn
                                  ? eroscriptsLoginStatus.username
                                    ? t`Logged in as ${eroscriptsLoginStatus.username}`
                                    : t`Logged in`
                                  : t`Not logged in`}
                            </div>
                          </div>
                          <div className="rounded-full border border-zinc-600/70 px-3 py-1 text-xs font-semibold text-zinc-300">
                            <Trans>Cookies stored: {eroscriptsLoginStatus?.cookieCount ?? 0}</Trans>
                          </div>
                        </div>
                        {eroscriptsLoginStatus?.error ? (
                          <p className="mt-2 text-sm text-amber-200">
                            {eroscriptsLoginStatus.error}
                          </p>
                        ) : null}
                      </div>
                      {eroscriptsAuthMessage && (
                        <div
                          className={`mt-3 flex items-start gap-2 rounded-xl border px-3 py-2.5 text-sm ${
                            eroscriptsLoginStatus?.loggedIn
                              ? "border-emerald-400/30 bg-emerald-500/10 text-emerald-200"
                              : "border-cyan-400/30 bg-cyan-500/10 text-cyan-200"
                          }`}
                        >
                          <span>{eroscriptsLoginStatus?.loggedIn ? "✓" : "ℹ"}</span>
                          <span>{eroscriptsAuthMessage}</span>
                        </div>
                      )}
                      <div className="mt-3 flex flex-wrap gap-2">
                        <button
                          type="button"
                          disabled={isEroScriptsAuthLoading || isEroScriptsAuthPending}
                          onMouseEnter={playHoverSound}
                          onClick={() => {
                            playSelectSound();
                            void openEroScriptsLogin();
                          }}
                          className={`flex items-center gap-2 rounded-xl border px-4 py-2.5 text-sm font-semibold transition-all ${
                            isEroScriptsAuthPending
                              ? "cursor-not-allowed border-zinc-600/50 bg-zinc-800/50 text-zinc-500"
                              : "border-cyan-400/50 bg-cyan-500/20 text-cyan-100 hover:border-cyan-300/70 hover:bg-cyan-500/30 hover:shadow-[0_0_20px_rgba(34,211,238,0.3)]"
                          }`}
                        >
                          {isEroScriptsAuthPending ? (
                            <>
                              <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-cyan-400/30 border-t-cyan-300" />
                              <span>
                                <Trans>Opening...</Trans>
                              </span>
                            </>
                          ) : (
                            <>
                              <span>🔑</span>
                              <span>
                                <Trans>Sign In / Create Account</Trans>
                              </span>
                            </>
                          )}
                        </button>
                        <button
                          type="button"
                          disabled={isEroScriptsAuthLoading || isEroScriptsAuthPending}
                          onMouseEnter={playHoverSound}
                          onClick={() => {
                            playSelectSound();
                            void refreshEroScriptsLoginStatus();
                          }}
                          className="flex items-center gap-2 rounded-xl border border-emerald-400/50 bg-emerald-500/20 px-4 py-2.5 text-sm font-semibold text-emerald-100 transition-all hover:border-emerald-300/70 hover:bg-emerald-500/30 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          <span>🔄</span>
                          <span>
                            <Trans>Check Login</Trans>
                          </span>
                        </button>
                      </div>
                    </div>
                  )}

                  {currentStep.interactive === "storage" && (
                    <div
                      className="fs-interactive-panel mt-3 rounded-2xl border border-sky-400/30 bg-gradient-to-br from-sky-500/10 via-cyan-500/5 to-indigo-500/10 p-4 animate-entrance"
                      style={{ animationDelay: "0.3s" }}
                    >
                      <div className="mb-3 flex items-center gap-2">
                        <span className="text-sky-300">🗄️</span>
                        <p className="text-sm font-semibold text-sky-100">
                          <Trans>Storage Locations</Trans>
                        </p>
                      </div>
                      <div className="space-y-3">
                        {[
                          {
                            id: "music-cache" as const,
                            storeKey: MUSIC_CACHE_ROOT_PATH_KEY,
                            title: t`Music Cache`,
                            description: t`Downloaded menu music and imported YouTube audio.`,
                            value: musicCacheRootPath,
                            fallback: t`Default app data folder`,
                          },
                          {
                            id: "website-video-cache" as const,
                            storeKey: WEBSITE_VIDEO_CACHE_ROOT_PATH_KEY,
                            title: t`Website Video Cache`,
                            description: t`Downloaded website videos and cache files.`,
                            value: websiteVideoCacheRootPath,
                            fallback: t`Default app data folder`,
                          },
                          {
                            id: "fpack-extraction" as const,
                            storeKey: FPACK_EXTRACTION_PATH_KEY,
                            title: t`.fpack Extraction`,
                            description: t`Persistent extracted contents from imported .fpack files.`,
                            value: fpackExtractionPath,
                            fallback: t`Default app data folder`,
                          },
                          {
                            id: "eroscripts-cache" as const,
                            storeKey: EROSCRIPTS_CACHE_ROOT_PATH_KEY,
                            title: t`EroScripts Extraction`,
                            description: t`Extracted videos and funscripts for the EroScripts service.`,
                            value: eroscriptsCacheRootPath,
                            fallback: t`Default app data folder`,
                          },
                          {
                            id: "acquisition-downloads" as const,
                            storeKey: "acquisition.downloadRootPath",
                            title: t`Torrent & MEGA Downloads`,
                            description: t`Downloaded files and partial torrent data.`,
                            value: acquisitionDownloadRootPath,
                            fallback: acquisitionResolvedDownloadRoot ?? t`Default app data folder`,
                          },
                        ].map((location) => {
                          const isPending = updatingStorageTarget === location.id;
                          return (
                            <div
                              key={location.id}
                              className="rounded-xl border border-white/10 bg-black/20 p-3"
                            >
                              <div className="flex flex-wrap items-center gap-2">
                                <p className="text-sm font-semibold text-white">{location.title}</p>
                                <p className="text-xs text-zinc-400">{location.description}</p>
                              </div>
                              <div className="mt-2 break-all font-[family-name:var(--font-jetbrains-mono)] text-xs text-zinc-300">
                                {isLoadingStorageSettings ? (
                                  <Trans>Loading...</Trans>
                                ) : (
                                  formatStoragePathDisplay(location.value, location.fallback)
                                )}
                              </div>
                              <div className="mt-3 flex flex-wrap gap-2">
                                <button
                                  type="button"
                                  disabled={isLoadingStorageSettings || isPending}
                                  onMouseEnter={playHoverSound}
                                  onClick={() => {
                                    playSelectSound();
                                    void updateStoragePath(location.id);
                                  }}
                                  className="rounded-xl border border-sky-400/50 bg-sky-500/20 px-4 py-2 text-sm font-semibold text-sky-100 transition-all hover:border-sky-300/70 hover:bg-sky-500/30 disabled:cursor-not-allowed disabled:opacity-50"
                                >
                                  {isPending ? (
                                    <Trans>Updating...</Trans>
                                  ) : (
                                    <Trans>Choose Folder</Trans>
                                  )}
                                </button>
                                <button
                                  type="button"
                                  disabled={
                                    isLoadingStorageSettings ||
                                    isPending ||
                                    !isStoragePathResettable(
                                      location.value,
                                      PORTABLE_DEFAULTS.get(location.storeKey) ?? null
                                    )
                                  }
                                  onMouseEnter={playHoverSound}
                                  onClick={() => {
                                    playSelectSound();
                                    void resetStoragePath(location.id);
                                  }}
                                  className="rounded-xl border border-zinc-500/50 bg-zinc-800/60 px-4 py-2 text-sm font-semibold text-zinc-200 transition-all hover:border-zinc-300/60 hover:bg-zinc-700/70 disabled:cursor-not-allowed disabled:opacity-50"
                                >
                                  <Trans>Use Default</Trans>
                                </button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* Booru Section */}
                  {currentStep.interactive === "booru" && (
                    <div
                      className="fs-interactive-panel mt-3 rounded-2xl border border-pink-400/30 bg-gradient-to-br from-pink-500/10 via-rose-500/5 to-fuchsia-500/10 p-4 animate-entrance"
                      style={{ animationDelay: "0.3s" }}
                    >
                      <div className="flex items-center gap-2 mb-2">
                        <span className="text-pink-400">🔍</span>
                        <p className="text-sm font-semibold text-pink-200">
                          <Trans>Search Prompt</Trans>
                        </p>
                      </div>
                      <p className="text-sm text-zinc-400">
                        <Trans>
                          This determines what media appears during loading. Keep the default if
                          unsure.
                        </Trans>
                      </p>
                      <textarea
                        id="first-start-booru-prompt"
                        value={booruPrompt}
                        disabled={isLoadingPrompt}
                        onChange={(event) => setBooruPrompt(event.target.value)}
                        className="mt-3 min-h-24 w-full rounded-xl border border-zinc-700/60 bg-zinc-900/60 px-3.5 py-3 text-sm text-white outline-none transition-all focus:border-pink-400/50 focus:ring-2 focus:ring-pink-400/20 disabled:opacity-60"
                        placeholder={t`Enter search prompt...`}
                      />
                    </div>
                  )}

                  {/* Background Phash Section */}
                  {currentStep.interactive === "phash" && (
                    <div
                      className="fs-interactive-panel mt-3 rounded-2xl border border-amber-400/30 bg-gradient-to-br from-amber-500/10 via-orange-500/5 to-yellow-500/10 p-4 animate-entrance"
                      style={{ animationDelay: "0.3s" }}
                    >
                      <div className="mb-2 flex items-center gap-2">
                        <span className="text-amber-300">🐢</span>
                        <p className="text-sm font-semibold text-amber-100">
                          <Trans>Background Hashing</Trans>
                        </p>
                      </div>
                      <p className="text-sm text-zinc-400">
                        <Trans>
                          Weak hardware: reduce rounds per pass, enable single-thread previews, or
                          turn off background hashing if startup or library work feels heavy.
                        </Trans>
                      </p>
                      <button
                        type="button"
                        disabled={
                          isLoadingBackgroundPhashScanningEnabled ||
                          isLoadingPhashPerformanceSettings ||
                          isApplyingWeakHardwareSettings
                        }
                        onMouseEnter={playHoverSound}
                        onClick={() => void applyWeakHardwarePerformanceSettings()}
                        className="mt-4 w-full rounded-xl border border-amber-300/45 bg-amber-500/20 px-4 py-3 text-left text-sm font-semibold text-amber-50 transition-all hover:border-amber-200/80 hover:bg-amber-500/30 disabled:cursor-not-allowed disabled:border-zinc-700 disabled:bg-zinc-900/60 disabled:text-zinc-500"
                      >
                        {isApplyingWeakHardwareSettings ? (
                          <Trans>Applying recommended weak hardware settings...</Trans>
                        ) : (
                          <Trans>Apply recommended settings for weak hardware</Trans>
                        )}
                      </button>
                      <label
                        htmlFor="first-start-background-phash-scanning"
                        className="mt-4 flex cursor-pointer items-start gap-3 rounded-xl border border-white/10 bg-black/20 px-4 py-3"
                      >
                        <input
                          id="first-start-background-phash-scanning"
                          type="checkbox"
                          role="switch"
                          aria-label={t`Enable background pHash scanning`}
                          checked={backgroundPhashScanningEnabled}
                          disabled={isLoadingBackgroundPhashScanningEnabled}
                          onChange={(event) => {
                            const next = event.target.checked;
                            setBackgroundPhashScanningEnabled(next);
                            void trpc.store.set.mutate({
                              key: BACKGROUND_PHASH_SCANNING_ENABLED_KEY,
                              value: next,
                            });
                          }}
                          className="mt-0.5 h-4 w-4 rounded border-zinc-600 bg-zinc-900 text-amber-400 focus:ring-amber-400/40"
                        />
                        <div className="space-y-1">
                          <p className="text-sm font-semibold text-white">
                            <Trans>Enable background pHash scanning</Trans>
                          </p>
                          <p className="text-xs leading-relaxed text-zinc-400">
                            <Trans>
                              Recommended on faster machines. Disable this if startup work or
                              background CPU load feels too heavy.
                            </Trans>
                          </p>
                        </div>
                      </label>
                      <div className="mt-3 rounded-xl border border-white/10 bg-black/20 px-4 py-3">
                        <label
                          htmlFor="first-start-background-phash-rounds-per-pass"
                          className="text-sm font-semibold text-white"
                        >
                          <Trans>Rounds per background pHash pass</Trans>
                        </label>
                        <p className="mt-1 text-xs leading-relaxed text-zinc-400">
                          <Trans>
                            Lower values reduce each automatic scan burst on weaker laptops. Higher
                            values finish background matching faster on stronger systems.
                          </Trans>
                        </p>
                        <input
                          id="first-start-background-phash-rounds-per-pass"
                          type="number"
                          min={MIN_BACKGROUND_PHASH_ROUNDS_PER_PASS}
                          max={MAX_BACKGROUND_PHASH_ROUNDS_PER_PASS}
                          value={backgroundPhashRoundsPerPass}
                          disabled={isLoadingPhashPerformanceSettings}
                          onChange={(event) => {
                            const next = normalizeBackgroundPhashRoundsPerPass(event.target.value);
                            setBackgroundPhashRoundsPerPass(next);
                            void trpc.store.set.mutate({
                              key: BACKGROUND_PHASH_ROUNDS_PER_PASS_KEY,
                              value: next,
                            });
                          }}
                          className="mt-3 w-full rounded-xl border border-zinc-700/60 bg-zinc-900/60 px-3.5 py-2 text-sm text-white outline-none transition-all focus:border-amber-400/50 focus:ring-2 focus:ring-amber-400/20 disabled:opacity-60"
                        />
                      </div>
                      <label
                        htmlFor="first-start-preview-ffmpeg-single-thread"
                        className="mt-3 flex cursor-pointer items-start gap-3 rounded-xl border border-white/10 bg-black/20 px-4 py-3"
                      >
                        <input
                          id="first-start-preview-ffmpeg-single-thread"
                          type="checkbox"
                          role="switch"
                          aria-label={t`Limit preview ffmpeg to one thread`}
                          checked={previewFfmpegSingleThreadEnabled}
                          disabled={isLoadingPhashPerformanceSettings}
                          onChange={(event) => {
                            const next = event.target.checked;
                            setPreviewFfmpegSingleThreadEnabled(next);
                            void trpc.store.set.mutate({
                              key: PREVIEW_FFMPEG_SINGLE_THREAD_ENABLED_KEY,
                              value: next,
                            });
                          }}
                          className="mt-0.5 h-4 w-4 rounded border-zinc-600 bg-zinc-900 text-amber-400 focus:ring-amber-400/40"
                        />
                        <div className="space-y-1">
                          <p className="text-sm font-semibold text-white">
                            <Trans>Limit preview ffmpeg to one thread</Trans>
                          </p>
                          <p className="text-xs leading-relaxed text-zinc-400">
                            <Trans>
                              Recommended on weak hardware if preview generation causes stutters.
                              Leave it off for faster imports on stronger machines.
                            </Trans>
                          </p>
                        </div>
                      </label>
                    </div>
                  )}

                  {/* Handy Section */}
                  {currentStep.interactive === "handy" && (
                    <div
                      className="fs-interactive-panel mt-3 rounded-2xl border border-emerald-400/30 bg-gradient-to-br from-emerald-500/10 via-green-500/5 to-teal-500/10 p-4 animate-entrance"
                      style={{ animationDelay: "0.3s" }}
                    >
                      <div className="flex items-center gap-2 mb-2">
                        <span className="text-emerald-400">🔌</span>
                        <p className="text-sm font-semibold text-emerald-200">
                          <Trans>Device Connection</Trans>
                        </p>
                        {handyConnected && (
                          <span className="ml-auto rounded-full bg-emerald-500/20 px-2 py-0.5 text-[10px] font-medium text-emerald-300">
                            <Trans>Connected</Trans>
                          </span>
                        )}
                      </div>
                      <p className="text-sm text-zinc-400">
                        <Trans>
                          Connect a haptics device for synchronized motion. Choose TheHandy,
                          Intiface, or TCode below.
                        </Trans>
                      </p>

                      <div className="mt-3 grid gap-2 sm:grid-cols-2">
                        <button
                          type="button"
                          disabled={handyConnected || handyIsConnecting}
                          onClick={() => {
                            playSelectSound();
                            void setHandyProvider("thehandy");
                          }}
                          className={`rounded-xl border px-4 py-3 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                            handyProvider === "thehandy"
                              ? "border-violet-300/60 bg-violet-500/30 text-violet-100"
                              : "border-zinc-700 bg-zinc-950 text-zinc-300 hover:bg-zinc-900"
                          }`}
                        >
                          <Trans>TheHandy</Trans>
                        </button>
                        <button
                          type="button"
                          disabled={handyConnected || handyIsConnecting}
                          onClick={() => {
                            playSelectSound();
                            void setHandyProvider("intiface");
                          }}
                          className={`rounded-xl border px-4 py-3 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                            handyProvider === "intiface"
                              ? "border-cyan-300/60 bg-cyan-500/25 text-cyan-100"
                              : "border-zinc-700 bg-zinc-950 text-zinc-300 hover:bg-zinc-900"
                          }`}
                        >
                          <Trans>Intiface</Trans>
                        </button>
                        <button
                          type="button"
                          disabled={handyConnected || handyIsConnecting}
                          onClick={() => {
                            playSelectSound();
                            void setHandyProvider("tcode");
                          }}
                          className={`rounded-xl border px-4 py-3 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                            handyProvider === "tcode"
                              ? "border-emerald-300/60 bg-emerald-500/25 text-emerald-100"
                              : "border-zinc-700 bg-zinc-950 text-zinc-300 hover:bg-zinc-900"
                          }`}
                        >
                          <Trans>TCode</Trans>
                        </button>
                      </div>

                      {handyProvider === "intiface" ? (
                        <>
                          <div className="mt-3 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-200">
                            <p className="font-bold uppercase tracking-wider">
                              <Trans>Experimental Support</Trans>
                            </p>
                            <p className="mt-1 leading-relaxed">
                              <Trans>
                                Intiface support is experimental. A direct TheHandy connection is
                                always preferred for performance.
                              </Trans>
                            </p>
                          </div>
                          <div className="mt-3 flex flex-col gap-2">
                            <label
                              className="ml-1 font-[family-name:var(--font-jetbrains-mono)] text-xs font-bold uppercase tracking-wider text-zinc-300"
                              htmlFor="first-start-intiface-url"
                            >
                              <Trans>Intiface WebSocket URL</Trans>
                            </label>
                            <input
                              id="first-start-intiface-url"
                              type="text"
                              value={inputIntifaceUrl}
                              onChange={(event) => setInputIntifaceUrl(event.target.value)}
                              placeholder={DEFAULT_INTIFACE_WEBSOCKET_URL}
                              disabled={handyConnected || handyIsConnecting}
                              className="rounded-xl border border-zinc-700/60 bg-zinc-900/60 px-3.5 py-3 text-sm text-white outline-none transition-all focus:border-cyan-400/50 focus:ring-2 focus:ring-cyan-400/20 disabled:opacity-60"
                            />
                          </div>
                          <p className="mt-2 text-xs text-zinc-400">
                            <Trans>
                              Start Intiface Central, start its server, then connect to a
                              linear/position- or vibration-capable device.
                            </Trans>
                          </p>
                          {intifaceDeviceName && handyConnected && (
                            <p className="mt-1 text-xs text-cyan-100">
                              <Trans>Selected device</Trans>: {intifaceDeviceName}
                            </p>
                          )}
                        </>
                      ) : handyProvider === "tcode" ? (
                        <>
                          <div className="mt-3 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-200">
                            <p className="font-bold uppercase tracking-wider">
                              <Trans>Experimental Support</Trans>
                            </p>
                            <p className="mt-1 leading-relaxed">
                              <Trans>
                                TCode support connects to TCodeESP32 over WebSocket and streams the
                                primary funscript to L0.
                              </Trans>
                            </p>
                          </div>

                          <div className="mt-3 grid gap-2 sm:grid-cols-3">
                            <button
                              type="button"
                              disabled={handyConnected || handyIsConnecting}
                              onClick={() => {
                                playSelectSound();
                                setInputTCodeTransport("websocket");
                              }}
                              className={`rounded-lg border px-3 py-2 text-xs font-semibold uppercase tracking-[0.15em] transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                                inputTCodeTransport === "websocket"
                                  ? "border-emerald-300/60 bg-emerald-500/25 text-emerald-100"
                                  : "border-zinc-700 bg-zinc-950 text-zinc-300 hover:bg-zinc-900"
                              }`}
                            >
                              <Trans>WebSocket</Trans>
                            </button>
                            <button
                              type="button"
                              disabled={handyConnected || handyIsConnecting}
                              onClick={() => {
                                playSelectSound();
                                setInputTCodeTransport("udp");
                              }}
                              className={`rounded-lg border px-3 py-2 text-xs font-semibold uppercase tracking-[0.15em] transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                                inputTCodeTransport === "udp"
                                  ? "border-emerald-300/60 bg-emerald-500/25 text-emerald-100"
                                  : "border-zinc-700 bg-zinc-950 text-zinc-300 hover:bg-zinc-900"
                              }`}
                            >
                              <Trans>UDP</Trans>
                            </button>
                            <button
                              type="button"
                              disabled={handyConnected || handyIsConnecting}
                              onClick={() => {
                                playSelectSound();
                                setInputTCodeTransport("serial");
                                void refreshTCodeSerialPorts();
                              }}
                              className={`rounded-lg border px-3 py-2 text-xs font-semibold uppercase tracking-[0.15em] transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                                inputTCodeTransport === "serial"
                                  ? "border-emerald-300/60 bg-emerald-500/25 text-emerald-100"
                                  : "border-zinc-700 bg-zinc-950 text-zinc-300 hover:bg-zinc-900"
                              }`}
                            >
                              <Trans>Serial</Trans>
                            </button>
                          </div>

                          {inputTCodeTransport === "serial" ? (
                            <div className="mt-3 grid gap-3 sm:grid-cols-[1fr_auto]">
                              <div className="flex flex-col gap-2">
                                <label
                                  className="ml-1 font-[family-name:var(--font-jetbrains-mono)] text-xs font-bold uppercase tracking-wider text-zinc-300"
                                  htmlFor="first-start-tcode-serial-port"
                                >
                                  <Trans>Serial Port</Trans>
                                </label>
                                <select
                                  id="first-start-tcode-serial-port"
                                  value={inputTCodeSerialPath}
                                  onChange={(event) => setInputTCodeSerialPath(event.target.value)}
                                  disabled={handyConnected || handyIsConnecting}
                                  className="rounded-xl border border-zinc-700/60 bg-zinc-900/60 px-3.5 py-3 text-sm text-white outline-none transition-all focus:border-emerald-400/50 focus:ring-2 focus:ring-emerald-400/20 disabled:opacity-60"
                                >
                                  <option value="">{t`Select serial port`}</option>
                                  {tcodeSerialPorts.map((port) => (
                                    <option key={port.path} value={port.path}>
                                      {port.path}
                                      {port.manufacturer ? ` (${port.manufacturer})` : ""}
                                    </option>
                                  ))}
                                </select>
                              </div>
                              <button
                                type="button"
                                disabled={
                                  handyConnected || handyIsConnecting || tcodeSerialPortsLoading
                                }
                                onClick={() => void refreshTCodeSerialPorts()}
                                className="self-end rounded-xl border border-emerald-300/40 bg-emerald-500/15 px-4 py-3 text-xs font-semibold uppercase tracking-[0.15em] text-emerald-100 transition-colors hover:bg-emerald-500/25 disabled:cursor-not-allowed disabled:opacity-50"
                              >
                                {tcodeSerialPortsLoading ? t`Refreshing...` : t`Refresh`}
                              </button>
                              <div className="flex flex-col gap-2 sm:col-span-2">
                                <label
                                  className="ml-1 font-[family-name:var(--font-jetbrains-mono)] text-xs font-bold uppercase tracking-wider text-zinc-300"
                                  htmlFor="first-start-tcode-baud-rate"
                                >
                                  <Trans>Baud Rate</Trans>
                                </label>
                                <input
                                  id="first-start-tcode-baud-rate"
                                  type="number"
                                  value={inputTCodeBaudRate}
                                  onChange={(event) => setInputTCodeBaudRate(event.target.value)}
                                  placeholder={String(DEFAULT_TCODE_BAUD_RATE)}
                                  disabled={handyConnected || handyIsConnecting}
                                  className="rounded-xl border border-zinc-700/60 bg-zinc-900/60 px-3.5 py-3 text-sm text-white outline-none transition-all focus:border-emerald-400/50 focus:ring-2 focus:ring-emerald-400/20 disabled:opacity-60"
                                />
                              </div>
                            </div>
                          ) : inputTCodeTransport === "udp" ? (
                            <div className="mt-3 flex flex-col gap-2">
                              <label
                                className="ml-1 font-[family-name:var(--font-jetbrains-mono)] text-xs font-bold uppercase tracking-wider text-zinc-300"
                                htmlFor="first-start-tcode-udp-host"
                              >
                                <Trans>Device IP / Host</Trans>
                              </label>
                              <input
                                id="first-start-tcode-udp-host"
                                type="text"
                                value={inputTCodeUdpHost}
                                onChange={(event) => setInputTCodeUdpHost(event.target.value)}
                                placeholder={`${DEFAULT_TCODE_UDP_HOST}:${DEFAULT_TCODE_UDP_PORT}`}
                                disabled={handyConnected || handyIsConnecting}
                                className="rounded-xl border border-zinc-700/60 bg-zinc-900/60 px-3.5 py-3 text-sm text-white outline-none transition-all focus:border-emerald-400/50 focus:ring-2 focus:ring-emerald-400/20 disabled:opacity-60"
                              />
                              <p className="text-xs text-zinc-400">
                                <Trans>Derived UDP endpoint</Trans>: {tcodeDerivedUdpEndpoint}
                              </p>
                            </div>
                          ) : (
                            <div className="mt-3 flex flex-col gap-2">
                              <label
                                className="ml-1 font-[family-name:var(--font-jetbrains-mono)] text-xs font-bold uppercase tracking-wider text-zinc-300"
                                htmlFor="first-start-tcode-host"
                              >
                                <Trans>Device IP / Host</Trans>
                              </label>
                              <input
                                id="first-start-tcode-host"
                                type="text"
                                value={inputTCodeHost}
                                onChange={(event) => setInputTCodeHost(event.target.value)}
                                placeholder={DEFAULT_TCODE_WEBSOCKET_HOST}
                                disabled={handyConnected || handyIsConnecting}
                                className="rounded-xl border border-zinc-700/60 bg-zinc-900/60 px-3.5 py-3 text-sm text-white outline-none transition-all focus:border-emerald-400/50 focus:ring-2 focus:ring-emerald-400/20 disabled:opacity-60"
                              />
                              <p className="text-xs text-zinc-400">
                                <Trans>Derived WebSocket URL</Trans>: {tcodeDerivedUrl}
                              </p>
                              {tcodeWebsocketUrl && handyConnected && (
                                <p className="text-xs text-emerald-100">
                                  <Trans>Connected TCode URL</Trans>: {tcodeWebsocketUrl}
                                </p>
                              )}
                            </div>
                          )}

                          <div className="mt-3 flex flex-col gap-2">
                            <label
                              className="ml-1 font-[family-name:var(--font-jetbrains-mono)] text-xs font-bold uppercase tracking-wider text-zinc-300"
                              htmlFor="first-start-tcode-precision"
                            >
                              <Trans>TCode Version</Trans>
                            </label>
                            <select
                              id="first-start-tcode-precision"
                              value={inputTCodePrecision}
                              onChange={(event) =>
                                setInputTCodePrecision(event.target.value === "3" ? 3 : 4)
                              }
                              disabled={handyConnected || handyIsConnecting}
                              className="rounded-xl border border-zinc-700/60 bg-zinc-900/60 px-3.5 py-3 text-sm text-white outline-none transition-all focus:border-emerald-400/50 focus:ring-2 focus:ring-emerald-400/20 disabled:opacity-60"
                            >
                              <option value={4}>{t`TCode v0.3 / 4 digit`}</option>
                              <option value={3}>{t`TCode v0.2 / 3 digit`}</option>
                            </select>
                          </div>
                        </>
                      ) : (
                        <>
                          <div className="mt-3 flex flex-col gap-2">
                            <label
                              className="ml-1 font-[family-name:var(--font-jetbrains-mono)] text-xs font-bold uppercase tracking-wider text-zinc-300"
                              htmlFor="first-start-handy-key"
                            >
                              <Trans>Connection Key</Trans>
                            </label>
                            <input
                              id="first-start-handy-key"
                              type="text"
                              value={handyInputKey}
                              onChange={(event) => setHandyInputKey(event.target.value)}
                              placeholder={t`Enter connection key from Handy app`}
                              disabled={handyConnected || handyIsConnecting}
                              className="rounded-xl border border-zinc-700/60 bg-zinc-900/60 px-3.5 py-3 text-sm text-white outline-none transition-all focus:border-emerald-400/50 focus:ring-2 focus:ring-emerald-400/20 disabled:opacity-60"
                            />
                          </div>
                          <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-2.5 mt-3 text-xs font-[family-name:var(--font-jetbrains-mono)] text-amber-200">
                            <Trans>Only firmware version 4 and up is supported.</Trans>
                          </div>
                        </>
                      )}

                      {handyError && (
                        <div className="mt-3 flex items-start gap-2 rounded-xl border border-red-400/30 bg-red-500/10 px-3 py-2.5 text-sm text-red-200">
                          <span>⚠</span>
                          <span>{handyError}</span>
                        </div>
                      )}
                      <button
                        type="button"
                        disabled={
                          handyIsConnecting ||
                          (!handyConnected &&
                            (handyProvider === "thehandy"
                              ? !handyInputKey.trim()
                              : handyProvider === "intiface"
                                ? !inputIntifaceUrl.trim()
                                : inputTCodeTransport === "serial"
                                  ? !inputTCodeSerialPath.trim()
                                  : inputTCodeTransport === "udp"
                                    ? !inputTCodeUdpHost.trim()
                                    : !inputTCodeHost.trim()))
                        }
                        onMouseEnter={playHoverSound}
                        onClick={() => {
                          playSelectSound();
                          void handleHandyConnect();
                        }}
                        className={`mt-3 flex items-center gap-2 rounded-xl border px-4 py-2.5 text-sm font-semibold transition-all ${
                          handyIsConnecting
                            ? "cursor-not-allowed border-zinc-600/50 bg-zinc-800/50 text-zinc-500"
                            : handyConnected
                              ? "border-rose-400/50 bg-rose-500/20 text-rose-100 hover:border-rose-300/70 hover:bg-rose-500/30"
                              : "border-emerald-400/50 bg-emerald-500/20 text-emerald-100 hover:border-emerald-300/70 hover:bg-emerald-500/30 hover:shadow-[0_0_20px_rgba(16,185,129,0.3)]"
                        }`}
                      >
                        {handyIsConnecting ? (
                          <>
                            <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-emerald-400/30 border-t-emerald-300" />
                            <span>
                              <Trans>Connecting...</Trans>
                            </span>
                          </>
                        ) : handyConnected ? (
                          <>
                            <span>⏹</span>
                            <span>
                              <Trans>Disconnect</Trans>
                            </span>
                          </>
                        ) : (
                          <>
                            <span>🔌</span>
                            <span>
                              <Trans>Connect</Trans>
                            </span>
                          </>
                        )}
                      </button>
                    </div>
                  )}
                </div>
              </div>

              {/* ── Footer Navigation ── */}
              <div className="mt-4 flex flex-col gap-3 border-t border-zinc-800/60 pt-4 sm:flex-row sm:items-center sm:justify-between">
                <button
                  type="button"
                  disabled={stepIndex === 0}
                  onMouseEnter={playHoverSound}
                  onClick={() => {
                    playSelectSound();
                    setStepIndex((current) => Math.max(0, current - 1));
                  }}
                  className={`group flex items-center gap-2 rounded-xl border px-4 py-2.5 text-sm font-semibold transition-all ${
                    stepIndex === 0
                      ? "cursor-not-allowed border-zinc-800/50 bg-zinc-900/30 text-zinc-600"
                      : "border-zinc-600/40 bg-zinc-900/60 text-zinc-300 hover:border-zinc-500/60 hover:bg-zinc-800/80 hover:text-white"
                  }`}
                >
                  <span
                    className={`transition-transform ${stepIndex === 0 ? "" : "group-hover:-translate-x-1"}`}
                  >
                    ←
                  </span>
                  <span>
                    <Trans>Back</Trans>
                  </span>
                </button>

                <div className="flex flex-wrap gap-2 sm:justify-end">
                  <button
                    type="button"
                    disabled={isSkipping}
                    onMouseEnter={playHoverSound}
                    onClick={() => {
                      playSelectSound();
                      void skip();
                    }}
                    className={`flex items-center gap-2 rounded-xl border px-4 py-2.5 text-sm font-semibold transition-all ${
                      isSkipping
                        ? "cursor-not-allowed border-zinc-600/50 bg-zinc-800/50 text-zinc-500"
                        : "border-zinc-600/40 bg-zinc-900/60 text-zinc-400 hover:border-zinc-500/60 hover:bg-zinc-800/80 hover:text-zinc-200"
                    }`}
                  >
                    <span>⏭</span>
                    <span>
                      <Trans>Skip All</Trans>
                    </span>
                  </button>
                  <button
                    type="button"
                    disabled={isContinueDisabled}
                    onMouseEnter={playHoverSound}
                    onClick={() => {
                      playSelectSound();
                      void goNext();
                    }}
                    className={`fs-continue-btn group relative flex items-center gap-2 overflow-hidden rounded-xl border px-5 py-2.5 text-sm font-semibold transition-all ${
                      isContinueDisabled
                        ? "cursor-not-allowed border-zinc-700/50 bg-zinc-800/50 text-zinc-500"
                        : "border-violet-400/50 bg-gradient-to-r from-violet-600/80 via-purple-600/80 to-indigo-600/80 text-white hover:border-violet-300/70 hover:shadow-[0_0_25px_rgba(139,92,246,0.4)]"
                    }`}
                  >
                    <span className="absolute inset-0 bg-gradient-to-r from-violet-500/0 via-white/10 to-violet-500/0 translate-x-[-100%] group-hover:translate-x-[100%] transition-transform duration-700" />
                    <span>
                      {isLastStep ? (
                        search.returnTo === "settings" ? (
                          <Trans>Finish</Trans>
                        ) : (
                          <Trans>Start Playing</Trans>
                        )
                      ) : (
                        <Trans>Continue</Trans>
                      )}
                    </span>
                    <span
                      className={`transition-transform ${isContinueDisabled ? "" : "group-hover:translate-x-1"}`}
                    >
                      →
                    </span>
                  </button>
                </div>
              </div>
            </section>
          </div>
        </div>
      </div>
    </div>
  );
}
