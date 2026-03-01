import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SfwGuard } from "./SfwGuard";

const mocks = vi.hoisted(() => ({
  sfwEnabled: true,
}));

vi.mock("../hooks/useSfwMode", () => ({
  useSfwModeState: () => ({
    enabled: mocks.sfwEnabled,
    resolved: true,
  }),
}));

describe("SfwGuard", () => {
  afterEach(() => {
    mocks.sfwEnabled = true;
    cleanup();
  });

  it("reveals guarded media only after confirming the internal prompt", () => {
    render(
      <SfwGuard>
        <div>Hidden media</div>
      </SfwGuard>
    );

    expect(screen.queryByText("Hidden media")).toBeNull();
    expect(screen.getByText("Safe Mode Enabled")).toBeDefined();

    fireEvent.click(screen.getByRole("button", { name: "Show Media Once" }));

    expect(screen.getByRole("dialog")).toBeDefined();
    expect(screen.getByText("Show this media anyway?")).toBeDefined();

    fireEvent.click(screen.getByRole("button", { name: "Show Once" }));

    expect(screen.getByText("Hidden media")).toBeDefined();
    expect(screen.queryByText("Safe Mode Enabled")).toBeNull();
  });

  it("does not persist the reveal across a remount", () => {
    const view = render(
      <SfwGuard>
        <div>Hidden media</div>
      </SfwGuard>
    );

    fireEvent.click(screen.getByRole("button", { name: "Show Media Once" }));
    fireEvent.click(screen.getByRole("button", { name: "Show Once" }));
    expect(screen.getByText("Hidden media")).toBeDefined();

    view.unmount();

    render(
      <SfwGuard>
        <div>Hidden media</div>
      </SfwGuard>
    );

    expect(screen.queryByText("Hidden media")).toBeNull();
    expect(screen.getByText("Safe Mode Enabled")).toBeDefined();
  });
});
