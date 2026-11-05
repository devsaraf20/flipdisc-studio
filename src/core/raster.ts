import { createFrame, setPixel, type Frame } from './frame';
import { getFont, lineColumns } from './fonts';

export type HAlign = 'left' | 'center' | 'right';
export type VAlign = 'top' | 'middle' | 'bottom';
export type ScrollMode = 'none' | 'left' | 'right' | 'up' | 'down';

export interface TextParams {
  text: string;
  font: string;
  scale: number;
  align: HAlign;
  valign: VAlign;
  scroll: ScrollMode;
  /** discs per second */
  speed: number;
  invert: boolean;
  offsetX: number;
  offsetY: number;
}

export const DEFAULT_TEXT: TextParams = {
  text: 'HELLO',
  font: 'classic',
  scale: 1,
  align: 'center',
  valign: 'middle',
  scroll: 'none',
  speed: 12,
  invert: false,
  offsetX: 0,
  offsetY: 0,
};

/** Rasterise multi-line text into its own tight bitmap. */
export function textBitmap(p: Pick<TextParams, 'text' | 'font' | 'scale' | 'align'>): Frame {
  const font = getFont(p.font);
  const s = Math.max(1, Math.round(p.scale));
  const lines = p.text.split('\n');
  const cols = lines.map((l) => lineColumns(font, l));
  const w = Math.max(1, ...cols.map((c) => c.length)) * s;
  const lineH = font.height * s;
  const gap = font.lineGap * s;
  const h = Math.max(1, lines.length * lineH + (lines.length - 1) * gap);
  const out = createFrame(w, h);
  cols.forEach((c, li) => {
    const lw = c.length * s;
    const x0 = p.align === 'left' ? 0 : p.align === 'right' ? w - lw : Math.floor((w - lw) / 2);
    const y0 = li * (lineH + gap);
    c.forEach((mask, cx) => {
      for (let cy = 0; cy < font.height; cy++) {
        if (!(mask & (1 << cy))) continue;
        for (let sy = 0; sy < s; sy++)
          for (let sx = 0; sx < s; sx++) setPixel(out, x0 + cx * s + sx, y0 + cy * s + sy, 1);
      }
    });
  });
  return out;
}

export function blit(dst: Frame, src: Frame, ox: number, oy: number, mode: 'or' | 'copy' = 'or'): void {
  for (let y = 0; y < src.height; y++) {
    const dy = y + oy;
    if (dy < 0 || dy >= dst.height) continue;
    for (let x = 0; x < src.width; x++) {
      const dx = x + ox;
      if (dx < 0 || dx >= dst.width) continue;
      const v = src.data[y * src.width + x];
      if (mode === 'copy') dst.data[dy * dst.width + dx] = v;
      else if (v) dst.data[dy * dst.width + dx] = 1;
    }
  }
}

/** Render a text scene at time t (ms). Scrolling loops seamlessly. */
export function renderText(p: TextParams, width: number, height: number, tMs: number): Frame {
  const bmp = textBitmap(p);
  const out = createFrame(width, height);
  const travel = (p.speed * tMs) / 1000;
  let x: number;
  let y: number;
  const ax = p.align === 'left' ? 0 : p.align === 'right' ? width - bmp.width : Math.floor((width - bmp.width) / 2);
  const ay = p.valign === 'top' ? 0 : p.valign === 'bottom' ? height - bmp.height : Math.floor((height - bmp.height) / 2);
  switch (p.scroll) {
    case 'left': {
      const period = width + bmp.width;
      x = width - Math.floor(travel % period);
      y = ay;
      break;
    }
    case 'right': {
      const period = width + bmp.width;
      x = -bmp.width + Math.floor(travel % period);
      y = ay;
      break;
    }
    case 'up': {
      const period = height + bmp.height;
      x = ax;
      y = height - Math.floor(travel % period);
      break;
    }
    case 'down': {
      const period = height + bmp.height;
      x = ax;
      y = -bmp.height + Math.floor(travel % period);
      break;
    }
    default:
      x = ax;
      y = ay;
  }
  blit(out, bmp, x + Math.round(p.offsetX), y + Math.round(p.offsetY));
  if (p.invert) for (let i = 0; i < out.data.length; i++) out.data[i] ^= 1;
  return out;
}

