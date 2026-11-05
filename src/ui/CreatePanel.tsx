import { cloneFrame, createFrame, resizeFrame, type Frame } from '../core/frame';
import { displaySize } from '../core/display';
import { FONTS } from '../core/fonts';
import { blit, scrollCycleMs, textBitmap, type HAlign, type ScrollMode, type TextParams, type VAlign } from '../core/raster';
import { GENERATOR_LABELS, type GeneratorKind, type GeneratorParams } from '../core/generators';
import { TRANSITION_LABELS, type TransitionKind } from '../core/transitions';
import { SCENE_LABELS, makeScene, newId, type Scene } from '../core/project';
import { app, breakUndoGroup, toast, updateProject, updateScene, useStore, type DrawTool } from './store';
import { Field, NumberInput, Section, Segmented, Select, Slider, Toggle } from './controls';
import { ImageControls } from './ImageControls';
import { getEngine } from './engine';
import { webcam } from '../io/live';
import { bridge } from '../io/bridge';
import { useSyncExternalStore, useState } from 'react';
import { ADDABLE, addScene } from './Timeline';

export function CreatePanel() {
  const project = useStore(app, (s) => s.project);
  const selectedId = useStore(app, (s) => s.selectedId);
  const scene = project.scenes.find((s) => s.id === selectedId);
  if (!scene)
    return (
      <div className="empty-panel">
        <p>Add a scene to start designing.</p>
        <div className="row wrap">
          {ADDABLE.map((t) => (
            <button key={t} className="btn" onClick={() => addScene(t)}>
              + {SCENE_LABELS[t]}
            </button>
          ))}
        </div>
      </div>
    );
  return (
    <>
      <SceneHeader scene={scene} />
      {scene.source.type === 'bitmap' && <BitmapEditor scene={scene} />}
      {scene.source.type === 'text' && <TextEditor scene={scene} params={scene.source.params} />}
      {scene.source.type === 'generator' && <GeneratorEditor scene={scene} params={scene.source.params} />}
      {scene.source.type === 'webcam' && <WebcamEditor scene={scene} />}
      {scene.source.type === 'animation' && <ClipEditor scene={scene} />}
      {scene.source.type === 'input' && <InputSceneInfo />}
      {scene.source.type !== 'bitmap' && (
        <div className="row">
          <button className="btn ghost" onClick={snapshotToDrawing}>
            Snapshot to new drawing
          </button>
        </div>
      )}
    </>
  );
}

function snapshotToDrawing() {
  const e = getEngine();
  if (!e) return;
  const f = cloneFrame(e.previewFrame());
  const p = app.get().project;
  const { width, height } = displaySize(p.display);
  const sc = makeScene('bitmap', width, height, 'Snapshot');
  sc.source = { type: 'bitmap', frame: f };
  const idx = p.scenes.findIndex((s) => s.id === app.get().selectedId);
  updateProject((pr) => {
    const scenes = [...pr.scenes];
    scenes.splice(idx + 1, 0, sc);
    return { ...pr, scenes };
  });
  app.set({ selectedId: sc.id });
  toast('Captured the current frame as a drawing.');
}

function SceneHeader({ scene }: { scene: Scene }) {
  const scenes = useStore(app, (s) => s.project.scenes);
  const idx = scenes.findIndex((s) => s.id === scene.id);
  const move = (d: number) =>
    updateProject((p) => {
      const arr = [...p.scenes];
      const j = idx + d;
      if (j < 0 || j >= arr.length) return p;
      [arr[idx], arr[j]] = [arr[j], arr[idx]];
      return { ...p, scenes: arr };
    });
  const duplicate = () => {
    const copy: Scene = structuredClone(scene);
    copy.id = newId();
    copy.name = `${scene.name} copy`;
    updateProject((p) => {
      const arr = [...p.scenes];
      arr.splice(idx + 1, 0, copy);
      return { ...p, scenes: arr };
    });
    app.set({ selectedId: copy.id });
  };
  const remove = () => {
    const next = scenes[idx + 1] ?? scenes[idx - 1];
    updateProject((p) => ({ ...p, scenes: p.scenes.filter((s) => s.id !== scene.id) }));
    app.set({ selectedId: next?.id ?? '' });
  };
  const set = (patch: Partial<Scene>) => updateScene(scene.id, (s) => ({ ...s, ...patch }));
  return (
    <Section
      title={`${SCENE_LABELS[scene.source.type]} scene`}
      aside={
        <div className="row tight">
          <button className="btn icon" onClick={() => move(-1)} disabled={idx <= 0} title="Move earlier" aria-label="Move scene earlier">
            ←
          </button>
          <button className="btn icon" onClick={() => move(1)} disabled={idx >= scenes.length - 1} title="Move later" aria-label="Move scene later">
            →
          </button>
          <button className="btn icon" onClick={duplicate} title="Duplicate" aria-label="Duplicate scene">
            ⧉
          </button>
          <button className="btn icon danger" onClick={remove} title="Delete" aria-label="Delete scene">
            ✕
          </button>
        </div>
      }
    >
      <div className="grid2">
        <Field label="Name">
          <input value={scene.name} onChange={(e) => set({ name: e.target.value })} />
        </Field>
        <NumberInput label="Duration (s)" value={scene.duration / 1000} min={0.1} step={0.1} onChange={(v) => set({ duration: Math.max(100, Math.round(v * 1000)) })} />
        <Select<TransitionKind>
          label="Transition in"
          value={scene.transition.kind}
          options={Object.entries(TRANSITION_LABELS).map(([value, label]) => ({ value: value as TransitionKind, label }))}
          onChange={(kind) => set({ transition: { kind, duration: kind === 'cut' ? 0 : scene.transition.duration || 600 } })}
        />
        <NumberInput
          label="Transition (s)"
          value={scene.transition.duration / 1000}
          min={0}
          step={0.1}
          onChange={(v) => set({ transition: { ...scene.transition, duration: Math.max(0, Math.min(scene.duration, Math.round(v * 1000))) } })}
        />
      </div>
    </Section>
  );
}

