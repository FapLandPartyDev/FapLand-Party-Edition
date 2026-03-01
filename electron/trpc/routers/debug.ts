import { clipboard, dialog, shell } from "electron";
import fs from "node:fs/promises";
import path from "node:path";
import * as z from "zod";
import {
  clearDebugLogFile,
  collectDebugDiagnostics,
  createDebugBundle,
  debugLog,
  getAllSettingsSanitized,
  getDebugLogFilePath,
  getDebugState,
  sanitizeForPublicDebug,
  setDebugLogLevel,
} from "../../services/debugLogging";
import {
  DEBUG_LOG_LEVELS,
  normalizeDebugLogLevel,
  type DebugLogLevel,
} from "../../../src/constants/debugSettings";
import { publicProcedure, router } from "../trpc";

const ZDebugLogLevel = z.enum(DEBUG_LOG_LEVELS);

export const debugRouter = router({
  getState: publicProcedure.query(() => getDebugState()),

  setLogLevel: publicProcedure.input(z.object({ level: ZDebugLogLevel })).mutation(({ input }) => {
    setDebugLogLevel(normalizeDebugLogLevel(input.level) as DebugLogLevel);
    debugLog.info("debug", "Debug log level changed", { level: input.level });
  }),

  getDiagnostics: publicProcedure.query(() => collectDebugDiagnostics()),

  getAllSettings: publicProcedure.query(() => getAllSettingsSanitized()),

  getDebugBundle: publicProcedure.query(() => createDebugBundle()),

  copyDebugBundle: publicProcedure.mutation(async () => {
    const bundle = await createDebugBundle();
    clipboard.writeText(bundle.content);
    debugLog.info("debug", "Debug bundle copied", { bytes: Buffer.byteLength(bundle.content) });
    return { bytes: Buffer.byteLength(bundle.content) };
  }),

  exportDebugBundle: publicProcedure.mutation(async () => {
    const bundle = await createDebugBundle();
    const result = await dialog.showSaveDialog({
      title: "Export Debug File",
      defaultPath: bundle.filename,
      filters: [{ name: "Text", extensions: ["txt"] }],
    });
    if (result.canceled || !result.filePath) return { filePath: null, anonymizedFilePath: null };

    await fs.writeFile(result.filePath, bundle.content, "utf8");
    debugLog.info("debug", "Debug bundle exported", { filePath: result.filePath });
    return {
      filePath: result.filePath,
      anonymizedFilePath: sanitizeForPublicDebug(result.filePath),
    };
  }),

  openLogFolder: publicProcedure.mutation(async () => {
    const logFilePath = getDebugLogFilePath();
    await fs.mkdir(path.dirname(logFilePath), { recursive: true });
    shell.showItemInFolder(logFilePath);
  }),

  clearLogFile: publicProcedure.mutation(async () => {
    await clearDebugLogFile();
  }),
});
