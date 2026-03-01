import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  search: {
    sourceRoundId: "",
    heroName: "",
  },
  db: {
    hero: {
      findMany: vi.fn(),
    },
    round: {
      findInstalled: vi.fn(),
    },
  },
  storeGet: vi.fn(),
  selectConverterVideoFile: vi.fn(),
  selectConverterFunscriptFile: vi.fn(),
  file: {
    convertFileSrc: vi.fn((path: string) => `app://media/${encodeURIComponent(path)}`),
  },
}));

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (config: Record<string, unknown>) => ({
    ...config,
    useSearch: () => mocks.search,
  }),
  useNavigate: () => mocks.navigate,
}));

vi.mock("../services/db", () => ({
  db: mocks.db,
}));

vi.mock("../services/trpc", () => ({
  trpc: {
    store: {
      get: {
        query: mocks.storeGet,
      },
      set: {
        mutate: vi.fn().mockResolvedValue(null),
      },
    },
  },
}));

vi.mock("../utils/audio", () => ({
  playConverterAutoDetectSound: vi.fn(),
  playConverterMarkInSound: vi.fn(),
  playConverterMarkOutSound: vi.fn(),
  playConverterSaveSuccessSound: vi.fn(),
  playConverterSegmentAddSound: vi.fn(),
  playConverterSegmentDeleteSound: vi.fn(),
  playConverterValidationErrorSound: vi.fn(),
  playConverterZoomSound: vi.fn(),
  playHoverSound: vi.fn(),
  playSelectSound: vi.fn(),
}));

vi.mock("../components/AnimatedBackground", () => ({
  AnimatedBackground: () => null,
}));

vi.mock("../components/MenuButton", () => ({
  MenuButton: ({ label, onClick }: { label: string; onClick?: () => void }) => (
    <button type="button" onClick={onClick}>
      {label}
    </button>
  ),
}));

vi.mock("../services/converter", () => ({
  converter: {
    saveSegments: vi.fn(),
  },
}));

vi.mock("../game/media/playback", () => ({
  loadFunscriptTimeline: vi.fn().mockResolvedValue(null),
}));

vi.mock("../features/converter/detection", () => ({
  buildDetectedSegments: vi.fn(() => []),
}));

vi.mock("../features/converter/metadata", () => ({
  applyAutoMetadataToSegments: vi.fn((segments: unknown) => segments),
}));

vi.mock("../hooks/usePlayableVideoFallback", () => ({
  usePlayableVideoFallback: () => ({
    getVideoSrc: (uri: string) => uri,
    ensurePlayableVideo: vi.fn(),
    handleVideoError: vi.fn(),
  }),
}));

vi.mock("../features/converter/HeroPanel", () => ({
  HeroPanel: ({
    heroName,
    heroAuthor,
    heroDescription,
  }: {
    heroName: string;
    heroAuthor: string;
    heroDescription: string;
  }) => (
    <div data-testid="hero-panel">
      <input defaultValue={heroName} />
      <input defaultValue={heroAuthor} />
      <textarea defaultValue={heroDescription} />
    </div>
  ),
  pickHeroPanelProps: (state: unknown) => state,
}));

vi.mock("../features/converter/VideoPreview", () => ({
  VideoPreview: ({ videoUri }: { videoUri: string }) => (
    <div data-testid="video-preview" data-video-uri={videoUri} />
  ),
  pickVideoPreviewProps: (state: unknown) => state,
}));

vi.mock("../features/converter/Timeline", () => ({
  Timeline: () => <div data-testid="timeline" />,
  pickTimelineProps: (state: unknown) => state,
}));

vi.mock("../features/converter/AutoDetectionPanel", () => ({
  AutoDetectionPanel: ({ funscriptUri }: { funscriptUri: string | null }) => (
    <div data-testid="auto-detection-panel" data-funscript-uri={funscriptUri ?? ""} />
  ),
  pickAutoDetectionPanelProps: (state: unknown) => state,
}));

