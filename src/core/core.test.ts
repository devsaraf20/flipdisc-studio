import { describe, expect, it } from 'vitest';
import { countDiff, countOn, createFrame, frameFromBase64, frameToBase64, packBits, scaleFrame, unpackBits } from './frame';
import { dither, adjustGray } from './dither';
import { applyTransition } from './transitions';
import { createGenerator, DEFAULT_GENERATOR } from './generators';
import { renderText, textBitmap } from './raster';
import { defaultProject, locate, makeScene, NO_LIVE, parseProject, serializeProject, TimelineRenderer } from './project';
import { FONTS } from './fonts';

describe('frame', () => {
  it('packs MSB first and round-trips', () => {
    const f = createFrame(10, 1);
    f.data.set([1, 0, 0, 0, 0, 0, 0, 1, 1, 0]);
    expect([...packBits(f)]).toEqual([0x81, 0x80]);
    expect([...unpackBits(packBits(f), 10, 1).data]).toEqual([...f.data]);
    expect([...frameFromBase64(frameToBase64(f), 10, 1).data]).toEqual([...f.data]);
  });
  it('counts differences', () => {
    const a = createFrame(4, 4);
    const b = createFrame(4, 4, 1);
    expect(countDiff(a, b)).toBe(16);
    expect(countDiff(a, a)).toBe(0);
  });
  it('scales with nearest neighbour', () => {
    const f = createFrame(2, 1);
    f.data.set([1, 0]);
    expect([...scaleFrame(f, 4, 1).data]).toEqual([1, 1, 0, 0]);
  });
});

describe('dither', () => {
  it('threshold splits at the threshold', () => {
    const g = new Float32Array([0.1, 0.49, 0.5, 0.9]);
    expect([...dither(g, 4, 1, 'threshold', 0.5).data]).toEqual([0, 0, 1, 1]);
  });
  it('Floyd–Steinberg keeps average brightness', () => {
    const w = 40;
    const h = 40;
    for (const level of [0.25, 0.5, 0.75]) {
      const g = new Float32Array(w * h).fill(level);
      const on = countOn(dither(g, w, h, 'floyd-steinberg'));
      expect(Math.abs(on / (w * h) - level)).toBeLessThan(0.03);
    }
  });
  it('threshold on mid-grey is all or nothing (why dithering exists)', () => {
    const g = new Float32Array(100).fill(0.45);
    expect(countOn(dither(g, 10, 10, 'threshold'))).toBe(0);
    expect(countOn(dither(g, 10, 10, 'ordered'))).toBeGreaterThan(30);
  });
  it('contrast pushes values away from mid-grey', () => {
    const out = adjustGray(new Float32Array([0.4, 0.6]), 0, 0.5);
    expect(out[0]).toBeLessThan(0.4);
    expect(out[1]).toBeGreaterThan(0.6);
  });
});

describe('transitions', () => {
  const a = createFrame(8, 4);
  const b = createFrame(8, 4, 1);
  for (const kind of ['wipe-left', 'wipe-right', 'wipe-up', 'wipe-down', 'dissolve', 'columns', 'cut'] as const) {
    it(`${kind} starts at A and ends at B`, () => {
      expect(countDiff(applyTransition(kind, a, b, 0), a)).toBe(0);
      expect(countDiff(applyTransition(kind, a, b, 1), b)).toBe(0);
    });
  }
  it('dissolve is roughly proportional', () => {
    const big = createFrame(40, 40, 1);
    const half = applyTransition('dissolve', createFrame(40, 40), big, 0.5);
    expect(countOn(half)).toBe(800);
  });
});

describe('text', () => {
  it('every font renders printable ASCII', () => {
    for (const f of FONTS)
      for (let c = 32; c < 127; c++) expect(f.glyph(String.fromCharCode(c)).length).toBeGreaterThan(0);
  });
  it('centres static text', () => {
    const bmp = textBitmap({ text: 'HI', font: 'classic', scale: 1, align: 'center' });
    expect(bmp.height).toBe(7);
    const f = renderText({ text: 'HI', font: 'classic', scale: 1, align: 'center', valign: 'middle', scroll: 'none', speed: 0, invert: false, offsetX: 0, offsetY: 0 }, 28, 14, 0);
    expect(countOn(f)).toBe(countOn(bmp));
  });
  it('marquee starts off-screen', () => {
    const f = renderText({ text: 'HI', font: 'classic', scale: 1, align: 'center', valign: 'middle', scroll: 'left', speed: 10, invert: false, offsetX: 0, offsetY: 0 }, 28, 14, 0);
    expect(countOn(f)).toBe(0);
  });
});

describe('generators', () => {
  it('are deterministic for time-based kinds', () => {
    for (const kind of ['noise', 'waves', 'ripple'] as const) {
      const g1 = createGenerator({ ...DEFAULT_GENERATOR, kind }, 28, 14);
      const g2 = createGenerator({ ...DEFAULT_GENERATOR, kind }, 28, 14);
      expect(countDiff(g1.render(1234), g2.render(1234))).toBe(0);
    }
  });
  it('life can rewind', () => {
    const g = createGenerator({ ...DEFAULT_GENERATOR, kind: 'life' }, 20, 10);
    const first = { ...g.render(2000) };
    const copy = new Uint8Array(first.data);
    g.render(5000);
    expect([...g.render(2000).data]).toEqual([...copy]);
  });
});

describe('project', () => {
  it('serialises and parses back', () => {
    const p = defaultProject();
    const bmp = makeScene('bitmap', 28, 14);
    if (bmp.source.type === 'bitmap') bmp.source.frame.data[5] = 1;
    p.scenes.push(bmp);
    const back = parseProject(serializeProject(p));
    expect(back.scenes.length).toBe(p.scenes.length);
    const s = back.scenes.at(-1)!;
    expect(s.source.type).toBe('bitmap');
    if (s.source.type === 'bitmap') expect(s.source.frame.data[5]).toBe(1);
  });
  it('rejects foreign JSON', () => {
    expect(() => parseProject('{"hello":1}')).toThrow();
  });
  it('locates the playhead and loops', () => {
    const p = defaultProject();
    const total = p.scenes.reduce((a, s) => a + s.duration, 0);
    expect(locate(p, 0).index).toBe(0);
    expect(locate(p, p.scenes[0].duration + 1).index).toBe(1);
    expect(locate(p, total + 1).index).toBe(0);
  });
  it('timeline renders frames of the display size', () => {
    const p = defaultProject();
    const tr = new TimelineRenderer(p, NO_LIVE);
    const r = tr.frameAt(4100);
    expect(r.frame.width).toBe(28);
    expect(r.frame.height).toBe(14);
    expect(r.transitioning).toBe(true);
  });
});
