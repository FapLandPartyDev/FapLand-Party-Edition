// @vitest-environment jsdom
import { act, renderHook, cleanup } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { useMcpSettingsRevision } from "./useMcpSettingsRevision";
import { MCP_CHANGED_EVENT } from "./types";

afterEach(cleanup);
it("refreshes live settings consumers only for matching persisted settings", () => {
  const { result } = renderHook(() => useMcpSettingsRevision("music."));
  const change = (detail: unknown) =>
    act(() => {
      window.dispatchEvent(new CustomEvent(MCP_CHANGED_EVENT, { detail }));
    });
  change({ procedure: "db.updateRound" });
  change({ procedure: "store.set", setting: { key: "moaning.volume", value: 0.1 } });
  expect(result.current).toBe(0);
  change({ procedure: "store.set", setting: { key: "music.volume", value: 0.2 } });
  expect(result.current).toBe(1);
});
