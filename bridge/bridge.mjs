#!/usr/bin/env node
// Flip-Disc Studio bridge
// ------------------------
// Runs on your computer. Connects the web app (WebSocket) with OSC tools on
// your network (TouchDesigner, Unreal, Max/MSP, Processing, a microcontroller…).
//
//   Studio  ──WebSocket──▶  bridge  ──OSC/UDP──▶  your app      (output)
//   Studio  ◀──WebSocket──  bridge  ◀──OSC/UDP──  your app      (input)
//
// Usage:  npm run bridge -- [options]      (or: node bridge/bridge.mjs [options])
//   --ws <port>            WebSocket port for the browser          (default 8765)
//   --host <addr>          WebSocket listen address                (default 127.0.0.1)
//   --osc-in <port>        UDP port to receive OSC frames on       (default 9000, 0 = off)
//   --osc-out <host:port>  where to send displayed frames as OSC   (default 127.0.0.1:9001, "off" = off)
//                          repeat the flag to send to several targets
//   --osc-format <list>    rows,blob,bits,pixels (comma separated) (default rows)
//   --width/--height       grid size assumed for /flipdisc/row messages (default 28 x 14)
//   --quiet                less logging
import dgram from 'node:dgram';
import { WebSocketServer } from 'ws';
import { decodePacket } from './osc.mjs';
import { FrameAssembler, frameToOsc, packBits, unpackBits } from './frames.mjs';

const VERSION = '1.0.0';

function parseArgs(argv) {
  const o = { ws: 8765, host: '127.0.0.1', oscIn: 9000, oscOut: [], formats: ['rows'], width: 28, height: 14, quiet: false };
  let outSet = false;
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    const v = () => {
      const val = argv[++i];
      if (val === undefined) throw new Error(`Missing value for ${k}`);
      return val;
    };
    if (k === '--ws') o.ws = Number(v());
    else if (k === '--host') o.host = v();
    else if (k === '--osc-in') o.oscIn = Number(v());
    else if (k === '--osc-out') {
      const val = v();
      if (!outSet) o.oscOut = [];
      outSet = true;
      if (val !== 'off') o.oscOut.push(val);
    } else if (k === '--osc-format') o.formats = v().split(',').map((s) => s.trim()).filter(Boolean);
    else if (k === '--width') o.width = Number(v());
    else if (k === '--height') o.height = Number(v());
    else if (k === '--quiet') o.quiet = true;
    else if (k === '--help' || k === '-h') {
      console.log(
        'Usage: node bridge/bridge.mjs [--ws 8765] [--host 127.0.0.1] [--osc-in 9000] [--osc-out 127.0.0.1:9001] [--osc-format rows,blob,bits,pixels] [--width 28 --height 14] [--quiet]',
      );
      process.exit(0);
    } else throw new Error(`Unknown option ${k} (try --help)`);
  }
  if (!outSet) o.oscOut = ['127.0.0.1:9001'];
  const bad = o.formats.filter((f) => !['rows', 'blob', 'bits', 'pixels'].includes(f));
  if (bad.length) throw new Error(`Unknown --osc-format ${bad.join(', ')}`);
  o.targets = o.oscOut.map((t) => {
    const m = /^(.*):(\d+)$/.exec(t);
    if (!m) throw new Error(`--osc-out must look like host:port, got "${t}"`);
    return { host: m[1] || '127.0.0.1', port: Number(m[2]) };
  });
  return o;
}

let opts;
try {
  opts = parseArgs(process.argv.slice(2));
} catch (e) {
  console.error(`✖ ${e.message}`);
  process.exit(1);
}

const log = (...a) => !opts.quiet && console.log(...a);
const counters = { wsIn: 0, oscOut: 0, oscIn: 0, framesIn: 0 };

// ---------- OSC out ----------
const udpOut = dgram.createSocket('udp4');
udpOut.on('error', (e) => console.error('OSC out error:', e.message));

function sendOsc(frame) {
  if (!opts.targets.length) return;
  const msgs = frameToOsc(frame, opts.formats);
  for (const t of opts.targets) for (const m of msgs) udpOut.send(m, t.port, t.host);
  counters.oscOut++;
}

for (const t of opts.targets) {
  if (opts.oscIn && t.port === opts.oscIn && /^(127\.|localhost|0\.0\.0\.0)/.test(t.host))
    console.warn(`⚠ OSC out (${t.host}:${t.port}) points at our own OSC in port: frames would loop.`);
}

