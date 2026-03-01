import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RangeSlider } from "./RangeSlider";

function RangeSliderHarness({ initialMin = 3, initialMax = 10 }) {
  const [range, setRange] = useState([initialMin, initialMax] as const);
  return (
    <RangeSlider
      min={0}
      max={30}
      minValue={range[0]}
      maxValue={range[1]}
      minAriaLabel="Minimum duration"
      maxAriaLabel="Maximum duration"
      onChange={(minValue, maxValue) => setRange([minValue, maxValue])}
    />
  );
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("RangeSlider", () => {
  it("supports keyboard adjustment without allowing its handles to cross", () => {
    render(<RangeSliderHarness />);
    const minThumb = screen.getByRole("slider", { name: "Minimum duration" });
    const maxThumb = screen.getByRole("slider", { name: "Maximum duration" });

    fireEvent.keyDown(minThumb, { key: "ArrowRight" });
    expect(minThumb.getAttribute("aria-valuenow")).toBe("4");

    for (let index = 0; index < 10; index += 1) {
      fireEvent.keyDown(minThumb, { key: "ArrowRight" });
    }
    expect(minThumb.getAttribute("aria-valuenow")).toBe("10");
    expect(maxThumb.getAttribute("aria-valuenow")).toBe("10");
  });

  it("expands the upper handle when both handles overlap and the track is clicked to the right", () => {
    const rect = {
      left: 0,
      width: 300,
      top: 0,
      right: 300,
      bottom: 10,
      height: 10,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    };
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(rect);
    const { container } = render(<RangeSliderHarness initialMin={10} initialMax={10} />);
    const track = container.querySelector("[class*='cursor-pointer']");
    expect(track).not.toBeNull();

    fireEvent.pointerDown(track!, { clientX: 200 });

    expect(
      within(container)
        .getByRole("slider", { name: "Minimum duration" })
        .getAttribute("aria-valuenow")
    ).toBe("10");
    expect(
      within(container)
        .getByRole("slider", { name: "Maximum duration" })
        .getAttribute("aria-valuenow")
    ).toBe("20");
  });
});
