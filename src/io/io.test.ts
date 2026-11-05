import { describe, expect, it } from 'vitest';
import { createFrame } from '../core/frame';
import { ALFAZETA, RAW_BITS, defaultOptions, transmitSeconds } from './protocols';
import { dedupeFrames, encodeFrameBytes, exportCArray } from './cexport';

describe('AlfaZeta-style protocol', () => {
  it('encodes one 28x7 module as 32 bytes', () => {
    const f = createFrame(28, 7);
    f.data[0] = 1; // top-left
    f.data[6 * 28 + 27] = 1; // bottom-right
    const b = ALFAZETA.encode(f, defaultOptions(ALFAZETA));
    expect(b.length).toBe(32);
    expect(b[0]).toBe(0x80);
    expect(b[1]).toBe(0x83);
    expect(b[2]).toBe(0x00);
    expect(b[3]).toBe(0x01); // column 0, bit 0 = top row
    expect(b[3 + 27]).toBe(0x40); // column 27, bit 6 = bottom row
    expect(b[31]).toBe(0x8f);
  });
  it('splits 28x14 into two addressed modules', () => {
    const b = ALFAZETA.encode(createFrame(28, 14), { ...defaultOptions(ALFAZETA), startAddress: 3 });
    expect(b.length).toBe(64);
    expect(b[2]).toBe(3);
    expect(b[32 + 2]).toBe(4);
  });
  it('buffered mode stores then refreshes', () => {
    const b = ALFAZETA.encode(createFrame(28, 7), { ...defaultOptions(ALFAZETA), mode: 'buffered' });
    expect(b[1]).toBe(0x84);
    expect([...b.slice(-3)]).toEqual([0x80, 0x82, 0x8f]);
  });
  it('never puts framing bytes in data', () => {
    const b = ALFAZETA.encode(createFrame(28, 7, 1), defaultOptions(ALFAZETA));
    for (const x of b.slice(3, 31)) expect(x).toBeLessThan(0x80);
  });
});

describe('raw protocol', () => {
  it('has header, payload and xor checksum', () => {
    const f = createFrame(8, 2);
    f.data[0] = 1;
    f.data[15] = 1;
    const b = RAW_BITS.encode(f, {});
    expect([...b]).toEqual([0x46, 0x44, 8, 2, 0x80, 0x01, 0x81]);
  });
  it('estimates transmit time with 8N1 framing', () => {
    expect(transmitSeconds(960, 9600)).toBeCloseTo(1);
  });
});

describe('C export', () => {
  it('encodes rows MSB-left and columns bit0-top', () => {
    const f = createFrame(9, 2);
    f.data[0] = 1;
    f.data[8] = 1;
    expect([...encodeFrameBytes(f, 'rows')]).toEqual([0x80, 0x80, 0, 0]);
    const c = encodeFrameBytes(f, 'columns');
    expect(c.length).toBe(9);
    expect(c[0]).toBe(1);
    expect(c[8]).toBe(1);
  });
  it('produces a header with defines and arrays', () => {
    const text = exportCArray([createFrame(28, 14), createFrame(28, 14, 1)], { name: 'my anim', layout: 'rows', progmem: true, fps: 10 });
    expect(text).toContain('#define MY_ANIM_WIDTH 28');
    expect(text).toContain('const uint8_t my_anim[MY_ANIM_COUNT][MY_ANIM_FRAME_BYTES] PROGMEM');
    expect(text).toContain('my_anim_ms[MY_ANIM_COUNT] PROGMEM = { 100, 100 }');
    expect(text.match(/0xff/g)!.length).toBe(3 * 14); // 28 discs = 3 full bytes + 0xf0
  });
  it('merges repeated frames', () => {
    const a = createFrame(4, 4);
    const b = createFrame(4, 4, 1);
    const r = dedupeFrames([a, a, b, b, b, a], 100);
    expect(r.frames.length).toBe(3);
    expect(r.durations).toEqual([200, 300, 100]);
  });
});
