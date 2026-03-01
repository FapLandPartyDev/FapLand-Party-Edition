// @vitest-environment node
import { expect, it } from "vitest";
import path from "node:path";
import { assertApprovedDialogPath, withLocalControlPaths } from "../services/dialogPathApproval";

it("accepts direct paths in local MCP calls without granting concurrent renderer calls access", async () => {
  const filePath = path.resolve("example.fplay");
  let release!: () => void;
  const pending = withLocalControlPaths(async () => {
    await new Promise<void>((resolve) => {
      release = resolve;
    });
    return assertApprovedDialogPath("playlistImportFile", filePath);
  });
  expect(() => assertApprovedDialogPath("playlistImportFile", filePath)).toThrow("system dialog");
  release();
  expect(await pending).toBe(filePath);
  expect(() => assertApprovedDialogPath("playlistImportFile", filePath)).toThrow("system dialog");
});
