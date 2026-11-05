import type { Frame } from '../core/frame';
import { packBits } from '../core/frame';

/**
 * Pluggable hardware protocol layer.
 * A protocol turns one Frame into the exact bytes to write to the serial port.
 * To add your own controller, implement DisplayProtocol and add it to PROTOCOLS.
 */
export type OptionValue = number | string | boolean;

export interface ProtocolOption {
  key: string;
  label: string;
  type: 'number' | 'select' | 'boolean' | 'hex';
  default: OptionValue;
  choices?: { value: string; label: string }[];
  min?: number;
  max?: number;
  help?: string;
}

export interface DisplayProtocol {
  id: string;
  name: string;
  description: string;
  /** false = written from public notes, not verified on real hardware */
  verified: boolean;
  warning?: string;
  defaultBaud: number;
  baudRates: number[];
  options: ProtocolOption[];
  encode(frame: Frame, opts: Record<string, OptionValue>): Uint8Array;
}

export function defaultOptions(p: DisplayProtocol): Record<string, OptionValue> {
  return Object.fromEntries(p.options.map((o) => [o.key, o.default]));
}

const num = (v: OptionValue | undefined, d: number) => {
  if (typeof v === 'number') return v;
  if (typeof v === 'string') {
    const n = v.trim().toLowerCase().startsWith('0x') ? parseInt(v, 16) : Number(v);
    return Number.isFinite(n) ? n : d;
  }
  return d;
};

// ---------------------------------------------------------------------------
// AlfaZeta-style RS485 (XY5 / "flipdots" modules)
// ---------------------------------------------------------------------------
//
// ⚠️  NEEDS VERIFICATION AGAINST YOUR PANEL'S DATASHEET.
// This follows the packet layout commonly described by hobbyists for
// AlfaZeta-style 28×7 modules. Command bytes, baud rate, addressing and bit
// order vary between controller revisions and DIP-switch settings. Every value
// is therefore an option you can change in the UI.
//
// Packet:  0x80 | command | address | data[N] | 0x8F
//   0x80        start of frame
//   command     0x83 = N=28 data bytes, show immediately
//               0x84 = N=28 data bytes, store only (wait for refresh)
//               0x82 = refresh: show stored data (no address/data, see below)
//   address     module address set by DIP switches; 0xFF = broadcast
//   data        one byte per column, left → right; bit 0 = top row,
//               bit 6 = bottom row; bit 7 must be 0 (bytes ≥ 0x80 are framing)
//   0x8F        end of frame
//
// A 28×14 panel is usually two 28×7 modules with two addresses.

function alfazetaEncode(frame: Frame, o: Record<string, OptionValue>): Uint8Array {
  const modW = Math.max(1, num(o.moduleWidth, 28));
  const modH = 7;
  const startAddr = num(o.startAddress, 0);
  const cmdShow = num(o.cmdShow, 0x83);
  const cmdStore = num(o.cmdStore, 0x84);
  const cmdRefresh = num(o.cmdRefresh, 0x82);
  const buffered = o.mode === 'buffered';
  const order = (o.order as string) ?? 'rows';
  const flipBits = o.bitOrder === 'msb-top';
  const invert = !!o.invert;
  const modsX = Math.ceil(frame.width / modW);
  const modsY = Math.ceil(frame.height / modH);
  const out: number[] = [];
  for (let my = 0; my < modsY; my++)
    for (let mx = 0; mx < modsX; mx++) {
      const idx = order === 'columns' ? mx * modsY + my : my * modsX + mx;
      const addr = (startAddr + idx) & 0xff;
      out.push(0x80, buffered ? cmdStore : cmdShow, addr);
      for (let cx = 0; cx < modW; cx++) {
        let b = 0;
        for (let ry = 0; ry < modH; ry++) {
          const x = mx * modW + cx;
          const y = my * modH + ry;
          let v = x < frame.width && y < frame.height ? frame.data[y * frame.width + x] : 0;
          if (invert) v ^= 1;
          if (v) b |= 1 << (flipBits ? 6 - ry : ry);
        }
        out.push(b & 0x7f);
      }
      out.push(0x8f);
    }
  if (buffered) out.push(0x80, cmdRefresh, 0x8f);
  return new Uint8Array(out);
}

