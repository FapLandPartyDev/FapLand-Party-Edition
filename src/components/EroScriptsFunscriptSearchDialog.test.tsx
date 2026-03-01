import type React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getLoginStatus: vi.fn(),
  search: vi.fn(),
  listTopicMedia: vi.fn(),
  downloadFunscript: vi.fn(),
  downloadVideo: vi.fn(),
  openLoginWindow: vi.fn(),
  clearLoginCookies: vi.fn(),
  translate: (value: TemplateStringsArray | string) => (Array.isArray(value) ? value[0] : value),
}));

vi.mock("@lingui/react/macro", () => ({
  Trans: ({ children }: { children: React.ReactNode }) => children,
  useLingui: () => ({
    t: mocks.translate,
  }),
}));

vi.mock("../services/eroscripts", () => ({
  eroscripts: mocks,
}));

vi.mock("../services/security", () => ({
  security: { openExternal: vi.fn() },
}));

vi.mock("../utils/audio", () => ({
  playHoverSound: vi.fn(),
  playSelectSound: vi.fn(),
}));

import { EroScriptsFunscriptSearchDialog } from "./EroScriptsFunscriptSearchDialog";

describe("EroScriptsFunscriptSearchDialog", () => {
  beforeEach(() => {
    window.electronAPI = {
      eroscripts: {
        subscribeToLoginStatus: vi.fn(() => () => undefined),
      },
    } as unknown as typeof window.electronAPI;
    mocks.getLoginStatus.mockResolvedValue({
      loggedIn: true,
      username: "tester",
      cookieCount: 1,
      error: null,
    });
    mocks.search.mockResolvedValue([
      {
        topicId: 42,
        title: "Matching Topic",
        excerpt: "A matching script",
        author: "Author",
        createdAt: null,
        url: "https://discuss.eroscripts.com/t/42",
      },
    ]);
    mocks.listTopicMedia.mockResolvedValue({
      funscripts: [
        {
          topicId: 42,
          postId: 7,
          url: "https://cdn.example.com/matching.funscript",
          filename: "matching.funscript",
          supported: true,
          unsupportedReason: null,
        },
      ],
      videos: [],
    });
    mocks.downloadFunscript.mockResolvedValue({
      funscriptUri: "app://media/eroscripts/matching.funscript",
      filename: "matching.funscript",
    });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  const openTopic = async () => {
    fireEvent.click(await screen.findByRole("button", { name: /Matching Topic/ }));
    await screen.findByText("matching.funscript");
  };

  it("shows only the attachment action in attachment-only mode", async () => {
    const onAttachFunscript = vi.fn();
    render(
      <EroScriptsFunscriptSearchDialog
        open
        initialQuery="Matching"
        onClose={() => undefined}
        onAttachFunscript={onAttachFunscript}
      />
    );

    await openTopic();

    expect(screen.queryByRole("button", { name: "Use with Video" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Attach to Current Video" }));

    await waitFor(() => {
      expect(onAttachFunscript).toHaveBeenCalledWith({
        funscriptUri: "app://media/eroscripts/matching.funscript",
        filename: "matching.funscript",
      });
    });
  });

  it("retains both funscript actions when video installation is available", async () => {
    render(
      <EroScriptsFunscriptSearchDialog
        open
        initialQuery="Matching"
        onClose={() => undefined}
        onAttachFunscript={() => undefined}
        onInstallRound={() => undefined}
      />
    );

    await openTopic();

    expect(screen.getByRole("button", { name: "Use with Video" })).toBeDefined();
    expect(screen.getByRole("button", { name: "Attach to Current Video" })).toBeDefined();
  });
});
