import { describe, it, expect, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useMenuNavigation, type MenuOption } from "./useMenuNavigation";

// Mock audio utils
vi.mock("../utils/audio", () => ({
  playHoverSound: vi.fn(),
  playSelectSound: vi.fn(),
}));

describe("useMenuNavigation", () => {
  const rootOptions: MenuOption[] = [
    {
      id: "opt1",
      label: "Option 1",
      action: vi.fn(),
    },
    {
      id: "opt2",
      label: "Option 2",
      disabled: true,
      action: vi.fn(),
    },
    {
      id: "opt3",
      label: "Option 3",
      submenu: [
        {
          id: "sub1",
          label: "Sub 1",
          action: vi.fn(),
        },
      ],
    },
  ];

  it("should allow executing non-disabled options", () => {
    const { result } = renderHook(() => useMenuNavigation(rootOptions));

    act(() => {
      result.current.handleClick(0);
    });

    expect(rootOptions[0].action).toHaveBeenCalled();
  });

  it("should NOT allow executing disabled options", () => {
    const { result } = renderHook(() => useMenuNavigation(rootOptions));

    act(() => {
      result.current.handleClick(1);
    });

    expect(rootOptions[1].action).not.toHaveBeenCalled();
  });

  it("should NOT allow diving into a disabled submenu (if we were to add such a case)", () => {
    // Just to be sure, if we had a disabled submenu
    const optionsWithDisabledSubmenu: MenuOption[] = [
      {
        id: "sub-disabled",
        label: "Disabled Sub",
        disabled: true,
        submenu: [{ id: "inner", label: "Inner", action: vi.fn() }],
      },
    ];
    const { result } = renderHook(() => useMenuNavigation(optionsWithDisabledSubmenu));

    act(() => {
      result.current.handleClick(0);
    });

    expect(result.current.depth).toBe(0);
  });

  it("should allow navigating submenus", () => {
    const { result } = renderHook(() => useMenuNavigation(rootOptions));

    act(() => {
      result.current.handleClick(2);
    });

    expect(result.current.depth).toBe(1);
    expect(result.current.currentOptions[0].id).toBe("sub1");
  });
});
