import { useEffect, useRef } from 'react';
import { Stage } from './ui/Stage';
import { TimelineStrip } from './ui/Timeline';
import { CreatePanel } from './ui/CreatePanel';
import { ImportPanel } from './ui/ImportPanel';
import { OutputPanel } from './ui/OutputPanel';
import { InputPanel } from './ui/InputPanel';
import { DisplayPanel } from './ui/DisplayPanel';
import { app, play, redo, replaceProject, stop, toast, undo, updateProject, useStore, type Tab } from './ui/store';
import { defaultProject, parseProject, serializeProject } from './core/project';
import { download } from './ui/controls';
import { getEngine } from './ui/engine';

const TABS: { id: Tab; label: string }[] = [
  { id: 'create', label: 'Create' },
  { id: 'import', label: 'Import' },
  { id: 'output', label: 'Output' },
  { id: 'input', label: 'Input' },
  { id: 'display', label: 'Display' },
];

export function App() {
  const tab = useStore(app, (s) => s.tab);
  const name = useStore(app, (s) => s.project.name);
  const toastMsg = useStore(app, (s) => s.toast);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      const typing = el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable;
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === 'z' && !typing) {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
      } else if (mod && e.key.toLowerCase() === 'y' && !typing) {
        e.preventDefault();
        redo();
      } else if (mod && e.key.toLowerCase() === 's') {
        e.preventDefault();
        save();
      } else if (e.key === ' ' && !typing && el.tagName !== 'BUTTON') {
        e.preventDefault();
        getEngine()?.sim.audio.unlock();
        if (app.get().playing) stop();
        else play();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const save = () => {
    const p = app.get().project;
    const file = (p.name || 'project').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-').toLowerCase() || 'project';
    download(`${file}.flipdisc.json`, serializeProject(p), 'application/json');
  };

  const open = async (f: File) => {
    try {
      replaceProject(parseProject(await f.text()));
      toast(`Opened ${f.name}`);
    } catch (e) {
      toast(`Could not open: ${(e as Error).message}`);
    }
  };

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand" aria-label="Flip-Disc Studio">
          <span className="logo" aria-hidden>
            <i />
            <i className="off" />
            <i className="off" />
            <i />
          </span>
          <span className="brand-name">Flip-Disc Studio</span>
        </div>
        <input
          className="project-name"
          value={name}
          aria-label="Project name"
          onChange={(e) => updateProject((p) => ({ ...p, name: e.target.value }))}
        />
        <nav className="file-actions">
          <button className="btn ghost" onClick={undo} title="Undo (Ctrl/⌘+Z)" aria-label="Undo">
            ↶
          </button>
          <button className="btn ghost" onClick={redo} title="Redo (Ctrl/⌘+Shift+Z)" aria-label="Redo">
            ↷
          </button>
          <button
            className="btn ghost"
            onClick={() => {
              if (confirm('Start a new project? Unsaved changes stay in undo history only.')) replaceProject(defaultProject());
            }}
          >
            New
          </button>
          <button className="btn ghost" onClick={() => fileRef.current?.click()}>
            Open
          </button>
          <button className="btn" onClick={save} title="Save project as JSON (Ctrl/⌘+S)">
            Save
          </button>
          <input
            ref={fileRef}
            type="file"
            accept=".json,application/json"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void open(f);
              e.target.value = '';
            }}
          />
        </nav>
      </header>
      <main className="workspace">
        <div className="left">
          <Stage />
          <TimelineStrip />
        </div>
        <aside className="panel">
          <div className="tabs" role="tablist">
            {TABS.map((t) => (
              <button key={t.id} role="tab" aria-selected={tab === t.id} className={tab === t.id ? 'on' : ''} onClick={() => app.set({ tab: t.id })}>
                {t.label}
              </button>
            ))}
          </div>
          <div className="panel-body" role="tabpanel">
            {tab === 'create' && <CreatePanel />}
            {tab === 'import' && <ImportPanel />}
            {tab === 'output' && <OutputPanel />}
            {tab === 'input' && <InputPanel />}
            {tab === 'display' && <DisplayPanel />}
          </div>
        </aside>
      </main>
      {toastMsg && (
        <div className="toast" role="status">
          {toastMsg}
        </div>
      )}
    </div>
  );
}
