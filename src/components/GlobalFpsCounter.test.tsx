import { act, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { GlobalFpsCounter } from "./GlobalFpsCounter";
import { trpc } from "../services/trpc";
import {
  FPS_COUNTER_ENABLED_EVENT,
  FPS_COUNTER_ENABLED_KEY,
} from "../constants/experimentalFeatures";

vi.mock("../services/trpc", () => ({
  trpc: {
    store: {
      get: {
        query: vi.fn(),
      },
    },
  },
}));

describe("GlobalFpsCounter", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    window.localStorage.clear();
  });

  it("stays hidden while disabled and appears after the global toggle event", async () => {
    const getQuery = vi.mocked(trpc.store.get.query);
    getQuery.mockResolvedValue(false);

    let now = 0;
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      now += 100;
      return window.setTimeout(() => callback(now), 0);
    });
    vi.stubGlobal("cancelAnimationFrame", (id: number) => window.clearTimeout(id));

    render(<GlobalFpsCounter />);

    await act(async () => {
      await Promise.resolve();
    });

    expect(screen.queryByText(/FPS/i)).toBeNull();

    await act(async () => {
      window.dispatchEvent(new CustomEvent<boolean>(FPS_COUNTER_ENABLED_EVENT, { detail: true }));
      await new Promise((resolve) => window.setTimeout(resolve, 10));
    });

    expect(window.localStorage.getItem(FPS_COUNTER_ENABLED_KEY)).toBe("true");
    expect(await screen.findByText("FPS 10")).not.toBeNull();
  });
});
