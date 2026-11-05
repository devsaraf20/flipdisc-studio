# TouchDesigner ↔ Flip-Disc Studio

Design in TouchDesigner and watch it on the simulated flip-disc panel, or feed
the studio's output back into TouchDesigner.

```
TouchDesigner ──OSC (UDP 9000)──▶ bridge ──WebSocket──▶ Studio simulator
TouchDesigner ◀──OSC (UDP 9001)── bridge ◀──WebSocket── Studio output
```

## 0. Start the bridge and the studio

```bash
npm install
```

```bash
npm run bridge
```

Open the studio (local `npm run dev` or your Vercel URL), go to **Input** and
press **Connect**, then **Show OSC input on the display**.

## 1. Send visuals from TouchDesigner (recommended: Execute DAT)

The panel is tiny (28 × 14 by default), so first shrink your visuals to that
size, then turn each pixel into on/off.

1. Build your visuals as usual, ending in a TOP.
2. Add a **Resolution TOP** after it: *Output Resolution* → *Custom Resolution*,
   width **28**, height **14** (use your panel size). Set *Input Smoothness* to
   *Mipmap Pixels* so it averages instead of skipping pixels.
3. Optional but nice: a **Level TOP** for contrast and a **Monochrome TOP**.
4. End with a **Null TOP** named `flipdisc_in`.
5. Add an **OSC Out DAT** named `oscout1`: *Network Address* `127.0.0.1`,
   *Network Port* `9000`, *Protocol* UDP.
6. Add an **Execute DAT**, turn on **Frame End**, and paste
   [`examples/touchdesigner/flipdisc_send_execute.py`](../examples/touchdesigner/flipdisc_send_execute.py).

The script reads the TOP with `numpyArray()`, flips it (TouchDesigner stores the
bottom row first), thresholds it and sends:

```
/flipdisc/frame  28  14  "0101101…"     (392 characters, row by row from the top-left)
```

It sends every 4th frame (15 fps). Real panels can't go much faster, and the
studio rate-limits to its *Max refresh rate* anyway.

### Python in a Script DAT instead

Any DAT that can run Python works. The essential call is:

```python
op('oscout1').sendOSC('/flipdisc/frame', [width, height, bits])
```

### Without Python: one OSC message per row

If you prefer CHOPs, send rows. The bridge accepts `/flipdisc/row/<y>` with
one number per disc (anything > 0.5 is "on"). After the last row
(`y = height − 1`) the frame is shown; or send `/flipdisc/commit` yourself.
If your grid is not 28 × 14, send `/flipdisc/size 56 14` once, or start the
bridge with `--width 56 --height 14`.

## 2. Receive the studio's output in TouchDesigner

By default the bridge sends every displayed frame to `127.0.0.1:9001` as rows:

```
/flipdisc/row/0   0 1 1 0 …   (width ints)
…
/flipdisc/row/13  …
/flipdisc/commit
```

1. Add an **OSC In DAT**, *Network Port* `9001`.
2. Set its *Callbacks DAT* to a Text DAT containing
   [`examples/touchdesigner/flipdisc_receive_callbacks.py`](../examples/touchdesigner/flipdisc_receive_callbacks.py).
3. Add a **Table DAT** named `flipdisc_grid`; the callback fills it with 0/1.
4. Visualise it with *DAT to CHOP* → *CHOP to TOP*, or the Script TOP snippet in the file.

Other formats: start the bridge with `--osc-format blob` (one message with packed
bytes), `bits` (one string of 0/1) or `pixels` (one message with all values).
Combine them with commas: `--osc-format rows,bits`.

## Troubleshooting

- **Nothing arrives**: the bridge prints `… last 5s: N OSC packets in`. If N is 0,
  check the port (9000) and that the OSC Out DAT is *Active*.
- **Image upside down**: remove or add the `[::-1]` in the script.
- **"ignoring OSC address"** in the bridge log: check the address spelling.
- **Firewall**: when TouchDesigner runs on another computer, start the bridge on
  the studio's computer and send to its IP address; allow UDP 9000 in the firewall.
