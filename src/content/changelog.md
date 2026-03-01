# What's New

## v0.6.24-beta

### Added

- **Interactive Source Linker for Heroes & Rounds** — a new **Link Download Sources** tool in the Installed Rounds library analyzes heroes and standalone rounds against configured BitTorrent and MEGA catalogs, scoring filename matches while ignoring generic path prefixes. Includes status filtering (Ready, Needs review, Linked, Unmatched), confidence meters, candidate review drawers, direct manual file search, and bulk source linking.
- **Incompatible Content Format Upgrade Prompt** — opening `.fplay`, `.hero`, `.round`, or `.fpack` sidecar files that use a newer schema version than the installed app now triggers a dedicated update prompt informing the user and offering an immediate upgrade link to the latest release.
- **Interactive Progression Skill Tree Canvas & Celebrations** — the Progression route now features an interactive SVG skill tree canvas with hexagonal branch nodes, animated connection edges, detailed skill panels, and a developer cheat console. Match completion on single-player and multiplayer result screens triggers a new completion celebration banner with level-up particle effects.
- **Acquisition Sources in Export Packs** — playlist and library export dialogs (`.fpack`) now include options to embed acquisition source metadata and replace local file links with shareable BitTorrent and MEGA download references.

### Changed

- **Unified Progressive Round Selection** — consolidated map round ordering and workshop queue progressive sorting into the shared `buildProgressiveRoundOrder` module.
- **Improved Playlist Workshop Presets** — difficulty section presets in the Playlist Workshop now distribute min/max difficulty bounds smoothly across queue ranges.
- Translation catalogs have been regenerated.

---

## v0.6.23-beta

### Added

- **BitTorrent & Magnet Link Media Acquisition** — integrated native BitTorrent downloading (via WebTorrent) and public magnet link / `.torrent` file parsing, enabling direct background acquisition of missing video assets for rounds and heroes.
- **Default Acquisition Sources Manifest** — ships with an editable `acquisition-sources.txt` manifest containing default public torrent collections and MEGA archive folders, automatically imported on startup.
- **Interactive Media Acquisition Review Modal** — importing sidecars (`.hero`, `.round`, `.fpack`, `.fplay`) or opening playlists with missing video assets now presents an interactive review dialog to resolve missing media by downloading candidate files from matching torrent and MEGA sources.
- **Acquisition Settings Panel** — a new Acquisition & Downloads section in Settings allows configuring maximum active downloads, download/upload bandwidth limits (MB/s), seed ratio and seed time limits, and choosing custom download directories.
- **Shareable Download Sources in Exports** — sidecar exports (`.fpack`, `.hero`, `.round`, `.fplay`, library packages) can now embed shareable magnet and MEGA acquisition source metadata so recipients can automatically fetch missing video assets.
- **BitTorrent File Association (`.torrent`)** — added system file association support for `.torrent` metadata files on Windows and Electron desktop builds.
- **Installed-Round Range Selection** — Select mode in the installed rounds library now supports Shift-click range selection between the anchor round and clicked card, respecting current filters, sorting, and collapsed groups.

### Changed

- **Automatic Anti-Perk Selection** — successful anti-perk rolls now select from the eligible pool with weighted probabilities (8/4/2/1 for common/rare/epic/legendary) instead of using a hardcoded index range that could select nothing from small pools.
- **Playlist Queue Reconciliation** — intentionally editing or clearing a normal or cum-round queue now removes stale references to deleted hero rounds instead of forcing them through auto-resolution again.
- **Map Editor Autosave Rework** — draft autosaving now runs on a deferred idle timer (1.5 s delay, 2 s idle timeout) driven by an explicit autosave revision counter, so viewport pan/zoom and sidebar search/filter changes are bundled into the next snapshot instead of triggering a full graph save mid-interaction.
- Translation catalogs have been regenerated.

---

## v0.6.22-beta

### Added

- **"Do not play interjections in a cum round" toggle** — the Map Editor's Graph Settings panel and the Playlist Workshop now expose a `disableInterjectionsDuringCumRounds` option (on by default). When enabled, automatic interjections are skipped during final cum rounds and Cum Point rounds. The setting is persisted in the playlist config and defaults to enabled for legacy configs and endless playlists.
- **"Allow pausing during the final cum round" toggle** — a new `allowPausingDuringFinalCumRound` option (off by default) in both authoring surfaces. When enabled, the in-round overlay grants unlimited pauses during the End-node cum round without consuming pause charges (the pause button shows "∞"), and that round forgoes the Cum Round Bonus Score. Cum Points are unaffected.