// ---------- drawing ----------

const TOOLS: { value: DrawTool; label: string; title: string }[] = [
  { value: 'brush', label: '✎', title: 'Brush (hold Shift to erase)' },
  { value: 'eraser', label: '⌫', title: 'Eraser' },
  { value: 'fill', label: '◧', title: 'Fill area' },
  { value: 'line', label: '╱', title: 'Line' },
  { value: 'rect', label: '▭', title: 'Rectangle' },
  { value: 'rectFill', label: '■', title: 'Filled rectangle' },
  { value: 'ellipse', label: '○', title: 'Ellipse' },
  { value: 'ellipseFill', label: '●', title: 'Filled ellipse' },
];

function BitmapEditor({ scene }: { scene: Scene }) {
  const tool = useStore(app, (s) => s.tool);
  const size = useStore(app, (s) => s.brushSize);
  const display = useStore(app, (s) => s.project.display);
  const { width, height } = displaySize(display);
  const [stampText, setStampText] = useState('');
  const [stampFont, setStampFont] = useState('classic');
  if (scene.source.type !== 'bitmap') return null;
  const frame = resizeFrame(scene.source.frame, width, height);
  const edit = (fn: (f: Frame) => void) => {
    breakUndoGroup();
    const f = cloneFrame(frame);
    fn(f);
    updateScene(scene.id, (s) => ({ ...s, source: { type: 'bitmap', frame: f } }));
    breakUndoGroup();
  };
  const shift = (dx: number, dy: number) =>
    edit((f) => {
      const src = cloneFrame(f);
      f.data.fill(0);
      blit(f, src, dx, dy, 'copy');
    });
  return (
    <Section title="Draw on the display">
      <p className="hint">Draw straight onto the simulator. Shift or right-click erases. Ctrl/⌘+Z undoes.</p>
      <Segmented<DrawTool>
        ariaLabel="Drawing tool"
        value={tool}
        onChange={(t) => app.set({ tool: t })}
        options={TOOLS.map((t) => ({ value: t.value, label: <span title={t.title}>{t.label}</span>, title: t.title }))}
      />
      <Slider label="Brush / stroke size" value={size} min={1} max={6} onChange={(v) => app.set({ brushSize: v })} />
      <div className="row wrap">
        <button className="btn" onClick={() => edit((f) => f.data.fill(0))}>
          Clear
        </button>
        <button className="btn" onClick={() => edit((f) => f.data.fill(1))}>
          Fill all
        </button>
        <button className="btn" onClick={() => edit((f) => f.data.forEach((v, i) => (f.data[i] = v ^ 1)))}>
          Invert
        </button>
        <span className="row tight" aria-label="Nudge">
          <button className="btn icon" onClick={() => shift(-1, 0)} aria-label="Nudge left">←</button>
          <button className="btn icon" onClick={() => shift(0, -1)} aria-label="Nudge up">↑</button>
          <button className="btn icon" onClick={() => shift(0, 1)} aria-label="Nudge down">↓</button>
          <button className="btn icon" onClick={() => shift(1, 0)} aria-label="Nudge right">→</button>
        </span>
      </div>
      <div className="grid2 stamp">
        <Field label="Stamp text">
          <input value={stampText} placeholder="Type, then Stamp" onChange={(e) => setStampText(e.target.value)} />
        </Field>
        <Select label="Font" value={stampFont} onChange={setStampFont} options={FONTS.map((f) => ({ value: f.id, label: f.name }))} />
      </div>
      <button
        className="btn"
        disabled={!stampText}
        onClick={() =>
          edit((f) => {
            const b = textBitmap({ text: stampText, font: stampFont, scale: 1, align: 'center' });
            blit(f, b, Math.floor((width - b.width) / 2), Math.floor((height - b.height) / 2));
          })
        }
      >
        Stamp in centre
      </button>
    </Section>
  );
}

