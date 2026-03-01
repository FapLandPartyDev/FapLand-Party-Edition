import { describe, expect, it } from "vitest";
import { setRendererPerformanceState, shouldDeferBackgroundWork } from "./rendererPerformance";

describe("rendererPerformance", () => {
  it("defers automatic work on every visible route", () => {
    setRendererPerformanceState({ route: "/settings", visible: true, activity: "interactive" });
    expect(shouldDeferBackgroundWork()).toBe(true);
  });

  it("keeps critical gameplay protected while hidden", () => {
    setRendererPerformanceState({ route: "/game", visible: false, activity: "critical" });
    expect(shouldDeferBackgroundWork()).toBe(true);
  });

  it("allows automatic work while a non-critical renderer is hidden", () => {
    setRendererPerformanceState({ route: "/settings", visible: false, activity: "idle" });
    expect(shouldDeferBackgroundWork()).toBe(false);
  });
});
