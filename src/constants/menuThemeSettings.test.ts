import { describe, expect, it } from "vitest";
import {
  DEFAULT_MENU_THEME_ID,
  MAIN_MENU_THEME_IDS,
  getMainMenuTheme,
  normalizeMainMenuThemeId,
} from "./menuThemeSettings";

describe("menuThemeSettings", () => {
  it("accepts every known main menu theme id", () => {
    for (const themeId of MAIN_MENU_THEME_IDS) {
      expect(normalizeMainMenuThemeId(themeId)).toBe(themeId);
      expect(getMainMenuTheme(themeId).id).toBe(themeId);
    }
  });

  it("falls back to classic for invalid values", () => {
    expect(normalizeMainMenuThemeId(undefined)).toBe(DEFAULT_MENU_THEME_ID);
    expect(normalizeMainMenuThemeId(null)).toBe(DEFAULT_MENU_THEME_ID);
    expect(normalizeMainMenuThemeId("")).toBe(DEFAULT_MENU_THEME_ID);
    expect(normalizeMainMenuThemeId("purple")).toBe(DEFAULT_MENU_THEME_ID);
    expect(getMainMenuTheme("missing").id).toBe(DEFAULT_MENU_THEME_ID);
  });
});
