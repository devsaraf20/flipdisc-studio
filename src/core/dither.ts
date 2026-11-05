import { createFrame, type Frame } from './frame';

export type DitherMethod = 'threshold' | 'floyd-steinberg' | 'atkinson' | 'ordered';
export type FitMode = 'cover' | 'contain' | 'stretch';

export interface ImageParams {
  method: DitherMethod;
  /** 0..1, the grey level that splits light from dark */
  threshold: number;
  /** -1..1 */
  brightness: number;
  /** -1..1 */
  contrast: number;
  invert: boolean;
  fit: FitMode;
  mirror: boolean;
}

export const DEFAULT_IMAGE_PARAMS: ImageParams = {
  method: 'floyd-steinberg',
  threshold: 0.5,
  brightness: 0,
  contrast: 0,
  invert: false,
  fit: 'cover',
  mirror: false,
};

/** Brightness / contrast adjustment on a 0..1 greyscale buffer (returns a new buffer). */
export function adjustGray(gray: Float32Array, brightness: number, contrast: number): Float32Array {
  const out = new Float32Array(gray.length);
  // Map contrast -1..1 to a slope 0..~5 (0 = flat grey, 1 = unchanged).
  const slope = contrast >= 0 ? 1 + contrast * 4 : 1 + contrast;
  for (let i = 0; i < gray.length; i++) {
    const v = (gray[i] - 0.5) * slope + 0.5 + brightness;
    out[i] = v < 0 ? 0 : v > 1 ? 1 : v;
  }
  return out;
}

const BAYER4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];

/**
 * Turn greys into on/off discs.
 * - threshold: each pixel compared on its own (posterised, loses detail)
 * - floyd-steinberg: push each pixel's rounding error onto its neighbours
 *   (7/16 right, 3/16 down-left, 5/16 down, 1/16 down-right)
 * - atkinson: like F–S but spreads only 6/8 of the error (crisper, higher contrast)
 * - ordered: compare against a repeating 4×4 Bayer pattern (stable in video)
 */
export function dither(gray: Float32Array, width: number, height: number, method: DitherMethod, threshold = 0.5): Frame {
  const out = createFrame(width, height);
  const d = out.data;
  if (method === 'threshold') {
    for (let i = 0; i < gray.length; i++) d[i] = gray[i] >= threshold ? 1 : 0;
    return out;
  }
  if (method === 'ordered') {
    const bias = threshold - 0.5;
    for (let y = 0; y < height; y++)
      for (let x = 0; x < width; x++) {
        const t = (BAYER4[(y & 3) * 4 + (x & 3)] + 0.5) / 16 + bias;
        d[y * width + x] = gray[y * width + x] >= t ? 1 : 0;
      }
    return out;
  }
  const buf = new Float32Array(gray);
  const add = (x: number, y: number, e: number) => {
    if (x < 0 || x >= width || y >= height) return;
    buf[y * width + x] += e;
  };
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      const old = buf[i];
      const v = old >= threshold ? 1 : 0;
      d[i] = v;
      const err = old - v;
      if (method === 'floyd-steinberg') {
        add(x + 1, y, (err * 7) / 16);
        add(x - 1, y + 1, (err * 3) / 16);
        add(x, y + 1, (err * 5) / 16);
        add(x + 1, y + 1, (err * 1) / 16);
      } else {
        const e = err / 8;
        add(x + 1, y, e);
        add(x + 2, y, e);
        add(x - 1, y + 1, e);
        add(x, y + 1, e);
        add(x + 1, y + 1, e);
        add(x, y + 2, e);
      }
    }
  }
  return out;
}

export function processGray(gray: Float32Array, width: number, height: number, p: ImageParams): Frame {
  const adj = adjustGray(gray, p.brightness, p.contrast);
  const f = dither(adj, width, height, p.method, p.threshold);
  if (p.invert) for (let i = 0; i < f.data.length; i++) f.data[i] ^= 1;
  return f;
}

// ---------- browser-only sampling helpers ----------

let scratch: HTMLCanvasElement | null = null;

/**
 * Draw any image/video/canvas into a tiny width×height canvas and read back
 * luminance (0..1). The browser does the averaging when it scales down.
 */
export function sampleGray(
  source: CanvasImageSource,
  srcW: number,
  srcH: number,
  width: number,
  height: number,
  fit: FitMode,
  mirror = false,
): Float32Array {
  if (!scratch) scratch = document.createElement('canvas');
  // Draw at 4× then box-filter for a smoother result than one-step downscaling.
  const ss = 4;
  scratch.width = width * ss;
  scratch.height = height * ss;
  const ctx = scratch.getContext('2d', { willReadFrequently: true })!;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, scratch.width, scratch.height);
  const W = scratch.width;
  const H = scratch.height;
  let dw = W;
  let dh = H;
  if (fit !== 'stretch' && srcW > 0 && srcH > 0) {
    const s = fit === 'cover' ? Math.max(W / srcW, H / srcH) : Math.min(W / srcW, H / srcH);
    dw = srcW * s;
    dh = srcH * s;
  }
  ctx.save();
  if (mirror) {
    ctx.translate(W, 0);
    ctx.scale(-1, 1);
  }
  try {
    ctx.drawImage(source, (W - dw) / 2, (H - dh) / 2, dw, dh);
  } catch {
    /* source not ready */
  }
  ctx.restore();
  const img = ctx.getImageData(0, 0, W, H).data;
  const out = new Float32Array(width * height);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      let sum = 0;
      for (let sy = 0; sy < ss; sy++)
        for (let sx = 0; sx < ss; sx++) {
          const i = ((y * ss + sy) * W + (x * ss + sx)) * 4;
          // Rec. 709 luma on sRGB values: good enough for dithering.
          sum += (0.2126 * img[i] + 0.7152 * img[i + 1] + 0.0722 * img[i + 2]) / 255;
        }
      out[y * width + x] = sum / (ss * ss);
    }
  return out;
}
