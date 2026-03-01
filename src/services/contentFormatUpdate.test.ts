import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  check: vi.fn(),
  openLatestDownload: vi.fn(),
  prompt: vi.fn(),
}));

vi.mock("./trpc", () => ({
  trpc: {
    updater: {
      check: { mutate: mocks.check },
      openLatestDownload: { mutate: mocks.openLatestDownload },
    },
  },
}));

vi.mock("./contentFormatUpdatePrompt", () => ({
  promptForContentFormatUpdate: mocks.prompt,
}));

import { offerUpdateForIncompatibleContent } from "./contentFormatUpdate";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.prompt.mockResolvedValue({ action: "dismiss" });
  mocks.openLatestDownload.mockResolvedValue(undefined);
});

describe("offerUpdateForIncompatibleContent", () => {
  it("does not prompt when the app is already current", async () => {
    mocks.check.mockResolvedValue({
      status: "up_to_date",
      currentVersion: "0.6.23-beta",
      latestVersion: "0.6.23-beta",
    });

    await expect(offerUpdateForIncompatibleContent("/tmp/future.hero")).resolves.toBe(false);

    expect(mocks.check).toHaveBeenCalledWith({ force: true });
    expect(mocks.prompt).not.toHaveBeenCalled();
  });

  it("prompts with version details when a newer app is available", async () => {
    mocks.check.mockResolvedValue({
      status: "update_available",
      currentVersion: "0.6.22-beta",
      latestVersion: "0.6.23-beta",
    });

    await expect(offerUpdateForIncompatibleContent("/tmp/Future Hero.hero")).resolves.toBe(true);

    expect(mocks.prompt).toHaveBeenCalledWith({
      fileName: "Future Hero.hero",
      currentVersion: "0.6.22-beta",
      latestVersion: "0.6.23-beta",
    });
    expect(mocks.openLatestDownload).not.toHaveBeenCalled();
  });

  it("opens the latest download when the user accepts the update prompt", async () => {
    mocks.check.mockResolvedValue({
      status: "update_available",
      currentVersion: "0.6.22-beta",
      latestVersion: "0.6.23-beta",
    });
    mocks.prompt.mockResolvedValue({ action: "update" });

    await offerUpdateForIncompatibleContent("C:\\packs\\future.fplay");

    expect(mocks.openLatestDownload).toHaveBeenCalledOnce();
  });

  it("keeps the original import flow usable when the update check fails", async () => {
    mocks.check.mockRejectedValue(new Error("offline"));

    await expect(offerUpdateForIncompatibleContent("/tmp/future.round")).resolves.toBe(false);
    expect(mocks.prompt).not.toHaveBeenCalled();
  });
});
