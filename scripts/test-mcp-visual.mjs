import { build } from "esbuild";
import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const directory = await fs.mkdtemp(path.join(os.tmpdir(), "fland-visual-test-"));
try {
  await build({
    entryPoints: ["electron/mcp/screenControl.ts"],
    outfile: path.join(directory, "screenControl.cjs"),
    platform: "node",
    format: "cjs",
    bundle: true,
    external: ["electron"],
  });
  await fs.copyFile("scripts/test-mcp-visual-window.cjs", path.join(directory, "test.cjs"));
  const electron = createRequire(import.meta.url)("electron");
  const environment = { ...process.env };
  delete environment.ELECTRON_RUN_AS_NODE;
  const code = await new Promise((resolve, reject) => {
    const child = spawn(electron, [path.join(directory, "test.cjs")], {
      windowsHide: true,
      stdio: "inherit",
      env: environment,
    });
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error("Visual verification timed out."));
    }, 30000);
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve(code);
    });
  });
  if (code !== 0) throw new Error(`Visual verification exited with ${code}.`);
} finally {
  await fs.rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}
