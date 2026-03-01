import { describe, expect, it } from "vitest";
import { createDefaultPlaylistConfig, toGameConfigFromPlaylist } from "./playlistRuntime";
import { ZGameConfig } from "./saveSchema";

describe("saveSchema game config", () => {
  it("defaults missing cum-round interjection suppression to enabled", () => {
    const config = toGameConfigFromPlaylist(createDefaultPlaylistConfig([]), []);
    const legacyConfig = { ...config };
    delete legacyConfig.disableInterjectionsDuringCumRounds;

    expect(ZGameConfig.parse(legacyConfig).disableInterjectionsDuringCumRounds).toBe(true);
  });

  it("preserves an explicitly disabled cum-round interjection setting", () => {
    const config = toGameConfigFromPlaylist(createDefaultPlaylistConfig([]), []);

    expect(
      ZGameConfig.parse({
        ...config,
        disableInterjectionsDuringCumRounds: false,
      }).disableInterjectionsDuringCumRounds
    ).toBe(false);
  });

  it("defaults missing final cum-round pausing to disabled and preserves an opt-in", () => {
    const config = toGameConfigFromPlaylist(createDefaultPlaylistConfig([]), []);
    const legacyConfig = { ...config };
    delete legacyConfig.allowPausingDuringFinalCumRound;

    expect(ZGameConfig.parse(legacyConfig).allowPausingDuringFinalCumRound).toBe(false);
    expect(
      ZGameConfig.parse({
        ...config,
        allowPausingDuringFinalCumRound: true,
      }).allowPausingDuringFinalCumRound
    ).toBe(true);
  });
});