---

## v0.6.21-beta

### Added

- **Optional pausing in the final Cum round** — playlist authors can now allow unlimited pauses during the End-node Cum round without consuming pause charges. The option is disabled by default, never enables skipping or affects Cum Points, and suppresses the final Cum-round bonus score while active.
- **Cum-round interjection suppression** — playlists now default to skipping automatic interjections during final Cum rounds and Cum Point rounds. Playlist Workshop and Map Editor both expose a “Do not play interjections in a cum round” toggle for authors who want to opt out.
- **Configurable interjection count** — the Map Editor's Graph Settings panel and the Playlist Workshop now expose Minimum / Maximum interjections per triggered round, replacing the old hardcoded 60/30/10 split with a dedicated `intermediarySelection` range (1–5 each) and a `chooseIntermediaryCount` helper. The playlist schema is bumped to version 4 to persist the range; legacy configs migrate to a 1–3 default and new playlists default to exactly one.
- **Funscript rate limiter (TheHandy & Intiface)** — a new "Limit fast funscripts" toggle in Settings → Hardware & Sync keeps demanding scripts within a Handy-compatible movement rate via a new `funscriptRateLimiter` module that caps the maximum movement rate (%/s) and applies an RDP simplification tolerance. Both parameters are configurable per provider and per multi-device slot, with a reset-to-defaults action.
- **Verified database backup restore** — the Startup Recovery Center now lists every managed database backup with its integrity status, size, and creation time, and can restore a chosen copy. Restore integrity-checks the backup, snapshots a safety copy of the current database, applies the backup through a temp file, re-migrates, and re-verifies, rolling back to the safety copy if any step fails. Two new IPC channels (`startup-recovery:list-database-backups`, `startup-recovery:restore-database-backup`) back the UI.
- **Difficulty-section queue builder** — the shared `roundSelection` module gains `buildDifficultySectionRoundOrder`, which fills each difficulty section by picking the closest-matching unused round (distance to the section's min/max band) with optional shuffle that avoids repeating the previous order. The Playlist Workshop wires it into a new suggested-sections action.
- **Export audio quality selector** — the library and playlist (.fpack) export dialogs now expose an Audio Quality dropdown (Compact 128 / Balanced 192 / High 256 kbps AAC) that feeds the AV1 transcode pipeline.
- **Windows file-association smoke test** — a new `scripts/windows-file-association-smoke.ps1` script, an `extractOpenedFileArguments` helper that distinguishes packaged vs dev argv, and an `FLAND_OPEN_FILE_SMOKE_LOG` hook validate the open-file pipeline, which now dedupes pending files before delivery.

### Changed

- **Anti-perk timing rework** — anti-perks now roll after a round completes via a new `triggerAutomaticAntiPerk` step instead of being bundled into perk selection, the round-complete log separates the active anti-perk count from the next-round chance line, and `antiPerkTriggeredThisRound` is normalized to false on save load.
- **Anti-perk beatbar performance** — beat lookup now uses binary search plus slice instead of `filter`, and the beatbar renders beats with CSS container queries and `translate`/`willChange` for GPU-friendly motion instead of animating `left`. A new self-contained `LiveAntiPerkBeatbar` drives its own animation-frame loop, removing the overlay-level elapsed-time plumbing.
- **Large re-encode acknowledgement** — both export dialogs now require an explicit checkbox before starting AV1 re-encodes of 20 or more videos or jobs estimated above 30 minutes.
- Translation catalogs have been regenerated.

---

## v0.6.15-beta

### Added

- **Gameplay Statistics** — a new Statistics section on the Highscores page surfaces total active play time, watched video duration, scheduled vs. watched round length, session and round-play counts, and cum outcomes (losses and "came as told"). Filter by mode (Combined / Single-player / Multiplayer) and round type (All / Main / Cum / Interjection), sort round breakdowns by losses, plays, watched time, or recency, and browse a paginated session list with expandable per-round details. Two new tables (`GameplaySession`, `GameplayRoundPlay`) capture active, focused play time and per-round telemetry from both single-player and multiplayer runs, and a database migration backfills existing `SinglePlayerRunHistory` and `PlaylistTrackPlay` records as legacy sessions so historical activity appears on day one.
- **Per-hero funscript offset** — the Edit Hero dialog now has a "Funscript Offset for All Hero Rounds (ms)" field that applies the same offset to every resource-backed round in the hero in one save, reporting how many rounds were updated and how many were skipped.
- **Search EroScripts from the Round Converter** — a new "Search EroScripts" button in the converter header opens the EroScripts funscript search dialog directly, so you can find and attach a script without leaving the converter.

### Changed

- **Map Editor authoring overhaul** — incomplete maps now autosave as recoverable drafts, Delete and Backspace remove selections without leaving the editor, and temporary test runs can safely add exits to unfinished reachable paths without changing the saved map.
- **Dedicated map libraries** — Tiles, individual Rounds, and Heroes now have separate searchable, sortable tabs, with clearer placement state and full-height lists.
- **Map Editor usability fixes** — Help is dismissible and no longer obscures primary actions, validation issues can focus their affected node or edge, and pending draft saves are flushed before leaving the editor.
- **TheHandy connection reliability overhaul** — device commands (preload, sync, pause, resume, stop, disconnect) are now serialized per connection so overlapping HSP requests can no longer desync the device. The runtime tracks a session generation and discards stale setup attempts, preventing an older reconnect from stopping a newer round's HSP stream; a new `sessionRevision` on the haptics context lets the in-game overlay tear down and re-handshake its playback session whenever a reconnect is requested. Server-time sampling now deduplicates concurrent refreshes, uses a monotonic clock for round-trip measurement, and TheHandy responses are validated with a typed `HandyDeviceError` that surfaces the device's error code, name, and connected state instead of a generic failure.
- **Cum Point falls back to any installed Cum Round** — when no specific Cum Round is configured for a checkpoint, Cum Point now picks from any non-excluded installed Cum Round instead of refusing to start. The checkpoint activation guard likewise accepts any installed Cum Round, so the "no cum rounds installed" message only appears when none are actually present.
- **Cum Point checkpoint toggle no longer requires a pre-configured Cum Round** — the Map Editor's Node Inspector enables the cum-point checkpoint option whenever a save mode is active, removing the previous "Add at least one Cum Round first" gate.
- **Accurate run timing across save/resume** — the session start clock is now reconstructed from the elapsed time stored in the save snapshot, so "survived duration" and gameplay-telemetry active time stay correct when a run is resumed after being saved.
- **Prerelease update detection** — the desktop updater now treats prerelease builds (e.g. `0.6.11-beta`) as out-of-date when a newer prerelease with the same base version ships, via a new `shouldUpdateToRelease` check, instead of only comparing semver order.
- Translation catalogs have been regenerated.

---

## v0.6.11-beta

### Added

- **Versatile Playlist Workshop round filters** — the installed-round picker now opens on a compact Normal-only view, with removable exclusions for Cum and Interjection rounds plus a collapsible advanced tray for difficulty, duration, BPM, source, funscript status, random eligibility, added date, heroes, tags, authors, and library labels. Search, hero bulk-add, Add Visible, and difficulty-section generation now share the same filter results.
- **"None" update channel** — a new option in the Update Channel selector (Settings → App Updates) disables app update checks entirely. While active, the manual check and update actions are turned off with an inline "Updates Disabled" state, an amber notice explains the consequences, and the home screen's Multiplayer entry is blocked with an "Updates Disabled" sub-label. A dedicated "Multiplayer Disabled" screen replaces the update-required guard so it is clear why multiplayer is unavailable without a release channel. A new `useUpdateChannel` hook and a cross-component `fland:update-channel-changed` event keep every surface in sync the moment the channel changes.
- **Hard Mode badge in the installed rounds library** — hero group headers now show a "Hard Mode" badge whenever any round in the hero has been converted to Hard Mode, backed by a new `isHardModeConverted` flag computed from hard-mode revert records on the installed-round catalog query.
- **Cinematic round-start hint cards** — the round-start transition now renders a stack of color-coded hint cards instead of a single hint line. Each card surfaces a round rule (such as cum-round instructions), an active anti-perk (Highspeed playback speed, Antigravity inverted motion), or an intensity-capping perk, tagged with an instruction / perk / anti-perk tone and matching accent color.
- **Difficulty-section draft input** — the Playlist Workshop's difficulty-section index and difficulty-band fields now use a dedicated numeric input that tolerates transient empty or non-numeric drafts while typing and clamps to the valid range on blur, instead of fighting the user on every keystroke.

### Changed

- Funscript difficulty estimation now rates total beat hits and duration (with longer rounds contributing more strongly) instead of average movement velocity and action density, and the five difficulty levels are distributed linearly. This affects the Round Converter, the installed-round difficulty calculator, and the Recalculate All Difficulties action.
- Recalculate All Difficulties now reads the generated Hard Mode funscript for rounds that have been converted, so the reported difficulty reflects the active script rather than the original.
- Difficulty-section ranges in the Playlist Workshop now auto-correct their start/end indices and min/max difficulty bands when one side is moved past the other, preventing invalid inverted or overlapping ranges.
- Translation catalogs have been regenerated.

---

## v0.6.10-beta

### Added

- **Playlist Workshop round-selection toolkit** — a new dedicated, unit-tested `roundSelection` module consolidates every round-ordering path the Playlist Workshop uses into one place. It ships a guaranteed-different `randomizeRoundOrder` (which never returns the input unchanged when avoidable), a strict `buildProgressiveRoundOrder` that buckets rounds by difficulty 1–5 with unknown-difficulty entries shuffled to the end, `fillRoundOrderRemainderRandomly` for topping up a queue from filtered candidates without repeats, and `buildDifficultySectionResult`, which validates difficulty-section ranges and overlaps, reports matched and missing counts per section, and returns exactly which queue rounds were retained or removed and which library rounds were pulled in — plus any uncovered queue positions and validation errors.

### Changed

- Auto hard-mode conversion now completes the beat before a detected pause with an upstroke and holds the device at the top, making both the pause-start beat and the first beat after the pause distinct and tactile.
- The converter's segment card now exposes its custom round-name input to assistive technology via a `Round name` aria-label.
- Translation catalogs have been regenerated.

---

## v0.6.07-beta

### Added

- **Legacy funscript → Hard Mode conversion** — convert older half-stroke funscripts into full-range hard-mode scripts directly from three places: the in-round overlay's options menu, the Round Inspector in the installed rounds library, and each hero group header's action menu. The converter reads the source script (local file, HTTP/HTTPS URL, or configured Stash proxy URI), detects pause boundaries, inserts midpoint upstrokes so every down-stroke is paired, writes a managed, content-hashed script into a dedicated `hardmode-funscripts` storage folder, and tags the output with an `fLandHardMode` marker so it is never converted twice. Converting a round that belongs to a hero replaces the primary funscript on every resource-backed round in that hero, and an optional checkbox recalculates the affected rounds' difficulty from the generated script. Each conversion records a revert entry, so a matching **Restore previous script** action (in the same three surfaces) can roll the original attachments back, including for an entire hero at once. Playback is paused and the active haptics session is disconnected and re-synced around the swap so the new script takes over without desync.
- **Recalculate All Difficulties action** — a new action under Settings → Data & Storage re-estimates the difficulty of every installed round that has a readable primary funscript in one pass, reporting how many rounds were updated and how many were skipped.
- **Minimum video length filter in the Round Converter** — the source picker now has a Minimum length slider (persisted across sessions) that hides rounds shorter than the chosen duration, and it applies to both the visible round list and the Prev/Next unconverted navigation.

### Changed

- Funscript difficulty estimation is shared by the Round Converter and installed-round calculator. It now rates total beat hits and duration instead of movement velocity, with longer rounds contributing more strongly and all five difficulty levels distributed linearly.
- The `ConfirmDialog` component now accepts optional `children`, used to embed the recalculation checkbox inside the hard-mode conversion prompts.
- Release metadata and the bundled dependency-license manifest have been refreshed for this version.

---

## v0.6.06-beta

### Added

- **Adaptive Round Converter splitting** — a new **Auto Split** action analyzes funscript pauses, searches for suitable pause-gap and minimum-round settings, and immediately applies a balanced set of roughly three-minute rounds. It reports when no meaningful split is available and safely ignores results if the source changes while detection is running.
- **Rounds that do not consume a number** — converter segments can now be marked **Exclude from numbering** for named interjections or other special rounds. Excluded segments display without an `R` ordinal, require a custom name, and no longer create gaps in the generated names of the numbered rounds that follow them. The choice is persisted when converted rounds are saved and restored when they are edited again.

### Changed

- Reopening generated converter rounds now recognizes default names such as `Hero - round 1` as automatic names, allowing them to follow the current hero name and ordinal instead of being treated as custom titles.
- Loading an installed round linked to a hero now consistently uses that hero's saved name, author, and description instead of stale navigation-prefilled metadata.
- The Round Converter schema and installed-round data flow now carry the numbering-exclusion setting, including an automatic database migration for existing installations.

### Fixed

- Auto-detection results can no longer be applied to a different local, website, installed-round, or installed-hero source after the user changes sources while analysis is still running.
- Converter validation now prevents an excluded, unnumbered segment from being saved without the custom round name needed to identify it.

---

## v0.6.05-beta

### Added

- **Seekable installed-round previews** — the video progress bar in the Installed Rounds preview is now an interactive timeline. Drag or click it to seek within the playable portion of the main video, with cut ranges skipped automatically and haptics resynchronized to the selected position. Timeline seeking remains disabled during normal gameplay and intermediary sequences.
- **Immediate website-video caching** — newly installed website rounds now queue their video for caching right away instead of waiting for the next bulk scan. Targeted installs take priority over background work, share in-flight downloads for duplicate URLs, and retain the existing cache concurrency limit.

### Changed

- Installed-round cards now recognize download progress for both direct website URLs and wrapped external playback URLs, show caching activity while targeted downloads are running, and refresh their cached preview assets as soon as a download completes.
- **Ignore Playlist Level Requirements** has moved from Experimental into the main gameplay settings so the existing no-XP testing bypass is easier to find.
- Release metadata and the bundled dependency-license manifest have been refreshed for this version.

---

## v0.6.00-beta

### Added

- **Player progression & skill tree** — runs now award XP toward a persistent player level, unlocking a new Progression & Skill Tree route from the main menu. Eight skill branches (Control, Dicecraft, Economy, Fortune, Defense, Endurance, Scoring, and Starter Arsenal) each offer multi-rank perks that modify starting pauses, dice limits, money, perk-offer chance, danger probabilities, scoring, and starter inventory. Levels also unlock equippable titles, with respec tokens earned at milestones and a skill-deactivation system that grants up to +100% XP when you run with skills turned off.
- **Connect multiple haptics devices at once** — a new multi-device (group) provider lets you connect several TheHandy, Intiface, or TCode devices simultaneously, each with its own connection config, funscript offset, and stroke range. Devices are managed as named slots and the runtime fans script commands out to every connected target.
- **Installed Rounds library rework** — the installed rounds page has been visually rebuilt around the active app theme. Decorative cyan/violet accents, focus rings, selection bars, progress bars, sticky toolbars, and the round inspector now resolve through theme variables (with SFW-safe heading text), so the library matches your selected menu theme instead of hard-coded colors.
- **Playlist level requirements** — playlists can now declare a required player level (configurable in the Map Editor's Graph Settings panel). Locked playlists show their level badge and a reach-level hint on the single-player setup screen, and an experimental "Ignore Playlist Level Requirements" toggle (Settings → Experimental) lets you bypass the gate for testing, though bypassed runs do not award XP.
- **Multiplayer level & title cosmetics** — your equipped title and player level now appear next to your name in the lobby, in-match player lists, and on the results screen. A new Supabase RPC (`mp_update_player_cosmetics`) keeps your cosmetics in sync with other players, and join/leave/finish notifications include the title.
- **XP award on run results** — the single-player and multiplayer result screens now surface the XP earned for the run, the skill-deactivation bonus breakdown, the resulting level, and any skill points gained from level-ups.
- **Native TCode serial port picker** — when multiple serial ports are available, a native dialog now lists each port with its display name, vendor, and product IDs so you can choose the right TCode device. The previously auto-selected first port is no longer silently picked.

### Changed

- Upgraded the Buttplug/Intiface client library from v4 to v5, including the move from `Vibrate.speed` to `Vibrate.percent` for vibration commands, and raised the minimum supported Intiface Central major version to 3 with a download link surfaced in-app.
- Manual round pauses now use the progression-configured pause duration instead of the fixed 15-second window, and the in-game overlay reports the active pause length.
- TCode serial teardown now wraps reader/writer cancellation and the read loop in 5-second timeouts so a hung driver can no longer block disconnection; Linux connection errors include dialout/uucp group and "port in use" guidance, and serial lifecycle events are recorded to the debug log.
- TCode connection verification now reports a failure if the test command cannot be sent or if the serial port cannot be cleanly closed after the probe, instead of silently treating a half-open port as connected.
- Refactored the Map Editor and Playlist Workshop playlist pickers into a single shared `PlaylistPicker` component (`src/features/playlist-picker/`), replacing the legacy `PlaylistPickerView` with consistent theming, search, sort, and management actions across both surfaces.
- Playlist schema bumped to version 3 to persist `requiredLevel`; legacy graph configs continue to be normalized on import.
- Game saves now persist the run's progression block reason (level bypass, map-editor test) and the disabled-skill rank count so XP awards stay consistent across resumes.
- Existing installs automatically repair the new `progressionXp`, `equippedTitleId`, `respecTokens` columns on `GameProfile` and create the `ProgressionSkillRank` and `ProgressionAward` tables if missing, including the skill `enabled` column added in a follow-up migration.

### Fixed

- TCode serial disconnect no longer hangs when the underlying WebSerial reader fails to cancel; teardown always completes within a bounded timeout.
- TCode verification no longer reports success when the serial port could not be closed after the probe, preventing stale "connected" state on the next connect attempt.

---

## v0.5.23-beta

### Added

- **Startup Recovery Center** — failed startups can now open a dedicated recovery screen with database health details and actions to back up or repair the database, clear caches, reset settings, reset the installation while optionally preserving the database, and restart the app safely.
- **Drag-and-drop Map Editor palette** — node tiles, installed rounds, and complete heroes can now be dragged directly from the sidebar onto the canvas. Rounds also have a searchable sidebar section with type colors and click-to-place support.
- **Seamless playlist launch handoff** — starting or resuming a run now preloads the game route and keeps the themed playlist launch transition visible until the Pixi gameboard has rendered its first ready frame.

### Changed

- Automatic website-video and perceptual-hash scans now yield while the renderer is active, and renderer performance reporting distinguishes critical gameplay from interactive and idle routes so background work does not compete with playback.
- Gamepad polling and gameboard rendering now pause while the app is hidden and resume when it becomes visible or a controller reconnects, reducing unnecessary background CPU and GPU use.
- Gameboard starfield connections now use spatial lookup instead of comparing every particle pair, while map parallax, playback progress, and haptics preview updates avoid React rerenders for smoother animation.
- Playlist pickers now visually distinguish graph maps, show endless playlists with the correct mode label, and retain the appropriate editor routing behavior.
- Map Editor round nodes now inherit their round type color and display the assigned round type when available.

### Fixed

- Startup retry now clears failed database initialization state instead of reusing a rejected connection attempt.
- Expanding grouped shelves in the installed-rounds library no longer leaves persistent blank gaps caused by discarded virtualizer measurements.
- Background video rendering and anti-perk beat sequences now avoid stale animation state during visibility and playback transitions.

---

## v0.5.15-beta

### Added

- **Intiface funscript support for vibration-only toys** — vibrators and other vibration-capable Buttplug devices now work with funscripts. The adapter translates funscript stroke speed into vibration intensity, and a new Vibration Sensitivity slider in Settings -> Hardware & Sync lets you tune the mapping.
- **Installed rounds library rebuild** — the installed rounds page has been split into dedicated library components, dialogs, hooks, overlays, and helpers. The UI behavior stays familiar, but the screen is now easier to maintain and extend.
- **Hero shortcuts in Playlist Workshop** — the normal-round picker now groups installed hero rounds in a collapsible Heroes section, with one-click add for every missing round from a hero.
- **Hero chain placement in Map Editor** — Map Editor can now place a whole hero as a connected round-node chain from the tile sidebar.
- **Map Editor quick-add workflow** — nodes now expose a connection handle for creating connected nodes quickly; dropping on another node creates an edge, and dropping on empty canvas places a connected node.
- **Map Editor authoring helpers** — added snap-to-grid placement, alignment guides while dragging, node duplication, keyboard nudging, double-click rename, context menus, fit-to-content view logic, and minimap support.

### Changed

- Round Converter auto-detection now trims leading and trailing idle funscript space, uses cadence-aware padding around real motion, and searches pause-gap/min-round settings from actual action gaps for more accurate target segment counts.
- The Round Converter's quick-detect action now uses a 60-second minimum round length again.
- Milker and Jackhammer beatbars now show a beat for every downward movement in their generated motion.
- Settings now lazily refresh binary diagnostics only when Advanced is opened, and debug diagnostics only when Debug is opened.
- Debug diagnostics and available GPU listing now use a shared cached system-info service.
- Hardware-derived machine IDs and legacy settings decryption now tolerate slow or unavailable system-information probes instead of blocking indefinitely.

### Fixed

- EroScripts login status checks now time out after 5 seconds and report timeout failures clearly.
- Legacy encrypted settings import now tries historical encryption keys one at a time and keeps falling back when a key cannot decrypt the file.

---

## v0.5.07-beta

### Added

- **Intiface funscript support for vibration-only toys** — vibrators and other vibration-capable Buttplug devices now work with funscripts. The adapter translates funscript stroke speed into vibration intensity (holds go silent, fast strokes hit hard), and a new Vibration Sensitivity slider in Settings → Hardware & Sync lets you tune the mapping. Linear/position devices remain preferred when both are connected.
- **Graphics compatibility settings** — a new collapsible "Graphics Compatibility" panel in Settings under Debug with granular toggles for GPU safe mode, zero-copy rendering, GPU blocklist override, GPU rasterization, GPU compositing, accelerated video decode/encode, GPU shader disk cache, ANGLE OpenGL backend, and WebGL 2; all settings require an app restart and include an in-page restart button.
- **GPU preference selector (FFmpeg & Electron)** — choose which GPU FFmpeg and Electron's renderer use via a new dropdown in the Graphics Compatibility panel; on Linux this sets DRI_PRIME for both processes, on Windows/macOS it uses Chromium's --gpu-device-index switch.
- **GPU crash recovery hint** — when the GPU process crashes during an active game session, a recovery flag is persisted and shown as a toast on next startup suggesting Graphics Safe Mode from Settings.
- **GPU diagnostics** — the main process now captures GPU feature status, GPU info, hardware acceleration state, and graphics compatibility settings into a structured diagnostics snapshot that is logged on startup and refreshed on GPU info updates.
- **Video playback diagnostics** — round video elements (main and intermediary) now record structured diagnostic events (error, emptied, loadstart, waiting, stalled, canplay, loadeddata) to the debug log with debounced waiting/stalled events for noise reduction.
- **App relaunch action** — a new "Restart App" button in the Debug section relaunches the app via `app.relaunch()`.
- **Available GPU listing in debug** — the debug router now exposes an `getAvailableGpus` endpoint that lists detected GPUs (vendor + model) via systeminformation.
- **Collapsible difficulty sections in the Playlist Workshop** — the difficulty sections panel can now be collapsed and expanded, with a section count badge and a toggle arrow.
- **Graph playlists open in Map Editor** — selecting a graph playlist from the Playlist Workshop picker or the single-player setup screen now opens it directly in the Map Editor instead of the Workshop.
- **Stash proxy URI support for exports** — library and playlist export packages now correctly resolve Stash proxy URIs by extracting the source ID and target URL for proper authentication during export.

### Changed

- FFmpeg child processes (media transcoding, phash extraction, AV1 compression) now inherit the GPU preference environment variables so FFmpeg uses the user-selected GPU.
- The PixiJS game scene now reinitializes when the board layout key changes (board length, edge count, endless generation counter, text annotations) instead of only on mount.
- Global styles now set `min-height: 100%` and a dark background on `html`, `body`, and `#root` to prevent white flashes during route transitions.
- Simplified the export dialog's include-media toggle logic for the fpack format state.

---

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
