// Send an animated test pattern to the bridge over OSC, like TouchDesigner would.
// Run the bridge, open the studio, Input tab → "Show OSC input on the display", then:
//   node examples/node/send-test-pattern.mjs [width] [height] [port]
import dgram from 'node:dgram';
import { encodeMessage } from '../../bridge/osc.mjs';

const W = Number(process.argv[2] ?? 28);
const H = Number(process.argv[3] ?? 14);
const PORT = Number(process.argv[4] ?? 9000);
const sock = dgram.createSocket('udp4');
let t = 0;
setInterval(() => {
  let bits = '';
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) bits += Math.sin(x * 0.45 + t) * Math.cos(y * 0.6 - t * 0.7) > 0.1 ? '1' : '0';
  sock.send(encodeMessage('/flipdisc/frame', [W, H, bits]), PORT, '127.0.0.1');
  t += 0.15;
}, 1000 / 15);
console.log(`sending ${W}x${H} frames to udp://127.0.0.1:${PORT} at 15 fps (Ctrl+C to stop)`);
