import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GameDropdown } from "./GameDropdown";

afterEach(() => {
  cleanup();
});

describe("GameDropdown", () => {
  it("opens with keyboard controls and selects the highlighted option", () => {
    const handleChange = vi.fn();

    render(
      <GameDropdown
        label="Mode"
        value="easy"
        options={[
          { value: "easy", label: "Easy" },
          { value: "normal", label: "Normal" },
          { value: "hard", label: "Hard" },
        ]}
        onChange={handleChange}
      />
    );

    const trigger = screen.getByRole("button", { name: /easy/i });
    trigger.focus();

    fireEvent.keyDown(trigger, { key: "ArrowDown" });

    const listbox = screen.getByRole("listbox");
    expect(listbox.getAttribute("aria-activedescendant")).toContain("option-0");

    fireEvent.keyDown(screen.getByRole("option", { name: "Easy" }), { key: "ArrowDown" });
    fireEvent.keyDown(screen.getByRole("option", { name: "Normal" }), { key: "Enter" });

    expect(handleChange).toHaveBeenCalledWith("normal");
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it("skips disabled options during keyboard navigation", () => {
    const handleChange = vi.fn();

    render(
      <GameDropdown
        value="easy"
        options={[
          { value: "easy", label: "Easy" },
          { value: "normal", label: "Normal", disabled: true },
          { value: "hard", label: "Hard" },
        ]}
        onChange={handleChange}
      />
    );

    const trigger = screen.getByRole("button", { name: /easy/i });
    trigger.focus();

    fireEvent.keyDown(trigger, { key: "ArrowDown" });
    fireEvent.keyDown(screen.getByRole("option", { name: "Easy" }), { key: "ArrowDown" });
    fireEvent.keyDown(screen.getByRole("option", { name: "Hard" }), { key: "Enter" });

    expect(handleChange).toHaveBeenCalledWith("hard");
  });
});