vi.mock("../features/converter/SegmentList", () => ({
  SegmentList: ({
    sortedSegments,
    onSetSegmentCutMarkIn,
    onAddCutToSegmentFromLocalMarks,
  }: {
    sortedSegments: Array<{ id: string; customName?: string }>;
    onSetSegmentCutMarkIn?: (segmentId: string) => void;
    onAddCutToSegmentFromLocalMarks?: (segmentId: string) => void;
  }) => (
    <div data-testid="segment-list">
      <span data-testid="segment-list-local-cut-ready">
        {typeof onSetSegmentCutMarkIn === "function" &&
        typeof onAddCutToSegmentFromLocalMarks === "function"
          ? "yes"
          : "no"}
      </span>
      {sortedSegments.map((seg, i) => (
        <span key={seg.id}>{seg.customName ?? `Round ${i + 1}`}</span>
      ))}
    </div>
  ),
  pickSegmentListProps: (state: unknown) => state,
}));

vi.mock("../features/converter/StatusBar", () => ({
  StatusBar: ({ message, error }: { message: string | null; error: string | null }) => (
    <div data-testid="status-bar">
      {message && <span data-testid="status-message">{message}</span>}
      {error && <span data-testid="status-error">{error}</span>}
    </div>
  ),
}));

vi.mock("../features/converter/HotkeyOverlay", () => ({
  HotkeyOverlay: ({ visible }: { visible: boolean }) =>
    visible ? <div data-testid="hotkey-overlay" /> : null,
}));

vi.mock("../features/converter/ConverterHeader", () => ({
  ConverterHeader: ({
    selectedSourceInfo,
    onGoToSelect,
  }: {
    selectedSourceInfo: { kind: string; id: string; name: string } | null;
    onGoToSelect: () => void;
  }) => (
    <div data-testid="converter-header">
      <span>{selectedSourceInfo?.name}</span>
      <button type="button" onClick={onGoToSelect}>
        Change Source
      </button>
    </div>
  ),
  pickConverterHeaderProps: (state: {
    selectedSourceInfo?: { kind: string; id: string; name: string } | null;
  }) => ({
    selectedSourceInfo: state.selectedSourceInfo ?? null,
  }),
}));

import { Route } from "./converter";

function makeRound(
  id: string,
  name: string,
  overrides: Partial<{
    videoUri: string;
    funscriptUri: string | null;
    heroId: string | null;
    hero: {
      id: string;
      name: string;
      author: string | null;
      description: string | null;
    } | null;
    startTime: number | null;
    endTime: number | null;
    createdAt: Date;
    updatedAt: Date;
    previewImage: string | null;
  }> = {}
) {
  return {
    id,
    name,
    description: null,
    author: null,
    type: "Normal" as const,
    difficulty: null,
    bpm: null,
    startTime: overrides.startTime ?? null,
    endTime: overrides.endTime ?? null,
    createdAt: overrides.createdAt ?? new Date("2026-03-03T11:00:00.000Z"),
    updatedAt: overrides.updatedAt ?? new Date("2026-03-03T11:00:00.000Z"),
    heroId: overrides.heroId ?? null,
    hero: overrides.hero ?? null,
    resources: [
      {
        id: `res-${id}`,
        roundId: id,
        videoUri: overrides.videoUri ?? "file:///tmp/test.mp4",
        funscriptUri: overrides.funscriptUri ?? null,
        phash: null,
        disabled: false,
        createdAt: new Date("2026-03-03T11:00:00.000Z"),
        updatedAt: new Date("2026-03-03T11:00:00.000Z"),
      },
    ],
    installSourceKey: null,
    previewImage: overrides.previewImage ?? null,
    phash: null,
  };
}

function createDeferredPromise<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

