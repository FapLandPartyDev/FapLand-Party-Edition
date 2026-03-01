# What's New

## v0.5.0-beta

### Added

- **"High Roller" perk** — permanently increases maximum dice roll by 1.
- **"Long Stride" perk** — increases maximum dice roll by 1 for 5 rounds.
- **"Hot Streak" perk** — increases maximum dice roll by 2 and luck for 2 rounds.
- **"Breather" perk** — reduces intermediary chance by 5% and grants one pause charge.
- **"Lucky Momentum" perk** — increases perk offer chance and luck for 3 rounds.
- **"Low Ceiling" anti-perk** — permanently reduces maximum dice roll by 1.
- **Bulk tag editing** — add, remove, or replace tags across multiple selected rounds at once from the round library's bulk actions menu.
- **"Select Matching Rounds"** — renamed from "Select Visible Rounds"; now selects only rounds that match the active search, tag, and library filters.
- **Custom road palettes in the Map Editor** — save, edit, reuse, and delete custom road color palettes from a new palette manager in the Graph Settings panel.
- **Difficulty Sections in the Playlist Workshop** — define index ranges with min/max difficulty bands to auto-generate round queues; includes a suggested-sections preset and an option to filter by current search and duration settings.
- **Graph node round transition settings** — round and random-round nodes in the Map Editor can now configure a per-node countdown duration, overline label, and custom transition palette.
- **Clear Booru Cache** — a new action in Settings under Data & Storage to clear the local booru (Rule34/Gelbooru/Danbooru) media cache.
- **Show Disconnected Haptics Status** toggle — show or hide the disconnected haptics status pill during round playback when no device is connected.
- **Allow Haptics Anti-Perks Without Device** toggle — keep haptics-themed anti-perks available for their visual effects even when no haptics device is connected.
- **Map zoom on the gameboard** — zoom in or out on the game board (0.5×–2.0×) with new zoom controls; setting is persisted across sessions.
- **Menu theme selector in the First-Start wizard** — pick a main menu theme during onboarding.

### Changed

- TCode serial transport now serializes concurrent connect/disconnect operations and properly manages reader/writer locks for reliable reconnection.
- Booru cache refresh now tracks cache generations for more reliable background updates.
- Media transcoding pipeline now emits structured debug log entries with timing, retry, and error diagnostics.
- The Playlist Workshop round picker now includes all non-interjection round types instead of only "Normal" rounds.
- Various test improvements across settings, rounds, haptics, and playlist modules.

---

## v0.4.4-beta

### Added

- **TCode haptics support** — connect OSR/SR-style devices via the TCode protocol over WebSocket or serial port with configurable baud rate, precision (TCode v0.2 3-digit / v0.3 4-digit), and L0 axis targeting. TCode is available alongside TheHandy and Intiface in Settings, the First-Start wizard, the in-game overlay, and the home screen.
- **TCode serial quick-connect on the home screen** — a dedicated TCode Serial panel lets you pick a serial port, refresh the port list, and connect or disconnect without opening Settings.
- **Debug logging and diagnostics system** — a new Debug section in Settings with configurable log level (Off / Error / Warn / Info / Debug), an anonymized diagnostics viewer (app info, storage, hardware, database, runtime, background jobs), copy-debug-info to clipboard, export-debug-file to disk, open-log-folder, and clear-log-file. The log automatically captures renderer errors, unhandled promise rejections, startup lifecycle events, renderer performance snapshots, navigation blocks, GPU process crashes, and background service activity. All debug output is sanitized for public sharing (paths are redacted, usernames stripped, private IPs masked, and sensitive keys replaced).
- **Renderer error forwarding** — uncaught errors and unhandled promise rejections from the renderer process are now forwarded to the main process debug log automatically via the preload script.
- **Debug instrumentation in background services** — database backup, music download, phash scanning, website video scanning, install scanning, and playlist operations now write structured debug log entries at appropriate log levels.
- **Probability reset toggles in the Playlist Workshop** — new `resetIntermediaryProbabilityAfterTrigger` and `resetAntiPerkProbabilityAfterTrigger` toggles let playlist authors reset intermediary and anti-perk probabilities back to their initial values after a trigger event, giving finer control over probability pacing across linear and graph playlists.

### Changed

- Haptics runtime refactored from provider-specific if-else chains to a generic adapter dispatch pattern, making it straightforward to add new haptics providers.
- Map Editor's tag, author, and library filter inputs in the Node Inspector extracted into a reusable `CsvFilterInput` component with improved editing UX (draft state while focused, auto-format on blur).
- In-game overlay labels renamed from "TheHandy" to generic "Haptics" labels (Haptics Menu, Haptics Linkup, Haptics resumed/stopped) to reflect multi-provider support; the status pill now shows the active provider name.
- Home screen haptics status indicator now displays the connected provider name alongside the connection state.
- Added `serialport` as an external dependency for the Electron main process build.
- Updated `systeminformation` dependency.

