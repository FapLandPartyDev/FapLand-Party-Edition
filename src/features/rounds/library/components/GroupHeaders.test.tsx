import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ComponentProps } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HeroGroupHeader } from "./GroupHeaders";

function renderHeroHeader(overrides: Partial<ComponentProps<typeof HeroGroupHeader>> = {}) {
  const props: ComponentProps<typeof HeroGroupHeader> = {
    heroName: "Hero One",
    roundCount: 3,
    pendingCacheCount: 0,
    pendingPreviewCount: 0,
    expanded: false,
    converting: false,
    convertingHardMode: false,
    isHardModeConverted: false,
    hasTemplateRounds: false,
    onToggle: vi.fn(),
    onConvertToRound: vi.fn(),
    onConvertLegacyFunscript: vi.fn(),
    onRevertHardModeFunscript: vi.fn(),
    onEditHero: vi.fn(),
    onDeleteHero: vi.fn(),
    onRetryTemplateLinking: vi.fn(),
    onRepairTemplate: vi.fn(),
    onHoverSfx: vi.fn(),
    ...overrides,
  };
  return { props, view: render(<HeroGroupHeader {...props} />) };
}

describe("HeroGroupHeader", () => {
  afterEach(() => cleanup());

  it("offers hero-wide legacy script conversion", () => {
    const onConvertLegacyFunscript = vi.fn();
    renderHeroHeader({ onConvertLegacyFunscript });

    fireEvent.click(screen.getByRole("button", { name: "Collection actions" }));
    fireEvent.click(screen.getByRole("button", { name: "Convert legacy script to hard mode" }));

    expect(onConvertLegacyFunscript).toHaveBeenCalledTimes(1);
  });

  it("disables duplicate hard-mode conversion while one is pending", () => {
    renderHeroHeader({ convertingHardMode: true });

    fireEvent.click(screen.getByRole("button", { name: "Collection actions" }));
    const action = screen.getByRole("button", { name: "Converting legacy script…" });

    expect(action.hasAttribute("disabled")).toBe(true);
  });

  it("shows when the hero funscript is already converted to hard mode", () => {
    renderHeroHeader({ isHardModeConverted: true });

    expect(screen.getByText("Hard Mode")).toBeDefined();
  });
});
