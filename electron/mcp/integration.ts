import path from "node:path";
import { randomUUID } from "node:crypto";
import { app, ipcMain, type BrowserWindow, type WebContents } from "electron";
import { z } from "zod";
import { appRouter } from "../trpc/router";
import { withLocalControlPaths } from "../services/dialogPathApproval";
import { getStore } from "../services/store";
import { ZPlaylistConfig, ZGraphBoardConfig } from "../../src/game/playlistSchema";
import { settingsCatalog } from "../../src/mcp/settingsCatalog";
import { ZLiveMapConfig, ZMapEditorRequest } from "../../src/mcp/mapEditorSchema";
import { ZMcpUiRequest, type McpChange } from "../../src/mcp/types";
import { createControlServer, jsonSchema } from "./protocol";
import { McpRuntime } from "./runtime";
import { createLibraryTools } from "./libraryTools";
import { formatConverterResult } from "./converterResults";
import { createScreenTools, formatScreenResult } from "./screenControl";

export function installMcp(getWindow: () => BrowserWindow | null) {
  const screenTools = createScreenTools(getWindow);
  const pending = new Map<
    string,
    { sender: WebContents; resolve: (value: unknown) => void; reject: (error: Error) => void }
  >();
  const requireWindow = () => {
    const window = getWindow();
    if (!window || window.isDestroyed() || window.webContents.isDestroyed())
      throw new Error("The app window is unavailable.");
    return window;
  };
  const requestUi = async (input: z.infer<typeof ZMcpUiRequest>) => {
    const window = requireWindow();
    const id = randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(
          new Error(
            "The app did not respond within 15 seconds. Inspect before retrying a mutation."
          )
        );
      }, 15_000);
      pending.set(id, {
        sender: window.webContents,
        resolve: (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        },
      });
      window.webContents.send("mcp:ui-request", { id, input });
    });
  };
  const notifyChange = (procedure: string, input?: unknown) => {
    const window = getWindow();
    if (!window || window.isDestroyed() || window.webContents.isDestroyed()) return;
    const change: McpChange = { procedure };
    if (procedure === "store.set") {
      const { key } = input as { key: string };
      change.setting = { key, value: getStore().get(key) };
    }
    window.webContents.send("mcp:changed", change);
  };
  const runtime = new McpRuntime(path.join(app.getPath("userData"), "mcp-server.json"), () =>
    createControlServer({
      router: appRouter,
      context: () => ({ source: "mcp" }),
      resources: {
        "fland://schemas/playlist": {
          description:
            "Complete playlist config, advanced map graph, pools, music and automation schema.",
          value: jsonSchema(ZPlaylistConfig, "output"),
        },
        "fland://schemas/graph": {
          description: "Advanced map nodes, edges, branches, pools, style and automations.",
          value: jsonSchema(ZGraphBoardConfig),
        },
        "fland://schemas/live-map": {
          description: "Live advanced map editor config. Patch paths are relative to this config.",
          value: jsonSchema(ZLiveMapConfig),
        },
        "fland://guide": {
          description: "Workflows and units for controlling F-Land.",
          value: {
            eroscripts:
              "Use eroscripts.getLoginStatus to check the integrated app session, search to find topics and listTopicMedia for candidate URLs. Call eroscripts.startDownload with kind=funscript/video and the candidate fields (filename is required for scripts), then poll eroscripts.getDownload by jobId. Completed jobs return local media URIs: inspectFrames/inspectFunscript/autoDetect can use them directly, and converter.saveSegments can create rounds. To replace installed media, use db.replaceRoundMedia with roundId and videoUri and/or funscriptUri; null detaches a script. Replacement copies media into durable storage, preserves metadata and trims, returns previous resource values and never deletes originals. resetTrim=true explicitly clears trims for a shorter replacement. External video hosts use the existing supported/trusted downloader; EroScripts cookies are never sent to those hosts. Jobs do not survive app restarts. No login credentials are needed when the integrated session is already signed in.",
            cutting:
              "Use fland_converter_inspectFrames to see images from an agent-selected time range or exact source timestamps and obtain durationMs. Use fland_converter_inspectFunscript to see its plot, metadata and paginated actions; all timestamps remain absolute source milliseconds. fland_converter_autoDetect supports standard/adaptive/targetCount and returns unsaved proposals using the editor's detection. Inspect proposed boundaries, adjust segments, and call fland_converter_saveSegments to persist. Read-only inspection never alters media or editor drafts. Plain paths, file:// and app://media URIs are accepted; website videos must be cached first.",
            rounds:
              "List fland_db_getInstalledRounds or getInstalledRoundCatalog. Rename/edit with fland_db_updateRound, preserving existing values. Times are milliseconds. Delete with deleteRound/deleteRounds. Use fland_converter_saveSegments for cuts and multiple segments.",
            install:
              "Supply absolute paths directly. Import local videos with db.importLegacyVideoFileAsRound; sidecars/packages with db.importInstallSidecarFile; folders with db.scanInstallFolderOnce. Acquisition tools manage remote sources, downloads and job status. Imports may require trust/confirmation in the visible app; use fland_ui to inspect and answer those prompts.",
            playlists:
              "Read playlist.list/getById. Create with playlist.create (omit config for defaults). Replace config with playlist.update, preserving unrelated fields. Reorder using linear boardConfig.normalRoundOrder. For graph maps read the playlist/graph schema resources; define nodes, edges, startNodeId, pools and automations in boardConfig. playlist.saveEditorDraft is separate from the playable config.",
            collaborativeMap:
              "Use fland_map_editor inspect for the OPEN unsaved map, selected node/edge/text IDs, viewport, tool, validation, undo state and tile catalog. Combine with fland_screenshot to understand what the user sees. Apply atomic patches with expectedRevision from the latest inspect; paths are config-relative arrays, e.g. [nodes,0,name]. set replaces a property/array or appends at array.length; remove deletes a property or splices an array. Preserve unrelated work. Stale revisions fail; inspect again after human edits. Edits appear immediately, support Undo and autosave. saveDraft persists unfinished work; publish validates and updates the playable playlist. Use this instead of backend playlist.update/saveEditorDraft when collaborating in the open editor. Read fland://schemas/live-map for fields. For a new map create a playlist, navigate to /map-editor and select it in the UI first.",
            settings:
              "Use fland_settings_catalog, then store.get/getMany/set. Values use native JSON types. Startup/graphics flags may require a restart. The catalog includes exported keys/defaults plus existing store keys.",
            ui: "Use fland_screenshot to see the rendered app, including canvas maps and video. Use fland_ui_input with the screenshotId and image-pixel coordinates to click, hover, drag, scroll, type Unicode text or press keyboard shortcuts; it returns a fresh screenshot by default. Use the newest screenshot after actions. Resizing, zoom or navigation invalidates old coordinates. Input focuses the app. fland_ui inspect supplies semantic control IDs, CSS viewport bounds and canvas bounds; use targetId for click/set/media or navigate for an internal path. Native OS dialogs and other desktop apps are outside these tools. Changes to library/config invalidate renderer queries; use fland_map_editor for the open unsaved map draft.",
          },
        },
      },
      tools: [
        ...screenTools,
        {
          name: "fland_map_editor",
          description:
            "Read and edit the visible advanced map editor, including unsaved work, selection, viewport, validation and tile catalog. Inspect first. All mutations require expectedRevision. Atomic config-relative patches support set/remove, nodes, edges, pools, styles, music, automations and settings. Changes appear immediately and use editor Undo/autosave. saveDraft saves unfinished work; publish saves the playable playlist after validation. Use alongside screenshots for collaborative requests about selected/visible tiles.",
          schema: ZMapEditorRequest,
          run: (editor: z.infer<typeof ZMapEditorRequest>) =>
            requestUi({ action: "mapEditor", editor }),
        },
        ...createLibraryTools(appRouter.createCaller({ source: "mcp" }), notifyChange),
        {
          name: "fland_settings_catalog",
          description:
            "List available setting keys, defaults and current persisted values. Filter by key prefix. Use store.set to update settings.",
          schema: z.object({ prefix: z.string().optional() }),
          readOnly: true,
          run: (input: { prefix?: string }) => {
            const persisted = getStore().store;
            const flatten = (object: Record<string, unknown>, prefix = ""): string[] =>
              Object.entries(object).flatMap(([key, value]) => {
                const name = prefix ? `${prefix}.${key}` : key;
                return value && typeof value === "object" && !Array.isArray(value)
                  ? flatten(value as Record<string, unknown>, name)
                  : [name];
              });
            const keys = new Set([
              ...settingsCatalog.map((entry) => entry.key),
              ...flatten(persisted),
            ]);
            return [...keys]
              .filter((key) => key.startsWith(input.prefix ?? ""))
              .sort()
              .map((key) => ({
                ...settingsCatalog.find((entry) => entry.key === key),
                key,
                value: getStore().get(key),
              }));
          },
        },
        {
          name: "fland_ui",
          description:
            "Control the visible app, including navigation, gameplay, dialogs, playback, and settings. Inspect first for target IDs. Set supports text/select inputs and checkbox booleans; key sends a keyboard key; media supports play/pause/seek (seconds)/volume (0..1)/mute (boolean).",
          schema: ZMcpUiRequest,
          run: requestUi,
        },
      ],
      afterMutation: notifyChange,
      runProcedure: withLocalControlPaths,
      formatResult: (name, result) =>
        formatScreenResult(name, result) ?? formatConverterResult(name, result),
    })
  );
  const assertSender = (sender: WebContents) => {
    if (sender !== requireWindow().webContents) throw new Error("Untrusted MCP settings caller.");
  };
  ipcMain.handle("mcp:status", (event) => {
    assertSender(event.sender);
    return runtime.status();
  });
  ipcMain.handle("mcp:configure", (event, raw: unknown) => {
    assertSender(event.sender);
    return runtime.configure(
      z
        .object({
          enabled: z.boolean(),
          port: z.number().int().min(1).max(65535),
        })
        .parse(raw)
    );
  });
  ipcMain.on("mcp:ui-response", (event, raw: unknown) => {
    const result = z
      .object({ id: z.string(), value: z.unknown().optional(), error: z.string().optional() })
      .safeParse(raw);
    if (!result.success) return;
    const request = pending.get(result.data.id);
    if (!request || request.sender !== event.sender) return;
    pending.delete(result.data.id);
    if (result.data.error) request.reject(new Error(result.data.error));
    else request.resolve(result.data.value);
  });
  return runtime;
}
