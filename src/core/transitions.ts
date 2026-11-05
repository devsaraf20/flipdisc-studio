import { createFrame, type Frame } from './frame';
import { mulberry32 } from './generators';

export type TransitionKind = 'cut' | 'wipe-left' | 'wipe-right' | 'wipe-down' | 'wipe-up' | 'dissolve' | 'columns';

export interface Transition {
  kind: TransitionKind;
  /** ms */
  duration: number;
}

export const TRANSITION_LABELS: Record<TransitionKind, string> = {
  cut: 'Cut',
  'wipe-left': 'Wipe →',
  'wipe-right': 'Wipe ←',
  'wipe-down': 'Wipe ↓',
  'wipe-up': 'Wipe ↑',
  dissolve: 'Dissolve',
  columns: 'Column flip',
};

const orderCache = new Map<string, Uint32Array>();
/** A fixed random ranking of every disc, so a dissolve looks the same each time. */
function dissolveOrder(n: number, seed: number): Uint32Array {
  const key = `${n}:${seed}`;
  let o = orderCache.get(key);
  if (o) return o;
  o = new Uint32Array(n);
  for (let i = 0; i < n; i++) o[i] = i;
  const r = mulberry32(seed);
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    const t = o[i];
    o[i] = o[j];
    o[j] = t;
  }
  const rank = new Uint32Array(n);
  for (let i = 0; i < n; i++) rank[o[i]] = i;
  orderCache.set(key, rank);
  return rank;
}

/**
 * Blend from frame `a` to frame `b`; p runs 0 → 1.
 * p = 0 returns a, p = 1 returns b, for every kind.
 */
export function applyTransition(kind: TransitionKind, a: Frame, b: Frame, p: number, seed = 7): Frame {
  const { width: w, height: h } = b;
  if (p <= 0) return a;
  if (p >= 1 || kind === 'cut') return b;
  const out = createFrame(w, h);
  const A = a.data;
  const B = b.data;
  switch (kind) {
    case 'wipe-left':
    case 'wipe-right': {
      const edge = Math.round(p * w);
      for (let y = 0; y < h; y++)
        for (let x = 0; x < w; x++) {
          const fromB = kind === 'wipe-left' ? x < edge : x >= w - edge;
          out.data[y * w + x] = fromB ? B[y * w + x] : A[y * w + x];
        }
      return out;
    }
    case 'wipe-down':
    case 'wipe-up': {
      const edge = Math.round(p * h);
      for (let y = 0; y < h; y++)
        for (let x = 0; x < w; x++) {
          const fromB = kind === 'wipe-down' ? y < edge : y >= h - edge;
          out.data[y * w + x] = fromB ? B[y * w + x] : A[y * w + x];
        }
      return out;
    }
    case 'dissolve': {
      const rank = dissolveOrder(w * h, seed);
      const cut = p * w * h;
      for (let i = 0; i < w * h; i++) out.data[i] = rank[i] < cut ? B[i] : A[i];
      return out;
    }
    case 'columns': {
      // Each column in turn first shows the inverse of b, then b itself, so
      // every disc in the column visibly flips: a wave travelling across.
      const span = w + 1;
      const pos = p * span;
      for (let x = 0; x < w; x++) {
        const local = pos - x;
        for (let y = 0; y < h; y++) {
          const i = y * w + x;
          out.data[i] = local < 0 ? A[i] : local < 1 ? 1 - B[i] : B[i];
        }
      }
      return out;
    }
  }
  return b;
}
