// Print frames that the studio sends through the bridge, as ASCII art.
// Run the bridge, then: node examples/node/listen.mjs
// Shows how any program can consume the WebSocket output.
import WebSocket from 'ws';

const ws = new WebSocket(process.argv[2] ?? 'ws://localhost:8765');
ws.on('open', () => console.log('connected; waiting for frames from the studio…'));
ws.on('message', (raw) => {
  const msg = JSON.parse(raw.toString());
  if (msg.type !== 'frame') return;
  const bytes = Buffer.from(msg.bits, 'base64');
  let out = '';
  for (let y = 0; y < msg.height; y++) {
    for (let x = 0; x < msg.width; x++) {
      const i = y * msg.width + x;
      out += (bytes[i >> 3] >> (7 - (i & 7))) & 1 ? '●' : '·';
    }
    out += '\n';
  }
  console.clear();
  console.log(out);
});
ws.on('error', (e) => console.error('Is the bridge running? (npm run bridge)', e.message));