export const ALFAZETA: DisplayProtocol = {
  id: 'alfazeta',
  name: 'AlfaZeta-style RS485 (unverified)',
  description:
    'Packets of 0x80, command, address, one byte per column (7 rows), 0x8F. One packet per 28×7 module. Send through a USB-to-RS485 adapter.',
  verified: false,
  warning:
    'Example driver written from public hobbyist notes. Check command bytes, addresses, baud rate and bit order against your panel’s datasheet before relying on it. Start with one module and the broadcast address.',
  defaultBaud: 57600,
  baudRates: [9600, 19200, 38400, 57600, 115200],
  options: [
    { key: 'moduleWidth', label: 'Module width (columns)', type: 'number', default: 28, min: 1, max: 112 },
    { key: 'startAddress', label: 'First module address', type: 'number', default: 0, min: 0, max: 255, help: 'Set by DIP switches. 255 = broadcast to all.' },
    {
      key: 'order',
      label: 'Address order',
      type: 'select',
      default: 'rows',
      choices: [
        { value: 'rows', label: 'Row by row (left→right, then down)' },
        { value: 'columns', label: 'Column by column (top→bottom, then right)' },
      ],
    },
    {
      key: 'mode',
      label: 'Update mode',
      type: 'select',
      default: 'immediate',
      choices: [
        { value: 'immediate', label: 'Show each module immediately' },
        { value: 'buffered', label: 'Store all, then one refresh (in sync)' },
      ],
    },
    { key: 'cmdShow', label: 'Command: data + show', type: 'hex', default: '0x83' },
    { key: 'cmdStore', label: 'Command: data, no show', type: 'hex', default: '0x84' },
    { key: 'cmdRefresh', label: 'Command: refresh all', type: 'hex', default: '0x82' },
    {
      key: 'bitOrder',
      label: 'Bit order',
      type: 'select',
      default: 'lsb-top',
      choices: [
        { value: 'lsb-top', label: 'Bit 0 = top row' },
        { value: 'msb-top', label: 'Bit 6 = top row' },
      ],
    },
    { key: 'invert', label: 'Invert', type: 'boolean', default: false },
  ],
  encode: alfazetaEncode,
};

// ---------------------------------------------------------------------------
// Raw packed bits: for your own Arduino / ESP32 firmware
// ---------------------------------------------------------------------------
// 'F' 'D' width height payload[ceil(w*h/8)] checksum
// payload = row-major bits, MSB first. checksum = XOR of payload bytes.
// See examples/arduino/serial_receiver/serial_receiver.ino

export const RAW_BITS: DisplayProtocol = {
  id: 'raw',
  name: 'Raw packed bits (custom firmware)',
  description: "'F','D', width, height, packed bits (row-major, MSB first), XOR checksum. Pairs with the Arduino receiver example.",
  verified: true,
  defaultBaud: 115200,
  baudRates: [9600, 57600, 115200, 230400, 460800, 921600],
  options: [],
  encode(frame) {
    const payload = packBits(frame);
    const out = new Uint8Array(payload.length + 5);
    out[0] = 0x46;
    out[1] = 0x44;
    out[2] = frame.width & 0xff;
    out[3] = frame.height & 0xff;
    out.set(payload, 4);
    let x = 0;
    for (const b of payload) x ^= b;
    out[out.length - 1] = x;
    return out;
  },
};

export const PROTOCOLS: DisplayProtocol[] = [ALFAZETA, RAW_BITS];

export function getProtocol(id: string): DisplayProtocol {
  return PROTOCOLS.find((p) => p.id === id) ?? ALFAZETA;
}

/** Seconds needed to send `bytes` at `baud` with 8N1 framing (10 bits per byte). */
export function transmitSeconds(bytes: number, baud: number): number {
  return (bytes * 10) / baud;
}
