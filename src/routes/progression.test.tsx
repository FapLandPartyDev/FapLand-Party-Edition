import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const profile = {
    totalXp: 100,
    level: 2,
    unspentSkillPoints: 0,
    spentSkillPoints: 2,
    respecTokens: 0,
    equippedTitle: {
      id: "fresh-face",
      name: "Fresh Meat",
      safeName: "Fresh Recruit",
      requiredLevel: 1,
    },
    unlockedTitles: [
      {
        id: "fresh-face",
        name: "Fresh Meat",
        safeName: "Fresh Recruit",
        requiredLevel: 1,
      },
    ],
    skillRanks: { "pocket-pauses": 2 },
    disabledSkillIds: [] as string[],
    disabledSkillRanks: 0,
    skillDeactivationXpBonusPercent: 0,
    isCheated: false,
    genuineLevel: 2,
    genuineTotalXp: 100,
  };
  return {
    profile,
    navigate: vi.fn(),
    setSkillEnabled: vi.fn(),
    setAllSkillsEnabled: vi.fn(),
    activateCheatProfile: vi.fn(),
    getStoredCheatMode: vi.fn(async () => true),
  };
});

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (configuration: Record<string, unknown>) => ({
    ...configuration,
    useLoaderData: () => mocks.profile,
  }),
  useNavigate: () => mocks.navigate,
}));

vi.mock("../components/AnimatedBackground", () => ({
  AnimatedBackground: () => null,
}));

vi.mock("../hooks/useSfwMode", () => ({
  useSfwMode: () => false,
}));

vi.mock("../services/progression", () => ({
  progression: {
    getProfile: vi.fn(),
    purchaseSkill: vi.fn(),
    respec: vi.fn(),
    equipTitle: vi.fn(),
    setSkillEnabled: mocks.setSkillEnabled,
    setAllSkillsEnabled: mocks.setAllSkillsEnabled,
    activateCheatProfile: mocks.activateCheatProfile,
  },
}));

vi.mock("../services/trpc", () => ({
  trpc: {
    store: {
      get: {
        query: mocks.getStoredCheatMode,
      },
    },
  },
}));

import { ProgressionRoute } from "./progression";

describe("ProgressionRoute skill activation", () => {
  beforeEach(() => {
    cleanup();
    mocks.setSkillEnabled.mockReset();
    mocks.setAllSkillsEnabled.mockReset();
    mocks.setSkillEnabled.mockResolvedValue(mocks.profile);
    mocks.setAllSkillsEnabled.mockResolvedValue(mocks.profile);
    mocks.activateCheatProfile.mockReset();
    mocks.activateCheatProfile.mockResolvedValue({
      ...mocks.profile,
      isCheated: true,
    });
    mocks.getStoredCheatMode.mockReset();
    mocks.getStoredCheatMode.mockResolvedValue(true);
  });

  it("deactivates an individual purchased skill", async () => {
    render(<ProgressionRoute />);

    fireEvent.click(screen.getByRole("button", { name: "Deactivate Pocket Pauses" }));

    await waitFor(() => {
      expect(mocks.setSkillEnabled).toHaveBeenCalledWith("pocket-pauses", false);
    });
  });

  it("deactivates every purchased skill from the bulk control", async () => {
    render(<ProgressionRoute />);

    fireEvent.click(screen.getByRole("button", { name: "Deactivate all" }));

    await waitFor(() => {
      expect(mocks.setAllSkillsEnabled).toHaveBeenCalledWith(false);
    });
  });

  it("shows the cheat console button when Cheat Mode is enabled and opens it on click", async () => {
    render(<ProgressionRoute />);

    await waitFor(() => expect(mocks.getStoredCheatMode).toHaveBeenCalled());

    fireEvent.click(screen.getByRole("button", { name: /cheat console/i }));

    await waitFor(() => {
      expect(mocks.activateCheatProfile).toHaveBeenCalledOnce();
      expect(
        screen.getByRole("dialog", { name: "Secret progression cheat console" })
      ).toBeTruthy();
    });
  });

  it("does not show the cheat console button when Cheat Mode is disabled", async () => {
    mocks.getStoredCheatMode.mockResolvedValue(false);
    render(<ProgressionRoute />);

    await waitFor(() => expect(mocks.getStoredCheatMode).toHaveBeenCalled());

    expect(screen.queryByRole("button", { name: /cheat console/i })).toBeNull();
  });
});
