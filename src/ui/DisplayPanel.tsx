import { PANEL_PRESETS, clampDisplay, displaySize, type DisplayConfig } from '../core/display';
import type { SimSettings } from '../core/project';
import { app, stats, updateProject, useStore } from './store';
import { NumberInput, Section, Segmented, Select, Slider, Toggle } from './controls';
import { getEngine } from './engine';

export function DisplayPanel() {
  const display = useStore(app, (s) => s.project.display);
  const sim = useStore(app, (s) => s.project.sim);
  const setD = (patch: Partial<DisplayConfig>) => updateProject((p) => ({ ...p, display: clampDisplay({ ...p.display, ...patch }) }));
  const setS = (patch: Partial<SimSettings>) => updateProject((p) => ({ ...p, sim: { ...p.sim, ...patch } }), { checkpoint: false });
  const preset = PANEL_PRESETS.find((p) => p.width === display.panelWidth && p.height === display.panelHeight)?.id ?? 'custom';
  const { width, height } = displaySize(display);
  return (
    <>
      <Section title="Panels">
        <Select
          label="Panel size"
          value={preset}
          options={[...PANEL_PRESETS.map((p) => ({ value: p.id, label: `${p.name}` })), { value: 'custom', label: 'Custom…' }]}
          onChange={(id) => {
            const p = PANEL_PRESETS.find((x) => x.id === id);
            if (p) setD({ panelWidth: p.width, panelHeight: p.height });
          }}
          hint={PANEL_PRESETS.find((p) => p.id === preset)?.note}
        />
        <div className="grid2">
          <NumberInput label="Panel width (discs)" value={display.panelWidth} min={1} max={128} onChange={(v) => setD({ panelWidth: v })} />
          <NumberInput label="Panel height (discs)" value={display.panelHeight} min={1} max={64} onChange={(v) => setD({ panelHeight: v })} />
          <NumberInput label="Panels across" value={display.panelsX} min={1} max={8} onChange={(v) => setD({ panelsX: v })} />
          <NumberInput label="Panels down" value={display.panelsY} min={1} max={8} onChange={(v) => setD({ panelsY: v })} />
        </div>
        <p className="hint">
          Total {width} × {height} = {(width * height).toLocaleString()} discs. Drawings are cropped or padded from the top-left when
          you resize.
        </p>
      </Section>
      <Section title="Mechanics">
        <Slider
          label="Max refresh rate"
          value={sim.maxFps}
          min={1}
          max={60}
          onChange={(maxFps) => setS({ maxFps })}
          format={(v) => `${v} fps`}
          hint="Real panels manage roughly 10–30 updates per second, limited by coil timing and the serial link."
        />
        <Toggle
          label="Diff mode: only flip discs that change"
          checked={sim.diffMode}
          onChange={(diffMode) => setS({ diffMode })}
          hint="Off = every disc is pulsed every update. Discs already in place twitch; wear and noise go up."
        />
        <div className="grid2">
          <Slider label="Flip time" value={sim.flipMs} min={30} max={400} onChange={(flipMs) => setS({ flipMs })} format={(v) => `${v} ms`} />
          <Slider label="Timing variation" value={sim.jitterMs} min={0} max={120} onChange={(jitterMs) => setS({ jitterMs })} format={(v) => `±${v} ms`} />
          <Slider
            label="Column scan delay"
            value={sim.scanMsPerColumn}
            min={0}
            max={10}
            step={0.1}
            onChange={(scanMsPerColumn) => setS({ scanMsPerColumn })}
            format={(v) => `${v.toFixed(1)} ms`}
            hint="Controllers drive columns one after another."
          />
          <Select<SimSettings['axis']>
            label="Rotation axis"
            value={sim.axis}
            onChange={(axis) => setS({ axis })}
            options={[
              { value: 'diagonal', label: 'Diagonal' },
              { value: 'vertical', label: 'Vertical' },
              { value: 'horizontal', label: 'Horizontal' },
            ]}
          />
        </div>
      </Section>
      <Section title="Look & sound">
        <div className="grid2">
          <div className="field">
            <span className="field-label">Rendering</span>
            <Segmented<SimSettings['view']>
              ariaLabel="Rendering"
              value={sim.view}
              onChange={(view) => setS({ view })}
              options={[
                { value: 'tilt', label: '2.5D shaded' },
                { value: 'flat', label: 'Flat' },
              ]}
            />
          </div>
          <div className="field">
            <span className="field-label">Disc colours</span>
            <div className="row tight">
              <input type="color" value={sim.faceColor} onChange={(e) => setS({ faceColor: e.target.value })} aria-label="Bright face colour" />
              <input type="color" value={sim.backColor} onChange={(e) => setS({ backColor: e.target.value })} aria-label="Dark face colour" />
              <button className="btn ghost" onClick={() => setS({ faceColor: '#f4c430', backColor: '#17181b' })}>
                Yellow
              </button>
              <button className="btn ghost" onClick={() => setS({ faceColor: '#f2f2ee', backColor: '#141414' })}>
                White
              </button>
            </div>
          </div>
        </div>
        <Toggle
          label="Click sound"
          checked={sim.sound}
          onChange={(sound) => {
            getEngine()?.sim.audio.unlock();
            setS({ sound });
          }}
          hint="Synthesised in the browser: one tick per landing disc, mixed so big updates rattle."
        />
        {sim.sound && <Slider label="Volume" value={sim.volume} min={0} max={1} step={0.05} onChange={(volume) => setS({ volume })} format={(v) => `${Math.round(v * 100)}%`} />}
        <div className="row">
          <button
            className="btn ghost"
            onClick={() => {
              getEngine()?.sim.resetCounters();
              stats.set({ totalFlips: 0, totalPulses: 0, frames: 0 });
            }}
          >
            Reset flip counters
          </button>
        </div>
      </Section>
    </>
  );
}
