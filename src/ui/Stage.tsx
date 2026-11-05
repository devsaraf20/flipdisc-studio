import { useEffect, useRef } from 'react';
import { cloneFrame, createFrame, resizeFrame, type Frame } from '../core/frame';
import { drawLine, drawShape, floodFill, stamp, type ShapeKind } from '../core/raster';
import { displaySize } from '../core/display';
import { Engine, setEngine } from './engine';
import { app, breakUndoGroup, stats, updateProject, updateScene, useStore } from './store';

export function Stage() {
  const hostRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<Engine | null>(null);
  const project = useStore(app, (s) => s.project);
  const selectedId = useStore(app, (s) => s.selectedId);
  const tab = useStore(app, (s) => s.tab);
  const playing = useStore(app, (s) => s.playing);
  const tool = useStore(app, (s) => s.tool);
  const brushSize = useStore(app, (s) => s.brushSize);
  const scene = project.scenes.find((s) => s.id === selectedId);
  const drawable = tab === 'create' && !playing && scene?.source.type === 'bitmap';
  const { width, height } = displaySize(project.display);

  useEffect(() => {
    const e = new Engine(hostRef.current!);
    engineRef.current = e;
    setEngine(e);
    return () => {
      setEngine(null);
      e.destroy();
    };
  }, []);

  // ---------- drawing ----------
  const drag = useRef<{ start: { x: number; y: number }; last: { x: number; y: number }; erase: boolean } | null>(null);

  const currentBitmap = (): Frame | null => {
    const s = app.get();
    const sc = s.project.scenes.find((x) => x.id === s.selectedId);
    if (sc?.source.type !== 'bitmap') return null;
    return resizeFrame(sc.source.frame, width, height);
  };

  const commitBitmap = (f: Frame) => {
    const id = app.get().selectedId;
    updateScene(id, (s) => (s.source.type === 'bitmap' ? { ...s, source: { type: 'bitmap', frame: f } } : s));
  };

  const shapePreview = (a: { x: number; y: number }, b: { x: number; y: number }, kind: ShapeKind) => {
    const f = createFrame(width, height);
    drawShape(f, kind, a.x, a.y, b.x, b.y, 1, brushSize);
    return f;
  };

  const cursorPreview = (c: { x: number; y: number }) => {
    const f = createFrame(width, height);
    stamp(f, c.x, c.y, 1, tool === 'fill' ? 1 : brushSize);
    return f;
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (!drawable) return;
    const sim = engineRef.current!.sim;
    const c = sim.cellAt(e.clientX, e.clientY);
    if (!c) return;
    sim.audio.unlock();
    (e.target as Element).setPointerCapture?.(e.pointerId);
    breakUndoGroup();
    const erase = tool === 'eraser' || e.shiftKey || e.button === 2;
    const bmp = currentBitmap();
    if (!bmp) return;
    if (tool === 'fill') {
      const f = cloneFrame(bmp);
      floodFill(f, c.x, c.y, erase ? 0 : 1);
      commitBitmap(f);
      return;
    }
    drag.current = { start: c, last: c, erase };
    if (tool === 'brush' || tool === 'eraser') {
      const f = cloneFrame(bmp);
      stamp(f, c.x, c.y, erase ? 0 : 1, brushSize);
      commitBitmap(f);
    } else {
      sim.drawOverlay(shapePreview(c, c, tool), undefined, erase);
    }
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const sim = engineRef.current?.sim;
    if (!sim || !drawable) return;
    const d = drag.current;
    const c = sim.cellAt(e.clientX, e.clientY, !!d);
    if (!d) {
      sim.drawOverlay(c ? cursorPreview(c) : null, undefined, tool === 'eraser' || e.shiftKey);
      return;
    }
    if (!c || (c.x === d.last.x && c.y === d.last.y)) return;
    if (tool === 'brush' || tool === 'eraser') {
      const bmp = currentBitmap();
      if (!bmp) return;
      const f = cloneFrame(bmp);
      drawLine(f, d.last.x, d.last.y, c.x, c.y, d.erase ? 0 : 1, brushSize);
      commitBitmap(f);
      sim.drawOverlay(cursorPreview(c), undefined, d.erase);
    } else if (tool !== 'fill') {
      sim.drawOverlay(shapePreview(d.start, c, tool), undefined, d.erase);
    }
    d.last = c;
  };

  const onPointerUp = () => {
    const d = drag.current;
    drag.current = null;
    const sim = engineRef.current?.sim;
    if (!d || !sim) return;
    if (tool !== 'brush' && tool !== 'eraser' && tool !== 'fill') {
      const bmp = currentBitmap();
      if (bmp) {
        const f = cloneFrame(bmp);
        drawShape(f, tool, d.start.x, d.start.y, d.last.x, d.last.y, d.erase ? 0 : 1, brushSize);
        commitBitmap(f);
      }
    }
    sim.drawOverlay(null);
    breakUndoGroup();
  };

  useEffect(() => {
    if (!drawable) engineRef.current?.sim.drawOverlay(null);
  }, [drawable]);

  return (
    <div className="stage">
      <div
        ref={hostRef}
        className={`sim-host${drawable ? ' drawable' : ''}`}
        style={{ '--aspect': `${width + (project.display.panelsX - 1) * 0.55 + 1.4} / ${height + (project.display.panelsY - 1) * 0.55 + 1.4}` } as React.CSSProperties}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onPointerLeave={() => !drag.current && engineRef.current?.sim.drawOverlay(null)}
        onContextMenu={(e) => drawable && e.preventDefault()}
        role="img"
        aria-label={`Simulated flip-disc display, ${width} by ${height} discs`}
      />
      <StatsBar />
    </div>
  );
}

function StatsBar() {
  const st = useStore(stats, (s) => s);
  const diff = useStore(app, (s) => s.project.sim.diffMode);
  const fps = useStore(app, (s) => s.project.sim.maxFps);
  const { width, height } = displaySize(useStore(app, (s) => s.project.display));
  const n = width * height;
  return (
    <div className="statsbar" aria-live="off">
      <button
        className={`chip ${diff ? 'chip-on' : ''}`}
        onClick={() => updateProject((p) => ({ ...p, sim: { ...p.sim, diffMode: !p.sim.diffMode } }))}
        title="Diff mode: only pulse discs that change. Fewer flips = less wear and noise."
      >
        Diff {diff ? 'on' : 'off'}
      </button>
      <Stat label="flips / frame" value={st.changed} />
      <Stat label="pulses / frame" value={st.pulses} warn={!diff && st.pulses > st.changed} />
      <Stat label="refresh" value={`${st.fps}/${fps} fps`} />
      <Stat label="total flips" value={st.totalFlips.toLocaleString()} />
      <Stat
        label="saved by diff"
        value={st.frames ? `${Math.max(0, Math.round(100 - (st.totalFlips / (st.frames * n)) * 100))}%` : '–'}
        title="Share of coil pulses avoided compared with re-driving every disc each frame"
      />
      <span className="statsbar-size">
        {width}×{height} · {n.toLocaleString()} discs
      </span>
    </div>
  );
}

function Stat({ label, value, warn, title }: { label: string; value: number | string; warn?: boolean; title?: string }) {
  return (
    <span className={`stat${warn ? ' warn' : ''}`} title={title}>
      <b>{value}</b>
      <small>{label}</small>
    </span>
  );
}