---

## v0.4.0-beta

### Added

- **"Antigravity" anti-perk** — a new anti-perk that inverts the funscript for the next round, flipping all device positions.
- **"Full Heal" perk** — a new perk that resets intermediary chance and anti-perk chance back to 0.
- **Per-resource funscript inversion** — each installed round resource now has an "Invert funscript" toggle that flips all device positions, available in the round editor.
- **Probability reset options** — new settings in the Map Editor and Playlist Workshop to reset intermediary and anti-perk probabilities to their initial values after they trigger, giving playlist authors finer control over probability pacing.

### Changed

- Upgraded app version to v0.4.0-beta.
- Codebase-wide formatting and lint cleanup across settings, first-start wizard, game engine, multiplayer, converter, map editor, and haptics modules.

---

## v0.3.7-beta

### Changed

- Increased the minimum round duration for the automatic round converter from 60 seconds to 3 minutes to produce longer, higher quality rounds.
- Optimized Intiface haptics responsiveness by removing command interval clamps and syncing directly to the next funscript action for unlimited fine movement updates.
- Added clearer experimental warning notices for Intiface hardware connections in the Settings and First-Start wizard.
- Adjusted the visual opacity and transparency of the game's loading overlay for a better visual transition experience.
- Experimental feature toggles (like the test animation) are now persisted across app restarts.

### Fixed

- Fixed a UI issue where the settings page could sometimes remain frozen in a disabled "loading" state.

---

## v0.3.6-beta

### Added

- **Target-count auto-detection in the Round Converter** — enter a desired segment count and the converter automatically searches for pause-gap and minimum-round-duration values that produce exactly that many segments.
- **60-second quick-detect mode** — a one-click detection pass that applies a fixed 60-second minimum round duration.
- **Previous/Next unconverted round navigation** — new Prev/Next buttons and `Alt+←`/`Alt+→` shortcuts let you cycle through unconverted rounds without leaving the converter.
- **Unconverted position indicator** — the converter header now shows the current unconverted round index (e.g. "Unconverted 3/12").

### Changed

- Endless-mode auto-generated playlists are now hidden from the Map Editor and Playlist Workshop pickers.
- The "Open Playlist Workshop" button is hidden on the single-player setup screen when an endless playlist is selected.
- Intiface/Buttplug haptics sync now targets the next funscript action position instead of the interpolated current position, and deduplicates redundant position commands for smoother device movement.

---

## v0.3.4-beta

### Added

- **Intiface / Buttplug haptics support** — connect any Buttplug-compatible linear or position device via Intiface Central alongside the existing direct TheHandy connection; the first-start wizard, Settings, and global overlay now let you switch between TheHandy and Intiface providers.
- **Endless playlist mode** — a new "Endless" board mode generates rounds infinitely with configurable safe points and perk spacing; players can end the run at any time and the endless playlist is auto-created if none exist.
- **Source and date filters in the round library** — filter installed rounds by source (Stash, Web, Local) and by added date (since, before, or between dates).
- **Bulk round management** — new "Select Visible Rounds" and "Delete Selected" actions let you batch-select and delete round entries from the installed rounds page.
- **Video file and folder drag-and-drop import** — dropping individual video files or entire folders onto the app now imports them directly through the existing install pipeline.

### Changed

- Haptics-related UI labels are now phrased generically ("haptics device") instead of referencing TheHandy only, reflecting the multi-provider support.
- Electron build target updated from Node 20 to Node 24.
- Electron upgraded to v42; drizzle-kit updated.

---

## v0.3.2-beta

### Added

- **Drag-and-drop overlay** — dragging files onto the app now shows a visual drop zone and a confirmation dialog listing the files before importing, preventing accidental drops.
- **Storage migration** — a new _Migrate Storage Paths_ card in Settings lets you copy all cache folders (web videos, music, EroScripts, .fpack extractions) to a new directory and optionally delete the originals.
- **Portable migration** (Windows only) — a _Migrate to Portable_ card in Settings can move cache folders, database, and settings into an existing portable installation with automatic detection and backup of existing data.

### Changed

- The Round Converter UI (header, segment cards, video preview) is now fully translatable.
- The Licenses page is now fully translatable.
- Graph validation error messages now include the human-readable node name alongside the node ID, making errors easier to identify in the Map Editor and graph schema validation.
- Automation graph mutation errors also include node names for clearer diagnostics.

---

## v0.3.1-beta

### Added

