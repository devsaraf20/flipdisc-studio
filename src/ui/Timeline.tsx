import { useRef, useState } from 'react';
import { displaySize } from '../core/display';
import { SCENE_LABELS, makeScene, totalDuration, type SceneType } from '../core/project';
import { app, play, seek, stop, updateProject, useStore } from './store';
import { getEngine } from './engine';

const ICON: Record<SceneType, string> = {
  bitmap: '✎',
  text: 'T',
  generator: '∿',
  animation: '▶︎',
  webcam: '◉',
  input: '⇄',
};

export const ADDABLE: SceneType[] = ['bitmap', 'text', 'generator', 'webcam', 'input'];

export function addScene(type: SceneType) {
  const p = app.get().project;
  const { width, height } = displaySize(p.display);
  const sc = makeScene(type, width, height);
  const idx = p.scenes.findIndex((s) => s.id === app.get().selectedId);
  updateProject((pr) => {
    const scenes = [...pr.scenes];
    scenes.splice(idx < 0 ? scenes.length : idx + 1, 0, sc);
    return { ...pr, scenes };
  });
  app.set({ selectedId: sc.id, tab: 'create' });
  return sc;
}

export function TimelineStrip() {
  const project = useStore(app, (s) => s.project);
  const selectedId = useStore(app, (s) => s.selectedId);
  const playing = useStore(app, (s) => s.playing);
  const playhead = useStore(app, (s) => s.playhead);
  const [menu, setMenu] = useState(false);
  const barRef = useRef<HTMLDivElement>(null);
  const total = totalDuration(project);

  const startOf = (i: number) => project.scenes.slice(0, i).reduce((a, s) => a + s.duration, 0);

  const onScrub = (e: React.PointerEvent) => {
    if (!barRef.current || total <= 0 || e.target !== barRef.current) return;
    const r = barRef.current.getBoundingClientRect();
    const t = ((e.clientX - r.left) / r.width) * total;
    seek(Math.max(0, Math.min(total - 1, t)));
  };

  return (
    <div className="timeline">
      <div className="timeline-controls">
        <button
          className="btn primary play"
          onClick={() => {
            getEngine()?.sim.audio.unlock();
            if (playing) stop();
            else play();
          }}
          aria-label={playing ? 'Stop' : 'Play timeline'}
          title="Play / stop (Space)"
        >
          {playing ? '■' : '▶'}
        </button>
        <button
          className={`btn icon ${project.loop ? 'active' : ''}`}
          onClick={() => updateProject((p) => ({ ...p, loop: !p.loop }))}
          title="Loop playback"
          aria-pressed={project.loop}
        >
          ⟲
        </button>
        <span className="time">
          {(playhead / 1000).toFixed(1)}s / {(total / 1000).toFixed(1)}s
        </span>
        <div className="add-wrap">
          <button className="btn" onClick={() => setMenu((m) => !m)} aria-expanded={menu}>
            + Scene
          </button>
          {menu && (
            <div className="menu" role="menu" onMouseLeave={() => setMenu(false)}>
              {ADDABLE.map((t) => (
                <button
                  key={t}
                  role="menuitem"
                  onClick={() => {
                    addScene(t);
                    setMenu(false);
                  }}
                >
                  <span className="scene-icon">{ICON[t]}</span> {SCENE_LABELS[t]}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
      <div className="timeline-track" ref={barRef} onPointerDown={onScrub}>
        {project.scenes.map((s, i) => (
          <button
            key={s.id}
            className={`clip ${s.id === selectedId ? 'selected' : ''} type-${s.source.type}`}
            style={{ flexGrow: s.duration }}
            onClick={() => {
              app.set({ selectedId: s.id });
              if (playing) seek(startOf(i) + 1);
              else app.set({ playhead: startOf(i) });
            }}
            title={`${s.name} · ${(s.duration / 1000).toFixed(1)}s · ${s.transition.kind}`}
          >
            {s.transition.kind !== 'cut' && (
              <span
                className="clip-tr"
                style={{ width: `${Math.min(100, (s.transition.duration / s.duration) * 100)}%` }}
                aria-hidden
              />
            )}
            <span className="scene-icon">{ICON[s.source.type]}</span>
            <span className="clip-name">{s.name}</span>
            <span className="clip-dur">{(s.duration / 1000).toFixed(1)}s</span>
          </button>
        ))}
        {total > 0 && <div className="playhead" style={{ left: `${(playhead / total) * 100}%` }} aria-hidden />}
        {!project.scenes.length && <span className="empty">No scenes yet. Add one to start.</span>}
      </div>
    </div>
  );
}
