# Control F-Land with MCP

The desktop app automatically starts a local MCP server at `http://127.0.0.1:32123/mcp`. No authentication, tokens, or authorization prompts are required. Keep the app running. Open **Settings → Security & Privacy → MCP App Control** to copy the URL, change the port, stop/start the server, or retry after a port conflict. Simultaneous profiles need different ports.

## Connect a local client

Select **Streamable HTTP**, use that URL, and select **No authentication**. For clients that support only stdio, use the standalone bridge with Node.js 22.12 or newer:

```json
{
  "mcpServers": {
    "f-land": {
      "command": "node",
      "args": ["/path/to/f-land/scripts/mcp-stdio.mjs"],
      "env": {
        "FLAND_MCP_URL": "http://127.0.0.1:32123/mcp"
      }
    }
  }
}
```

Replace the script path with your checkout's absolute path. Packaged releases include the bridge and this guide under `resources/mcp/`. The bridge has no npm dependencies and forwards calls to the running app without opening another database. Its stdout contains only protocol messages. `npm run mcp:stdio` also runs it; the default URL works without environment variables.

## Connect ChatGPT

ChatGPT cloud connections need a reachable server or private tunnel to reach this computer. Follow the official [custom MCP connection guide](https://developers.openai.com/api/docs/guides/custom-mcp-server), or use [Secure MCP Tunnel](https://developers.openai.com/api/docs/guides/secure-mcp-tunnels) where available. Account and workspace restrictions apply.

For a tunnel or HTTPS gateway, forward requests to `http://127.0.0.1:32123`, preserve `/mcp`, and rewrite the upstream Host header to `127.0.0.1:32123`. Add its reachable `/mcp` URL in ChatGPT and select **No authentication**. Install/select the resulting connection in the chat. The feature does not provision a tunnel. ChatGPT's own write-action confirmations are controlled by ChatGPT; direct account connectivity requires external setup and is not covered by the local tests.

## Controls

Every non-subscription backend procedure becomes an MCP tool automatically. Names follow `fland_<router>_<procedure>`. Inputs use the app's existing Zod schemas, and calls run through the same tRPC middleware, services and database.

| Task                                                                   | Tools                                                                                                                                                |
| ---------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| List, rename, tag, trim, delete rounds                                 | `fland_db_getInstalledRounds`, `fland_round_edit`, `fland_db_deleteRound`, `fland_db_deleteRounds`                                                   |
| Cut videos into rounds, including internal cut ranges                  | `fland_converter_saveSegments`; times are milliseconds                                                                                               |
| Install local videos, sidecars/packages or folders                     | `fland_db_importLegacyVideoFileAsRound`, `fland_db_importInstallSidecarFile`, `fland_db_scanInstallFolderOnce`; provide file paths directly          |
| Manage download sources and jobs                                       | All `fland_acquisition_*` tools, including queue/pause/resume/retry/cancel/status                                                                    |
| Create/edit/duplicate/select/import/export/delete playlists            | All `fland_playlist_*` tools                                                                                                                         |
| Reorder playlist rounds                                                | `fland_playlist_reorder`, supplying a full zero-based permutation such as `[2,0,1]`; pinned assignments remain pinned                                |
| Create advanced maps                                                   | `fland_map_create`, with graph nodes, branching edges, weighted pools, backgrounds, text and automations                                             |
| Edit maps and game rules                                               | Read `fland_playlist_getById`, then replace the complete config with `fland_playlist_update`; drafts use `fland_playlist_saveEditorDraft` separately |
| Collaborate on the open map                                            | `fland_map_editor`: inspect the live draft and selection, then patch with its revision; supports Undo/Redo, saveDraft and publish |
| Inspect/change settings                                                | `fland_settings_catalog`, `fland_store_get`, `fland_store_getMany`, `fland_store_set`; pass native JSON values                                       |
| Navigate, gameplay, dialogs, playback and visible controls             | `fland_ui`: `inspect`, then `navigate`, `click`, `set`, `key` or `media` with returned control IDs                                                   |
| Integrations, scans, backups/migration, binaries, updates, diagnostics | Tools from the remaining backend routers                                                                                                             |

Use `fland_read_resource` (or MCP resource APIs) to read `fland://guide`, `fland://schemas/playlist`, and `fland://schemas/graph`. They describe the complete playlist/map configuration, including automation rules. Preserve unrelated fields when replacing configurations. `fland_round_edit` automatically preserves omitted fields; the raw `fland_db_updateRound` tool has the backend's replacement semantics.

Imports, exports and migrations accept paths directly. A scoped local-control context replaces the UI's system-dialog path selection without requiring an authorization tool. Existing file schemas and remote-site checks remain in the import services; tool inputs can supply allowed domains where needed. Poll status/job tools for asynchronous downloads, scans and exports.

External changes invalidate query and route caches. Settings also dispatch the app's existing setting events. Startup/graphics flags can require a restart. Backend playlist updates do not replace an open editor's unsaved draft; use `fland_map_editor` to collaborate directly on that draft. OS dialogs, browser authentication and serial-device permission dialogs can still require local interaction. Canvas gestures inside the app can be driven with the visual input tools below.

## See and drive the app visually

`fland_screenshot` returns an image of the actual app content, including canvas maps, video, menus and app dialogs. It also returns `screenshotId`, image dimensions, viewport dimensions and zoom. The image is native MCP PNG content, so clients with image support can see it directly. It captures the app window only, without other desktop applications or native OS dialogs.

After looking at the image, use `fland_ui_input` with coordinates measured in that image:

```json
{
  "action": "click",
  "screenshotId": "ID_FROM_SCREENSHOT",
  "point": { "x": 420, "y": 275 }
}
```

The tool maps screenshot pixels to the app viewport automatically, including resized images and display scaling. It focuses the app and sends real browser input, including canvas pointer events. Supported actions are:

- `click`: `point`, optional `button` (`left`, `middle`, `right`) and `clickCount` (2 for double-click).
- `move`: hover over `point`.
- `drag`: `point` to `to`, optional `durationMs` (100–2000).
- `scroll`: `point` over the scrollable area, `scrollY` positive to scroll down or negative to scroll up; `scrollX` for horizontal scrolling.
- `type`: insert Unicode `text` into the focused field. Click the field first.
- `key`: press `key` such as `Enter`, `Tab`, `Escape`, `Backspace`, `ArrowLeft` or `A`, with optional `modifiers` (`control`, `shift`, `alt`, `meta`). To replace a field, click it, send `A` with `control` (`meta` on macOS), then type.

Every action returns a fresh screenshot by default. Use its new `observation.screenshotId` for the next action. `screenshotAfter: false` skips that image; `settleMs` controls the rendering wait (default 150, maximum 2000). Take a fresh screenshot after asynchronous work. Screenshot IDs expire after two minutes; navigation, resizing or zoom changes require a new screenshot. Old images can also become stale if the user or animations change the page, so inspect before acting.

`fland_ui` remains available for semantic DOM control. Its `inspect` output now includes control bounds, viewport size and canvas geometry. Those bounds are CSS viewport pixels; multiply by `screenshot.imageWidth / inspect.viewport.width` to map them to the screenshot. Prefer semantic control IDs for ordinary form controls and visual input for canvas or custom widgets. Native file pickers can be avoided with backend import tools.

Run `npm run test:mcp:visual` for an isolated Electron window that verifies screenshots, click mapping at zoom 1 and 1.5, Unicode typing, keyboard shortcuts, canvas dragging and scrolling. This test briefly focuses its own test window and does not operate the user's app/library.

## Collaborate in the open advanced map editor

Use `fland_map_editor` with `{"operation":"inspect"}` to read the actual unsaved draft, selected node/edge/text IDs, viewport, current tool, validation messages, Undo/Redo availability, and tile catalog. Combine it with `fland_screenshot` to understand requests such as “change this tile” or “finish this map.” Select the relevant items before making such a request. The agent reads the same draft you are editing.

Use `operation: "patch"` with `expectedRevision` from the latest inspection. Patches apply atomically relative to `config`; for example:

```json
{
  "operation": "patch",
  "expectedRevision": "12",
  "patches": [
    { "op": "set", "path": ["nodes", 1, "name"], "value": "Rest stop" },
    { "op": "set", "path": ["nodes", 1, "styleHint", "x"], "value": 600 }
  ]
}
```

`set` replaces a property or array element; using the array's length appends. `remove` deletes a property or splices an array element. Parent objects must already exist; set the whole object when adding one. Read `fland://schemas/live-map` for all fields, including nodes, connections, pools, styling, music, automations and map settings. Each patch batch appears immediately in the visible editor as one Undo step and follows normal draft autosaving. Use `undo`/`redo` with the latest revision. Changes to the draft, selection or viewport invalidate older revisions; inspect again instead of overwriting newer user work.

`saveDraft` explicitly saves unfinished work. `publish` validates and saves the playable playlist, returning errors when it cannot do so. Both require the latest revision and an existing playlist selected in the editor. For a new map, create a playlist with `fland_playlist_create`, navigate to `/map-editor`, and select it through the UI first. Use these live tools instead of backend playlist updates while collaborating on an open draft. The connected chat client must support MCP and image content; this does not add a built-in chat model to the app.

## Inspect videos and funscripts before cutting

The agent can request actual images with `fland_converter_inspectFrames`. For example:

```json
{
  "videoUri": "E:/Videos/source.mp4",
  "startTimeMs": 60000,
  "endTimeMs": 90000,
  "frameCount": 8,
  "width": 640
}
```

This samples the centers of eight equal time bins inside the selected range. For precise boundary checks, supply `timestampsMs: [59800, 60000, 60200]` instead of `startTimeMs`/`endTimeMs`. The server returns video duration/dimensions and timestamped JPEG images as native MCP image content. Up to 16 frames can be inspected per call; narrow the range or request more batches for detail. Decoder seek times are reported separately when a near-EOF request needs to seek back to the last frame interval. Times are requested source positions, not frame-accurate decoded presentation timestamps. Inspection leaves the video unchanged. Plain absolute paths, `file://` and `app://media/` URIs are supported. Website videos must already be cached; use `fland_db_ensureWebsiteVideoCachedForConverter` first.

`fland_converter_inspectFunscript` accepts `funscriptUri`, optional `startTimeMs`/`endTimeMs`, `offset` and `limit`. It returns file metadata, action counts, exact actions, `nextOffset`, and a PNG motion plot covering the entire selected range independently of pagination. Plot axes are source time from left to right and position 0 at the bottom / 100 at the top. Follow `nextOffset` with the same time range to read every action without downsampling. Actions remain at absolute source times. By default the tool uses playback's range scaling, inversion, autofix setting and time-zero anchor; `normalized: false` gives raw file positions/times, and `includePlot: false` returns just the data.

`fland_converter_autoDetect` exposes the editor's existing detector:

```json
{
  "funscriptUri": "E:/Videos/source.funscript",
  "durationMs": 1800000,
  "mode": "targetCount",
  "targetCount": 6,
  "pauseGapMs": 900,
  "minRoundMs": 60000,
  "autoTrimRounds": true,
  "trimAllowanceMs": 1000
}
```

Modes are `standard`, `adaptive` and `targetCount`. Supply the full source video's `durationMs`, available from frame inspection. Results include candidate segments and estimated BPM/difficulty. Target-count failure reports the closest result rather than silently returning a different count. All results are unsaved proposals (`saved: false`). The agent can inspect frames around the boundaries, adjust the proposal, then send the chosen segments to `fland_converter_saveSegments` with the hero/source information. Use the `videoUri` and `funscriptUri` returned by inspection for the save's `source` fields: absolute file paths are normalized into app media URIs automatically. Detection does not alter the visible editor's unsaved draft.

## Use the integrated EroScripts session

`fland_eroscripts_getLoginStatus`, `fland_eroscripts_search` and `fland_eroscripts_listTopicMedia` reuse the app's existing EroScripts login. The agent does not need a username, password, API key or copied cookies. If the session has expired, use the app's existing EroScripts login window. Login cookies are not returned to the agent or sent to external attachment/video hosts.

For downloads, call `fland_eroscripts_startDownload` with the selected candidate's fields:

```json
{
  "kind": "funscript",
  "topicId": 123,
  "postId": 456,
  "url": "https://discuss.eroscripts.com/uploads/example.funscript",
  "filename": "example.funscript"
}
```

Use `kind: "video"` and omit `filename` for a supported video candidate. The call returns immediately with an `id`; poll `fland_eroscripts_getDownload` using `{"jobId":"..."}`. Status is `running`, `completed` or `failed`. Completed results include `funscriptUri` or `videoUri`, plus `filePath`; failed results include the error. `fland_eroscripts_listDownloads` lists jobs. Jobs are retained for the current app process, with up to four concurrent downloads and the latest 100 records. Existing direct download tools remain available. Direct EroScripts video attachments stream through the integrated session; external videos use the existing supported/trusted downloader; EroScripts login does not sign into external video services. Archives and unsupported links are not downloaded.

Downloaded URIs work directly with the frame/script inspection and auto-detection tools. Use `fland_converter_saveSegments` to install chosen cuts, or `fland_db_importLegacyVideoFileAsRound` with the downloaded video `filePath` to import a new round.

To replace existing media, call `fland_db_replaceRoundMedia` with `roundId` and `videoUri`, `funscriptUri`, or both. Set `funscriptUri: null` to detach a script. Optional `resourceId` selects a specific resource; otherwise the round's first resource is used. Replacements are copied into durable `round-media` storage under the app profile, so clearing the EroScripts download cache does not remove the replacement files. The operation keeps round/resource IDs, names, tags, other metadata, and script offset/inversion. It returns the previous resource values and never deletes the original files. Use the previous URIs with the same tool to restore the original media while those original files remain available.

Trims are preserved by default. A replacement video whose duration cannot be read, or which is shorter than the existing trim, is rejected. Explicit `resetTrim: true` clears the round's trim boundaries. Video replacement refreshes duration/preview and clears the old video hash. Script validation and all file copies finish before the database changes; intervening edits to the round cause the replacement to fail instead of overwriting them.

## Local access and verification

The server binds only to `127.0.0.1` and checks Host/Origin to prevent ordinary websites from controlling the app. Local clients have the app user's library, filesystem-operation and device-control privileges. Configuration lives in `mcp-server.json` in the app profile, separately from ordinary settings.

Run `npm run test:mcp` for protocol discovery, real HTTP/stdio client interoperability, localhost restrictions, lifecycle, safe partial edits, reordering, branching maps, React input controls, and real database/installer/playlist workflows in an isolated temporary profile. Tests do not delete the user's library or drive real devices. Media extraction is mocked in the application integration test; FFmpeg and remote downloads remain covered by their existing services and require their external dependencies.

Frame-inspection tests also generate and decode a synthetic video with real FFmpeg/FFprobe. Run `npm run prepare:ffmpeg` first, or have both binaries on PATH. The application integration tests retain mocked media extraction; the dedicated inspection tests verify the actual extraction commands and MCP image responses.
