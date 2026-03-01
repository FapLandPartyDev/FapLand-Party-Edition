import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { usePlayableVideoFallback } from "./usePlayableVideoFallback";

function FallbackHarness(props: {
  videoUri: string;
  resolver: (videoUri: string) => Promise<{ videoUri: string; transcoded: boolean; cacheHit: boolean }>;
}) {
  const { getVideoSrc, handleVideoError } = usePlayableVideoFallback(props.resolver);
  return (
    <div>
      <span data-testid="src">{getVideoSrc(props.videoUri) ?? ""}</span>
      <button onClick={() => void handleVideoError(props.videoUri)} type="button">
        trigger
      </button>
    </div>
  );
}

describe("usePlayableVideoFallback", () => {
  afterEach(() => {
    cleanup();
  });

  it("resolves fallback once for local sources and swaps src", async () => {
    const resolver = vi.fn(async () => ({
      videoUri: "app://media/%2Ftmp%2Fcached.mp4",
      transcoded: true,
      cacheHit: false,
    }));

    render(<FallbackHarness resolver={resolver} videoUri="app://media/%2Ftmp%2Fsource.hevc" />);
    expect(screen.getByTestId("src").textContent).toBe("app://media/%2Ftmp%2Fsource.hevc");

    fireEvent.click(screen.getByRole("button", { name: "trigger" }));
    await waitFor(() => {
      expect(screen.getByTestId("src").textContent).toBe("app://media/%2Ftmp%2Fcached.mp4");
    });

    fireEvent.click(screen.getByRole("button", { name: "trigger" }));
    await waitFor(() => {
      expect(resolver).toHaveBeenCalledTimes(1);
    });
  });

  it("does not resolve fallback for remote sources", async () => {
    const resolver = vi.fn(async () => ({
      videoUri: "https://cdn.example.com/video.mp4",
      transcoded: false,
      cacheHit: false,
    }));

    render(<FallbackHarness resolver={resolver} videoUri="https://cdn.example.com/video.hevc" />);
    fireEvent.click(screen.getByRole("button", { name: "trigger" }));

    await waitFor(() => {
      expect(resolver).not.toHaveBeenCalled();
    });
    expect(screen.getByTestId("src").textContent).toBe("https://cdn.example.com/video.hevc");
  });
});
