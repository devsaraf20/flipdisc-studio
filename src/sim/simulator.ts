import { createFrame, type Frame } from '../core/frame';
import type { DisplayConfig } from '../core/display';
import { displaySize } from '../core/display';
import type { SimSettings } from '../core/project';
import { ClickSynth } from './audio';

export interface CommitStats {
  /** discs whose face actually changed */
  changed: number;
  /** coil pulses sent (= changed in diff mode, every disc otherwise) */
  pulses: number;
  /** measured commits per second */
  fps: number;
  totalFlips: number;
  totalPulses: number;
  frames: number;
}

const NONE = 0;
const FLIP = 1;
const TWITCH = 2;
const LAND = 0.62; // fraction of the flip at which the disc hits its stop

/**
 * Canvas-based 2.5D flip-disc simulator.
 *
 * Each disc is a sprite that is squashed along the axis it rotates around,
 * with shading from its angle. A disc swaps face at 90°, lands at ~62% of the
 * animation and bounces a little against its stop. Only animating discs are
 * redrawn each frame, so large displays stay smooth.
 *
 * Frames are pushed at any rate; the simulator commits at most `maxFps` per
 * second (newest frame wins), like a real controller with a fixed refresh.
 */
export class FlipSimulator {
  readonly canvas: HTMLCanvasElement;
  readonly overlay: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private octx: CanvasRenderingContext2D;
  private bg: HTMLCanvasElement = document.createElement('canvas');
  private sprites: HTMLCanvasElement[] = [document.createElement('canvas'), document.createElement('canvas')];
  private ro: ResizeObserver;
  private raf = 0;

  private width = 0;
  private height = 0;
  private display: DisplayConfig;
  settings: SimSettings;

  // committed state
  private state = new Uint8Array(0);
  private lastFrame: Frame;
  // animation state per disc
  private aKind = new Uint8Array(0);
  private aFrom = new Uint8Array(0);
  private aStart = new Float64Array(0);
  private aDur = new Float32Array(0);
  private active: number[] = [];

  private pending: Frame | null = null;
  private lastCommit = 0;
  private commitTimes: number[] = [];
  private totals = { flips: 0, pulses: 0, frames: 0 };

  // layout (device pixels)
  private cell = 10;
  private gap = 5;
  private margin = 8;
  private cssW = 0;
  private cssH = 0;

  readonly audio = new ClickSynth();
  onCommit: ((frame: Frame, stats: CommitStats) => void) | null = null;

  constructor(
    private container: HTMLElement,
    display: DisplayConfig,
    settings: SimSettings,
  ) {
    this.display = display;
    this.settings = settings;
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'sim-canvas';
    this.overlay = document.createElement('canvas');
    this.overlay.className = 'sim-overlay';
    container.appendChild(this.canvas);
    container.appendChild(this.overlay);
    this.ctx = this.canvas.getContext('2d')!;
    this.octx = this.overlay.getContext('2d')!;
    const { width, height } = displaySize(display);
    this.lastFrame = createFrame(width, height);
    this.allocate(width, height);
    this.ro = new ResizeObserver(() => this.layout());
    this.ro.observe(container);
    this.layout();
    this.raf = requestAnimationFrame(this.tick);
  }

  destroy(): void {
    cancelAnimationFrame(this.raf);
    this.ro.disconnect();
    this.canvas.remove();
    this.overlay.remove();
  }

  private allocate(w: number, h: number) {
    this.width = w;
    this.height = h;
    const n = w * h;
    this.state = new Uint8Array(n);
    this.aKind = new Uint8Array(n);
    this.aFrom = new Uint8Array(n);
    this.aStart = new Float64Array(n);
    this.aDur = new Float32Array(n);
    this.active = [];
    this.lastFrame = createFrame(w, h);
  }

  setDisplay(d: DisplayConfig): void {
    const { width, height } = displaySize(d);
    const same =
      d.panelWidth === this.display.panelWidth &&
      d.panelHeight === this.display.panelHeight &&
      d.panelsX === this.display.panelsX &&
      d.panelsY === this.display.panelsY;
    this.display = d;
    if (same) return;
    this.allocate(width, height);
    this.layout();
  }

  setSettings(s: SimSettings): void {
    const visual = s.faceColor !== this.settings.faceColor || s.backColor !== this.settings.backColor || s.view !== this.settings.view;
    this.settings = s;
    this.audio.volume = s.volume;
    if (visual) this.layout();
  }

  /** Queue a frame. Rate-limited to settings.maxFps; the newest frame wins. */
  push(frame: Frame): void {
    this.pending = frame;
  }

