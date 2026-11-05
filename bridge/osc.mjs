// Minimal OSC 1.0 encoder/decoder. No dependencies.
// Supports the argument types you meet in practice: i f s b T F N d h.

const pad4 = (n) => (n + 3) & ~3;

function writeString(s) {
  const raw = Buffer.from(s, 'utf8');
  const out = Buffer.alloc(pad4(raw.length + 1));
  raw.copy(out);
  return out;
}

function readString(buf, off) {
  let end = off;
  while (end < buf.length && buf[end] !== 0) end++;
  if (end >= buf.length) throw new Error('OSC string not terminated');
  return { value: buf.toString('utf8', off, end), next: pad4(end + 1) };
}

/**
 * Encode one OSC message.
 * args: numbers become int32 if integral else float32; strings → s; Buffer/Uint8Array → b;
 * booleans → T/F; or pass { type, value } explicitly.
 */
export function encodeMessage(address, args = []) {
  let tags = ',';
  const parts = [];
  for (const a of args) {
    const { type, value } = normalise(a);
    tags += type;
    switch (type) {
      case 'i': {
        const b = Buffer.alloc(4);
        b.writeInt32BE(value | 0);
        parts.push(b);
        break;
      }
      case 'f': {
        const b = Buffer.alloc(4);
        b.writeFloatBE(value);
        parts.push(b);
        break;
      }
      case 'd': {
        const b = Buffer.alloc(8);
        b.writeDoubleBE(value);
        parts.push(b);
        break;
      }
      case 's':
        parts.push(writeString(String(value)));
        break;
      case 'b': {
        const data = Buffer.from(value);
        const b = Buffer.alloc(4 + pad4(data.length));
        b.writeInt32BE(data.length);
        data.copy(b, 4);
        parts.push(b);
        break;
      }
      case 'T':
      case 'F':
      case 'N':
        break;
      default:
        throw new Error(`Unsupported OSC type ${type}`);
    }
  }
  return Buffer.concat([writeString(address), writeString(tags), ...parts]);
}

function normalise(a) {
  if (a && typeof a === 'object' && 'type' in a) return a;
  if (typeof a === 'number') return { type: Number.isInteger(a) ? 'i' : 'f', value: a };
  if (typeof a === 'string') return { type: 's', value: a };
  if (typeof a === 'boolean') return { type: a ? 'T' : 'F', value: a };
  if (a === null || a === undefined) return { type: 'N', value: null };
  if (a instanceof Uint8Array) return { type: 'b', value: a };
  throw new Error(`Cannot encode OSC argument ${a}`);
}

export function encodeBundle(messages, timetag = 1n) {
  const head = writeString('#bundle');
  const tt = Buffer.alloc(8);
  tt.writeBigUInt64BE(BigInt(timetag));
  const parts = [head, tt];
  for (const m of messages) {
    const len = Buffer.alloc(4);
    len.writeInt32BE(m.length);
    parts.push(len, m);
  }
  return Buffer.concat(parts);
}

/** Decode a packet into a flat list of { address, args: [{type, value}] } (bundles are unpacked). */
export function decodePacket(buf, out = []) {
  if (buf.length >= 8 && buf.toString('ascii', 0, 7) === '#bundle') {
    let off = 16;
    while (off + 4 <= buf.length) {
      const len = buf.readInt32BE(off);
      off += 4;
      if (len <= 0 || off + len > buf.length) break;
      decodePacket(buf.subarray(off, off + len), out);
      off += len;
    }
    return out;
  }
  const addr = readString(buf, 0);
  if (!addr.value.startsWith('/')) throw new Error('Not an OSC message');
  let off = addr.next;
  let tags = ',';
  if (off < buf.length) {
    const t = readString(buf, off);
    tags = t.value;
    off = t.next;
  }
  const args = [];
  for (const type of tags.slice(1)) {
    switch (type) {
      case 'i':
        args.push({ type, value: buf.readInt32BE(off) });
        off += 4;
        break;
      case 'f':
        args.push({ type, value: buf.readFloatBE(off) });
        off += 4;
        break;
      case 'd':
        args.push({ type, value: buf.readDoubleBE(off) });
        off += 8;
        break;
      case 'h':
        args.push({ type, value: Number(buf.readBigInt64BE(off)) });
        off += 8;
        break;
      case 's':
      case 'S': {
        const s = readString(buf, off);
        args.push({ type: 's', value: s.value });
        off = s.next;
        break;
      }
      case 'b': {
        const len = buf.readInt32BE(off);
        off += 4;
        args.push({ type, value: Buffer.from(buf.subarray(off, off + len)) });
        off += pad4(len);
        break;
      }
      case 'T':
        args.push({ type, value: true });
        break;
      case 'F':
        args.push({ type, value: false });
        break;
      case 'N':
      case 'I':
        args.push({ type, value: null });
        break;
      default:
        throw new Error(`Unsupported OSC type tag "${type}"`);
    }
  }
  out.push({ address: addr.value, args });
  return out;
}
