// Frame helpers shared by the bridge. A frame is { width, height, data: Uint8Array(0|1) }.
import { encodeMessage } from './osc.mjs';

export function packBits(data) {
  const out = Buffer.alloc(Math.ceil(data.length / 8));
  for (let i = 0; i < data.length; i++) if (data[i]) out[i >> 3] |= 0x80 >> (i & 7);
  return out;
}

export function unpackBits(bytes, width, height) {
  const data = new Uint8Array(width * height);
  for (let i = 0; i < data.length; i++) data[i] = ((bytes[i >> 3] ?? 0) >> (7 - (i & 7))) & 1;
  return data;
}

const on = (a) => {
  if (typeof a.value === 'boolean') return a.value ? 1 : 0;
  return Number(a.value) > 0.5 ? 1 : 0;
};

/**
 * Accepts OSC messages from TouchDesigner, Unreal, Max… and assembles frames.
 *   /flipdisc/frame  i:w i:h b:packed           → frame
 *   /flipdisc/frame  i:w i:h s:"0101…"          → frame
 *   /flipdisc/frame  i:w i:h n0 n1 … (w*h nums) → frame
 *   /flipdisc/pixels (same as the line above)
 *   /flipdisc/size   i:w i:h                    → sets size for rows
 *   /flipdisc/row    i:y n0 … n(w-1)            → row; frame emitted after last row
 *   /flipdisc/row/<y> n0 … n(w-1)               → same, row index in the address
 *   /flipdisc/commit                            → emit the rows so far
 */
export class FrameAssembler {
  constructor(width = 28, height = 14, onFrame = () => {}) {
    this.width = width;
    this.height = height;
    this.rows = new Uint8Array(width * height);
    this.onFrame = onFrame;
    this.dirty = false;
  }

  resize(w, h) {
    w = Math.max(1, Math.min(512, w | 0));
    h = Math.max(1, Math.min(512, h | 0));
    if (w === this.width && h === this.height) return;
    this.width = w;
    this.height = h;
    this.rows = new Uint8Array(w * h);
  }

  emitRows() {
    this.dirty = false;
    this.onFrame({ width: this.width, height: this.height, data: new Uint8Array(this.rows) });
  }

  /** Returns true if the message was understood. */
  handle(msg) {
    const { address, args } = msg;
    const a = address.replace(/\/+$/, '');
    if (a === '/flipdisc/frame' || a === '/flipdisc/pixels') {
      if (args.length < 3) return false;
      const w = args[0].value | 0;
      const h = args[1].value | 0;
      if (w <= 0 || h <= 0 || w * h > 512 * 512) return false;
      const rest = args.slice(2);
      let data;
      if (rest[0].type === 'b') data = unpackBits(rest[0].value, w, h);
      else if (rest[0].type === 's') {
        const s = rest[0].value.replace(/[^01]/g, '');
        data = new Uint8Array(w * h);
        for (let i = 0; i < data.length && i < s.length; i++) data[i] = s.charCodeAt(i) === 49 ? 1 : 0;
      } else {
        data = new Uint8Array(w * h);
        for (let i = 0; i < data.length && i < rest.length; i++) data[i] = on(rest[i]);
      }
      this.onFrame({ width: w, height: h, data });
      return true;
    }
    if (a === '/flipdisc/size') {
      if (args.length < 2) return false;
      this.resize(args[0].value, args[1].value);
      return true;
    }
    if (a === '/flipdisc/commit') {
      if (this.dirty) this.emitRows();
      return true;
    }
    let y;
    let values;
    const m = /^\/flipdisc\/row\/(\d+)$/.exec(a);
    if (m) {
      y = Number(m[1]);
      values = args;
    } else if (a === '/flipdisc/row' && args.length >= 2) {
      y = args[0].value | 0;
      values = args.slice(1);
    } else return false;
    if (y < 0 || y >= this.height) return false;
    for (let x = 0; x < this.width; x++) this.rows[y * this.width + x] = x < values.length ? on(values[x]) : 0;
    this.dirty = true;
    if (y === this.height - 1) this.emitRows();
    return true;
  }
}

/** Build the OSC messages for one outgoing frame in the chosen formats. */
export function frameToOsc(frame, formats) {
  const { width: w, height: h, data } = frame;
  const msgs = [];
  for (const f of formats) {
    if (f === 'blob') msgs.push(encodeMessage('/flipdisc/frame', [w, h, packBits(data)]));
    else if (f === 'bits') {
      let s = '';
      for (let i = 0; i < data.length; i++) s += data[i] ? '1' : '0';
      msgs.push(encodeMessage('/flipdisc/frame', [w, h, s]));
    } else if (f === 'pixels') msgs.push(encodeMessage('/flipdisc/pixels', [w, h, ...Array.from(data)]));
    else if (f === 'rows') {
      for (let y = 0; y < h; y++) msgs.push(encodeMessage(`/flipdisc/row/${y}`, Array.from(data.subarray(y * w, (y + 1) * w))));
      msgs.push(encodeMessage('/flipdisc/commit', []));
    }
  }
  return msgs;
}
