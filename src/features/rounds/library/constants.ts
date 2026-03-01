import type { GroupMode, SectionId } from "./types";

export const INTERMEDIARY_LOADING_PROMPT_KEY = "game.intermediary.loadingPrompt";
export const INTERMEDIARY_LOADING_DURATION_KEY = "game.intermediary.loadingDurationSec";
export const INTERMEDIARY_RETURN_PAUSE_KEY = "game.intermediary.returnPauseSec";

export const DEFAULT_INTERMEDIARY_LOADING_DURATION_SEC = 5;
export const DEFAULT_INTERMEDIARY_RETURN_PAUSE_SEC = 4;

export const ROUND_CARD_PREVIEW_HOVER_DELAY_MS = 600;

export const INSTALL_SCAN_POLL_INTERVAL_MS = 2000;
export const INSTALL_SCAN_MESSAGE_POLL_INTERVAL_MS = 4000;
export const EXPORT_STATUS_POLL_INTERVAL_MS = 1500;
export const WEB_VIDEO_CACHE_POLL_INTERVAL_MS = 2000;

export const CARD_MIN_WIDTH_PX = 320;

export const ROUNDS_LIBRARY_QUERY_KEY = ["rounds", "library"] as const;
export const ROUNDS_CATALOG_QUERY_KEY = ["rounds", "catalog"] as const;
export const ROUNDS_DISABLED_QUERY_KEY = ["rounds", "disabled"] as const;
export const PLAYLISTS_QUERY_KEY = ["playlists"] as const;
export const PREVIEW_SETTINGS_QUERY_KEY = ["rounds", "preview-settings"] as const;
export const INSTALL_SCAN_QUERY_KEY = ["rounds", "install-scan-status"] as const;
export const EXPORT_PACKAGE_STATUS_QUERY_KEY = ["rounds", "export-package-status"] as const;
export const WEB_VIDEO_CACHE_QUERY_KEY = ["rounds", "web-video-cache"] as const;
export const WEB_INSTALL_SETTINGS_QUERY_KEY = ["rounds", "web-install-settings"] as const;

export const ROUND_DATE_FORMATTER = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
  year: "numeric",
});

export const LIBRARY_SECTIONS: ReadonlyArray<{
  id: SectionId;
  icon: string;
}> = [
  { id: "library", icon: "📚" },
  { id: "transfer", icon: "📦" },
];

export const GROUP_MODE_OPTIONS: ReadonlyArray<{ value: GroupMode; icon: string }> = [
  { value: "hero", icon: "🦸" },
  { value: "playlist", icon: "📋" },
];

export const DEFAULT_EXPORT_COMPRESSION_STRENGTH = 80;
