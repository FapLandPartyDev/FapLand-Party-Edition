# F-Land (Fap Land — Party Edition)

A chaotic, adult-oriented, up to 4-player asynchronous multiplayer board game that also can be played solo. Think "Mario Party" meets haptic hardware synchronization.

## The Elevator Pitch

Players race across a 2D virtual game board while simultaneously watching a local video synced to their personal haptic hardware (TheHandy). As they progress, they collect coins and use them to place "Traps" (anti-perks) on the board. When an opponent lands on a trap, their video, hardware, or gameplay is sabotaged in real-time.

## Core Gameplay Loop

1. **The Setup:** Players open multiplayer, get an anonymous multiplayer account automatically on the default online server, enter their Handy Connection Key, and select a local video (`.mp4`/`.webm`) and its matching `.funscript` file. Advanced users can still switch to a self-hosted Supabase server.
2. **The Race:** The game is an asynchronous race. Players roll dice to move across the PixiJS 2D board.
3. **The Sabotage (Traps):** Players spend coins to place traps on specific board tiles. If Player B lands on Player A's "Speed Trap," Player B's video `playbackRate` dynamically shifts to 1.5x, and their Handy hardware instantly scales its speed to match.
4. **The Queue:** To handle concurrent attacks, traps do not overwrite each other. They are pushed into a sequential "Trap Queue." The player's client processes them one by one until the queue is empty.
5. **The Climax:** The match ends when the conditions are met, and the Host broadcasts the final `MatchRecord`.

## Technology Stack

- **Frontend**: React 19, TypeScript, TailwindCSS 4, Vite
- **Desktop Environment**: Electron
- **Game Engine**: PixiJS (`@pixi/react`)
- **Backend & Multiplayer**: Supabase (Database & Realtime Broadcast for intense setup)
- **Local Storage**: Prisma + LibSQL
- **Hardware API**: TheHandy API v3 (Firmware 4, HSP protocol)

## Hardware Integration Constraints

- **Protocol**: Exclusively utilizes the official REST API v3 (Firmware 4) in HSP (Handy Streaming Protocol) mode.
- **Variable Speeds**: To keep haptics perfectly synced with trap effects (e.g., `video.playbackRate = 1.5`), the game issues immediate `PUT /hsp/playbackrate` commands.
- **Latency**: Prioritizes the Local Network API (direct IP communication) to ensure traps and haptic alterations trigger instantly.

## Development

Install dependencies (ensure you have the latest Node/npm or use the provided Nix flake for the environment):

```bash
npm install
```

Create a local env file before running multiplayer locally:

```bash
cp example.env .env
```

Set `VITE_MULTIPLAYER_DEVELOPMENT_SUPABASE_ANON_KEY` in `.env` to your local Supabase anon key. The development key is no longer kept in source.

Start the development server:

```bash
npm run dev
```

Run multiplayer development environment:

```bash
npm run dev:multiplayer
```

Build for production:

```bash
npm run build
```

Build a hardened release bundle with terser minification, target-specific obfuscation, and production source maps disabled:

```bash
npm run build:release
```

Build the hardened release bundle with compressed size reporting enabled:

```bash
npm run build:analyze
```

Optional build flags:

- `FLAND_BUILD_PROFILE=default|release`
- `FLAND_OBFUSCATE_RENDERER=true|false`
- `FLAND_OBFUSCATE_PRELOAD=true|false`
- `FLAND_OBFUSCATE_MAIN=true|false`
- `FLAND_BUILD_ANALYZE=true|false`
