import type React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { VideoPreview } from "./VideoPreview";

vi.mock("@lingui/react/macro", () => ({
  useLingui: () => ({
    t: (value: TemplateStringsArray | string) =>
      Array.isArray(value) ? value[0] : value,
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
  it("renders and updates the preview skip-cuts checkbox", () => {
    const onPreviewSkipsCutsChange = vi.fn();

    render(
      <VideoPreview
        videoRef={{ current: null }}
        videoUri="file:///tmp/source.mp4"
        durationMs={10_000}
        currentTimeMs={2_000}
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
    expect(checkbox).toBeChecked();

    fireEvent.click(checkbox);

    expect(onPreviewSkipsCutsChange).toHaveBeenCalledWith(false);
  });
});
