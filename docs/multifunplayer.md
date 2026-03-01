# MultiFunPlayer

This build provides a local OFS-compatible WebSocket bridge. MultiFunPlayer loads
the scripts sent by F-Land and controls your multi-axis device.

**Funlink test integration:** RustyFunPlayer, the Linux port of MultiFunPlayer, can
discover the local bridge and offer a connection. The manual OFS setup below is also available.

1. In F-Land, open **Settings → Hardware & Sync → MultiFunPlayer** and enable the bridge.
2. In MultiFunPlayer, add **OFS** under media players. Set its address to
   `ws://127.0.0.1:8080/ofs` (or the port shown in F-Land), then connect.
3. Add and connect your device output in MultiFunPlayer, and configure its axes,
   ranges and speed limits. Accepting the Funlink offer, or connecting the OFS player
   manually, automatically adds MultiFunPlayer as a hardware device in F-Land.
4. Play a round or a round preview in F-Land. Playback, pauses, seeks, speed changes
   and the F-Land script offset are sent automatically. A connected-player count
   appears in Hardware settings. The bridge setting persists across app restarts.

MultiFunPlayer replaces the direct TCode hardware option. Saved TCode devices migrate
into one MultiFunPlayer entry, preserving the first entry's stroke range and offset.
Connect the OFS player to activate it in F-Land. Listening for a player or discovering
a Funlink hub alone does not activate hardware. F-Land checks incoming connections
every second; no second **Connect** click is needed. **Disconnect** remains effective
until a fresh player connection arrives or you explicitly reconnect in F-Land.

The normal hardware Stop/Resume controls and the cum button pause playback through
OFS. When MultiFunPlayer is connected, the haptics overlay shows its device card instead
of the extra Stroke Adjustment card. Saved F-Land stroke calibration still scales
the primary stroke timeline;
MultiFunPlayer's own axis/output limits still apply. Configure other axes there.
For axes using motion providers, turn off **Update motion providers when paused**
in MultiFunPlayer so a playback pause also pauses generated motion. OFS controls
playback; it does not disconnect device outputs or override MultiFunPlayer's
motion-provider and auto-home settings.
A running bridge without a connected OFS player is not a connected hardware device.

The active primary timeline is sent as `F-Land.funscript`, including F-Land's
normalization and inversion. Additional local scripts are discovered beside the
selected funscript, using the same base filename:

```text
scene.funscript
scene.roll.funscript
scene.pitch.funscript
scene.twist.funscript
scene.surge.funscript
scene.sway.funscript
```

Offset changes apply live to the primary script and all forwarded axes, including
while paused. Positive values advance the script; negative values delay it.
The bridge shifts script timestamps without resetting the media or changing the
video clock, avoiding MultiFunPlayer's smoothing of small clock corrections.
OFS does not expose MultiFunPlayer's native offset setting, so its displayed
offset remains independent and adds to the calibration applied by F-Land.

The suffixes `suck`, `vib`, `L1`–`L2`, `R0`–`R2`, and `A0`–`A2` are also forwarded;
MultiFunPlayer's configured axis filename mappings determine how they are used.
The primary timeline owns L0; an L0 sibling is skipped so it cannot bypass the
in-app stroke range. Only valid JSON files containing an `actions` array are forwarded. Remote scripts
use the primary timeline loaded by F-Land; sibling discovery requires local files.
If a round has only a primary script, use MultiFunPlayer's axis links or motion
providers to generate motion for the other axes. The bridge does not invent extra
axis scripts. Missing scripts are cleared when the active media changes.

The bridge follows the actual round video, including intermediary videos. During
loading, buffering, seeking, or F-Land's manual device stop it reports paused.
It also reports paused if renderer updates stop for more than one second. F-Land
owns playback: commands from MultiFunPlayer's play/seek/speed buttons are ignored.
Generated device-only anti-perk sequences and script enhancements use the same
hardware playback path. Converter previews are not connected to the bridge.

The server listens only on `127.0.0.1`. If the port is occupied, choose another
port in Hardware settings and use the same port in MultiFunPlayer.

Protocol reference: [MultiFunPlayer OFS source](https://github.com/Yoooi0/MultiFunPlayer/blob/master/Source/MultiFunPlayer/MediaSource/ViewModels/OfsMediaSource.cs).
