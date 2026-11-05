# Learn: the ideas behind Flip-Disc Studio

Written for design students. No maths beyond adding fractions, no electronics
background needed.

## 1. What is a flip-disc display?

A grid of small discs, each painted bright (often yellow) on one side and black
on the other. Each disc sits on a tiny axle with a magnet in it. Under it is a
coil of wire. Send a short pulse of current through the coil one way and the
disc flips to bright; the other way and it flips to black.

Three things follow from that, and they shape everything in this app:

- **Each disc is either on or off.** There is no grey. A picture has to be
  turned into a pattern of on/off dots. That is what *dithering* is for.
- **Disc stays put without power.** You only need to pulse discs that change.
  That is *diff mode*: fewer flips means less wear, less noise and less power.
- **Flipping takes time.** A disc needs a few milliseconds to turn, and a
  controller drives the coils one after another. That is why a real panel
  manages maybe 10–30 updates per second, and why the simulator has a *max
  refresh rate*.

The click you hear is the disc hitting its stop. A whole panel changing at once
makes a satisfying rattle. Many artists treat the sound as part of the work.

## 2. Dithering: faking grey with dots

Take a photo and shrink it to 28 × 14. Each pixel is now some shade of grey
between 0 (black) and 1 (white). The disc can only show 0 or 1.

**Threshold** is the simplest rule: "if the grey is brighter than 0.5, disc on".
It gives bold, graphic shapes, and it's perfect for text and logos. But a soft
gradient (a sky, a cheek) turns into one hard edge, and a large area of 0.45
grey becomes solid black. Detail is lost.

**Dithering** keeps the *average* brightness right by mixing on and off discs.
Look at a newspaper photo under a magnifier: it's the same trick.

### Floyd–Steinberg (error diffusion)

Go through the pixels like reading a book, left to right, top to bottom. For
each one:

1. Decide on or off with the threshold.
2. Work out the **error**: how wrong you were. A 0.7 grey shown as "on" (1)
   is 0.3 too bright, so the error is −0.3. A 0.3 grey shown as "off" (0) is
   0.3 too dark: error +0.3.
3. **Pass the error on** to neighbours you haven't visited yet, so they make up
   for it:

```
            [ you ]   7/16 →
   3/16 ↙   5/16 ↓   1/16 ↘
```

If you were too dark, your neighbours get a bit brighter and are more likely to
turn on. Over an area the on/off count averages out to the right grey. A 50 %
grey becomes roughly half the discs on, in an organic-looking scatter.

### The other options in the app

- **Atkinson** (from the original Macintosh) only passes on ¾ of the error.
  Highlights and shadows go clean white or black, mid-tones keep their texture.
  It often looks crisper on tiny grids.
- **Ordered (Bayer)** compares each pixel with a repeating 4 × 4 pattern of
  thresholds. It makes a regular cross-hatch texture. Because the pattern
  doesn't move, it's calm in **video**: error diffusion can "boil" as small
  changes ripple across the picture, which means lots of extra flips.

### Contrast and brightness

At 28 × 14, the biggest win is usually *before* dithering: push contrast up so
the subject separates from the background, and nudge brightness until the
important shape reads. Watch the *flips / frame* counter while you adjust a
video: noisy dithering means wear and noise on the real panel.

## 3. OSC: how creative apps talk to each other

**OSC** (Open Sound Control) is a simple message format that creative tools
share: TouchDesigner, Max/MSP, Ableton, Unreal, Processing, VVVV, many
microcontrollers. An OSC message looks like a tiny letter:

```
address:   /flipdisc/frame
arguments: 28, 14, "0101100…"
```

- The **address** is a path like a web URL. It says what the message is about.
  You choose the names; both sides just have to agree.
- The **arguments** are values: whole numbers (`int`), decimals (`float`),
  text (`string`) or raw bytes (`blob`).

OSC messages usually travel over **UDP** on your network. UDP is like
shouting across a room: fast, no handshake, and if one message is lost, the
next frame replaces it anyway. That suits live visuals. Each program listens on
a **port** (a numbered door on the computer). Here, the bridge listens on 9000
and sends to 9001.

