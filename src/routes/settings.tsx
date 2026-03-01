import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import type { I18n } from "@lingui/core";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Trans, useLingui } from "@lingui/react/macro";
import ReactMarkdown from "react-markdown";
import changelogMarkdown from "../content/changelog.md?raw";
import { AnimatedBackground } from "../components/AnimatedBackground";
import { AntiPerkBeatbar } from "../components/game/AntiPerkBeatbar";
import { HandyStrokeRangeControl } from "../components/HandyStrokeRangeControl";
import { MenuButton } from "../components/MenuButton";
import {
  ClearDataDialog,
  DEFAULT_CLEAR_DATA_SELECTIONS,
  type ClearDataSelections,
} from "../components/ClearDataDialog";
import { ConfirmDialog } from "../components/ui/ConfirmDialog";
import { GameDropdown } from "../components/ui/GameDropdown";
import { useToast } from "../components/ui/ToastHost";
import { useControllerSurface } from "../controller";
import {
  DEFAULT_THEHANDY_APP_API_KEY,
  THEHANDY_OFFSET_FINE_STEP_MS,
  THEHANDY_OFFSET_MAX_MS,
  THEHANDY_OFFSET_MIN_MS,
  THEHANDY_OFFSET_STEP_MS,
} from "../constants/theHandy";
import {
  DEFAULT_INTIFACE_WEBSOCKET_URL,
  DEFAULT_TCODE_BAUD_RATE,
  DEFAULT_TCODE_WEBSOCKET_HOST,
  DEFAULT_TCODE_WEBSOCKET_URL,
  INTIFACE_DOWNLOAD_URL,
  INTIFACE_VIBRATION_SENSITIVITY_MAX,
  INTIFACE_VIBRATION_SENSITIVITY_MIN,
  INTIFACE_VIBRATION_SENSITIVITY_STEP,
} from "../constants/haptics";
import {
  normalizeTCodeBaudRate,
  normalizeTCodeWebSocketInput,
} from "../services/haptics/tcodeConfig";
import {
  DEFAULT_FUNSCRIPT_MAX_RATE,
  DEFAULT_FUNSCRIPT_RDP_EPSILON,
  FUNSCRIPT_MAX_RATE_MAX,
  FUNSCRIPT_MAX_RATE_MIN,
  FUNSCRIPT_RDP_EPSILON_MAX,
  FUNSCRIPT_RDP_EPSILON_MIN,
  normalizeFunscriptMaxRate,
  normalizeFunscriptRdpEpsilon,
} from "../services/haptics/funscriptRateLimiter";
import {
  DEFAULT_MUSIC_LOOP_MODE,
  DEFAULT_MUSIC_VOLUME,
  type MusicLoopMode,
} from "../constants/musicSettings";
import { DEFAULT_MOANING_VOLUME } from "../constants/moaningSettings";
import { useHandy } from "../contexts/HandyContext";
import {
  HAPTICS_TEST_ACTIONS,
  HAPTICS_TEST_BEATBAR_BEATS,
  HAPTICS_TEST_BEATBAR_STYLE,
  HAPTICS_TEST_PERIOD_MS,
} from "../constants/hapticsTest";
import { useGlobalMusic } from "../hooks/useGlobalMusic";
import { useGameplayMoaning } from "../hooks/useGameplayMoaning";
import { useAppUpdate } from "../hooks/useAppUpdate";
import { useIdleScreenPerformance } from "../hooks/useIdleScreenPerformance";
import { useSfwMode } from "../hooks/useSfwMode";
import { formatHandyStrokeBoundPercent } from "../services/theHandyConfig";
import { clearBooruMediaCache, ensureBooruMediaCache } from "../services/booru";
import { db, type PhashScanStatus, type WebsiteVideoScanStatus } from "../services/db";
import {
  integrations,
  type ExternalSource,
  type IntegrationSyncStatus,
  type StashTagResult,
} from "../services/integrations";
import { security } from "../services/security";
import { trpc } from "../services/trpc";
import {
  acquisition,
  type AcquisitionFile,
  type AcquisitionJob,
  type AcquisitionSettings,
  type AcquisitionSource,
} from "../services/acquisition";
import { useLocale } from "../i18n";
import { playHoverSound, playSelectSound } from "../utils/audio";
import { abbreviateNsfwText } from "../utils/sfwText";
import {
  normalizeVideoHashFfmpegSourcePreference,
  VIDEOHASH_FFMPEG_SOURCE_PREFERENCE_KEY,
  type VideoHashFfmpegSourcePreference,
} from "../constants/videohashSettings";
import {
  DEFAULT_YT_DLP_BINARY_PREFERENCE,
  normalizeYtDlpBinaryPreference,
  YT_DLP_BINARY_PREFERENCE_KEY,
  type YtDlpBinaryPreference,
} from "../constants/ytDlpSettings";
import {
  BACKGROUND_VIDEO_ENABLED_EVENT,
  BACKGROUND_VIDEO_ENABLED_KEY,
  DEFAULT_BACKGROUND_VIDEO_ENABLED,
} from "../constants/backgroundSettings";
import {
  DEFAULT_MENU_THEME_ID,
  MAIN_MENU_THEMES,
  MENU_THEME_CHANGED_EVENT,
  MENU_THEME_KEY,
  normalizeMainMenuThemeId,
  type MainMenuThemeId,
} from "../constants/menuThemeSettings";
import {
  AUTOFIX_BROKEN_FUNSCRIPTS_KEY,
  DEFAULT_AUTOFIX_BROKEN_FUNSCRIPTS,
  DEFAULT_STASH_REATTACH_FUNSCRIPTS_MODE,
  STASH_REATTACH_FUNSCRIPTS_ENABLED_KEY,
  type StashReattachFunscriptsMode,
  normalizeAutofixBrokenFunscripts,
  normalizeStashReattachFunscriptsMode,
} from "../constants/funscriptSettings";
import {
  ANTI_PERK_BEATBAR_ENABLED_KEY,
  DEFAULT_ANTI_PERK_BEATBAR_ENABLED,
  DEFAULT_GAMEPLAY_HAPTICS_PERKS_WITHOUT_DEVICE,
  DEFAULT_HAPTICS_DISCONNECTED_STATUS_VISIBLE,
  DEFAULT_ROUND_PROGRESS_BAR_ALWAYS_VISIBLE,
  GAMEPLAY_HAPTICS_PERKS_WITHOUT_DEVICE_KEY,
  HAPTICS_DISCONNECTED_STATUS_VISIBLE_KEY,
  ROUND_PROGRESS_BAR_ALWAYS_VISIBLE_KEY,
  normalizeAntiPerkBeatbarEnabled,
  normalizeGameplayHapticsPerksWithoutDevice,
  normalizeHapticsDisconnectedStatusVisible,
  normalizeRoundProgressBarAlwaysVisible,
} from "../constants/roundVideoOverlaySettings";
import { DEFAULT_INTERMEDIARY_LOADING_PROMPT } from "../constants/booruSettings";
import {
  CONTROLLER_SUPPORT_ENABLED_EVENT,
  CONTROLLER_SUPPORT_ENABLED_KEY,
  DEFAULT_CONTROLLER_SUPPORT_ENABLED,
  normalizeControllerSupportEnabled,
  FPS_COUNTER_ENABLED_EVENT,
  FPS_COUNTER_ENABLED_KEY,
  DEFAULT_FPS_COUNTER_ENABLED,
  normalizeFpsCounterEnabled,
  CHEAT_MODE_ENABLED_EVENT,
  CHEAT_MODE_ENABLED_KEY,
  DEFAULT_CHEAT_MODE_ENABLED,
  normalizeCheatModeEnabled,
  SFW_MODE_ENABLED_EVENT,
  SFW_MODE_ENABLED_KEY,
  DEFAULT_SFW_MODE_ENABLED,
  normalizeSfwModeEnabled,
  MULTIPLAYER_SKIP_ROUNDS_CHECK_EVENT,
  MULTIPLAYER_SKIP_ROUNDS_CHECK_KEY,
  DEFAULT_MULTIPLAYER_SKIP_ROUNDS_CHECK,
  normalizeMultiplayerSkipRoundsCheck,
  INSTALL_WEB_FUNSCRIPT_URL_ENABLED_KEY,
  DEFAULT_INSTALL_WEB_FUNSCRIPT_URL_ENABLED,
  normalizeInstallWebFunscriptUrlEnabled,
  SYSTEM_LANGUAGE_ENABLED_KEY,
  DEFAULT_SYSTEM_LANGUAGE_ENABLED,
  normalizeSystemLanguageEnabled,
  PLAYLIST_CACHE_ONGOING_RESTRICTION_DISABLED_KEY,
  DEFAULT_PLAYLIST_CACHE_ONGOING_RESTRICTION_DISABLED,
  normalizePlaylistCacheOngoingRestrictionDisabled,
  IGNORE_PLAYLIST_LEVEL_REQUIREMENTS_EVENT,
  IGNORE_PLAYLIST_LEVEL_REQUIREMENTS_KEY,
  DEFAULT_IGNORE_PLAYLIST_LEVEL_REQUIREMENTS,
  normalizeIgnorePlaylistLevelRequirements,
  STARTUP_SAFE_MODE_SHORTCUT_ENABLED_KEY,
  DEFAULT_STARTUP_SAFE_MODE_SHORTCUT_ENABLED,
  normalizeStartupSafeModeShortcutEnabled,
  DEVICE_ANIMATION_TEST_ENABLED_KEY,
  DEFAULT_DEVICE_ANIMATION_TEST_ENABLED,
  normalizeDeviceAnimationTestEnabled,
} from "../constants/experimentalFeatures";
import {
  SFX_VOLUME_CHANGED_EVENT,
  SFX_VOLUME_KEY,
  DEFAULT_SFX_VOLUME,
  clampSfxVolume,
} from "../constants/audioSettings";
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
import {
  DATABASE_BACKUP_ENABLED_KEY,
  DATABASE_BACKUP_FREQUENCY_DAYS_KEY,
  DATABASE_BACKUP_RETENTION_DAYS_KEY,
  DEFAULT_DATABASE_BACKUP_ENABLED,
  DEFAULT_DATABASE_BACKUP_FREQUENCY_DAYS,
  DEFAULT_DATABASE_BACKUP_RETENTION_DAYS,
  MAX_DATABASE_BACKUP_FREQUENCY_DAYS,
  MAX_DATABASE_BACKUP_RETENTION_DAYS,
  MIN_DATABASE_BACKUP_FREQUENCY_DAYS,
  MIN_DATABASE_BACKUP_RETENTION_DAYS,
  normalizeDatabaseBackupEnabled,
  normalizeDatabaseBackupFrequencyDays,
  normalizeDatabaseBackupRetentionDays,
} from "../constants/databaseBackupSettings";
import { WEBSITE_VIDEO_CACHE_ROOT_PATH_KEY } from "../constants/websiteVideoCacheSettings";
import { EROSCRIPTS_CACHE_ROOT_PATH_KEY } from "../constants/eroscriptsSettings";
import { MUSIC_CACHE_ROOT_PATH_KEY } from "../constants/musicSettings";
import { FPACK_EXTRACTION_PATH_KEY } from "../constants/fpackSettings";
import {
  DEFAULT_UPDATE_CHANNEL,
  UPDATE_CHANNEL_CHANGED_EVENT,
  UPDATE_CHANNEL_KEY,
  normalizeUpdateChannel,
  type UpdateChannel,
} from "../constants/updateSettings";
import {
  DEBUG_LOG_LEVELS,
  DEBUG_LOG_LEVEL_KEY,
  normalizeDebugLogLevel,
  type DebugLogLevel,
  FFMPEG_GPU_PREFERENCE_KEY,
  DEFAULT_FFMPEG_GPU_PREFERENCE,
  normalizeFfmpegGpuPreference,
  type FfmpegGpuPreference,
} from "../constants/debugSettings";
import {
  ALWAYS_RECOVERY_MODE_KEY,
  normalizeAlwaysRecoveryMode,
} from "../constants/startupSettings";
import {
  DEFAULT_GRAPHICS_DISABLE_ACCELERATED_VIDEO_DECODE_ENABLED,
  DEFAULT_GRAPHICS_DISABLE_ACCELERATED_VIDEO_ENCODE_ENABLED,
  DEFAULT_GRAPHICS_DISABLE_GPU_BLOCKLIST_OVERRIDE_ENABLED,
  DEFAULT_GRAPHICS_DISABLE_GPU_COMPOSITING_ENABLED,
  DEFAULT_GRAPHICS_DISABLE_GPU_RASTERIZATION_ENABLED,
  DEFAULT_GRAPHICS_DISABLE_GPU_SHADER_DISK_CACHE_ENABLED,
  DEFAULT_GRAPHICS_DISABLE_GPU_VSYNC_ENABLED,
  DEFAULT_GRAPHICS_DISABLE_WEBGL2_ENABLED,
  DEFAULT_GRAPHICS_DISABLE_ZERO_COPY_ENABLED,
  DEFAULT_GRAPHICS_FORCE_ANGLE_OPENGL_ENABLED,
  DEFAULT_GRAPHICS_SAFE_MODE_ENABLED,
  GRAPHICS_DISABLE_ACCELERATED_VIDEO_DECODE_ENABLED_KEY,
  GRAPHICS_DISABLE_ACCELERATED_VIDEO_ENCODE_ENABLED_KEY,
  GRAPHICS_DISABLE_GPU_BLOCKLIST_OVERRIDE_ENABLED_KEY,
  GRAPHICS_DISABLE_GPU_COMPOSITING_ENABLED_KEY,
  GRAPHICS_DISABLE_GPU_RASTERIZATION_ENABLED_KEY,
  GRAPHICS_DISABLE_GPU_SHADER_DISK_CACHE_ENABLED_KEY,
  GRAPHICS_DISABLE_GPU_VSYNC_ENABLED_KEY,
  GRAPHICS_DISABLE_WEBGL2_ENABLED_KEY,
  GRAPHICS_DISABLE_ZERO_COPY_ENABLED_KEY,
  GRAPHICS_FORCE_ANGLE_OPENGL_ENABLED_KEY,
  GRAPHICS_SAFE_MODE_ENABLED_KEY,
  normalizeGraphicsBoolean,
} from "../constants/graphicsSettings";
import { CONVERTER_SHORTCUTS } from "../features/converter/shortcuts";
import { progression } from "../services/progression";
import { formatStoragePathDisplay, isStoragePathResettable } from "../utils/storagePath";

const PORTABLE_DEFAULTS: ReadonlyMap<string, string> = new Map([
  [WEBSITE_VIDEO_CACHE_ROOT_PATH_KEY, "web-video-cache"],
  [MUSIC_CACHE_ROOT_PATH_KEY, "music-cache"],
  [EROSCRIPTS_CACHE_ROOT_PATH_KEY, "eroscripts-cache"],
  [FPACK_EXTRACTION_PATH_KEY, "fpacks"],
]);

const INTERMEDIARY_LOADING_PROMPT_KEY = "game.intermediary.loadingPrompt";
const INTERMEDIARY_LOADING_DURATION_KEY = "game.intermediary.loadingDurationSec";
const INTERMEDIARY_RETURN_PAUSE_KEY = "game.intermediary.returnPauseSec";
const APPLY_PERK_DIRECTLY_KEY = "game.singleplayer.applyPerkDirectly";
const DEFAULT_INTERMEDIARY_LOADING_DURATION_SEC = 5;
const DEFAULT_INTERMEDIARY_RETURN_PAUSE_SEC = 4;
const DEFAULT_APPLY_PERK_DIRECTLY = true;
const ACTIVE_STASH_VERSION = "30.1";
const LEGACY_LOGIN_AUTH_VALUE = "__legacy_login__";
const HANDY_USER_PORTAL_URL = "https://user.handyfeeling.com";
type EroScriptsLoginStatus = Awaited<ReturnType<typeof trpc.eroscripts.getLoginStatus.query>>;
type BinaryDiagnostics = Awaited<ReturnType<typeof trpc.binaries.getResolvedVersions.query>>;
type BinaryDiagnosticEntry = BinaryDiagnostics["ffmpeg"];
type DebugState = Awaited<ReturnType<typeof trpc.debug.getState.query>>;
type DebugDiagnostics = Awaited<ReturnType<typeof trpc.debug.getDiagnostics.query>>;
const SETTINGS_SECTION_IDS = [
  "general",
  "gameplay",
  "audio",
  "hardware",
  "sources",
  "security-privacy",
  "app",
  "advanced",
  "debug",
  "experimental",
  "help",
  "changelog",
  "credits",
] as const;

type ShortcutDefinition = {
  keys: string;
  description: string;
};

type ShortcutGroup = {
  id: string;
  title: string;
  description: string;
  shortcuts: ShortcutDefinition[];
};

type ShortcutI18n = Pick<I18n, "_">;

export function getVisibleShortcutGroups(
  i18n: ShortcutI18n,
  isProductionBuild = import.meta.env.PROD,
  cheatModeEnabled = false
): ShortcutGroup[] {
  const shortcutGroups: ShortcutGroup[] = [
    {
      id: "global",
      title: i18n._({ id: "settings.help.shortcuts.global.title", message: "Global" }),
      description: i18n._({
        id: "settings.help.shortcuts.global.description",
        message: "Available anywhere unless an input field is actively being edited.",
      }),
      shortcuts: [
        {
          keys: "Ctrl/Cmd+K",
          description: i18n._({
            id: "settings.help.shortcuts.global.commandPalette",
            message: "Open or close the command palette.",
          }),
        },
        {
          keys: "Ctrl/Cmd+M",
          description: i18n._({
            id: "settings.help.shortcuts.global.music",
            message: "Open or close the global music overlay.",
          }),
        },
        {
          keys: "Ctrl/Cmd+H",
          description: i18n._({
            id: "settings.help.shortcuts.global.handy",
            message: "Open or close the global TheHandy overlay.",
          }),
        },
        {
          keys: "Ctrl/Cmd+R",
          description: i18n._({
            id: "settings.help.shortcuts.global.reconnectHandy",
            message: "Reconnect TheHandy using the saved connection settings.",
          }),
        },
        {
          keys: "Escape",
          description: i18n._({
            id: "settings.help.shortcuts.global.closeMusic",
            message: "Close the global music overlay when it is open.",
          }),
        },
        {
          keys: "F11",
          description: i18n._({
            id: "settings.help.shortcuts.global.fullscreen",
            message: "Toggle fullscreen for the app window.",
          }),
        },
        {
          keys: "Ctrl/Cmd+= or Ctrl/Cmd++",
          description: i18n._({
            id: "settings.help.shortcuts.global.zoomIn",
            message: "Zoom the app window in.",
          }),
        },
        {
          keys: "Ctrl/Cmd+-",
          description: i18n._({
            id: "settings.help.shortcuts.global.zoomOut",
            message: "Zoom the app window out.",
          }),
        },
        {
          keys: "Ctrl/Cmd+0 or Ctrl/Cmd+O",
          description: i18n._({
            id: "settings.help.shortcuts.global.resetZoom",
            message: "Reset the app window zoom level to default.",
          }),
        },
      ],
    },
    {
      id: "controller",
      title: i18n._({
        id: "settings.help.shortcuts.controller.title",
        message: "Keyboard Controller Navigation",
      }),
      description: i18n._({
        id: "settings.help.shortcuts.controller.description",
        message:
          "Keyboard mappings that mirror controller input when controller support surfaces are active.",
      }),
      shortcuts: [
        {
          keys: "Arrow Keys",
          description: i18n._({
            id: "settings.help.shortcuts.controller.moveFocus",
            message: "Move focus between controller-navigable controls.",
          }),
        },
        {
          keys: "Enter or Space",
          description: i18n._({
            id: "settings.help.shortcuts.controller.primaryAction",
            message: "Trigger the primary action on the focused control.",
          }),
        },
        {
          keys: "Escape or Backspace",
          description: i18n._({
            id: "settings.help.shortcuts.controller.backAction",
            message: "Trigger the secondary/back action.",
          }),
        },
        {
          keys: "Q",
          description: i18n._({
            id: "settings.help.shortcuts.controller.leftBumper",
            message: "Use the left bumper action.",
          }),
        },
        {
          keys: "E",
          description: i18n._({
            id: "settings.help.shortcuts.controller.rightBumper",
            message: "Use the right bumper action.",
          }),
        },
      ],
    },
    {
      id: "game",
      title: i18n._({ id: "settings.help.shortcuts.game.title", message: "Game Session" }),
      description: i18n._({
        id: "settings.help.shortcuts.game.description",
        message: "Used during active gameplay and round playback.",
      }),
      shortcuts: [
        {
          keys: "Space",
          description: i18n._({
            id: "settings.help.shortcuts.game.mainAction",
            message: "Roll the dice or trigger the main gameplay action.",
          }),
        },
        {
          keys: "1 / 2 / 3",
          description: i18n._({
            id: "settings.help.shortcuts.game.selectPerk",
            message: "Select a perk during the perk selection phase.",
          }),
        },
        {
          keys: "C",
          description: i18n._({
            id: "settings.help.shortcuts.game.cumConfirmation",
            message: "Open the cum confirmation flow.",
          }),
        },
        {
          keys: "Escape",
          description: i18n._({
            id: "settings.help.shortcuts.game.options",
            message: "Open the in-game options menu.",
          }),
        },
        {
          keys: "Ctrl/Cmd+W",
          description: i18n._({
            id: "settings.help.shortcuts.game.toggleHandyStop",
            message: "Toggle TheHandy manual stop state.",
          }),
        },
        {
          keys: "[ / ] / \\\\ physical keys",
          description: i18n._({
            id: "settings.help.shortcuts.game.adjustHandyOffset",
            message: "Adjust the global TheHandy offset; hold Shift for 1ms fine tuning.",
          }),
        },
        {
          keys: "R",
          description: i18n._({
            id: "settings.help.shortcuts.game.resyncHandy",
            message: "Resync TheHandy timing to the current round video.",
          }),
        },
      ],
    },
    {
      id: "game-debug",
      title: i18n._({ id: "settings.help.shortcuts.gameDebug.title", message: "Game Debug" }),
      description: i18n._({
        id: "settings.help.shortcuts.gameDebug.description",
        message:
          "Development-only shortcuts that are only active when round debug controls are enabled.",
      }),
      shortcuts: [
        {
          keys: "I",
          description: i18n._({
            id: "settings.help.shortcuts.gameDebug.triggerIntermediary",
            message: "Trigger a test intermediary immediately.",
          }),
        },
        {
          keys: "J",
          description: i18n._({
            id: "settings.help.shortcuts.gameDebug.endIntermediary",
            message: "End the current intermediary early and resume the main round.",
          }),
        },
        {
          keys: "K",
          description: i18n._({
            id: "settings.help.shortcuts.gameDebug.finishRound",
            message: "Finish the round and jump to the summary screen.",
          }),
        },
      ],
    },
    {
      id: "converter",
      title: i18n._({ id: "settings.help.shortcuts.converter.title", message: "Converter" }),
      description: i18n._({
        id: "settings.help.shortcuts.converter.description",
        message: "Used while trimming and classifying segments in the converter.",
      }),
      shortcuts: CONVERTER_SHORTCUTS.map((shortcut) => ({
        keys: shortcut.keysLabel,
        description: shortcut.description,
      })),
    },
    {
      id: "map-editor",
      title: i18n._({ id: "settings.help.shortcuts.mapEditor.title", message: "Map Editor" }),
      description: i18n._({
        id: "settings.help.shortcuts.mapEditor.description",
        message: "Shortcuts for graph editing, layout, and viewport control.",
      }),
      shortcuts: [
        {
          keys: "Hold Space",
          description: i18n._({
            id: "settings.help.shortcuts.mapEditor.panning",
            message: "Temporarily enable panning.",
          }),
        },
        {
          keys: "Ctrl/Cmd+Z",
          description: i18n._({
            id: "settings.help.shortcuts.mapEditor.undo",
            message: "Undo the last graph edit.",
          }),
        },
        {
          keys: "Ctrl/Cmd+Shift+Z or Ctrl/Cmd+Y",
          description: i18n._({
            id: "settings.help.shortcuts.mapEditor.redo",
            message: "Redo the last undone graph edit.",
          }),
        },
        {
          keys: "Ctrl/Cmd+S",
          description: i18n._({
            id: "settings.help.shortcuts.mapEditor.save",
            message: "Save the current playlist.",
          }),
        },
        {
          keys: "X",
          description: i18n._({
            id: "settings.help.shortcuts.mapEditor.deleteSelection",
            message: "Delete the current selection.",
          }),
        },
        {
          keys: "1-9",
          description: i18n._({
            id: "settings.help.shortcuts.mapEditor.armTile",
            message: "Arm one of the first nine visible tile types for placement.",
          }),
        },
        {
          keys: "Escape",
          description: i18n._({
            id: "settings.help.shortcuts.mapEditor.clearSelection",
            message: "Clear the current selection and cancel a pending connection.",
          }),
        },
        {
          keys: "V",
          description: i18n._({
            id: "settings.help.shortcuts.mapEditor.selectTool",
            message: "Switch to the Select tool.",
          }),
        },
        {
          keys: "P",
          description: i18n._({
            id: "settings.help.shortcuts.mapEditor.placeTool",
            message: "Switch to the Place tool.",
          }),
        },
        {
          keys: "C",
          description: i18n._({
            id: "settings.help.shortcuts.mapEditor.connectTool",
            message: "Switch to the Connect tool.",
          }),
        },
        {
          keys: "G",
          description: i18n._({
            id: "settings.help.shortcuts.mapEditor.grid",
            message: "Show or hide the editor grid.",
          }),
        },
        {
          keys: "L",
          description: i18n._({
            id: "settings.help.shortcuts.mapEditor.layout",
            message: "Apply the current graph layout strategy.",
          }),
        },
        {
          keys: "0",
          description: i18n._({
            id: "settings.help.shortcuts.mapEditor.resetCamera",
            message: "Reset the editor camera to the default view.",
          }),
        },
      ],
    },
  ];

  if (isProductionBuild && !cheatModeEnabled) {
    return shortcutGroups.filter((group) => group.id !== "game-debug");
  }

  return shortcutGroups;
}

type SettingsSectionId = (typeof SETTINGS_SECTION_IDS)[number];

function normalizeSettingsSectionId(value: unknown): SettingsSectionId | undefined {
  if (typeof value !== "string") return undefined;
  return SETTINGS_SECTION_IDS.find((sectionId) => sectionId === value);
}

type ToggleSetting = {
  id: string;
  type: "toggle";
  label: string;
  description: string;
  value: boolean;
  onChange: (next: boolean) => Promise<void>;
};

type TextSetting = {
  id: string;
  type: "text";
  label: string;
  description: string;
  value: string;
  placeholder?: string;
  onChange: (next: string) => Promise<void>;
};

type NumberSetting = {
  id: string;
  type: "number";
  label: string;
  description: string;
  value: number;
  min: number;
  max: number;
  onChange: (next: number) => Promise<void>;
};

type ActionSetting = {
  id: string;
  type: "actions";
  label: string;
  description: string;
  actions: Array<{
    id: string;
    label: string;
    onClick: () => Promise<void>;
  }>;
};

type SelectSetting = {
  id: string;
  type: "select";
  label: string;
  description: string;
  value: string;
  options: Array<{ value: string; label: string }>;
  onChange: (next: string) => Promise<void>;
};

type SettingDefinition =
  ToggleSetting | TextSetting | NumberSetting | ActionSetting | SelectSetting;

type SettingsSection = {
  id: SettingsSectionId;
  icon: string;
  title: string;
  description: string;
  settings: SettingDefinition[];
};

type FolderImportNotice = {
  folderPath: string;
  tone: "success" | "error";
  message: string;
};

function toFolderImportMessage(
  result: Awaited<ReturnType<typeof db.install.addAutoScanFolderAndScan>>["result"]
): FolderImportNotice["message"] {
  const { status, legacyImport } = result;
  const summary = `Installed ${status.stats.installed} rounds, imported ${status.stats.playlistsImported} playlists, updated ${status.stats.updated}, failed ${status.stats.failed}.`;
  if (legacyImport) {
    return `Imported immediately via legacy fallback. ${summary}`;
  }
  if (
    status.stats.sidecarsSeen > 0 ||
    status.stats.installed > 0 ||
    status.stats.playlistsImported > 0 ||
    status.stats.updated > 0
  ) {
    return `Imported immediately. ${summary}`;
  }
  return `Folder saved for startup rescans. Nothing importable was found right now. ${summary}`;
}

export const Route = createFileRoute("/settings")({
  validateSearch: (search: Record<string, unknown>) => ({
    section: normalizeSettingsSectionId(search.section),
  }),
  component: SettingsPage,
});

export function SettingsPage() {
  useIdleScreenPerformance("settings");
  const { t } = useLingui();
  const { showToast } = useToast();
  const { locale, locales, setLocale } = useLocale();
  const search = Route.useSearch();
  const navigate = useNavigate();
  const appUpdate = useAppUpdate();
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isInitialLoading, setIsInitialLoading] = useState(true);
  const [zoomPercent, setZoomPercent] = useState<number | null>(null);
  const [isLoadingZoom, setIsLoadingZoom] = useState(true);
  const [intermediaryLoadingPrompt, setIntermediaryLoadingPrompt] = useState(
    DEFAULT_INTERMEDIARY_LOADING_PROMPT
  );
  const [intermediaryLoadingDurationSec, setIntermediaryLoadingDurationSec] = useState(
    DEFAULT_INTERMEDIARY_LOADING_DURATION_SEC
  );
  const [intermediaryReturnPauseSec, setIntermediaryReturnPauseSec] = useState(
    DEFAULT_INTERMEDIARY_RETURN_PAUSE_SEC
  );
  const [videoHashFfmpegSourcePreference, setVideoHashFfmpegSourcePreference] =
    useState<VideoHashFfmpegSourcePreference>("auto");
  const [ytDlpBinaryPreference, setYtDlpBinaryPreference] = useState<YtDlpBinaryPreference>(
    DEFAULT_YT_DLP_BINARY_PREFERENCE
  );
  const [backgroundVideoEnabled, setBackgroundVideoEnabled] = useState(
    DEFAULT_BACKGROUND_VIDEO_ENABLED
  );
  const [mainMenuThemeId, setMainMenuThemeId] = useState<MainMenuThemeId>(DEFAULT_MENU_THEME_ID);
  const [autofixBrokenFunscripts, setAutofixBrokenFunscripts] = useState(
    DEFAULT_AUTOFIX_BROKEN_FUNSCRIPTS
  );
  const [stashReattachFunscriptsMode, setStashReattachFunscriptsMode] =
    useState<StashReattachFunscriptsMode>(DEFAULT_STASH_REATTACH_FUNSCRIPTS_MODE);
  const [roundProgressBarAlwaysVisible, setRoundProgressBarAlwaysVisible] = useState(
    DEFAULT_ROUND_PROGRESS_BAR_ALWAYS_VISIBLE
  );
  const [antiPerkBeatbarEnabled, setAntiPerkBeatbarEnabled] = useState(
    DEFAULT_ANTI_PERK_BEATBAR_ENABLED
  );
  const [hapticsDisconnectedStatusVisible, setHapticsDisconnectedStatusVisible] = useState(
    DEFAULT_HAPTICS_DISCONNECTED_STATUS_VISIBLE
  );
  const [gameplayHapticsPerksWithoutDevice, setGameplayHapticsPerksWithoutDevice] = useState(
    DEFAULT_GAMEPLAY_HAPTICS_PERKS_WITHOUT_DEVICE
  );
  const [applyPerkDirectly, setApplyPerkDirectly] = useState(DEFAULT_APPLY_PERK_DIRECTLY);
  const [controllerSupportEnabled, setControllerSupportEnabled] = useState(
    DEFAULT_CONTROLLER_SUPPORT_ENABLED
  );
  const [fpsCounterEnabled, setFpsCounterEnabled] = useState(DEFAULT_FPS_COUNTER_ENABLED);
  const [cheatModeEnabled, setCheatModeEnabled] = useState(DEFAULT_CHEAT_MODE_ENABLED);
  const [sfwModeEnabled, setSfwModeEnabled] = useState(DEFAULT_SFW_MODE_ENABLED);
  const [multiplayerSkipRoundsCheck, setMultiplayerSkipRoundsCheck] = useState(
    DEFAULT_MULTIPLAYER_SKIP_ROUNDS_CHECK
  );
  const [installWebFunscriptUrlEnabled, setInstallWebFunscriptUrlEnabled] = useState(
    DEFAULT_INSTALL_WEB_FUNSCRIPT_URL_ENABLED
  );
  const [systemLanguageEnabled, setSystemLanguageEnabled] = useState(
    DEFAULT_SYSTEM_LANGUAGE_ENABLED
  );
  const [playlistCacheOngoingRestrictionDisabled, setPlaylistCacheOngoingRestrictionDisabled] =
    useState(DEFAULT_PLAYLIST_CACHE_ONGOING_RESTRICTION_DISABLED);
  const [ignorePlaylistLevelRequirements, setIgnorePlaylistLevelRequirements] = useState(
    DEFAULT_IGNORE_PLAYLIST_LEVEL_REQUIREMENTS
  );
  const [startupSafeModeShortcutEnabled, setStartupSafeModeShortcutEnabled] = useState(
    DEFAULT_STARTUP_SAFE_MODE_SHORTCUT_ENABLED
  );
  const [deviceAnimationTestEnabled, setDeviceAnimationTestEnabled] = useState(
    DEFAULT_DEVICE_ANIMATION_TEST_ENABLED
  );
  const [backgroundPhashScanningEnabled, setBackgroundPhashScanningEnabled] = useState(
    DEFAULT_BACKGROUND_PHASH_SCANNING_ENABLED
  );
  const [backgroundPhashRoundsPerPass, setBackgroundPhashRoundsPerPass] = useState(
    DEFAULT_BACKGROUND_PHASH_ROUNDS_PER_PASS
  );
  const [previewFfmpegSingleThreadEnabled, setPreviewFfmpegSingleThreadEnabled] = useState(
    DEFAULT_PREVIEW_FFMPEG_SINGLE_THREAD_ENABLED
  );
  const [databaseBackupEnabled, setDatabaseBackupEnabled] = useState(
    DEFAULT_DATABASE_BACKUP_ENABLED
  );
  const [databaseBackupFrequencyDays, setDatabaseBackupFrequencyDays] = useState(
    DEFAULT_DATABASE_BACKUP_FREQUENCY_DAYS
  );
  const [databaseBackupRetentionDays, setDatabaseBackupRetentionDays] = useState(
    DEFAULT_DATABASE_BACKUP_RETENTION_DAYS
  );
  const [websiteVideoCacheRootPath, setWebsiteVideoCacheRootPath] = useState<string | null>(null);
  const [eroscriptsCacheRootPath, setEroScriptsCacheRootPath] = useState<string | null>(null);
  const [eroscriptsLoginStatus, setEroScriptsLoginStatus] = useState<EroScriptsLoginStatus | null>(
    null
  );
  const [eroscriptsAuthMessage, setEroScriptsAuthMessage] = useState<string | null>(null);
  const [musicCacheRootPath, setMusicCacheRootPath] = useState<string | null>(null);
  const [fpackExtractionPath, setFpackExtractionPath] = useState<string | null>(null);
  const [binaryDiagnostics, setBinaryDiagnostics] = useState<BinaryDiagnostics | null>(null);
  const [binaryDiagnosticsError, setBinaryDiagnosticsError] = useState<string | null>(null);
  const [isLoadingBinaryDiagnostics, setIsLoadingBinaryDiagnostics] = useState(true);
  const [isRefreshingBinaryDiagnostics, setIsRefreshingBinaryDiagnostics] = useState(false);
  const [debugLogLevel, setDebugLogLevel] = useState<DebugLogLevel>("off");
  const [debugLogMaxFileSizeMb, setDebugLogMaxFileSizeMb] = useState(200);
  const [alwaysRecoveryMode, setAlwaysRecoveryMode] = useState(false);
  const [ffmpegGpuPreference, setFfmpegGpuPreference] = useState<FfmpegGpuPreference>(
    DEFAULT_FFMPEG_GPU_PREFERENCE
  );
  const [availableGpus, setAvailableGpus] = useState<Array<{ index: number; name: string }>>([]);
  const [graphicsSafeModeEnabled, setGraphicsSafeModeEnabled] = useState(
    DEFAULT_GRAPHICS_SAFE_MODE_ENABLED
  );
  const [graphicsDisableZeroCopyEnabled, setGraphicsDisableZeroCopyEnabled] = useState(
    DEFAULT_GRAPHICS_DISABLE_ZERO_COPY_ENABLED
  );
  const [
    graphicsDisableGpuBlocklistOverrideEnabled,
    setGraphicsDisableGpuBlocklistOverrideEnabled,
  ] = useState(DEFAULT_GRAPHICS_DISABLE_GPU_BLOCKLIST_OVERRIDE_ENABLED);
  const [graphicsDisableGpuRasterizationEnabled, setGraphicsDisableGpuRasterizationEnabled] =
    useState(DEFAULT_GRAPHICS_DISABLE_GPU_RASTERIZATION_ENABLED);
  const [graphicsDisableGpuCompositingEnabled, setGraphicsDisableGpuCompositingEnabled] = useState(
    DEFAULT_GRAPHICS_DISABLE_GPU_COMPOSITING_ENABLED
  );
  const [
    graphicsDisableAcceleratedVideoDecodeEnabled,
    setGraphicsDisableAcceleratedVideoDecodeEnabled,
  ] = useState(DEFAULT_GRAPHICS_DISABLE_ACCELERATED_VIDEO_DECODE_ENABLED);
  const [graphicsDisableGpuShaderDiskCacheEnabled, setGraphicsDisableGpuShaderDiskCacheEnabled] =
    useState(DEFAULT_GRAPHICS_DISABLE_GPU_SHADER_DISK_CACHE_ENABLED);
  const [
    graphicsDisableAcceleratedVideoEncodeEnabled,
    setGraphicsDisableAcceleratedVideoEncodeEnabled,
  ] = useState(DEFAULT_GRAPHICS_DISABLE_ACCELERATED_VIDEO_ENCODE_ENABLED);
  const [graphicsDisableGpuVsyncEnabled, setGraphicsDisableGpuVsyncEnabled] = useState(
    DEFAULT_GRAPHICS_DISABLE_GPU_VSYNC_ENABLED
  );
  const [graphicsForceAngleOpenGLEnabled, setGraphicsForceAngleOpenGLEnabled] = useState(
    DEFAULT_GRAPHICS_FORCE_ANGLE_OPENGL_ENABLED
  );
  const [graphicsDisableWebgl2Enabled, setGraphicsDisableWebgl2Enabled] = useState(
    DEFAULT_GRAPHICS_DISABLE_WEBGL2_ENABLED
  );
  const [debugState, setDebugState] = useState<DebugState | null>(null);
  const [debugDiagnostics, setDebugDiagnostics] = useState<DebugDiagnostics | null>(null);
  const [debugAllSettings, setDebugAllSettings] = useState<Record<string, unknown> | null>(null);
  const [isLoadingDebug, setIsLoadingDebug] = useState(true);
  const [isRefreshingDebug, setIsRefreshingDebug] = useState(false);
  const [isCopyingDebug, setIsCopyingDebug] = useState(false);
  const [isExportingDebug, setIsExportingDebug] = useState(false);
  const [isCreatingPlaintextSettings, setIsCreatingPlaintextSettings] = useState(false);
  const [isClearingLog, setIsClearingLog] = useState(false);
  const [debugMessage, setDebugMessage] = useState<string | null>(null);

  const [isUpdatingWebsiteVideoCacheRootPath, setIsUpdatingWebsiteVideoCacheRootPath] =
    useState(false);
  const [isUpdatingEroScriptsCacheRootPath, setIsUpdatingEroScriptsCacheRootPath] = useState(false);
  const [isSavingEroScriptsAuth, setIsSavingEroScriptsAuth] = useState(false);
  const [isLoadingEroScriptsAuth, setIsLoadingEroScriptsAuth] = useState(true);
  const [isUpdatingMusicCacheRootPath, setIsUpdatingMusicCacheRootPath] = useState(false);
  const [isUpdatingFpackExtractionPath, setIsUpdatingFpackExtractionPath] = useState(false);
  const [openingPathTarget, setOpeningPathTarget] = useState<
    "website-video-cache" | "music-cache" | "fpack-extraction" | "eroscripts-cache" | null
  >(null);
  const [autoScanFolders, setAutoScanFolders] = useState<string[]>([]);

  const [isUpdatingAutoScanFolders, setIsUpdatingAutoScanFolders] = useState(false);
  const [folderImportNotices, setFolderImportNotices] = useState<FolderImportNotice[]>([]);
  const [isClearDataDialogOpen, setIsClearDataDialogOpen] = useState(false);
  const [isDifficultyRecalculationDialogOpen, setIsDifficultyRecalculationDialogOpen] =
    useState(false);
  const [isRecalculatingDifficulties, setIsRecalculatingDifficulties] = useState(false);
  const [isCheatModeConfirmDialogOpen, setIsCheatModeConfirmDialogOpen] = useState(false);
  const [isSkipRoundsCheckDialogOpen, setIsSkipRoundsCheckDialogOpen] = useState(false);
  const [isClearingData, setIsClearingData] = useState(false);
  const [clearDataError, setClearDataError] = useState<string | null>(null);
  const [clearSelections, setClearSelections] = useState<ClearDataSelections>(
    DEFAULT_CLEAR_DATA_SELECTIONS
  );

  const refreshBinaryDiagnostics = useCallback(async () => {
    setIsRefreshingBinaryDiagnostics(true);
    setBinaryDiagnosticsError(null);
    try {
      const nextDiagnostics = await trpc.binaries.getResolvedVersions.query();
      setBinaryDiagnostics(nextDiagnostics);
    } catch (error) {
      console.error("Failed to load binary diagnostics", error);
      setBinaryDiagnosticsError(
        error instanceof Error ? error.message : t`Failed to load program versions.`
      );
    } finally {
      setIsLoadingBinaryDiagnostics(false);
      setIsRefreshingBinaryDiagnostics(false);
    }
  }, []);

  const refreshDebugInfo = useCallback(async () => {
    setIsRefreshingDebug(true);
    try {
      const [nextState, nextDiagnostics, nextAllSettings, nextGpus] = await Promise.all([
        trpc.debug.getState.query(),
        trpc.debug.getDiagnostics.query(),
        trpc.debug.getAllSettings.query(),
        trpc.debug.getAvailableGpus.query(),
      ]);
      setDebugState(nextState);
      setDebugLogLevel(normalizeDebugLogLevel(nextState.logLevel));
      setDebugLogMaxFileSizeMb(nextState.maxFileSizeMb);
      setDebugDiagnostics(nextDiagnostics);
      setDebugAllSettings(nextAllSettings);
      setAvailableGpus(nextGpus);
    } catch (error) {
      console.error("Failed to load debug diagnostics", error);
      setDebugMessage(error instanceof Error ? error.message : t`Failed to load debug info.`);
    } finally {
      setIsLoadingDebug(false);
      setIsRefreshingDebug(false);
    }
  }, []);

  useEffect(() => {
    let mounted = true;
    const loadSettings = async () => {
      const storeKeys = [
        INTERMEDIARY_LOADING_PROMPT_KEY,
        INTERMEDIARY_LOADING_DURATION_KEY,
        INTERMEDIARY_RETURN_PAUSE_KEY,
        VIDEOHASH_FFMPEG_SOURCE_PREFERENCE_KEY,
        YT_DLP_BINARY_PREFERENCE_KEY,
        BACKGROUND_VIDEO_ENABLED_KEY,
        MENU_THEME_KEY,
        AUTOFIX_BROKEN_FUNSCRIPTS_KEY,
        STASH_REATTACH_FUNSCRIPTS_ENABLED_KEY,
        ROUND_PROGRESS_BAR_ALWAYS_VISIBLE_KEY,
        ANTI_PERK_BEATBAR_ENABLED_KEY,
        HAPTICS_DISCONNECTED_STATUS_VISIBLE_KEY,
        GAMEPLAY_HAPTICS_PERKS_WITHOUT_DEVICE_KEY,
        CONTROLLER_SUPPORT_ENABLED_KEY,
        FPS_COUNTER_ENABLED_KEY,
        CHEAT_MODE_ENABLED_KEY,
        SFW_MODE_ENABLED_KEY,
        BACKGROUND_PHASH_SCANNING_ENABLED_KEY,
        BACKGROUND_PHASH_ROUNDS_PER_PASS_KEY,
        PREVIEW_FFMPEG_SINGLE_THREAD_ENABLED_KEY,
        DATABASE_BACKUP_ENABLED_KEY,
        DATABASE_BACKUP_FREQUENCY_DAYS_KEY,
        DATABASE_BACKUP_RETENTION_DAYS_KEY,
        APPLY_PERK_DIRECTLY_KEY,
        MULTIPLAYER_SKIP_ROUNDS_CHECK_KEY,
        INSTALL_WEB_FUNSCRIPT_URL_ENABLED_KEY,
        SYSTEM_LANGUAGE_ENABLED_KEY,
        PLAYLIST_CACHE_ONGOING_RESTRICTION_DISABLED_KEY,
        IGNORE_PLAYLIST_LEVEL_REQUIREMENTS_KEY,
        STARTUP_SAFE_MODE_SHORTCUT_ENABLED_KEY,
        WEBSITE_VIDEO_CACHE_ROOT_PATH_KEY,
        EROSCRIPTS_CACHE_ROOT_PATH_KEY,
        MUSIC_CACHE_ROOT_PATH_KEY,
        FPACK_EXTRACTION_PATH_KEY,
        DEVICE_ANIMATION_TEST_ENABLED_KEY,
        DEBUG_LOG_LEVEL_KEY,
        ALWAYS_RECOVERY_MODE_KEY,
        FFMPEG_GPU_PREFERENCE_KEY,
        GRAPHICS_SAFE_MODE_ENABLED_KEY,
        GRAPHICS_DISABLE_ZERO_COPY_ENABLED_KEY,
        GRAPHICS_DISABLE_GPU_BLOCKLIST_OVERRIDE_ENABLED_KEY,
        GRAPHICS_DISABLE_GPU_RASTERIZATION_ENABLED_KEY,
        GRAPHICS_DISABLE_GPU_COMPOSITING_ENABLED_KEY,
        GRAPHICS_DISABLE_ACCELERATED_VIDEO_DECODE_ENABLED_KEY,
        GRAPHICS_DISABLE_GPU_SHADER_DISK_CACHE_ENABLED_KEY,
        GRAPHICS_DISABLE_ACCELERATED_VIDEO_ENCODE_ENABLED_KEY,
        GRAPHICS_DISABLE_GPU_VSYNC_ENABLED_KEY,
        GRAPHICS_FORCE_ANGLE_OPENGL_ENABLED_KEY,
        GRAPHICS_DISABLE_WEBGL2_ENABLED_KEY,
      ];

      try {
        const [storeValues, fullscreen, rawEroScriptsLoginStatus, folders] = await Promise.all([
          trpc.store.getMany.query({ keys: storeKeys }),
          window.electronAPI.window.isFullscreen(),
          trpc.eroscripts.getLoginStatus.query(),
          db.install.getAutoScanFolders(),
        ]);

        if (!mounted) return;

        const rawPrompt = storeValues[INTERMEDIARY_LOADING_PROMPT_KEY];
        const rawDuration = storeValues[INTERMEDIARY_LOADING_DURATION_KEY];
        const rawReturnPause = storeValues[INTERMEDIARY_RETURN_PAUSE_KEY];
        const rawVideoHashPreference = storeValues[VIDEOHASH_FFMPEG_SOURCE_PREFERENCE_KEY];
        const rawYtDlpPreference = storeValues[YT_DLP_BINARY_PREFERENCE_KEY];
        const rawBackgroundVideoEnabled = storeValues[BACKGROUND_VIDEO_ENABLED_KEY];
        const rawMainMenuTheme = storeValues[MENU_THEME_KEY];
        const rawAutofixBrokenFunscripts = storeValues[AUTOFIX_BROKEN_FUNSCRIPTS_KEY];
        const rawStashReattachFunscriptsEnabled =
          storeValues[STASH_REATTACH_FUNSCRIPTS_ENABLED_KEY];
        const rawRoundProgressBarAlwaysVisible = storeValues[ROUND_PROGRESS_BAR_ALWAYS_VISIBLE_KEY];
        const rawAntiPerkBeatbarEnabled = storeValues[ANTI_PERK_BEATBAR_ENABLED_KEY];
        const rawHapticsDisconnectedStatusVisible =
          storeValues[HAPTICS_DISCONNECTED_STATUS_VISIBLE_KEY];
        const rawGameplayHapticsPerksWithoutDevice =
          storeValues[GAMEPLAY_HAPTICS_PERKS_WITHOUT_DEVICE_KEY];
        const rawControllerSupportEnabled = storeValues[CONTROLLER_SUPPORT_ENABLED_KEY];
        const rawFpsCounterEnabled = storeValues[FPS_COUNTER_ENABLED_KEY];
        const rawCheatModeEnabled = storeValues[CHEAT_MODE_ENABLED_KEY];
        const rawSfwModeEnabled = storeValues[SFW_MODE_ENABLED_KEY];
        const rawBackgroundPhashScanningEnabled =
          storeValues[BACKGROUND_PHASH_SCANNING_ENABLED_KEY];
        const rawBackgroundPhashRoundsPerPass = storeValues[BACKGROUND_PHASH_ROUNDS_PER_PASS_KEY];
        const rawPreviewFfmpegSingleThreadEnabled =
          storeValues[PREVIEW_FFMPEG_SINGLE_THREAD_ENABLED_KEY];
        const rawDatabaseBackupEnabled = storeValues[DATABASE_BACKUP_ENABLED_KEY];
        const rawDatabaseBackupFrequencyDays = storeValues[DATABASE_BACKUP_FREQUENCY_DAYS_KEY];
        const rawDatabaseBackupRetentionDays = storeValues[DATABASE_BACKUP_RETENTION_DAYS_KEY];
        const rawApplyPerkDirectly = storeValues[APPLY_PERK_DIRECTLY_KEY];
        const rawMultiplayerSkipRoundsCheck = storeValues[MULTIPLAYER_SKIP_ROUNDS_CHECK_KEY];
        const rawInstallWebFunscriptUrlEnabled = storeValues[INSTALL_WEB_FUNSCRIPT_URL_ENABLED_KEY];
        const rawSystemLanguageEnabled = storeValues[SYSTEM_LANGUAGE_ENABLED_KEY];
        const rawPlaylistCacheOngoingRestrictionDisabled =
          storeValues[PLAYLIST_CACHE_ONGOING_RESTRICTION_DISABLED_KEY];
        const rawIgnorePlaylistLevelRequirements =
          storeValues[IGNORE_PLAYLIST_LEVEL_REQUIREMENTS_KEY];
        const rawStartupSafeModeShortcutEnabled =
          storeValues[STARTUP_SAFE_MODE_SHORTCUT_ENABLED_KEY];
        const rawDeviceAnimationTestEnabled = storeValues[DEVICE_ANIMATION_TEST_ENABLED_KEY];
        const rawWebsiteVideoCacheRootPath = storeValues[WEBSITE_VIDEO_CACHE_ROOT_PATH_KEY];
        const rawEroScriptsCacheRootPath = storeValues[EROSCRIPTS_CACHE_ROOT_PATH_KEY];
        const rawMusicCacheRootPath = storeValues[MUSIC_CACHE_ROOT_PATH_KEY];
        const rawFpackExtractionPath = storeValues[FPACK_EXTRACTION_PATH_KEY];
        const rawDebugLogLevel = storeValues[DEBUG_LOG_LEVEL_KEY];
        const rawAlwaysRecoveryMode = storeValues[ALWAYS_RECOVERY_MODE_KEY];
        const rawFfmpegGpuPreference = storeValues[FFMPEG_GPU_PREFERENCE_KEY];
        const rawGraphicsSafeModeEnabled = storeValues[GRAPHICS_SAFE_MODE_ENABLED_KEY];
        const rawGraphicsDisableZeroCopyEnabled =
          storeValues[GRAPHICS_DISABLE_ZERO_COPY_ENABLED_KEY];
        const rawGraphicsDisableGpuBlocklistOverrideEnabled =
          storeValues[GRAPHICS_DISABLE_GPU_BLOCKLIST_OVERRIDE_ENABLED_KEY];
        const rawGraphicsDisableGpuRasterizationEnabled =
          storeValues[GRAPHICS_DISABLE_GPU_RASTERIZATION_ENABLED_KEY];
        const rawGraphicsDisableGpuCompositingEnabled =
          storeValues[GRAPHICS_DISABLE_GPU_COMPOSITING_ENABLED_KEY];
        const rawGraphicsDisableAcceleratedVideoDecodeEnabled =
          storeValues[GRAPHICS_DISABLE_ACCELERATED_VIDEO_DECODE_ENABLED_KEY];
        const rawGraphicsDisableGpuShaderDiskCacheEnabled =
          storeValues[GRAPHICS_DISABLE_GPU_SHADER_DISK_CACHE_ENABLED_KEY];
        const rawGraphicsDisableAcceleratedVideoEncodeEnabled =
          storeValues[GRAPHICS_DISABLE_ACCELERATED_VIDEO_ENCODE_ENABLED_KEY];
        const rawGraphicsDisableGpuVsyncEnabled =
          storeValues[GRAPHICS_DISABLE_GPU_VSYNC_ENABLED_KEY];
        const rawGraphicsForceAngleOpenGLEnabled =
          storeValues[GRAPHICS_FORCE_ANGLE_OPENGL_ENABLED_KEY];
        const rawGraphicsDisableWebgl2Enabled = storeValues[GRAPHICS_DISABLE_WEBGL2_ENABLED_KEY];

        setIsFullscreen(fullscreen);
        const nextPrompt =
          typeof rawPrompt === "string" && rawPrompt.trim().length > 0
            ? rawPrompt.trim()
            : DEFAULT_INTERMEDIARY_LOADING_PROMPT;
        setIntermediaryLoadingPrompt(nextPrompt);
        const parsedDuration = typeof rawDuration === "number" ? rawDuration : Number(rawDuration);
        const nextDuration = Number.isFinite(parsedDuration)
          ? Math.max(1, Math.min(60, Math.floor(parsedDuration)))
          : DEFAULT_INTERMEDIARY_LOADING_DURATION_SEC;
        setIntermediaryLoadingDurationSec(nextDuration);
        const parsedReturnPause =
          typeof rawReturnPause === "number" ? rawReturnPause : Number(rawReturnPause);
        const nextReturnPause = Number.isFinite(parsedReturnPause)
          ? Math.max(0, Math.min(60, Math.floor(parsedReturnPause)))
          : DEFAULT_INTERMEDIARY_RETURN_PAUSE_SEC;
        setIntermediaryReturnPauseSec(nextReturnPause);
        setVideoHashFfmpegSourcePreference(
          normalizeVideoHashFfmpegSourcePreference(rawVideoHashPreference)
        );
        setYtDlpBinaryPreference(normalizeYtDlpBinaryPreference(rawYtDlpPreference));
        setBackgroundVideoEnabled(
          typeof rawBackgroundVideoEnabled === "boolean"
            ? rawBackgroundVideoEnabled
            : DEFAULT_BACKGROUND_VIDEO_ENABLED
        );
        setMainMenuThemeId(normalizeMainMenuThemeId(rawMainMenuTheme));
        setAutofixBrokenFunscripts(normalizeAutofixBrokenFunscripts(rawAutofixBrokenFunscripts));
        setStashReattachFunscriptsMode(
          normalizeStashReattachFunscriptsMode(rawStashReattachFunscriptsEnabled)
        );
        setRoundProgressBarAlwaysVisible(
          normalizeRoundProgressBarAlwaysVisible(rawRoundProgressBarAlwaysVisible)
        );
        setAntiPerkBeatbarEnabled(normalizeAntiPerkBeatbarEnabled(rawAntiPerkBeatbarEnabled));
        setHapticsDisconnectedStatusVisible(
          normalizeHapticsDisconnectedStatusVisible(rawHapticsDisconnectedStatusVisible)
        );
        setGameplayHapticsPerksWithoutDevice(
          normalizeGameplayHapticsPerksWithoutDevice(rawGameplayHapticsPerksWithoutDevice)
        );
        setControllerSupportEnabled(normalizeControllerSupportEnabled(rawControllerSupportEnabled));
        setFpsCounterEnabled(normalizeFpsCounterEnabled(rawFpsCounterEnabled));
        setCheatModeEnabled(normalizeCheatModeEnabled(rawCheatModeEnabled));
        setSfwModeEnabled(normalizeSfwModeEnabled(rawSfwModeEnabled));
        setMultiplayerSkipRoundsCheck(
          normalizeMultiplayerSkipRoundsCheck(rawMultiplayerSkipRoundsCheck)
        );
        setInstallWebFunscriptUrlEnabled(
          normalizeInstallWebFunscriptUrlEnabled(rawInstallWebFunscriptUrlEnabled)
        );
        setSystemLanguageEnabled(normalizeSystemLanguageEnabled(rawSystemLanguageEnabled));
        setPlaylistCacheOngoingRestrictionDisabled(
          normalizePlaylistCacheOngoingRestrictionDisabled(
            rawPlaylistCacheOngoingRestrictionDisabled
          )
        );
        setIgnorePlaylistLevelRequirements(
          normalizeIgnorePlaylistLevelRequirements(rawIgnorePlaylistLevelRequirements)
        );
        setBackgroundPhashScanningEnabled(
          normalizeBackgroundPhashScanningEnabled(rawBackgroundPhashScanningEnabled)
        );
        setBackgroundPhashRoundsPerPass(
          normalizeBackgroundPhashRoundsPerPass(rawBackgroundPhashRoundsPerPass)
        );
        setPreviewFfmpegSingleThreadEnabled(
          normalizePreviewFfmpegSingleThreadEnabled(rawPreviewFfmpegSingleThreadEnabled)
        );
        setDatabaseBackupEnabled(normalizeDatabaseBackupEnabled(rawDatabaseBackupEnabled));
        setDatabaseBackupFrequencyDays(
          normalizeDatabaseBackupFrequencyDays(rawDatabaseBackupFrequencyDays)
        );
        setDatabaseBackupRetentionDays(
          normalizeDatabaseBackupRetentionDays(rawDatabaseBackupRetentionDays)
        );
        setStartupSafeModeShortcutEnabled(
          normalizeStartupSafeModeShortcutEnabled(rawStartupSafeModeShortcutEnabled)
        );
        setDeviceAnimationTestEnabled(
          normalizeDeviceAnimationTestEnabled(rawDeviceAnimationTestEnabled)
        );
        setWebsiteVideoCacheRootPath(
          typeof rawWebsiteVideoCacheRootPath === "string" &&
            rawWebsiteVideoCacheRootPath.trim().length > 0
            ? rawWebsiteVideoCacheRootPath.trim()
            : null
        );
        setEroScriptsCacheRootPath(
          typeof rawEroScriptsCacheRootPath === "string" &&
            rawEroScriptsCacheRootPath.trim().length > 0
            ? rawEroScriptsCacheRootPath.trim()
            : null
        );
        setEroScriptsLoginStatus(rawEroScriptsLoginStatus);
        setIsLoadingEroScriptsAuth(false);
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
        setDebugLogLevel(normalizeDebugLogLevel(rawDebugLogLevel));
        setAlwaysRecoveryMode(normalizeAlwaysRecoveryMode(rawAlwaysRecoveryMode));
        setFfmpegGpuPreference(normalizeFfmpegGpuPreference(rawFfmpegGpuPreference));
        setGraphicsSafeModeEnabled(normalizeGraphicsBoolean(rawGraphicsSafeModeEnabled));
        setGraphicsDisableZeroCopyEnabled(
          normalizeGraphicsBoolean(rawGraphicsDisableZeroCopyEnabled)
        );
        setGraphicsDisableGpuBlocklistOverrideEnabled(
          normalizeGraphicsBoolean(rawGraphicsDisableGpuBlocklistOverrideEnabled)
        );
        setGraphicsDisableGpuRasterizationEnabled(
          normalizeGraphicsBoolean(rawGraphicsDisableGpuRasterizationEnabled)
        );
        setGraphicsDisableGpuCompositingEnabled(
          normalizeGraphicsBoolean(rawGraphicsDisableGpuCompositingEnabled)
        );
        setGraphicsDisableAcceleratedVideoDecodeEnabled(
          normalizeGraphicsBoolean(rawGraphicsDisableAcceleratedVideoDecodeEnabled)
        );
        setGraphicsDisableGpuShaderDiskCacheEnabled(
          normalizeGraphicsBoolean(rawGraphicsDisableGpuShaderDiskCacheEnabled)
        );
        setGraphicsDisableAcceleratedVideoEncodeEnabled(
          normalizeGraphicsBoolean(rawGraphicsDisableAcceleratedVideoEncodeEnabled)
        );
        setGraphicsDisableGpuVsyncEnabled(
          normalizeGraphicsBoolean(rawGraphicsDisableGpuVsyncEnabled)
        );
        setGraphicsForceAngleOpenGLEnabled(
          normalizeGraphicsBoolean(rawGraphicsForceAngleOpenGLEnabled)
        );
        setGraphicsDisableWebgl2Enabled(normalizeGraphicsBoolean(rawGraphicsDisableWebgl2Enabled));
        setApplyPerkDirectly(
          rawApplyPerkDirectly === true || rawApplyPerkDirectly === "true"
            ? true
            : rawApplyPerkDirectly === false || rawApplyPerkDirectly === "false"
              ? false
              : DEFAULT_APPLY_PERK_DIRECTLY
        );
        if (Array.isArray(folders)) {
          setAutoScanFolders(folders as string[]);
        }
      } catch (error) {
        console.error("Failed to read settings state", error);
      } finally {
        setIsInitialLoading(false);
        setIsLoadingEroScriptsAuth(false);
      }
    };

    void loadSettings();

    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    const unsubscribe = window.electronAPI.eroscripts.subscribeToLoginStatus((status) => {
      setEroScriptsLoginStatus(status);
      if (status.loggedIn) {
        setEroScriptsAuthMessage(t`EroScripts login active.`);
      }
    });
    return unsubscribe;
  }, []);

  useEffect(() => {
    let mounted = true;
    const zoomApi = window.electronAPI.window;

    if (!zoomApi.getZoomPercent || !zoomApi.subscribeToZoom) {
      setZoomPercent(100);
      setIsLoadingZoom(false);
      return () => {
        mounted = false;
      };
    }

    zoomApi
      .getZoomPercent()
      .then((value) => {
        if (mounted) setZoomPercent(value);
      })
      .catch((error) => {
        console.error("Failed to read app zoom", error);
      })
      .finally(() => {
        if (mounted) setIsLoadingZoom(false);
      });

    const unsubscribe = zoomApi.subscribeToZoom((value) => {
      setZoomPercent(value);
    });

    return () => {
      mounted = false;
      unsubscribe();
    };
  }, []);

  const sections: SettingsSection[] = useMemo(
    () => [
      {
        id: "general",
        icon: "⚙",
        title: t`General`,
        description: t`Window and display preferences.`,
        settings: [
          {
            id: "fullscreen",
            type: "toggle",
            label: t`Fullscreen`,
            description: t`Enable or disable fullscreen mode for the game window.`,
            value: isFullscreen,
            onChange: async (next: boolean) => {
              const applied = await window.electronAPI.window.setFullscreen(next);
              setIsFullscreen(applied);
            },
          },
          {
            id: "background-video-enabled",
            type: "toggle",
            label: t`Load Background Videos`,
            description: t`When disabled, animated backgrounds keep the visual effects but skip loading video files.`,
            value: backgroundVideoEnabled,
            onChange: async (next: boolean) => {
              await trpc.store.set.mutate({ key: BACKGROUND_VIDEO_ENABLED_KEY, value: next });
              setBackgroundVideoEnabled(next);
              window.dispatchEvent(
                new CustomEvent<boolean>(BACKGROUND_VIDEO_ENABLED_EVENT, { detail: next })
              );
            },
          },
          {
            id: "main-menu-theme",
            type: "select",
            label: t`App Theme`,
            description: t`Choose the color scheme used outside the gameboard.`,
            value: mainMenuThemeId,
            options: MAIN_MENU_THEMES.map((theme) => ({
              value: theme.id,
              label: theme.label,
            })),
            onChange: async (next: string) => {
              const value = normalizeMainMenuThemeId(next);
              await trpc.store.set.mutate({ key: MENU_THEME_KEY, value });
              setMainMenuThemeId(value);
              window.dispatchEvent(
                new CustomEvent<MainMenuThemeId>(MENU_THEME_CHANGED_EVENT, { detail: value })
              );
            },
          },
          {
            id: "language",
            type: "select",
            // KI: Keep the / Language at the end. This is for users to find the setting if they accidentally mistyped the language
            label: t`Language` + " / Language",
            description: t`Choose the language used for app labels, dialogs, and safe mode prompts. English stays the default unless the experimental system language option is enabled.`,
            value: locale,
            options: locales.map((entry) => ({ value: entry.code, label: entry.label })),
            onChange: async (next: string) => {
              await setLocale(next as typeof locale);
            },
          },
        ],
      },
      {
        id: "gameplay",
        icon: "🎮",
        title: t`Gameplay`,
        description: t`In-game HUD, anti-perks, intermediary session behavior, and gameplay modifiers.`,
        settings: [
          {
            id: "anti-perk-beatbar-enabled",
            type: "toggle",
            label: t`Show Anti-Perk Beatbar`,
            description: t`Shows a synchronized manual beatbar during jackhammer and milker anti-perk sequences.`,
            value: antiPerkBeatbarEnabled,
            onChange: async (next: boolean) => {
              await trpc.store.set.mutate({ key: ANTI_PERK_BEATBAR_ENABLED_KEY, value: next });
              setAntiPerkBeatbarEnabled(next);
            },
          },
          {
            id: "round-progress-bar-always-visible",
            type: "toggle",
            label: t`Pin Round Progress Bar`,
            description: t`Keep the round playback progress bar visible even after the rest of the HUD fades out.`,
            value: roundProgressBarAlwaysVisible,
            onChange: async (next: boolean) => {
              await trpc.store.set.mutate({
                key: ROUND_PROGRESS_BAR_ALWAYS_VISIBLE_KEY,
                value: next,
              });
              setRoundProgressBarAlwaysVisible(next);
            },
          },
          {
            id: "haptics-disconnected-status-visible",
            type: "toggle",
            label: t`Show Disconnected Haptics Status`,
            description: t`Show the disconnected haptics status pill during round playback when no device is connected.`,
            value: hapticsDisconnectedStatusVisible,
            onChange: async (next: boolean) => {
              await trpc.store.set.mutate({
                key: HAPTICS_DISCONNECTED_STATUS_VISIBLE_KEY,
                value: next,
              });
              setHapticsDisconnectedStatusVisible(next);
            },
          },
          {
            id: "apply-perk-directly",
            type: "toggle",
            label: t`Auto-Apply Perks`,
            description: t`When enabled, perks (not anti-perks) are applied immediately when received instead of being stored in inventory.`,
            value: applyPerkDirectly,
            onChange: async (next: boolean) => {
              await trpc.store.set.mutate({ key: APPLY_PERK_DIRECTLY_KEY, value: next });
              setApplyPerkDirectly(next);
            },
          },
          {
            id: "intermediary-loading-prompt",
            type: "text",
            label: t`Intermediary Loading Prompt`,
            description: t`Search prompt used for loading-screen media from rule34/booru sites.`,
            value: intermediaryLoadingPrompt,
            placeholder: DEFAULT_INTERMEDIARY_LOADING_PROMPT,
            onChange: async (next: string) => {
              const trimmed = next.trim();
              const value = trimmed.length > 0 ? trimmed : DEFAULT_INTERMEDIARY_LOADING_PROMPT;
              await trpc.store.set.mutate({ key: INTERMEDIARY_LOADING_PROMPT_KEY, value });
              setIntermediaryLoadingPrompt(value);
              void ensureBooruMediaCache(value, 18);
            },
          },
          {
            id: "intermediary-loading-duration",
            type: "number",
            label: t`Intermediary Loading Duration (s)`,
            description: t`How long the intermediary loading countdown runs before switching videos.`,
            value: intermediaryLoadingDurationSec,
            min: 1,
            max: 60,
            onChange: async (next: number) => {
              const value = Math.max(1, Math.min(60, Math.floor(next)));
              await trpc.store.set.mutate({ key: INTERMEDIARY_LOADING_DURATION_KEY, value });
              setIntermediaryLoadingDurationSec(value);
            },
          },
          {
            id: "intermediary-return-pause",
            type: "number",
            label: t`Return Pause After Intermediary (s)`,
            description: t`Pause duration after intermediary ends before resuming the main round.`,
            value: intermediaryReturnPauseSec,
            min: 0,
            max: 60,
            onChange: async (next: number) => {
              const value = Math.max(0, Math.min(60, Math.floor(next)));
              await trpc.store.set.mutate({ key: INTERMEDIARY_RETURN_PAUSE_KEY, value });
              setIntermediaryReturnPauseSec(value);
            },
          },
          {
            id: "cheat-mode-enabled",
            type: "toggle",
            label: t`Cheat Mode`,
            description: t`Enables dev menu features in singleplayer. Any highscore achieved will be permanently marked with 🎭. Does not work in multiplayer.`,
            value: cheatModeEnabled,
            onChange: async (next: boolean) => {
              if (next) {
                setIsCheatModeConfirmDialogOpen(true);
              } else {
                await progression.setCheatModeEnabled(false);
                setCheatModeEnabled(false);
                window.dispatchEvent(
                  new CustomEvent<boolean>(CHEAT_MODE_ENABLED_EVENT, { detail: false })
                );
              }
            },
          },
          {
            id: "multiplayer-skip-rounds-check",
            type: "toggle",
            label: t`Skip Multiplayer Safeguards`,
            description: t`Allow multiplayer access regardless of the global minimum and playlist-specific round requirements. Disabling these safeguards may result in a bad user experience.`,
            value: multiplayerSkipRoundsCheck,
            onChange: async (next: boolean) => {
              if (next) {
                setIsSkipRoundsCheckDialogOpen(true);
              } else {
                await trpc.store.set.mutate({
                  key: MULTIPLAYER_SKIP_ROUNDS_CHECK_KEY,
                  value: false,
                });
                setMultiplayerSkipRoundsCheck(false);
                window.dispatchEvent(
                  new CustomEvent<boolean>(MULTIPLAYER_SKIP_ROUNDS_CHECK_EVENT, {
                    detail: false,
                  })
                );
              }
            },
          },
          {
            id: "ignore-playlist-level-requirements",
            type: "toggle",
            label: t`Ignore Playlist Level Requirements`,
            description: t`Allows locked solo playlists to start for testing. Runs started through this bypass do not award XP.`,
            value: ignorePlaylistLevelRequirements,
            onChange: async (next: boolean) => {
              await trpc.store.set.mutate({
                key: IGNORE_PLAYLIST_LEVEL_REQUIREMENTS_KEY,
                value: next,
              });
              setIgnorePlaylistLevelRequirements(next);
              window.dispatchEvent(
                new CustomEvent<boolean>(IGNORE_PLAYLIST_LEVEL_REQUIREMENTS_EVENT, {
                  detail: next,
                })
              );
            },
          },
        ],
      },
      {
        id: "audio",
        icon: "🎵",
        title: t`Audio`,
        description: t`Global background music queue and playback preferences.`,
        settings: [],
      },
      {
        id: "hardware",
        icon: "🔗",
        title: t`Hardware & Sync`,
        description: t`Haptics hardware integration and funscript compatibility.`,
        settings: [
          {
            id: "autofix-broken-funscripts",
            type: "toggle",
            label: t`Autofix Broken Funscripts`,
            description: t`When enabled, funscripts with \`range: 90\` are normalized to \`100\` in memory so TheHandy playback keeps working.`,
            value: autofixBrokenFunscripts,
            onChange: async (next: boolean) => {
              await trpc.store.set.mutate({ key: AUTOFIX_BROKEN_FUNSCRIPTS_KEY, value: next });
              setAutofixBrokenFunscripts(next);
            },
          },
        ],
      },
      {
        id: "sources",
        icon: "📂",
        title: t`Sources & Library`,
        description: t`External source integrations, Stash sync, and local library folders.`,
        settings: [
          {
            id: "stash-reattach-funscripts",
            type: "select",
            label: t`Reattach Funscripts in Stash Rounds`,
            description: t`Controls when Stash sync refreshes funscript attachments from the source when the scene has one.`,
            value: stashReattachFunscriptsMode,
            options: [
              { value: "off", label: t`Do Not Reattach` },
              { value: "stashOnly", label: t`Missing or Stash-Origin Only` },
              { value: "always", label: t`Always Override` },
            ],
            onChange: async (next: string) => {
              const value = normalizeStashReattachFunscriptsMode(next);
              await trpc.store.set.mutate({
                key: STASH_REATTACH_FUNSCRIPTS_ENABLED_KEY,
                value,
              });
              setStashReattachFunscriptsMode(value);
            },
          },
        ],
      },
      {
        id: "security-privacy",
        icon: "🛡",
        title: t`Security & Privacy`,
        description: t`Content safety, trusted domains, and safe site lists.`,
        settings: [
          {
            id: "sfw-mode-enabled",
            type: "toggle",
            label: t`SFW Mode`,
            description: t`Prevents all media from loading. Videos, images, previews, and booru media are replaced with a placeholder banner. Does not affect gameplay logic.`,
            value: sfwModeEnabled,
            onChange: async (next: boolean) => {
              await trpc.store.set.mutate({ key: SFW_MODE_ENABLED_KEY, value: next });
              window.localStorage.setItem(SFW_MODE_ENABLED_KEY, String(next));
              setSfwModeEnabled(next);
              window.dispatchEvent(
                new CustomEvent<boolean>(SFW_MODE_ENABLED_EVENT, { detail: next })
              );
            },
          },
          {
            id: "startup-safe-mode-shortcut-enabled",
            type: "toggle",
            label: t`Safe Mode Startup Shortcut`,
            description: t`When enabled, holding 'S' during the first 5 seconds of app startup will automatically enable SFW Mode. Useful for emergency situations.`,
            value: startupSafeModeShortcutEnabled,
            onChange: async (next: boolean) => {
              await trpc.store.set.mutate({
                key: STARTUP_SAFE_MODE_SHORTCUT_ENABLED_KEY,
                value: next,
              });
              window.localStorage.setItem(STARTUP_SAFE_MODE_SHORTCUT_ENABLED_KEY, String(next));
              setStartupSafeModeShortcutEnabled(next);
            },
          },
        ],
      },
      {
        id: "app",
        icon: "🗄",
        title: t`Data & Storage`,
        description: t`Application data maintenance and destructive actions.`,
        settings: [
          {
            id: "hardware-performance-presets",
            type: "actions",
            label: t`Hardware performance presets`,
            description: t`Apply a quick profile for background hashing and preview generation. You can still fine tune each setting below.`,
            actions: [
              {
                id: "weak-hardware",
                label: t`Apply recommended settings for weak hardware`,
                onClick: async () => {
                  await Promise.all([
                    trpc.store.set.mutate({
                      key: BACKGROUND_VIDEO_ENABLED_KEY,
                      value: false,
                    }),
                    trpc.store.set.mutate({
                      key: BACKGROUND_PHASH_SCANNING_ENABLED_KEY,
                      value: false,
                    }),
                    trpc.store.set.mutate({
                      key: BACKGROUND_PHASH_ROUNDS_PER_PASS_KEY,
                      value: MIN_BACKGROUND_PHASH_ROUNDS_PER_PASS,
                    }),
                    trpc.store.set.mutate({
                      key: PREVIEW_FFMPEG_SINGLE_THREAD_ENABLED_KEY,
                      value: true,
                    }),
                  ]);
                  setBackgroundVideoEnabled(false);
                  setBackgroundPhashScanningEnabled(false);
                  setBackgroundPhashRoundsPerPass(MIN_BACKGROUND_PHASH_ROUNDS_PER_PASS);
                  setPreviewFfmpegSingleThreadEnabled(true);
                  window.dispatchEvent(
                    new CustomEvent<boolean>(BACKGROUND_VIDEO_ENABLED_EVENT, { detail: false })
                  );
                },
              },
              {
                id: "defaults",
                label: t`Apply defaults`,
                onClick: async () => {
                  await Promise.all([
                    trpc.store.set.mutate({
                      key: BACKGROUND_VIDEO_ENABLED_KEY,
                      value: DEFAULT_BACKGROUND_VIDEO_ENABLED,
                    }),
                    trpc.store.set.mutate({
                      key: BACKGROUND_PHASH_SCANNING_ENABLED_KEY,
                      value: DEFAULT_BACKGROUND_PHASH_SCANNING_ENABLED,
                    }),
                    trpc.store.set.mutate({
                      key: BACKGROUND_PHASH_ROUNDS_PER_PASS_KEY,
                      value: DEFAULT_BACKGROUND_PHASH_ROUNDS_PER_PASS,
                    }),
                    trpc.store.set.mutate({
                      key: PREVIEW_FFMPEG_SINGLE_THREAD_ENABLED_KEY,
                      value: DEFAULT_PREVIEW_FFMPEG_SINGLE_THREAD_ENABLED,
                    }),
                  ]);
                  setBackgroundVideoEnabled(DEFAULT_BACKGROUND_VIDEO_ENABLED);
                  setBackgroundPhashScanningEnabled(DEFAULT_BACKGROUND_PHASH_SCANNING_ENABLED);
                  setBackgroundPhashRoundsPerPass(DEFAULT_BACKGROUND_PHASH_ROUNDS_PER_PASS);
                  setPreviewFfmpegSingleThreadEnabled(DEFAULT_PREVIEW_FFMPEG_SINGLE_THREAD_ENABLED);
                  window.dispatchEvent(
                    new CustomEvent<boolean>(BACKGROUND_VIDEO_ENABLED_EVENT, {
                      detail: DEFAULT_BACKGROUND_VIDEO_ENABLED,
                    })
                  );
                },
              },
            ],
          },
          {
            id: "round-difficulty-actions",
            type: "actions",
            label: t`Round Difficulties`,
            description: t`Automatically estimate every installed round's difficulty from its primary funscript.`,
            actions: [
              {
                id: "recalculate-round-difficulties",
                label: t`Recalculate All Difficulties`,
                onClick: async () => {
                  setIsDifficultyRecalculationDialogOpen(true);
                },
              },
            ],
          },
          {
            id: "background-phash-scanning-enabled",
            type: "toggle",
            label: t`Background Phash Scanning`,
            description: t`Automatically compute visual fingerprints for rounds in the background. Highly recommended for accurate similarity matching.`,
            value: backgroundPhashScanningEnabled,
            onChange: async (next: boolean) => {
              await trpc.store.set.mutate({
                key: BACKGROUND_PHASH_SCANNING_ENABLED_KEY,
                value: next,
              });
              setBackgroundPhashScanningEnabled(next);
            },
          },
          {
            id: "background-phash-rounds-per-pass",
            type: "number",
            label: t`Rounds per background pHash pass`,
            description: t`Limits how many missing video fingerprints are calculated during each automatic background pass. Manual scans still process the full backlog.`,
            value: backgroundPhashRoundsPerPass,
            min: MIN_BACKGROUND_PHASH_ROUNDS_PER_PASS,
            max: MAX_BACKGROUND_PHASH_ROUNDS_PER_PASS,
            onChange: async (next: number) => {
              const normalized = normalizeBackgroundPhashRoundsPerPass(next);
              await trpc.store.set.mutate({
                key: BACKGROUND_PHASH_ROUNDS_PER_PASS_KEY,
                value: normalized,
              });
              setBackgroundPhashRoundsPerPass(normalized);
            },
          },
          {
            id: "preview-ffmpeg-single-thread-enabled",
            type: "toggle",
            label: t`Limit preview ffmpeg to one thread`,
            description: t`Reduces preview generation load on weak hardware. Leave off for faster imports on stronger systems.`,
            value: previewFfmpegSingleThreadEnabled,
            onChange: async (next: boolean) => {
              await trpc.store.set.mutate({
                key: PREVIEW_FFMPEG_SINGLE_THREAD_ENABLED_KEY,
                value: next,
              });
              setPreviewFfmpegSingleThreadEnabled(next);
            },
          },
          {
            id: "database-backup-enabled",
            type: "toggle",
            label: t`Automatic Local Backups`,
            description: t`Create periodic local SQLite and settings backups in the app data folder.`,
            value: databaseBackupEnabled,
            onChange: async (next: boolean) => {
              await trpc.store.set.mutate({
                key: DATABASE_BACKUP_ENABLED_KEY,
                value: next,
              });
              setDatabaseBackupEnabled(next);
            },
          },
          {
            id: "database-backup-frequency-days",
            type: "number",
            label: t`Backup Frequency (days)`,
            description: t`Minimum number of days between automatic database and settings backups.`,
            value: databaseBackupFrequencyDays,
            min: MIN_DATABASE_BACKUP_FREQUENCY_DAYS,
            max: MAX_DATABASE_BACKUP_FREQUENCY_DAYS,
            onChange: async (next: number) => {
              const normalized = normalizeDatabaseBackupFrequencyDays(next);
              await trpc.store.set.mutate({
                key: DATABASE_BACKUP_FREQUENCY_DAYS_KEY,
                value: normalized,
              });
              setDatabaseBackupFrequencyDays(normalized);
            },
          },
          {
            id: "database-backup-retention-days",
            type: "number",
            label: t`Backup Retention (days)`,
            description: t`Delete automatic database and settings backups once they are older than this many days.`,
            value: databaseBackupRetentionDays,
            min: MIN_DATABASE_BACKUP_RETENTION_DAYS,
            max: MAX_DATABASE_BACKUP_RETENTION_DAYS,
            onChange: async (next: number) => {
              const normalized = normalizeDatabaseBackupRetentionDays(next);
              await trpc.store.set.mutate({
                key: DATABASE_BACKUP_RETENTION_DAYS_KEY,
                value: normalized,
              });
              setDatabaseBackupRetentionDays(normalized);
            },
          },
          {
            id: "database-backup-actions",
            type: "actions",
            label: t`Database Backup Actions`,
            description: t`Create a backup immediately or open the automatic backup folder. Restores are manual: close the app and replace the active database file with one of these backup files. This is not automated to avoid accidental data loss.`,
            actions: [
              {
                id: "backup-now",
                label: t`Back Up Now`,
                onClick: async () => {
                  await db.install.backupDatabaseNow();
                  showToast(t`Database backup created.`, "success");
                },
              },
              {
                id: "open-backup-folder",
                label: t`Open Backup Folder`,
                onClick: async () => {
                  await db.install.openDatabaseBackupFolder();
                },
              },
            ],
          },
          {
            id: "settings-backup-actions",
            type: "actions",
            label: t`Settings Backup Actions`,
            description: t`Create a settings backup immediately or open the automatic settings backup folder. Restores are manual: close the app and replace the active f-land.json settings file with one of these backup files.`,
            actions: [
              {
                id: "backup-settings-now",
                label: t`Back Up Settings Now`,
                onClick: async () => {
                  await db.install.backupSettingsNow();
                  showToast(t`Settings backup created.`, "success");
                },
              },
              {
                id: "open-settings-backup-folder",
                label: t`Open Settings Backup Folder`,
                onClick: async () => {
                  await db.install.openSettingsBackupFolder();
                },
              },
            ],
          },
          {
            id: "booru-cache-actions",
            type: "actions",
            label: t`Booru Cache`,
            description: t`Clear the local cache of booru (Rule34/Gelbooru/Danbooru) media items and thumbnails.`,
            actions: [
              {
                id: "clear-booru-cache",
                label: t`Clear Booru Cache`,
                onClick: async () => {
                  try {
                    await clearBooruMediaCache();
                    showToast(t`Booru cache cleared.`, "success");
                  } catch {
                    showToast(t`Failed to clear booru cache.`, "error");
                  }
                },
              },
            ],
          },
        ],
      },
      {
        id: "advanced",
        icon: "🔧",
        title: t`Advanced`,
        description: t`Technical preferences for power users.`,
        settings: [
          {
            id: "videohash-ffmpeg-source",
            type: "select",
            label: t`VideoHash FFmpeg Source`,
            description: t`Auto keeps current behavior (prefer newer system binaries). Use Bundled/System to force source selection.`,
            value: videoHashFfmpegSourcePreference,
            options: [
              { value: "auto", label: t`Auto (Default)` },
              { value: "bundled", label: t`Bundled Only` },
              { value: "system", label: t`System Only` },
            ],
            onChange: async (next: string) => {
              const value = normalizeVideoHashFfmpegSourcePreference(next);
              await trpc.store.set.mutate({ key: VIDEOHASH_FFMPEG_SOURCE_PREFERENCE_KEY, value });
              setVideoHashFfmpegSourcePreference(value);
              await refreshBinaryDiagnostics();
            },
          },
          {
            id: "yt-dlp-binary-source",
            type: "select",
            label: t`yt-dlp Binary Source`,
            description: t`Auto keeps current behavior (prefer the bundled local binary). Use Local/System to force source selection.`,
            value: ytDlpBinaryPreference,
            options: [
              { value: "auto", label: t`Auto (Default)` },
              { value: "bundled", label: t`Local Only` },
              { value: "system", label: t`System Only` },
            ],
            onChange: async (next: string) => {
              const value = normalizeYtDlpBinaryPreference(next);
              await trpc.store.set.mutate({ key: YT_DLP_BINARY_PREFERENCE_KEY, value });
              setYtDlpBinaryPreference(value);
              await refreshBinaryDiagnostics();
            },
          },
        ],
      },
      {
        id: "debug",
        icon: "🐞",
        title: t`Debug`,
        description: t`Logging, diagnostics, and public-safe support information.`,
        settings: [
          {
            id: "debug-log-level",
            type: "select",
            label: t`Log Level`,
            description: t`Controls how much diagnostic information is written to the local log file.`,
            value: debugLogLevel,
            options: DEBUG_LOG_LEVELS.map((level) => ({
              value: level,
              label:
                level === "off"
                  ? t`Off`
                  : level === "error"
                    ? t`Error`
                    : level === "warn"
                      ? t`Warn`
                      : level === "info"
                        ? t`Info`
                        : t`Debug`,
            })),
            onChange: async (next: string) => {
              const level = normalizeDebugLogLevel(next);
              await trpc.debug.setLogLevel.mutate({ level });
              setDebugLogLevel(level);
              setDebugMessage(t`Debug log level updated.`);
              await refreshDebugInfo();
            },
          },
          {
            id: "always-recovery-mode",
            type: "toggle",
            label: t`Always Start in Recovery Mode`,
            description: t`Boot directly into recovery mode on every app launch. Use this when normal startup keeps failing. “Start Normally” in recovery still opens the app once; a full restart returns to recovery until disabled.`,
            value: alwaysRecoveryMode,
            onChange: async (next: boolean) => {
              await trpc.store.set.mutate({ key: ALWAYS_RECOVERY_MODE_KEY, value: next });
              setAlwaysRecoveryMode(next);
              setDebugMessage(
                next
                  ? t`The app will always start in recovery mode.`
                  : t`Always start in recovery mode disabled.`
              );
            },
          },
          {
            id: "debug-log-max-file-size",
            type: "number",
            label: t`Max Log File Size (MB)`,
            description: t`When the log file exceeds this size, the oldest entries are pruned.`,
            value: debugLogMaxFileSizeMb,
            min: 1,
            max: 10000,
            onChange: async (next: number) => {
              await trpc.debug.setMaxFileSizeMb.mutate({ maxFileSizeMb: next });
              setDebugLogMaxFileSizeMb(next);
              await refreshDebugInfo();
            },
          },
          {
            id: "ffmpeg-gpu-preference",
            type: "select",
            label: t`GPU Preference (FFmpeg & Electron)`,
            description: t`Choose which GPU is used by FFmpeg and Electron's renderer. "Default" lets the OS decide. On Linux, selects the GPU via DRI_PRIME for both FFmpeg transcoding and Electron's Chromium GPU process. On Windows/macOS, selects the Electron rendering GPU via the --gpu-device-index switch (FFmpeg codec selection is unaffected). Requires an app restart to apply.`,
            value: ffmpegGpuPreference,
            options: [
              { value: "default" as FfmpegGpuPreference, label: t`Default (OS decides)` },
              ...availableGpus.map((gpu) => ({
                value: `gpu:${gpu.index}` as FfmpegGpuPreference,
                label: `GPU ${gpu.index}: ${gpu.name}`,
              })),
            ],
            onChange: async (next: string) => {
              const pref = normalizeFfmpegGpuPreference(next);
              await trpc.store.set.mutate({ key: FFMPEG_GPU_PREFERENCE_KEY, value: pref });
              setFfmpegGpuPreference(pref);
            },
          },
          {
            id: "graphics-disable-zero-copy",
            type: "toggle",
            label: t`Disable Zero-Copy Rendering`,
            description: t`Compatibility option for NVIDIA/Chromium video or compositor flicker. Requires an app restart.`,
            value: graphicsDisableZeroCopyEnabled,
            onChange: async (next: boolean) => {
              await trpc.store.set.mutate({
                key: GRAPHICS_DISABLE_ZERO_COPY_ENABLED_KEY,
                value: next,
              });
              setGraphicsDisableZeroCopyEnabled(next);
              setDebugMessage(t`Graphics setting saved. Restart the app to apply it.`);
              await refreshDebugInfo();
            },
          },
          {
            id: "graphics-use-gpu-blocklist",
            type: "toggle",
            label: t`Use Chromium GPU Blocklist`,
            description: t`Stops forcing Chromium to ignore its GPU blocklist. Try this for GPU-specific rendering issues. Requires an app restart.`,
            value: graphicsDisableGpuBlocklistOverrideEnabled,
            onChange: async (next: boolean) => {
              await trpc.store.set.mutate({
                key: GRAPHICS_DISABLE_GPU_BLOCKLIST_OVERRIDE_ENABLED_KEY,
                value: next,
              });
              setGraphicsDisableGpuBlocklistOverrideEnabled(next);
              setDebugMessage(t`Graphics setting saved. Restart the app to apply it.`);
              await refreshDebugInfo();
            },
          },
          {
            id: "graphics-safe-mode",
            type: "toggle",
            label: t`Graphics Safe Mode`,
            description: t`Disables hardware acceleration on next launch. Use only when GPU rendering or video surfaces are unstable. Requires an app restart.`,
            value: graphicsSafeModeEnabled,
            onChange: async (next: boolean) => {
              await trpc.store.set.mutate({ key: GRAPHICS_SAFE_MODE_ENABLED_KEY, value: next });
              setGraphicsSafeModeEnabled(next);
              setDebugMessage(t`Graphics setting saved. Restart the app to apply it.`);
              await refreshDebugInfo();
            },
          },
          {
            id: "graphics-disable-gpu-rasterization",
            type: "toggle",
            label: t`Disable GPU Rasterization`,
            description: t`Forces software rasterization instead of using the GPU. Can fix visual artifacts or crashes on some GPU drivers. Requires an app restart.`,
            value: graphicsDisableGpuRasterizationEnabled,
            onChange: async (next: boolean) => {
              await trpc.store.set.mutate({
                key: GRAPHICS_DISABLE_GPU_RASTERIZATION_ENABLED_KEY,
                value: next,
              });
              setGraphicsDisableGpuRasterizationEnabled(next);
              setDebugMessage(t`Graphics setting saved. Restart the app to apply it.`);
              await refreshDebugInfo();
            },
          },
          {
            id: "graphics-disable-gpu-compositing",
            type: "toggle",
            label: t`Disable GPU Compositing`,
            description: t`Prevents the GPU from compositing render layers. Can fix flickering or blank screens on some hardware. Requires an app restart.`,
            value: graphicsDisableGpuCompositingEnabled,
            onChange: async (next: boolean) => {
              await trpc.store.set.mutate({
                key: GRAPHICS_DISABLE_GPU_COMPOSITING_ENABLED_KEY,
                value: next,
              });
              setGraphicsDisableGpuCompositingEnabled(next);
              setDebugMessage(t`Graphics setting saved. Restart the app to apply it.`);
              await refreshDebugInfo();
            },
          },
          {
            id: "graphics-disable-accelerated-video-decode",
            type: "toggle",
            label: t`Disable Accelerated Video Decode`,
            description: t`Forces software video decoding instead of GPU-accelerated decode. Can fix video playback issues or crashes. Requires an app restart.`,
            value: graphicsDisableAcceleratedVideoDecodeEnabled,
            onChange: async (next: boolean) => {
              await trpc.store.set.mutate({
                key: GRAPHICS_DISABLE_ACCELERATED_VIDEO_DECODE_ENABLED_KEY,
                value: next,
              });
              setGraphicsDisableAcceleratedVideoDecodeEnabled(next);
              setDebugMessage(t`Graphics setting saved. Restart the app to apply it.`);
              await refreshDebugInfo();
            },
          },
          {
            id: "graphics-disable-gpu-shader-disk-cache",
            type: "toggle",
            label: t`Disable GPU Shader Disk Cache`,
            description: t`Prevents Chromium from caching compiled GPU shaders on disk. Can fix GPU process crashes caused by corrupted shader caches after NVIDIA driver updates. Requires an app restart.`,
            value: graphicsDisableGpuShaderDiskCacheEnabled,
            onChange: async (next: boolean) => {
              await trpc.store.set.mutate({
                key: GRAPHICS_DISABLE_GPU_SHADER_DISK_CACHE_ENABLED_KEY,
                value: next,
              });
              setGraphicsDisableGpuShaderDiskCacheEnabled(next);
              setDebugMessage(t`Graphics setting saved. Restart the app to apply it.`);
              await refreshDebugInfo();
            },
          },
          {
            id: "graphics-disable-accelerated-video-encode",
            type: "toggle",
            label: t`Disable Accelerated Video Encode`,
            description: t`Forces software video encoding instead of GPU-accelerated encode (NVENC). Can fix crashes when the GPU is under heavy concurrent load from WebGL rendering. Requires an app restart.`,
            value: graphicsDisableAcceleratedVideoEncodeEnabled,
            onChange: async (next: boolean) => {
              await trpc.store.set.mutate({
                key: GRAPHICS_DISABLE_ACCELERATED_VIDEO_ENCODE_ENABLED_KEY,
                value: next,
              });
              setGraphicsDisableAcceleratedVideoEncodeEnabled(next);
              setDebugMessage(t`Graphics setting saved. Restart the app to apply it.`);
              await refreshDebugInfo();
            },
          },
          {
            id: "graphics-disable-gpu-vsync",
            type: "toggle",
            label: t`Disable GPU VSync`,
            description: t`Passes Chromium --disable-gpu-vsync on startup. Use for graphics timing diagnostics or vsync-related stalls. Requires an app restart.`,
            value: graphicsDisableGpuVsyncEnabled,
            onChange: async (next: boolean) => {
              await trpc.store.set.mutate({
                key: GRAPHICS_DISABLE_GPU_VSYNC_ENABLED_KEY,
                value: next,
              });
              setGraphicsDisableGpuVsyncEnabled(next);
              setDebugMessage(t`Graphics setting saved. Restart the app to apply it.`);
              await refreshDebugInfo();
            },
          },
          {
            id: "graphics-force-angle-opengl",
            type: "toggle",
            label: t`Force OpenGL ANGLE Backend`,
            description: t`Forces Chromium's ANGLE layer to use OpenGL instead of the default backend (Vulkan on Linux). Can fix GPU process crashes on NVIDIA drivers with broken Vulkan support. Requires an app restart.`,
            value: graphicsForceAngleOpenGLEnabled,
            onChange: async (next: boolean) => {
              await trpc.store.set.mutate({
                key: GRAPHICS_FORCE_ANGLE_OPENGL_ENABLED_KEY,
                value: next,
              });
              setGraphicsForceAngleOpenGLEnabled(next);
              setDebugMessage(t`Graphics setting saved. Restart the app to apply it.`);
              await refreshDebugInfo();
            },
          },
          {
            id: "graphics-disable-webgl2",
            type: "toggle",
            label: t`Disable WebGL 2`,
            description: t`Forces fallback to WebGL 1. Some NVIDIA driver versions have broken WebGL 2 implementations that cause context loss and renderer crashes. Requires an app restart.`,
            value: graphicsDisableWebgl2Enabled,
            onChange: async (next: boolean) => {
              await trpc.store.set.mutate({
                key: GRAPHICS_DISABLE_WEBGL2_ENABLED_KEY,
                value: next,
              });
              setGraphicsDisableWebgl2Enabled(next);
              setDebugMessage(t`Graphics setting saved. Restart the app to apply it.`);
              await refreshDebugInfo();
            },
          },
          {
            id: "graphics-restart-app",
            type: "actions",
            label: t`Restart App`,
            description: t`Graphics compatibility settings require a restart to take effect. Click below to restart the app now.`,
            actions: [
              {
                id: "restart-app",
                label: t`Restart App`,
                onClick: async () => {
                  await trpc.debug.relaunchApp.mutate();
                },
              },
            ],
          },
        ],
      },
      {
        id: "experimental",
        icon: "🧪",
        title: t`Experimental`,
        description: t`Opt into unfinished features that may change or break between builds.`,
        settings: [
          {
            id: "system-language-enabled",
            type: "toggle",
            label: t`Use System Language`,
            description: t`When enabled, first launch may use your system language if it is supported. Disabled by default so English remains the default language.`,
            value: systemLanguageEnabled,
            onChange: async (next: boolean) => {
              await trpc.store.set.mutate({
                key: SYSTEM_LANGUAGE_ENABLED_KEY,
                value: next,
              });
              setSystemLanguageEnabled(next);
            },
          },
          {
            id: "controller-support-enabled",
            type: "toggle",
            label: t`Controller Support`,
            description: t`Experimental gamepad navigation and input support. Disabled by default until it is more stable. Expect some things to not work as expected.`,
            value: controllerSupportEnabled,
            onChange: async (next: boolean) => {
              await trpc.store.set.mutate({ key: CONTROLLER_SUPPORT_ENABLED_KEY, value: next });
              setControllerSupportEnabled(next);
              window.dispatchEvent(
                new CustomEvent<boolean>(CONTROLLER_SUPPORT_ENABLED_EVENT, { detail: next })
              );
            },
          },
          {
            id: "fps-counter-enabled",
            type: "toggle",
            label: t`FPS Counter`,
            description: t`Shows a global frames-per-second counter in the top-right corner. The display updates at a low frequency to keep overhead low.`,
            value: fpsCounterEnabled,
            onChange: async (next: boolean) => {
              await trpc.store.set.mutate({ key: FPS_COUNTER_ENABLED_KEY, value: next });
              window.localStorage.setItem(FPS_COUNTER_ENABLED_KEY, String(next));
              setFpsCounterEnabled(next);
              window.dispatchEvent(
                new CustomEvent<boolean>(FPS_COUNTER_ENABLED_EVENT, { detail: next })
              );
            },
          },
          {
            id: "playlist-cache-ongoing-restriction-disabled",
            type: "toggle",
            label: t`Allow Playlist Start During Cache Ongoing`,
            description: t`Lets singleplayer start while required web rounds are still caching. Warning: some rounds may not play, and the web version is used instead of the local cache.`,
            value: playlistCacheOngoingRestrictionDisabled,
            onChange: async (next: boolean) => {
              await trpc.store.set.mutate({
                key: PLAYLIST_CACHE_ONGOING_RESTRICTION_DISABLED_KEY,
                value: next,
              });
              setPlaylistCacheOngoingRestrictionDisabled(next);
            },
          },
          {
            id: "install-web-funscript-url-enabled",
            type: "toggle",
            label: t`Show Web Install Funscript URL`,
            description: t`Exposes an optional remote funscript URL field in the Install From Web dialog. Disabled by default so web installs prefer a local funscript file.`,
            value: installWebFunscriptUrlEnabled,
            onChange: async (next: boolean) => {
              await trpc.store.set.mutate({
                key: INSTALL_WEB_FUNSCRIPT_URL_ENABLED_KEY,
                value: next,
              });
              setInstallWebFunscriptUrlEnabled(next);
            },
          },
          {
            id: "device-animation-test-enabled",
            type: "toggle",
            label: t`Device Animation Test`,
            description: t`Shows the Test Device panel in Hardware & Sync for visual sync checks with a generated motion loop.`,
            value: deviceAnimationTestEnabled,
            onChange: async (next: boolean) => {
              await trpc.store.set.mutate({
                key: DEVICE_ANIMATION_TEST_ENABLED_KEY,
                value: next,
              });
              setDeviceAnimationTestEnabled(next);
            },
          },
          {
            id: "gameplay-haptics-perks-without-device",
            type: "toggle",
            label: t`Allow Haptics Anti-Perks Without Device`,
            description: t`Keep haptics-themed anti-perks available for their visual effects even when no haptics device is connected.`,
            value: gameplayHapticsPerksWithoutDevice,
            onChange: async (next: boolean) => {
              await trpc.store.set.mutate({
                key: GAMEPLAY_HAPTICS_PERKS_WITHOUT_DEVICE_KEY,
                value: next,
              });
              setGameplayHapticsPerksWithoutDevice(next);
            },
          },
        ],
      },
      {
        id: "help",
        icon: "?",
        title: t`Help`,
        description: t`Keyboard shortcut reference for the app, editor, and gameplay screens.`,
        settings: [],
      },
      {
        id: "changelog",
        icon: "✦",
        title: t`What's New`,
        description: t`Recent releases, fixes, and gameplay updates.`,
        settings: [],
      },
      {
        id: "credits",
        icon: "★",
        title: t`Credits / License`,
        description: t`Special thanks & inspiration.`,
        settings: [],
      },
    ],
    [
      backgroundVideoEnabled,
      mainMenuThemeId,
      antiPerkBeatbarEnabled,
      gameplayHapticsPerksWithoutDevice,
      hapticsDisconnectedStatusVisible,
      applyPerkDirectly,
      autofixBrokenFunscripts,
      stashReattachFunscriptsMode,
      intermediaryLoadingDurationSec,
      intermediaryLoadingPrompt,
      intermediaryReturnPauseSec,
      isFullscreen,
      roundProgressBarAlwaysVisible,
      controllerSupportEnabled,
      fpsCounterEnabled,
      cheatModeEnabled,
      sfwModeEnabled,
      multiplayerSkipRoundsCheck,
      installWebFunscriptUrlEnabled,
      systemLanguageEnabled,
      playlistCacheOngoingRestrictionDisabled,
      ignorePlaylistLevelRequirements,
      videoHashFfmpegSourcePreference,
      ytDlpBinaryPreference,
      backgroundPhashScanningEnabled,
      backgroundPhashRoundsPerPass,
      previewFfmpegSingleThreadEnabled,
      databaseBackupEnabled,
      databaseBackupFrequencyDays,
      databaseBackupRetentionDays,
      startupSafeModeShortcutEnabled,
      deviceAnimationTestEnabled,
      locale,
      locales,
      setLocale,
      showToast,
      t,
      refreshBinaryDiagnostics,
      debugLogLevel,
      debugLogMaxFileSizeMb,
      alwaysRecoveryMode,
      ffmpegGpuPreference,
      availableGpus,
      graphicsSafeModeEnabled,
      graphicsDisableZeroCopyEnabled,
      graphicsDisableGpuBlocklistOverrideEnabled,
      graphicsDisableGpuRasterizationEnabled,
      graphicsDisableGpuCompositingEnabled,
      graphicsDisableAcceleratedVideoDecodeEnabled,
      graphicsDisableGpuShaderDiskCacheEnabled,
      graphicsDisableAcceleratedVideoEncodeEnabled,
      graphicsDisableGpuVsyncEnabled,
      graphicsForceAngleOpenGLEnabled,
      graphicsDisableWebgl2Enabled,
      refreshDebugInfo,
    ]
  );
  const [activeSectionId, setActiveSectionId] = useState<SettingsSectionId>(
    search.section ?? sections[0]?.id ?? "general"
  );

  useEffect(() => {
    if (search.section && search.section !== activeSectionId) {
      setActiveSectionId(search.section);
    }
  }, [activeSectionId, search.section]);

  useEffect(() => {
    if (!sections.some((section) => section.id === activeSectionId)) {
      setActiveSectionId(sections[0]?.id ?? "general");
    }
  }, [sections, activeSectionId]);

  useEffect(() => {
    if (activeSectionId !== "advanced") return;
    void refreshBinaryDiagnostics();
  }, [activeSectionId, refreshBinaryDiagnostics]);

  useEffect(() => {
    if (activeSectionId !== "debug") return;
    void refreshDebugInfo();
  }, [activeSectionId, refreshDebugInfo]);

  const activeSection = sections.find((section) => section.id === activeSectionId) ?? sections[0];

  const selectSection = useCallback(
    (sectionId: SettingsSectionId) => {
      setActiveSectionId(sectionId);
      void navigate({
        to: "/settings",
        search: { section: sectionId },
        replace: true,
      });
    },
    [navigate]
  );

  const handleControllerBack = useCallback(() => {
    playSelectSound();
    navigate({ to: "/" });
    return true;
  }, [navigate]);

  useControllerSurface({
    id: "settings-page",
    priority: 10,
    enabled: controllerSupportEnabled,
    onBack: handleControllerBack,
  });

  const addFolders = async () => {
    if (isUpdatingAutoScanFolders) return;
    setIsUpdatingAutoScanFolders(true);
    setFolderImportNotices([]);
    try {
      const selected = await window.electronAPI.dialog.selectFolders();
      if (selected.length === 0) return;

      let latest = autoScanFolders;
      const notices: FolderImportNotice[] = [];
      for (const folderPath of selected) {
        try {
          const added = await db.install.addAutoScanFolderAndScan(folderPath);
          latest = added.folders;
          notices.push({
            folderPath,
            tone: added.result.status.state === "error" ? "error" : "success",
            message: toFolderImportMessage(added.result),
          });
        } catch (error) {
          notices.push({
            folderPath,
            tone: "error",
            message: error instanceof Error ? error.message : "Failed to add and import folder.",
          });
        }
      }
      setAutoScanFolders(latest);
      setFolderImportNotices(notices);
    } catch (error) {
      console.error("Failed to add auto-scan folders", error);
    } finally {
      setIsUpdatingAutoScanFolders(false);
    }
  };

  const removeFolder = async (folderPath: string) => {
    if (isUpdatingAutoScanFolders) return;
    setIsUpdatingAutoScanFolders(true);
    try {
      const next = await db.install.removeAutoScanFolder(folderPath);
      setAutoScanFolders(next);
    } catch (error) {
      console.error("Failed to remove auto-scan folder", error);
    } finally {
      setIsUpdatingAutoScanFolders(false);
    }
  };

  const chooseWebsiteVideoCacheFolder = async () => {
    if (isUpdatingWebsiteVideoCacheRootPath) return;
    setIsUpdatingWebsiteVideoCacheRootPath(true);
    try {
      const selected = await window.electronAPI.dialog.selectWebsiteVideoCacheDirectory();
      if (!selected) return;
      const value = selected.trim();
      await trpc.store.set.mutate({ key: WEBSITE_VIDEO_CACHE_ROOT_PATH_KEY, value });
      setWebsiteVideoCacheRootPath(value);
    } catch (error) {
      console.error("Failed to update website video cache folder", error);
    } finally {
      setIsUpdatingWebsiteVideoCacheRootPath(false);
    }
  };

  const resetWebsiteVideoCacheFolder = async () => {
    setIsUpdatingWebsiteVideoCacheRootPath(true);
    try {
      await trpc.store.set.mutate({ key: WEBSITE_VIDEO_CACHE_ROOT_PATH_KEY, value: null });
      setWebsiteVideoCacheRootPath(null);
    } catch (error) {
      console.error("Failed to reset website video cache folder", error);
    } finally {
      setIsUpdatingWebsiteVideoCacheRootPath(false);
    }
  };

  const chooseEroScriptsCacheFolder = async () => {
    if (isUpdatingEroScriptsCacheRootPath) return;
    setIsUpdatingEroScriptsCacheRootPath(true);
    try {
      const selected = await window.electronAPI.dialog.selectEroScriptsCacheDirectory();
      if (!selected) return;
      const value = selected.trim();
      await trpc.store.set.mutate({ key: EROSCRIPTS_CACHE_ROOT_PATH_KEY, value });
      setEroScriptsCacheRootPath(value);
    } catch (error) {
      console.error("Failed to update EroScripts cache folder", error);
    } finally {
      setIsUpdatingEroScriptsCacheRootPath(false);
    }
  };

  const resetEroScriptsCacheFolder = async () => {
    if (isUpdatingEroScriptsCacheRootPath) return;
    setIsUpdatingEroScriptsCacheRootPath(true);
    try {
      await trpc.store.set.mutate({ key: EROSCRIPTS_CACHE_ROOT_PATH_KEY, value: null });
      setEroScriptsCacheRootPath(null);
    } catch (error) {
      console.error("Failed to reset EroScripts cache folder", error);
    } finally {
      setIsUpdatingEroScriptsCacheRootPath(false);
    }
  };

  const openEroScriptsLogin = async () => {
    if (isSavingEroScriptsAuth) return;
    setIsSavingEroScriptsAuth(true);
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
      setIsSavingEroScriptsAuth(false);
    }
  };

  const refreshEroScriptsLoginStatus = async () => {
    if (isSavingEroScriptsAuth) return;
    setIsSavingEroScriptsAuth(true);
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
      setIsSavingEroScriptsAuth(false);
    }
  };

  const clearEroScriptsLogin = async () => {
    if (isSavingEroScriptsAuth) return;
    setIsSavingEroScriptsAuth(true);
    setEroScriptsAuthMessage(null);
    try {
      const status = await trpc.eroscripts.clearLoginCookies.mutate();
      setEroScriptsLoginStatus(status);
      setEroScriptsAuthMessage(t`EroScripts login cookies cleared.`);
    } catch (error) {
      setEroScriptsAuthMessage(
        error instanceof Error ? error.message : t`Failed to clear EroScripts login cookies.`
      );
    } finally {
      setIsSavingEroScriptsAuth(false);
    }
  };

  const chooseFpackExtractionFolder = async () => {
    try {
      const folderPath = await window.electronAPI.dialog.selectFpackExtractionDirectory();
      if (!folderPath) return;

      setIsUpdatingFpackExtractionPath(true);
      await trpc.store.set.mutate({ key: FPACK_EXTRACTION_PATH_KEY, value: folderPath });
      setFpackExtractionPath(folderPath);
    } catch (error) {
      console.error("Failed to choose fpack extraction folder", error);
    } finally {
      setIsUpdatingFpackExtractionPath(false);
    }
  };

  const resetFpackExtractionFolder = async () => {
    setIsUpdatingFpackExtractionPath(true);
    try {
      await trpc.store.set.mutate({ key: FPACK_EXTRACTION_PATH_KEY, value: null });
      setFpackExtractionPath(null);
    } catch (error) {
      console.error("Failed to reset fpack extraction folder", error);
    } finally {
      setIsUpdatingFpackExtractionPath(false);
    }
  };

  const chooseMusicCacheFolder = async () => {
    if (isUpdatingMusicCacheRootPath) return;
    setIsUpdatingMusicCacheRootPath(true);
    try {
      const selected = await window.electronAPI.dialog.selectMusicCacheDirectory();
      if (!selected) return;
      const value = selected.trim();
      await trpc.store.set.mutate({ key: MUSIC_CACHE_ROOT_PATH_KEY, value });
      setMusicCacheRootPath(value);
    } catch (error) {
      console.error("Failed to update music cache folder", error);
    } finally {
      setIsUpdatingMusicCacheRootPath(false);
    }
  };

  const resetMusicCacheFolder = async () => {
    if (isUpdatingMusicCacheRootPath) return;
    setIsUpdatingMusicCacheRootPath(true);
    try {
      await trpc.store.set.mutate({ key: MUSIC_CACHE_ROOT_PATH_KEY, value: null });
      setMusicCacheRootPath(null);
    } catch (error) {
      console.error("Failed to reset music cache folder", error);
    } finally {
      setIsUpdatingMusicCacheRootPath(false);
    }
  };

  const openConfiguredPath = async (
    target: "website-video-cache" | "music-cache" | "fpack-extraction" | "eroscripts-cache"
  ) => {
    if (openingPathTarget) return;
    setOpeningPathTarget(target);
    try {
      await trpc.db.openConfiguredPath.mutate({ target });
    } catch (error) {
      console.error("Failed to open configured path", error);
    } finally {
      setOpeningPathTarget(null);
    }
  };

  const runZoomAction = async (action: () => Promise<number>) => {
    setIsLoadingZoom(true);
    try {
      const nextZoomPercent = await action();
      setZoomPercent(nextZoomPercent);
    } catch (error) {
      console.error("Failed to update app zoom", error);
    } finally {
      setIsLoadingZoom(false);
    }
  };

  const clearData = async () => {
    if (isClearingData) return;

    setIsClearingData(true);
    setClearDataError(null);
    try {
      await db.install.clearAllData(clearSelections);
      if (clearSelections.settings) {
        window.localStorage.clear();
        window.sessionStorage.clear();
        window.location.reload();
      } else {
        setIsClearingData(false);
        setIsClearDataDialogOpen(false);
      }
    } catch (error) {
      console.error("Failed to clear data", error);
      setClearDataError(error instanceof Error ? error.message : "Failed to clear data.");
      setIsClearingData(false);
    }
  };

  const copyDebugInfo = async () => {
    if (isCopyingDebug) return;
    setIsCopyingDebug(true);
    setDebugMessage(null);
    try {
      const result = await trpc.debug.copyDebugBundle.mutate();
      setDebugMessage(t`Debug info copied.`);
      showToast(t`Debug info copied.`, "success");
      if (result.bytes > 0) {
        await refreshDebugInfo();
      }
    } catch (error) {
      console.error("Failed to copy debug info", error);
      setDebugMessage(error instanceof Error ? error.message : t`Failed to copy debug info.`);
    } finally {
      setIsCopyingDebug(false);
    }
  };

  const exportDebugFile = async () => {
    if (isExportingDebug) return;
    setIsExportingDebug(true);
    setDebugMessage(null);
    try {
      const result = await trpc.debug.exportDebugBundle.mutate();
      setDebugMessage(result.anonymizedFilePath ? t`Debug file exported.` : t`Export cancelled.`);
      if (result.anonymizedFilePath) {
        showToast(t`Debug file exported.`, "success");
      }
      await refreshDebugInfo();
    } catch (error) {
      console.error("Failed to export debug file", error);
      setDebugMessage(error instanceof Error ? error.message : t`Failed to export debug file.`);
    } finally {
      setIsExportingDebug(false);
    }
  };

  const createPlaintextSettingsFile = async () => {
    if (isCreatingPlaintextSettings) return;
    setIsCreatingPlaintextSettings(true);
    setDebugMessage(null);
    try {
      await db.install.createPlaintextSettingsFile();
      setDebugMessage(t`Plaintext settings file created.`);
      showToast(t`Plaintext settings file created.`, "success");
    } catch (error) {
      console.error("Failed to create plaintext settings file", error);
      setDebugMessage(
        error instanceof Error ? error.message : t`Failed to create plaintext settings file.`
      );
    } finally {
      setIsCreatingPlaintextSettings(false);
    }
  };

  const openDebugLogFolder = async () => {
    try {
      await trpc.debug.openLogFolder.mutate();
    } catch (error) {
      console.error("Failed to open debug log folder", error);
      setDebugMessage(error instanceof Error ? error.message : t`Failed to open log folder.`);
    }
  };

  const clearDebugLog = async () => {
    if (isClearingLog) return;
    setIsClearingLog(true);
    setDebugMessage(null);
    try {
      await trpc.debug.clearLogFile.mutate();
      setDebugMessage(t`Log file cleared.`);
      await refreshDebugInfo();
    } catch (error) {
      console.error("Failed to clear debug log", error);
      setDebugMessage(error instanceof Error ? error.message : t`Failed to clear log file.`);
    } finally {
      setIsClearingLog(false);
    }
  };

  return (
    <div className="relative min-h-screen overflow-hidden">
      <AnimatedBackground quality="minimal" />

      <div className="relative z-10 flex h-screen flex-col overflow-hidden lg:flex-row">
        {/* ── Sidebar (vertical on lg+, horizontal strip on small) ── */}
        <nav className="app-theme-shell-border animate-entrance flex shrink-0 flex-row gap-1 overflow-x-auto border-b bg-zinc-950/70 px-3 py-2 backdrop-blur-xl lg:w-60 lg:flex-col lg:gap-0.5 lg:overflow-x-visible lg:overflow-y-auto lg:border-b-0 lg:border-r lg:px-3 lg:py-6">
          {/* Title — only visible on lg+ */}
          <div className="hidden lg:block lg:mb-5 lg:px-3">
            <p className="app-theme-eyebrow font-[family-name:var(--font-jetbrains-mono)] text-[0.6rem] uppercase tracking-[0.45em]">
              <Trans>System Config</Trans>
            </p>
            <h1 className="app-theme-heading mt-1.5 text-xl font-black tracking-tight">
              <Trans>Settings</Trans>
            </h1>
          </div>

          {sections.map((section, index) => {
            const active = section.id === activeSectionId;
            return (
              <button
                key={section.id}
                type="button"
                data-controller-focus-id={`settings-sidebar-${section.id}`}
                data-controller-down={
                  index < sections.length - 1
                    ? `settings-sidebar-${sections[index + 1].id}`
                    : undefined
                }
                data-controller-up={
                  index > 0 ? `settings-sidebar-${sections[index - 1].id}` : undefined
                }
                onMouseEnter={playHoverSound}
                onFocus={playHoverSound}
                onClick={() => {
                  playSelectSound();
                  selectSection(section.id);
                }}
                className={`settings-sidebar-item whitespace-nowrap ${active ? "is-active" : ""}`}
              >
                <span className="settings-sidebar-icon">{section.icon}</span>
                <span>{section.title}</span>
              </button>
            );
          })}

          {/* Back button — sidebar footer */}
          <div className="hidden lg:mt-auto lg:block lg:px-1 lg:pt-4">
            <MenuButton
              label={t`← Back`}
              controllerFocusId="settings-back"
              onHover={playHoverSound}
              onClick={() => {
                playSelectSound();
                navigate({ to: "/" });
              }}
            />
          </div>
        </nav>

        {/* ── Content area ── */}
        <div className="flex-1 overflow-y-auto px-4 py-6 sm:px-8 lg:px-10 lg:py-8">
          <main className="parallax-ui-none mx-auto flex w-full max-w-3xl flex-col gap-5">
            {/* Section header */}
            {activeSection && (
              <header className="settings-panel-enter mb-1" key={`header-${activeSection.id}`}>
                <h2 className="app-theme-heading text-2xl font-black tracking-tight sm:text-3xl">
                  {activeSection.title}
                </h2>
                <p className="mt-1.5 text-sm text-zinc-400">{activeSection.description}</p>
              </header>
            )}

            {/* Section content */}
            <div
              className="settings-panel-enter flex flex-col gap-5"
              key={`content-${activeSection?.id}`}
            >
              {activeSection && activeSection.id === "sources" ? (
                <>
                  <SettingsSectionCard section={activeSection} loading={isInitialLoading} />
                  <EroScriptsSettingsCard
                    status={eroscriptsLoginStatus}
                    message={eroscriptsAuthMessage}
                    isLoading={isLoadingEroScriptsAuth}
                    isPending={isSavingEroScriptsAuth}
                    onLogin={() => {
                      playSelectSound();
                      void openEroScriptsLogin();
                    }}
                    onRefresh={() => {
                      playSelectSound();
                      void refreshEroScriptsLoginStatus();
                    }}
                    onClear={() => {
                      playSelectSound();
                      void clearEroScriptsLogin();
                    }}
                  />
                  <SourceIntegrationsCard />
                  <AcquisitionSourcesCard />
                  <AutoScanFoldersCard
                    folders={autoScanFolders}
                    notices={folderImportNotices}
                    isLoading={isInitialLoading}
                    isPending={isUpdatingAutoScanFolders}
                    onAddFolders={() => {
                      playSelectSound();
                      void addFolders();
                    }}
                    onRemoveFolder={(folderPath) => {
                      playSelectSound();
                      void removeFolder(folderPath);
                    }}
                  />
                </>
              ) : activeSection && activeSection.id === "general" ? (
                <>
                  <SettingsSectionCard section={activeSection} loading={isInitialLoading} />
                  <AppZoomCard
                    zoomPercent={zoomPercent}
                    isLoading={isLoadingZoom}
                    onZoomIn={() => {
                      playSelectSound();
                      void runZoomAction(
                        () =>
                          window.electronAPI.window.zoomIn?.() ??
                          Promise.resolve(zoomPercent ?? 100)
                      );
                    }}
                    onZoomOut={() => {
                      playSelectSound();
                      void runZoomAction(
                        () =>
                          window.electronAPI.window.zoomOut?.() ??
                          Promise.resolve(zoomPercent ?? 100)
                      );
                    }}
                    onResetZoom={() => {
                      playSelectSound();
                      void runZoomAction(
                        () =>
                          window.electronAPI.window.resetZoom?.() ??
                          Promise.resolve(zoomPercent ?? 100)
                      );
                    }}
                  />
                  <OnboardingCard />
                </>
              ) : activeSection && activeSection.id === "audio" ? (
                <>
                  <MusicSettingsCard />
                  <MoaningSettingsCard />
                </>
              ) : activeSection && activeSection.id === "security-privacy" ? (
                <>
                  <SettingsSectionCard section={activeSection} loading={isInitialLoading} />
                  <SecuritySettingsCard />
                </>
              ) : activeSection && activeSection.id === "app" ? (
                <>
                  <AppUpdateCard appUpdate={appUpdate} />
                  <SettingsSectionCard section={activeSection} loading={isInitialLoading} />
                  <MusicCacheLocationCard
                    configuredPath={musicCacheRootPath}
                    isLoading={isInitialLoading}
                    isPending={isUpdatingMusicCacheRootPath}
                    isOpening={openingPathTarget === "music-cache"}
                    onChooseFolder={() => {
                      playSelectSound();
                      void chooseMusicCacheFolder();
                    }}
                    onOpenCurrentLocation={() => {
                      playSelectSound();
                      void openConfiguredPath("music-cache");
                    }}
                    onReset={() => {
                      playSelectSound();
                      void resetMusicCacheFolder();
                    }}
                  />
                  <WebsiteVideoCacheLocationCard
                    configuredPath={websiteVideoCacheRootPath}
                    isLoading={isInitialLoading}
                    isPending={isUpdatingWebsiteVideoCacheRootPath}
                    isOpening={openingPathTarget === "website-video-cache"}
                    onChooseFolder={() => {
                      playSelectSound();
                      void chooseWebsiteVideoCacheFolder();
                    }}
                    onOpenCurrentLocation={() => {
                      playSelectSound();
                      void openConfiguredPath("website-video-cache");
                    }}
                    onReset={() => {
                      playSelectSound();
                      void resetWebsiteVideoCacheFolder();
                    }}
                  />
                  <EroScriptsCacheLocationCard
                    configuredPath={eroscriptsCacheRootPath}
                    isLoading={isInitialLoading}
                    isPending={isUpdatingEroScriptsCacheRootPath}
                    isOpening={openingPathTarget === "eroscripts-cache"}
                    onChooseFolder={() => {
                      playSelectSound();
                      void chooseEroScriptsCacheFolder();
                    }}
                    onOpenCurrentLocation={() => {
                      playSelectSound();
                      void openConfiguredPath("eroscripts-cache");
                    }}
                    onReset={() => {
                      playSelectSound();
                      void resetEroScriptsCacheFolder();
                    }}
                  />
                  <WebsiteVideoCacheScanCard />
                  <FpackExtractionLocationCard
                    configuredPath={fpackExtractionPath}
                    isLoading={isInitialLoading}
                    isPending={isUpdatingFpackExtractionPath}
                    isOpening={openingPathTarget === "fpack-extraction"}
                    onChooseFolder={() => {
                      playSelectSound();
                      void chooseFpackExtractionFolder();
                    }}
                    onOpenCurrentLocation={() => {
                      playSelectSound();
                      void openConfiguredPath("fpack-extraction");
                    }}
                    onReset={() => {
                      playSelectSound();
                      void resetFpackExtractionFolder();
                    }}
                  />
                  <AcquisitionDownloadLocationCard />
                  <PhashScanCard />
                  <MigrationCard />
                  <MigrateToPortableCard />
                  <DangerZoneCard
                    error={clearDataError}
                    isPending={isClearingData}
                    onOpenConfirm={() => {
                      playSelectSound();
                      setClearDataError(null);
                      setIsClearDataDialogOpen(true);
                    }}
                  />
                </>
              ) : activeSection && activeSection.id === "help" ? (
                <HelpShortcutsCard cheatModeEnabled={cheatModeEnabled} />
              ) : activeSection && activeSection.id === "changelog" ? (
                <ChangelogCard />
              ) : activeSection && activeSection.id === "hardware" ? (
                <HardwareSettingsCard
                  section={activeSection}
                  loading={isInitialLoading}
                  deviceAnimationTestEnabled={deviceAnimationTestEnabled}
                />
              ) : activeSection && activeSection.id === "advanced" ? (
                <>
                  <SettingsSectionCard section={activeSection} loading={isInitialLoading} />
                  <ProgramVersionsCard
                    diagnostics={binaryDiagnostics}
                    error={binaryDiagnosticsError}
                    isLoading={isLoadingBinaryDiagnostics}
                    isRefreshing={isRefreshingBinaryDiagnostics}
                    onRefresh={() => {
                      playSelectSound();
                      void refreshBinaryDiagnostics();
                    }}
                  />
                </>
              ) : activeSection && activeSection.id === "debug" ? (
                <DebugSettingsCard
                  section={activeSection}
                  loading={isInitialLoading || isLoadingDebug}
                  debugState={debugState}
                  diagnostics={debugDiagnostics}
                  allSettings={debugAllSettings}
                  message={debugMessage}
                  isRefreshing={isRefreshingDebug}
                  isCopying={isCopyingDebug}
                  isExporting={isExportingDebug}
                  isCreatingPlaintextSettings={isCreatingPlaintextSettings}
                  isClearing={isClearingLog}
                  onRefresh={() => {
                    playSelectSound();
                    void refreshDebugInfo();
                  }}
                  onCopy={() => {
                    playSelectSound();
                    void copyDebugInfo();
                  }}
                  onExport={() => {
                    playSelectSound();
                    void exportDebugFile();
                  }}
                  onCreatePlaintextSettings={() => {
                    playSelectSound();
                    void createPlaintextSettingsFile();
                  }}
                  onOpenLogFolder={() => {
                    playSelectSound();
                    void openDebugLogFolder();
                  }}
                  onClearLog={() => {
                    playSelectSound();
                    void clearDebugLog();
                  }}
                />
              ) : activeSection && activeSection.id === "credits" ? (
                <CreditsCard />
              ) : activeSection ? (
                <SettingsSectionCard section={activeSection} loading={isInitialLoading} />
              ) : null}
            </div>

            {/* Back button — visible only on small viewports */}
            <div className="mx-auto grid w-full max-w-md grid-cols-1 gap-2 pb-6 lg:hidden">
              <MenuButton
                label={t`Back to Main Menu`}
                onHover={playHoverSound}
                onClick={() => {
                  playSelectSound();
                  navigate({ to: "/" });
                }}
              />
            </div>
          </main>
        </div>
      </div>

      <ClearDataDialog
        isOpen={isClearDataDialogOpen}
        isPending={isClearingData}
        selections={clearSelections}
        onSelectionChange={(next) => setClearSelections(next)}
        onCancel={() => {
          if (isClearingData) return;
          playSelectSound();
          setIsClearDataDialogOpen(false);
        }}
        onConfirm={() => {
          playSelectSound();
          void clearData();
        }}
      />
      <ConfirmDialog
        isOpen={isDifficultyRecalculationDialogOpen}
        isPending={isRecalculatingDifficulties}
        variant="warning"
        title={t`Recalculate all round difficulties?`}
        message={t`This will replace the difficulty of every installed round that has a readable primary funscript. Rounds without a usable funscript will be left unchanged.`}
        confirmLabel={t`Recalculate All`}
        onCancel={() => {
          if (isRecalculatingDifficulties) return;
          playSelectSound();
          setIsDifficultyRecalculationDialogOpen(false);
        }}
        onConfirm={() => {
          if (isRecalculatingDifficulties) return;
          playSelectSound();
          setIsRecalculatingDifficulties(true);
          void db.round
            .recalculateInstalledDifficulties()
            .then((result) => {
              showToast(
                t`Updated ${result.updatedCount} rounds; skipped ${result.skippedCount}.`,
                "success"
              );
              setIsDifficultyRecalculationDialogOpen(false);
            })
            .catch((error) => {
              showToast(
                error instanceof Error
                  ? error.message
                  : t`Failed to recalculate round difficulties.`,
                "error"
              );
            })
            .finally(() => {
              setIsRecalculatingDifficulties(false);
            });
        }}
      />
      <CheatModeConfirmDialog
        isOpen={isCheatModeConfirmDialogOpen}
        onCancel={() => {
          playSelectSound();
          setIsCheatModeConfirmDialogOpen(false);
        }}
        onConfirm={async () => {
          playSelectSound();
          await progression.setCheatModeEnabled(true);
          setCheatModeEnabled(true);
          window.dispatchEvent(
            new CustomEvent<boolean>(CHEAT_MODE_ENABLED_EVENT, { detail: true })
          );
          setIsCheatModeConfirmDialogOpen(false);
        }}
      />
      <SkipRoundsCheckConfirmDialog
        isOpen={isSkipRoundsCheckDialogOpen}
        onCancel={() => {
          playSelectSound();
          setIsSkipRoundsCheckDialogOpen(false);
        }}
        onConfirm={async () => {
          playSelectSound();
          await trpc.store.set.mutate({ key: MULTIPLAYER_SKIP_ROUNDS_CHECK_KEY, value: true });
          setMultiplayerSkipRoundsCheck(true);
          window.dispatchEvent(
            new CustomEvent<boolean>(MULTIPLAYER_SKIP_ROUNDS_CHECK_EVENT, { detail: true })
          );
          setIsSkipRoundsCheckDialogOpen(false);
        }}
      />
    </div>
  );
}

function AcquisitionDownloadLocationCard() {
  const { t } = useLingui();
  const [settings, setSettings] = useState<AcquisitionSettings | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isPending, setIsPending] = useState(false);
  const [isOpening, setIsOpening] = useState(false);

  const reload = useCallback(async () => {
    try {
      setSettings(await acquisition.getSettings());
    } catch (error) {
      console.error("Failed to load acquisition download location", error);
      setSettings(null);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const chooseFolder = async () => {
    const selected = await window.electronAPI.dialog.selectAcquisitionDownloadDirectory?.();
    if (!selected) return;
    setIsPending(true);
    try {
      await acquisition.updateSettings({ downloadRootPath: selected.trim() });
      await reload();
    } finally {
      setIsPending(false);
    }
  };

  const resetFolder = async () => {
    setIsPending(true);
    try {
      await acquisition.updateSettings({ downloadRootPath: null });
      await reload();
    } finally {
      setIsPending(false);
    }
  };

  const openFolder = async () => {
    setIsOpening(true);
    try {
      await acquisition.openDownloadRoot();
    } finally {
      setIsOpening(false);
    }
  };

  return (
    <section className="animate-entrance rounded-3xl border border-cyan-400/25 bg-zinc-950/55 p-5 backdrop-blur-xl">
      <div className="mb-4">
        <h2 className="text-lg font-extrabold tracking-tight text-cyan-100">
          <Trans>Acquisition Download Location</Trans>
        </h2>
        <p className="mt-1 text-sm text-zinc-300">
          <Trans>Choose where torrent and MEGA downloads are stored.</Trans>
        </p>
      </div>
      <div className="rounded-2xl border border-cyan-300/25 bg-black/35 p-4">
        <div className="text-xs uppercase tracking-[0.18em] text-zinc-500">
          <Trans>Current Location</Trans>
        </div>
        <div className="mt-2 break-all font-[family-name:var(--font-jetbrains-mono)] text-sm text-zinc-100">
          {isLoading ? t`Loading...` : (settings?.resolvedDownloadRoot ?? t`Unavailable`)}
        </div>
        <p className="mt-2 text-xs text-zinc-500">
          <Trans>
            Changing this affects new downloads. Existing files are not moved automatically.
          </Trans>
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            disabled={!settings || isPending}
            onMouseEnter={playHoverSound}
            onClick={() => void chooseFolder()}
            className="rounded-xl border border-cyan-300/60 bg-cyan-500/25 px-4 py-2 text-sm font-semibold text-cyan-100 disabled:opacity-50"
          >
            {isPending ? t`Updating...` : t`Choose Folder`}
          </button>
          <button
            type="button"
            disabled={!settings || isPending || isOpening}
            onMouseEnter={playHoverSound}
            onClick={() => void openFolder()}
            className="rounded-xl border border-cyan-300/60 bg-cyan-500/20 px-4 py-2 text-sm font-semibold text-cyan-100 disabled:opacity-50"
          >
            {isOpening ? t`Opening...` : t`Open Current Folder`}
          </button>
          <button
            type="button"
            disabled={!settings?.downloadRootPath || isPending}
            onMouseEnter={playHoverSound}
            onClick={() => void resetFolder()}
            className="rounded-xl border border-zinc-500/60 bg-zinc-700/40 px-4 py-2 text-sm font-semibold text-zinc-100 disabled:opacity-50"
          >
            <Trans>Use Default</Trans>
          </button>
        </div>
      </div>
    </section>
  );
}

function WebsiteVideoCacheLocationCard({
  configuredPath,
  isLoading,
  isPending,
  isOpening,
  onChooseFolder,
  onOpenCurrentLocation,
  onReset,
}: {
  configuredPath: string | null;
  isLoading: boolean;
  isPending: boolean;
  isOpening: boolean;
  onChooseFolder: () => void;
  onOpenCurrentLocation: () => void;
  onReset: () => void;
}) {
  const { t } = useLingui();

  return (
    <section
      className="animate-entrance rounded-3xl border border-purple-400/25 bg-zinc-950/55 p-5 backdrop-blur-xl"
      style={{ animationDelay: "0.1s" }}
    >
      <div className="mb-4">
        <h2 className="text-lg font-extrabold tracking-tight text-violet-100">
          <Trans>Website Video Cache Location</Trans>
        </h2>
        <p className="mt-1 text-sm text-zinc-300">
          <Trans>
            Store downloaded website videos in a custom folder, or leave this unset to keep using
            the built-in default location.
          </Trans>
        </p>
      </div>

      <div className="rounded-2xl border border-violet-300/25 bg-black/35 p-4">
        <div className="text-xs uppercase tracking-[0.18em] text-zinc-500">
          <Trans>Current Location</Trans>
        </div>
        <div className="mt-2 break-all font-[family-name:var(--font-jetbrains-mono)] text-sm text-zinc-100">
          {isLoading
            ? t`Loading...`
            : formatStoragePathDisplay(
                configuredPath,
                t`Default app data folder (existing behavior)`
              )}
        </div>
        <p className="mt-2 text-xs text-zinc-500">
          <Trans>
            Changing this only affects the website video cache path. Existing cached files are not
            moved automatically.
          </Trans>
        </p>

        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            disabled={isLoading || isPending}
            onMouseEnter={playHoverSound}
            onClick={onChooseFolder}
            className="rounded-xl border border-violet-300/60 bg-violet-500/30 px-4 py-2 text-sm font-semibold text-violet-100 transition hover:border-violet-200/80 hover:bg-violet-500/45 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isPending ? t`Updating...` : t`Choose Folder`}
          </button>
          <button
            type="button"
            disabled={isLoading || isPending || isOpening}
            onMouseEnter={playHoverSound}
            onClick={onOpenCurrentLocation}
            className="rounded-xl border border-cyan-300/60 bg-cyan-500/20 px-4 py-2 text-sm font-semibold text-cyan-100 transition hover:border-cyan-200/80 hover:bg-cyan-500/35 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isOpening ? t`Opening...` : t`Open Current Folder`}
          </button>
          <button
            type="button"
            disabled={
              isLoading ||
              isPending ||
              !isStoragePathResettable(
                configuredPath,
                PORTABLE_DEFAULTS.get(WEBSITE_VIDEO_CACHE_ROOT_PATH_KEY) ?? null
              )
            }
            onMouseEnter={playHoverSound}
            onClick={onReset}
            className="rounded-xl border border-zinc-500/60 bg-zinc-700/40 px-4 py-2 text-sm font-semibold text-zinc-100 transition hover:border-zinc-300/70 hover:bg-zinc-700/60 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Trans>Use Default</Trans>
          </button>
        </div>
      </div>
    </section>
  );
}

function EroScriptsCacheLocationCard({
  configuredPath,
  isLoading,
  isPending,
  isOpening,
  onChooseFolder,
  onOpenCurrentLocation,
  onReset,
}: {
  configuredPath: string | null;
  isLoading: boolean;
  isPending: boolean;
  isOpening: boolean;
  onChooseFolder: () => void;
  onOpenCurrentLocation: () => void;
  onReset: () => void;
}) {
  const { t } = useLingui();

  return (
    <section
      className="animate-entrance rounded-3xl border border-purple-400/25 bg-zinc-950/55 p-5 backdrop-blur-xl"
      style={{ animationDelay: "0.1s" }}
    >
      <div className="mb-4">
        <h2 className="text-lg font-extrabold tracking-tight text-violet-100">
          <Trans>EroScripts Download Cache Location</Trans>
        </h2>
        <p className="mt-1 text-sm text-zinc-300">
          <Trans>
            Store downloaded EroScripts funscripts and optional video copies in a custom folder, or
            leave this unset to use the default app data location.
          </Trans>
        </p>
      </div>

      <div className="rounded-2xl border border-violet-300/25 bg-black/35 p-4">
        <div className="text-xs uppercase tracking-[0.18em] text-zinc-500">
          <Trans>Current Location</Trans>
        </div>
        <div className="mt-2 break-all font-[family-name:var(--font-jetbrains-mono)] text-sm text-zinc-100">
          {isLoading
            ? t`Loading...`
            : formatStoragePathDisplay(configuredPath, t`Default app data folder`)}
        </div>
        <p className="mt-2 text-xs text-zinc-500">
          <Trans>
            Changing this only affects future EroScripts downloads. Existing cached files are not
            moved automatically.
          </Trans>
        </p>

        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            disabled={isLoading || isPending}
            onMouseEnter={playHoverSound}
            onClick={onChooseFolder}
            className="rounded-xl border border-violet-300/60 bg-violet-500/30 px-4 py-2 text-sm font-semibold text-violet-100 transition hover:border-violet-200/80 hover:bg-violet-500/45 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isPending ? t`Updating...` : t`Choose Folder`}
          </button>
          <button
            type="button"
            disabled={isLoading || isPending || isOpening}
            onMouseEnter={playHoverSound}
            onClick={onOpenCurrentLocation}
            className="rounded-xl border border-cyan-300/60 bg-cyan-500/20 px-4 py-2 text-sm font-semibold text-cyan-100 transition hover:border-cyan-200/80 hover:bg-cyan-500/35 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isOpening ? t`Opening...` : t`Open Current Folder`}
          </button>
          <button
            type="button"
            disabled={
              isLoading ||
              isPending ||
              !isStoragePathResettable(
                configuredPath,
                PORTABLE_DEFAULTS.get(EROSCRIPTS_CACHE_ROOT_PATH_KEY) ?? null
              )
            }
            onMouseEnter={playHoverSound}
            onClick={onReset}
            className="rounded-xl border border-zinc-500/60 bg-zinc-700/40 px-4 py-2 text-sm font-semibold text-zinc-100 transition hover:border-zinc-300/70 hover:bg-zinc-700/60 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Trans>Use Default</Trans>
          </button>
        </div>
      </div>
    </section>
  );
}

function FpackExtractionLocationCard({
  configuredPath,
  isLoading,
  isPending,
  isOpening,
  onChooseFolder,
  onOpenCurrentLocation,
  onReset,
}: {
  configuredPath: string | null;
  isLoading: boolean;
  isPending: boolean;
  isOpening: boolean;
  onChooseFolder: () => void;
  onOpenCurrentLocation: () => void;
  onReset: () => void;
}) {
  const { t } = useLingui();

  return (
    <section
      className="animate-entrance rounded-3xl border border-purple-400/25 bg-zinc-950/55 p-5 backdrop-blur-xl"
      style={{ animationDelay: "0.1s" }}
    >
      <div className="mb-4">
        <h2 className="text-lg font-extrabold tracking-tight text-violet-100">
          <Trans>Fpack Extraction Location</Trans>
        </h2>
        <p className="mt-1 text-sm text-zinc-300">
          <Trans>
            Store extracted .fpack contents in a custom folder, or leave this unset to use the
            default app data location.
          </Trans>
        </p>
      </div>

      <div className="rounded-2xl border border-violet-300/25 bg-black/35 p-4">
        <div className="text-xs uppercase tracking-[0.18em] text-zinc-500">
          <Trans>Current Location</Trans>
        </div>
        <div className="mt-2 break-all font-[family-name:var(--font-jetbrains-mono)] text-sm text-zinc-100">
          {isLoading
            ? t`Loading...`
            : formatStoragePathDisplay(configuredPath, t`Default app data folder`)}
        </div>
        <p className="mt-2 text-xs text-zinc-500">
          <Trans>
            Changing this only affects future .fpack extractions. Existing extracted files are not
            moved automatically.
          </Trans>
        </p>

        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            disabled={isLoading || isPending}
            onMouseEnter={playHoverSound}
            onClick={onChooseFolder}
            className="rounded-xl border border-violet-300/60 bg-violet-500/30 px-4 py-2 text-sm font-semibold text-violet-100 transition hover:border-violet-200/80 hover:bg-violet-500/45 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isPending ? t`Updating...` : t`Choose Folder`}
          </button>
          <button
            type="button"
            disabled={isLoading || isPending || isOpening}
            onMouseEnter={playHoverSound}
            onClick={onOpenCurrentLocation}
            className="rounded-xl border border-cyan-300/60 bg-cyan-500/20 px-4 py-2 text-sm font-semibold text-cyan-100 transition hover:border-cyan-200/80 hover:bg-cyan-500/35 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isOpening ? t`Opening...` : t`Open Current Folder`}
          </button>
          <button
            type="button"
            disabled={
              isLoading ||
              isPending ||
              !isStoragePathResettable(
                configuredPath,
                PORTABLE_DEFAULTS.get(FPACK_EXTRACTION_PATH_KEY) ?? null
              )
            }
            onMouseEnter={playHoverSound}
            onClick={onReset}
            className="rounded-xl border border-zinc-500/60 bg-zinc-700/40 px-4 py-2 text-sm font-semibold text-zinc-100 transition hover:border-zinc-300/70 hover:bg-zinc-700/60 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Trans>Use Default</Trans>
          </button>
        </div>
      </div>
    </section>
  );
}

function EroScriptsSettingsCard({
  status,
  message,
  isLoading,
  isPending,
  onLogin,
  onRefresh,
  onClear,
}: {
  status: EroScriptsLoginStatus | null;
  message: string | null;
  isLoading: boolean;
  isPending: boolean;
  onLogin: () => void;
  onRefresh: () => void;
  onClear: () => void;
}) {
  const { t } = useLingui();
  const statusLabel = isLoading
    ? t`Checking login...`
    : status?.loggedIn
      ? status.username
        ? t`Logged in as ${status.username}`
        : t`Logged in`
      : t`Not logged in`;
  const cookieCount = status?.cookieCount ?? 0;

  return (
    <section className="animate-entrance rounded-3xl border border-cyan-400/25 bg-zinc-950/55 p-5 backdrop-blur-xl">
      <div className="mb-4">
        <h2 className="text-lg font-extrabold tracking-tight text-cyan-100">
          <Trans>EroScripts</Trans>
        </h2>
        <p className="mt-1 text-sm text-zinc-300">
          <Trans>
            Log in on the EroScripts website to make the search popup and downloads use your account
            cookies, including two-factor authentication.
          </Trans>
        </p>
      </div>

      <div className="rounded-2xl border border-cyan-300/20 bg-black/35 px-4 py-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <div className="text-xs font-semibold uppercase tracking-[0.18em] text-zinc-500">
              <Trans>Login Status</Trans>
            </div>
            <div className="mt-1 text-sm font-semibold text-zinc-100">{statusLabel}</div>
          </div>
          <div className="rounded-full border border-zinc-600/70 px-3 py-1 text-xs font-semibold text-zinc-300">
            <Trans>Cookies stored: {cookieCount}</Trans>
          </div>
        </div>
        {status?.error ? <p className="mt-2 text-sm text-amber-200">{status.error}</p> : null}
      </div>

      {message ? (
        <div className="mt-3 rounded-xl border border-cyan-300/25 bg-cyan-500/10 px-4 py-3 text-sm text-cyan-100">
          {message}
        </div>
      ) : null}

      <div className="mt-4 flex flex-wrap gap-2">
        <button
          type="button"
          disabled={isLoading || isPending}
          onMouseEnter={playHoverSound}
          onClick={onLogin}
          className="rounded-xl border border-cyan-300/60 bg-cyan-500/25 px-4 py-2 text-sm font-semibold text-cyan-100 transition hover:border-cyan-200/80 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isPending ? t`Opening...` : t`Login`}
        </button>
        <button
          type="button"
          disabled={isLoading || isPending}
          onMouseEnter={playHoverSound}
          onClick={onRefresh}
          className="rounded-xl border border-emerald-300/60 bg-emerald-500/20 px-4 py-2 text-sm font-semibold text-emerald-100 transition hover:border-emerald-200/80 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Trans>Check Login</Trans>
        </button>
        <button
          type="button"
          disabled={isLoading || isPending || cookieCount === 0}
          onMouseEnter={playHoverSound}
          onClick={onClear}
          className="rounded-xl border border-zinc-500/60 bg-zinc-700/40 px-4 py-2 text-sm font-semibold text-zinc-100 transition hover:border-zinc-300/70 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Trans>Clear Login Cookies</Trans>
        </button>
      </div>
    </section>
  );
}

function MusicCacheLocationCard({
  configuredPath,
  isLoading,
  isPending,
  isOpening,
  onChooseFolder,
  onOpenCurrentLocation,
  onReset,
}: {
  configuredPath: string | null;
  isLoading: boolean;
  isPending: boolean;
  isOpening: boolean;
  onChooseFolder: () => void;
  onOpenCurrentLocation: () => void;
  onReset: () => void;
}) {
  const { t } = useLingui();

  return (
    <section
      className="animate-entrance rounded-3xl border border-purple-400/25 bg-zinc-950/55 p-5 backdrop-blur-xl"
      style={{ animationDelay: "0.1s" }}
    >
      <div className="mb-4">
        <h2 className="text-lg font-extrabold tracking-tight text-violet-100">
          <Trans>Music Cache Location</Trans>
        </h2>
        <p className="mt-1 text-sm text-zinc-300">
          <Trans>
            Store downloaded music files in a custom folder, or leave this unset to keep using the
            built-in default location.
          </Trans>
        </p>
      </div>

      <div className="rounded-2xl border border-violet-300/25 bg-black/35 p-4">
        <div className="text-xs uppercase tracking-[0.18em] text-zinc-500">
          <Trans>Current Location</Trans>
        </div>
        <div className="mt-2 break-all font-[family-name:var(--font-jetbrains-mono)] text-sm text-zinc-100">
          {isLoading
            ? t`Loading...`
            : formatStoragePathDisplay(
                configuredPath,
                t`Default app data folder (existing behavior)`
              )}
        </div>
        <p className="mt-2 text-xs text-zinc-500">
          <Trans>
            Changing this only affects the music cache path. Existing downloaded files are not moved
            automatically.
          </Trans>
        </p>

        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            disabled={isLoading || isPending}
            onMouseEnter={playHoverSound}
            onClick={onChooseFolder}
            className="rounded-xl border border-violet-300/60 bg-violet-500/30 px-4 py-2 text-sm font-semibold text-violet-100 transition hover:border-violet-200/80 hover:bg-violet-500/45 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isPending ? t`Updating...` : t`Choose Folder`}
          </button>
          <button
            type="button"
            disabled={isLoading || isPending || isOpening}
            onMouseEnter={playHoverSound}
            onClick={onOpenCurrentLocation}
            className="rounded-xl border border-cyan-300/60 bg-cyan-500/20 px-4 py-2 text-sm font-semibold text-cyan-100 transition hover:border-cyan-200/80 hover:bg-cyan-500/35 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isOpening ? t`Opening...` : t`Open Current Folder`}
          </button>
          <button
            type="button"
            disabled={
              isLoading ||
              isPending ||
              !isStoragePathResettable(
                configuredPath,
                PORTABLE_DEFAULTS.get(MUSIC_CACHE_ROOT_PATH_KEY) ?? null
              )
            }
            onMouseEnter={playHoverSound}
            onClick={onReset}
            className="rounded-xl border border-zinc-500/60 bg-zinc-700/40 px-4 py-2 text-sm font-semibold text-zinc-100 transition hover:border-zinc-300/70 hover:bg-zinc-700/60 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Trans>Use Default</Trans>
          </button>
        </div>
      </div>
    </section>
  );
}

function PhashScanCard() {
  const { t } = useLingui();
  const [scanStatus, setScanStatus] = useState<PhashScanStatus | null>(null);
  const [isStarting, setIsStarting] = useState(false);

  useEffect(() => {
    let mounted = true;
    let timeout: number | null = null;

    const scheduleNext = (delayMs: number) => {
      if (!mounted) return;
      timeout = window.setTimeout(() => {
        void pollStatus();
      }, delayMs);
    };

    const pollStatus = async () => {
      if (document.hidden) {
        scheduleNext(10_000);
        return;
      }
      try {
        const status = await db.phash.getScanStatus();
        if (mounted) {
          setScanStatus(status);
        }
      } catch (error) {
        console.error("Failed to poll phash scan status", error);
      } finally {
        scheduleNext(scanStatus?.state === "running" ? 2_000 : 10_000);
      }
    };

    void pollStatus();

    return () => {
      mounted = false;
      if (timeout) {
        window.clearTimeout(timeout);
      }
    };
  }, [scanStatus?.state]);

  const handleStartScan = async () => {
    if (isStarting) return;
    setIsStarting(true);
    playSelectSound();
    try {
      await db.phash.startScanManual();
    } catch (error) {
      console.error("Failed to start phash scan", error);
    } finally {
      setIsStarting(false);
    }
  };

  const handleAbortScan = async () => {
    playSelectSound();
    try {
      await db.phash.abortScan();
    } catch (error) {
      console.error("Failed to abort phash scan", error);
    }
  };

  const isRunning = scanStatus?.state === "running";
  const progress =
    scanStatus && scanStatus.totalCount > 0
      ? (scanStatus.completedCount / scanStatus.totalCount) * 100
      : 0;

  return (
    <section
      className="animate-entrance rounded-3xl border border-purple-400/25 bg-zinc-950/55 p-5 backdrop-blur-xl"
      style={{ animationDelay: "0.09s" }}
    >
      <div className="mb-4">
        <h2 className="text-lg font-extrabold tracking-tight text-violet-100">
          <Trans>Video Fingerprint Scanner</Trans>
        </h2>
        <p className="mt-1 text-sm text-zinc-300">
          <Trans>
            Manually trigger a scan to compute perceptual hashes for rounds that do not have them
            yet.
          </Trans>
        </p>
      </div>

      <div
        className="rounded-2xl border border-violet-300/25 bg-black/35 p-4"
        onMouseEnter={playHoverSound}
      >
        {isRunning && scanStatus && (
          <>
            <div className="mb-3 flex items-center gap-2">
              <span className="rounded-full border border-cyan-300/40 bg-cyan-500/15 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-cyan-100">
                <Trans>Scanning</Trans>
              </span>
            </div>

            <div className="mb-2 h-1.5 overflow-hidden rounded-full bg-cyan-950/60">
              <div
                className="h-full rounded-full bg-gradient-to-r from-cyan-500 via-cyan-400 to-teal-400"
                style={{ width: `${progress}%` }}
              />
            </div>

            {scanStatus.currentRoundName && (
              <div className="mb-2 truncate font-[family-name:var(--font-jetbrains-mono)] text-xs text-cyan-100/90">
                {t`Processing:`} {scanStatus.currentRoundName}
              </div>
            )}

            <div className="mb-3 flex items-center justify-between font-[family-name:var(--font-jetbrains-mono)] text-xs">
              <span className="text-cyan-400/60">
                <Trans>
                  {scanStatus.completedCount} / {scanStatus.totalCount} videos
                </Trans>
              </span>
              <span className="text-cyan-300/80">{Math.round(progress)}%</span>
            </div>
          </>
        )}

        {!isRunning &&
          scanStatus &&
          (scanStatus.state === "done" ||
            scanStatus.state === "aborted" ||
            scanStatus.state === "error") && (
            <div className="mb-3 flex items-center gap-2">
              <span
                className={`rounded-full border px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] ${
                  scanStatus.state === "done"
                    ? "border-emerald-300/40 bg-emerald-500/15 text-emerald-100"
                    : scanStatus.state === "aborted"
                      ? "border-amber-300/40 bg-amber-500/15 text-amber-100"
                      : "border-rose-300/40 bg-rose-500/15 text-rose-100"
                }`}
              >
                {scanStatus.state === "done"
                  ? t`Complete`
                  : scanStatus.state === "aborted"
                    ? t`Aborted`
                    : t`Error`}
              </span>
              <span className="font-[family-name:var(--font-jetbrains-mono)] text-xs text-zinc-400">
                <Trans>{scanStatus.completedCount} hashed</Trans>
                {scanStatus.skippedCount > 0 && <span>, {scanStatus.skippedCount} skipped</span>}
              </span>
            </div>
          )}

        {!isRunning && scanStatus?.state === "idle" && (
          <div className="mb-3 flex items-center gap-2">
            <span className="rounded-full border border-zinc-500/40 bg-zinc-800/70 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-zinc-300">
              <Trans>Idle</Trans>
            </span>
            <span className="font-[family-name:var(--font-jetbrains-mono)] text-xs text-zinc-400">
              <Trans>Ready to scan</Trans>
            </span>
          </div>
        )}

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={isRunning || isStarting}
            onClick={handleStartScan}
            className={`rounded-xl border px-4 py-2 text-sm font-semibold transition-all duration-200 ${
              isRunning || isStarting
                ? "cursor-not-allowed border-zinc-600 bg-zinc-800 text-zinc-500"
                : "border-violet-300/60 bg-violet-500/30 text-violet-100 hover:border-violet-200/80 hover:bg-violet-500/45"
            }`}
          >
            {isStarting ? t`Starting...` : isRunning ? t`Scanning...` : t`Scan Now`}
          </button>

          {isRunning && (
            <button
              type="button"
              onClick={handleAbortScan}
              className="rounded-xl border border-rose-300/60 bg-rose-500/30 px-4 py-2 text-sm font-semibold text-rose-100 transition-all duration-200 hover:border-rose-200/80 hover:bg-rose-500/45"
            >
              <Trans>Abort</Trans>
            </button>
          )}
        </div>
      </div>
    </section>
  );
}

function WebsiteVideoCacheScanCard() {
  const { t } = useLingui();
  const [scanStatus, setScanStatus] = useState<WebsiteVideoScanStatus | null>(null);
  const [isStarting, setIsStarting] = useState(false);

  useEffect(() => {
    let mounted = true;
    let timeout: number | null = null;

    const scheduleNext = (delayMs: number) => {
      if (!mounted) return;
      timeout = window.setTimeout(() => {
        void pollStatus();
      }, delayMs);
    };

    const pollStatus = async () => {
      if (document.hidden) {
        scheduleNext(10_000);
        return;
      }
      try {
        const status = await db.webVideoCache.getScanStatus();
        if (mounted) {
          setScanStatus(status);
        }
      } catch (error) {
        console.error("Failed to poll website video cache scan status", error);
      } finally {
        scheduleNext(scanStatus?.state === "running" ? 2_000 : 10_000);
      }
    };

    void pollStatus();

    return () => {
      mounted = false;
      if (timeout) {
        window.clearTimeout(timeout);
      }
    };
  }, [scanStatus?.state]);

  const handleStartScan = async () => {
    if (isStarting) return;
    setIsStarting(true);
    playSelectSound();
    try {
      await db.webVideoCache.startScanManual();
    } catch (error) {
      console.error("Failed to start website video cache scan", error);
    } finally {
      setIsStarting(false);
    }
  };

  const handleAbortScan = async () => {
    playSelectSound();
    try {
      await db.webVideoCache.abortScan();
    } catch (error) {
      console.error("Failed to abort website video cache scan", error);
    }
  };

  const isRunning = scanStatus?.state === "running";
  const progress =
    scanStatus && scanStatus.totalCount > 0
      ? (scanStatus.completedCount / scanStatus.totalCount) * 100
      : 0;

  return (
    <section
      className="animate-entrance rounded-3xl border border-purple-400/25 bg-zinc-950/55 p-5 backdrop-blur-xl"
      style={{ animationDelay: "0.11s" }}
    >
      <div className="mb-4">
        <h2 className="text-lg font-extrabold tracking-tight text-violet-100">
          <Trans>Website Video Cache</Trans>
        </h2>
        <p className="mt-1 text-sm text-zinc-300">
          <Trans>
            Download and cache videos from website rounds for offline playback. A background scan
            runs automatically every 5 minutes.
          </Trans>
        </p>
      </div>

      <div
        className="rounded-2xl border border-violet-300/25 bg-black/35 p-4"
        onMouseEnter={playHoverSound}
      >
        {isRunning && scanStatus && (
          <>
            <div className="mb-3 flex items-center gap-2">
              <span className="rounded-full border border-amber-300/40 bg-amber-500/15 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-amber-100">
                <Trans>Caching</Trans>
              </span>
            </div>

            <div className="mb-2 h-1.5 overflow-hidden rounded-full bg-amber-950/60">
              <div
                className="h-full rounded-full bg-gradient-to-r from-amber-500 via-amber-400 to-yellow-400"
                style={{ width: `${progress}%` }}
              />
            </div>

            {scanStatus.currentRoundName && (
              <div className="mb-2 truncate font-[family-name:var(--font-jetbrains-mono)] text-xs text-amber-100/90">
                {t`Downloading:`} {scanStatus.currentRoundName}
              </div>
            )}

            <div className="mb-3 flex items-center justify-between font-[family-name:var(--font-jetbrains-mono)] text-xs">
              <span className="text-amber-400/60">
                <Trans>
                  {scanStatus.completedCount} / {scanStatus.totalCount} videos
                </Trans>
              </span>
              <span className="text-amber-300/80">{Math.round(progress)}%</span>
            </div>
          </>
        )}

        {!isRunning &&
          scanStatus &&
          (scanStatus.state === "done" ||
            scanStatus.state === "aborted" ||
            scanStatus.state === "error") && (
            <div className="mb-3 flex items-center gap-2">
              <span
                className={`rounded-full border px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] ${
                  scanStatus.state === "done"
                    ? "border-emerald-300/40 bg-emerald-500/15 text-emerald-100"
                    : scanStatus.state === "aborted"
                      ? "border-amber-300/40 bg-amber-500/15 text-amber-100"
                      : "border-rose-300/40 bg-rose-500/15 text-rose-100"
                }`}
              >
                {scanStatus.state === "done"
                  ? t`Complete`
                  : scanStatus.state === "aborted"
                    ? t`Aborted`
                    : t`Error`}
              </span>
              <span className="font-[family-name:var(--font-jetbrains-mono)] text-xs text-zinc-400">
                <Trans>{scanStatus.completedCount} cached</Trans>
                {scanStatus.skippedCount > 0 && <span>, {scanStatus.skippedCount} failed</span>}
              </span>
            </div>
          )}

        {!isRunning && scanStatus?.state === "idle" && (
          <div className="mb-3 flex items-center gap-2">
            <span className="rounded-full border border-zinc-500/40 bg-zinc-800/70 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-zinc-300">
              <Trans>Idle</Trans>
            </span>
            <span className="font-[family-name:var(--font-jetbrains-mono)] text-xs text-zinc-400">
              <Trans>All website videos cached</Trans>
            </span>
          </div>
        )}

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={isRunning || isStarting}
            onClick={handleStartScan}
            className={`rounded-xl border px-4 py-2 text-sm font-semibold transition-all duration-200 ${
              isRunning || isStarting
                ? "cursor-not-allowed border-zinc-600 bg-zinc-800 text-zinc-500"
                : "border-violet-300/60 bg-violet-500/30 text-violet-100 hover:border-violet-200/80 hover:bg-violet-500/45"
            }`}
          >
            {isStarting ? t`Starting...` : isRunning ? t`Caching...` : t`Cache Now`}
          </button>

          {isRunning && (
            <button
              type="button"
              onClick={handleAbortScan}
              className="rounded-xl border border-rose-300/60 bg-rose-500/30 px-4 py-2 text-sm font-semibold text-rose-100 transition-all duration-200 hover:border-rose-200/80 hover:bg-rose-500/45"
            >
              <Trans>Abort</Trans>
            </button>
          )}
        </div>
      </div>
    </section>
  );
}

function AppUpdateCard({ appUpdate }: { appUpdate: ReturnType<typeof useAppUpdate> }) {
  const { t } = useLingui();
  const [updateChannel, setUpdateChannel] = useState<UpdateChannel>(DEFAULT_UPDATE_CHANNEL);
  const [isLoadingChannel, setIsLoadingChannel] = useState(true);
  const [isSavingChannel, setIsSavingChannel] = useState(false);
  const [channelError, setChannelError] = useState<string | null>(null);
  const statusTone =
    appUpdate.state.status === "update_available"
      ? "border-amber-300/30 bg-amber-500/10 text-amber-100"
      : appUpdate.state.status === "up_to_date"
        ? "border-emerald-300/30 bg-emerald-500/10 text-emerald-100"
        : appUpdate.state.status === "error"
          ? "border-rose-300/30 bg-rose-500/10 text-rose-100"
          : "border-zinc-600/40 bg-black/35 text-zinc-200";
  const statusLabel =
    appUpdate.state.status === "checking"
      ? t`Checking`
      : appUpdate.state.status === "update_available"
        ? t`Update Available`
        : appUpdate.state.status === "up_to_date"
          ? t`Up to Date`
          : appUpdate.state.status === "error"
            ? t`Check Failed`
            : t`Not Checked Yet`;

  useEffect(() => {
    let mounted = true;
    trpc.store.get
      .query({ key: UPDATE_CHANNEL_KEY })
      .then((value) => {
        if (mounted) {
          setUpdateChannel(normalizeUpdateChannel(value));
        }
      })
      .catch((error) => {
        console.error("Failed to load update channel", error);
        if (mounted) {
          setUpdateChannel(DEFAULT_UPDATE_CHANNEL);
        }
      })
      .finally(() => {
        if (mounted) {
          setIsLoadingChannel(false);
        }
      });

    return () => {
      mounted = false;
    };
  }, []);

  const changeUpdateChannel = async (next: UpdateChannel) => {
    if (isSavingChannel || next === updateChannel) return;
    playSelectSound();
    setIsSavingChannel(true);
    setChannelError(null);
    try {
      await trpc.store.set.mutate({ key: UPDATE_CHANNEL_KEY, value: next });
      setUpdateChannel(next);
      window.dispatchEvent(new CustomEvent(UPDATE_CHANNEL_CHANGED_EVENT, { detail: next }));
      await trpc.updater.check.mutate({ force: true });
    } catch (error) {
      setChannelError(error instanceof Error ? error.message : t`Failed to update channel.`);
    } finally {
      setIsSavingChannel(false);
    }
  };

  return (
    <section
      className="animate-entrance rounded-3xl border border-purple-400/25 bg-zinc-950/55 p-5 backdrop-blur-xl"
      style={{ animationDelay: "0.08s" }}
    >
      <div className="mb-4">
        <h2 className="text-lg font-extrabold tracking-tight text-violet-100">
          <Trans>Updates</Trans>
        </h2>
        <p className="mt-1 text-sm text-zinc-300">
          <Trans>
            Check for new releases or open the latest available download for this build.
          </Trans>
        </p>
      </div>

      <div className={`rounded-2xl border p-4 ${statusTone}`} onMouseEnter={playHoverSound}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="font-semibold text-current">{statusLabel}</p>
            <p className="mt-1 text-sm text-current/80">{appUpdate.systemMessage}</p>
            <div className="mt-3 space-y-1 text-xs font-[family-name:var(--font-jetbrains-mono)] uppercase tracking-[0.16em] text-current/80">
              <div>
                <Trans>Installed</Trans> v{appUpdate.state.currentVersion}
              </div>
              {appUpdate.state.latestVersion ? (
                <div>
                  <Trans>Latest</Trans> v{appUpdate.state.latestVersion}
                </div>
              ) : null}
            </div>
          </div>

          <div className="flex w-full flex-col gap-2 sm:w-56">
            <GameDropdown
              label={t`Channel`}
              value={updateChannel}
              options={[
                { value: "none", label: t`None (updates disabled)` },
                { value: "release", label: t`Release` },
                { value: "prerelease", label: t`Prerelease` },
              ]}
              disabled={isLoadingChannel || isSavingChannel || appUpdate.isBusy}
              onHoverSfx={playHoverSound}
              onSelectSfx={playSelectSound}
              onChange={(value) => void changeUpdateChannel(normalizeUpdateChannel(value))}
            />
            <button
              type="button"
              disabled={updateChannel === "none" || appUpdate.isBusy || isSavingChannel}
              onClick={() => {
                playSelectSound();
                void appUpdate.triggerPrimaryAction();
              }}
              className={`rounded-xl border px-4 py-2 text-sm font-semibold transition-all duration-200 ${
                updateChannel === "none" || appUpdate.isBusy || isSavingChannel
                  ? "cursor-not-allowed border-zinc-600 bg-zinc-800 text-zinc-500"
                  : "border-violet-300/60 bg-violet-500/30 text-violet-100 hover:border-violet-200/80 hover:bg-violet-500/45"
              }`}
            >
              {isSavingChannel
                ? t`Saving...`
                : updateChannel === "none"
                  ? t`Updates Disabled`
                  : appUpdate.actionLabel}
            </button>
          </div>
        </div>
        {updateChannel === "prerelease" ? (
          <div
            role="alert"
            className="mt-3 rounded-xl border border-amber-400/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-100 animate-entrance"
          >
            <Trans>
              Prerelease updates are unstable and may break features. In rare cases, you may lose
              data. Back up important data before continuing.
            </Trans>
          </div>
        ) : null}
        {updateChannel === "none" ? (
          <div
            role="alert"
            className="mt-3 rounded-xl border border-amber-400/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-100 animate-entrance"
          >
            <Trans>
              Updates are disabled. You will not stay up to date, and multiplayer is unavailable
              until you select a release channel.
            </Trans>
          </div>
        ) : null}
        {channelError ? (
          <p className="mt-3 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-1.5 font-mono text-xs text-rose-200 animate-entrance">
            {channelError}
          </p>
        ) : null}
      </div>
    </section>
  );
}

function OnboardingCard() {
  const { t } = useLingui();
  const navigate = useNavigate();

  return (
    <section
      className="animate-entrance rounded-3xl border border-purple-400/25 bg-zinc-950/55 p-5 backdrop-blur-xl"
      style={{ animationDelay: "0.1s" }}
    >
      <div className="mb-4">
        <h2 className="text-lg font-extrabold tracking-tight text-violet-100">
          <Trans>First Start Workflow</Trans>
        </h2>
        <p className="mt-1 text-sm text-zinc-300">
          <Trans>
            Run the guided introduction again if you want a refresher on play modes, content
            installs, editors, Handy setup, music, and booru search.
          </Trans>
        </p>
      </div>

      <button
        type="button"
        onMouseEnter={playHoverSound}
        onClick={() => {
          playSelectSound();
          void navigate({ to: "/first-start", search: { returnTo: "settings" } });
        }}
        className="rounded-xl border border-violet-300/60 bg-violet-500/30 px-4 py-2 text-sm font-semibold text-violet-100 transition-all duration-200 hover:border-violet-200/80 hover:bg-violet-500/45"
      >
        {t`Open First Start Workflow`}
      </button>
    </section>
  );
}

function HardwareSettingsCard({
  section,
  loading,
  deviceAnimationTestEnabled,
}: {
  section: SettingsSection;
  loading: boolean;
  deviceAnimationTestEnabled: boolean;
}) {
  const { t } = useLingui();
  const { showToast } = useToast();
  const {
    deviceSlots = [],
    selectedDeviceId,
    selectDevice,
    removeDevice,
    provider,
    setProvider,
    connectionKey,
    appApiKeyOverride,
    isUsingDefaultAppApiKey,
    intifaceWebsocketUrl,
    intifaceDeviceName,
    intifaceDeviceIndex,
    intifaceVibrationSensitivity,
    setIntifaceVibrationSensitivity,
    funscriptRateLimitEnabled,
    setFunscriptRateLimitEnabled,
    funscriptMaxRate,
    funscriptRdpEpsilon,
    setFunscriptRateLimitSettings,
    tcodeTransport,
    tcodeSerialPath,
    tcodeBaudRate,
    tcodeWebsocketHost,
    tcodeWebsocketUrl,
    tcodePrecision,
    tcodeSerialPorts,
    tcodeSerialPortsLoading,
    offsetMs,
    strokeMin,
    strokeMax,
    strokePercent,
    strokeLoading,
    strokeError,
    connected,
    synced,
    syncError,
    testDeviceStarting,
    testDeviceRunning,
    testDeviceStartedAtMs,
    testDeviceError,
    isConnecting,
    error,
    connect,
    connectIntiface,
    connectTCode,
    refreshTCodeSerialPorts,
    autoDetectTCodeSerialPort,
    disconnect,
    forceStop,
    startTestDevice,
    stopTestDevice,
    adjustOffset,
    resetOffset,
    setStrokeBounds,
    resetStroke,
  } = useHandy();
  const [inputKey, setInputKey] = useState(connectionKey);
  const [inputApiKeyOverride, setInputApiKeyOverride] = useState(appApiKeyOverride);
  const [inputIntifaceUrl, setInputIntifaceUrl] = useState(intifaceWebsocketUrl);
  const [inputIntifaceDeviceIndex, setInputIntifaceDeviceIndex] = useState(
    intifaceDeviceIndex === null ? "" : String(intifaceDeviceIndex)
  );
  const [inputTCodeTransport, setInputTCodeTransport] = useState(tcodeTransport);
  const [inputTCodeSerialPath, setInputTCodeSerialPath] = useState(tcodeSerialPath);
  const [inputTCodeBaudRate, setInputTCodeBaudRate] = useState(String(tcodeBaudRate));
  const [inputTCodeHost, setInputTCodeHost] = useState(tcodeWebsocketHost);
  const [inputTCodePrecision, setInputTCodePrecision] = useState<3 | 4>(tcodePrecision);
  const [inputFunscriptMaxRate, setInputFunscriptMaxRate] = useState(String(funscriptMaxRate));
  const [inputFunscriptRdpEpsilon, setInputFunscriptRdpEpsilon] = useState(
    String(funscriptRdpEpsilon)
  );
  const [tcodeAutoDetecting, setTCodeAutoDetecting] = useState(false);
  const [useCustomApiKey, setUseCustomApiKey] = useState(!isUsingDefaultAppApiKey);
  const [strokeMinSliderValue, setStrokeMinSliderValue] = useState(
    formatHandyStrokeBoundPercent(strokeMin)
  );
  const [strokeMaxSliderValue, setStrokeMaxSliderValue] = useState(
    formatHandyStrokeBoundPercent(strokeMax)
  );
  const [testAnimationNowMs, setTestAnimationNowMs] = useState(() => performance.now());

  useEffect(() => {
    queueMicrotask(() => {
      setStrokeMinSliderValue(formatHandyStrokeBoundPercent(strokeMin));
      setStrokeMaxSliderValue(formatHandyStrokeBoundPercent(strokeMax));
    });
  }, [strokeMin, strokeMax]);

  useEffect(() => {
    queueMicrotask(() => {
      setInputFunscriptMaxRate(String(funscriptMaxRate));
      setInputFunscriptRdpEpsilon(String(funscriptRdpEpsilon));
    });
  }, [funscriptMaxRate, funscriptRdpEpsilon]);

  useEffect(() => {
    queueMicrotask(() => {
      setInputKey(connectionKey);
      setInputApiKeyOverride(appApiKeyOverride);
      setInputIntifaceUrl(intifaceWebsocketUrl);
      setInputIntifaceDeviceIndex(intifaceDeviceIndex === null ? "" : String(intifaceDeviceIndex));
      setInputTCodeTransport(tcodeTransport);
      setInputTCodeSerialPath(tcodeSerialPath);
      setInputTCodeBaudRate(String(tcodeBaudRate));
      setInputTCodeHost(tcodeWebsocketHost);
      setInputTCodePrecision(tcodePrecision);
      setUseCustomApiKey(!isUsingDefaultAppApiKey);
    });
  }, [
    appApiKeyOverride,
    connectionKey,
    intifaceWebsocketUrl,
    intifaceDeviceIndex,
    isUsingDefaultAppApiKey,
    tcodeBaudRate,
    tcodePrecision,
    tcodeSerialPath,
    tcodeTransport,
    tcodeWebsocketHost,
  ]);

  useEffect(() => {
    if (!testDeviceRunning) return;
    let animationFrame = 0;
    const tick = () => {
      setTestAnimationNowMs(performance.now());
      animationFrame = window.requestAnimationFrame(tick);
    };
    animationFrame = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(animationFrame);
  }, [testDeviceRunning]);

  const handleConnect = async () => {
    if (provider === "intiface") {
      const parsedIndex =
        inputIntifaceDeviceIndex.trim() === "" ? null : Number(inputIntifaceDeviceIndex);
      if (parsedIndex === null) {
        await connectIntiface(inputIntifaceUrl);
      } else {
        await connectIntiface(
          inputIntifaceUrl,
          Number.isFinite(parsedIndex) ? Math.floor(parsedIndex) : null
        );
      }
      return;
    }
    if (provider === "tcode") {
      await connectTCode({
        transport: inputTCodeTransport,
        serialPath: inputTCodeSerialPath,
        baudRate: normalizeTCodeBaudRate(inputTCodeBaudRate),
        websocketInput: inputTCodeHost,
        precision: inputTCodePrecision,
      });
      return;
    }

    await connect(inputKey, "", useCustomApiKey ? inputApiKeyOverride : "");
  };

  const handleAutoDetectTCodeSerialPort = async () => {
    playSelectSound();
    setInputTCodeTransport("serial");
    setTCodeAutoDetecting(true);
    try {
      const portPath = await autoDetectTCodeSerialPort(normalizeTCodeBaudRate(inputTCodeBaudRate));
      if (!portPath) {
        showToast(t`No toy seems connected.`, "error");
        return;
      }
      setInputTCodeSerialPath(portPath);
      showToast(t`TCode serial port detected: ${portPath}`, "success");
    } finally {
      setTCodeAutoDetecting(false);
    }
  };

  const tcodeDerivedUrl = (() => {
    try {
      return normalizeTCodeWebSocketInput(inputTCodeHost).url;
    } catch {
      return DEFAULT_TCODE_WEBSOCKET_URL;
    }
  })();

  const testElapsedMs =
    testDeviceRunning && testDeviceStartedAtMs !== null
      ? testAnimationNowMs - testDeviceStartedAtMs + offsetMs
      : 0;
  const normalizedTestElapsedMs =
    ((testElapsedMs % HAPTICS_TEST_PERIOD_MS) + HAPTICS_TEST_PERIOD_MS) % HAPTICS_TEST_PERIOD_MS;

  return (
    <section
      className="animate-entrance rounded-3xl border border-purple-400/25 bg-zinc-950/55 p-5 backdrop-blur-xl"
      style={{ animationDelay: "0.08s" }}
    >
      <div className="mb-4">
        <h2 className="text-lg font-extrabold tracking-tight text-violet-100">{section.title}</h2>
        <p className="mt-1 text-sm text-zinc-300">{section.description}</p>
      </div>

      <div className="space-y-3">
        {section.settings.map((setting) => (
          <SettingRow key={setting.id} setting={setting} disabled={loading} />
        ))}

        <div
          className="rounded-2xl border border-violet-300/25 bg-black/35 p-4 transition-colors duration-200 hover:border-violet-300/45"
          onMouseEnter={playHoverSound}
        >
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <span
              className={`rounded-full border px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] ${connected ? "border-emerald-300/40 bg-emerald-500/15 text-emerald-100" : "border-rose-300/35 bg-rose-500/10 text-rose-100"}`}
            >
              {connected ? t`Connected` : t`Disconnected`}
            </span>
            <span
              className={`rounded-full border px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] ${synced ? "border-cyan-300/40 bg-cyan-500/15 text-cyan-100" : "border-zinc-500/40 bg-zinc-800/70 text-zinc-300"}`}
            >
              {synced ? t`Synced` : t`Not Synced`}
            </span>
            {isConnecting ? (
              <span className="rounded-full border border-amber-300/40 bg-amber-500/15 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-amber-100">
                <Trans>Connecting</Trans>
              </span>
            ) : null}
          </div>

          <div className="space-y-4 text-left">
            <p className="rounded-lg border border-cyan-300/15 bg-cyan-500/5 px-3 py-2 text-xs text-cyan-100/80">
              <Trans>
                Every device category can be driven and tuned individually, even while all devices
                run at the same time.
              </Trans>
            </p>
            {deviceSlots.length > 0 ? (
              <div className="space-y-2 rounded-xl border border-white/10 bg-black/20 p-3">
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-zinc-300">
                  <Trans>Configured devices</Trans> ({deviceSlots.length})
                </p>
                {deviceSlots.map((device) => (
                  <div
                    key={device.id}
                    className="flex items-center justify-between gap-3 rounded-lg border border-white/10 bg-white/5 px-3 py-2"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-white">{device.label}</p>
                      <p className="text-[11px] uppercase tracking-wider text-zinc-400">
                        {device.config.provider}
                      </p>
                    </div>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => selectDevice(device.id)}
                        className={`rounded-lg border px-2.5 py-1.5 text-xs font-semibold ${
                          selectedDeviceId === device.id
                            ? "border-cyan-300/50 bg-cyan-500/20 text-cyan-100"
                            : "border-white/15 bg-white/5 text-zinc-200 hover:bg-white/10"
                        }`}
                      >
                        <Trans>Tune</Trans>
                      </button>
                      <button
                        type="button"
                        onClick={() => void removeDevice(device.id)}
                        className="rounded-lg border border-rose-400/35 bg-rose-500/10 px-2.5 py-1.5 text-xs font-semibold text-rose-200 hover:bg-rose-500/20"
                      >
                        <Trans>Remove</Trans>
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            ) : null}

            <div className="grid gap-2 sm:grid-cols-3">
              <button
                type="button"
                disabled={isConnecting}
                onClick={() => {
                  playSelectSound();
                  void setProvider("thehandy");
                }}
                className={`rounded-xl border px-4 py-3 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                  provider === "thehandy"
                    ? "border-violet-300/60 bg-violet-500/30 text-violet-100"
                    : "border-zinc-700 bg-zinc-950 text-zinc-300 hover:bg-zinc-900"
                }`}
              >
                <Trans>TheHandy</Trans>
              </button>
              <button
                type="button"
                disabled={isConnecting}
                onClick={() => {
                  playSelectSound();
                  void setProvider("intiface");
                }}
                className={`rounded-xl border px-4 py-3 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                  provider === "intiface"
                    ? "border-cyan-300/60 bg-cyan-500/25 text-cyan-100"
                    : "border-zinc-700 bg-zinc-950 text-zinc-300 hover:bg-zinc-900"
                }`}
              >
                <Trans>Intiface</Trans>
              </button>
              <button
                type="button"
                disabled={isConnecting}
                onClick={() => {
                  playSelectSound();
                  void setProvider("tcode");
                }}
                className={`rounded-xl border px-4 py-3 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                  provider === "tcode"
                    ? "border-emerald-300/60 bg-emerald-500/25 text-emerald-100"
                    : "border-zinc-700 bg-zinc-950 text-zinc-300 hover:bg-zinc-900"
                }`}
              >
                <Trans>TCode</Trans>
              </button>
            </div>

            {provider === "intiface" ? (
              <div className="rounded-xl border border-cyan-400/25 bg-cyan-500/10 p-4">
                <div className="mb-4 rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-200">
                  <p className="font-bold uppercase tracking-wider">
                    <Trans>Experimental Support</Trans>
                  </p>
                  <p className="mt-1">
                    <Trans>
                      Intiface support is currently experimental and may have performance
                      limitations. Using a direct TheHandy connection is always preferred for the
                      best experience.
                    </Trans>
                  </p>
                </div>
                <div className="mb-4 rounded-xl border border-rose-500/40 bg-rose-500/10 p-4 text-sm text-rose-200">
                  <p className="font-bold uppercase tracking-wider">
                    <Trans>Intiface Central 3.0+ Required</Trans>
                  </p>
                  <p className="mt-1">
                    <Trans>
                      Only the latest version of Intiface Central is supported. Older versions may
                      fail to connect or behave unexpectedly.
                    </Trans>{" "}
                    <a
                      href={INTIFACE_DOWNLOAD_URL}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-semibold text-rose-100 underline decoration-rose-300/50 underline-offset-2 hover:text-white"
                    >
                      <Trans>Download the latest version</Trans>
                    </a>
                  </p>
                </div>
                <div className="flex flex-col gap-2">
                  <label
                    className="ml-1 font-[family-name:var(--font-jetbrains-mono)] text-xs font-bold uppercase tracking-wider text-zinc-300"
                    htmlFor="settings-intiface-websocket-url"
                  >
                    <Trans>Intiface WebSocket URL</Trans>
                  </label>
                  <input
                    id="settings-intiface-websocket-url"
                    type="text"
                    value={inputIntifaceUrl}
                    onChange={(event) => setInputIntifaceUrl(event.target.value)}
                    placeholder={DEFAULT_INTIFACE_WEBSOCKET_URL}
                    disabled={isConnecting}
                    className="rounded-xl border border-zinc-700 bg-zinc-950 px-4 py-3 text-white outline-none transition-all focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500 disabled:opacity-50"
                  />
                  <p className="ml-1 text-xs text-zinc-400">
                    <Trans>
                      Start Intiface Central, start its server, then connect to a linear/position-
                      or vibration-capable device.
                    </Trans>
                  </p>
                  <label
                    className="ml-1 mt-2 font-[family-name:var(--font-jetbrains-mono)] text-xs font-bold uppercase tracking-wider text-zinc-300"
                    htmlFor="settings-intiface-device-index"
                  >
                    <Trans>Device index</Trans>
                  </label>
                  <input
                    id="settings-intiface-device-index"
                    type="number"
                    min={0}
                    value={inputIntifaceDeviceIndex}
                    onChange={(event) => setInputIntifaceDeviceIndex(event.target.value)}
                    placeholder={t`Auto-select`}
                    disabled={isConnecting}
                    className="rounded-xl border border-zinc-700 bg-zinc-950 px-4 py-3 text-white outline-none transition-all focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500 disabled:opacity-50"
                  />
                  {intifaceDeviceName || intifaceDeviceIndex !== null ? (
                    <p className="ml-1 text-xs text-cyan-100">
                      <Trans>Selected device</Trans>: {intifaceDeviceName ?? t`Device`}{" "}
                      {intifaceDeviceIndex !== null ? `#${intifaceDeviceIndex}` : ""}
                    </p>
                  ) : null}
                  <div className="mt-2">
                    <label
                      className="mb-2 block font-[family-name:var(--font-jetbrains-mono)] text-[10px] font-semibold uppercase tracking-[0.24em] text-cyan-100/70"
                      htmlFor="settings-intiface-vibration-sensitivity"
                    >
                      <Trans>Vibration Sensitivity</Trans>
                    </label>
                    <input
                      id="settings-intiface-vibration-sensitivity"
                      type="range"
                      min={INTIFACE_VIBRATION_SENSITIVITY_MIN}
                      max={INTIFACE_VIBRATION_SENSITIVITY_MAX}
                      step={INTIFACE_VIBRATION_SENSITIVITY_STEP}
                      value={intifaceVibrationSensitivity}
                      aria-label={t`Intiface vibration sensitivity`}
                      onChange={(event) => {
                        const next = Number(event.target.value);
                        if (!Number.isFinite(next)) return;
                        setIntifaceVibrationSensitivity(
                          Math.max(
                            INTIFACE_VIBRATION_SENSITIVITY_MIN,
                            Math.min(INTIFACE_VIBRATION_SENSITIVITY_MAX, next)
                          )
                        );
                      }}
                      className="w-full accent-cyan-500"
                    />
                    <p className="ml-1 text-xs text-zinc-400">
                      <Trans>
                        Only affects vibration-only toys. Higher values map funscript stroke speed
                        to stronger vibration.
                      </Trans>{" "}
                      <span className="font-[family-name:var(--font-jetbrains-mono)] text-cyan-100">
                        {intifaceVibrationSensitivity.toFixed(2)}x
                      </span>
                    </p>
                  </div>
                </div>
              </div>
            ) : provider === "tcode" ? (
              <div className="rounded-xl border border-emerald-400/25 bg-emerald-500/10 p-4">
                <div className="mb-4 rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-200">
                  <p className="font-bold uppercase tracking-wider">
                    <Trans>Experimental Support</Trans>
                  </p>
                  <p className="mt-1">
                    <Trans>
                      TCode support streams the primary funscript to the L0 axis of OSR/SR-style
                      devices.
                    </Trans>
                  </p>
                </div>

                <div className="mb-4 grid gap-2 sm:grid-cols-2">
                  <button
                    type="button"
                    disabled={isConnecting}
                    onClick={() => setInputTCodeTransport("websocket")}
                    className={`rounded-lg border px-3 py-2 text-xs font-semibold uppercase tracking-[0.15em] transition-colors disabled:opacity-50 ${
                      inputTCodeTransport === "websocket"
                        ? "border-emerald-300/60 bg-emerald-500/25 text-emerald-100"
                        : "border-zinc-700 bg-zinc-950 text-zinc-300 hover:bg-zinc-900"
                    }`}
                  >
                    <Trans>WebSocket</Trans>
                  </button>
                  <button
                    type="button"
                    disabled={isConnecting}
                    onClick={() => {
                      setInputTCodeTransport("serial");
                      void refreshTCodeSerialPorts();
                    }}
                    className={`rounded-lg border px-3 py-2 text-xs font-semibold uppercase tracking-[0.15em] transition-colors disabled:opacity-50 ${
                      inputTCodeTransport === "serial"
                        ? "border-emerald-300/60 bg-emerald-500/25 text-emerald-100"
                        : "border-zinc-700 bg-zinc-950 text-zinc-300 hover:bg-zinc-900"
                    }`}
                  >
                    <Trans>Serial</Trans>
                  </button>
                </div>

                {inputTCodeTransport === "websocket" ? (
                  <div className="flex flex-col gap-2">
                    <label
                      className="ml-1 font-[family-name:var(--font-jetbrains-mono)] text-xs font-bold uppercase tracking-wider text-zinc-300"
                      htmlFor="settings-tcode-host"
                    >
                      <Trans>Device IP / Host</Trans>
                    </label>
                    <input
                      id="settings-tcode-host"
                      type="text"
                      value={inputTCodeHost}
                      onChange={(event) => setInputTCodeHost(event.target.value)}
                      placeholder={DEFAULT_TCODE_WEBSOCKET_HOST}
                      disabled={isConnecting}
                      className="rounded-xl border border-zinc-700 bg-zinc-950 px-4 py-3 text-white outline-none transition-all focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 disabled:opacity-50"
                    />
                    <p className="ml-1 text-xs text-zinc-400">
                      <Trans>Derived WebSocket URL</Trans>: {tcodeDerivedUrl}
                    </p>
                    {tcodeWebsocketUrl ? (
                      <p className="ml-1 text-xs text-emerald-100">
                        <Trans>Saved TCode URL</Trans>: {tcodeWebsocketUrl}
                      </p>
                    ) : null}
                  </div>
                ) : (
                  <div className="grid gap-3 sm:grid-cols-[1fr_auto_auto]">
                    <div className="flex flex-col gap-2">
                      <label
                        className="ml-1 font-[family-name:var(--font-jetbrains-mono)] text-xs font-bold uppercase tracking-wider text-zinc-300"
                        htmlFor="settings-tcode-serial-port"
                      >
                        <Trans>Serial Port</Trans>
                      </label>
                      <select
                        id="settings-tcode-serial-port"
                        value={inputTCodeSerialPath}
                        onChange={(event) => setInputTCodeSerialPath(event.target.value)}
                        disabled={isConnecting}
                        className="rounded-xl border border-zinc-700 bg-zinc-950 px-4 py-3 text-white outline-none transition-all focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 disabled:opacity-50"
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
                      disabled={connected || isConnecting || tcodeSerialPortsLoading}
                      onClick={() => void refreshTCodeSerialPorts()}
                      className="self-end rounded-xl border border-emerald-300/40 bg-emerald-500/15 px-4 py-3 text-xs font-semibold uppercase tracking-[0.15em] text-emerald-100 transition-colors hover:bg-emerald-500/25 disabled:opacity-50"
                    >
                      {tcodeSerialPortsLoading && !tcodeAutoDetecting
                        ? t`Refreshing...`
                        : t`Refresh`}
                    </button>
                    <button
                      type="button"
                      disabled={connected || isConnecting || tcodeSerialPortsLoading}
                      onClick={() => void handleAutoDetectTCodeSerialPort()}
                      className="self-end rounded-xl border border-cyan-300/40 bg-cyan-500/15 px-4 py-3 text-xs font-semibold uppercase tracking-[0.15em] text-cyan-100 transition-colors hover:bg-cyan-500/25 disabled:opacity-50"
                    >
                      {tcodeAutoDetecting ? t`Detecting...` : t`Auto Detect Toy`}
                    </button>
                    <div className="flex flex-col gap-2 sm:col-span-3">
                      <label
                        className="ml-1 font-[family-name:var(--font-jetbrains-mono)] text-xs font-bold uppercase tracking-wider text-zinc-300"
                        htmlFor="settings-tcode-baud-rate"
                      >
                        <Trans>Baud Rate</Trans>
                      </label>
                      <input
                        id="settings-tcode-baud-rate"
                        type="number"
                        value={inputTCodeBaudRate}
                        onChange={(event) => setInputTCodeBaudRate(event.target.value)}
                        placeholder={String(DEFAULT_TCODE_BAUD_RATE)}
                        disabled={isConnecting}
                        className="rounded-xl border border-zinc-700 bg-zinc-950 px-4 py-3 text-white outline-none transition-all focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 disabled:opacity-50"
                      />
                    </div>
                  </div>
                )}

                <div className="mt-4 flex flex-col gap-2">
                  <label
                    className="ml-1 font-[family-name:var(--font-jetbrains-mono)] text-xs font-bold uppercase tracking-wider text-zinc-300"
                    htmlFor="settings-tcode-precision"
                  >
                    <Trans>TCode Version</Trans>
                  </label>
                  <select
                    id="settings-tcode-precision"
                    value={inputTCodePrecision}
                    onChange={(event) => setInputTCodePrecision(event.target.value === "3" ? 3 : 4)}
                    disabled={isConnecting}
                    className="rounded-xl border border-zinc-700 bg-zinc-950 px-4 py-3 text-white outline-none transition-all focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 disabled:opacity-50"
                  >
                    <option value={4}>{t`TCode v0.3 / 4 digit`}</option>
                    <option value={3}>{t`TCode v0.2 / 3 digit`}</option>
                  </select>
                </div>
              </div>
            ) : (
              <>
                <div className="flex flex-col gap-2">
                  <label
                    className="ml-1 font-[family-name:var(--font-jetbrains-mono)] text-xs font-bold uppercase tracking-wider text-zinc-300"
                    htmlFor="settings-handy-connection-key"
                  >
                    <Trans>Connection Key / Channel Ref</Trans>
                  </label>
                  <input
                    id="settings-handy-connection-key"
                    type="text"
                    value={inputKey}
                    onChange={(event) => setInputKey(event.target.value)}
                    placeholder={t`Device connection key`}
                    disabled={isConnecting}
                    className="rounded-xl border border-zinc-700 bg-zinc-950 px-4 py-3 text-white outline-none transition-all focus:border-purple-500 focus:ring-1 focus:ring-purple-500 disabled:opacity-50"
                  />
                </div>

                <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm font-[family-name:var(--font-jetbrains-mono)] text-amber-200">
                  <Trans>Only firmware version 4 and up is supported.</Trans>
                </div>

                <div className="rounded-xl border border-cyan-400/25 bg-cyan-500/10 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="font-[family-name:var(--font-jetbrains-mono)] text-xs uppercase tracking-[0.22em] text-cyan-200/80">
                        <Trans>App Key</Trans>
                      </p>
                      <p className="mt-1 text-sm text-cyan-50">
                        {useCustomApiKey
                          ? t`Using your custom TheHandy app key.`
                          : t`Using the built-in TheHandy app key automatically.`}
                      </p>
                    </div>
                    <button
                      type="button"
                      disabled={isConnecting}
                      onClick={() => {
                        setUseCustomApiKey((current) => {
                          const next = !current;
                          if (!next) {
                            setInputApiKeyOverride("");
                          }
                          return next;
                        });
                      }}
                      className="rounded-lg border border-cyan-300/40 bg-cyan-500/15 px-3 py-2 text-xs font-semibold uppercase tracking-[0.15em] text-cyan-100 transition-colors hover:bg-cyan-500/25 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {useCustomApiKey ? t`Use Built-In` : t`Use Custom`}
                    </button>
                  </div>

                  {useCustomApiKey ? (
                    <div className="mt-4 flex flex-col gap-2">
                      <label
                        className="ml-1 font-[family-name:var(--font-jetbrains-mono)] text-xs font-bold uppercase tracking-wider text-zinc-300"
                        htmlFor="settings-handy-api-key"
                      >
                        <Trans>Application ID</Trans>
                      </label>
                      <input
                        id="settings-handy-api-key"
                        type="password"
                        value={inputApiKeyOverride}
                        onChange={(event) => setInputApiKeyOverride(event.target.value)}
                        placeholder={t`Enter your Handy application ID`}
                        disabled={isConnecting}
                        className="rounded-xl border border-zinc-700 bg-zinc-950 px-4 py-3 text-white outline-none transition-all focus:border-purple-500 focus:ring-1 focus:ring-purple-500 disabled:opacity-50"
                      />
                      <a
                        href={HANDY_USER_PORTAL_URL}
                        target="_blank"
                        rel="noreferrer"
                        className="mt-1 inline-flex w-fit items-center justify-center rounded-lg border border-cyan-300/40 bg-cyan-500/15 px-3 py-2 text-xs font-semibold uppercase tracking-[0.15em] text-cyan-100 transition-colors hover:bg-cyan-500/25"
                      >
                        <Trans>Open Handy User Portal</Trans>
                      </a>
                      <p className="ml-1 text-xs text-zinc-400">
                        <Trans>
                          Do not use your access token here. Create or select an app at Handy and
                          paste the application ID instead.
                        </Trans>
                      </p>
                      <p className="ml-1 text-xs text-zinc-400">
                        <Trans>
                          Leave custom mode off unless you explicitly want to override the built-in
                          app identity.
                        </Trans>
                      </p>
                    </div>
                  ) : (
                    <p className="mt-3 text-xs text-zinc-400">
                      <Trans>
                        Built-in key loaded. Override only if you need a different app identity.
                      </Trans>
                    </p>
                  )}
                </div>
              </>
            )}

            {provider !== "tcode" ? (
              <div className="rounded-xl border border-cyan-400/25 bg-cyan-500/10 p-4">
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <p className="font-[family-name:var(--font-jetbrains-mono)] text-xs font-bold uppercase tracking-wider text-cyan-100">
                      <Trans>Limit fast funscripts</Trans>
                    </p>
                    <p className="mt-1 text-xs text-zinc-300">
                      <Trans>
                        Keeps demanding scripts within a Handy-compatible movement rate. Disable
                        only if the device or another application handles speed limiting; fast
                        scripts may stutter or stop.
                      </Trans>
                    </p>
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-label={t`Limit fast funscripts`}
                    aria-checked={funscriptRateLimitEnabled}
                    onClick={() => {
                      playSelectSound();
                      void setFunscriptRateLimitEnabled(!funscriptRateLimitEnabled);
                    }}
                    className={`relative h-7 w-14 shrink-0 overflow-hidden rounded-full border transition-all duration-200 ${funscriptRateLimitEnabled ? "border-cyan-300/80 bg-cyan-500/50 shadow-[0_0_20px_rgba(34,211,238,0.35)]" : "border-zinc-600 bg-zinc-800"}`}
                  >
                    <span
                      className={`absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow-md transition-transform duration-200 ${funscriptRateLimitEnabled ? "translate-x-7" : "translate-x-0"}`}
                    />
                  </button>
                </div>

                <div
                  className={`mt-4 grid gap-3 border-t border-cyan-300/15 pt-4 sm:grid-cols-2 ${funscriptRateLimitEnabled ? "" : "opacity-50"}`}
                >
                  <label className="flex flex-col gap-1.5 text-xs text-zinc-300">
                    <span className="font-[family-name:var(--font-jetbrains-mono)] font-bold uppercase tracking-wider">
                      <Trans>Maximum movement rate (%/s)</Trans>
                    </span>
                    <input
                      aria-label={t`Maximum movement rate`}
                      type="number"
                      min={FUNSCRIPT_MAX_RATE_MIN}
                      max={FUNSCRIPT_MAX_RATE_MAX}
                      step={10}
                      value={inputFunscriptMaxRate}
                      disabled={!funscriptRateLimitEnabled}
                      onChange={(event) => setInputFunscriptMaxRate(event.target.value)}
                      onBlur={() => {
                        const nextMaxRate = normalizeFunscriptMaxRate(inputFunscriptMaxRate);
                        const nextRdpEpsilon =
                          normalizeFunscriptRdpEpsilon(inputFunscriptRdpEpsilon);
                        setInputFunscriptMaxRate(String(nextMaxRate));
                        setInputFunscriptRdpEpsilon(String(nextRdpEpsilon));
                        void setFunscriptRateLimitSettings(nextMaxRate, nextRdpEpsilon);
                      }}
                      className="rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-white outline-none focus:border-cyan-400 disabled:cursor-not-allowed"
                    />
                    <span className="text-zinc-500">
                      <Trans>Maximum physical travel per second. Default: 400.</Trans>
                    </span>
                  </label>
                  <label className="flex flex-col gap-1.5 text-xs text-zinc-300">
                    <span className="font-[family-name:var(--font-jetbrains-mono)] font-bold uppercase tracking-wider">
                      <Trans>Simplification tolerance</Trans>
                    </span>
                    <input
                      aria-label={t`Simplification tolerance`}
                      type="number"
                      min={FUNSCRIPT_RDP_EPSILON_MIN}
                      max={FUNSCRIPT_RDP_EPSILON_MAX}
                      step={0.1}
                      value={inputFunscriptRdpEpsilon}
                      disabled={!funscriptRateLimitEnabled}
                      onChange={(event) => setInputFunscriptRdpEpsilon(event.target.value)}
                      onBlur={() => {
                        const nextMaxRate = normalizeFunscriptMaxRate(inputFunscriptMaxRate);
                        const nextRdpEpsilon =
                          normalizeFunscriptRdpEpsilon(inputFunscriptRdpEpsilon);
                        setInputFunscriptMaxRate(String(nextMaxRate));
                        setInputFunscriptRdpEpsilon(String(nextRdpEpsilon));
                        void setFunscriptRateLimitSettings(nextMaxRate, nextRdpEpsilon);
                      }}
                      className="rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-white outline-none focus:border-cyan-400 disabled:cursor-not-allowed"
                    />
                    <span className="text-zinc-500">
                      <Trans>Higher values remove more tiny movements. Default: 1.</Trans>
                    </span>
                  </label>
                </div>
                <button
                  type="button"
                  disabled={!funscriptRateLimitEnabled}
                  onClick={() => {
                    playSelectSound();
                    setInputFunscriptMaxRate(String(DEFAULT_FUNSCRIPT_MAX_RATE));
                    setInputFunscriptRdpEpsilon(String(DEFAULT_FUNSCRIPT_RDP_EPSILON));
                    void setFunscriptRateLimitSettings(
                      DEFAULT_FUNSCRIPT_MAX_RATE,
                      DEFAULT_FUNSCRIPT_RDP_EPSILON
                    );
                  }}
                  className="mt-3 rounded-lg border border-zinc-600 bg-zinc-900/70 px-3 py-2 text-xs font-semibold uppercase tracking-wider text-zinc-300 transition-colors hover:border-cyan-400/60 hover:text-cyan-100 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <Trans>Reset limiter defaults</Trans>
                </button>
              </div>
            ) : null}

            {provider === "thehandy" && DEFAULT_THEHANDY_APP_API_KEY.trim().length === 0 ? (
              <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm font-[family-name:var(--font-jetbrains-mono)] text-amber-300">
                <Trans>
                  No bundled TheHandy app key is configured in this build. Enable custom mode and
                  enter one manually.
                </Trans>
              </div>
            ) : null}

            {error ? (
              <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm font-[family-name:var(--font-jetbrains-mono)] text-red-400">
                {error}
              </div>
            ) : null}

            {syncError ? (
              <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm font-[family-name:var(--font-jetbrains-mono)] text-amber-300">
                {syncError}
              </div>
            ) : null}

            <div className="flex flex-wrap gap-2 pt-1">
              <button
                type="button"
                onClick={() => {
                  playSelectSound();
                  void handleConnect();
                }}
                className="inline-flex rounded-xl border border-violet-300/60 bg-violet-500/30 px-4 py-2 text-sm font-semibold text-violet-100 transition-all duration-200 hover:border-violet-200/80 hover:bg-violet-500/45"
              >
                {isConnecting
                  ? t`Connecting...`
                  : deviceSlots.length > 0
                    ? t`Add device`
                    : t`Connect`}
              </button>
              {connected ? (
                <button
                  type="button"
                  onClick={() => void disconnect()}
                  className="inline-flex rounded-xl border border-rose-400/40 bg-rose-500/10 px-4 py-2 text-sm font-semibold text-rose-100 transition hover:bg-rose-500/20"
                >
                  <Trans>Disconnect all</Trans>
                </button>
              ) : null}
              <button
                type="button"
                onClick={() => {
                  playSelectSound();
                  void forceStop();
                }}
                className="inline-flex rounded-xl border border-zinc-500/60 bg-zinc-800/70 px-4 py-2 text-sm font-semibold text-zinc-100 transition-all duration-200 hover:border-zinc-300/80 hover:bg-zinc-700/80"
              >
                <Trans>Force Stop</Trans>
              </button>
            </div>
          </div>
        </div>

        {deviceAnimationTestEnabled ? (
          <div
            className="rounded-2xl border border-fuchsia-300/20 bg-[linear-gradient(160deg,rgba(31,10,38,0.74),rgba(8,18,32,0.74))] p-4 shadow-[0_0_32px_rgba(217,70,239,0.08)] transition-colors duration-200 hover:border-fuchsia-300/35"
            data-testid="haptics-test-device-layer"
            onMouseEnter={playHoverSound}
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="font-[family-name:var(--font-jetbrains-mono)] text-xs uppercase tracking-[0.22em] text-fuchsia-200/80">
                  <Trans>Test Device</Trans>
                </p>
                <p className="mt-1 text-sm text-zinc-200">
                  <Trans>
                    Runs a generated motion loop with a matching visual animation for sync checks.
                  </Trans>
                </p>
              </div>
              <span
                className={`rounded-full border px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] ${
                  testDeviceRunning
                    ? "border-fuchsia-300/40 bg-fuchsia-500/15 text-fuchsia-100"
                    : testDeviceStarting
                      ? "border-cyan-300/40 bg-cyan-500/15 text-cyan-100"
                      : "border-zinc-500/40 bg-zinc-800/70 text-zinc-300"
                }`}
              >
                {testDeviceRunning ? t`Running` : testDeviceStarting ? t`Syncing` : t`Stopped`}
              </span>
            </div>

            <div className="mt-4 overflow-hidden rounded-xl border border-white/10 bg-black/35 p-4">
              <div className="relative h-28 rounded-lg border border-fuchsia-300/15 bg-[radial-gradient(circle_at_50%_50%,rgba(244,63,94,0.18),rgba(2,6,23,0.9)_68%)]">
                <AntiPerkBeatbar
                  actions={HAPTICS_TEST_ACTIONS}
                  beatbarBeats={HAPTICS_TEST_BEATBAR_BEATS}
                  elapsedMs={normalizedTestElapsedMs}
                  showBeatbar={false}
                  showBall
                  style={HAPTICS_TEST_BEATBAR_STYLE}
                  className="pointer-events-none absolute inset-x-0 top-1/2 z-10 mx-auto w-full -translate-y-1/2 px-2"
                />
              </div>
            </div>

            {testDeviceError ? (
              <div className="mt-3 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm font-[family-name:var(--font-jetbrains-mono)] text-amber-300">
                {testDeviceError}
              </div>
            ) : null}

            <div className="mt-4 flex flex-wrap gap-2">
              <button
                type="button"
                disabled={!connected || isConnecting || testDeviceStarting}
                onClick={() => {
                  playSelectSound();
                  void (testDeviceRunning ? stopTestDevice() : startTestDevice());
                }}
                className="inline-flex rounded-xl border border-fuchsia-300/40 bg-fuchsia-500/15 px-4 py-2 text-sm font-semibold text-fuchsia-100 transition-all duration-200 hover:border-fuchsia-200/70 hover:bg-fuchsia-500/25 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {testDeviceRunning
                  ? t`Stop Test`
                  : testDeviceStarting
                    ? t`Syncing...`
                    : t`Start Test`}
              </button>
            </div>
          </div>
        ) : null}

        <div
          className="rounded-2xl border border-cyan-300/20 bg-[linear-gradient(160deg,rgba(8,20,36,0.72),rgba(12,16,38,0.72))] p-4 shadow-[0_0_32px_rgba(34,211,238,0.08)] transition-colors duration-200 hover:border-cyan-300/35"
          data-testid="thehandy-offset-layer"
          onMouseEnter={playHoverSound}
        >
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="font-[family-name:var(--font-jetbrains-mono)] text-xs uppercase tracking-[0.22em] text-cyan-200/80">
                <Trans>Global Sync Offset</Trans>
              </p>
              <p className="mt-1 text-sm text-zinc-200">
                <Trans>
                  Applies to all haptics sync operations. Use this if the device is slightly ahead
                  or behind the video.
                </Trans>
              </p>
            </div>
            <div className="rounded-2xl border border-cyan-300/30 bg-cyan-400/10 px-4 py-2 text-right">
              <div className="text-[10px] font-semibold uppercase tracking-[0.24em] text-cyan-100/70">
                <Trans>Current</Trans>
              </div>
              <div className="bg-gradient-to-r from-cyan-100 via-sky-100 to-indigo-100 bg-clip-text text-3xl font-black tracking-tight text-transparent">
                {offsetMs >= 0 ? "+" : ""}
                {offsetMs}ms
              </div>
            </div>
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => {
                playSelectSound();
                void adjustOffset(-THEHANDY_OFFSET_STEP_MS);
              }}
              className="rounded-xl border border-cyan-300/30 bg-cyan-500/10 px-3 py-2 text-sm font-semibold text-cyan-100 transition-colors hover:bg-cyan-500/20"
            >
              -25ms
            </button>
            <button
              type="button"
              onClick={() => {
                playSelectSound();
                void adjustOffset(-THEHANDY_OFFSET_FINE_STEP_MS);
              }}
              className="rounded-xl border border-cyan-300/20 bg-white/5 px-3 py-2 text-sm font-semibold text-zinc-100 transition-colors hover:bg-white/10"
            >
              -1ms
            </button>
            <button
              type="button"
              onClick={() => {
                playSelectSound();
                void resetOffset();
              }}
              className="rounded-xl border border-violet-300/30 bg-violet-500/10 px-3 py-2 text-sm font-semibold text-violet-100 transition-colors hover:bg-violet-500/20"
            >
              <Trans>Reset</Trans>
            </button>
            <button
              type="button"
              onClick={() => {
                playSelectSound();
                void adjustOffset(THEHANDY_OFFSET_FINE_STEP_MS);
              }}
              className="rounded-xl border border-cyan-300/20 bg-white/5 px-3 py-2 text-sm font-semibold text-zinc-100 transition-colors hover:bg-white/10"
            >
              +1ms
            </button>
            <button
              type="button"
              onClick={() => {
                playSelectSound();
                void adjustOffset(THEHANDY_OFFSET_STEP_MS);
              }}
              className="rounded-xl border border-cyan-300/30 bg-cyan-500/10 px-3 py-2 text-sm font-semibold text-cyan-100 transition-colors hover:bg-cyan-500/20"
            >
              +25ms
            </button>
          </div>

          <div className="mt-4">
            <label
              className="mb-2 block font-[family-name:var(--font-jetbrains-mono)] text-[10px] font-semibold uppercase tracking-[0.24em] text-cyan-100/70"
              htmlFor="settings-handy-offset-slider"
            >
              <Trans>Offset Slider</Trans>
            </label>
            <input
              id="settings-handy-offset-slider"
              type="range"
              min={THEHANDY_OFFSET_MIN_MS}
              max={THEHANDY_OFFSET_MAX_MS}
              step={1}
              value={offsetMs}
              aria-label={t`TheHandy offset slider`}
              onChange={(event) => {
                const nextOffsetMs = Number(event.target.value);
                if (!Number.isFinite(nextOffsetMs)) return;
                const deltaMs = nextOffsetMs - offsetMs;
                if (deltaMs === 0) return;
                void adjustOffset(deltaMs);
              }}
              className="h-2 w-full cursor-pointer appearance-none rounded-full bg-[linear-gradient(90deg,rgba(56,189,248,0.24),rgba(168,85,247,0.28))] accent-cyan-300"
            />
            <div className="mt-2 flex items-center justify-between text-[11px] font-medium text-zinc-400">
              <span>{THEHANDY_OFFSET_MIN_MS}ms</span>
              <span>0ms</span>
              <span>+{THEHANDY_OFFSET_MAX_MS}ms</span>
            </div>
          </div>

          <div className="mt-3 flex flex-wrap gap-x-4 gap-y-2 text-xs text-zinc-400">
            <span>
              <code>[</code> / <code>]</code> physical keys in-game for coarse adjustment
            </span>
            <span>
              <code>Shift</code> + keys for 1ms fine tuning
            </span>
            <span>
              <code>\</code> in-game resets to 0ms
            </span>
          </div>
        </div>

        <div
          className="rounded-2xl border border-emerald-300/20 bg-[linear-gradient(160deg,rgba(8,24,26,0.72),rgba(12,16,38,0.72))] p-4 shadow-[0_0_32px_rgba(16,185,129,0.08)] transition-colors duration-200 hover:border-emerald-300/35"
          data-testid="thehandy-stroke-layer"
          onMouseEnter={playHoverSound}
        >
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="font-[family-name:var(--font-jetbrains-mono)] text-xs uppercase tracking-[0.22em] text-emerald-200/80">
                <Trans>Stroke Adjustment</Trans>
              </p>
              <p className="mt-1 text-sm text-zinc-200">
                <Trans>Adjust the active haptics stroke range.</Trans>
              </p>
            </div>
            <div className="rounded-2xl border border-emerald-300/30 bg-emerald-400/10 px-4 py-2 text-right">
              <div className="text-[10px] font-semibold uppercase tracking-[0.24em] text-emerald-100/70">
                <Trans>Current</Trans>
              </div>
              <div className="bg-gradient-to-r from-emerald-100 via-cyan-100 to-sky-100 bg-clip-text text-3xl font-black tracking-tight text-transparent">
                {strokePercent}%
              </div>
            </div>
          </div>

          <div className="mt-4">
            <div className="mb-2 flex items-center justify-between text-[10px] font-semibold uppercase tracking-[0.24em] text-emerald-100/70">
              <span>
                <Trans>Min</Trans>: {strokeMinSliderValue}%
              </span>
              <span>
                <Trans>Max</Trans>: {strokeMaxSliderValue}%
              </span>
            </div>
            <HandyStrokeRangeControl
              minValue={strokeMinSliderValue}
              maxValue={strokeMaxSliderValue}
              disabled={!connected || isConnecting || strokeLoading}
              minAriaLabel={t`TheHandy stroke minimum slider`}
              maxAriaLabel={t`TheHandy stroke maximum slider`}
              onPreview={(nextMinPercent, nextMaxPercent) => {
                setStrokeMinSliderValue(nextMinPercent);
                setStrokeMaxSliderValue(nextMaxPercent);
              }}
              onCommit={(nextMinPercent, nextMaxPercent) => {
                void setStrokeBounds(nextMinPercent, nextMaxPercent);
              }}
              trackClassName="bg-[linear-gradient(90deg,rgba(16,185,129,0.12),rgba(34,211,238,0.18))]"
              activeTrackClassName="bg-emerald-300/70"
            />
          </div>

          <div className="mt-3 text-sm text-zinc-200">
            <Trans>Current stroke</Trans>: {formatHandyStrokeBoundPercent(strokeMin)}% -{" "}
            {formatHandyStrokeBoundPercent(strokeMax)}%
          </div>

          {strokeError ? (
            <div className="mt-3 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm font-[family-name:var(--font-jetbrains-mono)] text-amber-300">
              {strokeError}
            </div>
          ) : null}

          <button
            type="button"
            disabled={!connected || isConnecting || strokeLoading}
            onClick={() => {
              playSelectSound();
              setStrokeMinSliderValue(0);
              setStrokeMaxSliderValue(100);
              void resetStroke();
            }}
            className="mt-4 inline-flex rounded-xl border border-emerald-300/30 bg-emerald-500/10 px-4 py-2 text-sm font-semibold text-emerald-100 transition-colors hover:bg-emerald-500/20 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Trans>Reset Stroke</Trans>
          </button>
        </div>
      </div>
    </section>
  );
}

function MusicSettingsCard() {
  const { t } = useLingui();
  const {
    enabled,
    queue,
    currentTrack,
    isPlaying,
    volume,
    shuffle,
    loopMode,
    setEnabled,
    addTracks,
    addTrackFromUrl,
    addPlaylistFromUrl,
    removeTrack,
    moveTrack,
    clearQueue,
    play,
    pause,
    next,
    previous,
    setCurrentTrack,
    setVolume,
    setShuffle,
  } = useGlobalMusic();
  const [isAddingTracks, setIsAddingTracks] = useState(false);
  const [showUrlInput, setShowUrlInput] = useState(false);
  const [urlInput, setUrlInput] = useState("");
  const [isAddingFromUrl, setIsAddingFromUrl] = useState(false);
  const [urlError, setUrlError] = useState<string | null>(null);
  const [urlMode, setUrlMode] = useState<"track" | "playlist">("track");
  const [urlResult, setUrlResult] = useState<{ added: number; errors: number } | null>(null);
  const [isClearConfirmOpen, setIsClearConfirmOpen] = useState(false);
  const [volumeDraft, setVolumeDraft] = useState(() => Math.round(DEFAULT_MUSIC_VOLUME * 100));
  const [loopDraft, setLoopDraft] = useState<MusicLoopMode>(DEFAULT_MUSIC_LOOP_MODE);
  const [sfxVolumeDraft, setSfxVolumeDraft] = useState(() => Math.round(DEFAULT_SFX_VOLUME * 100));

  useEffect(() => {
    let mounted = true;
    void trpc.store.get.query({ key: SFX_VOLUME_KEY }).then((val) => {
      if (!mounted) return;
      const vol = clampSfxVolume(val);
      setSfxVolumeDraft(Math.round(vol * 100));
    });
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    setVolumeDraft(Math.round(volume * 100));
  }, [volume]);

  useEffect(() => {
    setLoopDraft(loopMode);
  }, [loopMode]);

  const commitVolumeDraft = async () => {
    await setVolume(volumeDraft / 100);
  };

  const commitSfxVolumeDraft = async () => {
    const next = sfxVolumeDraft / 100;
    await trpc.store.set.mutate({ key: SFX_VOLUME_KEY, value: next });
    window.dispatchEvent(new CustomEvent(SFX_VOLUME_CHANGED_EVENT, { detail: next }));
  };

  const addSelectedTracks = async () => {
    if (isAddingTracks) return;
    setIsAddingTracks(true);
    try {
      const filePaths = await window.electronAPI.dialog.selectMusicFiles();
      if (filePaths.length === 0) return;
      await addTracks(filePaths);
    } catch (error) {
      console.error("Failed to add music tracks", error);
    } finally {
      setIsAddingTracks(false);
    }
  };

  const handleAddFromUrl = async () => {
    if (isAddingFromUrl) return;
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
    setIsAddingFromUrl(true);
    setUrlResult(null);
    try {
      if (urlMode === "playlist") {
        const result = await addPlaylistFromUrl(trimmed);
        setUrlResult({ added: result.addedCount, errors: result.errorCount });
        if (result.addedCount > 0) {
          setUrlInput("");
          setShowUrlInput(false);
        }
      } else {
        await addTrackFromUrl(trimmed);
        setUrlInput("");
        setShowUrlInput(false);
      }
    } catch (error) {
      setUrlError(error instanceof Error ? error.message : t`Failed to add from URL`);
    } finally {
      setIsAddingFromUrl(false);
    }
  };

  const handleRequestClearQueue = () => {
    if (queue.length === 0) return;
    playSelectSound();
    setIsClearConfirmOpen(true);
  };

  const handleConfirmClearQueue = () => {
    playSelectSound();
    setIsClearConfirmOpen(false);
    void clearQueue();
  };

  const handleCancelClearQueue = () => {
    playSelectSound();
    setIsClearConfirmOpen(false);
  };

  return (
    <>
      <section
        className="animate-entrance rounded-3xl border border-purple-400/25 bg-zinc-950/55 p-5 backdrop-blur-xl"
        style={{ animationDelay: "0.08s" }}
      >
        <div className="mb-4">
          <h2 className="text-lg font-extrabold tracking-tight text-violet-100">
            <Trans>Music</Trans>
          </h2>
          <p className="mt-1 text-sm text-zinc-300">
            <Trans>
              Build a global queue from local audio files. Music pauses for foreground video
              playback and resumes from the same spot.
            </Trans>
          </p>
        </div>

        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-4 border-b border-violet-300/15 pb-4">
            <div className="flex items-center gap-4">
              <button
                type="button"
                aria-label={t`Toggle Enable Global Music`}
                role="switch"
                aria-checked={enabled}
                onMouseEnter={playHoverSound}
                onClick={() => {
                  playSelectSound();
                  void setEnabled(!enabled);
                }}
                className={`relative h-7 w-14 shrink-0 overflow-hidden rounded-full border transition-all duration-200 ${enabled ? "border-violet-300/80 bg-violet-500/50 shadow-[0_0_20px_rgba(139,92,246,0.45)]" : "border-zinc-600 bg-zinc-800"}`}
              >
                <span
                  className={`absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow-md transition-transform duration-200 ${enabled ? "translate-x-7" : "translate-x-0"}`}
                />
              </button>
              <span
                className={`text-sm font-medium ${enabled ? "text-zinc-100" : "text-zinc-400"}`}
              >
                {enabled ? t`Music Enabled` : t`Music Disabled`}
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onMouseEnter={playHoverSound}
                onClick={() => {
                  playSelectSound();
                  void previous();
                }}
                className="rounded-lg border border-zinc-600 bg-black/45 px-2.5 py-1.5 text-xs font-semibold text-zinc-100 hover:border-zinc-400"
              >
                <Trans>Prev</Trans>
              </button>
              <button
                type="button"
                onMouseEnter={playHoverSound}
                onClick={() => {
                  playSelectSound();
                  if (isPlaying) {
                    pause();
                    return;
                  }
                  void play();
                }}
                className="rounded-lg border border-violet-300/60 bg-violet-500/30 px-2.5 py-1.5 text-xs font-semibold text-violet-100 hover:border-violet-200/80 hover:bg-violet-500/45"
              >
                {isPlaying ? t`Pause` : t`Play`}
              </button>
              <button
                type="button"
                onMouseEnter={playHoverSound}
                onClick={() => {
                  playSelectSound();
                  void next();
                }}
                className="rounded-lg border border-zinc-600 bg-black/45 px-2.5 py-1.5 text-xs font-semibold text-zinc-100 hover:border-zinc-400"
              >
                <Trans>Next</Trans>
              </button>
              <span className="text-xs text-zinc-400">
                {currentTrack ? currentTrack.name : t`No track`}
              </span>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-6 text-sm">
            <label className="flex items-center gap-2">
              <span className="text-zinc-400">
                <Trans>Volume:</Trans>
              </span>
              <input
                aria-label={t`Music volume`}
                type="range"
                min={0}
                max={100}
                step={1}
                value={volumeDraft}
                onChange={(event) => setVolumeDraft(Number(event.target.value))}
                onMouseUp={() => void commitVolumeDraft()}
                onTouchEnd={() => void commitVolumeDraft()}
                className="h-1.5 w-20 cursor-pointer appearance-none rounded-lg bg-zinc-800 accent-violet-400"
              />
              <span className="w-8 text-zinc-300">{volumeDraft}%</span>
            </label>
            <label className="flex items-center gap-2">
              <span className="text-zinc-400">SFX:</span>
              <input
                aria-label={t`Sound effects volume`}
                type="range"
                min={0}
                max={100}
                step={1}
                value={sfxVolumeDraft}
                onChange={(event) => setSfxVolumeDraft(Number(event.target.value))}
                onMouseUp={() => void commitSfxVolumeDraft()}
                onTouchEnd={() => void commitSfxVolumeDraft()}
                className="h-1.5 w-20 cursor-pointer appearance-none rounded-lg bg-zinc-800 accent-violet-400"
              />
              <span className="w-8 text-zinc-300">{sfxVolumeDraft}%</span>
            </label>
            <div className="flex items-center gap-2">
              <button
                type="button"
                aria-label={t`Toggle Shuffle`}
                role="switch"
                aria-checked={shuffle}
                onMouseEnter={playHoverSound}
                onClick={() => {
                  playSelectSound();
                  void setShuffle(!shuffle);
                }}
                className={`relative h-5 w-10 shrink-0 overflow-hidden rounded-full border transition-all duration-200 ${shuffle ? "border-violet-300/80 bg-violet-500/50" : "border-zinc-600 bg-zinc-800"}`}
              >
                <span
                  className={`absolute left-0.5 top-0.5 h-3.5 w-3.5 rounded-full bg-white shadow-md transition-transform duration-200 ${shuffle ? "translate-x-5" : "translate-x-0"}`}
                />
              </button>
              <span className="text-zinc-400">
                <Trans>Shuffle</Trans>
              </span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-zinc-400">
                <Trans>Loop:</Trans>
              </span>
              <GameDropdown
                value={loopDraft}
                options={[
                  { value: "queue", label: t`Queue` },
                  { value: "track", label: t`Track` },
                  { value: "off", label: t`Off` },
                ]}
                onChange={(value) => setLoopDraft(value as MusicLoopMode)}
                className="w-auto"
              />
            </div>
          </div>

          <div className="border-t border-violet-300/15 pt-4">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
              <span className="text-sm font-semibold text-zinc-100">
                {t`Queue (${queue.length} tracks)`}
              </span>
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={isAddingTracks}
                  onMouseEnter={playHoverSound}
                  onClick={() => {
                    playSelectSound();
                    void addSelectedTracks();
                  }}
                  className={`rounded-lg border px-3 py-1.5 text-xs font-semibold transition-all duration-200 ${
                    isAddingTracks
                      ? "cursor-not-allowed border-zinc-600 bg-zinc-800 text-zinc-500"
                      : "border-violet-300/60 bg-violet-500/30 text-violet-100 hover:border-violet-200/80 hover:bg-violet-500/45"
                  }`}
                >
                  {isAddingTracks ? t`Adding...` : t`Add Tracks`}
                </button>
                <button
                  type="button"
                  onMouseEnter={playHoverSound}
                  onClick={() => {
                    playSelectSound();
                    setShowUrlInput((current) => !current);
                    setUrlError(null);
                  }}
                  className={`rounded-lg border px-3 py-1.5 text-xs font-semibold transition-all duration-200 ${
                    showUrlInput
                      ? "border-cyan-300/60 bg-cyan-500/30 text-cyan-100"
                      : "border-purple-300/60 bg-purple-500/30 text-purple-100 hover:border-purple-200/80 hover:bg-purple-500/45"
                  }`}
                >
                  {showUrlInput ? t`Cancel` : t`Add from URL`}
                </button>
                <button
                  type="button"
                  disabled={queue.length === 0}
                  onMouseEnter={playHoverSound}
                  onClick={handleRequestClearQueue}
                  className={`rounded-lg border px-3 py-1.5 text-xs font-semibold transition-all duration-200 ${
                    queue.length === 0
                      ? "cursor-not-allowed border-zinc-600 bg-zinc-800 text-zinc-500"
                      : "border-rose-300/60 bg-rose-500/20 text-rose-100 hover:bg-rose-500/35"
                  }`}
                >
                  <Trans>Clear</Trans>
                </button>
              </div>
            </div>

            {showUrlInput && (
              <div className="mb-3 space-y-2 rounded-lg border border-violet-300/15 bg-black/20 p-3">
                <p className="text-xs text-zinc-400">
                  <Trans>Add from any yt-dlp-supported URL (downloaded as MP3 via yt-dlp)</Trans>
                </p>
                <div className="flex gap-1.5">
                  <button
                    type="button"
                    onMouseEnter={playHoverSound}
                    onClick={() => {
                      playSelectSound();
                      setUrlMode("track");
                      setUrlResult(null);
                    }}
                    className={`rounded-lg border px-2 py-1 text-[10px] font-bold uppercase tracking-wide transition ${
                      urlMode === "track"
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
                      setUrlMode("playlist");
                      setUrlResult(null);
                    }}
                    className={`rounded-lg border px-2 py-1 text-[10px] font-bold uppercase tracking-wide transition ${
                      urlMode === "playlist"
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
                      urlMode === "playlist"
                        ? t`https://example.com/playlist-or-collection`
                        : t`https://example.com/video-or-audio`
                    }
                    value={urlInput}
                    onChange={(e) => {
                      setUrlInput(e.target.value);
                      setUrlError(null);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        void handleAddFromUrl();
                      }
                    }}
                    disabled={isAddingFromUrl}
                    className={`flex-1 rounded-lg border bg-white/5 px-3 py-1.5 text-xs text-white placeholder-zinc-500 outline-none transition ${
                      urlError
                        ? "border-rose-400/40 focus:border-rose-400/60"
                        : "border-violet-300/30 focus:border-cyan-400/60"
                    }`}
                  />
                  <button
                    type="button"
                    onMouseEnter={playHoverSound}
                    onClick={() => void handleAddFromUrl()}
                    disabled={isAddingFromUrl}
                    className={`rounded-lg border px-3 py-1.5 text-xs font-semibold transition-all duration-200 ${
                      isAddingFromUrl
                        ? "cursor-not-allowed border-zinc-600 bg-zinc-800 text-zinc-500"
                        : "border-cyan-300/60 bg-cyan-500/30 text-cyan-100 hover:border-cyan-200/80 hover:bg-cyan-500/45"
                    }`}
                  >
                    {isAddingFromUrl ? t`Downloading...` : t`Add`}
                  </button>
                </div>
                {urlResult && (
                  <p className="text-xs text-emerald-300">
                    {urlResult.errors > 0
                      ? t`Added ${urlResult.added} track${urlResult.added !== 1 ? "s" : ""} (${urlResult.errors} failed)`
                      : t`Added ${urlResult.added} track${urlResult.added !== 1 ? "s" : ""}`}
                  </p>
                )}
                {urlError && <p className="text-xs text-rose-300">{urlError}</p>}
              </div>
            )}

            <div className="divide-y divide-violet-300/10">
              {queue.length === 0 ? (
                <div className="py-3 text-sm text-zinc-400">
                  <Trans>No music tracks configured.</Trans>
                </div>
              ) : (
                queue.map((entry, index) => {
                  const isCurrent = currentTrack?.id === entry.id;
                  return (
                    <div
                      key={entry.id}
                      className={`flex flex-wrap items-center justify-between gap-2 py-2 ${isCurrent ? "text-violet-100" : ""}`}
                    >
                      <button
                        type="button"
                        onClick={() => {
                          playSelectSound();
                          void setCurrentTrack(entry.id);
                        }}
                        className="min-w-0 flex-1 text-left"
                      >
                        <span
                          className={`truncate text-sm ${isCurrent ? "font-semibold text-violet-100" : "text-zinc-200"}`}
                        >
                          {isCurrent ? "▶ " : ""}
                          {entry.name}
                        </span>
                      </button>
                      <div className="flex gap-1">
                        <button
                          type="button"
                          disabled={index === 0}
                          onClick={() => {
                            playSelectSound();
                            void moveTrack(entry.id, "up");
                          }}
                          className="rounded px-2 py-0.5 text-xs text-zinc-400 hover:text-zinc-200 disabled:opacity-40"
                        >
                          ↑
                        </button>
                        <button
                          type="button"
                          disabled={index === queue.length - 1}
                          onClick={() => {
                            playSelectSound();
                            void moveTrack(entry.id, "down");
                          }}
                          className="rounded px-2 py-0.5 text-xs text-zinc-400 hover:text-zinc-200 disabled:opacity-40"
                        >
                          ↓
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            playSelectSound();
                            void removeTrack(entry.id);
                          }}
                          className="rounded px-2 py-0.5 text-xs text-rose-300 hover:text-rose-200"
                        >
                          ✕
                        </button>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
      </section>
      <ConfirmDialog
        isOpen={isClearConfirmOpen}
        title={t`Clear music playlist?`}
        message={t`This will remove every track from the current music playlist.`}
        confirmLabel={t`Clear Playlist`}
        cancelLabel={t`Keep Playlist`}
        variant="warning"
        onConfirm={handleConfirmClearQueue}
        onCancel={handleCancelClearQueue}
      />
    </>
  );
}

function MoaningSettingsCard() {
  const { t } = useLingui();
  const {
    enabled,
    queue,
    volume,
    setEnabled,
    setVolume,
    addTracks,
    addTrackFromUrl,
    addPlaylistFromUrl,
    removeTrack,
    moveTrack,
    clearQueue,
    previewTrack,
    stopPreview,
  } = useGameplayMoaning();
  const [isAddingTracks, setIsAddingTracks] = useState(false);
  const [showUrlInput, setShowUrlInput] = useState(false);
  const [urlInput, setUrlInput] = useState("");
  const [isAddingFromUrl, setIsAddingFromUrl] = useState(false);
  const [urlError, setUrlError] = useState<string | null>(null);
  const [urlMode, setUrlMode] = useState<"track" | "playlist">("track");
  const [urlResult, setUrlResult] = useState<{ added: number; errors: number } | null>(null);
  const [isClearConfirmOpen, setIsClearConfirmOpen] = useState(false);
  const [volumeDraft, setVolumeDraft] = useState(() => Math.round(DEFAULT_MOANING_VOLUME * 100));

  useEffect(() => {
    setVolumeDraft(Math.round(volume * 100));
  }, [volume]);

  const commitVolumeDraft = async () => {
    await setVolume(volumeDraft / 100);
  };

  const addSelectedTracks = async () => {
    if (isAddingTracks) return;
    setIsAddingTracks(true);
    try {
      const filePaths = await window.electronAPI.dialog.selectMoaningFiles();
      if (filePaths.length === 0) return;
      await addTracks(filePaths);
    } catch (error) {
      console.error("Failed to add moaning tracks", error);
    } finally {
      setIsAddingTracks(false);
    }
  };

  const handleAddFromUrl = async () => {
    if (isAddingFromUrl) return;
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
    setIsAddingFromUrl(true);
    setUrlResult(null);
    try {
      if (urlMode === "playlist") {
        const result = await addPlaylistFromUrl(trimmed);
        setUrlResult({ added: result.addedCount, errors: result.errorCount });
        if (result.addedCount > 0) {
          setUrlInput("");
          setShowUrlInput(false);
        }
      } else {
        await addTrackFromUrl(trimmed);
        setUrlInput("");
        setShowUrlInput(false);
      }
    } catch (error) {
      setUrlError(error instanceof Error ? error.message : t`Failed to add from URL`);
    } finally {
      setIsAddingFromUrl(false);
    }
  };

  const handleRequestClearQueue = () => {
    if (queue.length === 0) return;
    playSelectSound();
    setIsClearConfirmOpen(true);
  };

  const handleConfirmClearQueue = () => {
    playSelectSound();
    setIsClearConfirmOpen(false);
    void clearQueue();
  };

  const handleCancelClearQueue = () => {
    playSelectSound();
    setIsClearConfirmOpen(false);
  };

  return (
    <>
      <section
        className="animate-entrance rounded-3xl border border-rose-400/25 bg-zinc-950/55 p-5 backdrop-blur-xl"
        style={{ animationDelay: "0.1s" }}
      >
        <div className="mb-4">
          <h2 className="text-lg font-extrabold tracking-tight text-rose-100">
            <Trans>Moaning</Trans>
          </h2>
          <p className="mt-1 text-sm text-zinc-300">
            <Trans>
              Manage the gameplay moaning library used by perks and anti-perks. Add local audio
              files or download them from supported URLs via yt-dlp.
            </Trans>
          </p>
        </div>

        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-4 border-b border-rose-300/15 pb-4">
            <div className="flex items-center gap-4">
              <button
                type="button"
                aria-label={t`Toggle Enable Moaning`}
                role="switch"
                aria-checked={enabled}
                onMouseEnter={playHoverSound}
                onClick={() => {
                  playSelectSound();
                  void setEnabled(!enabled);
                }}
                className={`relative h-7 w-14 shrink-0 overflow-hidden rounded-full border transition-all duration-200 ${enabled ? "border-rose-300/80 bg-rose-500/50 shadow-[0_0_20px_rgba(251,113,133,0.35)]" : "border-zinc-600 bg-zinc-800"}`}
              >
                <span
                  className={`absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow-md transition-transform duration-200 ${enabled ? "translate-x-7" : "translate-x-0"}`}
                />
              </button>
              <span
                className={`text-sm font-medium ${enabled ? "text-zinc-100" : "text-zinc-400"}`}
              >
                {enabled ? t`Moaning Enabled` : t`Moaning Disabled`}
              </span>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <span className="text-zinc-400">
                <Trans>Volume:</Trans>
              </span>
              <input
                aria-label={t`Moaning volume`}
                type="range"
                min={0}
                max={100}
                step={1}
                value={volumeDraft}
                onChange={(event) => setVolumeDraft(Number(event.target.value))}
                onMouseUp={() => void commitVolumeDraft()}
                onTouchEnd={() => void commitVolumeDraft()}
                className="h-1.5 w-20 cursor-pointer appearance-none rounded-lg bg-zinc-800 accent-rose-400"
              />
              <span className="w-8 text-zinc-300">{volumeDraft}%</span>
            </label>
          </div>

          <div className="border-t border-rose-300/15 pt-4">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
              <span className="text-sm font-semibold text-zinc-100">
                {t`Library (${queue.length} files)`}
              </span>
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={queue.length === 0}
                  onMouseEnter={playHoverSound}
                  onClick={() => {
                    playSelectSound();
                    void previewTrack(queue[0]!.id);
                  }}
                  className={`rounded-lg border px-3 py-1.5 text-xs font-semibold transition-all duration-200 ${
                    queue.length === 0
                      ? "cursor-not-allowed border-zinc-600 bg-zinc-800 text-zinc-500"
                      : "border-cyan-300/60 bg-cyan-500/20 text-cyan-100 hover:border-cyan-200/80 hover:bg-cyan-500/35"
                  }`}
                >
                  <Trans>Preview</Trans>
                </button>
                <button
                  type="button"
                  onMouseEnter={playHoverSound}
                  onClick={() => {
                    playSelectSound();
                    stopPreview();
                  }}
                  className="rounded-lg border border-zinc-500 bg-zinc-800 px-3 py-1.5 text-xs font-semibold text-zinc-100 transition-all duration-200 hover:border-zinc-300"
                >
                  <Trans>Stop</Trans>
                </button>
                <button
                  type="button"
                  disabled={isAddingTracks}
                  onMouseEnter={playHoverSound}
                  onClick={() => {
                    playSelectSound();
                    void addSelectedTracks();
                  }}
                  className={`rounded-lg border px-3 py-1.5 text-xs font-semibold transition-all duration-200 ${
                    isAddingTracks
                      ? "cursor-not-allowed border-zinc-600 bg-zinc-800 text-zinc-500"
                      : "border-rose-300/60 bg-rose-500/25 text-rose-100 hover:border-rose-200/80 hover:bg-rose-500/40"
                  }`}
                >
                  {isAddingTracks ? t`Adding...` : t`Add Files`}
                </button>
                <button
                  type="button"
                  onMouseEnter={playHoverSound}
                  onClick={() => {
                    playSelectSound();
                    setShowUrlInput((current) => !current);
                    setUrlError(null);
                  }}
                  className={`rounded-lg border px-3 py-1.5 text-xs font-semibold transition-all duration-200 ${
                    showUrlInput
                      ? "border-cyan-300/60 bg-cyan-500/30 text-cyan-100"
                      : "border-rose-300/60 bg-rose-500/25 text-rose-100 hover:border-rose-200/80 hover:bg-rose-500/40"
                  }`}
                >
                  {showUrlInput ? t`Cancel` : t`Add from URL`}
                </button>
                <button
                  type="button"
                  disabled={queue.length === 0}
                  onMouseEnter={playHoverSound}
                  onClick={handleRequestClearQueue}
                  className={`rounded-lg border px-3 py-1.5 text-xs font-semibold transition-all duration-200 ${
                    queue.length === 0
                      ? "cursor-not-allowed border-zinc-600 bg-zinc-800 text-zinc-500"
                      : "border-zinc-500 bg-zinc-800 text-zinc-100 hover:border-zinc-300"
                  }`}
                >
                  <Trans>Clear</Trans>
                </button>
              </div>
            </div>

            {showUrlInput && (
              <div className="mb-3 space-y-2 rounded-lg border border-rose-300/15 bg-black/20 p-3">
                <p className="text-xs text-zinc-400">
                  <Trans>Add from any yt-dlp-supported URL (downloaded as MP3 via yt-dlp)</Trans>
                </p>
                <div className="flex gap-1.5">
                  <button
                    type="button"
                    onMouseEnter={playHoverSound}
                    onClick={() => {
                      playSelectSound();
                      setUrlMode("track");
                      setUrlResult(null);
                    }}
                    className={`rounded-lg border px-2 py-1 text-[10px] font-bold uppercase tracking-wide transition ${
                      urlMode === "track"
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
                      setUrlMode("playlist");
                      setUrlResult(null);
                    }}
                    className={`rounded-lg border px-2 py-1 text-[10px] font-bold uppercase tracking-wide transition ${
                      urlMode === "playlist"
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
                      urlMode === "playlist"
                        ? t`https://example.com/playlist-or-collection`
                        : t`https://example.com/video-or-audio`
                    }
                    value={urlInput}
                    onChange={(e) => {
                      setUrlInput(e.target.value);
                      setUrlError(null);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        void handleAddFromUrl();
                      }
                    }}
                    disabled={isAddingFromUrl}
                    className={`flex-1 rounded-lg border bg-white/5 px-3 py-1.5 text-xs text-white placeholder-zinc-500 outline-none transition ${
                      urlError
                        ? "border-rose-400/40 focus:border-rose-400/60"
                        : "border-rose-300/30 focus:border-cyan-400/60"
                    }`}
                  />
                  <button
                    type="button"
                    onMouseEnter={playHoverSound}
                    onClick={() => void handleAddFromUrl()}
                    disabled={isAddingFromUrl}
                    className={`rounded-lg border px-3 py-1.5 text-xs font-semibold transition-all duration-200 ${
                      isAddingFromUrl
                        ? "cursor-not-allowed border-zinc-600 bg-zinc-800 text-zinc-500"
                        : "border-cyan-300/60 bg-cyan-500/30 text-cyan-100 hover:border-cyan-200/80 hover:bg-cyan-500/45"
                    }`}
                  >
                    {isAddingFromUrl ? t`Downloading...` : t`Add`}
                  </button>
                </div>
                {urlResult && (
                  <p className="text-xs text-emerald-300">
                    {urlResult.errors > 0
                      ? t`Added ${urlResult.added} file${urlResult.added !== 1 ? "s" : ""} (${urlResult.errors} failed)`
                      : t`Added ${urlResult.added} file${urlResult.added !== 1 ? "s" : ""}`}
                  </p>
                )}
                {urlError && <p className="text-xs text-rose-300">{urlError}</p>}
              </div>
            )}

            <div className="divide-y divide-rose-300/10">
              {queue.length === 0 ? (
                <div className="py-3 text-sm text-zinc-400">
                  <Trans>No moaning files configured.</Trans>
                </div>
              ) : (
                queue.map((entry, index) => (
                  <div
                    key={entry.id}
                    className="flex flex-wrap items-center justify-between gap-2 py-2"
                  >
                    <span className="min-w-0 flex-1 truncate text-sm text-zinc-200">
                      {entry.name}
                    </span>
                    <div className="flex gap-1">
                      <button
                        type="button"
                        onClick={() => {
                          playSelectSound();
                          void previewTrack(entry.id);
                        }}
                        className="rounded px-2 py-0.5 text-xs text-cyan-300 hover:text-cyan-200"
                      >
                        ▶
                      </button>
                      <button
                        type="button"
                        disabled={index === 0}
                        onClick={() => {
                          playSelectSound();
                          void moveTrack(entry.id, "up");
                        }}
                        className="rounded px-2 py-0.5 text-xs text-zinc-400 hover:text-zinc-200 disabled:opacity-40"
                      >
                        ↑
                      </button>
                      <button
                        type="button"
                        disabled={index === queue.length - 1}
                        onClick={() => {
                          playSelectSound();
                          void moveTrack(entry.id, "down");
                        }}
                        className="rounded px-2 py-0.5 text-xs text-zinc-400 hover:text-zinc-200 disabled:opacity-40"
                      >
                        ↓
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          playSelectSound();
                          void removeTrack(entry.id);
                        }}
                        className="rounded px-2 py-0.5 text-xs text-rose-300 hover:text-rose-200"
                      >
                        ✕
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </section>
      <ConfirmDialog
        isOpen={isClearConfirmOpen}
        title={t`Clear moaning playlist?`}
        message={t`This will remove every file from the current moaning playlist.`}
        confirmLabel={t`Clear Playlist`}
        cancelLabel={t`Keep Playlist`}
        variant="warning"
        onConfirm={handleConfirmClearQueue}
        onCancel={handleCancelClearQueue}
      />
    </>
  );
}

function DangerZoneCard({
  error,
  isPending,
  onOpenConfirm,
}: {
  error: string | null;
  isPending: boolean;
  onOpenConfirm: () => void;
}) {
  const { t } = useLingui();

  return (
    <section
      className="animate-entrance rounded-3xl border border-rose-400/30 bg-rose-950/20 p-5 backdrop-blur-xl"
      style={{ animationDelay: "0.12s" }}
    >
      <div className="mb-4">
        <h2 className="text-lg font-extrabold tracking-tight text-rose-100">
          <Trans>Danger Zone</Trans>
        </h2>
        <p className="mt-1 text-sm text-rose-100/80">
          <Trans>Permanently remove saved data, such as rounds, playlists, or settings.</Trans>
        </p>
      </div>

      {error ? (
        <div className="mb-4 rounded-xl border border-rose-300/35 bg-black/35 p-3 text-sm text-rose-100">
          {error}
        </div>
      ) : null}

      <button
        type="button"
        disabled={isPending}
        onMouseEnter={playHoverSound}
        onClick={onOpenConfirm}
        className={`rounded-xl border px-4 py-2 text-sm font-semibold transition-all duration-200 ${
          isPending
            ? "cursor-not-allowed border-zinc-600 bg-zinc-800 text-zinc-500"
            : "border-rose-300/70 bg-rose-500/25 text-rose-100 hover:border-rose-200/90 hover:bg-rose-500/40"
        }`}
      >
        {isPending ? t`Clearing...` : t`Manage & Clear Data`}
      </button>
    </section>
  );
}

function CheatModeConfirmDialog({
  isOpen,
  onCancel,
  onConfirm,
}: {
  isOpen: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/70 px-4 backdrop-blur-sm">
      <div className="w-full max-w-lg rounded-3xl border border-amber-300/35 bg-zinc-950/95 p-6 shadow-[0_0_60px_rgba(251,191,36,0.28)]">
        <p className="font-[family-name:var(--font-jetbrains-mono)] text-xs uppercase tracking-[0.35em] text-amber-200/80">
          <Trans>Experimental Feature</Trans>
        </p>
        <h2 className="mt-3 text-2xl font-black tracking-tight text-amber-50">
          <Trans>Enable Cheat Mode?</Trans>
        </h2>
        <p className="mt-2 text-sm text-zinc-400">
          <Trans>
            This will enable developer menu features in singleplayer sessions, giving you access to
            debug controls, shortcuts, and a hidden temporary progression profile.
          </Trans>
        </p>

        <div className="mt-5 rounded-2xl border border-amber-300/25 bg-amber-500/10 p-4">
          <p className="text-sm font-semibold text-amber-100">
            <Trans>Important consequences:</Trans>
          </p>
          <ul className="mt-2 space-y-1 text-sm text-amber-200/90">
            <li>
              <Trans>Any highscore you achieve will be permanently marked with 🎭</Trans>
            </li>
            <li>
              <Trans>Your level will not progress while cheat mode is active</Trans>
            </li>
            <li>
              <Trans>Cheat mode has no effect in multiplayer</Trans>
            </li>
            <li>
              <Trans>
                Temporary progression is clearly marked and removed when Cheat Mode is disabled
              </Trans>
            </li>
            <li>
              <Trans>The mark on your highscores cannot be removed later</Trans>
            </li>
          </ul>
        </div>

        <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button
            type="button"
            onMouseEnter={playHoverSound}
            onClick={onCancel}
            className="rounded-xl border border-zinc-600 bg-zinc-900/80 px-4 py-2 text-sm font-semibold text-zinc-200 transition-all duration-200 hover:border-zinc-400 hover:text-zinc-100"
          >
            <Trans>Cancel</Trans>
          </button>
          <button
            type="button"
            onMouseEnter={playHoverSound}
            onClick={onConfirm}
            className="rounded-xl border border-amber-300/70 bg-amber-500/25 px-4 py-2 text-sm font-semibold text-amber-100 transition-all duration-200 hover:border-amber-200/90 hover:bg-amber-500/40"
          >
            <Trans>I Understand, Enable</Trans>
          </button>
        </div>
      </div>
    </div>
  );
}

function SkipRoundsCheckConfirmDialog({
  isOpen,
  onCancel,
  onConfirm,
}: {
  isOpen: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/70 px-4 backdrop-blur-sm">
      <div className="w-full max-w-lg rounded-3xl border border-amber-300/35 bg-zinc-950/95 p-6 shadow-[0_0_60px_rgba(251,191,36,0.28)]">
        <p className="font-[family-name:var(--font-jetbrains-mono)] text-xs uppercase tracking-[0.35em] text-amber-200/80">
          <Trans>Experimental Feature</Trans>
        </p>
        <h2 className="mt-3 text-2xl font-black tracking-tight text-amber-50">
          <Trans>Skip Multiplayer Safeguards?</Trans>
        </h2>
        <p className="mt-2 text-sm text-zinc-400">
          <Trans>
            This will allow you to access multiplayer regardless of the general minimum round count
            and any playlist-specific round requirement.
          </Trans>
        </p>

        <div className="mt-5 rounded-2xl border border-amber-300/25 bg-amber-500/10 p-4">
          <p className="text-sm font-semibold text-amber-100">
            <Trans>These safeguards are not here to annoy you:</Trans>
          </p>
          <ul className="mt-2 space-y-1 text-sm text-amber-200/90">
            <li>
              <Trans>
                The global multiplayer minimum helps ensure everyone starts from a baseline good
                experience
              </Trans>
            </li>
            <li>
              <Trans>
                Large playlists can still require more installed rounds than the global minimum
              </Trans>
            </li>
            <li>
              <Trans>You may encounter empty rounds, repeated content, or broken match flows</Trans>
            </li>
            <li>
              <Trans>
                Disabling both checks may result in a bad user experience for you and other players
              </Trans>
            </li>
          </ul>
        </div>

        <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button
            type="button"
            onMouseEnter={playHoverSound}
            onClick={onCancel}
            className="rounded-xl border border-zinc-600 bg-zinc-900/80 px-4 py-2 text-sm font-semibold text-zinc-200 transition-all duration-200 hover:border-zinc-400 hover:text-zinc-100"
          >
            <Trans>Cancel</Trans>
          </button>
          <button
            type="button"
            onMouseEnter={playHoverSound}
            onClick={onConfirm}
            className="rounded-xl border border-amber-300/70 bg-amber-500/25 px-4 py-2 text-sm font-semibold text-amber-100 transition-all duration-200 hover:border-amber-200/90 hover:bg-amber-500/40"
          >
            <Trans>I Understand, Disable Safeguards</Trans>
          </button>
        </div>
      </div>
    </div>
  );
}

function AutoScanFoldersCard({
  folders,
  notices,
  isLoading,
  isPending,
  onAddFolders,
  onRemoveFolder,
}: {
  folders: string[];
  notices: FolderImportNotice[];
  isLoading: boolean;
  isPending: boolean;
  onAddFolders: () => void;
  onRemoveFolder: (folderPath: string) => void;
}) {
  const { t } = useLingui();
  return (
    <section
      className="animate-entrance rounded-3xl border border-purple-400/25 bg-zinc-950/55 p-5 backdrop-blur-xl"
      style={{ animationDelay: "0.11s" }}
    >
      <div className="mb-4">
        <h2 className="text-lg font-extrabold tracking-tight text-violet-100">
          <Trans>Library</Trans>
        </h2>
        <p className="mt-1 text-sm text-zinc-300">
          <Trans>
            Added folders import immediately, including legacy video-folder fallback, and are
            rescanned on startup.
          </Trans>
        </p>
      </div>

      {notices.length > 0 ? (
        <div className="mb-4 space-y-2">
          {notices.map((notice) => (
            <div
              key={`${notice.folderPath}:${notice.message}`}
              className={`rounded-xl border px-3 py-2 text-xs ${
                notice.tone === "error"
                  ? "border-rose-300/35 bg-rose-500/10 text-rose-100"
                  : "border-emerald-300/35 bg-emerald-500/10 text-emerald-100"
              }`}
            >
              <div className="truncate font-semibold">{notice.folderPath}</div>
              <div className="mt-1 text-zinc-200">{notice.message}</div>
            </div>
          ))}
        </div>
      ) : null}

      <div className="space-y-2">
        {isLoading ? (
          <div className="rounded-xl border border-zinc-700 bg-black/30 px-3 py-2 text-sm text-zinc-400">
            <Trans>Loading folders...</Trans>
          </div>
        ) : folders.length === 0 ? (
          <div className="rounded-xl border border-zinc-700 bg-black/30 px-3 py-2 text-sm text-zinc-400">
            <Trans>No auto-scan folders configured.</Trans>
          </div>
        ) : (
          folders.map((folderPath) => (
            <div
              key={folderPath}
              className="flex items-center justify-between gap-3 rounded-xl border border-violet-300/25 bg-black/35 px-3 py-2"
            >
              <div className="min-w-0 text-xs text-zinc-200 truncate">{folderPath}</div>
              <button
                type="button"
                disabled={isPending}
                onClick={() => onRemoveFolder(folderPath)}
                className={`rounded-lg border px-3 py-1 text-xs font-semibold uppercase tracking-[0.12em] ${
                  isPending
                    ? "cursor-not-allowed border-zinc-600 bg-zinc-800 text-zinc-500"
                    : "border-rose-300/60 bg-rose-500/20 text-rose-100 hover:bg-rose-500/35"
                }`}
              >
                <Trans>Remove</Trans>
              </button>
            </div>
          ))
        )}
      </div>

      <button
        type="button"
        onMouseEnter={playHoverSound}
        disabled={isPending}
        onClick={onAddFolders}
        className={`mt-4 rounded-xl border px-4 py-2 text-sm font-semibold transition-all duration-200 ${
          isPending
            ? "cursor-not-allowed border-zinc-600 bg-zinc-800 text-zinc-500"
            : "border-violet-300/60 bg-violet-500/30 text-violet-100 hover:border-violet-200/80 hover:bg-violet-500/45"
        }`}
      >
        {isPending ? t`Updating...` : t`Add Folder`}
      </button>
    </section>
  );
}

type SourceDraft = {
  name: string;
  baseUrl: string;
  authMode: "none" | "apiKey" | "login";
  apiKey: string;
  username: string;
  password: string;
  enabled: boolean;
  tagSelections: Array<{
    id: string;
    name: string;
    roundTypeFallback: "Normal" | "Interjection" | "Cum";
  }>;
};

function toSourceDraft(source: ExternalSource): SourceDraft {
  return {
    name: source.name,
    baseUrl: source.baseUrl,
    authMode: source.authMode,
    apiKey: source.apiKey ?? "",
    username: source.username ?? "",
    password: source.password ?? "",
    enabled: source.enabled,
    tagSelections: source.tagSelections.map((entry) => ({
      id: entry.id,
      name: entry.name,
      roundTypeFallback: entry.roundTypeFallback,
    })),
  };
}

function getSelectableAuthModeValue(
  authMode: SourceDraft["authMode"]
): "none" | "apiKey" | typeof LEGACY_LOGIN_AUTH_VALUE {
  return authMode === "login" ? LEGACY_LOGIN_AUTH_VALUE : authMode;
}

function SourceIntegrationsCard() {
  const { t } = useLingui();
  const sfwMode = useSfwMode();
  const [sources, setSources] = useState<ExternalSource[]>([]);
  const [drafts, setDrafts] = useState<Record<string, SourceDraft>>({});
  const [syncStatus, setSyncStatus] = useState<IntegrationSyncStatus | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSyncing, setIsSyncing] = useState(false);
  const [pendingSourceId, setPendingSourceId] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [tagSearchQueryBySource, setTagSearchQueryBySource] = useState<Record<string, string>>({});
  const [tagSearchResultsBySource, setTagSearchResultsBySource] = useState<
    Record<string, StashTagResult["tags"]>
  >({});
  const [tagSearchPendingBySource, setTagSearchPendingBySource] = useState<Record<string, boolean>>(
    {}
  );
  const [newSourceDraft, setNewSourceDraft] = useState<SourceDraft>({
    name: "",
    baseUrl: "",
    authMode: "none",
    apiKey: "",
    username: "",
    password: "",
    enabled: true,
    tagSelections: [],
  });

  const refresh = async () => {
    const [nextSources, nextSyncStatus] = await Promise.all([
      integrations.listSources(),
      integrations.getSyncStatus(),
    ]);
    setSources(nextSources);
    setSyncStatus(nextSyncStatus);
    setDrafts(
      nextSources.reduce<Record<string, SourceDraft>>((acc, source) => {
        acc[source.id] = toSourceDraft(source);
        return acc;
      }, {})
    );
  };

  useEffect(() => {
    let mounted = true;

    const load = async () => {
      try {
        await refresh();
      } catch (error) {
        if (mounted) {
          setStatusMessage(error instanceof Error ? error.message : "Failed to load sources.");
        }
      } finally {
        if (mounted) {
          setIsLoading(false);
        }
      }
    };

    void load();
    const interval = window.setInterval(() => {
      if (document.hidden) return;
      void integrations
        .getSyncStatus()
        .then((status) => {
          if (mounted) setSyncStatus(status);
        })
        .catch(() => {
          // Ignore polling errors.
        });
    }, 3000);

    return () => {
      mounted = false;
      window.clearInterval(interval);
    };
  }, []);

  const syncNow = async () => {
    if (isSyncing) return;
    setIsSyncing(true);
    setStatusMessage(null);
    try {
      const status = await integrations.syncNow();
      setSyncStatus(status);
      await refresh();
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : t`Failed to sync sources.`);
    } finally {
      setIsSyncing(false);
    }
  };

  const createSource = async () => {
    setStatusMessage(null);
    try {
      await integrations.createStashSource({
        name: newSourceDraft.name,
        baseUrl: newSourceDraft.baseUrl,
        authMode: newSourceDraft.authMode,
        apiKey: newSourceDraft.apiKey || null,
        username: newSourceDraft.username || null,
        password: newSourceDraft.password || null,
        enabled: newSourceDraft.enabled,
        tagSelections: newSourceDraft.tagSelections,
      });
      setNewSourceDraft({
        name: "",
        baseUrl: "",
        authMode: "none",
        apiKey: "",
        username: "",
        password: "",
        enabled: true,
        tagSelections: [],
      });
      await refresh();
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : t`Failed to create source.`);
    }
  };

  const saveSource = async (sourceId: string) => {
    const draft = drafts[sourceId];
    if (!draft) return;

    setPendingSourceId(sourceId);
    setStatusMessage(null);
    try {
      await integrations.updateStashSource({
        sourceId,
        name: draft.name,
        baseUrl: draft.baseUrl,
        authMode: draft.authMode,
        apiKey: draft.apiKey || null,
        username: draft.username || null,
        password: draft.password || null,
        enabled: draft.enabled,
        tagSelections: draft.tagSelections,
      });
      await refresh();
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : t`Failed to update source.`);
    } finally {
      setPendingSourceId(null);
    }
  };

  const deleteSource = async (sourceId: string) => {
    setPendingSourceId(sourceId);
    setStatusMessage(null);
    try {
      await integrations.deleteSource(sourceId);
      await refresh();
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : t`Failed to delete source.`);
    } finally {
      setPendingSourceId(null);
    }
  };

  const testConnection = async (sourceId: string) => {
    setPendingSourceId(sourceId);
    setStatusMessage(null);
    try {
      await integrations.testStashConnection(sourceId);
      setStatusMessage(t`Stash connection succeeded.`);
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : t`Stash connection failed.`);
    } finally {
      setPendingSourceId(null);
    }
  };

  const searchTags = async (sourceId: string) => {
    const query = (tagSearchQueryBySource[sourceId] ?? "").trim();
    setTagSearchPendingBySource((prev) => ({ ...prev, [sourceId]: true }));
    try {
      const result = await integrations.searchStashTags({ sourceId, query, page: 1, perPage: 24 });
      setTagSearchResultsBySource((prev) => ({ ...prev, [sourceId]: result.tags }));
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : t`Tag search failed.`);
    } finally {
      setTagSearchPendingBySource((prev) => ({ ...prev, [sourceId]: false }));
    }
  };

  const patchDraft = (sourceId: string, patch: Partial<SourceDraft>) => {
    setDrafts((prev) => {
      const existing = prev[sourceId];
      if (!existing) return prev;
      return { ...prev, [sourceId]: { ...existing, ...patch } };
    });
  };

  const addTagSelection = (sourceId: string, tag: { id: string; name: string }) => {
    const draft = drafts[sourceId];
    if (!draft) return;
    if (draft.tagSelections.some((entry) => entry.id === tag.id)) return;
    patchDraft(sourceId, {
      tagSelections: [
        ...draft.tagSelections,
        { id: tag.id, name: tag.name, roundTypeFallback: "Normal" },
      ],
    });
  };

  if (isLoading) {
    return (
      <section className="animate-entrance rounded-3xl border border-purple-400/25 bg-zinc-950/55 p-5 backdrop-blur-xl">
        <p className="text-sm text-zinc-300">
          <Trans>Loading external sources...</Trans>
        </p>
      </section>
    );
  }

  return (
    <section className="animate-entrance rounded-3xl border border-purple-400/25 bg-zinc-950/55 p-5 backdrop-blur-xl">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-extrabold tracking-tight text-violet-100">
            <Trans>Sources</Trans>
          </h2>
          <p className="mt-1 text-sm text-zinc-300">
            <Trans>Configure Stash instances, tags, and run sync.</Trans>
          </p>
        </div>
        <button
          type="button"
          onMouseEnter={playHoverSound}
          disabled={isSyncing}
          onClick={() => {
            playSelectSound();
            void syncNow();
          }}
          className={`rounded-xl border px-4 py-2 text-sm font-semibold transition-all duration-200 ${
            isSyncing
              ? "cursor-not-allowed border-zinc-600 bg-zinc-800 text-zinc-500"
              : "border-violet-300/60 bg-violet-500/30 text-violet-100 hover:border-violet-200/80 hover:bg-violet-500/45"
          }`}
        >
          {isSyncing ? t`Syncing...` : t`Sync Now`}
        </button>
      </div>

      {syncStatus && (
        <div className="mb-4 rounded-xl border border-violet-300/25 bg-black/35 p-3 text-xs text-zinc-300">
          <div>
            <Trans>State:</Trans> {syncStatus.state}
          </div>
          <div>
            <Trans>Sources:</Trans> {syncStatus.stats.sourcesSynced}/{syncStatus.stats.sourcesSeen}
          </div>
          <div>
            <Trans>Scenes:</Trans> {syncStatus.stats.scenesSeen}
          </div>
          <div>
            <Trans>Created/Updated/Linked:</Trans> {syncStatus.stats.roundsCreated}/
            {syncStatus.stats.roundsUpdated}/{syncStatus.stats.roundsLinked}
          </div>
          <div>
            <Trans>Resources Added:</Trans> {syncStatus.stats.resourcesAdded}
          </div>
        </div>
      )}

      {statusMessage && (
        <div className="mb-4 rounded-xl border border-zinc-600 bg-black/40 p-3 text-xs text-zinc-200">
          {statusMessage}
        </div>
      )}

      <div className="mb-6 rounded-2xl border border-violet-300/25 bg-black/35 p-4">
        <p className="mb-3 text-sm font-semibold text-zinc-100">
          <Trans>Add Stash Source</Trans>
        </p>
        <div className="mb-3 rounded-xl border border-amber-300/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-100">
          <Trans>
            Only the newest Stash release, currently version {ACTIVE_STASH_VERSION}, is actively
            supported.
          </Trans>
        </div>
        <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
          <input
            className="rounded-xl border border-violet-300/30 bg-black/45 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-violet-300/75"
            placeholder={t`Source name`}
            value={newSourceDraft.name}
            onChange={(event) =>
              setNewSourceDraft((prev) => ({ ...prev, name: event.target.value }))
            }
          />
          <input
            className="rounded-xl border border-violet-300/30 bg-black/45 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-violet-300/75"
            placeholder={t`https://stash.example.com`}
            value={newSourceDraft.baseUrl}
            onChange={(event) =>
              setNewSourceDraft((prev) => ({ ...prev, baseUrl: event.target.value }))
            }
          />
          <GameDropdown
            value={newSourceDraft.authMode}
            options={[
              { value: "none", label: t`No Auth` },
              { value: "apiKey", label: t`API Key` },
            ]}
            onChange={(value) =>
              setNewSourceDraft((prev) => ({
                ...prev,
                authMode: value as "none" | "apiKey",
              }))
            }
          />
          {newSourceDraft.authMode === "apiKey" ? (
            <input
              className="rounded-xl border border-violet-300/30 bg-black/45 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-violet-300/75"
              placeholder={t`API key`}
              value={newSourceDraft.apiKey}
              onChange={(event) =>
                setNewSourceDraft((prev) => ({ ...prev, apiKey: event.target.value }))
              }
            />
          ) : (
            <div className="rounded-xl border border-dashed border-violet-300/25 bg-black/20 px-3 py-2 text-sm text-zinc-400">
              <Trans>This Stash source will connect without API keys.</Trans>
            </div>
          )}
        </div>
        <button
          type="button"
          onMouseEnter={playHoverSound}
          onClick={() => {
            playSelectSound();
            void createSource();
          }}
          className="mt-3 rounded-xl border border-violet-300/60 bg-violet-500/30 px-4 py-2 text-sm font-semibold text-violet-100 hover:border-violet-200/80 hover:bg-violet-500/45"
        >
          <Trans>Add Source</Trans>
        </button>
      </div>

      <div className="space-y-4">
        {sources.length === 0 ? (
          <div className="rounded-xl border border-zinc-700 bg-black/30 px-3 py-2 text-sm text-zinc-400">
            <Trans>No sources configured yet.</Trans>
          </div>
        ) : (
          sources.map((source) => {
            const draft = drafts[source.id];
            if (!draft) return null;

            return (
              <div
                key={source.id}
                className="rounded-2xl border border-violet-300/25 bg-black/35 p-4"
              >
                <div className="mb-3 grid grid-cols-1 gap-2 md:grid-cols-2">
                  <input
                    className="rounded-xl border border-violet-300/30 bg-black/45 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-violet-300/75"
                    value={draft.name}
                    onChange={(event) => patchDraft(source.id, { name: event.target.value })}
                  />
                  <input
                    className="rounded-xl border border-violet-300/30 bg-black/45 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-violet-300/75"
                    value={draft.baseUrl}
                    onChange={(event) => patchDraft(source.id, { baseUrl: event.target.value })}
                  />
                </div>
                <div className="mb-3 grid grid-cols-1 gap-2 md:grid-cols-2">
                  <GameDropdown
                    value={getSelectableAuthModeValue(draft.authMode) as string}
                    options={[
                      { value: "none", label: t`No Auth` },
                      { value: "apiKey", label: t`API Key` },
                      ...(draft.authMode === "login"
                        ? [
                            {
                              value: LEGACY_LOGIN_AUTH_VALUE,
                              label: t`Legacy Login`,
                              disabled: true as const,
                            },
                          ]
                        : []),
                    ]}
                    onChange={(value) =>
                      patchDraft(source.id, { authMode: value as "none" | "apiKey" })
                    }
                  />
                  {draft.authMode === "apiKey" ? (
                    <input
                      className="rounded-xl border border-violet-300/30 bg-black/45 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-violet-300/75"
                      placeholder={t`API key`}
                      value={draft.apiKey}
                      onChange={(event) => patchDraft(source.id, { apiKey: event.target.value })}
                    />
                  ) : draft.authMode === "login" ? (
                    <div className="rounded-xl border border-amber-300/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-100">
                      <Trans>
                        Legacy username/password login is no longer offered for Stash sources.
                        Switch this source to No Auth or API Key.
                      </Trans>
                    </div>
                  ) : (
                    <div className="rounded-xl border border-dashed border-violet-300/25 bg-black/20 px-3 py-2 text-sm text-zinc-400">
                      <Trans>No credentials required for this Stash instance.</Trans>
                    </div>
                  )}
                </div>

                <div className="mb-3">
                  <div className="mb-2 text-xs uppercase tracking-[0.2em] text-zinc-400">
                    <Trans>Tags</Trans>
                  </div>
                  <div className="mb-2 flex gap-2">
                    <input
                      className="w-full rounded-xl border border-violet-300/30 bg-black/45 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-violet-300/75"
                      placeholder={t`Search tags`}
                      value={tagSearchQueryBySource[source.id] ?? ""}
                      onChange={(event) =>
                        setTagSearchQueryBySource((prev) => ({
                          ...prev,
                          [source.id]: event.target.value,
                        }))
                      }
                      onKeyDown={(event) => {
                        if (event.key !== "Enter") return;
                        event.preventDefault();
                        void searchTags(source.id);
                      }}
                    />
                    <button
                      type="button"
                      onClick={() => void searchTags(source.id)}
                      disabled={Boolean(tagSearchPendingBySource[source.id])}
                      className="rounded-xl border border-violet-300/60 bg-violet-500/25 px-3 py-2 text-xs font-semibold text-violet-100 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <Trans>Search</Trans>
                    </button>
                  </div>
                  <div className="max-h-28 space-y-1 overflow-y-auto">
                    {(tagSearchResultsBySource[source.id] ?? []).map((tag) => (
                      <button
                        key={tag.id}
                        type="button"
                        onClick={() => addTagSelection(source.id, tag)}
                        className="block w-full rounded-lg border border-zinc-700 bg-black/30 px-2 py-1 text-left text-xs text-zinc-200 hover:border-violet-300/60"
                      >
                        + {tag.name}
                      </button>
                    ))}
                  </div>

                  <div className="mt-3 space-y-2">
                    {draft.tagSelections.map((entry) => (
                      <div
                        key={entry.id}
                        className="flex items-center gap-2 rounded-lg border border-zinc-700 bg-black/30 px-2 py-2"
                      >
                        <div className="min-w-0 flex-1 truncate text-xs text-zinc-200">
                          {entry.name}
                        </div>
                        <GameDropdown
                          value={entry.roundTypeFallback}
                          options={[
                            { value: "Normal", label: t`Normal` },
                            { value: "Interjection", label: t`Interjection` },
                            { value: "Cum", label: abbreviateNsfwText(t`Cum`, sfwMode) },
                          ]}
                          onChange={(value) =>
                            patchDraft(source.id, {
                              tagSelections: draft.tagSelections.map((selection) =>
                                selection.id === entry.id
                                  ? {
                                      ...selection,
                                      roundTypeFallback: value as "Normal" | "Interjection" | "Cum",
                                    }
                                  : selection
                              ),
                            })
                          }
                          className="w-auto"
                        />
                        <button
                          type="button"
                          onClick={() =>
                            patchDraft(source.id, {
                              tagSelections: draft.tagSelections.filter(
                                (selection) => selection.id !== entry.id
                              ),
                            })
                          }
                          className="rounded border border-rose-400/60 bg-rose-500/20 px-2 py-1 text-xs text-rose-100"
                        >
                          <Trans>Remove</Trans>
                        </button>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={pendingSourceId === source.id}
                    onClick={() => void saveSource(source.id)}
                    className="rounded-xl border border-violet-300/60 bg-violet-500/30 px-3 py-2 text-xs font-semibold text-violet-100 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <Trans>Save</Trans>
                  </button>
                  <button
                    type="button"
                    disabled={pendingSourceId === source.id}
                    onClick={() => void testConnection(source.id)}
                    className="rounded-xl border border-cyan-300/60 bg-cyan-500/25 px-3 py-2 text-xs font-semibold text-cyan-100 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <Trans>Test</Trans>
                  </button>
                  <button
                    type="button"
                    disabled={pendingSourceId === source.id}
                    onClick={() =>
                      void integrations.setSourceEnabled(source.id, !source.enabled).then(refresh)
                    }
                    className="rounded-xl border border-zinc-500/60 bg-zinc-700/40 px-3 py-2 text-xs font-semibold text-zinc-100 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {source.enabled ? t`Disable` : t`Enable`}
                  </button>
                  <button
                    type="button"
                    disabled={pendingSourceId === source.id}
                    onClick={() => void deleteSource(source.id)}
                    className="rounded-xl border border-rose-300/60 bg-rose-500/25 px-3 py-2 text-xs font-semibold text-rose-100 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <Trans>Delete</Trans>
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>
    </section>
  );
}

function formatAcquisitionBytes(value: number | null | undefined): string {
  if (!value) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const index = Math.min(units.length - 1, Math.floor(Math.log(value) / Math.log(1024)));
  return `${(value / 1024 ** index).toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}

function parseAcquisitionJobPaths(value: string): string[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((entry): entry is string => typeof entry === "string")
      : [];
  } catch {
    return [];
  }
}

function AcquisitionSourcesCard() {
  const { t } = useLingui();
  const [settings, setSettings] = useState<AcquisitionSettings | null>(null);
  const [sources, setSources] = useState<AcquisitionSource[]>([]);
  const [jobs, setJobs] = useState<AcquisitionJob[]>([]);
  const [files, setFiles] = useState<AcquisitionFile[]>([]);
  const [selectedSourceId, setSelectedSourceId] = useState<string | null>(null);
  const [selectedPaths, setSelectedPaths] = useState<Set<string>>(new Set());
  const [sourceUri, setSourceUri] = useState("");
  const [fileFilter, setFileFilter] = useState("");
  const [addCompletedToLibrary, setAddCompletedToLibrary] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const [nextSettings, nextSources, nextJobs] = await Promise.all([
      acquisition.getSettings(),
      acquisition.listSources(),
      acquisition.listJobs(),
    ]);
    setSettings(nextSettings);
    setSources(nextSources);
    setJobs(nextJobs);
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial IPC hydration
    void refresh();
    const timer = window.setInterval(() => void acquisition.listJobs().then(setJobs), 1000);
    return () => window.clearInterval(timer);
  }, [refresh]);

  const loadFiles = async (sourceId: string) => {
    setSelectedSourceId(sourceId);
    setSelectedPaths(new Set());
    setFileFilter("");
    let nextFiles = await acquisition.listSourceFiles(sourceId);
    const source = sources.find((candidate) => candidate.id === sourceId);
    if (source && nextFiles.length === 0) {
      setBusy(true);
      setMessage(null);
      try {
        await acquisition.refreshSource(sourceId);
        nextFiles = await acquisition.listSourceFiles(sourceId);
        await refresh();
      } catch (error) {
        setMessage(error instanceof Error ? error.message : t`Failed to load source catalog.`);
      } finally {
        setBusy(false);
      }
    }
    setFiles(nextFiles);
    return nextFiles;
  };

  const enableTorrents = async (enabled: boolean) => {
    if (
      enabled &&
      !window.confirm(
        t`Torrent peers and trackers can observe your IP address. Use a trusted VPN if this exposure is a concern. Enable torrent support?`
      )
    )
      return;
    setSettings((current) => (current ? { ...current, torrentEnabled: enabled } : current));
    await acquisition.updateSettings({ torrentEnabled: enabled });
    await refresh();
  };

  const addUri = async () => {
    const uri = sourceUri.trim();
    if (!uri) return;
    setBusy(true);
    setMessage(null);
    try {
      let created: AcquisitionSource;
      if (/^https:\/\/(?:www\.)?mega\.(?:nz|co\.nz)\//iu.test(uri)) {
        created = await acquisition.createMegaSource(uri);
      } else {
        created = await acquisition.createTorrentSource(uri);
      }
      setSourceUri("");
      await refresh();
      const catalog = await loadFiles(created.id);
      if (created.kind === "torrent" && catalog.length === 0 && settings?.torrentEnabled) {
        await acquisition.refreshSource(created.id);
        await refresh();
        await loadFiles(created.id);
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : t`Failed to add source.`);
    } finally {
      setBusy(false);
    }
  };

  const openTorrent = async () => {
    const filePath = await window.electronAPI.dialog.selectTorrentFile?.();
    if (!filePath) return;
    setBusy(true);
    try {
      const inspected = await acquisition.inspectTorrentFile(filePath);
      await refresh();
      await loadFiles(inspected.source.id);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : t`Failed to open torrent file.`);
    } finally {
      setBusy(false);
    }
  };

  const queueSelected = async () => {
    if (!selectedSourceId || selectedPaths.size === 0) return;
    const selectedSource = sources.find((source) => source.id === selectedSourceId);
    if (selectedSource?.kind === "torrent" && !settings?.torrentEnabled) {
      const enabled = window.confirm(
        t`Torrent peers and trackers can observe your IP address. Use a trusted VPN if this exposure is a concern. Enable torrent support and continue?`
      );
      if (!enabled) return;
      await acquisition.updateSettings({ torrentEnabled: true });
    }
    setBusy(true);
    try {
      await acquisition.queueFiles(selectedSourceId, [...selectedPaths], addCompletedToLibrary);
      setSelectedPaths(new Set());
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : t`Failed to queue download.`);
    } finally {
      setBusy(false);
    }
  };

  const renameSource = async (source: AcquisitionSource) => {
    const name = window.prompt(t`Rename acquisition source`, source.name)?.trim();
    if (!name || name === source.name) return;
    await acquisition.updateSource({ sourceId: source.id, name });
    await refresh();
  };

  const deleteSource = async (source: AcquisitionSource) => {
    if (
      !window.confirm(
        t`Delete the acquisition source "${source.name}"? Downloaded files will be kept.`
      )
    )
      return;
    try {
      await acquisition.deleteSource(source.id);
    } catch (error) {
      const reason = error instanceof Error ? error.message : t`This source is still referenced.`;
      if (!window.confirm(`${reason}\n\n${t`Detach its round mappings and delete it?`}`)) return;
      await acquisition.deleteSource(source.id, true);
    }
    if (selectedSourceId === source.id) {
      setSelectedSourceId(null);
      setFiles([]);
    }
    await refresh();
  };

  const chooseDownloadRoot = async () => {
    const selected = await window.electronAPI.dialog.selectAcquisitionDownloadDirectory?.();
    if (!selected) return;
    await acquisition.updateSettings({ downloadRootPath: selected });
    await refresh();
  };

  return (
    <section className="animate-entrance rounded-3xl border border-cyan-400/25 bg-zinc-950/55 p-5 backdrop-blur-xl">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-extrabold tracking-tight text-cyan-100">
            <Trans>Torrent &amp; MEGA Acquisition</Trans>
          </h2>
          <p className="mt-1 text-sm text-zinc-300">
            <Trans>Configure public download sources and select individual video files.</Trans>
          </p>
        </div>
        <label className="flex items-center gap-2 text-sm text-zinc-200">
          <input
            type="checkbox"
            checked={settings?.torrentEnabled ?? false}
            onChange={(event) => void enableTorrents(event.target.checked)}
          />
          <Trans>Enable Torrent Support</Trans>
        </label>
      </div>

      <div className="mt-4 rounded-xl border border-amber-300/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-100">
        <Trans>
          Torrent traffic exposes your IP address to peers and trackers. Consider using a trusted
          VPN. Torrent support is disabled by default.
        </Trans>
      </div>

      <div className="mt-4 flex flex-col gap-2 sm:flex-row">
        <input
          className="min-w-0 flex-1 rounded-xl border border-cyan-300/30 bg-black/45 px-3 py-2 text-sm text-zinc-100"
          placeholder={t`Paste a magnet, public .torrent URL, or public MEGA link`}
          value={sourceUri}
          onChange={(event) => setSourceUri(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") void addUri();
          }}
        />
        <button
          type="button"
          disabled={busy}
          onClick={() => void addUri()}
          className="rounded-xl border border-cyan-300/60 bg-cyan-500/25 px-4 py-2 text-sm font-semibold text-cyan-100 disabled:opacity-50"
        >
          <Trans>Add Source</Trans>
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => void openTorrent()}
          className="rounded-xl border border-zinc-500/60 bg-zinc-700/40 px-4 py-2 text-sm font-semibold text-zinc-100 disabled:opacity-50"
        >
          <Trans>Open .torrent</Trans>
        </button>
      </div>

      {message ? (
        <div className="mt-3 rounded-xl border border-zinc-600 bg-black/40 p-3 text-sm text-zinc-200">
          {message}
        </div>
      ) : null}

      <div className="mt-5 grid gap-4 lg:grid-cols-[minmax(14rem,0.8fr)_minmax(20rem,1.2fr)]">
        <div className="space-y-2">
          <h3 className="text-xs font-bold uppercase tracking-[0.18em] text-zinc-400">
            <Trans>Sources</Trans>
          </h3>
          {sources.length === 0 ? (
            <p className="text-sm text-zinc-500">
              <Trans>No acquisition sources configured.</Trans>
            </p>
          ) : (
            sources.map((source) => (
              <div
                key={source.id}
                className={`rounded-xl border p-3 ${selectedSourceId === source.id ? "border-cyan-300/60 bg-cyan-500/10" : "border-zinc-700 bg-black/30"}`}
              >
                <button
                  type="button"
                  className="w-full text-left"
                  onClick={() => void loadFiles(source.id)}
                >
                  <div className="font-semibold text-zinc-100">{source.name}</div>
                  <div className="text-xs uppercase text-zinc-500">{source.kind}</div>
                </button>
                {source.catalogError ? (
                  <div className="mt-1 text-xs text-rose-300">{source.catalogError}</div>
                ) : null}
                <div className="mt-2 flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => {
                      setBusy(true);
                      setMessage(null);
                      void acquisition
                        .refreshSource(source.id)
                        .then(async () => {
                          await refresh();
                          if (selectedSourceId === source.id) await loadFiles(source.id);
                        })
                        .catch((error: unknown) =>
                          setMessage(error instanceof Error ? error.message : t`Refresh failed.`)
                        )
                        .finally(() => setBusy(false));
                    }}
                    className="text-xs text-cyan-200"
                  >
                    <Trans>Refresh</Trans>
                  </button>
                  <button
                    type="button"
                    onClick={() => void renameSource(source)}
                    className="text-xs text-zinc-300"
                  >
                    <Trans>Rename</Trans>
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      void acquisition
                        .updateSource({ sourceId: source.id, enabled: !source.enabled })
                        .then(refresh)
                    }
                    className="text-xs text-zinc-300"
                  >
                    {source.enabled ? t`Disable` : t`Enable`}
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      void deleteSource(source).catch((error: unknown) =>
                        setMessage(error instanceof Error ? error.message : t`Delete failed.`)
                      )
                    }
                    className="text-xs text-rose-300"
                  >
                    <Trans>Delete</Trans>
                  </button>
                </div>
              </div>
            ))
          )}
        </div>

        <div>
          <div className="mb-2 flex flex-wrap items-center justify-between gap-3">
            <h3 className="text-xs font-bold uppercase tracking-[0.18em] text-zinc-400">
              <Trans>Source Files</Trans>
            </h3>
            <input
              type="search"
              value={fileFilter}
              onChange={(event) => setFileFilter(event.target.value)}
              placeholder={t`Filter files`}
              className="min-w-40 flex-1 rounded-lg border border-zinc-700 bg-black/35 px-2 py-1.5 text-xs text-zinc-100"
            />
            <button
              type="button"
              disabled={busy || selectedPaths.size === 0}
              onClick={() => void queueSelected()}
              className="rounded-lg border border-cyan-300/60 bg-cyan-500/25 px-3 py-1.5 text-xs font-semibold text-cyan-100 disabled:opacity-40"
            >
              <Trans>Download Selected</Trans> ({selectedPaths.size})
            </button>
          </div>
          <label className="mb-2 flex items-center gap-2 text-xs text-zinc-300">
            <input
              type="checkbox"
              checked={addCompletedToLibrary}
              onChange={(event) => setAddCompletedToLibrary(event.target.checked)}
            />
            <Trans>Add completed videos to library</Trans>
          </label>
          <div className="max-h-72 space-y-1 overflow-y-auto rounded-xl border border-zinc-700 bg-black/30 p-2">
            {files
              .filter(
                (file) =>
                  file.mediaKind === "video" &&
                  file.sourcePath.toLowerCase().includes(fileFilter.trim().toLowerCase())
              )
              .map((file) => (
                <label
                  key={file.id}
                  className="flex items-start gap-2 rounded-lg px-2 py-1.5 text-xs text-zinc-200 hover:bg-white/5"
                >
                  <input
                    type="checkbox"
                    checked={selectedPaths.has(file.sourcePath)}
                    onChange={(event) => {
                      const next = new Set(selectedPaths);
                      if (event.target.checked) next.add(file.sourcePath);
                      else next.delete(file.sourcePath);
                      setSelectedPaths(next);
                    }}
                  />
                  <span className="min-w-0 flex-1 break-all">{file.sourcePath}</span>
                  <span className="shrink-0 text-zinc-500">
                    {formatAcquisitionBytes(file.sizeBytes)}
                  </span>
                </label>
              ))}
            {selectedSourceId && files.filter((file) => file.mediaKind === "video").length === 0 ? (
              <p className="p-2 text-sm text-zinc-500">
                <Trans>No video files found in this source.</Trans>
              </p>
            ) : null}
          </div>
        </div>
      </div>

      <div className="mt-5">
        <h3 className="mb-2 text-xs font-bold uppercase tracking-[0.18em] text-zinc-400">
          <Trans>Downloads</Trans>
        </h3>
        <div className="space-y-2">
          {jobs.length === 0 ? (
            <p className="text-sm text-zinc-500">
              <Trans>No downloads yet.</Trans>
            </p>
          ) : (
            jobs.map((job) => {
              const progress =
                job.totalBytes > 0
                  ? Math.min(100, Math.round((job.downloadedBytes / job.totalBytes) * 100))
                  : 0;
              return (
                <div
                  key={job.id}
                  className="rounded-xl border border-zinc-700 bg-black/30 p-3 text-sm"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-semibold text-zinc-100">{job.source.name}</span>
                    <span className="text-xs uppercase text-zinc-400">
                      {job.state} · {progress}%
                    </span>
                  </div>
                  <div className="mt-2 h-1.5 overflow-hidden rounded bg-zinc-800">
                    <div className="h-full bg-cyan-400" style={{ width: `${progress}%` }} />
                  </div>
                  <div className="mt-2 text-xs text-zinc-400">
                    ↓ {formatAcquisitionBytes(job.downloadSpeed)}/s · ↑{" "}
                    {formatAcquisitionBytes(job.uploadSpeed)}/s · ratio {job.ratio.toFixed(2)} ·{" "}
                    {job.peerCount} peers
                  </div>
                  <div className="mt-1 break-all text-xs text-zinc-500">
                    {parseAcquisitionJobPaths(job.selectedPathsJson).join(", ")}
                  </div>
                  {job.errorMessage ? (
                    <div className="mt-1 text-xs text-rose-300">{job.errorMessage}</div>
                  ) : null}
                  <div className="mt-2 flex flex-wrap gap-3 text-xs">
                    {job.state === "paused" ||
                    job.state === "failed" ||
                    job.state === "cancelled" ? (
                      <button
                        type="button"
                        className="text-cyan-200"
                        onClick={() => void acquisition.resumeJob(job.id).then(refresh)}
                      >
                        <Trans>Resume</Trans>
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="text-zinc-300"
                        onClick={() => void acquisition.pauseJob(job.id).then(refresh)}
                      >
                        <Trans>Pause</Trans>
                      </button>
                    )}
                    <button
                      type="button"
                      className="text-amber-200"
                      onClick={() => void acquisition.cancelJob(job.id).then(refresh)}
                    >
                      <Trans>Cancel</Trans>
                    </button>
                    <button
                      type="button"
                      className="text-zinc-300"
                      onClick={() => void acquisition.removeJob(job.id).then(refresh)}
                    >
                      <Trans>Remove Job</Trans>
                    </button>
                    <button
                      type="button"
                      className="text-rose-300"
                      onClick={() =>
                        window.confirm(t`Remove downloaded data and detach affected rounds?`) &&
                        void acquisition.removeJobData(job.id).then(refresh)
                      }
                    >
                      <Trans>Remove Data</Trans>
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      {settings ? (
        <div className="mt-5 grid gap-3 rounded-xl border border-zinc-700 bg-black/25 p-3 sm:grid-cols-2 lg:grid-cols-4">
          <label className="text-xs text-zinc-400">
            <Trans>Max active downloads</Trans>
            <input
              type="number"
              min={1}
              max={10}
              value={settings.maxActiveDownloads}
              onChange={(event) =>
                setSettings({ ...settings, maxActiveDownloads: Number(event.target.value) })
              }
              onBlur={() =>
                void acquisition.updateSettings({ maxActiveDownloads: settings.maxActiveDownloads })
              }
              className="mt-1 w-full rounded-lg border border-zinc-700 bg-black/40 px-2 py-1.5 text-zinc-100"
            />
          </label>
          <label className="text-xs text-zinc-400">
            <Trans>Download limit (MB/s)</Trans>
            <input
              type="number"
              min={0}
              step={0.1}
              placeholder={t`Unlimited`}
              value={
                settings.downloadLimitBytesPerSec === null
                  ? ""
                  : settings.downloadLimitBytesPerSec / 1_000_000
              }
              onChange={(event) =>
                setSettings({
                  ...settings,
                  downloadLimitBytesPerSec: event.target.value
                    ? Math.round(Number(event.target.value) * 1_000_000)
                    : null,
                })
              }
              onBlur={() =>
                void acquisition.updateSettings({
                  downloadLimitBytesPerSec: settings.downloadLimitBytesPerSec,
                })
              }
              className="mt-1 w-full rounded-lg border border-zinc-700 bg-black/40 px-2 py-1.5 text-zinc-100"
            />
          </label>
          <label className="text-xs text-zinc-400">
            <Trans>Upload limit (MB/s)</Trans>
            <input
              type="number"
              min={0}
              step={0.1}
              placeholder={t`Unlimited`}
              value={
                settings.uploadLimitBytesPerSec === null
                  ? ""
                  : settings.uploadLimitBytesPerSec / 1_000_000
              }
              onChange={(event) =>
                setSettings({
                  ...settings,
                  uploadLimitBytesPerSec: event.target.value
                    ? Math.round(Number(event.target.value) * 1_000_000)
                    : null,
                })
              }
              onBlur={() =>
                void acquisition.updateSettings({
                  uploadLimitBytesPerSec: settings.uploadLimitBytesPerSec,
                })
              }
              className="mt-1 w-full rounded-lg border border-zinc-700 bg-black/40 px-2 py-1.5 text-zinc-100"
            />
          </label>
          <label className="text-xs text-zinc-400">
            <Trans>Seed ratio</Trans>
            <input
              type="number"
              min={0}
              step={0.1}
              value={settings.seedRatio ?? ""}
              onChange={(event) =>
                setSettings({
                  ...settings,
                  seedRatio: event.target.value ? Number(event.target.value) : null,
                })
              }
              onBlur={() => void acquisition.updateSettings({ seedRatio: settings.seedRatio })}
              className="mt-1 w-full rounded-lg border border-zinc-700 bg-black/40 px-2 py-1.5 text-zinc-100"
            />
          </label>
          <label className="text-xs text-zinc-400">
            <Trans>Seed hours</Trans>
            <input
              type="number"
              min={1}
              value={
                settings.seedTimeMs === null ? "" : Math.round(settings.seedTimeMs / 3_600_000)
              }
              onChange={(event) =>
                setSettings({
                  ...settings,
                  seedTimeMs: event.target.value ? Number(event.target.value) * 3_600_000 : null,
                })
              }
              onBlur={() => void acquisition.updateSettings({ seedTimeMs: settings.seedTimeMs })}
              className="mt-1 w-full rounded-lg border border-zinc-700 bg-black/40 px-2 py-1.5 text-zinc-100"
            />
          </label>
          <div className="text-xs text-zinc-400 sm:col-span-2">
            <Trans>Download folder</Trans>
            <div className="mt-1 break-all text-zinc-200">{settings.resolvedDownloadRoot}</div>
            <div className="mt-2 flex flex-wrap gap-3">
              <button
                type="button"
                className="text-cyan-200"
                onClick={() => void chooseDownloadRoot()}
              >
                <Trans>Choose folder</Trans>
              </button>
              <button
                type="button"
                className="text-zinc-300"
                onClick={() => void acquisition.openDownloadRoot()}
              >
                <Trans>Open folder</Trans>
              </button>
              <button
                type="button"
                className="text-zinc-300"
                onClick={() =>
                  void acquisition.updateSettings({ downloadRootPath: null }).then(refresh)
                }
              >
                <Trans>Reset to default</Trans>
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}

function SettingsSectionCard({ section, loading }: { section: SettingsSection; loading: boolean }) {
  return (
    <section
      className="animate-entrance rounded-3xl border border-purple-400/25 bg-zinc-950/55 p-5 backdrop-blur-xl"
      style={{ animationDelay: "0.08s" }}
    >
      <div className="mb-4">
        <h2 className="text-lg font-extrabold tracking-tight text-violet-100">{section.title}</h2>
        <p className="mt-1 text-sm text-zinc-300">{section.description}</p>
      </div>

      <div className="space-y-3">
        {section.settings.map((setting) => (
          <SettingRow key={setting.id} setting={setting} disabled={loading} />
        ))}
      </div>
    </section>
  );
}

function ProgramVersionsCard({
  diagnostics,
  error,
  isLoading,
  isRefreshing,
  onRefresh,
}: {
  diagnostics: BinaryDiagnostics | null;
  error: string | null;
  isLoading: boolean;
  isRefreshing: boolean;
  onRefresh: () => void;
}) {
  const { t } = useLingui();
  const entries: BinaryDiagnosticEntry[] = diagnostics
    ? [diagnostics.ffmpeg, diagnostics.ffprobe, diagnostics.ytDlp]
    : [];

  return (
    <section
      className="animate-entrance rounded-3xl border border-purple-400/25 bg-zinc-950/55 p-5 backdrop-blur-xl"
      style={{ animationDelay: "0.1s" }}
    >
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-extrabold tracking-tight text-violet-100">
            <Trans>Program Versions</Trans>
          </h2>
          <p className="mt-1 text-sm text-zinc-300">
            <Trans>
              Live versions fetched from the currently resolved ffmpeg, ffprobe, and yt-dlp
              executables. These reflect your active source preferences.
            </Trans>
          </p>
          {diagnostics?.checkedAtIso ? (
            <p className="mt-2 font-[family-name:var(--font-jetbrains-mono)] text-[11px] text-zinc-500">
              <Trans>Last checked:</Trans> {new Date(diagnostics.checkedAtIso).toLocaleString()}
            </p>
          ) : null}
        </div>

        <button
          type="button"
          disabled={isRefreshing}
          onMouseEnter={playHoverSound}
          onClick={onRefresh}
          className={`rounded-xl border px-4 py-2 text-sm font-semibold transition ${
            isRefreshing
              ? "cursor-not-allowed border-zinc-600 bg-zinc-800 text-zinc-500"
              : "border-violet-300/60 bg-violet-500/30 text-violet-100 hover:border-violet-200/80 hover:bg-violet-500/45"
          }`}
        >
          {isRefreshing ? t`Refreshing...` : t`Refresh`}
        </button>
      </div>

      {error ? (
        <div className="mb-3 rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
          {error}
        </div>
      ) : null}

      <div className="space-y-3">
        {isLoading && !diagnostics ? (
          <div className="rounded-2xl border border-violet-300/25 bg-black/35 px-4 py-5 text-sm text-zinc-300">
            {t`Loading...`}
          </div>
        ) : null}

        {entries.map((entry) => {
          const sourceLabel =
            entry.source === "bundled"
              ? t`Bundled`
              : entry.source === "system"
                ? t`System`
                : t`Unavailable`;
          const preferenceLabel =
            entry.preference === "bundled"
              ? t`Bundled Only`
              : entry.preference === "system"
                ? t`System Only`
                : t`Auto (Default)`;

          return (
            <div
              key={entry.tool}
              className="rounded-2xl border border-violet-300/25 bg-black/35 p-4 transition-colors duration-200 hover:border-violet-300/45"
              onMouseEnter={playHoverSound}
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="font-[family-name:var(--font-jetbrains-mono)] text-sm font-bold uppercase tracking-[0.18em] text-zinc-100">
                    {entry.tool}
                  </p>
                  <p className="mt-1 text-xs text-zinc-400">
                    <Trans>Preference:</Trans> {preferenceLabel}
                  </p>
                </div>

                <span
                  className={`rounded-full border px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] ${
                    entry.source === "bundled"
                      ? "border-cyan-300/40 bg-cyan-500/15 text-cyan-100"
                      : entry.source === "system"
                        ? "border-emerald-300/40 bg-emerald-500/15 text-emerald-100"
                        : "border-rose-300/40 bg-rose-500/15 text-rose-100"
                  }`}
                >
                  {sourceLabel}
                </span>
              </div>

              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <div>
                  <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-zinc-500">
                    <Trans>Version</Trans>
                  </div>
                  <div className="mt-1 text-sm font-semibold text-zinc-100">
                    {entry.version ?? t`Unavailable`}
                  </div>
                </div>

                <div>
                  <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-zinc-500">
                    <Trans>Path</Trans>
                  </div>
                  <div className="mt-1 break-all font-[family-name:var(--font-jetbrains-mono)] text-xs text-zinc-300">
                    {entry.path ?? t`Unavailable`}
                  </div>
                </div>
              </div>

              {entry.error ? (
                <p className="mt-3 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
                  {entry.error}
                </p>
              ) : null}
            </div>
          );
        })}
      </div>
    </section>
  );
}

function formatBytes(value: number | null | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "0 B";
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

function compactJson(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

function DebugSettingsCard({
  section,
  loading,
  debugState,
  diagnostics,
  allSettings,
  message,
  isRefreshing,
  isCopying,
  isExporting,
  isCreatingPlaintextSettings,
  isClearing,
  onRefresh,
  onCopy,
  onExport,
  onCreatePlaintextSettings,
  onOpenLogFolder,
  onClearLog,
}: {
  section: SettingsSection;
  loading: boolean;
  debugState: DebugState | null;
  diagnostics: DebugDiagnostics | null;
  allSettings: Record<string, unknown> | null;
  message: string | null;
  isRefreshing: boolean;
  isCopying: boolean;
  isExporting: boolean;
  isCreatingPlaintextSettings: boolean;
  isClearing: boolean;
  onRefresh: () => void;
  onCopy: () => void;
  onExport: () => void;
  onCreatePlaintextSettings: () => void;
  onOpenLogFolder: () => void;
  onClearLog: () => void;
}) {
  const { t } = useLingui();
  const actionDisabled =
    loading ||
    isRefreshing ||
    isCopying ||
    isExporting ||
    isCreatingPlaintextSettings ||
    isClearing;
  const groups = diagnostics
    ? [
        { title: t`App`, value: diagnostics.app },
        { title: t`Storage`, value: diagnostics.storage },
        { title: t`Hardware`, value: diagnostics.hardware },
        { title: t`Database`, value: diagnostics.database },
        { title: t`Background Jobs`, value: diagnostics.runtime },
        ...(allSettings ? [{ title: t`Settings`, value: allSettings }] : []),
      ]
    : [];

  return (
    <section
      className="animate-entrance rounded-3xl border border-purple-400/25 bg-zinc-950/55 p-5 backdrop-blur-xl"
      style={{ animationDelay: "0.08s" }}
    >
      <div className="mb-4">
        <h2 className="text-lg font-extrabold tracking-tight text-violet-100">{section.title}</h2>
        <p className="mt-1 text-sm text-zinc-300">{section.description}</p>
      </div>

      <div className="space-y-3">
        {section.settings
          .filter((s) => !s.id.startsWith("graphics-") && s.id !== "ffmpeg-gpu-preference")
          .map((setting) => (
            <SettingRow key={setting.id} setting={setting} disabled={loading} />
          ))}

        <details className="group rounded-2xl border border-violet-300/25 bg-black/35 p-4 transition-colors duration-200 hover:border-violet-300/45">
          <summary className="flex cursor-pointer items-center justify-between text-sm font-semibold text-zinc-100 hover:text-violet-100">
            <span>
              <Trans>Graphics Compatibility</Trans>
            </span>
            <span className="text-xs text-zinc-400 group-open:rotate-180 transition-transform">
              ▾
            </span>
          </summary>
          <div className="mt-2 rounded-xl border border-amber-300/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-100">
            <Trans>
              Changing these settings can degrade performance. It is recommended to leave them off
              and only enable them when necessary to fix specific issues. Changes require an app
              restart.
            </Trans>
          </div>
          <div className="mt-3 space-y-3">
            {section.settings
              .filter((s) => s.id.startsWith("graphics-") || s.id === "ffmpeg-gpu-preference")
              .map((setting) => (
                <SettingRow key={setting.id} setting={setting} disabled={loading} />
              ))}
          </div>
        </details>

        <div
          className="rounded-2xl border border-violet-300/25 bg-black/35 p-4 transition-colors duration-200 hover:border-violet-300/45"
          onMouseEnter={playHoverSound}
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-zinc-500">
                <Trans>Log File</Trans>
              </div>
              <div className="mt-1 break-all font-[family-name:var(--font-jetbrains-mono)] text-xs text-zinc-300">
                {debugState?.anonymizedLogFilePath ?? t`Loading...`}
              </div>
            </div>
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-zinc-500">
                <Trans>Size</Trans>
              </div>
              <div className="mt-1 text-sm font-semibold text-zinc-100">
                {formatBytes(debugState?.logFileSizeBytes)}
              </div>
            </div>
          </div>

          <div className="mt-4 grid gap-2 sm:grid-cols-3">
            <button
              type="button"
              disabled={actionDisabled}
              onClick={onCopy}
              className="rounded-xl border border-violet-300/60 bg-violet-500/30 px-3 py-2 text-xs font-semibold text-violet-100 transition hover:border-violet-200/80 hover:bg-violet-500/45 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isCopying ? t`Copying...` : t`Copy Debug Info`}
            </button>
            <button
              type="button"
              disabled={actionDisabled}
              onClick={onExport}
              className="rounded-xl border border-cyan-300/55 bg-cyan-500/20 px-3 py-2 text-xs font-semibold text-cyan-100 transition hover:border-cyan-200/80 hover:bg-cyan-500/30 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isExporting ? t`Exporting...` : t`Export Debug File`}
            </button>
            <button
              type="button"
              disabled={actionDisabled}
              onClick={onOpenLogFolder}
              className="rounded-xl border border-zinc-600 bg-zinc-900 px-3 py-2 text-xs font-semibold text-zinc-200 transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Trans>Open Log Folder</Trans>
            </button>
            <button
              type="button"
              disabled={actionDisabled}
              onClick={onCreatePlaintextSettings}
              className="rounded-xl border border-amber-300/55 bg-amber-500/15 px-3 py-2 text-xs font-semibold text-amber-100 transition hover:border-amber-200/80 hover:bg-amber-500/25 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isCreatingPlaintextSettings ? t`Creating...` : t`Create Plaintext Settings File`}
            </button>
            <button
              type="button"
              disabled={actionDisabled}
              onClick={onClearLog}
              className="rounded-xl border border-rose-300/45 bg-rose-500/15 px-3 py-2 text-xs font-semibold text-rose-100 transition hover:border-rose-200/70 hover:bg-rose-500/25 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isClearing ? t`Clearing...` : t`Clear Log File`}
            </button>
            <button
              type="button"
              disabled={actionDisabled}
              onClick={onRefresh}
              className="rounded-xl border border-zinc-600 bg-zinc-900 px-3 py-2 text-xs font-semibold text-zinc-200 transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isRefreshing ? t`Refreshing...` : t`Refresh`}
            </button>
          </div>

          {message ? (
            <p className="mt-3 rounded-xl border border-cyan-400/25 bg-cyan-500/10 px-4 py-2 text-sm text-cyan-100">
              {message}
            </p>
          ) : null}
        </div>

        <div className="rounded-2xl border border-violet-300/25 bg-black/35 p-4">
          <h3 className="text-sm font-bold uppercase tracking-[0.18em] text-zinc-100">
            <Trans>Debug Information</Trans>
          </h3>
          {loading && !diagnostics ? (
            <p className="mt-3 text-sm text-zinc-400">{t`Loading...`}</p>
          ) : (
            <div className="mt-4 space-y-3">
              {groups.map((group) => (
                <details
                  key={group.title}
                  className="rounded-xl border border-zinc-700/70 bg-zinc-950/80 p-3"
                  open={group.title === t`App` || group.title === t`Storage`}
                >
                  <summary className="cursor-pointer text-sm font-semibold text-violet-100">
                    {group.title}
                  </summary>
                  <pre className="mt-3 max-h-72 overflow-auto whitespace-pre-wrap break-words font-[family-name:var(--font-jetbrains-mono)] text-[11px] leading-relaxed text-zinc-300">
                    {compactJson(group.value)}
                  </pre>
                </details>
              ))}
              {diagnostics?.collectionErrors.length ? (
                <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-100">
                  <p className="font-semibold uppercase tracking-[0.16em]">
                    <Trans>Collection Errors</Trans>
                  </p>
                  <pre className="mt-2 whitespace-pre-wrap break-words font-[family-name:var(--font-jetbrains-mono)]">
                    {compactJson(diagnostics.collectionErrors)}
                  </pre>
                </div>
              ) : null}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

function AppZoomCard({
  zoomPercent,
  isLoading,
  onZoomIn,
  onZoomOut,
  onResetZoom,
}: {
  zoomPercent: number | null;
  isLoading: boolean;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onResetZoom: () => void;
}) {
  const { t } = useLingui();
  const displayZoom = zoomPercent === null ? t`Loading...` : `${zoomPercent}%`;

  return (
    <section
      className="animate-entrance rounded-3xl border border-purple-400/25 bg-zinc-950/55 p-5 backdrop-blur-xl"
      style={{ animationDelay: "0.1s" }}
    >
      <div className="mb-4">
        <h2 className="text-lg font-extrabold tracking-tight text-violet-100">
          <Trans>App Zoom</Trans>
        </h2>
        <p className="mt-1 text-sm text-zinc-300">
          <Trans>Adjust the window zoom level used by the whole app.</Trans>
        </p>
      </div>

      <div
        className="rounded-2xl border border-violet-300/25 bg-black/35 p-4 transition-colors duration-200 hover:border-violet-300/45"
        onMouseEnter={playHoverSound}
      >
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="font-semibold text-zinc-100">
              <Trans>Current Zoom</Trans>
            </p>
            <p className="mt-1 font-[family-name:var(--font-jetbrains-mono)] text-2xl font-black text-violet-100">
              {displayZoom}
            </p>
          </div>

          <div className="grid grid-cols-3 gap-2">
            <button
              type="button"
              aria-label={t`Zoom out`}
              title={t`Zoom out`}
              disabled={isLoading}
              onMouseEnter={playHoverSound}
              onClick={onZoomOut}
              className="grid h-11 w-11 place-items-center rounded-xl border border-violet-300/60 bg-violet-500/30 text-xl font-black text-violet-100 transition hover:border-violet-200/80 hover:bg-violet-500/45 disabled:cursor-not-allowed disabled:opacity-50"
            >
              -
            </button>
            <button
              type="button"
              aria-label={t`Reset zoom`}
              title={t`Reset zoom`}
              disabled={isLoading}
              onMouseEnter={playHoverSound}
              onClick={onResetZoom}
              className="grid h-11 w-16 place-items-center rounded-xl border border-zinc-500/60 bg-zinc-700/40 font-[family-name:var(--font-jetbrains-mono)] text-sm font-black text-zinc-100 transition hover:border-zinc-300/70 hover:bg-zinc-700/60 disabled:cursor-not-allowed disabled:opacity-50"
            >
              100%
            </button>
            <button
              type="button"
              aria-label={t`Zoom in`}
              title={t`Zoom in`}
              disabled={isLoading}
              onMouseEnter={playHoverSound}
              onClick={onZoomIn}
              className="grid h-11 w-11 place-items-center rounded-xl border border-violet-300/60 bg-violet-500/30 text-xl font-black text-violet-100 transition hover:border-violet-200/80 hover:bg-violet-500/45 disabled:cursor-not-allowed disabled:opacity-50"
            >
              +
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}

function HelpShortcutsCard({ cheatModeEnabled }: { cheatModeEnabled: boolean }) {
  const { i18n } = useLingui();
  const sfwMode = useSfwMode();
  const shortcutGroups = getVisibleShortcutGroups(i18n, import.meta.env.PROD, cheatModeEnabled);

  return (
    <section
      className="animate-entrance rounded-3xl border border-purple-400/25 bg-zinc-950/55 p-5 backdrop-blur-xl"
      style={{ animationDelay: "0.08s" }}
    >
      <div className="mb-4">
        <h2 className="text-lg font-extrabold tracking-tight text-violet-100">
          <Trans>Keyboard Shortcuts</Trans>
        </h2>
        <p className="mt-1 text-sm text-zinc-300">
          <Trans>Every shortcut currently wired into the app is listed here.</Trans>
        </p>
      </div>

      <div className="divide-y divide-violet-300/15">
        {shortcutGroups.map((group) => (
          <details key={group.id} className="group py-3" open>
            <summary className="flex cursor-pointer items-center justify-between text-sm font-semibold text-zinc-100 hover:text-violet-100">
              <span>{group.title}</span>
              <span className="text-xs text-zinc-400 group-open:rotate-180 transition-transform">
                ▾
              </span>
            </summary>
            <div className="mt-3 space-y-2 pl-2">
              {group.shortcuts.map((shortcut) => (
                <div
                  key={`${group.id}-${shortcut.keys}`}
                  className="flex items-center justify-between gap-3 py-1"
                >
                  <kbd className="rounded border border-violet-300/20 bg-violet-500/10 px-2 py-0.5 font-[family-name:var(--font-jetbrains-mono)] text-[10px] font-bold uppercase tracking-[0.16em] text-violet-100">
                    {shortcut.keys}
                  </kbd>
                  <span className="text-xs text-zinc-400">
                    {abbreviateNsfwText(shortcut.description, sfwMode)}
                  </span>
                </div>
              ))}
            </div>
          </details>
        ))}
      </div>
    </section>
  );
}

function ChangelogCard() {
  const currentVersion = import.meta.env.VITE_APP_VERSION;

  return (
    <section
      className="animate-entrance overflow-hidden rounded-3xl border border-fuchsia-400/25 bg-zinc-950/55 backdrop-blur-xl"
      style={{ animationDelay: "0.08s" }}
    >
      <div className="border-b border-white/8 bg-[radial-gradient(circle_at_top_left,rgba(244,114,182,0.18),transparent_42%),linear-gradient(135deg,rgba(91,33,182,0.28),rgba(12,10,24,0.94))] px-5 py-5 sm:px-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div className="max-w-2xl">
            <p className="font-[family-name:var(--font-jetbrains-mono)] text-[0.65rem] uppercase tracking-[0.35em] text-fuchsia-200/80">
              <Trans>Release Notes</Trans>
            </p>
            <h2 className="app-theme-heading mt-2 text-2xl font-black tracking-tight sm:text-3xl">
              <Trans>What&apos;s New</Trans>
            </h2>
            <p className="mt-2 text-sm text-fuchsia-50/80">
              <Trans>Release notes and shipped improvements bundled directly into the app.</Trans>
            </p>
          </div>

          <div className="self-start rounded-full border border-white/15 bg-white/8 px-3 py-1.5 font-[family-name:var(--font-jetbrains-mono)] text-xs font-bold uppercase tracking-[0.16em] text-fuchsia-100">
            v{currentVersion}
          </div>
        </div>
      </div>

      <div className="px-5 py-5 sm:px-6 sm:py-6">
        <div className="settings-changelog">
          <ReactMarkdown
            components={{
              a: ({ href, children, ...props }) => (
                <a href={href} rel="noreferrer" target="_blank" {...props}>
                  {children}
                </a>
              ),
            }}
          >
            {changelogMarkdown}
          </ReactMarkdown>
        </div>
      </div>
    </section>
  );
}

function SecuritySettingsCard() {
  const { t } = useLingui();
  const [trustedSites, setTrustedSites] = useState<Awaited<
    ReturnType<typeof security.listTrustedSites>
  > | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [draftDomain, setDraftDomain] = useState("");
  const [filter, setFilter] = useState("");
  const [isYtDlpDomainsOpen, setIsYtDlpDomainsOpen] = useState(true);
  const [isUserTrustedDomainsOpen, setIsUserTrustedDomainsOpen] = useState(true);

  useEffect(() => {
    let mounted = true;
    void security
      .listTrustedSites()
      .then((value) => {
        if (mounted) setTrustedSites(value);
      })
      .catch((error) => {
        if (mounted) {
          setStatusMessage(
            error instanceof Error ? error.message : t`Failed to load trusted sites.`
          );
        }
      });
    return () => {
      mounted = false;
    };
  }, [t]);

  const applyMutation = async (task: () => Promise<void>) => {
    setStatusMessage(null);
    try {
      await task();
      setTrustedSites(await security.listTrustedSites());
    } catch (error) {
      setStatusMessage(
        error instanceof Error ? error.message : t`Security settings update failed.`
      );
    }
  };

  const normalizedFilter = filter.trim().toLowerCase();
  const includeEntry = (value: string) =>
    normalizedFilter.length === 0 || value.toLowerCase().includes(normalizedFilter);

  return (
    <section
      className="animate-entrance rounded-3xl border border-purple-400/25 bg-zinc-950/55 p-5 backdrop-blur-xl"
      style={{ animationDelay: "0.08s" }}
    >
      <div className="mb-4">
        <h2 className="text-lg font-extrabold tracking-tight text-violet-100">
          <Trans>Remote Import Trust</Trans>
        </h2>
        <p className="mt-1 text-sm text-zinc-300">
          <Trans>
            Sidecar imports automatically trust Stash source hosts, yt-dlp-supported domains, and
            the user-trusted domains listed here. In{" "}
            <span className="font-semibold text-zinc-100">Prompt</span> mode, unknown remote URLs
            can be approved during manual import. In{" "}
            <span className="font-semibold text-zinc-100">Block</span> mode, every non-whitelisted
            remote URL is blocked automatically. In{" "}
            <span className="font-semibold text-zinc-100">Paranoid</span> mode, only configured
            Stash source URLs are allowed.
          </Trans>
        </p>
      </div>

      <div className="space-y-0 divide-y divide-violet-300/15">
        <div className="pb-4">
          <div className="flex items-center justify-between">
            <span className="text-sm font-semibold text-zinc-100">
              <Trans>Security Mode</Trans>
            </span>
            <div className="flex rounded-lg border border-violet-300/25 bg-black/35 p-0.5">
              {(["prompt", "block", "paranoid"] as const).map((mode) => {
                const active = trustedSites?.securityMode === mode;
                return (
                  <button
                    key={mode}
                    type="button"
                    className={`rounded-md px-3 py-1 text-xs font-semibold uppercase tracking-[0.12em] transition ${
                      active
                        ? "bg-violet-500/40 text-violet-100 shadow-[0_0_12px_rgba(139,92,246,0.3)]"
                        : "text-zinc-400 hover:text-zinc-200"
                    }`}
                    onMouseEnter={playHoverSound}
                    onClick={() => {
                      playSelectSound();
                      void applyMutation(async () => {
                        await security.setSecurityMode(mode);
                      });
                    }}
                  >
                    {mode === "prompt" ? t`prompt` : mode === "block" ? t`block` : t`paranoid`}
                  </button>
                );
              })}
            </div>
          </div>
          <p className="mt-1.5 text-xs text-zinc-500">
            {trustedSites?.securityMode === "paranoid"
              ? t`Allowing only configured Stash source URLs and blocking yt-dlp and user-whitelisted domains.`
              : trustedSites?.securityMode === "block"
                ? t`Silently blocking every remote URL that is not already whitelisted.`
                : t`Asking during manual sidecar imports before trusting unknown remote URLs.`}
          </p>
          {trustedSites?.securityMode === "paranoid" ? (
            <div className="mt-3 rounded-xl border border-amber-400/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-100">
              <Trans>
                Paranoid mode will impact the user experience significantly and should only be used
                if you know exactly what you are doing.
              </Trans>
            </div>
          ) : null}
        </div>

        <div className="py-4">
          <div className="flex flex-col gap-2 sm:flex-row">
            <input
              value={draftDomain}
              onChange={(event) => setDraftDomain(event.target.value)}
              placeholder={t`Add trusted base domain`}
              className="min-w-0 flex-1 rounded-xl border border-violet-300/25 bg-black/35 px-3 py-2 text-sm text-white outline-none placeholder:text-zinc-500 focus:border-violet-300/50"
            />
            <button
              type="button"
              onMouseEnter={playHoverSound}
              className="rounded-xl border border-violet-300/60 bg-violet-500/30 px-4 py-2 text-sm font-semibold text-violet-100 transition hover:border-violet-200/80 hover:bg-violet-500/45"
              onClick={() => {
                playSelectSound();
                void applyMutation(async () => {
                  await security.addTrustedSite(draftDomain);
                  setDraftDomain("");
                });
              }}
            >
              <Trans>Add Trusted Site</Trans>
            </button>
          </div>

          <input
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
            placeholder={t`Filter domains`}
            className="mt-3 w-full rounded-xl border border-violet-300/25 bg-black/35 px-3 py-2 text-sm text-white outline-none placeholder:text-zinc-500 focus:border-violet-300/50"
          />
        </div>

        {statusMessage ? (
          <div className="py-4">
            <div className="rounded-xl border border-amber-300/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-100">
              {statusMessage}
            </div>
          </div>
        ) : null}

        {!trustedSites ? (
          <div className="py-4 text-sm text-zinc-400">
            <Trans>Loading security settings...</Trans>
          </div>
        ) : (
          <>
            {trustedSites.builtInStashHosts.length > 0 && (
              <details className="group py-3" open>
                <summary className="flex cursor-pointer items-center justify-between text-sm font-semibold text-zinc-100 hover:text-violet-100">
                  <span>
                    <Trans>Stash Hosts</Trans>
                    <span className="ml-2 text-xs font-normal text-zinc-500">
                      {trustedSites.builtInStashHosts.filter(includeEntry).length}
                    </span>
                  </span>
                  <span className="text-xs text-zinc-400 group-open:rotate-180 transition-transform">
                    ▾
                  </span>
                </summary>
                <div className="mt-2 max-h-48 space-y-1 overflow-y-auto pl-1">
                  {trustedSites.builtInStashHosts.filter(includeEntry).map((host) => (
                    <div
                      key={host}
                      className="rounded-lg px-2 py-1 text-xs text-zinc-300 break-all"
                    >
                      {host}
                    </div>
                  ))}
                </div>
              </details>
            )}

            {trustedSites.builtInYtDlpDomains.length > 0 && (
              <details
                className="group py-3"
                open={isYtDlpDomainsOpen}
                onToggle={(event) =>
                  setIsYtDlpDomainsOpen((event.currentTarget as HTMLDetailsElement).open)
                }
              >
                <summary className="flex cursor-pointer items-center justify-between text-sm font-semibold text-zinc-100 hover:text-violet-100">
                  <span>
                    <Trans>yt-dlp Domains</Trans>
                    <span className="ml-2 text-xs font-normal text-zinc-500">
                      {trustedSites.builtInYtDlpDomains.filter(includeEntry).length}
                    </span>
                  </span>
                  <span className="text-xs text-zinc-400 group-open:rotate-180 transition-transform">
                    ▾
                  </span>
                </summary>
                {normalizedFilter.length === 0 ? (
                  <p className="mt-2 text-xs text-zinc-500 pl-1">
                    <Trans>
                      {trustedSites.builtInYtDlpDomains.length} domains — use the filter above to
                      search.
                    </Trans>
                  </p>
                ) : (
                  <div className="mt-2 max-h-48 space-y-1 overflow-y-auto pl-1">
                    {trustedSites.builtInYtDlpDomains.filter(includeEntry).map((domain) => (
                      <div
                        key={domain}
                        className="rounded-lg px-2 py-1 text-xs text-zinc-300 break-all"
                      >
                        {domain}
                      </div>
                    ))}
                  </div>
                )}
              </details>
            )}

            <details
              className="group py-3"
              open={isUserTrustedDomainsOpen}
              onToggle={(event) =>
                setIsUserTrustedDomainsOpen((event.currentTarget as HTMLDetailsElement).open)
              }
            >
              <summary className="flex cursor-pointer items-center justify-between text-sm font-semibold text-zinc-100 hover:text-violet-100">
                <span>
                  <Trans>User-Trusted Domains</Trans>
                  <span className="ml-2 text-xs font-normal text-zinc-500">
                    {trustedSites.userTrustedBaseDomains.filter(includeEntry).length}
                  </span>
                </span>
                <span className="text-xs text-zinc-400 group-open:rotate-180 transition-transform">
                  ▾
                </span>
              </summary>
              <div className="mt-2 space-y-1 pl-1">
                {trustedSites.userTrustedBaseDomains.filter(includeEntry).length === 0 ? (
                  <p className="text-xs text-zinc-500">
                    <Trans>No user-trusted domains yet.</Trans>
                  </p>
                ) : (
                  trustedSites.userTrustedBaseDomains.filter(includeEntry).map((domain) => (
                    <div
                      key={domain}
                      className="flex items-center justify-between gap-3 rounded-xl border border-violet-300/25 bg-black/35 px-3 py-2"
                    >
                      <span className="break-all text-xs text-zinc-200">{domain}</span>
                      <button
                        type="button"
                        className="shrink-0 rounded-lg border border-rose-300/60 bg-rose-500/20 px-3 py-1 text-xs font-semibold uppercase tracking-[0.12em] text-rose-100 hover:bg-rose-500/35"
                        onMouseEnter={playHoverSound}
                        onClick={() => {
                          playSelectSound();
                          void applyMutation(async () => {
                            await security.removeTrustedSite(domain);
                          });
                        }}
                      >
                        <Trans>Remove</Trans>
                      </button>
                    </div>
                  ))
                )}
              </div>
            </details>
          </>
        )}
      </div>
    </section>
  );
}

function SettingRow({ setting, disabled }: { setting: SettingDefinition; disabled: boolean }) {
  if (setting.type === "toggle") {
    return <ToggleRow setting={setting} disabled={disabled} />;
  }
  if (setting.type === "text") {
    return <TextRow setting={setting} disabled={disabled} />;
  }
  if (setting.type === "number") {
    return <NumberRow setting={setting} disabled={disabled} />;
  }
  if (setting.type === "actions") {
    return <ActionRow setting={setting} disabled={disabled} />;
  }
  if (setting.type === "select") {
    return <SelectRow setting={setting} disabled={disabled} />;
  }

  return null;
}

function ActionRow({ setting, disabled }: { setting: ActionSetting; disabled: boolean }) {
  const { t } = useLingui();
  const [pendingActionId, setPendingActionId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const runAction = async (action: ActionSetting["actions"][number]) => {
    if (disabled || pendingActionId) return;
    playSelectSound();
    setPendingActionId(action.id);
    setError(null);
    try {
      await action.onClick();
    } catch (err) {
      setError(err instanceof Error ? err.message : t`Failed to apply setting.`);
    } finally {
      setPendingActionId(null);
    }
  };

  return (
    <div
      className="rounded-2xl border border-violet-300/25 bg-black/35 p-4 transition-colors duration-200 hover:border-violet-300/45"
      onMouseEnter={playHoverSound}
    >
      <div className="mb-3">
        <p className="font-semibold text-zinc-100">{setting.label}</p>
        <p className="text-sm text-zinc-400">{setting.description}</p>
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        {setting.actions.map((action) => {
          const isPending = pendingActionId === action.id;
          return (
            <button
              key={action.id}
              type="button"
              disabled={disabled || pendingActionId !== null}
              onClick={() => void runAction(action)}
              className={`rounded-xl border px-4 py-2 text-left text-sm font-semibold transition-all duration-200 ${
                disabled || pendingActionId !== null
                  ? "cursor-not-allowed border-zinc-600 bg-zinc-800 text-zinc-500"
                  : "border-violet-300/60 bg-violet-500/30 text-violet-100 hover:border-violet-200/80 hover:bg-violet-500/45"
              }`}
            >
              {isPending ? t`Applying...` : action.label}
            </button>
          );
        })}
      </div>
      {error && (
        <p className="mt-2 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-1.5 font-mono text-xs text-rose-400 animate-entrance">
          {error}
        </p>
      )}
    </div>
  );
}

function SelectRow({ setting, disabled }: { setting: SelectSetting; disabled: boolean }) {
  const { t } = useLingui();
  const [draft, setDraft] = useState(setting.value);
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setDraft(setting.value);
  }, [setting.value]);

  const save = async () => {
    if (disabled || isPending) return;
    playSelectSound();
    setIsPending(true);
    setError(null);
    try {
      await setting.onChange(draft);
    } catch (err) {
      setError(err instanceof Error ? err.message : t`Failed to update setting.`);
    } finally {
      setIsPending(false);
    }
  };

  return (
    <div
      className="rounded-2xl border border-violet-300/25 bg-black/35 p-4 transition-colors duration-200 hover:border-violet-300/45"
      onMouseEnter={playHoverSound}
    >
      <div className="mb-3">
        <p className="font-semibold text-zinc-100">{setting.label}</p>
        <p className="text-sm text-zinc-400">{setting.description}</p>
      </div>
      <div className="flex flex-col gap-2 sm:flex-row">
        <GameDropdown
          value={draft}
          options={setting.options}
          disabled={disabled || isPending}
          onChange={(value) => setDraft(value)}
        />
        <button
          className={`rounded-xl border px-4 py-2 text-sm font-semibold transition-all duration-200 ${disabled || isPending ? "cursor-not-allowed border-zinc-600 bg-zinc-800 text-zinc-500" : "border-violet-300/60 bg-violet-500/30 text-violet-100 hover:border-violet-200/80 hover:bg-violet-500/45"}`}
          disabled={disabled || isPending}
          onClick={() => void save()}
          type="button"
        >
          <Trans>Save</Trans>
        </button>
      </div>
      {error && (
        <p className="mt-2 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-1.5 font-mono text-xs text-rose-400 animate-entrance">
          {error}
        </p>
      )}
    </div>
  );
}

function NumberRow({ setting, disabled }: { setting: NumberSetting; disabled: boolean }) {
  const { t } = useLingui();
  const [draft, setDraft] = useState(`${setting.value}`);
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setDraft(`${setting.value}`);
  }, [setting.value]);

  const save = async () => {
    if (disabled || isPending) return;
    playSelectSound();
    setIsPending(true);
    setError(null);
    try {
      const numeric = Number(draft);
      if (!Number.isFinite(numeric)) {
        setError(t`Please enter a valid number.`);
        setDraft(`${setting.value}`);
        return;
      }
      await setting.onChange(numeric);
    } catch (err) {
      setError(err instanceof Error ? err.message : t`Failed to update setting.`);
    } finally {
      setIsPending(false);
    }
  };

  return (
    <div
      className="rounded-2xl border border-violet-300/25 bg-black/35 p-4 transition-colors duration-200 hover:border-violet-300/45"
      onMouseEnter={playHoverSound}
    >
      <div className="mb-3">
        <p className="font-semibold text-zinc-100">{setting.label}</p>
        <p className="text-sm text-zinc-400">{setting.description}</p>
      </div>
      <div className="flex flex-col gap-2 sm:flex-row">
        <input
          className="w-full rounded-xl border border-violet-300/30 bg-black/45 px-3 py-2 text-sm text-zinc-100 outline-none transition-all duration-200 focus:border-violet-300/75 focus:ring-2 focus:ring-violet-400/30"
          disabled={disabled || isPending}
          max={setting.max}
          min={setting.min}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              void save();
            }
          }}
          type="number"
          value={draft}
        />
        <button
          className={`rounded-xl border px-4 py-2 text-sm font-semibold transition-all duration-200 ${disabled || isPending ? "cursor-not-allowed border-zinc-600 bg-zinc-800 text-zinc-500" : "border-violet-300/60 bg-violet-500/30 text-violet-100 hover:border-violet-200/80 hover:bg-violet-500/45"}`}
          disabled={disabled || isPending}
          onClick={() => void save()}
          type="button"
        >
          <Trans>Save</Trans>
        </button>
      </div>
      {error && (
        <p className="mt-2 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-1.5 font-mono text-xs text-rose-400 animate-entrance">
          {error}
        </p>
      )}
    </div>
  );
}

function ToggleRow({ setting, disabled }: { setting: ToggleSetting; disabled: boolean }) {
  const { t } = useLingui();
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleToggle = async () => {
    if (disabled || isPending) return;
    playSelectSound();
    setIsPending(true);
    setError(null);
    try {
      await setting.onChange(!setting.value);
    } catch (err) {
      setError(err instanceof Error ? err.message : t`Failed to update setting.`);
    } finally {
      setIsPending(false);
    }
  };

  const switchedOn = setting.value;

  return (
    <div
      className={`rounded-2xl border border-violet-300/25 bg-black/35 p-4 transition-colors duration-200 hover:border-violet-300/45 ${error ? "" : "flex justify-between gap-4"}`}
      onMouseEnter={playHoverSound}
    >
      <div className={error ? "" : "flex flex-1 items-start justify-between gap-4"}>
        <div>
          <p className="font-semibold text-zinc-100">{setting.label}</p>
          <p className="text-sm text-zinc-400">{setting.description}</p>
        </div>

        <button
          type="button"
          aria-label={t`Toggle ${setting.label}`}
          role="switch"
          aria-checked={switchedOn}
          disabled={disabled || isPending}
          onClick={() => void handleToggle()}
          className={`relative mt-1 h-8 w-16 shrink-0 self-start overflow-hidden rounded-full border transition-all duration-200 ${switchedOn ? "border-violet-300/80 bg-violet-500/50 shadow-[0_0_20px_rgba(139,92,246,0.45)]" : "border-zinc-600 bg-zinc-800"} ${disabled || isPending ? "opacity-60 cursor-not-allowed" : "cursor-pointer"}`}
        >
          <span
            className={`absolute left-1 top-1 h-6 w-6 rounded-full bg-white shadow-md transition-transform duration-200 ${switchedOn ? "translate-x-8" : "translate-x-0"}`}
          />
        </button>
      </div>
      {error && (
        <p className="mt-2 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-1.5 font-mono text-xs text-rose-400 animate-entrance">
          {error}
        </p>
      )}
    </div>
  );
}

function TextRow({ setting, disabled }: { setting: TextSetting; disabled: boolean }) {
  const { t } = useLingui();
  const [draft, setDraft] = useState(setting.value);
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setDraft(setting.value);
  }, [setting.value]);

  const save = async () => {
    if (disabled || isPending) return;
    playSelectSound();
    setIsPending(true);
    setError(null);
    try {
      await setting.onChange(draft);
    } catch (err) {
      setError(err instanceof Error ? err.message : t`Failed to update setting.`);
    } finally {
      setIsPending(false);
    }
  };

  return (
    <div
      className="rounded-2xl border border-violet-300/25 bg-black/35 p-4 transition-colors duration-200 hover:border-violet-300/45"
      onMouseEnter={playHoverSound}
    >
      <div className="mb-3">
        <p className="font-semibold text-zinc-100">{setting.label}</p>
        <p className="text-sm text-zinc-400">{setting.description}</p>
      </div>
      <div className="flex flex-col gap-2 sm:flex-row">
        <input
          className="w-full rounded-xl border border-violet-300/30 bg-black/45 px-3 py-2 text-sm text-zinc-100 outline-none transition-all duration-200 focus:border-violet-300/75 focus:ring-2 focus:ring-violet-400/30"
          disabled={disabled || isPending}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              void save();
            }
          }}
          placeholder={setting.placeholder}
          type="text"
          value={draft}
        />
        <button
          className={`rounded-xl border px-4 py-2 text-sm font-semibold transition-all duration-200 ${disabled || isPending ? "cursor-not-allowed border-zinc-600 bg-zinc-800 text-zinc-500" : "border-violet-300/60 bg-violet-500/30 text-violet-100 hover:border-violet-200/80 hover:bg-violet-500/45"}`}
          disabled={disabled || isPending}
          onClick={() => void save()}
          type="button"
        >
          <Trans>Save</Trans>
        </button>
      </div>
      {error && (
        <p className="mt-2 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-1.5 font-mono text-xs text-rose-400 animate-entrance">
          {error}
        </p>
      )}
    </div>
  );
}

function CreditsCard() {
  const { t } = useLingui();
  const sfwMode = useSfwMode();
  const playtesters = ["Kyral", "VladTheImplier", "Aodin", "woo", "edale", "Dragon0301"];

  return (
    <section
      className="animate-entrance rounded-3xl border border-purple-400/25 bg-zinc-950/55 p-5 backdrop-blur-xl"
      style={{ animationDelay: "0.12s" }}
    >
      <div className="mb-5">
        <h2 className="text-xl font-extrabold tracking-tight text-violet-100">
          <Trans>Credits & License</Trans>
        </h2>
        <p className="mt-1 text-sm text-zinc-300">
          <Trans>Special thanks to the community and creators who inspired this project.</Trans>
        </p>
      </div>

      <div className="mb-6 rounded-xl border border-fuchsia-300/40 bg-gradient-to-br from-fuchsia-500/18 via-violet-500/14 to-black/45 p-4">
        <p className="text-xs font-black uppercase tracking-[0.28em] text-fuchsia-200/80">
          <Trans>Playtesters</Trans>
        </p>
        <p className="mt-1 text-sm text-fuchsia-50/90">
          <Trans>They helped improving and polishing the game.</Trans>
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          {playtesters.map((playtester) => (
            <span
              key={playtester}
              className="rounded-full border border-fuchsia-300/30 bg-fuchsia-500/10 px-3 py-1 text-xs font-semibold text-fuchsia-100"
            >
              {playtester}
            </span>
          ))}
        </div>
      </div>

      <div className="divide-y divide-violet-300/10">
        <div className="py-3">
          <h3 className="font-semibold text-zinc-100">
            {abbreviateNsfwText(t`anon fapland inventor`, sfwMode)}
          </h3>
          <p className="text-xs text-zinc-400">
            {abbreviateNsfwText(
              t`The person who came up with the original fap land idea.`,
              sfwMode
            )}
          </p>
        </div>
        <div className="py-3">
          <h3 className="font-semibold text-zinc-100">FapLandPartyDev</h3>
          <p className="text-xs text-zinc-400">
            <Trans>Creator of the game.</Trans>
          </p>
        </div>
        <div className="py-3">
          <h3 className="font-semibold text-zinc-100">nakkub</h3>
          <p className="text-xs text-zinc-400">
            <Trans>Credit for the original Godot version.</Trans>
          </p>
        </div>
        <div className="py-3">
          <h3 className="font-semibold text-zinc-100">tomper</h3>
          <p className="text-xs text-zinc-400">
            <Trans>For</Trans>{" "}
            <a
              href="https://discuss.eroscripts.com/t/fapland-handy-edition/260780"
              target="_blank"
              rel="noreferrer"
              className="text-violet-300 hover:text-violet-200 underline decoration-violet-300/50 underline-offset-2"
              onMouseEnter={playHoverSound}
              onClick={playSelectSound}
            >
              <Trans>TheHandy version</Trans>
            </a>{" "}
            <Trans>that inspired this project.</Trans>
          </p>
        </div>
        <div className="py-3">
          <h3 className="font-semibold text-zinc-100">Davemakeswaves1</h3>
          <p className="text-xs text-zinc-400">
            <Trans>For providing an example of implementing TCode devices via</Trans>{" "}
            <a
              href="https://discuss.eroscripts.com/t/funsync-player-all-in-one-video-player-with-built-in-editor-eroscripts-search-multi-language-and-multi-device-sync/309393"
              target="_blank"
              rel="noreferrer"
              className="text-violet-300 hover:text-violet-200 underline decoration-violet-300/50 underline-offset-2"
              onMouseEnter={playHoverSound}
              onClick={playSelectSound}
            >
              FunSync Player
            </a>
            .
          </p>
        </div>
        <div className="py-3">
          <h3 className="font-semibold text-zinc-100">
            <Trans>Source Code</Trans>
          </h3>
          <p className="text-xs text-zinc-400">
            <Trans>Available on</Trans>{" "}
            <a
              href="https://github.com/FapLandPartyDev/FapLand-Party-Edition"
              target="_blank"
              rel="noreferrer"
              className="text-violet-300 hover:text-violet-200 underline decoration-violet-300/50 underline-offset-2"
              onMouseEnter={playHoverSound}
              onClick={playSelectSound}
            >
              GitHub
            </a>
          </p>
        </div>
        <div className="py-3">
          <h3 className="font-semibold text-zinc-100">
            <Trans>License</Trans>
          </h3>
          <p className="text-xs text-zinc-400">
            <span className="text-violet-100 font-bold">
              GNU Affero General Public License v3.0 (AGPL-3.0)
            </span>
          </p>
          <p className="mt-2 text-xs">
            <Link
              className="text-violet-300 underline decoration-violet-300/50 underline-offset-2 hover:text-violet-200"
              onMouseEnter={playHoverSound}
              onClick={playSelectSound}
              to="/licenses"
            >
              View bundled dependency licenses
            </Link>
          </p>
        </div>
      </div>
    </section>
  );
}

function MigrationCard() {
  const { t } = useLingui();
  const { showToast } = useToast();
  const [targetDirectory, setTargetDirectory] = useState<string | null>(null);
  const [deleteOriginals, setDeleteOriginals] = useState(false);
  const [isMigrating, setIsMigrating] = useState(false);
  const [isConfirmOpen, setIsConfirmOpen] = useState(false);
  const [result, setResult] = useState<{
    migrated: number;
    skipped: number;
    originalsDeleted: boolean;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const chooseTarget = async () => {
    try {
      const selected = await window.electronAPI.dialog.selectMigrationTargetDirectory();
      if (selected) {
        setTargetDirectory(selected);
        setResult(null);
        setError(null);
      }
    } catch (err) {
      console.error("Failed to select migration target", err);
    }
  };

  const startMigration = async () => {
    if (!targetDirectory || isMigrating) return;
    setIsMigrating(true);
    setError(null);
    setResult(null);
    try {
      const migrationResult = await trpc.migration.migratePaths.mutate({
        targetDirectory,
        deleteOriginals,
      });
      setResult({
        migrated: migrationResult.migrated.length,
        skipped: migrationResult.skipped.length,
        originalsDeleted: migrationResult.originalsDeleted,
      });
      showToast(
        t`Migration complete. ${migrationResult.migrated.length} paths migrated.`,
        "success"
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : t`Migration failed.`;
      setError(message);
      showToast(message, "error");
    } finally {
      setIsMigrating(false);
      setIsConfirmOpen(false);
    }
  };

  return (
    <section
      className="animate-entrance rounded-3xl border border-purple-400/25 bg-zinc-950/55 p-5 backdrop-blur-xl"
      style={{ animationDelay: "0.1s" }}
    >
      <div className="mb-4">
        <h2 className="text-lg font-extrabold tracking-tight text-violet-100">
          <Trans>Migrate Storage Paths</Trans>
        </h2>
        <p className="mt-1 text-sm text-zinc-300">
          <Trans>
            Copy all cache folders (web videos, music, EroScripts, .fpack extractions) to a new
            directory and update all settings to point there. Useful for moving data to a different
            drive or location.
          </Trans>
        </p>
      </div>

      {error ? (
        <div className="mb-4 rounded-xl border border-rose-300/35 bg-black/35 p-3 text-sm text-rose-100">
          {error}
        </div>
      ) : null}

      {result ? (
        <div className="mb-4 rounded-xl border border-emerald-300/35 bg-black/35 p-3 text-sm text-emerald-100">
          <Trans>
            Migration complete: {result.migrated} paths migrated
            {result.skipped > 0 ? `, ${result.skipped} skipped` : ""}.
          </Trans>
          {result.originalsDeleted ? (
            <span className="ml-1 text-zinc-400">
              <Trans>Original files have been deleted.</Trans>
            </span>
          ) : null}
        </div>
      ) : null}

      <div className="rounded-2xl border border-violet-300/25 bg-black/35 p-4">
        <div className="text-xs uppercase tracking-[0.18em] text-zinc-500">
          <Trans>Target Directory</Trans>
        </div>
        <div className="mt-2 break-all font-[family-name:var(--font-jetbrains-mono)] text-sm text-zinc-100">
          {targetDirectory ?? t`No directory selected`}
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            disabled={isMigrating}
            onMouseEnter={playHoverSound}
            onClick={chooseTarget}
            className="rounded-xl border border-violet-300/60 bg-violet-500/30 px-4 py-2 text-sm font-semibold text-violet-100 transition hover:border-violet-200/80 hover:bg-violet-500/45 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {t`Choose Target Directory`}
          </button>
          <button
            type="button"
            disabled={!targetDirectory || isMigrating}
            onMouseEnter={playHoverSound}
            onClick={() => {
              playSelectSound();
              setIsConfirmOpen(true);
            }}
            className="rounded-xl border border-emerald-300/60 bg-emerald-500/25 px-4 py-2 text-sm font-semibold text-emerald-100 transition hover:border-emerald-200/80 hover:bg-emerald-500/40 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isMigrating ? t`Migrating...` : t`Start Migration`}
          </button>
        </div>

        <label className="mt-4 flex items-center gap-2 text-sm text-zinc-300">
          <input
            type="checkbox"
            checked={deleteOriginals}
            onChange={(e) => setDeleteOriginals(e.target.checked)}
            className="rounded border-zinc-600 bg-zinc-800 text-violet-500 focus:ring-violet-400/50"
          />
          <Trans>Delete original files after successful migration</Trans>
        </label>
        <p className="mt-1 text-xs text-zinc-500">
          <Trans>
            When enabled, the original cache folders will be removed after all files have been
            copied successfully. Keep this off if you want to verify the migration first.
          </Trans>
        </p>
      </div>

      {isConfirmOpen ? (
        <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/70 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-3xl border border-violet-300/35 bg-zinc-950/95 p-6 shadow-[0_0_60px_rgba(139,92,246,0.28)]">
            <p className="font-[family-name:var(--font-jetbrains-mono)] text-xs uppercase tracking-[0.35em] text-violet-200/80">
              <Trans>Confirm Migration</Trans>
            </p>
            <h2 className="mt-3 text-2xl font-black tracking-tight text-violet-50">
              <Trans>Migrate Storage Paths</Trans>
            </h2>
            <p className="mt-2 text-sm text-zinc-400">
              <Trans>All cache data will be copied to:</Trans>
            </p>
            <p className="mt-1 break-all font-[family-name:var(--font-jetbrains-mono)] text-sm text-violet-200">
              {targetDirectory}
            </p>
            {deleteOriginals ? (
              <p className="mt-2 text-sm font-semibold text-rose-200">
                <Trans>Original files will be deleted after copying.</Trans>
              </p>
            ) : null}
            <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <button
                type="button"
                disabled={isMigrating}
                onMouseEnter={playHoverSound}
                onClick={() => setIsConfirmOpen(false)}
                className="rounded-xl border border-zinc-600 bg-zinc-900/80 px-4 py-2 text-sm font-semibold text-zinc-200 transition hover:border-zinc-400 hover:text-zinc-100 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Trans>Cancel</Trans>
              </button>
              <button
                type="button"
                disabled={isMigrating}
                onMouseEnter={playHoverSound}
                onClick={startMigration}
                className="rounded-xl border border-violet-300/70 bg-violet-500/30 px-4 py-2 text-sm font-semibold text-violet-100 transition hover:border-violet-200/90 hover:bg-violet-500/50 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isMigrating ? t`Migrating...` : t`Confirm Migration`}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}

type PortableDetection = {
  valid: boolean;
  reason?: string;
  exePath?: string;
  dataRoot?: string;
  databasePath?: string;
  existingDatabaseExists: boolean;
};

function MigrateToPortableCard() {
  const { t } = useLingui();
  const { showToast } = useToast();
  const [portableDirectory, setPortableDirectory] = useState<string | null>(null);
  const [detection, setDetection] = useState<PortableDetection | null>(null);
  const [isDetecting, setIsDetecting] = useState(false);
  const [isMigrating, setIsMigrating] = useState(false);
  const [isConfirmOpen, setIsConfirmOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [migrationResult, setMigrationResult] = useState<{
    migratedCaches: number;
    skippedCaches: number;
    databaseMigrated: boolean;
    storeConfigMigrated: boolean;
  } | null>(null);
  const [isWindows] = useState(() => {
    return typeof navigator !== "undefined" && /win/i.test(navigator.userAgent);
  });

  if (!isWindows) return null;

  const selectPortableDir = async () => {
    try {
      const selected = await window.electronAPI.dialog.selectPortableInstallation();
      if (!selected) return;
      setPortableDirectory(selected);
      setDetection(null);
      setError(null);
      setMigrationResult(null);
      setIsDetecting(true);
      try {
        const result = await trpc.migration.detectPortableInstallation.query({
          directory: selected,
        });
        setDetection(result);
      } catch (err) {
        setError(err instanceof Error ? err.message : t`Failed to detect portable installation.`);
      } finally {
        setIsDetecting(false);
      }
    } catch (err) {
      console.error("Failed to select portable directory", err);
    }
  };

  const startMigration = async () => {
    if (!portableDirectory || isMigrating) return;
    setIsMigrating(true);
    setError(null);
    setMigrationResult(null);
    try {
      const result = await trpc.migration.migrateToPortable.mutate({
        portableDirectory,
      });
      setMigrationResult({
        migratedCaches: result.migratedCaches.length,
        skippedCaches: result.skippedCaches.length,
        databaseMigrated: result.databaseMigrated,
        storeConfigMigrated: result.storeConfigMigrated,
      });
      showToast(t`Migration to portable complete.`, "success");
    } catch (err) {
      const message = err instanceof Error ? err.message : t`Migration failed.`;
      setError(message);
      showToast(message, "error");
    } finally {
      setIsMigrating(false);
      setIsConfirmOpen(false);
    }
  };

  return (
    <section
      className="animate-entrance rounded-3xl border border-purple-400/25 bg-zinc-950/55 p-5 backdrop-blur-xl"
      style={{ animationDelay: "0.11s" }}
    >
      <div className="mb-4">
        <h2 className="text-lg font-extrabold tracking-tight text-violet-100">
          <Trans>Migrate to Portable</Trans>
        </h2>
        <p className="mt-1 text-sm text-zinc-300">
          <Trans>
            Move all your data — cache folders, database, and settings — to an existing portable
            installation. Any existing data in the portable installation will be backed up first.
            After migration, launch the portable executable to use your migrated data.
          </Trans>
        </p>
      </div>

      {error ? (
        <div className="mb-4 rounded-xl border border-rose-300/35 bg-black/35 p-3 text-sm text-rose-100">
          {error}
        </div>
      ) : null}

      {migrationResult ? (
        <div className="mb-4 rounded-xl border border-emerald-300/35 bg-black/35 p-3 text-sm text-emerald-100">
          <Trans>
            Migration complete: {migrationResult.migratedCaches} cache folders migrated
            {migrationResult.databaseMigrated ? ", database copied" : ""}
            {migrationResult.storeConfigMigrated ? ", settings copied" : ""}.
          </Trans>
          <p className="mt-1 text-xs text-zinc-400">
            <Trans>
              Close this application and launch the portable executable to use your migrated data.
            </Trans>
          </p>
        </div>
      ) : null}

      <div className="rounded-2xl border border-violet-300/25 bg-black/35 p-4">
        <div className="text-xs uppercase tracking-[0.18em] text-zinc-500">
          <Trans>Portable Installation Directory</Trans>
        </div>
        <div className="mt-2 break-all font-[family-name:var(--font-jetbrains-mono)] text-sm text-zinc-100">
          {portableDirectory ?? t`No directory selected`}
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            disabled={isMigrating || isDetecting}
            onMouseEnter={playHoverSound}
            onClick={selectPortableDir}
            className="rounded-xl border border-violet-300/60 bg-violet-500/30 px-4 py-2 text-sm font-semibold text-violet-100 transition hover:border-violet-200/80 hover:bg-violet-500/45 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isDetecting ? t`Detecting...` : t`Select Portable Installation`}
          </button>
          <button
            type="button"
            disabled={!detection?.valid || isMigrating || isDetecting}
            onMouseEnter={playHoverSound}
            onClick={() => {
              playSelectSound();
              setIsConfirmOpen(true);
            }}
            className="rounded-xl border border-emerald-300/60 bg-emerald-500/25 px-4 py-2 text-sm font-semibold text-emerald-100 transition hover:border-emerald-200/80 hover:bg-emerald-500/40 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isMigrating ? t`Migrating...` : t`Start Migration`}
          </button>
        </div>

        {detection && !detection.valid ? (
          <div className="mt-3 rounded-xl border border-amber-300/35 bg-black/25 p-3 text-sm text-amber-100">
            {detection.reason}
          </div>
        ) : null}

        {detection?.valid ? (
          <div className="mt-3 space-y-1 rounded-xl border border-emerald-300/25 bg-black/25 p-3 text-sm">
            <div className="flex items-center gap-2 text-emerald-100">
              <svg
                className="h-4 w-4 shrink-0"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={3}
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
              <Trans>Valid portable installation detected</Trans>
            </div>
            {detection.exePath ? (
              <div className="pl-6 text-xs text-zinc-400">
                <Trans>Executable: {detection.exePath}</Trans>
              </div>
            ) : null}
            {detection.dataRoot ? (
              <div className="pl-6 text-xs text-zinc-400">
                <Trans>Data root: {detection.dataRoot}</Trans>
              </div>
            ) : null}
            {detection.databasePath ? (
              <div className="pl-6 text-xs text-zinc-400">
                <Trans>Database: {detection.databasePath}</Trans>
              </div>
            ) : null}
            {detection.existingDatabaseExists ? (
              <div className="pl-6 text-xs text-amber-300">
                <Trans>
                  An existing database was found and will be backed up before migration.
                </Trans>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>

      {isConfirmOpen ? (
        <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/70 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-3xl border border-violet-300/35 bg-zinc-950/95 p-6 shadow-[0_0_60px_rgba(139,92,246,0.28)]">
            <p className="font-[family-name:var(--font-jetbrains-mono)] text-xs uppercase tracking-[0.35em] text-violet-200/80">
              <Trans>Confirm Migration</Trans>
            </p>
            <h2 className="mt-3 text-2xl font-black tracking-tight text-violet-50">
              <Trans>Migrate to Portable</Trans>
            </h2>
            <p className="mt-2 text-sm text-zinc-400">
              <Trans>
                All cache data, your database, and settings will be copied to the portable
                installation. The app will need to be restarted using the portable executable
                afterwards.
              </Trans>
            </p>
            <p className="mt-1 break-all font-[family-name:var(--font-jetbrains-mono)] text-sm text-violet-200">
              {portableDirectory}
            </p>
            <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <button
                type="button"
                disabled={isMigrating}
                onMouseEnter={playHoverSound}
                onClick={() => setIsConfirmOpen(false)}
                className="rounded-xl border border-zinc-600 bg-zinc-900/80 px-4 py-2 text-sm font-semibold text-zinc-200 transition hover:border-zinc-400 hover:text-zinc-100 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Trans>Cancel</Trans>
              </button>
              <button
                type="button"
                disabled={isMigrating}
                onMouseEnter={playHoverSound}
                onClick={startMigration}
                className="rounded-xl border border-violet-300/70 bg-violet-500/30 px-4 py-2 text-sm font-semibold text-violet-100 transition hover:border-violet-200/90 hover:bg-violet-500/50 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isMigrating ? t`Migrating...` : t`Confirm Migration`}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