// ---------- WebSocket ----------
const wss = new WebSocketServer({ port: opts.ws, host: opts.host });
const studios = new Set();

function status() {
  return JSON.stringify({
    type: 'status',
    version: VERSION,
    oscIn: opts.oscIn || null,
    oscOut: opts.targets.map((t) => `${t.host}:${t.port}`).join(', ') || 'off',
    oscFormat: opts.formats.join(','),
    clients: wss.clients.size,
  });
}

function broadcast(text, except) {
  for (const c of wss.clients) if (c !== except && c.readyState === 1 && c.bufferedAmount < 256 * 1024) c.send(text);
}

wss.on('connection', (ws, req) => {
  log(`● client connected from ${req.socket.remoteAddress} (${wss.clients.size} total)`);
  ws.send(status());
  ws.on('message', (raw, isBinary) => {
    if (isBinary) return;
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }
    if (msg.type === 'hello' && msg.role === 'studio') {
      studios.add(ws);
      broadcast(status());
      return;
    }
    if (msg.type === 'frame' && typeof msg.bits === 'string') {
      const width = msg.width | 0;
      const height = msg.height | 0;
      if (width <= 0 || height <= 0 || width * height > 512 * 512) return;
      counters.wsIn++;
      const data = unpackBits(Buffer.from(msg.bits, 'base64'), width, height);
      sendOsc({ width, height, data });
      // Studio output also goes to other WebSocket listeners (your own sketches),
      // but not back into studios, which would treat it as input.
      if (studios.has(ws)) for (const c of wss.clients) if (!studios.has(c) && c.readyState === 1) c.send(raw.toString());
    }
  });
  ws.on('close', () => {
    studios.delete(ws);
    log(`○ client left (${wss.clients.size} total)`);
  });
});

wss.on('error', (e) => {
  console.error(`✖ WebSocket server: ${e.message}`);
  if (e.code === 'EADDRINUSE') console.error(`  Port ${opts.ws} is busy. Is another bridge running? Try --ws 8766.`);
  process.exit(1);
});

// ---------- OSC in ----------
const assembler = new FrameAssembler(opts.width, opts.height, (frame) => {
  counters.framesIn++;
  const text = JSON.stringify({
    type: 'frame',
    source: 'osc',
    width: frame.width,
    height: frame.height,
    bits: packBits(frame.data).toString('base64'),
  });
  broadcast(text);
});

if (opts.oscIn) {
  const udpIn = dgram.createSocket({ type: 'udp4', reuseAddr: true });
  const unknown = new Set();
  udpIn.on('message', (buf) => {
    counters.oscIn++;
    let msgs;
    try {
      msgs = decodePacket(buf);
    } catch (e) {
      if (!opts.quiet) console.warn(`OSC decode error: ${e.message}`);
      return;
    }
    for (const m of msgs) {
      if (!assembler.handle(m) && !unknown.has(m.address)) {
        unknown.add(m.address);
        log(`? ignoring OSC address ${m.address} (see README for supported messages)`);
      }
    }
  });
  udpIn.on('error', (e) => {
    console.error(`✖ OSC in: ${e.message}`);
    if (e.code === 'EADDRINUSE') console.error(`  UDP port ${opts.oscIn} is busy. Try --osc-in 9002.`);
  });
  udpIn.bind(opts.oscIn, '0.0.0.0');
}

console.log(`Flip-Disc Studio bridge ${VERSION}`);
console.log(`  WebSocket   ws://${opts.host === '0.0.0.0' ? 'localhost' : opts.host}:${opts.ws}   ← open the studio and press Connect`);
console.log(`  OSC in      udp :${opts.oscIn || 'off'}             ← TouchDesigner / Unreal send here`);
console.log(`  OSC out     ${opts.targets.map((t) => `${t.host}:${t.port}`).join(', ') || 'off'}  (${opts.formats.join(',')})`);

setInterval(() => {
  if (opts.quiet) return;
  if (counters.wsIn || counters.oscIn)
    log(`… last 5s: ${counters.wsIn} frames from studio → OSC, ${counters.oscIn} OSC packets in → ${counters.framesIn} frames to studio`);
  counters.wsIn = counters.oscIn = counters.framesIn = counters.oscOut = 0;
  broadcast(status());
}, 5000).unref?.();

const shutdown = () => {
  console.log('\nBye.');
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
