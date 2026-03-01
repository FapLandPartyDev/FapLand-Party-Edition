import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DeferredImage } from "./DeferredImage";

class IntersectionObserverMock {
  static instances: IntersectionObserverMock[] = [];
  callback: IntersectionObserverCallback;
  elements = new Set<Element>();

  constructor(callback: IntersectionObserverCallback) {
    this.callback = callback;
    IntersectionObserverMock.instances.push(this);
  }

  observe(element: Element) {
    this.elements.add(element);
  }

  unobserve(element: Element) {
    this.elements.delete(element);
  }

  disconnect() {
    this.elements.clear();
  }

  triggerIntersecting() {
    this.callback(
      [...this.elements].map(
        (target) =>
          ({
            target,
            isIntersecting: true,
          }) as IntersectionObserverEntry
      ),
      this as unknown as IntersectionObserver
    );
  }
}

describe("DeferredImage", () => {
  const rafQueue: FrameRequestCallback[] = [];

  beforeEach(() => {
    vi.useFakeTimers();
    IntersectionObserverMock.instances = [];
    rafQueue.length = 0;

    vi.stubGlobal("IntersectionObserver", IntersectionObserverMock);
    vi.stubGlobal("requestIdleCallback", (callback: IdleRequestCallback) => {
      callback({ didTimeout: false, timeRemaining: () => 50 } as IdleDeadline);
      return 1;
    });
    vi.stubGlobal("cancelIdleCallback", vi.fn());
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      rafQueue.push(callback);
      return rafQueue.length;
    });
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  function flushNextAnimationFrame() {
    const callback = rafQueue.shift();
    if (!callback) {
      return;
    }
    callback(performance.now());
  }

  it("waits for intersection before attaching the image source", async () => {
    render(<DeferredImage src="/preview-a.jpg" alt="preview-a" />);

    const image = screen.getByAltText("preview-a");
    expect(image.getAttribute("src")).toBeNull();

    await act(async () => {
      IntersectionObserverMock.instances[0]?.triggerIntersecting();
      vi.runAllTimers();
      flushNextAnimationFrame();
    });

    expect(image.getAttribute("src")).toBe("/preview-a.jpg");
  });

  it("spreads multiple image activations across animation frames", async () => {
    render(
      <>
        <DeferredImage src="/preview-a.jpg" alt="preview-a" />
        <DeferredImage src="/preview-b.jpg" alt="preview-b" />
      </>
    );

    const [observerA, observerB] = IntersectionObserverMock.instances;
    const imageA = screen.getByAltText("preview-a");
    const imageB = screen.getByAltText("preview-b");

    await act(async () => {
      observerA?.triggerIntersecting();
      observerB?.triggerIntersecting();
      vi.runAllTimers();
      flushNextAnimationFrame();
    });

    expect(imageA.getAttribute("src")).toBe("/preview-a.jpg");
    expect(imageB.getAttribute("src")).toBeNull();

    await act(async () => {
      flushNextAnimationFrame();
    });

    expect(imageB.getAttribute("src")).toBe("/preview-b.jpg");
  });

  it("does not attach the image source while suspended", async () => {
    const view = render(<DeferredImage src="/preview-a.jpg" alt="preview-a" suspended />);
    const image = screen.getByAltText("preview-a");

    expect(IntersectionObserverMock.instances).toHaveLength(0);
    expect(image.getAttribute("src")).toBeNull();

    view.rerender(<DeferredImage src="/preview-a.jpg" alt="preview-a" suspended={false} />);

    await act(async () => {
      IntersectionObserverMock.instances[0]?.triggerIntersecting();
      vi.runAllTimers();
      flushNextAnimationFrame();
    });

    expect(image.getAttribute("src")).toBe("/preview-a.jpg");
  });
});
