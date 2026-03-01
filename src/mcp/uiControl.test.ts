// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createElement, useState } from "react";
import { cleanup, render, act } from "@testing-library/react";
import { createUiControl } from "./uiControl";

beforeEach(() => {
  vi.spyOn(HTMLElement.prototype, "getClientRects").mockImplementation(function (
    this: HTMLElement
  ) {
    return (this.hidden ? [] : [{ width: 100, height: 30 }]) as unknown as DOMRectList;
  });
});
afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});
it("inspects controls and applies input changes that React receives", async () => {
  function Form() {
    const [name, setName] = useState("Before");
    return createElement("input", {
      "aria-label": "Round name",
      value: name,
      onChange: (event: { target: { value: string } }) => setName(event.target.value),
    });
  }
  render(createElement(Form));
  const control = createUiControl(vi.fn());
  const snapshot = (await control({ action: "inspect" })) as {
    controls: Array<{ targetId: string; label: string }>;
  };
  expect(snapshot.controls[0].label).toBe("Round name");
  await act(async () => {
    await control({ action: "set", targetId: snapshot.controls[0].targetId, value: "Renamed" });
  });
  expect(document.querySelector("input")!.value).toBe("Renamed");
  // A second edit proves React state (not just the DOM property) follows the update.
  await act(async () => {
    await control({ action: "set", targetId: snapshot.controls[0].targetId, value: "Again" });
  });
  expect(document.querySelector("input")!.value).toBe("Again");
});
it("clicks controls, sets checkboxes, and rejects disabled or stale controls", async () => {
  document.body.innerHTML =
    '<button>Go</button><input type="checkbox" aria-label="Enabled"><button disabled>Disabled</button>';
  const clicked = vi.fn();
  document.querySelector("button")!.addEventListener("click", clicked);
  const control = createUiControl(vi.fn());
  const snapshot = (await control({ action: "inspect" })) as {
    controls: Array<{ targetId: string }>;
  };
  await control({ action: "click", targetId: snapshot.controls[0].targetId });
  expect(clicked).toHaveBeenCalledOnce();
  await control({ action: "set", targetId: snapshot.controls[1].targetId, value: true });
  expect(document.querySelector("input")!.checked).toBe(true);
  await expect(
    control({ action: "click", targetId: snapshot.controls[2].targetId })
  ).rejects.toThrow("disabled");
  document.querySelector("button")!.remove();
  await expect(
    control({ action: "click", targetId: snapshot.controls[0].targetId })
  ).rejects.toThrow("unavailable");
});
it("does not disclose password values or permit external navigation", async () => {
  document.body.innerHTML = '<input type="password" value="secret"><button hidden>Hidden</button>';
  const navigate = vi.fn();
  const control = createUiControl(navigate);
  const snapshot = (await control({ action: "inspect" })) as {
    controls: Array<{ value?: string }>;
  };
  expect(snapshot.controls).toHaveLength(1);
  expect(snapshot.controls[0].value).toBeUndefined();
  await expect(control({ action: "navigate", path: "//example.com" })).rejects.toThrow("internal");
  await control({ action: "navigate", path: "/rounds" });
  expect(navigate).toHaveBeenCalledWith("/rounds");
});

it("reports viewport-relative bounds and canvas geometry for visual targeting", async () => {
  document.body.innerHTML = '<button aria-label="Save">Save</button><canvas id="map"></canvas>';
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
    x: 10,
    y: 20,
    left: 10,
    top: 20,
    right: 110,
    bottom: 60,
    width: 100,
    height: 40,
  } as DOMRect);
  const control = createUiControl(vi.fn());
  const snapshot = (await control({ action: "inspect" })) as {
    controls: Array<{ bounds: unknown; inViewport: boolean }>;
    canvases: Array<{ label: string; bounds: unknown }>;
    viewport: { width: number };
  };
  expect(snapshot.controls[0]).toMatchObject({
    bounds: { x: 10, y: 20, width: 100, height: 40 },
    inViewport: true,
  });
  expect(snapshot.canvases[0].label).toBe("map");
  expect(snapshot.viewport.width).toBe(window.innerWidth);
});
