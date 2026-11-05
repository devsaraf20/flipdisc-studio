# Flip-Disc Studio

Design, simulate and play content on flip-disc displays from the browser,
before you own the hardware and after.

- **Realistic simulator**: shaded 2.5D discs that rotate on their axle, land and
  bounce, with per-disc timing variation, column scan delay, a synthesised click
  sound, and a refresh rate limit like a real controller.
- **Content tools**: brush, eraser, fill and shapes; pixel-font text with
  alignment, size and scrolling; image and video import with threshold,
  Floyd–Steinberg / Atkinson / ordered dithering and contrast; live webcam;
  generative patterns (noise, waves, Game of Life, clock, ripple).
- **Timeline**: scenes with durations and transitions (wipe, dissolve,
  column-by-column flip), loop playback, undo, JSON save/load, autosave.
- **Diff mode**: only changed discs are pulsed. The status bar counts flips and
  pulses per frame, so you can see wear and noise drop.
- **Outputs**: OSC and WebSocket through a local bridge; direct hardware output
  over Web Serial with a pluggable protocol layer (AlfaZeta-style RS485 example,
  raw bits for your own firmware); C array export for Arduino / ESP32.
- **Inputs**: frames from TouchDesigner, Unreal, Max… over OSC, previewed live on the panel.

New to dithering, OSC, serial or RS485? Read **[LEARN.md](LEARN.md)**.

## Quick start

```bash
npm install
```

```bash
npm run dev
```

Open the URL Vite prints. To talk to OSC apps or other programs, start the bridge in a second terminal:

```bash
npm run bridge
```

Then in the studio: **Output** or **Input** tab → **Connect**.

Other scripts: `npm test` (unit tests for the app and the bridge), `npm run build` (production build into `dist/`).

## Architecture

```
                         ┌──────────────────────── Browser (Vercel or localhost) ─────────────────────────┐
                         │                                                                                  │
  Image / video / webcam │  Content sources            Timeline                 Simulator                  │
  ───────────────────────┼─▶ bitmap (draw, shapes)  ┐                                                       │
                         │   text (pixel fonts)     │  scenes + durations   ┌─────────────────────────┐    │
                         │   patterns (generators)  ├─▶ + transitions ──────▶│ rate limit (max fps)     │    │
                         │   clips (baked video)    │  (wipe, dissolve,     │ diff: changed discs only │    │
                         │   webcam (dithered live) │   column flip)        │ flip animation + clicks  │    │
                         │   OSC input ◀───────┐    ┘   Engine (rAF loop)   └────────────┬────────────┘    │
                         │                     │                                         │ committed frame │
                         │                     │        ┌────────────────────────────────┼──────────┐      │
                         │                     │        ▼                                ▼          ▼      │
                         │                     │  BridgeClient (WebSocket)     Web Serial      C export  │
                         │                     │        │                    protocol layer    (.h file) │
                         └─────────────────────┼────────┼──────────────────────────┬─────────────────────┘
                                               │        │ JSON {width,height,bits}  │ bytes
                                               │        ▼                           ▼
                         ┌──────────── bridge/bridge.mjs (Node, runs locally) ─┐   USB-RS485 adapter
                         │  WebSocket :8765  ◀──▶  OSC/UDP in :9000, out :9001 │        │
                         └──────────────────────────────┬──────────────────────┘        ▼
                                                        │                        flip-disc panel(s)
                                     TouchDesigner, Unreal, Max/MSP, Processing, ESP32…
```

**Data model.** A frame is `width × height` bytes of 0/1 (`src/core/frame.ts`).
On the wire it is packed: row-major, 8 discs per byte, MSB first (`packBits`).
The same convention is used in the project file, the WebSocket messages, the
OSC blob and the raw serial protocol.

### Source layout

| Path | What |
| --- | --- |
| `src/core/` | Pure logic, no DOM: frames, fonts, text and shape rasteriser, dithering, generators, transitions, project model and JSON format. Unit-tested. |
| `src/sim/` | The canvas simulator (`simulator.ts`) and the click synthesiser (`audio.ts`). |
| `src/io/` | Outputs and inputs: bridge client, Web Serial, protocol drivers (`protocols.ts`), C export, webcam. |
| `src/ui/` | React UI: store with undo, engine (picks the frame to show), panels. |
| `bridge/` | Node bridge: dependency-free OSC codec, frame assembler, WebSocket ↔ OSC relay. |
| `examples/` | Arduino sketches, TouchDesigner scripts, Node examples. |
| `docs/` | TouchDesigner and Unreal guides. |

### How a frame flows

1. The **engine** runs every animation frame. While playing it asks the
   `TimelineRenderer` for the frame at the playhead (blending the previous and
   next scene during a transition); otherwise it renders the selected scene.
2. The **simulator** keeps only the newest frame and commits at most *Max
   refresh rate* times per second. On commit it compares with the current
   state. With **diff mode** on, only changed discs are pulsed; off, every disc
   is pulsed and those already in place visibly twitch. Each pulsed disc gets a
   start delay (column scan + random jitter) and a slightly varied flip time.
3. Each committed frame is passed to the outputs that are enabled: the bridge
   (WebSocket) and Web Serial (encoded by the selected protocol). Nothing is
   sent when no disc changed.

