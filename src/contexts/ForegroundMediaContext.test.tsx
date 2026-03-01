import { act, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ForegroundMediaProvider, useForegroundMedia } from "./ForegroundMediaContext";

function TestConsumer() {
  const media = useForegroundMedia();
  return (
    <div>
      <div data-testid="count">{media.activeForegroundVideoCount}</div>
      <button type="button" onClick={() => media.register("a")}>
        register-a
      </button>
      <button type="button" onClick={() => media.register("b")}>
        register-b
      </button>
      <button type="button" onClick={() => media.setPlaying("a", true)}>
        play-a
      </button>
      <button type="button" onClick={() => media.setPlaying("b", true)}>
        play-b
      </button>
      <button type="button" onClick={() => media.setPlaying("a", false)}>
        pause-a
      </button>
      <button type="button" onClick={() => media.unregister("b")}>
        unregister-b
      </button>
    </div>
  );
}

describe("ForegroundMediaContext", () => {
  it("tracks multiple foreground players and clears removed ones", () => {
    render(
      <ForegroundMediaProvider>
        <TestConsumer />
      </ForegroundMediaProvider>
    );

    expect(screen.getByTestId("count").textContent).toBe("0");

    act(() => {
      screen.getByText("register-a").click();
      screen.getByText("register-b").click();
      screen.getByText("play-a").click();
      screen.getByText("play-b").click();
    });

    expect(screen.getByTestId("count").textContent).toBe("2");

    act(() => {
      screen.getByText("pause-a").click();
    });

    expect(screen.getByTestId("count").textContent).toBe("1");

    act(() => {
      screen.getByText("unregister-b").click();
    });

    expect(screen.getByTestId("count").textContent).toBe("0");
  });
});
