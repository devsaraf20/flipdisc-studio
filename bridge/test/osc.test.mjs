import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decodePacket, encodeBundle, encodeMessage } from '../osc.mjs';
import { FrameAssembler, frameToOsc, packBits, unpackBits } from '../frames.mjs';

test('OSC message round trip with mixed types', () => {
  const buf = encodeMessage('/test/addr', [1, 2.5, 'hi', Buffer.from([1, 2, 3]), true]);
  assert.equal(buf.length % 4, 0);
  const [m] = decodePacket(buf);
  assert.equal(m.address, '/test/addr');
  assert.deepEqual(
    m.args.map((a) => a.type),
    ['i', 'f', 's', 'b', 'T'],
  );
  assert.equal(m.args[0].value, 1);
  assert.equal(m.args[1].value, 2.5);
  assert.equal(m.args[2].value, 'hi');
  assert.deepEqual([...m.args[3].value], [1, 2, 3]);
});

test('known OSC byte layout', () => {
  // "/a\0\0" ",i\0\0" 00 00 00 07
  const buf = encodeMessage('/a', [7]);
  assert.deepEqual([...buf], [0x2f, 0x61, 0, 0, 0x2c, 0x69, 0, 0, 0, 0, 0, 7]);
});

test('bundles are flattened', () => {
  const b = encodeBundle([encodeMessage('/x', [1]), encodeMessage('/y', [2])]);
  const msgs = decodePacket(b);
  assert.deepEqual(
    msgs.map((m) => m.address),
    ['/x', '/y'],
  );
});

test('pack/unpack bits', () => {
  const data = new Uint8Array([1, 0, 1, 1, 0, 0, 0, 0, 1, 1]);
  const packed = packBits(data);
  assert.deepEqual([...packed], [0b10110000, 0b11000000]);
  assert.deepEqual([...unpackBits(packed, 10, 1)], [...data]);
});

test('assembler accepts blob, string and numeric frames', () => {
  const got = [];
  const a = new FrameAssembler(4, 2, (f) => got.push(f));
  const data = new Uint8Array([1, 0, 0, 1, 0, 1, 1, 0]);
  for (const buf of frameToOsc({ width: 4, height: 2, data }, ['blob', 'bits', 'pixels'])) for (const m of decodePacket(buf)) a.handle(m);
  assert.equal(got.length, 3);
  for (const f of got) assert.deepEqual([...f.data], [...data]);
});

test('assembler builds frames from rows and commits on last row', () => {
  const got = [];
  const a = new FrameAssembler(3, 2, (f) => got.push(f));
  a.handle({ address: '/flipdisc/row/0', args: [1, 0, 1].map((value) => ({ type: 'f', value })) });
  assert.equal(got.length, 0);
  a.handle({ address: '/flipdisc/row', args: [1, 0.2, 0.9, 0.6].map((value, i) => ({ type: i ? 'f' : 'i', value })) });
  assert.equal(got.length, 1);
  assert.deepEqual([...got[0].data], [1, 0, 1, 0, 1, 1]);
});

test('rows format round-trips through the assembler', () => {
  const got = [];
  const a = new FrameAssembler(5, 3, (f) => got.push(f));
  const data = new Uint8Array(15).map((_, i) => (i * 7) % 3 === 0 ? 1 : 0);
  for (const buf of frameToOsc({ width: 5, height: 3, data }, ['rows'])) for (const m of decodePacket(buf)) a.handle(m);
  // the last row emits; the trailing /flipdisc/commit has nothing new to emit
  assert.equal(got.length, 1);
  assert.deepEqual([...got.at(-1).data], [...data]);
});

test('size message changes the row grid', () => {
  const a = new FrameAssembler(28, 14);
  a.handle({ address: '/flipdisc/size', args: [{ type: 'i', value: 7 }, { type: 'i', value: 7 }] });
  assert.equal(a.width, 7);
  assert.equal(a.height, 7);
});