### Why is there a bridge?

Web pages are not allowed to send or receive UDP, for security. They can use
**WebSockets**, a two-way connection to a server. So `bridge/bridge.mjs` is a
small program on your computer that speaks WebSocket to the studio and OSC to
everything else, translating in both directions.

## 4. Serial: one bit after another

**Serial communication** sends data one bit at a time down a wire, like Morse
code. It is how a computer talks to an Arduino over USB, and how most
flip-disc controllers receive pictures.

Both sides must agree on the speed, the **baud rate**: bits per second, such as
9600, 57600 or 115200. If they disagree you get garbage, like playing a record
at the wrong speed.

Each byte (8 bits) is wrapped with a *start bit* and a *stop bit*, so it takes
10 bits on the wire. That lets you predict speed:

```
seconds per frame = bytes × 10 / baud
```

A 28 × 14 panel with the AlfaZeta-style protocol is 64 bytes. At 57600 baud
that is 64 × 10 / 57600 ≈ 0.011 s, so up to about 90 updates per second; the
discs themselves are slower than that. At 9600 baud it's 0.067 s, about 15 per
second. The Output tab does this sum for you.

A **protocol** is the agreement about what the bytes mean: "start with 0x80,
then a command, then the panel's address, then one byte per column, then 0x8F".
Different manufacturers use different protocols, which is why the app has a
pluggable protocol layer.

**Web Serial** lets Chrome and Edge open a serial port from a web page, after
you pick the device in a pop-up. That is how the studio can drive real
hardware without installing anything.

### Hex

Bytes are often written in hexadecimal: `0x80` = 128, `0x8F` = 143, `0x7F` =
127. Each hex digit is 4 bits, so a byte is always two digits. You'll see this
in datasheets and in the packet preview in the Output tab.

## 5. RS485: serial over long wires

USB and Arduino serial work over short distances. Installations need long
cables (a building facade, a ceiling) and electrically noisy surroundings
(motors, lights, the discs' own coils). **RS485** is the standard answer:

- It uses **two wires, A and B, twisted together**, and sends each bit as the
  *difference* between them. Interference hits both wires equally, so the
  difference survives. Hundreds of metres work fine.
- It's a **bus**: many panels hang on the same pair of wires, one after
  another. Every panel hears every message, so each panel has an **address**
  (usually set with tiny DIP switches) and only acts on messages addressed to
  it. Address 0xFF often means "everyone".
- The far end of the bus usually needs a **120 Ω termination resistor**
  between A and B to stop signals echoing back.

From your laptop you need a **USB-to-RS485 adapter** (a few euros). The studio
sends serial bytes to the adapter, the adapter turns them into RS485 signals.

Typical wiring: adapter **A → A** on the first panel, **B → B**, and **GND →
GND** if the panel has a ground terminal; then daisy-chain to the next panel.
If nothing happens, swapping A and B is the classic fix. **The panels'
power supply (often 12–24 V) is separate**: never take it from the data
lines, and double-check polarity before switching on.

### About the AlfaZeta-style driver in this app

It's an example based on public hobbyist notes. It has **not been verified on
real hardware**. Before you connect a real panel:

1. Find your panel's datasheet or the manufacturer's protocol document.
2. Compare the start/end bytes, command bytes, address scheme, bits per byte,
   bit order and baud rate. All of them are editable in the Output tab.
3. Begin with one module, the broadcast address, and a simple pattern (all on,
   then all off) before trying animations.

## 6. Designing for the medium

- **Design at 1:1.** One pixel = one disc. Check the simulator, not your
  source image.
- **Motion costs flips.** A scrolling marquee flips many discs every frame. A
  slow dissolve or a still image flips few. Watch the counter.
- **Use the sound.** A column-by-column flip transition is as much a sound
  effect as a visual.
- **Fonts**: 5 × 7 is the classic flip-disc font. 3 × 5 fits two lines on a
  14-row panel.
- **Light matters.** Discs are reflective, not glowing: they look entirely
  different in daylight, under a spotlight or in the dark. Plan the lighting
  with the display.
