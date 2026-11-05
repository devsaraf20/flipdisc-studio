import { createFrame, frameFromBase64, frameToBase64, resizeFrame, type Frame } from './frame';
import { DEFAULT_DISPLAY, clampDisplay, displaySize, type DisplayConfig } from './display';
import { DEFAULT_TEXT, renderText, type TextParams } from './raster';
import { DEFAULT_GENERATOR, createGenerator, type GeneratorParams, type Renderer } from './generators';
import { DEFAULT_IMAGE_PARAMS, type ImageParams } from './dither';
import { applyTransition, type Transition } from './transitions';

export type SceneSource =
  | { type: 'bitmap'; frame: Frame }
  | { type: 'text'; params: TextParams }
  | { type: 'generator'; params: GeneratorParams }
  | { type: 'animation'; fps: number; frames: Frame[] }
  | { type: 'webcam'; params: ImageParams }
  | { type: 'input'; label: string };

export type SceneType = SceneSource['type'];

export interface Scene {
  id: string;
  name: string;
  /** ms */
  duration: number;
  /** transition used when entering this scene */
  transition: Transition;
  source: SceneSource;
}

export interface SimSettings {
  maxFps: number;
  diffMode: boolean;
  flipMs: number;
  jitterMs: number;
  scanMsPerColumn: number;
  sound: boolean;
  volume: number;
  axis: 'vertical' | 'horizontal' | 'diagonal';
  faceColor: string;
  backColor: string;
  view: 'tilt' | 'flat';
}

export const DEFAULT_SIM: SimSettings = {
  maxFps: 15,
  diffMode: true,
  flipMs: 110,
  jitterMs: 18,
  scanMsPerColumn: 0.6,
  sound: false,
  volume: 0.5,
  axis: 'diagonal',
  faceColor: '#f4c430',
  backColor: '#17181b',
  view: 'tilt',
};

export interface Project {
  name: string;
  display: DisplayConfig;
  sim: SimSettings;
  scenes: Scene[];
  loop: boolean;
}

export const SCENE_LABELS: Record<SceneType, string> = {
  bitmap: 'Drawing',
  text: 'Text',
  generator: 'Pattern',
  animation: 'Clip',
  webcam: 'Webcam',
  input: 'OSC / bridge input',
};

let idCounter = 0;
export function newId(): string {
  idCounter++;
  return `s${Date.now().toString(36)}${idCounter.toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`;
}

export function makeScene(type: SceneType, width: number, height: number, name?: string): Scene {
  let source: SceneSource;
  switch (type) {
    case 'bitmap':
      source = { type, frame: createFrame(width, height) };
      break;
    case 'text':
      source = { type, params: { ...DEFAULT_TEXT } };
      break;
    case 'generator':
      source = { type, params: { ...DEFAULT_GENERATOR } };
      break;
    case 'animation':
      source = { type, fps: 12, frames: [createFrame(width, height)] };
      break;
    case 'webcam':
      source = { type, params: { ...DEFAULT_IMAGE_PARAMS, mirror: true } };
      break;
    case 'input':
      source = { type, label: 'OSC input' };
      break;
  }
  return {
    id: newId(),
    name: name ?? SCENE_LABELS[type],
    duration: 4000,
    transition: { kind: 'dissolve', duration: 600 },
    source,
  };
}

export function defaultProject(): Project {
  const { width, height } = displaySize(DEFAULT_DISPLAY);
  const hello = makeScene('text', width, height, 'Hello');
  if (hello.source.type === 'text') hello.source.params.text = 'HELLO';
  hello.transition = { kind: 'cut', duration: 0 };
  const scroll = makeScene('text', width, height, 'Marquee');
  if (scroll.source.type === 'text')
    Object.assign(scroll.source.params, { text: 'FLIP-DISC STUDIO', scroll: 'left', speed: 14 });
  scroll.duration = 6000;
  scroll.transition = { kind: 'columns', duration: 900 };
  const ripple = makeScene('generator', width, height, 'Ripple');
  if (ripple.source.type === 'generator') Object.assign(ripple.source.params, { kind: 'ripple', scale: 2.5 });
  ripple.transition = { kind: 'wipe-left', duration: 700 };
  const clock = makeScene('generator', width, height, 'Clock');
  if (clock.source.type === 'generator') Object.assign(clock.source.params, { kind: 'clock' });
  clock.transition = { kind: 'dissolve', duration: 800 };
  return {
    name: 'Untitled project',
    display: { ...DEFAULT_DISPLAY },
    sim: { ...DEFAULT_SIM },
    scenes: [hello, scroll, ripple, clock],
    loop: true,
  };
}

