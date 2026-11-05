import { createFrame, type Frame } from './frame';
import { renderText } from './raster';

export type GeneratorKind = 'noise' | 'waves' | 'life' | 'clock' | 'ripple';

export interface GeneratorParams {
  kind: GeneratorKind;
  /** general speed multiplier */
  speed: number;
  /** spatial scale (bigger = larger features) */
  scale: number;
  /** 0..1 */
  threshold: number;
  /** life: initial density 0..1 */
  density: number;
  seed: number;
  /** clock options */
  showSeconds: boolean;
  clockFont: string;
  /** waves: angle in degrees */
  angle: number;
}

export const DEFAULT_GENERATOR: GeneratorParams = {
  kind: 'noise',
  speed: 1,
  scale: 6,
  threshold: 0.5,
  density: 0.35,
  seed: 1,
  showSeconds: false,
  clockFont: 'classic',
  angle: 30,
};

export const GENERATOR_LABELS: Record<GeneratorKind, string> = {
  noise: 'Noise',
  waves: 'Waves',
  life: 'Game of Life',
  clock: 'Clock',
  ripple: 'Ripple',
};

// ---------- deterministic helpers ----------

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hash3(x: number, y: number, z: number, seed: number): number {
  let h = (x * 374761393 + y * 668265263 + z * 2147483647 + seed * 144269504) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

const smooth = (t: number) => t * t * (3 - 2 * t);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** 3D value noise in 0..1. */
export function valueNoise(x: number, y: number, z: number, seed: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const zi = Math.floor(z);
  const xf = smooth(x - xi);
  const yf = smooth(y - yi);
  const zf = smooth(z - zi);
  const c = (dx: number, dy: number, dz: number) => hash3(xi + dx, yi + dy, zi + dz, seed);
  const x00 = lerp(c(0, 0, 0), c(1, 0, 0), xf);
  const x10 = lerp(c(0, 1, 0), c(1, 1, 0), xf);
  const x01 = lerp(c(0, 0, 1), c(1, 0, 1), xf);
  const x11 = lerp(c(0, 1, 1), c(1, 1, 1), xf);
  return lerp(lerp(x00, x10, yf), lerp(x01, x11, yf), zf);
}

function fbm(x: number, y: number, z: number, seed: number): number {
  return (valueNoise(x, y, z, seed) * 2 + valueNoise(x * 2, y * 2, z * 1.7, seed + 7)) / 3;
}

// ---------- Game of Life ----------

function lifeStep(f: Frame): Frame {
  const { width: w, height: h } = f;
  const out = createFrame(w, h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let n = 0;
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue;
          const xx = (x + dx + w) % w; // wrap around: a torus
          const yy = (y + dy + h) % h;
          n += f.data[yy * w + xx];
        }
      const alive = f.data[y * w + x];
      out.data[y * w + x] = n === 3 || (alive && n === 2) ? 1 : 0;
    }
  return out;
}

function lifeSeed(w: number, h: number, density: number, seed: number): Frame {
  const r = mulberry32(seed);
  const f = createFrame(w, h);
  for (let i = 0; i < f.data.length; i++) f.data[i] = r() < density ? 1 : 0;
  return f;
}

export interface Renderer {
  render(tMs: number): Frame;
}

/** Generators are stateful (Life), so each scene gets its own renderer instance. */
export function createGenerator(p: GeneratorParams, width: number, height: number): Renderer {
  switch (p.kind) {
    case 'life': {
      let gen = 0;
      let state = lifeSeed(width, height, p.density, p.seed);
      let stale = 0;
      let prevCount = -1;
      let reseed = 0;
      return {
        render(t) {
          const target = Math.floor((t / 1000) * 6 * p.speed);
          if (target < gen) {
            gen = 0;
            reseed = 0;
            stale = 0;
            state = lifeSeed(width, height, p.density, p.seed);
          }
          while (gen < target) {
            state = lifeStep(state);
            gen++;
            // Re-seed when the board has settled so it never goes static.
            let count = 0;
            for (let i = 0; i < state.data.length; i++) count += state.data[i];
            stale = count === prevCount ? stale + 1 : 0;
            prevCount = count;
            if (stale > 12 || count === 0) {
              reseed++;
              state = lifeSeed(width, height, p.density, p.seed + reseed);
              stale = 0;
            }
          }
          return state;
        },
      };
    }
    case 'clock':
      return {
        render() {
          const d = new Date();
          const pad = (n: number) => String(n).padStart(2, '0');
          let text = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
          if (p.showSeconds) text += `:${pad(d.getSeconds())}`;
          const font = p.clockFont;
          // Blink the colon each second for a little life.
          if (!p.showSeconds && d.getMilliseconds() > 500) text = text.replace(':', ' ');
          const scale = Math.max(1, Math.round(p.scale / 6));
          return renderText(
            {
              text,
              font,
              scale,
              align: 'center',
              valign: 'middle',
              scroll: 'none',
              speed: 0,
              invert: false,
              offsetX: 0,
              offsetY: 0,
            },
            width,
            height,
            0,
          );
        },
      };
    default:
      return {
        render(t) {
          const f = createFrame(width, height);
          const s = (t / 1000) * p.speed;
          const sc = Math.max(0.5, p.scale);
          const a = (p.angle * Math.PI) / 180;
          const ca = Math.cos(a);
          const sa = Math.sin(a);
          const cx = (width - 1) / 2;
          const cy = (height - 1) / 2;
          for (let y = 0; y < height; y++)
            for (let x = 0; x < width; x++) {
              let v: number;
              if (p.kind === 'noise') v = fbm(x / sc, y / sc, s * 0.8, p.seed);
              else if (p.kind === 'waves') {
                const u = x * ca + y * sa;
                const w2 = x * -sa + y * ca;
                v = 0.5 + 0.5 * Math.sin(u / sc * 2 + s * 3 + Math.sin(w2 / (sc * 1.7) + s) * 1.5);
              } else {
                const dist = Math.hypot(x - cx, (y - cy) * 1.0);
                v = 0.5 + 0.5 * Math.sin(dist / sc * 3 - s * 4);
              }
              f.data[y * width + x] = v >= p.threshold ? 1 : 0;
            }
          return f;
        },
      };
  }
}
