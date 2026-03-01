---
trigger: always_on
---

# Hardware Integration: TheHandy API v3 (Firmware 4)

This game exclusively integrates with TheHandy using the official REST API v3 and requires Firmware 4.
We do NOT use `buttplug.io`, Intiface, or the legacy HSSP protocol.

## CRITICAL HANDY API V3 CONSTRAINTS:

1. **USE HSP (Handy Streaming Protocol):** The game must use the new HSP mode to sync video with the device.
2. **Script Setup:** Parse the local Funscript JSON and upload it to the device buffer using `PUT /hsp/setup` and `PUT /hsp/add`.
3. **Handling Variable Speed:** The game features dynamic video speed multipliers (e.g., `video.playbackRate = 1.5`). To keep the haptics synced, DO NOT write a custom math loop. Instead, whenever the HTML5 video playback rate changes, immediately send a request to `PUT /hsp/playbackrate` with the new speed multiplier.
4. **Local API Preferred:** Prioritize using the Local Network API (direct to the device's local IP) to minimize latency when sending trap triggers.