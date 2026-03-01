import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { PlaylistLaunchTransition } from "./PlaylistLaunchTransition";

afterEach(() => {
  cleanup();
});

describe("PlaylistLaunchTransition", () => {
  it("renders nothing when hidden", () => {
    const { container } = render(
      <PlaylistLaunchTransition
        visible={false}
        playlistName="Arcade"
        boardModeLabel="Linear"
        roundCount={8}
        estimatedDurationLabel="12:00"
        progress={0}
      />
    );

    expect(container.firstChild).toBeNull();
  });

  it("renders playlist metadata when visible", () => {
    render(
      <PlaylistLaunchTransition
        visible
        playlistName="Arcade"
        boardModeLabel="Graph"
        roundCount={11}
        estimatedDurationLabel="18:30"
        progress={0.4}
      />
    );

    expect(screen.getByTestId("playlist-launch-transition")).toBeDefined();
    expect(screen.getByTestId("cinematic-transition-title").textContent).toBe("Arcade");
    expect(screen.getByTestId("cinematic-transition-metadata").textContent).toContain(
      "Graph board"
    );
    expect(screen.getByTestId("cinematic-transition-metadata").textContent).toContain("11 rounds");
    expect(screen.getByTestId("cinematic-transition-metadata").textContent).toContain("18:30");
  });
});
