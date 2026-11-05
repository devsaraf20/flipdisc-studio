import { useSyncExternalStore } from 'react';
import { bridge } from '../io/bridge';
import { app, useStore } from './store';
import { Section } from './controls';
import { BridgeSection } from './OutputPanel';
import { addScene } from './Timeline';
import { displaySize } from '../core/display';

const REPO = 'https://github.com/devsaraf20/flipdisc-studio/blob/main';

export function InputPanel() {
  const received = useSyncExternalStore(bridge.subscribe, () => bridge.received);
  const last = useSyncExternalStore(bridge.subscribe, () => bridge.lastInput);
  const status = useSyncExternalStore(bridge.subscribe, () => bridge.status);
  const scenes = useStore(app, (s) => s.project.scenes);
  const { width, height } = displaySize(useStore(app, (s) => s.project.display));

  const preview = () => {
    if (status !== 'connected') bridge.connect();
    const existing = scenes.find((s) => s.source.type === 'input');
    if (existing) app.set({ selectedId: existing.id, playing: false });
    else {
      addScene('input');
      app.set({ tab: 'input', playing: false });
    }
  };

  return (
    <>
      <BridgeSection mode="input" />
      <Section title="Preview external visuals">
        <p className="hint">
          Design in TouchDesigner, Unreal, Max/MSP or Processing and see it on the simulated panel. They send OSC to the bridge
          (UDP port 9000 by default) and the bridge passes frames here.
        </p>
        <button className="btn primary" onClick={preview}>
          Show OSC input on the display
        </button>
        <dl className="kv">
          <dt>Frames received</dt>
          <dd>{received}</dd>
          <dt>Last frame size</dt>
          <dd>
            {last ? `${last.width}×${last.height}` : '–'}
            {last && (last.width !== width || last.height !== height) && <span className="warn-text"> (scaled to {width}×{height})</span>}
          </dd>
        </dl>
      </Section>
      <Section title="OSC messages the bridge understands">
        <table className="ref">
          <tbody>
            <tr>
              <td><code>/flipdisc/frame</code></td>
              <td>int width, int height, then one of: a blob of packed bits · a string of 0/1 · width×height numbers (&gt; 0.5 = on)</td>
            </tr>
            <tr>
              <td><code>/flipdisc/row</code></td>
              <td>int y, then width numbers. The frame is shown when the last row arrives.</td>
            </tr>
            <tr>
              <td><code>/flipdisc/row/&lt;y&gt;</code></td>
              <td>width numbers (the row index is in the address; handy for TouchDesigner CHOP channels).</td>
            </tr>
            <tr>
              <td><code>/flipdisc/size</code></td>
              <td>int width, int height: set the grid size for row messages.</td>
            </tr>
            <tr>
              <td><code>/flipdisc/commit</code></td>
              <td>no args: show the rows received so far now.</td>
            </tr>
          </tbody>
        </table>
      </Section>
      <Section title="Guides">
        <ul className="links">
          <li>
            <a href={`${REPO}/docs/touchdesigner.md`} target="_blank" rel="noreferrer">
              TouchDesigner: OSC Out CHOP and Script DAT examples
            </a>
          </li>
          <li>
            <a href={`${REPO}/docs/unreal.md`} target="_blank" rel="noreferrer">
              Unreal Engine: OSC plugin, render target → grid
            </a>
          </li>
          <li>
            <a href={`${REPO}/LEARN.md`} target="_blank" rel="noreferrer">
              LEARN.md: dithering, OSC, serial and RS485 explained
            </a>
          </li>
        </ul>
      </Section>
    </>
  );
}
