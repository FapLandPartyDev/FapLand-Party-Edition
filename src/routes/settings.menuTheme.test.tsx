import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  search: { section: undefined as string | undefined },
  navigate: vi.fn(),
  setLocale: vi.fn(async () => {}),
}));

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => () => ({
    useSearch: () => mocks.search,
  }),
  Link: ({ children }: { children: ReactNode }) => <a>{children}</a>,
  useNavigate: () => mocks.navigate,
}));

vi.mock("../components/AnimatedBackground", () => ({
  AnimatedBackground: () => null,
}));

vi.mock("../components/ui/GameDropdown", () => ({
  GameDropdown: ({
    value,
    options,
    onChange,
    disabled,
  }: {
    value: string;
    options: Array<{ value: string; label: string }>;
    onChange: (next: string) => void;
    disabled?: boolean;
  }) => (
    <select
      aria-label="setting-select"
      value={value}
      disabled={disabled}
      onChange={(event) => onChange(event.target.value)}
    >
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  ),
}));

vi.mock("../components/ui/ToastHost", () => ({
  useToast: () => ({ showToast: vi.fn() }),
}));

vi.mock("../controller", () => ({
  useControllerSurface: vi.fn(),
}));

vi.mock("../hooks/useIdleScreenPerformance", () => ({
  useIdleScreenPerformance: vi.fn(),
}));

vi.mock("../hooks/useAppUpdate", () => ({
  useAppUpdate: () => ({
    state: {
      status: "up_to_date",
      currentVersion: "0.1.2",
      latestVersion: "0.1.2",
      checkedAtIso: null,
      releasePageUrl: null,
      downloadUrl: null,
      releaseNotes: null,
      publishedAtIso: null,
      canAutoUpdate: false,
      errorMessage: null,
    },
    isBusy: false,
    actionLabel: "Check Again",
    menuBadge: undefined,
    menuTone: "success",
    systemMessage: "",
    triggerPrimaryAction: vi.fn(async () => {}),
  }),
}));

vi.mock("../hooks/useSfwMode", () => ({
  useSfwMode: () => false,
}));

vi.mock("../i18n", () => ({
  useLocale: () => ({
    locale: "en",
    locales: [{ code: "en", label: "English" }],
    setLocale: mocks.setLocale,
  }),
}));

vi.mock("../services/booru", () => ({
  ensureBooruMediaCache: vi.fn(),
  clearBooruMediaCache: vi.fn(),
}));

vi.mock("../services/db", () => ({
  db: {
    install: {
      getAutoScanFolders: vi.fn(async () => []),
    },
  },
}));

vi.mock("../services/integrations", () => ({
  integrations: {
    listSources: vi.fn(async () => []),
    getSyncStatus: vi.fn(async () => null),
  },
}));

vi.mock("../services/trpc", () => ({
  trpc: {
    binaries: {
      getResolvedVersions: {
        query: vi.fn(async () => ({
          ffmpeg: { tool: "ffmpeg", preference: "auto", source: "bundled", path: "", version: "" },
          ffprobe: {
            tool: "ffprobe",
            preference: "auto",
            source: "bundled",
            path: "",
            version: "",
          },
          ytDlp: { tool: "yt-dlp", preference: "auto", source: "bundled", path: "", version: "" },
          checkedAtIso: null,
        })),
      },
    },
    eroscripts: {
      getLoginStatus: {
        query: vi.fn(async () => ({ loggedIn: false, username: null, hasCredentials: false })),
      },
    },
    store: {
      getMany: {
        query: vi.fn(async ({ keys }: { keys: string[] }) => {
          const values: Record<string, unknown> = {};
          for (const key of keys) {
            values[key] = key === "display.mainMenuTheme" ? null : null;
          }
          return values;
        }),
      },
      get: {
        query: vi.fn(async () => null),
      },
      set: {
        mutate: vi.fn(async () => {}),
      },
    },
    debug: {
      getState: {
        query: vi.fn(async () => ({
          logLevel: "off",
          anonymizedLogFilePath: "/logs/app.log",
          logFileSizeBytes: 0,
        })),
      },
      getDiagnostics: {
        query: vi.fn(async () => ({
          app: {},
          storage: {},
          hardware: {},
          database: {},
          runtime: {},
          collectionErrors: [],
        })),
      },
      getAllSettings: {
        query: vi.fn(async () => ({})),
      },
    },
  },
}));

vi.mock("../utils/audio", () => ({
  playHoverSound: vi.fn(),
  playSelectSound: vi.fn(),
}));

import { MENU_THEME_CHANGED_EVENT, MENU_THEME_KEY } from "../constants/menuThemeSettings";
import { trpc } from "../services/trpc";
import { SettingsPage } from "./settings";

describe("Settings main menu theme", () => {
  beforeEach(() => {
    cleanup();
    mocks.search.section = undefined;
    vi.mocked(trpc.store.set.mutate).mockClear();

    window.electronAPI = {
      file: { convertFileSrc: vi.fn() },
      window: {
        isFullscreen: vi.fn(async () => false),
        setFullscreen: vi.fn(async () => false),
        getZoomPercent: vi.fn(async () => 100),
        subscribeToZoom: vi.fn(() => () => {}),
      },
      eroscripts: {
        subscribeToLoginStatus: vi.fn(() => () => {}),
      },
    } as typeof window.electronAPI;
  });

  it("renders, defaults, persists, and broadcasts the main menu theme setting", async () => {
    const themeEvents: string[] = [];
    const handleThemeChange = (event: Event) => {
      themeEvents.push(String((event as CustomEvent<string>).detail));
    };
    window.addEventListener(MENU_THEME_CHANGED_EVENT, handleThemeChange);

    try {
      render(<SettingsPage />);

      const label = await screen.findByText("App Theme");
      expect(screen.getByText("Choose the color scheme used outside the gameboard.")).toBeDefined();
      const row = label.closest(".rounded-2xl");
      expect(row).toBeTruthy();
      const controls = within(row as HTMLElement);
      const select = controls.getByLabelText("setting-select") as HTMLSelectElement;
      expect(select.value).toBe("classic");

      fireEvent.change(select, { target: { value: "ember" } });
      fireEvent.click(controls.getByRole("button", { name: "Save" }));

      await waitFor(() => {
        expect(trpc.store.set.mutate).toHaveBeenCalledWith({
          key: MENU_THEME_KEY,
          value: "ember",
        });
        expect(themeEvents).toContain("ember");
      });
    } finally {
      window.removeEventListener(MENU_THEME_CHANGED_EVENT, handleThemeChange);
    }
  });
});