// ---------- text ----------

function TextEditor({ scene, params }: { scene: Scene; params: TextParams }) {
  const display = useStore(app, (s) => s.project.display);
  const { width, height } = displaySize(display);
  const set = (patch: Partial<TextParams>) =>
    updateScene(scene.id, (s) => (s.source.type === 'text' ? { ...s, source: { type: 'text', params: { ...s.source.params, ...patch } } } : s));
  const cycle = scrollCycleMs(params, width, height);
  return (
    <Section title="Text">
      <Field label="Text" hint="New line = new row. Scrolling text loops seamlessly.">
        <textarea rows={2} value={params.text} onChange={(e) => set({ text: e.target.value })} />
      </Field>
      <div className="grid2">
        <Select label="Font" value={params.font} onChange={(font) => set({ font })} options={FONTS.map((f) => ({ value: f.id, label: f.name }))} />
        <Slider label="Size" value={params.scale} min={1} max={4} onChange={(scale) => set({ scale })} format={(v) => `${v}×`} />
        <div className="field">
          <span className="field-label">Align</span>
          <Segmented<HAlign>
            ariaLabel="Horizontal alignment"
            value={params.align}
            onChange={(align) => set({ align })}
            options={[
              { value: 'left', label: '⇤' },
              { value: 'center', label: '↔' },
              { value: 'right', label: '⇥' },
            ]}
          />
        </div>
        <div className="field">
          <span className="field-label">Vertical</span>
          <Segmented<VAlign>
            ariaLabel="Vertical alignment"
            value={params.valign}
            onChange={(valign) => set({ valign })}
            options={[
              { value: 'top', label: '⤒' },
              { value: 'middle', label: '↕' },
              { value: 'bottom', label: '⤓' },
            ]}
          />
        </div>
        <Select<ScrollMode>
          label="Scroll"
          value={params.scroll}
          onChange={(scroll) => {
            set({ scroll });
            getEngine()?.restartPreview();
          }}
          options={[
            { value: 'none', label: 'Static' },
            { value: 'left', label: 'Marquee ←' },
            { value: 'right', label: 'Marquee →' },
            { value: 'up', label: 'Credits ↑' },
            { value: 'down', label: 'Drop ↓' },
          ]}
        />
        <Slider label="Speed" value={params.speed} min={1} max={60} onChange={(speed) => set({ speed })} format={(v) => `${v} discs/s`} />
        <Slider label="Offset X" value={params.offsetX} min={-width} max={width} onChange={(offsetX) => set({ offsetX })} />
        <Slider label="Offset Y" value={params.offsetY} min={-height} max={height} onChange={(offsetY) => set({ offsetY })} />
      </div>
      <div className="row wrap">
        <Toggle label="Invert (dark text on bright)" checked={params.invert} onChange={(invert) => set({ invert })} />
        {cycle > 0 && (
          <button className="btn ghost" onClick={() => updateScene(scene.id, (s) => ({ ...s, duration: Math.round(cycle) }))}>
            Duration = one pass ({(cycle / 1000).toFixed(1)}s)
          </button>
        )}
      </div>
    </Section>
  );
}

// ---------- generators ----------

