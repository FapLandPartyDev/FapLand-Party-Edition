import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  db: {
    hero: {
      findMany: vi.fn(),
    },
    round: {
      findInstalled: vi.fn(),
    },
  },
  storeGet: vi.fn(),
}));

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (config: Record<string, unknown>) => ({
    ...config,
    useSearch: () => ({
      sourceRoundId: "",
      heroName: "",
    }),
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
    <button type="button" onClick={onClick}>{label}</button>
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

import { Route } from "./converter";

function expectTextContent(node: HTMLElement, expected: string) {
  expect(node.textContent ?? "").toContain(expected);
}

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
  }> = {},
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
    previewImage: null,
    phash: null,
  };
}

beforeEach(() => {
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
  it("loads an attached round source and hero metadata into the converter", async () => {
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

    await waitFor(() => {
      expect(mocks.db.hero.findMany).toHaveBeenCalled();
    });

    fireEvent.change(screen.getByRole("combobox"), {
      target: { value: "hero-1" },
    });

    fireEvent.click(screen.getByRole("button", { name: "Load Hero" }));

    await waitFor(() => {
      expect(screen.getByDisplayValue("Existing Hero")).toBeDefined();
      expect(screen.getByDisplayValue("Author A")).toBeDefined();
      expect(screen.getByDisplayValue("Loaded from library")).toBeDefined();
      expectTextContent(screen.getByText(/Video:/), "file:///tmp/hero-source.mp4");
      expectTextContent(screen.getByText(/Funscript:/), "file:///tmp/hero-source.funscript");
      expect(screen.getByText(/Loaded hero "Existing Hero" from attached round "Hero Source \[Existing Hero\]"\./)).toBeDefined();
      expect(screen.getByText("Round 1")).toBeDefined();
    });
  });

  it("chooses the earliest attached round deterministically when multiple exist", async () => {
    mocks.db.round.findInstalled.mockResolvedValue([
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
    ]);

    const Component = (Route as unknown as { component: React.FC }).component;
    render(<Component />);

    await waitFor(() => {
      expect(mocks.db.hero.findMany).toHaveBeenCalled();
    });

    fireEvent.change(screen.getByRole("combobox"), {
      target: { value: "hero-1" },
    });

    fireEvent.click(screen.getByRole("button", { name: "Load Hero" }));

    await waitFor(() => {
      expectTextContent(screen.getByText(/Video:/), "file:///tmp/earlier.mp4");
      expect(screen.getByText(/Loaded hero "Existing Hero" from attached round "Earlier Source \[Existing Hero\]"\./)).toBeDefined();
      expect(screen.getByText("Round 1")).toBeDefined();
      expect(screen.getByText("Round 2")).toBeDefined();
    });
  });

  it("loads attached round timing metadata into segments when loading a hero source", async () => {
    mocks.db.round.findInstalled.mockResolvedValue([
      makeRound("round-timed", "Timed Source", {
        heroId: "hero-1",
        hero: {
          id: "hero-1",
          name: "Existing Hero",
          author: "Author A",
          description: "Loaded from library",
        },
        videoUri: "file:///tmp/timed.mp4",
        funscriptUri: "file:///tmp/timed.funscript",
        startTime: 1000,
        endTime: 9000,
      }),
    ]);

    const Component = (Route as unknown as { component: React.FC }).component;
    render(<Component />);

    await waitFor(() => {
      expect(mocks.db.hero.findMany).toHaveBeenCalled();
    });

    fireEvent.change(screen.getByRole("combobox"), {
      target: { value: "hero-1" },
    });

    fireEvent.click(screen.getByRole("button", { name: "Load Hero" }));

    await waitFor(() => {
      expectTextContent(screen.getByText(/Video:/), "file:///tmp/timed.mp4");
      expectTextContent(screen.getByText(/Funscript:/), "file:///tmp/timed.funscript");
      expect(screen.getByText("Round 1")).toBeDefined();
      expect(screen.getByText(/00:01.00/)).toBeDefined();
      expect(screen.getByText(/00:09.00/)).toBeDefined();
    });
  });

  it("supports external installed resources when loading a hero source", async () => {
    mocks.db.round.findInstalled.mockResolvedValue([
      makeRound("round-external", "Stash Source", {
        heroId: "hero-1",
        hero: {
          id: "hero-1",
          name: "Existing Hero",
          author: "Author A",
          description: "Loaded from library",
        },
        videoUri: "app://external/stash?sourceId=stash-1&target=https%3A%2F%2Fstash.example.com%2Fscene%2F1%2Fstream",
        funscriptUri: "app://external/stash?sourceId=stash-1&target=https%3A%2F%2Fstash.example.com%2Fscene%2F1%2Ffunscript",
      }),
    ]);

    const Component = (Route as unknown as { component: React.FC }).component;
    render(<Component />);

    await waitFor(() => {
      expect(mocks.db.hero.findMany).toHaveBeenCalled();
    });

    fireEvent.change(screen.getByRole("combobox"), {
      target: { value: "hero-1" },
    });

    fireEvent.click(screen.getByRole("button", { name: "Load Hero" }));

    await waitFor(() => {
      expectTextContent(screen.getByText(/Video:/), "app://external/stash?sourceId=stash-1");
      expectTextContent(screen.getByText(/Funscript:/), "app://external/stash?sourceId=stash-1");
      expect(screen.getByText(/Loaded hero "Existing Hero" from attached round "Stash Source \[Existing Hero\]"\./)).toBeDefined();
    });
  });

  it("shows an error and leaves the current source unchanged when the hero has no usable attached round", async () => {
    mocks.db.round.findInstalled.mockResolvedValue([
      makeRound("round-other", "Other Source", {
        heroId: "hero-2",
        hero: {
          id: "hero-2",
          name: "Other Hero",
          author: "Author B",
          description: "Other description",
        },
        videoUri: "file:///tmp/other.mp4",
      }),
    ]);

    const Component = (Route as unknown as { component: React.FC }).component;
    render(<Component />);

    await waitFor(() => {
      expect(mocks.db.hero.findMany).toHaveBeenCalled();
    });

    expectTextContent(screen.getByText(/Video:/), "Not selected");

    fireEvent.change(screen.getByRole("combobox"), {
      target: { value: "hero-1" },
    });

    fireEvent.click(screen.getByRole("button", { name: "Load Hero" }));

    await waitFor(() => {
      expect(screen.getByText('Hero "Existing Hero" has no attached round with usable resources.')).toBeDefined();
      expectTextContent(screen.getByText(/Video:/), "Not selected");
    });

    expect(screen.queryByDisplayValue("Existing Hero")).toBeNull();
  });
});
