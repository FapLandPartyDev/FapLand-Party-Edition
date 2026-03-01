// @vitest-environment node

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  approveDialogPath,
  assertApprovedDialogPath,
  clearApprovedDialogPathsForTests,
} from "./dialogPathApproval";

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  clearApprovedDialogPathsForTests();
});

describe("dialogPathApproval", () => {
  it("normalizes approved paths and consumes approvals after one use", () => {
    approveDialogPath("playlistImportFile", "/tmp/example/../playlist.fplay");

    expect(assertApprovedDialogPath("playlistImportFile", "/tmp/playlist.fplay")).toBe("/tmp/playlist.fplay");
    expect(() => assertApprovedDialogPath("playlistImportFile", "/tmp/playlist.fplay")).toThrow(
      "Path must be selected through the system dialog.",
    );
  });

  it("rejects expired approvals", () => {
    vi.useFakeTimers();
    approveDialogPath("playlistExportFile", "/tmp/exported.fplay");

    vi.advanceTimersByTime(10 * 60 * 1000 + 1);

    expect(() => assertApprovedDialogPath("playlistExportFile", "/tmp/exported.fplay")).toThrow(
      "Path must be selected through the system dialog.",
    );
    vi.useRealTimers();
  });
});