// ---------- rendering ----------

/** Live inputs live outside the project file; the app supplies them. */
export interface LiveContext {
  webcam(width: number, height: number, params: ImageParams): Frame | null;
  input(width: number, height: number): Frame | null;
}

export const NO_LIVE: LiveContext = { webcam: () => null, input: () => null };

export function createSceneRenderer(scene: Scene, width: number, height: number, live: LiveContext): Renderer {
  const src = scene.source;
  switch (src.type) {
    case 'bitmap': {
      const f = resizeFrame(src.frame, width, height);
      return { render: () => f };
    }
    case 'text':
      return { render: (t) => renderText(src.params, width, height, t) };
    case 'generator':
      return createGenerator(src.params, width, height);
    case 'animation': {
      const frames = src.frames.map((f) => resizeFrame(f, width, height));
      return {
        render: (t) => frames[Math.floor((t / 1000) * src.fps) % Math.max(1, frames.length)] ?? createFrame(width, height),
      };
    }
    case 'webcam': {
      let last = createFrame(width, height);
      return { render: () => (last = live.webcam(width, height, src.params) ?? last) };
    }
    case 'input': {
      let last = createFrame(width, height);
      return { render: () => (last = live.input(width, height) ?? last) };
    }
  }
}

export function totalDuration(p: Project): number {
  return p.scenes.reduce((s, sc) => s + sc.duration, 0);
}

/** Where is the playhead? Returns scene index and time within that scene. */
export function locate(p: Project, tMs: number): { index: number; local: number } {
  const total = totalDuration(p);
  if (!p.scenes.length || total <= 0) return { index: -1, local: 0 };
  let t = p.loop ? ((tMs % total) + total) % total : Math.min(tMs, total - 1);
  for (let i = 0; i < p.scenes.length; i++) {
    if (t < p.scenes[i].duration) return { index: i, local: t };
    t -= p.scenes[i].duration;
  }
  return { index: p.scenes.length - 1, local: p.scenes[p.scenes.length - 1].duration };
}

/**
 * Renders the whole timeline. A transition plays at the start of a scene,
 * blending the previous scene's continuing output into the new one.
 */
export type RendererSource = (scene: Scene, width: number, height: number) => Renderer;

/** Cache renderers per scene object, so unchanged scenes keep their state (e.g. Life). */
export function rendererCache(live: LiveContext): RendererSource {
  const cache = new WeakMap<Scene, { w: number; h: number; r: Renderer }>();
  return (scene, width, height) => {
    const hit = cache.get(scene);
    if (hit && hit.w === width && hit.h === height) return hit.r;
    const r = createSceneRenderer(scene, width, height, live);
    cache.set(scene, { w: width, h: height, r });
    return r;
  };
}

export class TimelineRenderer {
  private get: RendererSource;
  constructor(
    private project: Project,
    live: LiveContext,
    source?: RendererSource,
  ) {
    this.get = source ?? rendererCache(live);
  }

  private renderer(scene: Scene): Renderer {
    const { width, height } = displaySize(this.project.display);
    return this.get(scene, width, height);
  }

