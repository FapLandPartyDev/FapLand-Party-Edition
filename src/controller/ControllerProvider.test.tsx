import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CONTROLLER_SUPPORT_ENABLED_EVENT } from "../constants/experimentalFeatures";
import { ControllerProvider } from "./ControllerProvider";
import { useControllerSurface } from "./useControllerSurface";

vi.mock("../services/trpc", () => ({
  trpc: {
    store: {
      get: {
        query: vi.fn(async () => false),
      },
    },
  },
}));

function ControllerHarness(props: { onPrimary?: () => void; onBack?: () => void }) {
  const scopeRef = useRef<HTMLDivElement | null>(null);

  useControllerSurface({
    id: "test-surface",
    scopeRef,
    initialFocusId: "first",
    onBack: () => {
      props.onBack?.();
      return true;
    },
  });

  return (
    <div ref={scopeRef}>
      <button type="button" data-controller-focus-id="first" data-controller-initial="true">
        First
      </button>
      <button type="button" data-controller-focus-id="second" onClick={props.onPrimary}>
        Second
      </button>
      <input aria-label="entry" data-controller-focus-id="entry" />
    </div>
  );
}

describe("ControllerProvider", () => {
  beforeEach(() => {
    let frameId = 0;
    const callbacks = new Map<number, FrameRequestCallback>();

    vi.stubGlobal(
      "requestAnimationFrame",
      vi.fn((callback: FrameRequestCallback) => {
        const nextId = ++frameId;
        callbacks.set(nextId, callback);
        return nextId;
      })
    );
    vi.stubGlobal(
      "cancelAnimationFrame",
      vi.fn((id: number) => {
        callbacks.delete(id);
      })
    );

    Object.defineProperty(window.navigator, "getGamepads", {
      configurable: true,
      value: vi.fn(() => []),
    });

    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (
      this: HTMLElement
    ) {
      const focusId = this.dataset.controllerFocusId;
      const topById: Record<string, number> = {
        first: 10,
        second: 70,
        entry: 130,
      };
      const top = topById[focusId ?? ""] ?? 10;
      return {
        x: 10,
        y: top,
        top,
        left: 10,
        right: 110,
        bottom: top + 40,
        width: 100,
        height: 40,
        toJSON: () => ({}),
      } as DOMRect;
    });

    (
      window as typeof window & { __runAnimationFrame?: (timestamp: number) => void }
    ).__runAnimationFrame = (timestamp: number) => {
      const [next] = callbacks.entries();
      if (!next) {
        throw new Error("No animation frame callback scheduled");
      }
      const [id, callback] = next;
      callbacks.delete(id);
      callback(timestamp);
    };
  });

  afterEach(() => {
    vi.restoreAllMocks();
    cleanup();
  });

  it("moves focus with directional input and activates the focused control", () => {
    const onPrimary = vi.fn();

    render(
      <ControllerProvider>
        <ControllerHarness onPrimary={onPrimary} />
      </ControllerProvider>
    );

    const first = screen.getByRole("button", { name: "First" });
    const second = screen.getByRole("button", { name: "Second" });
    first.focus();

    fireEvent.keyDown(window, { key: "ArrowDown" });
    expect(document.activeElement).toBe(second);

    fireEvent.keyDown(window, { key: "Enter" });
    expect(onPrimary).toHaveBeenCalledTimes(1);
  });

  it("treats space as a single primary action", () => {
    const onPrimary = vi.fn();

    render(
      <ControllerProvider>
        <ControllerHarness onPrimary={onPrimary} />
      </ControllerProvider>
    );

    const second = screen.getByRole("button", { name: "Second" });
    second.focus();

    fireEvent.keyDown(window, { key: " " });
    expect(onPrimary).toHaveBeenCalledTimes(1);
  });

  it("blurs text entry on secondary input before routing back", () => {
    const onBack = vi.fn();

    render(
      <ControllerProvider>
        <ControllerHarness onBack={onBack} />
      </ControllerProvider>
    );

    const entry = screen.getByLabelText("entry");
    entry.focus();

    fireEvent.keyDown(window, { key: "Escape" });
    expect(document.activeElement).not.toBe(entry);
    expect(onBack).not.toHaveBeenCalled();

    screen.getByRole("button", { name: "First" }).focus();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it("ignores gamepad input until experimental controller support is enabled", async () => {
    const onPrimary = vi.fn();
    const runAnimationFrame = (
      window as typeof window & { __runAnimationFrame: (timestamp: number) => void }
    ).__runAnimationFrame;
    const getGamepads = vi.fn(() => [
      {
        buttons: [
          { pressed: false },
          { pressed: false },
          { pressed: false },
          { pressed: false },
          { pressed: false },
          { pressed: false },
          { pressed: false },
          { pressed: false },
          { pressed: false },
          { pressed: false },
          { pressed: false },
          { pressed: false },
          { pressed: false },
          { pressed: true },
          { pressed: false },
          { pressed: false },
        ],
        axes: [0, 0, 0, 0],
      },
    ]);

    Object.defineProperty(window.navigator, "getGamepads", {
      configurable: true,
      value: getGamepads,
    });

    render(
      <ControllerProvider>
        <ControllerHarness onPrimary={onPrimary} />
      </ControllerProvider>
    );

    expect(getGamepads).not.toHaveBeenCalled();
    expect(document.activeElement).not.toBe(screen.getByRole("button", { name: "First" }));

    window.dispatchEvent(
      new CustomEvent<boolean>(CONTROLLER_SUPPORT_ENABLED_EVENT, { detail: true })
    );

    runAnimationFrame(16);

    await waitFor(() => {
      expect(document.activeElement).toBe(screen.getByRole("button", { name: "Second" }));
    });
  });
});