beforeEach(() => {
  mocks.search.sourceRoundId = "";
  mocks.search.heroName = "";
  window.electronAPI = {
    file: {
      convertFileSrc: mocks.file.convertFileSrc,
    },
    dialog: {
      selectConverterVideoFile: mocks.selectConverterVideoFile,
      selectConverterFunscriptFile: mocks.selectConverterFunscriptFile,
    },
  } as unknown as typeof window.electronAPI;
  mocks.db.round.findInstalled.mockResolvedValue([makeRound("round-1", "Installed Round")]);
  mocks.db.hero.findMany.mockResolvedValue([
    {
      id: "hero-1",
      name: "Existing Hero",
      author: "Author A",
      description: "Loaded from library",
    },
  ]);
  mocks.storeGet.mockResolvedValue(null);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("ConverterPage", () => {
  describe("Selection Step", () => {
    it("shows sidebar navigation sections", () => {
      const Component = (Route as unknown as { component: React.FC }).component;
      render(<Component />);

      expect(screen.getByRole("button", { name: /From Round/ })).toBeDefined();
      expect(screen.getByRole("button", { name: /From Hero/ })).toBeDefined();
      expect(screen.getByRole("button", { name: /From File/ })).toBeDefined();
      expect(screen.getByRole("button", { name: /From URL/ })).toBeDefined();
    });

    it("shows back button in sidebar that navigates home", () => {
      const Component = (Route as unknown as { component: React.FC }).component;
      render(<Component />);

      fireEvent.click(screen.getByRole("button", { name: "← Back" }));

      expect(mocks.navigate).toHaveBeenCalledWith({ to: "/" });
    });

    it("shows round selection cards when on 'From Round' section", async () => {
      mocks.db.round.findInstalled.mockResolvedValue([
        makeRound("round-standalone", "Standalone Source"),
        makeRound("round-hero", "Hero Source", {
          heroId: "hero-1",
          hero: {
            id: "hero-1",
            name: "Existing Hero",
            author: "Author A",
            description: "Loaded from library",
          },
        }),
      ]);

      const Component = (Route as unknown as { component: React.FC }).component;
      render(<Component />);

      await waitFor(() => {
        expect(mocks.db.round.findInstalled).toHaveBeenCalledWith(true);
      });

      await waitFor(() => {
        expect(screen.getByRole("button", { name: /Standalone Source/ })).toBeDefined();
      });

      expect(screen.queryByRole("button", { name: /Hero Source/ })).toBeNull();
    });

    it("shows a skeleton loader while installed rounds are still loading", async () => {
      const roundsDeferred = createDeferredPromise<ReturnType<typeof makeRound>[]>();
      mocks.db.round.findInstalled.mockReturnValue(roundsDeferred.promise);

      const Component = (Route as unknown as { component: React.FC }).component;
      render(<Component />);

      expect(screen.getByLabelText("Loading rounds")).toBeDefined();
      expect(screen.queryByText("Loading...")).toBeNull();

      roundsDeferred.resolve([makeRound("round-1", "Loaded Round")]);

      await waitFor(() => {
        expect(screen.getByRole("button", { name: /Loaded Round/ })).toBeDefined();
      });
    });

    it("renders the round media preview in the converter picker", async () => {
      mocks.db.round.findInstalled.mockResolvedValue([
        makeRound("round-preview", "Preview Source", {
          videoUri: "file:///tmp/preview-source.mp4",
          previewImage: "data:image/png;base64,preview",
          startTime: 1000,
          endTime: 5000,
        }),
      ]);

      const Component = (Route as unknown as { component: React.FC }).component;
      render(<Component />);

      await waitFor(() => {
        expect(screen.getByRole("button", { name: /Preview Source/ })).toBeDefined();
      });

      expect(screen.getByAltText("Preview Source preview")).toBeDefined();
    });

    it("replaces the converter picker preview with the safe mode guard", async () => {
      mocks.storeGet.mockResolvedValue(true);
      mocks.db.round.findInstalled.mockResolvedValue([
        makeRound("round-preview", "Preview Source", {
          videoUri: "file:///tmp/preview-source.mp4",
          previewImage: "data:image/png;base64,preview",
        }),
      ]);

      const Component = (Route as unknown as { component: React.FC }).component;
      render(<Component />);

      await waitFor(() => {
        expect(screen.getByRole("button", { name: /Preview Source/ })).toBeDefined();
      });

      await waitFor(() => {
        expect(screen.getByText("Safe Mode Enabled")).toBeDefined();
        expect(screen.queryByAltText("Preview Source preview")).toBeNull();
      });
    });

    it("shows hero selection cards when switching to 'From Hero' section", async () => {
      mocks.db.round.findInstalled.mockResolvedValue([
        makeRound("round-hero", "Hero Source", {
          heroId: "hero-1",
          hero: {
            id: "hero-1",
            name: "Existing Hero",
            author: "Author A",
            description: "Loaded from library",
          },
          startTime: 1000,
          endTime: 9000,
        }),
      ]);

      const Component = (Route as unknown as { component: React.FC }).component;
      render(<Component />);

      fireEvent.click(screen.getByRole("button", { name: /From Hero/ }));

      await waitFor(() => {
        expect(screen.getByRole("button", { name: /Existing Hero/ })).toBeDefined();
      });
    });

    it("shows file picker buttons when switching to 'From File' section", () => {
      const Component = (Route as unknown as { component: React.FC }).component;
      render(<Component />);

      fireEvent.click(screen.getByRole("button", { name: /From File/ }));

      expect(screen.getByRole("button", { name: "Select Video File" })).toBeDefined();
      expect(screen.getByRole("button", { name: "Select Funscript File" })).toBeDefined();
    });

    it("shows website url inputs when switching to 'From URL' section", () => {
      const Component = (Route as unknown as { component: React.FC }).component;
      render(<Component />);

      fireEvent.click(screen.getByRole("button", { name: /From URL/ }));

      expect(screen.getByLabelText("Video URL")).toBeDefined();
      expect(screen.getByLabelText("Funscript URL")).toBeDefined();
      expect(screen.getByRole("button", { name: "Use Website Source" })).toBeDefined();
    });
  });

  describe("Edit Step - Round Selection", () => {
    it("loads a preselected website-backed round from search params", async () => {
      mocks.search.sourceRoundId = "web-round";
      mocks.search.heroName = "Website Round";
      mocks.db.round.findInstalled.mockResolvedValue([
        makeRound("web-round", "Website Round", {
          videoUri: "app://external/web-url?target=https%3A%2F%2Fexample.com%2Fwatch%3Fv%3D123",
        }),
      ]);

      const Component = (Route as unknown as { component: React.FC }).component;
      render(<Component />);

      await waitFor(() => {
        expect(screen.getByRole("button", { name: "Change Source" })).toBeDefined();
      });

      await waitFor(() => {
        expect(screen.getByTestId("video-preview").getAttribute("data-video-uri")).toBe(
          "app://external/web-url?target=https%3A%2F%2Fexample.com%2Fwatch%3Fv%3D123"
        );
      });

      expect(screen.getByDisplayValue("Website Round")).toBeDefined();
    });

    it("transitions to edit mode when clicking a round card", async () => {
      mocks.db.round.findInstalled.mockResolvedValue([
        makeRound("round-1", "Standalone Source", {
          startTime: 1000,
          endTime: 9000,
        }),
      ]);

      const Component = (Route as unknown as { component: React.FC }).component;
      render(<Component />);

      await waitFor(() => {
        expect(screen.getByRole("button", { name: /Standalone Source/ })).toBeDefined();
      });

      fireEvent.click(screen.getByRole("button", { name: /Standalone Source/ }));

      await waitFor(() => {
        expect(screen.getByRole("button", { name: "Change Source" })).toBeDefined();
      });

      expect(screen.getByDisplayValue("Standalone Source")).toBeDefined();
    });

    it("passes local segment cutting controls into the edit-step segment list", async () => {
      mocks.db.round.findInstalled.mockResolvedValue([
        makeRound("round-1", "Standalone Source", {
          startTime: 1000,
          endTime: 9000,
        }),
      ]);

      const Component = (Route as unknown as { component: React.FC }).component;
      render(<Component />);

      await waitFor(() => {
        expect(screen.getByRole("button", { name: /Standalone Source/ })).toBeDefined();
      });

      fireEvent.click(screen.getByRole("button", { name: /Standalone Source/ }));

      await waitFor(() => {
        expect(screen.getByTestId("segment-list-local-cut-ready").textContent).toContain("yes");
      });
    });

    it("shows 'Change Source' button in edit mode that returns to selection", async () => {
      mocks.db.round.findInstalled.mockResolvedValue([
        makeRound("round-1", "Test Round", {
          startTime: 1000,
          endTime: 9000,
        }),
      ]);

      const Component = (Route as unknown as { component: React.FC }).component;
      render(<Component />);

      await waitFor(() => {
        expect(screen.getByRole("button", { name: /Test Round/ })).toBeDefined();
      });

      fireEvent.click(screen.getByRole("button", { name: /Test Round/ }));

      await waitFor(() => {
        expect(screen.getByRole("button", { name: "Change Source" })).toBeDefined();
      });

      fireEvent.click(screen.getByRole("button", { name: "Change Source" }));

      await waitFor(() => {
        expect(screen.getByRole("button", { name: /From Round/ })).toBeDefined();
      });
    });
  });

  describe("Edit Step - Hero Selection", () => {
    it("loads hero metadata and rounds when clicking a hero card", async () => {
      mocks.db.round.findInstalled.mockResolvedValue([
        makeRound("round-hero", "Hero Source", {
          heroId: "hero-1",
          hero: {
            id: "hero-1",
            name: "Existing Hero",
            author: "Author A",
            description: "Loaded from library",
          },
          videoUri: "file:///tmp/hero-source.mp4",
          funscriptUri: "file:///tmp/hero-source.funscript",
          startTime: 1000,
          endTime: 9000,
        }),
      ]);

      const Component = (Route as unknown as { component: React.FC }).component;
      render(<Component />);

      fireEvent.click(screen.getByRole("button", { name: /From Hero/ }));

      await waitFor(() => {
        expect(screen.getByRole("button", { name: /Existing Hero/ })).toBeDefined();
      });

      fireEvent.click(screen.getByRole("button", { name: /Existing Hero/ }));

      await waitFor(() => {
        expect(screen.getByDisplayValue("Existing Hero")).toBeDefined();
        expect(screen.getByDisplayValue("Author A")).toBeDefined();
        expect(screen.getByDisplayValue("Loaded from library")).toBeDefined();
      });
    });

    it("loads all attached rounds as segments when selecting a hero", async () => {
      mocks.db.round.findInstalled.mockResolvedValue([
        makeRound("round-early", "Earlier Source", {
          heroId: "hero-1",
          hero: {
            id: "hero-1",
            name: "Existing Hero",
            author: "Author A",
            description: "Loaded from library",
          },
          videoUri: "file:///tmp/earlier.mp4",
          startTime: 1000,
          endTime: 5000,
          createdAt: new Date("2026-03-02T11:00:00.000Z"),
        }),
        makeRound("round-late", "Later Source", {
          heroId: "hero-1",
          hero: {
            id: "hero-1",
            name: "Existing Hero",
            author: "Author A",
            description: "Loaded from library",
          },
          videoUri: "file:///tmp/later.mp4",
          startTime: 5000,
          endTime: 9000,
          createdAt: new Date("2026-03-04T11:00:00.000Z"),
        }),
      ]);

      const Component = (Route as unknown as { component: React.FC }).component;
      render(<Component />);

      fireEvent.click(screen.getByRole("button", { name: /From Hero/ }));

      await waitFor(() => {
        expect(screen.getByRole("button", { name: /Existing Hero/ })).toBeDefined();
      });

      fireEvent.click(screen.getByRole("button", { name: /Existing Hero/ }));

      await waitFor(() => {
        expect(screen.getByTestId("video-preview").getAttribute("data-video-uri")).toBe(
          "file:///tmp/earlier.mp4"
        );
        expect(screen.getByText("Earlier Source")).toBeDefined();
        expect(screen.getByText("Later Source")).toBeDefined();
      });
    });

    it("shows error when hero has no usable rounds", async () => {
      mocks.db.round.findInstalled.mockResolvedValue([]);

      const Component = (Route as unknown as { component: React.FC }).component;
      render(<Component />);

      fireEvent.click(screen.getByRole("button", { name: /From Hero/ }));

      await waitFor(() => {
        expect(screen.getByText(/No heroes with rounds available/)).toBeDefined();
      });
    });
  });

  describe("Edit Step - Local File", () => {
    it("transitions to edit mode when selecting a local video file", async () => {
      mocks.selectConverterVideoFile.mockResolvedValue("/path/to/local-video.mp4");

      const Component = (Route as unknown as { component: React.FC }).component;
      render(<Component />);

      fireEvent.click(screen.getByRole("button", { name: /From File/ }));
      fireEvent.click(screen.getByRole("button", { name: "Select Video File" }));

      await waitFor(() => {
        expect(screen.getByRole("button", { name: "Change Source" })).toBeDefined();
      });

      expect(screen.getByText("local-video.mp4")).toBeDefined();
    });

    it("keeps a funscript attached before selecting a local video file", async () => {
      mocks.selectConverterFunscriptFile.mockResolvedValue("/path/to/local-video.funscript");
      mocks.selectConverterVideoFile.mockResolvedValue("/path/to/local-video.mp4");

      const Component = (Route as unknown as { component: React.FC }).component;
      render(<Component />);

      fireEvent.click(screen.getByRole("button", { name: /From File/ }));
      fireEvent.click(screen.getByRole("button", { name: "Select Funscript File" }));

      await waitFor(() => {
        expect(screen.getByText("Local funscript attached: local-video.funscript")).toBeDefined();
      });

      fireEvent.click(screen.getByRole("button", { name: "Select Video File" }));

      await waitFor(() => {
        expect(screen.getByRole("button", { name: "Change Source" })).toBeDefined();
      });

      expect(screen.getByTestId("auto-detection-panel").getAttribute("data-funscript-uri")).toBe(
        "app://media/%2Fpath%2Fto%2Flocal-video.funscript"
      );
      expect(screen.getByTestId("video-preview").getAttribute("data-video-uri")).toBe(
        "app://media/%2Fpath%2Fto%2Flocal-video.mp4"
      );
    });

    it("transitions to edit mode when submitting a website video url", async () => {
      const Component = (Route as unknown as { component: React.FC }).component;
      render(<Component />);

      fireEvent.click(screen.getByRole("button", { name: /From URL/ }));
      fireEvent.change(screen.getByLabelText("Video URL"), {
        target: { value: "https://www.xhamster.com/videos/test-video-123" },
      });
      fireEvent.change(screen.getByLabelText("Funscript URL"), {
        target: { value: "https://cdn.example.com/test-video.funscript" },
      });
      fireEvent.click(screen.getByRole("button", { name: "Use Website Source" }));

      await waitFor(() => {
        expect(screen.getByRole("button", { name: "Change Source" })).toBeDefined();
      });

      expect(screen.getByText("xhamster.com")).toBeDefined();
      expect(screen.getByTestId("status-message").textContent).toContain("Website source loaded");
    });
  });
});