  frameAt(tMs: number): { frame: Frame; index: number; local: number; transitioning: boolean } {
    const p = this.project;
    const { width, height } = displaySize(p.display);
    const { index, local } = locate(p, tMs);
    if (index < 0) return { frame: createFrame(width, height), index, local, transitioning: false };
    const scene = p.scenes[index];
    const cur = this.renderer(scene).render(local);
    const tr = scene.transition;
    const hasPrev = index > 0 || p.loop;
    if (tr.kind !== 'cut' && tr.duration > 0 && local < tr.duration && hasPrev && p.scenes.length > 1) {
      const prevIdx = (index - 1 + p.scenes.length) % p.scenes.length;
      const prev = p.scenes[prevIdx];
      const prevFrame = this.renderer(prev).render(prev.duration + local);
      const prog = local / tr.duration;
      return { frame: applyTransition(tr.kind, prevFrame, cur, prog, index + 1), index, local, transitioning: true };
    }
    return { frame: cur, index, local, transitioning: false };
  }
}

// ---------- JSON ----------

export const PROJECT_FORMAT = 'flipdisc-studio';
export const PROJECT_VERSION = 1;

type SerialFrame = { width: number; height: number; bits: string };
const sf = (f: Frame): SerialFrame => ({ width: f.width, height: f.height, bits: frameToBase64(f) });
const df = (s: SerialFrame): Frame => frameFromBase64(s.bits, s.width, s.height);

export function serializeProject(p: Project): string {
  const scenes = p.scenes.map((s) => {
    const src = s.source;
    let source: unknown = src;
    if (src.type === 'bitmap') source = { type: 'bitmap', frame: sf(src.frame) };
    if (src.type === 'animation') source = { type: 'animation', fps: src.fps, frames: src.frames.map(sf) };
    return { ...s, source };
  });
  return JSON.stringify(
    {
      format: PROJECT_FORMAT,
      version: PROJECT_VERSION,
      note: 'Frames are base64 of packed bits: row-major, MSB first.',
      name: p.name,
      display: p.display,
      sim: p.sim,
      loop: p.loop,
      scenes,
    },
    null,
    2,
  );
}

export function parseProject(json: string): Project {
  const raw = JSON.parse(json);
  if (!raw || raw.format !== PROJECT_FORMAT) throw new Error('Not a Flip-Disc Studio project file.');
  if (typeof raw.version !== 'number' || raw.version > PROJECT_VERSION)
    throw new Error(`Unsupported project version ${raw.version}.`);
  if (!Array.isArray(raw.scenes)) throw new Error('Project has no scenes array.');
  const display = clampDisplay({ ...DEFAULT_DISPLAY, ...raw.display });
  const scenes: Scene[] = raw.scenes.map((s: any): Scene => {
    let source: SceneSource = s.source;
    switch (s.source?.type) {
      case 'bitmap':
        source = { type: 'bitmap', frame: df(s.source.frame) };
        break;
      case 'animation':
        source = { type: 'animation', fps: Number(s.source.fps) || 12, frames: s.source.frames.map(df) };
        break;
      case 'text':
        source = { type: 'text', params: { ...DEFAULT_TEXT, ...s.source.params } };
        break;
      case 'generator':
        source = { type: 'generator', params: { ...DEFAULT_GENERATOR, ...s.source.params } };
        break;
      case 'webcam':
        source = { type: 'webcam', params: { ...DEFAULT_IMAGE_PARAMS, ...s.source.params } };
        break;
      case 'input':
        source = { type: 'input', label: String(s.source.label ?? 'OSC input') };
        break;
      default:
        throw new Error(`Unknown scene type "${s.source?.type}".`);
    }
    return {
      id: typeof s.id === 'string' ? s.id : newId(),
      name: String(s.name ?? 'Scene'),
      duration: Math.max(100, Number(s.duration) || 4000),
      transition: { kind: s.transition?.kind ?? 'cut', duration: Number(s.transition?.duration) || 0 },
      source,
    };
  });
  return {
    name: String(raw.name ?? 'Untitled project'),
    display,
    sim: { ...DEFAULT_SIM, ...raw.sim },
    loop: raw.loop !== false,
    scenes,
  };
}
