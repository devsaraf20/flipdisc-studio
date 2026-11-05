/**
 * A Frame is the state of every disc on the display.
 * data[y * width + x] is 1 when the disc shows its bright face, 0 when dark.
 */
export interface Frame {
  width: number;
  height: number;
  data: Uint8Array;
}

export function createFrame(width: number, height: number, fill = 0): Frame {
  const data = new Uint8Array(width * height);
  if (fill) data.fill(1);
  return { width, height, data };
}

export function cloneFrame(f: Frame): Frame {
  return { width: f.width, height: f.height, data: new Uint8Array(f.data) };
}

export function getPixel(f: Frame, x: number, y: number): number {
  if (x < 0 || y < 0 || x >= f.width || y >= f.height) return 0;
  return f.data[y * f.width + x];
}

export function setPixel(f: Frame, x: number, y: number, v: number): void {
  if (x < 0 || y < 0 || x >= f.width || y >= f.height) return;
  f.data[y * f.width + x] = v ? 1 : 0;
}

export function invertFrame(f: Frame): Frame {
  const out = cloneFrame(f);
  for (let i = 0; i < out.data.length; i++) out.data[i] ^= 1;
  return out;
}

/** Crop or pad a frame to a new size, anchored at the top-left. */
export function resizeFrame(f: Frame, width: number, height: number): Frame {
  if (f.width === width && f.height === height) return f;
  const out = createFrame(width, height);
  const w = Math.min(width, f.width);
  const h = Math.min(height, f.height);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) out.data[y * width + x] = f.data[y * f.width + x];
  }
  return out;
}

/** Nearest-neighbour scale (used for incoming frames of a different size). */
export function scaleFrame(f: Frame, width: number, height: number): Frame {
  if (f.width === width && f.height === height) return f;
  const out = createFrame(width, height);
  for (let y = 0; y < height; y++) {
    const sy = Math.min(f.height - 1, Math.floor((y * f.height) / height));
    for (let x = 0; x < width; x++) {
      const sx = Math.min(f.width - 1, Math.floor((x * f.width) / width));
      out.data[y * width + x] = f.data[sy * f.width + sx];
    }
  }
  return out;
}

export function framesEqual(a: Frame, b: Frame): boolean {
  if (a.width !== b.width || a.height !== b.height) return false;
  for (let i = 0; i < a.data.length; i++) if (a.data[i] !== b.data[i]) return false;
  return true;
}

/** Count discs that differ between two frames of the same size. */
export function countDiff(a: Frame, b: Frame): number {
  let n = 0;
  const len = Math.min(a.data.length, b.data.length);
  for (let i = 0; i < len; i++) if (a.data[i] !== b.data[i]) n++;
  return n + Math.abs(a.data.length - b.data.length);
}

export function countOn(f: Frame): number {
  let n = 0;
  for (let i = 0; i < f.data.length; i++) n += f.data[i];
  return n;
}

/** Pack to bytes, row-major, MSB first, rows NOT padded (bit stream). */
export function packBits(f: Frame): Uint8Array {
  const out = new Uint8Array(Math.ceil(f.data.length / 8));
  for (let i = 0; i < f.data.length; i++) {
    if (f.data[i]) out[i >> 3] |= 0x80 >> (i & 7);
  }
  return out;
}

export function unpackBits(bytes: Uint8Array, width: number, height: number): Frame {
  const f = createFrame(width, height);
  for (let i = 0; i < f.data.length; i++) {
    const b = bytes[i >> 3] ?? 0;
    f.data[i] = (b >> (7 - (i & 7))) & 1;
  }
  return f;
}

export function bytesToBase64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}

export function base64ToBytes(b64: string): Uint8Array {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

export function frameToBase64(f: Frame): string {
  return bytesToBase64(packBits(f));
}

export function frameFromBase64(b64: string, width: number, height: number): Frame {
  return unpackBits(base64ToBytes(b64), width, height);
}

/** "0101…" string, one char per disc, row-major. Handy for OSC string args. */
export function frameToBitString(f: Frame): string {
  let s = '';
  for (let i = 0; i < f.data.length; i++) s += f.data[i] ? '1' : '0';
  return s;
}

/** Overlay: OR `top` onto `base` (both same size). */
export function orFrames(base: Frame, top: Frame): Frame {
  const out = cloneFrame(base);
  const n = Math.min(out.data.length, top.data.length);
  for (let i = 0; i < n; i++) out.data[i] |= top.data[i];
  return out;
}
