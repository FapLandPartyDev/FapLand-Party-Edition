import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PlayerState } from "../../game/types";
import { RoundStartTransition } from "./RoundStartTransition";

const mocks = vi.hoisted(() => ({
  sfwMode: false,
}));

vi.mock("../../hooks/useSfwMode", () => ({
  useSfwMode: () => mocks.sfwMode,
}));

afterEach(() => {
  mocks.sfwMode = false;
  cleanup();
});

function createPlayer(overrides: Partial<PlayerState> = {}): PlayerState {
  return {
    id: "p1",
    name: "Player 1",
    currentNodeId: "node-1",
    position: 0,
    money: 0,
    score: 0,
    perks: [],
    antiPerks: [],
    inventory: [],
    activePerkEffects: [],
    pendingIntensityCap: null,
    stats: {
      diceMin: 1,
      diceMax: 6,
      roundPauseMs: 0,
      perkFrequency: 0,
      perkLuck: 0,
    },
    ...overrides,
  };
}

const normalRound = {
  fieldId: "field-1",
  nodeId: "node-1",
  roundId: "round-1",
  roundName: "Round One",
  selectionKind: "fixed" as const,
  poolId: null,
  phaseKind: "normal" as const,
  campaignIndex: 0,
};

describe("RoundStartTransition", () => {
  it("renders nothing without a queued round", () => {
    const { container } = render(
      <RoundStartTransition queuedRound={null} remaining={1.4} duration={2.1} />
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders normal round labels and countdown", () => {
    const view = render(
      <RoundStartTransition queuedRound={normalRound} remaining={1.7} duration={2.1} />
    );

    expect(view.getByTestId("round-start-transition")).toBeDefined();
    expect(view.getByText("NORMAL ROUND")).toBeDefined();
    expect(view.getByTestId("cinematic-transition-title").textContent).toBe("Round One");
    expect(view.getByTestId("cinematic-transition-countdown").textContent).toBe("2");
    expect(view.queryByTestId("cinematic-transition-hint")).toBeNull();
  });

  it("shows all upcoming playback and device effects", () => {
    const view = render(
      <RoundStartTransition
        queuedRound={normalRound}
        player={createPlayer({
          antiPerks: ["highspeed", "antigravity"],
          pendingIntensityCap: 0.5,
        })}
        remaining={1.7}
        duration={2.1}
      />
    );

    const hints = view.getAllByTestId("cinematic-transition-hint-item");
    expect(hints).toHaveLength(3);
    expect(view.getByText(/Video playback speed: 1[.,]2×/u)).toBeDefined();
    expect(view.getByText("Device motion: inverted")).toBeDefined();
    expect(view.getByText("Device intensity capped at 50%")).toBeDefined();
    expect(hints.map((hint) => hint.getAttribute("data-tone"))).toEqual([
      "antiPerk",
      "antiPerk",
      "perk",
    ]);
  });

  it("ignores inactive or invalid intensity caps", () => {
    const { rerender, queryByTestId } = render(
      <RoundStartTransition
        queuedRound={normalRound}
        player={createPlayer({ pendingIntensityCap: 1 })}
        remaining={1.7}
        duration={2.1}
      />
    );

    expect(queryByTestId("cinematic-transition-hint")).toBeNull();

    rerender(
      <RoundStartTransition
        queuedRound={normalRound}
        player={createPlayer({ pendingIntensityCap: Number.NaN })}
        remaining={1.7}
        duration={2.1}
      />
    );

    expect(queryByTestId("cinematic-transition-hint")).toBeNull();

    rerender(
      <RoundStartTransition
        queuedRound={normalRound}
        player={createPlayer({ pendingIntensityCap: -0.5 })}
        remaining={1.7}
        duration={2.1}
      />
    );

    expect(queryByTestId("cinematic-transition-hint")).toBeNull();
  });

  it("renders cum round labels and hint", () => {
    const view = render(
      <RoundStartTransition
        queuedRound={{
          fieldId: "field-1",
          nodeId: "node-1",
          roundId: "round-1",
          roundName: "Finale",
          selectionKind: "random",
          poolId: "pool-1",
          phaseKind: "cum",
          campaignIndex: 2,
        }}
        remaining={0.4}
        duration={2.1}
      />
    );

    expect(view.getByText("CUM ROUND")).toBeDefined();
    expect(view.getByTestId("cinematic-transition-title").textContent).toBe("Finale");
    expect(view.getByTestId("cinematic-transition-hint").textContent).toContain(
      "In this round, you may cum when the video instructs you to do so."
    );
    expect(view.getByTestId("cinematic-transition-countdown").textContent).toBe("1");
  });

  it("keeps the cum-round rule alongside active effect hints", () => {
    const view = render(
      <RoundStartTransition
        queuedRound={{
          ...normalRound,
          roundName: "Finale",
          selectionKind: "cum",
          phaseKind: "cum",
        }}
        player={createPlayer({ antiPerks: ["highspeed"] })}
        remaining={0.4}
        duration={2.1}
      />
    );

    expect(view.getAllByTestId("cinematic-transition-hint-item")).toHaveLength(2);
    expect(view.getByText("Round rule")).toBeDefined();
    expect(view.getByText("Anti-perk")).toBeDefined();
  });

  it("abbreviates obscene round text while safe mode is enabled", () => {
    mocks.sfwMode = true;

    const view = render(
      <RoundStartTransition
        queuedRound={{
          fieldId: "field-1",
          nodeId: "node-1",
          roundId: "round-1",
          roundName: "Cum Finale",
          selectionKind: "random",
          poolId: "pool-1",
          phaseKind: "cum",
          campaignIndex: 2,
        }}
        remaining={0.4}
        duration={2.1}
      />
    );

    expect(view.getByText("C ROUND")).toBeDefined();
    expect(view.getByTestId("cinematic-transition-title").textContent).toBe("C Finale");
    expect(view.getByTestId("cinematic-transition-hint").textContent).toContain(
      "In this round, you may c when the video instructs you to do so."
    );
  });
});
