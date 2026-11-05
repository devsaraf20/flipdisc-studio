import type { ImageParams, DitherMethod, FitMode } from '../core/dither';
import { Segmented, Select, Slider, Toggle } from './controls';

export function ImageControls({ value, onChange }: { value: ImageParams; onChange: (p: ImageParams) => void }) {
  const set = (patch: Partial<ImageParams>) => onChange({ ...value, ...patch });
  return (
    <div className="grid2">
      <Select<DitherMethod>
        label="Method"
        value={value.method}
        onChange={(method) => set({ method })}
        options={[
          { value: 'threshold', label: 'Threshold' },
          { value: 'floyd-steinberg', label: 'Floyd–Steinberg dither' },
          { value: 'atkinson', label: 'Atkinson dither' },
          { value: 'ordered', label: 'Ordered (Bayer) dither' },
        ]}
        hint={value.method === 'threshold' ? 'Each disc on its own: bold, graphic.' : 'Spreads error to neighbours to fake greys.'}
      />
      <div className="field">
        <span className="field-label">Fit</span>
        <Segmented<FitMode>
          ariaLabel="Fit"
          value={value.fit}
          onChange={(fit) => set({ fit })}
          options={[
            { value: 'cover', label: 'Cover' },
            { value: 'contain', label: 'Contain' },
            { value: 'stretch', label: 'Stretch' },
          ]}
        />
      </div>
      <Slider label="Threshold" value={value.threshold} min={0} max={1} step={0.01} onChange={(threshold) => set({ threshold })} format={(v) => v.toFixed(2)} />
      <Slider label="Contrast" value={value.contrast} min={-1} max={1} step={0.01} onChange={(contrast) => set({ contrast })} format={(v) => (v > 0 ? '+' : '') + v.toFixed(2)} />
      <Slider label="Brightness" value={value.brightness} min={-0.5} max={0.5} step={0.01} onChange={(brightness) => set({ brightness })} format={(v) => (v > 0 ? '+' : '') + v.toFixed(2)} />
      <div className="field toggles">
        <Toggle label="Invert" checked={value.invert} onChange={(invert) => set({ invert })} />
        <Toggle label="Mirror" checked={value.mirror} onChange={(mirror) => set({ mirror })} />
      </div>
    </div>
  );
}