  /** Re-drive every disc on the next commit (like a power-on refresh). */
  resetCounters(): void {
    this.totals = { flips: 0, pulses: 0, frames: 0 };
  }

  get size() {
    return { width: this.width, height: this.height };
  }

  current(): Frame {
    return this.lastFrame;
  }

  // ---------- layout & static drawing ----------

  private layout = () => {
    const rect = this.container.getBoundingClientRect();
    if (rect.width < 2 || rect.height < 2) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    const { panelWidth: pw, panelHeight: ph, panelsX, panelsY } = this.display;
    const gapU = 0.55; // gap between panels, in cells
    const marginU = 0.7;
    const unitsW = this.width + (panelsX - 1) * gapU + marginU * 2;
    const unitsH = this.height + (panelsY - 1) * gapU + marginU * 2;
    const cssCell = Math.max(2, Math.min(rect.width / unitsW, rect.height / unitsH, 64));
    const cell = Math.max(2, Math.floor(cssCell * dpr));

    this.cell = cell;
    this.gap = Math.round(cell * gapU);
    this.margin = Math.round(cell * marginU);
    const W = this.width * cell + (panelsX - 1) * this.gap + this.margin * 2;
    const H = this.height * cell + (panelsY - 1) * this.gap + this.margin * 2;
    for (const c of [this.canvas, this.overlay, this.bg]) {
      c.width = W;
      c.height = H;
    }
    this.cssW = W / dpr;
    this.cssH = H / dpr;
    for (const c of [this.canvas, this.overlay]) {
      c.style.width = `${this.cssW}px`;
      c.style.height = `${this.cssH}px`;
    }
    this.drawBackground(pw, ph);
    this.makeSprites();
    this.redrawAll();
  };

  private cellX(x: number) {
    return this.margin + x * this.cell + Math.floor(x / this.display.panelWidth) * this.gap;
  }
  private cellY(y: number) {
    return this.margin + y * this.cell + Math.floor(y / this.display.panelHeight) * this.gap;
  }

  private drawBackground(pw: number, ph: number) {
    const g = this.bg.getContext('2d')!;
    const c = this.cell;
    g.fillStyle = '#08090b';
    g.fillRect(0, 0, this.bg.width, this.bg.height);
    for (let py = 0; py < this.display.panelsY; py++)
      for (let px = 0; px < this.display.panelsX; px++) {
        const x0 = this.cellX(px * pw) - Math.round(c * 0.25);
        const y0 = this.cellY(py * ph) - Math.round(c * 0.25);
        const w = pw * c + Math.round(c * 0.5);
        const h = ph * c + Math.round(c * 0.5);
        const grad = g.createLinearGradient(x0, y0, x0, y0 + h);
        grad.addColorStop(0, '#1a1c20');
        grad.addColorStop(1, '#121317');
        g.fillStyle = grad;
        g.fillRect(x0, y0, w, h);
        g.strokeStyle = 'rgba(255,255,255,0.06)';
        g.lineWidth = Math.max(1, c * 0.04);
        g.strokeRect(x0 + 0.5, y0 + 0.5, w - 1, h - 1);
      }
    // Sockets: the recess each disc sits in.
    const r = c * 0.47;
    for (let y = 0; y < this.height; y++)
      for (let x = 0; x < this.width; x++) {
        const cx = this.cellX(x) + c / 2;
        const cy = this.cellY(y) + c / 2;
        g.fillStyle = '#060607';
        g.beginPath();
        g.arc(cx, cy, r, 0, Math.PI * 2);
        g.fill();
      }
  }

  private makeSprites() {
    const c = this.cell;
    const tilt = this.settings.view === 'tilt';
    [this.settings.backColor, this.settings.faceColor].forEach((color, i) => {
      const s = this.sprites[i];
      s.width = c;
      s.height = c;
      const g = s.getContext('2d')!;
      g.clearRect(0, 0, c, c);
      const r = c * 0.43;
      g.beginPath();
      g.arc(c / 2, c / 2, r, 0, Math.PI * 2);
      g.fillStyle = color;
      g.fill();
      if (tilt && c >= 6) {
        // Soft sheen from the top-left, darker rim: reads as a slightly domed disc.
        const sheen = g.createRadialGradient(c * 0.36, c * 0.32, 0, c / 2, c / 2, r);
        sheen.addColorStop(0, i ? 'rgba(255,255,255,0.28)' : 'rgba(255,255,255,0.07)');
        sheen.addColorStop(0.55, 'rgba(255,255,255,0)');
        sheen.addColorStop(1, 'rgba(0,0,0,0.28)');
        g.fillStyle = sheen;
        g.fill();
        // The axle: a faint line along the rotation axis.
        g.save();
        g.translate(c / 2, c / 2);
        g.rotate(this.axisAngle());
        g.strokeStyle = i ? 'rgba(0,0,0,0.12)' : 'rgba(255,255,255,0.05)';
        g.lineWidth = Math.max(1, c * 0.03);
        g.beginPath();
        g.moveTo(0, -r);
        g.lineTo(0, r);
        g.stroke();
        g.restore();
      }
    });
  }

