import { useSyncExternalStore } from 'react';
import { defaultProject, parseProject, serializeProject, type Project, type Scene } from '../core/project';
import type { CommitStats } from '../sim/simulator';
import { ALFAZETA, defaultOptions, type OptionValue } from '../io/protocols';
import type { ShapeKind } from '../core/raster';

export function createStore<T>(initial: T) {
  let state = initial;
  const listeners = new Set<() => void>();
  return {
    get: () => state,
    set(next: Partial<T> | ((s: T) => Partial<T>)) {
      const patch = typeof next === 'function' ? next(state) : next;
      state = { ...state, ...patch };
      listeners.forEach((l) => l());
    },
    subscribe(l: () => void) {
      listeners.add(l);
      return () => listeners.delete(l);
    },
  };
}

export function useStore<T, S>(store: ReturnType<typeof createStore<T>>, sel: (s: T) => S): S {
  return useSyncExternalStore(store.subscribe, () => sel(store.get()));
}

export type Tab = 'create' | 'import' | 'output' | 'input' | 'display';
export type DrawTool = 'brush' | 'eraser' | 'fill' | ShapeKind;

export interface AppState {
  project: Project;
  selectedId: string;
  playing: boolean;
  /** performance.now() at which timeline time 0 occurred */
  playOrigin: number;
  playhead: number;
  tab: Tab;
  tool: DrawTool;
  brushSize: number;
  output: {
    bridge: boolean;
    serialProtocol: string;
    serialOptions: Record<string, OptionValue>;
    baud: number;
  };
  toast: string;
}

const STORAGE_KEY = 'flipdisc-studio:autosave';

function loadInitial(): Project {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return parseProject(raw);
  } catch {
    /* storage blocked or corrupt: start fresh */
  }
  return defaultProject();
}

const initialProject = loadInitial();

export const app = createStore<AppState>({
  project: initialProject,
  selectedId: initialProject.scenes[0]?.id ?? '',
  playing: false,
  playOrigin: 0,
  playhead: 0,
  tab: 'create',
  tool: 'brush',
  brushSize: 1,
  output: {
    bridge: true,
    serialProtocol: ALFAZETA.id,
    serialOptions: defaultOptions(ALFAZETA),
    baud: ALFAZETA.defaultBaud,
  },
  toast: '',
});

export const stats = createStore<CommitStats>({
  changed: 0,
  pulses: 0,
  fps: 0,
  totalFlips: 0,
  totalPulses: 0,
  frames: 0,
});

// ---------- undo / project updates ----------

const undoStack: Project[] = [];
const redoStack: Project[] = [];
let lastCheckpoint = 0;

/**
 * Update the project. Changes within 600 ms of each other (a brush stroke,
 * a slider drag) share one undo step.
 */
export function updateProject(fn: (p: Project) => Project, opts: { checkpoint?: boolean } = {}): void {
  const prev = app.get().project;
  const now = performance.now();
  if (opts.checkpoint !== false && now - lastCheckpoint > 600) {
    undoStack.push(prev);
    if (undoStack.length > 100) undoStack.shift();
    redoStack.length = 0;
  }
  lastCheckpoint = now;
  app.set({ project: fn(prev) });
  scheduleSave();
}

export function breakUndoGroup() {
  lastCheckpoint = 0;
}

export function undo() {
  const p = undoStack.pop();
  if (!p) return;
  redoStack.push(app.get().project);
  setProjectRaw(p);
}
export function redo() {
  const p = redoStack.pop();
  if (!p) return;
  undoStack.push(app.get().project);
  setProjectRaw(p);
}

function setProjectRaw(p: Project) {
  const sel = app.get().selectedId;
  app.set({ project: p, selectedId: p.scenes.some((s) => s.id === sel) ? sel : (p.scenes[0]?.id ?? '') });
  scheduleSave();
}

export function replaceProject(p: Project) {
  undoStack.push(app.get().project);
  redoStack.length = 0;
  app.set({ project: p, selectedId: p.scenes[0]?.id ?? '', playing: false, playhead: 0 });
  scheduleSave();
}

export function updateScene(id: string, fn: (s: Scene) => Scene, opts?: { checkpoint?: boolean }) {
  updateProject((p) => ({ ...p, scenes: p.scenes.map((s) => (s.id === id ? fn(s) : s)) }), opts);
}

export function selectedScene(): Scene | undefined {
  const s = app.get();
  return s.project.scenes.find((x) => x.id === s.selectedId);
}

let saveTimer = 0;
function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => {
    try {
      localStorage.setItem(STORAGE_KEY, serializeProject(app.get().project));
    } catch {
      /* quota or blocked storage: autosave is best-effort */
    }
  }, 800);
}

let toastTimer = 0;
export function toast(msg: string) {
  app.set({ toast: msg });
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => app.set({ toast: '' }), 3200);
}

// ---------- playback ----------

export function play(fromMs?: number) {
  const s = app.get();
  const start = fromMs ?? s.playhead;
  app.set({ playing: true, playOrigin: performance.now() - start });
}
export function stop() {
  app.set({ playing: false });
}
export function seek(ms: number) {
  const s = app.get();
  if (s.playing) app.set({ playOrigin: performance.now() - ms, playhead: ms });
  else app.set({ playhead: ms });
}