- Each installed round resource can now store a **per-resource funscript offset** (in ms) so TheHandy sync adjusts automatically per round instead of relying on a single global offset.
- The global Handy overlay and in-game overlay now show a **Save Offset to Round** button during playback when a funscript is active, letting you persist the current offset directly to the round resource (keyboard shortcut `Ctrl+Shift+S`).
- **Drag-and-drop file import** — dropping `.fplay` playlist files, funscripts, or videos onto the app window now opens them through the existing file-handler pipeline.
- Playlist export can now produce a bundled **.fpack** archive alongside the existing directory export.
- Legacy graph playlists that contain disconnected nodes now auto-repair by connecting dangling nodes to an end node during import, so older files open without validation errors.

### Changed

- During round playback, TheHandy offset now starts from the round's stored `funscriptOffsetMs` if set, falling back to the global offset otherwise; adjusting the offset from the overlay edits the per-round override in real time.
- Exporting or saving a linear playlist from the Workshop now auto-persists unsaved changes first, so the exported file always reflects the current editor state.
- The playlist file parser now accepts version-1 envelopes in addition to the current format, improving backward compatibility with older `.fplay` files.
- Map previews no longer render text annotations, reducing visual noise in small thumbnails.
- Various formatting and lint cleanups across settings, rounds, converter, and workshop modules.
- The build obfuscation plugin no longer uses a type-unsafe `as const` assertion for string array encoding options.

### Fixed

- Existing installs now auto-repair missing `funscriptOffsetMs` database columns after upgrades.
- Schema-repair detection now also checks for the `funscriptOffsetMs` column alongside the previously tracked columns.
- Timer interval references in polling effects now use the correct `number` type for browser `setTimeout` return values instead of `ReturnType<typeof setTimeout>`.

---

## v0.3.0-beta

### Added

- Map Editor now includes an **Automation** workflow for graph playlists, with rule templates, triggers, conditions, delayed actions, cooldowns, and rule enable/disable controls.
- Automations can react to node movement, player controls, round lifecycle events, music state, timers, and path choices, then update timers, music, backgrounds, graph nodes, graph edges, and other rules during play.
- Round nodes can now play a queued sequence of videos, and round/random-round nodes can auto-advance through technical transitions after completion.
- Random-round nodes now support installed-library or named-pool selection modes plus tag, author, and library filters.
- Installed rounds and heroes now support tags, and rounds can store a library label for filtering and organization.
- The round library now has dedicated tag, author, and library filters, and searches include round tags, hero tags, and library labels.
- Startup SFW mode can now be forced with the `FLAND_STARTUP_SAFE_MODE` environment flag.

### Changed

- Playlist graph files now use version 2 to persist automation rules, background ids, round video queues, random-round filters, hidden technical nodes, and auto-advance settings.
- Game saves now persist automation runtime state, temporary background overrides, runtime music state, rule cooldowns, automation overrides, and paused rest timers.
- Map previews and in-game boards now hide technical nodes marked as hidden while still resolving movement through them.
- Installed round scans now preserve imported round and hero metadata more completely, including tags and inferred library labels.
- The game route now synchronizes automation-controlled music state with the global playlist music system.

### Fixed

- Existing installs now repair missing installed-library metadata columns automatically, including resource duration, round cut ranges, random exclusion, tags, and library labels.
- Round catalog queries retry after repairing older database schemas, preventing missing-column failures after upgrades.
- Graph validation now catches invalid automation references, unresolved video queue entries, invalid hidden/auto-advance nodes, and non-zero-cost auto-advance edges.
- Auto-advance graph nodes now require exactly one zero-cost outgoing edge to avoid ambiguous runtime movement.

---

## v0.2.12-beta

### Added

- An optional global **FPS Counter** can now be enabled from Settings to monitor renderer performance.
- **TheHandy** now supports direct stroke-range adjustment from both Settings and the global overlay, including reset controls and live percentage feedback.
- Playlist Workshop and Map Editor now include a **Disable Dice Animation** option for instant movement after rolls.

### Changed

- Round library previews now load through a dedicated playback-entry cache, deferred images, and hover-delayed video activation to keep large libraries feeling more responsive.
- Installed round shelves use better height estimation and broader virtualization, including grouped layouts, to keep scrolling smoother.
- The converter now shows visual skeleton cards while installed rounds or heroes are still loading.

### Fixed

- Remote round playback now recovers from browser autoplay mute restrictions and restores audio after the next user interaction.
- Website video scan discovery errors are now tracked instead of being silently skipped, making cache issues easier to diagnose.
- Cache invalidation now also clears stored playback entries when round media changes, and Settings keep the FPS counter toggle in sync across persisted store values, local cache, and the live overlay.

---

## v0.2.9-beta

### Added

- In-app release notes are now available directly from Settings.
- A dedicated **What's New** section makes recent improvements easier to discover.

### Changed

- Release notes are now authored from a single markdown file bundled with the app.
- Settings now place project information in a clearer flow: **Help**, **What's New**, then **Credits / License**.

### Fixed

- Settings now have a more structured place for update history instead of relying on external context.

---

For the full project history, visit the repository:
<https://github.com/FapLandPartyDev/FapLand-Party-Edition>
