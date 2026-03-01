import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
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

describe("RoundStartTransition", () => {
  it("renders nothing without a queued round", () => {
    const { container } = render(
      <RoundStartTransition queuedRound={null} remaining={1.4} duration={2.1} />
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders normal round labels and countdown", () => {
    const view = render(
      <RoundStartTransition
        queuedRound={{
          fieldId: "field-1",
          nodeId: "node-1",
          roundId: "round-1",
          roundName: "Round One",
          selectionKind: "fixed",
          poolId: null,
          phaseKind: "normal",
          campaignIndex: 0,
        }}
        remaining={1.7}
        duration={2.1}
      />
    );

    expect(view.getByTestId("round-start-transition")).toBeDefined();
    expect(view.getByText("NORMAL ROUND")).toBeDefined();
    expect(view.getByTestId("cinematic-transition-title").textContent).toBe("Round One");
    expect(view.getByTestId("cinematic-transition-countdown").textContent).toBe("2");
    expect(view.queryByTestId("cinematic-transition-hint")).toBeNull();
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
