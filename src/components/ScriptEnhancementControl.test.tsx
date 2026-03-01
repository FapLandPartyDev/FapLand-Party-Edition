import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { setupI18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ScriptEnhancement } from "../services/haptics/scriptEnhancement";

const mocks = vi.hoisted(() => ({
  read: vi.fn(),
  save: vi.fn(),
  profile: vi.fn(),
  saveProfile: vi.fn(),
  provider: "thehandy",
}));
vi.mock("../contexts/HandyContext", () => ({
  useHaptics: () => ({ provider: mocks.provider }),
}));
vi.mock("../services/scriptEnhancementSettings", () => ({
  readScriptEnhancement: mocks.read,
  saveScriptEnhancement: mocks.save,
  readEnhancementSpeedProfile: mocks.profile,
  saveEnhancementSpeedProfile: mocks.saveProfile,
}));
import { ScriptEnhancementControl } from "./ScriptEnhancementControl";

afterEach(cleanup);
beforeEach(() => {
  vi.clearAllMocks();
  mocks.provider = "thehandy";
  mocks.profile.mockResolvedValue({ preset: "automatic", customRate: 1600 });
  mocks.saveProfile.mockImplementation(async (_provider, value) => value);
});

describe("script enhancement controls", () => {
  it("saves delimited strength independently of pattern controls", async () => {
    mocks.read.mockResolvedValue({ enabled: true, wildness: 0, delimited: 25 });
    mocks.save.mockImplementation(async (_uri: string, value: ScriptEnhancement) => value);
    const i18n = setupI18n({ locale: "en", messages: { en: {} } });
    await act(async () => {
      render(
        <I18nProvider i18n={i18n}>
          <ScriptEnhancementControl scriptUri="delimited" />
        </I18nProvider>
      );
    });
    fireEvent.click(screen.getByText("Auto enhance script"));
    const slider = screen.getByRole("slider", { name: "Delimited intensity" });
    expect((slider as HTMLInputElement).value).toBe("25");
    fireEvent.change(slider, { target: { value: "75" } });
    fireEvent.pointerUp(slider);
    await waitFor(() =>
      expect(mocks.save).toHaveBeenCalledWith("delimited", {
        enabled: true,
        wildness: 0,
        delimited: 75,
      })
    );
    await waitFor(() =>
      expect(
        (screen.getByRole("checkbox", { name: "Delimited" }) as HTMLInputElement).disabled
      ).toBe(false)
    );
    fireEvent.click(screen.getByRole("checkbox", { name: "Delimited" }));
    await waitFor(() =>
      expect(mocks.save).toHaveBeenLastCalledWith("delimited", {
        enabled: true,
        wildness: 0,
        delimited: 75,
        delimitedEnabled: false,
      })
    );
    await waitFor(() =>
      expect(
        (screen.getByRole("checkbox", { name: "Delimited" }) as HTMLInputElement).disabled
      ).toBe(false)
    );
    fireEvent.click(screen.getByRole("checkbox", { name: "Delimited" }));
    await waitFor(() =>
      expect(mocks.save).toHaveBeenLastCalledWith("delimited", {
        enabled: true,
        wildness: 0,
        delimited: 75,
        delimitedEnabled: true,
      })
    );
  });

  it("saves punch independently of variation, phrase length, and device speed", async () => {
    mocks.provider = "multifunplayer";
    mocks.read.mockResolvedValue({ enabled: true, wildness: 50, variation: 20 });
    mocks.save.mockImplementation(async (_uri: string, value: ScriptEnhancement) => value);
    const i18n = setupI18n({ locale: "en", messages: { en: {} } });
    await act(async () => {
      render(
        <I18nProvider i18n={i18n}>
          <ScriptEnhancementControl scriptUri="controls" />
        </I18nProvider>
      );
    });
    fireEvent.click(screen.getByText("Auto enhance script"));
    const punch = screen.getByRole("slider", { name: "Beat punch" });
    fireEvent.change(punch, { target: { value: "90" } });
    fireEvent.pointerUp(punch);
    await waitFor(() =>
      expect(mocks.save).toHaveBeenCalledWith("controls", {
        enabled: true,
        wildness: 50,
        variation: 20,
        beatPunch: 90,
      })
    );
    await waitFor(() =>
      expect(
        (screen.getByRole("combobox", { name: "Phrase length" }) as HTMLSelectElement).disabled
      ).toBe(false)
    );
    fireEvent.change(screen.getByRole("combobox", { name: "Phrase length" }), {
      target: { value: "16" },
    });
    await waitFor(() =>
      expect(mocks.save).toHaveBeenLastCalledWith(
        "controls",
        expect.objectContaining({ phraseLength: 16, beatPunch: 90, variation: 20 })
      )
    );
    await waitFor(() =>
      expect(
        (screen.getByRole("combobox", { name: "Device speed profile" }) as HTMLSelectElement)
          .disabled
      ).toBe(false)
    );
    fireEvent.change(screen.getByRole("combobox", { name: "Device speed profile" }), {
      target: { value: "powerful" },
    });
    await waitFor(() =>
      expect(mocks.saveProfile).toHaveBeenCalledWith("multifunplayer", {
        preset: "powerful",
        customRate: 1600,
      })
    );
  });

  it("uses saved wildness as the initial punch and retains changes when disabled", async () => {
    const i18n = setupI18n({ locale: "en", messages: { en: {} } });
    mocks.read.mockResolvedValue({ enabled: true, wildness: 60 });
    mocks.save.mockImplementation(async (_uri: string, value: ScriptEnhancement) => value);
    await act(async () => {
      render(
        <I18nProvider i18n={i18n}>
          <ScriptEnhancementControl scriptUri="a.funscript" />
        </I18nProvider>
      );
    });
    fireEvent.click(screen.getByText("Auto enhance script"));
    const slider = screen.getByRole("slider", { name: "Beat punch" });
    expect((slider as HTMLInputElement).value).toBe("60");
    fireEvent.change(slider, { target: { value: "85" } });
    fireEvent.pointerUp(slider);
    await waitFor(() =>
      expect(mocks.save).toHaveBeenCalledWith("a.funscript", {
        enabled: true,
        wildness: 60,
        beatPunch: 85,
      })
    );
    await waitFor(() =>
      expect(
        (screen.getByRole("checkbox", { name: "Enhance this script" }) as HTMLInputElement).disabled
      ).toBe(false)
    );
    fireEvent.click(screen.getByRole("checkbox", { name: "Enhance this script" }));
    await waitFor(() =>
      expect(mocks.save).toHaveBeenCalledWith("a.funscript", {
        enabled: false,
        wildness: 60,
        beatPunch: 85,
      })
    );
  });
});
