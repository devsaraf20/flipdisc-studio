import { useEffect, useRef, useState } from 'react';
import { DEFAULT_IMAGE_PARAMS, processGray, sampleGray, type ImageParams } from '../core/dither';
import { displaySize } from '../core/display';
import { makeScene, type Scene } from '../core/project';
import type { Frame } from '../core/frame';
import { app, toast, updateProject, updateScene, useStore } from './store';
import { Section, Slider } from './controls';
import { ImageControls } from './ImageControls';
import { getEngine } from './engine';

type Media = { kind: 'image'; el: HTMLImageElement; name: string } | { kind: 'video'; el: HTMLVideoElement; name: string };

// Kept outside React so the source survives tab switches.
let media: Media | null = null;
let imageSceneId = '';
let params: ImageParams = { ...DEFAULT_IMAGE_PARAMS };

function processMedia(m: Media, p: ImageParams, width: number, height: number): Frame {
  const w = m.kind === 'image' ? m.el.naturalWidth : m.el.videoWidth;
  const h = m.kind === 'image' ? m.el.naturalHeight : m.el.videoHeight;
  return processGray(sampleGray(m.el, w, h, width, height, p.fit, p.mirror), width, height, p);
}

function insertScene(sc: Scene) {
  const idx = app.get().project.scenes.findIndex((s) => s.id === app.get().selectedId);
  updateProject((p) => {
    const scenes = [...p.scenes];
    scenes.splice(idx < 0 ? scenes.length : idx + 1, 0, sc);
    return { ...p, scenes };
  });
  app.set({ selectedId: sc.id });
}

export function ImportPanel() {
  const display = useStore(app, (s) => s.project.display);
  const scenes = useStore(app, (s) => s.project.scenes);
  const { width, height } = displaySize(display);
  const [, force] = useState(0);
  const [p, setP] = useState<ImageParams>(params);
  const [fps, setFps] = useState(12);
  const [maxSeconds, setMaxSeconds] = useState(10);
  const [baking, setBaking] = useState<number | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  params = p;

  // Live preview of video while it plays.
  useEffect(() => {
    const e = getEngine();
    if (!e || media?.kind !== 'video' || baking !== null) return;
    const m = media;
    e.override = () => (m.el.readyState >= 2 ? processMedia(m, params, width, height) : null);
    return () => {
      if (e.override) e.override = null;
    };
  }, [media, width, height, baking]);

  // Re-process the still image whenever settings change.
  useEffect(() => {
    if (media?.kind !== 'image' || !imageSceneId) return;
    if (!scenes.some((s) => s.id === imageSceneId)) return;
    const f = processMedia(media, p, width, height);
    updateScene(imageSceneId, (s) => ({ ...s, source: { type: 'bitmap', frame: f } }));
  }, [p, width, height]);

  const onFile = async (file: File) => {
    const url = URL.createObjectURL(file);
    if (media?.kind === 'video') media.el.pause();
    if (file.type.startsWith('video/')) {
      const v = document.createElement('video');
      v.src = url;
      v.muted = true;
      v.loop = true;
      v.playsInline = true;
      await new Promise<void>((res, rej) => {
        v.onloadeddata = () => res();
        v.onerror = () => rej(new Error('Could not decode this video in your browser.'));
      }).catch((e) => toast(e.message));
      media = { kind: 'video', el: v, name: file.name };
      void v.play().catch(() => {});
      app.set({ playing: false });
    } else {
      const img = new Image();
      img.src = url;
      try {
        await img.decode();
      } catch {
        toast('Could not read that image.');
        return;
      }
      media = { kind: 'image', el: img, name: file.name };
      const sc = makeScene('bitmap', width, height, file.name.replace(/\.[^.]+$/, '').slice(0, 24) || 'Image');
      sc.source = { type: 'bitmap', frame: processMedia(media, p, width, height) };
      insertScene(sc);
      imageSceneId = sc.id;
      app.set({ playing: false });
    }
    force((n) => n + 1);
  };

  const bake = async () => {
    if (media?.kind !== 'video') return;
    const v = media.el;
    v.pause();
    const len = Math.min(v.duration || 0, maxSeconds);
    const count = Math.max(1, Math.floor(len * fps));
    const frames: Frame[] = [];
    setBaking(0);
    for (let i = 0; i < count; i++) {
      v.currentTime = i / fps;
      await new Promise<void>((res) => {
        const done = () => {
          v.removeEventListener('seeked', done);
          res();
        };
        v.addEventListener('seeked', done);
        setTimeout(done, 1500);
      });
      frames.push(processMedia(media, params, width, height));
      if (i % 5 === 0) setBaking(i / count);
    }
    setBaking(null);
    const sc = makeScene('animation', width, height, media.name.replace(/\.[^.]+$/, '').slice(0, 24) || 'Clip');
    sc.source = { type: 'animation', fps, frames };
    sc.duration = Math.round((frames.length / fps) * 1000);
    insertScene(sc);
    void v.play().catch(() => {});
    toast(`Baked ${frames.length} frames into a clip scene.`);
  };

  const close = () => {
    if (media?.kind === 'video') media.el.pause();
    media = null;
    imageSceneId = '';
    const e = getEngine();
    if (e) e.override = null;
    force((n) => n + 1);
  };

  return (
    <>
      <Section title="Import image or video">
        <p className="hint">
          Pictures become on/off discs. Dithering fakes grey tones with patterns of dots; see LEARN.md for how it works.
        </p>
        <div className="row wrap">
          <button className="btn primary" onClick={() => fileRef.current?.click()}>
            Choose file…
          </button>
          {media && (
            <button className="btn ghost" onClick={close}>
              Close {media.kind}
            </button>
          )}
          <input
            ref={fileRef}
            type="file"
            accept="image/*,video/*"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void onFile(f);
              e.target.value = '';
            }}
          />
        </div>
        {media && (
          <p className="hint">
            {media.kind === 'image' ? 'Image' : 'Video'}: <b>{media.name}</b>
            {media.kind === 'image' ? ' — adjustments update the new drawing scene live.' : ' — previewing live on the display.'}
          </p>
        )}
      </Section>
      <Section title="Adjust">
        <ImageControls value={p} onChange={setP} />
      </Section>
      {media?.kind === 'video' && (
        <Section title="Bake video into a clip">
          <p className="hint">Captures frames into the project so it can be saved, played on the timeline and exported to C.</p>
          <div className="grid2">
            <Slider label="Frames per second" value={fps} min={1} max={30} onChange={setFps} />
            <Slider label="Max length" value={maxSeconds} min={1} max={60} onChange={setMaxSeconds} format={(v) => `${v}s`} />
          </div>
          <button className="btn primary" onClick={bake} disabled={baking !== null}>
            {baking !== null ? `Baking… ${Math.round(baking * 100)}%` : 'Bake clip'}
          </button>
        </Section>
      )}
    </>
  );
}
