import { frameFromBase64, frameToBase64, type Frame } from '../core/frame';

export type BridgeStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

export interface BridgeInfo {
  oscIn?: number;
  oscOut?: string;
  oscFormat?: string;
  clients?: number;
  version?: string;
}

/**
 * WebSocket client for the local bridge (bridge/bridge.mjs).
 *
 * Browser → bridge: {"type":"frame","width":28,"height":14,"bits":"<base64>"}
 * Bridge → browser: same shape, for frames arriving over OSC (TouchDesigner, Unreal…)
 *
 * bits = packed bits, row-major, MSB first (see src/core/frame.ts packBits).
 */
export class BridgeClient {
  private ws: WebSocket | null = null;
  private retry = 0;
  private retryTimer = 0;
  private wantOpen = false;
  status: BridgeStatus = 'disconnected';
  info: BridgeInfo = {};
  error = '';
  url = 'ws://localhost:8765';
  sent = 0;
  received = 0;
  lastInput: Frame | null = null;
  lastInputAt = 0;
  private listeners = new Set<() => void>();
  onInputFrame: ((f: Frame) => void) | null = null;

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };
  private emit() {
    this.lastEmit = performance.now();
    this.listeners.forEach((l) => l());
  }
  private lastEmit = 0;
  /** Counters change many times a second; tell the UI at most ~4×/s. */
  private emitSoon() {
    if (performance.now() - this.lastEmit > 250) this.emit();
  }

  connect(url = this.url): void {
    this.url = url;
    this.wantOpen = true;
    this.open();
  }

  disconnect(): void {
    this.wantOpen = false;
    clearTimeout(this.retryTimer);
    this.ws?.close();
    this.ws = null;
    this.status = 'disconnected';
    this.emit();
  }

  private open() {
    clearTimeout(this.retryTimer);
    this.ws?.close();
    this.status = 'connecting';
    this.error = '';
    this.emit();
    let ws: WebSocket;
    try {
      ws = new WebSocket(this.url);
    } catch (e) {
      this.status = 'error';
      this.error = String((e as Error).message ?? e);
      this.emit();
      return;
    }
    this.ws = ws;
    ws.onopen = () => {
      this.retry = 0;
      this.status = 'connected';
      ws.send(JSON.stringify({ type: 'hello', role: 'studio' }));
      this.emit();
    };
    ws.onmessage = (ev) => {
      if (typeof ev.data !== 'string') return;
      let msg: any;
      try {
        msg = JSON.parse(ev.data);
      } catch {
        return;
      }
      if (msg.type === 'status') {
        this.info = msg;
        this.emit();
      } else if (msg.type === 'frame' && msg.width > 0 && msg.height > 0 && typeof msg.bits === 'string') {
        const f = frameFromBase64(msg.bits, msg.width, msg.height);
        this.lastInput = f;
        this.lastInputAt = performance.now();
        this.received++;
        this.onInputFrame?.(f);
        this.emitSoon();
      }
    };
    ws.onerror = () => {
      this.error = 'Could not reach the bridge. Is `npm run bridge` running?';
    };
    ws.onclose = () => {
      if (this.ws !== ws) return;
      this.ws = null;
      this.status = this.wantOpen ? 'error' : 'disconnected';
      this.emit();
      if (this.wantOpen) {
        const delay = Math.min(10000, 500 * 2 ** this.retry++);
        this.retryTimer = window.setTimeout(() => this.open(), delay);
      }
    };
  }

  sendFrame(f: Frame, changed: number): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    // Drop frames if the socket is backed up, rather than building latency.
    if (this.ws.bufferedAmount > 64 * 1024) return;
    this.ws.send(JSON.stringify({ type: 'frame', width: f.width, height: f.height, bits: frameToBase64(f), changed }));
    this.sent++;
    this.emitSoon();
  }
}

export const bridge = new BridgeClient();
