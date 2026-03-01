import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  backgroundVideoEnabledQuery: vi.fn(async () => true),
  useSfwMode: vi.fn(() => false),
  getVideoSrc: vi.fn((src: string) => src),
  ensurePlayableVideo: vi.fn(async () => null),
  handleVideoError: vi.fn(async () => null),
}));

vi.mock("../hooks/useSfwMode", () => ({
  useSfwMode: mocks.useSfwMode,
}));

vi.mock("../hooks/usePlayableVideoFallback", () => ({
  usePlayableVideoFallback: () => ({
    getVideoSrc: mocks.getVideoSrc,
    ensurePlayableVideo: mocks.ensurePlayableVideo,
    handleVideoError: mocks.handleVideoError,
  }),
}));

vi.mock("../services/trpc", () => ({
  trpc: {
    store: {
      get: {
        query: mocks.backgroundVideoEnabledQuery,
      },
    },
  },
}));

import { AnimatedBackground } from "./AnimatedBackground";

describe("AnimatedBackground", () => {
  beforeEach(() => {
    mocks.backgroundVideoEnabledQuery.mockResolvedValue(true);
    mocks.useSfwMode.mockReturnValue(false);
    mocks.getVideoSrc.mockImplementation((src: string) => src);
    mocks.ensurePlayableVideo.mockClear();
    mocks.handleVideoError.mockClear();
  });

  afterEach(() => {
    cleanup();
  });

  it("renders at most one video in light mode and omits grid and scanlines", () => {
    const { container } = render(
      <AnimatedBackground
        videoUris={["/video-1.mp4", "/video-2.mp4", "/video-3.mp4", "/video-4.mp4"]}
      />
    );

    expect(container.querySelectorAll("video")).toHaveLength(1);
    expect(screen.queryByTestId("animated-background-grid")).toBeNull();
    expect(screen.queryByTestId("animated-background-scanlines")).toBeNull();
  });

  it("handles empty video lists without rendering a video element", () => {
    const { container } = render(<AnimatedBackground videoUris={[]} />);

    expect(container.querySelectorAll("video")).toHaveLength(0);
    expect(screen.queryByTestId("animated-background-grid")).toBeNull();
    expect(screen.queryByTestId("animated-background-scanlines")).toBeNull();
  });
});
