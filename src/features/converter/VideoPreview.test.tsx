import type React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { VideoPreview } from "./VideoPreview";

vi.mock("@lingui/react/macro", () => ({
  Trans: ({ children }: { children: React.ReactNode }) => children,
  useLingui: () => ({
    t: (value: TemplateStringsArray | string) => (Array.isArray(value) ? value[0] : value),
  }),
}));

vi.mock("../../utils/audio", () => ({
  playConverterMarkInSound: vi.fn(),
  playConverterMarkOutSound: vi.fn(),
  playHoverSound: vi.fn(),
  playSelectSound: vi.fn(),
}));

vi.mock("../../hooks/useForegroundVideoRegistration", () => ({
  useForegroundVideoRegistration: () => ({
    handlePlay: vi.fn(),
    handlePause: vi.fn(),
    handleEnded: vi.fn(),
  }),
}));

vi.mock("../../components/SfwGuard", () => ({
  SfwGuard: ({ children }: { children: React.ReactNode }) => children,
}));

describe("VideoPreview", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("renders and updates the preview skip-cuts checkbox", () => {
    const onPreviewSkipsCutsChange = vi.fn();

    render(
      <VideoPreview
        videoRef={{ current: null }}
        videoUri="file:///tmp/source.mp4"
        durationMs={10_000}
        currentTimeMs={2_000}
        funscriptActions={[]}
        markInMs={null}
        markOutMs={null}
        hasSelectedSegment={false}
        previewSkipsCuts={true}
        getVideoSrc={(uri) => uri}
        onLoadedMetadata={vi.fn()}
        onTimeUpdate={vi.fn()}
        onVideoError={vi.fn()}
        onTogglePlayback={vi.fn()}
        onSetMarkIn={vi.fn()}
        onSetMarkOut={vi.fn()}
        onAddSegment={vi.fn()}
        onMoveSelectedStartToPlayhead={vi.fn()}
        onMoveSelectedEndToPlayhead={vi.fn()}
        onRandomJump={vi.fn()}
        onPreviewSkipsCutsChange={onPreviewSkipsCutsChange}
      />
    );

    const checkbox = screen.getByLabelText("Skip cuts in preview");
    expect(checkbox).toBeInstanceOf(HTMLInputElement);
    expect((checkbox as HTMLInputElement).checked).toBe(true);

    fireEvent.click(checkbox);

    expect(onPreviewSkipsCutsChange).toHaveBeenCalledWith(false);
  });

  it("always renders a dim motion rail and hides the orb without script actions", () => {
    render(
      <VideoPreview
        videoRef={{ current: null }}
        videoUri="file:///tmp/source.mp4"
        durationMs={10_000}
        currentTimeMs={0}
        funscriptActions={[]}
        markInMs={null}
        markOutMs={null}
        hasSelectedSegment={false}
        previewSkipsCuts
        getVideoSrc={(uri) => uri}
        onLoadedMetadata={vi.fn()}
        onTimeUpdate={vi.fn()}
        onVideoError={vi.fn()}
        onTogglePlayback={vi.fn()}
        onSetMarkIn={vi.fn()}
        onSetMarkOut={vi.fn()}
        onAddSegment={vi.fn()}
        onMoveSelectedStartToPlayhead={vi.fn()}
        onMoveSelectedEndToPlayhead={vi.fn()}
        onRandomJump={vi.fn()}
        onPreviewSkipsCutsChange={vi.fn()}
      />
    );

    expect(screen.getByTestId("converter-handy-motion-rail")).toBeDefined();
    expect(screen.getByTestId("converter-handy-motion-orb").style.visibility).toBe("hidden");
  });

  it("animates the orb from interpolated video time and cancels on cleanup", () => {
    let runQueuedFrame: (time: number) => void = () => {
      throw new Error("Preview animation was not started.");
    };
    const requestAnimationFrameSpy = vi
      .spyOn(window, "requestAnimationFrame")
      .mockImplementation((callback) => {
        runQueuedFrame = (time) => callback(time);
        return 17;
      });
    const cancelAnimationFrameSpy = vi
      .spyOn(window, "cancelAnimationFrame")
      .mockImplementation(() => undefined);
    const videoRef = { current: null as HTMLVideoElement | null };

    const { unmount } = render(
      <VideoPreview
        videoRef={videoRef}
        videoUri="file:///tmp/source.mp4"
        durationMs={10_000}
        currentTimeMs={0}
        funscriptActions={[
          { at: 0, pos: 0 },
          { at: 1_000, pos: 100 },
        ]}
        markInMs={null}
        markOutMs={null}
        hasSelectedSegment={false}
        previewSkipsCuts
        getVideoSrc={(uri) => uri}
        onLoadedMetadata={vi.fn()}
        onTimeUpdate={vi.fn()}
        onVideoError={vi.fn()}
        onTogglePlayback={vi.fn()}
        onSetMarkIn={vi.fn()}
        onSetMarkOut={vi.fn()}
        onAddSegment={vi.fn()}
        onMoveSelectedStartToPlayhead={vi.fn()}
        onMoveSelectedEndToPlayhead={vi.fn()}
        onRandomJump={vi.fn()}
        onPreviewSkipsCutsChange={vi.fn()}
      />
    );

    const orb = screen.getByTestId("converter-handy-motion-orb");
    expect(orb.style.visibility).toBe("visible");
    expect(orb.style.top).toBe("100%");

    if (!videoRef.current) throw new Error("Preview video was not mounted.");
    videoRef.current.currentTime = 0.5;
    runQueuedFrame(16);

    expect(orb.style.top).toBe("50%");
    expect(requestAnimationFrameSpy).toHaveBeenCalled();

    unmount();
    expect(cancelAnimationFrameSpy).toHaveBeenCalledWith(17);
  });
});