  /** Angle of the rotation axis (radians; 0 = vertical). */
  private axisAngle() {
    const a = this.settings.axis;
    return a === 'vertical' ? 0 : a === 'horizontal' ? Math.PI / 2 : Math.PI / 4;
  }

  private redrawAll() {
    const ctx = this.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(this.bg, 0, 0);
    const now = performance.now();
    for (let i = 0; i < this.state.length; i++) this.drawDisc(i, now, false);
  }

  // ---------- animation ----------

  /** Rotation angle (0..π, with a little overshoot) for progress p. */
  private static angle(p: number): number {
    if (p <= 0) return 0;
    if (p < LAND) return Math.PI * Math.pow(p / LAND, 1.7); // accelerates as the magnet pulls
    const q = Math.min(1, (p - LAND) / (1 - LAND));
    return Math.PI + 0.32 * Math.sin(q * Math.PI * 2.2) * Math.pow(1 - q, 1.6); // bounce on the stop
  }

  private drawDisc(i: number, now: number, clear = true) {
    const ctx = this.ctx;
    const c = this.cell;
    const x = i % this.width;
    const y = (i / this.width) | 0;
    const px = this.cellX(x);
    const py = this.cellY(y);
    if (clear) {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.drawImage(this.bg, px, py, c, c, px, py, c, c);
    }
    let face = this.state[i];
    let theta = 0;
    const kind = this.aKind[i];
    if (kind !== NONE) {
      const p = (now - this.aStart[i]) / this.aDur[i];
      if (kind === FLIP) {
        theta = FlipSimulator.angle(p);
        face = Math.cos(theta) >= 0 ? this.aFrom[i] : this.state[i];
      } else {
        theta = p > 0 && p < 1 ? 0.28 * Math.sin(p * Math.PI) * (1 - p * 0.3) : 0;
        face = this.state[i];
      }
    }
    const scale = Math.abs(Math.cos(theta));
    const cx = px + c / 2;
    const cy = py + c / 2;
    if (scale > 0.999) {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.drawImage(this.sprites[face], px, py);
      return;
    }
    const a = this.axisAngle();
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    const s = Math.max(0.04, scale);
    // Squash perpendicular to the axis: R(a) · S(s,1) · R(-a)
    const m11 = ca * ca * s + sa * sa;
    const m12 = ca * sa * s - sa * ca;
    const m22 = sa * sa * s + ca * ca;
    ctx.setTransform(m11, m12, m12, m22, cx, cy);
    ctx.drawImage(this.sprites[face], -c / 2, -c / 2);
    if (this.settings.view === 'tilt') {
      // Shade by tilt: one side catches the light, the other falls into shadow.
      const lit = Math.sin(theta) * (face ? 1 : -1);
      ctx.fillStyle = lit > 0 ? `rgba(255,255,255,${0.12 * lit})` : `rgba(0,0,0,${0.45 * (1 - scale)})`;
      ctx.beginPath();
      ctx.arc(0, 0, c * 0.43, 0, Math.PI * 2);
      ctx.fill();
    }
    if (scale < 0.3) {
      // Disc edge-on: draw its rim.
      ctx.setTransform(1, 0, 0, 1, cx, cy);
      ctx.rotate(a);
      ctx.fillStyle = '#3a3b3f';
      const t = Math.max(1, c * 0.05);
      ctx.fillRect(-t / 2, -c * 0.43, t, c * 0.86);
    }
  }

  private tick = (now: number) => {
    this.raf = requestAnimationFrame(this.tick);
    if (this.pending && now - this.lastCommit >= 1000 / Math.max(0.5, this.settings.maxFps) - 2) {
      const f = this.pending;
      this.pending = null;
      this.commit(f, now);
    }
    if (!this.active.length) return;
    const still: number[] = [];
    for (const i of this.active) {
      if (this.aKind[i] === NONE) continue;
      const done = now >= this.aStart[i] + this.aDur[i];
      if (done) this.aKind[i] = NONE;
      if (now >= this.aStart[i] || done) this.drawDisc(i, now);
      if (!done) still.push(i);
    }
    this.active = still;
  };

