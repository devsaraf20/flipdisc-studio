import { useMemo, useState, useSyncExternalStore } from 'react';
import { displaySize } from '../core/display';
import { NO_LIVE, TimelineRenderer, totalDuration } from '../core/project';
import type { Frame } from '../core/frame';
import { bridge } from '../io/bridge';
import { serial, serialSupported } from '../io/serial';
import { PROTOCOLS, defaultOptions, getProtocol, transmitSeconds, type OptionValue } from '../io/protocols';
import { dedupeFrames, exportCArray, sanitizeIdent, type CLayout } from '../io/cexport';
import { app, stats, toast, useStore } from './store';
import { Field, Section, Segmented, Select, Slider, Toggle, download } from './controls';
import { getEngine } from './engine';

export function OutputPanel() {
  return (
    <>
      <BridgeSection mode="output" />
      <SerialSection />
      <CExportSection />
    </>
  );
}

export function BridgeSection({ mode }: { mode: 'output' | 'input' }) {
  const status = useSyncExternalStore(bridge.subscribe, () => bridge.status);
  const info = useSyncExternalStore(bridge.subscribe, () => bridge.info);
  const sent = useSyncExternalStore(bridge.subscribe, () => bridge.sent);
  const received = useSyncExternalStore(bridge.subscribe, () => bridge.received);
  const err = useSyncExternalStore(bridge.subscribe, () => bridge.error);
  const out = useStore(app, (s) => s.output);
  const [url, setUrl] = useState(bridge.url);
  const connected = status === 'connected';
  return (
    <Section
      title={mode === 'output' ? 'OSC & WebSocket output' : 'Bridge connection'}
      aside={<span className={`badge ${status}`}>{status}</span>}
    >
      <p className="hint">
        The bridge is a small Node script that runs on your computer: <code>npm run bridge</code>. It relays frames between
        this page (WebSocket) and OSC apps on your network.
      </p>
      <div className="row">
        <input className="grow" value={url} onChange={(e) => setUrl(e.target.value)} aria-label="Bridge WebSocket URL" spellCheck={false} />
        {connected || status === 'connecting' ? (
          <button className="btn" onClick={() => bridge.disconnect()}>
            Disconnect
          </button>
        ) : (
          <button className="btn primary" onClick={() => bridge.connect(url)}>
            Connect
          </button>
        )}
      </div>
      {status === 'error' && <p className="error">{err || 'Bridge not reachable; retrying…'}</p>}
      {mode === 'output' && (
        <Toggle
          label="Send every displayed frame to the bridge"
          checked={out.bridge}
          onChange={(v) => app.set({ output: { ...out, bridge: v } })}
          hint="The bridge forwards it as OSC (/flipdisc/frame and /flipdisc/row/N) and to other WebSocket clients."
        />
      )}
      {connected && (
        <dl className="kv">
          <dt>OSC out</dt>
          <dd>{info.oscOut ?? '–'} ({info.oscFormat ?? 'rows'})</dd>
          <dt>OSC in</dt>
          <dd>udp port {info.oscIn ?? '–'}</dd>
          <dt>Frames sent</dt>
          <dd>{sent}</dd>
          <dt>Frames received</dt>
          <dd>{received}</dd>
        </dl>
      )}
    </Section>
  );
}