## Bridge

```bash
npm run bridge -- --osc-out 192.168.1.20:9001 --osc-format rows,blob
```

| Option | Default | |
| --- | --- | --- |
| `--ws <port>` | 8765 | WebSocket port for the studio |
| `--host <addr>` | 127.0.0.1 | Use `0.0.0.0` to accept browsers from other machines |
| `--osc-in <port>` | 9000 | UDP port for incoming frames (`0` = off) |
| `--osc-out <host:port>` | 127.0.0.1:9001 | Where displayed frames go. Repeat for several targets, `off` to disable |
| `--osc-format <list>` | rows | `rows`, `blob`, `bits`, `pixels`, comma separated |
| `--width`, `--height` | 28, 14 | Grid size assumed for row messages |

**OSC the bridge sends** (each displayed frame):

| Format | Messages |
| --- | --- |
| `rows` | `/flipdisc/row/<y>` with `width` ints, for every row, then `/flipdisc/commit` |
| `blob` | `/flipdisc/frame` `int width, int height, blob packedBits` |
| `bits` | `/flipdisc/frame` `int width, int height, string "0101…"` |
| `pixels` | `/flipdisc/pixels` `int width, int height, int × (w·h)` |

**OSC the bridge accepts**: everything above, plus `/flipdisc/frame` or
`/flipdisc/pixels` with numeric values (anything > 0.5 is on),
`/flipdisc/row int y, values…`, and `/flipdisc/size int w, int h`.
Bundles are unpacked. Frames whose size differs from the studio's grid are
scaled to fit.

**WebSocket messages** (JSON text):

```json
{ "type": "frame", "width": 28, "height": 14, "bits": "<base64 packed bits>" }
```

The studio sends these; the bridge sends the same shape back for OSC input,
plus `{"type":"status", …}`. Any other WebSocket client receives the studio's
frames too; see `examples/node/listen.mjs`. Test input without TouchDesigner:
`node examples/node/send-test-pattern.mjs`.

**Hosted studio + local bridge.** The Vercel page connects to
`ws://localhost:8765`. Chrome, Edge and Firefox allow this from an https page
because `localhost` counts as a secure origin; Safari may block it, so use
`npm run dev` there.

## Hardware output (Web Serial)

Web Serial works in desktop Chrome and Edge, on https or localhost. Plug in a
USB-to-RS485 adapter (or a microcontroller), open **Output → Hardware via Web
Serial**, pick a protocol and baud rate, then **Connect serial port…**. If a
frame takes longer to send than the refresh interval, only the newest frame is
kept, so latency never builds up. The panel shows bytes per frame and the
fastest frame rate your baud rate allows.

### Protocols

Protocols live in `src/io/protocols.ts`. A protocol is an object with options
(rendered as form fields automatically) and an `encode(frame, options)`
function returning the bytes to write. To add one, implement `DisplayProtocol`
and add it to `PROTOCOLS`.

- **AlfaZeta-style RS485 — ⚠️ unverified example.** Written from public
  hobbyist notes, not tested on hardware. Packet per 28×7 module:
  `0x80, command, address, 28 column bytes (bit 0 = top), 0x8F`, with
  `0x83` (show now), `0x84` (store) + `0x82` (refresh all). Command bytes,
  addresses, bit order and baud rate are all editable because they vary between
  controllers and DIP-switch settings. **Check everything against your panel's
  datasheet before relying on it**, and start with a single module.
- **Raw packed bits.** `'F','D', width, height, packed bits, XOR checksum`.
  Pair it with `examples/arduino/serial_receiver/serial_receiver.ino` to drive
  any panel from your own microcontroller code.

## C export

**Output → Export C array** writes a header for Arduino or ESP32 with the
current frame, the selected scene or the whole timeline sampled at a chosen
rate. Pick **Rows** (each row padded to bytes, MSB = leftmost disc) or
**Columns** (each column padded, bit 0 = top, like most flip-disc controllers).
Repeated frames can be merged and their durations summed.
`examples/arduino/playback/playback.ino` plays the result.

## Project files

Projects save as `*.flipdisc.json` (Ctrl/⌘+S). Bitmaps and clips are stored as
base64 packed bits. The current project also autosaves in the browser. Webcam
and OSC input scenes save their settings, not their pictures.

## Deploying to Vercel

The repo includes `vercel.json`. Import the repository in Vercel (framework
preset: Vite) or run `npx vercel`. Build command `npm run build`, output
`dist`. The bridge is not deployed; it runs on the computer next to your panel
or creative tools.

## Keyboard

| Key | Action |
| --- | --- |
| Space | Play / stop |
| Ctrl/⌘ + Z, Shift + Ctrl/⌘ + Z | Undo, redo |
| Ctrl/⌘ + S | Save project |
| Shift or right mouse button while drawing | Erase |

## Guides

- [TouchDesigner](docs/touchdesigner.md): OSC Out DAT + Execute DAT, or rows from CHOPs; receiving output back.
- [Unreal Engine](docs/unreal.md): OSC plugin, Scene Capture into a 28×14 render target, Blueprint and C++.
- [LEARN.md](LEARN.md): dithering, OSC, serial and RS485 for designers.
