# What's New

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