function GeneratorEditor({ scene, params }: { scene: Scene; params: GeneratorParams }) {
  const set = (patch: Partial<GeneratorParams>) =>
    updateScene(scene.id, (s) => (s.source.type === 'generator' ? { ...s, source: { type: 'generator', params: { ...s.source.params, ...patch } } } : s));
  const k = params.kind;
  return (
    <Section title="Generative pattern">
      <Segmented<GeneratorKind>
        ariaLabel="Pattern"
        value={k}
        onChange={(kind) => {
          set({ kind, scale: kind === 'ripple' ? 2.5 : kind === 'clock' ? 6 : params.scale });
          getEngine()?.restartPreview();
        }}
        options={(Object.keys(GENERATOR_LABELS) as GeneratorKind[]).map((g) => ({ value: g, label: GENERATOR_LABELS[g] }))}
      />
      <div className="grid2">
        {k !== 'clock' && <Slider label="Speed" value={params.speed} min={0.1} max={4} step={0.1} onChange={(speed) => set({ speed })} format={(v) => `${v.toFixed(1)}×`} />}
        {(k === 'noise' || k === 'waves' || k === 'ripple') && (
          <>
            <Slider label="Scale" value={params.scale} min={1} max={20} step={0.5} onChange={(scale) => set({ scale })} />
            <Slider label="Threshold" value={params.threshold} min={0.05} max={0.95} step={0.01} onChange={(threshold) => set({ threshold })} format={(v) => v.toFixed(2)} />
          </>
        )}
        {k === 'waves' && <Slider label="Angle" value={params.angle} min={0} max={180} onChange={(angle) => set({ angle })} format={(v) => `${v}°`} />}
        {k === 'life' && <Slider label="Starting density" value={params.density} min={0.05} max={0.8} step={0.01} onChange={(density) => set({ density })} format={(v) => `${Math.round(v * 100)}%`} />}
        {(k === 'noise' || k === 'life') && (
          <NumberInput label="Seed" value={params.seed} onChange={(seed) => set({ seed: Math.round(seed) })} hint="Same seed, same result." />
        )}
        {k === 'clock' && (
          <>
            <Select label="Font" value={params.clockFont} onChange={(clockFont) => set({ clockFont })} options={FONTS.map((f) => ({ value: f.id, label: f.name }))} />
            <Slider label="Size" value={Math.max(1, Math.round(params.scale / 6))} min={1} max={4} onChange={(v) => set({ scale: v * 6 })} format={(v) => `${v}×`} />
            <Toggle label="Show seconds" checked={params.showSeconds} onChange={(showSeconds) => set({ showSeconds })} />
          </>
        )}
      </div>
      {k === 'life' && <p className="hint">Conway’s Game of Life on a wrap-around board. Re-seeds itself when it settles.</p>}
      {k === 'clock' && <p className="hint">Uses this device’s local time. On hardware, the bridge or microcontroller should keep time.</p>}
    </Section>
  );
}

// ---------- webcam ----------

function WebcamEditor({ scene }: { scene: Scene }) {
  const running = useSyncExternalStore(webcam.subscribe, () => webcam.running);
  const err = useSyncExternalStore(webcam.subscribe, () => webcam.error);
  const starting = useSyncExternalStore(webcam.subscribe, () => webcam.starting);
  if (scene.source.type !== 'webcam') return null;
  const params = scene.source.params;
  return (
    <Section
      title="Live webcam"
      aside={
        <button className={`btn ${running ? '' : 'primary'}`} onClick={() => (running ? webcam.stop() : webcam.start())} disabled={starting}>
          {running ? 'Stop camera' : starting ? 'Starting…' : 'Start camera'}
        </button>
      }
    >
      {err && <p className="error">{err}</p>}
      <p className="hint">Your video stays in this browser. Only the on/off disc pattern is ever sent to outputs.</p>
      <ImageControls
        value={params}
        onChange={(p) => updateScene(scene.id, (s) => ({ ...s, source: { type: 'webcam', params: p } }))}
      />
    </Section>
  );
}

function ClipEditor({ scene }: { scene: Scene }) {
  if (scene.source.type !== 'animation') return null;
  const src = scene.source;
  const lengthMs = (src.frames.length / src.fps) * 1000;
  return (
    <Section title="Clip">
      <p className="hint">
        {src.frames.length} frames at {src.fps} fps ({(lengthMs / 1000).toFixed(1)}s). Import new clips in the Import tab.
      </p>
      <div className="grid2">
        <Slider
          label="Playback fps"
          value={src.fps}
          min={1}
          max={30}
          onChange={(fps) => updateScene(scene.id, (s) => (s.source.type === 'animation' ? { ...s, source: { ...s.source, fps } } : s))}
        />
        <button className="btn ghost" onClick={() => updateScene(scene.id, (s) => ({ ...s, duration: Math.round(lengthMs) }))}>
          Duration = clip length
        </button>
      </div>
    </Section>
  );
}

function InputSceneInfo() {
  const status = useSyncExternalStore(bridge.subscribe, () => bridge.status);
  return (
    <Section title="External input">
      <p className="hint">
        Shows frames arriving over OSC (TouchDesigner, Unreal, Max…) through the local bridge. Bridge status: <b>{status}</b>.
      </p>
      <button className="btn" onClick={() => app.set({ tab: 'input' })}>
        Input settings & guides
      </button>
    </Section>
  );
}

export function blankFrame(): Frame {
  const { width, height } = displaySize(app.get().project.display);
  return createFrame(width, height);
}