function SerialSection() {
  const connected = useSyncExternalStore(serial.subscribe, () => serial.connected);
  const err = useSyncExternalStore(serial.subscribe, () => serial.error);
  const framesSent = useSyncExternalStore(serial.subscribe, () => serial.framesSent);
  const label = useSyncExternalStore(serial.subscribe, () => serial.portLabel);
  const out = useStore(app, (s) => s.output);
  const display = useStore(app, (s) => s.project.display);
  const maxFps = useStore(app, (s) => s.project.sim.maxFps);
  useStore(stats, (s) => s.frames); // refresh packet preview with the display
  const proto = getProtocol(out.serialProtocol);
  const setOpt = (k: string, v: OptionValue) => app.set({ output: { ...out, serialOptions: { ...out.serialOptions, [k]: v } } });
  const current = getEngine()?.sim.current();
  const packet = useMemo(() => {
    if (!current) return null;
    try {
      return proto.encode(current, out.serialOptions);
    } catch {
      return null;
    }
  }, [current, proto, out.serialOptions]);
  const { width, height } = displaySize(display);
  const bytes = packet?.length ?? 0;
  const secs = transmitSeconds(bytes, out.baud);
  const supported = serialSupported();
  return (
    <Section title="Hardware via Web Serial" aside={<span className={`badge ${connected ? 'connected' : 'disconnected'}`}>{connected ? 'connected' : 'not connected'}</span>}>
      {!supported && <p className="warn-box">Web Serial needs desktop Chrome or Edge. Everything else still works.</p>}
      <Select
        label="Protocol"
        value={proto.id}
        options={PROTOCOLS.map((p) => ({ value: p.id, label: p.name }))}
        onChange={(id) => {
          const p = getProtocol(id);
          app.set({ output: { ...out, serialProtocol: id, serialOptions: defaultOptions(p), baud: p.defaultBaud } });
        }}
        hint={proto.description}
      />
      {!proto.verified && proto.warning && (
        <p className="warn-box" role="note">
          <b>Needs verification.</b> {proto.warning}
        </p>
      )}
      <div className="grid2">
        <Select
          label="Baud rate"
          value={String(out.baud)}
          options={proto.baudRates.map((b) => ({ value: String(b), label: `${b}` }))}
          onChange={(b) => app.set({ output: { ...out, baud: Number(b) } })}
        />
        {proto.options.map((o) => {
          const v = out.serialOptions[o.key] ?? o.default;
          if (o.type === 'boolean') return <Toggle key={o.key} label={o.label} checked={!!v} onChange={(x) => setOpt(o.key, x)} />;
          if (o.type === 'select')
            return <Select key={o.key} label={o.label} value={String(v)} options={o.choices ?? []} onChange={(x) => setOpt(o.key, x)} hint={o.help} />;
          return (
            <Field key={o.key} label={o.label} hint={o.help}>
              <input
                value={String(v)}
                inputMode={o.type === 'number' ? 'numeric' : 'text'}
                spellCheck={false}
                onChange={(e) => setOpt(o.key, o.type === 'number' ? Number(e.target.value) || 0 : e.target.value)}
              />
            </Field>
          );
        })}
      </div>
      <dl className="kv">
        <dt>Bytes per frame</dt>
        <dd>
          {bytes} for {width}×{height}
        </dd>
        <dt>Time on the wire</dt>
        <dd>
          {(secs * 1000).toFixed(1)} ms → max ≈ {secs > 0 ? Math.floor(1 / secs) : '∞'} fps
          {secs > 0 && 1 / secs < maxFps && <span className="warn-text"> (below your {maxFps} fps setting)</span>}
        </dd>
        {connected && (
          <>
            <dt>Port</dt>
            <dd>{label}</dd>
            <dt>Frames sent</dt>
            <dd>{framesSent}</dd>
          </>
        )}
      </dl>
      {packet && (
        <details>
          <summary>Packet preview (current frame)</summary>
          <pre className="hex">{hexdump(packet, 128)}</pre>
        </details>
      )}
      {err && <p className="error">{err}</p>}
      <div className="row">
        {connected ? (
          <button className="btn" onClick={() => serial.disconnect()}>
            Disconnect
          </button>
        ) : (
          <button className="btn primary" disabled={!supported} onClick={() => serial.connect(out.baud)}>
            Connect serial port…
          </button>
        )}
      </div>
    </Section>
  );
}

function hexdump(b: Uint8Array, max: number): string {
  const parts: string[] = [];
  for (let i = 0; i < Math.min(b.length, max); i++) parts.push(b[i].toString(16).padStart(2, '0'));
  const lines: string[] = [];
  for (let i = 0; i < parts.length; i += 16) lines.push(parts.slice(i, i + 16).join(' '));
  if (b.length > max) lines.push(`… ${b.length - max} more bytes`);
  return lines.join('\n');
}

