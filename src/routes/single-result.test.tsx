import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  search: {
    score: 420,
    highscore: 500,
    survivedDurationSec: 372,
    reason: "finished" as const,
    xpAwarded: undefined as number | undefined,
    skillDeactivationBonusXp: undefined as number | undefined,
    skillDeactivationBonusPercent: undefined as number | undefined,
    level: undefined as number | undefined,
  },
  navigate: vi.fn(),
}));

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => () => ({
    useSearch: () => mocks.search,
  }),
  useNavigate: () => mocks.navigate,
}));

import { SingleResultRoute } from "./single-result";

describe("SingleResultRoute", () => {
  beforeEach(() => {
    mocks.navigate.mockReset();
    mocks.search = {
      score: 420,
      highscore: 500,
      survivedDurationSec: 372,
      reason: "finished",
      xpAwarded: undefined,
      skillDeactivationBonusXp: undefined,
      skillDeactivationBonusPercent: undefined,
      level: undefined,
    };
  });

  it("renders the survived duration from route search", () => {
    render(<SingleResultRoute />);

    expect(screen.getByText("Survived")).toBeTruthy();
    expect(screen.getByText("6:12")).toBeTruthy();
    expect(screen.getByText("TIME")).toBeTruthy();
  });

  it("shows the skill challenge XP bonus", () => {
    mocks.search.xpAwarded = 181;
    mocks.search.skillDeactivationBonusXp = 23;
    mocks.search.skillDeactivationBonusPercent = 15;
    mocks.search.level = 2;

    render(<SingleResultRoute />);

    expect(screen.getByText("+181 XP · Level 2")).toBeTruthy();
    expect(screen.getByText("Skill challenge +23 XP (+15%)")).toBeTruthy();
  });
});
