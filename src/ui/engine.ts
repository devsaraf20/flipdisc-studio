import { displaySize } from '../core/display';
import { createFrame, type Frame } from '../core/frame';
import { TimelineRenderer, rendererCache, type Project } from '../core/project';
import { FlipSimulator } from '../sim/simulator';
import { bridge } from '../io/bridge';
import { serial } from '../io/serial';
import { getProtocol } from '../io/protocols';
import { liveContext } from '../io/live';
import { app, stats } from './store';

/**
 * The engine decides which frame should be on the display right now and
 * pushes it to the simulator. The simulator rate-limits and animates, and
 * every frame it commits goes to the outputs (bridge, serial).
 */
export class Engine {
  sim: FlipSimulator;
  private raf = 0;
  private renderers = rendererCache(liveContext);
  private timeline: TimelineRenderer;
  private project: Project;
  private previewOrigin = performance.now();
  private previewId = '';
  private lastPlayheadUpdate = 0;
  /** When set (e.g. a video being imported), shown instead of the scene. */
  override: (() => Frame | null) | null = null;
  private unsub: () => void;

  constructor(container: HTMLElement) {
    const s = app.get();
    this.project = s.project;
    this.timeline = new TimelineRenderer(s.project, liveContext, this.renderers);
    this.sim = new FlipSimulator(container, s.project.display, s.project.sim);
    this.sim.onCommit = (frame, st) => {
      stats.set(st);
      const o = app.get().output;
      if (o.bridge) bridge.sendFrame(frame, st.changed);
      if (serial.connected) serial.sendFrame(frame, getProtocol(o.serialProtocol), o.serialOptions);
    };
    this.unsub = app.subscribe(() => this.sync());
    this.raf = requestAnimationFrame(this.tick);
  }

  destroy() {
    cancelAnimationFrame(this.raf);
    this.unsub();
    this.sim.destroy();
  }

  private sync() {
    const s = app.get();
    if (s.project !== this.project) {
      this.project = s.project;
      this.timeline = new TimelineRenderer(s.project, liveContext, this.renderers);
      this.sim.setDisplay(s.project.display);
      this.sim.setSettings(s.project.sim);
    }
    if (s.selectedId !== this.previewId) {
      this.previewId = s.selectedId;
      this.previewOrigin = performance.now();
    }
  }

  /** The frame for the selected scene (not playing), at its own local time. */
  previewFrame(now = performance.now()): Frame {
    const s = app.get();
    const { width, height } = displaySize(s.project.display);
    const scene = s.project.scenes.find((x) => x.id === s.selectedId);
    if (!scene) return createFrame(width, height);
    const r = this.renderers(scene, width, height);
    return r.render(now - this.previewOrigin);
  }

  restartPreview() {
    this.previewOrigin = performance.now();
  }

  private tick = (now: number) => {
    this.raf = requestAnimationFrame(this.tick);
    const s = app.get();
    let frame: Frame | null = null;
    if (s.playing) {
      const t = now - s.playOrigin;
      const r = this.timeline.frameAt(t);
      frame = r.frame;
      const total = s.project.scenes.reduce((a, b) => a + b.duration, 0);
      if (!s.project.loop && t >= total) {
        app.set({ playing: false, playhead: 0 });
      } else if (now - this.lastPlayheadUpdate > 80) {
        this.lastPlayheadUpdate = now;
        app.set({ playhead: s.project.loop && total > 0 ? t % total : t });
      }
    } else {
      frame = this.override?.() ?? this.previewFrame(now);
    }
    if (frame) this.sim.push(frame);
  };
}

let engine: Engine | null = null;
export function setEngine(e: Engine | null) {
  engine = e;
}
export function getEngine(): Engine | null {
  return engine;
}