function CExportSection() {
  const project = useStore(app, (s) => s.project);
  const selectedId = useStore(app, (s) => s.selectedId);
  const [source, setSource] = useState<'frame' | 'scene' | 'timeline'>('timeline');
  const [layout, setLayout] = useState<CLayout>('rows');
  const [fps, setFps] = useState(10);
  const [progmem, setProgmem] = useState(true);
  const [dedupe, setDedupe] = useState(true);
  const [name, setName] = useState('flipdisc_frames');
  const { width, height } = displaySize(project.display);

  const collect = (): { frames: Frame[]; durations?: number[] } => {
    const frameMs = 1000 / fps;
    if (source === 'frame') {
      const f = getEngine()?.sim.current();
      return { frames: f ? [f] : [] };
    }
    let frames: Frame[] = [];
    if (source === 'scene') {
      const sc = project.scenes.find((s) => s.id === selectedId);
      if (!sc) return { frames: [] };
      const tr = new TimelineRenderer({ ...project, scenes: [{ ...sc, transition: { kind: 'cut', duration: 0 } }], loop: false }, NO_LIVE);
      for (let t = 0; t < sc.duration; t += frameMs) frames.push(tr.frameAt(t).frame);
    } else {
      const tr = new TimelineRenderer({ ...project, loop: false }, NO_LIVE);
      const total = totalDuration(project);
      for (let t = 0; t < total; t += frameMs) frames.push(tr.frameAt(t).frame);
    }
    frames = frames.map((f) => ({ ...f, data: new Uint8Array(f.data) }));
    if (dedupe) return dedupeFrames(frames, frameMs);
    return { frames };
  };

  const est = useMemo(() => {
    const per = layout === 'rows' ? Math.ceil(width / 8) * height : Math.ceil(height / 8) * width;
    const n = source === 'frame' ? 1 : Math.ceil(((source === 'scene' ? project.scenes.find((s) => s.id === selectedId)?.duration ?? 0 : totalDuration(project)) / 1000) * fps);
    return { per, n, total: per * n };
  }, [layout, width, height, source, fps, project, selectedId]);

  const run = () => {
    try {
      const { frames, durations } = collect();
      if (!frames.length) return toast('Nothing to export.');
      const text = exportCArray(frames, { name, layout, progmem, fps, durations });
      download(`${sanitizeIdent(name)}.h`, text, 'text/x-c');
      toast(`Exported ${frames.length} frame(s).`);
    } catch (e) {
      toast((e as Error).message);
    }
  };

  return (
    <Section title="Export C array (Arduino / ESP32)">
      <div className="grid2">
        <Select
          label="What"
          value={source}
          onChange={setSource}
          options={[
            { value: 'frame', label: 'Current frame' },
            { value: 'scene', label: 'Selected scene' },
            { value: 'timeline', label: 'Whole timeline' },
          ]}
        />
        <Field label="Array name">
          <input value={name} onChange={(e) => setName(e.target.value)} spellCheck={false} />
        </Field>
        <div className="field">
          <span className="field-label">Bit layout</span>
          <Segmented<CLayout>
            ariaLabel="Bit layout"
            value={layout}
            onChange={setLayout}
            options={[
              { value: 'rows', label: 'Rows (MSB left)' },
              { value: 'columns', label: 'Columns (bit0 top)' },
            ]}
          />
        </div>
        {source !== 'frame' && <Slider label="Sample rate" value={fps} min={1} max={30} onChange={setFps} format={(v) => `${v} fps`} />}
      </div>
      <div className="row wrap">
        <Toggle label="PROGMEM (keep in flash)" checked={progmem} onChange={setProgmem} />
        {source !== 'frame' && <Toggle label="Merge repeated frames" checked={dedupe} onChange={setDedupe} />}
      </div>
      <p className="hint">
        ≈ {est.n} frames × {est.per} bytes = {(est.total / 1024).toFixed(1)} KB before merging. Webcam and OSC scenes export as
        blank. See <code>examples/arduino/</code> for a sketch that plays the file.
      </p>
      <button className="btn primary" onClick={run}>
        Download .h file
      </button>
    </Section>
  );
}
