# Fap Land Party Edition(F-Land)

Desktop board-game app built with React, Vite, and Electron. The project combines local round playback, TheHandy integration, playlist authoring, and Supabase-backed multiplayer in one package.

## What It Does

F-Land is an adult-oriented party/board-game app with both solo and multiplayer flows. The current app includes:

- Single-player setup and results
- Experimental Supabase multiplayer lobbies and matches
- Local round library management
- Round converter tooling
- Playlist workshop and export/import flows
- Experimental map editor
- Highscores and cached match history
- TheHandy connection and sync controls
- Desktop packaging, auto-update wiring, and custom file associations

## Stack

- React 19
- TypeScript
- Vite 7
- Electron 41
- Tailwind CSS 4
- TanStack Router + React Query
- PixiJS
- Drizzle ORM + LibSQL/SQLite
- Supabase Realtime/Auth for multiplayer

## Requirements

- Node.js and npm
- Optional: `nix develop` if you want to use the provided Nix shell
- For local multiplayer backend work: Docker, Supabase CLI, and `psql`

The Electron build targets Node 20 for the main/preload bundles, so a current Node 20+ environment is the safe default.

## Quick Start

Install dependencies:

```bash
npm install
```

Or with the Nix shell:

```bash
nix develop -c npm install
```

Create a local env file:

```bash
cp .example.env .env
```

Start the app in development:

```bash
npm run dev
```

## Environment

The main variables are documented in [`.example.env`](./.example.env). The most relevant ones are:

- `DATABASE_URL`: local LibSQL/SQLite database URL. Defaults to `file:dev.db` when unset.
- `FLAND_UPDATE_REPOSITORY`: GitHub repo slug used by the desktop updater.
- `VITE_MULTIPLAYER_DEFAULT_SUPABASE_URL`
- `VITE_MULTIPLAYER_DEFAULT_SUPABASE_ANON_KEY`
- `VITE_MULTIPLAYER_DEVELOPMENT_SUPABASE_URL`
- `VITE_MULTIPLAYER_DEVELOPMENT_SUPABASE_ANON_KEY`
- `SUPABASE_AUTH_EXTERNAL_DISCORD_CLIENT_ID`
- `SUPABASE_AUTH_EXTERNAL_DISCORD_SECRET`
- `FLAND_ENABLE_DEV_FEATURES`
- `FLAND_USER_DATA_SUFFIX`

If a multiplayer server is configured with Discord OAuth, the app expects account linking through Discord and requires the Discord account to expose an email address.

Packaged desktop OAuth callbacks use the `fland://auth/callback` protocol.

## Development Scripts

- `npm run dev`: Vite + Electron development
- `npm run dev:multiplayer`: launches two local app instances for multiplayer testing
- `npm run test`: run Vitest
- `npm run lint`: run ESLint
- `npm run format`: run Prettier
- `npm run db:generate`: generate Drizzle artifacts
- `npm run db:push`: push Drizzle schema changes
- `npm run supabase:local:setup`: start and verify a local Supabase stack
- `npm run supabase:migrate`: apply local Supabase migrations
- `npm run supabase:reset`: restart local Supabase services

## Local Multiplayer Workflow

1. Copy [`.example.env`](./.example.env) to `.env`.
2. Set `VITE_MULTIPLAYER_DEVELOPMENT_SUPABASE_ANON_KEY` to the anon key from your local Supabase instance.
3. Run `npm run supabase:local:setup`.
4. Run `npm run dev:multiplayer`.

`npm run dev:multiplayer` starts one Vite dev server and launches two Electron profiles with isolated user data (`mp1` and `mp2`) so you can test lobby flows locally.

## Build And Packaging

Available build commands:

- `npm run build`: standard production renderer/main build
- `npm run build:release`: hardened release build with terser minification and release defaults
- `npm run build:analyze`: release build with compressed size reporting
- `npm run build:package`: packaged release build via `electron-builder`
- `npm run build:testers`: packaged build with dev-only app features kept on
- `npm run build:dev`: packaged development-oriented build

Supported package targets currently configured:

- Linux: `AppImage`
- Windows: `nsis`

Release packaging enables ASAR, Electron fuses, and embedded ASAR integrity validation.

## Build Flags

These environment variables influence builds:

- `FLAND_BUILD_PROFILE=default|release`
- `FLAND_OBFUSCATE_RENDERER=true|false`
- `FLAND_OBFUSCATE_PRELOAD=true|false`
- `FLAND_OBFUSCATE_MAIN=true|false`
- `FLAND_BUILD_ANALYZE=true|false`
- `FLAND_ENABLE_DEV_FEATURES=true|false`

## Project Notes

- The desktop app registers file associations for `.hero`, `.round`, and `.fplay`.
- Local persistence uses Drizzle with a bundled SQLite/LibSQL database.
- Multiplayer state and match history are backed by Supabase.
- The UI is route-driven with TanStack Router and includes extensive test coverage across routes, services, and gameplay logic.

## License

Licensed under AGPL-3.0-only. See [LICENSE](./LICENSE).