  private commit(f: Frame, now: number) {
    if (f.width !== this.width || f.height !== this.height) return;
    const s = this.settings;
    let changed = 0;
    for (let i = 0; i < f.data.length; i++) if (f.data[i] !== this.lastFrame.data[i]) changed++;
    if (changed === 0 && this.totals.frames > 0) return; // nothing to send
    const pulses = s.diffMode ? changed : f.data.length;
    const landings: number[] = [];
    const seen = new Set(this.active);
    for (let i = 0; i < f.data.length; i++) {
      const target = f.data[i];
      const differs = target !== this.state[i];
      if (!differs && s.diffMode) continue;
      // What face is showing right now (may be mid-flip)?
      let visible = this.state[i];
      if (this.aKind[i] === FLIP) {
        const p = (now - this.aStart[i]) / this.aDur[i];
        if (Math.cos(FlipSimulator.angle(p)) >= 0) visible = this.aFrom[i];
      }
      const x = i % this.width;
      const delay = s.scanMsPerColumn * x + Math.random() * s.jitterMs;
      const dur = s.flipMs * (0.88 + Math.random() * 0.24);
      if (visible !== target) {
        this.aKind[i] = FLIP;
        this.aFrom[i] = visible;
        this.aDur[i] = dur;
        landings.push(delay + dur * LAND);
      } else {
        // Pulsed but already in position: it just twitches.
        this.aKind[i] = TWITCH;
        this.aDur[i] = dur * 0.6;
      }
      this.aStart[i] = now + delay;
      this.state[i] = target;
      if (!seen.has(i)) {
        this.active.push(i);
        seen.add(i);
      }
    }
    if (s.sound) this.audio.play(landings);
    this.lastFrame = { width: f.width, height: f.height, data: new Uint8Array(f.data) };
    this.lastCommit = now;
    this.commitTimes.push(now);
    while (this.commitTimes.length && now - this.commitTimes[0] > 1000) this.commitTimes.shift();
    this.totals.flips += changed;
    this.totals.pulses += pulses;
    this.totals.frames++;
    this.onCommit?.(this.lastFrame, {
      changed,
      pulses,
      fps: Math.min(this.commitTimes.length, Math.round(s.maxFps)),
      totalFlips: this.totals.flips,
      totalPulses: this.totals.pulses,
      frames: this.totals.frames,
    });
  }

  // ---------- pointer & overlay ----------

  cellAt(clientX: number, clientY: number, clamp = false): { x: number; y: number } | null {
    const r = this.canvas.getBoundingClientRect();
    const sx = ((clientX - r.left) / r.width) * this.canvas.width;
    const sy = ((clientY - r.top) / r.height) * this.canvas.height;
    const find = (v: number, n: number, panel: number) => {
      // invert cellX: walk panels
      const unit = panel * this.cell + this.gap;
      const pi = Math.floor((v - this.margin) / unit);
      const within = v - this.margin - pi * unit;
      let idx = pi * panel + Math.floor(within / this.cell);
      if (within >= panel * this.cell) idx = pi * panel + panel - 1; // in the gap: snap
      return clamp ? Math.max(0, Math.min(n - 1, idx)) : idx;
    };
    const x = find(sx, this.width, this.display.panelWidth);
    const y = find(sy, this.height, this.display.panelHeight);
    if (!clamp && (x < 0 || y < 0 || x >= this.width || y >= this.height || sx < this.margin || sy < this.margin)) return null;
    return { x, y };
  }

  /** Draw a translucent preview (shape in progress, brush cursor) above the discs. */
  drawOverlay(cells: Frame | null, color = 'rgba(120,200,255,0.55)', erase = false): void {
    const g = this.octx;
    g.clearRect(0, 0, this.overlay.width, this.overlay.height);
    if (!cells) return;
    const c = this.cell;
    g.lineWidth = Math.max(1, c * 0.08);
    g.strokeStyle = erase ? 'rgba(255,110,110,0.85)' : color;
    g.fillStyle = erase ? 'rgba(255,110,110,0.25)' : 'rgba(120,200,255,0.2)';
    for (let y = 0; y < cells.height && y < this.height; y++)
      for (let x = 0; x < cells.width && x < this.width; x++) {
        if (!cells.data[y * cells.width + x]) continue;
        g.beginPath();
        g.arc(this.cellX(x) + c / 2, this.cellY(y) + c / 2, c * 0.4, 0, Math.PI * 2);
        g.fill();
        g.stroke();
      }
  }

  get cssSize() {
    return { width: this.cssW, height: this.cssH };
  }

  /** Snapshot PNG of the current canvas. */
  toDataURL(): string {
    return this.canvas.toDataURL('image/png');
  }
}
