import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ConverterHeader } from "./ConverterHeader";

vi.mock("../../utils/audio", () => ({
  playHoverSound: vi.fn(),
  playSelectSound: vi.fn(),
}));

describe("ConverterHeader", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders explicit shortcut visibility controls", () => {
    const onShowHotkeys = vi.fn();
    const onHideHotkeys = vi.fn();

    const { rerender } = render(
      <ConverterHeader
        step="edit"
        selectedSourceInfo={{ kind: "local", id: "source-1", name: "Editor" }}
        segmentCount={2}
        sourceSummary="Local file"
        canLoadPreviousUnconverted={false}
        canLoadNextUnconverted={false}
        unconvertedPositionLabel={null}
        showHotkeys
        onGoToSelect={() => {}}
        onAttachFunscript={() => {}}
        onSearchEroScripts={() => {}}
        onLoadPreviousUnconverted={() => {}}
        onLoadNextUnconverted={() => {}}
        onShowHotkeys={onShowHotkeys}
        onHideHotkeys={onHideHotkeys}
      />
    );

    fireEvent.click(screen.getByText("Hide Shortcuts"));
    expect(onHideHotkeys).toHaveBeenCalledTimes(1);

    rerender(
      <ConverterHeader
        step="edit"
        selectedSourceInfo={{ kind: "local", id: "source-1", name: "Editor" }}
        segmentCount={2}
        sourceSummary="Local file"
        canLoadPreviousUnconverted={false}
        canLoadNextUnconverted={false}
        unconvertedPositionLabel={null}
        showHotkeys={false}
        onGoToSelect={() => {}}
        onAttachFunscript={() => {}}
        onSearchEroScripts={() => {}}
        onLoadPreviousUnconverted={() => {}}
        onLoadNextUnconverted={() => {}}
        onShowHotkeys={onShowHotkeys}
        onHideHotkeys={onHideHotkeys}
      />
    );

    fireEvent.click(screen.getByText("Show Shortcuts"));
    expect(onShowHotkeys).toHaveBeenCalledTimes(1);
  });

  it("exposes a top-level funscript attach action while editing", () => {
    const onAttachFunscript = vi.fn();

    const { getByText } = render(
      <ConverterHeader
        step="edit"
        selectedSourceInfo={{ kind: "local", id: "source-1", name: "Editor" }}
        segmentCount={0}
        sourceSummary="Local file"
        canLoadPreviousUnconverted={false}
        canLoadNextUnconverted={false}
        unconvertedPositionLabel={null}
        showHotkeys={false}
        onGoToSelect={() => {}}
        onAttachFunscript={onAttachFunscript}
        onSearchEroScripts={() => {}}
        onLoadPreviousUnconverted={() => {}}
        onLoadNextUnconverted={() => {}}
        onShowHotkeys={() => {}}
        onHideHotkeys={() => {}}
      />
    );

    fireEvent.click(getByText("Attach Funscript"));
    expect(onAttachFunscript).toHaveBeenCalledTimes(1);
  });

  it("exposes EroScripts search while editing", () => {
    const onSearchEroScripts = vi.fn();

    render(
      <ConverterHeader
        step="edit"
        selectedSourceInfo={{ kind: "local", id: "source-1", name: "Editor" }}
        segmentCount={0}
        sourceSummary="Local file"
        canLoadPreviousUnconverted={false}
        canLoadNextUnconverted={false}
        unconvertedPositionLabel={null}
        showHotkeys={false}
        onGoToSelect={() => {}}
        onAttachFunscript={() => {}}
        onSearchEroScripts={onSearchEroScripts}
        onLoadPreviousUnconverted={() => {}}
        onLoadNextUnconverted={() => {}}
        onShowHotkeys={() => {}}
        onHideHotkeys={() => {}}
      />
    );

    fireEvent.click(screen.getByText("Search EroScripts"));
    expect(onSearchEroScripts).toHaveBeenCalledTimes(1);
  });
});
