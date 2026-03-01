import { app } from "electron";
import path from "node:path";

export function resolveAppStorageBaseDir(): string {
  return app.isPackaged ? app.getPath("userData") : app.getAppPath();
}

export function resolveInstallExportBaseDir(): string {
  return path.join(resolveAppStorageBaseDir(), "export");
}