/** Time (ms) for one full scroll cycle; useful for picking scene durations. */
export function scrollCycleMs(p: TextParams, width: number, height: number): number {
  if (p.scroll === 'none' || p.speed <= 0) return 0;
  const bmp = textBitmap(p);
  const dist = p.scroll === 'left' || p.scroll === 'right' ? width + bmp.width : height + bmp.height;
  return (dist / p.speed) * 1000;
}

// ---------- shapes ----------

export type ShapeKind = 'line' | 'rect' | 'rectFill' | 'ellipse' | 'ellipseFill';

export function drawLine(f: Frame, x0: number, y0: number, x1: number, y1: number, v = 1, size = 1): void {
  const dx = Math.abs(x1 - x0);
  const dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  let x = x0;
  let y = y0;
  for (;;) {
    stamp(f, x, y, v, size);
    if (x === x1 && y === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) {
      err += dy;
      x += sx;
    }
    if (e2 <= dx) {
      err += dx;
      y += sy;
    }
  }
}

/** Square brush of `size` centred on (x, y). */
export function stamp(f: Frame, x: number, y: number, v: number, size = 1): void {
  const r0 = -Math.floor((size - 1) / 2);
  for (let dy = 0; dy < size; dy++) for (let dx = 0; dx < size; dx++) setPixel(f, x + r0 + dx, y + r0 + dy, v);
}

export function drawShape(
  f: Frame,
  kind: ShapeKind,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  v = 1,
  size = 1,
): void {
  if (kind === 'line') return drawLine(f, x0, y0, x1, y1, v, size);
  const left = Math.min(x0, x1);
  const right = Math.max(x0, x1);
  const top = Math.min(y0, y1);
  const bottom = Math.max(y0, y1);
  if (kind === 'rect' || kind === 'rectFill') {
    for (let y = top; y <= bottom; y++) {
      for (let x = left; x <= right; x++) {
        const edge = x - left < size || right - x < size || y - top < size || bottom - y < size;
        if (kind === 'rectFill' || edge) setPixel(f, x, y, v);
      }
    }
    return;
  }
  // Ellipse inscribed in the bounding box, sampled at pixel centres.
  const cx = (left + right) / 2;
  const cy = (top + bottom) / 2;
  const rx = (right - left) / 2 + 0.5;
  const ry = (bottom - top) / 2 + 0.5;
  const irx = Math.max(0.01, rx - size);
  const iry = Math.max(0.01, ry - size);
  for (let y = top; y <= bottom; y++) {
    for (let x = left; x <= right; x++) {
      const nx = (x - cx) / rx;
      const ny = (y - cy) / ry;
      const inside = nx * nx + ny * ny <= 1;
      if (!inside) continue;
      if (kind === 'ellipseFill') setPixel(f, x, y, v);
      else {
        const ix = (x - cx) / irx;
        const iy = (y - cy) / iry;
        if (ix * ix + iy * iy > 1 || irx < 0.6 || iry < 0.6) setPixel(f, x, y, v);
      }
    }
  }
}

export function floodFill(f: Frame, x: number, y: number, v: number): void {
  if (x < 0 || y < 0 || x >= f.width || y >= f.height) return;
  const target = f.data[y * f.width + x];
  if (target === (v ? 1 : 0)) return;
  const stack = [y * f.width + x];
  while (stack.length) {
    const i = stack.pop()!;
    if (f.data[i] !== target) continue;
    f.data[i] = v ? 1 : 0;
    const px = i % f.width;
    if (px > 0) stack.push(i - 1);
    if (px < f.width - 1) stack.push(i + 1);
    if (i >= f.width) stack.push(i - f.width);
    if (i + f.width < f.data.length) stack.push(i + f.width);
  }
}
