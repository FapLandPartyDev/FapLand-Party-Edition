import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { CinematicTransitionFrame } from "./CinematicTransitionFrame";

afterEach(() => {
  cleanup();
});

describe("CinematicTransitionFrame", () => {
  it("exposes stable variant and progress variable", () => {
    const view = render(
      <CinematicTransitionFrame
        title="Neon Run"
        overline="RUN INITIALIZATION"
        progress={0.9}
        variant="playlist-launch"
      />
    );

    const root = view.getByTestId("cinematic-transition-root");
    expect(root.getAttribute("data-variant")).toBe("playlist-launch");
    expect(root.style.getPropertyValue("--transition-progress")).toBe("0.900");
  });

  it("renders metadata and countdown when provided", () => {
    const view = render(
      <CinematicTransitionFrame
        title="Round 9"
        overline="NORMAL ROUND"
        metadata={["Linear board", "9 rounds"]}
        countdownLabel="2"
        progress={0.45}
        variant="round-start"
      />
    );

    expect(view.getByTestId("cinematic-transition-title").textContent).toBe("Round 9");
    expect(view.getByTestId("cinematic-transition-metadata").textContent).toContain("Linear board");
    expect(view.getByTestId("cinematic-transition-countdown").textContent).toBe("2");
    expect(view.queryByTestId("cinematic-transition-hint")).toBeNull();
  });

  it("renders a hint callout when provided", () => {
    const view = render(
      <CinematicTransitionFrame
        title="Finale"
        overline="CUM ROUND"
        hintText="In this round, you may cum when the video instructs you to do so."
        countdownLabel="4"
        progress={0.25}
        variant="round-start"
      />
    );

    expect(view.getByTestId("cinematic-transition-hint").textContent).toContain(
      "In this round, you may cum when the video instructs you to do so."
    );
  });

  it("renders structured hints with semantic tones", () => {
    const view = render(
      <CinematicTransitionFrame
        title="Round 9"
        overline="NORMAL ROUND"
        hints={[
          {
            id: "speed",
            label: "ANTI-PERK",
            text: "Video playback speed: 1.2×",
            tone: "antiPerk",
          },
          {
            id: "intensity",
            label: "PERK",
            text: "Device intensity capped at 50%",
            tone: "perk",
          },
        ]}
        progress={0.45}
        variant="round-start"
      />
    );

    const hints = view.getAllByTestId("cinematic-transition-hint-item");
    expect(hints).toHaveLength(2);
    expect(hints[0]?.getAttribute("data-tone")).toBe("antiPerk");
    expect(hints[1]?.getAttribute("data-tone")).toBe("perk");
  });
});
