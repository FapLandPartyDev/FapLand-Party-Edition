---
trigger: always_on
---

# Context: Game Design & Core Concept

You are building a chaotic, adult-oriented, up to 4-player asynchronous multiplayer board game that also can be played solo. Think "Mario Party" meets haptic hardware synchronization. 

## The Elevator Pitch
Players race across a 2D virtual game board while simultaneously watching a local video synced to their personal haptic hardware (TheHandy). As they progress, they collect coins and use them to place "Traps" (anti-perks) on the board. When an opponent lands on a trap, their video, hardware, or gameplay is sabotaged in real-time. 

## Core Gameplay Loop
1. **The Setup:** Players connect to a self-hosted Supabase server, enter their Handy Connection Key, and select a local video (`.mp4`/`.webm`) and its matching `.funscript` file.
2. **The Race:** The game is an asynchronous race. Players roll dice to move across the PixiJS 2D board.
3. **The Sabotage (Traps):** Players spend coins to place traps on specific board tiles. If Player B lands on Player A's "Speed Trap," Player B's video `playbackRate` dynamically shifts to 1.5x, and their Handy hardware instantly scales its speed to match. 
4. **The Queue:** To handle concurrent attacks, traps do not overwrite each other. They are pushed into a sequential "Trap Queue." The player's client processes them one by one until the queue is empty.
5. **The Climax:** The match ends when the conditions are met, and the Host broadcasts the final `MatchRecord`.

## The Tone & Vibe
This is a highly competitive, chaotic party game. The UI should feel juicy, tactile, and responsive. The code should prioritize making the sabotage mechanics feel instant and punishing for the target.

## System Interdependencies (Crucial Context)
You must understand how these systems link together:
- **PixiJS (The Board):** Only handles the 2D visual representation of the game. It is "dumb" and just reacts to state changes.
- **Supabase (The Network):** Acts as the multiplayer backbone. The Host validates moves; clients send Intents via Realtime Broadcast.
- **HTML5 Video + TheHandy (The Engine):** The video player's current time and playback rate dictate the hardware's HSP protocol commands. They must remain perfectly synchronized, especially when Traps alter the playback speed.