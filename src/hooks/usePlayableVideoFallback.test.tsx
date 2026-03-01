import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { usePlayableVideoFallback } from "./usePlayableVideoFallback";

function FallbackHarness(props: {
  videoUri: string;
  resolver: (videoUri: string) => Promise<{ videoUri: string; transcoded: boolean; cacheHit: boolean }>;
}) {
  const { getVideoSrc, ensurePlayableVideo, handleVideoError } = usePlayableVideoFallback(props.resolver);
  return (
    <div>
      <span data-testid="src">{getVideoSrc(props.videoUri) ?? ""}</span>
      <button onClick={() => void ensurePlayableVideo(props.videoUri)} type="button">
        ensure
      </button>
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

  it("forces a transcode uri when a local app media source still has no replacement on error", async () => {
    const resolver = vi.fn(async () => ({
      videoUri: "app://media/%2Ftmp%2Fsource.mp4",
      transcoded: false,
      cacheHit: false,
    }));

    render(<FallbackHarness resolver={resolver} videoUri="app://media/%2Ftmp%2Fsource.mp4" />);
    expect(screen.getByTestId("src").textContent).toBe("app://media/%2Ftmp%2Fsource.mp4");

    fireEvent.click(screen.getByRole("button", { name: "trigger" }));

    await waitFor(() => {
      expect(screen.getByTestId("src").textContent).toBe(
        "app://media/%2Ftmp%2Fsource.mp4?transcode=1"
      );
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

  it("resolves fallback for website proxy sources", async () => {
    const resolver = vi.fn(async () => ({
      videoUri: "app://media/%2Ftmp%2Fcached-website.mp4",
      transcoded: false,
      cacheHit: true,
    }));

    render(<FallbackHarness resolver={resolver} videoUri="app://external/web-url?target=https%3A%2F%2Fexample.com%2Fwatch%3Fv%3D1" />);
    expect(screen.getByTestId("src").textContent).toBe("");
    fireEvent.click(screen.getByRole("button", { name: "trigger" }));

    await waitFor(() => {
      expect(resolver).toHaveBeenCalledTimes(1);
      expect(screen.getByTestId("src").textContent).toBe("app://media/%2Ftmp%2Fcached-website.mp4");
    });
  });

  it("resolves fallback for raw website video page urls", async () => {
    const resolver = vi.fn(async () => ({
      videoUri: "app://external/web-url?target=https%3A%2F%2Fwww.xhamster.com%2Fvideos%2Ftest-123",
      transcoded: false,
      cacheHit: false,
    }));

    render(<FallbackHarness resolver={resolver} videoUri="https://www.xhamster.com/videos/test-123" />);
    expect(screen.getByTestId("src").textContent).toBe(
      "app://external/web-url?target=https%3A%2F%2Fwww.xhamster.com%2Fvideos%2Ftest-123"
    );

    fireEvent.click(screen.getByRole("button", { name: "ensure" }));
    await waitFor(() => {
      expect(resolver).toHaveBeenCalledTimes(1);
    });

    fireEvent.click(screen.getByRole("button", { name: "trigger" }));

    await waitFor(() => {
      expect(screen.getByTestId("src").textContent).toBe(
        "app://external/web-url?target=https%3A%2F%2Fwww.xhamster.com%2Fvideos%2Ftest-123"
      );
    });
  });

  it("retries website sources until a cached local replacement becomes available", async () => {
    const resolver = vi.fn()
      .mockResolvedValueOnce({
        videoUri: "app://external/web-url?target=https%3A%2F%2Fexample.com%2Fwatch%3Fv%3D1",
        transcoded: false,
        cacheHit: false,
      })
      .mockResolvedValueOnce({
        videoUri: "app://media/%2Ftmp%2Fcached-website.mp4",
        transcoded: false,
        cacheHit: true,
      });

    render(<FallbackHarness resolver={resolver} videoUri="app://external/web-url?target=https%3A%2F%2Fexample.com%2Fwatch%3Fv%3D1" />);
    expect(screen.getByTestId("src").textContent).toBe("");

    fireEvent.click(screen.getByRole("button", { name: "ensure" }));
    await waitFor(() => {
      expect(resolver).toHaveBeenCalledTimes(1);
      expect(screen.getByTestId("src").textContent).toBe("");
    });

    fireEvent.click(screen.getByRole("button", { name: "trigger" }));
    await waitFor(() => {
      expect(resolver).toHaveBeenCalledTimes(2);
      expect(screen.getByTestId("src").textContent).toBe("app://media/%2Ftmp%2Fcached-website.mp4");
    });
  });
});
