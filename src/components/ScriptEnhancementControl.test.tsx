import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { setupI18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ScriptEnhancement } from "../services/haptics/scriptEnhancement";

const mocks = vi.hoisted(() => ({ read: vi.fn(), save: vi.fn() }));
vi.mock("../services/scriptEnhancementSettings", () => ({
  readScriptEnhancement: mocks.read,
  saveScriptEnhancement: mocks.save,
}));
import { ScriptEnhancementControl } from "./ScriptEnhancementControl";

afterEach(cleanup);

describe("script enhancement controls", () => {
  it("loads per-script settings, saves wildness, and retains it when disabled", async () => {
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
    const slider = screen.getByRole("slider", { name: "Wildness" });
    expect((slider as HTMLInputElement).value).toBe("60");
    fireEvent.change(slider, { target: { value: "85" } });
    fireEvent.pointerUp(slider);
    await waitFor(() =>
      expect(mocks.save).toHaveBeenCalledWith("a.funscript", { enabled: true, wildness: 85 })
    );
    await waitFor(() =>
      expect((screen.getByRole("checkbox") as HTMLInputElement).disabled).toBe(false)
    );
    fireEvent.click(screen.getByRole("checkbox"));
    await waitFor(() =>
      expect(mocks.save).toHaveBeenCalledWith("a.funscript", { enabled: false, wildness: 85 })
    );
  });
});
