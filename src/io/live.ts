import { scaleFrame, type Frame } from '../core/frame';
import { processGray, sampleGray, type ImageParams } from '../core/dither';
import type { LiveContext } from '../core/project';
import { bridge } from './bridge';

/** Shared webcam stream. Started on demand, stopped when no scene needs it. */
class Webcam {
  video: HTMLVideoElement | null = null;
  stream: MediaStream | null = null;
  error = '';
  starting = false;
  private listeners = new Set<() => void>();

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };
  private emit() {
    this.listeners.forEach((l) => l());
  }

  get running() {
    return !!this.stream;
  }

  async start(): Promise<void> {
    if (this.stream || this.starting) return;
    this.starting = true;
    this.error = '';
    this.emit();
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error('Camera API not available (needs https or localhost).');
      this.stream = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480 }, audio: false });
      const v = document.createElement('video');
      v.muted = true;
      v.playsInline = true;
      v.srcObject = this.stream;
      await v.play();
      this.video = v;
    } catch (e) {
      this.error = (e as Error).message || String(e);
      this.stream = null;
    }
    this.starting = false;
    this.emit();
  }

  stop(): void {
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.video = null;
    this.emit();
  }

  frame(width: number, height: number, p: ImageParams): Frame | null {
    const v = this.video;
    if (!v || v.readyState < 2) return null;
    const gray = sampleGray(v, v.videoWidth, v.videoHeight, width, height, p.fit, p.mirror);
    return processGray(gray, width, height, p);
  }
}

export const webcam = new Webcam();

export const liveContext: LiveContext = {
  webcam: (w, h, p) => webcam.frame(w, h, p),
  input: (w, h) => (bridge.lastInput ? scaleFrame(bridge.lastInput, w, h) : null),
};
